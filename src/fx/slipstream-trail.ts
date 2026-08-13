import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import type { SlipstreamConfig } from '../player/slipstream'
import type { Effect } from './effect'
import { safeScale } from './scale'

/**
 * The streak a Slipstream leaves.
 *
 * A cooler, sharper tint than the dash trail, because the two moves must not be
 * confused: one is traversal, the other is the dodge you bet a hit on.
 */
const LIFETIME = 0.26
const WIDTH = 0.5
const TALL = 1.5
const TINT = 0xc9f2ff
const OPACITY = 0.7

export function createSlipstreamTrail(
  origin: Vector3, heading: Vector3, c: SlipstreamConfig,
): Effect {
  // Length is what the dash actually covers, so the streak cannot claim ground the
  // move does not reach.
  const length = safeScale(c.speed * c.durationSeconds)
  const geometry = new BoxGeometry(WIDTH, TALL, 1)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, depthWrite: false, opacity: OPACITY, depthTest: false,
  })
  const mesh = new Mesh(geometry, material)
  // Copied before the offset, because the caller passes the player's live position.
  mesh.position.copy(origin)
  mesh.position.y += TALL / 2
  mesh.scale.z = length

  const flat = new Vector3(heading.x, 0, heading.z)
  if (flat.lengthSq() > 1e-8) {
    mesh.lookAt(mesh.position.clone().add(flat.normalize()))
  }
  mesh.userData.excludeFromShadows = true

  let age = 0

  return {
    object: mesh,
    advance(dt: number): boolean {
      age += dt
      material.opacity = OPACITY * Math.max(0, 1 - age / LIFETIME)
      return age < LIFETIME
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
