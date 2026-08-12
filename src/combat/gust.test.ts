import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  inGust, gustImpulse, gustTargets, liveGustTargets, anyLiveGustTarget, type GustConfig,
} from './gust'
import {
  spawnEnemy, UNARMOURED, type Enemy, type EnemyConfig, type EnemyKind,
} from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

const G: GustConfig = {
  range: 12, halfAngle: Math.PI / 3, verticalReach: 5,
  damage: 0.5, knockback: 26, cooldownSeconds: 0.5,
}
/**
 * The character's standing height, which `avatar.ts` holds as `TARGET_HEIGHT` and
 * `avatar.test.ts` measures off the real rig. Restated rather than imported: the export does
 * not exist, and importing `avatar.ts` here would pull the GLTF loader in behind it.
 *
 * **Tracked debt, and the trigger for paying it is not the one first recorded.** The ledger
 * said "fix before a fourth copy appears", which counts copies and misses the actual hazard:
 * `avatar.ts` documents `TARGET_HEIGHT` as matching a *placeholder* capsule
 * (`CapsuleGeometry(0.4, 1.0)`), so this 1.8 is a restatement of a stand-in. The staff's
 * `verticalReach` of 2.0 has only 0.2 m of slack over a lower bound pinned to it. The trigger
 * is **before the avatar model is replaced**, whether or not a fourth copy ever exists: the
 * moment the real rig's height differs from 1.8, these bounds are measuring something that no
 * longer exists and nothing here will say so.
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
  armour: UNARMOURED,
}

/**
 * Every kind unarmoured, so the existing preview tests read only the `isTargetable` rule.
 *
 * `liveGustTargets` and `anyLiveGustTarget` now also ask each soldier's armour whether the gust
 * reaches it at all. Handed a table where nobody deflects, they behave exactly as they did
 * before armour existed — which is what keeps every assertion below about the thing it was
 * written to be about. The armour rule gets its own describe block at the bottom of this file,
 * with a fixture that actually deflects.
 */
const NO_ARMOUR: Record<EnemyKind, EnemyConfig> = {
  spear: E, archer: E, heavy: E, nets: E,
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
    expect(liveGustTargets(ORIGIN, NORTH, [live], G, NO_ARMOUR).map((e) => e.id)).toEqual([live.id])
  })

  it('excludes a downed enemy inside the cone', () => {
    // The whole reason this function exists next to gustTargets. A preview that lights up
    // for a body is a preview that lies about what a gust would achieve.
    const corpse = { ...enemyAt(new Vector3(0, 0, -4)), health: { current: 0, max: 1.5, sinceHit: 0 } }
    expect(liveGustTargets(ORIGIN, NORTH, [corpse], G, NO_ARMOUR)).toEqual([])
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
    expect(liveGustTargets(ORIGIN, NORTH, [rising], G, NO_ARMOUR).map((e) => e.id)).toEqual([rising.id])
  })

  it('excludes a live enemy outside the cone', () => {
    const behind = enemyAt(new Vector3(0, 0, 4))
    expect(liveGustTargets(ORIGIN, NORTH, [behind], G, NO_ARMOUR)).toEqual([])
  })

  it('keeps only the live ones from a mixed group', () => {
    const live = enemyAt(new Vector3(0, 0, -4))
    const corpse = { ...enemyAt(new Vector3(1, 0, -4)), id: 'corpse', health: { current: 0, max: 1.5, sinceHit: 0 } }
    const far = { ...enemyAt(new Vector3(0, 0, -400)), id: 'far' }
    const caught = liveGustTargets(ORIGIN, NORTH, [live, corpse, far], G, NO_ARMOUR).map((e) => e.id)
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
    expect(liveGustTargets(ORIGIN, NORTH, group, G, NO_ARMOUR).map((e) => e.id))
      .toEqual(gustTargets(ORIGIN, NORTH, group, G).map((e) => e.id))
  })
})

describe('whether a gust would catch anyone at all', () => {
  it('says no with nobody in the fight', () => {
    expect(anyLiveGustTarget(ORIGIN, NORTH, [], G, NO_ARMOUR)).toBe(false)
  })

  it('says yes for a live enemy inside the cone', () => {
    expect(anyLiveGustTarget(ORIGIN, NORTH, [enemyAt(new Vector3(0, 0, -4))], G, NO_ARMOUR)).toBe(true)
  })

  it('says no for a live enemy outside the cone', () => {
    expect(anyLiveGustTarget(ORIGIN, NORTH, [enemyAt(new Vector3(0, 0, 4))], G, NO_ARMOUR)).toBe(false)
  })

  it('says no for a downed enemy inside the cone', () => {
    // The same distinction liveGustTargets draws, and the reason this is not simply a
    // non-empty gustTargets: a preview that lights up for a body promises a hit that a gust
    // cannot deliver.
    const corpse = {
      ...enemyAt(new Vector3(0, 0, -4)),
      health: { current: 0, max: 1.5, sinceHit: 0 },
    }
    expect(anyLiveGustTarget(ORIGIN, NORTH, [corpse], G, NO_ARMOUR)).toBe(false)
  })

  it('says yes for a soldier pushing back up, so the reticle does not stay dark on a target the gust can reach', () => {
    // main.ts feeds this straight into the aim tell. Health is zero for the whole rise, the
    // same as a corpse's, so `isDowned` alone cannot tell them apart -- only `stance` can.
    const rising = {
      ...enemyAt(new Vector3(0, 0, -4)),
      health: { current: 0, max: 1.5, sinceHit: 0 },
      stance: 'rising' as const,
    }
    expect(anyLiveGustTarget(ORIGIN, NORTH, [rising], G, NO_ARMOUR)).toBe(true)
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
    expect(anyLiveGustTarget(ORIGIN, NORTH, crowd, G, NO_ARMOUR)).toBe(true)
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
      expect(anyLiveGustTarget(ORIGIN, NORTH, group, G, NO_ARMOUR), `group [${ids}]`)
        .toBe(liveGustTargets(ORIGIN, NORTH, group, G, NO_ARMOUR).length > 0)
    }
  })
})

describe('the aim preview and armour the gust cannot get through', () => {
  /**
   * The same four kinds, but plate on the heavy: a gust turns away entirely.
   *
   * Only the `gust` row is 0 and 0. The other three are left whole on purpose, so nothing in this
   * block can pass because the fixture happens to be immune to everything.
   */
  const WITH_PLATE: Record<EnemyKind, EnemyConfig> = {
    spear: E,
    archer: E,
    nets: E,
    heavy: {
      ...E,
      armour: { ...UNARMOURED, gust: { damage: 0, knockback: 0 } },
    },
  }
  const heavyAt = (position: Vector3, id = 'plate'): Enemy => spawnEnemy(id, position, 'heavy', E)

  it('stays cold for a soldier the gust cannot touch', () => {
    // The same argument that keeps the preview dark for a body, applied to a second population: a
    // preview that warms on a heavy promises something the move cannot deliver. This is the type's
    // first and cheapest tell, because it costs the player nothing to learn from.
    const plate = heavyAt(new Vector3(0, 0, -4))
    expect(liveGustTargets(ORIGIN, NORTH, [plate], G, WITH_PLATE)).toEqual([])
    expect(anyLiveGustTarget(ORIGIN, NORTH, [plate], G, WITH_PLATE)).toBe(false)
  })

  it('warms for the identical soldier once the plate comes off', () => {
    // The positive control on the assertion above, and the one that makes it a statement about
    // armour: same enemy, same position, same cone, an unarmoured table. Without it, a fixture
    // that had drifted out of the cone would read as the armour filter working.
    const plate = heavyAt(new Vector3(0, 0, -4))
    expect(anyLiveGustTarget(ORIGIN, NORTH, [plate], G, NO_ARMOUR)).toBe(true)
  })

  it('still warms for the spear standing beside the heavy', () => {
    // The case the player actually meets, and the reason this is a good tell rather than a
    // confusing one: the preview lights for the group and goes dark only when the heavy is the
    // whole of what is in the cone.
    const group = [heavyAt(new Vector3(-1, 0, -4)), enemyAt(new Vector3(1, 0, -4), 'leather')]
    expect(liveGustTargets(ORIGIN, NORTH, group, G, WITH_PLATE).map((e) => e.id))
      .toEqual(['leather'])
    expect(anyLiveGustTarget(ORIGIN, NORTH, group, G, WITH_PLATE)).toBe(true)
  })

  it('is still the geometry that decides for an unarmoured soldier out of the cone', () => {
    // The armour filter must not become the only thing the preview asks. A spear behind the player
    // is out regardless of what anybody is wearing.
    const behind = [enemyAt(new Vector3(0, 0, 4), 'leather')]
    expect(anyLiveGustTarget(ORIGIN, NORTH, behind, G, WITH_PLATE)).toBe(false)
  })

  it('keeps the cheap answer agreeing with the list form once armour is in play', () => {
    // The same derivation the block above runs against `isTargetable`, extended to the armour
    // rule: two implementations of one rule are two places it can be got wrong.
    const groups: Enemy[][] = [
      [heavyAt(new Vector3(0, 0, -4))],
      [heavyAt(new Vector3(0, 0, 4))],
      [heavyAt(new Vector3(0, 0, -4)), enemyAt(new Vector3(1, 0, -4), 'leather')],
      [enemyAt(new Vector3(1, 0, -4), 'leather'), heavyAt(new Vector3(0, 0, -4))],
      [
        heavyAt(new Vector3(0, 0, -4)),
        { ...enemyAt(new Vector3(1, 0, -4), 'leather'), health: { current: 0, max: 1.5, sinceHit: 0 } },
      ],
      [heavyAt(new Vector3(0, 0, -400))],
    ]
    for (const group of groups) {
      const ids = group.map((e) => e.id).join(',')
      expect(anyLiveGustTarget(ORIGIN, NORTH, group, G, WITH_PLATE), `group [${ids}]`)
        .toBe(liveGustTargets(ORIGIN, NORTH, group, G, WITH_PLATE).length > 0)
    }
  })

  it('goes cold for the shipped heavy against the shipped gust', () => {
    // The fixtures above are about the mechanism. This is the one assertion tying it to what
    // actually ships, so the tell working in a fixture cannot coexist with it not working in the
    // game. `DEFAULT_COMBAT_CONFIG.gust` and `.enemies` both, so neither can be retuned out from
    // under it silently.
    const shipped = DEFAULT_COMBAT_CONFIG
    const plate = spawnEnemy('plate', new Vector3(0, 0, -4), 'heavy', shipped.enemies.heavy)
    const leather = spawnEnemy('leather', new Vector3(1, 0, -4), 'spear', shipped.enemies.spear)
    expect(anyLiveGustTarget(ORIGIN, NORTH, [plate], shipped.gust, shipped.enemies)).toBe(false)
    // And the control, from the shipped config too.
    expect(anyLiveGustTarget(ORIGIN, NORTH, [leather], shipped.gust, shipped.enemies)).toBe(true)
  })
})
