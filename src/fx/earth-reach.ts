import {
  DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import { stoneShape, type EarthConfig } from '../combat/earth'
import type { Effect } from './effect'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry } from './sector'

/**
 * The ground a Stone Throw covers, drawn at the volume it actually affects.
 *
 * The third member of the family `gust-cone.ts` started and `water-reach.ts` continued, and it
 * follows the same honesty rule for the same reason: the filled sector states the true reach,
 * because a hit landing outside the visible shape teaches the wrong spacing and reads as a bug.
 * The cone is narrow — 40 degrees against the gust's 120 — and drawing it honestly is what tells
 * the player, without a word, that this move has to be aimed where the gust only has to be
 * pointed.
 *
 * **Direction of travel is how the three elements read apart**, and this one travels *outward*.
 * That puts it on the same side of the vocabulary as the gust, which is correct and is worth
 * saying out loud, because the obvious instinct is to make every element's tell distinct: a gust
 * and a thrown rock both send something away from the player, so they share a direction, and what
 * separates them is width and colour. It is water that is the odd one — a grip travels inward
 * because the soldier is about to. Inventing a third direction for earth would have made the
 * vocabulary arbitrary rather than descriptive.
 *
 * The arc travels outward and does not close, unlike the grip's: a rock leaves and does not come
 * back, so the bright edge runs to the full reach and fades there.
 *
 * **Deliberately a `MeshBasicMaterial` and not a `ShaderMaterial`.** The argument is
 * `water-reach.ts`'s in full: a `ShaderMaterial` that includes the `..._pars_fragment` chunks the
 * renderer already injects fails to compile almost silently, and the mesh then simply does not
 * draw — which looks like a correctly transparent effect with the world showing through, so it
 * can read as success. There is no `ShaderMaterial` anywhere in `src/fx/` and this is not the
 * effect to introduce one with. No `PointsMaterial` either: points draw screen-facing squares, so
 * a spray of grit at anything approaching a world unit across reads as a block from close up.
 */
const LIFETIME = 0.26

/** Above the player's origin, which is at their feet — a sector on the ground is hidden. */
const HEIGHT = 1

/**
 * A warm sandstone, picked against the world rather than in the abstract.
 *
 * Three hazards to stay clear of, and this colour is chosen by all three. It must separate from
 * the pale green terrain and washed sky the gust's first pale-blue pass disappeared into, so it is
 * saturated and light rather than a realistic rock grey — a grey-brown effect over grey-brown
 * ground is an effect nobody sees. It must not be gold: the Focus bar, the arm pip, the Avatar
 * State vignette and the hot reticle all use gold to mean "charged" or "this will land", and an
 * element's colour has no business joining that conversation. And it must leave room for fire,
 * which is the next element and will want red and orange — so earth stays on the brown side of
 * warm rather than reaching toward flame.
 */
const TINT = 0xd9a066

/** Matches the gust cone's and the water reach's fill, so all three read as the same statement. */
const FILL_OPACITY = 0.34
const ARC_OPACITY = 0.9
/** Arc thickness as a fraction of its own radius, the same as the other two. */
const ARC_THICKNESS = 0.16
/**
 * Where the outward arc starts, as a fraction of the reach.
 *
 * Not zero: an arc that began at the player's own feet would spend its first frames as a bright
 * disc under them, which reads as something landing on the player rather than leaving. It starts
 * where a thrown thing is already clear of the thrower.
 */
const ARC_START_FRACTION = 0.2

export function createEarthReach(origin: Vector3, forward: Vector3, c: EarthConfig): Effect {
  const shape = stoneShape(c)
  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  // Aim the group's +Z along the heading, flattened — because `inCone` tests a flattened heading,
  // so a cone tilted with a climbing glider would misrepresent the hit volume. Same convention as
  // `createGustCone` and `createWaterReach`, and `earth-reach.test.ts` checks the drawn shape
  // against `inStoneThrow` rather than restating it.
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() > 1e-8) {
    group.lookAt(group.position.clone().add(flat.normalize()))
  }

  const fillGeometry = sectorGeometry(shape.halfAngle, 0, shape.range)
  const fillMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: FILL_OPACITY,
    // Drawn over the world rather than depth-tested against it, for the reason the gust cone is: a
    // flat sector a metre above the player's feet is buried by ground sloping up away from them,
    // which made that effect invisible in play while its geometry tests all passed.
    depthTest: false,
  })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.rotation.x = SECTOR_FLAT_ROTATION_X
  fill.userData.excludeFromShadows = true

  // A unit arc scaled at runtime, so travelling costs a scale rather than a geometry rebuild sixty
  // times a second.
  const arcGeometry = sectorGeometry(shape.halfAngle, 1 - ARC_THICKNESS, 1)
  const arcMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
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
    const reach = MathUtils.lerp(ARC_START_FRACTION, 1, t) * shape.range
    // Never exactly zero: a zero scale collapses the matrix. `ARC_START_FRACTION` already keeps it
    // well clear, and the floor is here so that a retune of that constant to zero cannot
    // reintroduce the problem silently.
    arc.scale.setScalar(Math.max(reach, 1e-4))
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
