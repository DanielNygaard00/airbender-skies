import { Vector3 } from 'three'

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
}

export interface SlipstreamState {
  /** Seconds since it fired, or null when not slipstreaming. */
  elapsed: number | null
  cooldown: number
}

export function idleSlipstream(): SlipstreamState {
  return { elapsed: null, cooldown: 0 }
}

/** Not already dashing, and off cooldown. */
export function canSlipstream(state: SlipstreamState): boolean {
  return state.elapsed === null && state.cooldown <= 0
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
 * Advance the dodge. The impulse is returned rather than applied, the same contract
 * `stepDash` uses, so movement code stays in charge of integration.
 */
export function stepSlipstream(
  state: SlipstreamState,
  pressed: boolean,
  heading: Vector3,
  dt: number,
  c: SlipstreamConfig,
): { state: SlipstreamState; impulse: Vector3 | null } {
  if (pressed && canSlipstream(state)) {
    const flat = new Vector3(heading.x, 0, heading.z)
    const direction = flat.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : flat.normalize()
    return {
      state: { elapsed: 0, cooldown: c.cooldownSeconds },
      impulse: direction.multiplyScalar(c.speed),
    }
  }

  const cooldown = Math.max(0, state.cooldown - dt)
  if (state.elapsed === null) return { state: { elapsed: null, cooldown }, impulse: null }

  const elapsed = state.elapsed + dt
  return {
    state: { elapsed: elapsed >= c.durationSeconds ? null : elapsed, cooldown },
    impulse: null,
  }
}
