import {
  BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, ConeGeometry, DoubleSide, Group,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, TorusGeometry,
  type Object3D, type Quaternion,
} from 'three'
import { isDowned } from './health'
import { createHealthBar } from './health-bar'
import type { Enemy, EnemyConfig, EnemyKind } from './enemy'

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
