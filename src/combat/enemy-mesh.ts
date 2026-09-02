import {
  BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, ConeGeometry, DoubleSide, Group,
  MathUtils, Mesh, MeshBasicMaterial, MeshLambertMaterial, TorusGeometry,
  type Object3D, type Quaternion,
} from 'three'
import { isDowned } from './health'
import { createHealthBar } from './health-bar'
import { markCanReact } from './reactions'
import type { Enemy, EnemyConfig, EnemyKind } from './enemy'
import type { Element } from '../elements/element'

/**
 * A soldier, as primitives.
 *
 * Placeholder art on purpose: the point of this slice is that the fight reads, not
 * that the soldier does. What has to be legible is the stance, because the doc's
 * whole dodge window depends on the player seeing a wind-up coming — so the weapon
 * lifts on the telegraph and the body falls flat when downed.
 *
 * All four kinds come off one rig with a swapped prop, a swapped body tint and, for the net
 * thrower, one extra piece drawn on the ground. Four rigs would have been four places for the
 * downed pose, the rise and the health bar's parenting to drift.
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

  return {
    object,
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

      if (enemy.stance === 'rising') {
        // Flat at 0, upright at 1. The rotation carries the whole read: the colour stays
        // at the kind's own base, because WINDUP exists so the player can time a dodge, and
        // wearing it here would teach them to dodge something that cannot hit them.
        rig.rotation.set(
          (Math.PI / 2) * (1 - rising),
          Math.atan2(enemy.facing.x, enemy.facing.z),
          0,
        )
        bodyMaterial.color.setHex(BASE_COLOUR[kind])
        prop.rotation.set(0, 0, 0)
        return
      }

      if (isDowned(enemy.health)) {
        // Down, not gone: the body stays in the world, lying where it was put.
        rig.rotation.set(Math.PI / 2, 0, 0)
        bodyMaterial.color.setHex(BASE_COLOUR[kind])
        prop.rotation.set(0, 0, 0)
        return
      }

      // Facing is horizontal, so atan2 of the heading is the whole rotation.
      rig.rotation.set(0, Math.atan2(enemy.facing.x, enemy.facing.z), 0)

      const winding = enemy.stance === 'wind-up'
      bodyMaterial.color.setHex(winding ? WINDUP : BASE_COLOUR[kind])
      prop.rotation.set(winding ? WIND_UP_PITCH[kind] : 0, 0, 0)
    },
  }
}
