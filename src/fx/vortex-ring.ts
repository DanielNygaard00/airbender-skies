import { DoubleSide, MathUtils, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three'
import type { Effect } from './effect'
import { safeScale } from './scale'

/**
 * The air a Vortex gathers, drawn at the radius it actually caught.
 *
 * Sweeps inward, which is the visual contrast with the Pressure Wave's ring going out:
 * one gathers a group, the other scatters it. Drawn at the true `vortexRadius` for the
 * same reason the gust cone is drawn at its true hit volume — a pull that reaches
 * outside the visible ring reads as a bug.
 */
const LIFETIME = 0.45
const THICKNESS = 0.3
/** How far in the ring travels: not to nothing, so it stays legible as it closes. */
const END_FRACTION = 0.15
const HEIGHT = 0.6
const TINT = 0x9fd9ff
const OPACITY = 0.75

export function createVortexRing(origin: Vector3, radius: number): Effect {
  const geometry = new RingGeometry(1 - THICKNESS, 1, 48)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: OPACITY,
    // Drawn over the world, matching the other attack effects: a flat ring near the
    // ground is otherwise buried by any slope.
    depthTest: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.copy(origin)
  mesh.position.y += HEIGHT
  mesh.userData.excludeFromShadows = true

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    mesh.scale.setScalar(safeScale(MathUtils.lerp(radius, radius * END_FRACTION, t)))
    material.opacity = OPACITY * (1 - t * t)
  }

  apply()

  return {
    object: mesh,
    advance(dt: number): boolean {
      age += dt
      apply()
      return age < LIFETIME
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
