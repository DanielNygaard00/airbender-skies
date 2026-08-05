import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry, sectorTheta } from './sector'
import { inCone, type ConeShape } from '../combat/cone'

const ORIGIN = new Vector3(0, 0, 0)
const FORWARD = new Vector3(0, 0, 1)

/**
 * Where a point at pre-rotation angle `theta` ends up once the sector is laid flat.
 *
 * Derived rather than copied from the implementation: a rotation of -PI/2 about X maps
 * (x, y, z) to (x, z, -y), so a point at (cos t, sin t, 0) in the authored XY plane lands
 * at (cos t, 0, -sin t) in the world. This is the mapping the whole convention rests on,
 * and expressing it here rather than importing it is what makes the test independent.
 */
function flattened(theta: number, radius: number): Vector3 {
  return new Vector3(Math.cos(theta) * radius, 0, -Math.sin(theta) * radius)
}

describe('the flat-sector convention', () => {
  it('lays a sector flat by a quarter turn backwards about X', () => {
    expect(SECTOR_FLAT_ROTATION_X).toBeCloseTo(-Math.PI / 2)
  })

  it('centres the span on +Z once flat', () => {
    // The midpoint of the span must map to the heading itself. If this is wrong, every
    // cone in the game is drawn rotated away from the volume it claims to show.
    const halfAngle = Math.PI / 3
    const { thetaStart, thetaLength } = sectorTheta(halfAngle)
    const mid = flattened(thetaStart + thetaLength / 2, 1)
    expect(mid.x).toBeCloseTo(0)
    expect(mid.z).toBeCloseTo(1)
  })

  it('spans exactly twice the half angle', () => {
    expect(sectorTheta(Math.PI / 3).thetaLength).toBeCloseTo((2 * Math.PI) / 3)
    expect(sectorTheta(Math.PI / 6).thetaLength).toBeCloseTo(Math.PI / 3)
  })

  it('puts its edges exactly the half angle off the heading', () => {
    const halfAngle = Math.PI / 5
    const { thetaStart, thetaLength } = sectorTheta(halfAngle)
    for (const theta of [thetaStart, thetaStart + thetaLength]) {
      expect(flattened(theta, 1).angleTo(FORWARD)).toBeCloseTo(halfAngle)
    }
  })
})

describe('the drawn span agrees with the hit test', () => {
  // The same cross-check gust-cone.test.ts uses on the fired cone, applied to the helper:
  // compare the drawn sector against inCone, which decides membership by a completely
  // different mechanism (a dot product against the heading).
  const shape: ConeShape = { range: 12, halfAngle: Math.PI / 3 }

  it('marks every direction inside the span as inside the cone', () => {
    const { thetaStart, thetaLength } = sectorTheta(shape.halfAngle)
    // Inset from the edges, so floating point at the boundary is not what is under test.
    for (let i = 1; i < 20; i++) {
      const theta = thetaStart + (thetaLength * i) / 20
      const point = flattened(theta, shape.range * 0.5)
      expect(inCone(ORIGIN, FORWARD, point, shape), `theta ${theta}`).toBe(true)
    }
  })

  it('marks directions outside the span as outside the cone', () => {
    const { thetaStart, thetaLength } = sectorTheta(shape.halfAngle)
    for (const theta of [thetaStart - 0.15, thetaStart + thetaLength + 0.15]) {
      const point = flattened(theta, shape.range * 0.5)
      expect(inCone(ORIGIN, FORWARD, point, shape), `theta ${theta}`).toBe(false)
    }
  })
})

describe('the geometry', () => {
  it('reaches exactly the outer radius', () => {
    const geometry = sectorGeometry(Math.PI / 3, 0, 12)
    // A literal 12, not the argument echoed back: the point is that the geometry is built
    // at the radius it was asked for. Checked via the farthest vertex from the origin
    // rather than geometry.computeBoundingSphere(): three.js centres that sphere on the
    // bounding box's centroid, not on the apex, so for a wedge this narrow the reported
    // sphere radius undershoots the true reach even though every vertex is correctly
    // placed. Confirmed empirically before relying on it: the box centroid for this wedge
    // sits at (0, -6), giving a reported radius of ~10.39, while the actual farthest vertex
    // is exactly at 12 as expected.
    const positions = geometry.getAttribute('position')
    let farthest = 0
    for (let i = 0; i < positions.count; i++) {
      farthest = Math.max(farthest, Math.hypot(positions.getX(i), positions.getY(i)))
    }
    expect(farthest).toBeCloseTo(12, 1)
    geometry.dispose()
  })

  it('leaves a hole when given an inner radius', () => {
    // The arc in gust-cone.ts is a ring, not a wedge, so this parameter has to work.
    const ring = sectorGeometry(Math.PI / 3, 0.84, 1)
    const positions = ring.getAttribute('position')
    let closest = Infinity
    for (let i = 0; i < positions.count; i++) {
      closest = Math.min(closest, Math.hypot(positions.getX(i), positions.getY(i)))
    }
    expect(closest).toBeCloseTo(0.84, 5)
    ring.dispose()
  })
})
