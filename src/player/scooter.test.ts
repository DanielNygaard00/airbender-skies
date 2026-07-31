import { describe, it, expect } from 'vitest'
import {
  idleScooter, stepScooter, scooterSpeedMultiplier, scooterTurnAuthority,
  type ScooterInput, type ScooterState,
} from './scooter'
import { DEFAULT_GROUND_CONFIG as C } from '../core/config'

const on = (charge = 0): ScooterState => ({ active: true, charge })
const move = (over: Partial<ScooterInput> = {}): ScooterInput => ({
  toggle: false, turn: 0, moving: true, clipped: false, ...over,
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
