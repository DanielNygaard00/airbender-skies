/**
 * Being caught in a net: the glider is stowed and refused for a spell.
 *
 * Section 4.4 gives the net thrower **flight itself** to pressure, and this is the whole of
 * the effect. Not damage, not a slow, not a stun — a countdown during which the wings will not
 * open, which drops the player into the ground layer that section 2.2 calls his most
 * vulnerable posture. Everything else about the fight carries on: he can walk, dash, dodge,
 * swing the staff and gust, and none of that is touched.
 *
 * The state is one number on `PlayerState`, and the three functions here are all of the
 * arithmetic. Keeping them in a module rather than inline in `controller.ts` and `main.ts` is
 * the usual reason: `main.ts` has no tests, and the merge rule below is not obvious enough to
 * live somewhere untested.
 */

/** Whether the wings are currently refused. */
export function isTangled(state: { tangled: number }): boolean {
  return state.tangled > 0
}

/**
 * The refusal after another net lands, given what is already owed.
 *
 * The larger of the two, never the sum. Two nets arriving a frame apart should cost one
 * refusal, not two: the mechanic is priced in seconds of being unable to fly, and a volley of
 * three netters on one screen would otherwise stack into six seconds on the ground, which is
 * long enough to be a death sentence over open sky and is not what any single one of them
 * threatened. `stepEncounter` already collapses the nets landing on the *same* frame with the
 * same rule; this covers the frames either side of it.
 *
 * The consequence is worth stating plainly, because it is a real design choice and not a
 * rounding decision: a second net landing on an already-grounded player is wasted. That makes
 * the netter's threat non-cumulative, which is what keeps the answer to a group of them
 * "spend two seconds walking" rather than "do not go near them".
 *
 * Non-finite input is discarded rather than propagated. A NaN here would be laundered straight
 * into `PlayerState.tangled`, and while `isFinitePlayer` does now watch that field — so the
 * game would respawn rather than corrupt — respawning because a net landed is a worse outcome
 * than ignoring one impossible net.
 */
export function applyTangle(current: number, seconds: number): number {
  const held = Number.isFinite(current) ? Math.max(0, current) : 0
  if (!Number.isFinite(seconds) || seconds <= 0) return held
  return Math.max(held, seconds)
}

/**
 * One frame off the countdown.
 *
 * Clamped at zero rather than allowed to go negative, because `isTangled` is a `> 0` test and
 * a deeply negative value would be indistinguishable from zero to every reader while quietly
 * being a different number in a save or a log.
 */
export function stepTangle(current: number, dt: number): number {
  if (!Number.isFinite(current)) return 0
  if (!Number.isFinite(dt) || dt <= 0) return Math.max(0, current)
  return Math.max(0, current - dt)
}
