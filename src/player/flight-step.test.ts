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
    // Covers the ordinary banked path, where liftDir is the projection of kiteUp
    // off the velocity direction and is perpendicular by construction. It does
    // NOT reach the degenerate fallback branch, which needs the angle of attack
    // within 0.0057 degrees of 90; that branch is covered by the vertical-fall
    // deploy tests below.
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

/**
 * Fly from an explicit velocity rather than one derived from the kite's pitch,
 * which is what lets these tests set up an exactly vertical fall.
 */
function simulateFrom(opts: {
  velocity: Vector3
  forward: Vector3
  seconds: number
  bank?: number
  thrust?: boolean
}) {
  const { seconds, bank = 0, thrust = false } = opts
  const forward = opts.forward.clone().normalize()
  const start = new Vector3(0, 500, 0)
  let position = start.clone()
  let velocity = opts.velocity.clone()
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    const next = flightStep(position, velocity, { forward, thrust, flare: false, bank }, dt, C)
    position = next.position
    velocity = next.velocity
  }
  const displacement = position.clone().sub(start)
  const heading = new Vector3(forward.x, 0, forward.z)
  return {
    displacement,
    /**
     * Metres travelled across the ground along the heading. Negative means
     * going backwards. Deliberately measured against the *horizontal* heading
     * rather than against `forward` itself: a nose-up kite falling straight
     * down has a negative projection onto its own pitched forward axis while
     * not travelling backwards at all.
     */
    alongHeading: heading.lengthSq() < 1e-12
      ? 0
      : displacement.dot(heading.normalize()),
    horizontal: Math.hypot(displacement.x, displacement.z),
    position,
    velocity,
  }
}

/**
 * Deploying the kite out of a coast is the most common deployment: groundStep
 * writes horizontal velocity with no inertia, so releasing WASD mid-fall zeroes
 * x and z exactly, and pressing the action key then hands flightStep a velocity
 * of exactly (0, vy, 0) with up dot vdir of exactly -1. That is a 90 degree
 * angle of attack, where lift must be zero and its direction must not matter.
 */
describe('flightStep deploying from a vertical fall', () => {
  const straightDown = () => new Vector3(0, -20, 0)
  /**
   * The correct answer for a broadside kite is zero horizontal travel, which
   * accumulates float noise on the order of 1e-14 over hundreds of steps. This
   * tolerance admits that noise and nothing else: the bug being pinned moved
   * the player tens to hundreds of metres.
   */
  const BACKWARDS_EPSILON = -1e-9

  it('never travels backwards along the heading', () => {
    const r = simulateFrom({
      velocity: straightDown(), forward: new Vector3(0, 0, -1), seconds: 1,
    })
    expect(r.alongHeading).toBeGreaterThan(BACKWARDS_EPSILON)
  })

  it('never travels backwards along the heading over a long fall', () => {
    const r = simulateFrom({
      velocity: straightDown(), forward: new Vector3(0, 0, -1), seconds: 10,
    })
    expect(r.alongHeading).toBeGreaterThan(BACKWARDS_EPSILON)
  })

  it('does not glide sideways when banked', () => {
    for (const bank of [0.02, 0.3, 0.6, 1]) {
      const r = simulateFrom({
        velocity: straightDown(), forward: new Vector3(0, 0, -1), seconds: 4, bank,
      })
      expect(r.alongHeading).toBeGreaterThan(BACKWARDS_EPSILON)
      // Broadside to the airflow the kite generates no lift, so it simply falls.
      expect(r.horizontal).toBeLessThan(1)
    }
  })

  it('falls rather than gliding backwards, whatever the nose-up look pitch', () => {
    for (const pitchDeg of [0, 10, 30]) {
      const rad = MathUtils.degToRad(pitchDeg)
      const r = simulateFrom({
        velocity: straightDown(),
        forward: new Vector3(0, Math.sin(rad), -Math.cos(rad)),
        seconds: 4,
      })
      expect(r.alongHeading).toBeGreaterThan(BACKWARDS_EPSILON)
      expect(r.horizontal).toBeLessThan(1)
      expect(r.position.y).toBeLessThan(500)
    }
  })

  it('still glides forward once the player looks down out of the fall', () => {
    const rad = MathUtils.degToRad(-20)
    const r = simulateFrom({
      velocity: straightDown(),
      forward: new Vector3(0, Math.sin(rad), -Math.cos(rad)),
      seconds: 4,
    })
    expect(r.alongHeading).toBeGreaterThan(0)
    expect(r.displacement.z).toBeLessThan(0)
  })
})
