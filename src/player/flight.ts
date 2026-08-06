import { Vector3, MathUtils } from 'three'
import type { FlightConfig } from '../core/types'
import { stillAir, type WindSample } from '../world/wind'

const WORLD_UP = new Vector3(0, 1, 0)
const FALLBACK_RIGHT = new Vector3(1, 0, 0)

/**
 * The glider's up axis: perpendicular to forward, rolled about forward by `bank`.
 *
 * Lift acts along this axis rather than along world up. Deriving it from a
 * cross product with velocity instead would degenerate whenever the glider moves
 * exactly where it points, and a fallback of world up in that case is not
 * perpendicular to velocity, which silently injects energy along the flight
 * path. This formulation has no degenerate case except forward being vertical,
 * which is handled explicitly.
 */
export function gliderUp(forward: Vector3, bank: number): Vector3 {
  let right = new Vector3().crossVectors(forward, WORLD_UP)
  if (right.lengthSq() < 1e-6) right = FALLBACK_RIGHT.clone()
  else right.normalize()
  const up = new Vector3().crossVectors(right, forward).normalize()
  return up.applyAxisAngle(forward, -bank)
}

/**
 * The glider's right axis: the third leg of the frame `gliderUp` builds.
 *
 * Derived from `gliderUp` rather than recomputed from a world-up cross, and the
 * difference matters. `cross(forward, WORLD_UP)` is horizontal for every heading, so a
 * dodge along it would be flat however far the glider was rolled. Rolling the up axis
 * and taking the cross against forward carries the bank through, and it inherits
 * `gliderUp`'s handling of a vertical heading rather than needing its own.
 */
export function gliderRight(forward: Vector3, bank: number): Vector3 {
  return new Vector3().crossVectors(gliderUp(forward, bank), forward).normalize()
}

/**
 * Signed angle between where the glider points and where it is moving.
 * Positive means the nose is above the flight path, which is what generates lift.
 */
export function angleOfAttack(forward: Vector3, velocity: Vector3, up: Vector3): number {
  if (velocity.lengthSq() < 1e-6) return 0
  const vdir = velocity.clone().normalize()
  const magnitude = Math.acos(MathUtils.clamp(forward.dot(vdir), -1, 1))
  // If velocity leans toward the glider's up axis, the nose is below the path.
  return up.dot(vdir) > 0 ? -magnitude : magnitude
}

export interface FlightInput {
  /** Where the glider points. Normalised. Produced by steering (Task 5). */
  forward: Vector3
  thrust: boolean
  flare: boolean
  /** Roll about the forward axis, radians. */
  bank: number
  /** Bending air downward to hold station, rather than only to go faster. */
  hover: boolean
  /** Wings folded: trades lift away for a fast, clean dive. */
  tuck: boolean
}

/**
 * Airbending downward hard enough to hold the glider up, and to stop it.
 *
 * This is what separates a bender from anyone else on the same staff: a plain
 * glider can only trade altitude for distance, so it must keep moving to keep
 * flying. Cancelling gravity lets the glider hold altitude with no updraft, and
 * bleeding the airspeed lets it stop dead rather than merely stop sinking.
 *
 * Deliberately not clamped to only oppose descent: bending against an upward
 * velocity too is what makes a hover settle rather than balloon.
 */
export function hoverAccel(velocity: Vector3, c: FlightConfig): Vector3 {
  return new Vector3(0, c.gravity, 0).addScaledVector(velocity, -c.hoverDamping)
}

/**
 * How much lift the wing still makes at this airspeed: 0 at rest, 1 at or above stall speed.
 *
 * Lift falls off linearly below stall speed rather than cutting off abruptly.
 *
 * Exported, and used by `flightStep` below, because `stallSeverity` in `./stall` is the
 * arithmetic complement of this value: the stall warning must not hold a second,
 * differently-shaped opinion about where a stall begins, or the airspeed readout can redden
 * and the wings shudder while the wing is still making most of its lift. One formula in one
 * place means retuning the ramp here retunes the warning with it, and the two cannot diverge.
 *
 * A non-finite speed falls through to 1, the same as a fast one: this is the integrator's
 * hot path, and callers that care about corrupt input guard it themselves.
 */
export function stallFactor(speed: number, c: FlightConfig): number {
  return speed < c.stallSpeed ? Math.max(0, speed / c.stallSpeed) : 1
}

export interface FlightResult {
  position: Vector3
  velocity: Vector3
}

/** Specific energy: potential plus kinetic, per unit mass. */
export function totalEnergy(position: Vector3, velocity: Vector3, gravity: number): number {
  return gravity * position.y + 0.5 * velocity.lengthSq()
}

/**
 * Integrate one step of glider flight. Pure: never mutates its arguments.
 *
 * Lift uses sin(2·aoa) rather than cos(aoa) so that lift peaks near 45 degrees
 * and falls away past it, which is what makes stalling emerge from the geometry
 * instead of needing a special case.
 */
export function flightStep(
  position: Vector3,
  velocity: Vector3,
  input: FlightInput,
  dt: number,
  c: FlightConfig,
  wind: WindSample = stillAir(),
): FlightResult {
  const speed = velocity.length()
  const vdir = speed > 0.01 ? velocity.clone().normalize() : input.forward.clone()
  const up = gliderUp(input.forward, input.bank)

  const aoa = angleOfAttack(input.forward, velocity, up)
  const effectiveAoa = aoa + (input.flare ? c.flareAoaBoost : 0) + c.rigAoa

  const stall = stallFactor(speed, c)
  // Bound at a quarter turn, which is where sin(2·aoa) reaches zero: a glider held
  // broadside to the airflow makes pure drag and no lift. Any tighter bound would
  // make lift plateau near its peak instead of falling away, contradicting the
  // model above, and would leave near-peak lift pointing in a direction that is
  // ill-conditioned at exactly 90 degrees. This is a bound on the formula's
  // domain, not a tuning value.
  const clampedAoa = MathUtils.clamp(effectiveAoa, -Math.PI / 2, Math.PI / 2)
  // Folding the wings throws away nearly all the lift and sheds drag with it, so a
  // tuck is a fast clean dive rather than just a nose-down glide. Both factors are
  // 1 when not tucked, so the untucked flight model is untouched.
  const liftFold = input.tuck ? c.tuckLiftFactor : 1
  const dragFold = input.tuck ? c.tuckDragFactor : 1
  // Dead air drives wind.liftScale to zero, which is what forces breath-only
  // flying rather than merely making the wing less efficient.
  const liftMag =
    c.liftCoeff * speed * speed * Math.sin(2 * clampedAoa) * stall * liftFold * wind.liftScale
  const dragMag =
    c.dragCoeff * speed * speed * (1 + c.inducedDragFactor * Math.sin(effectiveAoa) ** 2) * dragFold

  // Lift acts perpendicular to velocity, in the plane containing the glider's up axis.
  let liftDir = up.clone().addScaledVector(vdir, -up.dot(vdir))
  if (liftDir.lengthSq() < 1e-8) {
    // up is parallel to velocity, so the projection gives no direction. The
    // fallback has two requirements. It MUST be perpendicular to velocity: a
    // component along the flight path would do work and inject energy, breaking
    // the invariant that gliding never gains height. And it must be related to
    // where the glider points, or lift gets applied in a direction with no bearing
    // on the player's heading — which is how deploying out of a vertical fall
    // used to glide backwards. Projecting forward off the velocity direction
    // satisfies both; the world-axis crosses are only a last resort for when
    // forward is itself parallel to velocity.
    liftDir = input.forward.clone().addScaledVector(vdir, -input.forward.dot(vdir))
    if (liftDir.lengthSq() < 1e-8) liftDir = new Vector3().crossVectors(vdir, WORLD_UP)
    if (liftDir.lengthSq() < 1e-8) liftDir = new Vector3().crossVectors(vdir, FALLBACK_RIGHT)
  }
  liftDir.normalize()

  const accel = new Vector3(0, -c.gravity, 0)
  accel.addScaledVector(liftDir, liftMag)
  accel.addScaledVector(vdir, -dragMag)
  if (input.thrust) accel.addScaledVector(input.forward, c.thrustAccel)
  if (input.hover) accel.add(hoverAccel(velocity, c))
  // The air itself: thermals, ridge lift, rivers and downdrafts.
  accel.add(wind.accel)

  const nextVelocity = velocity.clone().addScaledVector(accel, dt)
  const nextPosition = position.clone().addScaledVector(nextVelocity, dt)
  return { position: nextPosition, velocity: nextVelocity }
}
