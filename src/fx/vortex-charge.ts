import {
  DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, RingGeometry, type Object3D,
} from 'three'
import { vortexRadius, vortexCharge, type VortexConfig } from '../combat/vortex'

/**
 * The ring that shows what a held Vortex will catch.
 *
 * A charged move whose reach is invisible until it fires cannot be aimed, and this repo
 * treats a mechanic the player cannot see as a bug. Persistent rather than an `Effect`
 * because it lives as long as the button is held, which is not a one-shot.
 */
export interface VortexChargeTell {
  object: Object3D
  /** Call every frame with how long the charge has been held. */
  update(dt: number, heldSeconds: number, c: VortexConfig): void
  dispose(): void
}

const THICKNESS = 0.06
const HEIGHT = 0.5
const TINT = 0x9fd9ff
const PEAK_OPACITY = 0.55

export function createVortexChargeTell(): VortexChargeTell {
  const object = new Group()
  const geometry = new RingGeometry(1 - THICKNESS, 1, 64)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: PEAK_OPACITY, depthTest: false,
  })
  const ring = new Mesh(geometry, material)
  ring.rotation.x = -Math.PI / 2
  ring.userData.excludeFromShadows = true
  object.add(ring)
  object.position.y = HEIGHT
  object.visible = false

  return {
    object,
    update(_dt: number, heldSeconds: number, c: VortexConfig): void {
      object.visible = heldSeconds > 0
      if (!object.visible) return
      const charge = vortexCharge(heldSeconds, c)
      ring.scale.setScalar(Math.max(vortexRadius(charge, c), 1e-4))
      // Brightens as it fills, so the moment it is worth releasing is visible.
      material.opacity = PEAK_OPACITY * MathUtils.lerp(0.45, 1, charge)
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
