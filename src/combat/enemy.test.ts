import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { spawnEnemy, stepEnemy, hitEnemy, horizontalDistance, type EnemyConfig } from './enemy'
import { isDowned } from './health'

const C: EnemyConfig = {
  maxHealth: 3, outOfCombatSeconds: 4, regenPerSecond: 0.4,
  moveSpeed: 4, strikeRange: 3, windUpSeconds: 0.5, recoverSeconds: 0.6,
  strikeDamage: 1, knockbackDamping: 3,
}

const AT = (x: number, z: number) => new Vector3(x, 0, z)

/** Run the enemy against a stationary player and total the damage dealt. */
function fight(seconds: number, playerAt: Vector3, from = spawnEnemy('a', AT(0, 20), C)) {
  let enemy = from
  let damage = 0
  for (let t = 0; t < seconds; t += 1 / 60) {
    const step = stepEnemy(enemy, playerAt, 1 / 60, C)
    enemy = step.enemy
    damage += step.damageToPlayer
  }
  return { enemy, damage }
}

describe('spear infantry pressures ground spacing', () => {
  it('closes on a distant player', () => {
    const start = horizontalDistance(AT(0, 20), AT(0, 0))
    const { enemy } = fight(1, AT(0, 0))
    expect(horizontalDistance(enemy.position, AT(0, 0))).toBeLessThan(start)
  })

  it('punishes standing still', () => {
    // The contract for this type: holding one spot has to cost something.
    expect(fight(6, AT(0, 0)).damage).toBeGreaterThan(0)
  })

  it('stops closing once inside its reach', () => {
    const { enemy } = fight(8, AT(0, 0))
    expect(horizontalDistance(enemy.position, AT(0, 0))).toBeLessThanOrEqual(C.strikeRange + 0.5)
  })

  it('cannot reach a player who keeps their distance', () => {
    // Out-running it is the intended answer, so distance must be a real defence.
    const far = spawnEnemy('a', AT(0, 60), C)
    expect(fight(2, AT(0, 0), far).damage).toBe(0)
  })

  it('telegraphs before it hits, so the strike is dodgeable', () => {
    // Inside reach, but the hit must not land during the wind-up.
    const adjacent = spawnEnemy('a', AT(0, 2), C)
    const early = fight(C.windUpSeconds - 0.1, AT(0, 0), adjacent)
    expect(early.damage).toBe(0)
    expect(early.enemy.stance).toBe('wind-up')
  })

  it('misses if the player leaves reach during the wind-up', () => {
    // This is what makes the telegraph a dodge window rather than decoration.
    let enemy = spawnEnemy('a', AT(0, 2), C)
    let damage = 0
    for (let t = 0; t < C.windUpSeconds + 0.2; t += 1 / 60) {
      // Step away as soon as the wind-up starts.
      const playerAt = enemy.stance === 'wind-up' ? AT(0, -40) : AT(0, 0)
      const step = stepEnemy(enemy, playerAt, 1 / 60, C)
      enemy = step.enemy
      damage += step.damageToPlayer
    }
    expect(damage).toBe(0)
  })

  it('faces the player it is pressuring', () => {
    const { enemy } = fight(0.5, AT(0, 0))
    expect(enemy.facing.z).toBeLessThan(0)
  })
})

describe('being downed rather than killed', () => {
  it('goes down at zero health and stays present', () => {
    const downed = hitEnemy(spawnEnemy('a', AT(0, 5), C), C.maxHealth, new Vector3())
    expect(isDowned(downed.health)).toBe(true)
    expect(downed.stance).toBe('downed')
  })

  it('stops fighting once downed', () => {
    const downed = hitEnemy(spawnEnemy('a', AT(0, 2), C), C.maxHealth, new Vector3())
    expect(fight(5, AT(0, 0), downed).damage).toBe(0)
  })

  it('stays down instead of recovering over time', () => {
    const downed = hitEnemy(spawnEnemy('a', AT(0, 2), C), C.maxHealth, new Vector3())
    expect(fight(30, AT(0, 0), downed).enemy.stance).toBe('downed')
  })

  it('does not advance while downed', () => {
    const downed = hitEnemy(spawnEnemy('a', AT(0, 20), C), C.maxHealth, new Vector3())
    const after = fight(3, AT(0, 0), downed).enemy
    expect(horizontalDistance(after.position, AT(0, 20))).toBeLessThan(0.5)
  })
})

describe('taking a hit', () => {
  it('interrupts a wind-up rather than only chipping health', () => {
    const winding = fight(C.windUpSeconds - 0.1, AT(0, 0), spawnEnemy('a', AT(0, 2), C)).enemy
    expect(winding.stance).toBe('wind-up')
    expect(hitEnemy(winding, 1, new Vector3()).stance).toBe('recover')
  })

  it('is pushed by the impulse and then settles', () => {
    const pushed = hitEnemy(spawnEnemy('a', AT(0, 20), C), 0.5, new Vector3(0, 0, 30))
    const moved = fight(0.3, AT(0, 0), pushed).enemy
    expect(moved.position.z).toBeGreaterThan(20)
    const settled = fight(3, AT(0, 0), moved).enemy
    expect(settled.knockback.length()).toBeLessThan(0.5)
  })
})
