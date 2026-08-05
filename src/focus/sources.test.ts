import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { traversalRatePerSecond, fellOutOfWorld } from './sources'
import type { FocusConfig } from './focus'
import type { FlightConfig, PlayerState } from '../core/types'
import { DEFAULT_FLIGHT_CONFIG } from '../core/config'

const C: FocusConfig = {
  maxFocus: 100,
  glideGainPerSecond: 2,
  windGainMultiplier: 3,
  scooterGainPerSecond: 4,
  idleDrainPerSecond: 3,
  chainRampSeconds: 10,
  chainRampMax: 2,
  gustConnectGain: 5,
  downGain: 10,
  slamGainAtFullImpact: 20,
  damageDrain: 30,
  crashDrain: 50,
  dodgeGain: 8,
  staffConnectGain: 3,
  // Unused by anything this file tests (traversalRatePerSecond, fellOutOfWorld);
  // present only because FocusConfig now requires it.
  accidentDownGain: 4,
}

const FLIGHT: FlightConfig = { ...DEFAULT_FLIGHT_CONFIG, stallSpeed: 10 }

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, ...over,
})

const gliding = (speed: number) =>
  p({ mode: 'glider', grounded: false, velocity: new Vector3(0, 0, speed) })

describe('traversalRatePerSecond', () => {
  it('pays for gliding above stall speed', () => {
    expect(traversalRatePerSecond(gliding(30), false, FLIGHT, C)).toBeCloseTo(2)
  })

  it('pays triple inside a wind feature', () => {
    expect(traversalRatePerSecond(gliding(30), true, FLIGHT, C)).toBeCloseTo(6)
  })

  it('drains while stalled in the air', () => {
    // Hanging below stall speed is not clean traversal, whatever the mode says.
    expect(traversalRatePerSecond(gliding(4), false, FLIGHT, C)).toBeCloseTo(-3)
  })

  it('drains while standing on the ground', () => {
    expect(traversalRatePerSecond(p(), false, FLIGHT, C)).toBeCloseTo(-3)
  })

  it('drains while running without the scooter', () => {
    expect(traversalRatePerSecond(
      p({ velocity: new Vector3(0, 0, 13) }), false, FLIGHT, C,
    )).toBeCloseTo(-3)
  })

  it('pays for a fully charged scooter line', () => {
    expect(traversalRatePerSecond(
      p({ scooterActive: true, scooterCharge: 1 }), false, FLIGHT, C,
    )).toBeCloseTo(4)
  })

  it('scales the scooter rate with the accumulator', () => {
    expect(traversalRatePerSecond(
      p({ scooterActive: true, scooterCharge: 0.5 }), false, FLIGHT, C,
    )).toBeCloseTo(2)
  })

  it('pays nothing for a scooter that has built no charge', () => {
    // Mounting the scooter must not be worth Focus on its own; the line is.
    expect(traversalRatePerSecond(
      p({ scooterActive: true, scooterCharge: 0 }), false, FLIGHT, C,
    )).toBeCloseTo(0)
  })

  it('ignores wind on the ground', () => {
    // inWind is sampled for the glider; it must not leak into the ground rate.
    expect(traversalRatePerSecond(
      p({ scooterActive: true, scooterCharge: 1 }), true, FLIGHT, C,
    )).toBeCloseTo(4)
  })
})

describe('fellOutOfWorld', () => {
  it('is true below the floor', () => {
    expect(fellOutOfWorld(p({ position: new Vector3(0, -260, 0) }), -250)).toBe(true)
  })

  it('is false above the floor', () => {
    expect(fellOutOfWorld(p({ position: new Vector3(0, -240, 0) }), -250)).toBe(false)
  })

  it('is false at exactly the floor, matching the controller', () => {
    // The controller respawns on a strict less-than. This must not disagree, or the
    // player loses Focus on a frame they were not respawned.
    expect(fellOutOfWorld(p({ position: new Vector3(0, -250, 0) }), -250)).toBe(false)
  })
})
