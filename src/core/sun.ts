import { DirectionalLight, Mesh, Vector3, type Object3D } from 'three'

/**
 * Direction the sunlight travels from, as a unit vector. Kept separate from the
 * light's position because the light moves with the player while the direction —
 * and so the angle of every shadow in the world — must not.
 */
export const SUN_DIRECTION = new Vector3(200, 400, 150).normalize()

/** How far back along that direction the light sits from whatever it is lighting. */
export const SUN_DISTANCE = 320

/**
 * Half-width of the shadow camera, in world units.
 *
 * The archipelago spans roughly 800 units, and one shadow map stretched over all
 * of it would give the 1.8-unit character a shadow a few texels wide. So the map
 * covers only the neighbourhood of the player and travels with them. 90 clears the
 * largest island, whose radius is 70, so the island the player is standing on is
 * always fully shadowed.
 *
 * **Shrinking this was tried as a way to sharpen shadows and found to be exhausted.**
 * The island-coverage test below pins the floor at just above 70, so the whole usable
 * range is 71 to 90 and the most texel density it can buy is 1.27 times. At the largest
 * safe step — 90 down to 75, a 1.2 times gain — the result was indistinguishable from
 * what ships in a side-by-side at the spawn view, while the clearance over that
 * 70-unit island fell from 20 units to 5. A lever whose entire range is below the
 * threshold of visibility is not worth spending the margin on.
 */
export const SHADOW_EXTENT = 90

/**
 * Shadow map resolution, per side.
 *
 * With `SHADOW_EXTENT` 90 the map covers 180 world units, so a texel is 0.044 units
 * across — about a fortieth of the 1.8-unit character.
 *
 * **Raised from 2048 after comparing the two at 1:1**, which is the only way the
 * difference shows: at 2048 the character's shadow renders the staff as a vague smear,
 * and at 4096 it resolves into a clean thin line. The effect is modest in a small window
 * and grows with the player's display, because more screen pixels per shadow texel is
 * exactly what makes a coarse map read as blocky — and `createRenderer` sets
 * `setPixelRatio(min(devicePixelRatio, 2))`, so on any retina screen the canvas is
 * already twice the size this was compared at. The comparison is a lower bound on what a
 * real player sees, not an upper one.
 *
 * **The cost is real, and one number here is not measured.** Memory is deterministic: a
 * 4096-square depth texture is roughly 67 MB against 2048's 17 MB, a 50 MB increase for
 * the game's one shadow-casting light, and the shadow pass rasterises four times the
 * fragments. Frame cost was *not* measured — the browser harness only runs its render
 * loop while its pane is frontmost, so no frame-timing probe could be taken, and both
 * configurations would have been vsync-capped on the development machine regardless.
 *
 * **This comment used to say that shrinking `SHADOW_EXTENT` was the way to recover the
 * memory while keeping the texel density. That is false, and the test above
 * `SHADOW_EXTENT` is why.** Matching this density at a 2048 map needs an extent of 45,
 * and `sun.test.ts`'s "covers the island the player stands on" requires the extent to
 * exceed the largest island's radius of 70 — it fails immediately at 45, with "expected
 * 45 to be greater than 70". At the smallest permitted extent a 2048 map gives 0.069
 * units per texel, which is 1.6 times coarser than what ships. So the memory and the
 * density cannot both be had: there is no cheap way back, only a choice.
 */
export const SHADOW_MAP_SIZE = 4096

/** Pulls the shadow slightly towards the caster to keep surfaces from self-striping. */
const SHADOW_BIAS = -0.0006

/**
 * The sunlight the game ships, exported for the reason `SKY_ZENITH` and `SKY_HORIZON` already
 * are: `daylight.ts`'s `SHIPPED` stop has to reproduce this light exactly, and it held its own
 * copies of both numbers. Two literals that must agree, in two files, is the arrangement that
 * makes "the derivation returns today's palette" quietly stop being true.
 */
export const SUN_COLOUR = 0xfff2d8
export const SUN_INTENSITY = 1.8

/**
 * The map size is a parameter with the measured default, not a constant read from module
 * scope, because the quality tier now chooses it. Defaulted rather than required so every
 * existing caller and test keeps the size the measurement in `renderer.ts` settled on.
 */
export function createSun(shadowMapSize: number = SHADOW_MAP_SIZE): DirectionalLight {
  const sun = new DirectionalLight(SUN_COLOUR, SUN_INTENSITY)
  sun.castShadow = true
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
  sun.shadow.bias = SHADOW_BIAS

  const shadowCamera = sun.shadow.camera
  shadowCamera.left = -SHADOW_EXTENT
  shadowCamera.right = SHADOW_EXTENT
  shadowCamera.top = SHADOW_EXTENT
  shadowCamera.bottom = -SHADOW_EXTENT
  shadowCamera.near = 1
  // Far enough to reach past the light's own standoff, or casters nearest the sun
  // fall outside the frustum and stop casting.
  shadowCamera.far = SUN_DISTANCE * 2
  shadowCamera.updateProjectionMatrix()

  return sun
}

/**
 * Move the light so its shadow frustum is centred on `target`, keeping the light
 * direction — and therefore the direction of every shadow — unchanged.
 */
export function aimSun(sun: DirectionalLight, target: Vector3): void {
  sun.position.copy(target).addScaledVector(SUN_DIRECTION, SUN_DISTANCE)
  sun.target.position.copy(target)
  // The target is not necessarily in the scene graph, so its matrix will not be
  // refreshed by the renderer's traversal.
  sun.target.updateMatrixWorld()
}

/**
 * Let every mesh under `root` cast and receive shadows.
 *
 * Opt out by setting `userData.excludeFromShadows`, which the sky dome does: it
 * encloses the whole scene, so casting from it would shadow everything. The flag
 * covers the node it is set on, not its descendants — enough for the dome, which
 * is a single mesh.
 */
export function enableShadows(root: Object3D): void {
  root.traverse((node) => {
    if (node.userData.excludeFromShadows) return
    if (!(node as Mesh).isMesh) return
    node.castShadow = true
    node.receiveShadow = true
  })
}
