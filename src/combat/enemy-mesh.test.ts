import { describe, it, expect } from 'vitest'
import { Euler, Group, Mesh, MeshLambertMaterial, Object3D, Quaternion, Vector3 } from 'three'
import { createEnemyView } from './enemy-mesh'
import { spawnEnemy, hitEnemy, type Enemy, type Stance } from './enemy'
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
    expect(createEnemyView('spear').object.getObjectByName('health-bar')).toBeDefined()
  })

  it('hides the bar on a downed enemy', () => {
    const view = createEnemyView('spear')
    view.sync(downed(enemyAt(0, 0)), CAMERA)
    expect(child(view, 'health-bar').visible).toBe(false)
  })

  it('shows the bar on a damaged one', () => {
    const view = createEnemyView('spear')
    view.sync(damaged(enemyAt(0, 0)), CAMERA)
    expect(child(view, 'health-bar').visible).toBe(true)
  })

  it('leaves the bar upright while the soldier turns', () => {
    // The whole reason the rig exists. If the bar were parented to the rotating root,
    // its world orientation would be the soldier's heading times the camera's, and it
    // would never actually face the camera.
    const view = createEnemyView('spear')
    const turned = { ...damaged(enemyAt(0, 0)), facing: new Vector3(1, 0, 0) }
    view.sync(turned, CAMERA)
    const world = new Quaternion()
    child(view, 'health-bar').getWorldQuaternion(world)
    expect(world.angleTo(CAMERA)).toBeLessThan(1e-6)
  })

  it('stands the soldier at its own position', () => {
    const view = createEnemyView('spear')
    view.sync(enemyAt(3, -7), CAMERA)
    expect(view.object.position.toArray()).toEqual([3, 0, -7])
  })

  it('turns the soldier to face its heading', () => {
    const view = createEnemyView('spear')
    view.sync({ ...enemyAt(0, 0), facing: new Vector3(1, 0, 0) }, CAMERA)
    expect(rig(view).rotation.y).toBeCloseTo(Math.PI / 2, 5)
  })

  it('lays a downed soldier flat', () => {
    const view = createEnemyView('spear')
    view.sync(downed(enemyAt(0, 0)), CAMERA)
    expect(rig(view).rotation.x).toBeCloseTo(Math.PI / 2, 5)
  })

  it('stands a living soldier upright', () => {
    const view = createEnemyView('spear')
    view.sync(enemyAt(0, 0), CAMERA)
    expect(rig(view).rotation.x).toBeCloseTo(0, 5)
  })

  it('cocks the spear back on a wind-up and not otherwise', () => {
    // The dodge window depends on the player seeing this, so it is worth pinning.
    const view = createEnemyView('spear')
    const spear = child(view, 'spear')
    view.sync({ ...enemyAt(0, 0), stance: 'wind-up' }, CAMERA)
    const winding = spear.rotation.x
    view.sync({ ...enemyAt(0, 0), stance: 'advance' }, CAMERA)
    expect(winding).toBeLessThan(spear.rotation.x)
  })
})

describe('the two kinds look different', () => {
  const ARCHER_CONFIG = DEFAULT_COMBAT_CONFIG.enemies.archer
  /** A bare archer in a given stance; position and facing don't matter to these tests. */
  const archerAt = (stance: Stance): Enemy => ({
    ...spawnEnemy('a', new Vector3(), 'archer', ARCHER_CONFIG),
    stance,
  })

  it('gives a spear soldier a spear and no bow', () => {
    // The pre-existing node name, which other tests in this file already find. It must
    // survive unchanged.
    const view = createEnemyView('spear')
    expect(view.object.getObjectByName('spear')).toBeTruthy()
    expect(view.object.getObjectByName('bow')).toBeFalsy()
  })

  it('gives an archer a bow and no spear', () => {
    const view = createEnemyView('archer')
    expect(view.object.getObjectByName('bow')).toBeTruthy()
    expect(view.object.getObjectByName('spear')).toBeFalsy()
  })

  it("telegraphs an archer's draw the same way a spear's thrust is telegraphed", () => {
    // The wind-up recolour is the existing tell and it must work for both, since it is
    // what the player's whole dodge window depends on seeing.
    const view = createEnemyView('archer')
    const body = view.object.getObjectByName('body') as Mesh
    const material = body.material as MeshLambertMaterial
    view.sync(archerAt('advance'), new Quaternion())
    const calm = material.color.getHex()
    view.sync(archerAt('wind-up'), new Quaternion())
    const drawing = material.color.getHex()
    expect(drawing).not.toBe(calm)
  })

  it('moves the bow on a draw', () => {
    const view = createEnemyView('archer')
    const bow = view.object.getObjectByName('bow') as Object3D
    view.sync(archerAt('advance'), new Quaternion())
    const calm = bow.rotation.x
    view.sync(archerAt('wind-up'), new Quaternion())
    // A real margin, not merely different: the draw has to be visible.
    expect(Math.abs(bow.rotation.x - calm)).toBeGreaterThan(0.3)
  })
})

describe('a downed soldier drops whatever it was holding', () => {
  // The downed branch resets prop.rotation, and nothing covered it for either kind:
  // "lays a downed soldier flat" reads only rig.rotation.x, and the wind-up tests all
  // exercise the living branch. prop.rotation is persistent mesh state, so without that
  // line a body lies flat on the ground with its weapon still drawn, held at the angle
  // the interrupted telegraph left it at -- and it stays there for the rest of the level.
  //
  // Each test winds up first and asserts the prop actually moved, so a view that never
  // rotated the prop at all cannot pass this vacuously.
  const ARCHER_CONFIG = DEFAULT_COMBAT_CONFIG.enemies.archer

  it('lowers a downed spear', () => {
    const view = createEnemyView('spear')
    const spear = child(view, 'spear')
    view.sync({ ...enemyAt(0, 0), stance: 'wind-up' }, CAMERA)
    expect(Math.abs(spear.rotation.x)).toBeGreaterThan(0.3)
    view.sync(downed(enemyAt(0, 0)), CAMERA)
    expect(spear.rotation.x).toBeCloseTo(0, 5)
  })

  it('lowers a downed bow', () => {
    const view = createEnemyView('archer')
    const bow = child(view, 'bow')
    const archer = spawnEnemy('a', new Vector3(), 'archer', ARCHER_CONFIG)
    view.sync({ ...archer, stance: 'wind-up' }, CAMERA)
    expect(Math.abs(bow.rotation.x)).toBeGreaterThan(0.3)
    view.sync(hitEnemy(archer, ARCHER_CONFIG.maxHealth, new Vector3()), CAMERA)
    expect(bow.rotation.x).toBeCloseTo(0, 5)
  })
})
