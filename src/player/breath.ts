import { MathUtils } from 'three'
import type { FlightConfig } from '../core/types'

export interface BreathState {
  breath: number
  maxBreath: number
}

/**
 * What the player is spending breath on. Named rather than a second boolean,
 * because "thrusting and hovering at once" is not a state the game has, and a
 * boolean pair would let callers express it.
 */
export type BreathEffort = 'idle' | 'thrust' | 'hover'

function drainRateFor(effort: BreathEffort, grounded: boolean, c: FlightConfig): number {
  if (effort === 'thrust') return -c.breathDrainPerSecond
  if (effort === 'hover') return -c.hoverBreathPerSecond
  return c.breathRegenPerSecond * (grounded ? c.breathRegenGroundedMultiplier : 1)
}

/** Drain while bending, otherwise recover — faster with feet on the ground. */
export function stepBreath(
  s: BreathState,
  effort: BreathEffort,
  grounded: boolean,
  dt: number,
  c: FlightConfig,
): BreathState {
  const rate = drainRateFor(effort, grounded, c)
  return { ...s, breath: MathUtils.clamp(s.breath + rate * dt, 0, s.maxBreath) }
}

/**
 * Any airbending needs breath in hand, not merely a non-zero bar.
 *
 * The floor is what stops an exhausted player buzzing. It converts the failure from a 30 Hz
 * flicker into a rhythm: at `bendFloor` 15 against `breathDrainPerSecond` 18 a player gets
 * 0.83 s of thrust, then 1.25 s of regeneration at 12/s to earn it back.
 *
 * Deliberately not true hysteresis. Remembering "was bending" would need a field on
 * PlayerState carried through every respawn and save path, which is a real cost for a
 * smaller improvement than the floor already buys.
 */
export function canBend(s: BreathState, c: FlightConfig): boolean {
  return s.breath >= c.bendFloor
}

/** Collecting a shrine permanently raises the ceiling. */
export function applyShrineBonus(s: BreathState, c: FlightConfig): BreathState {
  const maxBreath = s.maxBreath + c.baseMaxBreath * c.shrineBreathBonusFraction
  return { breath: Math.min(s.breath, maxBreath), maxBreath }
}
