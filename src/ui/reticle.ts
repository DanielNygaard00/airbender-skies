/** Where to draw the aim reticle, and whether to draw it at all. */
export interface ReticleModel {
  visible: boolean
  /** Fractions of the viewport, 0 to 1 from the top-left. */
  x: number
  y: number
  /** A live target is inside the gust cone. */
  hot: boolean
}

/**
 * Converts a point already projected to normalised device coordinates into a
 * viewport-fraction reticle position.
 *
 * The y axis is flipped: NDC +1 is the top of the screen, but the CSS fraction for
 * the top is 0. Getting this backwards does not crash anything, it just makes the
 * reticle track the opposite of where the player is looking.
 *
 * `z` outside [-1, 1] means the point is not in the visible depth range — beyond the
 * far plane above 1, in front of the near plane below -1, or (the case that matters
 * here) behind the camera entirely, which `Vector3.project` also reports with `z`
 * outside that range. A point behind the camera still has finite `x`/`y` after the
 * perspective divide — mirrored across the screen from where it would be if it were
 * in front — so skipping this check would draw a reticle that is confidently wrong
 * rather than absent.
 *
 * A non-finite component makes it invisible for the same reason, and that case was
 * watched happening rather than imagined. A camera whose `aspect` is not finite — a
 * 0×0 canvas divides zero by zero — projects to an `ndc.x` of NaN while `y` and `z`
 * stay perfectly finite. Deciding from `z` alone therefore answered "is the aim point
 * in front of the camera" correctly and still handed back a model with only half a
 * position, which no view can place: an invalid CSS `left` is dropped rather than
 * clamped, so the reticle would slide up and down at whatever horizontal position it
 * last had. That is the same confidently-wrong failure the depth check exists to
 * prevent, so it belongs in the same decision, here, where it can be tested — and not
 * in the DOM view that first noticed it, which the node test environment cannot build.
 *
 * All three components are checked rather than only the one that was seen going NaN.
 * `z` would in fact be caught by the range comparison below, since every comparison
 * against NaN is false, but a guard that leans on that reads as covering three
 * components while covering two, and the next edit to the range test decides how many
 * without knowing it.
 */
export function reticleModel(
  ndc: { x: number; y: number; z: number }, hot: boolean,
): ReticleModel {
  const placeable = Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Number.isFinite(ndc.z)
  return {
    visible: placeable && ndc.z >= -1 && ndc.z <= 1,
    x: (ndc.x + 1) / 2,
    y: (1 - ndc.y) / 2,
    hot,
  }
}
