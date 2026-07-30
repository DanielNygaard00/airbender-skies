import { describe, it, expect } from 'vitest'
import { Box3 } from 'three'
import { createGlider } from './glider'

function span(glider: ReturnType<typeof createGlider>) {
  glider.object.updateMatrixWorld(true)
  const box = new Box3().setFromObject(glider.object)
  return {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
    box,
  }
}

function settle(glider: ReturnType<typeof createGlider>, deployed: boolean) {
  for (let i = 0; i < 120; i++) glider.update(1 / 60, deployed)
}

describe('createGlider assembly', () => {
  it('constructs without throwing', () => {
    expect(() => createGlider()).not.toThrow()
  })

  it('starts stowed', () => {
    expect(createGlider().openness()).toBe(0)
  })

  it('has a staff plus one fan root per side', () => {
    expect(createGlider().object.children).toHaveLength(3)
  })

  it('produces finite geometry when stowed', () => {
    const stowed = span(createGlider())
    for (const value of [stowed.x, stowed.y, stowed.z]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('sweeps much deeper fore-and-aft when deployed', () => {
    // REGRESSION: a folding fan does not get longer when it opens, it gets wider.
    // Giving each panel its own pivot spaced along the staff makes the stowed
    // glider WIDER than the deployed one. Depth is the axis that proves it opened.
    const stowed = span(createGlider())
    const glider = createGlider()
    settle(glider, true)
    expect(span(glider).z).toBeGreaterThan(stowed.z * 2)
  })

  it('holds the deployed wing near horizontal', () => {
    // REGRESSION: the staff mesh is rotated a quarter turn about Z at build time
    // to lie along local X. Carrying another quarter turn in DEPLOYED_ROTATION
    // compounds the two, stands the wing on its end, and collapses the span to
    // almost nothing. A near-horizontal wing is short in Y and wide in X.
    const glider = createGlider()
    settle(glider, true)
    const deployed = span(glider)
    expect(deployed.y).toBeLessThan(0.6)
    expect(deployed.x).toBeGreaterThan(2)
  })

  it('reads as a compact staff when stowed', () => {
    expect(span(createGlider()).z).toBeLessThan(0.9)
  })

  it('widens its span when deployed', () => {
    const stowed = span(createGlider())
    const glider = createGlider()
    settle(glider, true)
    expect(span(glider).x).toBeGreaterThan(stowed.x * 1.5)
  })

  it('sits overhead when deployed', () => {
    const glider = createGlider()
    settle(glider, true)
    expect(span(glider).box.max.y).toBeGreaterThan(2)
  })

  it('returns to its stowed shape after stowing', () => {
    const stowed = span(createGlider())
    const glider = createGlider()
    settle(glider, true)
    settle(glider, false)
    expect(glider.openness()).toBe(0)
    expect(span(glider).z).toBeCloseTo(stowed.z, 5)
  })

  it('is symmetric about the centre line when deployed', () => {
    const glider = createGlider()
    settle(glider, true)
    const { box } = span(glider)
    expect(Math.abs(box.max.x + box.min.x)).toBeLessThan(0.35)
  })

  it('never produces non-finite geometry mid-animation', () => {
    const glider = createGlider()
    for (let i = 0; i < 200; i++) {
      glider.update(1 / 60, i % 40 < 20)
      const current = span(glider)
      for (const value of [current.x, current.y, current.z]) {
        expect(Number.isFinite(value)).toBe(true)
      }
    }
  })
})
