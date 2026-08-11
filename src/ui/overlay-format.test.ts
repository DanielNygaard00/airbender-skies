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

  it('documents the raw-float hazard percent exists to keep out of the DOM', () => {
    // **Neither line here can be reddened by a change to `overlay-format.ts`, and this
    // block is kept for what it records rather than for what it covers.** The first line
    // is about the JavaScript engine: it shows what a projected coordinate actually looks
    // like unformatted, which is the hazard these three formatters exist for. It can only
    // fail if the runtime's float-to-string rules change, which is a different claim from
    // "this module is correct". The second is forced for free by `percent(0.5)` and
    // `percent(1)` above, because `toFixed` never emits an exponent below 1e21 — that is
    // JavaScript's promise, not this module's — so every distinguishing mutant that was
    // looked for (`toFixed(1)`, `toPrecision(4)`, `toExponential(3)`) is already caught up
    // there. Nothing is asserted here that is not already pinned; the value of the block is
    // the hazard written down beside the code that answers it.
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

  it('documents the raw-angle hazard radians exists to keep out of the DOM', () => {
    // Kept for the same reason as `percent`'s raw-float block above, and with the same
    // limitation: neither line can be reddened by a change to this module. The first shows
    // what a raw `atan2` result looks like written straight into a transform — the hazard —
    // and can only fail if the runtime changes how it stringifies a float. The second is
    // already forced by the assertions above, since `toFixed` never emits an exponent below
    // 1e21. Documentation beside the code, not coverage of it.
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
