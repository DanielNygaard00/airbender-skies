import type { FlightConfig } from './types'

/** Validated by prototype measurement — see the plan's tuning table. */
export const DEFAULT_FLIGHT_CONFIG: FlightConfig = {
  gravity: 20,
  liftCoeff: 0.075,
  dragCoeff: 0.0045,
  inducedDragFactor: 6,
  stallSpeed: 8,
  thrustAccel: 22,
  flareAoaBoost: 0.35,
  rigAoa: 0.09,
  baseTurnRate: 2.2,
  turnRateSpeedRef: 40,
  bankTurnRate: 1.5,
  breathDrainPerSecond: 18,
  landingSpeed: 14,
  baseMaxBreath: 100,
  breathRegenPerSecond: 12,
  breathRegenGroundedMultiplier: 2.5,
  shrineBreathBonusFraction: 0.1,
}

export function validateFlightConfig(c: FlightConfig): void {
  const positive: (keyof FlightConfig)[] = [
    'gravity', 'liftCoeff', 'dragCoeff', 'stallSpeed',
    'thrustAccel', 'baseTurnRate', 'turnRateSpeedRef',
    'breathDrainPerSecond', 'landingSpeed', 'baseMaxBreath',
    'breathRegenPerSecond', 'breathRegenGroundedMultiplier',
    'shrineBreathBonusFraction',
  ]
  for (const key of positive) {
    if (!(c[key] > 0)) throw new Error(`FlightConfig.${key} must be > 0, got ${c[key]}`)
  }
  if (c.stallSpeed >= c.turnRateSpeedRef) {
    throw new Error(
      `FlightConfig.stallSpeed (${c.stallSpeed}) must be below turnRateSpeedRef (${c.turnRateSpeedRef})`,
    )
  }
}
