import { describe, it, expect } from 'vitest'
import { stepBreath, canBend, applyShrineBonus } from './breath'
import { DEFAULT_FLIGHT_CONFIG as C } from '../core/config'

// F is this file's alias for DEFAULT_FLIGHT_CONFIG, matching the C alias already in use.
const F = C

const full = { breath: 100, maxBreath: 100 }

describe('stepBreath', () => {
  it('drains while thrusting', () => {
    expect(stepBreath(full, 'thrust', false, 1, C).breath)
      .toBeCloseTo(100 - C.breathDrainPerSecond, 5)
  })

  it('regenerates while not thrusting', () => {
    const s = stepBreath({ breath: 50, maxBreath: 100 }, 'idle', false, 1, C)
    expect(s.breath).toBeCloseTo(50 + C.breathRegenPerSecond, 5)
  })

  it('regenerates faster on the ground', () => {
    const air = stepBreath({ breath: 50, maxBreath: 100 }, 'idle', false, 1, C)
    const ground = stepBreath({ breath: 50, maxBreath: 100 }, 'idle', true, 1, C)
    expect(ground.breath).toBeGreaterThan(air.breath)
  })

  it('never goes below zero', () => {
    expect(stepBreath({ breath: 1, maxBreath: 100 }, 'thrust', false, 5, C).breath).toBe(0)
  })

  it('never exceeds the maximum', () => {
    expect(stepBreath(full, 'idle', true, 10, C).breath).toBe(100)
  })

  it('does not mutate the state it is given', () => {
    const s = { breath: 50, maxBreath: 100 }
    stepBreath(s, 'thrust', false, 1, C)
    expect(s.breath).toBe(50)
  })
})

describe('canBend', () => {
  it('cannot bend below the floor', () => {
    expect(canBend({ breath: F.bendFloor - 0.01, maxBreath: 100 }, F)).toBe(false)
  })

  it('can bend at exactly the floor', () => {
    expect(canBend({ breath: F.bendFloor, maxBreath: 100 }, F)).toBe(true)
  })

  it('bendFloor is a config-shape check, not a behavioural one', () => {
    // This does not exercise canBend or the duty cycle at all -- it is pure arithmetic on
    // DEFAULT_FLIGHT_CONFIG, and it passes unchanged even with canBend reverted to
    // `breath > 0`, because it never calls canBend. See controller.test.ts's "cuts the
    // duty cycle rather than only moving where it oscillates" for the test that actually
    // exercises the floor's effect (300 of 600 frames engaged with no floor, 210 of 600
    // with bendFloor 15 -- the floor slows the buzz, it does not silence it; a clean
    // "beat of thrust, then a beat of nothing" would need true hysteresis, which canBend
    // deliberately does not have).
    //
    // What this check does confirm: bendFloor is sized in the same units as a real second
    // of thrust, not set to some token value like 1 that would drain in a single frame and
    // be indistinguishable from no floor at all.
    expect(F.bendFloor / F.breathDrainPerSecond).toBeGreaterThan(0.5)
  })
})

describe('applyShrineBonus', () => {
  it('raises the maximum by ten percent of the base', () => {
    expect(applyShrineBonus(full, C).maxBreath).toBeCloseTo(110, 5)
  })

  it('eight shrines roughly double the maximum', () => {
    let s = full
    for (let i = 0; i < 8; i++) s = applyShrineBonus(s, C)
    expect(s.maxBreath).toBeCloseTo(180, 5)
  })

  it('does not raise current breath above the new maximum', () => {
    expect(applyShrineBonus({ breath: 100, maxBreath: 100 }, C).breath).toBe(100)
  })
})

describe('hovering costs more than thrusting', () => {
  it('drains faster than thrust over the same second', () => {
    // Holding station carries the glider's whole weight; thrust only adds to a
    // wing that is already flying.
    const full = { breath: 100, maxBreath: 100 }
    const afterThrust = stepBreath(full, 'thrust', false, 1, C).breath
    const afterHover = stepBreath(full, 'hover', false, 1, C).breath
    expect(afterHover).toBeLessThan(afterThrust)
  })

  it('cannot drain past empty', () => {
    expect(stepBreath({ breath: 2, maxBreath: 100 }, 'hover', false, 5, C).breath).toBe(0)
  })

  it('recovers when idle in the air, as before', () => {
    expect(stepBreath({ breath: 50, maxBreath: 100 }, 'idle', false, 1, C).breath)
      .toBeGreaterThan(50)
  })
})
