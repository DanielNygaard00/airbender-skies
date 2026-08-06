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
  attack: { kind: 'melee', damage: 1 }, knockbackDamping: 3, gravity: 20, snapDistance: 1.2,
}

const AT = (x: number, z: number) => new Vector3(x, 0, z)

/** Flat ground at y=0, so an arc can be reasoned about exactly. */
const flatGround: GroundHeightQuery = { groundHeightAt: () => 0 }
/** No ground anywhere: what being blown off an island looks like. */
const emptyAir: GroundHeightQuery = { groundHeightAt: () => null }
const FLOOR = -50

/** Run the enemy against a stationary player and total the damage dealt. */
function fight(seconds: number, playerAt: Vector3, from = spawnEnemy('a', AT(0, 20), 'spear', C)) {
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
    const far = spawnEnemy('a', AT(0, 60), 'spear', C)
    expect(fight(2, AT(0, 0), far).damage).toBe(0)
  })

  it('telegraphs before it hits, so the strike is dodgeable', () => {
    // Inside reach, but the hit must not land during the wind-up.
    const adjacent = spawnEnemy('a', AT(0, 2), 'spear', C)
    const early = fight(C.windUpSeconds - 0.1, AT(0, 0), adjacent)
    expect(early.damage).toBe(0)
    expect(early.enemy.stance).toBe('wind-up')
  })

  it('misses if the player leaves reach during the wind-up', () => {
    // This is what makes the telegraph a dodge window rather than decoration.
    let enemy = spawnEnemy('a', AT(0, 2), 'spear', C)
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
    const downed = hitEnemy(spawnEnemy('a', AT(0, 5), 'spear', C), C.maxHealth, new Vector3())
    expect(isDowned(downed.health)).toBe(true)
    expect(downed.stance).toBe('downed')
  })

  it('stops fighting once downed', () => {
    const downed = hitEnemy(spawnEnemy('a', AT(0, 2), 'spear', C), C.maxHealth, new Vector3())
    expect(fight(5, AT(0, 0), downed).damage).toBe(0)
  })

  it('stays down instead of recovering over time', () => {
    const downed = hitEnemy(spawnEnemy('a', AT(0, 2), 'spear', C), C.maxHealth, new Vector3())
    expect(fight(30, AT(0, 0), downed).enemy.stance).toBe('downed')
  })

  it('does not advance while downed', () => {
    const downed = hitEnemy(spawnEnemy('a', AT(0, 20), 'spear', C), C.maxHealth, new Vector3())
    const after = fight(3, AT(0, 0), downed).enemy
    expect(horizontalDistance(after.position, AT(0, 20))).toBeLessThan(0.5)
  })
})

describe('taking a hit', () => {
  it('interrupts a wind-up rather than only chipping health', () => {
    const winding = fight(C.windUpSeconds - 0.1, AT(0, 0), spawnEnemy('a', AT(0, 2), 'spear', C)).enemy
    expect(winding.stance).toBe('wind-up')
    expect(hitEnemy(winding, 1, new Vector3()).stance).toBe('recover')
  })

  it('is pushed by the impulse and then settles', () => {
    const pushed = hitEnemy(spawnEnemy('a', AT(0, 20), 'spear', C), 0.5, new Vector3(0, 0, 30))
    const moved = fight(0.3, AT(0, 0), pushed).enemy
    expect(moved.position.z).toBeGreaterThan(20)
    const settled = fight(3, AT(0, 0), moved).enemy
    expect(settled.knockback.length()).toBeLessThan(0.5)
  })
})

describe('the aggro leash', () => {
  it('ignores a player beyond its notice range', () => {
    // Without a leash a patrol trails the player across the whole archipelago.
    const distant = spawnEnemy('a', AT(0, C.aggroRange + 20), 'spear', C)
    const after = fight(3, AT(0, 0), distant).enemy
    expect(horizontalDistance(after.position, AT(0, C.aggroRange + 20))).toBeLessThan(0.5)
  })

  it('closes once the player comes inside it', () => {
    const inside = spawnEnemy('a', AT(0, C.aggroRange - 5), 'spear', C)
    const after = fight(1, AT(0, 0), inside).enemy
    expect(horizontalDistance(after.position, AT(0, 0)))
      .toBeLessThan(C.aggroRange - 5)
  })

  it('still faces a player it is ignoring, so the leash is not blindness', () => {
    const distant = spawnEnemy('a', AT(0, C.aggroRange + 20), 'spear', C)
    expect(fight(0.5, AT(0, 0), distant).enemy.facing.z).toBeLessThan(0)
  })
})

describe('an airborne enemy', () => {
  /** Get an enemy into wind-up stance right next to the player, then lift it. */
  const liftedInWindUp = () => {
    const player = AT(0, 0)
    let enemy = spawnEnemy('a', AT(0, 0.5), 'spear', C)
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
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), 'spear', C), 0, new Vector3(0, 9, 0))
    expect(settle(lifted, 3).position.y).toBeCloseTo(0, 3)
  })

  it('rises before it falls', () => {
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), 'spear', C), 0, new Vector3(0, 9, 0))
    expect(settle(lifted, 0.2).position.y).toBeGreaterThan(0.5)
  })

  it('reports itself airborne while up, and grounded once it lands', () => {
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), 'spear', C), 0, new Vector3(0, 9, 0))
    expect(settle(lifted, 0.2).grounded).toBe(false)
    expect(settle(lifted, 3).grounded).toBe(true)
  })

  it('lets a downed body fall rather than stranding it in the air', () => {
    // stepEnemy returns early for the downed. Leaving gravity out of that branch
    // would strand any corpse that was airborne when it went down.
    const downed = hitEnemy(spawnEnemy('a', AT(0, 0), 'spear', C), C.maxHealth, new Vector3(0, 9, 0))
    const settled = settle(downed, 3)
    expect(settled.stance).toBe('downed')
    expect(settled.position.y).toBeCloseTo(0, 3)
  })

  it('downs an enemy that falls out of the world', () => {
    // Section 4.6 counts being blown off a ledge as a down.
    const pushed = settle(spawnEnemy('a', AT(0, 0), 'spear', C), 6, emptyAir)
    expect(isDowned(pushed.health)).toBe(true)
  })

  it('parks a body that fell out of the world instead of falling forever', () => {
    // Downing it is not enough on its own: the downed branch kept integrating, so a body
    // in empty air accelerated without bound. Measured before this guard — 36km down and
    // still gaining 1.2km/s a minute in. Nothing can ever see it again, so it stops.
    let enemy = spawnEnemy('a', AT(0, 0), 'spear', C)
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
    const shoved = hitEnemy(spawnEnemy('a', AT(0, 0), 'spear', C), 0, new Vector3(20, 0, 0))
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
  const spawnOnSlope = () => spawnEnemy('a', new Vector3(0, slope.groundHeightAt(0, 0) ?? 0, 0), 'spear', C)

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
    const step = stepEnemy(spawnEnemy('a', AT(0, 20), 'spear', C), AT(0, -10), flatGround, FLOOR, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(false)
  })

  it('reports nothing while merely falling, above the floor', () => {
    const falling = { ...spawnEnemy('a', AT(0, 20), 'spear', C), position: new Vector3(0, 0, 0), grounded: false }
    const step = stepEnemy(falling, AT(0, -10), emptyAir, FLOOR, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(false)
    expect(isDowned(step.enemy.health)).toBe(false)
  })

  it('reports the removal on the frame it crosses the floor, and downs it', () => {
    const brink = { ...spawnEnemy('a', AT(0, 20), 'spear', C), position: new Vector3(0, BRINK, 0), grounded: false }
    const step = stepEnemy(brink, AT(0, -10), emptyAir, FLOOR, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(true)
    expect(isDowned(step.enemy.health)).toBe(true)
  })

  it('reports it exactly once, not on every frame afterwards', () => {
    // The latching bug this test exists for: a flag that stays true pays Focus every
    // frame for one event, and a parked body sits below the floor forever.
    let current = { ...spawnEnemy('a', AT(0, 20), 'spear', C), position: new Vector3(0, BRINK, 0), grounded: false }
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
      ...spawnEnemy('a', AT(0, 20), 'spear', C),
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
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), 'spear', C), 0, new Vector3(0, 11, 0))
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

describe('a melee attack reaches horizontally, as it always has', () => {
  it('thrusts at a player just in reach', () => {
    // The existing behaviour, restated so the refactor cannot quietly change it.
    const near = { ...spawnEnemy('a', AT(0, 0), 'spear', C), stance: 'wind-up' as const, stanceTime: 999 }
    const step = stepEnemy(near, new Vector3(0, 0, -2), flatGround, FLOOR, 1 / 60, C)
    expect(step.damageToPlayer).toBeGreaterThan(0)
    expect(step.firedProjectile).toBe(null)
  })

  it('still thrusts at a player almost directly overhead', () => {
    // A spear's reach is horizontal and must stay so: 2 units away, 20 units up is a
    // hit today, and this refactor must not turn it into a miss.
    const near = { ...spawnEnemy('a', AT(0, 0), 'spear', C), stance: 'wind-up' as const, stanceTime: 999 }
    const step = stepEnemy(near, new Vector3(0, 20, -2), flatGround, FLOOR, 1 / 60, C)
    expect(step.damageToPlayer).toBeGreaterThan(0)
  })
})

describe('a projectile attack reaches in three dimensions', () => {
  // A deliberately distinct strikeRange from anything shipped, so an assertion that
  // accidentally read the real config instead of this one would be visible.
  const ARCHER: EnemyConfig = {
    ...C,
    strikeRange: 30,
    aggroRange: 60,
    attack: { kind: 'projectile', damage: 0.4, speed: 20 },
  }

  it('fires at a player inside its range', () => {
    const archer = {
      ...spawnEnemy('a', AT(0, 0), 'archer', ARCHER), stance: 'wind-up' as const, stanceTime: 999,
    }
    const step = stepEnemy(archer, new Vector3(0, 0, -10), flatGround, FLOOR, 1 / 60, ARCHER)
    expect(step.firedProjectile).not.toBe(null)
    // The arrow carries the damage, not this frame.
    expect(step.damageToPlayer).toBe(0)
  })

  it('does NOT fire at a player overhead beyond its range', () => {
    // The whole point of the type. Horizontal distance here is 0, so under the old
    // horizontal-only measurement this would be inside ANY range and the archer would
    // be inescapable by climbing. True distance is 40, outside the 30 above.
    const archer = {
      ...spawnEnemy('a', AT(0, 0), 'archer', ARCHER), stance: 'wind-up' as const, stanceTime: 999,
    }
    const step = stepEnemy(archer, new Vector3(0, 40, 0), flatGround, FLOOR, 1 / 60, ARCHER)
    expect(step.firedProjectile).toBe(null)
  })

  it('does fire at a player overhead inside its range', () => {
    // The other half: height is not a magic shield, only distance is.
    //
    // 20 out and 18 up: horizontal 20, true distance 26.9, both inside the 30 above.
    // A player directly overhead would be at horizontal distance 0 and would fire under
    // either measurement, which is why this one stands off to the side -- the pairing
    // with the test below, at the same horizontal offset and a greater height, is what
    // makes altitude the only difference between firing and not.
    const archer = {
      ...spawnEnemy('a', AT(0, 0), 'archer', ARCHER), stance: 'wind-up' as const, stanceTime: 999,
    }
    const step = stepEnemy(archer, new Vector3(0, 18, -20), flatGround, FLOOR, 1 / 60, ARCHER)
    expect(step.firedProjectile).not.toBe(null)
  })

  it('stops firing at that same player once they climb higher', () => {
    // The sibling of the test above, differing only in altitude: 20 out in both cases,
    // 18 up there and 25 up here, which puts true distance at 32.0 -- outside the 30.
    // Under a horizontal-only measurement both are at distance 20 and both fire, so this
    // pair is what pins the split rather than the degenerate directly-overhead case.
    const archer = {
      ...spawnEnemy('a', AT(0, 0), 'archer', ARCHER), stance: 'wind-up' as const, stanceTime: 999,
    }
    const step = stepEnemy(archer, new Vector3(0, 25, -20), flatGround, FLOOR, 1 / 60, ARCHER)
    expect(step.firedProjectile).toBe(null)
  })

  it('aims in 3D, so a shot at a hovering player climbs', () => {
    const archer = {
      ...spawnEnemy('a', AT(0, 0), 'archer', ARCHER), stance: 'wind-up' as const, stanceTime: 999,
    }
    const step = stepEnemy(archer, new Vector3(0, 20, -10), flatGround, FLOOR, 1 / 60, ARCHER)
    const shot = step.firedProjectile
    if (!shot) throw new Error('the archer should have fired')
    // A flattened direction would have y exactly 0, which is the bug this catches.
    expect(shot.direction.y).toBeGreaterThan(0.5)
    expect(shot.direction.length()).toBeCloseTo(1, 5)
  })

  it('leaves facing horizontal on the very frame it aims up', () => {
    // facing drives the rig's yaw via atan2(x, z) and must stay a horizontal heading,
    // while the shot itself climbs. Both halves are asserted on one frame on purpose:
    // `facing.y === 0` alone holds for every possible input, because horizontalTo builds
    // its vector as (dx, 0, dz) and even its degenerate fallback is (0, 0, -1) -- so on a
    // frame where nothing fires it is not a claim about anything. Pairing it with the
    // climb makes it contingent on the firing path having actually run.
    //
    // 10 out and 20 up is a true distance of 22.4, inside the 30 above. The previous
    // fixture stood at 40 up, a true distance of 41.2, where the archer never fired.
    const archer = {
      ...spawnEnemy('a', AT(0, 0), 'archer', ARCHER), stance: 'wind-up' as const, stanceTime: 999,
    }
    const step = stepEnemy(archer, new Vector3(0, 20, -10), flatGround, FLOOR, 1 / 60, ARCHER)
    const shot = step.firedProjectile
    if (!shot) throw new Error('the archer should have fired')
    expect(shot.direction.y).toBeGreaterThan(0.5)
    expect(step.enemy.facing.y).toBe(0)
  })

  it('notices in three dimensions too', () => {
    // aggroRange must be 3D for the same reason strikeRange is: a player hovering
    // overhead is at horizontal distance 0 and would otherwise always be noticed,
    // however high. 60 is this fixture's aggroRange, so 80 up is outside it and the
    // archer should hold station rather than close.
    const archer = {
      ...spawnEnemy('a', new Vector3(5, 0, 5), 'archer', ARCHER), stance: 'advance' as const,
    }
    const step = stepEnemy(archer, new Vector3(5, 80, 5), flatGround, FLOOR, 1 / 60, ARCHER)
    expect(step.enemy.position.x).toBeCloseTo(5)
    expect(step.enemy.position.z).toBeCloseTo(5)
    // Position alone does not distinguish "held station" from "in wind-up but yet to
    // move": under a horizontal-only measurement, distance reads as 0 here, which is
    // inside strikeRange too, so it would wind up on this very frame rather than hold.
    // Stance is what actually pins "still just advancing, not noticing yet".
    expect(step.enemy.stance).toBe('advance')
  })
})
