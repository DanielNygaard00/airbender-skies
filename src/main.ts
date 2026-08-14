import { Vector3, Mesh, OctahedronGeometry, MeshBasicMaterial, Group } from 'three'
import { createRenderer, hasWebGL, showFallback, WEBGL_MESSAGE } from './core/renderer'
// Aliased: `./camera/follow-cam` already exports a `profileFor` for the camera's own
// per-mode profile, used throughout this file, and that name is not free to reuse.
import { profileFor as qualityProfileFor } from './core/quality'
import { createStepper } from './core/loop'
import { createInterpolatedVector, type InterpolatedVector } from './core/interpolation'
import { InputTracker } from './core/input'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_DOWN_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG, validateCollisionConfig, validateFlightConfig,
} from './core/config'
import { loadSave, writeSave } from './core/save'
import { loadSettings, writeSettings } from './core/settings-store'
import { effectiveVolume, motionScales, type MotionScales, type Settings } from './core/settings'
import { loadGLTF } from './core/assets'
import { buildWorld, type World } from './world/world'
import { ARCHIPELAGO } from './world/levels/archipelago'
import { selectLevel } from './world/levels'
import { placeShrines } from './world/shrine'
import { buildPayloadMesh, placePayloads } from './world/payload'
import { carryIntent, carryPose, carryStep, loadedFlight, returnCarriedHome } from './player/payload'
import { windSampler, stillAir, type WindSample } from './world/wind'
import { createWindTell } from './world/wind-tell'
import { openAirTest } from './world/island'
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
import { detectSlam, applyBounce, touchedDown } from './player/slam'
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
import { createAirWallPanel } from './fx/air-wall'
import { canAirWall, isAirWallUp } from './combat/air-wall'
import { createVortexRing } from './fx/vortex-ring'
import { createVortexChargeTell } from './fx/vortex-charge'
import { vortexRadius } from './combat/vortex'
import { createEnemyView } from './combat/enemy-mesh'
import { createArrowView, type ArrowView } from './fx/arrow'
import { createWaterfall } from './world/waterfall'
import { createPlayerState, spawnPointFor } from './player/state'
import { actFromShrines } from './progress/acts'
import { applyTangle } from './player/tangle'
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
import { gripShape } from './combat/water'
import { stallSeverity } from './player/stall'
import { animationFor, chargeSquashScale, wallRideLean } from './player/avatar-anim'
import { profileFor, desiredCameraPosition, smoothTowards, pullInForTerrain } from './camera/follow-cam'
import { createHud, hudModelFor, VIGNETTE_SCALE_PROPERTY } from './ui/hud'
import { reticleModel } from './ui/reticle'
import { createReticle } from './ui/reticle-view'
import { createHitDirection } from './ui/hit-direction-view'
import { createOffScreen } from './ui/off-screen-view'
import { enemyMarker, type EnemyMarker } from './fx/off-screen'
import { bearingFromCamera, markFor, stepHitMarks, type HitMark } from './fx/hit-direction'
import { createGuide, guideModelFor } from './ui/guide/panel'
import { pauseReason, pauseOverlayModel } from './core/pause'
import { createPauseOverlay } from './ui/pause-overlay'
import { canBurst, canGust, canGrip, canStone, canVortex } from './combat/encounter'
import { canIceLock, anyLiveWaterGripTarget } from './combat/water'
import { anyLiveStoneThrowTarget, canRaisePillar, stoneShape, type Pillar } from './combat/earth'
import { createEarthReach } from './fx/earth-reach'
import { createPillarView, type PillarView } from './fx/pillar-view'
import {
  anyLiveFireBurstTarget, burstShape, canFireThrust, fireThrustImpulse, fullCharges, spendCharges,
  stepFireCharges,
} from './combat/fire'
import { createFireBurst } from './fx/fire-burst'
import { createFireThrust } from './fx/fire-thrust'
import {
  DEFAULT_ELEMENT_CONFIG, radialModel, restingElements, stepElements,
  type Element, type ElementState,
} from './elements/element'
import type { CombatConfig, Encounter } from './combat/encounter'
import type { ConeShape } from './combat/cone'
import type { PlayerState } from './core/types'
import { createElementRadial } from './ui/element-radial'
import { createWaterReach } from './fx/water-reach'
import { createIceShell } from './fx/ice-shell'
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

/**
 * How far along `player.forward` the reticle's aim point sits, in world units.
 *
 * The gust's range, and picked deliberately rather than tuned by eye. The distance is the
 * whole tuning surface of the projection: a point a metre or two out projects almost onto the
 * character, where the reticle would sit in the avatar's silhouette and barely move on a turn;
 * a point 200 units out is effectively on the horizon, where a turn slides it across the screen
 * but the reticle no longer says anything about *reach*. The gust is the longest-reaching aimed
 * move in the game, so its range is the honest outer edge of "where an attack will go" — a
 * reticle beyond it would promise reach the player does not have.
 *
 * Read from the config rather than written as 12, so retuning the gust moves the reticle with
 * it. `DEFAULT_COMBAT_CONFIG` rather than the Avatar-State-boosted `fightConfig`: that config
 * is not in scope in `syncVisuals`, and `boostedCombatConfig` does not touch the gust's range
 * anyway — it scales damage, knockback and cooldown only. If a future boost ever does reach the
 * range, this is a place that would need to hear about it.
 */
const AIM_DISTANCE = DEFAULT_COMBAT_CONFIG.gust.range

/**
 * Where the hit wedges are drawn around when the aim point is not on screen.
 *
 * Screen centre. `reticleModel` reports `visible: false` when the aim point is behind the
 * camera or outside the depth range, and on those frames there is no reticle for the wedges to
 * orbit — but a hit still has a direction worth showing, so they fall back to the middle of the
 * screen rather than vanishing with it. The reticle is the *preferred* origin (it makes the two
 * overlays read as one instrument), not a precondition for the indicator.
 */
const SCREEN_CENTRE = { x: 0.5, y: 0.5 }

/**
 * How sharply the avatar's wall-ride lean chases its target, per second.
 *
 * Chosen against `avatar.ts`'s `FADE_SECONDS` of 0.18, the cross-fade every clip change uses:
 * at 16 the lean is 94% of the way in after that long, so the roll lands with the pose it
 * accompanies rather than trailing it. Not `DEFAULT_GROUND_CONFIG.groundResponse` 7, which was
 * the other candidate — that is how fast the *body* chases the stick, and at 7 the lean would
 * still be a fifth short a full half-second after a ride begins, on a move whose median ride
 * on this archipelago is shorter than that.
 *
 * Not imported from avatar.ts, which does not export it. The figure is cited rather than
 * shared because these are two independent decisions that happen to agree, and coupling them
 * would mean a future retune of one silently retuning the other.
 */
const WALL_LEAN_RESPONSE = 16

/** What the aim preview needs to know about whichever light verb `F` would currently throw. */
interface LightVerbPreview {
  /** Something worth aiming at is inside the reach right now. */
  hot: boolean
  /** The move could actually fire if the key went down. */
  ready: boolean
  /** The reach to draw, taken from the same function the resolver builds its test from. */
  shape: ConeShape
}

/**
 * The light verb's aim preview, per element.
 *
 * **A `Record<Element, …>` rather than the chain of ternaries this was**, and the water design note
 * called for exactly this at exactly this point: "the three per-element ternaries in `main.ts` —
 * the `aimHot` query, the aim tell's shape, and the light-verb cone effect. Fine for two elements,
 * a small lookup at the third." Earth is the third. Two of those three are folded in here — the
 * hot query and the shape, which are asked in one place — and the fired cone stays where it is,
 * because it is drawn from the fight's own report rather than from a pre-step guess.
 *
 * A Record and not a switch, so fire fails to compile here rather than silently inheriting air's
 * preview: the failure mode of a fallback is a reticle that promises a gust's 120-degree reach for
 * a move that does not have it, which is precisely the wrong-by-a-wide-margin answer the per-element
 * split exists to prevent.
 *
 * At module scope and taking its inputs as arguments, so it is built once rather than every frame.
 *
 * Each entry reads the shape from the same function its resolver's containment test is built from —
 * `gustShape` is `fightConfig.gust` itself, `gripShape` is what `inWaterGrip` uses, `stoneShape` is
 * what `inStoneThrow` uses — so a previewed cone and the cone that bites cannot diverge.
 *
 * Only the air entry passes `enemies`, and that asymmetry is deliberate rather than an omission. A
 * heavy's armour turns a gust away entirely, so the tell stays cold on the heavy and warm on the
 * spear beside it: the armour's first and cheapest lesson, learned without spending the move. Water
 * has nothing to say there because neither of its moves is fully deflected by anything shipped, and
 * earth has nothing to say because *nothing deflects a stone at all* — a preview that went cold on
 * an armoured target would be teaching the exact opposite of the truth about the one move that
 * breaks armour. See `anyLiveStoneThrowTarget` for that argument in full.
 */
const LIGHT_VERB_PREVIEWS: Record<
  Element,
  (c: CombatConfig, fight: Encounter, p: PlayerState, charges: number) => LightVerbPreview
> = {
  air: (c, fight, p) => ({
    hot: anyLiveGustTarget(p.position, p.forward, fight.enemies, c.gust, c.enemies),
    ready: canGust(fight),
    shape: c.gust,
  }),
  water: (c, fight, p) => ({
    hot: anyLiveWaterGripTarget(p.position, p.forward, fight.enemies, c.water),
    ready: canGrip(fight, p.breath, c.water),
    shape: gripShape(c.water),
  }),
  earth: (c, fight, p) => ({
    hot: anyLiveStoneThrowTarget(p.position, p.forward, fight.enemies, c.earth),
    ready: canStone(fight, p.breath, c.earth),
    shape: stoneShape(c.earth),
  }),
  // Fire's entry, and the Record earning its keep at the merge: it failed to compile here the
  // moment fire joined the union, which is exactly the fallback-free behaviour the comment above
  // argues for. Without it the burst would have inherited air's preview and promised a
  // 120-degree reach for the narrowest cone in the game.
  //
  // `ready` comes from `canBurst`, which needs the charge count as well as the cooldown -- and
  // charges live in `main.ts` beside the player rather than on `PlayerState`. So the map takes a
  // fourth argument that only this entry reads. A parameter rather than a module binding, because
  // a preview reading mutable state from its own scope is a preview that can disagree with the
  // frame it is describing, and the other three entries ignoring it is the honest shape: only
  // fire's readiness turns on a resource that is not part of the player's own state.
  fire: (c, fight, p, charges) => ({
    hot: anyLiveFireBurstTarget(p.position, p.forward, fight.enemies, c.fire),
    ready: canBurst(fight, charges, c.fire),
    shape: burstShape(c.fire),
  }),
}

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

  /**
   * The region this session loads. One line, and `world/levels/index.ts` documents why it is
   * one line rather than a region-selection screen: `?region=canyon-country` loads Canyon
   * Country, anything else loads the archipelago.
   */
  const LEVEL = selectLevel(window.location.search)

  let world: World
  try {
    world = buildWorld(LEVEL)
  } catch (error) {
    return showFallback(`The level failed to load: ${(error as Error).message}`)
  }

  // Read once, at startup, and only as the seed for `reduceMotion`'s default: once the
  // player has touched that toggle their choice is what is stored, and the OS preference
  // must not keep overriding it. Guarded because `matchMedia` is absent in some embedded
  // webviews, where an unguarded call would take the whole game down at line one.
  const prefersReducedMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // Its own key, beside loadSave rather than inside it: progress and preferences have
  // different lifetimes, so clearing one must not cost the other. See settings-store.ts.
  //
  // Loaded here, ahead of `createRenderer`, because the renderer needs the quality tier
  // this holds before it can build itself.
  let settings: Settings = loadSettings(localStorage, prefersReducedMotion)

  const { renderer, scene, camera, followSun } =
    createRenderer(canvas, qualityProfileFor(settings.quality))
  scene.add(world.group)
  enableShadows(world.group)

  const save = loadSave(localStorage, DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
  /**
   * The five reduce-motion scalars, recomputed by `applySettings` rather than per frame.
   * `motionScales` is pure and cheap, but recomputing it in `update` and again in
   * `syncVisuals` would be two reads that a future edit could let disagree.
   */
  let motion: MotionScales = motionScales(settings)
  /**
   * The shrines, placed before the player rather than after, and the order is load-bearing.
   *
   * `placeShrines` is what resolves the save's ids against the level: an id naming no island is
   * discarded and a repeated one is collapsed by the `Set` inside it. The act is derived from the
   * result, so a hand-edited save cannot claim Act 2 with four copies of `"home"` or four ids
   * that name nothing. Deriving it from `save.collectedShrines.length` instead would take the
   * unvalidated number, which is the whole reason this line sits above the next one.
   *
   * `LEVEL` rather than `ARCHIPELAGO` now that there are two regions: the region is chosen once,
   * above, and both of these read the same choice. Note what that means for progression across
   * regions -- shrine ids are unique per region and the save holds one flat list, so acts advance
   * on shrines collected *anywhere*, which is the behaviour section 5 implies when it says each
   * act's world design assumes the previous act's kit.
   */
  let shrines = placeShrines(LEVEL, world.terrain, save.collectedShrines)
  let player = createPlayerState(
    LEVEL, world.terrain, save, DEFAULT_FLIGHT_CONFIG, actFromShrines(shrines),
  )
  /**
   * The payloads, and which one is on the glider.
   *
   * Beside `shrines` rather than on `PlayerState`, and deliberately not in the save. Not on
   * the player because `respawn()` would then carry it across a death for free — see
   * `returnCarriedHome` for the whole argument, and the two call sites below for the two
   * paths it covers. Not in the save because `save.ts` keeps the two things a session is
   * meant to accumulate, shrines and the breath ceiling, and where a bundle happens to be
   * sitting is a route in progress rather than progress: a reload puts it back on the home
   * plateau, which is the same place a respawn puts it.
   */
  let payloads = placePayloads(LEVEL, world.terrain)
  let carriedId: string | null = null

  // Focus is a live meter and is deliberately not saved.
  let focus = emptyFocus(DEFAULT_FOCUS_CONFIG)
  /**
   * Which element is selected, and the radial's open state.
   *
   * Deliberately not saved, like Focus — but for the opposite reason. Focus is not saved because
   * it is earned and a save would hand it over unearned; this is not saved because it is trivial
   * to re-express and a game that reopened on waterbending would be lying about what F does until
   * the player noticed. Air is where the game starts and where it restarts.
   */
  let elements: ElementState = restingElements()
  /**
   * Fire's charges, and the one piece of state in this file that is a resource rather than a system.
   *
   * Here rather than on `PlayerState` or on `Encounter`, and both refusals have the same source. The
   * comment on `Encounter` says movement is a pure function of a struct a dozen tests build fixtures
   * for and that combat has no business widening it; the comment on `EncounterInput.element` says a
   * fight is something happening in the world rather than a property of the character. Fire's
   * charges are spent by a move on each side of that line — a burst inside `stepEncounter`, a thrust
   * on the player's velocity — and refilled by a landing neither of them owns, so they belong to
   * neither struct. Focus sits here for the same reason and is read the same way: passed in, billed
   * back.
   *
   * Not saved, like Focus, and for a reason closer to the element selection's: a save that restored
   * two charges would be restoring the state of a flight that ended, and the refill condition — touch
   * the ground — is satisfied by definition the moment the game loads a player standing on an island.
   * So a fresh session starts full, which is also what a fresh landing gives.
   */
  let fireCharges = fullCharges(DEFAULT_COMBAT_CONFIG.fire)
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
  /**
   * The avatar's roll toward a wall it is riding, smoothed.
   *
   * A render-time value, so it lives here rather than on `PlayerState` and is stepped in
   * `syncVisuals` with real frame time — the same division of labour the camera shake keeps.
   * `wallRideLean` reads one frame of state and knows nothing about time; the easing is here,
   * and it is exponential so it behaves the same at any refresh rate.
   */
  let wallLean = 0
  const shakeVec = new Vector3()
  const combatAudio = createCombatAudio()
  /**
   * Every hit still fading on the direction indicator.
   *
   * Appended to in `update` from `stepEncounter`'s `playerHitsThisFrame`, and aged in
   * `syncVisuals` with real frame time — `stepHitMarks` fixes each bearing at the moment of the
   * hit and never revisits it, so this is a list of records rather than of live directions.
   */
  let hitMarks: HitMark[] = []
  /**
   * Whether anything is currently inside the gust cone, carried from `update` to `syncVisuals`.
   *
   * The same value `aimTell` is fed, computed once. `anyLiveGustTarget` needs the whole enemy
   * list and the fight config, neither of which `syncVisuals` has any other reason to touch, and
   * a second call there would be a second answer that a future edit could let disagree with the
   * tell the player is looking at.
   */
  let aimHot = false

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
  for (const def of LEVEL.waterfalls) {
    const island = LEVEL.islands.find((i) => i.id === def.islandId)
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
  //
  // Handed an open-air test, which is what keeps the motes out of the rock. A feature's radius is
  // its field, and in Canyon Country's slot that is deliberately wider than the slot, so without
  // this the tell scattered most of itself inside the walls — see `OpenAir` in `wind-tell.ts` for
  // the measurement. `openAirTest` is analytic over the level's island shells rather than a
  // height probe, because these islands float and the air beneath one is not rock; the first
  // version of this used `groundHeightAt` and collapsed two of the archipelago's own tells.
  const openAir = openAirTest(LEVEL.islands)
  const windTells = (LEVEL.winds ?? []).map((def) => {
    const tell = createWindTell(def, openAir)
    scene.add(tell.object)
    return tell
  })

  // The one encounter: a heavy, three spears, a net thrower and two archers on the home
  // island, per HOME_PATROL.
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
  //
  // Gated on the region, because `HOME_PATROL` is home-island coordinates rather than a level
  // feature: loaded in Canyon Country those same positions land in the narrows, which would put
  // six soldiers in the middle of a region the design document says should open with an
  // unpressured traversal sequence. A second encounter site needs its own spawn list and its own
  // `PatrolConfig`, so the empty list is the honest answer until that exists — every consumer
  // below iterates `encounter.enemies`, so none of them mind it being empty.
  const patrol = LEVEL.id === ARCHIPELAGO.id ? HOME_PATROL : []
  const patrolSpawns = patrol.map((spawn) => ({
    ...spawn,
    // Dropped onto the ground rather than trusting the authored y.
    position: spawn.position.clone().setY(
      world.terrain.groundHeightAt(spawn.position.x, spawn.position.z) ?? spawn.position.y,
    ),
  }))
  let encounter = startEncounter(patrolSpawns, DEFAULT_COMBAT_CONFIG)
  const enemyViews = new Map(encounter.enemies.map((enemy) => {
    // The config, not just the kind: the net thrower's throw lane is drawn at its real
    // strikeRange, so the view has to be told the reach it is drawing.
    const view = createEnemyView(enemy.kind, DEFAULT_COMBAT_CONFIG.enemies[enemy.kind])
    scene.add(view.object)
    enableShadows(view.object)
    return [enemy.id, view] as const
  }))

  /**
   * One view per arrow in flight, created on first sight and disposed when the arrow is
   * gone. Keyed by projectile id, the same way enemyViews is keyed by enemy id.
   */
  const arrowViews = new Map<string, ArrowView>()

  /**
   * One view per standing pillar, created on first sight and disposed when the rock is gone. Keyed
   * by pillar id, the same way `arrowViews` is keyed by projectile id and `enemyViews` by enemy id.
   *
   * A persistent view rather than a pooled `Effect`, and `createPillarView` carries the argument:
   * the effect pool caps at 24 and evicts oldest first, so a six-second pillar would be the first
   * thing a busy exchange threw away — and the rock would vanish while it was still stopping arrows.
   */
  const pillarViews = new Map<string, PillarView>()

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

  /**
   * One mesh per payload, built once and reparented rather than rebuilt.
   *
   * They start in the scene at their placed positions; `syncPayloadMeshes` below moves the
   * carried one onto the avatar and back.
   */
  const payloadMeshes = new Map<string, Mesh>()
  for (const payload of payloads) {
    const mesh = buildPayloadMesh()
    mesh.position.copy(payload.position)
    scene.add(mesh)
    enableShadows(mesh)
    payloadMeshes.set(payload.id, mesh)
  }

  /**
   * Put every payload mesh where its record says it is, reparenting the carried one.
   *
   * **The carried payload becomes a child of `avatar.object`** — alongside the glider, the
   * aura, the charge tell and the guard shell — and the two things it is *not* parented to
   * are the point. Not `modelRoot`: that inner wrapper exists to absorb the fitting scale
   * (`fitToPlaceholder` measures whatever model loads and can pick any scale — the shipped
   * character needed 0.34) and the charge-jump squash, so a payload in there would be
   * resized by whichever model happened to load and would compress every time the player
   * crouched to charge a jump. And not `glider.object`: that group lerps between the stowed
   * pose (tilted 1.05 rad about Z, across the back) and the deployed one, and sweeps 150
   * degrees through a staff swing, so a payload hanging off it would tumble sideways on
   * every stow and get flung by every swing. `avatar.object` is the one node that carries
   * nothing but the character's position and facing, which is exactly what a carried bundle
   * needs to inherit — the same reason the comments on the aura and the guard give.
   *
   * Called on the frames a payload changes hands, not per frame: `Object3D.add` detaches
   * from the previous parent, so calling it every frame would reshuffle the scene graph's
   * child order for nothing. The carried mesh's local position is the only part that moves
   * per frame, and `update` refreshes that on its own.
   */
  function syncPayloadMeshes(): void {
    for (const payload of payloads) {
      const mesh = payloadMeshes.get(payload.id)
      if (!mesh) continue
      if (payload.carried) {
        avatar.object.add(mesh)
        carryPose(glider.openness(), mesh.position)
      } else {
        scene.add(mesh)
        mesh.position.copy(payload.position)
      }
    }
  }

  // Parented to the scene, not the avatar, and deliberately so: the avatar is rotated in
  // syncVisuals from the *interpolated* heading, but this tell must read the simulation's
  // player.forward, which is the same value inGust tests. Parenting to the avatar would
  // inherit the facing for free but would then be reading the wrong heading — a hit-volume
  // tell has to agree with the hit, not with the smoothed visual.
  const aimTell = createAimTell()
  scene.add(aimTell.object)

  // Scene-parented for the same reason `aimTell` is, and it is the stronger case of the two:
  // this shape is not a preview of a hit volume, it IS one, and its tilt is the whole control
  // the move has. Parenting it to the avatar would inherit the interpolated heading and draw a
  // barrier at an angle the deflection never used.
  const airWallPanel = createAirWallPanel()
  scene.add(airWallPanel.object)

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
    // Pose the character here rather than in the priming block below, for the reason the
    // priming block cannot do it: this promise cannot settle before start()'s synchronous
    // body has finished, so the model is always attached after that block has run. And
    // nothing later covers it either while the front door is up -- setAnimation() and
    // avatar.update() are reached only from the playing branch of frame() -- so before
    // this call the character stood in whatever pose attachModel had left it in, for as
    // long as the player left the card up. Not character.glb's rest pose: attachModel
    // composes the glide clip before it builds the mixer, and sampling bones for that
    // pose writes into the live bones without ever restoring them, so what the card
    // showed was a leftover half-glide -- arms raised to head height on a character
    // standing on the ground. poseNow rather than setAnimation because the fade needs a
    // tick of the mixer to actually reach the model; see its own comment.
    avatar.poseNow(animationFor(player))
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
    // The guide releases the lock when it opens, and this is what keeps it released.
    // The panel is `pointer-events: none` everywhere except its settings rows, which is
    // deliberate — a full-screen click sink over the canvas would break the click that
    // resumes play — but it means a click on the panel's empty space still reaches the
    // canvas, where InputTracker requests the lock again. That leaves the game correctly
    // paused (`pauseReason` puts `guide` ahead of `unlocked`) but with no cursor, on top of
    // the one panel in the game that needs one. While the guide is up the lock buys
    // nothing, so it is simply not allowed. No loop: the release fires this handler again
    // with `pointerLockElement` null, and the condition is then false.
    if (pointerLocked && guide.isOpen()) document.exitPointerLock()
  })
  document.addEventListener('visibilitychange', () => {
    documentHidden = document.hidden
  })
  // All three appended *before* the HUD, and the order is load-bearing rather than tidy. None of
  // these overlays sets a `z-index`, so they stack in document order and the HUD's own
  // full-screen `.hud-fade` and `.hud-hurt` layers paint over whatever precedes them. That is
  // what keeps a reticle and two rings of marks from floating on top of the blackout during the
  // down beat — which is not a pause, so `frame()`'s hiding below does not cover it — and it is
  // what keeps them under the pause card and the guide panel as a second line of defence if
  // they are ever shown on a paused frame by mistake.
  const reticle = createReticle(document.body)
  const hitDirection = createHitDirection(document.body)
  const offScreen = createOffScreen(document.body)
  // Appended with the other three and before the HUD, for the same document-order reason: none of
  // these sets a z-index, so the HUD's own full-screen `.hud-fade` has to paint over them during
  // the down beat's blackout, and the pause card and guide panel have to paint over them too.
  const elementRadial = createElementRadial(document.body)
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
      airWallReady: canAirWall(
        encounter.airWall, player.breath, DEFAULT_COMBAT_CONFIG.airWall,
      ),
      // The same three predicates the fight resolves the water moves with, asked here rather than
      // restated: `canGrip` reads the encounter's own cooldown alongside the player's breath, and
      // `canIceLock` reads the live Focus value the HUD is drawing. A panel that computed either
      // rule for itself could tell the player a freeze is ready while the fight refuses it.
      element: elements.active,
      gripReady: canGrip(encounter, player.breath, DEFAULT_COMBAT_CONFIG.water),
      iceLockReady: canIceLock(focus.value, player.breath, DEFAULT_COMBAT_CONFIG.water),
      // Earth's two, asked through the same predicates the fight resolves them with, for the
      // identical reason. `canRaisePillar` is affordability only — the fight also asks whether
      // there is ground to raise from, which this row deliberately does not track; see the field.
      stoneReady: canStone(encounter, player.breath, DEFAULT_COMBAT_CONFIG.earth),
      pillarReady: canRaisePillar(focus.value, player.breath, DEFAULT_COMBAT_CONFIG.earth),
      // The same two predicates the burst and the thrust are actually resolved with, for the reason
      // the water pair above are asked rather than restated. `canFireThrust` carries the posture
      // rule as well as the charge one, so the row dims on the ground — which is where a panel that
      // only checked the charges would be telling the player fire can move them.
      burstReady: canBurst(encounter, fireCharges, DEFAULT_COMBAT_CONFIG.fire),
      fireThrustReady: canFireThrust(fireCharges, player.mode),
      // The same call `update` resolves the press with, so the row cannot dim on a frame the
      // key would have worked — or offer itself on one where it would not.
      carryReady: carryIntent(player, payloads, carriedId) !== null,
    }), settings)
  }, (patch) => {
    // A patch of one field, merged rather than assigned: the panel reports only what the
    // player just touched and does not own the rest. Written through immediately — no apply
    // button, since nothing here is expensive enough to batch and an apply button is a
    // second state that can disagree with the first.
    settings = { ...settings, ...patch }
    applySettings()
    // Failure is already swallowed by writeSettings (private browsing, a full quota), and
    // deliberately not reported: a preference that does not persist is worth less than a
    // game that keeps running.
    writeSettings(localStorage, settings)
  })
  const wind = createWindAudio()
  // Both need a user gesture to unblock audio, and this is the one the wind audio
  // already waits for, so the combat voices ride along on the same click.
  canvas.addEventListener('click', () => {
    wind.start()
    combatAudio.start()
  }, { once: true })

  /**
   * Push the current settings out to everything that consumes them.
   *
   * One function for startup and for every later change, so a path that applies four of
   * the five and forgets one cannot exist. Called below for the loaded values, and again
   * from the guide's change callback above.
   */
  function applySettings(): void {
    input.setLook(settings.sensitivity, settings.invertY)
    // `effectiveVolume`, never `settings.volume`. Mute is a separate flag precisely so
    // that it does not overwrite the level: zeroing `volume` on mute would work exactly
    // once, and unmuting would then restore 0 — or a default — instead of what the player
    // had set. This is the only place in the game that reads both fields together.
    const volume = effectiveVolume(settings)
    // Both audio modules store the value whether or not their AudioContext exists yet.
    // That matters here and not somewhere else: this runs at startup, before the first
    // click has unblocked audio, so at this point neither has a gain node to write to.
    wind.setVolume(volume)
    combatAudio.setVolume(volume)
    motion = motionScales(settings)
    // The fifth motion scalar. The other four are numbers this file multiplies at the
    // point of application; the Avatar State vignette is a CSS opacity owned by hud.ts, so
    // it is handed over as a custom property instead of being threaded through HudModel as
    // a fourth trailing optional number — which is the shape hud.ts itself warns about.
    // Set here rather than per frame: it changes only when the settings do.
    //
    // The property name is imported from hud.ts rather than written out, because the rule
    // there falls back through `var(..., 1)` to a full-strength rim: a typo on either side
    // would leave reduce motion quietly not softening the vignette, with nothing red and
    // nothing to see. `setProperty` takes any string, so sharing the name cannot make that a
    // type error — what it does is leave one spelling instead of two, which is the only
    // defence available here. Do not inline the string back.
    document.documentElement.style.setProperty(VIGNETTE_SCALE_PROPERTY, String(motion.vignette))
  }
  applySettings()

  const baseWindAt = windSampler(LEVEL.winds ?? [])

  const deps: ControllerDeps = {
    terrain: world.terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: LEVEL.worldFloorY,
    spawnPointFor: spawnPointFor(LEVEL, world.terrain),
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

  // The clone only carries the declaration; the value is dead. Both the priming block near
  // the bottom of this function and every later syncVisuals call overwrite it before
  // anything reads it, so this does not mean "the camera starts where the renderer put it"
  // -- which is exactly the false premise the front door's first paint bug rested on.
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
  // Scratch for the reticle's aim point, projected in place by Vector3.project.
  const aimPoint = new Vector3()
  /**
   * Scratch for a soldier's projected position, and for the camera's own heading.
   *
   * Reused for the same reason every other scratch in this block is: `syncVisuals` runs
   * once per rendered frame for the whole session, so allocating a Vector3 per soldier per
   * frame would be the only garbage the presentation layer produces.
   */
  const markerPoint = new Vector3()
  const cameraForward = new Vector3()
  /** Rebuilt in place each frame rather than reallocated, for the same reason. */
  const enemyMarkers: EnemyMarker[] = []

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
   *
   * **Two things this function deliberately does not touch, both added with water.**
   *
   * A held or frozen soldier keeps its hold, and keeps counting it down. Section 6 says the fight
   * "keeps whatever state he put it in", and a hold is fight state exactly as damage and stance
   * are — so releasing the patrol on a respawn would be handing the player a clean reset they were
   * told they would not get, and freezing a rank and then going down on purpose would become a way
   * to unfreeze it. It expires on its own clock while the blackout runs, because `effects.advance`
   * and the enemy step are the two things the down beat keeps moving. In practice nothing survives
   * the beat: the longest hold is the freeze's 3.2 seconds against `DEFAULT_DOWN_CONFIG`'s ramps,
   * so this is a guard rather than a fix — the same standing as the `hitMarks` clear below, and it
   * is written down for the same reason, that the relationship between those two constants is not
   * something anyone retuning either would think to check.
   *
   * **A third thing it does not touch, added with earth: a standing pillar keeps standing.** It is
   * on the same footing as the hold above and then some — a pillar is more clearly the player's own
   * mark on the world than a hold on a soldier is, and section 6's rule that the fight "keeps
   * whatever state he put it in" covers it directly. The argument that actually settled it is
   * mechanical rather than thematic: nothing may shorten a pillar's life but its own clock, because
   * the view layer cannot be told an object died early, so a pillar cleared here would leave a rock
   * drawn where nothing blocks arrows or a rock vanishing while it still does. See
   * `Pillar.secondsLeft`. Nothing survives the beat in any case — six seconds of pillar against
   * `DEFAULT_DOWN_CONFIG`'s ramps, which the pillar comfortably outlasts, so this one is not even a
   * guard: it is the *observable* case of the rule, and a player who goes down behind their own
   * cover comes back up behind it, which is the right answer.
   *
   * The selected element survives, and Focus does not, and the difference is the point. Focus is
   * wiped because it was *earned* and section 6 names it as part of the cost. Which element is
   * selected was not earned — it is a stance, like the direction the character is facing, which
   * this function also does not reset — so re-picking it after every knockdown would be busywork
   * that punishes nothing. It also means the badge the player glances at is still true when the
   * black lifts, rather than having silently reverted to air behind it.
   *
   * **Fire's charges come back full, and they are the third case rather than a copy of either.**
   * They are not wiped like Focus, because they were not earned: the only thing that earns a charge
   * is touching the ground, and `safeRespawn` is putting the player down on solid ground at the last
   * island they stood on. So a full hand is what the refill rule already says should happen, and
   * writing it here rather than leaving it to `update`'s landing edge is not a duplicate of that
   * rule — it is the one path the edge cannot see, because this branch returns before `update` ever
   * diffs a step.
   *
   * The alternative was leaving them as the beat found them, and it is worse in the one situation
   * that matters: going down to a net thrower with an empty hand would put the player back on their
   * feet unable to answer the thing that put them there, and the down beat already costs the walk
   * back and the whole Focus meter. It would also be inconsistent — the same knockdown while gliding
   * would refill, since a respawn arrives grounded, and standing on the ground would not.
   * **The act survives too, and it survives without a line here, which is the point.** Section 6
   * prices going down at the walk back and at the Focus meter, and at nothing else — so
   * progression is not part of the cost. `player.act` rides through on `safeRespawn`'s spread of
   * the state it is given, and `shrines` is not touched by this function at all, so the two cannot
   * come apart across the beat. The one path that had to say it out loud is `safeRespawn`'s
   * non-finite-position fallback, which rebuilds the player from scratch; see the comment on `act`
   * there. `controller.test.ts` pins both halves, because "it happens to be spread" is exactly the
   * kind of property a later refactor removes without noticing.
   */
  function recover(): void {
    player = safeRespawn(player, deps)
    // Anything on the glider goes back where it was found, for the reasons
    // `returnCarriedHome` sets out: carried across the respawn it would be a free teleport,
    // and dropped at the death spot it would be an objective sitting wherever the player
    // happened to lose a fight. This is one of that function's two call sites; the other is
    // the fall-out-of-the-world path in `update`, and both have to exist because they are
    // genuinely different events — nothing in `controllerStep` can report the down beat, and
    // this beat never reaches the code that watches for a fall.
    payloads = returnCarriedHome(payloads, carriedId)
    carriedId = null
    syncPayloadMeshes()
    encounter = { ...encounter, playerHealth: fullHealth(DEFAULT_COMBAT_CONFIG.player) }
    focus = emptyFocus(DEFAULT_FOCUS_CONFIG)
    // Through the same function the landing edge uses, with `landed` true, rather than assigning
    // `maxCharges` here: one authority on what "full" means, so a respawn and a touchdown cannot
    // come to different answers.
    fireCharges = stepFireCharges(fireCharges, true, DEFAULT_COMBAT_CONFIG.fire)
    avatarState = restingAvatarState()
    avatarActive = false
    // Every mark is a record of a hit on the life that just ended, and the player is being put
    // back somewhere else entirely, so none of them points at anything any more — a wedge that
    // survived would name a direction relative to a camera heading and a position that no
    // longer exist.
    //
    // Cleared here rather than left to `stepHitMarks` to age out, even though the beat is
    // currently the longer of the two: `DEFAULT_DOWN_CONFIG`'s two ramps outlast
    // `HIT_MARK_SECONDS` as both are tuned today, so nothing survives the blackout in practice
    // and this is a guard rather than a fix. It is here because "the beat is longer than the
    // marks" is a coupling between two constants in two files that nobody would think to check
    // when retuning either one, and the failure it produces on the day it stops holding is a
    // ring of wedges pointing at the death spot from the respawn point.
    hitMarks = []
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

  /**
   * Every hitstop request in the game, scaled by the reduce-motion setting.
   *
   * A helper rather than the scale written at each of the three trigger sites below, so
   * there is exactly one place it can be missing from. Softened rather than removed under
   * reduce motion (0.4, from `motionScales`): the freeze is the main signal that a heavy
   * hit landed, and a freeze is itself the absence of motion, so zeroing it would cost
   * legibility without buying comfort. `triggerHitstop` returns the state untouched for a
   * non-positive duration, so a scale of 0 would still be a clean no-op if this ever
   * became one.
   */
  function freeze(seconds: number): void {
    hitstop = triggerHitstop(hitstop, seconds * motion.hitstop)
  }

  /**
   * Fire's pips, as the HUD wants them.
   *
   * A helper rather than the literal at each of the three `hudModelFor` calls, for the same reason
   * `freeze` above is one: three copies is three places the `active` flag can be left out, and a pip
   * row that never appeared while fire was selected would look exactly like a HUD that does not draw
   * charges at all.
   *
   * `DEFAULT_COMBAT_CONFIG.fire` and not the Avatar-State-boosted `fightConfig`: that config is not
   * in scope at two of the three call sites, and `boostedCombatConfig` does not touch fire at
   * all — see the note where the burst is drawn.
   */
  function fireReadout() {
    return {
      charges: fireCharges,
      max: DEFAULT_COMBAT_CONFIG.fire.maxCharges,
      active: elements.active === 'fire',
    }
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
        // Driven to `up: false` so the barrier fades out behind the full black rather than
        // being revealed still standing at the respawn point, the same reason the glider is
        // stowed and the aura and guard are settled here. `DEFAULT_COMBAT_CONFIG.airWall`
        // stands in for `fightConfig` safely for the reason the vortex line above does:
        // `boostedCombatConfig` does not touch this key at all, so the two are the same object.
        airWallPanel.update(
          dt, false, player.position, player.forward, DEFAULT_COMBAT_CONFIG.airWall,
        )
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
        //
        // The fire readout is passed here as well, even though the blackout paints over it: the pips
        // are behind the fade like every other HUD element, and passing nothing would make the row
        // vanish and then reappear as the black lifts — a flicker on the one frame the player is
        // looking for what changed. `recover()` has already refilled by the time the fade is up.
      }, 0, 0, fadeOpacity(down, DEFAULT_DOWN_CONFIG), fireReadout()))
      return
    }

    // The element switch, resolved before anything reads which element is active, so a flick and
    // the bending key pressed on the same frame land in that order — which is the whole claim
    // "fast enough to sequence mid-combo" makes. Resolved after the `down` branch above, so a
    // number key mashed during the blackout is drained with every other edge rather than
    // surfacing as a switch on the other side.
    //
    // Nothing here can refuse or delay: `stepElements` has no cooldown to check and takes no dt.
    // It is placed among the simulation's other per-frame steps rather than in the render half
    // because the fight reads its output on this same frame.
    const beforeElements = elements
    elements = stepElements(elements, {
      radialHeld: state.radialHeld,
      radialReleased: state.radialReleased,
      aimDelta: state.pointerDelta,
      directIndex: state.elementIndex,
      // Pre-step, which is the only act this frame can have: `collectStep` is the one thing that
      // raises it and it runs a hundred lines below. So a player who touches the fourth shrine
      // this frame gets water on the next one — one frame of latency on an unlock that took
      // four islands to earn, and the alternative is resolving the selection after the fight has
      // already read which element is active.
    }, DEFAULT_ELEMENT_CONFIG, player.act)
    // Diffed rather than reported by `stepElements`, the same way the dash trail and the
    // slipstream streak are detected across their step: a pure function that also returned "and
    // this changed" would be a second thing to keep true.
    if (elements.active !== beforeElements.active) combatAudio.elementSwitch()

    // Read before controllerStep: it resolves a fall internally and hands back an
    // already-respawned state, so there is nothing left to observe afterwards.
    const crashed = fellOutOfWorld(player, LEVEL.worldFloorY)

    // Steps first, off last frame's Focus, so the effects apply from the frame the
    // player pressed rather than the one after. The cost is a frame of latency on
    // arming, which nobody can feel; the benefit is that no system here needs a value
    // that depends on itself.
    const asStep = stepAvatarState(
      avatarState, focus, state.avatarStatePressed, dt, DEFAULT_AVATAR_STATE_CONFIG, player.act,
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
    const staffSwing = willRespawn(player, LEVEL.worldFloorY)
      ? null
      : staffStep(player, state, dt, deps.staff)
    /**
     * Whether this step is a respawn, read before it runs for the same reason `crashed` is:
     * `controllerStep` hands back an already-respawned state.
     *
     * `willRespawn` rather than `crashed`, so this covers a state that is already non-finite
     * as well as one that has fallen past the floor — both of `willRespawn`'s documented
     * triggers move the player, and both must put the payload back.
     *
     * The one path this cannot see is a state that goes non-finite *inside* the step, which
     * `controllerStep`'s own trailing guard catches by respawning from the pre-step state.
     * Nothing outside that function can observe it happening, and giving it a way to report it
     * would mean changing what it returns — every caller and every test with it. Left
     * uncovered knowingly: it needs `flightStep` or `groundStep` to manufacture a NaN from
     * finite inputs, which is the pathological case that guard exists for rather than
     * something play produces. If it ever does fire, the payload rides the respawn.
     */
    const respawning = willRespawn(player, LEVEL.worldFloorY)
    // The loaded flight model, or the ordinary one. Derived per step rather than stored,
    // because it depends on `carriedId`, which the interaction below can change at any time;
    // `boostedCombatConfig` is built the same way a few dozen lines down for the same reason.
    // Only the glider branch of `controllerStep` reads any of the four fields `loadedFlight`
    // touches, so this cannot leak into walking, jumping or a landing.
    player = controllerStep(player, state, dt, carriedId === null
      ? deps
      : { ...deps, flight: loadedFlight(deps.flight) })
    if (respawning && carriedId !== null) {
      payloads = returnCarriedHome(payloads, carriedId)
      carriedId = null
      syncPayloadMeshes()
    }
    if (avatarActive) player = refillBreath(player)

    // Deliberately not `crashed` here, even though both flag a respawn. `crashed`
    // (fellOutOfWorld) only covers falling past the world floor, which is all the
    // Focus crash-drain below is meant to react to — draining Focus for a
    // corruption respawn too would be a behaviour change nobody asked for. The slam
    // guard needs the wider net: `willRespawn` also covers a non-finite state, which
    // respawns grounded from whatever fall speed corrupted it, and that must not
    // read as a slam either. Do not collapse these into one flag.
    const slam = detectSlam(
      beforeStep, player, state.tuck, willRespawn(beforeStep, LEVEL.worldFloorY),
      DEFAULT_COMBAT_CONFIG.pressureWave,
    )

    /**
     * Whether the player arrived on the ground this step, which is fire's entire refill condition.
     *
     * Read across the step exactly as the slam is, and through `touchedDown` — the same predicate
     * `detectSlam` uses — so there is one notion of touching down rather than two that can drift.
     *
     * Deliberately *not* guarded on `willRespawn` the way the slam is. That guard exists because a
     * respawn lands the player from an arbitrarily fast fall and dying must not be the hardest slam
     * in the game; for fire the opposite is true, because a respawn genuinely is being set down on
     * solid ground and `recover()` refills for the same reason on the down-beat path. So a fall out
     * of the world hands the charges back, and that is the intended answer rather than a leak: the
     * fall has already cost the trip back and, through `crashDrain`, half the Focus bar.
     *
     * The refill itself is applied at the end of this function rather than here, after the thrust has
     * had its chance to spend — see the note there.
     */
    const landed = touchedDown(beforeStep, player)

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
      // `collection.player` carries the new act as well as the new breath ceiling — `collectStep`
      // writes both from the one shrine count, so there is nothing to advance here. Nothing is
      // written to the save for the act either: the shrine ids below *are* the act, which is the
      // whole argument in `SaveData`'s doc comment for not storing it.
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

    // Resolved after the shrine collection and after the landing inside `controllerStep`, so a
    // press on the frame the glider touches down is a set-down rather than being dropped: the
    // player is `grounded` by now, which is what `carryIntent` asks about. Nothing is written
    // to the save — see the declaration of `payloads` for why a bundle's whereabouts is not
    // progress.
    const carry = carryStep(player, payloads, carriedId, state.carryPressed, LEVEL)
    if (carry.event !== null) {
      payloads = carry.payloads
      carriedId = carry.carriedId
      syncPayloadMeshes()
      // The existing 'down' burst, reused rather than given a colour of its own. It is the
      // broader and slower of the two impacts and it is pale gold rather than red — the
      // comment in `fx/impact.ts` is explicit that neither burst is allowed to read as
      // lethal — so it works as punctuation for "something concluded here". A delivery is
      // the only moment in the payload's life the player cannot see for themselves: a
      // set-down looks identical to it, and without this the difference between the two
      // would only be discoverable by trying to lift the bundle again.
      //
      // `player.position` rather than looking the payload back up: `carryStep` sets a payload
      // down at exactly the player's position, so these are the same point, and the id is no
      // longer on `carry.carriedId` by this line — a set-down clears it.
      if (carry.event === 'delivered') effects.add(createImpact(player.position, 'down'))
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
    // After `glider.update`, never before it: the carry pose is driven by the wing's own
    // `openness`, so reading it first would hang the bundle one step behind the wing it is
    // slung under. No timer of its own for exactly that reason — `advanceOpenness` is already
    // framerate-independent and already eases, so the bundle travels with the fan over the
    // same 0.3 s and cannot drift out of step with it.
    if (carriedId !== null) {
      const carriedMesh = payloadMeshes.get(carriedId)
      if (carriedMesh) carryPose(glider.openness(), carriedMesh.position)
    }
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

    // The light verb's preview, resolved through the lookup above rather than through a chain of
    // ternaries. `aimHot` is hoisted into the one variable syncVisuals reads for the reticle's hot
    // state, so the reticle warms on exactly the frames the world-space tell does — two calls would
    // be two answers, and a tell that says "this will connect" beside a reticle that says it will
    // not is worse than either alone.
    //
    // fightConfig, not the unboosted default, so the preview and the fired cone read one source and
    // cannot diverge if a future boost ever touches a range or a half angle — the same reason
    // chargeTell reads it. Today's Avatar State does not: `boostedCombatConfig`
    // (`src/focus/effects.ts`) only scales damage, knockback and cooldown.
    const preview = LIGHT_VERB_PREVIEWS[elements.active](
      fightConfig, encounter, player, fireCharges,
    )
    aimHot = preview.hot
    aimTell.update(player.position, player.forward, aimHot, preview.ready, preview.shape)
    // The gust branch also passes `fightConfig.enemies`, because a heavy's armour turns that move
    // away entirely: the tell stays cold on the heavy and warm on the spear beside it, which is
    // the armour's first and cheapest tell — the player learns the immunity without spending the
    // move. The water branch has no equivalent argument to pass, because nothing in the armour
    // model covers a Water Grip yet. See the note in `water.ts` on what that leaves open.
    // Fire is the third branch, added as a case rather than as a rewrite. The water cycle's own
    // design note says these three per-element ternaries "will want to become a small lookup at the
    // third element", and that is still true — it is deliberately not done here, because earth is
    // being built on a parallel branch against these same three expressions and a restructure would
    // turn three additive merges into three conflicts. The lookup is owed once both elements have
    // landed, and this comment is the reminder.
    //
    // The fire branch passes no `enemies` config, like the water one, because nothing in the armour
    // model turns a burst away *entirely* — the heavy's row is 0.5 damage, so a burst on plate is a
    // real hit at half strength and the tell should stay warm for it. The gust's branch passes the
    // configs precisely because that move is refused outright by plate and the cold reticle is what
    // teaches the immunity for free. If a kind is ever given `burst: 0 and 0`, this branch has to
    // learn about it or the tell will promise a hit that clangs.
    aimHot = elements.active === 'water'
      ? anyLiveWaterGripTarget(
        player.position, player.forward, encounter.enemies, fightConfig.water,
      )
      : elements.active === 'fire'
        ? anyLiveFireBurstTarget(
          player.position, player.forward, encounter.enemies, fightConfig.fire,
        )
        : anyLiveGustTarget(
          player.position, player.forward, encounter.enemies, fightConfig.gust,
          fightConfig.enemies,
        )

    // fightConfig, not the unboosted default, so the preview and the fired cone
    // (`createGustCone` below, also fed `fightConfig.gust`) read one source and cannot
    // diverge if a future boost ever does touch the gust's range or half angle — the same
    // reason chargeTell reads it. Today's Avatar State does not: `boostedCombatConfig`
    // (`src/focus/effects.ts`) only scales damage, knockback and cooldown.
    // The shape and the readiness of whichever light verb F would throw, so the preview is the
    // reach the player has. `gripShape` is the same function `inWaterGrip` builds its test from,
    // so the previewed cone and the cone that bites cannot diverge — the same relationship the
    // gust half of this call has always had.
    const water = elements.active === 'water'
    const fire = elements.active === 'fire'
    aimTell.update(
      player.position,
      player.forward,
      aimHot,
      // `canBurst` reads the charges as well as the cooldown, so the preview goes cold with an empty
      // hand — which is the whole readability job of a resource that only a landing refills. Asked
      // through the same predicate the fight refuses the press with, like the other two.
      water
        ? canGrip(encounter, player.breath, fightConfig.water)
        : fire
          ? canBurst(encounter, fireCharges, fightConfig.fire)
          : canGust(encounter),
      // `burstShape` is the same function `inFireBurst` builds its test from, so the previewed cone
      // and the cone that bites cannot diverge — the relationship both other branches already have.
      water ? gripShape(fightConfig.water) : fire ? burstShape(fightConfig.fire) : fightConfig.gust,
    )

    // Asked against the pre-step encounter, so the visual agrees with what stepEncounter
    // will actually do on this same frame rather than a frame late. Gated on the element as well,
    // so the wrong element's cone is never drawn — `stepEncounter` applies the identical
    // `input.element === 'air'` test, and the two have to agree or a press draws air and resolves
    // water. The water side is drawn from `fight.gripFired` below instead, because a grip can also
    // be refused for want of breath, which is a condition this pre-step branch cannot see without
    // restating `canGrip`.
    if (state.gustPressed && elements.active === 'air' && canGust(encounter)) {
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
      // `state.lookDirection`, not `player.forward`, and only the Air Wall reads it. On foot
      // `player.forward` IS the flattened look direction, so the two agree on yaw and differ
      // only in that this one carries the pitch the wall's normal needs; in the glider
      // `player.forward` is the nose, and requiring a pilot to fly at an arrow to wall it would
      // leave the mouse — which the design document says trims — doing nothing for the one move
      // whose elevation matters. `EncounterInput.playerAim` carries the full argument.
      playerAim: state.lookDirection,
      playerBreath: player.breath,
      airWallHeld: state.airWallHeld,
      element: elements.active,
      gustPressed: state.gustPressed,
      slam: slam ? { strength: slam.strength } : null,
      vortexHeld: state.vortexHeld,
      vortexReleased: state.vortexReleased,
      playerInvulnerable: isInvulnerable(
        { elapsed: player.slipstreamElapsed, cooldown: player.slipstreamCooldown },
        DEFAULT_SLIPSTREAM_CONFIG,
      ),
      staffSwing,
      // The live values, read at the point the fight is stepped. Focus is stepped further down
      // this function, so this is the meter as the previous frame left it — the same one-frame
      // convention the Avatar State's own boost runs on, and for the same reason: nothing here
      // may need a value that depends on itself. `player.breath` is post-`controllerStep`, so a
      // thrust or a dodge spent on this frame is already deducted and cannot be double-spent.
      focusAvailable: focus.value,
      breathAvailable: player.breath,
      // The live count, pre-step in exactly the sense the two meters above are: nothing has spent a
      // charge yet this frame, because the only other spender is the thrust below and it deliberately
      // runs after this call. See the note there.
      fireCharges,
    }, dt, fightConfig, {
      ground: world.terrain, worldFloorY: LEVEL.worldFloorY,
      // The same ground-adjusted array startEncounter was built from, never raw
      // HOME_PATROL: a restored soldier has to stand where the original three did.
      spawns: patrolSpawns, patrol: DEFAULT_PATROL_CONFIG,
    })
    encounter = fight.encounter
    // Deducted here, from the value the fight reported rather than by re-asking whether a wall
    // went up. `stepAirWall` already made that decision against `canAirWall`, and a second
    // decision in this file — which has no tests — is a second decision that can disagree.
    // Clamped for the reason `controllerStep` clamps the Slipstream's spend: the gate and the
    // deduction agree today and a negative bar would read as a permanently unusable move if
    // they ever drifted.
    if (fight.airWallBreathSpent > 0) {
      player = { ...player, breath: Math.max(0, player.breath - fight.airWallBreathSpent) }
    }
    // Fed the same `state.lookDirection` the fight was handed, so the drawn barrier is the plane
    // the deflection used. Every frame rather than only while a wall is up, because the panel
    // owns its own fade in both directions.
    airWallPanel.update(
      dt, isAirWallUp(encounter.airWall), player.position, state.lookDirection,
      fightConfig.airWall,
    )

    /**
     * Water's breath bill, paid the frame the move fired.
     *
     * Deducted here rather than inside `stepEncounter`, which has no business holding a
     * `PlayerState` — the same division of labour `stepSlipstream` keeps by returning
     * `breathSpent` for the controller to apply. Clamped at zero because the fight checked
     * affordability against the pre-step breath and `controllerStep` has run since: it cannot
     * actually go negative today, since `stepEncounter` reads the post-step value, but a floor
     * costs one comparison and a negative breath would silently disable thrust rather than
     * looking wrong.
     */
    if (fight.breathSpent > 0) {
      player = { ...player, breath: Math.max(0, player.breath - fight.breathSpent) }
    }

    // The water moves' reaches, drawn from the fight's own report rather than from the press.
    // A grip can be refused for want of breath and a freeze for want of Focus, and both
    // refusals are invisible to this file — asking the fight what fired is what keeps a
    // declined press from drawing a cone and playing a voice for a move that never happened.
    if (fight.gripFired) {
      effects.add(createWaterReach(player.position, player.forward, 'grip', fightConfig.water))
      combatAudio.grip()
    }
    if (fight.freezeFired) {
      effects.add(createWaterReach(player.position, player.forward, 'freeze', fightConfig.water))
      combatAudio.freeze()
    }
    // Earth's two, from the fight's report for the same reason water's are: a stone can be refused
    // for want of breath and a raise for want of Focus *or* for want of ground to raise from, and
    // all three refusals are invisible to this file.
    if (fight.stoneFired) {
      effects.add(createEarthReach(player.position, player.forward, fightConfig.earth))
      combatAudio.stone()
    }
    // Voiced here; drawn by the pillar views below, which sync off `encounter.pillars`. The split is
    // the one the ice shells make — one voice for the move, and a drawn object per thing it created
    // — except that a pillar outlives its frame, so the object is a persistent view rather than a
    // pooled effect. `createPillarView` records why that distinction is load-bearing.
    if (fight.pillarRaised) combatAudio.pillar()
    // One dry knock however many shots a rock ate this frame, like every other voice in this file.
    // Two archers can land on the same pillar on the same frame, and two bit-identical bursts at the
    // same currentTime sum coherently into one twice as loud — the defect `bowReleaseLevel` exists
    // to solve for arrows.
    if (fight.blockedThisFrame.length > 0) combatAudio.pillarBlock()
    // Dust where each shot struck, at the position the fight reported rather than at the pillar's
    // axis: a burst on the column's centre line would be drawn inside the rock. 'deflect' is the
    // right burst kind and not a borrowed one — it means "this did nothing to anybody", which is
    // exactly what an arrow stopping on a rock is.
    for (const block of fight.blockedThisFrame) effects.add(createImpact(block.at, 'deflect'))

    /**
     * Fire's charge bill, paid the frame the burst fired, and paid *before* the thrust is offered.
     *
     * The ordering is the whole reason this block sits here rather than beside the breath deduction
     * above. F and R are different keys and can be pressed on the same frame, and both verbs spend
     * from the same three charges — so with one charge left, a frame that pressed both would fire a
     * burst and a thrust for one charge unless the burst's bill is settled first. Deducting here
     * means the fight gets the last charge and the thrust below is refused, which is the right
     * precedence for the frame the player asked for both: the burst is the press that has already
     * happened by the time this line runs.
     *
     * Deducted from what the fight reported rather than by re-asking whether a burst went out, for
     * the reason the Air Wall's breath is: `stepEncounter` already made that decision against
     * `canBurst`, and a second decision in this file — which has no tests — is a second decision that
     * can disagree.
     */
    if (fight.chargesSpent > 0) fireCharges = spendCharges(fireCharges, fight.chargesSpent)

    // The burst's cone, drawn from the fight's own report rather than from the press, exactly as the
    // two water reaches above are: a burst can be refused for want of a charge or for its cooldown,
    // and asking the fight what fired is what keeps a declined press from drawing a flame and playing
    // a voice for a move that never happened.
    //
    // `fightConfig.fire` rather than the unboosted default, for the defensive reason the vortex and
    // the water reaches read it: `boostedCombatConfig` does not touch fire at all today — the Avatar
    // State scales the gust's damage, knockback and cooldown and nothing else — so this is the very
    // same object. Reading it here is what makes the drawn cone follow on its own if a future boost
    // ever does reach fire's reach or its half angle.
    if (fight.burstFired) {
      effects.add(createFireBurst(player.position, player.forward, fightConfig.fire))
      combatAudio.fireBurst()
    }

    /**
     * The Fire Thrust: fire's heavy verb, and the one bending move in the game that `stepEncounter`
     * does not resolve.
     *
     * It is here because it is a movement move. The fight owns enemies, arrows and the player's
     * health pool and reports everything else for the caller to apply — `airWallBreathSpent`,
     * `tangleSeconds`, `focusSpent` — and a velocity impulse on the glider is further from its
     * business than any of those. `canFireThrust` and `fireThrustImpulse` own the two rules, so what
     * is left in this untested file is the assignment.
     *
     * `player.mode` is the post-step posture, which is what makes the ground refusal correct on the
     * frame it matters most: a player who touches down this very frame is in ground mode by now, so
     * the press is declined and the charges are refilled below rather than one being spent on a shove
     * the ground would have eaten anyway.
     *
     * One frame late by construction, like the net's refusal a few lines down, and fine for the same
     * reason: `controllerStep` has already integrated this frame, so the impulse lands on the next
     * one. Sixteen milliseconds against a move whose window is "before the ground arrives", which the
     * `LANDING_PROBE` of 2.5 m already makes generous. Resolving it before the fight instead would
     * mean the thrust could take the last charge out from under a burst pressed on the same frame,
     * and the whole ordering argument above would run the other way.
     *
     * `state.vortexReleased` is the same edge the fight reads for the other two heavy verbs, and the
     * element test is the same value `stepEncounter` was handed as `input.element` on this frame, so
     * one release can never resolve as two elements' heavy moves.
     */
    if (state.vortexReleased && elements.active === 'fire'
      && canFireThrust(fireCharges, player.mode)) {
      const impulse = fireThrustImpulse(player.forward, fightConfig.fire)
      player = { ...player, velocity: player.velocity.clone().add(impulse) }
      fireCharges = spendCharges(fireCharges)
      // Drawn at the pre-impulse position, which is where the fire actually left the wing, and aimed
      // from the impulse itself rather than from the heading — see `createFireThrust`.
      effects.add(createFireThrust(player.position, impulse))
      combatAudio.fireThrust()
    }

    /**
     * The refill, last of fire's four touch points in this function and deliberately after the spend.
     *
     * A frame that both spent a charge and landed ends full, which is the rule read literally:
     * touching down refills, and it does not matter what happened earlier in the same 16 ms. The
     * alternative order would let a burst thrown on the landing frame be charged for, which is the
     * same "a press the game declines must not be a press the player is charged for" instinct pointed
     * the other way — here the press was *not* declined, so what is being said instead is that the
     * landing is worth a full hand however the last one was spent.
     *
     * `stepFireCharges` takes no `dt`, and that is the design rather than an omission: a refill that
     * could be expressed as a rate would be a second Breath bar, which is the one thing fire must not
     * be. See its own comment.
     */
    fireCharges = stepFireCharges(fireCharges, landed, DEFAULT_COMBAT_CONFIG.fire)
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

    // The standing pillars, on exactly the arrow loop's pattern above and for the same reasons: a
    // view per record, created on first sight, updated from the record every frame, disposed when
    // the record is gone. Read straight from the simulation rather than through an interpolator,
    // like the arrows — a pillar does not move at all after the frame it rises, so there is nothing
    // for an interpolator to smooth.
    //
    // `encounter.pillars` and not a report of what was raised: the view has to follow the whole
    // list, because a pillar's rise and sink are both driven off its own `secondsLeft` and a third
    // press retires the oldest one silently.
    for (const pillar of encounter.pillars) {
      let view = pillarViews.get(pillar.id)
      if (!view) {
        view = createPillarView(pillar)
        pillarViews.set(pillar.id, view)
        scene.add(view.object)
        // Shadowed like the payload meshes and the soldiers, and unlike everything in `src/fx/`.
        // A pillar is a solid object rather than an attack tell, and an object this size with no
        // shadow does not sit on the ground it is supposed to have come out of.
        enableShadows(view.object)
      }
      view.update(pillar)
    }
    const standing = new Set(encounter.pillars.map((pillar) => pillar.id))
    for (const [id, view] of pillarViews) {
      if (standing.has(id)) continue
      scene.remove(view.object)
      view.dispose()
      pillarViews.delete(id)
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
      stoneHits: fight.stoneHitThisFrame,
      redirectHits: fight.redirectHitsThisFrame,
      // Fire's connects earn a burst on the same terms as everything else, and pay no Focus below —
      // the two are separate questions and `impactTargets` only answers the first.
      fireHits: fight.burstHitThisFrame,
      downed: fight.downedThisFrame,
      deflected: fight.deflectedThisFrame,
    })
    for (const id of bursts.hits) {
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'hit'))
    }
    for (const id of bursts.downs) {
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'down'))
    }
    for (const id of bursts.deflects) {
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'deflect'))
    }
    // One ice shell per soldier actually caught, at the duration the fight applied, so the tell
    // is on screen for exactly the window that soldier cannot act. `positionOf` reads
    // `fight.enemiesBeforeRestore` for the same reason the impact bursts above do: on a frame that
    // both restores the patrol and resolved a move, `encounter.enemies` holds fresh soldiers at
    // their spawn points and would put the shell there.
    //
    // Voiced once for the whole move, above, and drawn once per soldier here — the same split the
    // impact bursts make. Both lists are separate from the four Focus lists, because neither water
    // move pays Focus.
    for (const id of fight.grippedThisFrame) {
      const at = positionOf(id)
      if (at) effects.add(createIceShell(at, fightConfig.water.gripHoldSeconds))
    }
    for (const id of fight.frozenThisFrame) {
      const at = positionOf(id)
      if (at) effects.add(createIceShell(at, fightConfig.water.freezeHoldSeconds))
    }
    if (bursts.hits.length > 0) combatAudio.impact()
    if (bursts.downs.length > 0) combatAudio.down()
    // Once for the frame, like every other voice: `impactTargets` has already reduced this to
    // one entry per soldier, so a gust that bounces off two heavies is one clang.
    if (bursts.deflects.length > 0) combatAudio.clang()
    // Once, with the count, like every other voice on this list. A call per arrow stacked
    // bit-identical bursts at the same currentTime; the level for a volley is decided in
    // mapping.ts, where it can be tested.
    combatAudio.bowRelease(fight.firedThisFrame.length)

    // Heavy events only. Never a gust: a move with a 0.45s cooldown that hitches on
    // every use is nausea, not weight.
    if (staffSwing?.finisher && fight.staffHitThisFrame.length > 0) {
      freeze(DEFAULT_HITSTOP_CONFIG.finisherSeconds)
    }
    if (bursts.downs.length > 0) {
      freeze(DEFAULT_HITSTOP_CONFIG.downSeconds)
      shake = triggerShake(
        shake, DEFAULT_SHAKE_CONFIG.downAmplitude, DEFAULT_SHAKE_CONFIG.downSeconds,
      )
    }
    if (slam) {
      freeze(slamHitstopSeconds(slam.strength, DEFAULT_HITSTOP_CONFIG))
      shake = triggerShake(
        shake,
        slamShakeAmplitude(slam.strength, DEFAULT_SHAKE_CONFIG),
        DEFAULT_SHAKE_CONFIG.slamSeconds,
      )
    }
    // Deliberately outside the `fight.playerHit` block below, not inside it.
    // `playerHitsThisFrame` reports what was *aimed* at the player, so it is populated on a
    // frame a Slipstream discarded the damage — where `playerHit` is false and the hurt flash,
    // the shake and the hurt voice all correctly stay silent. A dodge should still say where
    // the attack came from; that is the information the next dodge is made of.
    //
    // `lookDirection` is this step's sample (copied from `state` further up, well before
    // `stepEncounter` ran) and it is the camera's heading rather than the character's: the
    // follow cam is placed behind the player along this direction and looks back at them, so
    // flattened it is the camera's own forward, which is what a screen-space bearing has to be
    // measured against. `player.position` is the same post-step position `stepEncounter` was
    // handed as `playerPosition`, so each bearing is measured from where the hit was resolved
    // against rather than from a frame either side of it.
    //
    // That substitution used to be an argument and is now pinned:
    // `follow-cam.test.ts`'s 'offsets the camera purely backward and up' asserts that the
    // direction from the camera back to the player, flattened, is the look direction exactly,
    // for both profiles and for steeply pitched headings. It is the only test that reddens if
    // the follow cam ever gains a shoulder offset or an orbit, which is precisely the change
    // that would rotate every wedge by a constant with nothing else in the game looking wrong.
    //
    // The one departure left is the camera's exponential smoothing, which is a lag rather than
    // a different direction: mid-turn the drawn camera is still catching up to
    // `lookDirection`, so a mark struck during a fast flick is fixed against the heading the
    // view is turning toward rather than the one it is showing. Reading the camera's own world
    // direction here instead would trade that lag for a one-frame-stale orientation, which is
    // the smaller error of the two — but it puts render state inside the simulation half of the
    // frame, and the size of the error has never been seen with hands on a mouse. Left as is
    // deliberately; `docs/HANDOFF.md` carries the magnitude.
    //
    // One tuning caveat worth knowing before anyone measures this. An arrow's reported `from`
    // is the projectile's position *entering* the frame it connects on, because `stepProjectile`
    // discards the connecting position — a gap of `speed × dt`, which at the shipped archer's
    // speed of 34 is about 0.57 units at 60 Hz. It stretches distance rather than rotating the
    // bearing: the pre-step position lies almost directly behind the impact point along the
    // arrow's own approach vector, so the direction back to it is nearly the same direction.
    // For an indicator that reports a direction and not a distance it barely matters, but it is
    // a real inaccuracy and not a rounding artefact.
    for (const hit of fight.playerHitsThisFrame) {
      hitMarks.push(markFor(lookDirection, player.position, hit))
    }

    // A net landed: the wings shut. Applied here rather than inside `stepEncounter` because
    // the fight owns enemies and arrows and the glider is the controller's business, and
    // through `applyTangle` rather than a bare assignment so two nets a frame apart cost one
    // refusal rather than two -- the merge rule lives in a tested module, not in this file.
    //
    // One frame late by construction, and that is fine: `controllerStep` has already run this
    // frame, so the forced stow and the refused deploy both land on the next one. A single
    // frame of glide after the net connects is 16 ms and invisible; the alternative is
    // resolving the fight before movement, which would break every ordering comment above.
    if (fight.tangleSeconds > 0) {
      player = { ...player, tangled: applyTangle(player.tangled, fight.tangleSeconds) }
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
      // redirectedThisFrame, not redirectHitsThisFrame: §4.5 pays for the redirect, and the
      // arrow finding a body pays separately through `downs` if it puts one down.
      redirects: fight.redirectedThisFrame.length,
    }
    const inWind = lastWind.accel.lengthSq() > 1e-6 || lastWind.liftScale !== 1
    focus = stepFocus(focus, {
      ratePerSecond: traversalRatePerSecond(
        player, inWind, DEFAULT_FLIGHT_CONFIG, DEFAULT_FOCUS_CONFIG,
      ),
      events,
      // The bill the fight reported, which today is only ever an Ice Lock. `stepFocus` returns
      // early on `frozen`, so a freeze thrown during the Avatar State costs nothing — correct
      // rather than a leak, because the state already holds the meter still and section 4.5 makes
      // all elements free while it runs.
      spent: fight.focusSpent,
      frozen: avatarActive,
      reset: asStep.justEnded,
    }, dt, DEFAULT_FOCUS_CONFIG)

    wind.update(
      player.mode === 'glider' ? airspeed : 0,
      avatarActive ? AUDIO_SWELL : 0,
    )
    // The hurt flash, scaled at the point of application rather than where the pulse is set
    // to 1 above. `stepPulse` decays at a fixed rate per second, so scaling the peak would
    // shorten the flash instead of dimming it, and a setting flipped mid-flash has to take
    // effect on the flash already running. This is the only consumer of `hurtFlash` that can
    // ever be non-zero: the `down` branch passes a literal 0, and the priming call near the
    // bottom of this function runs before any hit can have landed.
    // Updated in `update` rather than in `syncVisuals`, unlike the reticle and the two marker
    // rings. Those three are projected from the camera and have to be recomputed per rendered
    // frame; this widget is anchored in viewport fractions and its contents change only when the
    // simulation changes them, so drawing it beside the HUD — which is updated here for the same
    // reason — keeps it on the same clock as the element it is reporting.
    elementRadial.update(radialModel(elements, DEFAULT_ELEMENT_CONFIG, player.act))
    const shownHurtFlash = hurtFlash * motion.hurtFlash
    hud.update(hudModelFor(player, encounter.playerHealth, {
      focus: focus.max > 0 ? focus.value / focus.max : 0,
      avatarCharge: armFraction(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
      avatarActive,
      // The fade is a literal 0 rather than omitted, because the fire readout has to land in the
      // slot after it. Only the down beat's own call above draws a fade, and this is not that call.
    }, shownHurtFlash, stall, 0, fireReadout()))

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
    // The wall-ride lean, rolled on after the heading rather than blended into it. `lookAt`
    // overwrites the whole quaternion, so this has to follow it; `rotateZ` post-multiplies in
    // the object's own space, and local +Z is the heading `lookAt` just set, so this is a roll
    // about the character's own forward axis and nothing else.
    //
    // A rotation, never a scale. The glider is a direct child of `avatar.object`, so it rides
    // this roll — which is correct: the staff is strapped across his back and should tip with
    // him. Scaling here would compress it, which is the whole reason `setSquash` targets the
    // model wrapper instead.
    //
    // Stepped with real frame time, like the shake below, so the lean keeps easing on rendered
    // frames that fall between simulation steps.
    //
    // The angle is computed from `player.forward` while the roll is applied about
    // `sampledForward`. The two differ by at most one simulation step of a turn rate the
    // camera bounds, and the angle is a cosine projection onto that heading, so the
    // disagreement is a fraction of a percent of the lean — not worth a second interpolator.
    wallLean += (wallRideLean(player) - wallLean) * (1 - Math.exp(-WALL_LEAN_RESPONSE * frameDt))
    if (Math.abs(wallLean) > 1e-4) avatar.object.rotateZ(wallLean)

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
    //
    // Scaled by the reduce-motion shake scalar here, at the one point the offset reaches
    // the camera, rather than at the three `triggerShake` calls in update(): one site
    // instead of three, and it also covers a shake already running when the setting is
    // flipped. Camera shake is the primary vestibular trigger, so the scalar is 0 rather
    // than a softening, and multiplying the offset by 0 is a true zero — `shakeOffset`
    // writes into `shakeVec` and returns it, so this scales the scratch it just filled.
    camera.position.copy(cameraPosition)
      .add(shakeOffset(shake, shakeVec).multiplyScalar(motion.shake))
    camera.lookAt(sampledPosition)
    // The dash's FOV kick, scaled at the point of application for the same reason the hurt
    // flash is: `dashKick` is a `stepPulse` value with a fixed decay, so scaling the pulse
    // would shorten the kick rather than shrink it. A FOV punch is the other strong
    // vestibular trigger, so this scalar is 0 under reduce motion, which leaves the field
    // of view exactly at `fovForSpeed`.
    //
    // The speed-reactive field of view is the sixth motion scalar, and it is the largest of
    // the six: `fovForSpeed` widens the camera continuously with airspeed, by 14 degrees at
    // the 55 m/s reference and still 7 at 27.5, for as long as the fast flight lasts —
    // against the dash kick's 6 degrees for a fifth of a second. Reduce motion softens it to
    // 0.35 rather than zeroing it, because the widening view is how speed reads as speed;
    // `motionScales` carries the full argument. The scale reaches the kick and never
    // `BASE_FOV`, which is why it is an argument to `fovForSpeed` and not a multiplier here.
    //
    // One `airspeed` in place of the two `fovForSpeed` calls this used to be: on foot the
    // speed is a literal 0, so the branch only ever chose the argument, and two calls meant
    // two places the scale could go missing from.
    const airspeed = player.mode === 'glider' ? player.velocity.length() : 0
    camera.fov = fovForSpeed(airspeed, motion.speedFov)
      + fovKickForDash(dashKick) * motion.dashKick
    camera.updateProjectionMatrix()

    // **This line has to stay above both projections below, and the reason is not the one a
    // reader would guess.** `updateProjectionMatrix` rebuilds only `projectionMatrix`;
    // `Vector3.project` also reads `camera.matrixWorldInverse`, and nothing above has
    // refreshed that — `renderer.render` is what normally does, and it runs *after*
    // `syncVisuals`. `getWorldDirection` calls `updateWorldMatrix`, which `Camera` overrides
    // to refresh `matrixWorldInverse` as well, so this call is doing double duty: it produces
    // the camera heading the marker loop needs *and* it is the only thing that brings the
    // inverse world matrix up to this frame before anything projects against it. Moved back
    // down below the reticle's projection — where it used to sit — the reticle and the
    // chevrons project against matrices a frame apart, so the ring's origin lags the ring's
    // contents. Measured against the installed three.js: same target point, two different NDC
    // results, with this statement as the only thing in between.
    //
    // The camera's own world heading, not `lookDirection`. The hit wedges are handed
    // `lookDirection` because `markFor` is called from `update()`, where reading the camera
    // would pull render state into the simulation half of the frame — and the drawn camera
    // trails the look direction by a measured 17.78 degrees in a sustained 180
    // degrees-per-second turn on foot. A frozen bearing can afford that error. A bearing
    // recomputed every frame cannot: it would slide the whole ring during every flick and
    // settle afterwards. Here, after `camera.lookAt`, the accurate value is free.
    camera.getWorldDirection(cameraForward)

    // Everything below has to be *after* `updateProjectionMatrix`, and it is the one ordering in
    // this function that nothing tests. `Vector3.project` multiplies by the camera's projection
    // matrix and its inverse world matrix, both of which the two blocks above have just
    // refreshed: `camera.fov` was reassigned, `camera.position` was written, `camera.lookAt`
    // re-oriented it, and `getWorldDirection` brought the inverse world matrix along. Run
    // before either, the projection would use the previous frame's matrices and put the reticle
    // one frame behind the view — which still looks entirely plausible in motion and is exactly
    // why this is written down rather than left to be noticed.
    //
    // A point along the real heading, not screen centre. The camera looks AT the player from
    // behind and above, so screen centre is the character's body; and on foot `forward` is the
    // flattened look direction, so aim stays horizontal however far the player looks up. The
    // projection is the only thing that reports both truthfully.
    //
    // `sampledPosition` for the origin and `player.forward` for the heading, which is a mix on
    // purpose. The origin is the drawn position, so the reticle emanates from the character the
    // player can see rather than from a body one simulation step away from it. The heading is
    // the simulation's own `forward` — the very value `inGust` and the staff arcs resolve
    // against, and the same reason `aimTell` reads it instead of `sampledForward`: an aim
    // indicator has to agree with the hit, not with the smoothed visual. `forward` is documented
    // as always normalised in `src/core/types.ts`, so no length guard is needed here.
    aimPoint.copy(sampledPosition).addScaledVector(player.forward, AIM_DISTANCE).project(camera)
    const aim = reticleModel(aimPoint, aimHot)

    // Aged with real frame time, not the fixed step, for the reason `shake` is stepped here
    // rather than in `update`: a mark is a render-time fade, so it keeps fading through a
    // hitstop. Stepped in `update` it would freeze mid-fade, and the wedge from the hit that
    // caused the freeze would hang at full opacity for the length of it.
    hitMarks = stepHitMarks(hitMarks, frameDt)
    // **Nothing from `motionScales` reaches this, and that is the design rather than an
    // omission.** Every other effect in this function is scaled at the point it reaches the
    // screen — `motion.shake` on the offset above, `motion.dashKick` and `motion.speedFov` on
    // the field of view — so a reader arriving here will want to make this consistent with them.
    // Do not. `motionScales` zeroes `hurtFlash`, so with reduce motion on this indicator is the
    // player's only feedback that they were hit beyond the health bar moving; scaling it would
    // take away the thing that makes that mode playable in a fight. And there is nothing to
    // soften even in principle: a wedge does not shake, pulse, travel or grow, it sits still and
    // fades, so it is information rather than motion.
    // Inside the viewport, not merely inside the depth range. `reticleModel`'s `visible` only
    // answers the depth question — a point in front of the camera but off the side or the bottom
    // of the screen is `visible: true` with a fraction outside 0..1, and that is a live case
    // rather than a corner one: on foot `forward` is flattened, so a player looking steeply up
    // has an aim point genuinely below the bottom edge. The reticle is allowed to leave with it
    // (it is reporting where the aim point is, and off screen is the truth), but the wedges must
    // not follow it out of view, because the whole point of a hit mark is that the player can
    // see it.
    const aimOnScreen = aim.visible
      && aim.x >= 0 && aim.x <= 1 && aim.y >= 0 && aim.y <= 1

    // All three hidden through the whole down beat, and this is a correctness guard rather than
    // tidiness. `update()` returns early while `down` is set, so nothing in there is being
    // recomputed: `aimHot` holds whatever it was on the frame the player went down, and the
    // aim point is projected from a heading the player has no control over until the beat
    // ends. Drawing any of them is drawing a stale claim.
    //
    // It also takes a load off the overlays' document order. The three roots are appended before
    // `createHud` so that the HUD's full-screen `.hud-fade` paints over them during the
    // blackout (see the comment at the `createReticle` call), and until this branch existed
    // that layering was the *only* thing standing between the player and a warm gold reticle
    // over a black screen. Now it is a second line of defence: the order still matters for the
    // pause card and the guide panel, but nothing about the down beat depends on it any more.
    if (down) {
      reticle.hide()
      hitDirection.hide()
      offScreen.hide()
      // Hidden with them, and it is the same correctness guard rather than tidiness: `update()`
      // returns early while `down` is set, so the radial's model is whatever it was on the frame
      // the player went down, and it cannot be steered until the beat ends. It is also meant to
      // be behind full black — the badge sits in the HUD's own gutter, and the blackout is
      // supposed to be black.
      elementRadial.hide()
      return
    }

    // Below the down-beat return, not above it: every marker this loop builds would be
    // discarded there, and it is five projections and five bearings per frame for the length
    // of the blackout. Nothing between the two points reads `enemyMarkers`, and `cameraForward`
    // is filled in far above — up beside `updateProjectionMatrix`, where it also refreshes the
    // inverse world matrix both projections in this function depend on, which is why that call
    // did not come down here with the loop.
    enemyMarkers.length = 0
    for (const enemy of encounter.enemies) {
      const view = enemyViews.get(enemy.id)
      if (!view) continue
      // The *drawn* position, which the enemy loop at the top of this function has already
      // set from each soldier's interpolator. The chevron points at the body the player
      // would see if they turned, so its direction has to come from where that body is
      // drawn rather than from a simulation position up to one step away from it.
      //
      // The distance and stance rules inside `enemyMarker` read the simulation's own
      // `enemy` instead, because those are what the fight decided. The same mix, for the
      // same reason, as the reticle's drawn origin and simulation heading above.
      markerPoint.copy(view.object.position).project(camera)
      const marker = enemyMarker(
        enemy,
        player.position,
        markerPoint,
        bearingFromCamera(cameraForward, sampledPosition, view.object.position),
        DEFAULT_COMBAT_CONFIG.enemies[enemy.kind],
      )
      if (marker) enemyMarkers.push(marker)
    }

    reticle.update(aim)
    hitDirection.update(hitMarks, aimOnScreen ? aim : SCREEN_CENTRE)
    offScreen.update(enemyMarkers, aimOnScreen ? aim : SCREEN_CENTRE)
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
    // Primed with a full hand, for the reason this whole block exists: the paused front-door card can
    // be the first frame and never calls `update()`, so without the readout here the pip row would be
    // blank on the one screen a new player looks at longest — and fire is selectable from that first
    // frame. `0` for the fade, as above, so the readout lands in its own slot.
  }, hurtFlash, stallSeverity(player, DEFAULT_FLIGHT_CONFIG), 0, fireReadout()))
  // Primed with the HUD, and for exactly the reason the HUD is: the paused branch of `frame()`
  // can be the very first frame and can hold indefinitely behind the front-door card, and it
  // never calls `update()`. Without this the badge's dot would have no colour and its label no
  // text until the player first clicked in — a blank widget in the HUD gutter on the one screen a
  // new player looks at longest.
  elementRadial.update(radialModel(elements, DEFAULT_ELEMENT_CONFIG, player.act))

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
      // All three hidden while paused: the guide panel and the pause card own the screen then,
      // and a reticle floating over a settings panel is noise. Hidden rather than left as they
      // were, because this branch does not call `syncVisuals`, so there is no fresh aim point to
      // draw, no `frameDt` reaching `stepHitMarks` and no fresh marker list — leaving them up
      // would freeze a reticle at a heading the camera may no longer have, hold a ring of wedges
      // at a fixed opacity, and hold a ring of chevrons pointing at where soldiers were when the
      // player opened the panel, for as long as it stays open. The hit marks themselves are kept,
      // not discarded: no simulation time passes while paused, so they resume at the age they
      // were hidden at.
      reticle.hide()
      hitDirection.hide()
      offScreen.hide()
      // Hidden while paused for the same reason as the other three: this branch does not call
      // `update()`, so nothing is refreshing the radial, and an open ring frozen over the guide
      // panel or the pause card would be a widget the player cannot operate sitting on top of the
      // one they can. The selection itself is untouched — no simulation time passes — so it comes
      // back exactly as it was.
      elementRadial.hide()
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
