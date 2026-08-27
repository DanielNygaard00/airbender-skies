import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ELEMENT_CONFIG, ELEMENT_ORDER, isElementAvailable, radialHighlight, radialModel,
  restingElements, stepElements, type Aim, type ElementInput, type ElementState,
} from './element'
import { ACTS, UNLOCKED_IN, type Act } from '../progress/acts'

const C = DEFAULT_ELEMENT_CONFIG
/**
 * The act every test below runs in unless it is testing the act gate itself.
 *
 * Act 2 rather than 1, because water is an Act 2 unlock and almost everything in this file is
 * about the *radial* -- which direction resolves to which element, that a twitch keeps what you
 * had, that a number key beats a release on the same frame. Run at Act 1 those tests would all
 * still pass while proving only that water is locked, since every assertion about picking water
 * would be satisfied by a `stepElements` that refused every pick. The gate is asserted on its
 * own terms, with Act 1 and Act 2 side by side, in `describe('the act gate')`.
 */
const ACT: Act = 2
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
  return stepElements(from, input({ radialHeld: true, aimDelta: aim }), C, ACT)
}

/**
 * A flick aimed at the centre of slot `index`'s wedge.
 *
 * Derived from `ELEMENT_ORDER.length` rather than written as a direction per element, and that is
 * the point of the helper. These tests used to say "straight down is slot 1", which was true with
 * two elements and false the moment earth was appended — the sectors went from 180 degrees to 120,
 * so straight down became a *boundary* between slots 1 and 2 rather than the middle of either.
 * Three assertions broke, all of them correctly, and hardcoding the new directions instead would
 * only queue the same breakage up for fire.
 *
 * Screen y grows downward, so up is negative y: slot 0 is straight up and each slot after it sits
 * one sector clockwise. That is `radialHighlight`'s own convention, restated here on purpose rather
 * than imported — the whole value of these tests is that two independent expressions of the
 * geometry agree, and a helper that called the function under test would agree with anything.
 */
/**
 * A flick straight at the centre of slot `index`, well past the dead zone.
 *
 * Derived from `ELEMENT_ORDER.length` rather than written as a direction, because every slot except
 * air moves when an element is appended: water was straight down at two elements, sat at 120
 * degrees at three, and is straight right at four. Tests that named "straight down" as slot 1 went
 * red the moment a third element landed — correctly, but for a reason that had nothing to do with
 * what they were testing. Expressed this way they hold at any element count.
 *
 * Clockwise from straight up, matching `radialHighlight`'s own `atan2(x, -y)` convention: screen y
 * grows downward, so the vertical component is negated. Spelled out here rather than imported —
 * the whole value of these tests is that two independent expressions of the geometry agree, and a
 * helper that called the function under test would agree with anything.
 *
 * Both element cycles wrote this helper independently, under two names. One survives; the merge
 * kept this wording because it is the version that stopped naming absolute directions.
 */
function flickAt(index: number): Aim {
  const angle = (index / ELEMENT_ORDER.length) * Math.PI * 2
  return { x: Math.sin(angle) * FAR, y: -Math.cos(angle) * FAR }
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

  it('is exactly this order, and a new element may only be appended', () => {
    // **Pinned as a literal, which almost nothing in this repo is, and mutation is why.** Every other
    // test in this file derives its expectations from `ELEMENT_ORDER` itself, so swapping water and
    // earth left the whole file green — and swapping them is the one change this array must never
    // take. The order is a promise to the player's muscle memory: a flick direction means the same
    // thing every session, and `radialModel` numbers the wedges straight off this array, so
    // reordering silently reassigns two directions and every description of them in the guide and
    // the README becomes wrong at once.
    //
    // Appending is the legal change and it is cheap: this assertion is the one line to extend, and
    // the compiler already forces the rest. Reordering is meant to cost an argument, and this is
    // where the argument has to be had.
    expect([...ELEMENT_ORDER]).toEqual(['air', 'water', 'earth', 'fire'])
  })
})

describe('radialHighlight', () => {
  it('reads straight up as the first slot', () => {
    // Screen y grows downward, so up is negative. Getting this backwards would give a radial
    // that is a vertical mirror of the one it draws, and nothing else in the game would look
    // wrong — which is why the sign is asserted rather than assumed.
    //
    // Air's slot is the one direction worth pinning to a literal rather than through
    // `aimForSlot`: it is the home slot, and the promise that a straight flick up always returns
    // the baseline element is the one part of this geometry that must survive every future
    // element. Every other slot is checked against the sectors below.
    expect(radialHighlight({ x: 0, y: -FAR }, C)).toBe(ELEMENT_ORDER[0])
    expect(radialHighlight({ x: 0, y: -FAR }, C)).toBe('air')
  })

  it('gives every element the centre of its own wedge, and no two the same', () => {
    // Replaces a pair that read "up is slot 0, down is slot 1" — true for two elements only. This
    // form scales: each element is asked for at the middle of its own sector, so appending fire
    // extends the loop rather than invalidating a direction.
    //
    // The reached set is compared against the whole order, which is what stops this passing for an
    // implementation that answered slot 0 for everything: with three sectors, two of the three
    // assertions inside the loop would fail, but a lone `toBe(ELEMENT_ORDER[i])` inside a loop over
    // a one-element order would not — and the set comparison also catches the subtler failure where
    // two directions resolve to the same wedge and one element becomes unreachable.
    const reached = ELEMENT_ORDER.map((_, index) => radialHighlight(flickAt(index), C))
    expect(reached).toEqual([...ELEMENT_ORDER])
    expect(new Set(reached).size).toBe(ELEMENT_ORDER.length)
  })

  it('resolves straight down deterministically, and never to air', () => {
    // **This test's premise inverted when fire landed, and the rewrite is the point.** It used to
    // assert that straight down is a *boundary* rather than a wedge centre, which was true at three
    // elements and is false at four: whether straight down is a centre or a boundary is a fact
    // about the parity of the element count, not about the radial. At an even count it is the
    // centre of the slot half way round; at an odd count it falls between two.
    //
    // So the assertion is now the part that does not depend on the count. Straight down resolves to
    // exactly one element, deterministically, and it is never air — a player flicking as far from
    // the home slot as the wrist can go must not land back on it. The parity fact is asserted as
    // parity, so appending a fifth element flips the expectation without anybody editing a literal.
    const down = radialHighlight({ x: 0, y: FAR }, C)
    expect(down).not.toBeNull()
    expect(down).not.toBe('air')

    const sector = (2 * Math.PI) / ELEMENT_ORDER.length
    const centre = ELEMENT_ORDER.indexOf(down!) * sector
    const offBoundary = Math.abs(Math.PI - centre)
    if (ELEMENT_ORDER.length % 2 === 0) {
      // Even: straight down is a wedge centre, with the full half-sector of margin either side.
      expect(offBoundary).toBeCloseTo(0, 10)
    } else {
      // Odd: it sits on a boundary and `Math.round` breaks the half clockwise, so it lands on the
      // slot after it — deterministic, but not the centre of anybody's wedge, which is why no
      // description of the radial anywhere in the game names an element as "straight down".
      expect(offBoundary).toBeCloseTo(sector / 2, 10)
    }
  })

  it('reads straight up as the first slot, and goes clockwise from there', () => {
    // Screen y grows downward, so up is negative. Getting this backwards would give a radial
    // that is a vertical mirror of the one it draws, and nothing else in the game would look
    // wrong — which is why the sign is asserted rather than assumed. The second half is what pins
    // the *direction* of travel: a flick a third of the way clockwise from up has to land on slot 1
    // rather than on the last slot, and an anticlockwise convention would still put air at the top.
    expect(radialHighlight({ x: 0, y: -FAR }, C)).toBe(ELEMENT_ORDER[0])
    expect(radialHighlight(flickAt(1), C)).toBe(ELEMENT_ORDER[1])
    // The flick that is clockwise-adjacent to air from the other side is the *last* slot, not the
    // second, which is the assertion an anticlockwise mapping fails.
    expect(radialHighlight(flickAt(ELEMENT_ORDER.length - 1), C))
      .toBe(ELEMENT_ORDER[ELEMENT_ORDER.length - 1])
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
      state = stepElements(state, input({ radialHeld: true, aimDelta: { x: 0, y: -8 } }), C, ACT)
    }
    expect(state.aim).toEqual({ x: 0, y: -40 })
  })

  it('opens closed and closes on release', () => {
    expect(restingElements().aim).toBeNull()
    expect(opened({ x: 0, y: -FAR }).aim).not.toBeNull()
    const released = stepElements(
      opened({ x: 0, y: -FAR }), input({ radialReleased: true }), C, ACT,
    )
    expect(released.aim).toBeNull()
  })

  it('commits the highlighted element on release', () => {
    const state = stepElements(
      opened(flickAt(1)), input({ radialReleased: true }), C, ACT,
    )
    expect(state.active).toBe(ELEMENT_ORDER[1])
    // The positive control's other half: releasing on the *other* direction has to land
    // somewhere else, or "commits the highlighted element" would pass for an implementation
    // that always picked slot 1.
    const up = stepElements(
      opened({ x: 0, y: -FAR }, { active: 'water', aim: null }),
      input({ radialReleased: true }), C, ACT,
    )
    expect(up.active).toBe(ELEMENT_ORDER[0])
  })

  it('keeps the element already selected when the release is inside the dead zone', () => {
    // The "change your mind" path: open, twitch, let go, and nothing happens. Asserted against a
    // non-default starting element so that "kept what it had" cannot be confused with "reset to
    // air", which is what a naive implementation would do.
    const from: ElementState = { active: 'water', aim: null }
    const state = stepElements(
      opened({ x: 2, y: -3 }, from), input({ radialReleased: true }), C, ACT,
    )
    expect(state.active).toBe('water')
  })

  it('ignores the release frame\'s own movement when picking', () => {
    // The pick is made from the offset accumulated *before* the release, so a jerk on the mouse
    // as the button comes up cannot change the answer. Here the accumulated flick points up and
    // the release frame's delta points hard down: reading them together would select water.
    const held = opened({ x: 0, y: -FAR }, { active: 'water', aim: null })
    const state = stepElements(
      held, input({ radialReleased: true, aimDelta: { x: 0, y: FAR * 4 } }), C, ACT,
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
    const blurred = stepElements(stale, input(), C, ACT)
    expect(blurred.aim).toBeNull()
    // And the element was not switched on the way out: a blur is not a selection.
    expect(blurred.active).toBe('air')
  })
})

describe('stepElements: the number binds', () => {
  it('selects by 1-based index', () => {
    expect(stepElements(restingElements(), input({ directIndex: 2 }), C, ACT).active)
      .toBe(ELEMENT_ORDER[1])
    expect(stepElements({ active: 'water', aim: null }, input({ directIndex: 1 }), C, ACT).active)
      .toBe(ELEMENT_ORDER[0])
  })

  it('ignores an index past the end rather than wrapping', () => {
    // Pressing 4 today. Wrapping would make it a second air bind, and would then break on the day
    // earth is appended and 4 starts meaning something real. Paired with a positive control on
    // the same call shape, so "ignores it" is not passing because nothing works.
    const from: ElementState = { active: 'water', aim: null }
    expect(stepElements(from, input({ directIndex: ELEMENT_ORDER.length + 1 }), C, ACT).active)
      .toBe('water')
    expect(stepElements(from, input({ directIndex: 1 }), C, ACT).active).toBe('air')
  })

  it('ignores a zero or negative index', () => {
    const from: ElementState = { active: 'water', aim: null }
    expect(stepElements(from, input({ directIndex: 0 }), C, ACT).active).toBe('water')
    expect(stepElements(from, input({ directIndex: -1 }), C, ACT).active).toBe('water')
  })

  it('does not close or disturb an open radial', () => {
    // The two paths are independent: a player holding the radial who hits a number key gets the
    // element they named, and the radial is still open and still holding the offset they had
    // flicked. Closing it here would be a second, invisible rule.
    const held = opened({ x: 0, y: -FAR })
    const state = stepElements(
      held, input({ radialHeld: true, directIndex: 2 }), C, ACT,
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
      held, input({ radialReleased: true, directIndex: 1 }), C, ACT,
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
    //
    // Cycled over the elements *unlocked at this act* rather than over the whole order, because
    // switching being free is a claim about elements the player has. A locked one is refused, and
    // that refusal is the subject of the block below rather than a failure of this one.
    const available = ELEMENT_ORDER.filter((element) => isElementAvailable(element, ACT))
    expect(available.length).toBeGreaterThan(1)
    let state = restingElements()
    for (let frame = 0; frame < 60; frame++) {
      const element = available[frame % available.length]!
      state = stepElements(
        state, input({ directIndex: ELEMENT_ORDER.indexOf(element) + 1 }), C, ACT,
      )
      expect(state.active).toBe(element)
    }
  })
})

describe('isElementAvailable', () => {
  // This block used to assert that every element is available from the start, "because there is no
  // act structure yet". That is no longer true, and the rewrite is the point: the seam water left
  // here is now wired to `UNLOCKED_IN`, so this is where the gate is observed from the element
  // system's side rather than the progression system's.
  it('hands each element over in its own act and withholds it before', () => {
    // Paired, over every element at once. Either half alone is worthless: the withholding half
    // passes for an element that is never available, and the handing-over half for one that is
    // always available.
    for (const element of ELEMENT_ORDER) {
      const at = UNLOCKED_IN[element]
      expect(isElementAvailable(element, at), `${element} in its own act`).toBe(true)
      for (const earlier of ACTS.filter((a) => a < at)) {
        expect(isElementAvailable(element, earlier), `${element} in act ${earlier}`).toBe(false)
      }
    }
  })

  it('never withholds air, whatever act it is asked about', () => {
    // The invariant the water design note states as a promise: air is the baseline, and a player
    // with no element at all would have no attack. Checked across every act rather than at Act 1,
    // because "never" is the claim.
    for (const act of ACTS) expect(isElementAvailable('air', act)).toBe(true)
  })

  it('withholds something at Act 1, so the gate is not decorative', () => {
    // Without this the two assertions above would both pass for a table that unlocked everything
    // in Act 1 -- which is exactly the state this cycle replaced.
    const locked = ELEMENT_ORDER.filter((element) => !isElementAvailable(element, 1))
    expect(locked.length).toBeGreaterThan(0)
  })
})

describe('radialModel', () => {
  it('reports one slot per element, in order, with its clockwise index', () => {
    const model = radialModel(restingElements(), C, ACT, 0)
    expect(model.count).toBe(ELEMENT_ORDER.length)
    expect(model.slots.map((slot) => slot.element)).toEqual([...ELEMENT_ORDER])
    expect(model.slots.map((slot) => slot.index)).toEqual(ELEMENT_ORDER.map((_, i) => i))
  })

  it('marks exactly one slot active, and it is the selected one', () => {
    const model = radialModel({ active: 'water', aim: null }, C, ACT, 0)
    expect(model.slots.filter((slot) => slot.active).map((s) => s.element)).toEqual(['water'])
  })

  it('is closed with no offset and open with one', () => {
    expect(radialModel(restingElements(), C, ACT, 0).open).toBe(false)
    expect(radialModel(opened({ x: 0, y: -FAR }), C, ACT, 0).open).toBe(true)
  })

  it('highlights nothing inside the dead zone and the aimed slot outside it', () => {
    // The pair again, and it is the assertion that matters most for this function: a model that
    // never highlighted anything would look like a radial the mouse does not drive, and "no slot
    // is highlighted" alone passes for it.
    const twitched = radialModel(opened({ x: 1, y: -2 }), C, ACT, 0)
    expect(twitched.slots.filter((slot) => slot.highlighted)).toEqual([])
    const flicked = radialModel(opened(flickAt(1)), C, ACT, 0)
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
      const model = radialModel(opened(aim), C, ACT, 0)
      const highlighted = model.slots.find((slot) => slot.highlighted)?.element ?? null
      expect(highlighted, `${degrees} degrees`).toBe(expected)
    }
  })

  it('reports availability per slot from the one predicate that owns it', () => {
    for (const slot of radialModel(restingElements(), C, ACT, 0).slots) {
      expect(slot.available).toBe(isElementAvailable(slot.element, ACT))
    }
  })

  describe('the badge shows the string', () => {
    it('carries the link count', () => {
      expect(radialModel(restingElements(), C, ACT, 2).links).toBe(2)
    })

    it('carries a zero rather than hiding it, so the widget has one shape', () => {
      expect(radialModel(restingElements(), C, ACT, 0).links).toBe(0)
    })
  })
})
