import { describe, it, expect } from 'vitest'
import { Group, Mesh, BoxGeometry, Vector3 } from 'three'
import {
  aimSun, createSun, enableShadows, SHADOW_EXTENT, SHADOW_MAP_SIZE, SUN_DIRECTION, SUN_DISTANCE,
} from './sun'
import { createSkyDome } from './sky'
import { ARCHIPELAGO } from '../world/levels/archipelago'

describe('createSun', () => {
  it('casts shadows', () => {
    expect(createSun().castShadow).toBe(true)
  })

  it('frames the shadow camera symmetrically about the light', () => {
    const { camera } = createSun().shadow
    expect(camera.right - camera.left).toBeCloseTo(SHADOW_EXTENT * 2, 6)
    expect(camera.top - camera.bottom).toBeCloseTo(SHADOW_EXTENT * 2, 6)
  })

  it('reaches past its own standoff from the target', () => {
    // A far plane shorter than the standoff clips the casters nearest the sun, so
    // they silently stop casting.
    expect(createSun().shadow.camera.far).toBeGreaterThan(SUN_DISTANCE)
  })

  it('covers the island the player stands on', () => {
    // One map cannot span the whole archipelago at a useful resolution, so it
    // follows the player — but it must at least cover the biggest island whole.
    const widest = Math.max(...ARCHIPELAGO.islands.map((island) => island.radius))
    expect(SHADOW_EXTENT).toBeGreaterThan(widest)
  })

  it('takes the shadow map size from its caller, and keeps the measured default', () => {
    // The tier switches this. The default stays 4096 because renderer.ts records the
    // measurement that chose it: at 2048 the character's shadow renders the staff as a smear.
    expect(createSun().shadow.mapSize.x).toBe(SHADOW_MAP_SIZE)
    expect(createSun(1024).shadow.mapSize.x).toBe(1024)
    expect(createSun(1024).shadow.mapSize.y).toBe(1024)
  })
})

describe('aimSun', () => {
  it('stands the light off along the sun direction', () => {
    const sun = createSun()
    const target = new Vector3(120, -30, 45)

    aimSun(sun, target)

    const offset = sun.position.clone().sub(target)
    expect(offset.length()).toBeCloseTo(SUN_DISTANCE, 4)
    expect(offset.normalize().dot(SUN_DIRECTION)).toBeCloseTo(1, 6)
  })

  it('points the light at the target', () => {
    const sun = createSun()
    aimSun(sun, new Vector3(10, 20, 30))
    expect(sun.target.position.toArray()).toEqual([10, 20, 30])
  })

  it('keeps the light direction fixed as the target moves', () => {
    // Shadows must not swing around as the player flies: only the frustum travels.
    const sun = createSun()

    aimSun(sun, new Vector3())
    const first = sun.position.clone().sub(sun.target.position).normalize()
    aimSun(sun, new Vector3(-300, 400, 250))
    const second = sun.position.clone().sub(sun.target.position).normalize()

    expect(second.dot(first)).toBeCloseTo(1, 6)
  })
})

describe('enableShadows', () => {
  it('makes meshes cast and receive', () => {
    const root = new Group()
    const mesh = new Mesh(new BoxGeometry(1, 1, 1))
    root.add(mesh)

    enableShadows(root)

    expect(mesh.castShadow).toBe(true)
    expect(mesh.receiveShadow).toBe(true)
  })

  it('reaches nested meshes', () => {
    const root = new Group()
    const branch = new Group()
    const mesh = new Mesh(new BoxGeometry(1, 1, 1))
    branch.add(mesh)
    root.add(branch)

    enableShadows(root)

    expect(mesh.castShadow).toBe(true)
  })

  it('honours an opt-out flag', () => {
    const root = new Group()
    const mesh = new Mesh(new BoxGeometry(1, 1, 1))
    mesh.userData.excludeFromShadows = true
    root.add(mesh)

    enableShadows(root)

    expect(mesh.castShadow).toBe(false)
  })

  it('leaves the sky dome out of it', () => {
    // The dome encloses the entire scene, so casting from it would shade everything.
    const dome = createSkyDome()
    enableShadows(dome)
    expect(dome.castShadow).toBe(false)
  })
})
