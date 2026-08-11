/**
 * How far past the frame edge, in normalised device coordinates, a soldier travels
 * before its chevron reaches full strength. A quarter of the half-width, so an eighth
 * of a screen width.
 *
 * Far enough that the chevron is only fully up once the soldier is definitively gone,
 * close enough that it arrives before the player wonders where they went. An argued
 * guess, not measured: nobody has played this.
 */
export const OFF_SCREEN_RAMP = 0.25

/**
 * How strongly to draw a marker for something at `ndc`: 0 while it is comfortably on
 * screen, ramping to 1 once it is definitively off it.
 *
 * A ramp read straight off the projection rather than a fade timer, and that is the
 * whole reason this function exists instead of a boolean. Soldiers cross the frame edge
 * constantly as the player turns, so a marker that switched on at the boundary would
 * blink through ordinary camera movement. The obvious fix is a per-soldier fade counter
 * stepped every frame; this needs no state at all, cannot drift out of sync with a
 * soldier that was removed from the fight, and is frame-rate independent without anyone
 * having to think about it.
 *
 * Two inputs mean "not on screen" rather than "somewhere off to one side", and both
 * return 1. A point behind the camera comes back from `Vector3.project` with `z` outside
 * [-1, 1] and an x/y mirrored across the screen — a finite number that is not a
 * position — and that is the population this feature mostly serves, since a follow cam's
 * blind spot is directly behind the player. A projection with a non-finite component is
 * the same story for a different reason: a camera whose `aspect` is not finite, which a
 * 0×0 canvas produces, gives a NaN `x` beside a perfectly finite `y` and `z`.
 *
 * `reticleModel` treats both of those as "hide", and this treating them as "show at full
 * strength" is deliberate rather than an inconsistency to tidy up. The reticle needs a
 * screen position and has none; a marker needs only a bearing, which comes from world
 * space and is unaffected by either.
 */
export function offScreenPresence(ndc: { x: number; y: number; z: number }): number {
  const placeable = Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Number.isFinite(ndc.z)
  if (!placeable || ndc.z < -1 || ndc.z > 1) return 1

  // The larger of the two axes' excesses: the further out on either, the more
  // definitely gone. Note for anyone writing tests against this — `Math.max` is
  // commutative, so swapping x and y here is a provable no-op and no test can catch
  // it. What tests can catch is reading only one axis, or dropping the absolute value
  // (which would report a point off the left or the bottom as fully on screen).
  const overshoot = Math.max(Math.abs(ndc.x) - 1, Math.abs(ndc.y) - 1)
  if (overshoot <= 0) return 0
  return Math.min(overshoot / OFF_SCREEN_RAMP, 1)
}
