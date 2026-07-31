import { Vector3, MathUtils } from 'three'
import type { FlightConfig } from '../core/types'

const WORLD_UP = new Vector3(0, 1, 0)

/**
 * Angular speed the kite can turn at. Slow flight turns tight, fast flight
 * turns wide, which is where the sense of the kite having weight comes from.
 */
export function turnRateFor(speed: number, bankInput: number, c: FlightConfig): number {
  const speedFactor = MathUtils.clamp(c.turnRateSpeedRef / Math.max(speed, 1), 0.25, 1.5)
  return c.baseTurnRate * speedFactor + Math.abs(bankInput) * c.bankTurnRate
}

/**
 * Yaw produced by shifting weight, independent of where the player is looking.
 *
 * This is what a hang glider actually steers with, and it was missing. Bank only
 * scaled how fast the glider chased the look direction, so holding a roll while
 * keeping the mouse still turned the glider not at all. Rolling now turns you on
 * its own, and looking trims the result.
 *
 * The rotation is about world up rather than the glider's own up, so a banked
 * glider carves a flat turn instead of corkscrewing.
 */
export function weightShiftYaw(
  forward: Vector3,
  bankInput: number,
  dt: number,
  c: FlightConfig,
): Vector3 {
  const normalized = forward.clone().normalize()
  if (Math.abs(bankInput) < 1e-6) return normalized
  // Negated so banking right turns right: a positive rotation about world up is
  // anticlockwise seen from above, which would send a right bank left.
  const angle = -bankInput * c.weightShiftTurnRate * dt
  return normalized.applyAxisAngle(WORLD_UP, angle).normalize()
}

/**
 * Turn the glider: the look assist pulls the nose towards where the player is
 * looking, and then their weight shift turns it further.
 *
 * The order matters, and getting it wrong cancels the feature. Shifting first and
 * chasing afterwards means the chase snaps the nose straight back onto the look
 * direction — the deviation the shift just produced is exactly what the chase
 * removes, so with a still mouse the glider never turns at all. Shifting last
 * leaves the weight shift as the input that actually commands the heading.
 */
export function steerToward(
  current: Vector3,
  target: Vector3,
  speed: number,
  bankInput: number,
  dt: number,
  c: FlightConfig,
): Vector3 {
  return weightShiftYaw(chaseLook(current, target, speed, bankInput, dt, c), bankInput, dt, c)
}

/** Rotate `current` toward `target` by at most this step's allowed turn. */
function chaseLook(
  current: Vector3,
  target: Vector3,
  speed: number,
  bankInput: number,
  dt: number,
  c: FlightConfig,
): Vector3 {
  const from = current.clone().normalize()
  const to = target.clone().normalize()
  const angle = from.angleTo(to)
  if (angle < 1e-6) return to

  const maxStep = turnRateFor(speed, bankInput, c) * dt
  if (angle <= maxStep) return to

  let axis = new Vector3().crossVectors(from, to)
  if (axis.lengthSq() < 1e-12) {
    // Exactly opposite: the cross product gives no axis, so pick any perpendicular.
    axis = new Vector3().crossVectors(from, WORLD_UP)
    if (axis.lengthSq() < 1e-12) axis = new Vector3(1, 0, 0)
  }
  return from.applyAxisAngle(axis.normalize(), maxStep).normalize()
}
