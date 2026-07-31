import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createIslandGeometry, type IslandDef } from './island'
import { paintIsland, BIOME_PALETTES } from './island-paint'

const def: IslandDef = {
  id: 'paint-test',
  position: new Vector3(0, 0, 0),
  radius: 40,
  height: 30,
  biome: 'grass',
  noiseSeed: 4321,
}

/** Face index → { normal, centroid, color } for a painted geometry. */
function faces(biome: IslandDef['biome'] = 'grass', seed = 99) {
  const geometry = createIslandGeometry(def)
  paintIsland(geometry, biome, seed)
  const pos = geometry.attributes.position!
  const col = geometry.attributes.color!
  const out: { normal: Vector3; centroid: Vector3; color: [number, number, number] }[] = []
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  for (let f = 0; f < pos.count / 3; f++) {
    a.fromBufferAttribute(pos, f * 3)
    b.fromBufferAttribute(pos, f * 3 + 1)
    c.fromBufferAttribute(pos, f * 3 + 2)
    const normal = new Vector3().subVectors(b, a)
      .cross(new Vector3().subVectors(c, a)).normalize()
    const centroid = new Vector3().add(a).add(b).add(c).divideScalar(3)
    out.push({
      normal, centroid,
      color: [col.getX(f * 3), col.getY(f * 3), col.getZ(f * 3)],
    })
  }
  return { geometry, faces: out }
}

/** True when the face color is the palette color within the ±4% jitter. */
function matches(color: [number, number, number], hex: number): boolean {
  const r = ((hex >> 16) & 0xff) / 255
  const g = ((hex >> 8) & 0xff) / 255
  const b = (hex & 0xff) / 255
  const within = (got: number, want: number) =>
    Math.abs(got - want) <= want * 0.05 + 1e-3
  return within(color[0], r) && within(color[1], g) && within(color[2], b)
}

describe('paintIsland', () => {
  it('writes one color per vertex, uniform within each face', () => {
    const { geometry } = faces()
    const col = geometry.attributes.color!
    expect(col.count).toBe(geometry.attributes.position!.count)
    for (let f = 0; f < col.count / 3; f++) {
      expect(col.getX(f * 3)).toBe(col.getX(f * 3 + 1))
      expect(col.getX(f * 3)).toBe(col.getX(f * 3 + 2))
    }
  })

  it('paints flat upward faces above the equator with the top color', () => {
    const flatTop = faces().faces.filter((f) => f.normal.y > 0.9 && f.centroid.y > 1)
    expect(flatTop.length).toBeGreaterThan(0)
    for (const f of flatTop) expect(matches(f.color, BIOME_PALETTES.grass.top)).toBe(true)
  })

  it('paints steep faces above the equator with the cliff color', () => {
    const steep = faces().faces.filter(
      (f) => Math.abs(f.normal.y) < 0.3 && f.centroid.y > 1,
    )
    expect(steep.length).toBeGreaterThan(0)
    for (const f of steep) expect(matches(f.color, BIOME_PALETTES.grass.cliff)).toBe(true)
  })

  it('paints the deep underside with the underside color', () => {
    const { geometry, faces: all } = faces()
    const minY = geometry.boundingBox!.min.y
    const deep = all.filter((f) => f.centroid.y < minY * 0.6)
    expect(deep.length).toBeGreaterThan(0)
    for (const f of deep) expect(matches(f.color, BIOME_PALETTES.grass.under)).toBe(true)
  })

  it('uses the palette of the requested biome', () => {
    const flatTop = faces('temple').faces.filter((f) => f.normal.y > 0.9 && f.centroid.y > 1)
    expect(flatTop.length).toBeGreaterThan(0)
    for (const f of flatTop) expect(matches(f.color, BIOME_PALETTES.temple.top)).toBe(true)
  })

  it('is deterministic for the same seed', () => {
    const a = faces('grass', 7).geometry.attributes.color!.array
    const b = faces('grass', 7).geometry.attributes.color!.array
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('rejects indexed geometry', () => {
    const { geometry } = faces()
    const indexed = geometry.clone()
    indexed.setIndex([0, 1, 2])
    expect(() => paintIsland(indexed, 'grass', 1)).toThrow(/non-indexed/)
  })
})
