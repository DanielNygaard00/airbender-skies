import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { reticleModel } from './reticle'

function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(70, 1, 0.1, 100)
  cam.position.set(0, 0, 0)
  cam.lookAt(0, 0, -1)
  cam.updateMatrixWorld()
  return cam
}

describe('reticleModel', () => {
  it('maps NDC origin to the centre of the viewport', () => {
    const model = reticleModel({ x: 0, y: 0, z: 0 }, false)
    expect(model.x).toBeCloseTo(0.5)
    expect(model.y).toBeCloseTo(0.5)
  })

  it('flips the y axis: NDC +1 is the top of the screen, CSS 0 is', () => {
    // x and z deliberately distinct (0.5 vs -0.25), not just off-axis: a point on an
    // axis, or one where x and y happen to match, would pass a swap that preserves
    // the flip — x: (ndc.y + 1) / 2, y: (1 - ndc.x) / 2 — as silently as it would
    // pass an unflipped axis. Distinct inputs make both bugs visible.
    const model = reticleModel({ x: 0.5, y: -0.25, z: 0 }, false)
    expect(model.x).toBeCloseTo(0.75)
    expect(model.y).toBeCloseTo(0.625)
  })

  it('is visible for a point within the depth range', () => {
    expect(reticleModel({ x: 0, y: 0, z: 0.9 }, false).visible).toBe(true)
    expect(reticleModel({ x: 0, y: 0, z: -1 }, false).visible).toBe(true)
    expect(reticleModel({ x: 0, y: 0, z: 1 }, false).visible).toBe(true)
  })

  it('is not visible for a point beyond the far plane or in front of the near one', () => {
    expect(reticleModel({ x: 0, y: 0, z: 1.0001 }, false).visible).toBe(false)
    expect(reticleModel({ x: 0, y: 0, z: -1.0001 }, false).visible).toBe(false)
  })

  it('is not visible for a point behind the camera', () => {
    // The case that matters: Vector3.project reports a point behind the camera
    // with z outside [-1, 1] (here, past the far-plane end of the range) even
    // though x and y still come out as ordinary finite numbers — mirrored across
    // the screen from where the point would land if it were in front. A naive
    // (x + 1) / 2 with no z check would happily draw that mirrored reticle.
    const behind = new Vector3(2, 0, 5).project(camera())
    expect(behind.z).toBeGreaterThan(1)
    expect(reticleModel(behind, false).visible).toBe(false)
  })

  it('is not visible when any single component is not finite', () => {
    // One case per component, and separately per component, because a guard that
    // checks only x passes a table that only ever corrupts x. Each row leaves the
    // other two components inside the visible depth range, so the only thing that
    // can make the model invisible is the component named.
    const bad = [NaN, Infinity, -Infinity]
    for (const value of bad) {
      expect(reticleModel({ x: value, y: 0, z: 0 }, false).visible).toBe(false)
      expect(reticleModel({ x: 0, y: value, z: 0 }, false).visible).toBe(false)
      expect(reticleModel({ x: 0, y: 0, z: value }, false).visible).toBe(false)
    }
  })

  it('hides the half-position a camera with a non-finite aspect produces', () => {
    // Not a hypothetical: a canvas measured at 0x0 makes width / height 0/0, and a
    // PerspectiveCamera built on that aspect projects to an x of NaN while y and z
    // stay ordinary finite numbers well inside the depth range. Deciding from z
    // alone reports visible: true with only half a position, and a DOM view then
    // places the reticle at a stale horizontal position while it still tracks
    // vertically -- confidently wrong, which is exactly what the depth check above
    // exists to avoid. Built through three.js rather than hand-written so it is the
    // real projection's output being asserted, not a guess at it.
    const zeroSized = new PerspectiveCamera(70, 0 / 0, 0.1, 100)
    zeroSized.position.set(0, 0, 0)
    zeroSized.lookAt(0, 0, -1)
    zeroSized.updateMatrixWorld()
    zeroSized.updateProjectionMatrix()

    const ndc = new Vector3(0, 0, -12).project(zeroSized)
    expect(Number.isNaN(ndc.x)).toBe(true)
    expect(Number.isFinite(ndc.y)).toBe(true)
    expect(Number.isFinite(ndc.z)).toBe(true)
    expect(ndc.z).toBeGreaterThanOrEqual(-1)
    expect(ndc.z).toBeLessThanOrEqual(1)

    expect(reticleModel(ndc, false).visible).toBe(false)
  })

  it('passes hot through unchanged in both directions', () => {
    expect(reticleModel({ x: 0, y: 0, z: 0 }, true).hot).toBe(true)
    expect(reticleModel({ x: 0, y: 0, z: 0 }, false).hot).toBe(false)
  })
})
