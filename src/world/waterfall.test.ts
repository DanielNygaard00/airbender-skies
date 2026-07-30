import { describe, it, expect } from 'vitest'
import { Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { waterfallAnchor, advanceScroll, type WaterfallDef } from './waterfall'
import { createIslandGeometry, type IslandDef } from './island'
import { createTerrainQuery, type IslandMesh } from './terrain-query'
import { ARCHIPELAGO } from './levels/archipelago'
import type { TerrainQuery } from '../core/types'

const island: IslandDef = {
  id: 'home', position: new Vector3(100, 20, -50), radius: 40, height: 30,
  biome: 'grass', noiseSeed: 1,
}
const def = (over: Partial<WaterfallDef> = {}): WaterfallDef => ({
  islandId: 'home', angle: 0, width: 8, length: 60, ...over,
})

const solid: TerrainQuery = {
  groundHeightAt: () => 25,
  raycastDown: (from) => ({
    point: new Vector3(from.x, 25, from.z), normal: new Vector3(0, 1, 0), islandId: 'home',
  }),
}
const empty: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }

describe('advanceScroll', () => {
  it('advances with time', () => {
    expect(advanceScroll(0, 1, 0.25)).toBeCloseTo(0.25, 6)
  })

  it('wraps back into the unit range instead of growing without bound', () => {
    expect(advanceScroll(0.9, 1, 0.25)).toBeCloseTo(0.15, 6)
  })

  it('stays within the unit range over a long run', () => {
    let offset = 0
    for (let i = 0; i < 10000; i++) offset = advanceScroll(offset, 1 / 60, 1.4)
    expect(offset).toBeGreaterThanOrEqual(0)
    expect(offset).toBeLessThan(1)
  })

  it('does not move when time does not pass', () => {
    expect(advanceScroll(0.4, 0, 1.4)).toBeCloseTo(0.4, 6)
  })
})

describe('waterfallAnchor', () => {
  it('places the curtain out at the island rim, not at its centre', () => {
    const anchor = waterfallAnchor(island, def(), solid)!
    const horizontal = Math.hypot(
      anchor.position.x - island.position.x, anchor.position.z - island.position.z,
    )
    expect(horizontal).toBeGreaterThan(island.radius * 0.7)
  })

  it('puts the curtain at the ground height it found', () => {
    expect(waterfallAnchor(island, def(), solid)!.position.y).toBeCloseTo(25, 5)
  })

  it('faces outward, so the angle follows the rim position', () => {
    const north = waterfallAnchor(island, def({ angle: 0 }), solid)!
    const east = waterfallAnchor(island, def({ angle: Math.PI / 2 }), solid)!
    expect(north.rotationY).not.toBeCloseTo(east.rotationY, 3)
  })

  it('moves around the rim as the angle changes', () => {
    const a = waterfallAnchor(island, def({ angle: 0 }), solid)!
    const b = waterfallAnchor(island, def({ angle: Math.PI }), solid)!
    expect(a.position.distanceTo(b.position)).toBeGreaterThan(island.radius)
  })

  it('returns null when the rim point has no ground beneath it', () => {
    expect(waterfallAnchor(island, def(), empty)).toBeNull()
  })

  it('does not mutate the island position it is given', () => {
    waterfallAnchor(island, def(), solid)
    expect(island.position.toArray()).toEqual([100, 20, -50])
  })

  it('is deterministic for the same inputs', () => {
    const a = waterfallAnchor(island, def(), solid)!
    const b = waterfallAnchor(island, def(), solid)!
    expect(a.position.toArray()).toEqual(b.position.toArray())
    expect(a.rotationY).toBeCloseTo(b.rotationY, 10)
  })
})

describe('waterfallAnchor rim retry', () => {
  // Ground only under the two innermost insets (0.76, 0.72 of the radius),
  // so the outermost probes must miss before this returns a hit.
  const outerMissesInnerHits: TerrainQuery = {
    groundHeightAt: (x, z) => {
      const reach = Math.hypot(x - island.position.x, z - island.position.z)
      return reach <= island.radius * 0.78 ? 25 : null
    },
    raycastDown: () => null,
  }

  it('steps inward and finds ground when the outermost rim point misses', () => {
    expect(waterfallAnchor(island, def(), outerMissesInnerHits)).not.toBeNull()
  })

  it('the retried point is still a plausible rim distance from the centre', () => {
    const anchor = waterfallAnchor(island, def(), outerMissesInnerHits)!
    const horizontal = Math.hypot(
      anchor.position.x - island.position.x, anchor.position.z - island.position.z,
    )
    expect(horizontal).toBeGreaterThan(island.radius * 0.7)
  })

  it('still returns null when there is no ground at any inset', () => {
    const noGroundAnywhere: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }
    expect(waterfallAnchor(island, def(), noGroundAnywhere)).toBeNull()
  })

  it('resolves a real island angle that the single fixed inset used to miss', () => {
    const home = ARCHIPELAGO.islands.find((i) => i.id === 'ring-east')!
    const waterfallDef = ARCHIPELAGO.waterfalls.find((w) => w.islandId === 'ring-east')!
    const mesh = new Mesh(createIslandGeometry(home), new MeshBasicMaterial())
    mesh.position.copy(home.position)
    mesh.updateMatrixWorld(true)
    const islandMesh: IslandMesh = { id: home.id, mesh }
    const terrain = createTerrainQuery([islandMesh])

    expect(waterfallAnchor(home, waterfallDef, terrain)).not.toBeNull()
  })
})
