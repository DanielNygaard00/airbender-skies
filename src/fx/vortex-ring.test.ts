import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { createVortexRing } from './vortex-ring'
import type { Effect } from './effect'

const AT = new Vector3(3, 10, -4)

function mesh(effect: Effect): Mesh {
  if (!(effect.object instanceof Mesh)) throw new Error('expected a mesh')
  return effect.object
}

describe('createVortexRing', () => {
  it('starts at the radius it was given', () => {
    // The honesty rule this repo follows for the gust cone: the drawn size is the
    // size that was actually caught, so a pull outside the ring reads as a bug.
    expect(mesh(createVortexRing(AT, 9)).scale.x).toBeCloseTo(9, 3)
  })

  it('sweeps inward rather than outward', () => {
    // A vortex gathers. An expanding ring would read as a blast.
    const ring = createVortexRing(AT, 9)
    const start = mesh(ring).scale.x
    ring.advance(0.1)
    expect(mesh(ring).scale.x).toBeLessThan(start)
  })

  it('keeps a positive scale all the way in', () => {
    // A zero scale is a degenerate matrix.
    const ring = createVortexRing(AT, 9)
    ring.advance(10)
    expect(mesh(ring).scale.x).toBeGreaterThan(0)
  })

  it('runs and then finishes', () => {
    const ring = createVortexRing(AT, 9)
    expect(ring.advance(0.01)).toBe(true)
    expect(ring.advance(5)).toBe(false)
  })

  it('casts no shadow', () => {
    expect(mesh(createVortexRing(AT, 9)).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    expect(() => createVortexRing(AT, 9).dispose()).not.toThrow()
  })
})
