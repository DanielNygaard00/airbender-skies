import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { createSlipstreamTrail } from './slipstream-trail'
import { DEFAULT_SLIPSTREAM_CONFIG as S } from '../core/config'
import type { Effect } from './effect'

const AT = new Vector3(2, 8, -3)
const NORTH = new Vector3(0, 0, -1)

function mesh(effect: Effect): Mesh {
  if (!(effect.object instanceof Mesh)) throw new Error('expected a mesh')
  return effect.object
}

describe('createSlipstreamTrail', () => {
  it('is as long as the dash actually travels', () => {
    // Derived from config rather than a chosen number, so retuning the dash retunes
    // the streak with it.
    const trail = createSlipstreamTrail(AT, NORTH, S)
    expect(mesh(trail).scale.z).toBeCloseTo(S.speed * S.durationSeconds, 0)
  })

  it('keeps a positive length for a config that covers no ground', () => {
    // The `Math.max(..., 1e-4)` floor on the length, which this effect's own arithmetic cannot
    // reach: `speed * durationSeconds` is a product of two shipped positives. It bounds the
    // config, and a zero scale is a degenerate matrix — the same reason and the same shape as
    // the floors in `vortex-ring.ts` and `shockwave.ts`, which are pinned the same way.
    const trail = createSlipstreamTrail(AT, NORTH, { ...S, speed: 0 })
    expect(mesh(trail).scale.z).toBeGreaterThan(0)
  })

  it('does not alias the position it was handed', () => {
    const at = AT.clone()
    createSlipstreamTrail(at, NORTH, S)
    expect(at.toArray()).toEqual(AT.toArray())
  })

  it('fades out', () => {
    const trail = createSlipstreamTrail(AT, NORTH, S)
    const material = mesh(trail).material
    if (Array.isArray(material)) throw new Error('expected one material')
    const start = material.opacity
    trail.advance(0.1)
    expect(material.opacity).toBeLessThan(start)
  })

  it('runs and then finishes', () => {
    const trail = createSlipstreamTrail(AT, NORTH, S)
    expect(trail.advance(0.01)).toBe(true)
    expect(trail.advance(5)).toBe(false)
  })

  it('casts no shadow', () => {
    expect(mesh(createSlipstreamTrail(AT, NORTH, S)).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    expect(() => createSlipstreamTrail(AT, NORTH, S).dispose()).not.toThrow()
  })
})
