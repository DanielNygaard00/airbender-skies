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
    // A point off both axes, so a swapped or unflipped axis is visible: a point on
    // an axis (x=0 or y=0) would pass either bug silently.
    const model = reticleModel({ x: 0.5, y: 0.5, z: 0 }, false)
    expect(model.x).toBeCloseTo(0.75)
    expect(model.y).toBeCloseTo(0.25)
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

  it('passes hot through unchanged in both directions', () => {
    expect(reticleModel({ x: 0, y: 0, z: 0 }, true).hot).toBe(true)
    expect(reticleModel({ x: 0, y: 0, z: 0 }, false).hot).toBe(false)
  })
})
