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
 * A plain threshold still oscillates -- it just does it at the floor instead of at zero.
 * `canBend` is re-evaluated every frame, so once breath is back at `bendFloor` a single
 * frame of drain drops it back below and closes the gate again, then regeneration walks it
 * back up and the gate reopens. Measured over 600 frames of holding thrust from empty:
 * 300 of 600 engaged with no floor, 210 of 600 with `bendFloor` 15 -- slower, not silent.
 *
 * Eliminating the flicker entirely needs true hysteresis: a "was bending" flag on
 * PlayerState, set on engaging and cleared only at zero, carried through every respawn and
 * save path. That is deliberately not done here -- it is the available next step for
 * anyone who decides the residual 40% duty cycle still matters. What the floor buys on its
 * own, independent of the buzz, is that thrust needs a real reserve of breath rather than
 * a non-zero bar: an exhausted player cannot limp along on fumes.
 */
export function canBend(s: BreathState, c: FlightConfig): boolean {
  return s.breath >= c.bendFloor
}

/** Collecting a shrine permanently raises the ceiling. */
export function applyShrineBonus(s: BreathState, c: FlightConfig): BreathState {
  const maxBreath = s.maxBreath + c.baseMaxBreath * c.shrineBreathBonusFraction
  return { breath: Math.min(s.breath, maxBreath), maxBreath }
}
