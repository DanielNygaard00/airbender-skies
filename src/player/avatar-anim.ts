import type { GroundConfig, PlayerState } from '../core/types'
import { isCharging } from './jump'

export type AnimationName = 'idle' | 'walk' | 'run' | 'fall' | 'glide'

const WALK_THRESHOLD = 0.5
const RUN_THRESHOLD = 9
const FULL_CHARGE_SQUASH = 0.7

/**
 * Which clip should be playing. Pure, so the state machine is testable without
 * a Three.js AnimationMixer.
 */
export function animationFor(state: PlayerState): AnimationName {
  if (state.mode === 'glider') return 'glide'
  if (!state.grounded) return 'fall'
  const horizontal = Math.hypot(state.velocity.x, state.velocity.z)
  if (horizontal < WALK_THRESHOLD) return 'idle'
  return horizontal >= RUN_THRESHOLD ? 'run' : 'walk'
}

/** Vertical crouch while charging a jump. 1 = full height. */
export function chargeSquashScale(state: PlayerState, c: GroundConfig): number {
  if (!state.grounded || !isCharging(state.chargeTime, c)) return 1
  const t = Math.min(state.chargeTime, c.chargeMaxSeconds) / c.chargeMaxSeconds
  return 1 - (1 - FULL_CHARGE_SQUASH) * t
}
