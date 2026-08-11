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
 */
export const SHADOW_EXTENT = 90

const SHADOW_MAP_SIZE = 2048

/**
 * How wide the penumbra is, in shadow-map texels.
 *
 * Only variance shadow mapping reads this — `renderer.shadowMap.type` is
 * `VSMShadowMap`, and `src/core/renderer.ts` explains why it is not PCF. Under PCF
 * this field does nothing at all, which is worth knowing before anyone switches the
 * type back and wonders where the softness went.
 *
 * A texel is `2 * SHADOW_EXTENT / SHADOW_MAP_SIZE` world units across — with an
 * extent of 90 and a 2048 map, 0.088 units — so 4 texels is a penumbra about 0.35
 * units wide, against a character 1.8 units tall.
 *
 * The width is in *texels* and therefore moves with both numbers above it: raising
 * `SHADOW_EXTENT` to cover a larger island would widen every penumbra in the game as
 * a side effect, and raising `SHADOW_MAP_SIZE` would narrow them.
 *
 * It came down from 8 to 4 while chasing the bleeding described under
 * `SHADOW_NORMAL_BIAS`, and the reduction did not fix it. Read that comment before
 * spending time on this number.
 */
const SHADOW_BLUR_TEXELS = 4

/**
 * Blur taps per axis.
 *
 * Three.js defaults this to 8, and 16 was chosen on the general expectation that a
 * blur this wide bands at 8 taps. **That was not verified** — the shadows here are too
 * washed out for banding to be the visible problem, so the two values could not be
 * told apart. Each tap is a texture read, in two separable passes over a 2048-square
 * map every frame, so if this configuration survives, 8 is worth retrying purely as a
 * saving.
 */
const SHADOW_BLUR_SAMPLES = 16

/**
 * How far along a surface's own normal its shadow lookup is nudged, in world units.
 *
 * This is the number that stops the terrain shadowing itself, and it was measured
 * rather than reasoned about — the first VSM attempt shipped no bias at all on the
 * argument that variance shadow mapping does not do PCF's depth comparison and so
 * cannot produce PCF's acne. That argument is wrong, and one look at the running game
 * settled it: every slope on the island was banded with its own shadow in wide
 * concentric stripes, far worse than the artefact the old `-0.0006` depth bias had
 * been holding off.
 *
 * `normalBias` rather than `bias` because the offset that fixes this scales with how
 * obliquely a surface faces the light, which is where the terrain's shallow slopes
 * fail.
 *
 * **0.6 is not a good value, it is the only value that works, and the gap between
 * those two things is the finding.** Everything below was measured on the home island
 * at the spawn view:
 *
 * | normalBias | result |
 * | --- | --- |
 * | 0 | every slope banded with its own shadow, in wide concentric stripes |
 * | 0.05 | the same, undiminished |
 * | 0.1 | still striped across the whole island |
 * | 0.2 | acne gone; shadows visibly washed out |
 * | 0.6 | acne gone; the character's shadow is a faint featureless smudge |
 *
 * There is no window between the two failures. Below roughly 0.2 the terrain shadows
 * itself; at and above it, VSM's variance test bleeds enough light that the character's
 * own shadow stops reading as a body with a staff and becomes a grey blur, which is the
 * one shadow in this game a player actually looks at. Tightening the shadow camera from
 * 1..640 to 100..510 to buy depth precision was tried in the same pass and changed
 * nothing measurable, so it was reverted rather than left in as a risk to high casters.
 *
 * For what the alternative looks like, and why this file still ends up here, see
 * `src/core/renderer.ts` above `shadowMap.type`.
 */
const SHADOW_NORMAL_BIAS = 0.6

export function createSun(): DirectionalLight {
  const sun = new DirectionalLight(0xfff2d8, 1.8)
  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  sun.shadow.normalBias = SHADOW_NORMAL_BIAS
  sun.shadow.radius = SHADOW_BLUR_TEXELS
  sun.shadow.blurSamples = SHADOW_BLUR_SAMPLES

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
