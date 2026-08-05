import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { inGust, gustImpulse, gustTargets, liveGustTargets, type GustConfig } from './gust'
import { spawnEnemy, type Enemy, type EnemyConfig } from './enemy'

const G: GustConfig = {
  range: 12, halfAngle: Math.PI / 3, damage: 0.5, knockback: 26, cooldownSeconds: 0.5,
}
const E: EnemyConfig = {
  maxHealth: 3, outOfCombatSeconds: 4, regenPerSecond: 0.4, moveSpeed: 4,
  strikeRange: 3, aggroRange: 30, windUpSeconds: 0.5, recoverSeconds: 0.6, strikeDamage: 1,
  knockbackDamping: 3,
  // Matches DEFAULT_COMBAT_CONFIG.enemy.gravity.
  gravity: 20,
  // Matches DEFAULT_COMBAT_CONFIG.enemy.snapDistance.
  snapDistance: 1.2,
}

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)

/** A live enemy at a given position, with a default id — override it with a spread when a test needs a distinct one. */
function enemyAt(position: Vector3, id = 'enemy'): Enemy {
  return spawnEnemy(id, position, E)
}

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

describe('only the soldiers still standing', () => {
  it('includes a live enemy inside the cone', () => {
    const live = enemyAt(new Vector3(0, 0, -4))
    expect(liveGustTargets(ORIGIN, NORTH, [live], G).map((e) => e.id)).toEqual([live.id])
  })

  it('excludes a downed enemy inside the cone', () => {
    // The whole reason this function exists next to gustTargets. A preview that lights up
    // for a body is a preview that lies about what a gust would achieve.
    const corpse = { ...enemyAt(new Vector3(0, 0, -4)), health: { current: 0, max: 1.5, sinceHit: 0 } }
    expect(liveGustTargets(ORIGIN, NORTH, [corpse], G)).toEqual([])
  })

  it('excludes a live enemy outside the cone', () => {
    const behind = enemyAt(new Vector3(0, 0, 4))
    expect(liveGustTargets(ORIGIN, NORTH, [behind], G)).toEqual([])
  })

  it('keeps only the live ones from a mixed group', () => {
    const live = enemyAt(new Vector3(0, 0, -4))
    const corpse = { ...enemyAt(new Vector3(1, 0, -4)), id: 'corpse', health: { current: 0, max: 1.5, sinceHit: 0 } }
    const far = { ...enemyAt(new Vector3(0, 0, -400)), id: 'far' }
    const caught = liveGustTargets(ORIGIN, NORTH, [live, corpse, far], G).map((e) => e.id)
    expect(caught).toEqual([live.id])
  })

  it('agrees with gustTargets when nobody is down', () => {
    // Derived rather than restated: with every enemy healthy the two must return the same
    // set, which pins that this function adds a filter and changes nothing else.
    const group = [
      enemyAt(new Vector3(0, 0, -4)),
      { ...enemyAt(new Vector3(3, 0, -5)), id: 'b' },
      { ...enemyAt(new Vector3(0, 0, 6)), id: 'behind' },
    ]
    expect(liveGustTargets(ORIGIN, NORTH, group, G).map((e) => e.id))
      .toEqual(gustTargets(ORIGIN, NORTH, group, G).map((e) => e.id))
  })
})
