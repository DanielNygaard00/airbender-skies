import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  spawnEnemy, stepEnemy, hitEnemy, horizontalDistance,
  type Enemy, type EnemyConfig, type GroundHeightQuery,
} from './enemy'
import { isDowned } from './health'

const C: EnemyConfig = {
  maxHealth: 3, outOfCombatSeconds: 4, regenPerSecond: 0.4,
  moveSpeed: 4, strikeRange: 3, aggroRange: 30, windUpSeconds: 0.5, recoverSeconds: 0.6,
  strikeDamage: 1, knockbackDamping: 3, gravity: 20,
}

const AT = (x: number, z: number) => new Vector3(x, 0, z)

/** Flat ground at y=0, so an arc can be reasoned about exactly. */
const flatGround: GroundHeightQuery = { groundHeightAt: () => 0 }
/** No ground anywhere: what being blown off an island looks like. */
const emptyAir: GroundHeightQuery = { groundHeightAt: () => null }
const FLOOR = -50

/** Run the enemy against a stationary player and total the damage dealt. */
function fight(seconds: number, playerAt: Vector3, from = spawnEnemy('a', AT(0, 20), C)) {
  let enemy = from
  let damage = 0
  for (let t = 0; t < seconds; t += 1 / 60) {
    const step = stepEnemy(enemy, playerAt, flatGround, FLOOR, 1 / 60, C)
    enemy = step.enemy
    damage += step.damageToPlayer
  }
  return { enemy, damage }
}

/** Step an enemy for `seconds` with no player nearby, so only physics acts. */
function settle(enemy: Enemy, seconds: number, ground = flatGround): Enemy {
  let current = enemy
  const far = AT(0, 500)
  for (let t = 0; t < seconds; t += 1 / 60) {
    current = stepEnemy(current, far, ground, FLOOR, 1 / 60, C).enemy
  }
  return current
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
      const step = stepEnemy(enemy, playerAt, flatGround, FLOOR, 1 / 60, C)
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

describe('the aggro leash', () => {
  it('ignores a player beyond its notice range', () => {
    // Without a leash a patrol trails the player across the whole archipelago.
    const distant = spawnEnemy('a', AT(0, C.aggroRange + 20), C)
    const after = fight(3, AT(0, 0), distant).enemy
    expect(horizontalDistance(after.position, AT(0, C.aggroRange + 20))).toBeLessThan(0.5)
  })

  it('closes once the player comes inside it', () => {
    const inside = spawnEnemy('a', AT(0, C.aggroRange - 5), C)
    const after = fight(1, AT(0, 0), inside).enemy
    expect(horizontalDistance(after.position, AT(0, 0)))
      .toBeLessThan(C.aggroRange - 5)
  })

  it('still faces a player it is ignoring, so the leash is not blindness', () => {
    const distant = spawnEnemy('a', AT(0, C.aggroRange + 20), C)
    expect(fight(0.5, AT(0, 0), distant).enemy.facing.z).toBeLessThan(0)
  })
})

describe('an airborne enemy', () => {
  /** Get an enemy into wind-up stance right next to the player, then lift it. */
  const liftedInWindUp = () => {
    const player = AT(0, 0)
    let enemy = spawnEnemy('a', AT(0, 0.5), C)
    // Step until it winds up (close enough to strike).
    for (let t = 0; t < 2 && enemy.stance !== 'wind-up'; t += 1 / 60) {
      enemy = stepEnemy(enemy, player, flatGround, FLOOR, 1 / 60, C).enemy
    }
    // Now in wind-up, lift without interrupting (preserve the wind-up).
    return { ...enemy, verticalVelocity: enemy.verticalVelocity + 9 }
  }

  it('deals no damage even from inside strike range', () => {
    // The whole payoff of a vortex: a lifted group stops acting. Range is derived
    // from config so this survives retuning.
    const player = AT(0, 0)
    let enemy = liftedInWindUp()
    expect(enemy.stance).toBe('wind-up')
    expect(horizontalDistance(enemy.position, player)).toBeLessThan(C.strikeRange)
    let dealt = 0
    for (let t = 0; t < C.windUpSeconds * 3; t += 1 / 60) {
      const step = stepEnemy(enemy, player, flatGround, FLOOR, 1 / 60, C)
      enemy = step.enemy
      dealt += step.damageToPlayer
      if (enemy.grounded) break
    }
    expect(dealt).toBe(0)
  })

  it('drops a wind-up in progress when it leaves the ground', () => {
    const player = AT(0, 0)
    const enemy = liftedInWindUp()
    expect(enemy.stance).toBe('wind-up')

    const lifted = stepEnemy(enemy, player, flatGround, FLOOR, 1 / 60, C).enemy
    expect(lifted.grounded).toBe(false)
    // Once airborne, wind-up is interrupted and should not advance.
    expect(lifted.stance).not.toBe('wind-up')
  })

  it('strikes again once it has landed', () => {
    // Inertness must be temporary, or a vortex would be a permanent disable.
    const player = AT(0, 0)
    // Lift an enemy that was in wind-up, then let it fall and recover.
    let enemy = liftedInWindUp()
    for (let t = 0; t < 4; t += 1 / 60) {
      enemy = stepEnemy(enemy, player, flatGround, FLOOR, 1 / 60, C).enemy
      if (enemy.grounded) break
    }
    expect(enemy.grounded).toBe(true)
    // Now let it get back into striking position.
    let dealt = 0
    for (let t = 0; t < C.windUpSeconds * 4; t += 1 / 60) {
      const step = stepEnemy(enemy, player, flatGround, FLOOR, 1 / 60, C)
      enemy = step.enemy
      dealt += step.damageToPlayer
    }
    expect(dealt).toBeGreaterThan(0)
  })
})

describe('enemy gravity', () => {
  it('returns a lifted enemy to the ground', () => {
    // Regression guard for a measured bug: gust and Pressure Wave both apply an
    // upward impulse, and with no gravity the soldier stayed up permanently — a
    // gusted enemy was measured 2.4m above the ground twenty seconds later.
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), C), 0, new Vector3(0, 9, 0))
    expect(settle(lifted, 3).position.y).toBeCloseTo(0, 3)
  })

  it('rises before it falls', () => {
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), C), 0, new Vector3(0, 9, 0))
    expect(settle(lifted, 0.2).position.y).toBeGreaterThan(0.5)
  })

  it('reports itself airborne while up, and grounded once it lands', () => {
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), C), 0, new Vector3(0, 9, 0))
    expect(settle(lifted, 0.2).grounded).toBe(false)
    expect(settle(lifted, 3).grounded).toBe(true)
  })

  it('lets a downed body fall rather than stranding it in the air', () => {
    // stepEnemy returns early for the downed. Leaving gravity out of that branch
    // would strand any corpse that was airborne when it went down.
    const downed = hitEnemy(spawnEnemy('a', AT(0, 0), C), C.maxHealth, new Vector3(0, 9, 0))
    const settled = settle(downed, 3)
    expect(settled.stance).toBe('downed')
    expect(settled.position.y).toBeCloseTo(0, 3)
  })

  it('downs an enemy that falls out of the world', () => {
    // Section 4.6 counts being blown off a ledge as a down. Without this, adding
    // gravity would make an enemy off the island fall forever.
    const pushed = settle(spawnEnemy('a', AT(0, 0), C), 6, emptyAir)
    expect(isDowned(pushed.health)).toBe(true)
  })

  it('still decays a horizontal push', () => {
    // Pre-existing behaviour that the split of knockback must not lose.
    const shoved = hitEnemy(spawnEnemy('a', AT(0, 0), C), 0, new Vector3(20, 0, 0))
    const after = settle(shoved, 2)
    expect(after.position.x).toBeGreaterThan(1)
    expect(Math.hypot(after.knockback.x, after.knockback.z)).toBeLessThan(1)
  })
})
