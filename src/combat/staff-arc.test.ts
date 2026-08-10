import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { staffShape, staffDamage, staffTargets, staffImpulse } from './staff-arc'
import { spawnEnemy, horizontalDistance } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

const A = DEFAULT_COMBAT_CONFIG.staffArc
const E = DEFAULT_COMBAT_CONFIG.enemies.spear
/**
 * The character's standing height, which `avatar.ts` holds as `TARGET_HEIGHT` and
 * `avatar.test.ts` measures off the real rig. Restated here rather than imported: the export
 * does not exist, and importing `avatar.ts` into a combat test would pull the GLTF loader in
 * behind it. If the rig's height ever moves, `avatar.test.ts` is the test that says so.
 *
 * **Tracked debt, with a corrected trigger.** The ledger's original trigger was "fix before a
 * fourth copy appears", which counts copies rather than naming the hazard. `avatar.ts`
 * documents `TARGET_HEIGHT` as matching a *placeholder* capsule, so this 1.8 restates a
 * stand-in, and the staff's `verticalReach` of 2.0 carries only 0.2 m of slack over a lower
 * bound derived from it. The real trigger is **before the avatar model is replaced**: at that
 * moment these bounds silently start measuring a height the game no longer has.
 */
const BODY_HEIGHT = 1.8
const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
const at = (x: number, z: number) => new Vector3(x, 0, z)
const enemyAt = (id: string, x: number, z: number) => spawnEnemy(id, at(x, z), 'spear', E)

describe('staffShape', () => {
  it('sweeps wider and further on the finisher', () => {
    // Three assertions rather than one, so swapping two of the numbers cannot pass.
    expect(staffShape(true, A).range).toBeGreaterThan(staffShape(false, A).range)
    expect(staffShape(true, A).halfAngle).toBeGreaterThan(staffShape(false, A).halfAngle)
    expect(staffDamage(true, A)).toBeGreaterThan(staffDamage(false, A))
  })

  it('outreaches a spear', () => {
    // The point of 3.6 against the enemy's strikeRange: melee is a spacing tool, not a
    // trade. Derived from config so retuning either side keeps this honest.
    expect(staffShape(false, A).range).toBeGreaterThan(E.strikeRange)
  })

  it('swings to the same height on both arcs', () => {
    // Asserted as equal to each other rather than as two literals: it is the same arm and the
    // same body, so the finisher sweeps wider and shoves harder, not taller. A future change
    // to one has to show up as a change to both.
    expect(staffShape(true, A).verticalReach).toBe(staffShape(false, A).verticalReach)
  })

  it('reaches less high than the bending does, because it is an arm holding a stick', () => {
    // Stated against the gust's band and the arc's own reach rather than restating 2.0. The
    // staff is bounded by where the character can physically put the staff; a gust is moving
    // air and is allowed more.
    expect(staffShape(false, A).verticalReach)
      .toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.verticalReach)
    expect(staffShape(false, A).verticalReach).toBeLessThan(staffShape(false, A).range)
  })

  it('still clears a soldier standing a full body height above the player', () => {
    // The lower bound, which nothing else pinned: over-tightening is the risk this change
    // actually carries, and both arcs set to 0.01 left the whole suite green before this test
    // existed. A swing has to reach at least as high as the character is tall, or a soldier on
    // a rise no taller than the player is unhittable with the staff -- which is precisely the
    // low rise the value's own comment says its margin is for.
    for (const finisher of [false, true]) {
      expect(staffShape(finisher, A).verticalReach, `finisher ${finisher}`)
        .toBeGreaterThanOrEqual(BODY_HEIGHT)
    }
  })
})

describe('staffTargets', () => {
  it('hits several enemies at once', () => {
    // The doc's stated purpose for the staff: several enemies, not one hard.
    const r = staffShape(false, A).range * 0.6
    const spread = [
      enemyAt('left', -r * 0.7, -r * 0.5),
      enemyAt('centre', 0, -r),
      enemyAt('right', r * 0.7, -r * 0.5),
    ]
    expect(staffTargets(ORIGIN, NORTH, false, spread, A).map((e) => e.id))
      .toEqual(['left', 'centre', 'right'])
  })

  it('ignores an enemy behind', () => {
    const behind = enemyAt('behind', 0, staffShape(false, A).range * 0.5)
    expect(staffTargets(ORIGIN, NORTH, false, [behind], A)).toHaveLength(0)
  })

  it('reaches enemies on the finisher that an opener misses', () => {
    const beyond = enemyAt('beyond', 0, -(staffShape(false, A).range + 0.3))
    expect(staffTargets(ORIGIN, NORTH, false, [beyond], A)).toHaveLength(0)
    expect(staffTargets(ORIGIN, NORTH, true, [beyond], A)).toHaveLength(1)
  })
})

describe('staffImpulse', () => {
  it('pushes outward, away from the player', () => {
    const target = at(0, -2)
    const push = staffImpulse(ORIGIN, target, false, A)
    const after = target.clone().addScaledVector(push, 0.1)
    expect(horizontalDistance(ORIGIN, after)).toBeGreaterThan(horizontalDistance(ORIGIN, target))
  })

  it('does not lift, unlike air', () => {
    // Lift belongs to bending. A staff sweep slides a soldier sideways; lifting one would
    // make it inert, which is the Vortex's job and would blur the two moves.
    expect(staffImpulse(ORIGIN, at(0, -2), true, A).y).toBe(0)
  })

  it('shoves harder on the finisher', () => {
    expect(staffImpulse(ORIGIN, at(0, -2), true, A).length())
      .toBeGreaterThan(staffImpulse(ORIGIN, at(0, -2), false, A).length())
  })

  it('stays finite for an enemy standing on the player', () => {
    // A target coincident with the caster still receives the configured shove, not zero.
    // Without the fallback, normalize() on a zero vector returns (0,0,0), not NaN, so the
    // impulse becomes zero and the guard against that silently vanishes. Magnitude assertion
    // catches it: zero-length impulse has magnitude 0, not the configured knockback.
    expect(staffImpulse(ORIGIN, ORIGIN.clone(), false, A).length())
      .toBeCloseTo(A.openerKnockback, 5)
    expect(staffImpulse(ORIGIN, ORIGIN.clone(), true, A).length())
      .toBeCloseTo(A.finisherKnockback, 5)
  })
})
