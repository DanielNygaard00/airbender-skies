import { MathUtils, Vector3 } from 'three'
import type { ShakeConfig } from './config'

/**
 * Frequencies in radians per second, deliberately different per axis.
 *
 * One frequency for both axes makes the offset oscillate along a single diagonal,
 * which reads as the camera sliding rather than shaking. These give roughly five and
 * seven cycles across a 0.2 second kick.
 */
const FREQ_X = 160
const FREQ_Y = 215

/**
 * A decaying camera kick.
 *
 * Trigonometric rather than random on purpose. A random offset cannot be asserted
 * about, and this project already keeps `src/core/rng.ts` because unrepeatable
 * randomness has been a problem here before. At 60Hz a decaying sine pair is
 * indistinguishable from noise, and it is testable.
 */
export interface ShakeState {
  remaining: number
  /** Held so the decay can be expressed as a fraction of the original length. */
  duration: number
  amplitude: number
}

export function noShake(): ShakeState {
  return { remaining: 0, duration: 0, amplitude: 0 }
}

/**
 * Strongest wins, for the same reason `triggerHitstop`'s longest wins: a real hit
 * fires several of these on one frame, and adding them would put the camera through
 * the floor.
 */
export function triggerShake(
  state: ShakeState, amplitude: number, seconds: number,
): ShakeState {
  if (!Number.isFinite(amplitude) || !Number.isFinite(seconds)) return state
  if (amplitude <= 0 || seconds <= 0) return state
  // A weaker kick never interrupts a stronger one already running, but it does start
  // one when nothing is running.
  if (state.remaining > 0 && amplitude <= state.amplitude) return state
  return { remaining: seconds, duration: seconds, amplitude }
}

/** Resets to exactly `noShake()` when spent, so `shakeOffset` returns a true zero. */
export function stepShake(state: ShakeState, dt: number): ShakeState {
  if (!Number.isFinite(dt)) return state
  const remaining = Math.max(0, state.remaining - dt)
  return remaining > 0 ? { ...state, remaining } : noShake()
}

/**
 * The offset to add to the camera this frame, written into `out`.
 *
 * Writes into a caller-owned vector rather than allocating: this runs once per
 * rendered frame, which is the one place in the project where a per-frame allocation
 * is worth avoiding.
 */
export function shakeOffset(state: ShakeState, out: Vector3): Vector3 {
  if (state.remaining <= 0 || state.duration <= 0) return out.set(0, 0, 0)
  const elapsed = state.duration - state.remaining
  const scaled = state.amplitude * (state.remaining / state.duration)
  // Each axis independently swings up to `scaled`, so the vector they form can reach
  // `scaled * sqrt(2)` when both peak together. Dividing by that same factor caps the
  // *vector's* length at `scaled` (and so at `amplitude`), which is the contract
  // `shakeOffset` is actually tested against — a per-axis bound isn't enough.
  const perAxis = scaled / Math.SQRT2
  return out.set(
    Math.sin(elapsed * FREQ_X) * perAxis,
    Math.sin(elapsed * FREQ_Y) * perAxis,
    0,
  )
}

/** How hard a slam shakes, from the same 0-to-1 strength its damage reads. */
export function slamShakeAmplitude(strength: number, c: ShakeConfig): number {
  return MathUtils.lerp(
    c.slamMinAmplitude, c.slamMaxAmplitude, MathUtils.clamp(strength, 0, 1),
  )
}
