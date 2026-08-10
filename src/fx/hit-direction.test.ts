import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { HIT_MARK_SECONDS, bearingFromCamera, markFor, stepHitMarks, type HitMark } from './hit-direction'
import type { PlayerHit } from '../combat/encounter'

// Camera looking toward world -Z, matching three.js's default camera orientation
// (forward -Z, up +Y). For that orientation `forward × up` — the camera's own
// screen-right — is world +X, so a source at world +X is the right-hand case below
// and world -X is the left-hand one.
const FORWARD_NORTH = new Vector3(0, 0, -1)
const PLAYER = new Vector3(0, 0, 0)

describe('bearingFromCamera', () => {
  it('reports zero for a source dead ahead', () => {
    expect(bearingFromCamera(FORWARD_NORTH, PLAYER, new Vector3(0, 0, -5))).toBeCloseTo(0)
  })

  it('reports the antipode for a source directly behind, sign unspecified', () => {
    // The one case where a magnitude assertion is correct: at the exact antipode,
    // +π and -π are the same turn, and either sign a correct implementation
    // produces is right. Everywhere else in this file the sign is the point.
    expect(Math.abs(bearingFromCamera(FORWARD_NORTH, PLAYER, new Vector3(0, 0, 5)))).toBeCloseTo(Math.PI)
  })

  it('reports a positive bearing for a source to the right and negative for the left', () => {
    // Signed values, not magnitudes: a mirrored left/right implementation would pass
    // a test written against Math.abs, and it would be the single error that makes
    // this feature send the player turning away from what hit them.
    expect(bearingFromCamera(FORWARD_NORTH, PLAYER, new Vector3(5, 0, 0))).toBeCloseTo(Math.PI / 2)
    expect(bearingFromCamera(FORWARD_NORTH, PLAYER, new Vector3(-5, 0, 0))).toBeCloseTo(-Math.PI / 2)
  })

  it('reports a signed quarter-turn for a source at 45 degrees', () => {
    // Front-right: between dead ahead (0) and full right (+π/2).
    expect(bearingFromCamera(FORWARD_NORTH, PLAYER, new Vector3(5, 0, -5))).toBeCloseTo(Math.PI / 4)
    // Front-left: the mirror image, negative.
    expect(bearingFromCamera(FORWARD_NORTH, PLAYER, new Vector3(-5, 0, -5))).toBeCloseTo(-Math.PI / 4)
  })

  it('reports a defined, finite bearing for a source directly above the player', () => {
    // No horizontal offset at all — the degenerate case a naive normalise turns
    // into NaN. Same guard shape as inCone's distance guard.
    const bearing = bearingFromCamera(FORWARD_NORTH, PLAYER, new Vector3(0, 20, 0))
    expect(Number.isFinite(bearing)).toBe(true)
    expect(bearing).toBeCloseTo(0)
  })

  it('reports a defined, finite bearing when the camera itself points straight down', () => {
    // Flattening a vertical forward leaves nothing to normalise. The source is at
    // a real horizontal offset, so this exercises the *forward* guard specifically,
    // not the source-distance one above.
    const straightDown = new Vector3(0, -1, 0)
    const bearing = bearingFromCamera(straightDown, PLAYER, new Vector3(5, 0, 0))
    expect(Number.isFinite(bearing)).toBe(true)
  })
})

describe('markFor', () => {
  it('starts a mark at HIT_MARK_SECONDS with the bearing bearingFromCamera would give', () => {
    const hit: PlayerHit = { from: new Vector3(5, 0, 0), damage: 10 }
    const mark = markFor(FORWARD_NORTH, PLAYER, hit)
    expect(mark.life).toBe(HIT_MARK_SECONDS)
    expect(mark.bearing).toBeCloseTo(bearingFromCamera(FORWARD_NORTH, PLAYER, hit.from))
  })
})

describe('stepHitMarks', () => {
  it('reduces every life by dt and preserves order', () => {
    const marks: HitMark[] = [
      { bearing: 0, life: 1 },
      { bearing: 1, life: 0.5 },
      { bearing: 2, life: 0.2 },
    ]
    const stepped = stepHitMarks(marks, 0.1)
    expect(stepped.map((m) => m.bearing)).toEqual([0, 1, 2])
    expect(stepped[0]?.life).toBeCloseTo(0.9)
    expect(stepped[1]?.life).toBeCloseTo(0.4)
    expect(stepped[2]?.life).toBeCloseTo(0.1)
  })

  it('drops a mark whose life reaches exactly zero and keeps one with life remaining', () => {
    // The boundary is where an off-by-one lives, so it is pinned exactly rather
    // than with a value merely close to it.
    const marks: HitMark[] = [
      { bearing: 0, life: 0.5 },
      { bearing: 1, life: 0.5 + 1e-9 },
    ]
    const stepped = stepHitMarks(marks, 0.5)
    expect(stepped).toHaveLength(1)
    expect(stepped[0]?.bearing).toBe(1)
  })

  it('never recomputes a mark bearing while ageing it', () => {
    // Deliberate design choice: a mark is fixed at the bearing it was struck at, so
    // turning toward it leaves the wedge behind rather than dragging it around.
    // "Recompute every frame" is the tempting wrong instinct this pins against.
    const marks: HitMark[] = [{ bearing: Math.PI / 3, life: 1 }]
    const stepped = stepHitMarks(marks, 0.3)
    expect(stepped[0]?.bearing).toBe(Math.PI / 3)
  })
})
