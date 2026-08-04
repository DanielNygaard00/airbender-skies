import { describe, it, expect } from 'vitest'
import { Mesh, Quaternion, Vector3 } from 'three'
import { createDashTrail } from './dash-trail'
import { DEFAULT_GROUND_CONFIG } from '../core/config'
import type { GroundConfig } from '../core/types'
import type { Effect } from './effect'

const ORIGIN = new Vector3(0, 5, 0)
const HEADING = new Vector3(0, 0, 1)

function streak(trail: Effect): Mesh {
  const first = trail.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected a streak mesh')
  return first
}

const lengthOf = (trail: Effect) => streak(trail).scale.z

function opacityOf(trail: Effect): number {
  const material = streak(trail).material
  if (Array.isArray(material)) throw new Error('expected a single material')
  return material.opacity
}

describe('createDashTrail', () => {
  it('marks the distance the dash actually covers', () => {
    // Asserted by responsiveness rather than by restating the product: doubling the dash
    // speed must lengthen the streak, which a hardcoded length would not do.
    const fast: GroundConfig = {
      ...DEFAULT_GROUND_CONFIG, dashSpeed: DEFAULT_GROUND_CONFIG.dashSpeed * 2,
    }
    const normal = lengthOf(createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG))
    const doubled = lengthOf(createDashTrail(ORIGIN, HEADING, 1, fast))
    expect(doubled).toBeGreaterThan(normal * 1.8)
  })

  it('lengthens with a longer dash duration too', () => {
    const slowBurn: GroundConfig = {
      ...DEFAULT_GROUND_CONFIG,
      dashDurationSeconds: DEFAULT_GROUND_CONFIG.dashDurationSeconds * 2,
    }
    const normal = lengthOf(createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG))
    expect(lengthOf(createDashTrail(ORIGIN, HEADING, 1, slowBurn)))
      .toBeGreaterThan(normal * 1.8)
  })

  it('makes the last dash of the chain louder than the first', () => {
    // The chain count is information the player has no other way to read, so the third
    // burst has to look different from the first. A margin, not a bare comparison.
    const first = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    const last = createDashTrail(
      ORIGIN, HEADING, DEFAULT_GROUND_CONFIG.maxDashChain, DEFAULT_GROUND_CONFIG,
    )
    expect(lengthOf(last)).toBeGreaterThan(lengthOf(first) * 1.2)
    expect(opacityOf(last)).toBeGreaterThan(opacityOf(first) * 1.2)
  })

  it('clamps a chain index outside the real range', () => {
    // Nothing should explode if a caller passes 0 or a number past the chain length.
    for (const chain of [0, -3, 99]) {
      const trail = createDashTrail(ORIGIN, HEADING, chain, DEFAULT_GROUND_CONFIG)
      expect(Number.isFinite(lengthOf(trail))).toBe(true)
      expect(lengthOf(trail)).toBeGreaterThan(0)
    }
  })

  it('never draws longer than the fullest chain, however large the index', () => {
    const last = lengthOf(createDashTrail(
      ORIGIN, HEADING, DEFAULT_GROUND_CONFIG.maxDashChain, DEFAULT_GROUND_CONFIG,
    ))
    expect(lengthOf(createDashTrail(ORIGIN, HEADING, 99, DEFAULT_GROUND_CONFIG)))
      .toBeCloseTo(last, 4)
  })

  it('points along the heading', () => {
    const trail = createDashTrail(ORIGIN, new Vector3(1, 0, 0), 1, DEFAULT_GROUND_CONFIG)
    trail.object.updateWorldMatrix(true, true)
    const rotation = new Quaternion()
    trail.object.getWorldQuaternion(rotation)
    // The streak is built along local +Z, so its world +Z must follow the heading.
    const along = new Vector3(0, 0, 1).applyQuaternion(rotation)
    expect(along.x).toBeCloseTo(1, 2)
    expect(Math.abs(along.z)).toBeLessThan(0.05)
  })

  it('runs and then finishes', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    expect(trail.advance(0.05)).toBe(true)
    expect(trail.advance(5)).toBe(false)
  })

  it('fades out', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    const start = opacityOf(trail)
    trail.advance(0.15)
    expect(opacityOf(trail)).toBeLessThan(start)
  })

  it('casts no shadow', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    expect(streak(trail).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    expect(() => trail.dispose()).not.toThrow()
  })
})
