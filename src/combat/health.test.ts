import { describe, it, expect } from 'vitest'
import { applyDamage, fullHealth, healthFraction, isDowned, stepHealth, type Health, type HealthConfig } from './health'

const C: HealthConfig = { maxHealth: 5, outOfCombatSeconds: 4, regenPerSecond: 0.4 }

describe('taking damage', () => {
  it('reduces health', () => {
    expect(applyDamage(fullHealth(C), 2).current).toBe(3)
  })

  it('never falls below zero', () => {
    expect(applyDamage(fullHealth(C), 99).current).toBe(0)
  })

  it('resets the out-of-combat timer', () => {
    expect(applyDamage(fullHealth(C), 1).sinceHit).toBe(0)
  })

  it('ignores a non-positive hit rather than healing from it', () => {
    const hurt = applyDamage(fullHealth(C), 3)
    expect(applyDamage(hurt, -5)).toEqual(hurt)
  })
})

describe('being downed', () => {
  it('happens at zero, and is a state rather than a removal', () => {
    // Aang wins without killing: everything reaches a downed state, not a death.
    const downed = applyDamage(fullHealth(C), C.maxHealth)
    expect(isDowned(downed)).toBe(true)
    expect(downed.current).toBe(0)
  })

  it('does not wear off with time', () => {
    let downed = applyDamage(fullHealth(C), C.maxHealth)
    for (let t = 0; t < 60; t += 1 / 60) downed = stepHealth(downed, 1 / 60, C)
    expect(isDowned(downed)).toBe(true)
  })
})

describe('regeneration', () => {
  /** Let `seconds` pass without being hit. */
  function rest(seconds: number, from = applyDamage(fullHealth(C), 3)) {
    let h = from
    for (let t = 0; t < seconds; t += 1 / 60) h = stepHealth(h, 1 / 60, C)
    return h
  }

  it('does nothing during the first quiet seconds', () => {
    const hurt = applyDamage(fullHealth(C), 3)
    expect(rest(C.outOfCombatSeconds - 0.5).current).toBe(hurt.current)
  })

  it('begins once the fight has been quiet long enough', () => {
    const hurt = applyDamage(fullHealth(C), 3)
    expect(rest(C.outOfCombatSeconds + 2).current).toBeGreaterThan(hurt.current)
  })

  it('is slow enough that it cannot be used mid-fight', () => {
    // Two seconds of quiet inside a fight must not meaningfully restore anything.
    const hurt = applyDamage(fullHealth(C), 3)
    expect(rest(2).current - hurt.current).toBeLessThan(0.5)
  })

  it('never exceeds the maximum', () => {
    expect(rest(600, applyDamage(fullHealth(C), 1)).current).toBe(C.maxHealth)
  })
})

describe('healthFraction', () => {
  const at = (current: number, max = 4): Health => ({ current, max, sinceHit: 0 })

  it('is 1 at full health', () => {
    expect(healthFraction(at(4))).toBe(1)
  })

  it('is a half at half health', () => {
    expect(healthFraction(at(2))).toBeCloseTo(0.5, 6)
  })

  it('is 0 at the floor', () => {
    expect(healthFraction(at(0))).toBe(0)
  })

  it('clamps a current above max', () => {
    // Regeneration clamps already, but a fraction above 1 would scale a quad past
    // the track it sits in, so this stays a guard rather than an assumption.
    expect(healthFraction(at(9))).toBe(1)
  })

  it('clamps a negative current', () => {
    expect(healthFraction(at(-3))).toBe(0)
  })

  it('is 0 rather than NaN for a non-finite current', () => {
    // This value reaches a transform. NaN in scale.x corrupts the matrix rather
    // than merely looking wrong, so it must not survive this function.
    expect(healthFraction(at(Number.NaN))).toBe(0)
  })

  it('is 0 rather than dividing by a zero max', () => {
    expect(healthFraction({ current: 0, max: 0, sinceHit: 0 })).toBe(0)
  })
})
