import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { inGust, gustImpulse, gustTargets, type GustConfig } from './gust'
import { spawnEnemy, type EnemyConfig } from './enemy'

const G: GustConfig = {
  range: 12, halfAngle: Math.PI / 3, damage: 0.5, knockback: 26, cooldownSeconds: 0.5,
}
const E: EnemyConfig = {
  maxHealth: 3, outOfCombatSeconds: 4, regenPerSecond: 0.4, moveSpeed: 4,
  strikeRange: 3, aggroRange: 30, windUpSeconds: 0.5, recoverSeconds: 0.6, strikeDamage: 1,
  knockbackDamping: 3,
}

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)

describe('the gust cone', () => {
  it('catches a target straight ahead', () => {
    expect(inGust(ORIGIN, NORTH, new Vector3(0, 0, -6), G)).toBe(true)
  })

  it('catches a target off to the side, because it is a sweep', () => {
    // Built for hitting several enemies at once rather than one enemy hard.
    expect(inGust(ORIGIN, NORTH, new Vector3(-4, 0, -5), G)).toBe(true)
  })

  it('misses a target behind', () => {
    expect(inGust(ORIGIN, NORTH, new Vector3(0, 0, 6), G)).toBe(false)
  })

  it('misses a target beyond its range', () => {
    expect(inGust(ORIGIN, NORTH, new Vector3(0, 0, -G.range - 1), G)).toBe(false)
  })

  it('ignores height, so it cannot be dodged by standing on a step', () => {
    expect(inGust(ORIGIN, NORTH, new Vector3(0, 9, -6), G)).toBe(true)
  })

  it('catches several targets at once', () => {
    const enemies = [
      spawnEnemy('a', new Vector3(0, 0, -5), E),
      spawnEnemy('b', new Vector3(-3, 0, -5), E),
      spawnEnemy('c', new Vector3(0, 0, 8), E),
    ]
    expect(gustTargets(ORIGIN, NORTH, enemies, G).map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('the gust impulse', () => {
  it('pushes the target away from the caster', () => {
    expect(gustImpulse(ORIGIN, new Vector3(0, 0, -5), G).z).toBeLessThan(0)
    expect(gustImpulse(ORIGIN, new Vector3(0, 0, 5), G).z).toBeGreaterThan(0)
  })

  it('lifts as well as shoves, so it reads as air', () => {
    // The lift is also what lets a gust blow someone off a ledge, which the doc
    // lists as a non-lethal way an enemy goes down.
    expect(gustImpulse(ORIGIN, new Vector3(0, 0, -5), G).y).toBeGreaterThan(0)
  })

  it('trades damage for displacement', () => {
    // The signature of a crowd-control move: barely hurts, moves everyone.
    expect(G.damage).toBeLessThan(1)
    expect(G.knockback).toBeGreaterThan(20)
  })

  it('survives a target standing exactly on the caster', () => {
    expect(gustImpulse(ORIGIN, ORIGIN.clone(), G).length()).toBeGreaterThan(0)
  })
})
