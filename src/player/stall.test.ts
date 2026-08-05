import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { stallSeverity } from './stall'
import { stallFactor } from './flight'
import { DEFAULT_FLIGHT_CONFIG } from '../core/config'
import type { PlayerState } from '../core/types'

const C = DEFAULT_FLIGHT_CONFIG

/** A glider moving at the given speed. Direction is irrelevant: only the magnitude counts. */
const gliding = (speed: number): PlayerState => ({
  mode: 'glider', position: new Vector3(), velocity: new Vector3(0, 0, -speed),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: false, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
})

const walking = (speed: number): PlayerState =>
  ({ ...gliding(speed), mode: 'ground', grounded: true })

describe('a stalling wing', () => {
  it('reports nothing at stall speed exactly', () => {
    // Exactly zero, not merely small: an off-by-epsilon here flickers the warning at cruise.
    expect(stallSeverity(gliding(C.stallSpeed), C)).toBe(0)
  })

  it('reports nothing above stall speed', () => {
    expect(stallSeverity(gliding(C.stallSpeed + 20), C)).toBe(0)
    expect(stallSeverity(gliding(60), C)).toBe(0)
  })

  it('reports full severity at a standstill', () => {
    expect(stallSeverity(gliding(0), C)).toBe(1)
  })

  it('ramps linearly between', () => {
    // stallSpeed is 8, so half of it is 4 and severity should be 0.5. Literals, so a changed
    // ramp shape is caught rather than absorbed.
    expect(stallSeverity(gliding(C.stallSpeed / 2), C)).toBeCloseTo(0.5)
    expect(stallSeverity(gliding(C.stallSpeed * 0.25), C)).toBeCloseTo(0.75)
  })

  it('complements the flight model rather than holding a second opinion', () => {
    // Compared against the real `stallFactor` the flight model scales its lift by, imported
    // rather than restated: an earlier version of this test recomputed `speed / stallSpeed`
    // itself, which meant it agreed with a stale copy of the formula and stayed green when the
    // flight model's ramp changed shape underneath it. Severity must be exactly 1 minus the
    // factor across the whole ramp, or the tell can say "stalling" while the wing still makes
    // most of its lift, or stay quiet while lift is already gone.
    for (const speed of [0, 1, 3.5, 6, 7.99, C.stallSpeed, 20]) {
      expect(stallSeverity(gliding(speed), C), `speed ${speed}`)
        .toBeCloseTo(1 - stallFactor(speed, C), 10)
    }
  })
})

describe('on foot there is no such thing as a stall', () => {
  it('reports nothing while walking, however slowly', () => {
    // The trap this guards. A walk is 7 and a sprint 13, so a severity computed from speed
    // alone would paint the airspeed readout red while the player strolls around the island.
    expect(stallSeverity(walking(7), C)).toBe(0)
    expect(stallSeverity(walking(0), C)).toBe(0)
    expect(stallSeverity(walking(1), C)).toBe(0)
  })

  it('reports nothing while standing still on the ground', () => {
    expect(stallSeverity(walking(0), C)).toBe(0)
  })
})

describe('bad numbers', () => {
  it('reports nothing rather than NaN for a corrupt velocity', () => {
    // The controller respawns a non-finite state, but the HUD reads the model on the same
    // frame, and a NaN would reach the DOM as a colour.
    const broken = { ...gliding(0), velocity: new Vector3(Number.NaN, 0, 0) }
    expect(stallSeverity(broken, C)).toBe(0)
  })

  it('reports nothing rather than dividing by a zero stall speed', () => {
    expect(stallSeverity(gliding(0), { ...C, stallSpeed: 0 })).toBe(0)
  })
})
