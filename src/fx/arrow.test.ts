import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createArrowView } from './arrow'
import { spawnProjectile } from '../combat/projectile'

const arrow = (position: Vector3, direction: Vector3) =>
  spawnProjectile('a1', position, direction, 1, 34)

describe('the arrow view', () => {
  it('sits where the arrow is', () => {
    const view = createArrowView()
    view.update(arrow(new Vector3(3, 7, -11), new Vector3(0, 0, -1)))
    expect(view.object.position.toArray()).toEqual([3, 7, -11])
    view.dispose()
  })

  it('points along the flight', () => {
    const view = createArrowView()
    view.update(arrow(new Vector3(), new Vector3(1, 0, 0)))
    view.object.updateMatrixWorld(true)
    // Forward is +Z in this project: Object3D.lookAt aligns local +Z, and only Camera
    // and Light use -Z.
    const forward = new Vector3(0, 0, 1).applyQuaternion(view.object.quaternion)
    expect(forward.x).toBeCloseTo(1, 3)
    expect(forward.y).toBeCloseTo(0, 3)
    view.dispose()
  })

  it('points upward for a shot at a hovering player', () => {
    const view = createArrowView()
    view.update(arrow(new Vector3(), new Vector3(0, 1, -1).normalize()))
    const forward = new Vector3(0, 0, 1).applyQuaternion(view.object.quaternion)
    // The climb is the whole point of an archer, so the drawn arrow has to show it.
    expect(forward.y).toBeGreaterThan(0.5)
    view.dispose()
  })

  it('is depth-tested, so an arrow behind a hill stays hidden', () => {
    // A deliberate difference from the attack tells in this directory, which draw over
    // the world. An arrow the player cannot see is a threat; an arrow visible through
    // terrain is information they should not have. Same reasoning as the health bars.
    const view = createArrowView()
    const mesh = view.object.getObjectByName('arrow-shaft') as unknown as { material: { depthTest: boolean } }
    expect(mesh.material.depthTest).toBe(true)
    view.dispose()
  })

  it('survives a zero velocity without producing NaN', () => {
    const view = createArrowView()
    const still = { ...arrow(new Vector3(1, 2, 3), new Vector3(0, 0, -1)), velocity: new Vector3() }
    view.update(still)
    expect(Number.isFinite(view.object.quaternion.w)).toBe(true)
    expect(view.object.position.x).toBeCloseTo(1)
    view.dispose()
  })
})
