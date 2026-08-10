import { Vector3 } from 'three'
import { horizontalDistance } from './enemy'

/**
 * A horizontal cone: how far it reaches, how wide it opens either side of a heading, and
 * how far above or below the caster it still bites.
 *
 * Named separately from any one move because two of them share the shape — a gust sweeps a
 * long narrow one and a staff swing a short wide one — and a second copy of this test is a
 * second thing to keep in step.
 */
export interface ConeShape {
  range: number
  halfAngle: number
  /**
   * Half-height of the slab the cone sweeps. A target further above or below is out.
   *
   * Without it the reach is not a cone at all but an infinite vertical column with a
   * cone-shaped cross-section, which lets the player hit a soldier from an altitude the
   * soldier's own 3D ranges cannot answer from.
   */
  verticalReach: number
}

/**
 * Whether a target lies inside the cone.
 *
 * A slab, not a column: the sweep itself is flat — `forward` on foot is the flattened
 * camera direction, so a flat sector is what the player's aim already means — but the
 * target must also sit within `verticalReach` of the caster's own height.
 */
export function inCone(
  origin: Vector3, forward: Vector3, target: Vector3, c: ConeShape,
): boolean {
  // Cheapest rejection first, and the one that costs nothing: a target far overhead or far
  // below is out before any direction is computed.
  if (Math.abs(target.y - origin.y) > c.verticalReach) return false

  const distance = horizontalDistance(origin, target)
  // A target on top of the caster has no direction to compare, so it is out rather than
  // normalised into a NaN. Separate from the height test above: that one asks whether the
  // target is in the slab at all, this one whether there is a heading to measure against.
  if (distance > c.range || distance < 1e-6) return false

  const toTarget = new Vector3(target.x - origin.x, 0, target.z - origin.z).normalize()
  const heading = new Vector3(forward.x, 0, forward.z)
  if (heading.lengthSq() < 1e-8) return false

  return toTarget.dot(heading.normalize()) >= Math.cos(c.halfAngle)
}
