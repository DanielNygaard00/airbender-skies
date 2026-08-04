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
    // Matches DEFAULT_COMBAT_CONFIG.enemy.gravity.
    gravity: 20,
  },
  gust: { range: 12, halfAngle: Math.PI / 3, damage: 0.5, knockback: 26, cooldownSeconds: 0.5 },
  pressureWave: {
    minImpactSpeed: 10, fullImpactSpeed: 50, minRadius: 4, maxRadius: 12,
    minDamage: 0.5, maxDamage: 2.5, minKnockback: 10, maxKnockback: 30,
    bounceFactor: 0.5,
  },
}

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
const near = () => startEncounter([{ id: 'a', position: new Vector3(0, 0, -2) }], C)

// Flat, bottomless-pit-free ground: existing tests were written before gravity
// existed, so a flat floor well below anything the fight does keeps them
// exercising the same horizontal behaviour rather than newly falling enemies.
const flatGround = { groundHeightAt: () => 0 }
const DEPS = { ground: flatGround, worldFloorY: -50 }

/** Run the fight with fixed input. */
function run(seconds: number, over: Partial<Parameters<typeof stepEncounter>[1]> = {}, from = near()) {
  let encounter = from
  let downed: string[] = []
  let hits = 0
  for (let t = 0; t < seconds; t += 1 / 60) {
    const step = stepEncounter(encounter, {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: false, slam: null, ...over,
    }, 1 / 60, C, DEPS)
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
    // with high knockback and almost no damage. Built directly rather than derived
    // through run(), so the margin to windUpSeconds is exact: a dt short of the
    // threshold means this very frame's enemy step would land the strike, if the
    // gust did not get to the enemy first. (Same rule the slam ordering test below
    // pins down.)
    const base = near()
    const winding = {
      ...base,
      enemies: base.enemies.map((enemy) => ({
        ...enemy, stance: 'wind-up' as const, stanceTime: C.enemy.windUpSeconds - (1 / 60) / 2,
      })),
    }
    const gusted = stepEncounter(winding, {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true, slam: null,
    }, 1 / 60, C, DEPS)
    expect(gusted.encounter.enemies[0]!.stance).not.toBe('wind-up')
    expect(gusted.playerHit).toBe(false)
  })

  it('goes on cooldown so it cannot be held down', () => {
    const fired = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true, slam: null,
    }, 1 / 60, C, DEPS)
    expect(canGust(fired.encounter)).toBe(false)
  })

  it('comes back off cooldown', () => {
    const fired = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true, slam: null,
    }, 1 / 60, C, DEPS).encounter
    expect(canGust(run(C.gust.cooldownSeconds + 0.2, {}, fired).encounter)).toBe(true)
  })

  it('does not down an enemy in one gust, because gust is not a damage move', () => {
    // Health 1.5 against damage 0.5. If a single gust downed an enemy, the move
    // would be a damage move wearing a crowd-control costume.
    const fired = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true, slam: null,
    }, 1 / 60, C, DEPS)
    expect(fired.downedThisFrame).toEqual([])
    expect(isDowned(fired.encounter.enemies[0]!.health)).toBe(false)
  })

  it('blows the enemy out of its own gust range, so it has to be re-engaged', () => {
    // Emergent from the numbers rather than designed in, and worth pinning: a
    // knockback that big means gust cannot be spammed on one target from one spot.
    const fired = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true, slam: null,
    }, 1 / 60, C, DEPS)
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
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true, slam: null,
    }, 1 / 60, C, DEPS)

    // 'a' is inside the 12 unit range; 'b' at 40 is well outside it.
    expect(step.hitThisFrame).toEqual(['a'])
  })

  it('reports nothing on a frame with no gust', () => {
    const step = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: false, slam: null,
    }, 1 / 60, C, DEPS)
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
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: true, slam: null,
    }, 1 / 60, C, DEPS)

    expect(step.hitThisFrame).toEqual([])
  })
})

describe('slamming', () => {
  const slamAt = (strength: number) => ({
    playerPosition: ORIGIN, playerForward: NORTH, gustPressed: false, slam: { strength },
  })

  it('damages an enemy inside the blast', () => {
    const before = near().enemies[0]!.health.current
    const step = stepEncounter(near(), slamAt(1), 1 / 60, C, DEPS)
    expect(step.encounter.enemies[0]!.health.current).toBeLessThan(before)
  })

  it('leaves an enemy outside the blast alone', () => {
    const far = startEncounter([{ id: 'a', position: new Vector3(0, 0, -60) }], C)
    const step = stepEncounter(far, slamAt(1), 1 / 60, C, DEPS)
    expect(step.encounter.enemies[0]!.health.current).toBeCloseTo(C.enemy.maxHealth)
  })

  it('downs an enemy in one full-strength slam', () => {
    // The payoff, and the thing that separates the wave from the gust: a gust needs
    // three connects, a committed dive needs one.
    const step = stepEncounter(near(), slamAt(1), 1 / 60, C, DEPS)
    expect(step.downedThisFrame).toEqual(['a'])
    expect(isDowned(step.encounter.enemies[0]!.health)).toBe(true)
  })

  it('does not down an enemy in one minimum slam', () => {
    const step = stepEncounter(near(), slamAt(0), 1 / 60, C, DEPS)
    expect(step.downedThisFrame).toEqual([])
    expect(isDowned(step.encounter.enemies[0]!.health)).toBe(false)
  })

  it('hits enemies behind the player, unlike a gust', () => {
    const behind = startEncounter([{ id: 'b', position: new Vector3(0, 0, 2) }], C)
    const step = stepEncounter(behind, slamAt(1), 1 / 60, C, DEPS)
    expect(step.slamHitThisFrame).toEqual(['b'])
  })

  it('reports slam connects apart from gust connects', () => {
    // Kept separate on purpose: hitThisFrame feeds a per-enemy Focus grant, so
    // folding the wave in would pay the player twice for one slam.
    const step = stepEncounter(near(), slamAt(1), 1 / 60, C, DEPS)
    expect(step.slamHitThisFrame).toEqual(['a'])
    expect(step.hitThisFrame).toEqual([])
  })

  it('does not report a slam that swept an already-downed enemy', () => {
    const base = near()
    const alreadyDowned = {
      ...base,
      enemies: base.enemies.map((enemy) => ({
        ...enemy, health: { ...enemy.health, current: 0 },
      })),
    }
    const step = stepEncounter(alreadyDowned, slamAt(1), 1 / 60, C, DEPS)
    expect(step.slamHitThisFrame).toEqual([])
  })

  it('changes nothing on a frame with no slam', () => {
    const step = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: false, slam: null,
    }, 1 / 60, C, DEPS)
    expect(step.slamHitThisFrame).toEqual([])
    expect(step.encounter.enemies[0]!.health.current).toBeCloseTo(C.enemy.maxHealth)
  })

  it('interrupts a wind-up instead of trading with it', () => {
    // Same rule as the gust: the wave resolves before the enemies act. Built
    // directly rather than via run(), so the margin to windUpSeconds is exact: a
    // dt short of the threshold means this very frame's enemy step would land the
    // strike, if the slam did not get to the enemy first.
    const base = near()
    const winding = {
      ...base,
      enemies: base.enemies.map((enemy) => ({
        ...enemy, stance: 'wind-up' as const, stanceTime: C.enemy.windUpSeconds - (1 / 60) / 2,
      })),
    }
    const slammed = stepEncounter(winding, slamAt(0.3), 1 / 60, C, DEPS)
    expect(slammed.encounter.enemies[0]!.stance).not.toBe('wind-up')
    expect(slammed.playerHit).toBe(false)
  })

  it('knocks a slammed enemy away from the player', () => {
    const step = stepEncounter(near(), slamAt(1), 1 / 60, C, DEPS)
    // 'a' starts at z -2, so it is pushed further negative.
    expect(step.encounter.enemies[0]!.knockback.z).toBeLessThan(0)
    // Lift and horizontal push are different physics now — a decaying horizontal
    // push and a ballistic arc — so damping a fall would make a body float down.
    // That split means the slam's upward component lands in verticalVelocity, and
    // knockback.y stays zero; pin both halves of the contract, not just one.
    expect(step.encounter.enemies[0]!.verticalVelocity).toBeGreaterThan(0)
    expect(step.encounter.enemies[0]!.knockback.y).toBe(0)
  })
})
