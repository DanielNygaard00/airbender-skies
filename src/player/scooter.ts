import { MathUtils } from 'three'
import type { GroundConfig } from '../core/types'

/**
 * The air scooter: a spinning ball of air Aang rides instead of running.
 *
 * The design doc calls it the connective tissue of ground movement, and gives it a
 * hidden speed accumulator: hold a clean line and the ball tightens and
 * accelerates; clip something and you drop a tier. That accumulator is what puts a
 * rhythm game underneath the platforming, so it is the part modelled here rather
 * than the raw speed bonus.
 *
 * The trade is deliberate and constant: the scooter doubles speed and halves turn
 * authority, so it is fastest exactly where the player has committed to a line.
 */
export interface ScooterState {
  /** Riding, rather than on foot. */
  active: boolean
  /** The accumulator, 0 to 1. Higher is faster and less manoeuvrable. */
  charge: number
}

export function idleScooter(): ScooterState {
  return { active: false, charge: 0 }
}

export interface ScooterInput {
  /** Edge-triggered: the scooter is a toggle, not a hold. */
  toggle: boolean
  /** Steering effort this frame, -1 to 1. Hard turns cost charge. */
  turn: number
  /** Whether the rider is actually moving. A parked scooter builds nothing. */
  moving: boolean
  /** Something was clipped this frame: drop a tier. */
  clipped: boolean
  /**
   * Riding a wall this frame, which changes two things here.
   *
   * A wall counts as support, so the "leaving the ground stows it" rule below does not
   * fire for a rider who is off the floor because he is on a cliff. And the accumulator is
   * left entirely alone, because `stepWallRide` is draining it: without this the two
   * systems would write one number in the same frame with opposite signs, and the ride's
   * documented cost would silently be its drain minus `scooterChargeGain`.
   *
   * Reported by the caller rather than worked out here, and it is deliberately the ride
   * that was running when the frame *began*. This function has to run first — the ride
   * cannot be resolved until the scooter has said whether it is still up — so the one
   * frame of lag is structural. It shows up in exactly one place: on the frame a ride
   * ends, the scooter survives one extra frame and is then stowed by the ordinary airborne
   * rule, which is the same outcome one frame later.
   */
  wallRiding: boolean
}

/**
 * Advance the accumulator.
 *
 * Charge builds only on a clean line, bleeds while turning hard, and drops a whole
 * tier on contact — the doc's rule is that clipping a wall costs you a tier, not a
 * trickle, so that collisions read as a real loss rather than as friction.
 */
export function stepScooter(
  state: ScooterState,
  input: ScooterInput,
  grounded: boolean,
  dt: number,
  c: GroundConfig,
): ScooterState {
  const active = input.toggle ? !state.active : state.active
  // Leaving the ground stows it: the scooter is a ground move, and keeping it
  // alive through a jump would blur the layer boundary the doc draws. A wall is
  // support too, though — the doc's own Air Scooter row says the ball can ride up a
  // vertical face — so the test is whether anything is holding him up, not whether it
  // happens to be underfoot.
  const supported = grounded || input.wallRiding
  if (!active || !supported) return { active: active && supported, charge: 0 }

  let charge = state.charge
  if (input.wallRiding) {
    // The wall owns the accumulator this frame. See `ScooterInput.wallRiding`.
  } else if (input.clipped) {
    charge -= c.scooterTierDrop
  } else if (!input.moving) {
    // Parked, so nothing accumulates, but nothing is lost either.
  } else {
    const hardness = Math.min(1, Math.abs(input.turn))
    charge += dt * (c.scooterChargeGain * (1 - hardness) - c.scooterChargeLoss * hardness)
  }

  return { active: true, charge: MathUtils.clamp(charge, 0, 1) }
}

/** Speed multiplier over the on-foot run. Doubles at rest, more once charged. */
export function scooterSpeedMultiplier(charge: number, c: GroundConfig): number {
  return c.scooterSpeedFactor + MathUtils.clamp(charge, 0, 1) * c.scooterChargeSpeedBonus
}

/**
 * How much steering the rider keeps, 1 being full on-foot authority.
 *
 * Halved by riding at all, and tightened further as the ball speeds up, so the
 * accumulator is a genuine trade rather than a free reward.
 */
export function scooterTurnAuthority(charge: number, c: GroundConfig): number {
  const spent = MathUtils.clamp(charge, 0, 1) * c.scooterChargeTurnPenalty
  return Math.max(0.05, c.scooterTurnFactor - spent)
}
