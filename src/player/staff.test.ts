import { describe, it, expect } from 'vitest'
import {
  idleStaff, isSwinging, staffBusy, staffOf, stepStaff,
} from './staff'
import type { StaffState } from './staff'
import { DEFAULT_STAFF_CONFIG as S } from '../core/config'

/** Press once from the given state. */
const press = (state = idleStaff()) => stepStaff(state, true, 1 / 60, S)
/** Let time pass with no press. */
function wait(state: ReturnType<typeof idleStaff>, seconds: number) {
  let s = state
  for (let t = 0; t < seconds; t += 1 / 60) s = stepStaff(s, false, 1 / 60, S).state
  return s
}
/** Press, let the swing finish, press again — the shortest legal continuation. */
function chain(times: number) {
  let s = idleStaff()
  const started = []
  for (let i = 0; i < times; i++) {
    const swung = stepStaff(s, true, 1 / 60, S)
    s = swung.state
    started.push(swung.started)
    s = wait(s, S.swingSeconds)
  }
  return { state: s, started }
}

describe('stepStaff', () => {
  it('starts a swing on a press', () => {
    const { started, state } = press()
    expect(started).not.toBeNull()
    expect(started?.index).toBe(1)
    expect(started?.finisher).toBe(false)
    expect(isSwinging(state)).toBe(true)
  })

  it('reports nothing on frames with no press', () => {
    expect(stepStaff(idleStaff(), false, 1 / 60, S).started).toBeNull()
  })

  it('ignores a press while a swing is already running', () => {
    // Mashing must not stack swings on top of each other.
    const swinging = press().state
    expect(stepStaff(swinging, true, 1 / 60, S).started).toBeNull()
  })

  it('continues the combo when pressed inside the window', () => {
    const { started } = chain(2)
    expect(started[1]?.index).toBe(2)
  })

  it('marks only the last swing of the chain as the finisher', () => {
    const { started } = chain(S.maxChain)
    expect(started.slice(0, -1).every((s) => s?.finisher === false)).toBe(true)
    expect(started[S.maxChain - 1]?.finisher).toBe(true)
  })

  it('resets the chain when the continue window lapses', () => {
    let s = press().state
    s = wait(s, S.swingSeconds + S.continueSeconds + S.recoverySeconds + 0.1)
    expect(stepStaff(s, true, 1 / 60, S).started?.index).toBe(1)
  })

  it('resolves a press-vs-lapse tie in the press\'s favour', () => {
    // On the frame where sinceSwing + dt would cross continueSeconds, the press still
    // wins: `free` in stepStaff deliberately checks only `recovery`/`chain`, not
    // `sinceSwing`, so a press this frame continues the combo instead of the window
    // being treated as already lapsed. That's a design choice — input leniency at a
    // frame's width beats a combo that intermittently refuses to continue at exactly
    // the wrong moment — not an oversight. Nothing else pins it down: adding a
    // `sinceSwing` check to `free` as a "tidy-up" would flip this silently and pass
    // every other test.
    //
    // Built directly rather than played forward with `wait`, so the boundary is exact
    // instead of resting on however dt happens to accumulate in floating point.
    const dt = 0.01
    const s: StaffState = {
      chain: 1, elapsed: null, recovery: 0, sinceSwing: S.continueSeconds - 0.001,
    }
    const { started } = stepStaff(s, true, dt, S)
    expect(started).not.toBeNull()
    // Both halves matter: a restarted combo would also "land a swing" at index 1.
    expect(started?.index).toBe(2)
  })

  it('will not exceed the chain length', () => {
    // A press after the finisher lands during recovery, and recovery is not a swing.
    const { state } = chain(S.maxChain)
    expect(stepStaff(state, true, 1 / 60, S).started).toBeNull()
  })

  it('owes recovery once the combo ends', () => {
    const { state } = chain(S.maxChain)
    const after = wait(state, S.swingSeconds)
    expect(isSwinging(after)).toBe(false)
    expect(staffBusy(after)).toBe(true)
  })

  it('does not extend recovery when mashed', () => {
    // Recovery is the price of the combo, not a punishment for pressing again.
    let a = wait(chain(S.maxChain).state, S.swingSeconds)
    let b = a
    for (let t = 0; t < 0.1; t += 1 / 60) {
      a = stepStaff(a, true, 1 / 60, S).state
      b = stepStaff(b, false, 1 / 60, S).state
    }
    expect(a.recovery).toBeCloseTo(b.recovery, 6)
  })

  it('is free again once recovery expires', () => {
    const spent = wait(chain(S.maxChain).state, S.swingSeconds + S.recoverySeconds + 0.05)
    expect(staffBusy(spent)).toBe(false)
    expect(stepStaff(spent, true, 1 / 60, S).started?.index).toBe(1)
  })
})

describe('staffBusy', () => {
  it('is true while swinging and while recovering, and false when idle', () => {
    expect(staffBusy(idleStaff())).toBe(false)
    expect(staffBusy(press().state)).toBe(true)
    expect(staffBusy(wait(chain(S.maxChain).state, S.swingSeconds))).toBe(true)
  })

  it('stays busy with no gap from the first swing through the end of recovery', () => {
    // A single swing (not a full combo), sampled once inside each of the three phases
    // the commitment is supposed to span, plus once after it lets go. Every offset is
    // derived from DEFAULT_STAFF_CONFIG rather than hardcoded, so this walks whatever
    // timings the config actually has.
    const started = press().state

    // Mid-swing.
    expect(staffBusy(wait(started, S.swingSeconds / 2))).toBe(true)

    const afterSwing = wait(started, S.swingSeconds)
    expect(isSwinging(afterSwing)).toBe(false) // swing just ended, window now open

    // Inside the continue window. This is the sample that used to be wrong:
    // `isSwinging(s) || s.recovery > 0` is false here — `elapsed` is null and nothing
    // is owed yet — so the old expression reported the staff free in the middle of a
    // live combo.
    expect(staffBusy(wait(afterSwing, S.continueSeconds / 2))).toBe(true)

    const afterWindowLapses = wait(afterSwing, S.continueSeconds + 0.01)
    expect(isSwinging(afterWindowLapses)).toBe(false)

    // During recovery, after the window has lapsed.
    expect(staffBusy(wait(afterWindowLapses, S.recoverySeconds / 2))).toBe(true)

    // Free once recovery has fully decayed.
    expect(staffBusy(wait(afterWindowLapses, S.recoverySeconds + 0.01))).toBe(false)
  })
})

describe('staffOf', () => {
  it('reads the four flat player fields', () => {
    const s = staffOf({
      staffChain: 2, staffElapsed: 0.1, staffRecovery: 0, staffSinceSwing: 0,
    })
    expect(s).toEqual({ chain: 2, elapsed: 0.1, recovery: 0, sinceSwing: 0 })
  })
})
