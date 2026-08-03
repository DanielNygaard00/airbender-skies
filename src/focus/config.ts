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
  damageDrain: 30,
  crashDrain: 50,
}
