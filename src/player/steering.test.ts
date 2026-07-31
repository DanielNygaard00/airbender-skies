import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { steerToward, turnRateFor, weightShiftYaw } from './steering'
import { DEFAULT_FLIGHT_CONFIG as C } from '../core/config'

const FWD = new Vector3(0, 0, -1)

describe('turnRateFor', () => {
  it('turns tighter when slow than when fast', () => {
    expect(turnRateFor(10, 0, C)).toBeGreaterThan(turnRateFor(55, 0, C))
  })

  it('bank input increases the turn rate', () => {
    expect(turnRateFor(30, 1, C)).toBeGreaterThan(turnRateFor(30, 0, C))
  })

  it('is always positive even at absurd speed', () => {
    expect(turnRateFor(10000, 0, C)).toBeGreaterThan(0)
  })
})

describe('steerToward', () => {
  it('snaps to the target when it is within reach this step', () => {
    const target = new Vector3(0, 0.02, -1).normalize()
    const out = steerToward(FWD, target, 24, 0, 1 / 60, C)
    expect(out.angleTo(target)).toBeCloseTo(0, 6)
  })

  it('clamps the step to the turn rate when the target is far', () => {
    const target = new Vector3(1, 0, 0)
    const dt = 1 / 60
    const out = steerToward(FWD, target, 24, 0, dt, C)
    expect(out.angleTo(FWD)).toBeCloseTo(turnRateFor(24, 0, C) * dt, 5)
  })

  it('moves toward the target, not away from it', () => {
    const target = new Vector3(1, 0, 0)
    const out = steerToward(FWD, target, 24, 0, 1 / 60, C)
    expect(out.angleTo(target)).toBeLessThan(FWD.angleTo(target))
  })

  it('returns a normalised vector', () => {
    expect(steerToward(FWD, new Vector3(1, 1, 1), 24, 0, 1 / 60, C).length())
      .toBeCloseTo(1, 6)
  })

  it('handles an exactly opposite target without NaN', () => {
    const out = steerToward(FWD, new Vector3(0, 0, 1), 24, 0, 1 / 60, C)
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
    expect(out.length()).toBeCloseTo(1, 6)
  })

  it('a fast kite takes more steps to reverse than a slow one', () => {
    const turns = (speed: number) => {
      let f = FWD.clone()
      const target = new Vector3(0, 0, 1)
      let n = 0
      while (f.angleTo(target) > 0.05 && n < 10000) {
        f = steerToward(f, target, speed, 0, 1 / 60, C)
        n++
      }
      return n
    }
    expect(turns(55)).toBeGreaterThan(turns(12))
  })
})

describe('weight shift steering', () => {
  const LEVEL = new Vector3(0, 0, -1)

  it('turns the glider with the mouse held still', () => {
    // REGRESSION: bank used to scale only how fast the glider chased the look
    // direction, so rolling while looking straight ahead turned it not at all.
    // Steering a hang glider is the weight shift, so this is the core behaviour.
    const turned = steerToward(LEVEL, LEVEL, 30, 1, 1 / 60, C)
    expect(turned.angleTo(LEVEL)).toBeGreaterThan(0.005)
  })

  it('does not drift when no weight is shifted', () => {
    const straight = steerToward(LEVEL, LEVEL, 30, 0, 1 / 60, C)
    expect(straight.angleTo(LEVEL)).toBeCloseTo(0, 9)
  })

  it('banks right to turn right and left to turn left', () => {
    // Facing -Z, turning right heads towards +X.
    expect(weightShiftYaw(LEVEL, 1, 1 / 60, C).x).toBeGreaterThan(0)
    expect(weightShiftYaw(LEVEL, -1, 1 / 60, C).x).toBeLessThan(0)
  })

  it('carves a flat turn rather than corkscrewing', () => {
    // Rotating about the glider's own up would pitch the nose as it banked.
    const turned = weightShiftYaw(LEVEL, 1, 0.5, C)
    expect(turned.y).toBeCloseTo(0, 9)
  })

  it('leads the look assist rather than following it', () => {
    // The hybrid only reads as weight shift if the shift is the stronger input.
    expect(C.weightShiftTurnRate).toBeGreaterThan(C.baseTurnRate)
  })
})
