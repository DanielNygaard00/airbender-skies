import { describe, it, expect } from 'vitest'
import { Vector3, Mesh } from 'three'
import { propPlacements, buildProps } from './props'
import type { IslandDef } from './island'
import type { TerrainQuery } from '../core/types'

const def = (over: Partial<IslandDef> = {}): IslandDef => ({
  id: 'prop-test',
  position: new Vector3(0, 0, 0),
  radius: 60,
  height: 30,
  biome: 'grass',
  noiseSeed: 777,
  ...over,
})

/** Flat ground at y=5 everywhere, with a configurable surface normal. */
const flat = (normalY = 1): TerrainQuery => ({
  groundHeightAt: () => 5,
  // Only answers downward casts. A fake that ignored `direction` would answer a
  // horizontal collision sweep with a hit on the ground below, so a movement test in a
  // flat fake world would start deflecting off phantom walls. The threshold is scaled by
  // the direction's length, not compared against the unit vector: `raycast` accepts an
  // unnormalised direction, and a fake that only recognised the unit down vector would
  // answer `null` to a mostly-downward sweep the real one answers.
  raycast: (from, direction, maxDistance) =>
    direction.y < -0.9 * direction.length() && from.y >= 5 && from.y - maxDistance <= 5
      ? {
          point: new Vector3(from.x, 5, from.z),
          normal: new Vector3(Math.sqrt(1 - normalY * normalY), normalY, 0),
          islandId: 'prop-test',
        }
      : null,
})
const voidTerrain: TerrainQuery = { groundHeightAt: () => null, raycast: () => null }

describe('propPlacements', () => {
  it('is deterministic for the same island', () => {
    const a = propPlacements(def(), flat(), [])
    const b = propPlacements(def(), flat(), [])
    expect(a.map((p) => ({ ...p, position: p.position.toArray() })))
      .toEqual(b.map((p) => ({ ...p, position: p.position.toArray() })))
  })

  it('plants the requested tree and boulder counts on friendly ground', () => {
    const placements = propPlacements(def({ radius: 60 }), flat(), [])
    expect(placements.filter((p) => p.kind === 'tree')).toHaveLength(10) // 60 / 6
    expect(placements.filter((p) => p.kind === 'boulder')).toHaveLength(7) // round(60 / 9)
  })

  it('sets every placement on the ground surface', () => {
    for (const p of propPlacements(def(), flat(), [])) {
      expect(p.position.y).toBe(5)
    }
  })

  it('keeps clear of shrines', () => {
    // Shrine offsets are island-local; def.position is the origin here.
    const shrine = new Vector3(10, 0, -5)
    for (const p of propPlacements(def(), flat(), [shrine])) {
      expect(Math.hypot(p.position.x - 10, p.position.z + 5)).toBeGreaterThanOrEqual(8)
    }
  })

  it('keeps clear of the island center, where respawns land', () => {
    for (const p of propPlacements(def(), flat(), [])) {
      expect(Math.hypot(p.position.x, p.position.z)).toBeGreaterThanOrEqual(8)
    }
  })

  it('stays within the placement disc', () => {
    const d = def({ radius: 60 })
    for (const p of propPlacements(d, flat(), [])) {
      expect(Math.hypot(p.position.x, p.position.z)).toBeLessThanOrEqual(60 * 0.75 + 1e-6)
    }
  })

  it('plants no trees on rock islands', () => {
    const kinds = propPlacements(def({ biome: 'rock' }), flat(), []).map((p) => p.kind)
    expect(kinds).not.toContain('tree')
    expect(kinds).toContain('boulder')
  })

  it('gives temple islands a pillar ring and an arch instead of trees', () => {
    const placements = propPlacements(def({ biome: 'temple' }), flat(), [])
    expect(placements.filter((p) => p.kind === 'pillar')).toHaveLength(5)
    expect(placements.filter((p) => p.kind === 'arch')).toHaveLength(1)
    expect(placements.filter((p) => p.kind === 'tree')).toHaveLength(0)
  })

  it('rejects steep ground and terminates', () => {
    expect(propPlacements(def(), flat(0.5), [])).toHaveLength(0)
  })

  it('terminates on terrain with no ground at all', () => {
    expect(propPlacements(def(), voidTerrain, [])).toHaveLength(0)
  })

  it('varies scale within 0.8 to 1.4', () => {
    for (const p of propPlacements(def(), flat(), [])) {
      expect(p.scale).toBeGreaterThanOrEqual(0.8)
      expect(p.scale).toBeLessThanOrEqual(1.4)
    }
  })
})

describe('buildProps', () => {
  it('merges all props into a single mesh with vertex colors', () => {
    const mesh = buildProps(def(), flat(), [])
    expect(mesh).toBeInstanceOf(Mesh)
    expect(mesh!.geometry.attributes.color).toBeDefined()
    expect(mesh!.geometry.attributes.position!.count).toBeGreaterThan(0)
    expect(mesh!.geometry.boundingSphere!.radius).toBeGreaterThan(0)
  })

  it('returns null when nothing can be placed', () => {
    expect(buildProps(def(), voidTerrain, [])).toBeNull()
  })

  it('is deterministic', () => {
    const a = buildProps(def(), flat(), [])!.geometry.attributes.position!.array
    const b = buildProps(def(), flat(), [])!.geometry.attributes.position!.array
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('builds props near the ground height', () => {
    const mesh = buildProps(def(), flat(), [])!
    // Flat ground sits at y=5; every prop part lives on or above it, and no
    // prop is taller than ~12 m at max scale.
    const pos = mesh.geometry.attributes.position!
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeGreaterThan(4)
      expect(pos.getY(i)).toBeLessThan(5 + 14)
    }
  })
})
