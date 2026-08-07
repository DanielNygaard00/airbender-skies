import { Vector3, Mesh, OctahedronGeometry, MeshBasicMaterial, Group } from 'three'
import { createRenderer, hasWebGL, showFallback, WEBGL_MESSAGE } from './core/renderer'
import { createStepper } from './core/loop'
import { createInterpolatedVector, type InterpolatedVector } from './core/interpolation'
import { InputTracker } from './core/input'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_DOWN_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG, validateCollisionConfig, validateFlightConfig,
} from './core/config'
import { loadSave, writeSave } from './core/save'
import { loadGLTF } from './core/assets'
import { buildWorld, type World } from './world/world'
import { ARCHIPELAGO } from './world/levels/archipelago'
import { placeShrines } from './world/shrine'
import { windSampler, stillAir, type WindSample } from './world/wind'
import { createWindTell } from './world/wind-tell'
import { startEncounter, stepEncounter } from './combat/encounter'
import { risingProgress } from './combat/enemy'
import { DEFAULT_COMBAT_CONFIG, DEFAULT_PATROL_CONFIG, HOME_PATROL } from './combat/config'
import { fullHealth, isDowned } from './combat/health'
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
import { createArrowView, type ArrowView } from './fx/arrow'
import { createWaterfall } from './world/waterfall'
import { createPlayerState, spawnPointFor } from './player/state'
import { canSlipstream, isInvulnerable, dodgeHeading } from './player/slipstream'
import {
  controllerStep, safeRespawn, staffStep, willRespawn, type ControllerDeps,
} from './player/controller'
import { collectStep } from './player/shrine-collect'
import {
  collapseSquash, fadeOpacity, hasRespawned, startDown, stepDown, type Down,
} from './player/down'
import { enableShadows } from './core/sun'
import { createAvatar } from './player/avatar'
import { createGlider } from './player/glider'
import { createAimTell } from './fx/aim-tell'
import { anyLiveGustTarget } from './combat/gust'
import { stallSeverity } from './player/stall'
import { animationFor, chargeSquashScale } from './player/avatar-anim'
import { profileFor, desiredCameraPosition, smoothTowards, pullInForTerrain } from './camera/follow-cam'
import { createHud, hudModelFor } from './ui/hud'
import { createGuide, guideModelFor } from './ui/guide/panel'
import { pauseReason, pauseOverlayModel } from './core/pause'
import { createPauseOverlay } from './ui/pause-overlay'
import { canGust, canVortex } from './combat/encounter'
import { isArmed } from './focus/avatar-state'
import { createWindAudio } from './fx/audio'
import { fovForSpeed, fovKickForDash } from './fx/mapping'
import {
  noHitstop, isFrozen, triggerHitstop, stepHitstop, slamHitstopSeconds,
} from './fx/hitstop'
import { noShake, triggerShake, stepShake, shakeOffset, slamShakeAmplitude } from './fx/shake'
import {
  DASH_KICK_DECAY_PER_SECOND, DEFAULT_HITSTOP_CONFIG, DEFAULT_SHAKE_CONFIG,
  HURT_FLASH_DECAY_PER_SECOND,
} from './fx/config'
import { stepPulse } from './fx/pulse'
import { impactTargets } from './fx/impact-targets'
import { createCombatAudio } from './fx/combat-audio'

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

  // A bad tuning value fails here, at startup, rather than surfacing later as a stall
  // that never resolves, a hover that drains no breath, or a wall that no longer deflects.
  validateFlightConfig(DEFAULT_FLIGHT_CONFIG)
  validateCollisionConfig(DEFAULT_COLLISION_CONFIG)

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
  /** The beat between going down and standing back up, or null while playing. */
  let down: Down | null = null
  /** The unsurged sample from the last windAt call, so the surge cannot feed itself. */
  let lastWind: WindSample = stillAir()
  /** Every live one-shot effect. The pool owns removal and disposal. */
  const effects = createEffectPool(scene)

  let hitstop = noHitstop()
  let shake = noShake()
  let hurtFlash = 0
  let dashKick = 0
  const shakeVec = new Vector3()
  const combatAudio = createCombatAudio()

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

  // The one encounter: three spears and two archers on the home island, per HOME_PATROL.
  //
  // Hoisted into a const and handed to both startEncounter and the fight's deps below,
  // because the restore respawns from `deps.spawns` and there must be exactly one answer
  // to where the patrol stands. Passing raw HOME_PATROL as the deps meant a restored
  // soldier spawned at the authored `y: 0` while the initial three stood on the terrain:
  // the home island is an icosphere at the origin, so ground at (26,-18) is roughly 30 m
  // up, and a restored soldier appeared 30 m inside the island for `fall()` to snap out on
  // its first step. Invisible only by luck — a 30 m correction exceeds the interpolator's
  // snap distance, so the view collapsed instead of sliding — and a spawn point over lower
  // terrain would have slid visibly up out of the ground.
  const patrolSpawns = HOME_PATROL.map((spawn) => ({
    ...spawn,
    // Dropped onto the ground rather than trusting the authored y.
    position: spawn.position.clone().setY(
      world.terrain.groundHeightAt(spawn.position.x, spawn.position.z) ?? spawn.position.y,
    ),
  }))
  let encounter = startEncounter(patrolSpawns, DEFAULT_COMBAT_CONFIG)
  const enemyViews = new Map(encounter.enemies.map((enemy) => {
    const view = createEnemyView(enemy.kind)
    scene.add(view.object)
    enableShadows(view.object)
    return [enemy.id, view] as const
  }))

  /**
   * One view per arrow in flight, created on first sight and disposed when the arrow is
   * gone. Keyed by projectile id, the same way enemyViews is keyed by enemy id.
   */
  const arrowViews = new Map<string, ArrowView>()

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

  // Parented to the scene, not the avatar, and deliberately so: the avatar is rotated in
  // syncVisuals from the *interpolated* heading, but this tell must read the simulation's
  // player.forward, which is the same value inGust tests. Parenting to the avatar would
  // inherit the facing for free but would then be reading the wrong heading — a hit-volume
  // tell has to agree with the hit, not with the smoothed visual.
  const aimTell = createAimTell()
  scene.add(aimTell.object)

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
  // Pointer lock is the signal for "the mouse is aiming rather than pointing", and losing
  // it is what Escape does. Before this, Escape released the mouse and the simulation
  // carried on: the look direction froze wherever it was and the patrol kept closing.
  let pointerLocked = document.pointerLockElement === canvas
  let documentHidden = document.hidden
  /** True from the first time the lock is actually held, which is what "play" means here. */
  let everStarted = pointerLocked
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas
    if (pointerLocked) everStarted = true
  })
  document.addEventListener('visibilitychange', () => {
    documentHidden = document.hidden
  })
  const hud = createHud(document.body)
  const overlay = createPauseOverlay(document.body)
  // Rebuilt on open rather than per frame: the simulation is paused while the guide is
  // up, so there is nothing to refresh. `canGust` and `isArmed` are asked here rather
  // than inside the guide, so a fight object and an Avatar State never reach the UI.
  const guide = createGuide(document.body, () => {
    if (!guide.isOpen()) return
    guide.update(guideModelFor({
      player,
      ground: DEFAULT_GROUND_CONFIG,
      flight: DEFAULT_FLIGHT_CONFIG,
      wave: DEFAULT_COMBAT_CONFIG.pressureWave,
      gustReady: canGust(encounter),
      avatarStateReady: isArmed(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
      vortexReady: canVortex(encounter),
      slipstreamReady: canSlipstream(
        { elapsed: player.slipstreamElapsed, cooldown: player.slipstreamCooldown },
        player.breath,
        DEFAULT_SLIPSTREAM_CONFIG,
      ),
    }))
  })
  const wind = createWindAudio()
  // Both need a user gesture to unblock audio, and this is the one the wind audio
  // already waits for, so the combat voices ride along on the same click.
  canvas.addEventListener('click', () => {
    wind.start()
    combatAudio.start()
  }, { once: true })

  const baseWindAt = windSampler(ARCHIPELAGO.winds ?? [])

  const deps: ControllerDeps = {
    terrain: world.terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    spawnPointFor: spawnPointFor(ARCHIPELAGO, world.terrain),
    slipstream: DEFAULT_SLIPSTREAM_CONFIG,
    staff: DEFAULT_STAFF_CONFIG,
    collision: DEFAULT_COLLISION_CONFIG,
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

  /**
   * Stand the player back up, at the moment the screen is fully black.
   *
   * Health is restored with the existing `fullHealth` rather than a new `revive` in
   * `health.ts`: it already returns exactly the right pool, and a second name for one
   * behaviour is a second thing to keep true.
   *
   * The fight is deliberately left alone. Enemies keep their damage, positions and
   * stances exactly as the beat found them, so the patrol may well still be aggroed
   * on the walk back in — the cost of going down is that walk plus the wiped Focus,
   * not a guaranteed clean reset.
   */
  function recover(): void {
    player = safeRespawn(player, deps)
    encounter = { ...encounter, playerHealth: fullHealth(DEFAULT_COMBAT_CONFIG.player) }
    focus = emptyFocus(DEFAULT_FOCUS_CONFIG)
    avatarState = restingAvatarState()
    avatarActive = false
    // Snapped, not smoothed. smoothTowards would converge across the fade in at
    // GROUND_PROFILE's smoothing of 9, but "converges in time" depends on two tuning
    // constants in different files agreeing, and a snap behind full black is free.
    // Composed the same way syncVisuals composes them, so the snapped position is one
    // the smoothing would have been allowed to reach rather than a seat inside a hillside.
    cameraPosition = pullInForTerrain(
      player.position,
      desiredCameraPosition(player.position, lookDirection, profileFor(player.mode)),
      world.terrain,
    )
    // Re-primed here because the frozen branch returns before update()'s own
    // record() calls, and syncVisuals is not gated on `down` — the stepper renders
    // every frame regardless. Left stale, the fade-in would reveal the avatar back at
    // the death spot and smoothTowards would drag the camera off the snap above.
    // reset() after record(), not record() alone: record()'s own snap only collapses
    // the pair past DEFAULT_SNAP_DISTANCE, which a respawn near the island centre
    // would not clear.
    playerPositionLerp.record(player.position)
    playerPositionLerp.reset()
    playerForwardLerp.record(player.forward)
    playerForwardLerp.reset()
  }

  function update(dt: number): void {
    hitstop = stepHitstop(hitstop, dt)
    // Returns before input.sample(), and that order is the whole trick. input.ts
    // documents sample() as "Call exactly once per frame: reading clears the action
    // edge", so sampling and then discarding would eat any press made during the
    // freeze -- a click landing inside a 60ms hitstop simply would not happen.
    // Returning first leaves the edge pending in the tracker, and it fires on the
    // first live frame.
    //
    // The accumulator needs no special handling: createStepper decrements it around
    // every update call regardless of what that call does, so an early return cannot
    // bank time and discharge it on resume.
    if (isFrozen(hitstop)) {
      // The interpolators do need handling, though, and this is the whole reason the
      // freeze is not simply a `return`. The early return skips the record() calls at the
      // end of this function, but createStepper goes on draining its accumulator, so
      // `alpha` keeps sawtoothing across [0,1) while each previous/current pair stays
      // pinned to the last live step. sample(alpha) therefore blends back and forth across
      // that step's displacement for the entire freeze — a full-strength slam's last
      // recorded step spans about 0.75 m vertically, and camera.lookAt(sampledPosition)
      // rotates with it, on top of the deliberate shake, so it reads as extra shake rather
      // than as a bug. reset() collapses each pair, so sample() returns current unblended
      // at any alpha: dead still, which is what a hitstop is.
      //
      // Every frozen frame, not once on entry. reset() is idempotent while nothing
      // records — previous is already current after the first call — so repeating it costs
      // three vector copies plus one per enemy, and the alternative is a second piece of
      // freeze state in this file that can fall out of step with `hitstop` itself.
      playerPositionLerp.reset()
      playerForwardLerp.reset()
      for (const lerp of enemyPositionLerps.values()) lerp.reset()
      return
    }

    const state = input.sample()

    // The whole simulation holds while the beat runs, the same way frame() holds it while
    // the guide panel is open. No controllerStep, no stepEncounter, no Focus: the pose
    // freezes mid-stride, which is the point. `state` is sampled and thrown away above,
    // which drains the input edges — a jump held through the blackout must not fire on the
    // other side.
    if (down) {
      const step = stepDown(down, dt, DEFAULT_DOWN_CONFIG)
      down = step.down
      // Primed before recover(), not after: recover()'s camera snap reads this to place
      // the camera, and InputTracker accumulates yaw/pitch on every mousemove regardless
      // of whether anything samples it. Left stale, the snap would use whatever direction
      // was current the instant the player went down, and the camera would swing onto the
      // real orientation on the first normal frame instead of behind the black.
      lookDirection.copy(state.lookDirection)
      if (step.respawnNow) recover()
      avatar.setSquash(collapseSquash(down, DEFAULT_DOWN_CONFIG))
      // Before the respawn lands, the world is meant to look frozen — that is the whole
      // point of the beat, so nothing below advances. Once it lands, everything is behind
      // full black and has to settle into the recovered state before the black lifts, or
      // the fade-in reveals a glider deployed on a standing avatar, a still-boosted wind
      // roar, a shadow aimed at the death spot, and enemy health bars facing a camera
      // orientation that no longer exists. `avatar.update(dt)` is deliberately not among
      // these: the frozen animation pose is the point, and the clip name changing to
      // 'idle' is enough for it to land in the right state once movement resumes.
      if (hasRespawned(down, DEFAULT_DOWN_CONFIG)) {
        // Stall severity 0: the wing is being stowed on a player standing on the ground,
        // and a shudder on a folding staff would read as damage rather than as a stall.
        glider.update(dt, player.mode === 'glider', null, 0)
        aura.update(dt, avatarActive)
        guard.update(dt, false)
        // fightConfig is computed further down in the normal path and is not in scope
        // here. DEFAULT_COMBAT_CONFIG.vortex stands in for it safely: avatarActive is
        // false after recover(), so the boosted and unboosted configs agree at this point.
        chargeTell.update(dt, 0, DEFAULT_COMBAT_CONFIG.vortex)
        avatar.setAnimation(animationFor(player))
        wind.update(0, 0)
        followSun(player.position)
        for (const enemy of encounter.enemies) enemyViews.get(enemy.id)?.sync(
          enemy, camera.quaternion, risingProgress(enemy, DEFAULT_COMBAT_CONFIG.enemies[enemy.kind]),
        )
      }
      // The one thing that always keeps moving. The 'down' burst is the punctuation of
      // the event, not the world carrying on.
      effects.advance(dt)
      hud.update(hudModelFor(player, encounter.playerHealth, {
        focus: focus.max > 0 ? focus.value / focus.max : 0,
        avatarCharge: armFraction(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
        avatarActive,
        // hurtFlash and stall are both zero here: the hit that put the player down has
        // already flashed on the frame before the beat, and a stall warning behind a
        // black screen is noise. Passed explicitly rather than left to default, because
        // the fade has to land in the third slot of three trailing optional numbers.
      }, 0, 0, fadeOpacity(down, DEFAULT_DOWN_CONFIG)))
      return
    }

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
      dashKick = 1
    }
    // A cosmetic camera flourish, not a restatement of the dash's own decay -- see
    // DASH_KICK_DECAY_PER_SECOND for why it keeps its own 0.22 s lifetime rather than
    // borrowing groundResponse, which decays a different curve at a different rate.
    dashKick = stepPulse(dashKick, dt, DASH_KICK_DECAY_PER_SECOND)

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
        dodgeHeading(
          player.mode, player.forward, state.lookDirection, state.forward, state.strafe,
          // Same 0.6 as `controller.ts`'s call and `flightStep`'s bank field: this has to
          // resolve to the identical heading the controller used, or the streak would
          // point somewhere the dodge didn't actually go.
          state.strafe * 0.6,
        ),
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

    // One value, two consumers: the HUD readout and the wing shudder. stallSeverity applies
    // the posture gate itself, so neither of them has to know that a walk is slower than
    // stall speed.
    //
    // Read here rather than straight after the step, because `player` is reassigned twice
    // between the two — by the slam bounce and by the shrine collection — and this must be
    // the same velocity the HUD's airspeed number is formatted from. Computed earlier, a slam
    // frame took the number from the post-bounce velocity and the warning colour from the
    // pre-bounce one, so the readout reddened a frame out of step with itself. It has to stay
    // above both consumers: `glider.update` below and the `hudModelFor` call after it.
    const stall = stallSeverity(player, DEFAULT_FLIGHT_CONFIG)

    avatar.setAnimation(animationFor(player))
    avatar.setSquash(chargeSquashScale(player, deps.ground))
    followSun(player.position)
    avatar.update(dt)
    // Progress through the active swing, not the frame one started: `staffSwing` above is
    // only true on the frame a new swing begins, but the glider needs to track the motion
    // for the whole 0..swingSeconds window that follows. `player.staffElapsed` already
    // carries that, post-step, so no extra bookkeeping is needed here.
    const rawStaffProgress = player.staffElapsed === null
      ? null
      : Math.min(1, Math.max(0, player.staffElapsed / deps.staff.swingSeconds))
    // Alternate the sweep direction per swing so a combo doesn't read as the same stroke
    // repeated. Read off `player.staffChain` (the swing's own 1-based index) rather than a
    // second counter here — a second counter is a second thing that can drift out of step
    // with the combo it's supposed to track.
    const staffProgress = rawStaffProgress === null
      ? null
      : (player.staffChain % 2 === 0 ? 1 - rawStaffProgress : rawStaffProgress)
    glider.update(dt, player.mode === 'glider', staffProgress, stall)
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

    // Hoisted so every tell drawn below and the gust the fight resolves cannot read
    // different configs. The Avatar State's boost is confined to the gust's damage,
    // knockback and cooldown — none of which is a shape — so nothing drawn from this
    // config differs from the base one today. Reading the boosted config anyway is what
    // keeps that true for free if a future boost ever does reach a range or a half angle;
    // see the comment on aimTell below.
    const fightConfig = boostedCombatConfig(
      DEFAULT_COMBAT_CONFIG, avatarActive, DEFAULT_AVATAR_STATE_CONFIG,
    )

    // fightConfig.vortex rather than the unboosted default, for that same defensive reason
    // and no other: `boostedCombatConfig` does not touch the vortex at all, so this is the
    // very same object as the default today. Reading it here is what makes the tell follow
    // on its own if a boost ever does reach the vortex.
    chargeTell.update(dt, encounter.vortexHeldSeconds, fightConfig.vortex)

    // fightConfig, not the unboosted default, so the preview and the fired cone
    // (`createGustCone` below, also fed `fightConfig.gust`) read one source and cannot
    // diverge if a future boost ever does touch the gust's range or half angle — the same
    // reason chargeTell reads it. Today's Avatar State does not: `boostedCombatConfig`
    // (`src/focus/effects.ts`) only scales damage, knockback and cooldown.
    aimTell.update(
      player.position,
      player.forward,
      anyLiveGustTarget(player.position, player.forward, encounter.enemies, fightConfig.gust),
      canGust(encounter),
      fightConfig.gust,
    )

    // Asked against the pre-step encounter, so the visual agrees with what stepEncounter
    // will actually do on this same frame rather than a frame late.
    if (state.gustPressed && canGust(encounter)) {
      effects.add(createGustCone(player.position, player.forward, fightConfig.gust))
      combatAudio.gust()
    }

    // staffShape(staffSwing.finisher, fightConfig.staffArc): the same call stepEncounter is
    // about to resolve the swing with, so the drawn arc and the hit arc cannot diverge.
    if (staffSwing) {
      effects.add(createStaffArc(
        player.position, player.forward, staffShape(staffSwing.finisher, fightConfig.staffArc),
      ))
      combatAudio.swing(staffSwing.finisher)
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
    }, dt, fightConfig, {
      ground: world.terrain, worldFloorY: ARCHIPELAGO.worldFloorY,
      // The same ground-adjusted array startEncounter was built from, never raw
      // HOME_PATROL: a restored soldier has to stand where the original three did.
      spawns: patrolSpawns, patrol: DEFAULT_PATROL_CONFIG,
    })
    encounter = fight.encounter
    // A restored soldier reuses its id, so its interpolator still holds wherever the
    // body fell. Left alone the view would blend from there to the spawn point --
    // sliding across the map, or climbing up out of the void for one that fell off the
    // world. Dropping the entry makes the next record start clean.
    for (const id of fight.restoredThisFrame) enemyPositionLerps.delete(id)
    // DEFAULT_COMBAT_CONFIG.enemy, not fightConfig.enemy, but not for the defensive reason
    // above or below: boostedCombatConfig only ever replaces the gust key, so the two are
    // the same object today, and there is nothing on `enemy` for a future boost to reach.
    for (const enemy of encounter.enemies) enemyViews.get(enemy.id)?.sync(
      enemy, camera.quaternion, risingProgress(enemy, DEFAULT_COMBAT_CONFIG.enemies[enemy.kind]),
    )

    // Read straight from the simulation rather than through an interpolator. Arrows are
    // fast and short-lived, an interpolator would have to be created and disposed per
    // arrow, and the render-interpolation work exists to smooth a camera-followed
    // character rather than every moving object.
    for (const arrow of encounter.projectiles) {
      let view = arrowViews.get(arrow.id)
      if (!view) {
        view = createArrowView()
        arrowViews.set(arrow.id, view)
        scene.add(view.object)
      }
      view.update(arrow)
    }
    // Anything with no arrow left has hit, landed or expired.
    const live = new Set(encounter.projectiles.map((arrow) => arrow.id))
    for (const [id, view] of arrowViews) {
      if (live.has(id)) continue
      scene.remove(view.object)
      view.dispose()
      arrowViews.delete(id)
    }

    // Drawn at the true vortexRadius for the same reason the gust cone is drawn at its
    // true hit volume — a pull that reaches outside the visible ring reads as a bug.
    if (fight.vortexFired !== null) {
      effects.add(createVortexRing(
        player.position, vortexRadius(fight.vortexFired, fightConfig.vortex),
      ))
    }

    // impactTargets owns the union and the rule that a down beats a connect. It lives
    // in a tested module because this file has none, and because the staff was added
    // to the fight without being added to the loop that used to live here.
    // fight.enemiesBeforeRestore, never `encounter.enemies`: the burst lists below are all
    // computed inside stepEncounter before the patrol restore runs, and `encounter` was
    // just reassigned to the post-restore array. On a frame that both downs the last
    // soldier and restores the patrol -- kite one 45 units out with the other two already
    // down, and gust it there -- the post-restore array holds fresh soldiers at their
    // spawn points, so the down spark would be drawn back on the patrol ground while the
    // freeze, the shake and the thud all fire around a player 45 units away.
    const positionOf = (id: string) =>
      fight.enemiesBeforeRestore.find((e) => e.id === id)?.position
    const bursts = impactTargets({
      hits: fight.hitThisFrame,
      slamHits: fight.slamHitThisFrame,
      staffHits: fight.staffHitThisFrame,
      downed: fight.downedThisFrame,
    })
    for (const id of bursts.hits) {
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'hit'))
    }
    for (const id of bursts.downs) {
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'down'))
    }
    if (bursts.hits.length > 0) combatAudio.impact()
    if (bursts.downs.length > 0) combatAudio.down()
    // Once, with the count, like every other voice on this list. A call per arrow stacked
    // bit-identical bursts at the same currentTime; the level for a volley is decided in
    // mapping.ts, where it can be tested.
    combatAudio.bowRelease(fight.firedThisFrame.length)

    // Heavy events only. Never a gust: a move with a 0.45s cooldown that hitches on
    // every use is nausea, not weight.
    if (staffSwing?.finisher && fight.staffHitThisFrame.length > 0) {
      hitstop = triggerHitstop(hitstop, DEFAULT_HITSTOP_CONFIG.finisherSeconds)
    }
    if (bursts.downs.length > 0) {
      hitstop = triggerHitstop(hitstop, DEFAULT_HITSTOP_CONFIG.downSeconds)
      shake = triggerShake(
        shake, DEFAULT_SHAKE_CONFIG.downAmplitude, DEFAULT_SHAKE_CONFIG.downSeconds,
      )
    }
    if (slam) {
      hitstop = triggerHitstop(hitstop, slamHitstopSeconds(slam.strength, DEFAULT_HITSTOP_CONFIG))
      shake = triggerShake(
        shake,
        slamShakeAmplitude(slam.strength, DEFAULT_SHAKE_CONFIG),
        DEFAULT_SHAKE_CONFIG.slamSeconds,
      )
    }
    if (fight.playerHit) {
      hurtFlash = 1
      shake = triggerShake(
        shake, DEFAULT_SHAKE_CONFIG.hurtAmplitude, DEFAULT_SHAKE_CONFIG.hurtSeconds,
      )
      combatAudio.hurt()
    }
    hurtFlash = stepPulse(hurtFlash, dt, HURT_FLASH_DECAY_PER_SECOND)

    const events: FocusEvents = {
      gustConnects: fight.hitThisFrame.length,
      // firstDownsThisFrame, not downedThisFrame: the impact bursts below still fire for
      // every down, but only the first one a soldier suffers pays Focus.
      downs: fight.firstDownsThisFrame.length,
      slamStrength: slam?.strength ?? 0,
      playerHit: fight.playerHit,
      fellOutOfWorld: crashed,
      damageAvoided: fight.damageAvoided,
      staffConnects: fight.staffHitThisFrame.length,
      accidents: fight.lostThisFrame.length,
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
    }, hurtFlash, stall))

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

    // Detected last, so the killing hit still pays its ordinary damageDrain and impact
    // effect on this frame: one normal step, then the beat. The 'down' burst is the same
    // one an enemy gets, because §4.6 says both sides of the fight go down rather than die.
    if (!down && isDowned(encounter.playerHealth)) {
      down = startDown()
      effects.add(createImpact(player.position, 'down'))
      // The frozen branch returns before any record() call below runs, so without this
      // every buffer stays one simulation step apart for the whole beat while alpha keeps
      // sweeping 0..1 every rendered frame — above 60Hz the "frozen" avatar and every enemy
      // visibly oscillate between two positions instead of holding still. reset() collapses
      // each pair onto its current value so sampling returns a still image.
      playerPositionLerp.reset()
      playerForwardLerp.reset()
      for (const lerp of enemyPositionLerps.values()) lerp.reset()
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
    // Stepped here rather than in update(), with real frame time: shake is a
    // render-time offset, so it keeps animating through a hitstop. A freeze with a
    // shaking camera is the impact; a freeze that holds still and then shakes is two
    // separate events, which is what stepping it in update() would produce, because
    // update() is exactly what the freeze stops.
    shake = stepShake(shake, frameDt)
    // Added to the transform, never written back into cameraPosition. That is the
    // smoothed state smoothTowards reads and writes every frame, so integrating the
    // shake into it would make the camera drift away from the player rather than
    // vibrate around him. lookAt keeps targeting the unshaken sampledPosition too:
    // shaking the target rotates the view instead of translating it, which reads as
    // the world tilting.
    camera.position.copy(cameraPosition).add(shakeOffset(shake, shakeVec))
    camera.lookAt(sampledPosition)
    camera.fov = (player.mode === 'glider' ? fovForSpeed(player.velocity.length()) : fovForSpeed(0))
      + fovKickForDash(dashKick)
    camera.updateProjectionMatrix()
  }

  const stepper = createStepper({
    update,
    render: (alpha, frameDt) => {
      syncVisuals(alpha, frameDt)
      renderer.render(scene, camera)
    },
  })

  // Prime the presentation layer once, before the loop ever runs. syncVisuals() is only
  // ever reached through stepper.advance's render callback, and hud.update() only from
  // inside update() -- both exclusive to the playing branch of frame() below. Before this
  // cycle that was fine: the game started playing on frame one, so the gap between "the
  // scene exists" and "the scene is drawn where it should be" lasted a few milliseconds at
  // worst. Now the paused branch can be the very first frame and can hold indefinitely
  // behind the front-door card, so that gap is what a new player sees: the camera sitting
  // at createRenderer's default transform (inside the home island's volume, since the
  // island is centred on the origin) and a HUD whose four meter fills are still at their
  // unset CSS `width: 100%`, not the values hudModelFor would compute for a fresh spawn.
  //
  // The player interpolators are already primed (record() above seeds both ends, so
  // sample() at any alpha already returns the spawn position/forward exactly) -- what is
  // missing is a single call that actually applies them to the camera, the avatar and the
  // enemy views, the way every subsequent frame's render callback does.
  //
  // cameraPosition is snapped directly rather than left for syncVisuals's own
  // smoothTowards to reach, for the same reason recover() snaps it: smoothTowards is
  // exponential decay, so calling syncVisuals with frameDt 0 (there being no elapsed frame
  // time to report before the loop has run once) would compute the right `desired` value
  // and then blend zero percent of the way to it, leaving cameraPosition exactly where
  // createRenderer put it.
  cameraPosition = pullInForTerrain(
    player.position,
    desiredCameraPosition(player.position, lookDirection, profileFor(player.mode)),
    world.terrain,
  )
  // Enemy view positions come from the same kind of interpolator as the player's, but
  // nothing has called record() for them yet -- that only happens inside update(), once
  // per enemy, the first time it steps. Seeded here with the patrol's spawn positions so
  // syncVisuals has something real to sample instead of leaving each view at whatever
  // position createEnemyView left it.
  for (const enemy of encounter.enemies) {
    const lerp = createInterpolatedVector()
    lerp.record(enemy.position)
    enemyPositionLerps.set(enemy.id, lerp)
  }
  followSun(player.position)
  syncVisuals(1, 0)
  // sync() needs camera.quaternion, which syncVisuals's camera.lookAt call above just set,
  // so this has to run after it -- the same ordering update()'s own copy of this loop
  // relies on.
  for (const enemy of encounter.enemies) enemyViews.get(enemy.id)?.sync(
    enemy, camera.quaternion, risingProgress(enemy, DEFAULT_COMBAT_CONFIG.enemies[enemy.kind]),
  )
  hud.update(hudModelFor(player, encounter.playerHealth, {
    focus: focus.max > 0 ? focus.value / focus.max : 0,
    avatarCharge: armFraction(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
    avatarActive,
  }, hurtFlash, stallSeverity(player, DEFAULT_FLIGHT_CONFIG)))

  let last = performance.now()
  /** Whether the previous frame was running, so audio follows the edge and not the state. */
  let wasPlaying = false
  function frame(now: number): void {
    const reason = pauseReason({ pointerLocked, documentHidden, guideOpen: guide.isOpen() })
    overlay.update(pauseOverlayModel(reason, everStarted))
    const playing = reason === null
    if (playing !== wasPlaying) {
      // Driven from the transition rather than called every paused frame: suspend() and
      // resume() move an AudioContext through a state machine, and a redundant pair of
      // them on a context that is mid-transition is exactly what produces an audible click.
      if (playing) { wind.resume(); combatAudio.resume() }
      else { wind.suspend(); combatAudio.suspend() }
      wasPlaying = playing
    }
    if (!playing) {
      // Drain the input edges so a jump pressed just before pausing does not fire on
      // resume, and hold `last` at now so no time accumulates to lurch through when it
      // does. The scene still renders rather than going blank: on the guide branch that
      // has always meant the world stays visible behind the panel; now that the very
      // first frame can land here too, it is the priming block above -- not this render
      // call -- that is what makes "still renders" mean "renders the spawn" instead of
      // "renders wherever the renderer's default camera happened to start."
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
