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
    // The whole reason these three exist. A raw NDC-derived fraction is regularly
    // seventeen significant digits, and `${1.2e-16 * 100}%` is the string "1.2e-14%".
    // CSS does accept that -- checked in a browser rather than assumed -- so this is
    // about keeping full-precision floats out of the DOM on every rendered frame, not
    // about validity.
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
