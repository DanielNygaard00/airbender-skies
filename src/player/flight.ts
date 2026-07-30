import { Vector3, MathUtils } from 'three'
import type { FlightConfig } from '../core/types'

const WORLD_UP = new Vector3(0, 1, 0)
const FALLBACK_RIGHT = new Vector3(1, 0, 0)

/**
 * The kite's up axis: perpendicular to forward, rolled about forward by `bank`.
 *
 * Lift acts along this axis rather than along world up. Deriving it from a
 * cross product with velocity instead would degenerate whenever the kite moves
 * exactly where it points, and a fallback of world up in that case is not
 * perpendicular to velocity, which silently injects energy along the flight
 * path. This formulation has no degenerate case except forward being vertical,
 * which is handled explicitly.
 */
export function kiteUp(forward: Vector3, bank: number): Vector3 {
  let right = new Vector3().crossVectors(forward, WORLD_UP)
  if (right.lengthSq() < 1e-6) right = FALLBACK_RIGHT.clone()
  else right.normalize()
  const up = new Vector3().crossVectors(right, forward).normalize()
  return up.applyAxisAngle(forward, -bank)
}

/**
 * Signed angle between where the kite points and where it is moving.
 * Positive means the nose is above the flight path, which is what generates lift.
 */
export function angleOfAttack(forward: Vector3, velocity: Vector3, up: Vector3): number {
  if (velocity.lengthSq() < 1e-6) return 0
  const vdir = velocity.clone().normalize()
  const magnitude = Math.acos(MathUtils.clamp(forward.dot(vdir), -1, 1))
  // If velocity leans toward the kite's up axis, the nose is below the path.
  return up.dot(vdir) > 0 ? -magnitude : magnitude
}

export interface FlightInput {
  /** Where the kite points. Normalised. Produced by steering (Task 5). */
  forward: Vector3
  thrust: boolean
  flare: boolean
  /** Roll about the forward axis, radians. */
  bank: number
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
 * Integrate one step of kite flight. Pure: never mutates its arguments.
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
): FlightResult {
  const speed = velocity.length()
  const vdir = speed > 0.01 ? velocity.clone().normalize() : input.forward.clone()
  const up = kiteUp(input.forward, input.bank)

  const aoa = angleOfAttack(input.forward, velocity, up)
  const effectiveAoa = aoa + (input.flare ? c.flareAoaBoost : 0) + c.rigAoa

  // Lift falls off linearly below stall speed rather than cutting off abruptly.
  const stallFactor = speed < c.stallSpeed ? Math.max(0, speed / c.stallSpeed) : 1
  // Bound at a quarter turn, which is where sin(2·aoa) reaches zero: a kite held
  // broadside to the airflow makes pure drag and no lift. Any tighter bound would
  // make lift plateau near its peak instead of falling away, contradicting the
  // model above, and would leave near-peak lift pointing in a direction that is
  // ill-conditioned at exactly 90 degrees. This is a bound on the formula's
  // domain, not a tuning value.
  const clampedAoa = MathUtils.clamp(effectiveAoa, -Math.PI / 2, Math.PI / 2)
  const liftMag = c.liftCoeff * speed * speed * Math.sin(2 * clampedAoa) * stallFactor
  const dragMag =
    c.dragCoeff * speed * speed * (1 + c.inducedDragFactor * Math.sin(effectiveAoa) ** 2)

  // Lift acts perpendicular to velocity, in the plane containing the kite's up axis.
  let liftDir = up.clone().addScaledVector(vdir, -up.dot(vdir))
  if (liftDir.lengthSq() < 1e-8) {
    // up is parallel to velocity, so the projection gives no direction. The
    // fallback has two requirements. It MUST be perpendicular to velocity: a
    // component along the flight path would do work and inject energy, breaking
    // the invariant that gliding never gains height. And it must be related to
    // where the kite points, or lift gets applied in a direction with no bearing
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

  const nextVelocity = velocity.clone().addScaledVector(accel, dt)
  const nextPosition = position.clone().addScaledVector(nextVelocity, dt)
  return { position: nextPosition, velocity: nextVelocity }
}
