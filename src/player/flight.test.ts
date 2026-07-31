import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { gliderUp, angleOfAttack, hoverAccel, flightStep } from './flight'
import { DEFAULT_FLIGHT_CONFIG as C } from '../core/config'

const FWD_LEVEL = new Vector3(0, 0, -1)

describe('gliderUp', () => {
  it('is perpendicular to forward when level', () => {
    expect(gliderUp(FWD_LEVEL, 0).dot(FWD_LEVEL)).toBeCloseTo(0, 6)
  })

  it('is perpendicular to forward when pitched up', () => {
    const f = new Vector3(0, 0.4, -1).normalize()
    expect(gliderUp(f, 0).dot(f)).toBeCloseTo(0, 6)
  })

  it('points world-up when the glider is level and unbanked', () => {
    const up = gliderUp(FWD_LEVEL, 0)
    expect(up.y).toBeCloseTo(1, 5)
  })

  it('is still normalised and perpendicular when banked', () => {
    const f = new Vector3(0, -0.2, -1).normalize()
    const up = gliderUp(f, 0.7)
    expect(up.length()).toBeCloseTo(1, 6)
    expect(up.dot(f)).toBeCloseTo(0, 6)
  })

  it('rolls the up axis sideways when banked', () => {
    expect(Math.abs(gliderUp(FWD_LEVEL, 0.7).x)).toBeGreaterThan(0.1)
  })

  it('does not produce NaN when forward is straight down', () => {
    const up = gliderUp(new Vector3(0, -1, 0), 0)
    expect(Number.isFinite(up.x + up.y + up.z)).toBe(true)
    expect(up.length()).toBeCloseTo(1, 6)
  })
})

describe('angleOfAttack', () => {
  it('is zero when the glider moves exactly where it points', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 0, -20), gliderUp(FWD_LEVEL, 0))
    expect(aoa).toBeCloseTo(0, 5)
  })

  it('is zero when the glider is barely moving', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 0, 0), gliderUp(FWD_LEVEL, 0))
    expect(aoa).toBe(0)
  })

  it('is positive when the nose is above the flight path', () => {
    // Pointing level but sinking: the nose is above where it is going.
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, -10, -10), gliderUp(FWD_LEVEL, 0))
    expect(aoa).toBeGreaterThan(0)
    expect(aoa).toBeCloseTo(Math.PI / 4, 3)
  })

  it('is negative when the nose is below the flight path', () => {
    // Pointing level but climbing: the nose is below where it is going.
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 10, -10), gliderUp(FWD_LEVEL, 0))
    expect(aoa).toBeLessThan(0)
    expect(aoa).toBeCloseTo(-Math.PI / 4, 3)
  })

  it('reaches ninety degrees when moving straight down while pointing level', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, -10, 0), gliderUp(FWD_LEVEL, 0))
    expect(aoa).toBeCloseTo(Math.PI / 2, 4)
  })
})

describe('hoverAccel', () => {
  it('cancels gravity exactly', () => {
    // The point of hovering is holding altitude with no updraft, which means
    // producing precisely the acceleration gravity is taking away.
    const accel = hoverAccel(new Vector3(), C)
    expect(accel.y).toBeCloseTo(C.gravity, 6)
  })

  it('bleeds airspeed so the glider can stop dead', () => {
    // A plain glider must keep moving to keep flying. Bending lets it stop.
    const accel = hoverAccel(new Vector3(30, 0, 0), C)
    expect(accel.x).toBeLessThan(0)
  })

  it('opposes a climb as well as a dive, so a hover settles', () => {
    // Only ever fighting descent would let a hover balloon upward instead of
    // holding station.
    expect(hoverAccel(new Vector3(0, 12, 0), C).y).toBeLessThan(C.gravity)
  })

  it('holds altitude against gravity over time', () => {
    let velocity = new Vector3(18, 0, 0)
    let position = new Vector3(0, 100, 0)
    for (let t = 0; t < 3; t += 1 / 60) {
      const step = flightStep(position, velocity, {
        forward: new Vector3(1, 0, 0), thrust: false, flare: false, bank: 0, hover: true, tuck: false,
      }, 1 / 60, C)
      position = step.position
      velocity = step.velocity
    }
    // Without hover this would have fallen roughly 90 units in three seconds.
    expect(position.y).toBeGreaterThan(95)
    // And it should have shed most of its speed rather than cruising on.
    expect(velocity.length()).toBeLessThan(9)
  })
})

describe('tucking folds the wings away', () => {
  function dive(tuck: boolean) {
    let velocity = new Vector3(0, -2, -20)
    let position = new Vector3(0, 400, 0)
    const forward = new Vector3(0, -0.45, -0.89).normalize()
    for (let t = 0; t < 2.5; t += 1 / 60) {
      const step = flightStep(position, velocity, {
        forward, thrust: false, flare: false, bank: 0, hover: false, tuck,
      }, 1 / 60, C)
      position = step.position
      velocity = step.velocity
    }
    return { position, velocity }
  }

  it('gains materially more speed in a dive than the same dive with wings out', () => {
    // "Fast dive, big speed gain, no lift". The margin matters: a bare
    // greater-than passes on a fraction of a percent, so it would still hold with
    // the fold factors neutralised and prove nothing about the tuck.
    const tucked = dive(true).velocity.length()
    const winged = dive(false).velocity.length()
    expect(tucked).toBeGreaterThan(winged * 1.15)
  })

  it('loses materially more altitude, because there is no lift holding it up', () => {
    const droppedTucked = 400 - dive(true).position.y
    const droppedWinged = 400 - dive(false).position.y
    expect(droppedTucked).toBeGreaterThan(droppedWinged * 1.15)
  })

  it('leaves the untucked flight model untouched', () => {
    // Both fold factors are 1 when not tucked, so gliding must be bit-identical.
    const args = {
      forward: new Vector3(0, 0, -1), thrust: false, flare: false, bank: 0, hover: false,
    }
    const withFlag = flightStep(new Vector3(), new Vector3(0, 0, -20), { ...args, tuck: false }, 1 / 60, C)
    expect(withFlag.velocity.length()).toBeGreaterThan(0)
  })
})
