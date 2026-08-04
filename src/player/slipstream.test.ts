import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  idleSlipstream, canSlipstream, isInvulnerable, stepSlipstream, slipstreamHeading,
} from './slipstream'
import { DEFAULT_SLIPSTREAM_CONFIG as S } from '../core/config'

const NORTH = new Vector3(0, 0, -1)
const fire = () => stepSlipstream(idleSlipstream(), true, NORTH, 1 / 60, S)

/** Advance an active slipstream by `seconds` with no further presses. */
function advance(state = fire().state, seconds = 0): typeof state {
  let current = state
  for (let t = 0; t < seconds; t += 1 / 60) {
    current = stepSlipstream(current, false, NORTH, 1 / 60, S).state
  }
  return current
}

describe('stepSlipstream', () => {
  it('fires when available, with an impulse along the heading', () => {
    const { impulse } = fire()
    expect(impulse).not.toBeNull()
    expect(impulse?.z).toBeCloseTo(-S.speed, 5)
  })

  it('is invulnerable the moment it fires', () => {
    expect(isInvulnerable(fire().state, S)).toBe(true)
  })

  it('stops being invulnerable while still dashing', () => {
    // The window is SHORTER than the dash, and that is what makes the timing tight:
    // you stay committed to a direction after the protection ends. A test that only
    // checked invulnerability at t=0 would pass against a move that is invulnerable
    // for its whole duration.
    const midway = advance(undefined, (S.invulnerableSeconds + S.durationSeconds) / 2)
    expect(midway.elapsed).not.toBeNull()
    expect(isInvulnerable(midway, S)).toBe(false)
  })

  it('ends after its duration', () => {
    expect(advance(undefined, S.durationSeconds + 0.05).elapsed).toBeNull()
  })

  it('cannot fire again while on cooldown', () => {
    const spent = advance(undefined, S.durationSeconds + 0.05)
    expect(spent.cooldown).toBeGreaterThan(0)
    expect(canSlipstream(spent)).toBe(false)
    expect(stepSlipstream(spent, true, NORTH, 1 / 60, S).impulse).toBeNull()
  })

  it('is available again once the cooldown expires', () => {
    expect(canSlipstream(advance(undefined, S.cooldownSeconds + 0.05))).toBe(true)
  })

  it('cannot fire twice inside one dash', () => {
    const active = fire().state
    expect(stepSlipstream(active, true, NORTH, 1 / 60, S).impulse).toBeNull()
  })

  it('forwards the heading to the impulse', () => {
    // If heading is ignored entirely, this test fails; every other test before this
    // uses a heading that normalizes to the same vector.
    const impulse = stepSlipstream(
      idleSlipstream(), true, new Vector3(1, 0, 0), 1 / 60, S,
    ).impulse
    expect(impulse?.x).toBeCloseTo(S.speed, 5)
    expect(impulse?.z).toBeCloseTo(0, 5)
  })

  it('flattens the heading, so looking up does not launch you', () => {
    // Heading with a real horizontal component and a vertical component.
    // Flattening should preserve the x while zeroing y.
    const impulse = stepSlipstream(
      idleSlipstream(), true, new Vector3(1, 5, 0), 1 / 60, S,
    ).impulse
    expect(impulse?.y).toBe(0)
    // The horizontal component must be preserved at full speed.
    expect(impulse?.length()).toBeCloseTo(S.speed, 5)
    expect(impulse?.x).toBeCloseTo(S.speed, 5)
  })

  it('falls back to a fixed direction rather than producing NaN', () => {
    const impulse = stepSlipstream(
      idleSlipstream(), true, new Vector3(0, 1, 0), 1 / 60, S,
    ).impulse
    expect(Number.isFinite(impulse?.x)).toBe(true)
    expect(impulse?.length()).toBeCloseTo(S.speed, 5)
  })
})

describe('slipstreamHeading', () => {
  it('uses the look direction when no movement is held', () => {
    expect(slipstreamHeading(NORTH, 0, 0).z).toBeCloseTo(-1, 5)
  })

  it('dodges sideways when strafe is held', () => {
    // A dodge has to be able to go somewhere other than where you are looking.
    expect(slipstreamHeading(NORTH, 0, 1).x).toBeCloseTo(1, 5)
  })

  it('dodges backwards when back is held', () => {
    expect(slipstreamHeading(NORTH, -1, 0).z).toBeCloseTo(1, 5)
  })

  it('stays normalised on a diagonal', () => {
    expect(slipstreamHeading(NORTH, 1, 1).length()).toBeCloseTo(1, 5)
  })
})
