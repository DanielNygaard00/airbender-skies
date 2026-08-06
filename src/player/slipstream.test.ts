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
    expect(dodgeHeading('ground', FLYING_EAST, NORTH, 1, 0, 0).z).toBeCloseTo(-1, 5)
  })

  it('on foot, still dodges backwards when back is held', () => {
    // On the ground S really is reverse, so this must keep working.
    expect(dodgeHeading('ground', FLYING_EAST, NORTH, -1, 0, 0).z).toBeCloseTo(1, 5)
  })

  it('in the glider, a flare does not dodge backwards', () => {
    // The bug this exists to fix. In the glider S is a flare — raise the nose — not
    // reverse, so reading it as translation sent the dodge backwards for an input that
    // never meant "go back". The forward axis is not read at all in this posture now, so
    // the dodge lands on the default side (the positive glider-right axis), nowhere near
    // "backward along the heading", which would show up as x close to -1.
    expect(dodgeHeading('glider', FLYING_EAST, NORTH, -1, 0, 0).x).toBeCloseTo(0, 5)
    expect(dodgeHeading('glider', FLYING_EAST, NORTH, -1, 0, 0).z).toBeCloseTo(1, 5)
  })

  it('in the glider, thrust does not steer the dodge either', () => {
    // W is airbending thrust and holding it is the normal flying state, so if it steered
    // the dodge then almost every glider dodge would silently become a forward one.
    // Checked by comparison against the flare case above: the forward axis flips sign
    // between the two calls and the result does not move at all.
    const withFlare = dodgeHeading('glider', FLYING_EAST, NORTH, -1, 0, 0)
    const withThrust = dodgeHeading('glider', FLYING_EAST, NORTH, 1, 0, 0)
    expect(withThrust.x).toBeCloseTo(withFlare.x, 5)
    expect(withThrust.z).toBeCloseTo(withFlare.z, 5)
  })

  it('in the glider, banking dodges sideways rather than along the heading', () => {
    // Perpendicular is the point: it is what beats something coming straight at you.
    // But dot 0 and length 1 alone don't discriminate much: the pre-Task-2 fallback
    // (slipstreamHeading(FLYING_EAST, 0, 1), the flattened-heading bug) happens to give
    // the identical (0,0,1) for this exact heading and strafe, so it passes both checks
    // too, coincidentally -- that regression is what the flare and thrust tests above
    // actually catch. The exact component below is what pins this test's own case,
    // and it does catch the handedness bug (gliderRight returning the mirrored axis):
    // that neutralisation gives (0,0,-1) here, not (0,0,1).
    const dodge = dodgeHeading('glider', FLYING_EAST, NORTH, 0, 1, 0)
    expect(dodge.dot(FLYING_EAST)).toBeCloseTo(0, 5)
    expect(dodge.length()).toBeCloseTo(1, 5)
    expect(dodge.z).toBeCloseTo(1, 5)
  })

  it('in the glider, uses the glider heading rather than the camera', () => {
    // The mouse only trims in the glider, so the heading is where the player is flying.
    // FLYING_EAST and NORTH are deliberately different (see the comment above): reading
    // the camera by mistake here would put the dodge on a different axis than the one
    // gliderRight(FLYING_EAST, 0) actually produces.
    const dodge = dodgeHeading('glider', FLYING_EAST, NORTH, 0, 0, 0)
    expect(dodge.x).toBeCloseTo(0, 5)
    expect(dodge.z).toBeCloseTo(1, 5)
  })

  it('dodges the same world direction that a ground dodge calls right, for a positive strafe', () => {
    // The handedness bug this exists to catch: gliderRight shipped once returning the
    // glider's left axis, so D (positive strafe) dodged world-right on foot and
    // world-left in the glider -- the same key, opposite directions, depending only on
    // posture. A relationship between two glider calls, or a perpendicularity check,
    // cannot see that: both sides of a mirrored pair are still perpendicular and still
    // each other's negation. This compares against the ground dodge's own right for the
    // same heading, which is the actual, player-facing thing that has to agree.
    const forward = new Vector3(0, 0, -1)
    const groundRight = dodgeHeading('ground', forward, forward, 0, 1, 0)
    const gliderRightDodge = dodgeHeading('glider', forward, forward, 0, 1, 0)
    expect(Math.sign(gliderRightDodge.x)).toBe(Math.sign(groundRight.x))
    expect(groundRight.x).toBeGreaterThan(0)
  })
})

describe('a glider dodge goes across the flight path, not along it', () => {
  it('is perpendicular to the heading when no bank is held', () => {
    // The defect: this used to fall back to the flattened heading, so the most common
    // press -- nobody holds A or D continuously -- was a 30 m/s forward boost with
    // invulnerability attached.
    const forward = new Vector3(0, 0, -1)
    const heading = dodgeHeading('glider', forward, new Vector3(0, 0, -1), 0, 0, 0)
    expect(Math.abs(heading.dot(forward))).toBeLessThan(1e-6)
  })

  it('is horizontal when the wings are level, even diving', () => {
    // The deliberate baseline, not an accident: with bank 0 there is no roll for a
    // vertical component to ride on, so the lateral break stays flat regardless of how
    // steep the dive is. gliderRight(forward, 0) is horizontal for every heading -- see
    // the next test for what changes once bank is nonzero.
    const diving = new Vector3(0, -1, -1).normalize()
    const heading = dodgeHeading('glider', diving, NORTH, 0, 1, 0)
    expect(Math.abs(heading.y)).toBeLessThan(1e-6)
  })

  it('picks up a vertical component when the dodge is thrown banked', () => {
    // The real deliverable, and the property that was unsatisfiable before bank was
    // threaded through to gliderRight: a dodge thrown while rolled carries the roll's
    // vertical component with it, the same way a real bank turns a level break into a
    // climbing or diving one.
    const forward = new Vector3(0, 0, -1)
    const heading = dodgeHeading('glider', forward, NORTH, 0, 1, 0.6)
    expect(Math.abs(heading.y)).toBeGreaterThan(0.1)
  })

  it('takes its side from the strafe axis, independent of the bank value -- in isolation', () => {
    // Not "the bank axis" -- that name would collide with the real bank parameter above,
    // which rolls the frame the side is chosen within but does not choose the side
    // itself. Side selection is strafeAxis's job in both calls.
    //
    // The same bank, 0.6, on BOTH sides here on purpose: this tests dodgeHeading's own
    // code in isolation from the coupling controllerStep actually applies (bank locked to
    // the same strafe that picks the side, so left and right never really share a bank
    // value in production -- see the next test for that pairing). Held equal like this,
    // bank cannot be the thing choosing the side, because it is identical on both calls;
    // only strafeAxis differs, and only the side differs in the result.
    const forward = new Vector3(0, 0, -1)
    const left = dodgeHeading('glider', forward, NORTH, 0, -1, 0.6)
    const right = dodgeHeading('glider', forward, NORTH, 0, 1, 0.6)
    expect(left.dot(right)).toBeLessThan(-0.9)
  })

  it('the production pairing (bank locked to strafe) still opposes on x, and matches on y', () => {
    // What controllerStep actually produces: bank = strafe * 0.6, so left and right carry
    // opposite bank too, not just opposite strafe. left.dot(right) is -0.362 here, not the
    // near-total opposition the isolated test above gets with a shared bank -- documented
    // rather than asserted as "less than -0.9", because that bound is simply false under
    // this coupling, and a test asserting it would either be wrong or would have to have
    // its bound quietly loosened until it stopped meaning what it said.
    //
    // What is still true, and worth pinning: the two sides still oppose horizontally (x
    // has the opposite sign), and per dodgeHeading's comment on the coupling, the roll
    // both sides carry currently pushes the same way vertically -- not opposite, matching.
    const forward = new Vector3(0, 0, -1)
    const left = dodgeHeading('glider', forward, NORTH, 0, -1, -1 * 0.6)
    const right = dodgeHeading('glider', forward, NORTH, 0, 1, 1 * 0.6)
    expect(Math.sign(left.x)).not.toBe(Math.sign(right.x))
    expect(Math.sign(left.y)).toBe(Math.sign(right.y))
    expect(left.dot(right)).toBeCloseTo(-0.362, 3)
  })

  it('stepSlipstream passes a 3D heading straight through, without flattening it', () => {
    // A property of stepSlipstream itself, independent of how the heading was produced.
    // It used to matter for a narrower reason -- a diving glider dodge was flattened
    // onto the ground plane before this function ever saw it, because gliderRight was
    // always called with bank fixed at 0 -- but that reason has since moved: dodgeHeading
    // can now produce a heading with a vertical component on its own (see the banked-dodge
    // test above). This still exercises stepSlipstream directly, with a heading that is
    // not itself constrained to be horizontal, so the assertion keeps meaning what its
    // name says regardless of how dodgeHeading's own logic changes later.
    const diving = new Vector3(0, -1, -1).normalize()
    const out = stepSlipstream(idleSlipstream(), true, diving, 100, 1 / 60, S)
    expect(Math.abs(out.impulse!.y)).toBeGreaterThan(0.1)
  })

  it('leaves the ground dodge horizontal and camera-relative', () => {
    // The ground rule is unchanged, including that it can go backwards. Asserted here
    // because Task 1 removed the flatten from stepSlipstream, and this is what proves
    // that removal did not leak into the posture that wants flat.
    const back = dodgeHeading('ground', NORTH, new Vector3(0, 0.7, -0.7).normalize(), -1, 0, 0)
    // toBeCloseTo rather than toBe: the arithmetic here can land on -0 rather than 0
    // depending on the signs multiplied through, and -0 is exactly horizontal too --
    // Object.is would fail a case that has nothing wrong with it.
    expect(back.y).toBeCloseTo(0, 6)
    expect(back.z).toBeGreaterThan(0)
  })
})
