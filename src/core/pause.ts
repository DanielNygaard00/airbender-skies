/**
 * Whether the game is running, and what the card over it says when it is not.
 *
 * Pure and tested because the two things that consume it are not: `main.ts` has no tests
 * and `src/ui/pause-overlay.ts` cannot have any, the test environment being node with no
 * DOM. Everything here that could be wrong in a way a test would catch lives here.
 */

/** Every reason the game might not be running. */
export interface PauseInputs {
  /** The canvas holds the pointer lock, so the mouse is aiming rather than pointing. */
  pointerLocked: boolean
  /** The tab is in the background. */
  documentHidden: boolean
  /** The guide panel is up, which was already a pause before this module existed. */
  guideOpen: boolean
}

export type PauseReason = 'unlocked' | 'hidden' | 'guide'

/**
 * Which cause to report when several apply, and null exactly when the game runs.
 *
 * One function for both questions -- "is it running" is `pauseReason(i) === null`. An
 * earlier draft also had an `isPlaying` returning the conjunction directly, which is a
 * second independent implementation of the same thing with only one production caller, so
 * nothing would have noticed the two drifting apart.
 *
 * The guide comes first because it is the only cause the player chose on purpose, and
 * `hidden` beats `unlocked` because a backgrounded tab has almost certainly lost the lock
 * as well, so the more specific cause is the more useful one.
 *
 * `documentHidden` is deliberately its own input rather than being folded into
 * `pointerLocked`. Hiding a tab very probably releases the pointer lock too, which would
 * make this input redundant -- but that could not be verified: the harness this was built
 * in never receives OS focus, so `requestPointerLock` always errors and there is no lock to
 * watch being released. Kept separate, the verdict is right either way, and if the browser
 * does drop the lock the two causes simply coincide.
 */
export function pauseReason(i: PauseInputs): PauseReason | null {
  if (i.guideOpen) return 'guide'
  if (i.documentHidden) return 'hidden'
  if (!i.pointerLocked) return 'unlocked'
  return null
}

export interface OverlayModel {
  visible: boolean
  title: string
  action: string
  hint: string
}

const HIDDEN: OverlayModel = { visible: false, title: '', action: '', hint: '' }

/** What a visible card always offers, alongside whatever brought it up. */
const HINT = 'H — guide'

/**
 * The card's copy, as a total function of the reason.
 *
 * The guide gets no card: it is already a full-screen panel whose own subtitle says the
 * game is paused, and a second panel over it saying the same thing would be a defect.
 */
export function pauseOverlayModel(
  reason: PauseReason | null,
  everStarted: boolean,
): OverlayModel {
  if (reason === null || reason === 'guide') return HIDDEN
  return everStarted
    ? { visible: true, title: 'Paused', action: 'Click to resume', hint: HINT }
    : { visible: true, title: 'Airbender Skies', action: 'Click to play', hint: HINT }
}
