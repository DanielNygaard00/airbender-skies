import { describe, it, expect } from 'vitest'
import { Vector3, type Mesh } from 'three'
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

  it('adds every island mesh to the returned group', () => {
    const world = buildWorld(ARCHIPELAGO)
    for (const island of world.islands) {
      expect(world.group.children).toContain(island.mesh)
    }
  })

  it('adds prop meshes beyond the island meshes', () => {
    const world = buildWorld(ARCHIPELAGO)
    expect(world.group.children.length).toBeGreaterThan(ARCHIPELAGO.islands.length)
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

  it('keeps the prop scatter clear of payloads as well as shrines', () => {
    // The only observable consequence of `buildWorld` passing payload offsets into
    // `buildProps`: the props are merged into one mesh per island, so individual placements
    // cannot be read back, but a level whose payload is ignored scatters differently from one
    // whose payload is respected. Measured on the shipped archipelago: with the payload offset
    // left out, the nearest prop lands 6.06 units from where the bundle sits, inside the
    // 8-unit clearance, so this comparison is not a theoretical difference — that prop is
    // rejected and re-drawn elsewhere. props.test.ts pins the clearance rule itself; this pins
    // the one line that feeds payloads into it.
    const withPayloads = buildWorld(ARCHIPELAGO)
    const without = buildWorld({ ...ARCHIPELAGO, payloads: undefined })
    // Home is the first island, so its prop mesh is the first child past the island meshes.
    const props = (world: ReturnType<typeof buildWorld>) => Array.from(
      (world.group.children[ARCHIPELAGO.islands.length] as Mesh)
        .geometry.attributes.position!.array,
    )
    expect(props(withPayloads)).not.toEqual(props(without))
  })

  it('is deterministic, so the same level always builds the same geometry', () => {
    const a = buildWorld(ARCHIPELAGO).islands[0]!.mesh.geometry.attributes.position!.array
    const b = buildWorld(ARCHIPELAGO).islands[0]!.mesh.geometry.attributes.position!.array
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})
