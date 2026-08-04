import { Vector3, Mesh, OctahedronGeometry, MeshBasicMaterial, Group } from 'three'
import { createRenderer, hasWebGL, showFallback, WEBGL_MESSAGE } from './core/renderer'
import { createStepper } from './core/loop'
import { createInterpolatedVector, type InterpolatedVector } from './core/interpolation'
import { InputTracker } from './core/input'
import {
  DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG, DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG,
} from './core/config'
import { loadSave, writeSave } from './core/save'
import { loadGLTF } from './core/assets'
import { buildWorld, type World } from './world/world'
import { ARCHIPELAGO } from './world/levels/archipelago'
import { placeShrines } from './world/shrine'
import { windSampler, stillAir, type WindSample } from './world/wind'
import { createWindTell } from './world/wind-tell'
import { startEncounter, stepEncounter } from './combat/encounter'
import { DEFAULT_COMBAT_CONFIG, HOME_PATROL } from './combat/config'
import { DEFAULT_FOCUS_CONFIG, DEFAULT_AVATAR_STATE_CONFIG } from './focus/config'
import { emptyFocus, stepFocus, type FocusEvents } from './focus/focus'
import { traversalRatePerSecond, fellOutOfWorld } from './focus/sources'
import { restingAvatarState, stepAvatarState, armFraction } from './focus/avatar-state'
import { boostedCombatConfig, surgeWind, refillBreath } from './focus/effects'
import { waveRadius } from './combat/pressure-wave'
import { detectSlam, applyBounce } from './player/slam'
import { createShockwave } from './fx/shockwave'
import { createEffectPool } from './fx/effect-pool'
import { createGustCone } from './fx/gust-cone'
import { createStaffArc } from './fx/staff-arc-fx'
import { staffShape } from './combat/staff-arc'
import { createDashTrail } from './fx/dash-trail'
import { createImpact } from './fx/impact'
import { createAvatarAura } from './fx/avatar-aura'
import { createSlipstreamTrail } from './fx/slipstream-trail'
import { createGuardShell } from './fx/guard-shell'
import { createVortexRing } from './fx/vortex-ring'
import { createVortexChargeTell } from './fx/vortex-charge'
import { vortexRadius } from './combat/vortex'
import { createEnemyView } from './combat/enemy-mesh'
import { createWaterfall } from './world/waterfall'
import { createPlayerState, spawnPointFor } from './player/state'
import { canSlipstream, isInvulnerable, dodgeHeading } from './player/slipstream'
import { controllerStep, staffStep, willRespawn, type ControllerDeps } from './player/controller'
import { collectStep } from './player/shrine-collect'
import { enableShadows } from './core/sun'
import { createAvatar } from './player/avatar'
import { createGlider } from './player/glider'
import { animationFor, chargeSquashScale } from './player/avatar-anim'
import { profileFor, desiredCameraPosition, smoothTowards, pullInForTerrain } from './camera/follow-cam'
import { createHud, hudModelFor } from './ui/hud'
import { createGuide, guideModelFor } from './ui/guide/panel'
import { canGust, canVortex } from './combat/encounter'
import { isArmed } from './focus/avatar-state'
import { createWindAudio } from './fx/audio'
import { fovForSpeed } from './fx/mapping'

/** How much faster the mote clouds drift while the Avatar State runs. */
const WIND_TELL_SURGE = 2.5
/** Wind audio lift while the Avatar State runs. */
const AUDIO_SWELL = 0.45

function start(): void {
  if (!hasWebGL()) return showFallback(WEBGL_MESSAGE)

  const canvas = document.getElementById('game')
  if (!(canvas instanceof HTMLCanvasElement)) {
    return showFallback('Could not find the game canvas.')
  }

  let world: World
  try {
    world = buildWorld(ARCHIPELAGO)
  } catch (error) {
    return showFallback(`The level failed to load: ${(error as Error).message}`)
  }

  const { renderer, scene, camera, followSun } = createRenderer(canvas)
  scene.add(world.group)
  enableShadows(world.group)

  const save = loadSave(localStorage, DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
  let player = createPlayerState(ARCHIPELAGO, world.terrain, save, DEFAULT_FLIGHT_CONFIG)
  let shrines = placeShrines(ARCHIPELAGO, world.terrain, save.collectedShrines)

  // Focus is a live meter and is deliberately not saved.
  let focus = emptyFocus(DEFAULT_FOCUS_CONFIG)
  let avatarState = restingAvatarState()
  let avatarActive = false
  /** The unsurged sample from the last windAt call, so the surge cannot feed itself. */
  let lastWind: WindSample = stillAir()
  /** Every live one-shot effect. The pool owns removal and disposal. */
  const effects = createEffectPool(scene)

  // Shrine markers: a spinning octahedron each, hidden once collected.
  const shrineGroup = new Group()
  const markers = new Map<string, Mesh>()
  for (const shrine of shrines) {
    const mesh = new Mesh(
      new OctahedronGeometry(1.2),
      new MeshBasicMaterial({ color: 0xd9f4ff }),
    )
    mesh.position.copy(shrine.position)
    mesh.visible = !shrine.collected
    markers.set(shrine.id, mesh)
    shrineGroup.add(mesh)
  }
  scene.add(shrineGroup)

  const waterfalls: { advance(dt: number): void }[] = []
  for (const def of ARCHIPELAGO.waterfalls) {
    const island = ARCHIPELAGO.islands.find((i) => i.id === def.islandId)
    if (!island) continue
    const waterfall = createWaterfall(island, def, world.terrain)
    if (!waterfall) {
      console.warn(
        `Dropped waterfall on island "${def.islandId}" at angle ${def.angle}: no ground found ` +
        'at any rim inset.',
      )
      continue
    }
    scene.add(waterfall.mesh)
    waterfalls.push(waterfall)
  }

  // A wind feature the player cannot see is a bug, so each one is given its tell.
  const windTells = (ARCHIPELAGO.winds ?? []).map((def) => {
    const tell = createWindTell(def)
    scene.add(tell.object)
    return tell
  })

  // The one encounter: spear infantry on the home island.
  let encounter = startEncounter(
    HOME_PATROL.map((spawn) => ({
      ...spawn,
      // Dropped onto the ground rather than trusting the authored y.
      position: spawn.position.clone().setY(
        world.terrain.groundHeightAt(spawn.position.x, spawn.position.z) ?? spawn.position.y,
      ),
    })),
    DEFAULT_COMBAT_CONFIG,
  )
  const enemyViews = new Map(encounter.enemies.map((enemy) => {
    const view = createEnemyView()
    scene.add(view.object)
    enableShadows(view.object)
    return [enemy.id, view] as const
  }))

  const avatar = createAvatar()
  scene.add(avatar.object)

  const glider = createGlider()
  // A child of the avatar, so it inherits the character's position and facing.
  avatar.object.add(glider.object)

  const aura = createAvatarAura()
  // A child of avatar.object, alongside the glider — never of the model, which lives in
  // an inner wrapper that absorbs the fitting and squash transforms.
  avatar.object.add(aura.object)

  const chargeTell = createVortexChargeTell()
  // Same attachment pattern as the aura: a child of avatar.object, not the model.
  avatar.object.add(chargeTell.object)

  const guard = createGuardShell()
  // Same attachment pattern as the aura: a child of avatar.object, not the model.
  avatar.object.add(guard.object)

  // BASE_URL, not a bare absolute path: vite.config.ts sets base to
  // '/airbender-skies/' for GitHub Pages, so "/models/..." would resolve in dev
  // and 404 only on the deployed site. Fire-and-forget on purpose — loadGLTF
  // resolves null instead of rejecting, so a missing file leaves the placeholder
  // standing and the game still starts.
  void loadGLTF(`${import.meta.env.BASE_URL}models/character.glb`).then((gltf) => {
    if (!gltf) return
    avatar.attachModel(gltf)
    // The model's meshes arrive after the first frame, so they miss the initial pass.
    enableShadows(avatar.object)
  })

  const input = new InputTracker(window, canvas)
  const hud = createHud(document.body)
  // Rebuilt on open rather than per frame: the simulation is paused while the guide is
  // up, so there is nothing to refresh. `canGust` and `isArmed` are asked here rather
  // than inside the guide, so a fight object and an Avatar State never reach the UI.
  const guide = createGuide(document.body, () => {
    if (!guide.isOpen()) return
    guide.update(guideModelFor({
      player,
      ground: DEFAULT_GROUND_CONFIG,
      wave: DEFAULT_COMBAT_CONFIG.pressureWave,
      gustReady: canGust(encounter),
      avatarStateReady: isArmed(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
      vortexReady: canVortex(encounter),
      slipstreamReady: canSlipstream({
        elapsed: player.slipstreamElapsed,
        cooldown: player.slipstreamCooldown,
      }),
    }))
  })
  const wind = createWindAudio()
  canvas.addEventListener('click', () => wind.start(), { once: true })

  const baseWindAt = windSampler(ARCHIPELAGO.winds ?? [])

  const deps: ControllerDeps = {
    terrain: world.terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    spawnPointFor: spawnPointFor(ARCHIPELAGO, world.terrain),
    slipstream: DEFAULT_SLIPSTREAM_CONFIG,
    staff: DEFAULT_STAFF_CONFIG,
    // Surged for the Avatar State on the way out, and the unsurged sample kept so the
    // Focus rate reads the real air. Otherwise the surge feeds itself: the state boosts
    // the wind, and the boosted wind pays more Focus.
    windAt: (position, forward) => {
      lastWind = baseWindAt(position, forward)
      return surgeWind(lastWind, avatarActive ? 1 : 0, DEFAULT_AVATAR_STATE_CONFIG)
    },
  }

  let cameraPosition = camera.position.clone()

  // Rendered frames outnumber simulation steps on high-refresh displays. update()
  // records each step's result into these; syncVisuals() draws between them.
  const playerPositionLerp = createInterpolatedVector()
  playerPositionLerp.record(player.position)
  const playerForwardLerp = createInterpolatedVector()
  playerForwardLerp.record(player.forward)
  const enemyPositionLerps = new Map<string, InterpolatedVector>()
  // The camera reads the look direction per rendered frame, but input is only
  // sampled per simulation step; this carries the last sample across.
  const lookDirection = new Vector3(0, 0, -1)
  // Scratch for sample() so syncVisuals allocates nothing per frame.
  const sampledPosition = new Vector3()
  const sampledForward = new Vector3()
  const sampledEnemy = new Vector3()

  function update(dt: number): void {
    const state = input.sample()

    // Read before controllerStep: it resolves a fall internally and hands back an
    // already-respawned state, so there is nothing left to observe afterwards.
    const crashed = fellOutOfWorld(player, ARCHIPELAGO.worldFloorY)

    // Steps first, off last frame's Focus, so the effects apply from the frame the
    // player pressed rather than the one after. The cost is a frame of latency on
    // arming, which nobody can feel; the benefit is that no system here needs a value
    // that depends on itself.
    const asStep = stepAvatarState(
      avatarState, focus, state.avatarStatePressed, dt, DEFAULT_AVATAR_STATE_CONFIG,
    )
    avatarState = asStep.state
    avatarActive = asStep.active

    // Cleared each frame; windAt overwrites it when the glider asks about the air.
    lastWind = stillAir()
    // Held across the step so the impact speed survives the landing that zeroes it.
    const beforeStep = player
    // Read beside controllerStep rather than after it: staffStep needs the same
    // pre-step state, input, dt and staff config controllerStep is about to consume,
    // since a PlayerState alone cannot say a swing started this frame as opposed to
    // continuing one already in progress.
    //
    // Gated on the same `willRespawn` check the slam guard below uses (a NaN position,
    // or falling past the world floor): `controllerStep` resets the whole combo to idle
    // on that frame via `safeRespawn`, so a swing reported here would resolve against
    // enemies in the fight for a player who, this same frame, is on the way out of the
    // world — landing a hit on the way to a respawn.
    const staffSwing = willRespawn(player, ARCHIPELAGO.worldFloorY)
      ? null
      : staffStep(player, state, dt, deps.staff)
    player = controllerStep(player, state, dt, deps)
    if (avatarActive) player = refillBreath(player)

    // Deliberately not `crashed` here, even though both flag a respawn. `crashed`
    // (fellOutOfWorld) only covers falling past the world floor, which is all the
    // Focus crash-drain below is meant to react to — draining Focus for a
    // corruption respawn too would be a behaviour change nobody asked for. The slam
    // guard needs the wider net: `willRespawn` also covers a non-finite state, which
    // respawns grounded from whatever fall speed corrupted it, and that must not
    // read as a slam either. Do not collapse these into one flag.
    const slam = detectSlam(
      beforeStep, player, state.tuck, willRespawn(beforeStep, ARCHIPELAGO.worldFloorY),
      DEFAULT_COMBAT_CONFIG.pressureWave,
    )

    // A dash fired iff the chain advanced this frame. Read across the step, the same way
    // the slam is, so no movement code has to report anything. The origin is where the
    // burst started; the heading is the velocity it produced.
    if (player.dashesUsed > beforeStep.dashesUsed) {
      effects.add(createDashTrail(
        beforeStep.position, player.velocity, player.dashesUsed, DEFAULT_GROUND_CONFIG,
      ))
    }

    // A Slipstream fired iff its elapsed timer went from null to running this frame,
    // the same before/after comparison the dash trail above uses. The origin is where
    // the dodge started; the heading is recomputed with `dodgeHeading` rather than read
    // off `player.velocity` — velocity carries whatever momentum the dodge was added to,
    // so a fast glider dodge would draw a streak pointing where the player was already
    // going instead of where they actually dodged. `dodgeHeading` is deterministic and is
    // the same function the controller resolved the dodge with, fed the same inputs this
    // frame, so the drawn direction cannot drift from the real one.
    if (player.slipstreamElapsed !== null && beforeStep.slipstreamElapsed === null) {
      effects.add(createSlipstreamTrail(
        beforeStep.position,
        dodgeHeading(player.mode, player.forward, state.lookDirection, state.forward, state.strafe),
        DEFAULT_SLIPSTREAM_CONFIG,
      ))
    }

    if (slam) {
      // The ring is placed at the point of contact, before the bounce moves the player.
      const ring = createShockwave(
        waveRadius(slam.strength, DEFAULT_COMBAT_CONFIG.pressureWave), slam.strength,
      )
      ring.object.position.copy(player.position)
      effects.add(ring)
      player = applyBounce(player, slam, DEFAULT_COMBAT_CONFIG.pressureWave)
    }

    const collection = collectStep(player, shrines, DEFAULT_FLIGHT_CONFIG)
    if (collection.collected.length > 0) {
      player = collection.player
      shrines = collection.shrines
      for (const id of collection.collected) {
        const marker = markers.get(id)
        if (marker) marker.visible = false
      }
      writeSave(localStorage, {
        collectedShrines: shrines.filter((s) => s.collected).map((s) => s.id),
        maxBreath: player.maxBreath,
      })
    }

    avatar.setAnimation(animationFor(player))
    avatar.setSquash(chargeSquashScale(player, deps.ground))
    followSun(player.position)
    avatar.update(dt)
    glider.update(dt, player.mode === 'glider')
    aura.update(dt, avatarActive)
    // Tracks the invulnerability window exactly, not the whole dash: the window is
    // the mechanic, so the shell must vanish the instant `isInvulnerable` goes false.
    guard.update(dt, isInvulnerable(
      { elapsed: player.slipstreamElapsed, cooldown: player.slipstreamCooldown },
      DEFAULT_SLIPSTREAM_CONFIG,
    ))

    lookDirection.copy(state.lookDirection)
    const airspeed = player.velocity.length()

    for (const marker of markers.values()) marker.rotation.y += dt * 1.5
    for (const waterfall of waterfalls) waterfall.advance(dt)
    for (const tell of windTells) tell.advance(dt * (avatarActive ? WIND_TELL_SURGE : 1))

    effects.advance(dt)

    // Hoisted so the drawn cone and the resolved gust cannot read different configs.
    // During the Avatar State the gust's reach and cooldown differ from the base config,
    // and a cone drawn from the base one would misrepresent what the fight just did.
    const fightConfig = boostedCombatConfig(
      DEFAULT_COMBAT_CONFIG, avatarActive, DEFAULT_AVATAR_STATE_CONFIG,
    )

    // fightConfig.vortex, not the unboosted default, so the tell agrees with whatever
    // the Avatar State is currently doing to the move's reach.
    chargeTell.update(dt, encounter.vortexHeldSeconds, fightConfig.vortex)

    // Asked against the pre-step encounter, so the visual agrees with what stepEncounter
    // will actually do on this same frame rather than a frame late.
    if (state.gustPressed && canGust(encounter)) {
      effects.add(createGustCone(player.position, player.forward, fightConfig.gust))
    }

    // staffShape(staffSwing.finisher, fightConfig.staffArc): the same call stepEncounter is
    // about to resolve the swing with, so the drawn arc and the hit arc cannot diverge.
    if (staffSwing) {
      effects.add(createStaffArc(
        player.position, player.forward, staffShape(staffSwing.finisher, fightConfig.staffArc),
      ))
    }

    const fight = stepEncounter(encounter, {
      playerPosition: player.position,
      playerForward: player.forward,
      gustPressed: state.gustPressed,
      slam: slam ? { strength: slam.strength } : null,
      vortexHeld: state.vortexHeld,
      vortexReleased: state.vortexReleased,
      playerInvulnerable: isInvulnerable(
        { elapsed: player.slipstreamElapsed, cooldown: player.slipstreamCooldown },
        DEFAULT_SLIPSTREAM_CONFIG,
      ),
      staffSwing,
    }, dt, fightConfig, { ground: world.terrain, worldFloorY: ARCHIPELAGO.worldFloorY })
    encounter = fight.encounter
    for (const enemy of encounter.enemies) enemyViews.get(enemy.id)?.sync(enemy, camera.quaternion)

    // Drawn at the true vortexRadius for the same reason the gust cone is drawn at its
    // true hit volume — a pull that reaches outside the visible ring reads as a bug.
    if (fight.vortexFired !== null) {
      effects.add(createVortexRing(
        player.position, vortexRadius(fight.vortexFired, fightConfig.vortex),
      ))
    }

    // A down and a connect both name an enemy that went down this frame, because the two
    // lists are computed at different moments. The down is the louder statement, so it
    // wins and the connect is dropped.
    const downedNow = new Set(fight.downedThisFrame)
    const positionOf = (id: string) => encounter.enemies.find((e) => e.id === id)?.position
    for (const id of new Set([...fight.hitThisFrame, ...fight.slamHitThisFrame])) {
      if (downedNow.has(id)) continue
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'hit'))
    }
    for (const id of fight.downedThisFrame) {
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'down'))
    }

    const events: FocusEvents = {
      gustConnects: fight.hitThisFrame.length,
      downs: fight.downedThisFrame.length,
      slamStrength: slam?.strength ?? 0,
      playerHit: fight.playerHit,
      fellOutOfWorld: crashed,
      damageAvoided: fight.damageAvoided,
      staffConnects: fight.staffHitThisFrame.length,
    }
    const inWind = lastWind.accel.lengthSq() > 1e-6 || lastWind.liftScale !== 1
    focus = stepFocus(focus, {
      ratePerSecond: traversalRatePerSecond(
        player, inWind, DEFAULT_FLIGHT_CONFIG, DEFAULT_FOCUS_CONFIG,
      ),
      events,
      frozen: avatarActive,
      reset: asStep.justEnded,
    }, dt, DEFAULT_FOCUS_CONFIG)

    wind.update(
      player.mode === 'glider' ? airspeed : 0,
      avatarActive ? AUDIO_SWELL : 0,
    )
    hud.update(hudModelFor(player, encounter.playerHealth, {
      focus: focus.max > 0 ? focus.value / focus.max : 0,
      avatarCharge: armFraction(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
      avatarActive,
    }))

    playerPositionLerp.record(player.position)
    playerForwardLerp.record(player.forward)
    for (const enemy of encounter.enemies) {
      let lerp = enemyPositionLerps.get(enemy.id)
      if (!lerp) {
        lerp = createInterpolatedVector()
        enemyPositionLerps.set(enemy.id, lerp)
      }
      lerp.record(enemy.position)
    }
  }

  /**
   * Runs once per rendered frame, not per simulation step. The hard split:
   * update() writes simulation state and records snapshots; only this function
   * touches the avatar transform, enemy-view positions, and the camera.
   */
  function syncVisuals(alpha: number, frameDt: number): void {
    playerPositionLerp.sample(alpha, sampledPosition)
    playerForwardLerp.sample(alpha, sampledForward)
    // Face the character along its heading, in both modes. On foot this used to face the
    // direction of travel, which left the model looking one way while a gust blew another:
    // travel is zero exactly when a player stops to aim, so a standing turn moved the blast
    // and not the character. One rule now, and what the character faces is what it hits.
    avatar.object.position.copy(sampledPosition)
    if (sampledForward.lengthSq() > 1e-4) {
      avatar.object.lookAt(
        sampledPosition.x + sampledForward.x,
        sampledPosition.y + sampledForward.y,
        sampledPosition.z + sampledForward.z,
      )
    }

    for (const enemy of encounter.enemies) {
      const view = enemyViews.get(enemy.id)
      const lerp = enemyPositionLerps.get(enemy.id)
      if (view && lerp) view.object.position.copy(lerp.sample(alpha, sampledEnemy))
    }

    // smoothTowards is exponential decay, so feeding real frame time instead of
    // the fixed step changes nothing at 60 Hz and adds samples above it.
    const profile = profileFor(player.mode)
    const desired = pullInForTerrain(
      sampledPosition,
      desiredCameraPosition(sampledPosition, lookDirection, profile),
      world.terrain,
    )
    cameraPosition = smoothTowards(cameraPosition, desired, profile.smoothing, frameDt)
    camera.position.copy(cameraPosition)
    camera.lookAt(sampledPosition)
    camera.fov = player.mode === 'glider' ? fovForSpeed(player.velocity.length()) : fovForSpeed(0)
    camera.updateProjectionMatrix()
  }

  const stepper = createStepper({
    update,
    render: (alpha, frameDt) => {
      syncVisuals(alpha, frameDt)
      renderer.render(scene, camera)
    },
  })

  let last = performance.now()
  function frame(now: number): void {
    if (guide.isOpen()) {
      // Drain the input edges so a jump pressed just before opening does not fire on
      // close, and hold `last` at now so no time accumulates to lurch through when it
      // does. The scene still renders, so the world stays visible behind the panel.
      input.sample()
      last = now
      renderer.render(scene, camera)
    } else {
      stepper.advance((now - last) / 1000)
      last = now
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

start()
