import { describe, it, expect } from 'vitest'
import { mulberry32, seededNoise2D } from './rng'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('produces different sequences for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('stays within the unit interval', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('seededNoise2D', () => {
  it('is deterministic for a given seed', () => {
    expect(seededNoise2D(99)(1.5, 2.5)).toBe(seededNoise2D(99)(1.5, 2.5))
  })

  it('varies across the sampled domain', () => {
    // A degenerate random source collapses the permutation table and the noise
    // field goes flat. This test is what catches that.
    const n = seededNoise2D(1234)
    let min = 1
    let max = -1
    for (let i = 0; i < 400; i++) {
      const v = n(i * 0.11, i * 0.07)
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    expect(max - min).toBeGreaterThan(0.8)
  })

  it('stays roughly within minus one to one', () => {
    const n = seededNoise2D(5)
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(n(i * 0.3, i * 0.9))).toBeLessThanOrEqual(1.001)
    }
  })
})
