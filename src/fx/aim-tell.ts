import {
  BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Vector3,
  type Object3D,
} from 'three'
import type { GustConfig } from '../combat/gust'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry } from './sector'
import { DEFAULT_AIM_TELL_CONFIG, type AimTellConfig } from './config'

/**
 * Just above the ground, so a flat shape is not sitting exactly on the terrain it draws over.
 *
 * Kept a hair's width rather than a visible height: both materials below already set
 * `depthTest: false`, which is what actually keeps this drawn over sloping terrain, so this
 * offset only has to break exact coplanarity. A visible offset would leak into the marker's
 * world Y regardless of heading, since the group's `lookAt` never tilts off pure yaw — and
 * that would read as the tell drifting upward with a climbing glider, which is exactly the
 * bug "ignores the vertical part of the heading" exists to catch.
 */
const HEIGHT = 0.002
const TINT = 0x7fe4ff
const MARKER_OPACITY = 0.5

/**
 * Where a gust will go, shown before it is thrown.
 *
 * Persistent rather than an `Effect` because it lives as long as the player does, which is
 * not a one-shot — the same reason `createVortexChargeTell` is shaped this way.
 *
 * Aimed from the simulation's `player.forward`, and parented to the scene rather than to the
 * avatar. Parenting would inherit the facing for free, but the avatar is rotated from the
 * *interpolated* heading, and a tell for a hit volume has to read the value the hit reads.
 */
export interface AimTell {
  object: Object3D
  /**
   * Call every frame. `targeted` is whether a live soldier is inside the cone; `ready` is
   * whether the gust is off cooldown.
   */
  update(
    position: Vector3, forward: Vector3, targeted: boolean, ready: boolean, c: GustConfig,
  ): void
  dispose(): void
}

/**
 * A flat chevron pointing along local +Z.
 *
 * A chevron rather than a bar or a dot because it carries a direction on its own, so it still
 * reads at the shallow camera angle this game mostly plays at, where a bar foreshortens into
 * a line and a dot says nothing.
 */
function createChevronGeometry(size: number): BufferGeometry {
  const geometry = new BufferGeometry()
  const halfWidth = size * 0.6
  const tailZ = -size * 0.4
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, size,
    -halfWidth, 0, tailZ,
    halfWidth, 0, tailZ,
  ]), 3))
  geometry.computeVertexNormals()
  return geometry
}

export function createAimTell(c: AimTellConfig = DEFAULT_AIM_TELL_CONFIG): AimTell {
  const object = new Group()

  const markerGeometry = createChevronGeometry(c.markerSize)
  const markerMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: MARKER_OPACITY,
    // Drawn over the world, like every other attack tell in this directory: a flat shape
    // near the ground is otherwise buried by terrain sloping up away from the player, which
    // is the defect that made the gust cone invisible in play.
    depthTest: false,
  })
  const marker = new Mesh(markerGeometry, markerMaterial)
  marker.name = 'aim-marker'
  marker.position.z = c.markerDistance
  marker.userData.excludeFromShadows = true
  object.add(marker)

  // Built at unit radius and scaled, so a changing gust range costs a scale rather than a
  // geometry rebuild sixty times a second. The Avatar State changes it mid-fight.
  const previewGeometry = sectorGeometry(1, 0, 1)
  const previewMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: c.previewOpacity, depthTest: false,
  })
  const preview = new Mesh(previewGeometry, previewMaterial)
  preview.name = 'aim-preview'
  preview.rotation.x = SECTOR_FLAT_ROTATION_X
  preview.userData.excludeFromShadows = true
  preview.visible = false
  object.add(preview)

  // Reused each frame rather than allocated: this runs every frame for the whole session.
  const flat = new Vector3()
  const target = new Vector3()
  /** The half angle the geometry was last built for, so it is rebuilt only when it changes. */
  let builtHalfAngle = 1

  return {
    object,

    update(
      position: Vector3, forward: Vector3, targeted: boolean, ready: boolean, gust: GustConfig,
    ): void {
      object.position.set(position.x, position.y + HEIGHT, position.z)

      // Flattened, because inGust tests a flattened heading: a tell tilted with a climbing
      // glider would point somewhere the gust does not reach.
      flat.set(forward.x, 0, forward.z)
      if (flat.lengthSq() > 1e-8) {
        flat.normalize()
        target.copy(object.position).add(flat)
        object.lookAt(target)
      }

      marker.position.z = c.markerDistance

      preview.visible = targeted
      if (targeted) {
        // A RingGeometry cannot change its theta after construction, so a changed half angle
        // needs a rebuild. The radius is a scale, which is why only this is conditional.
        if (Math.abs(gust.halfAngle - builtHalfAngle) > 1e-6) {
          preview.geometry.dispose()
          preview.geometry = sectorGeometry(gust.halfAngle, 0, 1)
          builtHalfAngle = gust.halfAngle
        }
        preview.scale.setScalar(Math.max(gust.range, 1e-4))
        previewMaterial.opacity = c.previewOpacity * (ready ? 1 : c.dimmedFactor)
      }
    },

    dispose(): void {
      markerGeometry.dispose()
      markerMaterial.dispose()
      preview.geometry.dispose()
      previewMaterial.dispose()
    },
  }
}
