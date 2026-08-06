import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  spawnEnemy, stepEnemy, hitEnemy, horizontalDistance, isTargetable, risingProgress,
  type Enemy, type EnemyConfig, type GroundHeightQuery,
} from './enemy'
import { isDowned } from './health'
import { DEFAULT_COMBAT_CONFIG } from './config'

const C: EnemyConfig = {
  maxHealth: 3, outOfCombatSeconds: 4, regenPerSecond: 0.4,
  moveSpeed: 4, strikeRange: 3, aggroRange: 30, windUpSeconds: 0.5, recoverSeconds: 0.6,
  strikeDamage: 1, knockbackDamping: 3, gravity: 20, snapDistance: 1.2,
  downedSeconds: 18, risingSeconds: 1.2, recoveryHealthFractions: [0.6, 0.3],
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

/** Take an enemy to zero the way the fight does — through a hit. */
const down = (enemy: Enemy) => hitEnemy(enemy, enemy.health.max, new Vector3())
/** Total seconds for one full trip: flat on the ground, then the push-up. */
const FULL_RECOVERY = C.downedSeconds + C.risingSeconds

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

  it('stays down through the countdown rather than recovering the instant it falls', () => {
    // The ladder (see "getting back up" below) does eventually stand a soldier back
    // up — that is Task 1's whole point — but not before downedSeconds has passed.
    const downed = hitEnemy(spawnEnemy('a', AT(0, 2), C), C.maxHealth, new Vector3())
    expect(fight(C.downedSeconds - 1, AT(0, 0), downed).enemy.stance).toBe('downed')
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
    // Section 4.6 counts being blown off a ledge as a down.
    const pushed = settle(spawnEnemy('a', AT(0, 0), C), 6, emptyAir)
    expect(isDowned(pushed.health)).toBe(true)
  })

  it('parks a body that fell out of the world instead of falling forever', () => {
    // Downing it is not enough on its own: the downed branch kept integrating, so a body
    // in empty air accelerated without bound. Measured before this guard — 36km down and
    // still gaining 1.2km/s a minute in. Nothing can ever see it again, so it stops.
    let enemy = spawnEnemy('a', AT(0, 0), C)
    const far = AT(0, 500)
    const run = (frames: number) => {
      for (let i = 0; i < frames; i++) enemy = stepEnemy(enemy, far, emptyAir, FLOOR, 1 / 60, C).enemy
    }
    run(600)
    expect(isDowned(enemy.health)).toBe(true)
    const parked = enemy.position.y
    run(600)
    expect(enemy.position.y).toBe(parked)
    expect(enemy.verticalVelocity).toBe(0)
  })

  it('still decays a horizontal push', () => {
    // Pre-existing behaviour that the split of knockback must not lose.
    const shoved = hitEnemy(spawnEnemy('a', AT(0, 0), C), 0, new Vector3(20, 0, 0))
    const after = settle(shoved, 2)
    expect(after.position.x).toBeGreaterThan(1)
    expect(Math.hypot(after.knockback.x, after.knockback.z)).toBeLessThan(1)
  })
})

describe('walking downhill', () => {
  // Constant downhill grade: height falls as x rises, so an enemy walking toward
  // a player further along +x is always stepping onto lower ground.
  const s = 0.2
  const slope: GroundHeightQuery = { groundHeightAt: (x) => 100 - s * x }
  // Halfway between strikeRange and aggroRange: well outside strike reach (so it
  // walks rather than winds up) and well inside the leash, for the entire 3
  // seconds below (moveSpeed 4 over 3s closes at most 12, leaving it short of
  // strikeRange 3 the whole time). Derived from config, not a literal.
  const playerDistance = (C.strikeRange + C.aggroRange) / 2
  const player = AT(playerDistance, 0)
  const spawnOnSlope = () => spawnEnemy('a', new Vector3(0, slope.groundHeightAt(0, 0) ?? 0, 0), C)

  it('stays grounded every frame on a 0.2 downhill slope', () => {
    // The measured bug: stepping onto lower ground puts position.y above the new
    // height for one frame, which the old ground check reads as airborne. Over 180
    // frames (3s at 1/60) that halved both walk speed and uptime for striking.
    let enemy = spawnOnSlope()
    let groundedFrames = 0
    for (let i = 0; i < 180; i++) {
      const step = stepEnemy(enemy, player, slope, FLOOR, 1 / 60, C)
      enemy = step.enemy
      if (enemy.grounded) groundedFrames++
    }
    expect(groundedFrames).toBe(180)
  })

  it('does not halve its walk speed on the same slope', () => {
    // Companion to the grounded-every-frame test: half the frames airborne meant
    // half the frames advancing too, since an airborne enemy does not move.
    let enemy = spawnOnSlope()
    const start = enemy.position.clone()
    for (let i = 0; i < 180; i++) {
      enemy = stepEnemy(enemy, player, slope, FLOOR, 1 / 60, C).enemy
    }
    const traveled = horizontalDistance(enemy.position, start)
    const expected = C.moveSpeed * 3
    // Half speed (the measured bug, roughly expected/2) must fail this; the walk
    // here is a straight, constant-speed closing line with no easing to budget for,
    // so the tolerance can stay tight.
    expect(traveled).toBeGreaterThan(expected * 0.9)
    expect(traveled).toBeLessThanOrEqual(expected + 0.01)
  })
})

describe('reporting an environmental removal', () => {
  // Just above the floor, so a single frame of free fall from rest is enough to cross
  // it — the exact margin depends on this file's own gravity and dt, not the doc.
  const BRINK = FLOOR + 0.001

  it('reports nothing on an ordinary grounded frame', () => {
    const step = stepEnemy(spawnEnemy('a', AT(0, 20), C), AT(0, -10), flatGround, FLOOR, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(false)
  })

  it('reports nothing while merely falling, above the floor', () => {
    const falling = { ...spawnEnemy('a', AT(0, 20), C), position: new Vector3(0, 0, 0), grounded: false }
    const step = stepEnemy(falling, AT(0, -10), emptyAir, FLOOR, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(false)
    expect(isDowned(step.enemy.health)).toBe(false)
  })

  it('reports the removal on the frame it crosses the floor, and downs it', () => {
    const brink = { ...spawnEnemy('a', AT(0, 20), C), position: new Vector3(0, BRINK, 0), grounded: false }
    const step = stepEnemy(brink, AT(0, -10), emptyAir, FLOOR, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(true)
    expect(isDowned(step.enemy.health)).toBe(true)
  })

  it('reports it exactly once, not on every frame afterwards', () => {
    // The latching bug this test exists for: a flag that stays true pays Focus every
    // frame for one event, and a parked body sits below the floor forever.
    let current = { ...spawnEnemy('a', AT(0, 20), C), position: new Vector3(0, BRINK, 0), grounded: false }
    const reports: boolean[] = []
    for (let i = 0; i < 20; i++) {
      const step = stepEnemy(current, AT(0, -10), emptyAir, FLOOR, 1 / 60, C)
      reports.push(step.fellOutOfWorld)
      current = step.enemy
    }
    expect(reports.filter(Boolean).length).toBe(1)
    expect(reports[0]).toBe(true)
  })

  it('does not report a body that was already downed before it fell', () => {
    // It was removed by a gust and already paid for. Reporting the fall as well would
    // pay twice for one soldier.
    const corpse = {
      ...spawnEnemy('a', AT(0, 20), C),
      position: new Vector3(0, BRINK, 0),
      grounded: false,
      health: { current: 0, max: 1.5, sinceHit: 0 },
    }
    const step = stepEnemy(corpse, AT(0, -10), emptyAir, FLOOR, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(false)
  })
})

describe('the ground snap does not grab a body from mid-air', () => {
  it('does not snap onto the ground early after a big lift', () => {
    // What the was-grounded guard exists to protect: a Vortex lifts an already-
    // grounded enemy several metres up. hitEnemy leaves the stale `grounded: true`
    // in place, but the very next physics tick has positive vertical velocity, so
    // the snap check is skipped entirely and it comes out genuinely airborne —
    // from then on it is not "already grounded" until it truly lands. If the
    // tolerance were unconditional (no was-grounded requirement), the moment its
    // fall brought it back within snapDistance of the ground it would pop onto the
    // ground early -- landing several frames before it actually reached it, which
    // for a multi-metre Vortex lift would be a visible teleport underfoot.
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), C), 0, new Vector3(0, 11, 0))
    let enemy = lifted
    let sawSmallGapWhileAirborne = false
    for (let t = 0; t < 3; t += 1 / 60) {
      enemy = stepEnemy(enemy, AT(0, 500), flatGround, FLOOR, 1 / 60, C).enemy
      // Only descending frames matter here: on the way up, verticalVelocity > 0
      // skips the snap check regardless of any guard, so a small gap while rising
      // proves nothing about the guard being tested.
      if (
        !enemy.grounded && enemy.verticalVelocity <= 0 &&
        enemy.position.y > 0 && enemy.position.y <= C.snapDistance
      ) {
        sawSmallGapWhileAirborne = true
      }
      if (enemy.grounded) break
    }
    // Seeing this intermediate frame -- inside the tolerance band, but still
    // reporting airborne -- is the proof the guard did not fire early. An
    // unconditional tolerance jumps straight from "well above" to "grounded, y
    // at the ground" with no such frame in between.
    expect(sawSmallGapWhileAirborne).toBe(true)
  })
})

describe('getting back up', () => {
  it('pushes up after the countdown', () => {
    const enemy = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    expect(enemy.stance).toBe('rising')
  })

  it('is still flat a moment before the countdown ends', () => {
    const enemy = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds - 0.5)
    expect(enemy.stance).toBe('downed')
  })

  it('restores the first rung of the ladder when the push-up finishes', () => {
    const enemy = settle(down(spawnEnemy('a', AT(0, 20), C)), FULL_RECOVERY + 0.1)
    expect(enemy.stance).toBe('advance')
    expect(enemy.health.current).toBeCloseTo(C.maxHealth * C.recoveryHealthFractions[0]!)
  })

  it('restores the second rung on the second recovery, so the ladder descends', () => {
    const first = settle(down(spawnEnemy('a', AT(0, 20), C)), FULL_RECOVERY + 0.1)
    const second = settle(down(first), FULL_RECOVERY + 0.1)
    expect(second.stance).toBe('advance')
    expect(second.health.current).toBeCloseTo(C.maxHealth * C.recoveryHealthFractions[1]!)
    expect(second.health.current).toBeLessThan(first.health.current)
  })

  it('stays down for good once the ladder is spent', () => {
    let enemy = down(spawnEnemy('a', AT(0, 20), C))
    for (const _ of C.recoveryHealthFractions) enemy = down(settle(enemy, FULL_RECOVERY + 0.1))
    // Several more countdowns' worth: a soldier past the last rung never rises again.
    expect(settle(enemy, FULL_RECOVERY * 3).stance).toBe('downed')
  })

  it('does not count down while still in the air', () => {
    // Downed mid-Vortex: the body has to land before it starts recovering.
    const lifted = { ...down(spawnEnemy('a', AT(0, 20), C)), position: AT(0, 20).setY(40) }
    const enemy = settle(lifted, 1)
    expect(enemy.stance).toBe('downed')
    expect(enemy.stanceTime).toBe(0)
  })

  it('deals no damage and does not close while pushing up', () => {
    // A rising soldier is inert. Player placed inside strikeRange to prove it.
    const onTop = AT(0, 20)
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    const step = stepEnemy(rising, onTop, flatGround, FLOOR, 1 / 60, C)
    expect(step.damageToPlayer).toBe(0)
    expect(step.enemy.position.x).toBeCloseTo(rising.position.x)
    expect(step.enemy.position.z).toBeCloseTo(rising.position.z)
  })

  it('faces the player from the moment it starts pushing up', () => {
    // Otherwise it comes up aimed wherever it fell and snaps round on its first
    // advance frame.
    const enemy = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    // `settle` puts the player at AT(0, 500), so the heading is +z.
    expect(enemy.facing.z).toBeGreaterThan(0.9)
  })

  it('goes straight back down when hit during the push-up', () => {
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.5)
    expect(rising.stance).toBe('rising')
    const interrupted = hitEnemy(rising, 0.1, new Vector3())
    expect(interrupted.stance).toBe('downed')
    expect(interrupted.stanceTime).toBe(0)
  })

  it('does not spend a rung on an interrupted push-up', () => {
    // The ruling: interrupting buys time, it does not substitute for damage. So the
    // next rise has to come back at the SAME rung, not the next one down.
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.5)
    const interrupted = hitEnemy(rising, 0.1, new Vector3())
    expect(interrupted.downs).toBe(1)
    const risenAgain = settle(interrupted, FULL_RECOVERY + 0.1)
    expect(risenAgain.health.current).toBeCloseTo(C.maxHealth * C.recoveryHealthFractions[0]!)
  })

  it('never rises once it has left the world', () => {
    const fallen = settle(spawnEnemy('a', AT(0, 20), C), 5, emptyAir)
    expect(isDowned(fallen.health)).toBe(true)
    expect(settle(fallen, FULL_RECOVERY * 2, emptyAir).stance).toBe('downed')
  })

  it('counts a down only on the crossing, not on every hit to a body', () => {
    const first = down(spawnEnemy('a', AT(0, 20), C))
    expect(first.downs).toBe(1)
    expect(hitEnemy(first, C.maxHealth, new Vector3()).downs).toBe(1)
  })

  it('takes strictly fewer gusts to put down at each rung, and one at the last', () => {
    // The feel claim from the spec, phrased so retuning the numbers cannot silently
    // invert the ladder. Uses the real config, not this file's fixture.
    const { enemy: E, gust } = DEFAULT_COMBAT_CONFIG
    const gustsToDown = (health: number) => Math.ceil(health / gust.damage)
    const rungs = [1, ...E.recoveryHealthFractions].map((f) => gustsToDown(E.maxHealth * f))
    for (let i = 1; i < rungs.length; i++) expect(rungs[i]).toBeLessThan(rungs[i - 1]!)
    expect(rungs[rungs.length - 1]).toBe(1)
  })
})

describe('isTargetable', () => {
  it('is true for a soldier on its feet', () => {
    expect(isTargetable(spawnEnemy('a', AT(0, 0), C))).toBe(true)
  })

  it('is false for a body on the ground', () => {
    expect(isTargetable(down(spawnEnemy('a', AT(0, 0), C)))).toBe(false)
  })

  it('is true for one pushing back up, which is what makes the interrupt reachable', () => {
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    expect(isTargetable(rising)).toBe(true)
  })
})

describe('risingProgress', () => {
  it('is nothing for a soldier that is not pushing up', () => {
    expect(risingProgress(spawnEnemy('a', AT(0, 0), C), C)).toBe(0)
  })

  it('runs from nothing to all of it across the push-up', () => {
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    expect(risingProgress(rising, C)).toBeLessThan(0.2)
    expect(risingProgress({ ...rising, stanceTime: C.risingSeconds }, C)).toBe(1)
  })

  it('clamps rather than overshooting the pose', () => {
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    expect(risingProgress({ ...rising, stanceTime: C.risingSeconds * 5 }, C)).toBe(1)
  })

  it('is nothing for a zero-length rise rather than a NaN', () => {
    // The value multiplies into a rotation, where a NaN corrupts the matrix instead of
    // merely looking wrong.
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    expect(risingProgress(rising, { ...C, risingSeconds: 0 })).toBe(0)
  })
})
