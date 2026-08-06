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

  it('honours maxDistance in world units on either side of the real hit', () => {
    // originIsland's surface along this ray sits at x ~= -46.55 (noise-perturbed, not the
    // nominal radius of 40), which is ~153.45 world units out from `from`. 200 comfortably
    // clears that; 100 comfortably falls short of it. The direction is left unnormalised
    // (length 10) on purpose, to pin that maxDistance behaves the same in world units
    // regardless of direction length.
    const query = createTerrainQuery([originIsland()])
    const from = new Vector3(-200, 0, 0)
    const direction = new Vector3(10, 0, 0)
    expect(query.raycast(from, direction, 200)).not.toBeNull()
    expect(query.raycast(from, direction, 100)).toBeNull()
  })

  it('treats a direction and the same direction scaled by a constant identically', () => {
    // This is the property the seven ground-plane fakes elsewhere in the test suite got
    // wrong before their `direction.y < -0.9` guard was scaled by `direction.length()`:
    // comparing a raw component against a unit-vector threshold treats a scaled-but-still-
    // mostly-downward direction as different from its unit form, when `raycast` itself does
    // not -- scaling the direction must not change whether it hits or where.
    const query = createTerrainQuery([originIsland()])
    const from = new Vector3(-200, 0, 0)
    const unit = new Vector3(1, 0, 0)
    const scaled = unit.clone().multiplyScalar(7)
    const a = query.raycast(from, unit, 1000)
    const b = query.raycast(from, scaled, 1000)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(b!.point.toArray()).toEqual(a!.point.toArray())
    expect(b!.islandId).toBe(a!.islandId)
  })

  // The two tests below are contract tests, not proof that the guard in `raycast` is
  // load-bearing: a zero-length or non-finite direction normalises to NaN (divideScalar's
  // 1/0 or 1/NaN), and a NaN ray already fails every downstream triangle-intersection
  // comparison in three.js, so both would still return null with the guard deleted. The
  // guard stays anyway -- it makes the contract explicit and fails fast, rather than
  // depending on a NaN ray staying harmless in whatever raycasting backend runs next.
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
