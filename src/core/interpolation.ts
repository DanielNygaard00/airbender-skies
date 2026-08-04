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
