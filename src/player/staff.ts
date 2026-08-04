/**
 * The staff as a weapon: short combos of wide arcs, and the commitment they cost.
 *
 * Player-side, like `dash.ts` and `slipstream.ts`, because a combo is a state machine over
 * time rather than something that happens to enemies. This module never sees an enemy — it
 * reports which swing began and lets the caller decide what that means, the same contract
 * `stepDash` and `detectSlam` use.
 *
 * The commitment is the point of the move. The design document calls no-glide-while-swinging
 * the game's central risk decision, and `recovery` is what gives that decision weight: the
 * combo keeps the staff for a beat after the last swing, so committing costs more than the
 * swings themselves.
 */
export interface StaffConfig {
  maxChain: number
  /** How long one swing occupies the staff. */
  swingSeconds: number
  /** Grace after a swing during which another press continues the combo. */
  continueSeconds: number
  /** Commitment owed once the combo ends, however it ended. */
  recoverySeconds: number
}

export interface StaffState {
  /**
   * Swings thrown in the current combo, 0 to maxChain. Reset to 0 the instant the combo
   * ends — whether that is the finisher landing or the continue window lapsing — so a
   * spent chain and an idle one look the same to everything but `recovery`.
   */
  chain: number
  /** Seconds into the active swing, or null between swings. */
  elapsed: number | null
  /** Seconds of commitment left after the combo ended. */
  recovery: number
  /**
   * Seconds since the last swing ended, counted only while a combo is still alive and
   * waiting on the next press (between swings, chain > 0, nothing owed yet).
   *
   * `chain` alone cannot tell "the window is still open" from "the window lapsed and
   * recovery is owed" — it has no notion of elapsed time between swings, so without this
   * field the combo could never expire on its own. It resets to 0 on every press that
   * starts a swing, and sits at 0 whenever it isn't the thing being measured (swinging,
   * idle, or recovering).
   */
  sinceSwing: number
}

/** The swing that just began. */
export interface StaffSwing {
  /** 1-based position in the combo. Drives the alternating sweep of the tell. */
  index: number
  /** The last swing of the chain: wider, heavier. */
  finisher: boolean
}

export function idleStaff(): StaffState {
  return { chain: 0, elapsed: null, recovery: 0, sinceSwing: 0 }
}

export function isSwinging(s: StaffState): boolean {
  return s.elapsed !== null
}

/** Swinging or still recovering: the staff is not available as a wing. */
export function staffBusy(s: StaffState): boolean {
  return isSwinging(s) || s.recovery > 0
}

/**
 * Read the four flat fields off a player as a `StaffState`.
 *
 * Exists so the controller and the action guide do not each assemble the struct by hand;
 * two copies of the same fields is how one of them ends up reading a stale one.
 */
export function staffOf(player: {
  staffChain: number
  staffElapsed: number | null
  staffRecovery: number
  staffSinceSwing: number
}): StaffState {
  return {
    chain: player.staffChain,
    elapsed: player.staffElapsed,
    recovery: player.staffRecovery,
    sinceSwing: player.staffSinceSwing,
  }
}

/** A fresh state once the combo has ended, whatever ended it: chain spent, recovery owed. */
function spent(c: StaffConfig): StaffState {
  return { chain: 0, elapsed: null, recovery: c.recoverySeconds, sinceSwing: 0 }
}

export function stepStaff(
  s: StaffState, pressed: boolean, dt: number, c: StaffConfig,
): { state: StaffState; started: StaffSwing | null } {
  if (isSwinging(s)) {
    // Mid-swing, a press cannot land — mashing must not stack swings on top of each
    // other. This is checked before anything else so a press here is simply dropped.
    const elapsed = (s.elapsed as number) + dt
    if (elapsed < c.swingSeconds) return { state: { ...s, elapsed }, started: null }

    // The swing just ended. The finisher ends the combo outright — there is nothing
    // left in the chain to continue into, so recovery is owed immediately rather than
    // waiting out a window that could never be used. Anything short of the finisher
    // opens the continue window instead: chain holds, recovery stays at zero, and
    // `sinceSwing` starts counting from this frame.
    if (s.chain >= c.maxChain) return { state: spent(c), started: null }
    return { state: { chain: s.chain, elapsed: null, recovery: 0, sinceSwing: 0 }, started: null }
  }

  // Not swinging. A press lands only when the staff is free: no recovery owed, and a
  // swing still left in the chain. If the continue window had already lapsed on an
  // earlier frame, that frame already reset chain to 0 and put recovery on the clock —
  // so checking `recovery <= 0` here is enough; there is no separate window check to
  // repeat.
  const free = s.recovery <= 0 && s.chain < c.maxChain
  if (pressed && free) {
    const index = s.chain + 1
    return {
      state: { chain: index, elapsed: 0, recovery: 0, sinceSwing: 0 },
      started: { index, finisher: index >= c.maxChain },
    }
  }

  // Recovery decays regardless of input — a press during recovery is ignored and must
  // not extend it, or mashing would turn the combo's cost into a punishment instead of
  // a fixed price.
  const recovery = Math.max(0, s.recovery - dt)

  if (s.chain === 0 || s.recovery > 0) {
    // Either no combo is in progress, or the chain is already spent and waiting out
    // recovery: neither case has a continue window to measure.
    return { state: { ...s, recovery, sinceSwing: 0 }, started: null }
  }

  // Between swings, mid-combo, nothing owed yet: this is exactly the continue window.
  const sinceSwing = s.sinceSwing + dt
  if (sinceSwing > c.continueSeconds) return { state: spent(c), started: null }
  return { state: { ...s, recovery, sinceSwing }, started: null }
}
