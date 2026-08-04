import { Vector3 } from 'three'
import { horizontalDistance } from './enemy'

/**
 * A horizontal cone: how far it reaches, and how wide it opens either side of a heading.
 *
 * Named separately from any one move because two of them share the shape — a gust sweeps a
 * long narrow one and a staff swing a short wide one — and a second copy of this test is a
 * second thing to keep in step.
 */
export interface ConeShape {
  range: number
  halfAngle: number
}

/** Whether a target lies inside the cone. Horizontal: height is ignored entirely. */
export function inCone(
  origin: Vector3, forward: Vector3, target: Vector3, c: ConeShape,
): boolean {
  const distance = horizontalDistance(origin, target)
  // A target on top of the caster has no direction to compare, so it is out rather than
  // normalised into a NaN.
  if (distance > c.range || distance < 1e-6) return false

  const toTarget = new Vector3(target.x - origin.x, 0, target.z - origin.z).normalize()
  const heading = new Vector3(forward.x, 0, forward.z)
  if (heading.lengthSq() < 1e-8) return false

  return toTarget.dot(heading.normalize()) >= Math.cos(c.halfAngle)
}
