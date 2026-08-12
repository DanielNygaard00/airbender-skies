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

describe('the element radial bindings', () => {
  const keyup = (code: string) => Object.assign(new Event('keyup'), { code }) as KeyboardEvent

  it('opens the radial while V is held', () => {
    // Read off the held set rather than tracked as an edge, so it is a state and not an event.
    expect(toInputState(new Set(['KeyV']), LOOK, false).radialHeld).toBe(true)
    expect(toInputState(new Set(), LOOK, false).radialHeld).toBe(false)
  })

  it('closes the radial when the held set is cleared by a blur', () => {
    // The whole reason `radialHeld` is derived rather than latched: `InputTracker`'s blur handler
    // clears the held keys and fires no keyup, so a latched flag would leave the radial open
    // forever after an alt-tab.
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    target.dispatchEvent(keydown('KeyV'))
    expect(tracker.sample().radialHeld).toBe(true)
    target.dispatchEvent(new Event('blur'))
    expect(tracker.sample().radialHeld).toBe(false)
  })

  it('reports the release edge on V, and clears it after one sample', () => {
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    target.dispatchEvent(keyup('KeyV'))
    expect(tracker.sample().radialReleased).toBe(true)
    // Exactly once per frame, like every other edge here — a release read twice would commit the
    // pick twice, and the second time from an already-cleared offset.
    expect(tracker.sample().radialReleased).toBe(false)
  })

  it('does not confuse the radial release with the vortex release', () => {
    // Two keyup-driven edges added at different times to the same handler, which is exactly where
    // a copy-paste puts the wrong field name.
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    target.dispatchEvent(keyup('KeyR'))
    const state = tracker.sample()
    expect(state.vortexReleased).toBe(true)
    expect(state.radialReleased).toBe(false)
  })

  it('binds the number row to element indices, by code and not by key', () => {
    // `e.code`, so the binds survive a layout where the unshifted top row produces punctuation —
    // on AZERTY `e.key` for that key is `&`, while `e.code` stays `Digit1`.
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    target.dispatchEvent(keydown('Digit2'))
    expect(tracker.sample().elementIndex).toBe(2)
    target.dispatchEvent(keydown('Digit1'))
    expect(tracker.sample().elementIndex).toBe(1)
  })

  it('reports no element index when no number key was pressed', () => {
    // The positive control's other half. Null rather than 0, because 0 is a plausible index and
    // `stepElements` would have to know to reject it.
    expect(new InputTracker(new EventTarget(), fakeCanvas).sample().elementIndex).toBeNull()
  })

  it('clears the element index after one sample', () => {
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    target.dispatchEvent(keydown('Digit2'))
    expect(tracker.sample().elementIndex).toBe(2)
    expect(tracker.sample().elementIndex).toBeNull()
  })

  it('ignores number keys beyond the four elements the design names', () => {
    // 5 and up are free for something else. Paired with a bound digit, so "ignored" is not
    // passing because the whole binding is broken.
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    target.dispatchEvent(keydown('Digit5'))
    expect(tracker.sample().elementIndex).toBeNull()
    target.dispatchEvent(keydown('Digit4'))
    expect(tracker.sample().elementIndex).toBe(4)
  })

  it('lets auto-repeat through, because selecting an element is idempotent', () => {
    // Unlike the scooter, which toggles and must not re-fire. Re-selecting the element already
    // selected writes the same value, so a held key cannot do anything a single press did not —
    // and guarding it would be a rule with no behaviour behind it.
    const target = new EventTarget()
    const tracker = new InputTracker(target, fakeCanvas)
    target.dispatchEvent(keydown('Digit2', true))
    expect(tracker.sample().elementIndex).toBe(2)
  })

  it('defaults the radial fields when toInputState is called without them', () => {
    // `toInputState` is called directly by tests and by nothing else in production, and the trailing
    // object is optional so those call sites keep working. This pins what "absent" means.
    const state = toInputState(new Set(), LOOK, false)
    expect(state.radialReleased).toBe(false)
    expect(state.elementIndex).toBeNull()
    expect(state.pointerDelta).toEqual({ x: 0, y: 0 })
  })

  it('passes a supplied pointer delta straight through', () => {
    const state = toInputState(
      new Set(), LOOK, false, false, false, false, false, false, false, false, false,
      { radialReleased: false, pointerDelta: { x: 7, y: -3 }, elementIndex: null },
    )
    expect(state.pointerDelta).toEqual({ x: 7, y: -3 })
  })

  it('does not let the radial fields displace the eleven edges before them', () => {
    // The off-by-one guard this file already carries for `gustPressed` and `avatarStatePressed`,
    // extended to the boundary the new object sits on. Every positional flag is set true and the
    // radial object is given distinctive values, so a shifted argument shows up as a wrong field
    // rather than as a value that happens to look plausible.
    const state = toInputState(
      new Set(), LOOK, true, true, true, true, true, true, true, true, true,
      { radialReleased: true, pointerDelta: { x: 11, y: 13 }, elementIndex: 2 },
    )
    expect(state.actionPressed).toBe(true)
    expect(state.staffPressed).toBe(true)
    expect(state.radialReleased).toBe(true)
    expect(state.elementIndex).toBe(2)
    expect(state.pointerDelta).toEqual({ x: 11, y: 13 })
  })
})

/**
 * Deliver a mousemove to the tracker's own listener, with the pointer lock satisfied.
 *
 * The handler's first line is `document.pointerLockElement !== canvas`, and the node test
 * environment has no `document` at all — so it is stubbed for the duration and restored
 * afterwards. Stubbing rather than skipping, because the ruling being tested here is about what
 * that handler does with the movement it receives, and there is nowhere else to test it: the
 * accumulation is two statements inside a listener, not a pure function that could be lifted out.
 */
function withPointerLock<T>(body: () => T): T {
  const holder = globalThis as { document?: unknown }
  const had = 'document' in holder
  const previous = holder.document
  holder.document = { pointerLockElement: fakeCanvas }
  try {
    return body()
  } finally {
    if (had) holder.document = previous
    else delete holder.document
  }
}

/** A tracker whose listeners can be invoked directly, with the events it registered. */
function trackerWithHandlers(): {
  tracker: InputTracker
  fire: (type: string, event: unknown) => void
} {
  const handlers = new Map<string, (e: Event) => void>()
  const target = {
    addEventListener: (type: string, fn: (e: Event) => void) => { handlers.set(type, fn) },
    removeEventListener: () => {},
  } as unknown as EventTarget
  const tracker = new InputTracker(target, fakeCanvas)
  return {
    tracker,
    fire: (type: string, event: unknown) => {
      const handler = handlers.get(type)
      if (!handler) throw new Error(`InputTracker registered no ${type} listener`)
      handler(event as Event)
    },
  }
}

describe('holding the radial open never costs a frame of control', () => {
  it('keeps turning the view while V is held', () => {
    // **An owner ruling, not an inference: opening the radial must not swallow mouse-look.** The
    // obvious implementation diverts the movement into the radial for as long as the key is down,
    // which takes the camera away from the player mid-fight — and the radial is for use mid-fight.
    // So the same movement does both.
    //
    // Asserted as the look direction actually changing, and against the identical movement with V
    // *not* held, so the two are equal rather than merely both non-zero.
    withPointerLock(() => {
      const held = trackerWithHandlers()
      held.fire('keydown', { code: 'KeyV', repeat: false })
      held.fire('mousemove', { movementX: 120, movementY: 0 })
      const withRadial = held.tracker.sample()

      const plain = trackerWithHandlers()
      plain.fire('mousemove', { movementX: 120, movementY: 0 })
      const withoutRadial = plain.tracker.sample()

      expect(withRadial.radialHeld).toBe(true)
      expect(withoutRadial.radialHeld).toBe(false)
      // The view moved at all, which is what the ruling forbids losing.
      expect(withRadial.lookDirection.angleTo(new Vector3(0, 0, -1))).toBeGreaterThan(0.01)
      // And it moved by exactly as much as it would have with the radial closed.
      expect(withRadial.lookDirection.angleTo(withoutRadial.lookDirection)).toBeCloseTo(0, 9)
    })
  })

  it('reports the same pointer movement to the radial that the look received', () => {
    // The other half: the movement is not merely left with the camera, it also reaches the radial.
    // Without this the ruling could be satisfied by ignoring the radial entirely.
    withPointerLock(() => {
      const { tracker, fire } = trackerWithHandlers()
      fire('keydown', { code: 'KeyV', repeat: false })
      fire('mousemove', { movementX: 30, movementY: -40 })
      const state = tracker.sample()
      expect(state.pointerDelta).toEqual({ x: 30, y: -40 })
    })
  })

  it('accumulates pointer movement across several events in one frame', () => {
    // A flick arrives as many small mousemove events between two samples, so the tracker has to sum
    // them — reporting only the last would leave the radial permanently inside its dead zone at
    // high frame rates.
    withPointerLock(() => {
      const { tracker, fire } = trackerWithHandlers()
      for (let i = 0; i < 4; i++) fire('mousemove', { movementX: 5, movementY: -3 })
      expect(tracker.sample().pointerDelta).toEqual({ x: 20, y: -12 })
    })
  })

  it('clears the pointer delta each sample, so it is per frame and not cumulative', () => {
    withPointerLock(() => {
      const { tracker, fire } = trackerWithHandlers()
      fire('mousemove', { movementX: 9, movementY: 9 })
      tracker.sample()
      expect(tracker.sample().pointerDelta).toEqual({ x: 0, y: 0 })
    })
  })

  it('reports no pointer movement without the pointer lock', () => {
    // The handler returns early when the canvas does not hold the lock, so a mouse moved over the
    // page chrome while paused neither turns the view nor steers the radial.
    const { tracker, fire } = trackerWithHandlers()
    const holder = globalThis as { document?: unknown }
    const had = 'document' in holder
    const previous = holder.document
    holder.document = { pointerLockElement: null }
    try {
      fire('mousemove', { movementX: 50, movementY: 50 })
      expect(tracker.sample().pointerDelta).toEqual({ x: 0, y: 0 })
    } finally {
      if (had) holder.document = previous
      else delete holder.document
    }
  })
})
