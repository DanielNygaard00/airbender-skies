import { describe, it, expect } from 'vitest'
import { alpha, percent, radians } from './overlay-format'

describe('percent', () => {
  it('writes a viewport fraction as a CSS percentage', () => {
    expect(percent(0.5)).toBe('50.000%')
    expect(percent(0)).toBe('0.000%')
    expect(percent(1)).toBe('100.000%')
  })

  it('rounds to a thousandth of a percent, which is a hundredth of a pixel', () => {
    expect(percent(1 / 3)).toBe('33.333%')
  })

  it('flattens a tiny float instead of writing it in exponent notation', () => {
    // The whole reason these three exist -- asserted on both sides, because the
    // formatted half alone cannot fail. `toFixed` never emits an exponent below 1e21,
    // so any implementation satisfying the assertions above satisfies the second line
    // for free; it pins the value rather than covering anything. The first line is the
    // one that can fail, and it is the one that establishes the hazard is real.
    expect(`${1.2e-16 * 100}%`).toBe('1.2000000000000001e-14%')
    expect(percent(1.2e-16)).toBe('0.000%')
  })
})

describe('radians', () => {
  it('writes an angle as CSS radians, signed', () => {
    expect(radians(0)).toBe('0.00000rad')
    expect(radians(Math.PI)).toBe('3.14159rad')
    // Negative: a bearing to the player's left. Dropping the sign here would mirror
    // every overlay that uses this, which is the one error in the ring that matters.
    expect(radians(-Math.PI / 2)).toBe('-1.57080rad')
  })

  it('flattens a tiny angle rather than writing an exponent', () => {
    // Asserted on both sides, for the same reason as percent's tiny-float test above:
    // `toFixed` never emits an exponent below 1e21, so the formatted line alone cannot
    // fail. The first line is the one that can fail, and it is the one that establishes
    // the hazard is real.
    expect(`${2.4e-17}rad`).toBe('2.4e-17rad')
    expect(radians(2.4e-17)).toBe('0.00000rad')
  })
})

describe('alpha', () => {
  it('writes an opacity at a thousandth, which is under one 255th', () => {
    expect(alpha(1)).toBe('1.000')
    expect(alpha(0)).toBe('0.000')
    expect(alpha(1 / 3)).toBe('0.333')
  })
})
