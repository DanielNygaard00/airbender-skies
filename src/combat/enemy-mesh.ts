import {
  CapsuleGeometry, ConeGeometry, Group, Mesh, MeshLambertMaterial, type Object3D,
} from 'three'
import { isDowned } from './health'
import type { Enemy } from './enemy'

/**
 * A spear infantryman, as primitives.
 *
 * Placeholder art on purpose: the point of this slice is that the fight reads, not
 * that the soldier does. What has to be legible is the stance, because the doc's
 * whole dodge window depends on the player seeing a wind-up coming — so the spear
 * lifts on the telegraph and the body falls flat when downed.
 */
export interface EnemyView {
  object: Object3D
  sync(enemy: Enemy): void
}

const BODY = 0x8d6b4a
const SPEAR = 0x4a3c2a
/** Warm and bright, so a telegraph is the most visible thing on screen. */
const WINDUP = 0xe4763c

export function createEnemyView(): EnemyView {
  const object = new Group()

  const bodyMaterial = new MeshLambertMaterial({ color: BODY })
  const body = new Mesh(new CapsuleGeometry(0.35, 1.0, 4, 8), bodyMaterial)
  body.position.y = 0.85
  object.add(body)

  const spear = new Mesh(new ConeGeometry(0.09, 1.9, 6), new MeshLambertMaterial({ color: SPEAR }))
  spear.position.set(0.32, 1.1, 0)
  object.add(spear)

  return {
    object,
    sync(enemy: Enemy): void {
      object.position.copy(enemy.position)

      if (isDowned(enemy.health)) {
        // Down, not gone: the body stays in the world, lying where it was put.
        object.rotation.set(Math.PI / 2, 0, 0)
        bodyMaterial.color.setHex(BODY)
        spear.rotation.set(0, 0, 0)
        return
      }

      // Facing is horizontal, so atan2 of the heading is the whole rotation.
      object.rotation.set(0, Math.atan2(enemy.facing.x, enemy.facing.z), 0)

      const winding = enemy.stance === 'wind-up'
      bodyMaterial.color.setHex(winding ? WINDUP : BODY)
      // Spear cocked back on the telegraph, level otherwise.
      spear.rotation.set(winding ? -1.1 : 0, 0, 0)
    },
  }
}
