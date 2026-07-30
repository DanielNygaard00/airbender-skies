import { describe, it, expect } from 'vitest'
import {
  advanceOpenness, easeOpenness, panelAngle,
  OPEN_SECONDS, PANELS_PER_SIDE, FAN_SPREAD,
} from './glider'

describe('advanceOpenness', () => {
  it('starts closed and opens toward one', () => {
    expect(advanceOpenness(0, true, OPEN_SECONDS / 3, OPEN_SECONDS)).toBeCloseTo(1 / 3, 5)
  })

  it('reaches exactly one and does not overshoot', () => {
    expect(advanceOpenness(0.9, true, 10, OPEN_SECONDS)).toBe(1)
  })

  it('closes toward zero', () => {
    expect(advanceOpenness(1, false, OPEN_SECONDS / 3, OPEN_SECONDS)).toBeCloseTo(2 / 3, 5)
  })

  it('reaches exactly zero and does not undershoot', () => {
    expect(advanceOpenness(0.1, false, 10, OPEN_SECONDS)).toBe(0)
  })

  it('reverses cleanly when interrupted mid-open', () => {
    let openness = 0
    for (let i = 0; i < 5; i++) openness = advanceOpenness(openness, true, 1 / 60, OPEN_SECONDS)
    const mid = openness
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    openness = advanceOpenness(openness, false, 1 / 60, OPEN_SECONDS)
    expect(openness).toBeLessThan(mid)
  })

  it('stays in range over a long run of alternating input', () => {
    let openness = 0
    for (let i = 0; i < 10000; i++) {
      openness = advanceOpenness(openness, i % 200 < 100, 1 / 60, OPEN_SECONDS)
      expect(openness).toBeGreaterThanOrEqual(0)
      expect(openness).toBeLessThanOrEqual(1)
    }
  })

  it('is frame-rate independent', () => {
    let fast = 0
    let slow = 0
    for (let i = 0; i < 36; i++) fast = advanceOpenness(fast, true, 1 / 120, OPEN_SECONDS)
    for (let i = 0; i < 18; i++) slow = advanceOpenness(slow, true, 1 / 60, OPEN_SECONDS)
    expect(Math.abs(fast - slow)).toBeLessThan(1e-9)
  })

  it('survives a non-finite or negative dt without corrupting openness', () => {
    expect(advanceOpenness(0.5, true, NaN, OPEN_SECONDS)).toBe(0.5)
    expect(advanceOpenness(0.5, true, -1, OPEN_SECONDS)).toBe(0.5)
  })

  it('recovers from a non-finite current value', () => {
    expect(advanceOpenness(NaN, true, 1 / 60, OPEN_SECONDS)).toBe(0)
  })
})

describe('easeOpenness', () => {
  it('is zero at zero and one at one', () => {
    expect(easeOpenness(0)).toBe(0)
    expect(easeOpenness(1)).toBe(1)
  })

  it('is symmetric about the midpoint', () => {
    expect(easeOpenness(0.5)).toBeCloseTo(0.5, 6)
  })

  it('eases, moving slower than linear near each end', () => {
    expect(easeOpenness(0.1)).toBeLessThan(0.1)
    expect(easeOpenness(0.9)).toBeGreaterThan(0.9)
  })

  it('clamps out-of-range input', () => {
    expect(easeOpenness(-1)).toBe(0)
    expect(easeOpenness(2)).toBe(1)
  })
})

describe('panelAngle', () => {
  it('collapses every panel to zero when fully closed', () => {
    for (let i = 0; i < PANELS_PER_SIDE; i++) {
      expect(panelAngle(i, PANELS_PER_SIDE, 0, FAN_SPREAD)).toBe(0)
    }
  })

  it('leaves the root panel along the staff even when open', () => {
    expect(panelAngle(0, PANELS_PER_SIDE, 1, FAN_SPREAD)).toBe(0)
  })

  it('opens the outermost panel to the full spread', () => {
    expect(panelAngle(PANELS_PER_SIDE - 1, PANELS_PER_SIDE, 1, FAN_SPREAD))
      .toBeCloseTo(FAN_SPREAD, 6)
  })

  it('fans monotonically outward', () => {
    let previous = -1
    for (let i = 0; i < PANELS_PER_SIDE; i++) {
      const angle = panelAngle(i, PANELS_PER_SIDE, 1, FAN_SPREAD)
      expect(angle).toBeGreaterThan(previous)
      previous = angle
    }
  })

  it('spreads progressively as openness rises', () => {
    const outer = PANELS_PER_SIDE - 1
    expect(panelAngle(outer, PANELS_PER_SIDE, 0.5, FAN_SPREAD))
      .toBeLessThan(panelAngle(outer, PANELS_PER_SIDE, 1, FAN_SPREAD))
  })

  it('never produces a non-finite angle', () => {
    for (const openness of [0, 0.5, 1, -1, 2]) {
      for (let i = 0; i < PANELS_PER_SIDE; i++) {
        expect(Number.isFinite(panelAngle(i, PANELS_PER_SIDE, openness, FAN_SPREAD))).toBe(true)
      }
    }
  })

  it('handles a single-panel fan without dividing by zero', () => {
    expect(panelAngle(0, 1, 1, FAN_SPREAD)).toBe(0)
  })
})
