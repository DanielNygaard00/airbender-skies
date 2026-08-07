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

export interface ShakeConfig {
  /** A minimum-strength Pressure Wave. */
  slamMinAmplitude: number
  /** A full committed dive. */
  slamMaxAmplitude: number
  slamSeconds: number
  downAmplitude: number
  downSeconds: number
  /** Above a down: the player's own damage is what they most need to notice. */
  hurtAmplitude: number
  hurtSeconds: number
}

/**
 * How fast the hurt flash fades, in units of full-strength-per-second.
 *
 * A quarter-second flash, long enough to catch peripherally, short enough not to obscure
 * the fight. Here rather than in `main.ts`, where it started, so that every value in this
 * feel pass really is visible in a config file — the promise HANDOFF.md makes.
 */
export const HURT_FLASH_DECAY_PER_SECOND = 4

/**
 * How fast the dash's FOV kick fades, in units of full-strength-per-second.
 *
 * `stepPulse` decays linearly, so this is `1 / lifetimeSeconds`: a 0.22 s kick, same as
 * before `dashDurationSeconds` was deleted from `GroundConfig`. That config value never
 * drove the dash simulation itself -- `easeHorizontal` bleeds the dash impulse off
 * exponentially at `groundResponse` instead, which is a different curve entirely -- but
 * this kick is a cosmetic camera flourish with no such obligation, and 0.22 s already
 * played fine, so there was no reason to also change how long it lasts. Named and kept
 * here, independent of `GroundConfig`, rather than reusing `groundResponse` and pretending
 * a linear pulse and an exponential decay are "the same quantity expressed directly" --
 * they are not: at `groundResponse` 7 that reads as 1/7 s, a 35% shorter kick, and it would
 * end while 37% of the dash's own burst was still live.
 */
export const DASH_KICK_DECAY_PER_SECOND = 1 / 0.22

export const DEFAULT_SHAKE_CONFIG: ShakeConfig = {
  slamMinAmplitude: 0.15,
  slamMaxAmplitude: 0.35,
  slamSeconds: 0.25,
  // Present but not disruptive: downs come in threes.
  downAmplitude: 0.18,
  downSeconds: 0.18,
  hurtAmplitude: 0.22,
  hurtSeconds: 0.2,
}

export interface AimTellConfig {
  /** How far ahead of the player the direction marker sits, in metres. */
  markerDistance: number
  markerSize: number
  /** Peak opacity of the cone preview. */
  previewOpacity: number
  /** Multiplies the preview's opacity while the gust is on cooldown. */
  dimmedFactor: number
}

/**
 * The aim tell.
 *
 * `markerDistance` is well inside the gust's 12-unit reach so the marker reads as "you are
 * pointing this way" rather than as a range indicator. `previewOpacity` is under half of
 * `gust-cone.ts`'s 0.34 fill, because a permanent indicator as loud as the move it previews
 * would swamp the move.
 */
export const DEFAULT_AIM_TELL_CONFIG: AimTellConfig = {
  markerDistance: 3,
  markerSize: 0.55,
  previewOpacity: 0.14,
  dimmedFactor: 0.4,
}
