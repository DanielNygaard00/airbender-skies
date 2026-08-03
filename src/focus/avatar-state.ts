import { MathUtils } from 'three'
import { isFull, type Focus } from './focus'

/**
 * The Avatar State: armed by sustained maximum Focus, fired by the player.
 *
 * Not to be confused with `src/player/avatar.ts`, which is the character *model* and
 * has nothing to do with this file. The name is the design document's term.
 *
 * The document asks for something situational that cannot be farmed, and those pull in
 * opposite directions. The resolution is that the charge is held rather than banked: it
 * fills only while Focus sits at maximum and empties the moment Focus drops, so keeping
 * it means continuing to play cleanly. The player still chooses the moment.
 */
export interface AvatarState {
  /** Seconds Focus has been pinned at maximum. Fills the arming charge. */
  armTime: number
  /** Seconds of Avatar State remaining. 0 means not running. */
  remaining: number
}

export interface AvatarStateConfig {
  /** Seconds at maximum Focus needed to arm. */
  armSeconds: number
  /** How long the state runs. Short, per the document. */
  durationSeconds: number
  /** Multiplies gust damage while active. */
  gustDamageMultiplier: number
  /** Multiplies gust knockback while active. */
  gustKnockbackMultiplier: number
  /** Multiplies a helpful wind feature's acceleration while active. */
  surgeAccelMultiplier: number
  /** Scales a downdraft's acceleration toward zero while active. */
  relentFactor: number
}

export interface AvatarStateStep {
  state: AvatarState
  /** The state is running this frame: effects apply. */
  active: boolean
  /** The state ended this frame: Focus empties. */
  justEnded: boolean
}

export function restingAvatarState(): AvatarState {
  return { armTime: 0, remaining: 0 }
}

export function isActive(state: AvatarState): boolean {
  return state.remaining > 0
}

export function isArmed(state: AvatarState, c: AvatarStateConfig): boolean {
  return !isActive(state) && state.armTime >= c.armSeconds
}

export function armFraction(state: AvatarState, c: AvatarStateConfig): number {
  if (!(c.armSeconds > 0)) return isActive(state) ? 0 : 1
  return MathUtils.clamp(state.armTime / c.armSeconds, 0, 1)
}

/**
 * Advance the state one frame.
 *
 * `active` is reported true on the frame the trigger fires, so the effects apply from
 * that frame rather than the next one. `armTime` is held at zero for the whole run: the
 * state freezes Focus at maximum, so an accumulating charge would hand the player a
 * second one for free the instant the first ended.
 */
export function stepAvatarState(
  state: AvatarState,
  focus: Focus,
  triggerPressed: boolean,
  dt: number,
  c: AvatarStateConfig,
): AvatarStateStep {
  if (isActive(state)) {
    const remaining = state.remaining - dt
    if (remaining > 0) {
      return { state: { armTime: 0, remaining }, active: true, justEnded: false }
    }
    // Clamped rather than left negative, so a long frame cannot leave the state
    // looking like it has time owed to it.
    return { state: { armTime: 0, remaining: 0 }, active: true, justEnded: true }
  }

  const charged: AvatarState = {
    armTime: isFull(focus) ? state.armTime + dt : 0,
    remaining: 0,
  }

  if (triggerPressed && isArmed(charged, c)) {
    return {
      state: { armTime: 0, remaining: c.durationSeconds },
      active: true,
      justEnded: false,
    }
  }

  return { state: charged, active: false, justEnded: false }
}
