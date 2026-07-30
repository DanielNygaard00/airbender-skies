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

/** Rotate `current` toward `target` by at most this step's allowed turn. */
export function steerToward(
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
