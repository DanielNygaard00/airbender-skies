import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { propPlacements } from './props'
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
  raycastDown: (from, maxDistance) =>
    from.y >= 5 && from.y - maxDistance <= 5
      ? {
          point: new Vector3(from.x, 5, from.z),
          normal: new Vector3(Math.sqrt(1 - normalY * normalY), normalY, 0),
          islandId: 'prop-test',
        }
      : null,
})
const voidTerrain: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }

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
