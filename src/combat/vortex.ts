import { MathUtils, Vector3 } from 'three'
import { horizontalDistance, type Enemy } from './enemy'

/**
 * Vortex: charged, gathers a group inward and lifts them briefly.
 *
 * The design doc calls it "setup, not damage", so there is no damage parameter to set
 * — the move cannot quietly become a damage tool through config drift. Its whole value
 * is that a lifted enemy is inert, which is enforced in `stepEnemy`, not here.
 *
 * Radial with no facing test, like the Pressure Wave: a vortex is a place rather than
 * a direction. That is the deliberate contrast with a gust, which sweeps a cone.
 */
export interface VortexConfig {
  maxChargeSeconds: number
  /** Below this, a release cancels: no pull, and the cooldown is not spent. */
  minChargeSeconds: number
  minRadius: number
  maxRadius: number
  minPullSpeed: number
  maxPullSpeed: number
  minLiftSpeed: number
  maxLiftSpeed: number
  cooldownSeconds: number
}

/** How far a held charge has come, 0 to 1. */
export function vortexCharge(heldSeconds: number, c: VortexConfig): number {
  if (!(c.maxChargeSeconds > 0)) return 0
  return MathUtils.clamp(heldSeconds / c.maxChargeSeconds, 0, 1)
}

export function vortexRadius(charge: number, c: VortexConfig): number {
  return MathUtils.lerp(c.minRadius, c.maxRadius, MathUtils.clamp(charge, 0, 1))
}

/** Everyone caught, named so a caller cannot forget the radius. */
export function vortexTargets(
  origin: Vector3, enemies: readonly Enemy[], charge: number, c: VortexConfig,
): Enemy[] {
  const radius = vortexRadius(charge, c)
  return enemies.filter((enemy) => horizontalDistance(origin, enemy.position) <= radius)
}

/** Inward pull plus lift. */
export function vortexImpulse(
  origin: Vector3, target: Vector3, charge: number, c: VortexConfig,
): Vector3 {
  const t = MathUtils.clamp(charge, 0, 1)
  const inward = new Vector3(origin.x - target.x, 0, origin.z - target.z)
  // Standing on the caster leaves the direction undefined: lift, and do not divide.
  const direction = inward.lengthSq() < 1e-8 ? new Vector3() : inward.normalize()
  return direction
    .multiplyScalar(MathUtils.lerp(c.minPullSpeed, c.maxPullSpeed, t))
    .setY(MathUtils.lerp(c.minLiftSpeed, c.maxLiftSpeed, t))
}
