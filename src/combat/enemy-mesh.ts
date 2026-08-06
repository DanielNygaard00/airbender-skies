import {
  CapsuleGeometry, ConeGeometry, Group, Mesh, MeshLambertMaterial, TorusGeometry,
  type Object3D, type Quaternion,
} from 'three'
import { isDowned } from './health'
import { createHealthBar } from './health-bar'
import type { Enemy, EnemyKind } from './enemy'

/**
 * A spear infantryman, as primitives.
 *
 * Placeholder art on purpose: the point of this slice is that the fight reads, not
 * that the soldier does. What has to be legible is the stance, because the doc's
 * whole dodge window depends on the player seeing a wind-up coming — so the spear
 * lifts on the telegraph and the body falls flat when downed.
 *
 * The object is in two parts. The root carries position only; the `rig` carries the
 * rotation. That split exists so the health bar, which hangs off the root, can face the
 * camera by copying its rotation — parented to the rotating part, its world orientation
 * would be the soldier's heading times the camera's, and it would never face anything.
 */
export interface EnemyView {
  object: Object3D
  sync(enemy: Enemy, cameraQuaternion: Quaternion): void
}

const BODY = 0x8d6b4a
const SPEAR = 0x4a3c2a
const BOW = 0x5a4632
/** Warm and bright, so a telegraph is the most visible thing on screen. */
const WINDUP = 0xe4763c

export function createEnemyView(kind: EnemyKind): EnemyView {
  const object = new Group()

  const rig = new Group()
  rig.name = 'rig'
  object.add(rig)

  const bodyMaterial = new MeshLambertMaterial({ color: BODY })
  const body = new Mesh(new CapsuleGeometry(0.35, 1.0, 4, 8), bodyMaterial)
  body.name = 'body'
  body.position.y = 0.85
  rig.add(body)

  // The held prop is the only visible difference between the kinds. The spear keeps its
  // geometry, position and name unchanged, because other tests in this file find it by
  // name and the silhouette is what tells the player which threat they are looking at.
  const prop = kind === 'spear'
    ? new Mesh(new ConeGeometry(0.09, 1.9, 6), new MeshLambertMaterial({ color: SPEAR }))
    : new Mesh(new TorusGeometry(0.42, 0.05, 6, 12, Math.PI * 1.2), new MeshLambertMaterial({ color: BOW }))
  prop.name = kind === 'spear' ? 'spear' : 'bow'
  prop.position.set(0.32, 1.1, 0)
  rig.add(prop)

  const healthBar = createHealthBar()
  object.add(healthBar.object)

  return {
    object,
    sync(enemy: Enemy, cameraQuaternion: Quaternion): void {
      object.position.copy(enemy.position)
      // Ahead of the downed branch below: the bar's own rule already covers being
      // downed, so there is one place that decides when a bar shows.
      healthBar.update(enemy.health, cameraQuaternion)

      if (isDowned(enemy.health)) {
        // Down, not gone: the body stays in the world, lying where it was put.
        rig.rotation.set(Math.PI / 2, 0, 0)
        bodyMaterial.color.setHex(BODY)
        prop.rotation.set(0, 0, 0)
        return
      }

      // Facing is horizontal, so atan2 of the heading is the whole rotation.
      rig.rotation.set(0, Math.atan2(enemy.facing.x, enemy.facing.z), 0)

      const winding = enemy.stance === 'wind-up'
      bodyMaterial.color.setHex(winding ? WINDUP : BODY)
      // A spear cocks back to thrust; a bow rotates as it is drawn. Different amounts,
      // because the two motions read differently at distance.
      prop.rotation.set(winding ? (kind === 'spear' ? -1.1 : -0.6) : 0, 0, 0)
    },
  }
}
