import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createIslandGeometry, insideIsland, openAirTest, type IslandDef, MAX_DEPTH_MULTIPLIER,
} from './island'

const def = (over: Partial<IslandDef> = {}): IslandDef => ({
  id: 'test',
  position: new Vector3(0, 0, 0),
  radius: 40,
  height: 30,
  biome: 'grass',
  noiseSeed: 1234,
  ...over,
})

function positions(d: IslandDef): Float32Array {
  return createIslandGeometry(d).attributes.position!.array as Float32Array
}

describe('createIslandGeometry', () => {
  it('produces geometry with vertices', () => {
    expect(createIslandGeometry(def()).attributes.position!.count).toBeGreaterThan(100)
  })

  it('is deterministic for the same seed', () => {
    expect(Array.from(positions(def()))).toEqual(Array.from(positions(def())))
  })

  it('differs for different seeds', () => {
    expect(Array.from(positions(def({ noiseSeed: 1 }))))
      .not.toEqual(Array.from(positions(def({ noiseSeed: 2 }))))
  })

  it('respects the requested radius', () => {
    const box = createIslandGeometry(def({ radius: 40 })).boundingBox!
    const horizontal = Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z)
    expect(horizontal).toBeGreaterThan(40 * 0.6)
    // Summed noise amplitude is 0.42, so the silhouette can reach 1.42×radius.
    expect(horizontal).toBeLessThan(40 * 1.45)
  })

  it('scales with radius', () => {
    const small = createIslandGeometry(def({ radius: 20 })).boundingBox!
    const large = createIslandGeometry(def({ radius: 60 })).boundingBox!
    expect(large.max.x).toBeGreaterThan(small.max.x)
  })

  it('has a flatter top than bottom, so it reads as a floating island', () => {
    const box = createIslandGeometry(def()).boundingBox!
    expect(Math.abs(box.min.y)).toBeGreaterThan(box.max.y * 2)
  })

  it('computes vertex normals', () => {
    expect(createIslandGeometry(def()).attributes.normal).toBeDefined()
  })

  it('computes a bounding sphere, required for raycasting', () => {
    expect(createIslandGeometry(def()).boundingSphere!.radius).toBeGreaterThan(0)
  })

  it('contains no non-finite coordinates', () => {
    for (const n of positions(def())) expect(Number.isFinite(n)).toBe(true)
  })

  it('is non-indexed, so every face has its own vertices for flat shading', () => {
    expect(createIslandGeometry(def()).index).toBeNull()
  })

  it('keeps the walkable crown gentler than the full noise amplitude', () => {
    const d = def()
    const box = createIslandGeometry(d).boundingBox!
    // At the top pole only (1 - 0.55) = 45% of the 0.42 amplitude applies, and
    // u·(1 + 0.42·(1 - 0.55u)) is maximised at u = 1, so the crown can never
    // rise above TOP_FLATTEN · height · 1.189.
    expect(box.max.y).toBeLessThan(d.height * 0.35 * (1 + 0.42 * 0.45) + 1e-6)
  })

  it('derives MAX_DEPTH_MULTIPLIER from the summed octave amplitude', () => {
    expect(MAX_DEPTH_MULTIPLIER).toBeCloseTo(1.9 * 1.42, 6)
  })
})

describe('insideIsland', () => {
  it('agrees with the geometry it is testing against', () => {
    // The claim that matters, and the reason `shellRadius` is shared rather than copied: every
    // vertex of the built mesh is *on* the surface, so a point pulled 12% in from one must read as
    // rock and the same point pushed 12% out must read as air. Run over a spread of vertices, so
    // this covers the crown, the flanks and the stretched underside rather than one lucky
    // direction. A drifting second copy of the displacement maths fails here.
    const d = def()
    const p = positions(d)
    const vertices = p.length / 3
    let checked = 0
    for (let i = 0; i < vertices; i += Math.floor(vertices / 40)) {
      const surface = new Vector3(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!)
      if (surface.length() < 1e-6) continue
      const inward = surface.clone().multiplyScalar(0.88).add(d.position)
      const outward = surface.clone().multiplyScalar(1.12).add(d.position)
      expect(insideIsland(inward.x, inward.y, inward.z, d), `vertex ${i} inward`).toBe(true)
      expect(insideIsland(outward.x, outward.y, outward.z, d), `vertex ${i} outward`).toBe(false)
      checked++
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('counts the centre as rock', () => {
    const d = def()
    expect(insideIsland(d.position.x, d.position.y, d.position.z, d)).toBe(true)
  })

  it('reads the air above and below a floating island as air', () => {
    // The defect this function exists to avoid. A height test — "below the surface at this column
    // is underground" — is true of the whole sky under a floating island, and using one collapsed
    // two of the archipelago's wind tells: a thermal high above the islands and a dead-air pocket
    // slung beneath them. Both are open air and must read as such.
    const d = def({ position: new Vector3(0, 100, 0) })
    expect(insideIsland(0, 100 + d.height * 8, 0, d)).toBe(false)
    expect(insideIsland(0, 100 - d.height * MAX_DEPTH_MULTIPLIER * 4, 0, d)).toBe(false)
  })

  it('is unmoved by an island somewhere else', () => {
    const here = def()
    const far = def({ id: 'far', position: new Vector3(1000, 0, 1000), noiseSeed: 99 })
    const open = openAirTest([here, far])
    expect(open(0, 0, 0)).toBe(false)
    expect(open(500, 0, 500)).toBe(true)
  })
})
