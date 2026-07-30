import { describe, it, expect } from 'vitest'
import { Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { createIslandGeometry, type IslandDef } from './island'
import { createTerrainQuery, type IslandMesh } from './terrain-query'

function island(id: string, position: Vector3, radius = 40): IslandMesh {
  const def: IslandDef = { id, position, radius, height: 30, biome: 'grass', noiseSeed: 7 }
  const mesh = new Mesh(createIslandGeometry(def), new MeshBasicMaterial())
  mesh.position.copy(position)
  mesh.updateMatrixWorld(true)
  return { id, mesh }
}

describe('createTerrainQuery', () => {
  const origin = island('origin', new Vector3(0, 0, 0))
  const far = island('far', new Vector3(500, 120, 0))
  const query = createTerrainQuery([origin, far])

  it('finds ground above the centre of an island', () => {
    expect(query.groundHeightAt(0, 0)).not.toBeNull()
  })

  it('returns null in open sky between islands', () => {
    expect(query.groundHeightAt(250, 0)).toBeNull()
  })

  it('reports a higher surface for an island placed higher', () => {
    const low = query.groundHeightAt(0, 0)!
    const high = query.groundHeightAt(500, 0)!
    expect(high).toBeGreaterThan(low)
    expect(high).toBeGreaterThan(100)
  })

  it('raycastDown reports which island was hit', () => {
    expect(query.raycastDown(new Vector3(0, 300, 0), 1000)!.islandId).toBe('origin')
    expect(query.raycastDown(new Vector3(500, 400, 0), 1000)!.islandId).toBe('far')
  })

  it('raycastDown returns null when nothing is below', () => {
    expect(query.raycastDown(new Vector3(250, 300, 0), 1000)).toBeNull()
  })

  it('respects the max distance', () => {
    expect(query.raycastDown(new Vector3(0, 300, 0), 5)).toBeNull()
  })

  it('returns an upward-ish normal on top of an island', () => {
    expect(query.raycastDown(new Vector3(0, 300, 0), 1000)!.normal.y).toBeGreaterThan(0)
  })

  it('does not alias its returned point into caller state', () => {
    const hit = query.raycastDown(new Vector3(0, 300, 0), 1000)!
    const y = hit.point.y
    hit.point.set(0, 0, 0)
    expect(query.raycastDown(new Vector3(0, 300, 0), 1000)!.point.y).toBeCloseTo(y, 6)
  })

  it('an empty world reports no ground anywhere', () => {
    const empty = createTerrainQuery([])
    expect(empty.groundHeightAt(0, 0)).toBeNull()
    expect(empty.raycastDown(new Vector3(0, 100, 0), 1000)).toBeNull()
  })
})
