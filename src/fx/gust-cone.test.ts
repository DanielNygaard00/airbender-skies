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
  // `relative` (atan2 plus a modulo) and `p.thetaLength` (the config angle through the
  // geometry constructor) are two different float paths to the same boundary; a sample
  // landing exactly on the sector edge can disagree by an ulp. The epsilon resolves that
  // tie toward inclusion, matching inGust's own `>=`, and at 1e-9 radians sits ~10 orders
  // of magnitude below the ~20-degree error this assertion exists to catch.
  return relative <= p.thetaLength + 1e-9
}

/** Every sampled point where the hit test and the drawn shape disagree. */
function disagreements(forward: Vector3): string[] {
  const cone = createGustCone(ORIGIN, forward, C)
  // The cone is drawn at a fixed height above the origin; sample in that plane so the
  // 2D containment check is meaningful. That plane has to sit inside the gust's
  // `verticalReach`, which the drawn height comfortably does — and if it ever stopped
  // doing so, every sampled point would disagree and this test would say so rather than
  // going quiet. What it compares is the drawn sector against the gust's horizontal
  // footprint; the slab's thickness is deliberately not drawn, which the design records
  // as a known cosmetic mismatch for the visuals phase.
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
  it('draws exactly the footprint the gust hits, and deliberately says nothing about its height', () => {
    // What this covers: the drawn sector matches the cone's horizontal footprint. Verified by
    // a different mechanism than the code uses — sampling the real hit test against the drawn
    // geometry's own transform — rather than by asserting the geometry equals the config,
    // which would pass for any orientation.
    //
    // What it does not cover, stated because the name used to promise it: the hit volume is a
    // slab of half-height `verticalReach` and this shape is a flat sector, so the effect
    // under-draws what the move hits by twice that in height. Giving the effect a real
    // thickness is visuals work with its own cycle. **A green run here is not evidence that
    // the hit volume is flat**, which is the exact misreading the design set out to prevent.
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

  it('keeps the leading arc off a zero scale on the frame it is born', () => {
    // The one scale floor in this directory that its own effect reaches unaided, and it does so
    // on every gust ever cast: `apply` scales the arc by `t * c.range`, and `t` is zero on the
    // first call, so without the `Math.max(..., 1e-4)` the arc would carry a scale of exactly
    // zero for one frame — a collapsed matrix, every time. The same floor in the other effects
    // here only bounds what a caller passes in; this one is live in the shipped game, which is
    // why it gets a test of its own rather than a zero-config one.
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    const born = cone.object.children[1]
    if (!(born instanceof Mesh)) throw new Error('expected a leading arc as children[1]')
    expect(born.scale.x).toBeGreaterThan(0)
    cone.dispose()
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

  it('draws over the world rather than being buried by it', () => {
    // Regression guard on a defect found only by playing: with depth testing on, a flat
    // sector a metre above the player's feet is hidden by ground that slopes up away from
    // them, and the whole effect is invisible. The shape was never wrong; the terrain was
    // simply in front of it.
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    for (const child of cone.object.children) {
      if (!(child instanceof Mesh)) throw new Error('expected meshes')
      const material = child.material
      if (Array.isArray(material)) throw new Error('expected a single material')
      expect(material.depthTest).toBe(false)
    }
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
