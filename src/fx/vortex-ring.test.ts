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

  it('closes to a legible fraction of where it started, not to nothing', () => {
    // What `END_FRACTION` is for: the ring stays readable as it shuts. Asserted as the
    // fraction rather than as "greater than zero", because greater-than-zero cannot fail
    // while `apply`'s `Math.max(..., 1e-4)` floor is in place — the floor makes any scale
    // positive for every input, so that form of the assertion tested nothing about this
    // sweep and would have passed with END_FRACTION set to 0, a ring collapsing to a point.
    const ring = createVortexRing(AT, 9)
    const start = mesh(ring).scale.x
    ring.advance(10)
    const end = mesh(ring).scale.x
    // Bounded on both sides rather than pinned to END_FRACTION's exact value, so a retune
    // stays free while both degenerate ends redden: a collapse to the floor fails the lower
    // bound, and a ring that never really closes fails the upper one.
    expect(end).toBeGreaterThan(start * 0.05)
    expect(end).toBeLessThan(start * 0.5)
  })

  it('keeps a positive scale for a zero radius, which only a caller can hand it', () => {
    // The `Math.max(..., 1e-4)` floor, which the sweep itself never reaches: END_FRACTION
    // 0.15 against the shipped minRadius of 5 bottoms out at 0.75. The floor is a bound on
    // the radius the caller passes in — `vortexRadius` lerps from `minRadius`, so a config
    // with a zero minimum, or a direct call like this one, is what reaches it. A zero scale
    // is a degenerate matrix, which is the thing being prevented.
    const ring = createVortexRing(AT, 0)
    expect(mesh(ring).scale.x).toBeGreaterThan(0)
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
