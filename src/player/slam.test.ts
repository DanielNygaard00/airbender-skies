import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { detectSlam, applyBounce } from './slam'
import type { PressureWaveConfig } from '../combat/pressure-wave'
import type { PlayerState } from '../core/types'

const C: PressureWaveConfig = {
  minImpactSpeed: 10,
  fullImpactSpeed: 50,
  minRadius: 4,
  maxRadius: 12,
  minDamage: 0.5,
  maxDamage: 2.5,
  minKnockback: 10,
  maxKnockback: 30,
  bounceFactor: 0.5,
  focusAtFullImpact: 20,
}

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: false, lastGroundIslandId: null, airJumpsUsed: 1, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, ...over,
})

/** Falling at `speed`, then landed: velocity.y is zeroed by the landing. */
const falling = (speed: number) => p({ grounded: false, velocity: new Vector3(3, -speed, 0) })
const landed = () => p({ grounded: true, velocity: new Vector3(3, 0, 0) })

describe('detectSlam', () => {
  it('reports a slam for a committed landing above the floor', () => {
    const slam = detectSlam(falling(30), landed(), true, false, C)
    expect(slam).not.toBeNull()
    expect(slam?.impactSpeed).toBeCloseTo(30)
    expect(slam?.strength).toBeCloseTo(0.5)
  })

  it('reads the impact from the frame before the landing', () => {
    // The landing zeroes velocity.y, so reading `after` would make every slam a
    // zero-speed slam. This is the regression guard for that.
    const slam = detectSlam(falling(40), landed(), true, false, C)
    expect(slam?.impactSpeed).toBeCloseTo(40)
  })

  it('reports nothing without the commit key', () => {
    expect(detectSlam(falling(40), landed(), false, false, C)).toBeNull()
  })

  it('reports nothing for a landing softer than the floor', () => {
    // A normal jump lands at about 9 m/s. Hopping must not be an attack.
    expect(detectSlam(falling(9), landed(), true, false, C)).toBeNull()
  })

  it('reports nothing after a respawn, however fast the fall was', () => {
    // Regression guard for the death plunge: respawning also sets grounded true, and
    // the fall speed is enormous, so without this a death would be the biggest slam
    // in the game.
    expect(detectSlam(falling(400), landed(), true, true, C)).toBeNull()
  })

  it('reports nothing while staying airborne', () => {
    expect(detectSlam(falling(40), falling(45), true, false, C)).toBeNull()
  })

  it('reports nothing while staying grounded', () => {
    // Walking around with Ctrl held must not slam every frame. Fast downward velocity
    // on `before` so this exercises the grounded-transition guard itself rather than
    // being masked by the minImpactSpeed cutoff (velocity.y = 0 would pass either way).
    const groundedFast = p({ grounded: true, velocity: new Vector3(3, -40, 0) })
    expect(detectSlam(groundedFast, landed(), true, false, C)).toBeNull()
  })

  it('reports nothing for a rising player, even with the key held', () => {
    const rising = p({ grounded: false, velocity: new Vector3(0, 25, 0) })
    expect(detectSlam(rising, landed(), true, false, C)).toBeNull()
  })

  it('caps strength at one for an enormous impact', () => {
    expect(detectSlam(falling(300), landed(), true, false, C)?.strength).toBe(1)
  })
})

describe('applyBounce', () => {
  it('throws the player back up in proportion to the impact', () => {
    const bounced = applyBounce(landed(), { impactSpeed: 40, strength: 0.75 }, C)
    // bounceFactor 0.5 of a 40 m/s impact.
    expect(bounced.velocity.y).toBeCloseTo(20)
  })

  it('leaves the ground, so the bounce is not swallowed by the ground snap', () => {
    expect(applyBounce(landed(), { impactSpeed: 40, strength: 0.75 }, C).grounded).toBe(false)
  })

  it('refreshes the air jump, which is what makes the re-deploy reachable', () => {
    const before = p({ grounded: true, airJumpsUsed: 1 })
    expect(applyBounce(before, { impactSpeed: 40, strength: 0.75 }, C).airJumpsUsed).toBe(0)
  })

  it('keeps the horizontal momentum', () => {
    // The doc is explicit that landing never hard-stops the player.
    const bounced = applyBounce(landed(), { impactSpeed: 40, strength: 0.75 }, C)
    expect(bounced.velocity.x).toBeCloseTo(3)
  })

  it('does not alias the velocity it was handed', () => {
    const before = landed()
    applyBounce(before, { impactSpeed: 40, strength: 0.75 }, C)
    expect(before.velocity.y).toBeCloseTo(0)
  })
})
