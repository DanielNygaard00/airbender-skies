import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { buildWorld } from './world'
import { ARCHIPELAGO } from './levels/archipelago'
import type { Level } from './level'

describe('buildWorld', () => {
  it('creates one mesh per island', () => {
    expect(buildWorld(ARCHIPELAGO).islands).toHaveLength(ARCHIPELAGO.islands.length)
  })

  it('positions each mesh where the level says', () => {
    // Anchored on ring-east at (320, -70, 40) rather than on home at the origin.
    // At the origin every failure mode collapses to the same value: not
    // positioning the mesh at all, and applying the offset twice, both give
    // (0, 0, 0). Here a missing copy gives the origin and a double-apply gives
    // (640, -140, 80), so both fail loudly.
    const world = buildWorld(ARCHIPELAGO)
    const def = ARCHIPELAGO.islands.find((i) => i.id === 'ring-east')!
    const mesh = world.islands.find((i) => i.id === 'ring-east')!.mesh
    expect(def.position.toArray()).toEqual([320, -70, 40])
    expect(mesh.position.toArray()).toEqual(def.position.toArray())
  })

  it('positions every mesh where the level says, not just the first', () => {
    const world = buildWorld(ARCHIPELAGO)
    for (const def of ARCHIPELAGO.islands) {
      const mesh = world.islands.find((i) => i.id === def.id)!.mesh
      expect(mesh.position.toArray()).toEqual(def.position.toArray())
    }
  })

  it('adds every mesh to the returned group', () => {
    const world = buildWorld(ARCHIPELAGO)
    expect(world.group.children).toHaveLength(ARCHIPELAGO.islands.length)
  })

  it('exposes a terrain query that finds an island away from the origin', () => {
    // Also anchored off the origin: with home at (0, 0, 0) this passed even when
    // every island had collapsed onto the origin.
    const world = buildWorld(ARCHIPELAGO)
    const def = ARCHIPELAGO.islands.find((i) => i.id === 'ring-east')!
    const height = world.terrain.groundHeightAt(def.position.x, def.position.z)
    expect(height).not.toBeNull()
    // The surface must be near the island's own altitude, not near the origin.
    expect(height!).toBeGreaterThan(def.position.y)
    expect(height!).toBeLessThan(def.position.y + def.height)
  })

  it('rejects an invalid level rather than building a broken world', () => {
    const broken: Level = { ...ARCHIPELAGO, spawn: { islandId: 'nope', offset: new Vector3() } }
    expect(() => buildWorld(broken)).toThrow(/unknown island "nope"/)
  })

  it('is deterministic, so the same level always builds the same geometry', () => {
    const a = buildWorld(ARCHIPELAGO).islands[0]!.mesh.geometry.attributes.position!.array
    const b = buildWorld(ARCHIPELAGO).islands[0]!.mesh.geometry.attributes.position!.array
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})
