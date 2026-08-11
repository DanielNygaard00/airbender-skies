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

/** Pulls the shadow slightly towards the caster to keep surfaces from self-striping. */
const SHADOW_BIAS = -0.0006

export function createSun(): DirectionalLight {
  const sun = new DirectionalLight(0xfff2d8, 1.8)
  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
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
