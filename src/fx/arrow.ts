import {
  CylinderGeometry, Group, Mesh, MeshLambertMaterial, Vector3, type Object3D,
} from 'three'
import type { Projectile } from '../combat/projectile'

const LENGTH = 0.9
const RADIUS = 0.035
const TINT = 0x4a3c2a

/**
 * One arrow, drawn.
 *
 * Persistent rather than a one-shot `Effect` because it lives as long as its flight,
 * which is the same reason `createVortexChargeTell` is shaped this way.
 *
 * An unseen thing that damages the player is the specific defect this project has fixed
 * twice — a gust cone buried by terrain, and a staff connect with no spark. An arrow is
 * the most dangerous invisible object the game could have.
 */
export interface ArrowView {
  object: Object3D
  update(projectile: Projectile): void
  dispose(): void
}

export function createArrowView(): ArrowView {
  const object = new Group()

  // The cylinder's axis is local Y, so lay it along local Z to point along the flight.
  const geometry = new CylinderGeometry(RADIUS, RADIUS, LENGTH, 5)
  const material = new MeshLambertMaterial({
    color: TINT,
    // Depth-tested, unlike the attack tells in this directory. An arrow visible through
    // a hill is information the player should not have — the same reasoning already
    // recorded for the enemy health bars.
    depthTest: true,
  })
  const shaft = new Mesh(geometry, material)
  shaft.name = 'arrow-shaft'
  shaft.rotation.x = Math.PI / 2
  object.add(shaft)

  // Reused rather than allocated: one of these exists per arrow in flight.
  const target = new Vector3()

  return {
    object,

    update(projectile: Projectile): void {
      object.position.copy(projectile.position)
      // A zero velocity has no direction to face, so the last orientation is kept rather
      // than a degenerate lookAt being attempted.
      if (projectile.velocity.lengthSq() > 1e-8) {
        target.copy(projectile.position).add(projectile.velocity)
        object.lookAt(target)
      }
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
