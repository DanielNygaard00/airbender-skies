import { MathUtils, Vector3 } from 'three'
import type { GroundConfig } from '../core/types'

/**
 * The air blast dash: a short burst of ground-shed thrust.
 *
 * Per the design doc it cancels most animations and chains three times before a
 * short recovery. The chain limit is the whole design: dashing is free enough to be
 * the default answer to a gap, but not free enough to replace running, so the
 * recovery window is where the player has to commit to a line instead.
 */
export interface DashState {
  /** Dashes spent in the current chain. */
  used: number
  /** Seconds of recovery still owed before the chain resets. */
  recovery: number
}

export function idleDash(): DashState {
  return { used: 0, recovery: 0 }
}

export interface DashStep {
  state: DashState
  /**
   * Impulse to add to velocity this frame, or null when no dash fired. Returned
   * rather than applied so movement code stays in charge of integration.
   */
  impulse: Vector3 | null
}

/** A dash is available while the chain is unspent and no recovery is owed. */
export function canDash(state: DashState, c: GroundConfig): boolean {
  return state.recovery <= 0 && state.used < c.maxDashChain
}

/**
 * Advance the dash chain.
 *
 * `heading` is where the burst should push. Recovery only ticks down once the chain
 * is spent, so an unspent chain never expires — a player who dashes once and then
 * runs for a minute still has two in hand, which keeps the move a tool rather than
 * a timer to watch.
 */
export function stepDash(
  state: DashState,
  pressed: boolean,
  heading: Vector3,
  grounded: boolean,
  dt: number,
  c: GroundConfig,
): DashStep {
  // Landing resets the chain: the recovery is a ground-layer cost, and being
  // airborne is already its own limitation.
  if (grounded && state.used >= c.maxDashChain) {
    const recovery = state.recovery - dt
    if (recovery <= 0) return { state: idleDash(), impulse: null }
    return { state: { used: state.used, recovery }, impulse: null }
  }

  if (!pressed || !canDash(state, c)) {
    return { state: { ...state, recovery: Math.max(0, state.recovery - dt) }, impulse: null }
  }

  const used = state.used + 1
  const flat = new Vector3(heading.x, 0, heading.z)
  const direction = flat.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : flat.normalize()
  return {
    // The recovery is only owed once the third dash is spent.
    state: { used, recovery: used >= c.maxDashChain ? c.dashRecoverySeconds : 0 },
    impulse: direction.multiplyScalar(c.dashSpeed),
  }
}

/**
 * How much of a dash impulse survives after `elapsed` seconds.
 *
 * The burst decays rather than being a permanent speed gain, so a dash is a
 * displacement tool and cannot be chained into unbounded velocity.
 */
export function dashDecay(elapsed: number, c: GroundConfig): number {
  if (c.dashDurationSeconds <= 0) return 0
  return MathUtils.clamp(1 - elapsed / c.dashDurationSeconds, 0, 1)
}
