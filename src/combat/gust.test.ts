import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  inGust, gustImpulse, gustTargets, liveGustTargets, anyLiveGustTarget, type GustConfig,
} from './gust'
import { spawnEnemy, type Enemy, type EnemyConfig } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

const G: GustConfig = {
  range: 12, halfAngle: Math.PI / 3, verticalReach: 5,
  damage: 0.5, knockback: 26, cooldownSeconds: 0.5,
}
/**
 * The character's standing height, which `avatar.ts` holds as `TARGET_HEIGHT` and
 * `avatar.test.ts` measures off the real rig. Restated rather than imported: the export does
 * not exist, and importing `avatar.ts` here would pull the GLTF loader in behind it.
 */
const BODY_HEIGHT = 1.8
const E: EnemyConfig = {
  maxHealth: 3, outOfCombatSeconds: 4, regenPerSecond: 0.4, moveSpeed: 4,
  strikeRange: 3, aggroRange: 30, windUpSeconds: 0.5, recoverSeconds: 0.6,
  attack: { kind: 'melee', damage: 1 },
  knockbackDamping: 3,
  // Matches DEFAULT_COMBAT_CONFIG.enemies.spear.gravity.
  gravity: 20,
  // Matches DEFAULT_COMBAT_CONFIG.enemies.spear.snapDistance.
  snapDistance: 1.2,
  downedSeconds: 18, risingSeconds: 1.2, recoveryHealthFractions: [0.6, 0.3],
}

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)

/** A live enemy at a given position, with a default id — override it with a spread when a test needs a distinct one. */
function enemyAt(position: Vector3, id = 'enemy'): Enemy {
  return spawnEnemy(id, position, 'spear', E)
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

  it('reaches the boundary and not past it', () => {
    // Both heights come off the fixture, so the pair keeps straddling the boundary if the
    // value moves. That also means this test tracks nothing shipped and cannot fail for
    // tightening -- the test below is the one that can.
    expect(inGust(ORIGIN, NORTH, new Vector3(0, G.verticalReach, -6), G)).toBe(true)
    expect(inGust(ORIGIN, NORTH, new Vector3(0, G.verticalReach + 0.01, -6), G)).toBe(false)
  })

  it('cannot be dodged by standing on a ledge a body height up', () => {
    // Against the shipped config and an absolute step height, because the pair above moves
    // with the value and so says nothing about whether the reach is big enough to be worth
    // having. This is the low-ledge case the value exists for: a soldier standing a full
    // character height above the player is still inside the sweep.
    const gust = DEFAULT_COMBAT_CONFIG.gust
    expect(inGust(ORIGIN, NORTH, new Vector3(0, BODY_HEIGHT, -6), gust)).toBe(true)
  })

  it('no longer reaches down an entire cliff face', () => {
    // The defect this reach exists to close: before it, height was dropped before anything
    // else, so a target 2000 m below a hovering player was inside the blast while the
    // soldier's own 3D ranges could not answer.
    expect(inGust(ORIGIN, NORTH, new Vector3(0, -2000, -6), G)).toBe(false)
  })

  it('ships as a sweep of air rather than a column of it', () => {
    // Stated against the shipped range instead of restating 5. A sweep has to stay at least
    // twice as wide as it is tall to read as one; past that the gust is a pillar the player
    // can park beside a cliff and fire through.
    const gust = DEFAULT_COMBAT_CONFIG.gust
    expect(gust.verticalReach * 2).toBeLessThanOrEqual(gust.range)
  })

  it('catches several targets at once', () => {
    const enemies = [
      spawnEnemy('a', new Vector3(0, 0, -5), 'spear', E),
      spawnEnemy('b', new Vector3(-3, 0, -5), 'spear', E),
      spawnEnemy('c', new Vector3(0, 0, 8), 'spear', E),
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

  it('includes a soldier pushing back up, because a gust would actually connect', () => {
    // Health sits at zero through the whole rise (see enemy.ts), so this is exactly the
    // shape `isDowned` alone could not tell apart from a corpse. `stepEncounter` resolves
    // a hit on this soldier via `isTargetable`, so the preview has to agree or it would
    // stay dark for a target the gust can actually reach.
    const rising = {
      ...enemyAt(new Vector3(0, 0, -4)),
      health: { current: 0, max: 1.5, sinceHit: 0 },
      stance: 'rising' as const,
    }
    expect(liveGustTargets(ORIGIN, NORTH, [rising], G).map((e) => e.id)).toEqual([rising.id])
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

describe('whether a gust would catch anyone at all', () => {
  it('says no with nobody in the fight', () => {
    expect(anyLiveGustTarget(ORIGIN, NORTH, [], G)).toBe(false)
  })

  it('says yes for a live enemy inside the cone', () => {
    expect(anyLiveGustTarget(ORIGIN, NORTH, [enemyAt(new Vector3(0, 0, -4))], G)).toBe(true)
  })

  it('says no for a live enemy outside the cone', () => {
    expect(anyLiveGustTarget(ORIGIN, NORTH, [enemyAt(new Vector3(0, 0, 4))], G)).toBe(false)
  })

  it('says no for a downed enemy inside the cone', () => {
    // The same distinction liveGustTargets draws, and the reason this is not simply a
    // non-empty gustTargets: a preview that lights up for a body promises a hit that a gust
    // cannot deliver.
    const corpse = {
      ...enemyAt(new Vector3(0, 0, -4)),
      health: { current: 0, max: 1.5, sinceHit: 0 },
    }
    expect(anyLiveGustTarget(ORIGIN, NORTH, [corpse], G)).toBe(false)
  })

  it('says yes for a soldier pushing back up, so the reticle does not stay dark on a target the gust can reach', () => {
    // main.ts feeds this straight into the aim tell. Health is zero for the whole rise, the
    // same as a corpse's, so `isDowned` alone cannot tell them apart -- only `stance` can.
    const rising = {
      ...enemyAt(new Vector3(0, 0, -4)),
      health: { current: 0, max: 1.5, sinceHit: 0 },
      stance: 'rising' as const,
    }
    expect(anyLiveGustTarget(ORIGIN, NORTH, [rising], G)).toBe(true)
  })

  it('finds the one live soldier in a crowd of corpses and distant enemies', () => {
    // Ordered so the answer sits last, which is what catches a short-circuit that gave up
    // rather than one that stopped early.
    const downed = (id: string, at: Vector3) => ({
      ...enemyAt(at, id), health: { current: 0, max: 1.5, sinceHit: 0 },
    })
    const crowd = [
      downed('corpse-a', new Vector3(0, 0, -4)),
      { ...enemyAt(new Vector3(0, 0, -400)), id: 'far' },
      { ...enemyAt(new Vector3(0, 0, 5)), id: 'behind' },
      downed('corpse-b', new Vector3(2, 0, -3)),
      { ...enemyAt(new Vector3(-2, 0, -5)), id: 'live' },
    ]
    expect(anyLiveGustTarget(ORIGIN, NORTH, crowd, G)).toBe(true)
  })

  it('answers exactly what liveGustTargets being non-empty answers', () => {
    // Derived rather than restated. This is the whole point of the function: `main.ts` used
    // to ask `liveGustTargets(...).length > 0`, which put an "at least one" rule in the one
    // module with no tests. The cheap answer must agree with the expensive one on every
    // arrangement, or moving the rule here changed the preview's behaviour.
    const live = (id: string, at: Vector3) => ({ ...enemyAt(at, id) })
    const downed = (id: string, at: Vector3) => ({
      ...enemyAt(at, id), health: { current: 0, max: 1.5, sinceHit: 0 },
    })
    const groups: Enemy[][] = [
      [],
      [live('a', new Vector3(0, 0, -4))],
      [downed('a', new Vector3(0, 0, -4))],
      [live('a', new Vector3(0, 0, 4))],
      [downed('a', new Vector3(0, 0, -4)), live('b', new Vector3(1, 0, -4))],
      [live('a', new Vector3(0, 0, -4)), downed('b', new Vector3(1, 0, -4))],
      [downed('a', new Vector3(0, 0, -4)), live('b', new Vector3(0, 0, 400))],
      [live('a', new Vector3(0, 0, -G.range - 1)), downed('b', new Vector3(0, 0, -2))],
    ]
    for (const group of groups) {
      const ids = group.map((e) => e.id).join(',')
      expect(anyLiveGustTarget(ORIGIN, NORTH, group, G), `group [${ids}]`)
        .toBe(liveGustTargets(ORIGIN, NORTH, group, G).length > 0)
    }
  })
})
