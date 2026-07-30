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
    const world = buildWorld(ARCHIPELAGO)
    const home = ARCHIPELAGO.islands.find((i) => i.id === 'home')!
    const mesh = world.islands.find((i) => i.id === 'home')!.mesh
    expect(mesh.position.toArray()).toEqual(home.position.toArray())
  })

  it('adds every mesh to the returned group', () => {
    const world = buildWorld(ARCHIPELAGO)
    expect(world.group.children).toHaveLength(ARCHIPELAGO.islands.length)
  })

  it('exposes a terrain query that finds the home island', () => {
    const world = buildWorld(ARCHIPELAGO)
    const home = ARCHIPELAGO.islands.find((i) => i.id === 'home')!
    expect(world.terrain.groundHeightAt(home.position.x, home.position.z)).not.toBeNull()
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
