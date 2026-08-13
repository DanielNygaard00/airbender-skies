import { describe, it, expect } from 'vitest'
import { safeScale, MIN_SCALE } from './scale'

describe('safeScale', () => {
  it('passes an ordinary scale through untouched', () => {
    // The common case by far, and the one that must not be disturbed: every effect in this
    // directory asks for a real radius on almost every frame.
    expect(safeScale(9.5)).toBe(9.5)
    expect(safeScale(MIN_SCALE * 2)).toBe(MIN_SCALE * 2)
  })

  it('floors a scale that is zero or below', () => {
    // A zero scale collapses the matrix, and a negative one mirrors the geometry as well as
    // being meaningless as a radius.
    expect(safeScale(0)).toBe(MIN_SCALE)
    expect(safeScale(-3)).toBe(MIN_SCALE)
  })

  it('floors a NaN, which is the whole reason this function exists', () => {
    // The clamp this replaced was `Math.max(value, 1e-4)`, which returns NaN for a NaN input and
    // so handed it to the transform. Asserted about `safeScale` rather than about `Math.max`: a
    // test that pinned `Math.max`'s NaN behaviour would be asserting a language guarantee, which
    // this repo's register already has an entry for.
    expect(safeScale(Number.NaN)).toBe(MIN_SCALE)
  })

  it('floors an infinite scale in both directions', () => {
    // Positive infinity survives a `Math.max` clamp too, and an infinite radius produces the
    // same unusable matrix as a NaN once three.js multiplies it by anything.
    expect(safeScale(Number.POSITIVE_INFINITY)).toBe(MIN_SCALE)
    expect(safeScale(Number.NEGATIVE_INFINITY)).toBe(MIN_SCALE)
  })

  it('always returns something a matrix can be built from', () => {
    // The property the callers actually depend on, stated over the whole range of nonsense an
    // effect could arrive with, rather than one input at a time.
    const nonsense = [
      0, -0, -1e9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      Number.MIN_VALUE, Number.EPSILON,
    ]
    for (const value of nonsense) {
      const scale = safeScale(value)
      expect(Number.isFinite(scale), `safeScale(${value}) is not finite`).toBe(true)
      expect(scale, `safeScale(${value}) is not positive`).toBeGreaterThan(0)
    }
  })
})
