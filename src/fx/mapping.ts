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
  /**
   * Raised from 0.4 to 0.47 when the Ice Lock landed, and the reasoning belongs here because
   * the number now sits between two other voices' claims rather than standing on its own.
   *
   * Two rules were written independently and turned out to contradict each other. The mix says
   * a hit taken is the loudest thing in the fight, by a margin, because it is the event the
   * player most needs to notice — `mapping.test.ts` asserts that against *every* voice in this
   * record rather than a hand-kept list, precisely so a new voice cannot quietly outgrow it.
   * And the Ice Lock claims the top of the player's own voices, because it is the one move that
   * spends a third of the Focus bar and the mix has to say so.
   *
   * Both survive if `hurt` moves instead of `freeze`: at 0.47 it clears the freeze's 0.42 by
   * the 1.1 margin the test demands (0.462), stays under the 0.5 ceiling every voice here is
   * held to, and leaves the Ice Lock the loudest thing the player can *do*. Retuning `freeze`
   * down instead would have put it at or under `down`'s 0.36, which is the opposite of what a
   * Focus-priced move should sound like.
   */
  hurt: 0.47,
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
   /**
   * A Water Grip: the water leaving and the soldier arriving.
   *
   * Just under the gust's 0.22, because the two are the same key and the player should be able to
   * hear which element fired without the louder one being the tell. The difference the ear
   * actually uses is timbre rather than level — the grip's voice sweeps its filter *upward* where
   * the gust's falls, matching the inward-versus-outward direction the two effects are drawn
   * with, so the pair reads consistently in both channels.
   */
  grip: 0.2,
  /**
   * An Ice Lock: the loudest voice in the fight, and the only one above `hurt`.
   *
   * Deliberately at the top of the list. It is the one move in the game that spends Focus, and a
   * third of the bar is a bigger commitment than any single hit either side of the fight takes —
   * so the mix has to say so, or the most expensive press the player can make is also one of the
   * quietest. It is still under the 0.5 ceiling every voice here is held to.
   */
  freeze: 0.42,
  /**
   * A Fire Burst: the loudest of the player's *damage* voices, and pinned between three neighbours.
   *
   * Above the gust's 0.22 and the staff finisher's 0.26, because those are a shove and a swing and
   * this is the one move in the kit that hurts one soldier properly — the mix has to rank them the
   * way the damage figures do.
   *
   * Below `down`'s 0.36, deliberately. A burst is frequently the press that produces a down, and the
   * two voices land on the same frame when it does; the *event* has to be the louder of the pair, or
   * the confirmation the player is listening for is buried under the thing that caused it.
   *
   * Below the Ice Lock's 0.42, which keeps its own claim: the freeze is the most expensive press in
   * the game because it spends a third of the Focus bar, and fire's price is a charge that a landing
   * gives back. Comfortably under `hurt`'s 0.47 by the 1.1 margin `mapping.test.ts` enforces against
   * every voice in this record — 0.34 × 1.1 = 0.374 — so a hit taken stays the loudest thing in the
   * fight, which is the rule a new voice is most likely to break by accident.
   */
  fireBurst: 0.34,
  /**
   * A Fire Thrust: the only voice here for a move that hits nobody.
   *
   * Louder than the grip's 0.2, and the reason is where it is heard rather than what it costs. Every
   * other player voice in this record is heard on foot or at fighting range; this one plays in the
   * glider, over `createWindAudio`, whose own level rises with airspeed and is at full strength by
   * the 55 m/s reference. A confirmation that a scarce charge just went cannot be the thing the wind
   * drowns out.
   *
   * Still below the burst's 0.34, because spending a charge to move is a smaller event than spending
   * one to hurt someone, and well below `hurt`.
   */
  fireThrust: 0.28,
  /**
   * The element switch: the quietest voice in the game, by a wide margin.
   *
   * Under half the softest thing in the fight, because switching is free and happens mid-combo —
   * possibly several times in an exchange. A confirmation that carried any weight would be the
   * most-heard sound in the game and would make a free action feel like a move. It exists at all
   * because the switch is otherwise silent and the radial is not being looked at, which is the
   * whole design: the click is what tells a player who flicked without looking that it took.
   */
  elementSwitch: 0.07,
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
