import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createArrowView, SHAFT_MATERIAL_OPTIONS } from './arrow'
import { spawnProjectile } from '../combat/projectile'

const arrow = (position: Vector3, direction: Vector3) =>
  spawnProjectile('a1', position, direction, 1, 34, 0)

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
    // Forward is +Z in this project: Object3D.lookAt aligns local +Z, and only Camera
    // and Light use -Z. lookAt sets `quaternion` directly and synchronously, so no
    // updateMatrixWorld call is needed before reading it here.
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
    //
    // Asserted against the exported options rather than against the built material.
    // `new MeshLambertMaterial({ color })` already yields depthTest === true, because
    // Material's constructor backfills its own defaults, so reading it back off the mesh
    // passes whether or not arrow.ts asks for it -- deleting the option left this test
    // green. On the options object a removed key reads undefined instead.
    expect(SHAFT_MATERIAL_OPTIONS.depthTest).toBe(true)
  })

  it('lays the shaft along its flight axis rather than across it', () => {
    // CylinderGeometry's axis is local Y and the view aims local +Z at the target, so
    // without the quarter turn every arrow in the game flies broadside -- visible in
    // every frame of flight, and nothing else in this file notices it.
    const view = createArrowView()
    const shaft = view.object.getObjectByName('arrow-shaft')
    if (!shaft) throw new Error('expected a child named arrow-shaft')
    expect(shaft.rotation.x).toBeCloseTo(Math.PI / 2, 5)
    // Local Y, the cylinder's own axis, has to end up along the parent's forward.
    const axis = new Vector3(0, 1, 0).applyQuaternion(shaft.quaternion)
    expect(Math.abs(axis.z)).toBeCloseTo(1, 5)
    view.dispose()
  })

  it('keeps its last heading when velocity drops to zero', () => {
    // A zero velocity gives lookAt nothing to aim at. Checking that the resulting
    // quaternion is merely finite proves nothing here: three.js's own Matrix4.lookAt
    // falls back to a default heading when eye and target coincide, rather than to NaN,
    // so a finite-quaternion assertion passes whether or not the arrow view guards
    // against this case. The property actually worth guarding is that the arrow keeps
    // pointing where it was going, instead of snapping to that fallback axis.
    const view = createArrowView()
    view.update(arrow(new Vector3(1, 2, 3), new Vector3(0, 1, -1).normalize()))
    const heading = view.object.quaternion.clone()

    const still = { ...arrow(new Vector3(1, 2, 3), new Vector3(0, 0, -1)), velocity: new Vector3() }
    view.update(still)

    expect(view.object.quaternion.x).toBeCloseTo(heading.x)
    expect(view.object.quaternion.y).toBeCloseTo(heading.y)
    expect(view.object.quaternion.z).toBeCloseTo(heading.z)
    expect(view.object.quaternion.w).toBeCloseTo(heading.w)
    expect(view.object.position.x).toBeCloseTo(1)
    view.dispose()
  })
})
