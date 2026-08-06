import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  idleSlipstream, canSlipstream, isInvulnerable, stepSlipstream, slipstreamHeading,
  dodgeHeading,
} from './slipstream'
import { DEFAULT_SLIPSTREAM_CONFIG as S, DEFAULT_FLIGHT_CONFIG } from '../core/config'

const NORTH = new Vector3(0, 0, -1)
const fire = (breath = S.breathCost) => stepSlipstream(idleSlipstream(), true, NORTH, breath, 1 / 60, S)

/** Advance an active slipstream by `seconds` with no further presses. */
function advance(state = fire().state, seconds = 0): typeof state {
  let current = state
  for (let t = 0; t < seconds; t += 1 / 60) {
    current = stepSlipstream(current, false, NORTH, 100, 1 / 60, S).state
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
    expect(canSlipstream(spent, 100, S)).toBe(false)
    expect(stepSlipstream(spent, true, NORTH, 100, 1 / 60, S).impulse).toBeNull()
  })

  it('is available again once the cooldown expires', () => {
    expect(canSlipstream(advance(undefined, S.cooldownSeconds + 0.05), 100, S)).toBe(true)
  })

  it('cannot fire twice inside one dash', () => {
    const active = fire().state
    expect(stepSlipstream(active, true, NORTH, 100, 1 / 60, S).impulse).toBeNull()
  })

  it('forwards the heading to the impulse', () => {
    // If heading is ignored entirely, this test fails; every other test before this
    // uses a heading that normalizes to the same vector.
    const impulse = stepSlipstream(
      idleSlipstream(), true, new Vector3(1, 0, 0), S.breathCost, 1 / 60, S,
    ).impulse
    expect(impulse?.x).toBeCloseTo(S.speed, 5)
    expect(impulse?.z).toBeCloseTo(0, 5)
  })

  it('no longer flattens the heading — it is passed straight through', () => {
    // The flatten that used to live here is gone; stepSlipstream now trusts whatever
    // direction it is handed, vertical component included.
    const impulse = stepSlipstream(
      idleSlipstream(), true, new Vector3(1, 1, 0), S.breathCost, 1 / 60, S,
    ).impulse
    expect(impulse?.length()).toBeCloseTo(S.speed, 5)
    expect(impulse?.y).toBeGreaterThan(0)
  })

  it('falls back to a fixed direction rather than producing NaN', () => {
    const impulse = stepSlipstream(
      idleSlipstream(), true, new Vector3(0, 0, 0), S.breathCost, 1 / 60, S,
    ).impulse
    expect(Number.isFinite(impulse?.x)).toBe(true)
    expect(impulse?.length()).toBeCloseTo(S.speed, 5)
  })
})

describe('a dodge costs breath', () => {
  it('does not fire when there is less breath than it costs', () => {
    const out = stepSlipstream(idleSlipstream(), true, NORTH, S.breathCost - 0.01, 1 / 60, S)
    expect(out.impulse).toBeNull()
  })

  it('does not spend the cooldown on a press it could not afford', () => {
    // The press has to be a no-op, not a wasted dodge. Spending the cooldown would
    // punish a player twice for being out of breath.
    const out = stepSlipstream(idleSlipstream(), true, NORTH, 0, 1 / 60, S)
    expect(out.state.cooldown).toBe(0)
    expect(out.state.elapsed).toBeNull()
  })

  it('fires at exactly its cost', () => {
    expect(stepSlipstream(idleSlipstream(), true, NORTH, S.breathCost, 1 / 60, S).impulse)
      .not.toBeNull()
  })

  it('reports exactly what it spent', () => {
    expect(stepSlipstream(idleSlipstream(), true, NORTH, 100, 1 / 60, S).breathSpent)
      .toBe(S.breathCost)
  })

  it('spends nothing on a frame with no dodge', () => {
    expect(stepSlipstream(idleSlipstream(), false, NORTH, 100, 1 / 60, S).breathSpent).toBe(0)
  })

  it('spends nothing on a press it could not afford', () => {
    expect(stepSlipstream(idleSlipstream(), true, NORTH, 0, 1 / 60, S).breathSpent).toBe(0)
  })

  it('costs more than thrust would to gain the same speed', () => {
    // The whole point of the number. Thrust buys thrustAccel per breathDrainPerSecond;
    // a dodge buys speed/cooldownSeconds per breathCost/cooldownSeconds. If the dodge
    // ever became the cheaper way to accelerate, chain-dodging would be optimal again.
    const thrustRatio = DEFAULT_FLIGHT_CONFIG.thrustAccel / DEFAULT_FLIGHT_CONFIG.breathDrainPerSecond
    const dodgeRatio = S.speed / S.breathCost
    expect(dodgeRatio).toBeLessThan(thrustRatio)
  })
})

describe('canSlipstream', () => {
  it('is false with too little breath even when off cooldown', () => {
    expect(canSlipstream(idleSlipstream(), S.breathCost - 0.01, S)).toBe(false)
  })

  it('is true with enough breath and no cooldown', () => {
    expect(canSlipstream(idleSlipstream(), S.breathCost, S)).toBe(true)
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

describe('dodgeHeading', () => {
  /**
   * Camera pointing north, glider flying east — deliberately different, so a call that
   * reads the wrong basis picks the wrong axis and fails rather than coinciding.
   */
  const FLYING_EAST = new Vector3(1, 0, 0)

  it('on foot, dodges forward along the camera', () => {
    expect(dodgeHeading('ground', FLYING_EAST, NORTH, 1, 0).z).toBeCloseTo(-1, 5)
  })

  it('on foot, still dodges backwards when back is held', () => {
    // On the ground S really is reverse, so this must keep working.
    expect(dodgeHeading('ground', FLYING_EAST, NORTH, -1, 0).z).toBeCloseTo(1, 5)
  })

  it('in the glider, a flare does not dodge backwards', () => {
    // The bug this exists to fix. In the glider S is a flare — raise the nose — not
    // reverse, so reading it as translation sent the dodge backwards for an input that
    // never meant "go back".
    expect(dodgeHeading('glider', FLYING_EAST, NORTH, -1, 0).x).toBeCloseTo(1, 5)
  })

  it('in the glider, thrust does not steer the dodge either', () => {
    // W is airbending thrust and holding it is the normal flying state, so if it steered
    // the dodge then almost every glider dodge would silently become a forward one.
    expect(dodgeHeading('glider', FLYING_EAST, NORTH, 1, 0).x).toBeCloseTo(1, 5)
  })

  it('in the glider, banking dodges sideways rather than along the heading', () => {
    // Perpendicular is the point: it is what beats something coming straight at you.
    const dodge = dodgeHeading('glider', FLYING_EAST, NORTH, 0, 1)
    expect(dodge.dot(FLYING_EAST)).toBeCloseTo(0, 5)
    expect(dodge.length()).toBeCloseTo(1, 5)
  })

  it('in the glider, uses the glider heading rather than the camera', () => {
    // The mouse only trims in the glider, so the heading is where the player is flying.
    const dodge = dodgeHeading('glider', FLYING_EAST, NORTH, 0, 0)
    expect(dodge.x).toBeCloseTo(1, 5)
    expect(dodge.z).toBeCloseTo(0, 5)
  })
})
