import { describe, it, expect } from 'vitest'
import { Vector3, MathUtils } from 'three'
import { clampPitch, lookDirectionFrom, toInputState, InputTracker, PITCH_LIMIT } from './input'

describe('clampPitch', () => {
  it('leaves a level view alone', () => {
    expect(clampPitch(0)).toBe(0)
  })

  it('stops the view before straight up', () => {
    expect(clampPitch(Math.PI)).toBeCloseTo(PITCH_LIMIT, 6)
    expect(PITCH_LIMIT).toBeLessThan(Math.PI / 2)
  })

  it('stops the view before straight down', () => {
    expect(clampPitch(-Math.PI)).toBeCloseTo(-PITCH_LIMIT, 6)
  })
})

describe('lookDirectionFrom', () => {
  it('looks down negative Z at zero yaw and pitch', () => {
    const d = lookDirectionFrom(0, 0)
    expect(d.x).toBeCloseTo(0, 6)
    expect(d.y).toBeCloseTo(0, 6)
    expect(d.z).toBeCloseTo(-1, 6)
  })

  it('is always normalised', () => {
    for (const yaw of [0, 1, 2, -3]) {
      for (const pitch of [-1, 0, 0.5]) {
        expect(lookDirectionFrom(yaw, pitch).length()).toBeCloseTo(1, 6)
      }
    }
  })

  it('positive pitch looks upward', () => {
    expect(lookDirectionFrom(0, MathUtils.degToRad(30)).y).toBeGreaterThan(0)
  })

  it('yawing ninety degrees looks down negative X', () => {
    const d = lookDirectionFrom(Math.PI / 2, 0)
    expect(d.x).toBeCloseTo(-1, 6)
    expect(d.z).toBeCloseTo(0, 6)
  })
})

const LOOK = new Vector3(0, 0, -1)

describe('toInputState', () => {
  it('W gives positive forward', () => {
    expect(toInputState(new Set(['KeyW']), LOOK, false).forward).toBe(1)
  })

  it('S gives negative forward', () => {
    expect(toInputState(new Set(['KeyS']), LOOK, false).forward).toBe(-1)
  })

  it('W and S together cancel', () => {
    expect(toInputState(new Set(['KeyW', 'KeyS']), LOOK, false).forward).toBe(0)
  })

  it('D gives positive strafe and A negative', () => {
    expect(toInputState(new Set(['KeyD']), LOOK, false).strafe).toBe(1)
    expect(toInputState(new Set(['KeyA']), LOOK, false).strafe).toBe(-1)
  })

  it('either shift key sprints', () => {
    expect(toInputState(new Set(['ShiftLeft']), LOOK, false).sprint).toBe(true)
    expect(toInputState(new Set(['ShiftRight']), LOOK, false).sprint).toBe(true)
    expect(toInputState(new Set(), LOOK, false).sprint).toBe(false)
  })

  it('passes the action edge through', () => {
    expect(toInputState(new Set(), LOOK, true).actionPressed).toBe(true)
  })

  it('normalises the look direction it is handed', () => {
    expect(toInputState(new Set(), new Vector3(0, 0, -7), false).lookDirection.length())
      .toBeCloseTo(1, 6)
  })

  it('does not alias the caller look vector', () => {
    const look = new Vector3(0, 0, -1)
    toInputState(new Set(), look, false).lookDirection.set(1, 1, 1)
    expect(look.toArray()).toEqual([0, 0, -1])
  })

  it('ignores unmapped keys', () => {
    const s = toInputState(new Set(['KeyQ', 'Digit1']), LOOK, false)
    expect(s.forward).toBe(0)
    expect(s.strafe).toBe(0)
    expect(s.sprint).toBe(false)
  })

})

/**
 * `scooterPressed` is an edge flag `InputTracker`'s own `keydown` listener sets, not
 * something `toInputState` derives from the held set -- so a `toInputState`-only test of
 * the binding would pass unchanged if the listener still keyed off `ShiftLeft`, which is
 * exactly the kind of assertion that cannot fail. Dispatching a real `keydown` at a tracker
 * and reading `scooterPressed` off `sample()` is the version with teeth. `Event` stands in
 * for `KeyboardEvent`, which the Node test environment does not provide: the listener only
 * reads `.code`, `.repeat` and calls `.preventDefault()`, all of which a plain `Event` with
 * `code`/`repeat` assigned onto it satisfies at runtime.
 */
const keydown = (code: string, repeat = false) =>
  Object.assign(new Event('keydown'), { code, repeat }) as KeyboardEvent

const fakeCanvas = {
  addEventListener: () => {},
  removeEventListener: () => {},
  requestPointerLock: () => {},
} as unknown as HTMLCanvasElement

describe('InputTracker and the scooter key', () => {
  it('rides the scooter on Z', () => {
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    target.dispatchEvent(keydown('KeyZ'))
    expect(tracker.sample().scooterPressed).toBe(true)
  })

  it('no longer rides the scooter on Shift', () => {
    // Shift used to toggle the scooter as well as meaning sprint and hover, so the key
    // that summoned it also changed its speed while still held -- measured at identical
    // charge, cruise was 27.5 m/s with Shift held against 14.8 m/s released.
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    target.dispatchEvent(keydown('ShiftLeft'))
    const state = tracker.sample()
    expect(state.scooterPressed).toBe(false)
    expect(state.sprint).toBe(true)
  })

  it('does not re-fire the toggle on auto-repeat', () => {
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    target.dispatchEvent(keydown('KeyZ'))
    tracker.sample() // Clears the edge from the first, real press.
    target.dispatchEvent(keydown('KeyZ', true))
    expect(tracker.sample().scooterPressed).toBe(false)
  })
})

describe('action hold and release', () => {
  it('reports the space key as held', () => {
    expect(toInputState(new Set(['Space']), LOOK, false).actionHeld).toBe(true)
    expect(toInputState(new Set(), LOOK, false).actionHeld).toBe(false)
  })

  it('passes the release edge through and defaults it to false', () => {
    expect(toInputState(new Set(), LOOK, false, true).actionReleased).toBe(true)
    expect(toInputState(new Set(), LOOK, false).actionReleased).toBe(false)
  })
})

describe('the Avatar State trigger', () => {
  it('passes the trigger edge through', () => {
    const state = toInputState(new Set(), LOOK, false, false, false, false, false, true)
    expect(state.avatarStatePressed).toBe(true)
  })

  it('defaults the trigger to unpressed', () => {
    expect(toInputState(new Set(), LOOK, false).avatarStatePressed).toBe(false)
  })

  it('does not confuse the trigger with the gust edge', () => {
    // Both are edge-triggered booleans at the end of a run of positional parameters,
    // so an off-by-one in the argument list is a real risk worth pinning.
    const gusting = toInputState(new Set(), LOOK, false, false, false, false, true, false)
    expect(gusting.gustPressed).toBe(true)
    expect(gusting.avatarStatePressed).toBe(false)
  })
})
