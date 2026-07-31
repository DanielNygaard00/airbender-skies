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
  // Weight shift leads and look assists: baseTurnRate came down from 2.2 so that
  // pointing the mouse trims a turn instead of commanding it outright.
  baseTurnRate: 0.9,
  turnRateSpeedRef: 40,
  bankTurnRate: 1.5,
  weightShiftTurnRate: 1.7,
  breathDrainPerSecond: 18,
  // Hovering costs about 1.7x thrust, so holding station is a deliberate spend
  // rather than a free way to wait out a bad approach.
  hoverBreathPerSecond: 30,
  hoverDamping: 1.6,
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
    'shrineBreathBonusFraction', 'hoverBreathPerSecond', 'hoverDamping',
    'weightShiftTurnRate',
  ]
  for (const key of positive) {
    if (!(c[key] > 0)) throw new Error(`FlightConfig.${key} must be > 0, got ${c[key]}`)
  }
  if (c.hoverBreathPerSecond <= c.breathDrainPerSecond) {
    throw new Error(
      `FlightConfig.hoverBreathPerSecond (${c.hoverBreathPerSecond}) must exceed ` +
      `breathDrainPerSecond (${c.breathDrainPerSecond}): hovering carries the whole ` +
      'glider, thrust only adds to a flying wing',
    )
  }
  if (c.stallSpeed >= c.turnRateSpeedRef) {
    throw new Error(
      `FlightConfig.stallSpeed (${c.stallSpeed}) must be below turnRateSpeedRef (${c.turnRateSpeedRef})`,
    )
  }
}

import type { GroundConfig } from './types'

export const DEFAULT_GROUND_CONFIG: GroundConfig = {
  walkSpeed: 7,
  runSpeed: 13,
  jumpSpeed: 9,
  gravity: 20,
  snapDistance: 1.2,
  eyeProbeHeight: 2,
  maxAirJumps: 1,
  airJumpSpeed: 9,
  chargeThresholdSeconds: 0.2,
  chargeMaxSeconds: 1.5,
  chargedJumpSpeed: 20,
  chargeWalkFactor: 0.4,
}
