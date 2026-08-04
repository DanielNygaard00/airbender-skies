import { describe, it, expect } from 'vitest'
import {
  advanceOpenness, easeOpenness, panelAngle, createGlider,
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

describe('the staff sweeping through a swing', () => {
  it('moves the staff while a swing is in progress', () => {
    const a = createGlider()
    a.update(1 / 60, false, 0)
    const start = a.object.rotation.y
    const b = createGlider()
    b.update(1 / 60, false, 0.5)
    expect(b.object.rotation.y).not.toBeCloseTo(start, 4)
  })

  it('leaves the stowed pose alone when not swinging', () => {
    // Regression guard: the sweep composes onto the pose this module already owns, so a
    // null swing has to leave that pose exactly as it was before the argument existed.
    const stowed = createGlider()
    stowed.update(1 / 60, false, null)
    const reference = createGlider()
    reference.update(1 / 60, false, null)
    expect(stowed.object.rotation.y).toBeCloseTo(reference.object.rotation.y, 6)
    expect(stowed.object.position.toArray()).toEqual(reference.object.position.toArray())
    // Comparing two freshly-created gliders alone cannot catch an unconditionally-applied
    // sweep: both would pick up the same leaked offset and still agree with each other.
    // Pin rotation.y to its known pre-sweep value too — neither the stowed nor the deployed
    // pose carries any yaw, so this is 0 regardless of openness — giving an unconditional
    // application something concrete to disagree with.
    expect(stowed.object.rotation.y).toBeCloseTo(0, 6)
  })

  it('returns to the stowed pose once the swing ends', () => {
    const g = createGlider()
    g.update(1 / 60, false, null)
    const rest = g.object.rotation.y
    // 0.75, not 0.5: the sweep lerps symmetrically either side of the stowed pose
    // (see SWEEP_ARC's doc comment), so progress 0.5 sits exactly at that pose's own
    // rotation.y by construction — a real mid-swing sample would spuriously equal
    // "rest" and this assertion could never catch a broken implementation.
    g.update(1 / 60, false, 0.75)
    expect(g.object.rotation.y).not.toBeCloseTo(rest, 4)
    g.update(1 / 60, false, null)
    expect(g.object.rotation.y).toBeCloseTo(rest, 6)
  })

  it('ignores a swing while deployed, where the staff is a wing', () => {
    const g = createGlider()
    for (let t = 0; t < 1; t += 1 / 60) g.update(1 / 60, true, null)
    const deployed = g.object.rotation.y
    g.update(1 / 60, true, 0.5)
    expect(g.object.rotation.y).toBeCloseTo(deployed, 6)
  })

  it('still ignores a swing one frame into folding away, before openness catches up', () => {
    // This is the case gating on `openness` exists for, not the always-deployed case
    // above: `deployed` flips to false the instant the fold starts, but `openness` is
    // still ~0.94 (OPEN_SECONDS is 0.3s, so one 1/60s frame barely moves it) — a glider
    // in that state is still a wing. Gating on the `deployed` flag instead would open
    // the sweep on this exact frame and the wing would twitch mid-fold.
    const g = createGlider()
    for (let t = 0; t < 1; t += 1 / 60) g.update(1 / 60, true, null)
    g.update(1 / 60, false, null)
    const folding = g.object.rotation.y
    // 0.75, not 0.5, for the same reason as the earlier stowed-pose regression test: the
    // symmetric sweep is exactly zero at progress 0.5, which would mask a wrongly-open gate.
    g.update(1 / 60, false, 0.75)
    expect(g.object.rotation.y).toBeCloseTo(folding, 6)
  })
})
