import { describe, it, expect } from 'vitest'
import {
  chainRamp, emptyFocus, isFull, noFocusEvents, stepFocus,
  type Focus, type FocusConfig, type FocusEvents,
} from './focus'
import { DEFAULT_FOCUS_CONFIG } from './config'

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
  staffConnectGain: 3,
  accidentDownGain: 4,
  // Deliberately distinct from every other gain here, so an assertion that paid the wrong
  // source would land on a different number rather than passing by coincidence.
  redirectGain: 7,
}

const focusAt = (value: number, chainTime = 0): Focus => ({ value, max: C.maxFocus, chainTime })

const input = (over: Partial<{
  ratePerSecond: number
  events: Partial<FocusEvents>
  spent: number
  frozen: boolean
  reset: boolean
}> = {}) => ({
  ratePerSecond: over.ratePerSecond ?? 0,
  events: { ...noFocusEvents(), ...over.events },
  spent: over.spent ?? 0,
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

describe('focus from the staff', () => {
  const withEvents = (over: Partial<FocusEvents>) => stepFocus(
    emptyFocus(C),
    {
      ratePerSecond: 0, events: { ...noFocusEvents(), ...over }, spent: 0,
      frozen: false, reset: false,
    },
    1 / 60, C,
  )

  it('grants per enemy the swing connected with', () => {
    // A wide arc on three soldiers is three connects, which is the point of the move.
    expect(withEvents({ staffConnects: 3 }).value)
      .toBeCloseTo(withEvents({ staffConnects: 1 }).value * 3, 5)
  })

  it('grants nothing without a connect', () => {
    expect(withEvents({}).value).toBe(0)
  })

  it('pays less per hit than a gust connect', () => {
    // A gust pays once per enemy at range and off cooldown; the staff pays three times a
    // combo at melee range. Per-hit parity would make the staff the way to farm the meter.
    expect(C.staffConnectGain).toBeLessThan(C.gustConnectGain)
  })
})

describe('a removal by accident pays less than a knockdown', () => {
  it('pays the accident gain for one soldier lost over the edge', () => {
    // A literal. `expect(gained).toBe(C.accidentDownGain)` passes for any value,
    // including downGain itself, which is the exact bug this field exists to prevent.
    const next = stepFocus(focusAt(0, 0), input({ events: { accidents: 1 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(4, 5)
  })

  it('pays materially less than a knockdown', () => {
    // A margin, not a bare `>`. The design rule is that the generous play is the
    // strong play, which a fraction of a percent would not deliver.
    const down = stepFocus(focusAt(0, 0), input({ events: { downs: 1 } }), 1 / 60, C)
    const accident = stepFocus(focusAt(0, 0), input({ events: { accidents: 1 } }), 1 / 60, C)
    expect(accident.value).toBeLessThan(down.value * 0.6)
  })

  it('pays per soldier', () => {
    const next = stepFocus(focusAt(0, 0), input({ events: { accidents: 3 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(12, 5)
  })

  it('rides the chain ramp like every other gain', () => {
    const cold = stepFocus(focusAt(0, 0), input({ events: { accidents: 1 } }), 1 / 60, C)
    const hot = stepFocus(focusAt(0, 30), input({ events: { accidents: 1 } }), 1 / 60, C)
    expect(hot.value).toBeGreaterThan(cold.value * 1.2)
  })

  it('pays nothing when nothing was lost', () => {
    const next = stepFocus(focusAt(0, 0), input({ events: { accidents: 0 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(0, 5)
  })
})

describe('a redirected projectile', () => {
  it('pays the redirect gain for one arrow turned around', () => {
    // A literal, for the reason the accident gain above is one: `toBe(C.redirectGain)` would
    // pass for any value including dodgeGain, and dodgeGain is exactly the neighbour this
    // source has to be distinguishable from.
    const next = stepFocus(focusAt(0, 0), input({ events: { redirects: 1 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(7, 5)
  })

  it('pays per arrow', () => {
    const next = stepFocus(focusAt(0, 0), input({ events: { redirects: 2 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(14, 5)
  })

  it('pays nothing when no arrow was turned', () => {
    const next = stepFocus(focusAt(0, 0), input({ events: { redirects: 0 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(0, 5)
  })

  it('rides the chain ramp like every other gain', () => {
    const cold = stepFocus(focusAt(0, 0), input({ events: { redirects: 1 } }), 1 / 60, C)
    const hot = stepFocus(focusAt(0, 30), input({ events: { redirects: 1 } }), 1 / 60, C)
    expect(hot.value).toBeGreaterThan(cold.value * 1.2)
  })

  it('is worth more than a dodge and less than a knockdown in the shipped config', () => {
    // The ordering argument, checked against the real numbers rather than this file's round
    // fixture. A redirect strictly dominates a dodge — it avoids the hit and returns it — so it
    // must pay more; and it is setup rather than a removal, and an arrow that does put a
    // soldier down pays downGain on top, so it must pay less than one.
    expect(DEFAULT_FOCUS_CONFIG.redirectGain).toBeGreaterThan(DEFAULT_FOCUS_CONFIG.dodgeGain)
    expect(DEFAULT_FOCUS_CONFIG.redirectGain).toBeLessThan(DEFAULT_FOCUS_CONFIG.downGain)
  })
})

describe('spending Focus on an elemental heavy move', () => {
  it('takes the amount off the meter', () => {
    // The literal, not `toBe(50 - spend)` computed from the same variable the production code
    // reads — a tautology there would pass for a spend of any size, including zero.
    expect(stepFocus(focusAt(50), input({ spent: 20 }), 1 / 60, C).value).toBeCloseTo(30, 5)
  })

  it('spends nothing when nothing was spent', () => {
    // The positive control for the assertion above: the meter is otherwise untouched on a frame
    // with no events, so a drop here would be something other than the spend.
    expect(stepFocus(focusAt(50), input(), 1 / 60, C).value).toBeCloseTo(50, 5)
  })

  it('is not scaled by the chain ramp, unlike every gain', () => {
    // The reason `spent` is on `FocusInput` and not in `FocusEvents`. A price that fell as the
    // player played better would make the move cheapest exactly when they could most afford it,
    // which is the opposite of a cost.
    //
    // Asserted as the two runs agreeing, plus a control proving the ramp is actually live in this
    // fixture — otherwise "the ramp did not apply" would pass against a ramp that never applies.
    const cold = stepFocus(focusAt(80, 0), input({ spent: 20 }), 1 / 60, C)
    const hot = stepFocus(focusAt(80, C.chainRampSeconds * 2), input({ spent: 20 }), 1 / 60, C)
    expect(hot.value).toBeCloseTo(cold.value, 5)

    const coldGain = stepFocus(focusAt(0, 0), input({ events: { downs: 1 } }), 1 / 60, C)
    const hotGain = stepFocus(
      focusAt(0, C.chainRampSeconds * 2), input({ events: { downs: 1 } }), 1 / 60, C,
    )
    expect(hotGain.value).toBeGreaterThan(coldGain.value * 1.5)
  })

  it('does not break the chain', () => {
    // Taking a hit and falling out of the world both break it, because both are failures. Spending
    // the meter on a move is the meter working as designed, and zeroing `chainTime` for it would
    // make using the element you were given a punishment. Compared against the hit, which does.
    const built = focusAt(80, 5)
    const spent = stepFocus(built, input({ spent: 20 }), 1 / 60, C)
    const hit = stepFocus(built, input({ events: { playerHit: true } }), 1 / 60, C)
    expect(spent.chainTime).toBeGreaterThan(built.chainTime)
    expect(hit.chainTime).toBe(0)
  })

  it('never takes the meter below zero', () => {
    // Clamped by the same `MathUtils.clamp` every other path goes through. A negative meter would
    // draw a bar scaled past its own frame and would make the next affordability check nonsense.
    expect(stepFocus(focusAt(10), input({ spent: 90 }), 1 / 60, C).value).toBe(0)
  })

  it('ignores a negative spend rather than treating it as a gain', () => {
    // `spent` is the one field that bypasses the chain ramp, so a negative value would be an
    // unramped Focus gain smuggled in through it. The fight computes this from a config value that
    // a retune could get wrong.
    expect(stepFocus(focusAt(50), input({ spent: -40 }), 1 / 60, C).value).toBeCloseTo(50, 5)
  })

  it('costs nothing while the Avatar State holds the meter still', () => {
    // `frozen` returns early, so a freeze thrown during the Avatar State is free. Correct rather
    // than a leak: section 4.5 makes all elements available during the state, and the meter is
    // deliberately not moving in either direction for its duration.
    expect(stepFocus(focusAt(50), input({ spent: 20, frozen: true }), 1 / 60, C).value).toBe(50)
  })

  it('applies before gains, so a spend is not discounted by the same frame\'s kill', () => {
    // The order in `stepFocus` is: drains and the spend, then the ramp, then the gains. A freeze
    // thrown on the frame a soldier goes down should cost its full price and be paid back at
    // whatever the ramp is worth — not have the price netted against the reward first. Measured as
    // the two effects being independent and additive.
    const base = focusAt(60, 0)
    const both = stepFocus(base, input({ spent: 20, events: { downs: 1 } }), 1 / 60, C)
    const onlySpend = stepFocus(base, input({ spent: 20 }), 1 / 60, C)
    const onlyDown = stepFocus(base, input({ events: { downs: 1 } }), 1 / 60, C)
    expect(both.value).toBeCloseTo(onlySpend.value + (onlyDown.value - base.value), 5)
  })
})
