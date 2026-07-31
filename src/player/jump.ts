import type { GroundConfig, InputState, PlayerState } from '../core/types'

/** Result of one frame of jump logic. Consumed by groundStep. */
export interface JumpStep {
  chargeTime: number
  airJumpsUsed: number
  /** Vertical speed to set this frame, or null for no jump. */
  jumpVelocityY: number | null
  /** Horizontal speed multiplier: chargeWalkFactor while charging, else 1. */
  walkFactor: number
}

/** Holds shorter than the threshold are taps; from the threshold on, a charge. */
export function isCharging(chargeTime: number, c: GroundConfig): boolean {
  return chargeTime >= c.chargeThresholdSeconds
}

export function canAirJump(state: PlayerState, c: GroundConfig): boolean {
  return !state.grounded && state.airJumpsUsed < c.maxAirJumps
}

function releaseSpeed(chargeTime: number, c: GroundConfig): number {
  if (!isCharging(chargeTime, c)) return c.jumpSpeed
  const t = Math.min(chargeTime, c.chargeMaxSeconds) / c.chargeMaxSeconds
  return c.jumpSpeed + (c.chargedJumpSpeed - c.jumpSpeed) * t
}

/**
 * Speed an air jump sets, given how fast the player is already moving vertically.
 *
 * The second jump is a downward air push rather than a leg push, so it bites
 * hardest against air that is already moving: rising fast gains more height than
 * jumping from a standstill. Descending gains nothing extra rather than being
 * penalised, so a recovery jump out of a fall is still worth taking.
 */
export function airJumpSpeed(verticalSpeed: number, c: GroundConfig): number {
  return c.airJumpSpeed + Math.max(0, verticalSpeed) * c.airJumpRisingBonus
}

export function stepJump(
  state: PlayerState,
  input: InputState,
  dt: number,
  c: GroundConfig,
): JumpStep {
  if (!state.grounded) {
    // A charge cannot survive leaving the ground; a press may spend an air jump.
    if (input.actionPressed && state.airJumpsUsed < c.maxAirJumps) {
      return {
        chargeTime: 0,
        airJumpsUsed: state.airJumpsUsed + 1,
        jumpVelocityY: airJumpSpeed(state.velocity.y, c),
        walkFactor: 1,
      }
    }
    return { chargeTime: 0, airJumpsUsed: state.airJumpsUsed, jumpVelocityY: null, walkFactor: 1 }
  }

  // A hold is tracked only from a fresh grounded press, so a key carried over
  // from before a landing cannot start a charge.
  let chargeTime = state.chargeTime
  if (input.actionPressed) chargeTime = dt
  else if (chargeTime > 0 && input.actionHeld) chargeTime += dt
  else if (!input.actionReleased) chargeTime = 0

  if (input.actionReleased && chargeTime > 0) {
    return {
      chargeTime: 0,
      airJumpsUsed: state.airJumpsUsed,
      jumpVelocityY: releaseSpeed(chargeTime, c),
      walkFactor: 1,
    }
  }

  return {
    chargeTime,
    airJumpsUsed: state.airJumpsUsed,
    jumpVelocityY: null,
    walkFactor: isCharging(chargeTime, c) ? c.chargeWalkFactor : 1,
  }
}
