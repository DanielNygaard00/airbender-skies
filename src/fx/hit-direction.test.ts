import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
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

  it('drops the vertical component entirely, agreeing with the purely-horizontal answer', () => {
    // Every other case in this file is either y = 0 or purely vertical. A source
    // with BOTH a horizontal and a vertical offset is the one case that actually
    // exercises "flattened" as a claim rather than a coincidence: an implementation
    // that measures the real 3D angle and only patches in a horizontal sign (a
    // plausible-looking "signed 3D angle" approach) agrees with the flattened
    // answer everywhere else in this file, but is measurably wrong here — the
    // vertical offset drags the magnitude toward 90 degrees. This is live rather
    // than theoretical: archers fire from height and the glider takes hits from
    // below.
    const level = bearingFromCamera(FORWARD_NORTH, PLAYER, new Vector3(5, 0, -5))
    const elevated = bearingFromCamera(FORWARD_NORTH, PLAYER, new Vector3(5, 20, -5))
    expect(elevated).toBeCloseTo(level)
    expect(elevated).toBeCloseTo(Math.PI / 4)
  })

  it('agrees with the camera\'s own right-hand basis vector, not just an assumed axis', () => {
    // The sign convention documented above (`forward × up` is positive) is checked
    // here against a real three.js camera's own matrixWorld, not merely asserted
    // against a hand-picked (0,0,-1) forward. If three.js's actual basis convention
    // ever disagreed with the hand-picked constant used elsewhere in this file, only
    // this test would notice.
    const camera = new PerspectiveCamera(70, 1, 0.1, 100)
    camera.position.set(0, 0, 0)
    camera.lookAt(0, 0, -1)
    camera.updateMatrixWorld()
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const source = camera.position.clone().add(right.clone().multiplyScalar(5))
    expect(bearingFromCamera(forward, camera.position, source)).toBeGreaterThan(0)
  })
})

describe('markFor', () => {
  it('starts a mark at HIT_MARK_SECONDS with the bearing bearingFromCamera would give', () => {
    // Pinned against the literal the brief specifies, not just the constant the
    // code itself reads — asserting only against HIT_MARK_SECONDS would pass even
    // if that constant silently drifted from the interface's documented value.
    expect(HIT_MARK_SECONDS).toBe(1.2)

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
