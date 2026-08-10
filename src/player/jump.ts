import type { GroundConfig, InputState, PlayerState } from '../core/types'

/** Result of one frame of jump logic. Consumed by groundStep. */
export interface JumpStep {
  chargeTime: number
  airJumpsUsed: number
  /** Vertical speed to set this frame, or null for no jump. */
  jumpVelocityY: number | null
  /** Horizontal speed multiplier: chargeWalkFactor while charging, else 1. */
  walkFactor: number
  /** Seconds of buffered press to carry, or 0. */
  jumpBuffer: number
  /**
   * Whether a jump fired this frame.
   *
   * Returned rather than left for the caller to derive from `jumpVelocityY !== null`:
   * `groundStep` needs it to close the coyote window, and the same fact computed in two
   * places is two places to keep in step.
   */
  jumped: boolean
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

/**
 * One frame of charge bookkeeping.
 *
 * A hold is tracked only from a fresh press, so a key carried over from before a landing
 * cannot start a charge. Shared by the grounded branch and the coyote window rather than
 * written twice: inside the window a press is still a ground press, and two copies of
 * this rule would be two chances for them to drift apart.
 */
function trackCharge(chargeTime: number, input: InputState, dt: number): number {
  if (input.actionPressed) return dt
  if (chargeTime > 0 && input.actionHeld) return chargeTime + dt
  if (!input.actionReleased) return 0
  return chargeTime
}

export function stepJump(
  state: PlayerState,
  input: InputState,
  dt: number,
  c: GroundConfig,
): JumpStep {
  if (!state.grounded) {
    // Inside the coyote window the body is off the ground but the jump is not: the charge
    // survives and a release fires the ground jump at the ground jump's speed, spending no
    // air jump. This is what rescues a press that straddles a ledge -- charged on one side
    // of the edge and, before this branch existed, thrown away on the other.
    if (state.coyoteTime > 0) {
      const chargeTime = trackCharge(state.chargeTime, input, dt)
      if (input.actionReleased && chargeTime > 0) {
        return {
          chargeTime: 0,
          airJumpsUsed: state.airJumpsUsed,
          jumpVelocityY: releaseSpeed(chargeTime, c),
          walkFactor: 1,
          jumpBuffer: state.jumpBuffer,
          jumped: true,
        }
      }
      return {
        chargeTime,
        airJumpsUsed: state.airJumpsUsed,
        jumpVelocityY: null,
        walkFactor: 1,
        jumpBuffer: state.jumpBuffer,
        jumped: false,
      }
    }

    // A charge cannot survive leaving the ground; a press may spend an air jump.
    if (input.actionPressed && state.airJumpsUsed < c.maxAirJumps) {
      return {
        chargeTime: 0,
        airJumpsUsed: state.airJumpsUsed + 1,
        jumpVelocityY: airJumpSpeed(state.velocity.y, c),
        walkFactor: 1,
        jumpBuffer: state.jumpBuffer,
        jumped: true,
      }
    }
    // Nothing left to fire, so the press waits for the ground instead of vanishing. Only a
    // fresh press arms the buffer: a release with no press behind it is the tail of an
    // input already spent or already dropped, and buffering that would fire a jump the
    // player did not ask for on the next landing.
    if (input.actionPressed) {
      return {
        chargeTime: 0,
        airJumpsUsed: state.airJumpsUsed,
        jumpVelocityY: null,
        walkFactor: 1,
        jumpBuffer: c.jumpBufferSeconds,
        jumped: false,
      }
    }
    return {
      chargeTime: 0,
      airJumpsUsed: state.airJumpsUsed,
      jumpVelocityY: null,
      walkFactor: 1,
      jumpBuffer: state.jumpBuffer,
      jumped: false,
    }
  }

  // A press remembered from the air, ahead of everything else: the player asked for this
  // jump before touching down and the landing is when it can be given. Uncharged, and
  // consistent rather than arbitrary -- the rule below refuses to charge from a key carried
  // across a landing anyway, so there was never a charge here to spend.
  if (state.jumpBuffer > 0) {
    return {
      chargeTime: 0,
      airJumpsUsed: state.airJumpsUsed,
      jumpVelocityY: c.jumpSpeed,
      walkFactor: 1,
      jumpBuffer: 0,
      jumped: true,
    }
  }

  const chargeTime = trackCharge(state.chargeTime, input, dt)

  if (input.actionReleased && chargeTime > 0) {
    return {
      chargeTime: 0,
      airJumpsUsed: state.airJumpsUsed,
      jumpVelocityY: releaseSpeed(chargeTime, c),
      walkFactor: 1,
      jumpBuffer: state.jumpBuffer,
      jumped: true,
    }
  }

  return {
    chargeTime,
    airJumpsUsed: state.airJumpsUsed,
    jumpVelocityY: null,
    walkFactor: isCharging(chargeTime, c) ? c.chargeWalkFactor : 1,
    jumpBuffer: state.jumpBuffer,
    jumped: false,
  }
}
