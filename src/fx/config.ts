/**
 * Tuning for the effects that are felt rather than seen.
 *
 * Separate from `mapping.ts`, which is pure functions over a handful of named
 * constants — dropping tables of tuning values into it would blur what that module
 * is for.
 *
 * Every value here is a guess about feel, which no test can check. The point of
 * naming them is that they are in one place and tunable, not that they are right.
 */
export interface HitstopConfig {
  /** A staff finisher connecting. */
  finisherSeconds: number
  /** An enemy going down. The loudest event in the fight. */
  downSeconds: number
  /** A minimum-strength Pressure Wave. */
  slamMinSeconds: number
  /** A full committed dive. The heaviest thing in the game. */
  slamMaxSeconds: number
}

export const DEFAULT_HITSTOP_CONFIG: HitstopConfig = {
  // Three frames at 60Hz: enough to register, short enough not to read as a stutter.
  finisherSeconds: 0.05,
  downSeconds: 0.07,
  slamMinSeconds: 0.04,
  slamMaxSeconds: 0.09,
}
