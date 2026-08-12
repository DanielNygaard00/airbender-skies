import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { detectSlam, applyBounce } from './slam'
import { willRespawn } from './controller'
import type { PressureWaveConfig } from '../combat/pressure-wave'
import type { PlayerState } from '../core/types'

/** Arbitrary; only needs to sit below every fixture's position.y. */
const WORLD_FLOOR_Y = -500

const C: PressureWaveConfig = {
  minImpactSpeed: 10,
  fullImpactSpeed: 50,
  minRadius: 4,
  maxRadius: 12,
  // Unused by this module: `detectSlam` and `applyBounce` decide whether a slam happened and
  // how hard it rebounds, never who it caught. Present because the type requires it.
  verticalReach: 4,
  minDamage: 0.5,
  maxDamage: 2.5,
  minKnockback: 10,
  maxKnockback: 30,
  bounceFactor: 0.5,
}

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: false, lastGroundIslandId: null, airJumpsUsed: 1, chargeTime: 0,
  coyoteTime: 0, jumpBuffer: 0,
  scooterActive: false, scooterCharge: 0, wallRideNormal: null, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, ...over,
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

  it('reports nothing for a non-finite-triggered respawn, not just a floor-triggered one', () => {
    // Regression guard: `willRespawn` covers two independent respawn triggers —
    // falling past the world floor, and any tracked field going non-finite — and
    // both land the player grounded from whatever fall speed was in flight. A guard
    // fed only `fellOutOfWorld` would miss the second trigger and let a corruption
    // respawn read as a full-strength slam at the spawn point.
    const corrupted = falling(50)
    corrupted.chargeTime = NaN
    expect(corrupted.position.y).toBeGreaterThan(WORLD_FLOOR_Y) // not floor-triggered
    expect(willRespawn(corrupted, WORLD_FLOOR_Y)).toBe(true)
    const respawned = willRespawn(corrupted, WORLD_FLOOR_Y)
    expect(detectSlam(corrupted, landed(), true, respawned, C)).toBeNull()
  })

  it('reports nothing for a NaN vertical velocity, rather than failing open', () => {
    // `impactSpeed < c.minImpactSpeed` is false for NaN, which would let a NaN
    // impact speed through into `strength` and poison `focus.value` with NaN for the
    // rest of the session. The guard reads the negated form instead.
    const nanFalling = p({ grounded: false, velocity: new Vector3(3, NaN, 0) })
    expect(detectSlam(nanFalling, landed(), true, false, C)).toBeNull()
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

  it('resets the air jump count to zero', () => {
    const before = p({ grounded: true, airJumpsUsed: 1 })
    expect(applyBounce(before, { impactSpeed: 40, strength: 0.75 }, C).airJumpsUsed).toBe(0)
  })

  it('closes the coyote window, so a tap cannot override the bounce', () => {
    // A slam is read off a grounded frame, and a grounded frame is exactly where groundStep
    // leaves the window full. Carried into the air alongside `grounded: false`, that window
    // is a free ground jump for the next six frames -- and a ground jump *replaces* the
    // bounce's velocity with a smaller one. `ground-move.test.ts` measures the height that
    // costs; this is the field it comes down to.
    const inWindow = p({ grounded: true, velocity: new Vector3(3, 0, 0), coyoteTime: 0.1 })
    expect(applyBounce(inWindow, { impactSpeed: 40, strength: 0.75 }, C).coyoteTime).toBe(0)
  })

  it('leaves a buffered press alone, because the air is where it decays', () => {
    // The deliberate asymmetry with the line above. Unlike the window, the buffer is not
    // pinned by being grounded, so `grounded: false` hands it back to groundStep's normal
    // countdown rather than freezing it. Nor can a buffered press eat a slam: it fires only
    // from a state that was already grounded, and detectSlam refuses a frame whose
    // predecessor was.
    const buffered = p({ grounded: true, velocity: new Vector3(3, 0, 0), jumpBuffer: 0.07 })
    expect(applyBounce(buffered, { impactSpeed: 40, strength: 0.75 }, C).jumpBuffer).toBe(0.07)
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
