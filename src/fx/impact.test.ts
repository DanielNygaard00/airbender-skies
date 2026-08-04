import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { createImpact } from './impact'
import type { Effect } from './effect'

const AT = new Vector3(4, 9, -2)

function shell(impact: Effect): Mesh {
  const object = impact.object
  if (!(object instanceof Mesh)) throw new Error('expected a mesh')
  return object
}

/** Run to completion, returning how many frames it took. */
function framesToFinish(impact: Effect, dt = 1 / 60): number {
  let frames = 0
  while (impact.advance(dt) && frames < 1000) frames += 1
  return frames
}

const finalRadius = (impact: Effect) => {
  impact.advance(10)
  return shell(impact).scale.x
}

describe('createImpact', () => {
  it('lands on the body rather than at its feet', () => {
    expect(shell(createImpact(AT, 'hit')).position.y).toBeGreaterThan(AT.y)
  })

  it('keeps the horizontal position it was given', () => {
    const mesh = shell(createImpact(AT, 'hit'))
    expect(mesh.position.x).toBeCloseTo(AT.x)
    expect(mesh.position.z).toBeCloseTo(AT.z)
  })

  it('does not alias the position it was handed', () => {
    // The caller passes an enemy's live position vector; writing the height offset into
    // it would teleport the enemy upward.
    const at = AT.clone()
    createImpact(at, 'hit')
    expect(at.y).toBeCloseTo(AT.y)
  })

  it('makes a down materially bigger than a hit', () => {
    // A down is the louder statement — it has to be distinguishable at a glance, not
    // just fractionally larger.
    expect(finalRadius(createImpact(AT, 'down')))
      .toBeGreaterThan(finalRadius(createImpact(AT, 'hit')) * 1.5)
  })

  it('makes a down last materially longer than a hit', () => {
    expect(framesToFinish(createImpact(AT, 'down')))
      .toBeGreaterThan(framesToFinish(createImpact(AT, 'hit')) * 1.5)
  })

  it('grows from small to full', () => {
    const impact = createImpact(AT, 'hit')
    const start = shell(impact).scale.x
    impact.advance(0.05)
    const mid = shell(impact).scale.x
    expect(start).toBeLessThan(mid)
  })

  it('fades out', () => {
    const impact = createImpact(AT, 'hit')
    const material = shell(impact).material
    if (Array.isArray(material)) throw new Error('expected a single material')
    const start = material.opacity
    expect(start).toBeGreaterThan(0)
    impact.advance(0.12)
    expect(material.opacity).toBeLessThan(start)
  })

  it('runs and then finishes, for both kinds', () => {
    for (const kind of ['hit', 'down'] as const) {
      const impact = createImpact(AT, kind)
      expect(impact.advance(0.01)).toBe(true)
      expect(impact.advance(5)).toBe(false)
    }
  })

  it('casts no shadow', () => {
    for (const kind of ['hit', 'down'] as const) {
      expect(shell(createImpact(AT, kind)).userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes without throwing', () => {
    expect(() => createImpact(AT, 'down').dispose()).not.toThrow()
  })
})
