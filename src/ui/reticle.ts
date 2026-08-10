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
 */
export function reticleModel(
  ndc: { x: number; y: number; z: number }, hot: boolean,
): ReticleModel {
  return {
    visible: ndc.z >= -1 && ndc.z <= 1,
    x: (ndc.x + 1) / 2,
    y: (1 - ndc.y) / 2,
    hot,
  }
}
