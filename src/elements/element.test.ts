import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ELEMENT_CONFIG, ELEMENT_ORDER, isElementAvailable, radialHighlight, radialModel,
  restingElements, stepElements, type Aim, type ElementInput, type ElementState,
} from './element'

const C = DEFAULT_ELEMENT_CONFIG
/** Well past the dead zone, so a direction test is testing direction and not distance. */
const FAR = C.deadZonePixels * 3

const input = (over: Partial<ElementInput> = {}): ElementInput => ({
  radialHeld: false,
  radialReleased: false,
  aimDelta: { x: 0, y: 0 },
  directIndex: null,
  ...over,
})

/** Open the radial and flick it by `aim`, without releasing. */
function opened(aim: Aim, from: ElementState = restingElements()): ElementState {
  return stepElements(from, input({ radialHeld: true, aimDelta: aim }), C)
}

describe('ELEMENT_ORDER', () => {
  it('starts with air, which is the baseline and the home slot', () => {
    // Both halves matter. Air first because the radial's straight-up direction is the least
    // deliberate flick the wrist makes, and the element you fall back to should be the one that
    // costs the least to reach. And `restingElements` has to agree with it, or the widget would
    // open with its highlight somewhere other than the slot the badge is showing.
    expect(ELEMENT_ORDER[0]).toBe('air')
    expect(restingElements().active).toBe('air')
  })

  it('has no duplicates, so no direction resolves to two elements', () => {
    expect(new Set(ELEMENT_ORDER).size).toBe(ELEMENT_ORDER.length)
  })
})

describe('radialHighlight', () => {
  it('reads straight up as the first slot and straight down as the second', () => {
    // Screen y grows downward, so up is negative. Getting this backwards would give a radial
    // that is a vertical mirror of the one it draws, and nothing else in the game would look
    // wrong — which is why the sign is asserted rather than assumed.
    expect(radialHighlight({ x: 0, y: -FAR }, C)).toBe(ELEMENT_ORDER[0])
    expect(radialHighlight({ x: 0, y: FAR }, C)).toBe(ELEMENT_ORDER[1])
  })

  it('answers nothing inside the dead zone, and something just outside it', () => {
    // A pair, not a lone negative. "Returns null" on its own passes for a function that always
    // returns null, which is exactly the bug that would make the radial unusable — so the
    // positive control sits beside it, at a distance one pixel past the same boundary.
    expect(radialHighlight({ x: 0, y: -(C.deadZonePixels - 1) }, C)).toBeNull()
    expect(radialHighlight({ x: 0, y: -(C.deadZonePixels + 1) }, C)).toBe(ELEMENT_ORDER[0])
  })

  it('measures the dead zone as a distance, not per axis', () => {
    // A diagonal flick whose components are each under the dead zone but whose length is over it
    // has to count. Implemented as `Math.abs(x) < dz && Math.abs(y) < dz` this would fail: at
    // 0.8 of the dead zone on both axes the length is about 1.13 of it.
    const component = C.deadZonePixels * 0.8
    expect(Math.hypot(component, component)).toBeGreaterThan(C.deadZonePixels)
    expect(radialHighlight({ x: component, y: -component }, C)).not.toBeNull()
  })

  it('fails closed on a non-finite offset', () => {
    // The result picks an array index. A NaN there selects nothing while looking exactly like a
    // radial that is simply not being moved, which is the worst kind of silent failure.
    expect(radialHighlight({ x: Number.NaN, y: 0 }, C)).toBeNull()
    expect(radialHighlight({ x: 0, y: Number.POSITIVE_INFINITY }, C)).toBeNull()
  })

  it('divides the circle evenly, so every element is reachable by some direction', () => {
    // Swept rather than sampled at the slot centres, because the property that matters is
    // coverage: with the wedge arithmetic wrong — a `Math.floor` instead of a `Math.round`, or a
    // missing modulo — some element becomes unreachable while the others still work, and a test
    // that only checked the centres would not notice.
    const reached = new Set<string>()
    for (let degrees = 0; degrees < 360; degrees += 1) {
      const radians = (degrees * Math.PI) / 180
      const element = radialHighlight(
        { x: Math.sin(radians) * FAR, y: -Math.cos(radians) * FAR }, C,
      )
      if (element) reached.add(element)
    }
    expect([...reached].sort()).toEqual([...ELEMENT_ORDER].sort())
  })

  it('gives every element a contiguous arc of its own', () => {
    // Contiguity, which coverage alone does not imply: an interleaved mapping would still reach
    // everything while making the gesture meaningless, since flicking slightly off a direction
    // would land on a different element. Counted as the number of times the answer changes
    // around a full sweep.
    //
    // The expected count is exactly N, and the reasoning is worth writing down because N−1 is the
    // number a reader will assume. N contiguous arcs have N boundaries on the circle; the sweep
    // starts at 0 degrees, which is the *centre* of slot 0, so slot 0's arc is split across the
    // wrap — half at the start of the sweep and half at the end. The scan therefore crosses every
    // one of the N boundaries rather than N−1 of them. At N=2 that is boundaries at 90 and 270,
    // giving air, water, air and two changes. An interleaved mapping would give more, which is
    // what this is really testing.
    let changes = 0
    let previous: string | null = null
    for (let degrees = 0; degrees < 360; degrees += 1) {
      const radians = (degrees * Math.PI) / 180
      const element = radialHighlight(
        { x: Math.sin(radians) * FAR, y: -Math.cos(radians) * FAR }, C,
      )
      if (element !== previous && previous !== null) changes++
      previous = element
    }
    expect(changes).toBe(ELEMENT_ORDER.length)
  })
})

describe('stepElements: the radial', () => {
  it('accumulates the pointer offset while held', () => {
    // Accumulated, not replaced. A radial that read only the latest frame's delta would need the
    // whole flick to arrive in one mousemove, so at a high frame rate — where each frame carries
    // a few pixels — it would never leave the dead zone at all.
    let state = restingElements()
    for (let i = 0; i < 5; i++) {
      state = stepElements(state, input({ radialHeld: true, aimDelta: { x: 0, y: -8 } }), C)
    }
    expect(state.aim).toEqual({ x: 0, y: -40 })
  })

  it('opens closed and closes on release', () => {
    expect(restingElements().aim).toBeNull()
    expect(opened({ x: 0, y: -FAR }).aim).not.toBeNull()
    const released = stepElements(
      opened({ x: 0, y: -FAR }), input({ radialReleased: true }), C,
    )
    expect(released.aim).toBeNull()
  })

  it('commits the highlighted element on release', () => {
    const state = stepElements(
      opened({ x: 0, y: FAR }), input({ radialReleased: true }), C,
    )
    expect(state.active).toBe(ELEMENT_ORDER[1])
    // The positive control's other half: releasing on the *other* direction has to land
    // somewhere else, or "commits the highlighted element" would pass for an implementation
    // that always picked slot 1.
    const up = stepElements(
      opened({ x: 0, y: -FAR }, { active: 'water', aim: null }),
      input({ radialReleased: true }), C,
    )
    expect(up.active).toBe(ELEMENT_ORDER[0])
  })

  it('keeps the element already selected when the release is inside the dead zone', () => {
    // The "change your mind" path: open, twitch, let go, and nothing happens. Asserted against a
    // non-default starting element so that "kept what it had" cannot be confused with "reset to
    // air", which is what a naive implementation would do.
    const from: ElementState = { active: 'water', aim: null }
    const state = stepElements(
      opened({ x: 2, y: -3 }, from), input({ radialReleased: true }), C,
    )
    expect(state.active).toBe('water')
  })

  it('ignores the release frame\'s own movement when picking', () => {
    // The pick is made from the offset accumulated *before* the release, so a jerk on the mouse
    // as the button comes up cannot change the answer. Here the accumulated flick points up and
    // the release frame's delta points hard down: reading them together would select water.
    const held = opened({ x: 0, y: -FAR }, { active: 'water', aim: null })
    const state = stepElements(
      held, input({ radialReleased: true, aimDelta: { x: 0, y: FAR * 4 } }), C,
    )
    expect(state.active).toBe(ELEMENT_ORDER[0])
  })

  it('clears a stale offset when the key vanishes without a release', () => {
    // What a window blur produces: `InputTracker`'s blur handler clears the held set but fires no
    // keyup, so `radialHeld` goes false with `radialReleased` never becoming true. Left alone the
    // offset would persist and the next open would resume from it — committing a direction the
    // player never aimed at on this occasion. The same hazard `stepEncounter` guards for a vortex
    // charge, and the same answer.
    const stale = opened({ x: 0, y: FAR })
    expect(stale.aim).not.toBeNull()
    const blurred = stepElements(stale, input(), C)
    expect(blurred.aim).toBeNull()
    // And the element was not switched on the way out: a blur is not a selection.
    expect(blurred.active).toBe('air')
  })
})

describe('stepElements: the number binds', () => {
  it('selects by 1-based index', () => {
    expect(stepElements(restingElements(), input({ directIndex: 2 }), C).active)
      .toBe(ELEMENT_ORDER[1])
    expect(stepElements({ active: 'water', aim: null }, input({ directIndex: 1 }), C).active)
      .toBe(ELEMENT_ORDER[0])
  })

  it('ignores an index past the end rather than wrapping', () => {
    // Pressing 3 today. Wrapping would make it a second air bind, and would then break on the day
    // earth is appended and 3 starts meaning something real. Paired with a positive control on
    // the same call shape, so "ignores it" is not passing because nothing works.
    const from: ElementState = { active: 'water', aim: null }
    expect(stepElements(from, input({ directIndex: ELEMENT_ORDER.length + 1 }), C).active)
      .toBe('water')
    expect(stepElements(from, input({ directIndex: 1 }), C).active).toBe('air')
  })

  it('ignores a zero or negative index', () => {
    const from: ElementState = { active: 'water', aim: null }
    expect(stepElements(from, input({ directIndex: 0 }), C).active).toBe('water')
    expect(stepElements(from, input({ directIndex: -1 }), C).active).toBe('water')
  })

  it('does not close or disturb an open radial', () => {
    // The two paths are independent: a player holding the radial who hits a number key gets the
    // element they named, and the radial is still open and still holding the offset they had
    // flicked. Closing it here would be a second, invisible rule.
    const held = opened({ x: 0, y: -FAR })
    const state = stepElements(
      held, input({ radialHeld: true, directIndex: 2 }), C,
    )
    expect(state.active).toBe(ELEMENT_ORDER[1])
    expect(state.aim).toEqual(held.aim)
  })

  it('lets a direct bind win over a release landing on the same frame', () => {
    // Either would be defensible; the direct bind is chosen because it is unambiguous. Pinned
    // because it is a real ordering decision inside the function and a future edit that moved the
    // release block above the bind would silently reverse it. The flick points at water and the
    // key names air, so the two answers are distinguishable.
    const held = opened({ x: 0, y: FAR })
    const state = stepElements(
      held, input({ radialReleased: true, directIndex: 1 }), C,
    )
    expect(state.active).toBe('air')
  })
})

describe('switching is free', () => {
  it('takes no dt and has no state that could hold a cooldown', () => {
    // The design document's "fast enough to sequence mid-combo" is not a tuning target a small
    // cooldown would approximately meet, and the owner has ruled the switch free. This is the
    // structural version of that claim: `ElementState` carries exactly the active element and the
    // radial offset, so there is nowhere for a cooldown or a charge to live. A future edit that
    // added one would have to widen this object and would redden here.
    expect(Object.keys(restingElements()).sort()).toEqual(['active', 'aim'])
  })

  it('switches back and forth on consecutive frames without refusing', () => {
    // Behavioural, beside the structural check above: sixty switches in sixty frames all take.
    let state = restingElements()
    for (let frame = 0; frame < 60; frame++) {
      const index = (frame % ELEMENT_ORDER.length) + 1
      state = stepElements(state, input({ directIndex: index }), C)
      expect(state.active).toBe(ELEMENT_ORDER[index - 1])
    }
  })
})

describe('isElementAvailable', () => {
  it('offers every element from the start, because there is no act structure yet', () => {
    // Section 5 puts water in Act 2 and there are no acts, so water is available from the start
    // exactly as the Avatar State is. This is the gate to change when acts arrive; it is asserted
    // so that changing it is a deliberate act with a failing test attached rather than a quiet
    // edit.
    for (const element of ELEMENT_ORDER) expect(isElementAvailable(element)).toBe(true)
  })
})

describe('radialModel', () => {
  it('reports one slot per element, in order, with its clockwise index', () => {
    const model = radialModel(restingElements(), C)
    expect(model.count).toBe(ELEMENT_ORDER.length)
    expect(model.slots.map((slot) => slot.element)).toEqual([...ELEMENT_ORDER])
    expect(model.slots.map((slot) => slot.index)).toEqual(ELEMENT_ORDER.map((_, i) => i))
  })

  it('marks exactly one slot active, and it is the selected one', () => {
    const model = radialModel({ active: 'water', aim: null }, C)
    expect(model.slots.filter((slot) => slot.active).map((s) => s.element)).toEqual(['water'])
  })

  it('is closed with no offset and open with one', () => {
    expect(radialModel(restingElements(), C).open).toBe(false)
    expect(radialModel(opened({ x: 0, y: -FAR }), C).open).toBe(true)
  })

  it('highlights nothing inside the dead zone and the aimed slot outside it', () => {
    // The pair again, and it is the assertion that matters most for this function: a model that
    // never highlighted anything would look like a radial the mouse does not drive, and "no slot
    // is highlighted" alone passes for it.
    const twitched = radialModel(opened({ x: 1, y: -2 }), C)
    expect(twitched.slots.filter((slot) => slot.highlighted)).toEqual([])
    const flicked = radialModel(opened({ x: 0, y: FAR }), C)
    expect(flicked.slots.filter((slot) => slot.highlighted).map((s) => s.element))
      .toEqual([ELEMENT_ORDER[1]])
  })

  it('agrees with radialHighlight rather than deciding for itself', () => {
    // Held to the independent mechanism across a full sweep, the way `anyLiveGustTarget` is held
    // to `liveGustTargets`, so the model cannot drift from the function the release actually
    // commits through. Without this the widget could highlight one wedge and select another.
    for (let degrees = 0; degrees < 360; degrees += 7) {
      const radians = (degrees * Math.PI) / 180
      const aim = { x: Math.sin(radians) * FAR, y: -Math.cos(radians) * FAR }
      const expected = radialHighlight(aim, C)
      const model = radialModel(opened(aim), C)
      const highlighted = model.slots.find((slot) => slot.highlighted)?.element ?? null
      expect(highlighted, `${degrees} degrees`).toBe(expected)
    }
  })

  it('reports availability per slot from the one predicate that owns it', () => {
    for (const slot of radialModel(restingElements(), C).slots) {
      expect(slot.available).toBe(isElementAvailable(slot.element))
    }
  })
})
