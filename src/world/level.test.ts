import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { validateLevel, findOverlappingIslands, type Level } from './level'
import { ARCHIPELAGO } from './levels/archipelago'

const base = (): Level => ({
  id: 'test',
  spawn: { islandId: 'a', offset: new Vector3(0, 5, 0) },
  worldFloorY: -500,
  islands: [{
    id: 'a', position: new Vector3(0, 0, 0), radius: 40, height: 20,
    biome: 'grass', noiseSeed: 1,
  }],
  shrines: [],
})

describe('validateLevel', () => {
  it('accepts a minimal valid level', () => {
    expect(() => validateLevel(base())).not.toThrow()
  })

  it('rejects a level with no islands', () => {
    expect(() => validateLevel({ ...base(), islands: [] })).toThrow(/no islands/)
  })

  it('rejects duplicate island ids', () => {
    const l = base()
    l.islands.push({ ...l.islands[0]! })
    expect(() => validateLevel(l)).toThrow(/duplicate island id "a"/)
  })

  it('rejects a spawn on an unknown island', () => {
    expect(() => validateLevel({ ...base(), spawn: { islandId: 'nope', offset: new Vector3() } }))
      .toThrow(/unknown island "nope"/)
  })

  it('rejects a shrine on an unknown island', () => {
    expect(() => validateLevel({
      ...base(), shrines: [{ islandId: 'ghost', offset: new Vector3() }],
    })).toThrow(/unknown island "ghost"/)
  })

  it('rejects a non-positive radius', () => {
    const l = base()
    l.islands[0]!.radius = 0
    expect(() => validateLevel(l)).toThrow(/radius > 0/)
  })

  it('rejects a non-positive height', () => {
    const l = base()
    l.islands[0]!.height = -5
    expect(() => validateLevel(l)).toThrow(/height > 0/)
  })

  it('rejects a world floor above the lowest island', () => {
    expect(() => validateLevel({ ...base(), worldFloorY: 100 })).toThrow(/worldFloorY/)
  })
})

describe('findOverlappingIslands', () => {
  it('finds none in a well-spaced level', () => {
    expect(findOverlappingIslands(base())).toEqual([])
  })

  it('flags two islands sharing the same space', () => {
    const l = base()
    l.islands.push({
      id: 'b', position: new Vector3(5, 0, 5), radius: 40, height: 20,
      biome: 'rock', noiseSeed: 2,
    })
    expect(findOverlappingIslands(l)).toEqual([['a', 'b']])
  })

  it('does not flag islands separated vertically', () => {
    const l = base()
    l.islands.push({
      id: 'b', position: new Vector3(0, 400, 0), radius: 40, height: 20,
      biome: 'rock', noiseSeed: 2,
    })
    expect(findOverlappingIslands(l)).toEqual([])
  })
})

describe('ARCHIPELAGO', () => {
  it('is valid', () => {
    expect(() => validateLevel(ARCHIPELAGO)).not.toThrow()
  })

  it('has exactly eight islands', () => {
    expect(ARCHIPELAGO.islands).toHaveLength(8)
  })

  it('has one shrine per island', () => {
    expect(ARCHIPELAGO.shrines).toHaveLength(ARCHIPELAGO.islands.length)
    expect(new Set(ARCHIPELAGO.shrines.map((s) => s.islandId)).size).toBe(8)
  })

  it('has no overlapping islands', () => {
    expect(findOverlappingIslands(ARCHIPELAGO)).toEqual([])
  })

  it('spawns on the home island', () => {
    expect(ARCHIPELAGO.spawn.islandId).toBe('home')
  })

  it('places the spire highest and above the glide ring', () => {
    const y = (id: string) => ARCHIPELAGO.islands.find((i) => i.id === id)!.position.y
    expect(y('spire')).toBeGreaterThan(y('climb-far'))
    expect(y('climb-north')).toBeGreaterThan(y('home'))
    expect(y('ring-east')).toBeLessThan(y('home'))
  })
})
