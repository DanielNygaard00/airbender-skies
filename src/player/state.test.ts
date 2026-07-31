import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { spawnPointFor, createPlayerState } from './state'
import { DEFAULT_FLIGHT_CONFIG } from '../core/config'
import type { Level } from '../world/level'
import type { TerrainQuery } from '../core/types'
import type { SaveData } from '../core/save'

const level: Level = {
  id: 'test',
  spawn: { islandId: 'home', offset: new Vector3(0, 6, 0) },
  worldFloorY: -600,
  islands: [
    { id: 'home', position: new Vector3(0, 0, 0), radius: 70, height: 34, biome: 'grass', noiseSeed: 1 },
    { id: 'far', position: new Vector3(100, 20, 50), radius: 30, height: 10, biome: 'rock', noiseSeed: 2 },
  ],
  shrines: [],
  waterfalls: [],
}

const terrain = (groundY: number | null): TerrainQuery => ({
  groundHeightAt: () => groundY,
  raycastDown: () => null,
})

const save = (maxBreath: number): SaveData => ({ collectedShrines: [], maxBreath })

describe('spawnPointFor', () => {
  it('returns a position above the found ground for a known island', () => {
    const point = spawnPointFor(level, terrain(20))('far')
    expect(point.x).toBe(100)
    expect(point.z).toBe(50)
    expect(point.y).toBe(22) // groundY (20) + SPAWN_CLEARANCE (2)
  })

  it('falls back to the level spawn island when given an unknown id', () => {
    const point = spawnPointFor(level, terrain(5))('does-not-exist')
    // Should resolve to 'home', not 'far'.
    expect(point.x).toBe(0)
    expect(point.z).toBe(0)
    expect(point.y).toBe(7) // groundY (5) + SPAWN_CLEARANCE (2)
  })

  it('falls back to the level spawn island when given null', () => {
    const point = spawnPointFor(level, terrain(5))(null)
    expect(point.x).toBe(0)
    expect(point.z).toBe(0)
  })

  it("falls back to the island's nominal top when groundHeightAt returns null", () => {
    const point = spawnPointFor(level, terrain(null))('far')
    // island.position.y (20) + island.height (10) + SPAWN_CLEARANCE (2)
    expect(point.y).toBe(32)
  })
})

describe('createPlayerState', () => {
  it('starts in ground mode with full breath and at least baseMaxBreath', () => {
    const state = createPlayerState(level, terrain(0), save(0), DEFAULT_FLIGHT_CONFIG)
    expect(state.mode).toBe('ground')
    expect(state.grounded).toBe(true)
    expect(state.maxBreath).toBeGreaterThanOrEqual(DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
    expect(state.breath).toBe(state.maxBreath)
    expect(state.lastGroundIslandId).toBe(level.spawn.islandId)
  })

  it('honours a higher saved maxBreath', () => {
    const higher = DEFAULT_FLIGHT_CONFIG.baseMaxBreath + 50
    const state = createPlayerState(level, terrain(0), save(higher), DEFAULT_FLIGHT_CONFIG)
    expect(state.maxBreath).toBe(higher)
    expect(state.breath).toBe(higher)
  })

  it('spawns with no air jumps used and no charge', () => {
    const state = createPlayerState(level, terrain(0), save(0), DEFAULT_FLIGHT_CONFIG)
    expect(state.airJumpsUsed).toBe(0)
    expect(state.chargeTime).toBe(0)
  })
})
