import { MathUtils } from 'three'

/**
 * The beat between going down and standing back up.
 *
 * `health.ts` refuses to regenerate a downed combatant off the floor, and says standing
 * them up is a decision for a system above it. This is that system for the player.
 *
 * Pure and posture-free, like `slipstream.ts` and `staff.ts`: it knows nothing about a
 * scene, a PlayerState, or an enemy. It reports *when* to respawn; main.ts decides what a
 * respawn means.
 */
export interface DownConfig {
  /** Blackout ramp. The respawn lands at full black, so it is never seen. */
  fadeOutSeconds: number
  /** Ramp back in afterwards. */
  fadeInSeconds: number
}

export interface Down {
  /** Seconds since the player went down. */
  elapsed: number
}

/**
 * How far the avatar sinks, as a fraction of full height.
 *
 * Exported so the test asserts against the constant rather than a second copy of the
 * number, which is how the two drift apart.
 */
export const COLLAPSE_SCALE = 0.35

export function startDown(): Down {
  return { elapsed: 0 }
}

/**
 * Advance the beat.
 *
 * `respawnNow` is derived from the before and after times rather than recorded on `Down`,
 * so it fires on exactly one frame and there is no second field to drift out of step with
 * the timer it describes.
 *
 * A step long enough to cross both boundaries reports the respawn *and* clears the state.
 * The respawn still applies; a frame that long has worse problems than a skipped fade.
 */
export function stepDown(
  down: Down, dt: number, c: DownConfig,
): { down: Down | null; respawnNow: boolean } {
  const elapsed = down.elapsed + dt
  // Fails open, not closed. Clamping a non-finite timer would leave the player in a
  // frozen world with no input and no way out, which is strictly worse than standing them
  // up a moment early with no explanation.
  if (!Number.isFinite(elapsed)) return { down: null, respawnNow: true }

  const respawnNow = down.elapsed < c.fadeOutSeconds && elapsed >= c.fadeOutSeconds
  if (elapsed >= c.fadeOutSeconds + c.fadeInSeconds) return { down: null, respawnNow }
  return { down: { elapsed }, respawnNow }
}

/**
 * How black the screen is, 0 to 1.
 *
 * Two ramps rather than one flat hold, because the whole reason for the beat is that the
 * teleport happens at full black and the player never sees it.
 */
export function fadeOpacity(down: Down | null, c: DownConfig): number {
  if (!down || !Number.isFinite(down.elapsed)) return 0
  if (down.elapsed < c.fadeOutSeconds) {
    // A zero-length ramp is instant rather than a division by zero.
    if (!(c.fadeOutSeconds > 0)) return 1
    return MathUtils.clamp(down.elapsed / c.fadeOutSeconds, 0, 1)
  }
  if (!(c.fadeInSeconds > 0)) return 0
  return MathUtils.clamp(1 - (down.elapsed - c.fadeOutSeconds) / c.fadeInSeconds, 0, 1)
}

/**
 * Vertical scale for the avatar as he sinks, driving the same squash channel jump
 * charging uses. There is no collapse clip to play, and teaching `planClips` about one
 * needs an asset the character model may not ship.
 *
 * Back to 1 from `fadeOutSeconds` onward: the respawn has already landed by then, and a
 * squashed avatar revealed by the lifting black would undo the effect.
 */
export function collapseSquash(down: Down | null, c: DownConfig): number {
  if (!down || !Number.isFinite(down.elapsed)) return 1
  if (down.elapsed >= c.fadeOutSeconds) return 1
  if (!(c.fadeOutSeconds > 0)) return COLLAPSE_SCALE
  const t = MathUtils.clamp(down.elapsed / c.fadeOutSeconds, 0, 1)
  return 1 - (1 - COLLAPSE_SCALE) * t
}

/**
 * Whether the respawn has already landed — the fade in half of the beat.
 *
 * Shares the `fadeOutSeconds` boundary with `fadeOpacity` and `collapseSquash` rather
 * than letting a caller re-derive it, so the three cannot disagree about when the
 * player is back on their feet. Before this boundary the world is meant to look
 * frozen, which is the point of the beat; from it onward, everything is behind full
 * black and has to settle into the recovered state before the black lifts.
 */
export function hasRespawned(down: Down | null, c: DownConfig): boolean {
  if (!down || !Number.isFinite(down.elapsed)) return true
  return down.elapsed >= c.fadeOutSeconds
}
