import { describe, it, expect } from 'vitest'
import { Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { createIslandGeometry, type IslandDef } from './island'
import { createTerrainQuery, raycastDown, type IslandMesh } from './terrain-query'

function island(id: string, position: Vector3, radius = 40): IslandMesh {
  const def: IslandDef = { id, position, radius, height: 30, biome: 'grass', noiseSeed: 7 }
  const mesh = new Mesh(createIslandGeometry(def), new MeshBasicMaterial())
  mesh.position.copy(position)
  mesh.updateMatrixWorld(true)
  return { id, mesh }
}

/** The island fixture the tests below stand on when they need something at the origin. */
function originIsland(): IslandMesh {
  return island('origin', new Vector3(0, 0, 0))
}

describe('createTerrainQuery', () => {
  const origin = originIsland()
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
    expect(raycastDown(query, new Vector3(0, 300, 0), 1000)!.islandId).toBe('origin')
    expect(raycastDown(query, new Vector3(500, 400, 0), 1000)!.islandId).toBe('far')
  })

  it('raycastDown returns null when nothing is below', () => {
    expect(raycastDown(query, new Vector3(250, 300, 0), 1000)).toBeNull()
  })

  it('respects the max distance', () => {
    expect(raycastDown(query, new Vector3(0, 300, 0), 5)).toBeNull()
  })

  it('returns an upward-ish normal on top of an island', () => {
    expect(raycastDown(query, new Vector3(0, 300, 0), 1000)!.normal.y).toBeGreaterThan(0)
  })

  it('does not alias its returned point into caller state', () => {
    const hit = raycastDown(query, new Vector3(0, 300, 0), 1000)!
    const y = hit.point.y
    hit.point.set(0, 0, 0)
    expect(raycastDown(query, new Vector3(0, 300, 0), 1000)!.point.y).toBeCloseTo(y, 6)
  })

  it('an empty world reports no ground anywhere', () => {
    const empty = createTerrainQuery([])
    expect(empty.groundHeightAt(0, 0)).toBeNull()
    expect(raycastDown(empty, new Vector3(0, 100, 0), 1000)).toBeNull()
  })
})

describe('raycast', () => {
  it('finds a surface sideways, not only below', () => {
    // The whole point of the method. A downward-only query cannot answer this, which is
    // why the player used to fly through solid rock.
    const query = createTerrainQuery([originIsland()])
    const hit = query.raycast(new Vector3(-200, 0, 0), new Vector3(1, 0, 0), 1000)
    expect(hit).not.toBeNull()
    expect(hit!.point.x).toBeLessThan(0)
  })

  it('respects maxDistance in world units even for an unnormalised direction', () => {
    // Raycaster.set does not normalise, so a direction of length 10 would otherwise
    // silently multiply the range by ten.
    const query = createTerrainQuery([originIsland()])
    const near = query.raycast(new Vector3(-200, 0, 0), new Vector3(10, 0, 0), 5)
    expect(near).toBeNull()
  })

  it('returns null for a zero-length direction rather than casting a degenerate ray', () => {
    const query = createTerrainQuery([originIsland()])
    expect(query.raycast(new Vector3(0, 300, 0), new Vector3(), 1000)).toBeNull()
  })

  it('returns null for a non-finite direction', () => {
    const query = createTerrainQuery([originIsland()])
    expect(query.raycast(new Vector3(0, 300, 0), new Vector3(NaN, 0, 0), 1000)).toBeNull()
  })
})

describe('the raycastDown helper', () => {
  it('casts straight down through any TerrainQuery', () => {
    const query = createTerrainQuery([originIsland()])
    expect(raycastDown(query, new Vector3(0, 300, 0), 1000)!.islandId).toBe('origin')
  })

  it('honours maxDistance the way the old method did', () => {
    const query = createTerrainQuery([originIsland()])
    expect(raycastDown(query, new Vector3(0, 300, 0), 5)).toBeNull()
  })
})
