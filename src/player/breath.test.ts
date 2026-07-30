import { describe, it, expect } from 'vitest'
import { stepBreath, canThrust, applyShrineBonus } from './breath'
import { DEFAULT_FLIGHT_CONFIG as C } from '../core/config'

const full = { breath: 100, maxBreath: 100 }

describe('stepBreath', () => {
  it('drains while thrusting', () => {
    expect(stepBreath(full, true, false, 1, C).breath)
      .toBeCloseTo(100 - C.breathDrainPerSecond, 5)
  })

  it('regenerates while not thrusting', () => {
    const s = stepBreath({ breath: 50, maxBreath: 100 }, false, false, 1, C)
    expect(s.breath).toBeCloseTo(50 + C.breathRegenPerSecond, 5)
  })

  it('regenerates faster on the ground', () => {
    const air = stepBreath({ breath: 50, maxBreath: 100 }, false, false, 1, C)
    const ground = stepBreath({ breath: 50, maxBreath: 100 }, false, true, 1, C)
    expect(ground.breath).toBeGreaterThan(air.breath)
  })

  it('never goes below zero', () => {
    expect(stepBreath({ breath: 1, maxBreath: 100 }, true, false, 5, C).breath).toBe(0)
  })

  it('never exceeds the maximum', () => {
    expect(stepBreath(full, false, true, 10, C).breath).toBe(100)
  })

  it('does not mutate the state it is given', () => {
    const s = { breath: 50, maxBreath: 100 }
    stepBreath(s, true, false, 1, C)
    expect(s.breath).toBe(50)
  })
})

describe('canThrust', () => {
  it('is false when out of breath', () => {
    expect(canThrust({ breath: 0, maxBreath: 100 })).toBe(false)
  })

  it('is true with breath remaining', () => {
    expect(canThrust({ breath: 0.5, maxBreath: 100 })).toBe(true)
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
