import { MathUtils } from 'three'

/** How long the fan takes to travel from fully stowed to fully deployed. */
export const OPEN_SECONDS = 0.3
export const PANELS_PER_SIDE = 4
export const FAN_SPREAD = MathUtils.degToRad(78)

/**
 * Move `openness` toward its target at a constant rate, clamped to [0, 1].
 * Guarding non-finite input matters: a stalled frame or a corrupted delta would
 * otherwise drive the fan angles to NaN and corrupt every mesh transform.
 */
export function advanceOpenness(
  current: number, deployed: boolean, dt: number, seconds: number,
): number {
  if (!Number.isFinite(current) || !Number.isFinite(dt) || dt <= 0) {
    return MathUtils.clamp(Number.isFinite(current) ? current : 0, 0, 1)
  }
  const target = deployed ? 1 : 0
  const next = current + Math.sign(target - current) * (dt / seconds)
  return target > current
    ? MathUtils.clamp(Math.min(next, target), 0, 1)
    : MathUtils.clamp(Math.max(next, target), 0, 1)
}

/** Smoothstep, so the fan eases in and out rather than moving mechanically. */
export function easeOpenness(openness: number): number {
  const t = MathUtils.clamp(openness, 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Where fan leaf `index` sits, as an angle from the staff. All leaves collapse to
 * zero when closed, which is what makes them stack into a stick.
 */
export function panelAngle(
  index: number, count: number, openness: number, spread: number,
): number {
  if (count <= 1) return 0
  return easeOpenness(openness) * spread * (index / (count - 1))
}
