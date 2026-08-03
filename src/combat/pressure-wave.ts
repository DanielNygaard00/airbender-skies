import { MathUtils, Vector3 } from 'three'
import { horizontalDistance, type Enemy } from './enemy'

/**
 * Pressure Wave: a ground slam out of a fall, scaled by the impact.
 *
 * The design document calls this a direct payoff for the traversal layer, and that is
 * the whole shape of it — height earned in the flight model turns into combat value.
 * It is the one move in the kit with real damage, and the only one with no facing: a
 * slam goes out in every direction, so there is no cone test here.
 *
 * Whether a slam happened at all is not this module's business. That is decided in
 * `src/player/slam.ts`, which is why a strength of 0 here means a legitimate minimum
 * slam rather than the absence of one.
 */
export interface PressureWaveConfig {
  /** Downward speed at impact below which a landing is just a landing. */
  minImpactSpeed: number
  /** Downward speed at which the slam is at full strength. */
  fullImpactSpeed: number
  minRadius: number
  maxRadius: number
  minDamage: number
  maxDamage: number
  minKnockback: number
  maxKnockback: number
  /** Upward bounce as a fraction of the impact speed. */
  bounceFactor: number
}

/** 0 at the minimum impact, 1 at full. Clamped at both ends. */
export function slamStrength(impactSpeed: number, c: PressureWaveConfig): number {
  const span = c.fullImpactSpeed - c.minImpactSpeed
  // A degenerate span would divide by zero; treat the threshold as a step instead.
  if (!(span > 0)) return impactSpeed >= c.minImpactSpeed ? 1 : 0
  return MathUtils.clamp((impactSpeed - c.minImpactSpeed) / span, 0, 1)
}

export function waveRadius(strength: number, c: PressureWaveConfig): number {
  return MathUtils.lerp(c.minRadius, c.maxRadius, MathUtils.clamp(strength, 0, 1))
}

export function waveDamage(strength: number, c: PressureWaveConfig): number {
  return MathUtils.lerp(c.minDamage, c.maxDamage, MathUtils.clamp(strength, 0, 1))
}

/**
 * Everyone caught in one slam. Named so callers cannot forget the radius test.
 *
 * Horizontal distance only, matching how the gust measures its reach: the fight is a
 * ground fight, and an enemy is where they stand rather than where their head is.
 */
export function waveTargets(
  origin: Vector3,
  enemies: readonly Enemy[],
  strength: number,
  c: PressureWaveConfig,
): Enemy[] {
  const radius = waveRadius(strength, c)
  return enemies.filter((enemy) => horizontalDistance(origin, enemy.position) <= radius)
}

/**
 * The push a slam puts on a target: outward and up.
 *
 * Lifts harder than a gust does, because the air here is going up past the player
 * rather than out from their hands — and the lift is what lets a slam clear a ledge.
 */
export function waveImpulse(
  origin: Vector3,
  target: Vector3,
  strength: number,
  c: PressureWaveConfig,
): Vector3 {
  const away = new Vector3(target.x - origin.x, 0, target.z - origin.z)
  const direction = away.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : away.normalize()
  const push = MathUtils.lerp(c.minKnockback, c.maxKnockback, MathUtils.clamp(strength, 0, 1))
  return direction.multiplyScalar(push).setY(push * 0.4)
}
