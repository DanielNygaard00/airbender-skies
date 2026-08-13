/**
 * One definition of "a scale a transform can survive".
 *
 * Every scaled effect in this directory needs the same three things of the number it hands to
 * `scale.setScalar`, and until this module existed each of them wrote its own `Math.max(x, 1e-4)`
 * — eight copies of a clamp, five structurally identical sites with no clamp at all, and no test
 * anywhere reaching any of them. The audit recorded in `HANDOFF.md` under "The scale floors" is
 * what turned that up.
 *
 * A zero scale collapses the object's matrix: it is not invertible, so anything derived from it
 * — normal matrices, bounding volumes, raycasts — is degenerate from that frame on.
 *
 * A non-finite scale is worse, and this is the part `Math.max` could not do. `Math.max(NaN, 1e-4)`
 * is `NaN`, so every one of those hand-written clamps passed a NaN straight through to the
 * transform, which then poisons the object's world matrix and everything three.js computes from
 * it. `Number.isFinite` is the check that catches it, along with `Infinity`, whose product with a
 * finite offset is equally unusable.
 *
 * The floor is the failure mode on purpose. An effect scaled to `MIN_SCALE` is invisible for that
 * frame, which is a far better outcome than a corrupted matrix — and an effect asked to draw at a
 * non-finite size had nothing meaningful to draw anyway.
 *
 * Note what this does *not* do: it does not fix wherever the NaN came from. Nothing in the game
 * currently feeds one — the paths are a NaN `dt` reaching an effect's `advance`, or a NaN in a
 * config value — and both would be defects in their own right. This is the last line before the
 * scene graph, not a substitute for the first.
 */

/** Small enough to be invisible, large enough to keep the matrix invertible. */
export const MIN_SCALE = 1e-4

/**
 * The scale to actually apply: the value itself when it is finite and big enough, and `MIN_SCALE`
 * when it is too small, negative, `NaN`, or infinite.
 */
export function safeScale(value: number): number {
  if (!Number.isFinite(value)) return MIN_SCALE
  return Math.max(value, MIN_SCALE)
}
