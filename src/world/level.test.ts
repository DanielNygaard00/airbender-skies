import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { validateLevel, findOverlappingIslands, type Level } from './level'
import { MAX_DEPTH_MULTIPLIER } from './island'
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
  waterfalls: [],
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

describe('waterfall validation', () => {
  it('rejects a waterfall on an unknown island', () => {
    expect(() => validateLevel({
      ...base(), waterfalls: [{ islandId: 'ghost', angle: 0, width: 8, length: 60 }],
    })).toThrow(/waterfall references unknown island "ghost"/)
  })

  it('rejects a non-positive width', () => {
    expect(() => validateLevel({
      ...base(), waterfalls: [{ islandId: 'a', angle: 0, width: 0, length: 60 }],
    })).toThrow(/width > 0/)
  })

  it('rejects a non-positive length', () => {
    expect(() => validateLevel({
      ...base(), waterfalls: [{ islandId: 'a', angle: 0, width: 8, length: -1 }],
    })).toThrow(/length > 0/)
  })

  it('accepts a level with no waterfalls at all', () => {
    expect(() => validateLevel({ ...base(), waterfalls: [] })).not.toThrow()
  })

  it('ARCHIPELAGO waterfalls all reference real islands', () => {
    const ids = new Set(ARCHIPELAGO.islands.map((i) => i.id))
    for (const w of ARCHIPELAGO.waterfalls) expect(ids.has(w.islandId)).toBe(true)
  })
})

describe('worldFloorY depth bound', () => {
  it('derives a depth multiplier that exceeds the roughness-displaced stretch', () => {
    // ROUGHNESS displaces vertices before BOTTOM_STRETCH scales them, so real
    // geometry reaches deeper than BOTTOM_STRETCH alone would suggest.
    expect(MAX_DEPTH_MULTIPLIER).toBeGreaterThan(2.4)
  })

  it('rejects a floor that clears height * 2 but not the real geometry', () => {
    // An island of height 20 at y=0 reaches about -48.6, not -40. A floor at
    // -45 sits inside the island's lower spike: validation used to accept it,
    // and the player would fall through the spike into the void.
    const l = base()
    l.worldFloorY = -45
    expect(() => validateLevel(l)).toThrow(/worldFloorY/)
  })

  it('still accepts a floor below the real geometry', () => {
    const l = base()
    l.worldFloorY = -55
    expect(() => validateLevel(l)).not.toThrow()
  })
})
