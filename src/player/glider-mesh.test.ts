import { describe, it, expect } from 'vitest'
import { Box3 } from 'three'
import { createGlider, PANELS_PER_SIDE } from './glider'

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

  it('has a staff, a tail fin, and one fan root per side', () => {
    // Counted by what each child is rather than by a bare total, so adding a part
    // cannot quietly satisfy this while a fan root has gone missing.
    const { children } = createGlider().object
    const fanRoots = children.filter((child) => child.children.length === PANELS_PER_SIDE)
    expect(fanRoots).toHaveLength(2)
    expect(children.filter((child) => child.name === 'tail-fin')).toHaveLength(1)
    expect(children).toHaveLength(4)
  })

  it('fans every leaf on a side from one shared pivot', () => {
    // REGRESSION: giving each leaf its own pivot spaced along the staff lays them
    // end-to-end when closed instead of stacking them. Asserting the structure
    // directly does not depend on how the transforms happen to compose.
    const glider = createGlider()
    const roots = glider.object.children.filter(
      (child) => child.children.length === PANELS_PER_SIDE,
    )
    expect(roots).toHaveLength(2)
    for (const root of roots) {
      expect(root.children).toHaveLength(PANELS_PER_SIDE)
    }
  })

  it('produces finite geometry when stowed', () => {
    const stowed = span(createGlider())
    for (const value of [stowed.x, stowed.y, stowed.z]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('sweeps much deeper fore-and-aft when deployed', () => {
    // The fan actually opens: leaves which stack into a stick when closed sweep out
    // into a membrane when open. This confirms the deployment animation is working.
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
    // REGRESSION: giving each leaf its own pivot spaced along the staff lays them
    // end-to-end when closed instead of stacking them. Spacing the pivots inflates
    // the stowed span so that the stowed glider ends up wider than the deployed one.
    // This ratio catches the bug: stowed span < deployed span.
    const stowed = span(createGlider())
    const glider = createGlider()
    settle(glider, true)
    expect(span(glider).x).toBeGreaterThan(stowed.x * 1.5)
  })

  // Where the deployed wing sits vertically is only meaningful against the rider it
  // rests on, so that assertion lives in avatar.test.ts, next to the posed model —
  // see "rests the deployed wing on the gliding rider's back". It replaces an
  // assertion here that max.y cleared 2, which described a standing rider and, by
  // measuring only the wing's highest corner, would have passed with the wing
  // buried in the body.

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

  it('carries the stowed staff behind the character, not on the chest', () => {
    // REGRESSION: local +Z is the character's FRONT, because Object3D.lookAt aligns
    // local +Z with the target (only Camera and Light use -Z). Extent-based
    // assertions cannot catch a sign error here; this one can.
    expect(span(createGlider()).box.max.z).toBeLessThan(0)
  })

  it('keeps the stowed staff clear of the ground', () => {
    // The avatar origin is at the feet, so a negative min.y means the staff clips
    // through the terrain while walking.
    expect(span(createGlider()).box.min.y).toBeGreaterThanOrEqual(0)
  })

  it('lies across the rider rather than out in front', () => {
    // This replaces an assertion that the whole wing stayed ahead of z 0, which
    // described a rider standing upright as a column at the origin. Gliding lays
    // the body flat from z -0.96 to +0.92, so the wing now spans the rider: part
    // ahead of the shoulders, most of it back over the legs.
    const glider = createGlider()
    settle(glider, true)
    const { box } = span(glider)
    expect(box.min.z).toBeLessThan(0)
    expect(box.max.z).toBeGreaterThan(0)
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

describe('the tail fin', () => {
  function fin(glider: ReturnType<typeof createGlider>) {
    const found = glider.object.children.find((child) => child.name === 'tail-fin')
    if (!found) throw new Error('tail fin missing')
    return found
  }

  it('unfurls with the wings instead of standing proud of a folded staff', () => {
    const stowed = createGlider()
    expect(fin(stowed).scale.y).toBe(0)

    const deployed = createGlider()
    settle(deployed, true)
    expect(fin(deployed).scale.y).toBeCloseTo(1, 3)
  })

  it('sits on the centre line so it cannot skew the span', () => {
    const glider = createGlider()
    settle(glider, true)
    const box = new Box3().setFromObject(fin(glider))
    expect(box.min.x).toBeCloseTo(box.max.x, 6)
  })

  it('adds no new rearmost point', () => {
    // The fan already sweeps back 1.04; a fin reaching past that would poke out
    // behind the wing and break the silhouette.
    const glider = createGlider()
    settle(glider, true)
    const wholeWing = span(glider).box
    const finBox = new Box3().setFromObject(fin(glider))
    expect(finBox.min.z).toBeGreaterThan(wholeWing.min.z)
  })

  it('rises above the staff when deployed', () => {
    const glider = createGlider()
    settle(glider, true)
    const finBox = new Box3().setFromObject(fin(glider))
    expect(finBox.max.y - finBox.min.y).toBeGreaterThan(0.2)
  })
})
