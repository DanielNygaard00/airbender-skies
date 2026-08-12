import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  startEncounter, stepEncounter, canGust, canVortex, type CombatConfig, type Encounter,
  type EncounterInput, type EnemySpawn, type PlayerHit,
} from './encounter'
import { isDowned } from './health'
import { horizontalDistance } from './enemy'
import { gustTargets } from './gust'
import { spawnProjectile } from './projectile'
import { DEFAULT_COMBAT_CONFIG, DEFAULT_PATROL_CONFIG, HOME_PATROL } from './config'

const C: CombatConfig = {
  player: { maxHealth: 5, outOfCombatSeconds: 4, regenPerSecond: 0.4 },
  enemies: {
    spear: {
      maxHealth: 1.5, outOfCombatSeconds: 4, regenPerSecond: 0,
      moveSpeed: 4, strikeRange: 3, aggroRange: 30, windUpSeconds: 0.5, recoverSeconds: 0.6,
      attack: { kind: 'melee', damage: 1 }, knockbackDamping: 3,
      // Matches DEFAULT_COMBAT_CONFIG.enemies.spear.gravity.
      gravity: 20,
      // Matches DEFAULT_COMBAT_CONFIG.enemies.spear.snapDistance.
      snapDistance: 1.2,
      downedSeconds: 18, risingSeconds: 1.2, recoveryHealthFractions: [0.6, 0.3],
    },
    // Deliberately different from the spear on every tuning axis, and its
    // strikeRange (22) is well past the 10 units a mixed-patrol fixture needs to
    // stand back an archer, and distinct from the shipped config's 40 so a test
    // that accidentally read the real config would be visible.
    //
    // That includes the damage: it used to be 1, the same as the spear's, which meant an
    // arrow spawned from the wrong kind's config carried an indistinguishable value. 0.8
    // instead, so a cross-kind mix-up is visible in an assertion.
    archer: {
      maxHealth: 1, outOfCombatSeconds: 4, regenPerSecond: 0,
      moveSpeed: 3, strikeRange: 22, aggroRange: 35, windUpSeconds: 0.6, recoverSeconds: 0.9,
      attack: { kind: 'projectile', damage: 0.8, speed: 20 }, knockbackDamping: 3,
      gravity: 20,
      snapDistance: 1.2,
      downedSeconds: 18, risingSeconds: 1.2, recoveryHealthFractions: [0.6, 0.3],
    },
  },
  // Both values are load-bearing here, not just shape. Three tests fly an arrow all the
  // way into the player -- "lets the stepping loop use each enemy's own kind", "eventually
  // hurts a player standing in front of it" and "lets a slipstream dodge an arrow" -- and
  // each of them goes red if hitRadius drops to 0 (nothing ever connects) or if maxSeconds
  // drops to 0 (every arrow expires before it arrives).
  projectile: { hitRadius: 0.9, maxSeconds: 4 },
  // The four vertical extents below are byte-identical duplicates of the shipped values, not
  // independent choices: 5, 4, 8 and 2 are exactly what DEFAULT_COMBAT_CONFIG carries. That
  // breaks the convention the numbers around them follow -- the archer's strikeRange is
  // deliberately distinct from the real config so a fixture that accidentally read it would be
  // visible -- and it is tolerable only because no assertion in this file measures a height:
  // every fixture here fights on level ground. A fixture that ever needs one must read the
  // shipped value rather than trust these to have kept up with it. `cone.test.ts` and each
  // move's own suite are what actually pin the extents.
  gust: {
    range: 12, halfAngle: Math.PI / 3, verticalReach: 5,
    damage: 0.5, knockback: 26, cooldownSeconds: 0.5,
  },
  pressureWave: {
    minImpactSpeed: 10, fullImpactSpeed: 50, minRadius: 4, maxRadius: 12, verticalReach: 4,
    minDamage: 0.5, maxDamage: 2.5, minKnockback: 10, maxKnockback: 30,
    bounceFactor: 0.5,
  },
  vortex: {
    maxChargeSeconds: 1.2, minChargeSeconds: 0.2, minRadius: 5, maxRadius: 12,
    verticalReach: 8,
    minPullSpeed: 10, maxPullSpeed: 18, minLiftSpeed: 5, maxLiftSpeed: 11,
    cooldownSeconds: 3.5,
  },
  staffArc: {
    opener: { range: 3.6, halfAngle: Math.PI / 2.2, verticalReach: 2 },
    finisher: { range: 4.2, halfAngle: Math.PI / 1.9, verticalReach: 2 },
    openerDamage: 0.7,
    finisherDamage: 1.2,
    openerKnockback: 4,
    finisherKnockback: 18,
  },
  // Deliberately unlike the shipped values on every axis a test here could read by accident:
  // range 5 rather than 4, a 30-degree half-angle rather than 45, and a vertical extent that
  // is not equal to the range. The one relationship the shipped config asserts --
  // `verticalReach >= range` -- is pinned in `air-wall.test.ts` against the real config, so
  // breaking it here costs nothing and makes a fixture mix-up visible.
  airWall: {
    range: 5, halfAngle: Math.PI / 6, verticalReach: 6,
    maxSeconds: 1, cooldownSeconds: 3, breathCost: 20,
  },
}

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
const near = () => startEncounter([{ id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' }], C)

// Flat, bottomless-pit-free ground: existing tests were written before gravity
// existed, so a flat floor well below anything the fight does keeps them
// exercising the same horizontal behaviour rather than newly falling enemies.
const flatGround = { groundHeightAt: () => 0 }
// An empty spawn list, so shouldRestorePatrol always declines and every test in this
// file that predates the respawn keeps exercising exactly what it used to. The
// restore has its own deps, built in its own describe block.
const DEPS = { ground: flatGround, worldFloorY: -50, spawns: [], patrol: { respawnRange: 40 } }

/** A neutral frame of input: nothing pressed, nothing held. */
const defaults: EncounterInput = {
  playerPosition: ORIGIN, playerForward: NORTH, gustPressed: false, slam: null,
  vortexHeld: false, vortexReleased: false, playerInvulnerable: false, staffSwing: null,
  // Aim starts equal to `playerForward`, which is what the game hands over on foot: there
  // `player.forward` IS the flattened look direction. Tests that need an elevation override it.
  playerAim: NORTH, playerBreath: 100, airWallHeld: false,
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

/** The single soldier of `near()`, already flat, having gone down `downs` times. */
function downedSoldier(downs: number): Encounter {
  const base = near()
  const enemy = base.enemies[0]!
  return {
    ...base,
    enemies: [{
      ...enemy,
      health: { ...enemy.health, current: 0 },
      stance: 'downed' as const,
      stanceTime: 0,
      downs,
    }],
  }
}

/** The same soldier, on its feet and one gust from going down again. */
function almostDown(downs: number): Encounter {
  const base = near()
  const enemy = base.enemies[0]!
  return {
    ...base,
    enemies: [{ ...enemy, health: { ...enemy.health, current: 0.1 }, downs }],
  }
}

const gustOnce = (from: Encounter) =>
  stepEncounter(from, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)

describe('the fight runs', () => {
  it('hurts a player who stands in reach doing nothing', () => {
    const { encounter, hits } = run(4)
    expect(hits).toBeGreaterThan(0)
    expect(encounter.playerHealth.current).toBeLessThan(C.player.maxHealth)
  })

  it('leaves a player alone who keeps their distance', () => {
    const far = startEncounter([{ id: 'a', position: new Vector3(0, 0, -80), kind: 'spear' }], C)
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
        ...enemy, stance: 'wind-up' as const, stanceTime: C.enemies.spear.windUpSeconds - (1 / 60) / 2,
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
    expect(distance).toBeGreaterThan(C.enemies.spear.strikeRange)
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
      { id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' },
      { id: 'b', position: new Vector3(0, 0, -40), kind: 'spear' },
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
    const far = startEncounter([{ id: 'a', position: new Vector3(0, 0, -60), kind: 'spear' }], C)
    const step = stepEncounter(far, slamAt(1), 1 / 60, C, DEPS)
    expect(step.encounter.enemies[0]!.health.current).toBeCloseTo(C.enemies.spear.maxHealth)
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
    const behind = startEncounter([{ id: 'b', position: new Vector3(0, 0, 2), kind: 'spear' }], C)
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
    expect(step.encounter.enemies[0]!.health.current).toBeCloseTo(C.enemies.spear.maxHealth)
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
        ...enemy, stance: 'wind-up' as const, stanceTime: C.enemies.spear.windUpSeconds - (1 / 60) / 2,
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
      DEFAULT_COMBAT_CONFIG.vortex.maxChargeSeconds, [{ id: 'a', position: new Vector3(3, 0, 0), kind: 'spear' }],
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
      DEFAULT_COMBAT_CONFIG.vortex.maxChargeSeconds, [{ id: 'a', position: new Vector3(3, 0, 0), kind: 'spear' }],
    )
    const enemy = step.encounter.enemies[0]
    if (!enemy) throw new Error('expected an enemy')
    expect(step.vortexFired).not.toBeNull()
    expect(enemy.health.current).toBeCloseTo(DEFAULT_COMBAT_CONFIG.enemies.spear.maxHealth, 5)
  })

  it('cancels for free below the minimum charge', () => {
    const step = chargeAndRelease(
      DEFAULT_COMBAT_CONFIG.vortex.minChargeSeconds / 2,
      [{ id: 'a', position: new Vector3(3, 0, 0), kind: 'spear' }],
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
      [{ id: 'a', position: new Vector3(2, 0, 0), kind: 'spear' }], DEFAULT_COMBAT_CONFIG,
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
      DEFAULT_COMBAT_CONFIG.vortex.maxChargeSeconds, [{ id: 'a', position: new Vector3(3, 0, 0), kind: 'spear' }],
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
      [{ id: 'a', position: new Vector3(1, 0, 0), kind: 'spear' }], DEFAULT_COMBAT_CONFIG,
    )
    const steps = []
    // At this range the enemy is in strike range from frame one, so wind-up,
    // strike and recover repeat back-to-back with no approach in between. The
    // window has to land inside that first recovery and stop short of the next
    // wind-up, or the exact stopping point would depend on which phase of a later
    // cycle a hardcoded duration happens to land in.
    const enemyC = DEFAULT_COMBAT_CONFIG.enemies.spear
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

describe('a staff swing', () => {
  const swing = (finisher: boolean, spawns: EnemySpawn[]) => stepEncounter(
    startEncounter(spawns, DEFAULT_COMBAT_CONFIG),
    { ...defaults, staffSwing: { index: finisher ? 3 : 1, finisher } },
    1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
  )

  it('damages an enemy in the arc and reports the hit', () => {
    const step = swing(false, [{ id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' }])
    const enemy = step.encounter.enemies[0]
    if (!enemy) throw new Error('expected an enemy')
    expect(enemy.health.current).toBeCloseTo(
      DEFAULT_COMBAT_CONFIG.enemies.spear.maxHealth - DEFAULT_COMBAT_CONFIG.staffArc.openerDamage, 5,
    )
    expect(step.staffHitThisFrame).toEqual(['a'])
  })

  it('leaves an enemy outside the arc alone', () => {
    const step = swing(false, [{ id: 'a', position: new Vector3(0, 0, 20), kind: 'spear' }])
    expect(step.staffHitThisFrame).toEqual([])
  })

  it('hits a whole group with one swing', () => {
    const step = swing(false, [
      { id: 'a', position: new Vector3(-1.5, 0, -1.5), kind: 'spear' },
      { id: 'b', position: new Vector3(0, 0, -2), kind: 'spear' },
      { id: 'c', position: new Vector3(1.5, 0, -1.5), kind: 'spear' },
    ])
    expect(step.staffHitThisFrame.sort()).toEqual(['a', 'b', 'c'])
  })

  it('hits harder on the finisher', () => {
    const spawns: EnemySpawn[] = [{ id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' }]
    const opener = swing(false, spawns).encounter.enemies[0]
    const finisher = swing(true, spawns).encounter.enemies[0]
    if (!opener || !finisher) throw new Error('expected enemies')
    expect(finisher.health.current).toBeLessThan(opener.health.current)
  })

  it('keeps its hits apart from gust connects and slam hits', () => {
    // Each of the three feeds a differently tuned Focus grant, so folding them together
    // would pay the wrong rate.
    const step = swing(false, [{ id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' }])
    expect(step.hitThisFrame).toEqual([])
    expect(step.slamHitThisFrame).toEqual([])
  })

  it('interrupts a wind-up', () => {
    // Stepped into a genuine wind-up first rather than assumed: a fixture that never
    // reaches one would pass against a swing that interrupts nothing.
    let encounter = startEncounter(
      [{ id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' }], DEFAULT_COMBAT_CONFIG,
    )
    for (let t = 0; t < 1; t += 1 / 60) {
      encounter = stepEncounter(encounter, defaults, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS).encounter
      if (encounter.enemies[0]?.stance === 'wind-up') break
    }
    expect(encounter.enemies[0]?.stance).toBe('wind-up')
    const struck = stepEncounter(
      encounter, { ...defaults, staffSwing: { index: 1, finisher: false } },
      1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
    expect(struck.encounter.enemies[0]?.stance).not.toBe('wind-up')
  })

  it('does not hit a downed enemy', () => {
    // Hits exactly enough to down the enemy, not a fixed handful: each swing's
    // knockback compounds with the last (hitEnemy adds impulse onto whatever
    // knockback is already there), and a few swings past downed fling the corpse
    // out of the opener's range on their own. That would make the assertion below
    // pass on distance alone, with the isDowned guard never in the loop.
    const hitsToDown = Math.ceil(
      DEFAULT_COMBAT_CONFIG.enemies.spear.maxHealth / DEFAULT_COMBAT_CONFIG.staffArc.finisherDamage,
    )
    const spawns: EnemySpawn[] = [{ id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' }]
    let encounter = startEncounter(spawns, DEFAULT_COMBAT_CONFIG)
    for (let i = 0; i < hitsToDown; i++) {
      encounter = stepEncounter(
        encounter, { ...defaults, staffSwing: { index: 3, finisher: true } },
        1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      ).encounter
    }
    expect(isDowned(encounter.enemies[0]?.health ?? { current: 1, max: 1, sinceHit: 0 })).toBe(true)
    const again = stepEncounter(
      encounter, { ...defaults, staffSwing: { index: 1, finisher: false } },
      1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
    expect(again.staffHitThisFrame).toEqual([])
  })
})

describe('a removal by accident is reported apart from a knockdown', () => {
  // Ground that is not there, and a floor just below the first frame's fall, so one
  // step takes the soldier out of the world. worldFloorY of -1 (matching DEPS's shape)
  // would not do it: with gravity 20 and dt 1/60, semi-implicit Euler puts the enemy at
  // y = -g*dt^2 = -1/180 (~-0.0056) after one frame, and it takes 19 frames of free fall
  // to pass y = -1. -0.001 sits just above that first-frame position, so it crosses in
  // exactly the one step these tests step.
  const voidDeps = {
    ground: { groundHeightAt: () => null }, worldFloorY: -0.001,
    // Empty, same reasoning as DEPS: no spawns means the restore never fires here.
    spawns: [], patrol: { respawnRange: 40 },
  }

  it('reports a fallen enemy as lost', () => {
    const start = startEncounter([{ id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' }], C)
    const step = stepEncounter(start, defaults, 1 / 60, C, voidDeps)
    expect(step.lostThisFrame).toEqual(['a'])
  })

  it('does not also report it as downed', () => {
    // The double-pay bug. `downedThisFrame` is computed by diffing the downed set
    // across the step, so a fallen enemy lands in it as well -- and Focus would grant
    // both downGain and accidentDownGain for one soldier. A test that only checks
    // `lostThisFrame` passes while that is live, which is why this asserts both.
    const start = startEncounter([{ id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' }], C)
    const step = stepEncounter(start, defaults, 1 / 60, C, voidDeps)
    expect(step.lostThisFrame).toEqual(['a'])
    expect(step.downedThisFrame).toEqual([])
  })

  it('reports a gusted enemy as downed and not as lost', () => {
    // The other direction: the split must not have moved ordinary knockdowns.
    let encounter = startEncounter([{ id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' }], C)
    const downs: string[] = []
    const losses: string[] = []
    for (let i = 0; i < 240; i++) {
      const step = stepEncounter(
        encounter, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS,
      )
      downs.push(...step.downedThisFrame)
      losses.push(...step.lostThisFrame)
      encounter = step.encounter
    }
    expect(downs).toEqual(['a'])
    expect(losses).toEqual([])
  })

  it('reports nothing on a quiet frame', () => {
    const step = stepEncounter(near(), defaults, 1 / 60, C, DEPS)
    expect(step.lostThisFrame).toEqual([])
    expect(step.downedThisFrame).toEqual([])
  })
})

describe('a cleared patrol comes back', () => {
  const SPAWNS: EnemySpawn[] = [{ id: 'a', position: new Vector3(0, 0, -2), kind: 'spear' }]
  const withPatrol = { ...DEPS, spawns: SPAWNS, patrol: { respawnRange: 40 } }

  /** Gust the soldier down, standing next to it. */
  function clear() {
    let encounter = startEncounter(SPAWNS, C)
    for (let i = 0; i < 240; i++) {
      encounter = stepEncounter(
        encounter, { ...defaults, gustPressed: true }, 1 / 60, C, withPatrol,
      ).encounter
    }
    return encounter
  }

  it('does not come back while the player is standing over it', () => {
    const cleared = clear()
    const step = stepEncounter(cleared, defaults, 1 / 60, C, withPatrol)
    expect(step.restoredThisFrame).toEqual([])
    expect(isDowned(step.encounter.enemies[0]!.health)).toBe(true)
  })

  it('comes back at full health once the player has left', () => {
    const cleared = clear()
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const step = stepEncounter(cleared, away, 1 / 60, C, withPatrol)
    expect(step.restoredThisFrame).toEqual(['a'])
    const restored = step.encounter.enemies[0]
    if (!restored) throw new Error('the patrol should have been restored')
    expect(restored.health.current).toBe(C.enemies.spear.maxHealth)
    expect(isDowned(restored.health)).toBe(false)
    expect(restored.position.z).toBeCloseTo(-2)
  })

  it('reports no phantom events on the frame it restores', () => {
    // The ordering bug this guards. `wasDowned` is diffed at the top of stepEncounter,
    // so replacing the enemy array before those lists are built would compare a fresh
    // soldier against a downed one. Restoring last means the frame reports nothing.
    const cleared = clear()
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const step = stepEncounter(cleared, away, 1 / 60, C, withPatrol)
    expect(step.downedThisFrame).toEqual([])
    expect(step.lostThisFrame).toEqual([])
    expect(step.hitThisFrame).toEqual([])
  })

  it('reports nothing on the frame after, having already restored', () => {
    const cleared = clear()
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const once = stepEncounter(cleared, away, 1 / 60, C, withPatrol)
    const twice = stepEncounter(once.encounter, away, 1 / 60, C, withPatrol)
    expect(twice.restoredThisFrame).toEqual([])
    expect(twice.downedThisFrame).toEqual([])
  })

  it('leaves a fight with no spawns configured alone', () => {
    // DEPS carries an empty spawns list, which is what keeps every pre-existing test
    // in this file unaffected by the restore.
    const cleared = clear()
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const step = stepEncounter(cleared, away, 1 / 60, C, DEPS)
    expect(step.restoredThisFrame).toEqual([])
    expect(isDowned(step.encounter.enemies[0]!.health)).toBe(true)
  })

  it('regression guard: a gust cannot land on the same frame the patrol restores', () => {
    // Production's respawnRange (52, in DEFAULT_PATROL_CONFIG) sits beyond every
    // weapon's reach -- gust's range of 12 included -- so the shipped tuning can never
    // let a restore and a landing attack coincide on one frame; that gap is what makes
    // leaving-and-returning safe in the first place. The respawnRange of 5 below exists
    // solely to force the two to overlap so the restore-last ordering is actually
    // observable by a test. Do not "fix" this back to production's value: that would
    // silently disarm the guard, since at that range this test could never fail even
    // with the ordering bug it exists to catch.
    const closeRespawn = { ...withPatrol, patrol: { respawnRange: 5 } }
    let encounter = clear()
    // Holding gust down through clear() leaves its cooldown mid-cycle, not spent. Settle
    // it fully before the frame under test, so the attack below is a live attempt to
    // connect rather than one that silently no-ops on cooldown.
    for (let i = 0; i < 60; i++) {
      encounter = stepEncounter(encounter, defaults, 1 / 60, C, withPatrol).encounter
    }
    // 6 units out: past respawnRange (5), so the restore fires, but still inside gust's
    // range (12) and cone, aimed straight down the spawn, so a gust this frame would
    // otherwise connect.
    const justBeyondButInGustRange = {
      ...defaults, playerPosition: new Vector3(0, 0, 4), gustPressed: true,
    }
    const step = stepEncounter(encounter, justBeyondButInGustRange, 1 / 60, C, closeRespawn)
    expect(step.restoredThisFrame).toEqual(['a'])
    expect(step.hitThisFrame).toEqual([])
    expect(step.downedThisFrame).toEqual([])
  })

  it('reports where the body fell on a frame that both downs and restores', () => {
    // Reachable in the shipped game: a soldier chases while the player is inside
    // aggroRange, so one can be led far from its spawn point, and with the rest of the
    // patrol already down, downing that last one 45+ units out satisfies the restore
    // condition on the very same frame. `encounter.enemies` is then the post-restore
    // array -- fresh soldiers standing at their spawns -- while `downedThisFrame` names
    // the body that fell somewhere else entirely, so a caller drawing a down spark from
    // `encounter.enemies` draws it on the patrol ground rather than at the kill.
    //
    // A respawnRange of 5 (test-local, like the guard above) is what lets one frame do
    // both: at production's 66 no attack reaches far enough for a down and a restore to
    // coincide, which is exactly why this needed a fixture of its own.
    const closeRespawn = { ...withPatrol, patrol: { respawnRange: 5 } }
    const start = startEncounter(SPAWNS, C)
    // 6 units back from the spawn: past respawnRange (5) so the restore fires, and well
    // inside a full-strength wave's 12 radius so the slam downs the soldier outright
    // (maxDamage 2.5 against 1.5 health) on this one frame.
    const slamFromBeyond = {
      ...defaults, playerPosition: new Vector3(0, 0, 4), slam: { strength: 1 },
    }
    const step = stepEncounter(start, slamFromBeyond, 1 / 60, C, closeRespawn)

    // The premise: one frame, both events.
    expect(step.downedThisFrame).toEqual(['a'])
    expect(step.restoredThisFrame).toEqual(['a'])

    const fallen = step.enemiesBeforeRestore.find((enemy) => enemy.id === 'a')
    if (!fallen) throw new Error('the downed soldier should still be reported')
    expect(isDowned(fallen.health)).toBe(true)
    // Knocked away from the player, so the body is further out than the spawn's z of -2.
    expect(fallen.position.z).toBeLessThan(-2)

    // And the fight itself carries the fresh soldier, standing at its spawn.
    const fresh = step.encounter.enemies[0]
    if (!fresh) throw new Error('the patrol should have been restored')
    expect(isDowned(fresh.health)).toBe(false)
    expect(fresh.position.z).toBeCloseTo(-2)
  })

  it('reports the same enemies before and after on a frame that does not restore', () => {
    // The other half of the contract: `enemiesBeforeRestore` is only interesting on a
    // restore frame, so on every other frame a caller reading it must see exactly what
    // the fight carries. Otherwise the two sources would disagree all the time and the
    // fix above would have traded one wrong position for another.
    const step = stepEncounter(near(), defaults, 1 / 60, C, DEPS)
    expect(step.enemiesBeforeRestore).toEqual(step.encounter.enemies)
  })
})

describe('a soldier pushing back up', () => {
  /** Wait out the countdown on a downed soldier, leaving it mid-rise. */
  const rising = () => run(C.enemies.spear.downedSeconds + 0.1, {}, downedSoldier(1)).encounter

  it('is on its way up once the countdown has run', () => {
    expect(rising().enemies[0]!.stance).toBe('rising')
  })

  it('can be hit, which is what makes the interrupt reachable', () => {
    // The regression isTargetable exists to prevent: every resolver used to skip anything
    // isDowned, and health is zero for the whole rise, so the gust would pass straight
    // through and the interrupt would be unreachable.
    expect(gustOnce(rising()).encounter.enemies[0]!.stance).toBe('downed')
  })

  it('is not reported as a down when it is knocked back over', () => {
    const step = gustOnce(rising())
    expect(step.downedThisFrame).toEqual([])
    expect(step.firstDownsThisFrame).toEqual([])
  })
})

describe('a flat soldier gusted on every cooldown', () => {
  it('runs its downed countdown untouched, and reaches the rise on schedule', () => {
    // The regression `isTargetable` exists to prevent: `hitEnemy` resets `stanceTime` to 0
    // on every hit, so a downed, non-rising body that could still be hit would have its
    // 18-second countdown restarted every cooldown, forever. All seven resolver gates ask
    // `isTargetable`, which is false for a downed body until it starts rising, so the
    // countdown runs untouched and only the rise itself is interruptible.
    //
    // The countdown is asserted directly, frame by frame, rather than through the stance
    // this eventually produces. An earlier version of this test gusted the body and
    // asserted it reached 'advance' inside a generous budget, which cannot fail: a
    // hittable body takes the knockback too, and `fall()` runs regardless of stance, so a
    // few hits blow it clean past gust.range and it recovers unmolested from there --
    // sooner than the correct behaviour, not later. Both readings passed.
    //
    // The window stops at the rise on purpose. A rising soldier *is* targetable, so a gust
    // landing after this point knocks it back down, which is the intended behaviour tested
    // above; extending the window would stop measuring the gate and start measuring the
    // interrupt.
    let encounter = downedSoldier(1)
    const fell = encounter.enemies[0]!.position.clone()
    const cap = Math.ceil((C.enemies.spear.downedSeconds + 1) * 60)
    let frames = 0

    while (encounter.enemies[0]!.stance === 'downed' && frames < cap) {
      // Geometry has nothing to do with it: the body is inside the cone on every frame of
      // this window, so the gate is the only thing that can be keeping it unhit.
      expect(gustTargets(ORIGIN, NORTH, encounter.enemies, C.gust)).toHaveLength(1)

      const step = stepEncounter(encounter, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)
      expect(step.hitThisFrame).toEqual([])

      encounter = step.encounter
      frames += 1
      const soldier = encounter.enemies[0]!
      // The assertion the old one only gestured at: elapsed seconds, never restarted.
      if (soldier.stance === 'downed') expect(soldier.stanceTime).toBeCloseTo(frames / 60, 5)
    }

    expect(encounter.enemies[0]!.stance).toBe('rising')
    expect(frames / 60).toBeCloseTo(C.enemies.spear.downedSeconds, 1)
    // And it never moved, which is what kept it in the cone for the whole window -- the
    // range escape that made the old assertion unfalsifiable never gets started.
    expect(encounter.enemies[0]!.position.distanceTo(fell)).toBeCloseTo(0, 5)
  })
})

describe('every resolver, against a flat soldier', () => {
  // The guarantee above is only worth as much as the gates being uniform: a fifth move
  // added with a looser gate -- or with the `caught.has(enemy.id)` test and no state gate
  // at all, which is the easy omission -- brings the stall back for that move alone, and
  // the gust test would not notice. `isTargetable` has its own unit tests in
  // enemy.test.ts; these are about the wiring, that each of the four moves resolving
  // against enemies actually asks it.
  //
  // Worth being precise about which mistake this catches, because the obvious candidate is
  // the wrong one: a gate written `!isDowned(enemy.health)` is *stricter* than
  // `isTargetable`, not looser, so it cannot produce the stall -- it skips a flat body just
  // as this one does. It fails the other way, by making a rising soldier unhittable, and
  // "can be hit, which is what makes the interrupt reachable" above is the test for that.
  const moves: Array<{ name: string; input: Partial<EncounterInput>; charged?: boolean }> = [
    { name: 'a gust', input: { gustPressed: true } },
    { name: 'a staff finisher', input: { staffSwing: { index: 3, finisher: true } } },
    { name: 'a pressure wave', input: { slam: { strength: 40 } } },
    // A release resolves only from a charge already held, so this one needs the encounter
    // primed as well as the input set.
    { name: 'a vortex release', input: { vortexReleased: true }, charged: true },
  ]

  /** The encounter a release needs: charged to the maximum, so the move actually fires. */
  const primed = (encounter: Encounter, charged: boolean | undefined) =>
    (charged ? { ...encounter, vortexHeldSeconds: C.vortex.maxChargeSeconds } : encounter)

  const land = (from: Encounter, move: typeof moves[number]) => stepEncounter(
    primed(from, move.charged), { ...defaults, ...move.input }, 1 / 60, C, DEPS,
  )

  for (const move of moves) {
    it(`leaves a body's countdown and its knockback alone under ${move.name}`, () => {
      const soldier = land(downedSoldier(1), move).encounter.enemies[0]!
      expect(soldier.stance).toBe('downed')
      // Not restarted, and not pushed: `hitEnemy` is the only thing that does either, so
      // both together say the resolver skipped this body rather than merely under-hitting it.
      expect(soldier.stanceTime).toBeCloseTo(1 / 60, 5)
      expect(soldier.knockback.length()).toBe(0)
    })

    it(`connects with a soldier on its feet under ${move.name}`, () => {
      // The control. Without it the assertion above would pass just as well for a move
      // aimed somewhere else entirely, which is the failure the old stall test made.
      const soldier = land(near(), move).encounter.enemies[0]!
      expect(soldier.knockback.length()).toBeGreaterThan(0)
    })
  }
})

describe('firstDownsThisFrame', () => {
  it('reports a soldier going down for the first time, alongside downedThisFrame', () => {
    const step = gustOnce(almostDown(0))
    expect(step.downedThisFrame).toEqual(['a'])
    expect(step.firstDownsThisFrame).toEqual(['a'])
  })

  it('drops a later down, so the ladder cannot be walked as a Focus engine', () => {
    // A soldier that has already been down once and has been chipped to zero again. The
    // burst should still fire; Focus should not pay twice.
    const step = gustOnce(almostDown(1))
    expect(step.downedThisFrame).toEqual(['a'])
    expect(step.firstDownsThisFrame).toEqual([])
  })
})

describe('a restore that lands inside an archer\'s notice range', () => {
  // What goes wrong when respawnRange does not clear an archer's aggroRange, played out
  // rather than asserted about the numbers. `shouldRestorePatrol` measures the player's
  // distance horizontally, but `stepEnemy` measures a ranged soldier's aggroRange in 3D,
  // so the two are only comparable when respawnRange is above every kind's aggroRange
  // outright -- 3D distance is never less than horizontal, but it is equal whenever the
  // player stands at the soldier's own altitude, so nothing about the 3D measurement
  // buys the restore any margin it can rely on.
  //
  // A test-local respawnRange, deliberately below this fixture's archer aggroRange, in
  // the same spirit as the two respawnRange-of-5 fixtures above: it forces the overlap
  // so the failure mode stays observable here no matter how the shipped values are
  // retuned. "the shipped patrol restores out of every notice range" below is the test
  // that pins the shipped values; this one is the test that says what it is protecting
  // against.
  const ARCHER: EnemySpawn[] = [{ id: 'archer-1', position: new Vector3(0, 0, 0), kind: 'archer' }]
  // Between the fixture archer's strikeRange (22) and its aggroRange (35), matching the
  // shape the shipped config had: respawnRange used to sit at 40, between the archer's
  // strikeRange of 40 and its aggroRange of 48.
  const tooClose = {
    ...DEPS, spawns: ARCHER, patrol: { respawnRange: 24 },
  }
  // 25 out along z and on the ground, at the archer's own altitude -- the case where 3D
  // distance collapses onto horizontal distance. Past respawnRange (24), so the restore
  // fires, and inside the archer's aggroRange (35), so the fresh soldier notices at once.
  const justPastRespawnRange = { ...defaults, playerPosition: new Vector3(0, 0, 25) }

  /** The archer, downed where it stands, so the patrol is ready to restore. */
  function cleared() {
    const encounter = startEncounter(ARCHER, C)
    return {
      ...encounter,
      enemies: encounter.enemies.map((e) => ({ ...e, health: { ...e.health, current: 0 } })),
    }
  }

  it('restores a soldier that is already inside its own notice range', () => {
    const step = stepEncounter(cleared(), justPastRespawnRange, 1 / 60, C, tooClose)
    expect(step.restoredThisFrame).toEqual(['archer-1'])

    const restored = step.encounter.enemies[0]
    if (!restored) throw new Error('the patrol should have been restored')
    // The premise, stated as the two measurements that disagree: the player has left as
    // far as the restore is concerned, and has not left at all as far as the archer is.
    const spawn = ARCHER[0]!.position
    expect(horizontalDistance(justPastRespawnRange.playerPosition, spawn))
      .toBeGreaterThan(tooClose.patrol.respawnRange)
    expect(justPastRespawnRange.playerPosition.distanceTo(restored.position))
      .toBeLessThanOrEqual(C.enemies.archer.aggroRange)
  })

  it('does not fire on the restore frame itself, but does start closing the frame after', () => {
    // Worth pinning because it is narrower than it sounds, and the narrowness is not a
    // defence. Two things stop an arrow leaving on the restore frame: fresh soldiers are
    // built after the enemy-stepping loop in stepEncounter, so they do not act at all on
    // the frame they appear; and a release needs a completed wind-up from inside
    // strikeRange, which respawnRange being above strikeRange rules out anyway. So the
    // damage is deferred, not avoided -- the archer spends the delay walking in.
    const restore = stepEncounter(cleared(), justPastRespawnRange, 1 / 60, C, tooClose)
    expect(restore.firedThisFrame).toEqual([])
    const before = restore.encounter.enemies[0]!.position.clone()

    const next = stepEncounter(restore.encounter, justPastRespawnRange, 1 / 60, C, tooClose)
    expect(next.firedThisFrame).toEqual([])
    // Closing, not holding station: an archer outside aggroRange would stand still, so
    // movement towards the player is the observable form of "it has noticed".
    const after = next.encounter.enemies[0]!.position
    expect(after.distanceTo(justPastRespawnRange.playerPosition))
      .toBeLessThan(before.distanceTo(justPastRespawnRange.playerPosition))
  })

  it('puts an arrow in the air a second and a half later, at a player who just walked away', () => {
    // The harm, end to end: the player cleared this patrol, walked past respawnRange, and
    // is being shot at by a soldier that did not exist when they turned their back. The
    // budget below is generous on purpose -- the point is that it happens at all and soon,
    // not the exact frame -- but it is finite, so an archer that never closed would fail
    // it rather than pass by never firing.
    let encounter = stepEncounter(cleared(), justPastRespawnRange, 1 / 60, C, tooClose).encounter
    let firedAfterSeconds = -1
    for (let frame = 0; frame < 300 && firedAfterSeconds < 0; frame++) {
      const step = stepEncounter(encounter, justPastRespawnRange, 1 / 60, C, tooClose)
      encounter = step.encounter
      if (step.firedThisFrame.length > 0) firedAfterSeconds = (frame + 1) / 60
    }
    expect(firedAfterSeconds).toBeGreaterThan(0)
    expect(firedAfterSeconds).toBeLessThan(3)
  })
})

describe('the shipped patrol restores out of every soldier\'s notice range', () => {
  // The regression guard for the gap the archer opened. DEFAULT_PATROL_CONFIG.respawnRange
  // shipped at 40 against an archer aggroRange of 48, so there were real player positions
  // -- 1907 of them on the one-unit grid this test sweeps -- that satisfied the restore and
  // put a fresh archer inside its own notice range at the same time. The block above plays
  // out what that costs; this one asserts the shipped numbers make it unreachable.
  //
  // Swept rather than asserted at one hand-picked position, because a single position is
  // pinned to today's HOME_PATROL layout and today's aggroRange, and would quietly stop
  // testing anything if either were retuned. It is also stronger than comparing
  // respawnRange against max(aggroRange) directly -- which patrol.test.ts already does --
  // because it goes through stepEncounter, so it covers the two measurements actually
  // disagreeing rather than the arithmetic relationship between the constants.
  //
  // On the ground plane at y = 0, which is the worst case: 3D distance is never below
  // horizontal distance, and the two are equal exactly there, so any position that clears
  // this at the soldiers' own altitude clears it at every altitude.
  const PROD = DEFAULT_COMBAT_CONFIG
  const deps = {
    ground: flatGround, worldFloorY: -50, spawns: HOME_PATROL, patrol: DEFAULT_PATROL_CONFIG,
  }

  // The whole home patrol, downed where it stands, so every frame below is one frame away
  // from a restore. Built once and reused: stepEncounter does not mutate what it is given,
  // and rebuilding it inside the sweep would dominate the sweep's runtime.
  const downed = (() => {
    const encounter = startEncounter(HOME_PATROL, PROD)
    return {
      ...encounter,
      enemies: encounter.enemies.map((e) => ({ ...e, health: { ...e.health, current: 0 } })),
    }
  })()

  // The box the sweep covers: the spawn points, grown by whichever is wider of the widest
  // notice range and the respawn range itself. The first term is what makes the box big
  // enough to contain every position that could offend -- a soldier only notices a player
  // inside its own aggroRange -- and the second is what keeps it big enough to contain
  // positions that restore at all, so raising respawnRange cannot quietly empty the sweep.
  // Derived from the config rather than written out, so retuning either keeps it correct.
  const margin = 2 + Math.max(
    DEFAULT_PATROL_CONFIG.respawnRange,
    ...Object.values(PROD.enemies).map((enemy) => enemy.aggroRange),
  )
  const xs = HOME_PATROL.map((spawn) => spawn.position.x)
  const zs = HOME_PATROL.map((spawn) => spawn.position.z)
  const box = {
    minX: Math.min(...xs) - margin, maxX: Math.max(...xs) + margin,
    minZ: Math.min(...zs) - margin, maxZ: Math.max(...zs) + margin,
  }

  it('leaves no player position that both restores the patrol and is already noticed', () => {
    const offenders: string[] = []

    // A one-unit grid. The gap this guards was units wide when it was open -- 469 grid
    // positions offended at the old respawnRange of 40 -- so the step does not have to be
    // fine to see it, and a finer one only makes the sweep slower.
    for (let x = box.minX; x <= box.maxX; x++) {
      for (let z = box.minZ; z <= box.maxZ; z++) {
        const player = new Vector3(x, 0, z)
        const step = stepEncounter(
          downed, { ...defaults, playerPosition: player }, 1 / 60, PROD, deps,
        )
        if (step.restoredThisFrame.length === 0) continue
        for (const soldier of step.encounter.enemies) {
          // 3D, the way stepEnemy measures a ranged soldier's aggroRange. For a spear it
          // is the stricter of the two measurements, so reading it for both kinds cannot
          // let a melee soldier through.
          const distance = player.distanceTo(soldier.position)
          const aggro = PROD.enemies[soldier.kind].aggroRange
          if (distance <= aggro) {
            offenders.push(
              `player (${x}, 0, ${z}) restores ${soldier.id} (${soldier.kind}) at 3D ` +
              `${distance.toFixed(2)}, inside its aggroRange of ${aggro}`,
            )
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('sweeps somewhere a restore actually happens, so the guard is not vacuous', () => {
    // Without this, a respawnRange raised past everything the sweep visits would pass the
    // test above by never restoring anywhere -- the same way the empty spawns list in DEPS
    // makes the restore invisible to most of this file. The far corner of the box is the
    // position furthest from every spawn point, so if anything in there restores, it does.
    const corner = new Vector3(box.minX, 0, box.minZ)
    const step = stepEncounter(
      downed, { ...defaults, playerPosition: corner }, 1 / 60, PROD, deps,
    )
    expect(step.restoredThisFrame.length).toBe(HOME_PATROL.length)
  })
})

describe('a mixed patrol', () => {
  const MIXED: EnemySpawn[] = [
    { id: 'spear-1', position: new Vector3(0, 0, -2), kind: 'spear' },
    { id: 'archer-1', position: new Vector3(0, 0, -20), kind: 'archer' },
  ]

  it('spawns each soldier as its own kind', () => {
    const encounter = startEncounter(MIXED, C)
    expect(encounter.enemies.map((e) => e.kind)).toEqual(['spear', 'archer'])
  })

  it('gives each kind its own health', () => {
    // The two configs differ, so this catches both being built from one of them.
    const encounter = startEncounter(MIXED, C)
    const [spear, archer] = encounter.enemies
    if (!spear || !archer) throw new Error('fixture')
    expect(spear.health.max).toBeCloseTo(C.enemies.spear.maxHealth)
    expect(archer.health.max).toBeCloseTo(C.enemies.archer.maxHealth)
    // And a margin, so a config where the two happen to match would not pass vacuously.
    expect(archer.health.max).toBeLessThan(spear.health.max * 0.95)
  })

  it('restores each soldier as its own kind', () => {
    // The restore builds fresh enemies from the spawn list, so it has to read the kind
    // there too rather than defaulting everything to a spear.
    const withPatrol = { ...DEPS, spawns: MIXED, patrol: { respawnRange: 40 } }
    let encounter = startEncounter(MIXED, C)
    encounter = {
      ...encounter,
      enemies: encounter.enemies.map((e) => ({ ...e, health: { ...e.health, current: 0 } })),
    }
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const step = stepEncounter(encounter, away, 1 / 60, C, withPatrol)
    expect(step.restoredThisFrame.length).toBe(2)
    expect(step.encounter.enemies.map((e) => e.kind)).toEqual(['spear', 'archer'])

    // The kind check above passes even if the restore forwards the right `kind` to
    // `spawnEnemy` while reading the wrong `EnemyConfig` for it -- `kind` and `config`
    // are independent arguments there. Same health check as "gives each kind its own
    // health", against the restored soldiers rather than the freshly spawned ones, so a
    // restored archer coming back with the spear's health (or aggro, or attack) cannot
    // pass silently.
    const [spear, archer] = step.encounter.enemies
    if (!spear || !archer) throw new Error('fixture')
    expect(spear.health.max).toBeCloseTo(C.enemies.spear.maxHealth)
    expect(archer.health.max).toBeCloseTo(C.enemies.archer.maxHealth)
    expect(archer.health.max).toBeLessThan(spear.health.max * 0.95)
  })

  it("lets the stepping loop use each enemy's own kind, not just its own config", () => {
    // "gives each kind its own health" only calls startEncounter, and the restore test
    // above zeroes health before stepping, which sends stepEnemy down the already-downed
    // branch -- one that reads only gravity, knockbackDamping and snapDistance, identical
    // between the two fixture kinds here. Neither exercises the per-kind lookup inside the
    // stepping loop itself. This test does, with an outcome that needs no arithmetic to
    // read: a live archer at 2 units is inside both its own strikeRange (22) and the
    // spear's (3), so a hardcoded spear lookup and the real per-kind one both send it into
    // a wind-up and a release.
    //
    // Now that arrows are wired into the fight (see "arrows in the fight" below), both
    // configs eventually hit the player, so a bare playerHit check no longer tells the two
    // apart -- this needed updating once this task landed, exactly as the removed version
    // of this comment anticipated. What still tells them apart: a spear's release deals
    // melee damage on the very same frame the wind-up completes, while an archer's release
    // only looses an arrow that frame -- the hit lands a few frames later, once the arrow
    // has flown the 2 units. A wrongly hardcoded spear lookup collapses that gap to zero.
    const spawns: EnemySpawn[] = [{ id: 'archer-1', position: new Vector3(0, 0, -2), kind: 'archer' }]
    let encounter = startEncounter(spawns, C)
    let firedFrame = -1
    let hitFrame = -1
    const duration = C.enemies.archer.windUpSeconds + C.enemies.archer.recoverSeconds
    let frame = 0
    for (let t = 0; t < duration; t += 1 / 60, frame++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, DEPS)
      encounter = step.encounter
      if (firedFrame < 0 && step.firedThisFrame.length > 0) firedFrame = frame
      if (hitFrame < 0 && step.playerHit) hitFrame = frame
    }
    expect(firedFrame).toBeGreaterThanOrEqual(0)
    expect(hitFrame).toBeGreaterThan(firedFrame)
  })
})

describe('arrows in the fight', () => {
  const ARCHER_ONLY: EnemySpawn[] = [
    { id: 'archer-1', position: new Vector3(0, 0, -10), kind: 'archer' },
  ]
  const deps = { ...DEPS, spawns: [], patrol: { respawnRange: 40 } }

  /** Run until the archer looses its first arrow, or give up. */
  function untilFired(seconds = 6) {
    let encounter = startEncounter(ARCHER_ONLY, C)
    const frames = Math.round(seconds * 60)
    for (let i = 0; i < frames; i++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, deps)
      encounter = step.encounter
      if (step.firedThisFrame.length > 0) return { encounter, step, frame: i }
    }
    throw new Error('the archer never fired')
  }

  it('starts with no arrows', () => {
    expect(startEncounter(ARCHER_ONLY, C).projectiles).toEqual([])
  })

  it('reports a shot and puts an arrow in the air', () => {
    const { encounter, step } = untilFired()
    expect(step.firedThisFrame.length).toBe(1)
    expect(encounter.projectiles.length).toBe(1)
    // The reported id is the projectile's, not the archer's.
    expect(step.firedThisFrame[0]).toBe(encounter.projectiles[0]?.id)
    expect(step.firedThisFrame[0]).not.toBe('archer-1')
  })

  it('gives every arrow a distinct id', () => {
    let { encounter } = untilFired()
    const ids = new Set(encounter.projectiles.map((p) => p.id))
    for (let i = 0; i < 600; i++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, deps)
      encounter = step.encounter
      for (const id of step.firedThisFrame) {
        expect(ids.has(id), `id ${id} was reused`).toBe(false)
        ids.add(id)
      }
    }
    // Several shots over ten seconds, given the archer's cycle.
    expect(ids.size).toBeGreaterThan(2)
  })

  it("builds the arrow from the archer's own attack config", () => {
    // Nothing asserted a spawned arrow's damage or speed, so `spawnProjectile` could have
    // been handed any kind's config and the suite stayed green. The fixture archer's
    // damage is 0.8 against the spear's 1 and its speed has no spear counterpart at all,
    // so a cross-kind mix-up shows up in both numbers.
    const { encounter } = untilFired()
    const arrow = encounter.projectiles[0]
    if (!arrow) throw new Error('no arrow')
    const attack = C.enemies.archer.attack
    if (attack.kind !== 'projectile') throw new Error('fixture archer must be ranged')
    expect(arrow.damage).toBeCloseTo(attack.damage, 6)
    expect(arrow.damage).not.toBeCloseTo(C.enemies.spear.attack.damage, 6)
    // The speed lands in the velocity's magnitude, which is the only place it survives.
    expect(arrow.velocity.length()).toBeCloseTo(attack.speed, 4)
  })

  it('does not advance an arrow on the frame it is fired', () => {
    // Stepping before spawning, so a new arrow does not appear already metres out.
    const { encounter } = untilFired()
    const arrow = encounter.projectiles[0]
    if (!arrow) throw new Error('no arrow')
    expect(arrow.age).toBe(0)
  })

  it('eventually hurts a player standing in front of it', () => {
    let encounter = startEncounter(ARCHER_ONLY, C)
    let hit = false
    for (let i = 0; i < 900; i++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, deps)
      encounter = step.encounter
      if (step.playerHit) { hit = true; break }
    }
    expect(hit).toBe(true)
  })

  it('lets a slipstream dodge an arrow, and pays Focus for it', () => {
    // Free leverage: arrow damage joins the same total the spears feed, so the existing
    // invulnerability and the existing damageAvoided flag both apply with no new code.
    let encounter = startEncounter(ARCHER_ONLY, C)
    let avoided = false
    let everHit = false
    for (let i = 0; i < 900; i++) {
      const step = stepEncounter(
        encounter, { ...defaults, playerInvulnerable: true }, 1 / 60, C, deps,
      )
      encounter = step.encounter
      if (step.damageAvoided) avoided = true
      if (step.playerHit) everHit = true
    }
    expect(avoided).toBe(true)
    expect(everHit).toBe(false)
  })

  it('clears the arrows when the patrol restores', () => {
    // An arrow loosed by a fight that is over must not strike a player who walks back to
    // a fresh patrol.
    const withPatrol = { ...DEPS, spawns: ARCHER_ONLY, patrol: { respawnRange: 40 } }
    const { encounter } = untilFired()
    const downed = {
      ...encounter,
      enemies: encounter.enemies.map((e) => ({ ...e, health: { ...e.health, current: 0 } })),
    }
    expect(downed.projectiles.length).toBeGreaterThan(0)
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const step = stepEncounter(downed, away, 1 / 60, C, withPatrol)
    expect(step.restoredThisFrame.length).toBe(1)
    expect(step.encounter.projectiles).toEqual([])
  })
})

describe('playerHitsThisFrame', () => {
  it("reports the soldier's position for a spear strike, component by component", () => {
    let encounter = near()
    let hit: PlayerHit | undefined
    for (let i = 0; i < 120 && !hit; i++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, DEPS)
      encounter = step.encounter
      hit = step.playerHitsThisFrame[0]
    }
    if (!hit) throw new Error('the spear never struck')
    const spearSpawn = near().enemies[0]!.position
    expect(hit.from.x).toBeCloseTo(spearSpawn.x)
    expect(hit.from.y).toBeCloseTo(spearSpawn.y)
    expect(hit.from.z).toBeCloseTo(spearSpawn.z)
  })

  it("reports the projectile's position for an arrow, not the archer's", () => {
    // The archer never has to move to fire -- 10 units is well inside its strikeRange
    // of 22 -- so its own position stays fixed at archerSpawn for the whole run, and
    // any real gap between that and the reported `from` can only come from the arrow
    // having flown most of the distance to the player.
    const archerSpawn = new Vector3(0, 0, -10)
    const spawns: EnemySpawn[] = [{ id: 'archer-1', position: archerSpawn, kind: 'archer' }]
    const deps = { ...DEPS, spawns: [], patrol: { respawnRange: 40 } }
    let encounter = startEncounter(spawns, C)
    let hit: PlayerHit | undefined
    for (let i = 0; i < 300 && !hit; i++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, deps)
      encounter = step.encounter
      hit = step.playerHitsThisFrame[0]
    }
    if (!hit) throw new Error('the arrow never struck')
    expect(hit.from.distanceTo(ORIGIN)).toBeLessThan(2)
    expect(hit.from.distanceTo(archerSpawn)).toBeGreaterThan(5)
  })

  it('reports a spear and an arrow on the same frame as two distinct entries', () => {
    // Built directly rather than played out, so both land on the very same frame: a
    // spear one dt short of completing its wind-up, and an arrow already resting inside
    // hitRadius with zero velocity, so it connects on this step without having to
    // travel anywhere. This is the case that justifies a list instead of one
    // aggregated direction -- averaging the two would point at empty space between them.
    const spear = {
      ...near().enemies[0]!,
      stance: 'wind-up' as const,
      stanceTime: C.enemies.spear.windUpSeconds - 1 / 60,
    }
    const arrowFrom = new Vector3(0.5, 0, 0)
    const arrow = spawnProjectile('arrow-test', arrowFrom, new Vector3(0, 0, 1), 0.3, 0)
    const encounter: Encounter = { ...near(), enemies: [spear], projectiles: [arrow] }
    const step = stepEncounter(encounter, defaults, 1 / 60, C, DEPS)

    expect(step.playerHitsThisFrame).toHaveLength(2)
    // Arrows already in flight are stepped before the enemy loop (see the ordering
    // comment at the top of stepEncounter), so the arrow's entry comes first.
    const [arrowHit, spearHit] = step.playerHitsThisFrame
    expect(arrowHit!.from.equals(arrowFrom)).toBe(true)
    expect(arrowHit!.damage).toBeCloseTo(0.3)
    const spearAttack = C.enemies.spear.attack
    if (spearAttack.kind !== 'melee') throw new Error('fixture spear must be melee')
    expect(spearHit!.from.equals(step.encounter.enemies[0]!.position)).toBe(true)
    expect(spearHit!.damage).toBeCloseTo(spearAttack.damage)
    // Distinct sources, not one aggregated bearing.
    expect(arrowHit!.from.equals(spearHit!.from)).toBe(false)
  })

  it('still reports a hit avoided by invulnerability, while health is unchanged', () => {
    let encounter = startEncounter(
      [{ id: 'a', position: new Vector3(1, 0, 0), kind: 'spear' }], DEFAULT_COMBAT_CONFIG,
    )
    // Same window "reports the dodge, and does not report a hit" uses above: long enough
    // for the wind-up to complete and the release to land inside recovery.
    const enemyC = DEFAULT_COMBAT_CONFIG.enemies.spear
    const duration = enemyC.windUpSeconds + enemyC.recoverSeconds / 2
    let reported: PlayerHit[] = []
    for (let t = 0; t < duration; t += 1 / 60) {
      const step = stepEncounter(
        encounter, { ...defaults, playerInvulnerable: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      )
      encounter = step.encounter
      reported = reported.concat(step.playerHitsThisFrame)
    }
    expect(reported.length).toBeGreaterThan(0)
    expect(encounter.playerHealth.current).toBeCloseTo(DEFAULT_COMBAT_CONFIG.player.maxHealth, 5)
  })

  it('reports nothing on a quiet frame', () => {
    const step = stepEncounter(near(), defaults, 1 / 60, C, DEPS)
    expect(step.playerHitsThisFrame).toEqual([])
  })
})

describe('an archer on high ground measures its range in 3D through a played fight', () => {
  // Every other archer fixture in this file stands at y = 0, which is the one altitude
  // where horizontal distance and true distance agree -- so nothing here noticed whether
  // stepEnemy measured a ranged soldier's range in 3D or horizontally, and reverting the
  // split only failed enemy.test.ts. This block puts the archer on a plateau instead, and
  // runs it through stepEncounter rather than stepEnemy directly.
  //
  // 10 units out and 25 units up: horizontal distance 10, well inside the fixture
  // archer's strikeRange of 22, while true distance is 26.9 -- outside it, and inside the
  // aggroRange of 35. So the archer notices, closes, and never gets a shot off. Under a
  // horizontal-only measurement it would be in range from the first frame.
  const HIGH_GROUND = 25
  const plateau = { groundHeightAt: () => HIGH_GROUND }
  const AT_ALTITUDE: EnemySpawn[] = [
    { id: 'archer-1', position: new Vector3(0, HIGH_GROUND, -10), kind: 'archer' },
  ]
  // The same archer at the player's own altitude, the control: identical horizontal
  // offset, so the only difference between the two is height.
  const ON_THE_LEVEL: EnemySpawn[] = [
    { id: 'archer-1', position: new Vector3(0, 0, -10), kind: 'archer' },
  ]

  /** Run for `seconds` and report what the archer did. */
  function play(spawns: EnemySpawn[], ground: { groundHeightAt: () => number }, seconds = 4) {
    const deps = { ...DEPS, ground, spawns: [], patrol: { respawnRange: 40 } }
    let encounter = startEncounter(spawns, C)
    let arrows = 0
    for (let t = 0; t < seconds; t += 1 / 60) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, deps)
      encounter = step.encounter
      arrows += step.firedThisFrame.length
    }
    const archer = encounter.enemies[0]
    if (!archer) throw new Error('fixture')
    return { arrows, archer }
  }

  it('never looses a shot at a player 25 units below it', () => {
    expect(play(AT_ALTITUDE, plateau).arrows).toBe(0)
  })

  it('still notices that player and closes on them', () => {
    // The vacuity guard for the test above: silence has to come from the range
    // measurement, not from an archer that is inert, airborne, or asleep.
    const { archer } = play(AT_ALTITUDE, plateau)
    expect(archer.grounded).toBe(true)
    expect(horizontalDistance(archer.position, ORIGIN)).toBeLessThan(5)
  })

  it('does loose at the same player from the same horizontal offset on the level', () => {
    // The other half of the guard: this fixture can fire, and altitude is the only thing
    // stopping it above. Under a horizontal-only measurement the two cases are identical
    // and both fire, which is what makes the pair a real test of the split.
    expect(play(ON_THE_LEVEL, flatGround).arrows).toBeGreaterThan(0)
  })
})

/**
 * The Air Wall as the fight resolves it.
 *
 * `air-wall.ts` owns the lifecycle and the reflection and is tested on its own; this block is
 * about the wiring — that the barrier is stepped and consulted inside the arrow pass, that the
 * breath is billed once and reported, and that a returned arrow reaches the enemy list the
 * fight is holding rather than a copy of it.
 */
describe('the Air Wall inside the fight', () => {
  const W = C.airWall
  /**
   * An arrow closing on a player at the origin, level at half a metre.
   *
   * Level and off the ground on purpose: level so the mirror is an exact reversal and the aim
   * below can be a plain `NORTH`, and off the ground so `flatGround` does not swallow the
   * return before it reaches anything.
   */
  const closing = (from = -8) => spawnProjectile('a1', new Vector3(0, 0.5, from), new Vector3(0, 0, 1), 0.8, 20)

  /** An encounter with one arrow already in the air and, optionally, soldiers. */
  function withArrow(spawns: EnemySpawn[] = [], from = -8): Encounter {
    return { ...startEncounter(spawns, C), projectiles: [closing(from)] }
  }

  /** Run until the arrow is gone, or `frames` elapse, gathering what the fight reported. */
  function fly(start: Encounter, over: Partial<EncounterInput>, frames = 120) {
    let encounter = start
    const redirected: string[] = []
    const redirectHits: string[] = []
    let breathSpent = 0
    let damageAvoided = false
    let playerHit = false
    for (let frame = 0; frame < frames; frame++) {
      const step = stepEncounter(encounter, { ...defaults, ...over }, 1 / 60, C, DEPS)
      encounter = step.encounter
      redirected.push(...step.redirectedThisFrame)
      redirectHits.push(...step.redirectHitsThisFrame)
      breathSpent += step.airWallBreathSpent
      damageAvoided = damageAvoided || step.damageAvoided
      playerHit = playerHit || step.playerHit
    }
    return { encounter, redirected, redirectHits, breathSpent, damageAvoided, playerHit }
  }

  const held = { airWallHeld: true, playerAim: NORTH, playerBreath: 100 }

  it('turns an arrow around instead of letting it land', () => {
    const walled = fly(withArrow(), held)
    expect(walled.redirected).toEqual(['a1'])
    expect(walled.playerHit).toBe(false)
    // The control, and it is the whole test: the identical arrow with no wall held does hurt
    // the player. Without it this would pass against a fight that quietly drops every arrow.
    const bare = fly(withArrow(), {})
    expect(bare.redirected).toEqual([])
    expect(bare.playerHit).toBe(true)
  })

  it('bills the breath once for a wall held its whole life', () => {
    // Over 120 frames — twice `maxSeconds` at this fixture's 1 second — so the wall goes up,
    // stands, and expires inside the window. One charge, not one per frame and not one per
    // frame the key is down.
    expect(fly(withArrow(), held).breathSpent).toBeCloseTo(W.breathCost)
  })

  it('refuses to raise a wall the player cannot pay for', () => {
    const broke = fly(withArrow(), { ...held, playerBreath: W.breathCost - 1 })
    expect(broke.breathSpent).toBe(0)
    expect(broke.redirected).toEqual([])
    expect(broke.playerHit).toBe(true)
    // The control: one unit more breath and the same frame raises a wall that saves them.
    const paid = fly(withArrow(), { ...held, playerBreath: W.breathCost })
    expect(paid.redirected).toEqual(['a1'])
    expect(paid.playerHit).toBe(false)
  })

  it('sends the arrow into a soldier standing behind the wall', () => {
    // The payoff: an arrow aimed at the player goes into what is closing on them. The soldier
    // sits past the wall's reach so the arrow really is turned before it gets there.
    const spear: EnemySpawn = { id: 'spear-1', position: new Vector3(0, 0, -6), kind: 'spear' }
    const walled = fly(withArrow([spear]), held)
    expect(walled.redirectHits).toEqual(['spear-1'])
    // And it cost the soldier real health rather than merely being reported.
    const hurt = walled.encounter.enemies[0]!
    expect(hurt.health.current).toBeLessThan(C.enemies.spear.maxHealth)
    // The control: with no wall the same soldier is untouched, because a fresh arrow passes
    // straight through its own side.
    const bare = fly(withArrow([spear]), {})
    expect(bare.redirectHits).toEqual([])
    expect(bare.encounter.enemies[0]!.health.current).toBe(C.enemies.spear.maxHealth)
  })

  it('interrupts a soldier the returned arrow lands on', () => {
    // The reason the hit is applied inside the arrow pass, ahead of the enemy step: `hitEnemy`
    // cancels a wind-up, and an interrupt applied after the soldier has acted is not one. A
    // struck soldier is left recovering rather than advancing or winding up.
    // Thirty frames: the arrow is turned at the wall's face around frame 9 and lands around
    // frame 12, which leaves the soldier well inside this fixture's `recoverSeconds` of 0.6 at
    // the end of the window. Running longer would see it back on its feet and advancing, which
    // is correct behaviour and would make this assertion about the clock instead of the hit.
    const spear: EnemySpawn = { id: 'spear-1', position: new Vector3(0, 0, -6), kind: 'spear' }
    const walled = fly(withArrow([spear]), held, 30)
    expect(walled.redirectHits).toEqual(['spear-1'])
    expect(walled.encounter.enemies[0]!.stance).toBe('recover')
    // The control: with no wall the same soldier at the same moment is still advancing, so
    // 'recover' above is the arrow's doing rather than the fixture's starting state.
    expect(fly(withArrow([spear]), {}, 30).encounter.enemies[0]!.stance).toBe('advance')
  })

  it('does not also report the arrow as damage avoided', () => {
    // Focus would pay both `redirectGain` and `dodgeGain` for one arrow otherwise. A redirected
    // arrow never reaches the player, so there is no damage for the dodge to have avoided --
    // asserted rather than assumed, because `damageAvoided` is computed from a total the arrow
    // used to feed.
    const walled = fly(withArrow(), { ...held, playerInvulnerable: true })
    expect(walled.redirected).toEqual(['a1'])
    expect(walled.damageAvoided).toBe(false)
    // The control: the same invulnerable player with no wall does record an avoided hit, so
    // the flag is reachable in this fixture and the silence above means something.
    expect(fly(withArrow(), { playerInvulnerable: true }).damageAvoided).toBe(true)
  })

  it('leaves an arrow coming from behind the player alone', () => {
    // The wall is a facing, not a bubble. Same arrow, same wall, aim turned around.
    const behind = fly(withArrow(), { ...held, playerAim: new Vector3(0, 0, 1) })
    expect(behind.redirected).toEqual([])
    expect(behind.playerHit).toBe(true)
  })

  it('saves a player from an arrow arriving on the frame the wall goes up', () => {
    // The ordering test, and the fixture is chosen so it can actually fail. The arrow sits one
    // step from connecting, so the hit lands on frame one — which means the barrier has to be
    // stepped *before* the arrow pass and each arrow offered to it *before* it advances. Step
    // the wall after the loop and its state is a frame stale, so it is not up when this arrow
    // arrives; deflect after `stepProjectile` and the damage is already reported. Either way
    // the player takes it.
    //
    // Arrow at z −1.0 at 20 units/sec: one step of 0.333 puts it at −0.667, and hypot(0.667,
    // 0.5) is 0.83 against this fixture's hitRadius of 0.9.
    const oneStepOut = { ...startEncounter([], C), projectiles: [closing(-1)] }
    const walled = stepEncounter(oneStepOut, { ...defaults, ...held }, 1 / 60, C, DEPS)
    expect(walled.redirectedThisFrame).toEqual(['a1'])
    expect(walled.playerHit).toBe(false)
    // The control that proves the fixture connects on frame one, which is the whole premise:
    // without the wall this same single step hurts the player.
    const bare = stepEncounter(oneStepOut, defaults, 1 / 60, C, DEPS)
    expect(bare.playerHit).toBe(true)
  })

  it('starts every fight with no wall up', () => {
    expect(startEncounter([], C).airWall).toEqual({ elapsed: null, cooldown: 0 })
  })
})
