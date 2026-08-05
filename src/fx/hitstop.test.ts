import { describe, it, expect } from 'vitest'
import {
  isFrozen, noHitstop, slamHitstopSeconds, stepHitstop, triggerHitstop,
} from './hitstop'
import type { HitstopConfig } from './config'

// Deliberately unlike DEFAULT_HITSTOP_CONFIG, so an assertion that accidentally
// reads the shipped values instead of these is visible rather than silent.
const C: HitstopConfig = {
  finisherSeconds: 0.2,
  downSeconds: 0.3,
  slamMinSeconds: 0.1,
  slamMaxSeconds: 0.5,
}

describe('the freeze', () => {
  it('starts unfrozen', () => {
    expect(isFrozen(noHitstop())).toBe(false)
  })

  it('freezes for the requested time', () => {
    expect(triggerHitstop(noHitstop(), 0.05).remaining).toBeCloseTo(0.05)
  })

  it('decays to exactly zero and stops there', () => {
    const frozen = triggerHitstop(noHitstop(), 0.05)
    const done = stepHitstop(stepHitstop(frozen, 0.04), 0.04)
    expect(done.remaining).toBe(0)
    expect(isFrozen(done)).toBe(false)
    // Clamped, not negative: a negative remaining would read as frozen under a
    // `!== 0` test and would drift further from zero every frame.
    expect(stepHitstop(done, 0.04).remaining).toBe(0)
  })

  it('ignores a non-positive or non-finite request', () => {
    const idle = noHitstop()
    expect(triggerHitstop(idle, 0).remaining).toBe(0)
    expect(triggerHitstop(idle, -1).remaining).toBe(0)
    expect(triggerHitstop(idle, Number.NaN).remaining).toBe(0)
  })
})

describe('two events on one frame', () => {
  // Asserted in BOTH orders on purpose. A single trigger passes identically under
  // longest-wins and under an additive implementation, so a one-directional test
  // proves nothing. Additive is the bug being guarded: a staff finisher that downs
  // a soldier is two triggers on one frame, and a slam into three soldiers is four,
  // so summing turns a good hit into a visible stall.
  it('keeps the longest, whichever arrived first', () => {
    const longThenShort = triggerHitstop(triggerHitstop(noHitstop(), 0.05), 0.03)
    const shortThenLong = triggerHitstop(triggerHitstop(noHitstop(), 0.03), 0.05)
    expect(longThenShort.remaining).toBeCloseTo(0.05)
    expect(shortThenLong.remaining).toBeCloseTo(0.05)
  })

  it('does not shorten a freeze already running', () => {
    const running = stepHitstop(triggerHitstop(noHitstop(), 0.09), 0.01)
    expect(triggerHitstop(running, 0.02).remaining).toBeCloseTo(0.08)
  })
})

describe('a slam scales with its own strength', () => {
  it('freezes for the minimum at zero strength', () => {
    expect(slamHitstopSeconds(0, C)).toBeCloseTo(0.1)
  })

  it('freezes for the maximum at full strength', () => {
    expect(slamHitstopSeconds(1, C)).toBeCloseTo(0.5)
  })

  it('interpolates between them', () => {
    expect(slamHitstopSeconds(0.5, C)).toBeCloseTo(0.3)
  })

  it('clamps a strength outside the range', () => {
    expect(slamHitstopSeconds(-2, C)).toBeCloseTo(0.1)
    expect(slamHitstopSeconds(9, C)).toBeCloseTo(0.5)
  })
})
