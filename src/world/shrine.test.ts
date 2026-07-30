import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { placeShrines, collectShrinesAt, COLLECT_RADIUS } from './shrine'
import { ARCHIPELAGO } from './levels/archipelago'
import type { TerrainQuery } from '../core/types'
import type { Level } from './level'

const flat: TerrainQuery = {
  groundHeightAt: () => 10,
  raycastDown: (from) => ({
    point: new Vector3(from.x, 10, from.z), normal: new Vector3(0, 1, 0), islandId: 'x',
  }),
}
const empty: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }

describe('placeShrines', () => {
  it('places one shrine per level shrine definition', () => {
    expect(placeShrines(ARCHIPELAGO, flat, [])).toHaveLength(ARCHIPELAGO.shrines.length)
  })

  it('sits shrines above the ground surface', () => {
    expect(placeShrines(ARCHIPELAGO, flat, [])[0]!.position.y).toBeGreaterThan(10)
  })

  it('marks already-collected shrines', () => {
    const shrines = placeShrines(ARCHIPELAGO, flat, ['home'])
    expect(shrines.find((s) => s.id === 'home')!.collected).toBe(true)
    expect(shrines.find((s) => s.id === 'spire')!.collected).toBe(false)
  })

  it('drops shrines whose island has no ground beneath them', () => {
    expect(placeShrines(ARCHIPELAGO, empty, [])).toHaveLength(0)
  })

  it('skips shrines referencing a missing island', () => {
    const level: Level = { ...ARCHIPELAGO, shrines: [{ islandId: 'ghost', offset: new Vector3() }] }
    expect(placeShrines(level, flat, [])).toHaveLength(0)
  })
})

describe('collectShrinesAt', () => {
  const shrines = [
    { id: 'a', position: new Vector3(0, 0, 0), collected: false },
    { id: 'b', position: new Vector3(100, 0, 0), collected: false },
    { id: 'c', position: new Vector3(0, 0, 0), collected: true },
  ]

  it('collects a shrine within range', () => {
    expect(collectShrinesAt(shrines, new Vector3(1, 0, 0))).toEqual(['a'])
  })

  it('ignores shrines out of range', () => {
    expect(collectShrinesAt(shrines, new Vector3(50, 0, 0))).toEqual([])
  })

  it('does not re-collect an already-collected shrine', () => {
    expect(collectShrinesAt(shrines, new Vector3(0, 0, 0))).toEqual(['a'])
  })

  it('collects exactly at the radius boundary', () => {
    expect(collectShrinesAt(shrines, new Vector3(COLLECT_RADIUS, 0, 0))).toEqual(['a'])
  })

  it('returns empty when nothing is nearby', () => {
    expect(collectShrinesAt(shrines, new Vector3(0, 500, 0))).toEqual([])
  })
})
