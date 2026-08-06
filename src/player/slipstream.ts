import { Vector3 } from 'three'
import type { PlayerMode } from '../core/types'

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
 *
 * In the glider they mean something else entirely: W is airbending thrust and S is a
 * flare. Reading them as translation made holding S dodge *backwards*, for an input that
 * only ever meant "raise the nose" — and since W is the normal flying state, it would
 * have turned almost every glider dodge into a forward one. So only the bank axis steers
 * a glider dodge, and it steers it perpendicular to the heading, which is the direction
 * that beats something coming straight at you. The basis is the glider's own forward
 * rather than the camera, because in the glider the mouse only trims: the heading is
 * where the player is actually flying.
 */
export function dodgeHeading(
  mode: PlayerMode,
  gliderForward: Vector3,
  lookDirection: Vector3,
  forwardAxis: number,
  strafeAxis: number,
): Vector3 {
  // Composed from slipstreamHeading rather than restating how axes become a direction,
  // so there is one definition of that and the two postures only choose its inputs.
  return mode === 'glider'
    ? slipstreamHeading(gliderForward, 0, strafeAxis)
    : slipstreamHeading(lookDirection, forwardAxis, strafeAxis)
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
