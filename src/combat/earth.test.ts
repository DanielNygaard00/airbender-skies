import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  addPillar, anyLiveStoneThrowTarget, blockingPillar, canRaisePillar, canStoneThrow, inStoneThrow,
  liveStoneThrowTargets, pillarBlocks, pillarShoveImpulse, pillarShoveTargets, pillarSite,
  spawnPillar, stepPillars, stoneImpulse, stoneShape, stoneThrowTargets, type Pillar,
} from './earth'
import { hitEnemy, spawnEnemy, type Enemy } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'
import { DEFAULT_FOCUS_CONFIG, DEFAULT_AVATAR_STATE_CONFIG } from '../focus/config'
import { DEFAULT_SLIPSTREAM_CONFIG } from '../core/config'

const R = DEFAULT_COMBAT_CONFIG.earth
const W = DEFAULT_COMBAT_CONFIG.water
const SPEAR = DEFAULT_COMBAT_CONFIG.enemies.spear
const HEAVY = DEFAULT_COMBAT_CONFIG.enemies.heavy
const ORIGIN = new Vector3(0, 0, 0)
/** Forward is +Z in this project, but the existing combat fixtures aim along −Z; either works. */
const NORTH = new Vector3(0, 0, -1)

const at = (x: number, z: number, y = 0) => new Vector3(x, y, z)
const enemyAt = (id: string, x: number, z: number, y = 0) =>
  spawnEnemy(id, at(x, z, y), 'spear', SPEAR)
/** A soldier taken to zero, which is what `isTargetable` refuses. */
const downed = (enemy: Enemy): Enemy => hitEnemy(enemy, enemy.health.max, new Vector3())
/** Flat ground at y, so `pillarSite` has somewhere to found a pillar. */
const groundAt = (y: number) => ({ groundHeightAt: () => y })
/** No ground at all: the void between islands. */
const noGround = { groundHeightAt: () => null }

const pillarAt = (id: string, x: number, z: number, y = 0) => spawnPillar(id, at(x, z, y), R)

describe('the stone throw is the narrowest reach in the game', () => {
  it('is narrower than every other aimed cone', () => {
    // The trade for being the light verb that does real damage. A rock is one object thrown at one
    // body, and an earth cone as wide as a gust would be a gust that also broke armour — the shape
    // `water.ts` warns about when it explains why the grip has no damage parameter.
    expect(R.stone.halfAngle).toBeLessThan(W.grip.halfAngle)
    expect(R.stone.halfAngle).toBeLessThan(W.freeze.halfAngle)
    expect(R.stone.halfAngle).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.halfAngle)
    expect(R.stone.halfAngle).toBeLessThan(DEFAULT_COMBAT_CONFIG.staffArc.opener.halfAngle)
    expect(R.stone.halfAngle).toBeLessThan(DEFAULT_COMBAT_CONFIG.airWall.halfAngle)
  })

  it('reaches exactly as far as a gust, so no light verb out-ranges another', () => {
    // Equal rather than merely comparable, and asserted against the gust's own field rather than
    // against 12: what differs between the three light verbs is width, price and payload, never
    // reach, and a retune that gave earth the longest reach as well as the biggest hit would make
    // it strictly better than a gust at range.
    expect(R.stone.range).toBe(DEFAULT_COMBAT_CONFIG.gust.range)
    // And the same as a full-charge Vortex, which is the other move that claims this distance.
    expect(R.stone.range).toBe(DEFAULT_COMBAT_CONFIG.vortex.maxRadius)
  })

  it('reaches far enough to break a heavy from outside its swing', () => {
    // The whole point of the move as section 4.4 frames it: earth answers the armoured soldier, and
    // an answer that required standing inside a 2-damage swing would not be one. Measured against
    // the longest melee reach in the game rather than against a number.
    const longestMelee = Math.max(SPEAR.strikeRange, HEAVY.strikeRange)
    expect(R.stone.range).toBeGreaterThan(longestMelee * 3)
    // The positive control the range claim needs: a heavy standing at the far end of the reach is
    // genuinely caught, so the comparison above is about a cone that actually bites.
    const heavy = spawnEnemy('h', at(0, -(R.stone.range - 0.5)), 'heavy', HEAVY)
    expect(inStoneThrow(ORIGIN, NORTH, heavy.position, R)).toBe(true)
    expect(heavy.position.distanceTo(ORIGIN)).toBeGreaterThan(HEAVY.strikeRange)
  })
})

describe('the two vertical extents', () => {
  it('gives the stone the middle band, above water and below the gust', () => {
    // The argued position rather than the number. Above water's, because a thrown mass is not a
    // rope held at arm's length; below the gust's, because a gust is a slab of air filling a volume
    // and this is one rock.
    expect(R.stoneVerticalReach).toBeGreaterThan(W.verticalReach)
    expect(R.stoneVerticalReach).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.staffArc.opener.verticalReach)
    expect(R.stoneVerticalReach).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.verticalReach)
    expect(R.stoneVerticalReach).toBeLessThan(DEFAULT_COMBAT_CONFIG.vortex.verticalReach)
  })

  it('is a separate number from the raise limit, because they measure different things', () => {
    // Water uses one band for its whole kit and argues for it; earth deliberately does not. One of
    // these bounds where a *target* may be and the other bounds where the *ground* may be, so a
    // shared number would be a coincidence dressed as a rule. Asserted as "they are allowed to
    // differ" by exercising both independently below rather than by comparing them to each other —
    // this test pins that the config exposes two fields at all, which is the thing a well-meaning
    // tidy-up would collapse.
    expect(R.stoneVerticalReach).not.toBe(R.raiseVerticalReach)
  })

  it('cannot throw a stone at a soldier that could not shoot back', () => {
    // The same exploit water's band closes, and it matters more here because this move does damage:
    // hovering above a patrol and shelling it would be a fight won with no counterplay. Hovering
    // one metre past the band puts the soldier out of reach while the archer's 3D strikeRange still
    // covers the hover.
    const hover = at(0, -2, R.stoneVerticalReach + 1)
    const soldier = enemyAt('spear', 0, -2)
    expect(inStoneThrow(hover, NORTH, soldier.position, R)).toBe(false)
    // The positive control: from ground level the very same soldier is caught, so the negative is
    // about height rather than about the fixture being aimed wrongly.
    expect(inStoneThrow(ORIGIN, NORTH, soldier.position, R)).toBe(true)
    expect(hover.distanceTo(soldier.position))
      .toBeLessThan(DEFAULT_COMBAT_CONFIG.enemies.archer.strikeRange)
  })

  it('catches a target exactly at the band edge and not a hair past it', () => {
    const edge = enemyAt('edge', 0, -2, R.stoneVerticalReach)
    const past = enemyAt('past', 0, -2, R.stoneVerticalReach + 0.01)
    expect(stoneThrowTargets(ORIGIN, NORTH, [edge, past], R).map((e) => e.id)).toEqual(['edge'])
  })

  it('builds the cone from the config rather than restating it', () => {
    const shape = stoneShape(R)
    expect(shape.range).toBe(R.stone.range)
    expect(shape.halfAngle).toBe(R.stone.halfAngle)
    expect(shape.verticalReach).toBe(R.stoneVerticalReach)
  })
})

describe('target queries', () => {
  it('filters by geometry only, leaving the live check to the fight', () => {
    // The rule every target query in this directory follows: `stepEncounter` applies `isTargetable`
    // itself, so a body in the cone is still *caught* and merely not hit. A query that filtered
    // here would make "connected" and "in range" the same question in one place and different in
    // another.
    const body = downed(enemyAt('body', 0, -3))
    const live = enemyAt('live', 1, -3)
    expect(stoneThrowTargets(ORIGIN, NORTH, [body, live], R).map((e) => e.id).sort())
      .toEqual(['body', 'live'])
    // And the live-only form does filter, which is what the aim preview needs: a reticle warming
    // for a corpse promises something the move cannot deliver.
    expect(liveStoneThrowTargets(ORIGIN, NORTH, [body, live], R).map((e) => e.id))
      .toEqual(['live'])
  })

  it('agrees with the list form across a sweep of arrangements', () => {
    // `anyLiveStoneThrowTarget` is the cheap per-frame form and duplicates the rule. Held to the
    // list rather than restating it, the way `gust.test.ts` holds `anyLiveGustTarget`, across
    // positions that land inside the cone, outside its angle, past its range and above its band.
    //
    // **The body is parked permanently inside the cone rather than mirrored across it, and mutation
    // is why.** The first version of this sweep put the live soldier at `(x, z)` and the body at
    // `(-x, z)`, which cannot catch a predicate that forgot `isTargetable`: the cone is symmetric
    // about its axis, so the body was inside it exactly when the live soldier was, and the two forms
    // agreed however wrong either was. Removing `isTargetable` from the predicate left this test
    // green. With the body always in reach, every arrangement where the live soldier is out of reach
    // is now a case where a predicate that counted bodies would answer true against an empty list.
    const body = downed(enemyAt('body', 0, -3))
    expect(stoneThrowTargets(ORIGIN, NORTH, [body], R).length).toBe(1)
    let inside = 0
    let outside = 0
    for (let x = -6; x <= 6; x += 2) {
      for (let z = -14; z <= 2; z += 2) {
        for (const y of [0, R.stoneVerticalReach + 1]) {
          const enemies = [enemyAt('a', x, z, y), body]
          const list = liveStoneThrowTargets(ORIGIN, NORTH, enemies, R).length > 0
          expect(anyLiveStoneThrowTarget(ORIGIN, NORTH, enemies, R), `(${x}, ${z}, ${y})`)
            .toBe(list)
          if (list) inside++
          else outside++
        }
      }
    }
    // Neither count may be zero, or the sweep agreed by finding nothing anywhere.
    expect(inside).toBeGreaterThan(0)
    expect(outside).toBeGreaterThan(0)
  })
})

describe('the stone throw shoves outward', () => {
  it('pushes away from the thrower, flat, at the configured speed', () => {
    // Outward is the deliberate contrast with the grip's inward pull, and it puts earth on the same
    // side of the visual and audio vocabulary as the gust.
    const impulse = stoneImpulse(ORIGIN, at(0, -4), R)
    expect(impulse.z).toBeCloseTo(-R.stoneKnockback, 10)
    expect(impulse.x).toBeCloseTo(0, 10)
    // No vertical component at all: lifting is the Vortex's job, and an airborne enemy is inert,
    // which would soften the one move that is supposed to hurt.
    expect(impulse.y).toBe(0)
  })

  it('shoves less far than a gust, so displacement stays the air kit\'s currency', () => {
    expect(R.stoneKnockback).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.knockback)
    expect(R.stoneKnockback).toBeLessThan(DEFAULT_COMBAT_CONFIG.staffArc.finisherKnockback)
    // And above the staff opener's, because a rock has mass.
    expect(R.stoneKnockback).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.staffArc.openerKnockback)
  })

  it('cannot walk a soldier as far toward a rim as a gust can', () => {
    // The reason the knockback is small, expressed as the distance it actually travels rather than
    // as a comparison of two config numbers. Environmental removals pay less Focus by design, and a
    // cheap repeatable move that produced them would make the stingy line the easy one.
    const stoneTravel = R.stoneKnockback / SPEAR.knockbackDamping
    const gustTravel = DEFAULT_COMBAT_CONFIG.gust.knockback / SPEAR.knockbackDamping
    expect(stoneTravel).toBeLessThan(gustTravel / 2)
  })

  it('gives no push at all to a target standing on the thrower', () => {
    // Zero rather than a fabricated heading, for the reason `horizontalTo` in `enemy.ts` reports an
    // absence: a made-up direction is indistinguishable from a real one downstream.
    expect(stoneImpulse(ORIGIN, ORIGIN.clone(), R).toArray()).toEqual([0, 0, 0]);
    // A purely vertical separation has no horizontal heading either.
    expect(stoneImpulse(ORIGIN, at(0, 0, 5), R).toArray()).toEqual([0, 0, 0])
  })
})

describe('what a stone costs, and what it buys', () => {
  it('is the slowest light verb by a wide margin', () => {
    // Earth's identity is commitment and this is where it is paid. Asserted against both other
    // light verbs' cooldowns rather than against 1.8, so the relationship survives a retune of any
    // of the three.
    expect(R.stoneCooldownSeconds).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.gust.cooldownSeconds * 3)
    expect(R.stoneCooldownSeconds).toBeGreaterThan(W.gripCooldownSeconds)
  })

  it('costs more breath than a grip and less than a dodge', () => {
    // Above the grip because this is the move that does damage; under the Slipstream because
    // nothing offensive should crowd the move that saves the player's life out of the bar.
    expect(R.stoneBreathCost).toBeGreaterThan(W.gripBreathCost)
    expect(R.stoneBreathCost).toBeLessThan(DEFAULT_SLIPSTREAM_CONFIG.breathCost)
  })

  it('hits harder than a gust and less hard than the staff finisher', () => {
    // The safe move must never pay better than the dangerous one. A finisher sweeps 190 degrees at
    // melee range against a character with no block; a stone is thrown from twelve units at
    // something that cannot answer.
    expect(R.stoneDamage).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.gust.damage * 2)
    expect(R.stoneDamage).toBeLessThan(DEFAULT_COMBAT_CONFIG.staffArc.finisherDamage)
    expect(R.stoneDamage).toBeLessThan(DEFAULT_COMBAT_CONFIG.pressureWave.maxDamage)
  })

  it('does not one-shot a spear, so even the slowest attack needs a follow-up', () => {
    expect(R.stoneDamage).toBeLessThan(SPEAR.maxHealth)
  })

  it('refuses to fire on cooldown or without the breath, and both halves matter', () => {
    expect(canStoneThrow(0, R.stoneBreathCost, R)).toBe(true)
    expect(canStoneThrow(0.01, R.stoneBreathCost, R)).toBe(false)
    expect(canStoneThrow(0, R.stoneBreathCost - 0.01, R)).toBe(false)
    // Exactly the cost is affordable, matching `canWaterGrip` and `stepSlipstream`.
    expect(canStoneThrow(0, R.stoneBreathCost, R)).toBe(true)
  })
})

describe('breaking plate: the arithmetic behind section 4.4', () => {
  /** How many stones it takes to cross one rung of health, through this kind's armour. */
  const stonesFor = (health: number) =>
    Math.ceil(health / (R.stoneDamage * HEAVY.armour.stone.damage))

  it('lets a stone through plate in full, exactly as the Pressure Wave is let through', () => {
    // The row the design document's sentence stands on. The doc names earth and the environment as
    // the two answers to this type, so it would be incoherent for one of them to be resisted and
    // the other not — and any fraction below 1 makes "the only reliable armour-breaker" less
    // reliable than the wave.
    expect(HEAVY.armour.stone.damage).toBe(1)
    expect(HEAVY.armour.stone.damage).toBe(HEAVY.armour.wave.damage)
  })

  it('still resists the shove, because displacement is what plate defends', () => {
    // Reduced, not removed, and the ordering against the other rows is the argument: a gust is air
    // pushed at a body and gets nothing, a wave is a shock through the ground and gets everything,
    // and a thrown rock sits between them.
    expect(HEAVY.armour.stone.knockback).toBeLessThan(1)
    expect(HEAVY.armour.stone.knockback).toBeGreaterThan(HEAVY.armour.gust.knockback)
  })

  it('takes four stones for the heavy\'s first rung and nine for the whole ladder', () => {
    // **The numbers that make "the only reliable armour-breaker" true rather than merely claimed.**
    // Derived from the shipped config rather than written down, so a retune of the damage, the
    // armour row, the health or the ladder moves the expectation with it and this test keeps
    // meaning the same thing.
    const rungs = [HEAVY.maxHealth, ...HEAVY.recoveryHealthFractions.map((f) => HEAVY.maxHealth * f)]
    expect(rungs).toEqual([4, 2.4, 1.2])
    expect(rungs.map(stonesFor)).toEqual([4, 3, 2])
    expect(rungs.reduce((total, rung) => total + stonesFor(rung), 0)).toBe(9)
  })

  it('beats the staff by a factor that makes the choice obvious', () => {
    // The comparison the config records for the staff, recomputed here against the stone. A full
    // three-swing combo is opener, opener, finisher, all through the staff's armour row.
    const combo = (DEFAULT_COMBAT_CONFIG.staffArc.openerDamage * 2
      + DEFAULT_COMBAT_CONFIG.staffArc.finisherDamage) * HEAVY.armour.staff.damage
    const ladder = HEAVY.maxHealth
      * (1 + HEAVY.recoveryHealthFractions.reduce((a, b) => a + b, 0))
    const staffSwings = Math.ceil(ladder / combo) * 3
    const stones = 9
    // Roughly twenty-five swings inside a 2-damage swing's reach against nine presses from twelve
    // units away. The factor is what matters, not the figures: earth has to be *obviously* the tool
    // for this job or the player will keep swinging.
    expect(staffSwings).toBeGreaterThan(stones * 2)
    // And each of those swings is thrown from inside the heavy's own reach, where a stone is not.
    expect(DEFAULT_COMBAT_CONFIG.staffArc.finisher.range).toBeLessThan(HEAVY.strikeRange * 2)
    expect(R.stone.range).toBeGreaterThan(HEAVY.strikeRange * 3)
  })

  it('is more presses than a perfect dive, which is the honest trade', () => {
    // "Reliable" rather than "fastest", and the distinction is worth pinning because the prose
    // leans on it. A full-strength slam is fewer presses; it needs 30-plus metres a second of
    // descent, and therefore altitude to spend first, which earth does not.
    const rungs = [HEAVY.maxHealth, ...HEAVY.recoveryHealthFractions.map((f) => HEAVY.maxHealth * f)]
    const dives = rungs.reduce(
      (total, rung) => total + Math.ceil(rung / DEFAULT_COMBAT_CONFIG.pressureWave.maxDamage), 0,
    )
    expect(dives).toBeLessThan(9)
    expect(DEFAULT_COMBAT_CONFIG.pressureWave.fullImpactSpeed).toBeGreaterThan(30)
  })

  it('leaves nothing in the game able to deflect a stone outright', () => {
    // A full deflect is `damage === 0 && knockback === 0`, which is what `deflects` reports and what
    // makes a resolver skip a soldier entirely. Nothing may do that to the armour-breaker, or
    // section 4.4's sentence has an exception nobody wrote down.
    for (const [kind, config] of Object.entries(DEFAULT_COMBAT_CONFIG.enemies)) {
      const armour = config.armour.stone
      expect(armour.damage === 0 && armour.knockback === 0, `${kind} deflects a stone`).toBe(false)
    }
  })
})

describe('where a pillar can be raised from', () => {
  it('rises the configured distance ahead, on the ground it finds there', () => {
    const site = pillarSite(ORIGIN, NORTH, groundAt(0), R)
    expect(site).not.toBeNull()
    expect(site!.z).toBeCloseTo(-R.raiseDistance, 10)
    expect(site!.x).toBeCloseTo(0, 10)
    expect(site!.y).toBe(0)
  })

  it('lands past every melee reach, so cover goes between the player and what is closing', () => {
    // The difference between cover and decoration. A pillar raised inside a spear's reach would come
    // up behind the soldier already swinging at the player.
    expect(R.raiseDistance).toBeGreaterThan(SPEAR.strikeRange)
    expect(R.raiseDistance).toBeGreaterThan(HEAVY.strikeRange)
  })

  it('follows the flattened heading, so looking up does not move the site', () => {
    // The raise point is a spot on the ground ahead of the player, and a player looking at the sky
    // is not asking for a pillar behind them.
    const climbing = new Vector3(0, 4, -1).normalize()
    const flat = pillarSite(ORIGIN, NORTH, groundAt(0), R)
    const tilted = pillarSite(ORIGIN, climbing, groundAt(0), R)
    expect(tilted).not.toBeNull()
    expect(tilted!.x).toBeCloseTo(flat!.x, 10)
    expect(tilted!.z).toBeCloseTo(flat!.z, 10)
  })

  it('refuses a purely vertical heading rather than picking a direction', () => {
    expect(pillarSite(ORIGIN, new Vector3(0, 1, 0), groundAt(0), R)).toBeNull()
  })

  it('refuses the void between islands', () => {
    expect(pillarSite(ORIGIN, NORTH, noGround, R)).toBeNull()
  })

  it('refuses ground further than the raise limit from the player\'s own feet', () => {
    // **The rule that stops cover being free.** Without it a player hovering fifty metres up could
    // manufacture hard cover onto ground they are nowhere near, and repeat it — which would answer
    // the archer with no counterplay at all.
    const hovering = at(0, 0, R.raiseVerticalReach + 0.5)
    expect(pillarSite(hovering, NORTH, groundAt(0), R)).toBeNull()
    // The positive control, one step inside the limit: the same call succeeds, so the refusal above
    // is about the height and not about the fixture.
    const jumping = at(0, 0, R.raiseVerticalReach - 0.5)
    expect(pillarSite(jumping, NORTH, groundAt(0), R)).not.toBeNull()
  })

  it('allows a jump\'s worth of clearance but not a glide\'s', () => {
    // The limit stated in the units the player experiences it in. A standing jump is well inside it
    // and a hover at glider height is well outside, which is what "cover is built standing on the
    // ground" has to mean mechanically.
    const jumpApex = DEFAULT_COMBAT_CONFIG.pressureWave.minImpactSpeed
    expect(R.raiseVerticalReach).toBeLessThan(jumpApex)
    expect(pillarSite(at(0, 0, 2), NORTH, groundAt(0), R)).not.toBeNull()
    expect(pillarSite(at(0, 0, 20), NORTH, groundAt(0), R)).toBeNull()
  })

  it('works from below as well as above, since the limit is a distance', () => {
    // Standing in a hollow with the raise point on a lip above is the mirror case, and it has to
    // behave the same way — `Math.abs` rather than a one-sided test, which is easy to get wrong and
    // impossible to notice on flat ground.
    expect(pillarSite(ORIGIN, NORTH, groundAt(R.raiseVerticalReach - 0.5), R)).not.toBeNull()
    expect(pillarSite(ORIGIN, NORTH, groundAt(R.raiseVerticalReach + 0.5), R)).toBeNull()
  })

  it('does not mutate the caller\'s vectors', () => {
    const origin = at(1, 2, 3)
    const forward = new Vector3(0, 0, -1)
    pillarSite(origin, forward, groundAt(0), R)
    expect(origin.toArray()).toEqual([1, 3, 2])
    expect(forward.toArray()).toEqual([0, 0, -1])
  })
})

describe('a pillar\'s life', () => {
  it('carries the shape it was raised with rather than a reference to the config', () => {
    // So a retune cannot change a rock's size while it is standing, which would leave the block
    // test, the view and the shove all measuring something other than what the player is looking at.
    const pillar = pillarAt('p', 0, -6)
    expect(pillar.radius).toBe(R.pillarRadius)
    expect(pillar.height).toBe(R.pillarHeight)
    expect(pillar.secondsLeft).toBe(R.pillarSeconds)
  })

  it('stands for three of an archer\'s shot cycles', () => {
    // Set against the thing it exists to shelter from rather than picked. An archer's cycle is its
    // wind-up plus its recovery, so this is how many shots one press covers.
    const archer = DEFAULT_COMBAT_CONFIG.enemies.archer
    const cycle = archer.windUpSeconds + archer.recoverSeconds
    expect(R.pillarSeconds / cycle).toBeGreaterThan(2.5)
    expect(R.pillarSeconds / cycle).toBeLessThan(4)
  })

  it('cannot outlast a knockdown, and far outlasts an Air Wall', () => {
    // Under the downed timer, so cover is never the thing a player waits behind while the patrol
    // gets up. Over the Air Wall by a wide margin, because the two are opposite tools: one is held
    // and aimed and returns fire, the other is placed once and only stops things.
    expect(R.pillarSeconds).toBeLessThan(SPEAR.downedSeconds)
    expect(R.pillarSeconds).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.airWall.maxSeconds * 5)
  })

  it('counts down and disappears when it is spent', () => {
    const [aged] = stepPillars([pillarAt('p', 0, -6)], 1)
    expect(aged!.secondsLeft).toBeCloseTo(R.pillarSeconds - 1, 10)
    expect(stepPillars([pillarAt('p', 0, -6)], R.pillarSeconds)).toEqual([])
    // And a step past its life does not leave a negative-lifetime rock standing.
    expect(stepPillars([pillarAt('p', 0, -6)], R.pillarSeconds + 5)).toEqual([])
  })

  it('ages every pillar, not just the first', () => {
    // A loop that returned early on the first expiry, or aged only the head of the list, would leave
    // the second pillar immortal — and with a cap of two that is exactly half the mechanic.
    const aged = stepPillars([pillarAt('a', 0, -6), pillarAt('b', 4, -6)], 1)
    expect(aged.map((p) => p.secondsLeft))
      .toEqual([R.pillarSeconds - 1, R.pillarSeconds - 1])
  })

  it('does not mutate the pillars it is given', () => {
    const pillars = [pillarAt('p', 0, -6)]
    stepPillars(pillars, 1)
    expect(pillars[0]!.secondsLeft).toBe(R.pillarSeconds)
  })
})

describe('the cap on standing pillars', () => {
  it('covers two bearings out of the patrol\'s three shooters', () => {
    // Two so the player has to choose which threat to hide from; three would let them build a box,
    // and section 4.4 says the intended answer is almost always movement.
    expect(R.maxPillars).toBe(2)
    const shooters = Object.values(DEFAULT_COMBAT_CONFIG.enemies)
      .filter((config) => config.attack.kind === 'projectile').length
    expect(R.maxPillars).toBeLessThan(shooters + 1)
  })

  it('retires the oldest rather than refusing the press', () => {
    // A refusal the player cannot see is the worst kind, and "you already have two" has nothing on
    // screen to say so except the two rocks — so replacing the older one is a rule they can read
    // straight off the world.
    const first = pillarAt('a', 0, -6)
    const second = pillarAt('b', 4, -6)
    const third = pillarAt('c', 8, -6)
    const two = addPillar(addPillar([], first, R), second, R)
    expect(two.map((p) => p.id)).toEqual(['a', 'b'])
    const three = addPillar(two, third, R)
    expect(three.map((p) => p.id)).toEqual(['b', 'c'])
    expect(three.length).toBe(R.maxPillars)
  })

  it('keeps raise order, which is what the cap depends on', () => {
    const ordered = ['a', 'b'].reduce(
      (pillars: Pillar[], id) => addPillar(pillars, pillarAt(id, 0, -6), R), [],
    )
    expect(ordered.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('degrades to no pillars rather than corrupting the list on a cap of zero', () => {
    // The honest reading of "no pillars may stand". A misconfigured cap disables the move instead of
    // throwing mid-frame or slicing the array backwards.
    expect(addPillar([], pillarAt('a', 0, -6), { ...R, maxPillars: 0 })).toEqual([])
    expect(addPillar([], pillarAt('a', 0, -6), { ...R, maxPillars: -3 })).toEqual([])
  })
})

describe('a pillar stops what flies at it', () => {
  const pillar = pillarAt('p', 0, -6)

  it('stops a step that crosses its footprint', () => {
    expect(pillarBlocks(at(0, 0, 1), at(0, -12, 1), pillar)).toBe(true)
  })

  it('lets a step past on either side through', () => {
    const clear = pillar.radius + 0.2
    expect(pillarBlocks(at(clear, 0, 1), at(clear, -12, 1), pillar)).toBe(false)
    expect(pillarBlocks(at(-clear, 0, 1), at(-clear, -12, 1), pillar)).toBe(false)
    // And exactly at the radius it still blocks, so the boundary belongs to the rock.
    expect(pillarBlocks(at(pillar.radius, 0, 1), at(pillar.radius, -12, 1), pillar)).toBe(true)
  })

  it('lets a step over the top through', () => {
    const over = pillar.position.y + pillar.height + 0.1
    expect(pillarBlocks(at(0, 0, over), at(0, -12, over), pillar)).toBe(false)
    // The positive control, a hair under the top: the same path blocks, so the miss above is about
    // the height rather than about the path.
    const under = pillar.position.y + pillar.height - 0.1
    expect(pillarBlocks(at(0, 0, under), at(0, -12, under), pillar)).toBe(true)
  })

  it('lets a step below its base through', () => {
    // Nothing passes under a rock founded on the ground in practice, but the extent is bounded at
    // both ends rather than only at the top: a pillar on a ledge must not stop an arrow flying
    // through the empty air beneath the ledge.
    expect(pillarBlocks(at(0, 0, -0.5), at(0, -12, -0.5), pillar)).toBe(false)
  })

  it('does not stop a step that ends short of it', () => {
    // The whole reason this is a swept segment rather than a point test — and the reason a *frame*
    // matters. A step that stops before the rock has not met it yet.
    expect(pillarBlocks(at(0, 0, 1), at(0, -3, 1), pillar)).toBe(false)
  })

  it('stops a single frame that crosses it entirely', () => {
    // The failure a position test has. An arrow at the archer's shipped speed covers little enough
    // per frame that a position test would pass today, but it would pass by luck — so the test is
    // written for a step that starts in front of the rock and ends behind it, which no position test
    // can catch.
    expect(pillarBlocks(at(0, -4, 1), at(0, -8, 1), pillar)).toBe(true)
  })

  it('samples the height where the step enters the rock, not where it started', () => {
    // A descending shot that is above the pillar at the start of its step and below the top by the
    // time it reaches the rock has to be stopped. Sampling at the origin would let it through, and
    // sampling at the closest approach would be a different wrong answer.
    // The first attempt at this test descended too gently to prove anything: from `top + 2` to
    // `top - 2` over twelve units, the entry into the footprint is at 40% of the step and the shot
    // is still at `top + 0.4` when it gets there — correctly not blocked. The path below is steep
    // enough that the entry point is genuinely under the top while the origin is genuinely over it,
    // which is the only arrangement that separates the three candidate sampling rules.
    const top = pillar.position.y + pillar.height
    const from = at(0, 0, top + 1)
    const to = at(0, -12, top - 3)
    expect(from.y).toBeGreaterThan(top)
    expect(to.y).toBeLessThan(top)
    expect(pillarBlocks(from, to, pillar)).toBe(true)
    // The negative that makes it a real distinction rather than a coincidence: the same start, on a
    // shallower descent that is still above the rock when it arrives, is not blocked.
    expect(pillarBlocks(from, at(0, -12, top + 0.5), pillar)).toBe(false)
  })

  it('samples the entry rather than the exit, on a shot climbing through the near face', () => {
    // **A test written because mutation found the previous one could not tell the two apart.**
    // Replacing the near root of the quadratic with the far one — sampling where the step *leaves*
    // the footprint instead of where it enters — left every other assertion in this block green,
    // because on a descending path both crossings sit under the top and either rule blocks.
    //
    // A steeply *climbing* shot separates them: an arrow loosed from below clips the near face low
    // down, inside the rock's height, and would emerge above the cap on the far side. The rock stops
    // it, because it met the rock. Sampling the exit would let it through.
    const top = pillar.position.y + pillar.height
    const from = at(0, 0, 0)
    const to = at(0, -12, 10)
    // Stated as the arithmetic the case depends on, so a retune of the height or the radius that
    // destroys the arrangement fails here rather than silently making the test vacuous.
    const entryFraction = (Math.abs(pillar.position.z) - pillar.radius) / 12
    const exitFraction = (Math.abs(pillar.position.z) + pillar.radius) / 12
    expect(from.y + (to.y - from.y) * entryFraction).toBeLessThan(top)
    expect(from.y + (to.y - from.y) * exitFraction).toBeGreaterThan(top)
    expect(pillarBlocks(from, to, pillar)).toBe(true)
  })

  it('stops a step that begins inside the footprint', () => {
    // An object already inside a rock has met it. There is no entry point to solve for, so the start
    // is the only position the step offers.
    expect(pillarBlocks(pillar.position.clone().setY(1), at(0, -12, 1), pillar)).toBe(true)
  })

  it('does not stop a purely vertical step outside the footprint', () => {
    expect(pillarBlocks(at(5, 0, 10), at(5, 0, 0), pillar)).toBe(false)
  })

  it('does not stop a step whose intersection lies behind it', () => {
    // Travelling away from the rock, with the circle behind the start of the step: both roots of the
    // quadratic are negative, and a solver that took the absolute value or ignored the sign would
    // stop an arrow flying in the opposite direction.
    expect(pillarBlocks(at(0, -2, 1), at(0, 6, 1), pillar)).toBe(false)
  })

  it('reports the first pillar of several, and none when the way is clear', () => {
    const near = pillarAt('near', 0, -4)
    const far = pillarAt('far', 0, -10)
    expect(blockingPillar(at(0, 0, 1), at(0, -12, 1), [near, far])?.id).toBe('near')
    expect(blockingPillar(at(0, 0, 1), at(0, -12, 1), [])).toBeNull()
    expect(blockingPillar(at(6, 0, 1), at(6, -12, 1), [near, far])).toBeNull()
  })

  it('is tall enough that an arrow cannot arrive over it on flat ground', () => {
    // Every arrow is loosed from chest height and aimed at the player's feet, so on flat ground a
    // shot is always descending and always below 1.1 by the time it arrives. The height's margin is
    // for an archer standing above the player, which is the case that could actually threaten it.
    expect(R.pillarHeight).toBeGreaterThan(2)
    // Over a standing character, and over the reach a staff can swing, so it is a thing to stand
    // behind rather than a boulder to crouch behind.
    expect(R.pillarHeight).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.staffArc.opener.verticalReach * 2)
  })
})

describe('a rising pillar shoves what is standing on it', () => {
  const pillar = pillarAt('p', 0, -6)

  it('catches a soldier inside the footprint and nobody outside it', () => {
    const on = enemyAt('on', 0, -6)
    const beside = enemyAt('beside', pillar.radius + 0.3, -6)
    expect(pillarShoveTargets(pillar, [on, beside]).map((e) => e.id)).toEqual(['on'])
  })

  it('ignores a soldier far above or below the rock it is not standing on', () => {
    // Bounded by the pillar's own height rather than by a config band, so the rule needs no number
    // that could disagree with the geometry.
    const above = enemyAt('above', 0, -6, pillar.height + 1)
    const on = enemyAt('on', 0, -6)
    expect(pillarShoveTargets(pillar, [above, on]).map((e) => e.id)).toEqual(['on'])
  })

  it('filters by geometry only, leaving the live check to the fight', () => {
    const body = downed(enemyAt('body', 0, -6))
    expect(pillarShoveTargets(pillar, [body]).map((e) => e.id)).toEqual(['body'])
  })

  it('shoves outward from the rock and lifts, rather than away from the player', () => {
    // Outward from the pillar, because the thing being resolved is a body sharing space with a
    // column of rock — which way the bender is standing has nothing to do with which way is out.
    const impulse = pillarShoveImpulse(pillar, at(0.5, -6), R)
    expect(impulse.x).toBeCloseTo(R.raiseShoveSpeed, 10)
    expect(impulse.z).toBeCloseTo(0, 10)
    expect(impulse.y).toBe(R.raiseLiftSpeed)
  })

  it('gives the lift alone to a soldier standing dead centre', () => {
    // No outward direction exists there, so the honest answer is straight up rather than a
    // fabricated bearing.
    const impulse = pillarShoveImpulse(pillar, pillar.position.clone(), R)
    expect(impulse.x).toBe(0)
    expect(impulse.z).toBe(0)
    expect(impulse.y).toBe(R.raiseLiftSpeed)
  })

  it('lifts less than the weakest Vortex, so it is a stumble and not a gathering', () => {
    // Gathering and lifting a group is air's payoff, and a cheaper version of it on earth's heavy
    // key would make the Vortex the move nobody presses. At the shipped gravity this is well under
    // half a second off the ground.
    expect(R.raiseLiftSpeed).toBeLessThan(DEFAULT_COMBAT_CONFIG.vortex.minLiftSpeed)
    const airborneSeconds = (2 * R.raiseLiftSpeed) / SPEAR.gravity
    expect(airborneSeconds).toBeLessThan(0.5)
    // And still non-zero, because the interruption is the point: `stepEnemy`'s airborne branch is
    // what cancels a wind-up, and a lift of zero would leave the raise doing nothing to anybody.
    expect(airborneSeconds).toBeGreaterThan(0)
  })

  it('shoves a body clear of the footprint and not much further', () => {
    // Enough to resolve a soldier standing where rock is arriving, and no more: a large shove would
    // be a gust that cost Focus.
    const travel = R.raiseShoveSpeed / SPEAR.knockbackDamping
    expect(travel).toBeGreaterThan(pillar.radius)
    expect(travel).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.knockback / SPEAR.knockbackDamping)
  })
})

describe('what a pillar costs', () => {
  it('spends Focus, and less of it than an Ice Lock', () => {
    // The two heavy verbs share one bar, so this is a comparison rather than an independent number.
    // A freeze takes a whole rank out of the fight for three seconds and is the strongest single
    // effect the player can produce; a pillar does nothing to anybody. The stronger effect keeps
    // the higher price.
    expect(R.raiseFocusCost).toBeGreaterThan(0)
    expect(R.raiseFocusCost).toBeLessThan(W.freezeFocusCost)
  })

  it('costs exactly what taking a spear hit costs', () => {
    // The anchor that decides the number: cover is priced at precisely the hit it is bought to
    // prevent, so a pillar that stops one arrow has broken even. Asserted against the Focus config
    // rather than against 30.
    expect(R.raiseFocusCost).toBe(DEFAULT_FOCUS_CONFIG.damageDrain)
  })

  it('is three pillars from a full bar, or one pillar and one freeze with room left', () => {
    // Both bounds, because either alone is satisfiable by a wrong number. Three so the move is
    // genuinely usable; and the mixed line matters most, since section 4.2's own worked example
    // chains water into earth and a price that could not pay for the document's example would
    // contradict the document.
    const max = DEFAULT_FOCUS_CONFIG.maxFocus
    expect(Math.floor(max / R.raiseFocusCost)).toBe(3)
    expect(R.raiseFocusCost + W.freezeFocusCost).toBeLessThan(max)
    // And not four: a full bar is not an indefinite supply of cover.
    expect(R.raiseFocusCost * 4).toBeGreaterThan(max)
  })

  it('destroys the Avatar State\'s arming pip, exactly as a freeze does', () => {
    // The state arms only from a bar held at maximum, so any spend at all costs it. That is the
    // trade section 4.5 asks for, and adding a second Focus sink must not soften it.
    const armed = DEFAULT_FOCUS_CONFIG.maxFocus
    expect(armed - R.raiseFocusCost).toBeLessThan(armed)
    expect(R.raiseFocusCost).toBeGreaterThan(0)
  })

  it('takes real time to earn back, though less than a freeze does', () => {
    // **A measurement that corrected an assertion rather than the other way round.** The water
    // cycle pins that refilling one freeze takes longer than `armSeconds` at the best gain rate in
    // the game, and the same test written for the pillar fails: at 30 Focus against a best rate of
    // 7.92 a second — a clean glide, doubled for riding a wind feature, times the maximum chain
    // ramp — the pillar comes back in about 3.8 seconds against the arming window's 4, where the
    // freeze needs about 4.4. So the pillar is on the *other* side of that particular line, and
    // pretending otherwise would have been a test asserting something false about the number
    // shipped.
    //
    // What is actually true is asserted instead, in two parts. The cheaper move is cheaper to
    // recover from, which is precisely what pricing it below the freeze means and is the ordering a
    // retune must preserve. And at the rate a player is realistically flying at — a plain glide, no
    // wind feature, no chain built — the climb back is several times the arming window, which is
    // the sense in which the spend is felt.
    const bestGain = DEFAULT_FOCUS_CONFIG.glideGainPerSecond
      * DEFAULT_FOCUS_CONFIG.windGainMultiplier * DEFAULT_FOCUS_CONFIG.chainRampMax
    expect(R.raiseFocusCost / bestGain).toBeLessThan(W.freezeFocusCost / bestGain)
    const plainGlide = DEFAULT_FOCUS_CONFIG.glideGainPerSecond
    expect(R.raiseFocusCost / plainGlide)
      .toBeGreaterThan(DEFAULT_AVATAR_STATE_CONFIG.armSeconds * 3)
  })

  it('costs the same breath as an Ice Lock, deliberately', () => {
    // Equal on purpose, and asserted against the water field rather than the literal so a retune of
    // either moves both. Breath is not where either heavy verb is priced — Focus is the gate meant
    // to be felt, and two meters saying the same thing twice is one more refusal to diagnose.
    expect(R.raiseBreathCost).toBe(W.freezeBreathCost)
  })

  it('refuses without the Focus or the breath, and both halves matter', () => {
    expect(canRaisePillar(R.raiseFocusCost, R.raiseBreathCost, R)).toBe(true)
    expect(canRaisePillar(R.raiseFocusCost - 0.01, R.raiseBreathCost, R)).toBe(false)
    expect(canRaisePillar(R.raiseFocusCost, R.raiseBreathCost - 0.01, R)).toBe(false)
  })

  it('says nothing about whether there is ground to raise from', () => {
    // Deliberately separate from `pillarSite`, because this predicate is what the action guide dims
    // a row on: a row that also tracked the terrain would flicker as the player looked around.
    expect(canRaisePillar(100, 100, R)).toBe(true)
    expect(pillarSite(ORIGIN, NORTH, noGround, R)).toBeNull()
  })

  it('has no cooldown field at all, because the visible cap is the second gate', () => {
    // A hidden timer would refuse the move for a reason the player cannot see — the HUD draws the
    // Focus bar and does not draw a cooldown. The cap on standing pillars is the other gate and it
    // is legible, being two rocks on screen.
    expect(Object.keys(R)).not.toContain('raiseCooldownSeconds')
  })
})
