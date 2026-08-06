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
  enemies: {
    spear: {
      maxHealth: 1.5, outOfCombatSeconds: 4, regenPerSecond: 0,
      moveSpeed: 4, strikeRange: 3, aggroRange: 30, windUpSeconds: 0.5, recoverSeconds: 0.6,
      attack: { kind: 'melee', damage: 1 }, knockbackDamping: 3,
      // Matches DEFAULT_COMBAT_CONFIG.enemies.spear.gravity.
      gravity: 20,
      // Matches DEFAULT_COMBAT_CONFIG.enemies.spear.snapDistance.
      snapDistance: 1.2,
    },
    // Deliberately different from the spear on every tuning axis, and its
    // strikeRange (22) is well past the 10 units a mixed-patrol fixture needs to
    // stand back an archer, and distinct from the shipped config's 40 so a test
    // that accidentally read the real config would be visible.
    archer: {
      maxHealth: 1, outOfCombatSeconds: 4, regenPerSecond: 0,
      moveSpeed: 3, strikeRange: 22, aggroRange: 35, windUpSeconds: 0.6, recoverSeconds: 0.9,
      attack: { kind: 'projectile', damage: 1, speed: 20 }, knockbackDamping: 3,
      gravity: 20,
      snapDistance: 1.2,
    },
  },
  // Not exercised by this file's own tests, but required by CombatConfig's shape.
  projectile: { hitRadius: 0.9, maxSeconds: 4 },
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
  staffArc: {
    opener: { range: 3.6, halfAngle: Math.PI / 2.2 },
    finisher: { range: 4.2, halfAngle: Math.PI / 1.9 },
    openerDamage: 0.7,
    finisherDamage: 1.2,
    openerKnockback: 4,
    finisherKnockback: 18,
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
    // Production's respawnRange (66, in DEFAULT_PATROL_CONFIG) sits beyond every
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
