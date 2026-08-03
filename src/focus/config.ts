import type { AvatarStateConfig } from './avatar-state'
import type { FocusConfig } from './focus'

/**
 * Focus tuning.
 *
 * Clean gliding fills the meter in roughly 45 seconds unramped, nearer 30 once the
 * chain is up — long enough that a full meter is earned rather than incidental. Combat
 * pays far better per second than traversal, and a single spear costs nearly a third of
 * the bar, which is what makes it a break rather than a scratch.
 *
 * Every value here is an argued guess. None of it has been played.
 */
export const DEFAULT_FOCUS_CONFIG: FocusConfig = {
  maxFocus: 100,
  glideGainPerSecond: 2.2,
  // Riding a feature is the skilled version of flying, so it pays double.
  windGainMultiplier: 2,
  // At a full accumulator, slightly better than plain gliding: the ground kit should
  // not be strictly worse than the air.
  scooterGainPerSecond: 3.5,
  // Faster than the base gain, so standing still loses ground rather than holding it.
  idleDrainPerSecond: 3,
  chainRampSeconds: 12,
  chainRampMax: 1.8,
  gustConnectGain: 6,
  downGain: 14,
  // A shade more than a down: a slam is harder to execute, and rewarding it is how
  // the traversal layer feeds the meter.
  slamGainAtFullImpact: 18,
  damageDrain: 30,
  crashDrain: 50,
}

/**
 * Avatar State tuning.
 *
 * Short and loud, per the design document. The gust multiplier is set so a single
 * gust downs a spear soldier outright — 0.5 damage times 3 reaches their 1.5 health —
 * which turns the whole patrol over in a few seconds and is the point of the state.
 *
 * Every value here is an argued guess. None of it has been played.
 */
export const DEFAULT_AVATAR_STATE_CONFIG: AvatarStateConfig = {
  // Long enough that arriving at maximum Focus is not instantly a trigger.
  armSeconds: 4,
  durationSeconds: 8,
  gustDamageMultiplier: 3,
  // Loud, without launching enemies clean out of the level.
  gustKnockbackMultiplier: 1.5,
  surgeAccelMultiplier: 1.8,
  // Downdrafts nearly stop rather than inverting into lift.
  relentFactor: 0.15,
}
