import { describe, it, expect } from 'vitest'
import { Euler, Group, Object3D, Quaternion, Vector3 } from 'three'
import { createEnemyView } from './enemy-mesh'
import { spawnEnemy, hitEnemy, type Enemy } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

const C = DEFAULT_COMBAT_CONFIG.enemies.spear
const CAMERA = new Quaternion().setFromEuler(new Euler(-0.4, 1.2, 0))
const enemyAt = (x: number, z: number): Enemy => spawnEnemy('a', new Vector3(x, 0, z), 'spear', C)
const damaged = (enemy: Enemy): Enemy => hitEnemy(enemy, C.maxHealth / 2, new Vector3())
const downed = (enemy: Enemy): Enemy => hitEnemy(enemy, C.maxHealth, new Vector3())

function child(view: { object: Object3D }, name: string): Object3D {
  const found = view.object.getObjectByName(name)
  if (!found) throw new Error(`expected a child named ${name}`)
  return found
}

/** The rig carries the rotation; the root carries only position. */
function rig(view: { object: Object3D }): Group {
  const found = child(view, 'rig')
  if (!(found instanceof Group)) throw new Error('expected the rig to be a Group')
  return found
}

describe('createEnemyView', () => {
  it('carries a health bar', () => {
    expect(createEnemyView().object.getObjectByName('health-bar')).toBeDefined()
  })

  it('hides the bar on a downed enemy', () => {
    const view = createEnemyView()
    view.sync(downed(enemyAt(0, 0)), CAMERA)
    expect(child(view, 'health-bar').visible).toBe(false)
  })

  it('shows the bar on a damaged one', () => {
    const view = createEnemyView()
    view.sync(damaged(enemyAt(0, 0)), CAMERA)
    expect(child(view, 'health-bar').visible).toBe(true)
  })

  it('leaves the bar upright while the soldier turns', () => {
    // The whole reason the rig exists. If the bar were parented to the rotating root,
    // its world orientation would be the soldier's heading times the camera's, and it
    // would never actually face the camera.
    const view = createEnemyView()
    const turned = { ...damaged(enemyAt(0, 0)), facing: new Vector3(1, 0, 0) }
    view.sync(turned, CAMERA)
    const world = new Quaternion()
    child(view, 'health-bar').getWorldQuaternion(world)
    expect(world.angleTo(CAMERA)).toBeLessThan(1e-6)
  })

  it('stands the soldier at its own position', () => {
    const view = createEnemyView()
    view.sync(enemyAt(3, -7), CAMERA)
    expect(view.object.position.toArray()).toEqual([3, 0, -7])
  })

  it('turns the soldier to face its heading', () => {
    const view = createEnemyView()
    view.sync({ ...enemyAt(0, 0), facing: new Vector3(1, 0, 0) }, CAMERA)
    expect(rig(view).rotation.y).toBeCloseTo(Math.PI / 2, 5)
  })

  it('lays a downed soldier flat', () => {
    const view = createEnemyView()
    view.sync(downed(enemyAt(0, 0)), CAMERA)
    expect(rig(view).rotation.x).toBeCloseTo(Math.PI / 2, 5)
  })

  it('stands a living soldier upright', () => {
    const view = createEnemyView()
    view.sync(enemyAt(0, 0), CAMERA)
    expect(rig(view).rotation.x).toBeCloseTo(0, 5)
  })

  it('cocks the spear back on a wind-up and not otherwise', () => {
    // The dodge window depends on the player seeing this, so it is worth pinning.
    const view = createEnemyView()
    const spear = child(view, 'spear')
    view.sync({ ...enemyAt(0, 0), stance: 'wind-up' }, CAMERA)
    const winding = spear.rotation.x
    view.sync({ ...enemyAt(0, 0), stance: 'advance' }, CAMERA)
    expect(winding).toBeLessThan(spear.rotation.x)
  })
})
