import {
  BoxGeometry, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import type { Effect } from './effect'

/**
 * The plume a Fire Thrust leaves, drawn opposite the push.
 *
 * The one effect in the game whose whole job is to say a *resource* was spent rather than that
 * something was hit. A thrust produces no damage, no burst on a body and no sound of contact, so
 * without this the player's only feedback that a charge went is one pip going out in the corner of
 * the HUD — and the move exists to be pressed in an emergency, which is exactly when nobody is
 * looking at the HUD.
 *
 * **It points backwards, and that is the whole readability decision.** Fire leaves the wing in the
 * direction opposite the acceleration, so the plume is the impulse mirrored: a thrust that climbs
 * draws a flame going down and behind. That is also what separates it at a glance from the burst,
 * which throws its cone *forward* — the same outward-versus-inward vocabulary `water-reach.ts`
 * borrows from `vortex-ring.ts`, applied to the two verbs of one element instead of to two elements.
 *
 * Its length comes from the impulse it is drawn for rather than from a constant, so retuning
 * `thrustUpSpeed` or `thrustForwardSpeed` moves the tell with the move. The other candidate was a
 * fixed length, and it would have quietly stopped describing the thrust the first time either number
 * changed.
 *
 * Aimed in full 3D, unlike every cone in `src/fx/`, and the difference is not an oversight: those
 * are drawings of flattened hit volumes and have to be flattened to stay honest, and this is a
 * drawing of a vector that genuinely has a vertical component. Flattening it would draw a horizontal
 * flame for a move whose main axis is up.
 *
 * `MeshBasicMaterial` and nothing else, for the reason `fire-burst.ts` sets out at length: a
 * `ShaderMaterial` including the `..._pars_fragment` chunks the renderer already injects fails to
 * compile nearly silently and the mesh then does not draw at all, which reads as a tastefully
 * transparent effect rather than as a broken one.
 */

/** Short: a thrust is one shove, not a sustained burn. Under the burst cone's own 0.16. */
const LIFETIME = 0.14
/**
 * How much of the impulse's travel the plume is drawn along, in seconds.
 *
 * The flame is as long as the distance the push carries the glider in this much time, which at the
 * shipped impulse of 10.8 m/s is about 1.3 m — around two thirds of the character's 1.8 height, so
 * it reads as a jet off the wing rather than as a beam.
 */
const PLUME_SECONDS = 0.12
/** Off the feet, at roughly the height the wing is carried. Matches the ice shell's centre. */
const HEIGHT = 0.95
/** Cross-section, tapering to nothing over the life. Narrower than the dash trail's 0.45 slab. */
const WIDTH = 0.34
const THICKNESS = 0.34
/** The burst's core white-orange, so the two verbs of one element share a colour. */
const TINT = 0xffd9a0
const PEAK_OPACITY = 0.85

/**
 * The plume's length for a given impulse.
 *
 * Exported so a test can hold the drawn length to the shipped `FireConfig` through
 * `fireThrustImpulse`, rather than checking this formula against itself.
 */
export function plumeLength(impulse: Vector3): number {
  return impulse.length() * PLUME_SECONDS
}

export function createFireThrust(origin: Vector3, impulse: Vector3): Effect {
  const length = plumeLength(impulse)

  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  // Aimed *against* the impulse, so the group's +Z is where the fire goes. A zero or non-finite
  // impulse leaves the group unrotated rather than throwing or producing a NaN matrix: nothing in
  // the game can hand one over — `fireThrustImpulse` always carries `thrustUpSpeed` — but a plume
  // pointing along +Z is a visible wrong answer where a corrupted matrix is an invisible one.
  const exhaust = impulse.clone().negate()
  if (exhaust.lengthSq() > 1e-8 && Number.isFinite(exhaust.lengthSq())) {
    group.lookAt(group.position.clone().add(exhaust.normalize()))
  }

  // A unit-length slab along +Z, scaled to the plume length — the same shape `dash-trail.ts` uses,
  // so the streak can be stretched without rebuilding geometry and a test can read the length off
  // the scale.
  const geometry = new BoxGeometry(WIDTH, THICKNESS, 1)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false, opacity: PEAK_OPACITY,
    // Drawn over the world, for the same reason the dash trail and every cone here are: a thrust
    // fired close to a cliff face would otherwise be swallowed by the rock at exactly the moment
    // the player most needs to know the charge went.
    depthTest: false,
  })
  const plume = new Mesh(geometry, material)
  plume.userData.excludeFromShadows = true
  group.add(plume)

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    // Stretches as it fades and thins as it stretches, which is what an exhaust plume does. Never
    // exactly zero on any axis: a zero scale collapses the matrix.
    const stretch = MathUtils.lerp(1, 1.6, t)
    plume.scale.set(
      Math.max(MathUtils.lerp(1, 0.2, t), 1e-4), Math.max(MathUtils.lerp(1, 0.2, t), 1e-4),
      Math.max(length * stretch, 1e-4),
    )
    // Pushed forward by half its length so it starts at the wing rather than straddling it, the
    // same offset `dash-trail.ts` applies, recomputed because the length grows.
    plume.position.z = (length * stretch) / 2
    material.opacity = PEAK_OPACITY * (1 - t)
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
      geometry.dispose()
      material.dispose()
    },
  }
}
