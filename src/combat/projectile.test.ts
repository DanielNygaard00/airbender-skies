import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  spawnProjectile, stepProjectile, type Projectile, type ProjectileConfig,
} from './projectile'
import { spawnEnemy, type Enemy } from './enemy'
import { spawnPillar, type Pillar } from './earth'
import { applyDamage } from './health'
import { DEFAULT_COMBAT_CONFIG } from './config'

// Deliberately unlike anything shipped, so an assertion reading the real config instead
// of this one would be visible.
const C: ProjectileConfig = { hitRadius: 1, maxSeconds: 2 }

const flatGround = { groundHeightAt: () => 0 }
const noGround = { groundHeightAt: () => null }
const NORTH = new Vector3(0, 0, -1)
const DT = 1 / 60
/**
 * No soldiers, which is the right fixture for every test that predates the Air Wall: they are
 * all about a fresh arrow, and a fresh arrow is inert to soldiers whether any are there or not.
 * The deflected half of the behaviour gets its own describe block with real enemies in it.
 */
const NO_ENEMIES: Enemy[] = []
/**
 * No raised pillars, which is the state of the world in every one of these tests but the block
 * suite at the bottom.
 *
 * Named rather than written as `[]` at thirty call sites, for the reason `NO_ENEMIES` is: the
 * argument is a list of things that stop arrows, and an empty literal reads as "not applicable"
 * where a name reads as "nothing there".
 */
const NO_PILLARS: Pillar[] = []

/** An arrow at the origin heading north at 20 units a second. */
const arrow = () => spawnProjectile('a1', new Vector3(0, 5, 0), NORTH, 0.4, 20, 0)

describe('flight', () => {
  it('carries the damage and speed it was given', () => {
    const p = arrow()
    // Literals, not the arguments echoed back.
    expect(p.damage).toBeCloseTo(0.4)
    expect(p.velocity.length()).toBeCloseTo(20)
    expect(p.age).toBe(0)
  })

  it('normalises a direction that was not already unit length', () => {
    const p = spawnProjectile('a1', new Vector3(), new Vector3(0, 0, -7), 1, 20, 0)
    expect(p.velocity.length()).toBeCloseTo(20)
  })

  it('travels in a straight line at constant speed', () => {
    // No gravity: a straight line is easier to read as a threat and needs no leading.
    let p = arrow()
    for (let i = 0; i < 30; i++) {
      const step = stepProjectile(p, new Vector3(500, 500, 500), NO_ENEMIES, NO_PILLARS, noGround, DT, C)
      if (!step.projectile) throw new Error('the arrow should still be flying')
      p = step.projectile
    }
    // 30 frames at 20 units/sec is 10 units. Derived, not guessed.
    expect(p.position.z).toBeCloseTo(-10, 2)
    expect(p.position.y).toBeCloseTo(5, 5)
    expect(p.velocity.length()).toBeCloseTo(20)
  })
})

describe('ending', () => {
  it('hits a player it reaches, and reports the damage once', () => {
    // 2 units ahead at 20 units/sec, but hitRadius 1 eats one of those units - the
    // arrow only has to close the other one. (2 - 1) / 0.333 is 3 frames out, not 6.
    let p = arrow()
    let hits = 0
    let total = 0
    for (let i = 0; i < 20; i++) {
      const step = stepProjectile(p, new Vector3(0, 5, -2), NO_ENEMIES, NO_PILLARS, noGround, DT, C)
      total += step.damageToPlayer
      if (step.damageToPlayer > 0) hits++
      if (!step.projectile) break
      p = step.projectile
    }
    expect(hits).toBe(1)
    expect(total).toBeCloseTo(0.4)
  })

  it('is gone on the frame it hits', () => {
    let p = arrow()
    for (let i = 0; i < 20; i++) {
      const step = stepProjectile(p, new Vector3(0, 5, -2), NO_ENEMIES, NO_PILLARS, noGround, DT, C)
      if (step.damageToPlayer > 0) {
        expect(step.projectile).toBe(null)
        return
      }
      if (!step.projectile) throw new Error('gone without hitting')
      p = step.projectile
    }
    throw new Error('never hit')
  })

  it('misses a player outside the hit radius', () => {
    // 3 units to the side, against a hitRadius of 1.
    let p = arrow()
    let total = 0
    for (let i = 0; i < 40; i++) {
      const step = stepProjectile(p, new Vector3(3, 5, -2), NO_ENEMIES, NO_PILLARS, noGround, DT, C)
      total += step.damageToPlayer
      if (!step.projectile) break
      p = step.projectile
    }
    expect(total).toBe(0)
  })

  it('ends at terrain height', () => {
    // Fired downward from y 5 onto ground at 0.
    let p = spawnProjectile('a1', new Vector3(0, 5, 0), new Vector3(0, -1, 0), 0.4, 20, 0)
    let alive = 0
    for (let i = 0; i < 60; i++) {
      const step = stepProjectile(p, new Vector3(500, 500, 500), NO_ENEMIES, NO_PILLARS, flatGround, DT, C)
      if (!step.projectile) break
      p = step.projectile
      alive++
    }
    // 5 units down at 20 units/sec is 15 frames. It must end near there, not fly on.
    expect(alive).toBeGreaterThan(10)
    expect(alive).toBeLessThan(20)
  })

  it('flies on where there is no ground at all', () => {
    // Over the void between islands, groundHeightAt returns null.
    let p = spawnProjectile('a1', new Vector3(0, 5, 0), new Vector3(0, -1, 0), 0.4, 20, 0)
    for (let i = 0; i < 60; i++) {
      const step = stepProjectile(p, new Vector3(500, 500, 500), NO_ENEMIES, NO_PILLARS, noGround, DT, C)
      if (!step.projectile) throw new Error('ended over the void, with no ground to end on')
      p = step.projectile
    }
    expect(p.position.y).toBeLessThan(-10)
  })

  it('expires after its lifetime rather than flying forever', () => {
    let p = arrow()
    let frames = 0
    for (let i = 0; i < 1000; i++) {
      const step = stepProjectile(p, new Vector3(500, 500, 500), NO_ENEMIES, NO_PILLARS, noGround, DT, C)
      frames++
      if (!step.projectile) break
      p = step.projectile
    }
    // maxSeconds 2 at 60 frames a second. A literal, not C.maxSeconds * 60.
    expect(frames).toBeGreaterThan(115)
    expect(frames).toBeLessThan(125)
  })

  it('hits a player standing on the ground rather than being swallowed by it', () => {
    // The only fixture that can pin this ordering: a level shot can't, because a level
    // arrow's y never changes, so it is never at or below flatGround's height of 0 and
    // the ground condition is false every frame regardless of check order - that was
    // the bug in the previous version of this test, which could not fail no matter which
    // check ran first. A downward shot arriving at a player standing exactly on the
    // ground makes both conditions true on the same frame: one step of 0.333 units at
    // this speed puts the arrow at y ~= -0.133, which is both within hitRadius 1 of a
    // player at y=0 and at or below the ground at 0. Testing the player first reports
    // the hit; testing the ground first would report nothing and drop the arrow silently.
    const p = spawnProjectile('a1', new Vector3(0, 0.2, 0), new Vector3(0, -1, 0), 0.4, 20, 0)
    const step = stepProjectile(p, new Vector3(0, 0, 0), NO_ENEMIES, NO_PILLARS, flatGround, DT, C)
    expect(step.damageToPlayer).toBeCloseTo(0.4)
    expect(step.projectile).toBe(null)
  })
})

/**
 * Which side of the fight an arrow can hurt, and where on a body it connects.
 *
 * Both halves are properties of `Projectile.deflected` rather than of any caller, so they
 * belong here rather than in `air-wall.test.ts` — that file owns the reflection, this one owns
 * what a reflected arrow can then do.
 */
describe('who an arrow can hurt', () => {
  const SPEAR = DEFAULT_COMBAT_CONFIG.enemies.spear
  /** A soldier on its feet. */
  const soldier = (at = new Vector3()) => spawnEnemy('s1', at, 'spear', SPEAR)
  /** The same arrow as `arrow()` above, already turned around. */
  const returned = (): Projectile => ({ ...arrow(), deflected: true })
  const AWAY = new Vector3(500, 500, 500)

  it('lets a fresh arrow pass straight through a soldier', () => {
    // Friendly fire is off, deliberately: the shipped patrol has both archers firing over
    // three spear soldiers, so a patrol of five would down itself while the player walked away.
    const step = stepProjectile(
      arrow(), AWAY, [soldier(new Vector3(0, 5, -0.2))], NO_PILLARS, noGround, DT, C,
    )
    expect(step.hitEnemyId).toBe(null)
    // The control: the identical arrow and the identical soldier, with the arrow deflected,
    // does connect. Without it this would pass against a `stepProjectile` that never reports
    // an enemy hit at all.
    const turned = stepProjectile(
      returned(), AWAY, [soldier(new Vector3(0, 5, -0.2))], NO_PILLARS, noGround, DT, C,
    )
    expect(turned.hitEnemyId).toBe('s1')
  })

  it('lets a deflected arrow pass straight through the player', () => {
    // The other half of "deflects rather than eating them": a mirror keeps the component of
    // the velocity in its own plane, so a grazing arrow stays near the player after the
    // bounce, and a live one would let a badly angled wall kill you with your own defence.
    // Close enough that one step brings the arrow inside hitRadius, so both lines resolve on
    // the same single frame and the difference between them is only the flag.
    const at = new Vector3(0, 5, -1)
    expect(stepProjectile(returned(), at, NO_ENEMIES, NO_PILLARS, noGround, DT, C).damageToPlayer).toBe(0)
    // The control: the same arrow, not deflected, does hurt the player standing there.
    expect(stepProjectile(arrow(), at, NO_ENEMIES, NO_PILLARS, noGround, DT, C).damageToPlayer)
      .toBeCloseTo(0.4)
  })

  it('ignores a soldier already flat on the ground', () => {
    // The same `isTargetable` rule the rest of the fight resolves against: an arrow through a
    // body is not a hit, and one through a soldier mid-push-up is.
    const base = soldier(new Vector3(0, 5, -0.2))
    const down = { ...base, health: applyDamage(base.health, 99) }
    expect(stepProjectile(returned(), AWAY, [down], NO_PILLARS, noGround, DT, C).hitEnemyId).toBe(null)
    expect(
      stepProjectile(returned(), AWAY, [{ ...down, stance: 'rising' as const }], NO_PILLARS, noGround, DT, C)
        .hitEnemyId,
    ).toBe('s1')
  })

  it('connects anywhere up the soldier\'s height, not just at one point on it', () => {
    // The band, and the whole reason it is a band. `hitsBody` spans the feet to twice
    // `hitRadius` above them, so an arrow skimming a soldier's ankles and one arriving at its
    // chest both land -- which is what the Air Wall's two shots respectively produce. A sphere
    // at either height catches one of those two lines and misses the other; both measurements
    // are recorded on `hitsBody` itself.
    //
    // Level shots, so one step does not move them off the height being tested.
    const at = (y: number): Projectile => ({
      ...returned(), position: new Vector3(0, y, 0.4), velocity: new Vector3(0, 0, -20),
    })
    expect(stepProjectile(at(0.05), AWAY, [soldier()], NO_PILLARS, noGround, DT, C).hitEnemyId).toBe('s1')
    expect(stepProjectile(at(1.1), AWAY, [soldier()], NO_PILLARS, noGround, DT, C).hitEnemyId).toBe('s1')
    // And the control at the far end of the band: above the head is a miss, so the extent is
    // a real limit rather than an unbounded column.
    expect(stepProjectile(at(2 * C.hitRadius + 0.2), AWAY, [soldier()], NO_PILLARS, noGround, DT, C)
      .hitEnemyId).toBe(null)
  })

  it('tests the soldier before the ground under the arrow', () => {
    // The same ordering the player already got, and the fixture needed to pin it is a
    // particular one, for a reason worth writing down. `hitsBody`'s band starts at the
    // soldier's feet and `groundHeightAt` is sampled at the *arrow's* position, so on level
    // ground the two conditions never overlap: an arrow low enough to be at or under the
    // terrain is already below the band. They only meet where the ground under the arrow sits
    // higher than the soldier's own footing — a soldier in a dip, which a single-sample
    // heightfield query produces readily enough. Ground at 0.5 with the soldier's feet at 0
    // and the arrow passing at 0.4 is that case, and it makes both true on one frame.
    const dip = { groundHeightAt: () => 0.5 }
    const skimming: Projectile = {
      ...returned(), position: new Vector3(0, 0.4, 0.4), velocity: new Vector3(0, 0, -20),
    }
    const step = stepProjectile(skimming, AWAY, [soldier()], NO_PILLARS, dip, DT, C)
    expect(step.hitEnemyId).toBe('s1')
    expect(step.projectile).toBe(null)
    // The control that makes the ordering the only thing under test: the same arrow at the
    // same height with no soldier there is swallowed by that same ground, so this fixture
    // really does have the ground condition true.
    const noSoldier = stepProjectile(skimming, AWAY, [], NO_PILLARS, dip, DT, C)
    expect(noSoldier.projectile).toBe(null)
    expect(noSoldier.hitEnemyId).toBe(null)
  })
})

describe('a pillar in the way', () => {
  const EARTH = DEFAULT_COMBAT_CONFIG.earth
  /** Far enough away that the player is never what ends a flight in this block. */
  const AWAY = new Vector3(500, 500, 500)
  /** A rock four units in front of a player standing at the origin. */
  const cover = () => spawnPillar('rock', new Vector3(0, 0, -4), EARTH)
  /** An arrow at chest height closing on the origin from beyond the rock. */
  const shot = (): Projectile => ({
    ...spawnProjectile('a1', new Vector3(0, 1.1, -5.4), new Vector3(0, 0, 1), 1, 34, 0),
  })

  it('stops a shot short of the player, and reports which rock did it', () => {
    const step = stepProjectile(shot(), new Vector3(0, 0, 0), NO_ENEMIES, [cover()], noGround, DT, C)
    expect(step.projectile).toBe(null)
    expect(step.blockedByPillarId).toBe('rock')
    expect(step.damageToPlayer).toBe(0)
    // The control that makes the block the only thing under test: with no rock there the same arrow
    // carries on. Without it, "the arrow ended" would pass for an arrow that expired or hit the
    // ground.
    const clear = stepProjectile(
      shot(), new Vector3(0, 0, 0), NO_ENEMIES, NO_PILLARS, noGround, DT, C,
    )
    expect(clear.projectile).not.toBe(null)
    expect(clear.blockedByPillarId).toBe(null)
  })

  it('beats the player, on a frame where the arrow would reach both', () => {
    // **The ordering that decides whether cover works at all.** A step long enough to cross the rock
    // *and* arrive at the player has to end at the rock: it is between them, and cover that lost a
    // race with the frame rate would fail exactly when the player was closest to it. A fast arrow and
    // a long step put both conditions true on one frame, which is the only arrangement that
    // separates the two orders.
    const crossing: Projectile = {
      ...shot(), position: new Vector3(0, 1.1, -5.4), velocity: new Vector3(0, 0, 300),
    }
    const player = new Vector3(0, 1.1, 0)
    const blocked = stepProjectile(crossing, player, NO_ENEMIES, [cover()], noGround, DT, C)
    expect(blocked.blockedByPillarId).toBe('rock')
    expect(blocked.damageToPlayer).toBe(0)
    // The same step with no rock does hit the player, so both conditions really were true.
    const through = stepProjectile(crossing, player, NO_ENEMIES, NO_PILLARS, noGround, DT, C)
    expect(through.damageToPlayer).toBe(1)
  })

  it('stops a returned arrow too, so cover is not one-way', () => {
    // "Deflects rather than eating them" gives the player an arrow of their own, and a rock in its
    // path stops it: cover that only obstructed the enemy would be a wall the player could shoot
    // through, which is a promise no physical object makes.
    const returned: Projectile = {
      // Started just clear of the rock's near face on the *player's* side, so one step at the
      // archer's own speed crosses it. Travelling toward −z, so the face it meets is the one at
      // `-4 + radius`, which is the opposite side from the incoming shots above.
      ...spawnProjectile('a2', new Vector3(0, 1.1, -2.7), new Vector3(0, 0, -1), 1, 34, 0),
      deflected: true,
    }
    const soldier = spawnEnemy('s1', new Vector3(0, 0, -6), 'spear', DEFAULT_COMBAT_CONFIG.enemies.spear)
    const step = stepProjectile(returned, AWAY, [soldier], [cover()], noGround, DT, C)
    expect(step.blockedByPillarId).toBe('rock')
    expect(step.hitEnemyId).toBe(null)
    // The control: without the rock the same returned arrow is still travelling toward the soldier
    // rather than having been stopped by something else.
    const clear = stepProjectile(returned, AWAY, [soldier], NO_PILLARS, noGround, DT, C)
    expect(clear.blockedByPillarId).toBe(null)
    expect(clear.projectile).not.toBe(null)
  })

  it('swallows a net\'s payload with the net', () => {
    // The refusal has to die with the shot. A net that reached through cover and stowed the glider
    // anyway would make the pillar useless against the one enemy built to ground the player.
    const net = spawnProjectile('n1', new Vector3(0, 1.1, -5.4), new Vector3(0, 0, 1), 0.5, 22, 2)
    const step = stepProjectile(net, new Vector3(0, 0, 0), NO_ENEMIES, [cover()], noGround, DT, C)
    expect(step.blockedByPillarId).toBe('rock')
    expect(step.tangleSeconds).toBe(0)
    // The control: the identical net with no rock in the way does land its refusal.
    const lands = stepProjectile(
      { ...net, position: new Vector3(0, 0.5, -0.2) }, new Vector3(0, 0, 0), NO_ENEMIES,
      NO_PILLARS, noGround, DT, C,
    )
    expect(lands.tangleSeconds).toBe(2)
  })

  it('lets a shot over the top through, and one at chest height not', () => {
    // The pair, because "the arrow was blocked" and "the arrow was not" are each satisfiable by an
    // implementation that ignores height entirely in one direction or the other.
    const rock = cover()
    const over: Projectile = {
      ...shot(), position: new Vector3(0, rock.height + 1, -5.4),
    }
    expect(stepProjectile(over, AWAY, NO_ENEMIES, [rock], noGround, DT, C).blockedByPillarId)
      .toBe(null)
    expect(stepProjectile(shot(), AWAY, NO_ENEMIES, [rock], noGround, DT, C).blockedByPillarId)
      .toBe('rock')
  })

  it('lets a shot past the side through', () => {
    const rock = cover()
    const wide: Projectile = {
      ...shot(), position: new Vector3(rock.radius + 0.5, 1.1, -5.4),
    }
    expect(stepProjectile(wide, AWAY, NO_ENEMIES, [rock], noGround, DT, C).blockedByPillarId)
      .toBe(null)
  })

  it('reports no block on every other way a flight can end', () => {
    // The field is on every return path, so a caller can read it unconditionally. A missing one would
    // be `undefined`, which is falsy and would therefore look like "not blocked" — right by accident
    // on three paths and wrong on the fourth.
    const player = stepProjectile(
      { ...shot(), position: new Vector3(0, 0, -0.2) }, new Vector3(0, 0, 0), NO_ENEMIES,
      NO_PILLARS, noGround, DT, C,
    )
    expect(player.damageToPlayer).toBe(1)
    expect(player.blockedByPillarId).toBe(null)
    const grounded = stepProjectile(
      { ...shot(), position: new Vector3(0, 0.1, -20), velocity: new Vector3(0, -20, 0) },
      AWAY, NO_ENEMIES, NO_PILLARS, flatGround, DT, C,
    )
    expect(grounded.projectile).toBe(null)
    expect(grounded.blockedByPillarId).toBe(null)
    const expired = stepProjectile(
      { ...shot(), age: C.maxSeconds }, AWAY, NO_ENEMIES, NO_PILLARS, noGround, DT, C,
    )
    expect(expired.projectile).toBe(null)
    expect(expired.blockedByPillarId).toBe(null)
    const flying = stepProjectile(shot(), AWAY, NO_ENEMIES, NO_PILLARS, noGround, DT, C)
    expect(flying.projectile).not.toBe(null)
    expect(flying.blockedByPillarId).toBe(null)
  })
})
