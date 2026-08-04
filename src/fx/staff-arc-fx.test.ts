import { describe, it, expect } from 'vitest'
import { Group, Mesh, RingGeometry, Vector3 } from 'three'
import { createStaffArc } from './staff-arc-fx'
import { inCone } from '../combat/cone'
import { staffShape } from '../combat/staff-arc'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import type { Effect } from './effect'

const A = DEFAULT_COMBAT_CONFIG.staffArc
const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)

function meshes(effect: Effect): Mesh[] {
  const object = effect.object
  if (!(object instanceof Group)) throw new Error('expected a group')
  return object.children.filter((c): c is Mesh => c instanceof Mesh)
}

/**
 * Whether a point lies inside the sector as actually drawn — read off the mesh's own
 * RingGeometry parameters and its real world transform.
 *
 * The brief's own version of this check re-derives the boundary from `shape.halfAngle`
 * directly, independent of the mesh. That comparison passes even when the geometry's real
 * `thetaStart`/`thetaLength` are built wrong (verified: widening the drawn sector by 20
 * degrees in the implementation left that version green), because it never inspects what
 * was actually rendered. Reading `geometry.parameters`, as `gust-cone.test.ts` does, closes
 * that gap while keeping the assertion a comparison against `inCone` rather than against
 * this test's own maths.
 */
function drawnContains(fill: Mesh, point: Vector3): boolean {
  const geometry = fill.geometry
  if (!(geometry instanceof RingGeometry)) throw new Error('expected a RingGeometry')
  const p = geometry.parameters
  const local = fill.worldToLocal(point.clone())
  const radius = Math.hypot(local.x, local.y)
  if (radius > p.outerRadius) return false
  // Mirrors inCone's own degenerate-distance guard, so a point sitting exactly on the
  // caster does not depend on where the sector's theta happens to start.
  if (radius < 1e-6) return false

  let relative = Math.atan2(local.y, local.x) - p.thetaStart
  const turn = Math.PI * 2
  relative = ((relative % turn) + turn) % turn
  return relative <= p.thetaLength
}

describe('createStaffArc', () => {
  it('draws the shape it was handed, not a fixed one', () => {
    const opener = createStaffArc(ORIGIN, NORTH, staffShape(false, A))
    const finisher = createStaffArc(ORIGIN, NORTH, staffShape(true, A))
    const radius = (e: Effect) => Math.max(...meshes(e).map((m) => m.scale.x || 1))
    expect(radius(finisher)).toBeGreaterThan(radius(opener))
  })

  it('agrees with inCone about what is inside the sweep', () => {
    // The honesty rule this repo holds attack effects to: a hit landing outside the drawn
    // arc reads as a bug. Checked against inCone, a different mechanism from the geometry.
    // Necessary but not sufficient — the gust cone passed a check like this while being
    // invisible on screen, so the in-game pass is what confirms it can be seen.
    const shape = staffShape(false, A)
    const arc = createStaffArc(ORIGIN, NORTH, shape)
    const fill = meshes(arc)[0]
    if (!fill) throw new Error('expected a fill mesh')
    arc.object.updateMatrixWorld(true)

    for (let angle = -Math.PI; angle < Math.PI; angle += Math.PI / 24) {
      for (const r of [shape.range * 0.5, shape.range * 1.4]) {
        const point = new Vector3(Math.sin(angle) * r, 0, -Math.cos(angle) * r)
        const expected = inCone(ORIGIN, NORTH, point, shape)
        const inSector = drawnContains(fill, point)
        expect({ angle, r, inSector }).toEqual({ angle, r, inSector: expected })
      }
    }
  })

  it('runs and then finishes', () => {
    const arc = createStaffArc(ORIGIN, NORTH, staffShape(false, A))
    expect(arc.advance(0.01)).toBe(true)
    expect(arc.advance(5)).toBe(false)
  })

  it('fades out', () => {
    const arc = createStaffArc(ORIGIN, NORTH, staffShape(false, A))
    const first = meshes(arc)[0]
    if (!first) throw new Error('expected a mesh')
    const material = first.material
    if (Array.isArray(material)) throw new Error('expected one material')
    const start = material.opacity
    arc.advance(0.1)
    expect(material.opacity).toBeLessThan(start)
  })

  it('does not alias the position it was handed', () => {
    const at = ORIGIN.clone()
    createStaffArc(at, NORTH, staffShape(false, A))
    expect(at.toArray()).toEqual([0, 0, 0])
  })

  it('casts no shadow', () => {
    for (const m of meshes(createStaffArc(ORIGIN, NORTH, staffShape(false, A)))) {
      expect(m.userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes without throwing', () => {
    expect(() => createStaffArc(ORIGIN, NORTH, staffShape(false, A)).dispose()).not.toThrow()
  })
})
