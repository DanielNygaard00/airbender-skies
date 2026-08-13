import {
  DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import type { FireConfig } from '../combat/fire'
import { burstShape } from '../combat/fire'
import type { Effect } from './effect'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry } from './sector'

/**
 * The blast a Fire Burst throws, drawn at the volume it actually affects.
 *
 * The same honesty rule `gust-cone.ts` argues for at length and `water-reach.ts` follows: the
 * filled sector states the true reach, because a hit landing outside the visible shape teaches the
 * wrong spacing and reads as a bug. So this is the third member of that family and it differs only
 * where the move differs.
 *
 * Where it differs is **speed and width**. A gust's arc travels outward over 0.22 seconds across a
 * 120-degree wedge; a grip's closes inward over 0.3; this one is a 30-degree wedge and its arc
 * crosses it in 0.16, which is the shortest-lived effect in the game. That is the readable
 * difference between a sweep of air and a blast thrown at one soldier, and it is the same
 * vocabulary rather than a new one: direction of travel and duration, both already carrying meaning.
 *
 * The tint is the one genuinely new colour in the effects layer, and it is picked against what is
 * already on screen rather than by name. The gust is cyan, the grip a deeper blue-green, ice nearly
 * white; the Focus bar, the arm pip, the Avatar State vignette and the hot reticle are all gold,
 * which is why fire is deliberately *not* gold — an orange-red that joined that conversation would
 * read as "charged" instead of "this is the damage move". It is also hotter and far more saturated
 * than the health bar's pale salmon, which is the one other warm thing on screen.
 *
 * **Deliberately a `MeshBasicMaterial` and not a `ShaderMaterial`.** A shader is the obvious reach
 * for fire and it is the one thing this file must not do: a `ShaderMaterial` that includes the
 * `..._pars_fragment` chunks the renderer already injects fails to compile almost silently, and the
 * mesh then simply does not draw — which looks like a correctly transparent effect with the world
 * showing through, so it can read as success. Two real defects in the Air Wall's shader were
 * invisible to every test and found only by looking. There is no `ShaderMaterial` anywhere in
 * `src/fx/`, and a flame is not the effect to introduce one with.
 *
 * No `PointsMaterial` either, for the related reason `water-reach.ts` gives: points draw
 * screen-facing squares, so a spray of embers approaching a world unit across reads as a solid
 * block up close — and a burst thrown at seven metres is nearer the camera than any mote cloud.
 */

/**
 * Shorter than the gust's 0.22 and the grip's 0.3, and the shortest in the game.
 *
 * A burst is instantaneous where a gust is a sweep and a grip is a drag. The lifetime is also what
 * keeps the effect from lying about the cooldown: at 0.16 seconds against `burstCooldownSeconds`
 * 1.2, the screen is clear of fire for seven eighths of the wait, so the player never sees a flame
 * while the move is refusing them.
 */
const LIFETIME = 0.16
/** Above the player's origin, which is at their feet — a sector on the ground is hidden. */
const HEIGHT = 1
/**
 * Two tints, unlike the gust's one: a deep orange fill and a near-white core on the travelling arc.
 *
 * The pair is what makes a narrow wedge read as hot rather than merely orange. A single colour at
 * this width is a thin stripe; the bright leading edge is what the eye follows, and it is the same
 * trick the gust's arc plays at a much larger scale.
 */
const FILL_TINT = 0xff5a2d
const ARC_TINT = 0xffd9a0
/** Matches the gust cone's and the water reach's fill, so the three read as the same statement. */
const FILL_OPACITY = 0.34
const ARC_OPACITY = 0.95
/**
 * Arc thickness as a fraction of its own radius, and thicker than the gust's 0.16.
 *
 * A 30-degree arc at a fraction of the gust's width has far less area, so the same thickness
 * fraction would draw a sliver. Thickened until the leading edge reads at the range the move is
 * thrown at rather than to match a number in another file.
 */
const ARC_THICKNESS = 0.3
/**
 * How far out the arc starts, as a fraction of the reach.
 *
 * Not zero: the blast leaves the caster's hand rather than materialising on top of them, and an arc
 * that began at the origin would spend its first frames as a dot inside the avatar's own silhouette.
 */
const ARC_START_FRACTION = 0.25

export function createFireBurst(origin: Vector3, forward: Vector3, c: FireConfig): Effect {
  const shape = burstShape(c)
  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  // Aim the group's +Z along the heading, flattened — because `inCone` tests a flattened heading, so
  // a cone tilted with a climbing glider would misrepresent the hit volume. Same convention as
  // `createGustCone` and `createWaterReach`, and `fire-burst.test.ts` checks the drawn shape against
  // `inFireBurst` rather than restating it.
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() > 1e-8) {
    group.lookAt(group.position.clone().add(flat.normalize()))
  }

  const fillGeometry = sectorGeometry(shape.halfAngle, 0, shape.range)
  const fillMaterial = new MeshBasicMaterial({
    color: FILL_TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: FILL_OPACITY,
    // Drawn over the world rather than depth-tested against it, for the reason the gust cone is: a
    // flat sector a metre above the player's feet is buried by ground sloping up away from them,
    // which made that effect invisible in play while its geometry tests all passed.
    depthTest: false,
  })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.rotation.x = SECTOR_FLAT_ROTATION_X
  fill.userData.excludeFromShadows = true

  // A unit arc scaled at runtime, so travelling outward costs a scale rather than a geometry rebuild
  // sixty times a second.
  const arcGeometry = sectorGeometry(shape.halfAngle, 1 - ARC_THICKNESS, 1)
  const arcMaterial = new MeshBasicMaterial({
    color: ARC_TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: ARC_OPACITY, depthTest: false,
  })
  const arc = new Mesh(arcGeometry, arcMaterial)
  arc.rotation.x = SECTOR_FLAT_ROTATION_X
  arc.userData.excludeFromShadows = true

  // Order matters to the tests and to the reader: the fill carries the true radius.
  group.add(fill)
  group.add(arc)

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    // Outward, unlike the grip's inward close: a blast leaves the caster. Eased so the arc is
    // fastest at the start and settles at full reach, which is what an explosion does and the
    // opposite of the gust's constant sweep.
    const travelled = MathUtils.lerp(ARC_START_FRACTION, 1, 1 - (1 - t) * (1 - t))
    // Never exactly zero: a zero scale collapses the matrix.
    arc.scale.setScalar(Math.max(travelled * shape.range, 1e-4))
    fillMaterial.opacity = FILL_OPACITY * (1 - t)
    // Squared, so the arc holds its brightness through most of its travel and then goes quickly —
    // the leading edge is what the eye follows. Same curve as the gust's and the grip's.
    arcMaterial.opacity = ARC_OPACITY * (1 - t * t)
  }

  apply()

  return {
    object: group,
    advance(dt: number): boolean {
      age += dt
      apply()
      return age < LIFETIME
    },
    dispose(): void {
      fillGeometry.dispose()
      fillMaterial.dispose()
      arcGeometry.dispose()
      arcMaterial.dispose()
    },
  }
}
