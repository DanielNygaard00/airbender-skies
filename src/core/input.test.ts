import { describe, it, expect } from 'vitest'
import { Vector3, MathUtils } from 'three'
import {
  clampPitch,
  lookDirectionFrom,
  lookDelta,
  toInputState,
  InputTracker,
  PITCH_LIMIT,
  MOUSE_SENSITIVITY,
  shouldClaimSpace,
} from './input'

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

describe('lookDelta', () => {
  it('at sensitivity 1 reproduces the base arithmetic exactly', () => {
    const { yaw, pitch } = lookDelta(100, 50, 1, false)
    // Asserted two ways on purpose: against the arithmetic, so a future rename of
    // MOUSE_SENSITIVITY can't drift out of sync with the test, and against the literal
    // it currently produces, so a change to the constant itself -- which would also change
    // the arithmetic assertion, since both read the same export -- still fails a test.
    expect(yaw).toBeCloseTo(-100 * MOUSE_SENSITIVITY, 10)
    expect(pitch).toBeCloseTo(-50 * MOUSE_SENSITIVITY, 10)
    expect(yaw).toBeCloseTo(-0.22, 10)
    expect(pitch).toBeCloseTo(-0.11, 10)
  })

  it('sensitivity 2 doubles both axes', () => {
    const base = lookDelta(100, 50, 1, false)
    const doubled = lookDelta(100, 50, 2, false)
    expect(doubled.yaw).toBeCloseTo(base.yaw * 2, 10)
    expect(doubled.pitch).toBeCloseTo(base.pitch * 2, 10)
  })

  it('sensitivity 0.5 halves both axes', () => {
    const base = lookDelta(100, 50, 1, false)
    const halved = lookDelta(100, 50, 0.5, false)
    expect(halved.yaw).toBeCloseTo(base.yaw * 0.5, 10)
    expect(halved.pitch).toBeCloseTo(base.pitch * 0.5, 10)
  })

  it('invertY flips the pitch sign and leaves yaw alone', () => {
    const normal = lookDelta(100, 50, 1, false)
    const inverted = lookDelta(100, 50, 1, true)
    expect(inverted.pitch).toBeCloseTo(-normal.pitch, 10)
    // This is the half a wrong implementation is most likely to miss: inverting the
    // vertical look must never touch yaw.
    expect(inverted.yaw).toBeCloseTo(normal.yaw, 10)
  })

  it('applies sensitivity before invert, so magnitude matches either way', () => {
    const inverted = lookDelta(100, 50, 2, true)
    const notInverted = lookDelta(100, 50, 2, false)
    expect(Math.abs(inverted.pitch)).toBeCloseTo(Math.abs(notInverted.pitch), 10)
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

  it('raises an Air Wall while G is down, and drops it when it is not', () => {
    // A pure read of the held set, unlike the scooter and the dash below, which is exactly why
    // a `toInputState` test is the right level here rather than the tracker-level one those
    // need. The negative line is the one with teeth: a binding that reported `true`
    // unconditionally would satisfy the first assertion on its own.
    expect(toInputState(new Set(['KeyG']), LOOK, false).airWallHeld).toBe(true)
    expect(toInputState(new Set(), LOOK, false).airWallHeld).toBe(false)
  })

  it('does not let any other bound key raise an Air Wall', () => {
    // The keys G had to be chosen around. A wall going up on a gust or a dodge would be a
    // silent breath drain in the middle of a fight rather than anything visibly wrong.
    for (const code of [
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyQ', 'KeyF', 'KeyE', 'KeyR', 'KeyC',
      'ShiftLeft', 'ControlLeft', 'Space', 'KeyH', 'Escape',
    ]) {
      expect(toInputState(new Set([code]), LOOK, false).airWallHeld, code).toBe(false)
    }
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
  Object.assign(new Event('keydown', { cancelable: true }), { code, repeat }) as KeyboardEvent
// `cancelable` matters and is not decoration: a real keydown is cancelable, and on an event
// that is not, `preventDefault()` is a no-op and `defaultPrevented` never becomes true — so
// the Space-claiming assertions below would pass against any implementation.

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

/**
 * A fake element, as the predicate sees one: it reads `tagName` and nothing else, which is
 * the whole reason it takes an `EventTarget` instead of being a method on the tracker.
 */
const el = (tagName: string) => ({ tagName }) as unknown as EventTarget

describe('shouldClaimSpace', () => {
  it('claims Space when nothing is focused', () => {
    // The jump has to be the default. An unclaimed Space with no focus scrolls the page
    // out from under the player, which is worse than the bug the gate fixes.
    expect(shouldClaimSpace(null)).toBe(true)
  })

  it('claims Space for the canvas and for targets with no tag at all', () => {
    expect(shouldClaimSpace(el('CANVAS'))).toBe(true)
    // `window` and `document` are both plausible targets on a window-bound listener and
    // neither has a tagName; a naive `target.tagName.toUpperCase()` would throw on them.
    expect(shouldClaimSpace(new EventTarget())).toBe(true)
    expect(shouldClaimSpace({} as EventTarget)).toBe(true)
  })

  it('leaves Space to a focused form control', () => {
    // A checkbox is the case that matters: the panel's invert-Y, mute and reduce-motion
    // rows are checkboxes, and Space is the only key that activates one.
    expect(shouldClaimSpace(el('INPUT'))).toBe(false)
    expect(shouldClaimSpace(el('BUTTON'))).toBe(false)
    expect(shouldClaimSpace(el('SELECT'))).toBe(false)
    expect(shouldClaimSpace(el('TEXTAREA'))).toBe(false)
  })

  it('matches a tag name whatever its case', () => {
    // HTML tagName is upper-case, but XML-serialised documents report it as authored.
    expect(shouldClaimSpace(el('input'))).toBe(false)
  })
})

/**
 * Deliver a keydown to the tracker's own listener with a `target` of our choosing.
 *
 * `dispatchEvent` sets `target` to the object doing the dispatching, so the
 * focused-checkbox case is not reachable through it — hence capturing the handler. The
 * event is a plain object rather than an `Event`: `target` is a getter on `Event`, so
 * assigning one onto a real instance throws in a module's strict mode.
 */
function trackerListener(): { tracker: InputTracker; press: (target: unknown) => boolean } {
  const handlers = new Map<string, (e: Event) => void>()
  const target = {
    addEventListener: (type: string, fn: (e: Event) => void) => { handlers.set(type, fn) },
    removeEventListener: () => {},
  } as unknown as EventTarget
  const tracker = new InputTracker(target, fakeCanvas)
  const handler = handlers.get('keydown')
  if (!handler) throw new Error('InputTracker registered no keydown listener')
  return {
    tracker,
    press: (eventTarget: unknown): boolean => {
      let prevented = false
      handler({
        code: 'Space', repeat: false, target: eventTarget,
        preventDefault: () => { prevented = true },
      } as unknown as Event)
      return prevented
    },
  }
}

describe('the Space key and focused controls', () => {
  it('claims Space and jumps when the press is aimed at the canvas', () => {
    const { tracker, press } = trackerListener()
    expect(press(el('CANVAS'))).toBe(true)
    expect(tracker.sample().actionPressed).toBe(true)
  })

  it('does not claim Space aimed at a checkbox, so the checkbox can still toggle', () => {
    // The defect this replaced: the window-bound listener prevented the default of every
    // Space press, which cancels a checkbox's activation behaviour whatever phase the
    // listener ran in — so the settings panel's three toggle rows, reduce motion included,
    // could not be operated from the keyboard at all.
    const { press } = trackerListener()
    expect(press(el('INPUT'))).toBe(false)
  })

  it('still records the jump edge for a press it did not claim', () => {
    // Deliberate: the guide is open in that case, so the game is paused and `main.ts`'s
    // paused branch drains the edge with its per-frame `sample()`. Leaving the edge out
    // here would instead make the tracker's state depend on what happened to be focused.
    const { tracker, press } = trackerListener()
    press(el('INPUT'))
    expect(tracker.sample().actionPressed).toBe(true)
  })

  it('claims a Space delivered through a real dispatch with nothing focusable', () => {
    // The end-to-end direction, on a real Event rather than the plain object above: an
    // EventTarget has no tagName, so this is the "nothing focused" case, and
    // `defaultPrevented` is the browser-visible half of the claim.
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    const event = keydown('Space')
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(tracker.sample().actionPressed).toBe(true)
  })
})
