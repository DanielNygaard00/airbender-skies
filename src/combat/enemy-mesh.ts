import {
  AnimationMixer, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry,
  ConeGeometry, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  TorusGeometry, Vector3, type AnimationAction, type AnimationClip, type Object3D,
  type Quaternion,
} from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { isDowned } from './health'
import { createHealthBar } from './health-bar'
import { markCanReact } from './reactions'
import type { Enemy, EnemyConfig, EnemyKind, Stance } from './enemy'
import type { Element } from '../elements/element'

/**
 * A soldier: a real model when one has loaded, and primitives until then.
 *
 * What has to be legible is the stance, because the doc's whole dodge window depends on the
 * player seeing a wind-up coming. That was the point of the slice this file was built for, and
 * it is still the point now the art has arrived — so every pose decision below is made twice,
 * once for a body with a skeleton and once for a capsule with a prop bolted to it.
 *
 * **Both paths are live.** `loadGLTF` resolves null rather than rejecting, so the primitives are
 * not a stage this file has moved past: they are what a player sees if a model 404s on the
 * deployed site, and `enemy-mesh.test.ts` pins them in full for that reason. As primitives all
 * four kinds come off one rig with a swapped prop and a swapped body tint; wearing models they
 * come off one *skeleton*, shared bone for bone by all four, which is what lets `clipForStance`
 * be a single table instead of four.
 *
 * The object is in two parts. The root carries position only; the `rig` carries the
 * rotation. That split exists so the health bar, which hangs off the root, can face the
 * camera by copying its rotation — parented to the rotating part, its world orientation
 * would be the soldier's heading times the camera's, and it would never face anything.
 */
export interface EnemyView {
  object: Object3D
  /** `rising` is 0-to-1 progress through a push-up, from `risingProgress`. */
  sync(enemy: Enemy, cameraQuaternion: Quaternion, rising: number): void
  /**
   * Swap the primitives for a real model, once one has loaded.
   *
   * Shaped like `avatar.attachModel` and for the same reason: models arrive over the network
   * after the first frame, and `loadGLTF` resolves null rather than rejecting, so a soldier
   * whose model never arrives has to keep standing there as primitives. Everything `sync`
   * decides has a placeholder path and a model path for exactly that reason — this is a
   * fallback that has to work, not a transitional state.
   */
  attachModel(gltf: GLTF): void
  /**
   * Advance this soldier's animation. Separate from `sync` because `sync` is a pure read of one
   * frame of simulation state and has no time in it — the same split `sync`'s own signature
   * already makes by taking `rising` as a number rather than a duration.
   */
  update(dt: number): void
}

const BODY = 0x8d6b4a
const SPEAR = 0x4a3c2a
const BOW = 0x5a4632
/** Cold and hard, so plate reads as metal beside three soldiers in leather. */
const PLATE = 0x6f7683
/** The net and the coil of chain. Pale and cool, matching the lane it throws down. */
const NET = 0x9fb6c4
/** Warm and bright, so a telegraph is the most visible thing on screen. */
const WINDUP = 0xe4763c

/**
 * Each kind's own body tint, replacing the single `BODY` this used to hard-code.
 *
 * A Record over `EnemyKind`, so a fifth kind is a typecheck error here rather than a soldier
 * that silently wears the spear infantry's leather. Three of the four still take `BODY`: the
 * silhouette is what tells the player which threat they are looking at, and recolouring
 * everybody would spend the vocabulary on nothing. The heavy is the exception because its
 * armour is a *rule* rather than a weapon — the player has to be able to tell at a glance
 * which soldier the gust will not touch, before they throw one.
 *
 * **That argument holds for the capsules and is only half true of the models.** These colours
 * are applied to the placeholder body; a model wears its own texture and this Record never
 * touches it. As primitives the silhouettes were chosen for maximum difference — a thin cone,
 * an open arc, a wide flat slab, a closed ring — and they do the job the paragraph above claims.
 * The `soldiers` bench scene was added to check whether the models still do, and the answer it
 * photographs is: the heavy reads instantly, and spear, nets and archer are three dark bodies
 * that are hard to separate at the 30-to-55 metres these kinds actually fight from. The heavy
 * still reading is partly luck — the model cast for it is the pale one in the pack.
 *
 * Left alone deliberately rather than fixed here. The fix would be to multiply a per-kind tint
 * onto the model's own materials the way `sync`'s wind-up tint already does, which is cheap and
 * would separate the hues — but it spends the pack's art to buy the separation, and how much of
 * it to spend is an art-direction decision rather than a defect to patch. Recorded in
 * `docs/deferred-findings.md` so it is a decision waiting rather than an observation lost.
 */
const BASE_COLOUR: Record<EnemyKind, number> = {
  spear: BODY,
  archer: BODY,
  heavy: PLATE,
  nets: BODY,
}

/**
 * How far the prop swings back on a wind-up, in radians about the rig's X axis.
 *
 * Different amounts per kind, because the four motions read differently at distance: a spear
 * cocks hard back to thrust, a bow rotates as it is drawn, a heavy weapon is hauled up over
 * the shoulder, and a net is wound furthest back of all because it is thrown with the whole
 * body. Negative, so every prop tips away from the direction of travel.
 *
 * A Record for the same reason `BASE_COLOUR` is one. Every value is past the 0.3 radians
 * `enemy-mesh.test.ts` insists a telegraph must move by, so no kind can be added with an
 * invisible tell.
 */
const WIND_UP_PITCH: Record<EnemyKind, number> = {
  spear: -1.1,
  archer: -0.6,
  heavy: -0.8,
  nets: -1.4,
}

/**
 * Which model each kind wears, and it is a casting decision rather than an arbitrary mapping.
 *
 * The four come from one character pack and share one 32-joint skeleton bone for bone, which is
 * what makes a single clip vocabulary below possible at all — the alternative was four rigs and
 * four sets of clip names to keep in step.
 *
 * The casting itself is by silhouette and by what each model already carries. The archer is the
 * pack's Ranger because it is the one holding a bow, and the game already flies arrows at the
 * end of its draw. The heavy is the Cleric for its plate, and for an accident worth keeping: it
 * is the only one of the four that ships no `Roll`, which suits the kind whose whole identity is
 * being hard to move. The netter is the Rogue, hooded and the lightest of the four at 2,326
 * triangles, so the kind that fights from furthest out is also the cheapest to draw seven of.
 * The spear is the Warrior, which leaves the pack's Monk to the player and its Wizard spare for
 * whenever an enemy bender turns up.
 *
 * A Record for the reason `PROPS` is one: a fifth kind is a typecheck error here rather than a
 * soldier that silently arrives wearing nobody's model.
 */
export const MODEL_FILE: Record<EnemyKind, string> = {
  spear: 'soldier-warrior.glb',
  archer: 'soldier-ranger.glb',
  heavy: 'soldier-cleric.glb',
  nets: 'soldier-rogue.glb',
}

/**
 * The clip each kind winds up with.
 *
 * Chosen per kind rather than shared, because the wind-up is the one animation the player is
 * required to read: §4.4's whole dodge window depends on seeing it start. So each kind uses the
 * motion it actually makes — the Warrior's sword swing, the Ranger's bow draw, the Cleric's
 * staff swing, and for the netter the *longer* of the Rogue's two dagger attacks, because a net
 * is thrown with the whole body and `WIND_UP_PITCH` already says so by winding furthest back.
 *
 * These are not played at their authored speed; see `windUpTimeScale`.
 */
const WIND_UP_CLIP: Record<EnemyKind, string> = {
  spear: 'Sword_Attack',
  archer: 'Bow_Draw',
  heavy: 'Staff_Attack',
  nets: 'Dagger_Attack2',
}

/**
 * How fast to run the wind-up clip so it finishes exactly as the wind-up does.
 *
 * Derived, never tuned, and that is the whole point. Every kind's telegraph window is authored
 * in `CombatConfig` and the numbers differ deliberately — spear 0.55, archer 0.8, heavy 0.95,
 * nets 1.0 — with `config.ts` arguing at length that the heavy's is "the game's most generous
 * telegraph" and the netter's "the longest telegraph in the game". None of the borrowed clips
 * happens to be that long: they run 0.75 to 1.25 seconds. A clip left at its authored speed
 * would therefore finish early or late, and the animation would be telling the player a
 * different window from the one the simulation is actually keeping — which is worse than the
 * orange capsule it replaces, because it looks authoritative.
 *
 * So the ratio is computed from the two numbers that already exist. Nothing here needs
 * retuning when a telegraph is rebalanced, and a new kind cannot be added with a wind-up whose
 * animation disagrees with its window.
 */
export function windUpTimeScale(clipDuration: number, windUpSeconds: number): number {
  if (!(clipDuration > 0) || !(windUpSeconds > 0)) return 1
  return clipDuration / windUpSeconds
}

/**
 * Which clip plays for a stance. Pure, so the mapping is testable without a mixer.
 *
 * `downed` and `rising` both answer `Death`, and they are the two the caller does not simply
 * play. `Death` covers being downed *and* getting up, which is the reason this pack's short clip
 * list is enough: `stepEnemy` reports a push-up as a continuous 0-to-1 `rising`, and a model can
 * run its own death backwards from that number — a real get-up, continuous with the pose it is
 * rising out of, rather than a body swivelling upright the way the placeholder must. So `sync`
 * pauses this clip and drives its time from `rising` instead of letting it run, and the
 * animation therefore cannot disagree with the simulation about how far up the soldier is.
 *
 * `recover` deliberately returns to `Idle` rather than playing the attack's tail. The recover
 * window is the punish window — `config.ts` calls the heavy's 1.3 seconds of it exactly that —
 * so what it has to read as is *open*, not as a follow-through the player might still respect.
 */
export function clipForStance(stance: Stance, kind: EnemyKind, moving: boolean): string {
  switch (stance) {
    // `moving` is a separate input because `advance` does not mean "walking". It is the stance
    // every soldier is *spawned* in and the one it returns to after every attack, so a soldier
    // standing at its patrol post with the player far outside its `aggroRange` is advancing by
    // this enum's reckoning while not going anywhere at all. Keyed on the stance alone, all
    // seven of `HOME_PATROL` would have walked on the spot from the moment the game loaded.
    //
    // Derived in the view from the position it is handed rather than read off the simulation,
    // because there is no velocity on `Enemy` to read — and deriving it has a bonus the enum
    // could not give: a body being shoved backwards by knockback is moving, and now says so.
    case 'advance': return moving ? 'Walk' : 'Idle'
    case 'wind-up': return WIND_UP_CLIP[kind]
    case 'downed': return 'Death'
    case 'rising': return 'Death'
    case 'recover': return 'Idle'
    case 'held': return 'Idle'
  }
}

/**
 * How far a soldier must move between syncs to count as walking.
 *
 * Small because it is separating movement from *no* movement rather than slow from fast: a
 * soldier the simulation is not moving has its position copied unchanged, so the delta is
 * exactly zero, and the slowest kind still covers millimetres per frame. Deliberately not a
 * speed — that would need the frame time, and a threshold on distance errs the safe way as the
 * frame rate drops, since longer frames only move a walking soldier further past it.
 */
const MOVING_EPSILON = 1e-4

/**
 * Standing height for a soldier's model, matching the capsule it replaces.
 *
 * `CapsuleGeometry(0.35, 1.0)` is 1.7 tall and sits at y 0.85, so the placeholder spans exactly
 * 0 to 1.7 and every reach, lane and health-bar height in the fight was authored against that.
 * The models arrive about 3.0 units tall, so they are measured and scaled rather than trusted:
 * the four differ by 5 centimetres between themselves, which would otherwise be a soldier that
 * is quietly taller than the one beside it.
 */
const SOLDIER_HEIGHT = 1.7

/** How long a cross-fade between two soldier clips takes. Matches the avatar's. */
const FADE_SECONDS = 0.18

/**
 * Scale a model to `SOLDIER_HEIGHT` and seat its feet at the rig's origin.
 *
 * Measured through the built scene graph rather than assumed, the way `fitToPlaceholder` does it
 * for the player, and for a reason worth recording: read straight off the vertex buffers these
 * models look as though they hang up to 0.79 below their own origin, which would mean a soldier
 * scaled short and floating. They do not — those bounds are in mesh-local space, *before* the
 * node transforms that put the model on its feet. Measured properly through `Box3` the four sit
 * between 4 and 5 millimetres below zero. So the offset is real but tiny, and it is applied
 * rather than assumed away only because measuring costs nothing.
 */
function fitToCapsule(wrapper: Object3D, model: Object3D): void {
  const box = new Box3().setFromObject(model)
  const height = box.max.y - box.min.y
  if (!Number.isFinite(height) || height <= 0) return
  const scale = SOLDIER_HEIGHT / height
  wrapper.scale.setScalar(scale)
  wrapper.position.y = -box.min.y * scale
}

/** How wide the throw lane is at its far end, in metres either side of the centre line. */
const LANE_HALF_WIDTH = 1.4
/** Just off the ground, for the same camera-angle reason `createAimTell` lifts its chevron. */
const LANE_HEIGHT = 0.06

/**
 * The net thrower's throw lane: a flat wedge on the ground running out along local +Z.
 *
 * The aim tell, and the counterpart to `createAimTell`'s preview sector for the player's own
 * gust: a hit volume the player is inside deserves to be drawn at the reach it actually has.
 * Being netted costs the whole air layer for two seconds, so "you are in the lane" is the one
 * piece of information the player most needs before the throw lands, and the wind-up recolour
 * every kind shares cannot carry it — it says a soldier is about to do something, not that it
 * is about to do it *to you*.
 *
 * A wedge rather than a line because it has to read at the shallow angle this game mostly
 * plays at, where a line foreshortens into a point. It widens away from the thrower, which is
 * also honest about the net: a thrown net spreads.
 *
 * Built at the netter's real `strikeRange` and never rescaled, since a config is fixed for
 * the run.
 */
function createLaneGeometry(length: number): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    -LANE_HALF_WIDTH, 0, length,
    LANE_HALF_WIDTH, 0, length,
  ]), 3))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * How far above the feet the mark pip sits: above `health-bar.ts`'s own bar, which stands at
 * height 2, so the two never share a band and the bar's own read is undisturbed.
 */
const MARK_PIP_HEIGHT_ABOVE_FEET = 2.3
const MARK_PIP_SIZE = 0.16
/**
 * Below this many seconds left, the pip's opacity starts dropping toward `MARK_PIP_FADE_FLOOR`.
 *
 * A fixed window rather than a fraction of the mark's total duration, because `sync` is only
 * ever handed `secondsLeft` -- `EnemyConfig` carries none of `ReactionConfig.markSeconds`, and
 * the brief that set this task rules out changing `sync`'s signature to thread it through. A
 * fixed window still tells the two tactical facts the brief asks for apart: a mark with plenty
 * left reads at full strength the whole time it has left, and only the stretch closest to
 * expiry dims -- which is the "about to expire" moment that matters, read off the one number
 * this view actually has.
 */
const MARK_PIP_FADE_WINDOW = 1
/** Never fades all the way to invisible: a dim mark is still a mark, not a hidden one. */
const MARK_PIP_FADE_FLOOR = 0.35

/**
 * The pip's colour per element, carrying over the identity the player already learned from the
 * elements radial rather than inventing a second set.
 *
 * These are the exact three.js-number renderings `aim-tell.ts` (`TINT = 0x7fe4ff`),
 * `water-reach.ts` (`GRIP_TINT = 0x2fb8d8`), `earth-reach.ts` (`TINT = 0xd9a066`) and
 * `fire-burst.ts` (`FILL_TINT = 0xff5a2d`) already carry for `src/ui/element-radial.ts`'s own
 * `LOOKS` table -- air's `#7fe4ff`, water's `#2fb8d8`, earth's `#d9a066` and fire's `#ff5a2d`,
 * with fire deliberately pushed toward red and away from amber so it never joins the gold
 * "charged" family. `LOOKS` is not exported, and it holds CSS strings for the HUD's DOM rather
 * than three.js hex numbers for a `Mesh` material, so there is no single symbol this file and
 * that one could both import without either exporting a HUD-only table out of its module or
 * building a shared number/string pair nothing else needs. Reusing the *numbers* already proven
 * equal to `LOOKS` -- rather than re-deriving four hex literals from the CSS strings by hand,
 * which risks a transcription slip -- is the same trade every one of those `src/fx` tints
 * already makes, so this table makes it too instead of inventing a fifth notation.
 *
 * A `Record<Element, ...>`, for `element.ts`'s own reason: appending to `Element` must fail
 * this table's typecheck until the new element is given a pip colour, the same guarantee
 * `BASE_COLOUR` and `WIND_UP_PITCH` above already carry.
 */
const MARK_COLOUR: Record<Element, number> = {
  air: 0x7fe4ff,
  water: 0x2fb8d8,
  earth: 0xd9a066,
  fire: 0xff5a2d,
}

/**
 * A small filled chevron, billboarded like the health bar rather than laid flat on the ground
 * like `createLaneGeometry`'s wedge -- this shape has to read face-on at fight distance, not
 * foreshortened by the shallow camera angle the way a flat ground shape would be.
 *
 * A chevron rather than a bar or a dot, for `aim-tell.ts`'s `createChevronGeometry` reason: it
 * carries its own silhouette rather than leaning on hue alone, so the mark still reads if the
 * colour is hard to place at distance or the soldier is lit oddly -- the same argument
 * `aim-tell.ts` makes against a bar (foreshortens into a line) or a dot (says nothing). Built in
 * the local XY plane, where `createHealthBar`'s `PlaneGeometry`s also live, so copying
 * `cameraQuaternion` whole turns it to face the camera the same way the bar already does.
 */
function createMarkPipGeometry(size: number): BufferGeometry {
  const geometry = new BufferGeometry()
  const halfWidth = size * 0.6
  const tailY = -size * 0.4
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, size, 0,
    -halfWidth, tailY, 0,
    halfWidth, tailY, 0,
  ]), 3))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The prop each kind carries, and the node name other code finds it by.
 *
 * A Record of factories rather than a chain of `if (kind === ...)` with a fallthrough, and the
 * difference is the whole point: a chain has to end in an unguarded branch, so a fifth kind
 * silently inherits whichever prop that branch builds. This is a `Record<EnemyKind, ...>`, so a
 * fifth kind is a typecheck error here — the same protection `CombatConfig.enemies` gets from
 * being a Record, and for the same reason. A soldier that quietly wears another type's silhouette
 * is a bug the player experiences as the fight lying to them.
 *
 * Factories rather than shared meshes, because each view owns its own geometry and material and
 * `sync` writes rotations into them per soldier.
 */
const PROPS: Record<EnemyKind, () => Mesh> = {
  // Geometry, position and name all unchanged from before there were four kinds: other tests find
  // this node by name, and the silhouette is the read.
  spear: () => new Mesh(new ConeGeometry(0.09, 1.9, 6), new MeshLambertMaterial({ color: SPEAR })),
  archer: () => new Mesh(
    new TorusGeometry(0.42, 0.05, 6, 12, Math.PI * 1.2),
    new MeshLambertMaterial({ color: BOW }),
  ),
  // A slab shield rather than a weapon. The heavy's read is what it holds *up*, not what it swings:
  // a wide flat plate is the silhouette that says "this does not move".
  heavy: () => new Mesh(new BoxGeometry(0.12, 1.15, 0.75), new MeshLambertMaterial({ color: PLATE })),
  // A closed ring, where the archer's bow is an open arc: both are tori and the difference has to
  // be visible at distance, so this one is complete, thicker and a different colour.
  nets: () => new Mesh(new TorusGeometry(0.34, 0.1, 6, 12), new MeshLambertMaterial({ color: NET })),
}

/** The node name each kind's prop answers to. Kept beside `PROPS` so the two cannot drift. */
const PROP_NAMES: Record<EnemyKind, string> = {
  spear: 'spear', archer: 'bow', heavy: 'shield', nets: 'net',
}

function createProp(kind: EnemyKind): Mesh {
  const prop = PROPS[kind]()
  prop.name = PROP_NAMES[kind]
  return prop
}

export function createEnemyView(kind: EnemyKind, c: EnemyConfig): EnemyView {
  const object = new Group()

  const rig = new Group()
  rig.name = 'rig'
  // Bulk, for the one kind whose whole identity is being hard to move. Set once rather than
  // per frame, and on the rig rather than the root, so it scales the body and the prop
  // together and leaves the health bar hanging off the root at its authored size.
  if (kind === 'heavy') rig.scale.set(1.3, 1, 1.3)
  object.add(rig)

  const bodyMaterial = new MeshLambertMaterial({ color: BASE_COLOUR[kind] })
  const body = new Mesh(new CapsuleGeometry(0.35, 1.0, 4, 8), bodyMaterial)
  body.name = 'body'
  body.position.y = 0.85
  rig.add(body)

  const prop = createProp(kind)
  prop.position.set(0.32, 1.1, 0)
  rig.add(prop)

  /**
   * The throw lane, on the *root* rather than on the rig, and that is load-bearing.
   *
   * The rig takes a quarter turn about X when its owner goes down or pushes back up, which
   * would stand a flat ground shape on its end. The health bar hangs off the root for the
   * mirror image of this reason, so the lane is in the right company.
   *
   * The cost of not inheriting the rig's rotation is that the lane has to be aimed itself, and
   * `sync` does that from the same `facing` the rig reads.
   */
  const lane = kind === 'nets'
    ? new Mesh(
        createLaneGeometry(c.strikeRange),
        new MeshBasicMaterial({
          color: NET, transparent: true, opacity: 0.28, side: DoubleSide, depthWrite: false,
          // Drawn over the world, like every attack tell in `src/fx`: a flat shape near the
          // ground is otherwise buried by terrain sloping up away from it, which is the defect
          // that made the player's own gust cone invisible in play. It also means a lane
          // thrown from behind a rise is still visible, which is the case that matters most.
          depthTest: false,
        }),
      )
    : null
  if (lane) {
    lane.name = 'throw-lane'
    lane.position.y = LANE_HEIGHT
    lane.visible = false
    lane.userData.excludeFromShadows = true
    object.add(lane)
  }

  const healthBar = createHealthBar()
  object.add(healthBar.object)

  const pipGeometry = createMarkPipGeometry(MARK_PIP_SIZE)
  // Colour and opacity are written per-mark in `sync`, below; white and opaque here are inert
  // defaults that are never actually seen, since the pip starts hidden and only the branch that
  // finds a mark ever turns it on.
  const pipMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false })
  const pip = new Mesh(pipGeometry, pipMaterial)
  pip.name = 'mark-pip'
  pip.position.y = MARK_PIP_HEIGHT_ABOVE_FEET
  pip.visible = false
  pip.userData.excludeFromShadows = true
  object.add(pip)

  /**
   * Model state. Null until one arrives, and every pose branch in `sync` reads it to decide
   * whether it is rotating primitives or driving a mixer.
   */
  let modelRoot: Group | null = null
  let mixer: AnimationMixer | null = null
  let modelClips = new Map<string, AnimationClip>()
  let currentAction: AnimationAction | null = null
  let currentClip: string | null = null
  /** The model's own materials beside the colour each arrived with, for the wind-up tint. */
  let modelMaterials: { material: MeshLambertMaterial; colour: number }[] = []
  /**
   * Where this soldier was at the previous sync, so the view can tell walking from standing
   * still without a velocity on `Enemy` to read. Null until the first sync, which therefore
   * reports "not moving" -- the correct answer for a soldier that has only just spawned.
   */
  let lastPosition: Vector3 | null = null

  /**
   * Start `name`, or return the action already running it.
   *
   * `hold` is for the two stances whose progress the simulation owns rather than the clock:
   * being downed and pushing back up both drive the clip's time themselves, so the action is
   * paused and its time written by the caller.
   */
  function play(name: string, hold: boolean, timeScale: number): AnimationAction | null {
    if (!mixer) return null
    const clip = modelClips.get(name)
    if (!clip) return null

    if (currentClip === name && currentAction) {
      currentAction.paused = hold
      currentAction.timeScale = hold ? 0 : timeScale
      return currentAction
    }

    const next = mixer.clipAction(clip)
    // Snapped rather than faded on the very first pose, because nothing has ticked this mixer
    // yet: a fade would ramp weight from 0 over mixer time the soldier has not spent, so the
    // first frame would show the bind pose. The same trap `avatar.poseNow` documents.
    if (currentAction) {
      currentAction.fadeOut(FADE_SECONDS)
      next.reset().fadeIn(FADE_SECONDS).play()
    } else {
      next.reset().setEffectiveWeight(1).play()
    }
    next.paused = hold
    next.timeScale = hold ? 0 : timeScale
    currentAction = next
    currentClip = name
    return next
  }

  return {
    object,

    attachModel(gltf: GLTF): void {
      // Cloned, and this is the single most important line in the method. `loadGLTF` caches by
      // URL, and three of the seven soldiers in `HOME_PATROL` are spears — so the same GLTF
      // instance is handed to several views, and an Object3D has exactly one parent. Adding
      // `gltf.scene` directly would mean the last soldier to attach stole the model and the
      // other two stood empty. `SkeletonUtils.clone` rather than `Object3D.clone` because a
      // plain clone copies the meshes but leaves them bound to the original's skeleton, which
      // animates one soldier and drags the others' limbs along with it.
      const model = cloneSkinned(gltf.scene)

      // A second call has to be safe for the same sharing reason: a retry, or two views handed
      // one load, must not leave the previous model parented with its actions still running.
      if (modelRoot) rig.remove(modelRoot)
      mixer?.stopAllAction()
      currentAction = null
      currentClip = null

      // Only these two go. The lane, the pip and the health bar hang off the *root* rather than
      // the rig and are tells rather than art, so the model does not replace them.
      rig.remove(body)
      rig.remove(prop)

      modelRoot = new Group()
      modelRoot.add(model)
      fitToCapsule(modelRoot, model)
      rig.add(modelRoot)

      // Materials cloned per view, for the sharing reason again and with a visible symptom:
      // the wind-up tint writes `material.color`, so three spear soldiers sharing one material
      // would all flash orange when any one of them wound up.
      modelMaterials = []
      model.traverse((node) => {
        const mesh = node as Mesh
        if (!mesh.isMesh || Array.isArray(mesh.material)) return
        if (!(mesh.material instanceof MeshLambertMaterial)) return
        const own = mesh.material.clone()
        mesh.material = own
        modelMaterials.push({ material: own, colour: own.color.getHex() })
      })

      mixer = new AnimationMixer(model)
      modelClips = new Map(gltf.animations.map((clip) => [clip.name, clip]))
    },

    update(dt: number): void {
      mixer?.update(dt)
    },

    sync(enemy: Enemy, cameraQuaternion: Quaternion, rising: number): void {
      object.position.copy(enemy.position)
      // Ahead of the downed branch below: the bar's own rule already covers being
      // downed, so there is one place that decides when a bar shows.
      healthBar.update(enemy.health, cameraQuaternion)

      if (lane) {
        // Set here, above every early return, so there is one place that decides whether the
        // lane shows and no branch below can leave it up. `wind-up` is mutually exclusive with
        // `downed` and `rising` in every path through `stepEnemy` and `hitEnemy`, so the
        // stance test alone is sufficient — but a lane hanging over a body is the worst
        // failure this tell has, so the health test is here as a belt as well as a brace.
        lane.visible = enemy.stance === 'wind-up' && !isDowned(enemy.health)
        // Aimed from `facing`, the same horizontal heading the rig turns by and the same one
        // the release is thrown along, so the drawn lane and the thrown net agree.
        lane.rotation.y = Math.atan2(enemy.facing.x, enemy.facing.z)
      }

      /**
       * Computed here, above every early return below, for the lane's own reason: deciding
       * visibility in one place is what keeps every branch of `sync` from having to remember
       * a stale mark. `!isDowned` is doing real work here, not standing in for a case that
       * cannot happen -- `markEnemy` refuses to *write* a mark on a downed body, but nothing
       * clears an *existing* one when a soldier goes down (`hitEnemy` leaves `mark` untouched,
       * and `markAndReact` in encounter.ts only clears it when the blow that downs the soldier
       * is itself the one that fires a reaction). So a mark struck moments before a knockdown
       * can still be sitting in `enemy.mark` afterwards, ageing down on its own schedule, and
       * this check is the only thing standing between that stale data and a pip drawn on a
       * body that cannot act on it.
       *
       * `markCanReact` folds into this same gate rather than adding a second one, for the
       * finding this pip's own bench scenes (`marks`, `marks-occluded`) turned up: of
       * `REACTIONS`'s sixteen cells, only water's row is ever anything but `'none'`, so an air,
       * earth or fire mark can never produce a reaction whatever hits it. Before this the pip
       * drew all four with equal visual weight, which made three of the four states it drew
       * information nobody could act on -- and a pip showing unusable state is the same failure
       * as the invisible mark it was built to fix, pointing the other way. It also makes moot,
       * rather than separately fixing, air's own near-invisible `#7fe4ff` pip against a sky
       * background: an unactionable mark now draws nothing, so its colour never has to be seen.
       *
       * The alternative considered was drawing all four but styling the actionable one
       * differently -- bolder, or the other three dimmed. Rejected: a mark that can never be an
       * input carries no information to style. The soldier is not "burning"; the mark is purely
       * a reaction input, so even a quieter pip on an unactionable mark would still be teaching
       * the player that it matters.
       *
       * Costs nothing when `mark` is null: only this one boolean is written, and the colour,
       * opacity and billboard work below never runs -- the same shape `avatar-aura.ts` and
       * `guard-shell.ts` use to skip themselves entirely while invisible.
       */
      pip.visible = enemy.mark !== null && !isDowned(enemy.health) && markCanReact(enemy.mark.element)
      if (enemy.mark) {
        pipMaterial.color.setHex(MARK_COLOUR[enemy.mark.element])
        // A fixed fade window rather than a fraction of the mark's total duration -- see
        // `MARK_PIP_FADE_WINDOW`'s own comment for why `sync` has no total to divide by here.
        pipMaterial.opacity = MathUtils.clamp(
          enemy.mark.secondsLeft / MARK_PIP_FADE_WINDOW, MARK_PIP_FADE_FLOOR, 1,
        )
        // Copied whole, not yaw-only, for the health bar's own reason: the camera looks down
        // at the soldier, and a yaw-only pip would lean away from it.
        pip.quaternion.copy(cameraQuaternion)
      }

      /** The wind-up tint, or back to the colours the model arrived wearing. */
      const tintModel = (winding: boolean): void => {
        for (const entry of modelMaterials) {
          entry.material.color.setHex(winding ? WINDUP : entry.colour)
        }
      }

      /**
       * Whether the body actually went anywhere since the last sync. Read before any branch
       * updates it, and updated exactly once below so every branch sees the same answer.
       */
      const moving = lastPosition !== null
        && lastPosition.distanceToSquared(enemy.position) > MOVING_EPSILON * MOVING_EPSILON
      lastPosition = (lastPosition ?? new Vector3()).copy(enemy.position)

      /** Hold `Death` at the point through it that `rising` names. 1 is flat, 0 is upright. */
      const holdDeathAt = (backwards: number): void => {
        const name = clipForStance('downed', kind, false)
        const action = play(name, true, 1)
        const clip = modelClips.get(name)
        if (action && clip) action.time = clip.duration * backwards
      }

      // Facing is horizontal, so atan2 of the heading is the whole rotation.
      const facingYaw = Math.atan2(enemy.facing.x, enemy.facing.z)

      if (enemy.stance === 'rising') {
        // Flat at 0, upright at 1. The rotation carries the whole read: the colour stays
        // at the kind's own base, because WINDUP exists so the player can time a dodge, and
        // wearing it here would teach them to dodge something that cannot hit them.
        rig.rotation.set((Math.PI / 2) * (1 - rising), facingYaw, 0)
        bodyMaterial.color.setHex(BASE_COLOUR[kind])
        prop.rotation.set(0, 0, 0)
        if (modelRoot) {
          // The model gets up under its own power — its death, run backwards — so the rig is
          // left doing nothing but turning it. Unpitching the rig *as well* would rotate a body
          // that is already standing itself up, and the soldier would arrive leaning.
          rig.rotation.set(0, facingYaw, 0)
          tintModel(false)
          holdDeathAt(1 - rising)
        }
        return
      }

      if (isDowned(enemy.health)) {
        // Down, not gone: the body stays in the world, lying where it was put.
        rig.rotation.set(Math.PI / 2, 0, 0)
        bodyMaterial.color.setHex(BASE_COLOUR[kind])
        prop.rotation.set(0, 0, 0)
        if (modelRoot) {
          // Held at the end of its own death rather than pitched flat. The yaw is kept, which
          // the placeholder throws away: a capsule laid on its side looks the same whichever way
          // it was turned, but a body should lie along the direction it was facing when it fell.
          rig.rotation.set(0, facingYaw, 0)
          tintModel(false)
          holdDeathAt(1)
        }
        return
      }

      rig.rotation.set(0, facingYaw, 0)

      const winding = enemy.stance === 'wind-up'
      bodyMaterial.color.setHex(winding ? WINDUP : BASE_COLOUR[kind])
      prop.rotation.set(winding ? WIND_UP_PITCH[kind] : 0, 0, 0)
      if (modelRoot) {
        // The tint is kept even though the model now animates its own wind-up, and that is a
        // deliberate belt and braces rather than an oversight. `WINDUP` exists because the
        // telegraph has to be "the most visible thing on screen", and these soldiers are read
        // from 30 to 55 metres out — where a limb moving is a few pixels and a colour change is
        // the whole silhouette. It costs the pack's art for the 0.55 to 1.0 seconds of a
        // wind-up, which is the cheaper of the two errors.
        tintModel(winding)
        const name = clipForStance(enemy.stance, kind, moving)
        const clip = modelClips.get(name)
        play(
          name,
          false,
          winding && clip ? windUpTimeScale(clip.duration, c.windUpSeconds) : 1,
        )
      }
    },
  }
}
