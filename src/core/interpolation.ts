import { Vector3 } from 'three'

/**
 * Beyond this many metres in one simulation step, the move was a teleport
 * (a respawn), not travel — 20 m per step is 1200 m/s, far past anything the
 * flight model or the air blast dash can produce — and blending through it
 * would streak the visual across the map for a frame.
 */
export const DEFAULT_SNAP_DISTANCE = 20

/**
 * A previous/current pair of one simulation-stepped vector, sampled between
 * steps by the renderer. Rendered frames outnumber simulation steps on
 * high-refresh displays; this is what lets them differ.
 */
export interface InterpolatedVector {
  /** Roll current into previous and store the new current. Copies, never holds. */
  record(current: Vector3): void
  /** Write previous.lerp(current, alpha) into out; snaps when the step jumped. */
  sample(alpha: number, out: Vector3): Vector3
  /** Forget the previous value, so the next sample returns current unblended. */
  reset(): void
}

export function createInterpolatedVector(
  snapDistance = DEFAULT_SNAP_DISTANCE,
): InterpolatedVector {
  const previous = new Vector3()
  const current = new Vector3()
  let primed = false
  const snapSq = snapDistance * snapDistance
  return {
    record(value: Vector3): void {
      if (primed) {
        previous.copy(current)
      } else {
        // Seed both ends, so sampling never blends from the origin-zero a
        // fresh Vector3 starts at.
        previous.copy(value)
        primed = true
      }
      current.copy(value)
      // A jump past the snap distance is a teleport; collapsing the pair here
      // keeps sample() branch-free and allocation-free.
      if (previous.distanceToSquared(current) > snapSq) previous.copy(current)
    },
    sample(alpha: number, out: Vector3): Vector3 {
      return out.copy(previous).lerp(current, alpha)
    },
    reset(): void {
      previous.copy(current)
    },
  }
}

/**
 * Ease `current` toward `target` at `rate`, frame-rate independently, snapping when no time has
 * passed.
 *
 * The exponential form is what makes the easing behave the same on a 60 Hz display and a 144 Hz
 * one: a fixed per-frame fraction would converge faster the more frames it got, so the same move
 * would feel different on different hardware.
 *
 * The snap at `dt <= 0` is the part worth naming, because it is a defect that has already
 * shipped once. `main.ts` calls its `syncVisuals` a second time to prime the presentation layer
 * before the loop ever runs, with a frame time of exactly 0 — and `1 - Math.exp(-rate * 0)` is
 * exactly 0, so a value eased through it stays where it started however far away the target is.
 * For a quantity that begins settled, such as the avatar's lean toward a wall at spawn, that is
 * invisible. For one that can already be mid-transition when the first frame is drawn — the
 * rider's turn onto the air board — it means the primed frame shows a character standing square
 * on a board they are supposed to be riding sideways. A non-positive frame time is not a small
 * step toward the target; it is no step at all, and the settled value is the only honest answer.
 */
export function approach(current: number, target: number, rate: number, dt: number): number {
  if (!Number.isFinite(target)) return current
  if (!Number.isFinite(dt) || dt <= 0) return target
  if (!Number.isFinite(current)) return target
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}
