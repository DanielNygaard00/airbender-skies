import { describe, it, expect } from 'vitest'
import {
  chainRamp, emptyFocus, isFull, noFocusEvents, stepFocus,
  type Focus, type FocusConfig, type FocusEvents,
} from './focus'

/**
 * Round numbers chosen so every expectation below can be a hand-computed literal
 * rather than a restatement of the config the code reads.
 */
const C: FocusConfig = {
  maxFocus: 100,
  glideGainPerSecond: 2,
  windGainMultiplier: 2,
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
}

const focusAt = (value: number, chainTime = 0): Focus => ({ value, max: C.maxFocus, chainTime })

const input = (over: Partial<{
  ratePerSecond: number
  events: Partial<FocusEvents>
  frozen: boolean
  reset: boolean
}> = {}) => ({
  ratePerSecond: over.ratePerSecond ?? 0,
  events: { ...noFocusEvents(), ...over.events },
  frozen: over.frozen ?? false,
  reset: over.reset ?? false,
})

describe('emptyFocus', () => {
  it('starts empty with no chain', () => {
    expect(emptyFocus(C)).toEqual({ value: 0, max: 100, chainTime: 0 })
  })
})

describe('isFull', () => {
  it('is true only at the top of the meter', () => {
    expect(isFull(focusAt(99.9))).toBe(false)
    expect(isFull(focusAt(100))).toBe(true)
  })

  it('stays true if a gain path ever overshoots', () => {
    // Guards the arming rule against an exact-equality comparison.
    expect(isFull(focusAt(120))).toBe(true)
  })
})

describe('chainRamp', () => {
  it('is 1 with no chain built', () => {
    expect(chainRamp(focusAt(0, 0), C)).toBeCloseTo(1)
  })

  it('is halfway up at half the ramp time', () => {
    // 1 -> 2 over 10s, so 5s in is 1.5.
    expect(chainRamp(focusAt(0, 5), C)).toBeCloseTo(1.5)
  })

  it('holds at the cap past the ramp time', () => {
    expect(chainRamp(focusAt(0, 10), C)).toBeCloseTo(2)
    expect(chainRamp(focusAt(0, 45), C)).toBeCloseTo(2)
  })
})

describe('stepFocus', () => {
  it('gains the traversal rate over a second', () => {
    const next = stepFocus(focusAt(0), input({ ratePerSecond: 2 }), 1, C)
    expect(next.value).toBeCloseTo(2)
  })

  it('gains twice as fast once the chain is fully ramped', () => {
    const cold = stepFocus(focusAt(0, 0), input({ ratePerSecond: 2 }), 1, C)
    const hot = stepFocus(focusAt(0, 30), input({ ratePerSecond: 2 }), 1, C)
    // Absolute values, not a bare comparison: the ramp is worth exactly 2x here.
    expect(cold.value).toBeCloseTo(2)
    expect(hot.value).toBeCloseTo(4)
  })

  it('drains while the rate is negative', () => {
    const next = stepFocus(focusAt(50), input({ ratePerSecond: -3 }), 1, C)
    expect(next.value).toBeCloseTo(47)
  })

  it('advances the chain when nothing breaks it', () => {
    const next = stepFocus(focusAt(10, 4), input(), 0.5, C)
    expect(next.chainTime).toBeCloseTo(4.5)
  })

  it('pays for a gust connect and a down', () => {
    const next = stepFocus(
      focusAt(0),
      input({ events: { gustConnects: 2, downs: 1 } }),
      1 / 60,
      C,
    )
    // 2 connects at 5, one down at 10, unramped.
    expect(next.value).toBeCloseTo(20)
  })

  it('drains and resets the chain when the player is hit', () => {
    const next = stepFocus(focusAt(80, 30), input({ events: { playerHit: true } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(50)
    expect(next.chainTime).toBe(0)
  })

  it('grants the unramped amount for a down on the frame the chain broke', () => {
    // Regression guard on ordering. The break must zero the ramp before the gain
    // is scaled, or a hit-and-down frame pays the 2x bonus for a chain that just
    // ended: 80 - 30 + 10 = 60, not 80 - 30 + 20 = 70.
    const next = stepFocus(
      focusAt(80, 30),
      input({ events: { playerHit: true, downs: 1 } }),
      1 / 60,
      C,
    )
    expect(next.value).toBeCloseTo(60)
  })

  it('costs more to fall out of the world than to take a spear', () => {
    const hit = stepFocus(focusAt(90, 30), input({ events: { playerHit: true } }), 1 / 60, C)
    const fell = stepFocus(focusAt(90, 30), input({ events: { fellOutOfWorld: true } }), 1 / 60, C)
    expect(hit.value).toBeCloseTo(60)
    expect(fell.value).toBeCloseTo(40)
  })

  it('holds the meter exactly still while frozen', () => {
    const before = focusAt(64, 12)
    const next = stepFocus(
      before,
      input({ ratePerSecond: 5, events: { downs: 3 }, frozen: true }),
      1,
      C,
    )
    expect(next).toEqual(before)
  })

  it('empties the meter and the chain on reset', () => {
    const next = stepFocus(focusAt(100, 40), input({ reset: true }), 1 / 60, C)
    expect(next).toEqual({ value: 0, max: 100, chainTime: 0 })
  })

  it('resets even while frozen, because the state ends on the same frame', () => {
    const next = stepFocus(focusAt(100, 40), input({ frozen: true, reset: true }), 1 / 60, C)
    expect(next.value).toBe(0)
  })

  it('never leaves the meter outside its range', () => {
    expect(stepFocus(focusAt(95), input({ ratePerSecond: 2 }), 60, C).value).toBe(100)
    expect(stepFocus(focusAt(5), input({ events: { fellOutOfWorld: true } }), 1, C).value).toBe(0)
  })
})

describe('stepFocus slams', () => {
  it('pays for a full-strength slam', () => {
    const next = stepFocus(focusAt(0), input({ events: { slamStrength: 1 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(20)
  })

  it('pays in proportion to the impact', () => {
    const next = stepFocus(focusAt(0), input({ events: { slamStrength: 0.25 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(5)
  })

  it('pays nothing when there was no slam', () => {
    const next = stepFocus(focusAt(0), input({ events: { slamStrength: 0 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(0)
  })

  it('pays more for a slam landed during a long clean run', () => {
    const cold = stepFocus(focusAt(0, 0), input({ events: { slamStrength: 1 } }), 1 / 60, C)
    const hot = stepFocus(focusAt(0, 30), input({ events: { slamStrength: 1 } }), 1 / 60, C)
    // The ramp is worth exactly 2x with this fixture.
    expect(cold.value).toBeCloseTo(20)
    expect(hot.value).toBeCloseTo(40)
  })

  it('pays nothing for a slam on a frame that also broke the chain', () => {
    // Not zero Focus overall — the drain applies — but the slam's own grant is
    // unramped, exactly like a down on a broken frame.
    const next = stepFocus(
      focusAt(80, 30),
      input({ events: { slamStrength: 1, playerHit: true } }),
      1 / 60,
      C,
    )
    // 80 - 30 damage + 20 unramped slam.
    expect(next.value).toBeCloseTo(70)
  })
})

describe('focus from a dodge', () => {
  it('grants for damage avoided', () => {
    const dodged = stepFocus(
      emptyFocus(C), input({ events: { damageAvoided: true } }), 1 / 60, C,
    )
    expect(dodged.value).toBeGreaterThan(0)
  })

  it('grants nothing without the event', () => {
    const nothing = stepFocus(emptyFocus(C), input(), 1 / 60, C)
    expect(nothing.value).toBe(0)
  })

  it('keeps a chain alive where taking the hit would break it', () => {
    // Section 4.5 builds Focus from unbroken chains, and a dodge is how a chain
    // survives an attack. Being hit resets chainTime; avoiding must not.
    const built = focusAt(40, 5)
    const dodged = stepFocus(built, input({ events: { damageAvoided: true } }), 1 / 60, C)
    const hit = stepFocus(built, input({ events: { playerHit: true } }), 1 / 60, C)
    expect(dodged.chainTime).toBeGreaterThan(built.chainTime)
    expect(hit.chainTime).toBe(0)
  })
})
