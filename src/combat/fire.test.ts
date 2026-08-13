import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  anyLiveFireBurstTarget, burstShape, canFireBurst, canFireThrust, fireBurstImpulse,
  fireBurstTargets, fireThrustImpulse, fullCharges, inFireBurst, liveFireBurstTargets,
  spendCharges, stepFireCharges,
} from './fire'
import { inGust } from './gust'
import { hitEnemy, horizontalDistance, spawnEnemy, type Enemy } from './enemy'
import { DEFAULT_COMBAT_CONFIG, HOME_PATROL } from './config'
import {
  DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG, DEFAULT_SLIPSTREAM_CONFIG,
} from '../core/config'
import { controllerStep, willRespawn, type ControllerDeps } from '../player/controller'
import { touchedDown } from '../player/slam'
import type { PlayerState, TerrainQuery } from '../core/types'

const F = DEFAULT_COMBAT_CONFIG.fire
const E = DEFAULT_COMBAT_CONFIG.enemies.spear
const ORIGIN = new Vector3(0, 0, 0)
/** Forward is +Z in this project, but the existing combat fixtures aim along −Z; either works. */
const NORTH = new Vector3(0, 0, -1)

const at = (x: number, z: number, y = 0) => new Vector3(x, y, z)
const enemyAt = (id: string, x: number, z: number, y = 0) =>
  spawnEnemy(id, at(x, z, y), 'spear', E)
/** A soldier taken to zero, which is what `isTargetable` refuses. */
const downed = (enemy: Enemy): Enemy => hitEnemy(enemy, enemy.health.max, new Vector3())

describe('the burst\'s band', () => {
  it('is the shortest of every band except the staff\'s', () => {
    // The argued position rather than the number, the way `water.test.ts` states its own. Reaching
    // high wins a fight from a hover with no counterplay, and this is the move that does the most
    // damage in the game — so it buys the least height of anything that is not a swing with a stick.
    // Below water in particular: water cannot hurt anyone at all, and this can.
    const staff = DEFAULT_COMBAT_CONFIG.staffArc.opener.verticalReach
    expect(F.verticalReach).toBeGreaterThan(staff)
    expect(F.verticalReach).toBeLessThan(DEFAULT_COMBAT_CONFIG.water.verticalReach)
    expect(F.verticalReach).toBeLessThan(DEFAULT_COMBAT_CONFIG.pressureWave.verticalReach)
    expect(F.verticalReach).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.verticalReach)
    expect(F.verticalReach).toBeLessThan(DEFAULT_COMBAT_CONFIG.vortex.verticalReach)
  })

  it('cannot reach a soldier the archer can still shoot back at', () => {
    // The exploit the band exists to close, stated as arithmetic rather than as a comparison of two
    // config values — and it matters more for fire than it did for water, because a player hovering
    // out of everyone's reach with a damage move would be able to take a patrol apart for free.
    const hover = at(0, -2, F.verticalReach + 1)
    const soldier = enemyAt('spear', 0, -2)
    expect(inFireBurst(hover, NORTH, soldier.position, F)).toBe(false)
    // The positive control: from ground level the very same soldier is caught, so the negative above
    // is about height and not about the fixture being aimed wrongly.
    expect(inFireBurst(at(0, 0), NORTH, soldier.position, F)).toBe(true)
    // And the soldier that exists to punish altitude still answers from there.
    expect(hover.distanceTo(soldier.position))
      .toBeLessThan(DEFAULT_COMBAT_CONFIG.enemies.archer.strikeRange)
  })

  it('catches a target exactly at the band edge and not a hair past it', () => {
    const edge = enemyAt('edge', 0, -2, F.verticalReach)
    const past = enemyAt('past', 0, -2, F.verticalReach + 0.01)
    expect(fireBurstTargets(ORIGIN, NORTH, [edge, past], F).map((e) => e.id)).toEqual(['edge'])
  })

  it('builds its cone from the config rather than from a second copy of the numbers', () => {
    // `burstShape` is what the effect draws and what `inFireBurst` tests, so the two cannot drift —
    // the relationship `gripShape` has with `inWaterGrip`. Asserted field by field because a shape
    // built from the wrong three values would still be a cone.
    expect(burstShape(F)).toEqual({
      range: F.burst.range, halfAngle: F.burst.halfAngle, verticalReach: F.verticalReach,
    })
  })
})

describe('the cone is what makes the burst single-target', () => {
  it('is the narrowest cone in the game', () => {
    // Every aimed shape in the shipped config, so a new move cannot quietly become narrower without
    // this failing. The claim is not decoration: "the only element with real single-target damage"
    // is delivered by the geometry rather than by a rule that picks one target, and the width is the
    // whole of that.
    const others = [
      DEFAULT_COMBAT_CONFIG.gust.halfAngle,
      DEFAULT_COMBAT_CONFIG.airWall.halfAngle,
      DEFAULT_COMBAT_CONFIG.staffArc.opener.halfAngle,
      DEFAULT_COMBAT_CONFIG.staffArc.finisher.halfAngle,
      DEFAULT_COMBAT_CONFIG.water.grip.halfAngle,
      DEFAULT_COMBAT_CONFIG.water.freeze.halfAngle,
    ]
    expect(F.burst.halfAngle).toBeLessThan(Math.min(...others))
  })

  it('is narrower at full reach than the shipped patrol\'s closest pair', () => {
    // The measurement behind "single-target", against the real encounter rather than against a
    // number in a comment. `HOME_PATROL`'s two closest soldiers are 11.31 m apart — a property
    // `reach-geometry.test.ts` also depends on — and the chord the burst sweeps at maximum reach is
    // narrower than that, so no two soldiers of that patrol can be inside one burst.
    //
    // Computed from the spawn list rather than transcribed, so moving a soldier moves this bound.
    let closest = Infinity
    for (let i = 0; i < HOME_PATROL.length; i++) {
      for (let j = i + 1; j < HOME_PATROL.length; j++) {
        closest = Math.min(
          closest, horizontalDistance(HOME_PATROL[i]!.position, HOME_PATROL[j]!.position),
        )
      }
    }
    const chord = 2 * F.burst.range * Math.sin(F.burst.halfAngle)
    expect(closest).toBeLessThan(Infinity)
    expect(chord).toBeLessThan(closest)
  })

  it('never catches two soldiers standing as far apart as the patrol\'s closest pair', () => {
    // The behavioural half, because the arithmetic above is a bound on the chord and this is the
    // consequence anywhere inside the cone. Swept over every pair of positions on a metre grid within
    // reach rather than checked on one arrangement, because the interesting case is not the widest
    // one: two soldiers both close to the caster are inside a much narrower slice of the cone, and a
    // single hand-placed pair would not find that.
    //
    // The gust is the positive control on the identical sweep, and it is what makes the claim mean
    // something: at the same spacing a gust catches both, so this is a property of fire's width
    // rather than of a grid too sparse to hold two soldiers at once.
    const spacing = 11.31
    // Half-metre steps: at whole metres the grid does not contain a pair the *gust* can hold at this
    // spacing either — the widest such pair sits at (±6, −3.5) — so the control would fail for a
    // reason that has nothing to do with fire. Found by the control failing, which is what it is for.
    const grid: Vector3[] = []
    for (let x = -F.burst.range; x <= F.burst.range; x += 0.5) {
      for (let z = -F.burst.range; z <= F.burst.range; z += 0.5) {
        if (Math.hypot(x, z) <= F.burst.range) grid.push(at(x, z))
      }
    }
    let firePairs = 0
    let gustPairs = 0
    // The cone predicates directly rather than through `fireBurstTargets`, because this sweep is
    // roughly 190,000 pairs and building two `Enemy` records per pair would spend the whole test
    // budget on allocation. `fireBurstTargets` is held to `inFireBurst` by construction — it is one
    // `filter` over it — and the band and the cone have their own tests above.
    for (let i = 0; i < grid.length; i++) {
      for (let j = i + 1; j < grid.length; j++) {
        const a = grid[i]!
        const b = grid[j]!
        if (horizontalDistance(a, b) < spacing) continue
        if (inFireBurst(ORIGIN, NORTH, a, F) && inFireBurst(ORIGIN, NORTH, b, F)) firePairs++
        const gust = DEFAULT_COMBAT_CONFIG.gust
        if (inGust(ORIGIN, NORTH, a, gust) && inGust(ORIGIN, NORTH, b, gust)) gustPairs++
      }
    }
    expect(firePairs).toBe(0)
    expect(gustPairs).toBeGreaterThan(0)
    // An explicit timeout, because this is a sweep and the default per-test budget is 5 s: a CI
    // deploy in this repo has already failed on a real-geometry sweep that passed locally. Measured
    // at about 40 ms here, so the margin is two orders of magnitude.
  }, 20_000)

  it('reaches less far than every other bending move and further than every melee reach', () => {
    // Both bounds, because either alone is the wrong move. Shorter than water and the gust because
    // it is the one that hurts; longer than a spear's reach, a heavy's and the staff finisher's,
    // because a damage move you have to stand inside a swing to use is the staff again.
    expect(F.burst.range).toBeLessThan(DEFAULT_COMBAT_CONFIG.water.freeze.range)
    expect(F.burst.range).toBeLessThan(DEFAULT_COMBAT_CONFIG.water.grip.range)
    expect(F.burst.range).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.range)
    expect(F.burst.range).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.enemies.spear.strikeRange)
    expect(F.burst.range).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.enemies.heavy.strikeRange)
    expect(F.burst.range).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.staffArc.finisher.range)
  })

  it('leaves a soldier behind the caster alone', () => {
    // Paired with the soldier in front, so "caught nobody" cannot be what passes.
    const behind = enemyAt('behind', 0, F.burst.range - 1)
    const ahead = enemyAt('ahead', 0, -(F.burst.range - 1))
    expect(fireBurstTargets(ORIGIN, NORTH, [behind, ahead], F).map((e) => e.id)).toEqual(['ahead'])
  })
})

describe('the damage is anchored to the recovery ladder', () => {
  /** Presses to take a soldier from `health` to zero. */
  const presses = (health: number) => Math.ceil(health / F.burstDamage)
  /** Every rung of a kind's ladder, in health, first down first. */
  const ladder = (kind: 'spear' | 'archer' | 'nets' | 'heavy') => {
    const c = DEFAULT_COMBAT_CONFIG.enemies[kind]
    return [c.maxHealth, ...c.recoveryHealthFractions.map((f) => c.maxHealth * f)]
  }

  it('puts a spear down in two presses, then one per rung', () => {
    // The arithmetic the config's comment claims, asserted off the shipped numbers so a retune of
    // either the damage or the ladder moves it.
    expect(ladder('spear').map(presses)).toEqual([2, 1, 1])
  })

  it('puts an archer down on the same count', () => {
    expect(ladder('archer').map(presses)).toEqual([2, 1, 1])
  })

  it('puts a net thrower down in a single press', () => {
    // Deliberate rather than incidental: the netter is the type that takes the air layer away, and
    // fire is the element that answers being grounded. One press for the first down is the pairing
    // the two designs already imply.
    expect(ladder('nets')[0]).toBe(DEFAULT_COMBAT_CONFIG.enemies.nets.maxHealth)
    expect(presses(ladder('nets')[0]!)).toBe(1)
  })

  it('beats every other aimed move per press, and loses to a committed dive', () => {
    // Where fire sits in the kit, as inequalities rather than as a paragraph. Above the gust (a
    // shove) and the staff finisher (the third swing of a combo that cannot be thrown from the air
    // at all); under the Pressure Wave's ceiling, so the dive stays the biggest single blow and
    // keeps costing a real fall.
    expect(F.burstDamage).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.gust.damage)
    expect(F.burstDamage).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.staffArc.openerDamage)
    expect(F.burstDamage).toBeLessThan(DEFAULT_COMBAT_CONFIG.pressureWave.maxDamage)
  })

  it('spends a whole hand of charges on two spears, and not a third', () => {
    // What three charges are actually worth, which is the sentence that keeps section 4.1's "not a
    // damage-per-second character" true of the damage element: a full hand is two soldiers' first
    // downs and nothing left over, so fire alone never clears a patrol of seven.
    const perLanding = F.maxCharges * F.burstDamage
    const spear = DEFAULT_COMBAT_CONFIG.enemies.spear.maxHealth
    expect(perLanding).toBeGreaterThanOrEqual(spear * 2)
    expect(perLanding).toBeLessThan(spear * 3)
  })

  it('is a bad answer to plate, and measurably worse than the wave', () => {
    // The row that decides whether fire quietly becomes the armour-breaker section 4.4 promises to
    // earth. Asserted as the two press counts against the same soldier, because "0.5 is less than 1"
    // says nothing about whether the tool is wrong.
    const heavy = DEFAULT_COMBAT_CONFIG.enemies.heavy
    const throughPlate = F.burstDamage * heavy.armour.burst.damage
    const burstsPerRung = Math.ceil(heavy.maxHealth / throughPlate)
    const divesPerRung = Math.ceil(heavy.maxHealth / DEFAULT_COMBAT_CONFIG.pressureWave.maxDamage)
    expect(burstsPerRung).toBe(8)
    expect(divesPerRung).toBe(2)
    expect(burstsPerRung).toBeGreaterThan(divesPerRung * 3)
    // And a single landing's worth of fire does not even finish one rung, which is what makes it a
    // grind rather than a slow answer: the charges run out first, every time.
    expect(F.maxCharges * throughPlate).toBeLessThan(heavy.maxHealth)
  })
})

describe('fireBurstImpulse', () => {
  it('shoves outward, away from the caster', () => {
    // The sign is the move, and it is the opposite of the grip's inward pull — which is how the two
    // light verbs read apart. A flipped sign would still "move something".
    const target = at(0, -5)
    const shove = fireBurstImpulse(ORIGIN, target, F)
    expect(shove.z).toBeLessThan(0)
    const after = target.clone().addScaledVector(shove, 0.1)
    expect(horizontalDistance(ORIGIN, after)).toBeGreaterThan(horizontalDistance(ORIGIN, target))
  })

  it('does not lift', () => {
    // Air takes people off their feet and fire does not: an airborne enemy is inert, so lifting
    // would hand the target the Vortex's payoff for free and remove the follow-up.
    expect(fireBurstImpulse(ORIGIN, at(0, -5), F).y).toBe(0)
  })

  it('leaves a shoved target inside the cone for the next burst', () => {
    // The measurement the knockback figure is chosen by, as arithmetic off the two configs. A push of
    // `burstKnockback` against `knockbackDamping` travels that ratio before it stops, and the claim
    // is that a target hit at ordinary range is still in reach afterwards — otherwise a move built
    // for working on one soldier would throw that soldier out of range of itself.
    const travel = F.burstKnockback / E.knockbackDamping
    expect(travel).toBeLessThan(F.burst.range)
    // Where the claim stops being true, stated rather than implied: a burst thrown past this
    // distance does shove its target out of the cone.
    expect(F.burst.range - travel).toBeGreaterThan(F.burst.range * 0.6)
  })

  it('shoves far less than a gust, and no harder than a staff opener needs to', () => {
    // Fire hurts, air displaces. A burst with the gust's 26 would be a strictly better gust: the
    // game's best single-target damage *and* its displacement, on the same key.
    expect(F.burstKnockback).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.knockback / 4)
    expect(F.burstKnockback).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.staffArc.openerKnockback)
  })

  it('is finite for a target standing exactly on the caster', () => {
    // The outward direction is undefined there; it must not produce a NaN that would corrupt the
    // body's position for the rest of the session.
    const shove = fireBurstImpulse(ORIGIN, ORIGIN.clone(), F)
    expect(Number.isFinite(shove.x)).toBe(true)
    expect(Number.isFinite(shove.z)).toBe(true)
    expect(shove.length()).toBe(0)
  })
})

describe('the live-target preview', () => {
  it('ignores a downed soldier and lights up for a standing one', () => {
    // The pair, because "the preview stays dark" passes just as well for a preview that never lights
    // up at all — and the same arrangement is used for both halves, so the only difference is the
    // soldier's state.
    const standing = enemyAt('standing', 0, -4)
    expect(liveFireBurstTargets(ORIGIN, NORTH, [standing], F).map((e) => e.id))
      .toEqual(['standing'])
    expect(liveFireBurstTargets(ORIGIN, NORTH, [downed(standing)], F)).toEqual([])
    // And the geometry filter still sees the body, which is what makes this a state test rather than
    // the cone quietly having moved.
    expect(fireBurstTargets(ORIGIN, NORTH, [downed(standing)], F).map((e) => e.id))
      .toEqual(['standing'])
  })

  it('answers the same as the list form across a range of arrangements', () => {
    // The cheap boolean held to the expensive list, the way `gust.test.ts` holds `anyLiveGustTarget`
    // to `liveGustTargets`. Both a hit and a miss occur in this sweep, which is what stops it passing
    // against a function that always answers false.
    let hits = 0
    let misses = 0
    for (let x = -6; x <= 6; x += 1) {
      for (let z = -9; z <= 3; z += 1) {
        for (const y of [0, 2, 4]) {
          const enemies = [enemyAt('a', x, z, y), downed(enemyAt('b', 0, -3))]
          const list = liveFireBurstTargets(ORIGIN, NORTH, enemies, F).length > 0
          expect(anyLiveFireBurstTarget(ORIGIN, NORTH, enemies, F), `${x},${z},${y}`).toBe(list)
          if (list) hits++
          else misses++
        }
      }
    }
    expect(hits).toBeGreaterThan(0)
    expect(misses).toBeGreaterThan(0)
  })
})

describe('the charges', () => {
  it('starts and refills at exactly the configured count', () => {
    expect(fullCharges(F)).toBe(F.maxCharges)
    expect(F.maxCharges).toBe(3)
  })

  it('spends one at a time and floors at nothing', () => {
    expect(spendCharges(3)).toBe(2)
    expect(spendCharges(1)).toBe(0)
    expect(spendCharges(0)).toBe(0)
    // A count, because the fight bills its spend as one. Never negative, whatever it is handed.
    expect(spendCharges(3, 2)).toBe(1)
    expect(spendCharges(1, 5)).toBe(0)
  })

  it('refills on a touchdown and on nothing else', () => {
    // Both halves. The refill on its own would pass for a function that always returns full, which
    // is precisely the second-Breath-bar failure the whole design is built to avoid.
    expect(stepFireCharges(0, true, F)).toBe(F.maxCharges)
    expect(stepFireCharges(1, true, F)).toBe(F.maxCharges)
    expect(stepFireCharges(0, false, F)).toBe(0)
    expect(stepFireCharges(1, false, F)).toBe(1)
  })

  it('keeps a spend that happens on a frame with no landing', () => {
    // **The composition `main.ts` performs every frame, in the order it performs it**: the fight's bill
    // is deducted, then the refill rule runs. That order is what makes a charge actually gone rather
    // than gone and handed straight back, and it is worth pinning here because the file that sequences
    // it has no tests of its own.
    //
    // Both halves, because the interesting failure is the one that looks like nothing: a refill that
    // ignored `landed` would leave the hand full after every press, so the pips would never move and
    // fire would be free.
    expect(stepFireCharges(spendCharges(F.maxCharges), false, F)).toBe(F.maxCharges - 1)
    expect(stepFireCharges(spendCharges(spendCharges(F.maxCharges)), false, F))
      .toBe(F.maxCharges - 2)
    // And on a frame that *did* land, the same spend is refunded — which is the rule read literally:
    // touching down refills, whatever happened earlier in the same 16 ms.
    expect(stepFireCharges(spendCharges(F.maxCharges), true, F)).toBe(F.maxCharges)
  })

  it('cannot be trickled: ten seconds in the air give nothing back', () => {
    // The behavioural version of "the refill takes no dt", and the assertion that would catch a
    // future edit turning this into a rate. Six hundred frames is longer than any encounter's worth
    // of hovering, and it is exactly the window a regenerating meter would refill several times over
    // — `breathRegenPerSecond` alone would have refilled the whole Breath bar eight times.
    let charges = 0
    for (let frame = 0; frame < 600; frame++) charges = stepFireCharges(charges, false, F)
    expect(charges).toBe(0)
    // And the very next touchdown gives all of them back, so this is a state that can still change.
    expect(stepFireCharges(charges, true, F)).toBe(F.maxCharges)
  })
})

describe('canFireBurst', () => {
  it('refuses with an empty hand and allows with one charge', () => {
    // Each gate varied independently, so a predicate that only checks the other one is caught.
    expect(canFireBurst(0, 1, F)).toBe(true)
    expect(canFireBurst(0, 0, F)).toBe(false)
  })

  it('refuses on cooldown even with a full hand', () => {
    expect(canFireBurst(0.01, F.maxCharges, F)).toBe(false)
    expect(canFireBurst(0, F.maxCharges, F)).toBe(true)
  })

  it('costs more recovery than a grip and far less than a vortex', () => {
    // Damage costs more than denial, and neither is a setup move with a three-second wait.
    expect(F.burstCooldownSeconds).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.water.gripCooldownSeconds)
    expect(F.burstCooldownSeconds).toBeLessThan(DEFAULT_COMBAT_CONFIG.vortex.cooldownSeconds)
  })

  it('cannot dump a whole hand inside one enemy telegraph', () => {
    // What the cooldown is actually for, given that the charges are the hard budget. Spending all
    // three takes longer than a spear's entire exchange and longer than a heavy's wind-up, so a
    // patrol gets to act between bursts rather than being deleted inside one window.
    const toSpendAll = (F.maxCharges - 1) * F.burstCooldownSeconds
    expect(toSpendAll).toBeGreaterThan(E.windUpSeconds + E.recoverSeconds)
    expect(toSpendAll).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.enemies.heavy.windUpSeconds)
  })
})

describe('the thrust', () => {
  it('is refused on the ground however many charges are in hand', () => {
    // The owner's ruling that fire does not move the player on the ground, and the pair is the point:
    // the same full hand that is refused on foot is accepted in the glider, so this is about the
    // posture rather than about the predicate never answering true.
    expect(canFireThrust(F.maxCharges, 'ground')).toBe(false)
    expect(canFireThrust(F.maxCharges, 'glider')).toBe(true)
  })

  it('is refused with an empty hand in the glider', () => {
    expect(canFireThrust(0, 'glider')).toBe(false)
    expect(canFireThrust(1, 'glider')).toBe(true)
  })

  it('has no way to read the breath bar, in either direction', () => {
    // **The structural version of "the thrust must never be paid for in Breath."** A behavioural test
    // cannot express it — there is no breath to pass — so what is asserted is that there is nowhere
    // for a breath gate to hide: the predicate takes exactly the charges and the posture, the impulse
    // takes the heading and the config, and no field in the shipped fire config mentions breath. An
    // edit that priced the thrust in breath would have to widen one of the three and redden here.
    expect(canFireThrust.length).toBe(2)
    expect(fireThrustImpulse.length).toBe(2)
    expect(Object.keys(F).filter((key) => /breath/i.test(key))).toEqual([])
  })

  it('is worth exactly one push of air, borrowed from the air jump', () => {
    // Anchored to a number the game already has rather than picked, so "one thrust is one push of
    // air" is a fact about the config rather than a claim in a comment.
    expect(F.thrustUpSpeed).toBe(DEFAULT_GROUND_CONFIG.airJumpSpeed)
  })

  it('climbs more than it pushes, and pushes far less than a dash', () => {
    // Section 4.2 calls it propulsion in the sense of a climb. The game already has two horizontal
    // burst moves; at a fraction of either, fire cannot become a third.
    expect(F.thrustForwardSpeed).toBeLessThan(F.thrustUpSpeed)
    expect(F.thrustForwardSpeed).toBeLessThan(DEFAULT_GROUND_CONFIG.dashSpeed / 4)
    expect(F.thrustForwardSpeed).toBeLessThan(DEFAULT_SLIPSTREAM_CONFIG.speed / 4)
  })

  it('returns a fully stalled wing to a speed that makes lift', () => {
    // What the impulse has to be able to do, measured against the flight model's own stall speed
    // rather than asserted as a size. From a dead stop, one thrust leaves the glider flying.
    const fromRest = fireThrustImpulse(NORTH, F).length()
    expect(fromRest).toBeGreaterThan(DEFAULT_FLIGHT_CONFIG.stallSpeed)
  })

  it('is worth under a third of a Breath bar for the whole hand', () => {
    // **The measurement that keeps the thrust from reading as extra Breath**, and the tightest number
    // in this file. Bending air accelerates at `thrustAccel`, so one thrust is its magnitude over
    // that: 0.492 s at the shipped values. Three of them are 1.475 s, against the 4.72 s a full bar
    // buys above `bendFloor` — so a player who tries to fly on fire has under a third of one bar for
    // the entire crossing, and no way to earn more without landing.
    const perCharge = fireThrustImpulse(NORTH, F).length() / DEFAULT_FLIGHT_CONFIG.thrustAccel
    const wholeHand = perCharge * F.maxCharges
    const barSeconds = (DEFAULT_FLIGHT_CONFIG.baseMaxBreath - DEFAULT_FLIGHT_CONFIG.bendFloor)
      / DEFAULT_FLIGHT_CONFIG.breathDrainPerSecond
    expect(wholeHand).toBeLessThan(barSeconds / 3)
    // And it is not so small as to be a gesture: one charge is worth a real fraction of a second of
    // thrust, which is what makes it a save rather than a tap.
    expect(perCharge).toBeGreaterThan(0.25)
  })

  it('climbs even when the nose is pointing straight down', () => {
    // The reason the heading is flattened. A diving glider's `forward` points down, so a 3D impulse
    // would spend a charge to dive harder — the exact opposite of the emergency this move is for.
    const diving = new Vector3(0, -0.9, -0.1).normalize()
    const impulse = fireThrustImpulse(diving, F)
    expect(impulse.y).toBe(F.thrustUpSpeed)
    // The horizontal part still goes where the nose points, flattened, rather than being dropped.
    expect(impulse.z).toBeLessThan(0)
  })

  it('delivers the lift alone for a perfectly vertical nose, without a NaN', () => {
    // There is no horizontal component to normalise there. A NaN would reach `player.velocity` and
    // corrupt the state until the controller's own guard respawned the player — invisible as a cause.
    const impulse = fireThrustImpulse(new Vector3(0, 1, 0), F)
    expect(impulse.toArray().every(Number.isFinite)).toBe(true)
    expect(impulse.y).toBe(F.thrustUpSpeed)
    expect(impulse.x).toBe(0)
    expect(impulse.z).toBe(0)
  })
})

/**
 * A fall out of the world, and what it does to the charges.
 *
 * Through the real `controllerStep` rather than by reasoning about `safeRespawn`, because the claim is
 * about the frame the player is put back: `willRespawn` fires, the controller hands back a grounded
 * state, and `touchedDown` therefore reports an arrival — which is what refills the hand. The
 * alternative would have been a fire-specific rule for the fall, and a second notion of "arrived" is
 * what `touchedDown` exists to prevent.
 */
describe('a fall out of the world', () => {
  const flatGround: TerrainQuery = {
    groundHeightAt: () => 0,
    raycast: () => null,
  }
  const deps: ControllerDeps = {
    terrain: flatGround,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: -500,
    spawnPointFor: () => new Vector3(0, 10, 0),
    slipstream: DEFAULT_SLIPSTREAM_CONFIG,
    staff: { maxChain: 3, swingSeconds: 0.26, continueSeconds: 0.3, recoverySeconds: 0.4 },
    collision: { radius: 0.5, wallNormalY: 0.5 },
  }
  const input = {
    lookDirection: NORTH.clone(), forward: 0, strafe: 0, sprint: false, tuck: false,
    actionPressed: false, actionHeld: false, actionReleased: false, scooterPressed: false,
    dashPressed: false, gustPressed: false, carryPressed: false, avatarStatePressed: false,
    vortexHeld: false, vortexReleased: false, radialHeld: false, radialReleased: false,
    aimDelta: { x: 0, y: 0 }, pointerDelta: { x: 0, y: 0 }, elementIndex: null,
    slipstreamPressed: false, airWallHeld: false, staffPressed: false,
  }
  const plunging = (): PlayerState => ({
    mode: 'glider', position: new Vector3(0, -600, 0), velocity: new Vector3(0, -140, 0),
    forward: NORTH.clone(), breath: 0, maxBreath: 100, grounded: false, lastGroundIslandId: null,
    airJumpsUsed: 1, chargeTime: 0, coyoteTime: 0, jumpBuffer: 0,
    scooterActive: false, scooterCharge: 0, wallRideNormal: null, dashesUsed: 0, dashRecovery: 0,
    slipstreamElapsed: null, slipstreamCooldown: 0,
    staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, tangled: 0,
  act: 3,
  })

  it('hands the charges back, because a respawn arrives on the ground', () => {
    const before = plunging()
    expect(willRespawn(before, deps.worldFloorY)).toBe(true)
    const after = controllerStep(before, input, 1 / 60, deps)
    expect(after.grounded).toBe(true)
    expect(touchedDown(before, after)).toBe(true)
    expect(stepFireCharges(0, touchedDown(before, after), F)).toBe(F.maxCharges)
  })

  it('does not report an arrival on an ordinary airborne frame', () => {
    // The control the assertion above needs: `touchedDown` has to be false for a frame that is
    // merely flying, or "the charges came back" would be true of every frame and the refill would be
    // the rate the whole design refuses.
    const flying: PlayerState = { ...plunging(), position: new Vector3(0, 200, 0) }
    const after = controllerStep(flying, input, 1 / 60, deps)
    expect(willRespawn(flying, deps.worldFloorY)).toBe(false)
    expect(touchedDown(flying, after)).toBe(false)
    expect(stepFireCharges(0, touchedDown(flying, after), F)).toBe(0)
  })
})
