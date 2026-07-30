import { describe, it, expect } from 'vitest'
import { Vector3, MathUtils } from 'three'
import { flightStep, totalEnergy } from './flight'
import { DEFAULT_FLIGHT_CONFIG as C } from '../core/config'

/** Fly for `seconds` holding a fixed attitude. Returns the final state. */
function simulate(opts: {
  pitchDeg: number
  seconds: number
  thrust?: boolean
  flare?: boolean
  startSpeed?: number
  /** Velocity direction, if it should differ from where the kite points. */
  velPitchDeg?: number
  /** Roll about the forward axis, radians. */
  bank?: number
}) {
  const { pitchDeg, seconds, thrust = false, flare = false, startSpeed = 18, bank = 0 } = opts
  const rad = MathUtils.degToRad(pitchDeg)
  const forward = new Vector3(0, Math.sin(rad), -Math.cos(rad)).normalize()
  const vrad = MathUtils.degToRad(opts.velPitchDeg ?? pitchDeg)
  let position = new Vector3(0, 500, 0)
  let velocity = new Vector3(0, Math.sin(vrad), -Math.cos(vrad))
    .normalize()
    .multiplyScalar(startSpeed)
  const startEnergy = totalEnergy(position, velocity, C.gravity)
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    const next = flightStep(position, velocity, { forward, thrust, flare, bank }, dt, C)
    position = next.position
    velocity = next.velocity
  }
  return {
    altitude: position.y,
    speed: velocity.length(),
    startEnergy,
    endEnergy: totalEnergy(position, velocity, C.gravity),
  }
}

describe('flightStep', () => {
  it('does not mutate the position or velocity it is given', () => {
    const position = new Vector3(0, 100, 0)
    const velocity = new Vector3(0, 0, -20)
    flightStep(position, velocity, {
      forward: new Vector3(0, 0, -1), thrust: false, flare: false, bank: 0,
    }, 1 / 60, C)
    expect(position.toArray()).toEqual([0, 100, 0])
    expect(velocity.toArray()).toEqual([0, 0, -20])
  })

  it('a level glide sinks slowly and settles at a cruise speed', () => {
    const r = simulate({ pitchDeg: 0, seconds: 6 })
    expect(r.altitude).toBeLessThan(500)
    expect(r.altitude).toBeGreaterThan(430)
    expect(r.speed).toBeGreaterThan(20)
    expect(r.speed).toBeLessThan(28)
  })

  it('diving builds speed', () => {
    const dive = simulate({ pitchDeg: -40, seconds: 4 })
    const level = simulate({ pitchDeg: 0, seconds: 4 })
    expect(dive.speed).toBeGreaterThan(level.speed)
  })

  it('a 45 degree dive reaches roughly 42 metres per second in 2.5 seconds', () => {
    const r = simulate({ pitchDeg: -45, seconds: 2.5 })
    expect(r.speed).toBeGreaterThan(38)
    expect(r.speed).toBeLessThan(46)
  })

  it('a fast kite pulling up converts speed into altitude', () => {
    const r = simulate({ pitchDeg: 30, seconds: 2, startSpeed: 55 })
    expect(r.altitude).toBeGreaterThan(500)
    expect(r.speed).toBeLessThan(55)
  })

  it('a zoom climb gains roughly 30 metres above the pull-up point', () => {
    const r = simulate({ pitchDeg: 35, seconds: 2.5, startSpeed: 42 })
    expect(r.altitude - 500).toBeGreaterThan(18)
    expect(r.altitude - 500).toBeLessThan(45)
  })

  it('a slow kite pointing up cannot climb', () => {
    const r = simulate({ pitchDeg: 30, seconds: 2, startSpeed: 12 })
    expect(r.altitude).toBeLessThan(500)
  })

  it('a dive then climb cycle is net lossy in both height and speed', () => {
    // This is the load-bearing design property: gliding never gains net height.
    const dive = simulate({ pitchDeg: -45, seconds: 2.5 })
    const heightSpentDiving = 500 - dive.altitude
    const climb = simulate({ pitchDeg: 35, seconds: 2.5, startSpeed: dive.speed })
    const heightRegained = climb.altitude - 500
    expect(heightRegained).toBeLessThan(heightSpentDiving)
    expect(climb.speed).toBeLessThan(18)
  })

  it('an unpowered glide loses only a little energy', () => {
    const r = simulate({ pitchDeg: -10, seconds: 5 })
    const loss = (r.startEnergy - r.endEnergy) / r.startEnergy
    expect(loss).toBeGreaterThan(0)
    expect(loss).toBeLessThan(0.35)
  })

  it('thrust adds net energy, unlike gliding', () => {
    const powered = simulate({ pitchDeg: 5, seconds: 3, thrust: true })
    const glide = simulate({ pitchDeg: 5, seconds: 3, thrust: false })
    expect(powered.endEnergy).toBeGreaterThan(glide.endEnergy)
    expect(powered.altitude).toBeGreaterThan(500)
  })

  it('flaring slows the kite more than not flaring', () => {
    const flared = simulate({ pitchDeg: 0, seconds: 2, startSpeed: 40, flare: true })
    const clean = simulate({ pitchDeg: 0, seconds: 2, startSpeed: 40, flare: false })
    expect(flared.speed).toBeLessThan(clean.speed)
  })

  it('stalls: a very slow kite at high angle of attack loses lift and falls', () => {
    const r = simulate({ pitchDeg: 60, seconds: 1.5, startSpeed: 4, velPitchDeg: 0 })
    expect(r.altitude).toBeLessThan(500)
  })

  it('recovers from a stall by building speed in the fall', () => {
    const r = simulate({ pitchDeg: 60, seconds: 1.5, startSpeed: 4, velPitchDeg: 0 })
    expect(r.speed).toBeGreaterThan(4)
  })

  it('never produces non-finite values', () => {
    for (const pitchDeg of [-90, -45, 0, 45, 90]) {
      const r = simulate({ pitchDeg, seconds: 3, thrust: true })
      expect(Number.isFinite(r.altitude)).toBe(true)
      expect(Number.isFinite(r.speed)).toBe(true)
    }
  })

  it('an unpowered glide still loses energy with a non-zero bank', () => {
    // Regression: liftDir must stay perpendicular to velocity even when kiteUp
    // sweeps off vertical under bank, otherwise lift does work along the flight
    // path and gliding could gain energy instead of losing it.
    for (const bank of [0.7, -0.7, 1.5, -1.5]) {
      const r = simulate({ pitchDeg: 0, seconds: 4, bank })
      expect(r.endEnergy).toBeLessThan(r.startEnergy)
    }
  })

  it('does not mutate the position or velocity it is given, with a non-zero bank', () => {
    const position = new Vector3(0, 100, 0)
    const velocity = new Vector3(0, 0, -20)
    flightStep(position, velocity, {
      forward: new Vector3(0, 0, -1), thrust: false, flare: false, bank: 0.7,
    }, 1 / 60, C)
    expect(position.toArray()).toEqual([0, 100, 0])
    expect(velocity.toArray()).toEqual([0, 0, -20])
  })

  it('never produces non-finite values across a range of bank angles', () => {
    for (const bank of [-1.5, -0.7, 0, 0.7, 1.5]) {
      const r = simulate({ pitchDeg: -20, seconds: 3, thrust: true, bank })
      expect(Number.isFinite(r.altitude)).toBe(true)
      expect(Number.isFinite(r.speed)).toBe(true)
    }
  })
})
