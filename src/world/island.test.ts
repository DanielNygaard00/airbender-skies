import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createIslandGeometry, type IslandDef } from './island'

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
    expect(horizontal).toBeLessThan(40 * 1.4)
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
})
