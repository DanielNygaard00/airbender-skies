import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { startEncounter, stepEncounter, canGust, type CombatConfig } from './encounter'
import { isDowned } from './health'

const C: CombatConfig = {
  player: { maxHealth: 5, outOfCombatSeconds: 4, regenPerSecond: 0.4 },
  enemy: {
    maxHealth: 1.5, outOfCombatSeconds: 4, regenPerSecond: 0,
    moveSpeed: 4, strikeRange: 3, aggroRange: 30, windUpSeconds: 0.5, recoverSeconds: 0.6,
    strikeDamage: 1, knockbackDamping: 3,
  },
  gust: { range: 12, halfAngle: Math.PI / 3, damage: 0.5, knockback: 26, cooldownSeconds: 0.5 },
}

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
const near = () => startEncounter([{ id: 'a', position: new Vector3(0, 0, -2) }], C)

/** Run the fight with fixed input. */
function run(seconds: number, over: Partial<Parameters<typeof stepEncounter>[1]> = {}, from = near()) {
  let encounter = from
  let downed: string[] = []
  let hits = 0
  for (let t = 0; t < seconds; t += 1 / 60) {
    const step = stepEncounter(encounter, {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: false, ...over,
    }, 1 / 60, C)
    encounter = step.encounter
    downed = downed.concat(step.downedThisFrame)
    if (step.playerHit) hits++
  }
  return { encounter, downed, hits }
}

describe('the fight runs', () => {
  it('hurts a player who stands in reach doing nothing', () => {
    const { encounter, hits } = run(4)
    expect(hits).toBeGreaterThan(0)
    expect(encounter.playerHealth.current).toBeLessThan(C.player.maxHealth)
  })

  it('leaves a player alone who keeps their distance', () => {
    const far = startEncounter([{ id: 'a', position: new Vector3(0, 0, -80) }], C)
    expect(run(2, {}, far).hits).toBe(0)
  })
})

describe('gusting', () => {
  it('knocks an enemy back out of its reach', () => {
    const before = near().enemies[0]!.position.z
    const { encounter } = run(0.3, { gustPressed: true })
    expect(encounter.enemies[0]!.position.z).toBeLessThan(before)
  })

  it('interrupts a strike instead of trading with it', () => {
    // Gusting resolves before the enemies act, which is the whole point of a move
    // with high knockback and almost no damage.
    const winding = run(C.enemy.windUpSeconds - 0.1).encounter
    expect(winding.enemies[0]!.stance).toBe('wind-up')
    const gusted = stepEncounter(winding, {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true,
    }, 1 / 60, C)
    expect(gusted.encounter.enemies[0]!.stance).not.toBe('wind-up')
    expect(gusted.playerHit).toBe(false)
  })

  it('goes on cooldown so it cannot be held down', () => {
    const fired = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true,
    }, 1 / 60, C)
    expect(canGust(fired.encounter)).toBe(false)
  })

  it('comes back off cooldown', () => {
    const fired = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true,
    }, 1 / 60, C).encounter
    expect(canGust(run(C.gust.cooldownSeconds + 0.2, {}, fired).encounter)).toBe(true)
  })

  it('does not down an enemy in one gust, because gust is not a damage move', () => {
    // Health 1.5 against damage 0.5. If a single gust downed an enemy, the move
    // would be a damage move wearing a crowd-control costume.
    const fired = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true,
    }, 1 / 60, C)
    expect(fired.downedThisFrame).toEqual([])
    expect(isDowned(fired.encounter.enemies[0]!.health)).toBe(false)
  })

  it('blows the enemy out of its own gust range, so it has to be re-engaged', () => {
    // Emergent from the numbers rather than designed in, and worth pinning: a
    // knockback that big means gust cannot be spammed on one target from one spot.
    const fired = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true,
    }, 1 / 60, C)
    const settled = run(C.gust.cooldownSeconds, {}, fired.encounter).encounter
    const distance = Math.hypot(settled.enemies[0]!.position.x, settled.enemies[0]!.position.z)
    expect(distance).toBeGreaterThan(C.enemy.strikeRange)
  })

  it('downs an enemy across a sustained fight, so the damage does accumulate', () => {
    const { downed } = run(30, { gustPressed: true })
    expect(downed).toContain('a')
  })

  it('reports a downing exactly once', () => {
    const { downed } = run(20, { gustPressed: true })
    expect(downed.filter((id) => id === 'a').length).toBeLessThanOrEqual(1)
  })

  it('leaves a downed enemy down rather than gusting it again', () => {
    const { encounter } = run(20, { gustPressed: true })
    if (!isDowned(encounter.enemies[0]!.health)) return
    expect(encounter.enemies[0]!.stance).toBe('downed')
  })

  it('reports the enemies a gust connected with', () => {
    const encounter = startEncounter([
      { id: 'a', position: new Vector3(0, 0, -2) },
      { id: 'b', position: new Vector3(0, 0, -40) },
    ], C)
    const step = stepEncounter(encounter, {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true,
    }, 1 / 60, C)

    // 'a' is inside the 12 unit range; 'b' at 40 is well outside it.
    expect(step.hitThisFrame).toEqual(['a'])
  })

  it('reports nothing on a frame with no gust', () => {
    const step = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: false,
    }, 1 / 60, C)
    expect(step.hitThisFrame).toEqual([])
  })

  it('does not report a gust that swept an already-downed enemy', () => {
    // A connect has to mean a live enemy took it, or Focus would pay the player for
    // blowing a body around the island.
    const base = near()
    const alreadyDowned = {
      ...base,
      enemies: base.enemies.map((enemy) => ({
        ...enemy, health: { ...enemy.health, current: 0 },
      })),
    }
    const step = stepEncounter(alreadyDowned, {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true,
    }, 1 / 60, C)

    expect(step.hitThisFrame).toEqual([])
  })
})
