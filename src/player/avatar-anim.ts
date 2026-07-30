import type { PlayerState } from '../core/types'

export type AnimationName = 'idle' | 'walk' | 'run' | 'fall' | 'glide'

const WALK_THRESHOLD = 0.5
const RUN_THRESHOLD = 9

/**
 * Which clip should be playing. Pure, so the state machine is testable without
 * a Three.js AnimationMixer.
 */
export function animationFor(state: PlayerState): AnimationName {
  if (state.mode === 'kite') return 'glide'
  if (!state.grounded) return 'fall'
  const horizontal = Math.hypot(state.velocity.x, state.velocity.z)
  if (horizontal < WALK_THRESHOLD) return 'idle'
  return horizontal >= RUN_THRESHOLD ? 'run' : 'walk'
}
