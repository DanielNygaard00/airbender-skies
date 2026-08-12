import { MathUtils } from 'three'

/** Airspeed at which speed effects reach full strength. */
export const FX_SPEED_REFERENCE = 55
export const BASE_FOV = 70
export const MAX_FOV_KICK = 14
export const TRAIL_SPEED_THRESHOLD = 30

/** 0 at rest, 1 at the reference speed. Drives every speed-reactive effect. */
export function speedIntensity(airspeed: number): number {
  return MathUtils.clamp(airspeed / FX_SPEED_REFERENCE, 0, 1)
}

/**
 * Field of view at a given airspeed.
 *
 * `scale` is the reduce-motion `speedFov` scalar. It multiplies the kick and never
 * `BASE_FOV`, so scale 0 would leave the camera at 70 degrees rather than collapsing it to
 * nothing, and the shipped default of 1 keeps this module correct read on its own.
 */
export function fovForSpeed(airspeed: number, scale = 1): number {
  return BASE_FOV + MAX_FOV_KICK * speedIntensity(airspeed) * scale
}

export function windVolumeForSpeed(airspeed: number): number {
  // Squared so slow flight stays quiet and only fast flight gets loud.
  return speedIntensity(airspeed) ** 2
}

export function windPitchForSpeed(airspeed: number): number {
  return 0.7 + 0.8 * speedIntensity(airspeed)
}

export function trailOpacityForSpeed(airspeed: number): number {
  if (airspeed <= TRAIL_SPEED_THRESHOLD) return 0
  return MathUtils.clamp(
    (airspeed - TRAIL_SPEED_THRESHOLD) / (FX_SPEED_REFERENCE - TRAIL_SPEED_THRESHOLD),
    0, 1,
  )
}

/**
 * Degrees of extra field of view at the peak of a dash.
 *
 * Well under `MAX_FOV_KICK`'s 14 for full glider speed: a dash should read as a
 * burst, not as flight. On foot the field of view is otherwise pinned at
 * `fovForSpeed(0)`, which is why a 26 m/s dash has no visual weight today.
 */
export const MAX_DASH_FOV_KICK = 6

/** Additive on top of `fovForSpeed`, so a dash on landing does not fight it. */
export function fovKickForDash(pulse: number): number {
  if (!Number.isFinite(pulse)) return 0
  return MAX_DASH_FOV_KICK * MathUtils.clamp(pulse, 0, 1)
}

/**
 * Peak gain per combat voice.
 *
 * Held here rather than in `combat-audio.ts` so the mix is testable: the WebAudio
 * graph cannot be exercised in the node test environment, but the relative levels are
 * the part that can actually be wrong.
 */
export const COMBAT_LEVELS = {
  gust: 0.22,
  swing: 0.18,
  finisher: 0.26,
  impact: 0.3,
  down: 0.36,
  hurt: 0.4,
  /** An archer loosing. Louder than a staff swing, since it is a warning; below hurt. */
  bowRelease: 0.24,
  /**
   * A blow bouncing off plate.
   *
   * Deliberately equal to `impact` rather than below it. The instinct is to make a move that
   * did nothing quieter than one that connected, and it is wrong here: quiet reads as "barely
   * hit", and the one thing the player must not conclude from a gust on a heavy is that it
   * hit a little. A deflect has to be as loud as a connect and *unmistakably a different
   * sound*, so the whole difference is carried by timbre — `combat-audio.ts` plays this as a
   * short, high, bright snap where `impact` is a low thud.
   *
   * Tied to `impact` by a test rather than by sharing the literal, because the two are the
   * same number for a reason and should move together if the mix is ever rebalanced.
   */
  clang: 0.3,
} as const

export function swingLevel(finisher: boolean): number {
  return finisher ? COMBAT_LEVELS.finisher : COMBAT_LEVELS.swing
}

/**
 * The loudest a bow release may be, however many archers loose on one frame.
 *
 * Under the 0.5 every voice in `COMBAT_LEVELS` is held to, with a little margin, because
 * this is the only voice whose level is not a constant.
 */
export const BOW_RELEASE_CEILING = 0.48

/**
 * Gain for every release that happened on one frame, played as a single burst.
 *
 * A count rather than one call per arrow, and this is the whole reason the function
 * exists. Every other voice fires once per frame regardless of how many events fed it;
 * the bow release used to fire once per arrow, and each call builds a fresh chain into a
 * master at gain 1. Two arrows on one frame therefore produced two bit-identical bursts
 * starting at the same `currentTime`, which sum coherently rather than blending: 2 × 0.24
 * = 0.48 against the 0.5 ceiling, and a third clipped outright. Two equidistant archers
 * on the shipped patrol phase-lock on their identical cycle and do this repeatedly.
 *
 * Growth is by the square root of the count, the way uncorrelated sources add, so a
 * volley reads as bigger than one shot without the level being a straight multiple of
 * it. Hard-capped on top, so the number of archers on screen can never clip the mix.
 */
export function bowReleaseLevel(count: number): number {
  if (!Number.isFinite(count) || count < 1) return 0
  return Math.min(BOW_RELEASE_CEILING, COMBAT_LEVELS.bowRelease * Math.sqrt(count))
}

export function swingSeconds(finisher: boolean): number {
  return finisher ? 0.26 : 0.16
}
