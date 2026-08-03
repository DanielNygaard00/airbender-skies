import { describe, it, expect } from 'vitest'
import {
  armFraction, isActive, isArmed, restingAvatarState, stepAvatarState,
  type AvatarState, type AvatarStateConfig,
} from './avatar-state'
import type { Focus } from './focus'

const C: AvatarStateConfig = {
  armSeconds: 4,
  durationSeconds: 8,
  gustDamageMultiplier: 3,
  gustKnockbackMultiplier: 1.5,
  surgeAccelMultiplier: 2,
  relentFactor: 0.2,
}

const FULL: Focus = { value: 100, max: 100, chainTime: 30 }
const PARTIAL: Focus = { value: 99, max: 100, chainTime: 30 }

/** Hold the trigger unpressed and feed one-second frames of full Focus. */
function charge(seconds: number): AvatarState {
  let state = restingAvatarState()
  for (let i = 0; i < seconds; i++) {
    state = stepAvatarState(state, FULL, false, 1, C).state
  }
  return state
}

describe('stepAvatarState', () => {
  it('arms only after Focus has been held at maximum long enough', () => {
    expect(isArmed(charge(3), C)).toBe(false)
    expect(isArmed(charge(4), C)).toBe(true)
  })

  it('does not arm from Focus below maximum, however long it is held', () => {
    let state = restingAvatarState()
    for (let i = 0; i < 20; i++) state = stepAvatarState(state, PARTIAL, false, 1, C).state
    expect(state.armTime).toBe(0)
    expect(isArmed(state, C)).toBe(false)
  })

  it('loses the charge the moment Focus drops below maximum', () => {
    // The disarm rule: one spear hit drains Focus and takes the charge with it.
    const nearlyArmed = charge(3)
    expect(nearlyArmed.armTime).toBeCloseTo(3)
    const after = stepAvatarState(nearlyArmed, PARTIAL, false, 1, C).state
    expect(after.armTime).toBe(0)
  })

  it('does nothing when the trigger is pressed unarmed', () => {
    const step = stepAvatarState(charge(2), FULL, true, 1, C)
    expect(step.active).toBe(false)
    expect(step.state.remaining).toBe(0)
  })

  it('is active on the same frame the trigger fires', () => {
    // No dead frame: the effects have to apply from the frame the player pressed.
    const step = stepAvatarState(charge(4), FULL, true, 1 / 60, C)
    expect(step.active).toBe(true)
    expect(step.state.remaining).toBeCloseTo(8)
  })

  it('runs for its full duration and ends exactly once', () => {
    let state = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    let ends = 0
    let activeFrames = 0
    for (let i = 0; i < 8; i++) {
      const step = stepAvatarState(state, FULL, false, 1, C)
      state = step.state
      if (step.active) activeFrames++
      if (step.justEnded) ends++
    }
    expect(activeFrames).toBe(8)
    expect(ends).toBe(1)
    expect(isActive(state)).toBe(false)
  })

  it('cannot be extended by pressing the trigger again while it runs', () => {
    const started = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    const after = stepAvatarState(started, FULL, true, 3, C).state
    expect(after.remaining).toBeCloseTo(5)
  })

  it('cannot re-arm from the maximum Focus it is holding frozen', () => {
    // Focus is frozen at full during the state, so an accumulating armTime would
    // hand the player a second charge for free the instant the first one ended.
    let state = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    for (let i = 0; i < 6; i++) {
      state = stepAvatarState(state, FULL, false, 1, C).state
      expect(state.armTime).toBe(0)
    }
  })

  it('reports the end without leaving a negative timer behind', () => {
    const started = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    const step = stepAvatarState(started, FULL, false, 20, C)
    expect(step.justEnded).toBe(true)
    expect(step.state.remaining).toBe(0)
  })
})

describe('armFraction', () => {
  it('reports progress toward the charge', () => {
    expect(armFraction(charge(2), C)).toBeCloseTo(0.5)
    expect(armFraction(charge(4), C)).toBeCloseTo(1)
  })

  it('is zero while the state is running, so the HUD pip hides', () => {
    const started = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    expect(armFraction(started, C)).toBe(0)
  })
})

describe('isArmed', () => {
  it('is false while the state is already running', () => {
    const started = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    expect(isArmed(started, C)).toBe(false)
  })
})
