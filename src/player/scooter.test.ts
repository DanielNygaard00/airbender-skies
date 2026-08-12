import { describe, it, expect } from 'vitest'
import {
  idleScooter, stepScooter, scooterSpeedMultiplier, scooterTurnAuthority,
  type ScooterInput, type ScooterState,
} from './scooter'
import { DEFAULT_GROUND_CONFIG as C } from '../core/config'

const on = (charge = 0): ScooterState => ({ active: true, charge })
const move = (over: Partial<ScooterInput> = {}): ScooterInput => ({
  toggle: false, turn: 0, moving: true, clipped: false, wallRiding: false, ...over,
})

/** Ride a clean line for `seconds` and report the accumulator. */
function ride(seconds: number, input = move(), from = on()): ScooterState {
  let state = from
  for (let t = 0; t < seconds; t += 1 / 60) state = stepScooter(state, input, true, 1 / 60, C)
  return state
}

describe('toggling the scooter', () => {
  it('is a toggle rather than a hold', () => {
    // The doc binds it to a tap, so it has to survive the key being released.
    const started = stepScooter(idleScooter(), move({ toggle: true }), true, 1 / 60, C)
    expect(started.active).toBe(true)
    const carried = stepScooter(started, move(), true, 1 / 60, C)
    expect(carried.active).toBe(true)
  })

  it('toggles back off', () => {
    expect(stepScooter(on(), move({ toggle: true }), true, 1 / 60, C).active).toBe(false)
  })

  it('stows itself on leaving the ground', () => {
    // It is a ground move; carrying it through a jump would blur the layer split.
    expect(stepScooter(on(0.8), move(), false, 1 / 60, C).active).toBe(false)
  })

  it('loses the accumulator when stowed', () => {
    expect(stepScooter(on(0.8), move({ toggle: true }), true, 1 / 60, C).charge).toBe(0)
  })

  it('stays up over a wall, because a wall is support too', () => {
    // The Air Scooter row in the design doc says the ball can ride up a vertical face, so
    // "leaving the ground" cannot mean "off the floor" — otherwise the ride would stow the
    // very thing it is a property of on its first airborne frame.
    const kept = stepScooter(on(0.8), move({ wallRiding: true }), false, 1 / 60, C)
    expect(kept.active).toBe(true)
    expect(kept.charge).toBe(0.8)
  })

  it('is still stowed by leaving the ground with no wall to be on', () => {
    // The other half, so the clause above cannot have switched the rule off: without a wall,
    // airborne still stows it and still costs the accumulator.
    const gone = stepScooter(on(0.8), move({ wallRiding: false }), false, 1 / 60, C)
    expect(gone.active).toBe(false)
    expect(gone.charge).toBe(0)
  })

  it('is still stowed by a toggle while riding a wall', () => {
    // The player's own release. `Z` stows the ball wherever he is, and the ball is what was
    // climbing, so the ride goes with it.
    expect(stepScooter(on(0.8), move({ toggle: true, wallRiding: true }), false, 1 / 60, C).active)
      .toBe(false)
  })
})

describe('the speed accumulator', () => {
  it('builds while holding a clean line', () => {
    expect(ride(2).charge).toBeGreaterThan(0)
  })

  it('builds more the longer the line is held', () => {
    expect(ride(3).charge).toBeGreaterThan(ride(1).charge)
  })

  it('bleeds away while turning hard', () => {
    const charged = ride(3)
    const turning = ride(1, move({ turn: 1 }), charged)
    expect(turning.charge).toBeLessThan(charged.charge)
  })

  it('drops a whole tier on contact rather than a trickle', () => {
    // Clipping a wall should read as a real loss, per the doc.
    const charged = ride(3)
    const clipped = stepScooter(charged, move({ clipped: true }), true, 1 / 60, C)
    expect(charged.charge - clipped.charge).toBeCloseTo(C.scooterTierDrop, 6)
  })

  it('is left entirely alone while a wall ride owns it', () => {
    // Not "drained a bit less" — untouched. `stepWallRide` is the only thing spending the
    // accumulator during a ride, and if this branch also built it on a clean line the ride's
    // documented cost would silently be its drain minus `scooterChargeGain`.
    const charged = ride(3)
    const onWall = stepScooter(charged, move({ wallRiding: true }), false, 1 / 60, C)
    expect(onWall.charge).toBe(charged.charge)
  })

  it('does not even bleed from a hard turn while riding a wall', () => {
    // Both of the ordinary accumulator rules are off, not just the gain. A rider carving along
    // a face is already paying the wall's drain, and charging him twice for one manoeuvre would
    // make the ride's cost a function of how much he happened to be steering.
    const charged = ride(3)
    const turning = stepScooter(charged, move({ turn: 1, wallRiding: true }), false, 1 / 60, C)
    expect(turning.charge).toBe(charged.charge)
  })

  it('does not drop a tier for a clip taken while riding a wall', () => {
    // A rider pressed against rock is in contact with it by definition. Letting `clipped` fire
    // there would take a tier off every frame of every ride.
    const charged = ride(3)
    const clipped = stepScooter(charged, move({ clipped: true, wallRiding: true }), false, 1 / 60, C)
    expect(clipped.charge).toBe(charged.charge)
  })

  it('never goes below empty or above full', () => {
    expect(stepScooter(on(0.05), move({ clipped: true }), true, 1 / 60, C).charge).toBe(0)
    expect(ride(60).charge).toBe(1)
  })

  it('builds nothing while parked', () => {
    expect(ride(2, move({ moving: false })).charge).toBe(0)
  })
})

describe('the speed and steering trade', () => {
  it('doubles speed even before any charge', () => {
    expect(scooterSpeedMultiplier(0, C)).toBeCloseTo(2, 6)
  })

  it('goes faster as the ball tightens', () => {
    expect(scooterSpeedMultiplier(1, C)).toBeGreaterThan(scooterSpeedMultiplier(0, C))
  })

  it('halves turn authority for riding at all', () => {
    expect(scooterTurnAuthority(0, C)).toBeCloseTo(0.5, 6)
  })

  it('costs more steering the faster it goes, so the accumulator is a real trade', () => {
    expect(scooterTurnAuthority(1, C)).toBeLessThan(scooterTurnAuthority(0, C))
  })

  it('always leaves some steering, so a charged rider is never uncontrollable', () => {
    expect(scooterTurnAuthority(1, C)).toBeGreaterThan(0)
  })
})
