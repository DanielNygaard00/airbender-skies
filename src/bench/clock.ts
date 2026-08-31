/**
 * Runs the bench's fixed-step clock to completion, synchronously, in one call.
 *
 * Pulled out of `main.ts`'s old per-`requestAnimationFrame` `frame()` so the loop is a plain
 * function of numbers and callbacks — no `document`, no WebGL, no `three.js` — and node can
 * call it directly in a test. See `main.ts`'s doc comment for why the simulation now runs to
 * completion up front instead of one step per rAF callback.
 *
 * The loop body is copied from the old `frame()` unchanged in shape: increment `elapsed` by
 * `step`, fire once when it first reaches `fireAt`, then advance. Keeping that shape (rather
 * than, say, computing the fire tick up front) is what keeps every scene's frame count
 * identical to what the old rAF loop produced for it.
 */

/**
 * `fireAt: null` stands in for a scene whose `effect` is `null` — nothing should ever fire,
 * regardless of `duration`. A plain number here would hand a scene with no effect a fire time
 * it does not have, and force every caller to invent one.
 *
 * Returns the number of times `advance` was called, which is what a caller needs to check the
 * loop ran exactly as many times as the old one did for the same scene.
 */
export function runFixedClock(
  fireAt: number | null,
  duration: number,
  step: number,
  fire: () => void,
  advance: (dt: number) => void,
): number {
  // The old loop could never spin faster than the display's refresh rate, even for a scene
  // with a broken `duration`, because `requestAnimationFrame` throttled it to one tick per
  // real animation frame. A synchronous loop has no such governor, so a `duration` that is
  // ever `Infinity` or otherwise nonsense would hang the tab with nothing on screen to say
  // why. `Math.ceil(duration / step)` is the number of increments a well-formed scene needs —
  // the same arithmetic `elapsed < duration` converges on — padded by a handful of steps to
  // absorb the float drift repeated addition accumulates (this codebase's own scene data
  // needs one increment more than the exact division implies: see the `gust` and
  // `dash-trail` cases in `clock.test.ts`). `Math.min` against `MAX_SANE_STEPS` then turns a
  // duration that is `Infinity`, absurdly large, or (via `elapsed < duration` short-circuiting
  // on the comparison itself) `NaN` or negative into a bounded number of iterations. Same
  // spirit as `effect-pool.ts`'s `add` bounding its eviction count rather than trusting its
  // `cap` argument, but a different technique, not the same shape: `add`'s bound is derived
  // purely from real state (`live.length`), with no ceiling of its own, while this one combines
  // a duration-derived estimate with `MAX_SANE_STEPS`, a hardcoded ceiling `add` never needed.
  // No real scene comes close to it: the longest today, `vortex-charge`, needs 48 steps.
  const MAX_SANE_STEPS = 10_000
  const maxSteps = Math.min(Math.ceil(duration / step) + 8, MAX_SANE_STEPS)

  let elapsed = 0
  let fired = false
  let advances = 0
  let i = 0
  for (; i < maxSteps && elapsed < duration; i++) {
    elapsed += step
    if (!fired && fireAt !== null && elapsed >= fireAt) {
      fired = true
      fire()
    }
    advance(step)
    advances++
  }
  // Hitting the cap before `elapsed` ever reaches `duration` means the loop stopped for a
  // reason unrelated to the scene finishing. Returning `advances` here anyway would hand back a
  // plausible-looking short frame with nothing to say it was cut off — the exact
  // invisible-failure-reads-as-success trap this bench exists to catch, relocated into its own
  // clock. A bench that refuses to lie is worth more than one that always returns something.
  if (i === maxSteps && elapsed < duration) {
    throw new Error(
      `runFixedClock hit its ${MAX_SANE_STEPS}-step bound (${maxSteps} for this call) with `
      + `elapsed only ${elapsed} of duration ${duration} at step ${step}. The scene's duration `
      + 'is likely Infinity, NaN, or otherwise absurd rather than a real scene length.',
    )
  }
  return advances
}
