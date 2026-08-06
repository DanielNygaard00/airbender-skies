import { Vector3 } from 'three'
import type { PlayerMode } from '../core/types'
import { gliderRight } from './flight'

/**
 * Slipstream: a directional dash with a brief invulnerability window.
 *
 * The design doc calls it "the dodge, upgraded", and files it under combat while the
 * blast dash in `dash.ts` sits under movement — they are different tools. The blast
 * dash is ground-only and chains three times; this works in both postures and is
 * limited by a single cooldown.
 *
 * The invulnerable window is deliberately shorter than the dash. That is what makes
 * the timing tight: the move keeps displacing you after the protection has ended, so
 * a mistimed dodge leaves you committed to a direction with nothing to show for it.
 */
export interface SlipstreamConfig {
  speed: number
  durationSeconds: number
  /** Measured from the start, and shorter than `durationSeconds`. */
  invulnerableSeconds: number
  cooldownSeconds: number
  /**
   * Breath a dodge spends, deducted the frame it fires.
   *
   * Chosen against thrust, because the two are alternatives for gaining speed and the
   * dodge has to be the worse of them. Thrust buys `thrustAccel` 22 for
   * `breathDrainPerSecond` 18, a ratio of 1.22; a dodge buys `speed` 30 over
   * `cooldownSeconds` 1.5 for this cost over the same 1.5, a ratio of `speed / breathCost`.
   * They break even at 25. Above that, thrust is the efficient way to go faster and the
   * dodge is what you spend when you need the invulnerability — which is the ordering the
   * move is supposed to have, and a test pins it.
   */
  breathCost: number
}

export interface SlipstreamState {
  /** Seconds since it fired, or null when not slipstreaming. */
  elapsed: number | null
  cooldown: number
}

export function idleSlipstream(): SlipstreamState {
  return { elapsed: null, cooldown: 0 }
}

/** Not already dashing, off cooldown, and able to pay for it. */
export function canSlipstream(
  state: SlipstreamState, breath: number, c: SlipstreamConfig,
): boolean {
  return state.elapsed === null && state.cooldown <= 0 && breath >= c.breathCost
}

export function isInvulnerable(state: SlipstreamState, c: SlipstreamConfig): boolean {
  return state.elapsed !== null && state.elapsed < c.invulnerableSeconds
}

/**
 * Where a dodge should go: the movement keys when they are held, and the camera
 * otherwise. The same rule `groundStep` applies to a standing dash, so a player who
 * has stopped to aim dodges where they are looking.
 */
export function slipstreamHeading(
  lookDirection: Vector3, forward: number, strafe: number,
): Vector3 {
  const flat = new Vector3(lookDirection.x, 0, lookDirection.z)
  const facing = flat.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : flat.normalize()
  if (Math.abs(forward) < 0.01 && Math.abs(strafe) < 0.01) return facing
  const right = new Vector3().crossVectors(facing, new Vector3(0, 1, 0)).normalize()
  const move = facing.clone().multiplyScalar(forward).addScaledVector(right, strafe)
  return move.lengthSq() < 1e-8 ? facing : move.normalize()
}

/**
 * Where a dodge goes, per posture. Both the controller and the effect that draws the
 * streak call this, so the drawn direction cannot drift from the resolved one.
 *
 * On foot the movement keys mean walk and strafe, so a dodge is camera-relative and can
 * go anywhere, backwards included.
 */
export function dodgeHeading(
  mode: PlayerMode,
  gliderForward: Vector3,
  lookDirection: Vector3,
  forwardAxis: number,
  strafeAxis: number,
  bank: number,
): Vector3 {
  // In the glider the movement keys mean something else: W is airbending thrust and S is
  // a flare. Reading them as translation made holding S dodge *backwards* for an input
  // that only meant "raise the nose", and since W is the normal flying state it turned
  // almost every glider dodge into a forward one.
  //
  // So a glider dodge is lateral, along the glider's own right axis, with the bank axis
  // choosing the side and a default side when nothing is held. Perpendicular to the
  // flight path by construction, for any heading, because `gliderRight` is an axis of a
  // frame built on `forward` -- which is what beats something coming straight at you, and
  // is what the guide panel has told players the move does all along.
  //
  // `bank` is the glider's actual roll -- the same value `flightStep` derives as
  // `input.strafe * 0.6` for lift -- passed through rather than fixed at zero, so a dodge
  // thrown while banked rolls with the wing and picks up the vertical component that
  // implies, rather than being crushed onto the horizontal plane regardless of roll.
  // Level (bank 0) the break stays exactly horizontal, which is the deliberate baseline,
  // not an oversight -- wings level, no roll to carry a vertical component on.
  //
  // Bank is sign-locked to the same strafe axis that picks the side, because strafe is
  // the only lateral input there is -- there is no separate "roll independently of which
  // side you break toward" control. Both directions of that coupled pair currently break
  // upward: `gliderRight` returns the frame's true right (fixed after shipping the mirror
  // once -- see the handedness test in flight.test.ts), and with `bank = strafe * 0.6`
  // on both sides, the vertical component the roll contributes comes out positive
  // regardless of which side strafe picks. This is *not* a free-altitude reopening in
  // practice: the kick is one instantaneous velocity injection per cooldown, and gravity
  // pulls harder than that across the 1.5s gap before the next one lands -- measured
  // against both a held bank and a bank tapped only on the firing frame, forty seconds of
  // chain-dodging still ends well below where it started either way. It is recorded here
  // because it was not the intended shape going in, and the next person to touch this
  // coupling needs to know the sign is what it is, not what the design doc originally
  // said, and why that's still safe rather than assumed to be.
  //
  // A default side rather than a fallback to the heading: falling back to forward made
  // the no-bank press -- the common one -- a free 30 m/s boost.
  if (mode === 'glider') {
    const right = gliderRight(gliderForward, bank)
    return strafeAxis < 0 ? right.negate() : right
  }
  return slipstreamHeading(lookDirection, forwardAxis, strafeAxis)
}

/**
 * Advance the dodge. The impulse is returned rather than applied, the same contract
 * `stepDash` uses, so movement code stays in charge of integration.
 */
export function stepSlipstream(
  state: SlipstreamState,
  pressed: boolean,
  heading: Vector3,
  breath: number,
  dt: number,
  c: SlipstreamConfig,
): { state: SlipstreamState; impulse: Vector3 | null; breathSpent: number } {
  if (pressed && canSlipstream(state, breath, c)) {
    // Not flattened: the impulse follows the heading in all three axes, because a glider
    // dodge is perpendicular to the flight path and that perpendicular is not guaranteed
    // to be horizontal -- gliderRight rolls with bank, so a heading with a vertical
    // component must be allowed through rather than crushed onto the ground plane. The
    // ground dodge is unaffected either way, since slipstreamHeading already returns a
    // horizontal vector.
    const direction = heading.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : heading.clone().normalize()
    return {
      state: { elapsed: 0, cooldown: c.cooldownSeconds },
      impulse: direction.multiplyScalar(c.speed),
      breathSpent: c.breathCost,
    }
  }

  const cooldown = Math.max(0, state.cooldown - dt)
  if (state.elapsed === null) {
    return { state: { elapsed: null, cooldown }, impulse: null, breathSpent: 0 }
  }

  const elapsed = state.elapsed + dt
  return {
    state: { elapsed: elapsed >= c.durationSeconds ? null : elapsed, cooldown },
    impulse: null,
    breathSpent: 0,
  }
}
