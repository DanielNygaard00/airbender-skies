import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  spawnProjectile, stepProjectile, type ProjectileConfig,
} from './projectile'

// Deliberately unlike anything shipped, so an assertion reading the real config instead
// of this one would be visible.
const C: ProjectileConfig = { hitRadius: 1, maxSeconds: 2 }

const flatGround = { groundHeightAt: () => 0 }
const noGround = { groundHeightAt: () => null }
const NORTH = new Vector3(0, 0, -1)
const DT = 1 / 60

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
      const step = stepProjectile(p, new Vector3(500, 500, 500), noGround, DT, C)
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
      const step = stepProjectile(p, new Vector3(0, 5, -2), noGround, DT, C)
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
      const step = stepProjectile(p, new Vector3(0, 5, -2), noGround, DT, C)
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
      const step = stepProjectile(p, new Vector3(3, 5, -2), noGround, DT, C)
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
      const step = stepProjectile(p, new Vector3(500, 500, 500), flatGround, DT, C)
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
      const step = stepProjectile(p, new Vector3(500, 500, 500), noGround, DT, C)
      if (!step.projectile) throw new Error('ended over the void, with no ground to end on')
      p = step.projectile
    }
    expect(p.position.y).toBeLessThan(-10)
  })

  it('expires after its lifetime rather than flying forever', () => {
    let p = arrow()
    let frames = 0
    for (let i = 0; i < 1000; i++) {
      const step = stepProjectile(p, new Vector3(500, 500, 500), noGround, DT, C)
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
    const step = stepProjectile(p, new Vector3(0, 0, 0), flatGround, DT, C)
    expect(step.damageToPlayer).toBeCloseTo(0.4)
    expect(step.projectile).toBe(null)
  })
})
