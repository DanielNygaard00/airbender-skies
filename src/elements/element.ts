/**
 * Which element Aang is bending, and the radial that changes it.
 *
 * Section 4.2 of the design document describes the borrowed elements as "a small, distinct
 * verb rather than a full duplicate kit", switched "on a radial", and switching as "fast
 * enough to sequence mid-combo: vortex a group, freeze the front rank, drop a pillar under
 * them." Two things follow from that sentence and they are the whole shape of this module.
 *
 * **The elements share the bending keys.** F is the active element's light verb and R is its
 * heavy one, and what those keys do depends on what is selected here. The alternative — one
 * key per move per element — was considered and rejected, because it makes the radial
 * decoration: if freeze had its own key you would never switch, and the document's example
 * sequence would be three unrelated presses rather than a sequence at all. Sharing the keys
 * is what makes the switch a real part of a combo, and it is also the only binding scheme
 * that survives earth and fire arriving: the game does not have six more free keys.
 *
 * **Switching is free.** There is no cooldown here, no charge, no animation lock and no
 * refusal. "Fast enough to sequence mid-combo" is not a tuning target that a small cooldown
 * would approximately meet; it is a statement that the switch is not a move. Anything in
 * flight — a staff swing, a vortex charge, a dodge — carries on across a switch untouched.
 *
 * **The radial does not slow, pause or gate anything, and this is an owner ruling rather than
 * an inference.** The simulation runs at full speed while the radial is open, enemies keep
 * acting, and no input is withheld — including mouse-look, which keeps turning the view from
 * the very same pointer movement that steers the wedges (see `ElementState.aim`). Two things
 * follow. The radial has to be readable at a glance or not read at all, which is why
 * `ELEMENT_ORDER` is fixed and never reordered by recency: the direction a player flicks means
 * the same thing every session, so the gesture becomes muscle memory and the widget stops
 * being looked at. And the number-key binds in `ElementInput.directIndex` are not a
 * convenience — with no slow-motion to read a menu in, they are the path most players will
 * settle on, and the radial is the thing that teaches the layout they then use without it.
 *
 * Deliberately not part of PlayerState, for the reason `Focus` and `Encounter` are not:
 * movement is a pure function of a struct that a dozen tests build fixtures for, and which
 * element is selected is not a property of the character's kinematics.
 */

/**
 * The elements Aang can bend.
 *
 * Air is the baseline and is always available; water is the first borrowed element. Earth
 * and fire join this union, and every `Record<Element, ...>` in the codebase then fails to
 * compile until they are given a wedge label, a guide entry and a HUD colour — which is the
 * point of typing them as a Record rather than as a lookup with a fallback. See the contract
 * section of `docs/superpowers/specs/2026-08-11-water-element-design.md`.
 */
export type Element = 'air' | 'water'

/**
 * The radial's order, clockwise from straight up.
 *
 * Air first because it is the baseline: the element you return to is the one under a straight
 * flick upward, which is the least deliberate direction the wrist can produce. Adding earth
 * and fire means appending to this array — the wedge geometry below divides the circle by
 * `length`, so nothing else has to change, and the two new elements land on the two
 * directions the wrist finds next.
 *
 * With only two entries the sectors are half-circles and the boundary runs along the
 * horizontal axis, which is exactly why `deadZonePixels` exists (see `radialHighlight`). A
 * third element makes the geometry natural rather than merely workable.
 */
export const ELEMENT_ORDER: readonly Element[] = ['air', 'water']

export interface ElementConfig {
  /**
   * Pointer travel needed before the radial reads a direction at all, in pixels.
   *
   * Below it the radial highlights nothing and a release keeps the element already selected.
   * That matters more here than it would with four wedges: with two, every direction that is
   * not straight up or straight down is within a hair of a sector boundary, so a radial that
   * committed on the first pixel of movement would reassign the element on a twitch. A player
   * who opens the radial and changes their mind must be able to close it by letting go.
   *
   * 24 pixels rather than a fraction of the viewport: this is a wrist movement, and a wrist
   * movement is measured in mouse counts, not in how large the monitor is. It is also well
   * under the travel a deliberate flick produces at the default sensitivity — `lookDelta`
   * turns 24 pixels into about 3 degrees of view, which is a nudge rather than a gesture.
   */
  deadZonePixels: number
}

/** Where the radial's dead zone sits. One value, so it is a config and not a literal. */
export const DEFAULT_ELEMENT_CONFIG: ElementConfig = { deadZonePixels: 24 }

/** A pointer offset in screen pixels: +x right, +y down, the way a mouse delta arrives. */
export interface Aim {
  x: number
  y: number
}

export interface ElementState {
  active: Element
  /**
   * The pointer offset accumulated since the radial opened, or null while it is closed.
   *
   * Accumulated rather than read as an absolute cursor position, because the pointer is
   * locked during play and there is no cursor to read. It is also why opening the radial must
   * not release the lock: relative movement is the only input this can be driven by, and
   * `document.exitPointerLock()` would stop it arriving. The guide panel deliberately does
   * release the lock, and this is the one place in the game that must not copy it.
   *
   * The offset is fed the *same* pointer movement the camera is fed, not movement diverted
   * away from it. Diverting it would be the obvious implementation and it is forbidden: the
   * owner's ruling is that holding the radial open must not eat a frame of control, and
   * swallowing mouse-look for as long as a key is held is exactly that. So a flick that picks
   * water also turns the view by however much that flick is worth — about 3 degrees at the
   * dead zone and under 8 for a committed pick, at the default sensitivity. That view nudge is
   * the deliberate price of never taking the camera away from the player.
   */
  aim: Aim | null
}

export function restingElements(): ElementState {
  return { active: 'air', aim: null }
}

/**
 * Whether an element is available to the player at all.
 *
 * **Section 5 puts water in Act 2, and there is no act structure yet, so water is available
 * from the start** — exactly as the Avatar State is, which section 4.5 story-locks to the
 * early game and which the game hands over on the first frame. When acts exist, this is the
 * one function that has to learn about them: gate it on progression here and the guide's
 * strike-through, the radial's dimming and the resolvers in `stepEncounter` all follow,
 * because all three ask this and nothing restates the rule.
 *
 * **It is also where a "water needs a source nearby" rule would go, and it deliberately is
 * not one.** Section 4.2 gives water three jobs and the world can support one of them: there
 * is no pooled water anywhere in the archipelago and no fire hazards, so "extinguishes fire
 * hazards" and "turns pooled water into a hazard surface" have nothing to act on. What does
 * exist is `src/world/waterfall.ts` — six curtains on five islands — and drawing from those
 * is the strongest available reading of the control element without inventing world content.
 *
 * The argument for requiring one was real and it lost on a measurement. A source requirement
 * makes water positional, which suits a game whose whole defence is positional, and it would
 * give the waterfalls a mechanical job instead of a decorative one. But the archipelago's
 * only encounter is `HOME_PATROL`, on the home island's +X/−Z side at radius 18 to 55, and
 * the home island's two waterfalls sit at rim angles 2.1 and 4.4 radians — that is the
 * −X/+Z and −X/−Z rims. Neither is anywhere near the fight. A source requirement would
 * therefore not make water positional; it would make water unusable in the only place the
 * game has to use it, which is not a tuning problem but a shipped element that never fires.
 *
 * So: always available, and the requirement is recorded as the thing to revisit on the day
 * there is pooled water and more than one encounter. The right time to add it is the same
 * cycle that adds the hazard surface, because the two share a world query — "is there water
 * within reach" — and building that query for a rule that only restricts the player, with no
 * rule that rewards them for standing near a source, is the wrong half to build first.
 */
export function isElementAvailable(_element: Element): boolean {
  return true
}

/**
 * Which wedge the accumulated pointer offset points at, or null inside the dead zone.
 *
 * Screen y grows downward, so straight up is negative y and `atan2(x, -y)` is 0 pointing up
 * and increases clockwise — which is the order `ELEMENT_ORDER` is written in.
 *
 * `Math.round` rather than `Math.floor` puts each element at the *centre* of its sector
 * rather than at its leading edge, so a flick straight up lands on air with the maximum
 * possible margin either side rather than sitting on a boundary. With two elements the
 * boundaries fall exactly on the horizontal axis: a perfectly horizontal flick resolves left
 * to air and right to water, because `Math.round(-0.5)` is `-0` and `Math.round(0.5)` is 1.
 * That is deterministic rather than arbitrary, but it is not *meaningful*, which is what the
 * dead zone is for.
 */
export function radialHighlight(aim: Aim, c: ElementConfig): Element | null {
  const count = ELEMENT_ORDER.length
  if (count === 0) return null
  const distance = Math.hypot(aim.x, aim.y)
  // Fails closed on a non-finite offset rather than propagating it: the result picks an
  // array index, and a NaN there silently selects nothing while looking like a dead radial.
  if (!Number.isFinite(distance) || distance < c.deadZonePixels) return null

  const sector = (2 * Math.PI) / count
  const angle = Math.atan2(aim.x, -aim.y)
  const index = ((Math.round(angle / sector) % count) + count) % count
  return ELEMENT_ORDER[index] ?? null
}

/** What the player did this frame that the element system cares about. */
export interface ElementInput {
  /** The radial key is held: the radial is open. */
  radialHeld: boolean
  /** The radial key came up this frame: commit the highlighted wedge. */
  radialReleased: boolean
  /** Pointer movement this frame, in pixels. Only meaningful while the radial is open. */
  aimDelta: Aim
  /**
   * A direct number-key bind, 1-based, or null.
   *
   * Offered alongside the radial rather than instead of it. The radial is the shape the
   * design document asks for and it is the better gesture with four elements on screen; a
   * number key is the better one for a player who already knows which element they want and
   * does not need to look. Both write the same field, so neither is a second code path.
   */
  directIndex: number | null
}

/**
 * Advance the selection one frame.
 *
 * A direct bind wins over a radial release landing on the same frame. Either would be
 * defensible; the direct bind is chosen because it is unambiguous — the player named an
 * element — where a release may well be inside the dead zone and mean nothing.
 */
export function stepElements(
  state: ElementState, input: ElementInput, c: ElementConfig,
): ElementState {
  let active = state.active
  /**
   * Whether a number key already decided this frame, so the radial does not overrule it.
   *
   * A flag rather than an early return, because the radial still has to *close* on its release
   * even when the pick came from elsewhere — an early return on the bind would leave the offset
   * standing and the widget open with the key already up.
   */
  let named = false

  if (input.directIndex !== null) {
    const picked = ELEMENT_ORDER[input.directIndex - 1]
    // Silently ignores an index past the end, which is what pressing 3 does today. A key
    // bound to an element that does not exist yet must not throw and must not wrap around
    // to air, because wrapping would make 3 a second air bind and then break the day earth
    // arrives and 3 starts meaning something.
    if (picked !== undefined && isElementAvailable(picked)) {
      active = picked
      named = true
    }
  }

  if (input.radialReleased) {
    // `state.aim` and not `state.aim + delta`: the release frame's movement is the
    // mouse-up flick, and folding it in would let a jerk on the button change the pick.
    const pending = state.aim === null ? null : radialHighlight(state.aim, c)
    // `!named` is what makes the direct bind win, and the guard is here rather than implied by
    // statement order — which is how it was written first, and it silently did the opposite of
    // what the doc comment above claims. `element.test.ts` pins the precedence for that reason.
    if (!named && pending !== null && isElementAvailable(pending)) active = pending
    return { active, aim: null }
  }

  if (!input.radialHeld) {
    // Neither held nor released: the key went away without a key-up edge, which is what a
    // window blur produces — `InputTracker`'s blur handler clears the held-key set but never
    // fires keyup. The same hazard `stepEncounter` guards for a vortex charge, and the same
    // answer: clear, so a later open starts from the centre instead of resuming a stale
    // offset and committing a direction the player never aimed at.
    return { active, aim: null }
  }

  const from = state.aim ?? { x: 0, y: 0 }
  return { active, aim: { x: from.x + input.aimDelta.x, y: from.y + input.aimDelta.y } }
}

/** One wedge of the radial, as the view draws it. */
export interface RadialSlot {
  element: Element
  /** Clockwise position from straight up, so the view needs no knowledge of the order. */
  index: number
  /** The element currently in effect. Drawn whether or not the radial is open. */
  active: boolean
  /** The element a release right now would land on. Never set while inside the dead zone. */
  highlighted: boolean
  /** False for an element the player has not unlocked, so the view can dim it. */
  available: boolean
}

export interface RadialModel {
  open: boolean
  slots: readonly RadialSlot[]
  /** How many wedges there are, so the view can lay them out without importing the order. */
  count: number
}

/**
 * The radial as a drawable model, computed once.
 *
 * A pure function here rather than the view reading `ELEMENT_ORDER` and calling
 * `radialHighlight` itself, for the reason `hudModelFor` exists: the view cannot be tested in
 * the node environment, so every decision that could be wrong is made on this side of the
 * line and the view is left with a class toggle and a transform.
 */
export function radialModel(state: ElementState, c: ElementConfig): RadialModel {
  const highlighted = state.aim === null ? null : radialHighlight(state.aim, c)
  return {
    open: state.aim !== null,
    count: ELEMENT_ORDER.length,
    slots: ELEMENT_ORDER.map((element, index) => ({
      element,
      index,
      active: element === state.active,
      highlighted: element === highlighted,
      available: isElementAvailable(element),
    })),
  }
}
