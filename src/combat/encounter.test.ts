import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  startEncounter, stepEncounter, canGust, canVortex, type CombatConfig, type EncounterInput,
  type EnemySpawn,
} from './encounter'
import { isDowned } from './health'
import { DEFAULT_COMBAT_CONFIG } from './config'

const C: CombatConfig = {
  player: { maxHealth: 5, outOfCombatSeconds: 4, regenPerSecond: 0.4 },
  enemy: {
    maxHealth: 1.5, outOfCombatSeconds: 4, regenPerSecond: 0,
    moveSpeed: 4, strikeRange: 3, aggroRange: 30, windUpSeconds: 0.5, recoverSeconds: 0.6,
    strikeDamage: 1, knockbackDamping: 3,
    // Matches DEFAULT_COMBAT_CONFIG.enemy.gravity.
    gravity: 20,
    // Matches DEFAULT_COMBAT_CONFIG.enemy.snapDistance.
    snapDistance: 1.2,
  },
  gust: { range: 12, halfAngle: Math.PI / 3, damage: 0.5, knockback: 26, cooldownSeconds: 0.5 },
  pressureWave: {
    minImpactSpeed: 10, fullImpactSpeed: 50, minRadius: 4, maxRadius: 12,
    minDamage: 0.5, maxDamage: 2.5, minKnockback: 10, maxKnockback: 30,
    bounceFactor: 0.5,
  },
  vortex: {
    maxChargeSeconds: 1.2, minChargeSeconds: 0.2, minRadius: 5, maxRadius: 12,
    minPullSpeed: 10, maxPullSpeed: 18, minLiftSpeed: 5, maxLiftSpeed: 11,
    cooldownSeconds: 3.5,
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

/** A neutral frame of input: nothing pressed, nothing held. */
const defaults: EncounterInput = {
  playerPosition: ORIGIN, playerForward: NORTH, gustPressed: false, slam: null,
  vortexHeld: false, vortexReleased: false, playerInvulnerable: false,
}

/** Run the fight with fixed input. */
function run(seconds: number, over: Partial<EncounterInput> = {}, from = near()) {
  let encounter = from
  let downed: string[] = []
  let hits = 0
  for (let t = 0; t < seconds; t += 1 / 60) {
    const step = stepEncounter(encounter, { ...defaults, ...over }, 1 / 60, C, DEPS)
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
    const gusted = stepEncounter(winding, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)
    expect(gusted.encounter.enemies[0]!.stance).not.toBe('wind-up')
    expect(gusted.playerHit).toBe(false)
  })

  it('goes on cooldown so it cannot be held down', () => {
    const fired = stepEncounter(near(), { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)
    expect(canGust(fired.encounter)).toBe(false)
  })

  it('comes back off cooldown', () => {
    const fired = stepEncounter(near(), { ...defaults, gustPressed: true }, 1 / 60, C, DEPS).encounter
    expect(canGust(run(C.gust.cooldownSeconds + 0.2, {}, fired).encounter)).toBe(true)
  })

  it('does not down an enemy in one gust, because gust is not a damage move', () => {
    // Health 1.5 against damage 0.5. If a single gust downed an enemy, the move
    // would be a damage move wearing a crowd-control costume.
    const fired = stepEncounter(near(), { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)
    expect(fired.downedThisFrame).toEqual([])
    expect(isDowned(fired.encounter.enemies[0]!.health)).toBe(false)
  })

  it('blows the enemy out of its own gust range, so it has to be re-engaged', () => {
    // Emergent from the numbers rather than designed in, and worth pinning: a
    // knockback that big means gust cannot be spammed on one target from one spot.
    const fired = stepEncounter(near(), { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)
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
    const step = stepEncounter(encounter, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)

    // 'a' is inside the 12 unit range; 'b' at 40 is well outside it.
    expect(step.hitThisFrame).toEqual(['a'])
  })

  it('reports nothing on a frame with no gust', () => {
    const step = stepEncounter(near(), defaults, 1 / 60, C, DEPS)
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
    const step = stepEncounter(alreadyDowned, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)

    expect(step.hitThisFrame).toEqual([])
  })
})

describe('slamming', () => {
  const slamAt = (strength: number) => ({ ...defaults, slam: { strength } })

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
    const step = stepEncounter(near(), defaults, 1 / 60, C, DEPS)
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

describe('a vortex', () => {
  /** Hold for `seconds`, then release, and return the resulting step. */
  const chargeAndRelease = (seconds: number, enemies: EnemySpawn[]) => {
    let encounter = startEncounter(enemies, DEFAULT_COMBAT_CONFIG)
    for (let t = 0; t < seconds; t += 1 / 60) {
      encounter = stepEncounter(
        encounter, { ...defaults, vortexHeld: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      ).encounter
    }
    return stepEncounter(
      encounter, { ...defaults, vortexReleased: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
  }

  it('accumulates charge while held', () => {
    let encounter = startEncounter([], DEFAULT_COMBAT_CONFIG)
    for (let t = 0; t < 0.5; t += 1 / 60) {
      encounter = stepEncounter(
        encounter, { ...defaults, vortexHeld: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      ).encounter
    }
    expect(encounter.vortexHeldSeconds).toBeGreaterThan(0.4)
  })

  it('drops an abandoned charge if the key goes away without a release edge', () => {
    // The shape a window blur produces: InputTracker's blur handler clears the
    // held-key set but fires no keyup, so a frame can see vortexHeld go false
    // with vortexReleased staying false too. Without a reset for that case the
    // charge would freeze rather than clear, and a later tap would resume on top
    // of the stale total and fire a bigger vortex than that tap earned.
    let encounter = startEncounter([], DEFAULT_COMBAT_CONFIG)
    for (let t = 0; t < 0.5; t += 1 / 60) {
      encounter = stepEncounter(
        encounter, { ...defaults, vortexHeld: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      ).encounter
    }
    expect(encounter.vortexHeldSeconds).toBeGreaterThan(0)

    encounter = stepEncounter(encounter, defaults, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS).encounter
    expect(encounter.vortexHeldSeconds).toBe(0)
  })

  it('lifts a caught enemy and spends the cooldown', () => {
    const step = chargeAndRelease(
      DEFAULT_COMBAT_CONFIG.vortex.maxChargeSeconds, [{ id: 'a', position: new Vector3(3, 0, 0) }],
    )
    const enemy = step.encounter.enemies[0]
    if (!enemy) throw new Error('expected an enemy')
    expect(enemy.verticalVelocity).toBeGreaterThan(0)
    expect(step.encounter.vortexCooldown).toBeCloseTo(DEFAULT_COMBAT_CONFIG.vortex.cooldownSeconds, 5)
    expect(step.vortexFired).not.toBeNull()
  })

  it('does no damage', () => {
    // "Setup, not damage" — the enemy must come out of a vortex at full health.
    // vortexFired is asserted too: without it, this test would pass just as well
    // against a vortex that never fired at all, which proves nothing about the move.
    const step = chargeAndRelease(
      DEFAULT_COMBAT_CONFIG.vortex.maxChargeSeconds, [{ id: 'a', position: new Vector3(3, 0, 0) }],
    )
    const enemy = step.encounter.enemies[0]
    if (!enemy) throw new Error('expected an enemy')
    expect(step.vortexFired).not.toBeNull()
    expect(enemy.health.current).toBeCloseTo(DEFAULT_COMBAT_CONFIG.enemy.maxHealth, 5)
  })

  it('cancels for free below the minimum charge', () => {
    const step = chargeAndRelease(
      DEFAULT_COMBAT_CONFIG.vortex.minChargeSeconds / 2,
      [{ id: 'a', position: new Vector3(3, 0, 0) }],
    )
    const enemy = step.encounter.enemies[0]
    if (!enemy) throw new Error('expected an enemy')
    expect(enemy.verticalVelocity).toBe(0)
    expect(step.encounter.vortexCooldown).toBe(0)
    expect(step.vortexFired).toBeNull()
    expect(step.encounter.vortexHeldSeconds).toBe(0)
  })

  it('interrupts a wind-up', () => {
    // Derived, not assumed: step until the enemy is genuinely winding up first. An
    // earlier version of this test in this file used a fixture that never reached
    // wind-up, so it passed against a move that interrupted nothing.
    let encounter = startEncounter(
      [{ id: 'a', position: new Vector3(2, 0, 0) }], DEFAULT_COMBAT_CONFIG,
    )
    for (let t = 0; t < 1; t += 1 / 60) {
      encounter = stepEncounter(encounter, defaults, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS).encounter
      if (encounter.enemies[0]?.stance === 'wind-up') break
    }
    expect(encounter.enemies[0]?.stance).toBe('wind-up')

    for (let t = 0; t < DEFAULT_COMBAT_CONFIG.vortex.minChargeSeconds + 0.1; t += 1 / 60) {
      encounter = stepEncounter(
        encounter, { ...defaults, vortexHeld: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      ).encounter
    }
    const fired = stepEncounter(
      encounter, { ...defaults, vortexReleased: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
    expect(fired.encounter.enemies[0]?.stance).not.toBe('wind-up')
  })

  it('cannot charge while on cooldown', () => {
    const fired = chargeAndRelease(
      DEFAULT_COMBAT_CONFIG.vortex.maxChargeSeconds, [{ id: 'a', position: new Vector3(3, 0, 0) }],
    )
    const held = stepEncounter(
      fired.encounter, { ...defaults, vortexHeld: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
    expect(held.encounter.vortexHeldSeconds).toBe(0)
  })

  it('does not start charging on the frame the cooldown runs out', () => {
    // `canVortex` reads the stored cooldown, and the action guide asks it for availability,
    // so the fight must not bank charge a frame before the guide admits it can. Gating on a
    // locally decremented copy let it start exactly one frame early.
    const lastFrame = { ...startEncounter([], DEFAULT_COMBAT_CONFIG), vortexCooldown: 1 / 60 }
    expect(canVortex(lastFrame)).toBe(false)
    const held = stepEncounter(
      lastFrame, { ...defaults, vortexHeld: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
    expect(held.encounter.vortexHeldSeconds).toBe(0)
  })
})

describe('invulnerability', () => {
  /** Step until the enemy's strike would land, returning every step. */
  const untilStrike = (invulnerable: boolean) => {
    let encounter = startEncounter(
      [{ id: 'a', position: new Vector3(1, 0, 0) }], DEFAULT_COMBAT_CONFIG,
    )
    const steps = []
    // At this range the enemy is in strike range from frame one, so wind-up,
    // strike and recover repeat back-to-back with no approach in between. The
    // window has to land inside that first recovery and stop short of the next
    // wind-up, or the exact stopping point would depend on which phase of a later
    // cycle a hardcoded duration happens to land in.
    const enemyC = DEFAULT_COMBAT_CONFIG.enemy
    const duration = enemyC.windUpSeconds + enemyC.recoverSeconds / 2
    for (let t = 0; t < duration; t += 1 / 60) {
      const step = stepEncounter(
        encounter, { ...defaults, playerInvulnerable: invulnerable },
        1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      )
      encounter = step.encounter
      steps.push(step)
    }
    return { encounter, steps }
  }

  it('takes the hit when not invulnerable', () => {
    // The control for the test below: without it, "no damage" proves nothing.
    const { encounter } = untilStrike(false)
    expect(encounter.playerHealth.current).toBeLessThan(DEFAULT_COMBAT_CONFIG.player.maxHealth)
  })

  it('discards the damage when invulnerable', () => {
    const { encounter } = untilStrike(true)
    expect(encounter.playerHealth.current).toBeCloseTo(DEFAULT_COMBAT_CONFIG.player.maxHealth, 5)
  })

  it('reports the dodge, and does not report a hit', () => {
    const { steps } = untilStrike(true)
    expect(steps.some((s) => s.damageAvoided)).toBe(true)
    expect(steps.some((s) => s.playerHit)).toBe(false)
  })

  it('reports no dodge when there was no damage to avoid', () => {
    // The anti-farming rule. A flag meaning "invulnerable this frame" would let a
    // player build Focus by dodging an empty field, turning section 4.5's reward for
    // skill into a grind.
    let encounter = startEncounter([], DEFAULT_COMBAT_CONFIG)
    for (let t = 0; t < 1; t += 1 / 60) {
      const step = stepEncounter(
        encounter, { ...defaults, playerInvulnerable: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      )
      encounter = step.encounter
      expect(step.damageAvoided).toBe(false)
    }
  })

  it('still costs the attacker its wind-up', () => {
    // A dodge beats the attack; it does not erase it. The enemy commits and recovers.
    const { encounter } = untilStrike(true)
    expect(['recover', 'advance']).toContain(encounter.enemies[0]?.stance)
  })
})
