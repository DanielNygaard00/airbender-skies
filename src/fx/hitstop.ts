import { MathUtils } from 'three'
import type { HitstopConfig } from './config'

/**
 * The freeze that gives a heavy hit weight.
 *
 * A module rather than two lines in `main.ts` because of one rule: the longest
 * freeze wins, and freezes never add. Any real hit produces several triggers on one
 * frame — a finisher that downs a soldier is two, a slam into three soldiers is four
 * — and the difference between longest-wins and additive is invisible until it
 * happens in play, at which point a good hit reads as the game hanging.
 */
export interface HitstopState {
  /** Seconds of simulation still to skip. */
  remaining: number
}

export function noHitstop(): HitstopState {
  return { remaining: 0 }
}

export function isFrozen(state: HitstopState): boolean {
  return state.remaining > 0
}

/** Longest wins. A shorter request never shortens a freeze already running. */
export function triggerHitstop(state: HitstopState, seconds: number): HitstopState {
  if (!Number.isFinite(seconds) || seconds <= 0) return state
  return { remaining: Math.max(state.remaining, seconds) }
}

/**
 * Clamped at zero rather than allowed negative: a negative remaining reads as frozen
 * under any `!== 0` test and drifts further from zero every frame it is stepped.
 */
export function stepHitstop(state: HitstopState, dt: number): HitstopState {
  if (!Number.isFinite(dt)) return state
  return { remaining: Math.max(0, state.remaining - dt) }
}

/** How long a slam freezes for, from the same 0-to-1 strength its damage reads. */
export function slamHitstopSeconds(strength: number, c: HitstopConfig): number {
  return MathUtils.lerp(
    c.slamMinSeconds, c.slamMaxSeconds, MathUtils.clamp(strength, 0, 1),
  )
}
