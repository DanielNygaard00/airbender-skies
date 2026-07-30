import { MathUtils } from 'three'
import type { FlightConfig } from '../core/types'

export interface BreathState {
  breath: number
  maxBreath: number
}

/** Drain while thrusting, otherwise recover — faster with feet on the ground. */
export function stepBreath(
  s: BreathState,
  thrusting: boolean,
  grounded: boolean,
  dt: number,
  c: FlightConfig,
): BreathState {
  const rate = thrusting
    ? -c.breathDrainPerSecond
    : c.breathRegenPerSecond * (grounded ? c.breathRegenGroundedMultiplier : 1)
  return { ...s, breath: MathUtils.clamp(s.breath + rate * dt, 0, s.maxBreath) }
}

export function canThrust(s: BreathState): boolean {
  return s.breath > 0
}

/** Collecting a shrine permanently raises the ceiling. */
export function applyShrineBonus(s: BreathState, c: FlightConfig): BreathState {
  const maxBreath = s.maxBreath + c.baseMaxBreath * c.shrineBreathBonusFraction
  return { breath: Math.min(s.breath, maxBreath), maxBreath }
}
