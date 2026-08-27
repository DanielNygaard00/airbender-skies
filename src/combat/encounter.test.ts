import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  startEncounter, stepEncounter, canGust, canVortex, type CombatConfig, type Encounter,
  type EncounterInput, type EnemySpawn, type PillarBlock, type PlayerHit,
} from './encounter'
import { isDowned } from './health'
import { inCone } from './cone'
import {
  deflects, horizontalDistance, markEnemy, UNARMOURED, type EnemyConfig,
} from './enemy'
import type { Element } from '../elements/element'
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
      armour: UNARMOURED,
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
      attack: { kind: 'projectile', damage: 0.8, speed: 20, tangleSeconds: 0 },
      knockbackDamping: 3,
      gravity: 20,
      snapDistance: 1.2,
      downedSeconds: 18, risingSeconds: 1.2, recoveryHealthFractions: [0.6, 0.3],
      armour: UNARMOURED,
    },
    /**
     * The heavy armoured soldier, with the one row of armour that matters set to the shipped
     * value — a gust turns away entirely — and the other three deliberately *not* matching the
     * shipped config.
     *
     * The gust row has to be 0 and 0, because that is the behaviour under test and it is a
     * qualitative fact rather than a tuning number. Everything else here differs from
     * `DEFAULT_COMBAT_CONFIG` on purpose, so an assertion that accidentally read the real
     * config instead of this fixture would be visible: maxHealth 2 against the shipped 4, the
     * staff at a flat half against the shipped 0.35 and 0.3, and the vortex at 0.5 against 0.45.
     */
    heavy: {
      maxHealth: 2, outOfCombatSeconds: 4, regenPerSecond: 0,
      moveSpeed: 2, strikeRange: 4, aggroRange: 18, windUpSeconds: 0.9, recoverSeconds: 1.2,
      attack: { kind: 'melee', damage: 2 }, knockbackDamping: 3,
      gravity: 20,
      snapDistance: 1.2,
      downedSeconds: 18, risingSeconds: 1.8, recoveryHealthFractions: [0.6, 0.3],
      armour: {
        gust: { damage: 0, knockback: 0 },
        vortex: { damage: 1, knockback: 0.5 },
        wave: { damage: 1, knockback: 1 },
        staff: { damage: 0.5, knockback: 0.5 },
        // Deliberately unlike the shipped heavy on both rows, so a test here that happened to
        // read the real config instead of this fixture is visible: the grip resists a *little*
        // rather than completely, and the freeze is turned away outright, which is the
        // opposite of what ships. Both behaviours need a fixture that exercises them, and
        // neither is what the game does.
        grip: { damage: 1, knockback: 0.5 },
        freeze: { damage: 0, knockback: 0 },
        // Earth's two, deliberately unlike the shipped heavy on both rows for the same reason as
        // water's above. The stone is *halved* here where the real plate does nothing at all to
        // it, so a test that read the shipped config by accident would come out at twice the
        // damage this fixture expects; and the pillar's shove is turned away outright, which is a
        // branch the shipped config never takes and which therefore needs a fixture to exercise.
        stone: { damage: 0.5, knockback: 0.5 },
        pillar: { damage: 0, knockback: 0 },
        // Deliberately unlike the shipped heavy's 0.5 and 0, and unlike the two rows above in shape:
        // a quarter of the damage still gets through and so does a quarter of the shove, so a test
        // here that read the real config would be visible in either number. The shipped row is
        // asserted against `DEFAULT_COMBAT_CONFIG` in the 'fire against plate' block below.
        burst: { damage: 0.25, knockback: 0.25 },
      },
    },
    /**
     * The net thrower. Its `tangleSeconds` is 3 rather than the shipped 2 and its projectile
     * damage 0.25 rather than 0.5, so both are distinguishable from the real config and from
     * the archer's 0.8 in an assertion.
     */
    nets: {
      maxHealth: 1, outOfCombatSeconds: 4, regenPerSecond: 0,
      moveSpeed: 3, strikeRange: 16, aggroRange: 24, windUpSeconds: 0.7, recoverSeconds: 1.4,
      attack: { kind: 'projectile', damage: 0.25, speed: 18, tangleSeconds: 3 },
      knockbackDamping: 3,
      gravity: 20,
      snapDistance: 1.2,
      downedSeconds: 18, risingSeconds: 1.2, recoveryHealthFractions: [0.6, 0.3],
      armour: UNARMOURED,
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
  /**
   * Water, with round numbers chosen so the assertions below are arithmetic rather than
   * transcriptions of the shipped config — the same reason every other block in this fixture
   * differs from `DEFAULT_COMBAT_CONFIG`.
   *
   * Two relationships are load-bearing and are deliberately preserved from the real config,
   * because tests below turn on them: the freeze holds longer than the grip, and the freeze's cone
   * is wider but shorter than the grip's. The shipped numbers' own inequalities are asserted
   * against `DEFAULT_COMBAT_CONFIG` in `water.test.ts`, which is where a retune has to be caught.
   */
  water: {
    grip: { range: 10, halfAngle: Math.PI / 6 },
    freeze: { range: 8, halfAngle: Math.PI / 2.5 },
    verticalReach: 3,
    pullSpeed: 12,
    gripHoldSeconds: 1.5,
    gripCooldownSeconds: 1.1,
    gripBreathCost: 12,
    freezeHoldSeconds: 3,
    freezeFocusCost: 35,
    freezeBreathCost: 18,
  },
  /**
   * Earth, with several values deliberately unlike the shipped ones so a test that read
   * `DEFAULT_COMBAT_CONFIG` by mistake would fail here rather than pass by coincidence — the same
   * rule the water block above and the enemy fixtures follow.
   *
   * `stoneDamage` is 1 against the shipped 1.1, `pillarSeconds` 5 against 6, `raiseDistance` 5
   * against 6, `maxPillars` 2 as shipped (the cap's behaviour *is* the thing under test in the
   * pillar block, so a different number would only obscure it), and the two prices are the shipped
   * ones because several tests reason about what a full Focus bar buys.
   */
  earth: {
    stone: { range: 12, halfAngle: Math.PI / 9 },
    stoneVerticalReach: 4,
    stoneDamage: 1,
    stoneKnockback: 10,
    stoneCooldownSeconds: 1.8,
    stoneBreathCost: 16,
    raiseDistance: 5,
    raiseVerticalReach: 3,
    pillarRadius: 1.2,
    pillarHeight: 4.5,
    pillarSeconds: 5,
    maxPillars: 2,
    raiseShoveSpeed: 6,
    raiseLiftSpeed: 4,
    raiseFocusCost: 30,
    raiseBreathCost: 18,
  },
  /**
   * Fire, with round numbers unlike the shipped ones on every axis a test here could read by
   * accident: a burst reaching 6 rather than 7, at a 45-degree half-angle rather than 15, doing 0.6
   * damage rather than 1.0, from two charges rather than three.
   *
   * The damage figure is the one worth pointing at. At 0.6 against this fixture's spear health of 1.5
   * a burst does *not* down one in two presses, which is what the shipped 1.0 does — so an assertion
   * about how many bursts a soldier takes cannot pass here by coincidence, and the claims about the
   * recovery ladder are made against `DEFAULT_COMBAT_CONFIG` in `fire.test.ts` where they belong.
   *
   * Two charges rather than three, because the interesting boundary is "the last one", and a fixture
   * that needed three presses to reach it would make every exhaustion test a frame longer for nothing.
   * The wide half-angle is deliberate too: several tests below put two soldiers in one cone, which the
   * shipped 15 degrees is specifically designed to make impossible.
   */
  fire: {
    burst: { range: 6, halfAngle: Math.PI / 4 },
    verticalReach: 2.5,
    burstDamage: 0.6,
    burstKnockback: 5,
    burstCooldownSeconds: 1,
    maxCharges: 2,
    thrustUpSpeed: 8,
    thrustForwardSpeed: 4,
  },
  chain: { maxLinks: 3, windowSeconds: 0.9 },
  reactions: { markSeconds: 2.5, steamDamage: 1.0, mudHoldSeconds: 1.4, holdCeilingSeconds: 3.2 },
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

/**
 * A neutral frame of input: nothing pressed, nothing held.
 *
 * `element: 'air'` is what keeps every test in this file that predates the element system
 * exercising exactly what it used to: F resolves to a gust and R to a vortex under air, which is
 * the only behaviour those tests know about. The water tests set it explicitly.
 *
 * The two meters are generous rather than zero, so a test that fires a water move without saying
 * anything about resources is not silently refused for want of Focus — the affordability rule has
 * its own tests, and a fixture that made every other water test depend on it would hide failures
 * behind a refusal. `fireCharges` is a full hand for the same reason.
 */
const defaults: EncounterInput = {
  playerPosition: ORIGIN, playerForward: NORTH, element: 'air', gustPressed: false, slam: null,
  fireCharges: C.fire.maxCharges,
  vortexHeld: false, vortexReleased: false, playerInvulnerable: false, staffSwing: null,
  // Aim starts equal to `playerForward`, which is what the game hands over on foot: there
  // `player.forward` IS the flattened look direction. Tests that need an elevation override it.
  playerAim: NORTH, playerBreath: 100, airWallHeld: false,
  focusAvailable: 100, breathAvailable: 100,
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
    // knockback is already there), and a few swings past downed would fling the
    // corpse out of the opener's range on their own. Even the minimal count still
    // drifts the corpse a little every frame, which is why the arc precondition
    // below re-checks its position before the probe swing.
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
    // Precondition, not a watch item: the corpse must still lie inside the opener's
    // arc when the probe swing comes, measured with exactly the origin and forward
    // that stepEncounter hands staffTargets (the defaults' playerPosition and
    // playerForward). Without this check, a knockback retune big enough to push the
    // corpse past the opener's range would make the final assertion pass on distance
    // alone, with the isDowned guard never exercised — a silent false pass. With it,
    // that retune reddens here instead, and the empty staffHitThisFrame below can
    // only mean the guard did its job.
    const corpse = encounter.enemies[0]
    if (!corpse) throw new Error('expected the downed enemy to still exist')
    expect(
      inCone(defaults.playerPosition, defaults.playerForward, corpse.position,
        DEFAULT_COMBAT_CONFIG.staffArc.opener),
      'knockback drifted the corpse out of the opener arc; the assertion below would pass on distance alone',
    ).toBe(true)
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
    const arrow = spawnProjectile('arrow-test', arrowFrom, new Vector3(0, 0, 1), 0.3, 0, 0)
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
  const closing = (from = -8) => spawnProjectile(
    'a1', new Vector3(0, 0.5, from), new Vector3(0, 0, 1), 0.8, 20, 0,
  )

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

describe('a gust against plate', () => {
  /**
   * A heavy and a spear standing side by side, both squarely inside one gust cone.
   *
   * **The pair is the whole design of this block, and it exists to answer the trap this
   * codebase has already been caught by twice.** "Nothing happened to the heavy" is not a
   * falsifiable assertion on its own: it passes just as well for a gust aimed at empty sky, for
   * a cone whose vertical band excluded both soldiers, for a `gustPressed` that never reached
   * the resolver, and for a fight that threw no gust at all. The spear beside it is the positive
   * control — the same call, the same cone, the same frame — so every one of those failures
   * shows up as the spear surviving too.
   *
   * They stand 3 units apart at the same height, well inside the 12-unit range and the 60-degree
   * half-angle, so `gustTargets` catches both. `reach-geometry.test.ts` covers the geometry; this
   * block is only ever about the armour.
   */
  const PAIR: EnemySpawn[] = [
    { id: 'plate', position: new Vector3(-1.5, 0, -4), kind: 'heavy' },
    { id: 'leather', position: new Vector3(1.5, 0, -4), kind: 'spear' },
  ]
  const pair = () => startEncounter(PAIR, C)
  const gustThePair = () => stepEncounter(pair(), { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)
  const find = (e: Encounter, id: string) => {
    const found = e.enemies.find((enemy) => enemy.id === id)
    if (!found) throw new Error(`no soldier named ${id}`)
    return found
  }

  it('catches both soldiers geometrically, so the cone is not what separates them', () => {
    // Asserted through `gustTargets` rather than through the fight, because it is a statement
    // about the cone and nothing else. Without this, every assertion below could be satisfied by
    // a heavy that was simply never in range.
    const caught = gustTargets(ORIGIN, NORTH, pair().enemies, C.gust).map((e) => e.id)
    expect(caught.sort()).toEqual(['leather', 'plate'])
  })

  it('takes no health off the heavy while taking it off the spear', () => {
    const step = gustThePair()
    expect(find(step.encounter, 'plate').health.current).toBe(C.enemies.heavy.maxHealth)
    // The control. If this is also unchanged the gust did not happen, and the line above says
    // nothing about armour.
    expect(find(step.encounter, 'leather').health.current)
      .toBeCloseTo(C.enemies.spear.maxHealth - C.gust.damage, 6)
  })

  it('does not move the heavy at all while shoving the spear', () => {
    // Displacement, not merely damage: knockback is the currency section 4.4 gives this type to
    // pressure. Read off `knockback` and `verticalVelocity` rather than off `position`, so a
    // single frame of damping cannot mask an impulse that was applied.
    const step = gustThePair()
    const plate = find(step.encounter, 'plate')
    expect(plate.knockback.length()).toBe(0)
    expect(plate.verticalVelocity).toBe(0)
    const leather = find(step.encounter, 'leather')
    expect(leather.knockback.length()).toBeGreaterThan(0)
    expect(leather.verticalVelocity).toBeGreaterThan(0)
  })

  it('does not interrupt a heavy mid-wind-up, where it does interrupt the spear', () => {
    // `hitEnemy` resets the stance to `recover`, which is how a gust "interrupts, staggers, opens
    // gaps". Armour that stopped the blow has no business also cancelling the swing, so the
    // deflect path skips `hitEnemy` entirely rather than calling it with zeroes.
    //
    // This is the assertion that would survive the two traps the knockback one cannot fully
    // escape: a stance is not physics, so nothing about being shoved or not shoved can produce
    // it by accident.
    const winding: Encounter = {
      ...pair(),
      enemies: pair().enemies.map((e) => ({ ...e, stance: 'wind-up' as const, stanceTime: 0.1 })),
    }
    const step = stepEncounter(winding, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)
    expect(find(step.encounter, 'plate').stance).toBe('wind-up')
    expect(find(step.encounter, 'plate').stanceTime).toBeGreaterThan(0.1)
    // The control: the spear's telegraph is cancelled, as it always was.
    expect(find(step.encounter, 'leather').stance).toBe('recover')
  })

  it('reports the heavy as deflected and the spear as connected, and never both', () => {
    // The two lists have to be disjoint, because `hitThisFrame` pays Focus and
    // `deflectedThisFrame` must not: a soldier that shrugged off a move is not a soldier the
    // player did something to, and paying for it would make plate armour a Focus battery.
    const step = gustThePair()
    expect(step.deflectedThisFrame).toEqual(['plate'])
    expect(step.hitThisFrame).toEqual(['leather'])
  })

  it('reports nothing as deflected when the gust catches only unarmoured soldiers', () => {
    // The negative control on the report itself. Without it, a `deflectedThisFrame` that simply
    // listed everyone in the cone would satisfy the test above.
    const step = gustOnce(near())
    expect(step.deflectedThisFrame).toEqual([])
    expect(step.hitThisFrame).toEqual(['a'])
  })

  it('spends the gust cooldown even when every target turned it away', () => {
    // A gust that costs nothing against plate makes spamming it into a heavy free, which is the
    // opposite of a knockback economy. Asserted against a lone heavy so the cooldown cannot be
    // credited to the spear.
    const alone = startEncounter([PAIR[0]!], C)
    const step = stepEncounter(alone, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)
    expect(step.deflectedThisFrame).toEqual(['plate'])
    expect(step.encounter.gustCooldown).toBe(C.gust.cooldownSeconds)
    expect(canGust(step.encounter)).toBe(false)
  })

  it('never deflects a blow off a downed heavy, because a downed heavy is not a target at all', () => {
    // `isTargetable` is the gate every resolver asks, and the deflect report sits behind it
    // rather than beside it. A clang sounding off a body on the ground would tell the player
    // their gust reached something when it reached nothing.
    const flat: Encounter = {
      ...pair(),
      enemies: pair().enemies.map((e) => ({
        ...e, health: { ...e.health, current: 0 }, stance: 'downed' as const,
      })),
    }
    const step = stepEncounter(flat, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)
    expect(step.deflectedThisFrame).toEqual([])
    expect(step.hitThisFrame).toEqual([])
  })
})

describe('the moves that do still work on plate', () => {
  const heavyAt = (z: number): EnemySpawn[] => [
    { id: 'plate', position: new Vector3(0, 0, z), kind: 'heavy' },
  ]
  const plate = (step: { encounter: Encounter }) => {
    const found = step.encounter.enemies.find((enemy) => enemy.id === 'plate')
    if (!found) throw new Error('no plate')
    return found
  }

  /**
   * The heavy with its plate taken off, and nothing else about it changed.
   *
   * The control every comparison in this block is measured against, and the reason it is this
   * rather than a spear is `applyDamage`'s clamp at zero. A full slam does 2.2, so a spear's 1.5
   * health pool bottoms out and reports 1.5 lost against the heavy's 2.2 — a difference of 0.7
   * that has nothing to do with armour and would have made an honest comparison impossible.
   * Same maxHealth, same pool, same clamp behaviour; the armour table is the only variable.
   */
  const NAKED: CombatConfig = {
    ...C,
    enemies: { ...C.enemies, heavy: { ...C.enemies.heavy, armour: UNARMOURED } },
  }

  it('lets a full-strength slam through whole, damage and displacement alike', () => {
    // The environment route's first half, and the reason the heavy is beatable at all. The wave
    // row is 1 and 1, so this must be indistinguishable from a slam on the same soldier with no
    // armour on. Compared against exactly that rather than against literals, so retuning the wave
    // moves both sides together.
    const slam = { ...defaults, slam: { strength: 1 } }
    const armoured = stepEncounter(startEncounter(heavyAt(-3), C), slam, 1 / 60, C, DEPS)
    const bare = stepEncounter(startEncounter(heavyAt(-3), NAKED), slam, 1 / 60, NAKED, DEPS)
    expect(plate(armoured).knockback.length()).toBeCloseTo(plate(bare).knockback.length(), 10)
    expect(plate(armoured).verticalVelocity).toBeCloseTo(plate(bare).verticalVelocity, 10)
    expect(plate(armoured).health.current).toBeCloseTo(plate(bare).health.current, 10)
    // And not vacuous: the slam did take health off, so "the same as unarmoured" is not "neither
    // of them was touched".
    expect(plate(armoured).health.current).toBeLessThan(C.enemies.heavy.maxHealth)
    expect(plate(armoured).knockback.length()).toBeGreaterThan(0)
    expect(armoured.slamHitThisFrame).toEqual(['plate'])
    expect(armoured.deflectedThisFrame).toEqual([])
  })

  it('lifts a heavy off its feet with a full vortex, less far than it lifts a spear', () => {
    // Reduced, not removed, and both halves are asserted. "Less than a spear" alone would pass
    // for zero, which is the tuning that makes the type unbeatable; "greater than zero" alone
    // would pass for a vortex row of 1, which would make the armour meaningless here.
    const held = { ...defaults, vortexHeld: false, vortexReleased: true }
    const charged = (spawns: EnemySpawn[]): Encounter => ({
      ...startEncounter(spawns, C), vortexHeldSeconds: C.vortex.maxChargeSeconds,
    })
    const armoured = stepEncounter(charged(heavyAt(-3)), held, 1 / 60, C, DEPS)
    const bare = stepEncounter(charged(heavyAt(-3)), held, 1 / 60, NAKED, DEPS)
    expect(plate(armoured).verticalVelocity).toBeGreaterThan(0)
    expect(plate(armoured).verticalVelocity).toBeLessThan(plate(bare).verticalVelocity)
    expect(plate(armoured).knockback.length()).toBeGreaterThan(0)
    expect(plate(armoured).knockback.length()).toBeLessThan(plate(bare).knockback.length())
    // Not a deflect: a reduced blow still connects, still interrupts, and must not clang.
    expect(armoured.deflectedThisFrame).toEqual([])
  })

  it('lets a staff finisher chip a heavy, at a fraction of what an unarmoured one takes', () => {
    // The route that exists so a player with no altitude to spend is not stuck. Deliberately bad
    // rather than absent, and both bounds say so: greater than zero, so there is a route, and less
    // than unarmoured, so the plate means something.
    const swing = { ...defaults, staffSwing: { index: 3, finisher: true } }
    const armoured = stepEncounter(startEncounter(heavyAt(-3), C), swing, 1 / 60, C, DEPS)
    const bare = stepEncounter(startEncounter(heavyAt(-3), NAKED), swing, 1 / 60, NAKED, DEPS)
    const max = C.enemies.heavy.maxHealth
    expect(max - plate(armoured).health.current).toBeGreaterThan(0)
    expect(max - plate(armoured).health.current).toBeLessThan(max - plate(bare).health.current)
    expect(armoured.staffHitThisFrame).toEqual(['plate'])
    expect(armoured.deflectedThisFrame).toEqual([])
  })

  it('can be ground all the way down the recovery ladder by slams alone', () => {
    // The claim that the type is beatable without the environment, played rather than argued: a
    // player who keeps diving eventually takes a heavy off the ladder for good. Section 4.6's
    // rungs are counted here too, so this reddens if armour ever lets one of them be skipped.
    //
    // **The player follows the body, and that is not a convenience.** A full slam shoves its
    // target about 11.5 m, which is past the wave's own 11 m radius -- so a fixed player
    // position lands exactly one slam and every later one misses, and the test would report the
    // heavy as unbeatable for a reason that has nothing to do with armour. A player diving on a
    // heavy walks to it first; the standoff below is a metre, well inside the radius.
    let encounter = startEncounter(heavyAt(-3), C)
    let permanent = false
    let slams = 0
    for (let frame = 0; frame < 60 * 300 && !permanent; frame++) {
      const heavy = encounter.enemies[0]!
      // Only when it is on its feet and on the ground: a body still falling out of a slam is not
      // somewhere a player can land beside, and hitting one already at zero does not advance the
      // ladder -- `hitEnemy` counts crossings, deliberately.
      const worthSlamming = frame % 8 === 0 && !isDowned(heavy.health) && heavy.grounded
      // A metre short of it, along the line back toward the island's centre.
      const stand = heavy.position.clone().multiplyScalar(
        Math.max(0, heavy.position.length() - 1) / Math.max(1e-6, heavy.position.length()),
      )
      const step = stepEncounter(
        encounter,
        {
          ...defaults,
          playerPosition: stand,
          slam: worthSlamming ? { strength: 1 } : null,
        },
        1 / 60, C, DEPS,
      )
      if (worthSlamming) slams += step.slamHitThisFrame.length
      encounter = step.encounter
      const after = encounter.enemies[0]!
      // Off the end of the ladder: downed, with more crossings than there are rungs to climb.
      permanent = isDowned(after.health)
        && after.downs > C.enemies.heavy.recoveryHealthFractions.length
    }
    expect(permanent, 'a heavy could not be taken off the recovery ladder by slams').toBe(true)
    // The control on the loop itself: slams actually connected. Without it a `permanent` that
    // somehow became true for another reason would read as this route working.
    expect(slams).toBeGreaterThanOrEqual(
      C.enemies.heavy.recoveryHealthFractions.length + 1,
    )
  })

  it('cannot be dented at all by gusts, however many land', () => {
    // The negative counterpart of the test above, and the sentence that makes "beatable" mean
    // something. Two hundred seconds of gusting on every cooldown leaves a heavy at full health
    // and standing where it started.
    let encounter = startEncounter(heavyAt(-3), C)
    let deflects = 0
    for (let frame = 0; frame < 60 * 200; frame++) {
      const step = stepEncounter(
        encounter, { ...defaults, gustPressed: canGust(encounter) }, 1 / 60, C, DEPS,
      )
      encounter = step.encounter
      deflects += step.deflectedThisFrame.length
    }
    expect(encounter.enemies[0]!.health.current).toBe(C.enemies.heavy.maxHealth)
    expect(encounter.enemies[0]!.downs).toBe(0)
    // The control that makes the two lines above a statement about armour rather than about a
    // gust that never fired: hundreds of gusts did land on it.
    expect(deflects).toBeGreaterThan(100)
  })
})

describe('a net that lands on the player', () => {
  /**
   * The netter's release, narrowed to the projectile arm of `EnemyAttack`.
   *
   * The throw is asserted against `NET.tangleSeconds` and `NET.damage` rather than against
   * literals, so the fixture is the single source of both. The narrowing throw is not ceremony:
   * a netter whose `attack.kind` had been changed to `melee` would be a netter that cannot throw
   * anything at all, and this is the clearest place to say so.
   */
  const NET = (() => {
    const attack = C.enemies.nets.attack
    if (attack.kind !== 'projectile') throw new Error('a net thrower has to be a ranged attacker')
    return attack
  })()
  const ARROW = (() => {
    const attack = C.enemies.archer.attack
    if (attack.kind !== 'projectile') throw new Error('an archer has to be a ranged attacker')
    return attack
  })()

  /**
   * A netter standing close enough to throw immediately, already at the end of its wind-up.
   *
   * `stanceTime` past `windUpSeconds` so the release happens on the first frame, which is the
   * same shortcut the archer tests take. The player stands 4 units away so the net has a
   * fraction of a second of flight rather than none — an assertion on the frame of the throw
   * would say nothing about the payload arriving.
   */
  const netterAt = (z: number): EnemySpawn[] => [
    { id: 'net-1', position: new Vector3(0, 0, z), kind: 'nets' },
  ]
  const readyToThrow = (spawns: EnemySpawn[]): Encounter => {
    const base = startEncounter(spawns, C)
    return {
      ...base,
      enemies: base.enemies.map((e) => ({
        ...e, stance: 'wind-up' as const, stanceTime: C.enemies.nets.windUpSeconds + 1,
      })),
    }
  }

  /** Throw one net and fly it until something reports a refusal, or the window runs out. */
  function throwOne(over: Partial<EncounterInput> = {}) {
    let encounter = readyToThrow(netterAt(-4))
    let tangle = 0
    let damage = 0
    let arrows = 0
    const before = encounter.playerHealth.current
    for (let frame = 0; frame < 120; frame++) {
      const step = stepEncounter(encounter, { ...defaults, ...over }, 1 / 60, C, DEPS)
      encounter = step.encounter
      tangle = Math.max(tangle, step.tangleSeconds)
      arrows += step.firedThisFrame.length
      damage = before - encounter.playerHealth.current
    }
    return { encounter, tangle, damage, arrows }
  }

  it('reports the netter config\'s own refusal, not some other kind\'s', () => {
    // Read against the fixture's 3 rather than the shipped 2, so a payload sourced from the
    // wrong kind's config — or from a default — is visible rather than plausible.
    const { tangle, arrows } = throwOne()
    expect(arrows).toBeGreaterThan(0)
    expect(tangle).toBe(NET.tangleSeconds)
    expect(tangle).toBe(3)
  })

  it('also takes a little health, so the hit registers as a hit', () => {
    // Not zero on purpose: the hurt flash, the direction wedge and the Focus drain all key off
    // damage, and a mechanic that cost no health would land silently on all three.
    const { damage } = throwOne()
    expect(damage).toBeCloseTo(NET.damage, 6)
  })

  it('reports no refusal on the frames before the net arrives', () => {
    // The positive control's mirror: without this, a `tangleSeconds` wired to the netter's config
    // rather than to the projectile's arrival would satisfy the test above while grounding the
    // player the instant a netter decided to throw.
    const first = stepEncounter(
      readyToThrow(netterAt(-4)), defaults, 1 / 60, C, DEPS,
    )
    expect(first.firedThisFrame.length).toBe(1)
    expect(first.tangleSeconds).toBe(0)
  })

  it('reports nothing at all from an archer, whose arrows carry no refusal', () => {
    // The other negative control, and the one that says this is a property of the net rather than
    // of every projectile. Same fixture shape, same flight, an arrow instead of a net.
    //
    // Stopped as soon as the first shot has landed rather than run for a fixed window, because
    // this fixture reloads: at the archer's 0.6 wind-up and 0.9 recovery a two-second run lands
    // two arrows, and an assertion on the total damage would then be comparing against twice the
    // per-arrow figure for a reason that has nothing to do with what is under test.
    let encounter = readyToThrow([{ id: 'bow-1', position: new Vector3(0, 0, -4), kind: 'archer' }])
    let tangle = 0
    let damage = 0
    const before = encounter.playerHealth.current
    for (let frame = 0; frame < 120 && damage === 0; frame++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, DEPS)
      encounter = step.encounter
      tangle = Math.max(tangle, step.tangleSeconds)
      damage = before - encounter.playerHealth.current
    }
    // The arrow really did connect, so the zero below is about the payload and not about a shot
    // that missed.
    expect(damage).toBeCloseTo(ARROW.damage, 6)
    expect(tangle).toBe(0)
  })

  it('is discarded whole by a Slipstream, along with its damage', () => {
    // A dodge has to answer a net as completely as it answers an arrow, or the one attack in the
    // game that takes the air layer away would be the one attack that cannot be dodged.
    const { tangle, damage } = throwOne({ playerInvulnerable: true })
    expect(tangle).toBe(0)
    expect(damage).toBe(0)
  })

  it('is refused by a Slipstream even if the net is retuned to do no damage', () => {
    // The coupling this guards is subtle and lives in two files. `damageAvoided` requires
    // `damageToPlayer > 0`, so a `tangleSeconds` gated on that flag would let a zero-damage net
    // straight through an invulnerable window — a dodge silently stopping working because
    // somebody retuned a damage figure in `config.ts`. The gate reads `playerInvulnerable`
    // directly for exactly this reason, and this is what holds it there.
    const harmless: CombatConfig = {
      ...C,
      enemies: {
        ...C.enemies,
        nets: { ...C.enemies.nets, attack: { ...NET, damage: 0 } },
      },
    }
    let encounter = readyToThrow(netterAt(-4))
    let tangle = 0
    let landed = 0
    for (let frame = 0; frame < 120; frame++) {
      const dodging = stepEncounter(
        encounter, { ...defaults, playerInvulnerable: true }, 1 / 60, harmless, DEPS,
      )
      encounter = dodging.encounter
      tangle = Math.max(tangle, dodging.tangleSeconds)
    }
    expect(tangle).toBe(0)
    // And the control, on the identical harmless config with the dodge off: the net does still
    // arrive, so the zero above is the dodge working rather than the net failing to connect.
    let vulnerable = readyToThrow(netterAt(-4))
    for (let frame = 0; frame < 120; frame++) {
      const step = stepEncounter(vulnerable, defaults, 1 / 60, harmless, DEPS)
      vulnerable = step.encounter
      landed = Math.max(landed, step.tangleSeconds)
    }
    expect(landed).toBe(NET.tangleSeconds)
  })

  it('costs one refusal for two nets landing together, not two', () => {
    // Two netters equidistant from the player throw on the same cycle and their nets arrive on
    // the same frame. Reported as a sum this would be six seconds on the ground from one
    // exchange, which is long enough over open sky to be a death sentence and is not what either
    // netter threatened. `stepEncounter` takes the maximum; `applyTangle` covers the frames
    // either side.
    let encounter = readyToThrow([
      { id: 'net-1', position: new Vector3(-3, 0, -3), kind: 'nets' },
      { id: 'net-2', position: new Vector3(3, 0, -3), kind: 'nets' },
    ])
    let worst = 0
    for (let frame = 0; frame < 120; frame++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, DEPS)
      encounter = step.encounter
      worst = Math.max(worst, step.tangleSeconds)
    }
    expect(worst).toBe(NET.tangleSeconds)
  })

  it('does not report a refusal for a net that lands on the terrain instead', () => {
    // A net is only a net once it catches somebody. Aimed at a player who then leaves, so the
    // projectile flies past and ends on the ground.
    let encounter = readyToThrow(netterAt(-4))
    // One frame with the player in place, so the throw is aimed at them...
    let step = stepEncounter(encounter, defaults, 1 / 60, C, DEPS)
    encounter = step.encounter
    expect(step.firedThisFrame.length).toBe(1)
    // ...then the player is somewhere else entirely for the rest of the flight.
    let tangle = 0
    const gone = { ...defaults, playerPosition: new Vector3(400, 0, 400) }
    for (let frame = 0; frame < 240; frame++) {
      step = stepEncounter(encounter, gone, 1 / 60, C, DEPS)
      encounter = step.encounter
      tangle = Math.max(tangle, step.tangleSeconds)
    }
    expect(tangle).toBe(0)
    // And the net is gone rather than still in the air, so this is "it landed elsewhere" rather
    // than "the flight window was too short".
    expect(encounter.projectiles).toEqual([])
  })
})

/**
 * The two behaviours that only exist because the Air Wall and the net throwers landed in the
 * same game.
 *
 * Neither branch could have written these: the wall was built against an archipelago with no
 * nets in it, and the netters were built against one with no wall. Both interactions fall out
 * of code neither side changed, which is exactly the kind of behaviour that is nobody's
 * feature and therefore nobody's test until a merge makes it real.
 */
describe('the Air Wall against a net', () => {
  const NET = (() => {
    const attack = C.enemies.nets.attack
    if (attack.kind !== 'projectile') throw new Error('a net thrower has to be a ranged attacker')
    return attack
  })()

  /** A netter at the end of its wind-up, four units north, so the throw lands within a beat. */
  const readyNetter = (): Encounter => {
    const base = startEncounter([{ id: 'net-1', position: new Vector3(0, 0, -4), kind: 'nets' }], C)
    return {
      ...base,
      enemies: base.enemies.map((e) => ({
        ...e, stance: 'wind-up' as const, stanceTime: C.enemies.nets.windUpSeconds + 1,
      })),
    }
  }

  /** Fly the throw out, reporting the worst refusal and whether the net was ever turned. */
  function throwAt(over: Partial<EncounterInput>) {
    let encounter = readyNetter()
    let tangle = 0
    let redirected = 0
    for (let frame = 0; frame < 120; frame++) {
      const step = stepEncounter(encounter, { ...defaults, ...over }, 1 / 60, C, DEPS)
      encounter = step.encounter
      tangle = Math.max(tangle, step.tangleSeconds)
      redirected += step.redirectedThisFrame.length
    }
    return { tangle, redirected }
  }

  it('turns a net around, and a turned net grounds nobody', () => {
    // What this actually pins is that **the wall is indifferent to what kind of projectile it
    // catches**. Nothing in `deflect` or in the loop that offers arrows to it asks whether the
    // thing arriving is an arrow or a net, and that is the whole reason the Air Wall answers a
    // mechanic built two branches away from it without a line of code connecting the two.
    // Verified by mutation: gating the deflection on `arrow.tangleSeconds === 0`, which is the
    // shape a plausible "only arrows can be walled" change would take, reddens this test alone.
    //
    // It is deliberately *not* a test of the `!p.deflected` guard in `stepProjectile`, which an
    // earlier version of this comment claimed. A turned net travels away from the player and
    // never re-enters `hitRadius`, so the guard is not what saves them here — geometry is. The
    // guard has its own test, in `projectile.test.ts`, and dropping it reddens that one.
    const { tangle, redirected } = throwAt({ airWallHeld: true, playerAim: NORTH })
    expect(redirected).toBeGreaterThan(0)
    expect(tangle).toBe(0)
  })

  it('is the only reason that net missed, which is what makes the test mean anything', () => {
    // The control. Without it, "no refusal" would pass just as well for a netter that never
    // threw, a net that expired early, or a fixture aimed somewhere the net could not reach.
    const { tangle, redirected } = throwAt({})
    expect(redirected).toBe(0)
    expect(tangle).toBe(NET.tangleSeconds)
  })
})

describe('the bending keys resolve on the active element', () => {
  /** One frame of the fight, with whatever input the case needs. */
  const frame = (over: Partial<EncounterInput>, from = near()) =>
    stepEncounter(from, { ...defaults, ...over }, 1 / 60, C, DEPS)

  it('gusts on air and grips on water, from the same key', () => {
    // The core claim of the element system, and both halves are needed. Air's press damages the
    // soldier and does not hold it; water's press holds it and does no damage. Either assertion
    // alone would pass for an implementation that ignored the element and always did one of them.
    const air = frame({ element: 'air', gustPressed: true })
    const water = frame({ element: 'water', gustPressed: true })
    const airSoldier = air.encounter.enemies[0]
    const waterSoldier = water.encounter.enemies[0]

    expect(air.hitThisFrame).toEqual(['a'])
    expect(air.grippedThisFrame).toEqual([])
    expect(airSoldier?.health.current).toBeLessThan(C.enemies.spear.maxHealth)
    expect(airSoldier?.stance).not.toBe('held')

    expect(water.grippedThisFrame).toEqual(['a'])
    expect(water.hitThisFrame).toEqual([])
    expect(waterSoldier?.health.current).toBe(C.enemies.spear.maxHealth)
    expect(waterSoldier?.stance).toBe('held')
  })

  it('vortexes on air and freezes on water, from the same release', () => {
    // The heavy key, same shape. The vortex lifts and does no damage; the freeze holds and applies
    // no impulse at all — so `verticalVelocity` is the discriminator, and it is asserted in both
    // directions rather than only for the move that produces it.
    const charged = { ...near(), vortexHeldSeconds: C.vortex.maxChargeSeconds }
    const air = frame({ element: 'air', vortexReleased: true }, charged)
    const water = frame({ element: 'water', vortexReleased: true }, charged)

    expect(air.vortexFired).not.toBeNull()
    expect(air.frozenThisFrame).toEqual([])
    expect(air.encounter.enemies[0]?.verticalVelocity).toBeGreaterThan(0)

    expect(water.frozenThisFrame).toEqual(['a'])
    expect(water.vortexFired).toBeNull()
    expect(water.encounter.enemies[0]?.verticalVelocity).toBe(0)
    expect(water.encounter.enemies[0]?.stance).toBe('held')
  })

  it('banks no vortex charge while water is selected', () => {
    // Without the element gate on the charge accumulator, a player could hold R under water,
    // switch to air and release into a full-strength vortex they never held air for. Paired with
    // the air run, so "no charge accumulated" is not passing because charging is broken outright.
    let underWater = near()
    let underAir = near()
    for (let i = 0; i < 60; i++) {
      underWater = frame({ element: 'water', vortexHeld: true }, underWater).encounter
      underAir = frame({ element: 'air', vortexHeld: true }, underAir).encounter
    }
    expect(underWater.vortexHeldSeconds).toBe(0)
    expect(underAir.vortexHeldSeconds).toBeGreaterThan(0)
  })

  it('bursts on fire, from the same key again', () => {
    // The third element on the light key, and the discriminator is damage: air's press hurts a little
    // and shoves hard, water's holds and hurts not at all, fire's hurts more than either and holds
    // nobody. Asserted against the other two on the same arrangement, because any one of the three
    // alone would pass for an implementation that ignored the element.
    const air = frame({ element: 'air', gustPressed: true })
    const water = frame({ element: 'water', gustPressed: true })
    const fire = frame({ element: 'fire', gustPressed: true })

    expect(fire.burstHitThisFrame).toEqual(['a'])
    expect(fire.hitThisFrame).toEqual([])
    expect(fire.grippedThisFrame).toEqual([])
    expect(fire.encounter.enemies[0]?.stance).not.toBe('held')

    const hurt = (step: typeof fire) =>
      C.enemies.spear.maxHealth - (step.encounter.enemies[0]?.health.current ?? 0)
    expect(hurt(fire)).toBeCloseTo(C.fire.burstDamage, 5)
    expect(hurt(fire)).toBeGreaterThan(hurt(air))
    expect(hurt(water)).toBe(0)
  })

  it('ticks all three light-verb cooldowns whatever element is selected', () => {
    // Switching away must not park a cooldown. Otherwise a player could hide a gust's recovery
    // inside water and come back to a gust that never recovered — and the same in reverse.
    const gusted = frame({ element: 'air', gustPressed: true }).encounter
    expect(gusted.gustCooldown).toBeGreaterThan(0)
    let waiting = gusted
    for (let i = 0; i < 60; i++) {
      waiting = frame({ element: 'water' }, waiting).encounter
    }
    expect(waiting.gustCooldown).toBe(0)

    const gripped = frame({ element: 'water', gustPressed: true }).encounter
    expect(gripped.waterGripCooldown).toBeGreaterThan(0)
    let waitingToo = gripped
    for (let i = 0; i < 90; i++) {
      waitingToo = frame({ element: 'air' }, waitingToo).encounter
    }
    expect(waitingToo.waterGripCooldown).toBe(0)

    // Fire's, ticked while *air* is held. This is the cooldown a switch is most worth laundering,
    // because at 1 second in this fixture it is the longest of the three.
    const burned = frame({ element: 'fire', gustPressed: true }).encounter
    expect(burned.fireBurstCooldown).toBeGreaterThan(0)
    let waitingAgain = burned
    for (let i = 0; i < 90; i++) {
      waitingAgain = frame({ element: 'air' }, waitingAgain).encounter
    }
    expect(waitingAgain.fireBurstCooldown).toBe(0)
  })

  it('keeps the three cooldowns independent, so an element switch launders none of them', () => {
    // A single shared "light verb cooldown" would let the player gust, switch, and grip
    // immediately at the gust's shorter recovery — or worse, grip and then gust at once. Three
    // fields, and this pins that each move leaves the other two timers untouched.
    const gusted = frame({ element: 'air', gustPressed: true }).encounter
    expect(gusted.waterGripCooldown).toBe(0)
    expect(gusted.fireBurstCooldown).toBe(0)
    const gripped = frame({ element: 'water', gustPressed: true }).encounter
    expect(gripped.gustCooldown).toBe(0)
    expect(gripped.fireBurstCooldown).toBe(0)
    const burned = frame({ element: 'fire', gustPressed: true }).encounter
    expect(burned.gustCooldown).toBe(0)
    expect(burned.waterGripCooldown).toBe(0)
  })
})

describe('the Water Grip', () => {
  const W = C.water
  const frame = (over: Partial<EncounterInput>, from = near()) =>
    stepEncounter(from, { ...defaults, ...over }, 1 / 60, C, DEPS)
  const grip = (over: Partial<EncounterInput> = {}, from = near()) =>
    frame({ element: 'water', gustPressed: true, ...over }, from)

  it('pulls the target toward the caster', () => {
    // The direction is the move. Asserted as a distance closing over several frames rather than as
    // an impulse sign, because the pull is delivered as decaying knockback and what matters is
    // that the body actually travels.
    const start = horizontalDistance(ORIGIN, near().enemies[0]!.position)
    let encounter = grip().encounter
    for (let i = 0; i < 20; i++) encounter = frame({ element: 'water' }, encounter).encounter
    expect(horizontalDistance(ORIGIN, encounter.enemies[0]!.position)).toBeLessThan(start)
  })

  it('does no damage at all', () => {
    // Water is the control element, and there is no damage parameter to set. This is the assertion
    // that would catch one appearing.
    expect(grip().encounter.enemies[0]?.health.current).toBe(C.enemies.spear.maxHealth)
  })

  it('spends breath and refuses below the cost', () => {
    // The contract `stepSlipstream` uses for a dodge, and both halves. The refusal costs nothing:
    // no breath, no cooldown, no hold — a press the game declines must not be a press the player
    // is charged for.
    const paid = grip({ breathAvailable: W.gripBreathCost })
    expect(paid.breathSpent).toBe(W.gripBreathCost)
    expect(paid.gripFired).toBe(true)

    const refused = grip({ breathAvailable: W.gripBreathCost - 1 })
    expect(refused.breathSpent).toBe(0)
    expect(refused.gripFired).toBe(false)
    expect(refused.grippedThisFrame).toEqual([])
    expect(refused.encounter.waterGripCooldown).toBe(0)
    expect(refused.encounter.enemies[0]?.stance).not.toBe('held')
  })

  it('spends no Focus', () => {
    // Water's light verb is free of the meter in both directions: it neither pays nor charges. A
    // control move that earned Focus would be a Focus engine, and the freeze spends the same bar.
    const step = grip()
    expect(step.focusSpent).toBe(0)
    expect(step.grippedThisFrame).toEqual(['a'])
  })

  it('reports the fire even when it catches nobody', () => {
    // The effect and the voice fire on the attempt, the way the gust cone is drawn from the press:
    // a move that is silent when it misses reads as a move that did not come out. The empty catch
    // list is what distinguishes this from a connect.
    const empty = startEncounter([], C)
    const step = grip({}, empty)
    expect(step.gripFired).toBe(true)
    expect(step.grippedThisFrame).toEqual([])
    expect(step.breathSpent).toBe(W.gripBreathCost)
  })

  it('does not drag a downed body, and does not report one as a connect', () => {
    // `isTargetable` is the gate, the same one every other resolver asks.
    //
    // **The assertion that matters here is the knockback, and finding that out is what mutation
    // testing is for.** The first version of this test checked only `grippedThisFrame` and the
    // stance, and it survived removing the `isTargetable` gate from the resolver's map — because
    // `holdEnemy` refuses a downed soldier on its own, so the stance stayed 'downed' and the report
    // list is filtered separately. What the gate actually protects is the *pull*: without it,
    // `hitEnemy(enemy, 0, impulse)` still lands, so a corpse in the cone gets yanked across the
    // island. That is the "a body being dragged around the island" this file's other resolvers all
    // guard against, and it is now the thing being asserted.
    const body = downedSoldier(1)
    const before = body.enemies[0]!.position.clone()
    const step = grip({}, body)
    const after = step.encounter.enemies[0]!

    expect(step.grippedThisFrame).toEqual([])
    expect(after.stance).toBe('downed')
    expect(after.knockback.lengthSq()).toBe(0)
    expect(after.position.x).toBeCloseTo(before.x, 6)
    expect(after.position.z).toBeCloseTo(before.z, 6)

    // The positive control on the identical arrangement, differing only in the soldier being alive:
    // a live one *is* dragged, so the assertions above are about the body's state rather than about
    // the grip failing to reach it.
    const live = grip()
    expect(live.grippedThisFrame).toEqual(['a'])
    expect(live.encounter.enemies[0]!.knockback.lengthSq()).toBeGreaterThan(0)
  })
})

describe('the Ice Lock', () => {
  const W = C.water
  const freeze = (over: Partial<EncounterInput> = {}, from = near()) =>
    stepEncounter(from, {
      ...defaults, element: 'water', vortexReleased: true, ...over,
    }, 1 / 60, C, DEPS)

  it('freezes the rank in front and does no damage', () => {
    const step = freeze()
    expect(step.frozenThisFrame).toEqual(['a'])
    expect(step.encounter.enemies[0]?.stance).toBe('held')
    expect(step.encounter.enemies[0]?.health.current).toBe(C.enemies.spear.maxHealth)
  })

  it('spends Focus, and reports the bill rather than applying it', () => {
    // The fight has no meter of its own — `stepEncounter` reports `focusSpent` and `main.ts` hands
    // it to `stepFocus`, the same division of labour `stepEnemy` keeps for `damageToPlayer`.
    const step = freeze()
    expect(step.focusSpent).toBe(W.freezeFocusCost)
    expect(step.breathSpent).toBe(W.freezeBreathCost)
  })

  it('refuses below the Focus cost, and charges nothing for the refusal', () => {
    // Both sides of the boundary, one unit apart, so a `>` where a `>=` belongs is caught. And the
    // refusal is total: no Focus, no breath, and nobody frozen.
    const paid = freeze({ focusAvailable: W.freezeFocusCost })
    expect(paid.freezeFired).toBe(true)
    expect(paid.frozenThisFrame).toEqual(['a'])

    const refused = freeze({ focusAvailable: W.freezeFocusCost - 1 })
    expect(refused.freezeFired).toBe(false)
    expect(refused.focusSpent).toBe(0)
    expect(refused.breathSpent).toBe(0)
    expect(refused.frozenThisFrame).toEqual([])
    expect(refused.encounter.enemies[0]?.stance).not.toBe('held')
  })

  it('refuses below the breath cost even with a full Focus bar', () => {
    const refused = freeze({ focusAvailable: 100, breathAvailable: W.freezeBreathCost - 1 })
    expect(refused.freezeFired).toBe(false)
    expect(refused.focusSpent).toBe(0)
  })

  it('has no cooldown, so two back-to-back releases both fire', () => {
    // Focus is the price and there is deliberately no second gate: a hidden timer would refuse the
    // move for a reason the player cannot see, since the HUD draws the Focus bar and does not draw
    // a cooldown. Two freezes from a full bar are affordable and are meant to be.
    const first = freeze()
    const second = freeze({}, first.encounter)
    expect(first.freezeFired).toBe(true)
    expect(second.freezeFired).toBe(true)
    expect(first.focusSpent + second.focusSpent).toBe(W.freezeFocusCost * 2)
  })

  it('holds longer than a grip, measured through the fight rather than off the config', () => {
    // The relationship that makes the freeze the heavy verb, exercised end to end: both moves are
    // thrown at a fresh soldier and the fight is run until each hold lapses. Reading the two config
    // numbers would assert the config against itself; running the fight asserts that the durations
    // actually reach the soldier.
    const gripped = stepEncounter(near(), {
      ...defaults, element: 'water', gustPressed: true,
    }, 1 / 60, C, DEPS).encounter
    const frozen = freeze().encounter

    const heldFor = (from: Encounter): number => {
      let encounter = from
      let seconds = 0
      for (let i = 0; i < 600; i++) {
        if (encounter.enemies[0]?.stance !== 'held') break
        encounter = stepEncounter(encounter, defaults, 1 / 60, C, DEPS).encounter
        seconds += 1 / 60
      }
      return seconds
    }

    const gripSeconds = heldFor(gripped)
    const freezeSeconds = heldFor(frozen)
    expect(gripSeconds).toBeGreaterThan(0)
    expect(freezeSeconds).toBeGreaterThan(gripSeconds)
    // And each lands within a frame of the duration the config asked for, so neither is being
    // silently truncated or extended by the step order.
    expect(Math.abs(gripSeconds - W.gripHoldSeconds)).toBeLessThan(2 / 60)
    expect(Math.abs(freezeSeconds - W.freezeHoldSeconds)).toBeLessThan(2 / 60)
  })

  it('leaves a frozen soldier hittable by the staff, and it stays frozen', () => {
    // The reason `isTargetable` was not changed. A locked target is locked so it can be worked on:
    // the staff has to connect, has to do its damage, and must not free the soldier.
    const frozen = freeze().encounter
    const swung = stepEncounter(frozen, {
      ...defaults, staffSwing: { index: 1, finisher: false },
    }, 1 / 60, C, DEPS)
    expect(swung.staffHitThisFrame).toEqual(['a'])
    expect(swung.encounter.enemies[0]?.health.current).toBeLessThan(C.enemies.spear.maxHealth)
    expect(swung.encounter.enemies[0]?.stance).toBe('held')
  })

  it('cannot be thrown while air is selected', () => {
    // The mirror of the gust gate: releasing the heavy key under air fires a vortex or nothing, and
    // never a freeze. Paired with the water run so this is about the element rather than about the
    // release edge being dropped.
    const air = stepEncounter(near(), {
      ...defaults, element: 'air', vortexReleased: true,
    }, 1 / 60, C, DEPS)
    expect(air.freezeFired).toBe(false)
    expect(air.focusSpent).toBe(0)
    expect(freeze().freezeFired).toBe(true)
  })
})

describe('switching element on the same frame as a release', () => {
  it('cannot fire a vortex and an Ice Lock from one press', () => {
    // **This case was a real bug and the fix is the element gate on the release branch.** The
    // charge accumulator is zeroed every frame water is selected, but that `else` is guarded on
    // `!vortexReleased` — so on the single frame where the player switches to water *and* lets go
    // of R, a charge built under air is still standing when the release resolves. Ungated, that
    // frame produced a full-strength vortex *and* a freeze, and charged Focus for the freeze: two
    // heavy moves for one press.
    //
    // Reproduced by handing the fight a pre-loaded charge and a water release, which is exactly
    // the state that frame is in.
    const charged = { ...near(), vortexHeldSeconds: C.vortex.maxChargeSeconds }
    const step = stepEncounter(charged, {
      ...defaults, element: 'water', vortexReleased: true,
    }, 1 / 60, C, DEPS)

    expect(step.vortexFired).toBeNull()
    // The freeze is what the player asked for, and it does happen — so this is not passing because
    // the whole release was swallowed.
    expect(step.freezeFired).toBe(true)
    expect(step.focusSpent).toBe(C.water.freezeFocusCost)
    // No lift, which is the observable signature of the vortex that must not have fired.
    expect(step.encounter.enemies[0]?.verticalVelocity).toBe(0)
  })

  it('discards the stale charge rather than parking it for a later air release', () => {
    // The charge is cleared on any release, whichever element is selected. Left standing, the
    // player could switch back to air, tap R, and get the vortex they had already spent.
    const charged = { ...near(), vortexHeldSeconds: C.vortex.maxChargeSeconds }
    const released = stepEncounter(charged, {
      ...defaults, element: 'water', vortexReleased: true,
    }, 1 / 60, C, DEPS).encounter
    expect(released.vortexHeldSeconds).toBe(0)

    const later = stepEncounter(released, {
      ...defaults, element: 'air', vortexReleased: true,
    }, 1 / 60, C, DEPS)
    expect(later.vortexFired).toBeNull()
  })
})

/**
 * Water against plate.
 *
 * Before this, `BendingSource` named only the four air moves, so `ArmourTable` had no row for a
 * grip or a freeze and `deflects` could not be asked about either. The heavy armoured soldier —
 * the one type whose whole identity is that a blow can be refused — had no defence against water
 * of any kind, and nothing said whether that was intended. It was an expressiveness gap before it
 * was a balance one: there was no way to write the rule down. These tests pin the rule written.
 *
 * **Two things had to be got right before any of this was falsifiable, and the first draft got
 * both wrong.**
 *
 * The shipped values are asserted against `DEFAULT_COMBAT_CONFIG`, not against this file's `C`.
 * The fixture's armour is deliberately unlike the real heavy's on every row — that is what makes
 * a test accidentally reading the wrong config visible — so a claim about what the *game* does
 * has to name the game's config. The first draft asserted shipped behaviour while running on the
 * fixture and failed on its own mismatch.
 *
 * And "the body did not move" is not a claim position can carry for an *unheld* soldier: it
 * advances on its own, so a deflected heavy walks 0.3 units in twenty frames and a position
 * assertion catches its aggro rather than the pull. Position is only used where both soldiers are
 * held — a held soldier is inert, so the only thing left that can move it is the pull.
 */
describe('water against plate', () => {
  const SHIPPED = DEFAULT_COMBAT_CONFIG
  const HEAVY = SHIPPED.enemies.heavy.armour
  /**
   * A heavy and a spear side by side, both inside the shipped grip's cone.
   *
   * At (±1.5, 0, −4) each is 4.27 out and 20.6 degrees off the axis, against the shipped grip's
   * range of 10 and half-angle of 30 degrees, on ground flat enough for its 3-unit band. The
   * spear is the positive control on every assertion below: "nothing happened to the heavy"
   * passes for a grip aimed at empty sky, a cone that caught nobody, an `element` that never
   * reached the resolver, and a fight that threw nothing — and every one of those shows up here
   * as the spear being untouched too.
   */
  const PAIR: EnemySpawn[] = [
    { id: 'plate', position: new Vector3(-1.5, 0, -4), kind: 'heavy' },
    { id: 'leather', position: new Vector3(1.5, 0, -4), kind: 'spear' },
  ]
  const find = (e: Encounter, id: string) => {
    const found = e.enemies.find((enemy) => enemy.id === id)
    if (!found) throw new Error(`no soldier named ${id}`)
    return found
  }
  const gripThePair = (config = SHIPPED, frames = 20) => {
    const from = startEncounter(PAIR, config)
    const before = {
      plate: find(from, 'plate').position.clone(),
      leather: find(from, 'leather').position.clone(),
    }
    const first = stepEncounter(
      from, { ...defaults, element: 'water', gustPressed: true }, 1 / 60, config, DEPS,
    )
    let encounter = first.encounter
    for (let i = 0; i < frames; i++) {
      encounter = stepEncounter(
        encounter, { ...defaults, element: 'water' }, 1 / 60, config, DEPS,
      ).encounter
    }
    return { first, encounter, before }
  }
  const freezeThePair = (config = SHIPPED) => stepEncounter(
    { ...startEncounter(PAIR, config), vortexHeldSeconds: 0 },
    { ...defaults, element: 'water', vortexReleased: true, focusAvailable: 100 },
    1 / 60, config, DEPS,
  )

  it('writes the decision down in the shipped config', () => {
    // The two rows, pinned as values rather than left to the prose in `config.ts`. Both are the
    // decision this work exists to record: the pull is refused, the hold is not.
    expect(HEAVY.grip).toEqual({ damage: 1, knockback: 0 })
    expect(HEAVY.freeze).toEqual({ damage: 1, knockback: 1 })
    // And neither is a full deflect, which is what keeps the move landing at all. A grip row of
    // 0 and 0 would make `deflects` true and skip the hold with it — the thing the config
    // comment argues against, asserted rather than trusted.
    expect(deflects(SHIPPED.enemies.heavy, 'grip')).toBe(false)
    expect(deflects(SHIPPED.enemies.heavy, 'freeze')).toBe(false)
  })

  it('takes hold of a heavy without dragging it, and drags the spear beside it', () => {
    // The rule. Both halves asserted, because either alone is the wrong feature: a heavy that
    // gets dragged has no armour, and a heavy that does not get held is immune to the control
    // element outright. Position is meaningful here precisely because both are held, so neither
    // is walking and the pull is the only thing left that could move them.
    const { first, encounter, before } = gripThePair()
    expect(first.grippedThisFrame).toEqual(expect.arrayContaining(['plate', 'leather']))
    expect(find(first.encounter, 'plate').stance).toBe('held')
    expect(find(first.encounter, 'leather').stance).toBe('held')

    expect(find(encounter, 'plate').position.distanceTo(before.plate)).toBeCloseTo(0, 5)
    expect(find(encounter, 'leather').position.distanceTo(before.leather)).toBeGreaterThan(0.5)
  })

  it('freezes a heavy for the full duration, which is decided rather than overlooked', () => {
    // Raised as a balance problem and settled the other way, so it is pinned as behaviour: ice
    // round the legs is not a blow shrugged off by a breastplate, and a freeze cannot break a
    // heavy in any case — water carries no damage, so nothing about it moves this soldier down
    // the recovery ladder. What it buys is the seconds to set up the wave, which is the answer
    // section 4.4 names for this type.
    const step = freezeThePair()
    expect(step.frozenThisFrame).toEqual(expect.arrayContaining(['plate', 'leather']))
    // One frame under the configured duration, not equal to it, and that is `stepEnemy` doing
    // what it documents: the hold is decremented once at the top of the step, so a hold applied
    // during the same step is already a frame old by the time the step returns. Written as the
    // arithmetic rather than as 3.1833 so a retune of `freezeHoldSeconds` carries the assertion
    // with it, and so the one-frame offset stays visible instead of looking like a rounded literal.
    expect(find(step.encounter, 'plate').heldSeconds)
      .toBeCloseTo(SHIPPED.water.freezeHoldSeconds - 1 / 60, 5)
    // Identical to the unarmoured soldier's, which is the claim: armour has nothing to say here.
    expect(find(step.encounter, 'plate').heldSeconds)
      .toBeCloseTo(find(step.encounter, 'leather').heldSeconds, 5)
  })

  it('reports a grip a kind turns away outright, instead of doing nothing quietly', () => {
    // The lever the widened table exists to provide, at a config that ships nowhere. A refused
    // move has to reach the feedback layer or it reads as a bug — the same contract the gust's
    // clang already has. No position assertion on the heavy: a deflected soldier is not held, so
    // it advances under its own aggro and its position would be measuring that.
    const immune: CombatConfig = {
      ...SHIPPED,
      enemies: {
        ...SHIPPED.enemies,
        heavy: {
          ...SHIPPED.enemies.heavy,
          armour: { ...HEAVY, grip: { damage: 0, knockback: 0 } },
        },
      },
    }
    const { first } = gripThePair(immune)
    expect(first.deflectedThisFrame).toContain('plate')
    expect(first.grippedThisFrame).not.toContain('plate')
    expect(find(first.encounter, 'plate').stance).not.toBe('held')
    // The control on the same frame: one kind's armour, not a grip that stopped working.
    expect(first.grippedThisFrame).toContain('leather')
    expect(find(first.encounter, 'leather').stance).toBe('held')
  })

  it('leaves fire\'s own row alone, since a burst is neither of water\'s moves', () => {
    // The row-by-row independence of the table, which is what makes a per-move armour decision a
    // decision at all. Asserted here rather than in fire's own block because this is the file that
    // owns the shipped heavy's rows.
    expect(deflects(SHIPPED.enemies.heavy, 'burst')).toBe(false)
    expect(HEAVY.burst).toEqual({ damage: 0.5, knockback: 0 })
  })

  it('reports a freeze a kind turns away outright, and leaves it unheld', () => {
    // The branch that never fires in the shipped game, kept live by a test rather than by a
    // comment, so the `freeze` row is a working lever if playing it says the freeze should be
    // blocked after all.
    const immune: CombatConfig = {
      ...SHIPPED,
      enemies: {
        ...SHIPPED.enemies,
        heavy: {
          ...SHIPPED.enemies.heavy,
          armour: { ...HEAVY, freeze: { damage: 0, knockback: 0 } },
        },
      },
    }
    const step = freezeThePair(immune)
    expect(step.deflectedThisFrame).toContain('plate')
    expect(step.frozenThisFrame).not.toContain('plate')
    expect(find(step.encounter, 'plate').stance).not.toBe('held')
    expect(step.frozenThisFrame).toContain('leather')
    expect(find(step.encounter, 'leather').stance).toBe('held')
  })
})

describe('earth on the two bending keys', () => {
  /**
   * A soldier squarely inside the fixture stone's cone, and a second one beside it.
   *
   * Two, always, and the reason is the trap this repo has already been caught by: an assertion that
   * nothing happened passes for a move aimed at empty sky, for a cone that caught nobody, for an
   * `element` that never reached the resolver and for a fight that threw nothing at all. The second
   * soldier is the positive control that separates those from the thing under test.
   *
   * At (0, 0, −3) and (0.6, 0, −3) both sit inside the fixture's 40-degree cone: about 3 out and
   * 11.3 degrees off the axis at worst, against a range of 12.
   */
  const PAIR: EnemySpawn[] = [
    { id: 'front', position: new Vector3(0, 0, -3), kind: 'spear' },
    { id: 'beside', position: new Vector3(0.6, 0, -3), kind: 'spear' },
  ]
  const find = (e: Encounter, id: string) => {
    const found = e.enemies.find((enemy) => enemy.id === id)
    if (!found) throw new Error(`no soldier named ${id}`)
    return found
  }
  const pair = () => startEncounter(PAIR, C)
  const throwStone = (from = pair(), over: Partial<EncounterInput> = {}) => stepEncounter(
    from, { ...defaults, element: 'earth', gustPressed: true, ...over }, 1 / 60, C, DEPS,
  )
  const raise = (from = pair(), over: Partial<EncounterInput> = {}) => stepEncounter(
    from, { ...defaults, element: 'earth', vortexReleased: true, ...over }, 1 / 60, C, DEPS,
  )

  describe('the light key', () => {
    it('throws a stone under earth and a gust under air, from the same press', () => {
      // The dispatch, all three ways round. `stoneFired` alone would pass for a resolver that
      // ignored the element and threw a stone whatever was selected.
      const earth = throwStone()
      expect(earth.stoneFired).toBe(true)
      expect(earth.hitThisFrame).toEqual([])
      const air = stepEncounter(
        pair(), { ...defaults, element: 'air', gustPressed: true }, 1 / 60, C, DEPS,
      )
      expect(air.stoneFired).toBe(false)
      expect(air.hitThisFrame.length).toBeGreaterThan(0)
      const water = stepEncounter(
        pair(), { ...defaults, element: 'water', gustPressed: true }, 1 / 60, C, DEPS,
      )
      expect(water.stoneFired).toBe(false)
      expect(water.gripFired).toBe(true)
    })

    it('damages and shoves everyone in the cone', () => {
      const step = throwStone()
      expect([...step.stoneHitThisFrame].sort()).toEqual(['beside', 'front'])
      for (const id of ['front', 'beside']) {
        const hit = find(step.encounter, id)
        expect(hit.health.current).toBeCloseTo(C.enemies.spear.maxHealth - C.earth.stoneDamage, 5)
        // Shoved outward, away from a thrower at the origin, so the push is negative in z.
        expect(hit.knockback.z).toBeLessThan(0)
      }
    })

    it('leaves a soldier out of the cone alone', () => {
      // The other half of the positive control: a soldier 90 degrees off the axis is outside a
      // 40-degree cone and must be untouched while the two in front are hit. Its *health* is the
      // evidence rather than its position, because an unheld soldier walks under its own aggro and
      // position would be measuring that instead.
      const wide = startEncounter([
        ...PAIR, { id: 'flank', position: new Vector3(6, 0, 0), kind: 'spear' },
      ], C)
      const step = throwStone(wide)
      expect(step.stoneHitThisFrame).not.toContain('flank')
      expect(find(step.encounter, 'flank').health.current).toBe(C.enemies.spear.maxHealth)
      expect(step.stoneHitThisFrame.length).toBe(2)
    })

    it('spends the cooldown and the breath, and reports the breath rather than holding it', () => {
      const step = throwStone()
      expect(step.encounter.stoneThrowCooldown).toBe(C.earth.stoneCooldownSeconds)
      expect(step.breathSpent).toBe(C.earth.stoneBreathCost)
      // No Focus at all: the light verbs do not spend it.
      expect(step.focusSpent).toBe(0)
    })

    it('spends the cooldown even when it catches nobody', () => {
      // A stone that cost nothing on a miss would make the slowest move in the game free to fish
      // with, which is the opposite of "slow, committed".
      const step = throwStone(startEncounter([], C))
      expect(step.stoneFired).toBe(true)
      expect(step.stoneHitThisFrame).toEqual([])
      expect(step.encounter.stoneThrowCooldown).toBe(C.earth.stoneCooldownSeconds)
      expect(step.breathSpent).toBe(C.earth.stoneBreathCost)
    })

    it('refuses on cooldown, and the refusal costs nothing', () => {
      const first = throwStone()
      const second = throwStone(first.encounter)
      expect(second.stoneFired).toBe(false)
      expect(second.stoneHitThisFrame).toEqual([])
      expect(second.breathSpent).toBe(0)
      expect(second.encounter.stoneThrowCooldown)
        .toBeCloseTo(C.earth.stoneCooldownSeconds - 1 / 60, 6)
    })

    it('refuses without the breath, and that refusal costs nothing either', () => {
      const step = throwStone(pair(), { breathAvailable: C.earth.stoneBreathCost - 1 })
      expect(step.stoneFired).toBe(false)
      expect(step.breathSpent).toBe(0)
      expect(step.encounter.stoneThrowCooldown).toBe(0)
      expect(find(step.encounter, 'front').health.current).toBe(C.enemies.spear.maxHealth)
    })

    it('ticks its cooldown down whatever element is selected', () => {
      // **The first of the four rules the water design note says cost real bugs.** Switching away
      // must not park a cooldown, or a player hides one move's recovery inside another element and
      // comes back to a stone that never recovered.
      let encounter = throwStone().encounter
      const parked = encounter.stoneThrowCooldown
      for (let i = 0; i < 30; i++) {
        encounter = stepEncounter(
          encounter, { ...defaults, element: 'air' }, 1 / 60, C, DEPS,
        ).encounter
      }
      expect(encounter.stoneThrowCooldown).toBeLessThan(parked - 0.4)
    })

    it('does not fire on the frame the cooldown expires, one frame before the guide agrees', () => {
      // **A test written because mutation found nothing was holding this.** The branch is gated on
      // `canStone(encounter, ...)` — the pre-step encounter, which is the same value the action guide
      // reads — rather than on the copy this function has already decremented. Swapping one for the
      // other left every other assertion green, and the bug it produces is the one the water design
      // note lists: a move that fires a frame before the panel will admit it can, which is a
      // discrepancy the player sees as the guide lying.
      //
      // The frame that separates them is the one where the cooldown is still positive but smaller
      // than a step: the pre-step predicate says no, the decremented copy says yes.
      let encounter = throwStone().encounter
      let guard = 0
      while (encounter.stoneThrowCooldown > 1 / 60 && guard++ < 600) {
        encounter = stepEncounter(encounter, defaults, 1 / 60, C, DEPS).encounter
      }
      expect(encounter.stoneThrowCooldown).toBeGreaterThan(0)
      expect(encounter.stoneThrowCooldown).toBeLessThanOrEqual(1 / 60)
      // Pressed on exactly that frame: refused, because the cooldown has not run out yet.
      const early = throwStone(encounter)
      expect(early.stoneFired).toBe(false)
      expect(early.breathSpent).toBe(0)
      // And on the very next frame it fires, so the refusal above is one frame of timing rather than
      // a move that stopped working.
      expect(early.encounter.stoneThrowCooldown).toBe(0)
      expect(throwStone(early.encounter).stoneFired).toBe(true)
    })

    it('keeps its own cooldown separate from the gust\'s and the grip\'s', () => {
      // A shared "light verb cooldown" would let an element switch convert the shorter cooldown into
      // the longer one. Throwing a stone must leave a gust available.
      const step = throwStone()
      expect(step.encounter.gustCooldown).toBe(0)
      expect(step.encounter.waterGripCooldown).toBe(0)
      expect(canGust(step.encounter)).toBe(true)
    })
  })

  describe('the heavy key', () => {
    it('raises a pillar under earth, ahead of the player, on the ground it finds', () => {
      const step = raise()
      expect(step.pillarRaised).not.toBeNull()
      expect(step.encounter.pillars.length).toBe(1)
      const pillar = step.encounter.pillars[0]!
      expect(pillar.position.z).toBeCloseTo(-C.earth.raiseDistance, 6)
      expect(pillar.position.y).toBe(0)
      expect(pillar.secondsLeft).toBeCloseTo(C.earth.pillarSeconds, 6)
    })

    it('freezes under water and raises nothing, from the same release', () => {
      const water = stepEncounter(
        pair(), { ...defaults, element: 'water', vortexReleased: true }, 1 / 60, C, DEPS,
      )
      expect(water.pillarRaised).toBeNull()
      expect(water.encounter.pillars).toEqual([])
      expect(water.freezeFired).toBe(true)
      const earth = raise()
      expect(earth.freezeFired).toBe(false)
      expect(earth.pillarRaised).not.toBeNull()
    })

    it('does not fire a vortex and a pillar for one release', () => {
      // **The one-frame hole the water cycle found, re-asked for earth.** A charge built under air is
      // still standing on the frame the player switches away and lets go, because the `else` that
      // zeroes it is guarded on `!vortexReleased`. Ungated, one press would produce a full-strength
      // vortex *and* a pillar, and pay Focus for the pillar.
      const charged = { ...pair(), vortexHeldSeconds: C.vortex.maxChargeSeconds }
      const step = raise(charged)
      expect(step.vortexFired).toBeNull()
      expect(step.pillarRaised).not.toBeNull()
      // The charge is discarded rather than parked, so switching back to air does not find it.
      expect(step.encounter.vortexHeldSeconds).toBe(0)
      // The positive control: the identical charge released under *air* does fire, so the null above
      // is the element gate and not a charge that was never there.
      const underAir = stepEncounter(
        charged, { ...defaults, element: 'air', vortexReleased: true }, 1 / 60, C, DEPS,
      )
      expect(underAir.vortexFired).not.toBeNull()
      expect(underAir.encounter.pillars).toEqual([])
    })

    it('spends Focus and breath, and reports both rather than holding a meter', () => {
      const step = raise()
      expect(step.focusSpent).toBe(C.earth.raiseFocusCost)
      expect(step.breathSpent).toBe(C.earth.raiseBreathCost)
    })

    it('refuses without the Focus, and the refusal costs nothing', () => {
      const step = raise(pair(), { focusAvailable: C.earth.raiseFocusCost - 1 })
      expect(step.pillarRaised).toBeNull()
      expect(step.encounter.pillars).toEqual([])
      expect(step.focusSpent).toBe(0)
      expect(step.breathSpent).toBe(0)
    })

    it('refuses without the breath, for nothing', () => {
      const step = raise(pair(), { breathAvailable: C.earth.raiseBreathCost - 1 })
      expect(step.pillarRaised).toBeNull()
      expect(step.focusSpent).toBe(0)
      expect(step.breathSpent).toBe(0)
    })

    it('refuses over the void, for nothing, with the Focus still in hand', () => {
      // A raise with nowhere to found a pillar is refused exactly as one that cannot be paid for is.
      // The Focus assertion is the one that matters: charging for a move the world declined would be
      // the most confusing refusal in the game, since the meter is the only visible price.
      const overVoid = { ...DEPS, ground: { groundHeightAt: () => null } }
      const step = stepEncounter(
        pair(), { ...defaults, element: 'earth', vortexReleased: true }, 1 / 60, C, overVoid,
      )
      expect(step.pillarRaised).toBeNull()
      expect(step.encounter.pillars).toEqual([])
      expect(step.focusSpent).toBe(0)
      expect(step.breathSpent).toBe(0)
    })

    it('refuses from too far above the ground, for nothing', () => {
      // The rule that stops hard cover being manufactured from a hover.
      const step = raise(pair(), {
        playerPosition: new Vector3(0, C.earth.raiseVerticalReach + 2, 0),
      })
      expect(step.pillarRaised).toBeNull()
      expect(step.focusSpent).toBe(0)
      // The positive control at a height inside the limit: the same call succeeds.
      expect(raise(pair(), {
        playerPosition: new Vector3(0, C.earth.raiseVerticalReach - 0.5, 0),
      }).pillarRaised).not.toBeNull()
    })

    it('shoves a soldier standing where the rock comes up, and interrupts it', () => {
      // Section 4.2's "drop a pillar under them", as a mechanic. Zero damage, so the evidence is the
      // impulse and the stance rather than health.
      const underfoot: EnemySpawn[] = [
        { id: 'under', position: new Vector3(0, 0, -C.earth.raiseDistance), kind: 'spear' },
        { id: 'clear', position: new Vector3(6, 0, -C.earth.raiseDistance), kind: 'spear' },
      ]
      const step = raise(startEncounter(underfoot, C))
      const under = find(step.encounter, 'under')
      expect(under.health.current).toBe(C.enemies.spear.maxHealth)
      // One frame of gravity lighter than the configured lift, and written as the arithmetic rather
      // than as 3.667 for the reason the freeze's hold assertion is: `stepEnemy` integrates gravity
      // after the impulse lands, so the value the step returns is already a frame old. A literal
      // here would hide that, and a retune of the lift or the gravity would then look like a bug.
      expect(under.verticalVelocity)
        .toBeCloseTo(C.earth.raiseLiftSpeed - C.enemies.spear.gravity / 60, 6)
      expect(under.stance).toBe('recover')
      // The positive control: the soldier six metres from the rock is untouched by it, so the shove
      // is a footprint and not a radial knockback wearing one.
      const clear = find(step.encounter, 'clear')
      expect(clear.verticalVelocity).toBe(0)
      expect(clear.knockback.length()).toBe(0)
    })

    it('caps the standing pillars and retires the oldest', () => {
      // Raised on separate frames, since one release is one pillar. The cap's own arithmetic is
      // tested in `earth.test.ts`; this is the fight applying it.
      let encounter = pair()
      const ids: string[] = []
      for (let i = 0; i < C.earth.maxPillars + 1; i++) {
        const step = raise(encounter)
        expect(step.pillarRaised).not.toBeNull()
        ids.push(step.pillarRaised!.id)
        encounter = step.encounter
      }
      expect(encounter.pillars.length).toBe(C.earth.maxPillars)
      expect(encounter.pillars.map((p) => p.id)).toEqual(ids.slice(1))
      // Ids are unique and counter-derived, so a view keyed off one cannot be reused for another.
      expect(new Set(ids).size).toBe(ids.length)
      expect(encounter.nextPillarId).toBe(ids.length)
    })

    it('ages its pillars whatever element is selected', () => {
      // The same rule the cooldowns follow. Cover whose clock only ran while earth was in hand would
      // last as long as the player did not use the rest of their kit, which is not a cost.
      let encounter = raise().encounter
      const raisedWith = encounter.pillars[0]!.secondsLeft
      for (let i = 0; i < 60; i++) {
        encounter = stepEncounter(
          encounter, { ...defaults, element: 'water' }, 1 / 60, C, DEPS,
        ).encounter
      }
      expect(encounter.pillars[0]!.secondsLeft).toBeCloseTo(raisedWith - 1, 5)
    })

    it('sinks a pillar when its life runs out', () => {
      let encounter = raise().encounter
      expect(encounter.pillars.length).toBe(1)
      for (let i = 0; i < Math.ceil(C.earth.pillarSeconds * 60) + 2; i++) {
        encounter = stepEncounter(encounter, defaults, 1 / 60, C, DEPS).encounter
      }
      expect(encounter.pillars).toEqual([])
    })
  })
})

describe('a pillar as cover, inside the fight', () => {
  /**
   * An archer out at 20, with the player at the origin.
   *
   * The block is measured through the whole fight rather than through `stepProjectile` alone, because
   * the ordering that makes cover work — pillars aged, the raise resolved, then the arrows stepped —
   * lives in `stepEncounter` and nowhere else.
   */
  const ARCHER: EnemySpawn[] = [{ id: 'bow', position: new Vector3(0, 0, -20), kind: 'archer' }]
  /** An arrow already in the air, heading at a player standing at the origin. */
  const incoming = (from: Encounter): Encounter => ({
    ...from,
    projectiles: [spawnProjectile(
      'shot', new Vector3(0, 1.1, -12), new Vector3(0, -0.09, 1), 1, 34, 0,
    )],
  })
  /** A pillar between the player and the archer, on the flat ground the fixture provides. */
  const covered = (from: Encounter): Encounter => stepEncounter(
    from, { ...defaults, element: 'earth', vortexReleased: true }, 1 / 60, C, DEPS,
  ).encounter

  it('stops an arrow that would otherwise reach the player', () => {
    // Both halves, and the uncovered case is what makes the covered one mean anything: "the player
    // was not hit" passes on its own for an arrow that expired, missed, or was never in the air.
    let unprotected = incoming(startEncounter(ARCHER, C))
    let hit = false
    for (let i = 0; i < 40; i++) {
      const step = stepEncounter(unprotected, defaults, 1 / 60, C, DEPS)
      unprotected = step.encounter
      if (step.playerHit) hit = true
    }
    expect(hit).toBe(true)

    let sheltered = incoming(covered(startEncounter(ARCHER, C)))
    expect(sheltered.pillars.length).toBe(1)
    let blocked = 0
    let struck = false
    for (let i = 0; i < 40; i++) {
      const step = stepEncounter(sheltered, defaults, 1 / 60, C, DEPS)
      sheltered = step.encounter
      blocked += step.blockedThisFrame.length
      if (step.playerHit) struck = true
    }
    expect(blocked).toBe(1)
    expect(struck).toBe(false)
  })

  it('reports which pillar stopped it and where, so the block can be seen and heard', () => {
    let encounter = incoming(covered(startEncounter(ARCHER, C)))
    const pillar = encounter.pillars[0]!
    let report: PillarBlock | null = null
    for (let i = 0; i < 40 && report === null; i++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, DEPS)
      encounter = step.encounter
      report = step.blockedThisFrame[0] ?? null
    }
    expect(report).not.toBeNull()
    expect(report!.pillarId).toBe(pillar.id)
    // The strike point is outside the column rather than on its axis, which is what keeps a dust
    // burst from being drawn inside the rock. Measured as a distance from the axis rather than as a
    // signed comparison in z — the first attempt at this assertion had the sign backwards, because
    // this arrow flies toward +z and so meets the *more negative* face.
    //
    // Bounded above as well as below: the report carries the position the shot entered the step at,
    // which at the archer's speed of 34 is up to 0.57 units short of the face it struck, so the dust
    // lands within one frame's travel of the rock and not somewhere out in the open.
    const offAxis = Math.hypot(
      report!.at.x - pillar.position.x, report!.at.z - pillar.position.z,
    )
    expect(offAxis).toBeGreaterThan(pillar.radius)
    expect(offAxis).toBeLessThan(pillar.radius + 1)
    // And the arrow is gone: a blocked shot ends, it does not carry on past the rock.
    expect(encounter.projectiles).toEqual([])
  })

  it('stops a net without grounding the player', () => {
    // The payload has to die with the shot. A net that reached through cover and stowed the glider
    // would make the pillar useless against the one enemy whose whole job is grounding the player.
    let encounter: Encounter = {
      ...covered(startEncounter(ARCHER, C)),
      projectiles: [spawnProjectile(
        'net', new Vector3(0, 1.1, -12), new Vector3(0, -0.09, 1), 0.5, 22, 3,
      )],
    }
    let tangle = 0
    let blocked = 0
    for (let i = 0; i < 60; i++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, DEPS)
      encounter = step.encounter
      tangle = Math.max(tangle, step.tangleSeconds)
      blocked += step.blockedThisFrame.length
    }
    expect(blocked).toBe(1)
    expect(tangle).toBe(0)
  })

  it('keeps its pillars across a patrol restore, unlike the arrows', () => {
    // The decision recorded on `Pillar.secondsLeft`: one clock owns a pillar's life, because the view
    // layer cannot be told an object died early. Nothing survives the trip in practice — the player
    // has to get past `respawnRange` — so this is the rule stated where it can be checked.
    const spawns: EnemySpawn[] = [{ id: 'solo', position: new Vector3(0, 0, -3), kind: 'spear' }]
    const deps = { ...DEPS, spawns, patrol: { respawnRange: 40 } }
    const raised = stepEncounter(
      startEncounter(spawns, C),
      { ...defaults, element: 'earth', vortexReleased: true }, 1 / 60, C, deps,
    ).encounter
    expect(raised.pillars.length).toBe(1)
    // Down the soldier and walk away, which is what makes `shouldRestorePatrol` fire.
    const spent: Encounter = {
      ...raised,
      enemies: raised.enemies.map((enemy) => ({
        ...enemy, health: { ...enemy.health, current: 0 }, downs: 99, stance: 'downed' as const,
      })),
      projectiles: [spawnProjectile(
        'stray', new Vector3(0, 2, -3), new Vector3(0, 0, 1), 1, 34, 0,
      )],
    }
    const step = stepEncounter(
      spent, { ...defaults, playerPosition: new Vector3(0, 0, 200) }, 1 / 60, C, deps,
    )
    expect(step.restoredThisFrame.length).toBe(1)
    // The arrows are discarded and the rock is not.
    expect(step.encounter.projectiles).toEqual([])
    expect(step.encounter.pillars.length).toBe(1)
  })
})

describe('earth against plate', () => {
  const SHIPPED = DEFAULT_COMBAT_CONFIG
  const PLATE = SHIPPED.enemies.heavy.armour
  /**
   * A heavy and a spear side by side, both inside the shipped stone's cone.
   *
   * At (±0.6, 0, −4) each is about 4 out and 8.5 degrees off the axis, against the shipped stone's
   * range of 12 and half-angle of 20 degrees. The spear is the positive control on every assertion
   * here, for the reason the water block's is.
   */
  const PAIR: EnemySpawn[] = [
    { id: 'plate', position: new Vector3(-0.6, 0, -4), kind: 'heavy' },
    { id: 'leather', position: new Vector3(0.6, 0, -4), kind: 'spear' },
  ]
  const find = (e: Encounter, id: string) => {
    const found = e.enemies.find((enemy) => enemy.id === id)
    if (!found) throw new Error(`no soldier named ${id}`)
    return found
  }
  const stoneThePair = (config = SHIPPED) => stepEncounter(
    startEncounter(PAIR, config),
    { ...defaults, element: 'earth', gustPressed: true }, 1 / 60, config, DEPS,
  )
  const underfoot: EnemySpawn[] = [
    { id: 'plate', position: new Vector3(0, 0, -SHIPPED.earth.raiseDistance), kind: 'heavy' },
    { id: 'leather', position: new Vector3(0.5, 0, -SHIPPED.earth.raiseDistance), kind: 'spear' },
  ]
  const raiseUnderThePair = (config = SHIPPED) => stepEncounter(
    startEncounter(underfoot, config),
    { ...defaults, element: 'earth', vortexReleased: true }, 1 / 60, config, DEPS,
  )

  it('writes the decision down in the shipped config', () => {
    // The two rows, pinned as values rather than left to the prose in `config.ts`. The stone row is
    // the one section 4.4's sentence stands on.
    expect(PLATE.stone).toEqual({ damage: 1, knockback: 0.6 })
    expect(PLATE.pillar).toEqual({ damage: 1, knockback: 0.5 })
    // Neither is a full deflect, which is what keeps both landing at all.
    expect(deflects(SHIPPED.enemies.heavy, 'stone')).toBe(false)
    expect(deflects(SHIPPED.enemies.heavy, 'pillar')).toBe(false)
  })

  it('hurts a heavy exactly as much as it hurts the spear beside it', () => {
    // The claim, as an equality rather than as two separate numbers: plate does *nothing* to a
    // thrown rock. The spear is what makes "the heavy took damage" mean "the heavy took the whole
    // blow" rather than "some damage got through".
    const step = stoneThePair()
    expect([...step.stoneHitThisFrame].sort()).toEqual(['leather', 'plate'])
    const plateLost = SHIPPED.enemies.heavy.maxHealth
      - find(step.encounter, 'plate').health.current
    const spearLost = SHIPPED.enemies.spear.maxHealth
      - find(step.encounter, 'leather').health.current
    expect(plateLost).toBeCloseTo(SHIPPED.earth.stoneDamage, 6)
    expect(plateLost).toBeCloseTo(spearLost, 6)
  })

  it('shoves a heavy less far than the spear beside it, but still shoves it', () => {
    // Both halves. A heavy shoved as far as a spear has no armour at all; a heavy not shoved at all
    // makes the stone's row a copy of the gust's, and displacement is the currency this type is built
    // to defend rather than one it is immune in.
    const step = stoneThePair()
    const plate = find(step.encounter, 'plate').knockback.length()
    const leather = find(step.encounter, 'leather').knockback.length()
    expect(plate).toBeGreaterThan(0)
    expect(plate).toBeLessThan(leather)
    expect(plate / leather).toBeCloseTo(PLATE.stone.knockback, 5)
  })

  it('takes four stones to put a heavy down its first rung', () => {
    // **The arithmetic that makes the design document's sentence true, measured through the fight
    // rather than computed off the config.** Each stone is thrown on its own frame with the cooldown
    // waited out, which is what a player actually does, and the loop is bounded well above the
    // expected count so a regression reports the wrong number rather than hanging.
    let encounter = startEncounter(PAIR, SHIPPED)
    let stones = 0
    let downed = false
    while (stones < 12 && !downed) {
      const step = stepEncounter(
        encounter, { ...defaults, element: 'earth', gustPressed: true }, 1 / 60, SHIPPED, DEPS,
      )
      encounter = step.encounter
      expect(step.stoneFired).toBe(true)
      stones++
      if (step.downedThisFrame.includes('plate')) downed = true
      // Wait out the cooldown, so the next press is not refused.
      for (let t = 0; t < SHIPPED.earth.stoneCooldownSeconds + 1 / 60 && !downed; t += 1 / 60) {
        const idle = stepEncounter(encounter, defaults, 1 / 60, SHIPPED, DEPS)
        encounter = idle.encounter
        if (idle.downedThisFrame.includes('plate')) downed = true
      }
    }
    expect(downed).toBe(true)
    expect(stones).toBe(4)
  })

  it('beats the staff by a margin that makes the choice obvious', () => {
    // The comparison "the only reliable armour-breaker" actually rests on, against the other tool the
    // player has in hand at melee range. A full three-swing combo is opener, opener, finisher,
    // through the staff's own armour row.
    const combo = (SHIPPED.staffArc.openerDamage * 2 + SHIPPED.staffArc.finisherDamage)
      * PLATE.staff.damage
    const swings = Math.ceil(SHIPPED.enemies.heavy.maxHealth / combo) * 3
    expect(swings).toBeGreaterThan(4 * 2)
    // And every one of those swings is thrown from inside the heavy's own 2-damage reach, where a
    // stone is not.
    expect(SHIPPED.staffArc.finisher.range).toBeLessThan(SHIPPED.enemies.heavy.strikeRange * 2)
    expect(SHIPPED.earth.stone.range).toBeGreaterThan(SHIPPED.enemies.heavy.strikeRange * 3)
  })

  it('reports a stone a kind turns away outright, instead of doing nothing quietly', () => {
    // The lever the widened table provides, at a config that ships nowhere — nothing in the game
    // deflects a stone, and `earth.test.ts` asserts that across every kind. This exists so blocking
    // the armour-breaker against some future kind is a config edit with working code behind it.
    const immune: CombatConfig = {
      ...SHIPPED,
      enemies: {
        ...SHIPPED.enemies,
        heavy: {
          ...SHIPPED.enemies.heavy,
          armour: { ...PLATE, stone: { damage: 0, knockback: 0 } },
        },
      },
    }
    const step = stoneThePair(immune)
    expect(step.deflectedThisFrame).toContain('plate')
    expect(step.stoneHitThisFrame).not.toContain('plate')
    expect(find(step.encounter, 'plate').health.current).toBe(SHIPPED.enemies.heavy.maxHealth)
    // The control: the spear beside it still takes the rock, so the deflect is the armour and not a
    // move that failed to come out.
    expect(step.stoneHitThisFrame).toContain('leather')
  })

  it('lifts a heavy less than the spear beside it, at the shipped rows', () => {
    const step = raiseUnderThePair()
    const plate = find(step.encounter, 'plate').verticalVelocity
    const leather = find(step.encounter, 'leather').verticalVelocity
    expect(plate).toBeGreaterThan(0)
    expect(plate).toBeLessThan(leather)
    // Compared against the arithmetic rather than as a ratio of the two returned values, and the
    // difference matters: `stepEnemy` subtracts a frame of gravity after the impulse lands, and it
    // subtracts the *same* frame from both, so the ratio of what comes back is not the armour
    // fraction. It reads 0.45 against a row of 0.5, which is the kind of near-miss that invites
    // someone to "fix" the config.
    const frame = SHIPPED.enemies.heavy.gravity / 60
    expect(plate).toBeCloseTo(SHIPPED.earth.raiseLiftSpeed * PLATE.pillar.knockback - frame, 6)
    expect(leather).toBeCloseTo(SHIPPED.earth.raiseLiftSpeed - frame, 6)
  })

  it('reports a pillar shove a kind turns away, and leaves that soldier on its feet', () => {
    const immune: CombatConfig = {
      ...SHIPPED,
      enemies: {
        ...SHIPPED.enemies,
        heavy: {
          ...SHIPPED.enemies.heavy,
          armour: { ...PLATE, pillar: { damage: 0, knockback: 0 } },
        },
      },
    }
    const step = raiseUnderThePair(immune)
    expect(step.deflectedThisFrame).toContain('plate')
    expect(find(step.encounter, 'plate').verticalVelocity).toBe(0)
    // The control beside it: the spear is lifted, so the deflect is the armour rather than a raise
    // that caught nobody. One frame of gravity lighter than the configured lift, per the note on the
    // test above.
    expect(find(step.encounter, 'leather').verticalVelocity)
      .toBeCloseTo(SHIPPED.earth.raiseLiftSpeed - SHIPPED.enemies.spear.gravity / 60, 6)
  })

  it('never kills, however many stones land', () => {
    // Section 4.6. Earth does real damage, which is its job, and damage moves a soldier down the
    // recovery ladder and never off it: a heavy past the end of its rungs is *downed*, still in the
    // world, at zero health rather than removed.
    let encounter = startEncounter(PAIR, SHIPPED)
    for (let i = 0; i < 30; i++) {
      encounter = stepEncounter(
        encounter, { ...defaults, element: 'earth', gustPressed: true }, 1 / 60, SHIPPED, DEPS,
      ).encounter
      for (let t = 0; t < SHIPPED.earth.stoneCooldownSeconds; t += 1 / 60) {
        encounter = stepEncounter(encounter, defaults, 1 / 60, SHIPPED, DEPS).encounter
      }
    }
    const plate = encounter.enemies.find((e) => e.id === 'plate')
    expect(plate).toBeDefined()
    expect(isDowned(plate!.health)).toBe(true)
    expect(plate!.health.current).toBe(0)
    expect(plate!.stance).toBe('downed')
  })
})

describe('the Fire Burst', () => {
  const F = C.fire
  const frame = (over: Partial<EncounterInput>, from = near()) =>
    stepEncounter(from, { ...defaults, ...over }, 1 / 60, C, DEPS)
  const burn = (over: Partial<EncounterInput> = {}, from = near()) =>
    frame({ element: 'fire', gustPressed: true, ...over }, from)

  it('spends exactly one charge and reports the bill rather than applying it', () => {
    // The fight has no resource of its own — it reports `chargesSpent` and `main.ts` deducts, the
    // same division of labour `focusSpent` and `breathSpent` already keep. One, never two, because
    // both fire verbs cost one and a burst that billed for two would empty a hand in a press and a
    // half with nothing in the config saying so.
    const step = burn()
    expect(step.chargesSpent).toBe(1)
    expect(step.burstFired).toBe(true)
    // And nothing else is billed: fire is outside the Focus and breath economies in both directions.
    expect(step.focusSpent).toBe(0)
    expect(step.breathSpent).toBe(0)
  })

  it('refuses with an empty hand, and charges nothing for the refusal', () => {
    // Both sides of the boundary, one charge apart, so a `>` where a `>=` belongs is caught. The
    // refusal is total: no charge, no cooldown, no damage, and nobody reported.
    const paid = burn({ fireCharges: 1 })
    expect(paid.burstFired).toBe(true)
    expect(paid.burstHitThisFrame).toEqual(['a'])

    const refused = burn({ fireCharges: 0 })
    expect(refused.burstFired).toBe(false)
    expect(refused.chargesSpent).toBe(0)
    expect(refused.burstHitThisFrame).toEqual([])
    expect(refused.encounter.fireBurstCooldown).toBe(0)
    expect(refused.encounter.enemies[0]?.health.current).toBe(C.enemies.spear.maxHealth)
  })

  it('refuses a second press inside the cooldown, with charges still in hand', () => {
    // The two gates are independent and this varies only the cooldown: the fixture's hand is full, so
    // a burst that fired here would be a cooldown that is not being read. The first press is the
    // positive control on the same arrangement.
    const first = burn()
    expect(first.burstFired).toBe(true)
    const second = burn({}, first.encounter)
    expect(second.burstFired).toBe(false)
    expect(second.chargesSpent).toBe(0)
    // The soldier took exactly one burst's worth of damage across the two presses.
    expect(second.encounter.enemies[0]?.health.current)
      .toBeCloseTo(C.enemies.spear.maxHealth - F.burstDamage, 5)
  })

  it('reports the fire even when it catches nobody, and still spends the charge', () => {
    // The effect and the voice fire on the attempt, the way the gust cone is drawn from the press. And
    // the charge goes anyway, which is the rule that makes aiming part of the move: three charges are
    // three presses, not three connects.
    const empty = startEncounter([], C)
    const step = burn({}, empty)
    expect(step.burstFired).toBe(true)
    expect(step.burstHitThisFrame).toEqual([])
    expect(step.chargesSpent).toBe(1)
  })

  it('does not burn a downed body, and does not report one as a connect', () => {
    // `isTargetable` is the gate, the same one every other resolver asks. Two assertions beyond the
    // report list, because the report list alone is filtered separately and survives the gate being
    // removed: the *damage* and the *shove* are what the gate actually protects, and a corpse being
    // shoved across the island is the failure the other resolvers all guard against.
    const body = downedSoldier(1)
    const step = burn({}, body)
    const after = step.encounter.enemies[0]!

    expect(step.burstHitThisFrame).toEqual([])
    expect(after.stance).toBe('downed')
    expect(after.health.current).toBe(0)
    expect(after.knockback.lengthSq()).toBe(0)

    // The positive control on the identical arrangement, differing only in the soldier being alive: a
    // live one is hurt and shoved, so the assertions above are about the body's state rather than
    // about the burst failing to reach it.
    const live = burn()
    expect(live.burstHitThisFrame).toEqual(['a'])
    expect(live.encounter.enemies[0]!.knockback.lengthSq()).toBeGreaterThan(0)
    expect(live.encounter.enemies[0]!.health.current).toBeLessThan(C.enemies.spear.maxHealth)
  })

  it('cannot be thrown while another element is selected', () => {
    // The mirror of the gust and grip gates. Paired with the fire run so this is about the element
    // rather than about the press edge being dropped.
    expect(frame({ element: 'air', gustPressed: true }).burstFired).toBe(false)
    expect(frame({ element: 'water', gustPressed: true }).burstFired).toBe(false)
    expect(frame({ element: 'air', gustPressed: true }).chargesSpent).toBe(0)
    expect(burn().burstFired).toBe(true)
  })

  it('puts a soldier down without removing it, and leaves nothing burning', () => {
    // Section 4.6, for the one element that does real damage. Two claims: the body stays in the world
    // as a downed soldier rather than disappearing, and there is no lingering damage afterwards — no
    // burning state, no damage over time. The second is measured over five seconds of doing nothing,
    // which is long enough for any per-second effect to show and short of the 18-second down timer.
    let encounter = burn({}, almostDown(0)).encounter
    expect(isDowned(encounter.enemies[0]!.health)).toBe(true)
    expect(encounter.enemies.length).toBe(1)
    expect(encounter.enemies[0]!.stance).toBe('downed')
    expect(encounter.enemies[0]!.downs).toBe(1)
    // No hold either: fire holds nobody, so a burst must not write the field water's kit owns.
    expect(encounter.enemies[0]!.heldSeconds).toBe(0)

    const atDown = encounter.enemies[0]!.health.current
    for (let i = 0; i < 300; i++) {
      encounter = stepEncounter(encounter, { ...defaults, element: 'fire' }, 1 / 60, C, DEPS)
        .encounter
    }
    expect(encounter.enemies[0]!.health.current).toBe(atDown)
    expect(encounter.enemies.length).toBe(1)
  })

  it('interrupts a wind-up, which every blow in this fight does', () => {
    // Not a fire-specific rule — `hitEnemy` interrupts whatever the damage — but the one property that
    // makes a damage move usable defensively, and it costs one assertion to pin that fire is inside
    // that contract rather than beside it.
    let encounter = near()
    for (let i = 0; i < 60; i++) {
      encounter = stepEncounter(encounter, defaults, 1 / 60, C, DEPS).encounter
      if (encounter.enemies[0]?.stance === 'wind-up') break
    }
    expect(encounter.enemies[0]?.stance).toBe('wind-up')
    expect(burn({}, encounter).encounter.enemies[0]?.stance).toBe('recover')
  })
})

describe('the heavy key under fire', () => {
  /**
   * Fire's heavy verb is the Fire Thrust, and it is resolved by the caller rather than by the fight.
   *
   * What these pin is the fight's half of that: a release under fire resolves *nothing* here, and in
   * particular it cannot leak into either of the other two elements' heavy moves. The thrust's own
   * rules are tested in `fire.test.ts`, where they live.
   */
  const release = (over: Partial<EncounterInput> = {}, from = near()) =>
    stepEncounter(from, {
      ...defaults, element: 'fire', vortexReleased: true, ...over,
    }, 1 / 60, C, DEPS)

  it('fires neither a vortex nor a freeze, and bills nothing', () => {
    const charged = { ...near(), vortexHeldSeconds: C.vortex.maxChargeSeconds }
    const step = release({}, charged)
    expect(step.vortexFired).toBeNull()
    expect(step.freezeFired).toBe(false)
    expect(step.frozenThisFrame).toEqual([])
    expect(step.focusSpent).toBe(0)
    expect(step.chargesSpent).toBe(0)
    // No lift and no hold, which are the observable signatures of the two moves that must not have
    // fired. The pair matters: `vortexFired` alone would stay null for a vortex that resolved but
    // forgot to report.
    expect(step.encounter.enemies[0]?.verticalVelocity).toBe(0)
    expect(step.encounter.enemies[0]?.stance).not.toBe('held')
  })

  it('discards a charge built under air rather than parking it', () => {
    // The same one-frame hole the water release was found to have: a charge standing when the element
    // changes must be spent by the release, or the player could switch back to air, tap R, and get the
    // vortex they had already let go of.
    const charged = { ...near(), vortexHeldSeconds: C.vortex.maxChargeSeconds }
    const released = release({}, charged).encounter
    expect(released.vortexHeldSeconds).toBe(0)
    const later = stepEncounter(released, {
      ...defaults, element: 'air', vortexReleased: true,
    }, 1 / 60, C, DEPS)
    expect(later.vortexFired).toBeNull()
  })

  it('banks no charge while fire is selected', () => {
    // Holding R under fire must accumulate nothing, or a player could charge under fire, switch to air
    // and release a full-strength vortex they never held air for. Paired with the air run, so "no
    // charge" is not passing because charging is broken outright.
    let underFire = near()
    let underAir = near()
    for (let i = 0; i < 60; i++) {
      underFire = stepEncounter(
        underFire, { ...defaults, element: 'fire', vortexHeld: true }, 1 / 60, C, DEPS,
      ).encounter
      underAir = stepEncounter(
        underAir, { ...defaults, element: 'air', vortexHeld: true }, 1 / 60, C, DEPS,
      ).encounter
    }
    expect(underFire.vortexHeldSeconds).toBe(0)
    expect(underAir.vortexHeldSeconds).toBeGreaterThan(0)
  })
})

/**
 * Fire against plate.
 *
 * The row that decides whether fire quietly becomes the armour-breaker section 4.4 promises to earth.
 * The shipped values are asserted against `DEFAULT_COMBAT_CONFIG` rather than this file's `C`, whose
 * heavy is deliberately unlike the real one on every row — the same rule the water block above
 * follows, and for the same reason: a claim about what the *game* does has to name the game's config.
 *
 * **Position is not used as evidence anywhere here.** Neither soldier is held, so both advance under
 * their own aggro, and a position assertion would be measuring the walk rather than the shove. The
 * knockback vector is what the armour row actually scales, so that is what is asserted.
 */
describe('fire against plate', () => {
  const SHIPPED = DEFAULT_COMBAT_CONFIG
  const HEAVY_ARMOUR = SHIPPED.enemies.heavy.armour
  /**
   * A heavy and a spear, each squarely inside the shipped burst's very narrow cone, thrown at
   * separately rather than together.
   *
   * The burst's whole design is that it cannot hold two soldiers at once — 30 degrees swept — so
   * unlike the water block's side-by-side pair this has to be two runs at two arrangements. The spear
   * is still the positive control on every assertion: "nothing happened to the heavy" passes for a
   * burst aimed at empty sky, a cone that caught nobody, an `element` that never reached the resolver
   * and a fight that threw nothing, and each of those shows up as the spear being untouched too.
   */
  const alone = (kind: 'heavy' | 'spear'): EnemySpawn[] =>
    [{ id: kind, position: new Vector3(0, 0, -4), kind }]
  const burnAt = (kind: 'heavy' | 'spear', config = SHIPPED) => stepEncounter(
    startEncounter(alone(kind), config),
    { ...defaults, element: 'fire', gustPressed: true, fireCharges: config.fire.maxCharges },
    1 / 60, config, DEPS,
  )

  it('writes the decision down in the shipped config', () => {
    // Pinned as values rather than left to the prose in `config.ts`: half the damage, none of the
    // shove. And not a full deflect, which is what keeps the move landing at all — 0 and 0 would make
    // `deflects` true and skip the burst whole, which reads as "fire does not work on plate".
    expect(HEAVY_ARMOUR.burst).toEqual({ damage: 0.5, knockback: 0 })
    expect(deflects(SHIPPED.enemies.heavy, 'burst')).toBe(false)
  })

  it('hurts a heavy for half, where the spear beside it takes all of it', () => {
    const plate = burnAt('heavy')
    const leather = burnAt('spear')
    const hurt = (step: typeof plate, kind: 'heavy' | 'spear') => {
      const found = step.encounter.enemies.find((e) => e.id === kind)!
      return SHIPPED.enemies[kind].maxHealth - found.health.current
    }
    expect(plate.burstHitThisFrame).toEqual(['heavy'])
    expect(leather.burstHitThisFrame).toEqual(['spear'])
    expect(hurt(leather, 'spear')).toBeCloseTo(SHIPPED.fire.burstDamage, 5)
    expect(hurt(plate, 'heavy'))
      .toBeCloseTo(SHIPPED.fire.burstDamage * HEAVY_ARMOUR.burst.damage, 5)
    expect(hurt(plate, 'heavy')).toBeLessThan(hurt(leather, 'spear'))
  })

  it('does not move a heavy at all, and does move the spear', () => {
    // The knockback row, and the knockback vector rather than the position: an unheld soldier walks
    // under its own aggro, so position would be measuring the advance. This type is displaced by
    // nothing except an earned Pressure Wave, which is what "knockback economy" means.
    const plate = burnAt('heavy').encounter.enemies[0]!
    const leather = burnAt('spear').encounter.enemies[0]!
    expect(plate.knockback.lengthSq()).toBe(0)
    expect(leather.knockback.lengthSq()).toBeGreaterThan(0)
  })

  it('takes a whole hand of charges without finishing a rung', () => {
    // Why this row does not make fire the answer to plate, measured through the fight rather than off
    // the config. Every charge the player holds, spent on one heavy with the cooldown waited out, and
    // it is still standing well above its first rung — where two committed dives would have taken it
    // down. The charges run out first, every time, which is the shape that makes fire the wrong tool
    // rather than a slow one.
    let encounter = startEncounter(alone('heavy'), SHIPPED)
    let charges = SHIPPED.fire.maxCharges
    let spent = 0
    for (let frame = 0; frame < 600 && charges > 0; frame++) {
      const step = stepEncounter(
        encounter,
        { ...defaults, element: 'fire', gustPressed: true, fireCharges: charges },
        1 / 60, SHIPPED, DEPS,
      )
      encounter = step.encounter
      charges -= step.chargesSpent
      spent += step.chargesSpent
    }
    expect(spent).toBe(SHIPPED.fire.maxCharges)
    const heavy = encounter.enemies[0]!
    expect(isDowned(heavy.health)).toBe(false)
    expect(heavy.health.current).toBeGreaterThan(SHIPPED.enemies.heavy.maxHealth * 0.5)
    // An explicit timeout because this runs the real config's soldier for up to 600 frames, and the
    // default per-test budget is 5 s. Measured at a few milliseconds.
  }, 20_000)
})

/**
 * The chain and the reactions, wired into the fight.
 *
 * Both systems are unit-tested in `chain.test.ts` and `reactions.test.ts`; this block is only
 * ever about the wiring — that the fight advances the string off a landing rather than a press,
 * that a mark is written in the element that landed, and that a reaction is looked up against the
 * mark the soldier was already carrying rather than the one the same blow leaves behind.
 *
 * Built on this file's existing fixtures throughout: `near()`, `defaults`, `DEPS` and `C`. The
 * helpers below are one-frame presses over `stepEncounter`, the same shape `gustOnce` already has.
 */
describe('the chain in the fight', () => {
  const empty = () => startEncounter([], C)
  const loneHeavy = () =>
    startEncounter([{ id: 'plate', position: new Vector3(0, 0, -2), kind: 'heavy' }], C)

  /** One frame of the fight with one thing pressed. `gustOnce` for an arbitrary input. */
  const press = (over: Partial<EncounterInput>) => (from: Encounter) =>
    stepEncounter(from, { ...defaults, ...over }, 1 / 60, C, DEPS)

  const gustAt = press({ gustPressed: true, element: 'air' })
  const gripAt = press({ gustPressed: true, element: 'water' })
  const burstAt = press({ gustPressed: true, element: 'fire' })
  const staffAt = press({ staffSwing: { index: 0, finisher: false } })
  const idle = press({})

  /**
   * A three-link string ending in a gust, in two frames.
   *
   * The first frame lands a staff swing and then a Pressure Wave — both resolve in one frame, and
   * the staff resolves first, which is the order `stepEncounter` documents. Neither is an element
   * whose mark can react with air, so the gust on the second frame is the third landing and
   * nothing else. A weakest-possible slam (`strength: 0`) so the wave's own damage cannot down
   * the soldier the gust still has to connect with.
   */
  const staffThenSlam = press({
    staffSwing: { index: 0, finisher: false }, slam: { strength: 0 },
  })
  const threeLinkStringEndingInGust = (from: Encounter) => gustAt(staffThenSlam(from).encounter)

  const soldier = (e: Encounter, id: string) => {
    const found = e.enemies.find((enemy) => enemy.id === id)
    if (!found) throw new Error(`no soldier named ${id}`)
    return found
  }
  const spearIn = (e: Encounter) => soldier(e, 'a')

  it('starts a fresh fight with no string standing', () => {
    expect(near().chain.links).toBe(0)
  })

  it('advances on a blow that connects', () => {
    expect(gustAt(near()).encounter.chain.links).toBe(1)
  })

  it('advances on a staff swing, because a landed blow is a landed blow', () => {
    // The staff has no element and writes no mark (below), and it still builds the string:
    // §4.2 keeps the weapon separate from bending, not separate from sequencing.
    expect(staffAt(near()).encounter.chain.links).toBe(1)
  })

  it('does not advance on a blow that connects with nobody', () => {
    expect(gustAt(empty()).encounter.chain.links).toBe(0)
  })

  it('does not advance on a blow the armour turns away entirely', () => {
    // A deflected gust on a heavy is not pressure applied. It is the armour working.
    const step = gustAt(loneHeavy())
    expect(step.encounter.chain.links).toBe(0)
    // Not vacuous: the gust did reach the soldier and was turned away, rather than missing.
    expect(step.deflectedThisFrame).toEqual(['plate'])
  })

  it('does not advance on a blow the geometry missed', () => {
    // The negative control on "a landing, not a press": the cooldown is spent either way.
    const step = press({ gustPressed: true, playerForward: new Vector3(0, 0, 1) })(near())
    expect(step.encounter.chain.links).toBe(0)
    expect(step.encounter.gustCooldown).toBe(C.gust.cooldownSeconds)
  })

  it('survives an element switch, which is the whole point', () => {
    let e = near()
    e = gustAt(e).encounter // air
    e = gripAt(e).encounter // water, no reset
    expect(e.chain.links).toBe(2)
  })

  it('lets the window lapse whatever element is in hand', () => {
    // The string is aged at the top of the step beside the five cooldowns and for the identical
    // reason: a window that only ran while the element it started under was in hand would let a
    // player park a two-link string by switching away.
    let e = gustAt(near()).encounter
    expect(e.chain.links).toBe(1)
    for (let t = 0; t <= C.chain.windowSeconds + 0.1; t += 1 / 60) {
      e = press({ element: 'water' })(e).encounter
    }
    expect(e.chain.links).toBe(0)
  })

  it('shortens no cooldown, however long the string', () => {
    // The invariant `encounter.ts`'s independent cooldowns exist to protect. Stated as a test
    // rather than a comment so a future contributor cannot pay the finisher out of the cooldown
    // budget. Three landings on three consecutive frames, one per light-verb element, so the
    // third is the finisher and all three cooldowns are running when it lands.
    const first = gustAt(near())
    const second = gripAt(first.encounter)
    const third = burstAt(second.encounter)
    expect(third.encounter.chain.links).toBe(C.chain.maxLinks)
    expect(third.finisherThisFrame).toBe(true)

    // Each set to exactly its own config value on the frame it fired, and never less.
    expect(first.encounter.gustCooldown).toBe(C.gust.cooldownSeconds)
    expect(second.encounter.waterGripCooldown).toBe(C.water.gripCooldownSeconds)
    expect(third.encounter.fireBurstCooldown).toBe(C.fire.burstCooldownSeconds)
    // And the finisher refunded nothing that was already running: each of the two older
    // cooldowns is down by exactly the frames elapsed since it was set.
    expect(third.encounter.gustCooldown).toBeCloseTo(C.gust.cooldownSeconds - 2 / 60, 10)
    expect(third.encounter.waterGripCooldown)
      .toBeCloseTo(C.water.gripCooldownSeconds - 1 / 60, 10)
  })

  describe('the finisher against plate', () => {
    /**
     * A heavy and a spear, close enough together for one staff swing, one slam and one gust to
     * catch both.
     *
     * The spear is what makes the finisher reachable at all, and that is the mechanic rather
     * than a fixture convenience: the heavy deflects a gust, a deflected blow advances no
     * string, so the third landing has to come from a soldier the gust can actually touch.
     * Standing at 2.24 units they are inside the staff opener's 3.6 reach, the weakest slam's
     * 4-unit radius and the gust's 12.
     */
    const pair = () => startEncounter([
      { id: 'plate', position: new Vector3(-1, 0, -2), kind: 'heavy' },
      { id: 'leather', position: new Vector3(1, 0, -2), kind: 'spear' },
    ], C)

    it('moves a heavy with a finisher, which no gust can do alone', () => {
      // `armour.gust` is { damage: 0, knockback: 0 }, so a plain gust is deflected and skipped.
      // At the last link the knockback lands unarmoured — §4.4 gives the heavy knockback economy
      // to pressure, and this is the third answer to it, earned by sequencing.
      //
      // Measured as the *difference* against the same frame with nothing pressed, not as
      // `knockback.length() > 0`. The two frames that build the string land a staff swing and a
      // slam, both of which the plate's armour lets partly through, so the soldier is already
      // sliding when the gust arrives and a bare "was it pushed" would pass for a gust that was
      // skipped exactly as before.
      const built = staffThenSlam(pair()).encounter
      const step = gustAt(built)
      const unpressed = press({})(built)
      expect(step.encounter.chain.links).toBe(C.chain.maxLinks)
      expect(step.finisherThisFrame).toBe(true)
      const pushed = soldier(step.encounter, 'plate')
      const sliding = soldier(unpressed.encounter, 'plate')
      // Half the gust's own knockback as the floor rather than all of it: one frame of damping
      // has already run by the time either is read.
      expect(pushed.knockback.length() - sliding.knockback.length())
        .toBeGreaterThan(C.gust.knockback / 2)
      // The lift too, which is a second, independent channel — `hitEnemy` writes it to its own
      // field, so a knockback that arrived without it would mean the impulse was scaled.
      expect(pushed.verticalVelocity).toBeGreaterThan(sliding.verticalVelocity)
    })

    it('still takes no health off the heavy, because the finisher is displacement', () => {
      // Zero damage through its armour, the full impulse around it. A finisher that also did
      // damage would make the chain the answer to plate's health pool, which is the environment
      // route's job.
      const step = threeLinkStringEndingInGust(pair())
      const before = soldier(staffThenSlam(pair()).encounter, 'plate')
      expect(soldier(step.encounter, 'plate').health.current)
        .toBeCloseTo(before.health.current, 10)
    })

    it('reports the heavy as connected rather than deflected on the finishing frame', () => {
      const step = threeLinkStringEndingInGust(pair())
      expect(step.deflectedThisFrame).toEqual([])
      expect(step.hitThisFrame.sort()).toEqual(['leather', 'plate'])
    })

    it('leaves a plain gust deflected and unmoved, which is the control', () => {
      // Without this the assertions above would pass just as well for a gust that had stopped
      // consulting the armour table at all.
      const step = gustAt(pair())
      expect(step.deflectedThisFrame).toEqual(['plate'])
      expect(soldier(step.encounter, 'plate').knockback.length()).toBe(0)
    })

    it('applies the finishing blow exactly once', () => {
      // The property the two-pass shape this task considered would have put at risk. Measured on
      // a lone heavy with a Stone Throw, because the stone's damage row is 0.5 rather than 0 and
      // the soldier is well clear of the health pool's clamp at zero — so one application and two
      // are 0.5 apart rather than indistinguishable.
      const lone = () =>
        startEncounter([{ id: 'plate', position: new Vector3(0, 0, -2), kind: 'heavy' }], C)
      const built = staffThenSlam(lone()).encounter
      const before = soldier(built, 'plate').health.current
      const step = press({ gustPressed: true, element: 'earth' })(built)
      expect(step.finisherThisFrame).toBe(true)
      expect(step.stoneHitThisFrame).toEqual(['plate'])
      expect(before - soldier(step.encounter, 'plate').health.current)
        .toBeCloseTo(C.earth.stoneDamage * C.enemies.heavy.armour.stone.damage, 10)
    })

    it('shortens no cooldown to reach the heavy', () => {
      const step = threeLinkStringEndingInGust(pair())
      expect(step.encounter.gustCooldown).toBe(C.gust.cooldownSeconds)
    })
  })

  it('reports the finisher for the frame it landed on', () => {
    expect(threeLinkStringEndingInGust(near()).finisherThisFrame).toBe(true)
    expect(gustAt(near()).finisherThisFrame).toBe(false)
    expect(idle(near()).finisherThisFrame).toBe(false)
  })

  it('reports no reactions on a frame that fired none', () => {
    expect(gustAt(near()).reactionsThisFrame).toEqual([])
    expect(idle(near()).reactionsThisFrame).toEqual([])
  })

  it('leaves the soldier it marked findable, so the fixtures above are not lying', () => {
    // Guards the two helpers this whole block leans on: `near()`'s soldier is 'a', and one press
    // does not remove it from the array.
    expect(spearIn(gustAt(near()).encounter).id).toBe('a')
  })
})

describe('reactions in the fight', () => {
  const loneHeavy = () =>
    startEncounter([{ id: 'plate', position: new Vector3(0, 0, -2), kind: 'heavy' }], C)
  const press = (over: Partial<EncounterInput>) => (from: Encounter) =>
    stepEncounter(from, { ...defaults, ...over }, 1 / 60, C, DEPS)

  const gustAt = press({ gustPressed: true, element: 'air' })
  const gripAt = press({ gustPressed: true, element: 'water' })
  const burstAt = press({ gustPressed: true, element: 'fire' })
  const stoneAt = press({ gustPressed: true, element: 'earth' })
  const staffAt = press({ staffSwing: { index: 0, finisher: false } })
  const freezeAt = press({ vortexReleased: true, element: 'water' })
  const raiseAt = press({ vortexReleased: true, element: 'earth' })
  /** A burst thrown at the opposite bearing: it fires, spends its charge, and reaches nobody. */
  const burstAtNothing = press({
    gustPressed: true, element: 'fire', playerForward: new Vector3(0, 0, 1),
  })

  const soldier = (e: Encounter, id: string) => {
    const found = e.enemies.find((enemy) => enemy.id === id)
    if (!found) throw new Error(`no soldier named ${id}`)
    return found
  }
  const spearIn = (e: Encounter) => soldier(e, 'a')

  /** `near()`'s soldier, already carrying a mark, so a pairing can be set up in one frame. */
  const carrying = (element: Element, from = near()): Encounter => ({
    ...from,
    enemies: from.enemies.map((enemy) => markEnemy(enemy, element, C.reactions.markSeconds)),
  })

  it('marks a soldier with the element that landed', () => {
    expect(spearIn(gustAt(near()).encounter).mark?.element).toBe('air')
    expect(spearIn(burstAt(near()).encounter).mark?.element).toBe('fire')
    expect(spearIn(stoneAt(near()).encounter).mark?.element).toBe('earth')
  })

  it('marks a soldier from water\'s two verbs, which are not blows', () => {
    // Both leave a soldier *wet*: `reactions.ts` says a reaction that fired for the grip but not
    // the freeze would be a distinction no player could see, and neither move goes through
    // `resolveBlow`, so this is the wiring that claim depends on.
    expect(spearIn(gripAt(near()).encounter).mark?.element).toBe('water')
    expect(spearIn(freezeAt(near()).encounter).mark?.element).toBe('water')
  })

  it('writes no mark for a staff blow', () => {
    expect(spearIn(staffAt(near()).encounter).mark).toBeNull()
  })

  it('writes no mark on a soldier the blow never reached', () => {
    expect(spearIn(burstAtNothing(near()).encounter).mark).toBeNull()
    expect(burstAtNothing(near()).burstFired).toBe(true)
  })

  it('fires steam when fire lands on a wet soldier', () => {
    // Two frames of the real fight rather than a hand-written mark: this is the wiring test, and
    // the grip is where a wet soldier actually comes from.
    const step = burstAt(gripAt(near()).encounter)
    expect(step.reactionsThisFrame).toEqual([{ enemyId: 'a', kind: 'steam' }])
  })

  it('puts a spear down with a steam it would have survived unlit', () => {
    // What Steam is worth, and why the test above cannot also assert the new mark: 0.6 of burst
    // against 1.5 of health leaves the soldier standing, and the extra 1.0 does not.
    expect(isDowned(spearIn(burstAt(gripAt(near()).encounter).encounter).health)).toBe(true)
    expect(isDowned(spearIn(burstAt(near()).encounter).health)).toBe(false)
  })

  it('writes no mark on a soldier its own blow put down', () => {
    // `markEnemy` refuses a downed body, and the wiring inherits that rather than working around
    // it: a mark on a soldier that cannot act is a reaction promised to a fight that is over.
    expect(spearIn(burstAt(gripAt(near()).encounter).encounter).mark).toBeNull()
  })

  it('consumes the old mark and leaves its own in place of it', () => {
    // On the heavy, because it is the soldier in this fixture that survives being steamed.
    const step = burstAt(carrying('water', loneHeavy()))
    expect(step.reactionsThisFrame).toEqual([{ enemyId: 'plate', kind: 'steam' }])
    expect(soldier(step.encounter, 'plate').mark?.element).toBe('fire')
  })

  it('reads the old mark, not the one the same blow writes', () => {
    // The ordering that makes cross-element reactions possible at all, isolated from the two
    // frames the test above needs. If the mark were written before the lookup, this pairing
    // would resolve fire against fire and `reactionFor` would return the diagonal's 'none'.
    expect(burstAt(carrying('water')).reactionsThisFrame)
      .toEqual([{ enemyId: 'a', kind: 'steam' }])
  })

  it('pays nothing for repetition, which is the chain\'s business', () => {
    // The diagonal. Without this the test above would pass for an implementation that fired a
    // reaction for every mark it found.
    expect(burstAt(carrying('fire')).reactionsThisFrame).toEqual([])
    expect(gustAt(carrying('air')).reactionsThisFrame).toEqual([])
  })

  it('does not fire on a soldier the blow never reached', () => {
    expect(burstAtNothing(carrying('water')).reactionsThisFrame).toEqual([])
  })

  it('does not fire on a soldier the armour turned the blow away from', () => {
    // The deflect gate sits in front of the reaction, the way it sits in front of `hitEnemy`: a
    // blow the plate stopped is not a blow that arrived, so it cannot ignite anything either.
    const wet = {
      ...loneHeavy(),
      enemies: loneHeavy().enemies.map((e) => markEnemy(e, 'water', C.reactions.markSeconds)),
    }
    expect(gustAt(wet).reactionsThisFrame).toEqual([])
  })

  it('skips the armour the blow itself went through, which is what a reaction is', () => {
    // Steam does not go through `throughArmour`, and the heavy's `burst` row is the thing it is
    // bypassing. Measured as the whole health lost minus the armoured burst's own share.
    const step = burstAt(carrying('water', loneHeavy()))
    const lost = C.enemies.heavy.maxHealth - soldier(step.encounter, 'plate').health.current
    const armoured = C.fire.burstDamage * C.enemies.heavy.armour.burst.damage
    expect(step.reactionsThisFrame).toEqual([{ enemyId: 'plate', kind: 'steam' }])
    expect(lost - armoured).toBeCloseTo(C.reactions.steamDamage, 6)
  })

  it('muds a wet soldier that earth then lands on', () => {
    const step = stoneAt(gripAt(near()).encounter)
    expect(step.reactionsThisFrame).toEqual([{ enemyId: 'a', kind: 'mud' }])
    // Held longer than the grip alone bought, and never past the ceiling.
    const held = spearIn(step.encounter).heldSeconds
    expect(held).toBeGreaterThan(C.water.gripHoldSeconds)
    expect(held).toBeLessThanOrEqual(C.reactions.holdCeilingSeconds)
    // And still held, rather than knocked out of the hold by the stone that muddied it.
    expect(spearIn(step.encounter).stance).toBe('held')
  })

  it('muds from a pillar shove, which is not a blow either', () => {
    // Earth's other verb, hand-rolled like water's two, and the last of the nine sources.
    const at = new Vector3(0, 0, -C.earth.raiseDistance)
    const wet = startEncounter([{ id: 'a', position: at, kind: 'spear' }], C)
    const step = raiseAt(carrying('water', wet))
    expect(step.pillarRaised).not.toBeNull()
    expect(step.reactionsThisFrame).toEqual([{ enemyId: 'a', kind: 'mud' }])
    expect(spearIn(step.encounter).mark?.element).toBe('earth')
  })

  it('reports one entry per soldier a burst steamed, in enemy order', () => {
    // A list rather than a single reaction, because one burst can steam several wet soldiers at
    // once — this fixture's 45-degree cone holds two, which the shipped 15 degrees cannot.
    const two = startEncounter([
      { id: 'left', position: new Vector3(-1, 0, -3), kind: 'spear' },
      { id: 'right', position: new Vector3(1, 0, -3), kind: 'spear' },
    ], C)
    const wet = {
      ...two,
      enemies: two.enemies.map((e) => markEnemy(e, 'water', C.reactions.markSeconds)),
    }
    expect(burstAt(wet).reactionsThisFrame).toEqual([
      { enemyId: 'left', kind: 'steam' },
      { enemyId: 'right', kind: 'steam' },
    ])
  })

  it('lets a mark lapse, so a reaction is a window rather than a flag', () => {
    let e = gripAt(near()).encounter
    for (let t = 0; t <= C.reactions.markSeconds + 0.1; t += 1 / 60) {
      e = press({})(e).encounter
    }
    expect(spearIn(e).mark).toBeNull()
  })
})
