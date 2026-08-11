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
 * The view-space depth difference below which a "hit" is the surface finding itself.
 *
 * Without it every pixel occludes itself at the first step and the whole screen
 * darkens uniformly, which reads as the exposure being wrong rather than as a bug in
 * this file.
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
 * The rule reuses `userData.excludeFromShadows`, which already exists for this question
 * and already marks both groups, so a future effect that opts out of the shadow map
 * opts out of this pass for free.
 *
 * **Deliberately wider than `enableShadows`, which collects meshes only.** A `Points`
 * renders under an override material and writes depth from its sprites, and
 * `src/world/wind-tell.ts` sets the flag on the `Group` above one. Collecting any
 * flagged node and hiding it covers such a child through visibility inheritance.
 */
export function excludedFromDepth(root: Object3D): Object3D[] {
  const excluded: Object3D[] = []
  root.traverse((node) => {
    if (node.userData.excludeFromShadows) excluded.push(node)
  })
  return excluded
}
