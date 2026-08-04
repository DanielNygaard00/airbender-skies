import { describe, it, expect } from 'vitest'
import { Mesh, Quaternion, RingGeometry, Vector3 } from 'three'
import { createGustCone } from './gust-cone'
import { inGust } from '../combat/gust'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import type { Effect } from './effect'

const C = DEFAULT_COMBAT_CONFIG.gust
const ORIGIN = new Vector3(3, 12, -7)

/** The filled sector, which carries the true radius. children[0] by construction. */
function fill(cone: Effect): Mesh {
  const first = cone.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected the fill sector as children[0]')
  return first
}

function params(mesh: Mesh) {
  const geometry = mesh.geometry
  if (!(geometry instanceof RingGeometry)) throw new Error('expected a RingGeometry')
  return geometry.parameters
}

/**
 * Whether a point lies inside the sector as drawn.
 *
 * Deliberately asks the mesh's own world transform rather than reconstructing the
 * rotation: that way the test does not care HOW the orientation was achieved, only
 * whether the drawn shape and the hit test agree.
 */
function drawnContains(cone: Effect, point: Vector3): boolean {
  const mesh = fill(cone)
  cone.object.updateWorldMatrix(true, true)
  const local = mesh.worldToLocal(point.clone())
  const p = params(mesh)

  const radius = Math.hypot(local.x, local.y)
  if (radius > p.outerRadius) return false
  // Mirrors inGust's own degenerate-distance guard, so a point sitting exactly on the
  // caster does not depend on where the sector's theta happens to start.
  if (radius < 1e-6) return false

  let relative = Math.atan2(local.y, local.x) - p.thetaStart
  const turn = Math.PI * 2
  relative = ((relative % turn) + turn) % turn
  return relative <= p.thetaLength
}

/** Every sampled point where the hit test and the drawn shape disagree. */
function disagreements(forward: Vector3): string[] {
  const cone = createGustCone(ORIGIN, forward, C)
  // The cone is drawn at a fixed height above the origin; sample in that plane so the
  // 2D containment check is meaningful. `inGust` ignores height entirely.
  const y = fill(cone).getWorldPosition(new Vector3()).y

  const found: string[] = []
  for (let dx = -14; dx <= 14; dx += 1) {
    for (let dz = -14; dz <= 14; dz += 1) {
      const point = new Vector3(ORIGIN.x + dx, y, ORIGIN.z + dz)
      const hit = inGust(ORIGIN, forward, point, C)
      const drawn = drawnContains(cone, point)
      if (hit !== drawn) found.push(`(${dx},${dz}) hit=${hit} drawn=${drawn}`)
    }
  }
  return found
}

describe('createGustCone', () => {
  it('draws exactly the volume the gust hits', () => {
    // The promise of this effect is that what you see is what you hit. Verified by a
    // different mechanism than the code uses — sampling the real hit test against the
    // drawn geometry's own transform — rather than by asserting the geometry equals the
    // config, which would pass for any orientation.
    // Named offenders, so a failure is a bug report rather than a puzzle.
    expect(disagreements(new Vector3(0, 0, 1)).slice(0, 8)).toEqual([])
  })

  it('agrees with the hit test for a heading that is not an axis', () => {
    // An orientation bug can hide behind an axis-aligned heading.
    expect(disagreements(new Vector3(1, 0, 1).normalize()).slice(0, 8)).toEqual([])
  })

  it('agrees with the hit test for a backwards heading', () => {
    expect(disagreements(new Vector3(0, 0, -1)).slice(0, 8)).toEqual([])
  })

  it('lies flat rather than standing up', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    cone.object.updateWorldMatrix(true, true)
    const rotation = new Quaternion()
    fill(cone).getWorldQuaternion(rotation)
    // A RingGeometry's own normal is local +Z; laid flat it must point up or down.
    const normal = new Vector3(0, 0, 1).applyQuaternion(rotation)
    expect(Math.abs(normal.y)).toBeCloseTo(1, 3)
  })

  it('sits above the origin so the ground does not swallow it', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    cone.object.updateWorldMatrix(true, true)
    expect(fill(cone).getWorldPosition(new Vector3()).y).toBeGreaterThan(ORIGIN.y)
  })

  it('drives the leading arc outward across its life', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    const arc = cone.object.children[1]
    if (!arc) throw new Error('expected a leading arc as children[1]')

    const start = arc.scale.x
    cone.advance(0.08)
    const mid = arc.scale.x
    cone.advance(1)
    const end = arc.scale.x

    expect(start).toBeLessThan(mid)
    expect(mid).toBeLessThan(end)
    // It should finish at the gust's actual reach, not somewhere short of it.
    expect(end).toBeCloseTo(C.range, 1)
  })

  it('runs and then finishes', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    expect(cone.advance(0.05)).toBe(true)
    expect(cone.advance(5)).toBe(false)
  })

  it('fades out', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    const material = fill(cone).material
    if (Array.isArray(material)) throw new Error('expected a single material')
    const start = material.opacity
    expect(start).toBeGreaterThan(0)
    cone.advance(0.2)
    expect(material.opacity).toBeLessThan(start)
  })

  it('casts no shadow', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    for (const child of cone.object.children) {
      expect(child.userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes without throwing', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    expect(() => cone.dispose()).not.toThrow()
  })
})
