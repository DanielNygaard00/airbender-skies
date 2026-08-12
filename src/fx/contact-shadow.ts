import type { Camera, Object3D, Vector3 } from 'three'

/**
 * How far from a surface an occluder still counts, in world units.
 *
 * A *contact* distance rather than an ambient-occlusion radius — about a third of the
 * 1.8-unit character — so this darkens where a body, a trunk or a rock is genuinely
 * touching and does not attempt to be a general occlusion term. An argued guess:
 * nothing in this cycle has been played.
 */
export const CONTACT_RANGE = 0.6

/**
 * Samples along the ray.
 *
 * Injected into the shader as a `#define` and used as a loop bound, which GLSL ES 1.0
 * requires to be constant — so this must stay an integer literal.
 */
export const CONTACT_STEPS = 8

/** How dark a fully occluded pixel goes. 1 would be black. */
export const CONTACT_STRENGTH = 0.55

/**
 * The residual view-space depth difference below which a "hit" is the surface finding
 * itself, on top of a per-step self-occlusion term the shader computes and this
 * constant does not know about.
 *
 * That computed term already cancels the *predictable* part of a flat, camera-facing
 * surface reporting itself as an occluder — the gap the march's own step along the sun
 * direction opens up between where it samples and where the surface it started on
 * still is. This constant used to be the only thing standing between that gap and a
 * false hit, and at 0.02 against a single 0.075-unit step (`CONTACT_RANGE` /
 * `CONTACT_STEPS`) it was too small to do that job except at near-grazing sun angles.
 * With the computed term in place, what is left for this constant to absorb is smaller
 * and more honest: reconstruction noise, and surfaces that are not exactly the flat
 * plane the computed term assumes.
 */
export const CONTACT_BIAS = 0.02

/**
 * The difference above which the hit is something far behind rather than an occluder
 * near the surface.
 *
 * A screen-space march has no way to know whether the depth it sampled belongs to a
 * pebble one centimetre away or a mountain two hundred units back. Without this bound
 * every silhouette edge would trail a dark smear across the distance behind it.
 */
export const CONTACT_THICKNESS = 0.5

/**
 * Camera distances between which the effect fades away entirely.
 *
 * A fixed world-space range subtends fewer pixels the further away it is. Past a
 * certain depth all `CONTACT_STEPS` samples land within a pixel or two, the march stops
 * sampling anything meaningful, and what is left is noise that flickers as the camera
 * moves. Fading to nothing is the honest answer there.
 */
export const CONTACT_FADE_START = 40
export const CONTACT_FADE_END = 70

/**
 * The sun's direction in view space, which is the space the march happens in.
 *
 * `SUN_DIRECTION` is a world-space unit vector and the camera turns constantly, so this
 * is recomputed every frame. `transformDirection` applies the matrix's rotation and
 * renormalises, which is what a direction needs and what a full `applyMatrix4` would
 * get wrong by also applying the translation.
 *
 * The caller is responsible for `camera.matrixWorldInverse` being current. In practice
 * this runs after `renderer.render`, which updates it.
 */
export function sunDirectionInView(
  worldDirection: Vector3, camera: Camera, target: Vector3,
): Vector3 {
  return target.copy(worldDirection).transformDirection(camera.matrixWorldInverse)
}

/**
 * The pixel dimensions the depth target should have for a canvas of this size.
 *
 * Full resolution, deliberately: the fine detail at a contact is the entire point, and
 * a half-resolution pass would blur exactly the signal it exists to produce. It is a
 * named, tested rule rather than an inline expression because the one thing that must
 * not drift is this size against the canvas — a mismatch does not fail, it offsets every
 * sample by a fraction of a pixel and reads as a soft halo along every edge.
 *
 * Floored because a render target cannot have a fractional dimension and a device pixel
 * ratio readily produces one, and floored to at least 1 because `resize` runs before
 * layout in some embeddings and a zero-dimension target throws rather than degrading.
 */
export function depthTargetSize(
  canvasWidth: number, canvasHeight: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(canvasWidth)),
    height: Math.max(1, Math.floor(canvasHeight)),
  }
}

/**
 * The nodes the depth pass must hide while it renders.
 *
 * `scene.overrideMaterial` replaces the material on every mesh it draws — including its
 * `side`, its `depthWrite` and its `depthTest` — so two groups of objects that are
 * carefully arranged never to occlude anything would start writing depth. The sky dome
 * sets `depthWrite: false` and `side: BackSide` for exactly that reason, and every
 * attack effect that draws over the world sets `depthTest: false`; a gust fired toward
 * the camera would otherwise put a wall of near depth across the frame.
 *
 * The rule reuses `userData.excludeFromShadows`, which already exists for this question,
 * so a future effect that opts out of the shadow map opts out of this pass for free.
 *
 * **It did not already mark everything, and that is worth knowing before adding a mesh.**
 * The flag covered the two groups above because both of them are things that must not
 * cast a shadow either. A third class was not covered: a translucent mesh that writes no
 * depth of its own and casts no shadow because it is not solid. `src/world/waterfall.ts`
 * was the one such mesh in the scene when this pass shipped, and it was missed — its
 * curtains are added straight to the scene rather than under `world.group`, so
 * `enableShadows` never traversed them and nobody had cause to check the flag. Any new
 * translucent surface needs it set explicitly.
 *
 * **Deliberately wider than `enableShadows`, which collects meshes only.** A `Points`
 * renders under an override material and writes depth from its sprites, and
 * `src/world/wind-tell.ts` sets the flag on the `Group` above one. Collecting any
 * flagged node and hiding it covers such a child through visibility inheritance.
 *
 * **Writes into a caller-supplied array, which it clears first, and returns that same
 * array.** This runs once per frame for the whole session, and the rest of the
 * presentation layer — `sunDirectionInView` immediately above, which has a test pinning
 * exactly this — holds to the same no-allocation habit. Returning the target as well as
 * filling it keeps the call readable at the one site that uses it.
 *
 * **The traversal itself has to happen every frame, and that is not the part worth
 * optimising away.** Collecting once at startup would be wrong rather than merely stale:
 * arrow views and attack effects are added to and removed from the scene graph while the
 * game runs, so the set of flagged nodes is different from one frame to the next.
 */
export function excludedFromDepth(root: Object3D, target: Object3D[]): Object3D[] {
  target.length = 0
  root.traverse((node) => {
    if (node.userData.excludeFromShadows) target.push(node)
  })
  return target
}
