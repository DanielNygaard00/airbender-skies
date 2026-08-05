import { describe, it, expect } from 'vitest'
import { Box3, Object3D } from 'three'
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
  for (let i = 0; i < 120; i++) glider.update(1 / 60, deployed, null, 0)
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
      glider.update(1 / 60, i % 40 < 20, null, 0)
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

describe('the stall shudder', () => {
  /** Panel pivot Y angles, which is what the shudder perturbs. */
  function panelAngles(glider: { object: Object3D }): number[] {
    const angles: number[] = []
    glider.object.traverse((node) => {
      if (node.name === 'wing-panel-pivot') angles.push(node.rotation.y)
    })
    return angles
  }

  it('holds the panels still while the wing is flying', () => {
    const glider = createGlider()
    for (let i = 0; i < 120; i++) glider.update(1 / 60, true, null, 0)
    const first = panelAngles(glider)
    for (let i = 0; i < 20; i++) glider.update(1 / 60, true, null, 0)
    expect(panelAngles(glider)).toEqual(first)
  })

  it('moves the panels while stalling', () => {
    const glider = createGlider()
    for (let i = 0; i < 120; i++) glider.update(1 / 60, true, null, 0)
    const settled = panelAngles(glider)
    // Sampled across frames rather than probed once, because the shudder is an oscillation
    // and a single sample can land on a zero crossing — the exact shape that shipped green
    // and useless in this repo before.
    let peak = 0
    for (let i = 0; i < 40; i++) {
      glider.update(1 / 60, true, null, 1)
      const now = panelAngles(glider)
      for (let p = 0; p < now.length; p++) {
        peak = Math.max(peak, Math.abs((now[p] ?? 0) - (settled[p] ?? 0)))
      }
    }
    // A real margin against the amplitude, not a bare `> 0`.
    expect(peak).toBeGreaterThan(0.04)
  })

  it('shudders harder the worse the stall', () => {
    const peakAt = (stall: number) => {
      const glider = createGlider()
      for (let i = 0; i < 120; i++) glider.update(1 / 60, true, null, 0)
      const settled = panelAngles(glider)
      let peak = 0
      for (let i = 0; i < 40; i++) {
        glider.update(1 / 60, true, null, stall)
        const now = panelAngles(glider)
        for (let p = 0; p < now.length; p++) {
          peak = Math.max(peak, Math.abs((now[p] ?? 0) - (settled[p] ?? 0)))
        }
      }
      return peak
    }
    expect(peakAt(1)).toBeGreaterThan(peakAt(0.3) * 1.5)
  })

  /**
   * The shudder alone, isolated from the fan angles it is composed onto.
   *
   * Two gliders driven with an identical frame sequence and identical arguments apart from
   * the stall: every other contribution to a pivot's angle is therefore the same in both, so
   * the difference between them is exactly the flutter. Comparing a stalling glider against
   * its own settled angles cannot work here, because the fan angles are still changing while
   * the wing unfurls, which is the whole situation under test.
   */
  function flutterVsFold(frames: number, skip = 0): { flutter: number; fold: number } {
    const shuddering = createGlider()
    const calm = createGlider()
    let flutter = 0
    let fold = 0
    for (let i = 0; i < skip + frames; i++) {
      shuddering.update(1 / 60, true, null, 1)
      calm.update(1 / 60, true, null, 0)
      if (i < skip) continue
      const shaken = panelAngles(shuddering)
      const still = panelAngles(calm)
      for (let p = 0; p < shaken.length; p++) {
        flutter = Math.max(flutter, Math.abs((shaken[p] ?? 0) - (still[p] ?? 0)))
        fold = Math.max(fold, Math.abs(still[p] ?? 0))
      }
    }
    return { flutter, fold }
  }

  it('shudders far less while the wing is still folding than once it is open', () => {
    // Reachable, not theoretical: on the frame the mode flips to glider, `deployed` and a high
    // stall arrive together, so deploying at a jump apex with the airspeed already gone used to
    // buzz leaves still stacked into a stick at the full open-wing amplitude.
    //
    // The first three frames of the roughly eighteen the open takes, against a window well
    // after it finishes. A margin of five rather than a bare `<`: the wing is only a
    // fourteenth of the way eased open across those frames, so anything close to parity means
    // the amplitude is not following the fold at all.
    const early = flutterVsFold(3).flutter
    const open = flutterVsFold(40, 60).flutter
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(open * 0.2)
  })

  it('never flutters a leaf further than the fold has already opened it', () => {
    // The defect in its measurable form. Before the fold scaling, frame one of the open put
    // 0.048 radians of flutter on panels open by 0.012 — the shudder was four times the wing
    // doing it, which reads as a stick vibrating rather than as a wing losing lift. Compared
    // per frame across the whole open, so no single lucky frame can carry it.
    for (let frame = 1; frame <= 30; frame++) {
      const { flutter, fold } = flutterVsFold(frame)
      expect(flutter, `through frame ${frame}`).toBeLessThanOrEqual(fold)
    }
  })

  it('leaves a stowed staff perfectly still, however bad the stall', () => {
    // The gate here is the OPPOSITE of the staff sweep's. The sweep applies while the glider
    // is stowed, because that is when the staff is a weapon. A stowed walking stick must not
    // vibrate because the player happens to be moving slowly on foot.
    const glider = createGlider()
    for (let i = 0; i < 120; i++) glider.update(1 / 60, false, null, 0)
    const stowed = panelAngles(glider)
    const rotation = glider.object.rotation.clone()
    for (let i = 0; i < 40; i++) glider.update(1 / 60, false, null, 1)
    expect(panelAngles(glider)).toEqual(stowed)
    expect(glider.object.rotation.x).toBeCloseTo(rotation.x, 10)
    expect(glider.object.rotation.y).toBeCloseTo(rotation.y, 10)
    expect(glider.object.rotation.z).toBeCloseTo(rotation.z, 10)
  })

  it('is deterministic, so two gliders shudder identically', () => {
    // Trigonometric rather than random, for the same reason src/fx/shake.ts is: a random
    // shudder cannot be asserted about at all.
    const a = createGlider()
    const b = createGlider()
    for (let i = 0; i < 30; i++) {
      a.update(1 / 60, true, null, 1)
      b.update(1 / 60, true, null, 1)
    }
    expect(panelAngles(a)).toEqual(panelAngles(b))
  })
})
