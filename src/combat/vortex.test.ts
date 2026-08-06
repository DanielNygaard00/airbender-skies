import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { vortexCharge, vortexRadius, vortexTargets, vortexImpulse } from './vortex'
import { spawnEnemy, horizontalDistance } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

const V = DEFAULT_COMBAT_CONFIG.vortex
const E = DEFAULT_COMBAT_CONFIG.enemies.spear
const ORIGIN = new Vector3(0, 0, 0)
const at = (x: number, z: number) => new Vector3(x, 0, z)
const enemyAt = (id: string, x: number, z: number) => spawnEnemy(id, at(x, z), 'spear', E)

describe('vortexCharge', () => {
  it('is 0 at the start and 1 at the cap', () => {
    expect(vortexCharge(0, V)).toBe(0)
    expect(vortexCharge(V.maxChargeSeconds, V)).toBe(1)
  })

  it('clamps past the cap rather than over-charging', () => {
    expect(vortexCharge(V.maxChargeSeconds * 4, V)).toBe(1)
  })
})

describe('vortexRadius', () => {
  it('grows with charge, from the minimum to the maximum', () => {
    expect(vortexRadius(0, V)).toBeCloseTo(V.minRadius, 6)
    expect(vortexRadius(1, V)).toBeCloseTo(V.maxRadius, 6)
    expect(vortexRadius(0.5, V)).toBeGreaterThan(V.minRadius)
  })
})

describe('vortexTargets', () => {
  it('catches an enemy directly behind the caster', () => {
    // Radial with no facing test: a vortex is a place, not a direction. This is the
    // contrast with a gust, which only catches what is in front.
    const behind = enemyAt('behind', 0, V.minRadius - 1)
    const ahead = enemyAt('ahead', 0, -(V.minRadius - 1))
    const caught = vortexTargets(ORIGIN, [behind, ahead], 0, V).map((e) => e.id)
    expect(caught).toContain('behind')
    expect(caught).toContain('ahead')
  })

  it('leaves an enemy outside the radius alone', () => {
    const far = enemyAt('far', V.maxRadius + 2, 0)
    expect(vortexTargets(ORIGIN, [far], 1, V)).toHaveLength(0)
  })

  it('reaches further on a full charge than on none', () => {
    const mid = enemyAt('mid', (V.minRadius + V.maxRadius) / 2, 0)
    expect(vortexTargets(ORIGIN, [mid], 0, V)).toHaveLength(0)
    expect(vortexTargets(ORIGIN, [mid], 1, V)).toHaveLength(1)
  })
})

describe('vortexImpulse', () => {
  it('pulls inward, toward the caster', () => {
    // The sign is the whole move. A gust pushes away; this gathers. Asserting the
    // direction rather than merely that something moved.
    const target = at(6, 0)
    const pull = vortexImpulse(ORIGIN, target, 1, V)
    expect(pull.x).toBeLessThan(0)
    const after = target.clone().addScaledVector(pull, 0.1)
    expect(horizontalDistance(ORIGIN, after)).toBeLessThan(horizontalDistance(ORIGIN, target))
  })

  it('lifts', () => {
    expect(vortexImpulse(ORIGIN, at(6, 0), 1, V).y).toBeGreaterThan(0)
  })

  it('lifts harder on a full charge', () => {
    expect(vortexImpulse(ORIGIN, at(3, 0), 1, V).y)
      .toBeGreaterThan(vortexImpulse(ORIGIN, at(3, 0), 0, V).y)
  })

  it('still lifts an enemy standing exactly on the caster', () => {
    // The inward direction is undefined there; it must not produce NaN.
    const pull = vortexImpulse(ORIGIN, ORIGIN.clone(), 1, V)
    expect(Number.isFinite(pull.x)).toBe(true)
    expect(pull.y).toBeGreaterThan(0)
  })
})
