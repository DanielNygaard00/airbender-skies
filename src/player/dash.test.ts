import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { idleDash, stepDash, canDash, dashDecay } from './dash'
import { DEFAULT_GROUND_CONFIG as C } from '../core/config'

const NORTH = new Vector3(0, 0, -1)
const step = (state = idleDash(), pressed = true, grounded = true) =>
  stepDash(state, pressed, NORTH, grounded, 1 / 60, C)

describe('the dash chain', () => {
  it('fires on a press', () => {
    expect(step().impulse).not.toBeNull()
  })

  it('does nothing without a press', () => {
    expect(step(idleDash(), false).impulse).toBeNull()
  })

  it('chains exactly three times before owing recovery', () => {
    let state = idleDash()
    let fired = 0
    for (let i = 0; i < 5; i++) {
      const result = step(state)
      if (result.impulse) fired++
      state = result.state
    }
    expect(fired).toBe(C.maxDashChain)
  })

  it('owes recovery only once the chain is spent', () => {
    let state = idleDash()
    state = step(state).state
    expect(state.recovery).toBe(0)
    state = step(state).state
    state = step(state).state
    expect(state.recovery).toBeGreaterThan(0)
  })

  it('never expires an unspent chain', () => {
    // A player who dashes once then runs for a while still has two in hand: the
    // move is a tool, not a timer to watch.
    let state = step().state
    for (let t = 0; t < 5; t += 1 / 60) state = step(state, false).state
    expect(canDash(state, C)).toBe(true)
  })

  it('restores the chain after the recovery elapses', () => {
    let state = idleDash()
    for (let i = 0; i < C.maxDashChain; i++) state = step(state).state
    expect(canDash(state, C)).toBe(false)
    for (let t = 0; t < C.dashRecoverySeconds + 0.1; t += 1 / 60) {
      state = step(state, false).state
    }
    expect(canDash(state, C)).toBe(true)
  })
})

describe('the dash impulse', () => {
  it('pushes along the heading', () => {
    const impulse = step().impulse
    expect(impulse!.z).toBeLessThan(0)
    expect(impulse!.length()).toBeCloseTo(C.dashSpeed, 4)
  })

  it('stays horizontal even from a heading that points up', () => {
    // A dash is ground-shed thrust, not a jump.
    const climbing = stepDash(idleDash(), true, new Vector3(0, 5, -1), true, 1 / 60, C)
    expect(climbing.impulse!.y).toBe(0)
  })

  it('falls back to a sane direction from a degenerate heading', () => {
    const nowhere = stepDash(idleDash(), true, new Vector3(0, 1, 0), true, 1 / 60, C)
    expect(nowhere.impulse!.length()).toBeCloseTo(C.dashSpeed, 4)
  })

  it('decays rather than being a permanent speed gain', () => {
    // Otherwise chaining dashes would compound into unbounded velocity.
    expect(dashDecay(0, C)).toBeCloseTo(1, 6)
    expect(dashDecay(C.dashDurationSeconds, C)).toBeCloseTo(0, 6)
    expect(dashDecay(C.dashDurationSeconds / 2, C)).toBeCloseTo(0.5, 6)
  })

  it('never reports negative decay past the end of the burst', () => {
    expect(dashDecay(C.dashDurationSeconds * 10, C)).toBe(0)
  })
})

describe('the dash is ground-shed thrust', () => {
  it('does not fire in mid-air', () => {
    // The doc files it under the ground layer: there is nothing to push off up
    // there, and an air dash would double as a second air jump.
    expect(stepDash(idleDash(), true, NORTH, false, 1 / 60, C).impulse).toBeNull()
  })

  it('still fires from the ground', () => {
    expect(stepDash(idleDash(), true, NORTH, true, 1 / 60, C).impulse).not.toBeNull()
  })
})
