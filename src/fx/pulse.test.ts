import { describe, it, expect } from 'vitest'
import { stepPulse } from './pulse'

describe('a decaying pulse', () => {
  it('decays at the rate it is given', () => {
    // 4 per second over a quarter second lands on zero.
    expect(stepPulse(1, 0.125, 4)).toBeCloseTo(0.5)
  })

  it('clamps at zero rather than going negative', () => {
    expect(stepPulse(0.1, 1, 4)).toBe(0)
    expect(stepPulse(0, 1, 4)).toBe(0)
  })

  it('never exceeds one, so a re-trigger cannot stack', () => {
    expect(stepPulse(5, 0, 4)).toBe(1)
  })

  it('returns zero for a non-finite value rather than propagating it', () => {
    // The value reaches the DOM as an opacity and the camera as a FOV, so a NaN here
    // would show up as an invisible overlay or a blank screen.
    expect(stepPulse(Number.NaN, 1 / 60, 4)).toBe(0)
    expect(stepPulse(1, Number.NaN, 4)).toBe(0)
  })
})
