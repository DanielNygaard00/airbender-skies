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
  tuckLiftFactor: 0.1,
  tuckDragFactor: 0.55,
  deployKick: 3,
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
    'weightShiftTurnRate', 'tuckLiftFactor', 'tuckDragFactor', 'deployKick',
  ]
  for (const key of positive) {
    if (!(c[key] > 0)) throw new Error(`FlightConfig.${key} must be > 0, got ${c[key]}`)
  }
  if (!(c.tuckLiftFactor < 1) || !(c.tuckDragFactor < 1)) {
    throw new Error(
      'FlightConfig tuck factors must be below 1: a tuck folds the wings away, it ' +
      `does not add lift or drag (got ${c.tuckLiftFactor}, ${c.tuckDragFactor})`,
    )
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
  airJumpRisingBonus: 0.6,
  chargeThresholdSeconds: 0.2,
  chargeMaxSeconds: 1.5,
  chargedJumpSpeed: 20,
  chargeWalkFactor: 0.4,
  // Soft enough to lean into turns and slide on stops, per the doc's air-assisted
  // run, without feeling like ice.
  groundResponse: 7,
  scooterSpeedFactor: 2,
  scooterChargeSpeedBonus: 0.6,
  scooterTurnFactor: 0.5,
  scooterChargeTurnPenalty: 0.25,
  scooterChargeGain: 0.35,
  scooterChargeLoss: 0.8,
  scooterTierDrop: 0.34,
  maxDashChain: 3,
  dashSpeed: 26,
  dashDurationSeconds: 0.22,
  dashRecoverySeconds: 0.7,
}

import type { SlipstreamConfig } from '../player/slipstream'

/**
 * Slipstream. The window is 0.11s inside an enemy telegraph of 0.55s
 * (`windUpSeconds`), so beating a strike takes real timing rather than a mash.
 */
export const DEFAULT_SLIPSTREAM_CONFIG: SlipstreamConfig = {
  // A shade faster than the blast dash's 26: this one is bought with a cooldown
  // rather than being the everyday traversal tool.
  speed: 30,
  durationSeconds: 0.2,
  invulnerableSeconds: 0.11,
  cooldownSeconds: 1.5,
}

import type { StaffConfig } from '../player/staff'

/**
 * The staff. A full three-swing combo occupies it for about 0.8s of swinging plus 0.4s of
 * recovery, so committing to melee costs over a second with no wing — which is the price
 * the design document's "central risk decision" is supposed to have.
 */
export const DEFAULT_STAFF_CONFIG: StaffConfig = {
  maxChain: 3,
  swingSeconds: 0.26,
  continueSeconds: 0.3,
  recoverySeconds: 0.4,
}
