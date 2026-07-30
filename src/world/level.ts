import type { Vector3 } from 'three'
import type { IslandDef } from './island'

export interface ShrineDef {
  islandId: string
  offset: Vector3
}

export interface Level {
  id: string
  spawn: { islandId: string; offset: Vector3 }
  /** Falling below this height triggers a respawn. */
  worldFloorY: number
  islands: IslandDef[]
  shrines: ShrineDef[]
}

/** Throws on any structural error, with a message that names the offender. */
export function validateLevel(level: Level): void {
  if (level.islands.length === 0) throw new Error(`Level "${level.id}" has no islands`)

  const ids = new Set<string>()
  for (const island of level.islands) {
    if (ids.has(island.id)) {
      throw new Error(`Level "${level.id}" has duplicate island id "${island.id}"`)
    }
    ids.add(island.id)
    if (!(island.radius > 0)) {
      throw new Error(`Island "${island.id}" must have radius > 0, got ${island.radius}`)
    }
    if (!(island.height > 0)) {
      throw new Error(`Island "${island.id}" must have height > 0, got ${island.height}`)
    }
  }

  if (!ids.has(level.spawn.islandId)) {
    throw new Error(`Level "${level.id}" spawn references unknown island "${level.spawn.islandId}"`)
  }
  for (const shrine of level.shrines) {
    if (!ids.has(shrine.islandId)) {
      throw new Error(`Level "${level.id}" shrine references unknown island "${shrine.islandId}"`)
    }
  }

  const lowest = Math.min(...level.islands.map((i) => i.position.y - i.height * 2))
  if (level.worldFloorY >= lowest) {
    throw new Error(
      `Level "${level.id}" worldFloorY (${level.worldFloorY}) must sit below ` +
      `the lowest island (${lowest})`,
    )
  }
}

/**
 * Islands close enough to intersect visually. Reported rather than thrown,
 * because it is a design smell rather than a broken level.
 */
export function findOverlappingIslands(level: Level): [string, string][] {
  const clashes: [string, string][] = []
  for (let i = 0; i < level.islands.length; i++) {
    for (let j = i + 1; j < level.islands.length; j++) {
      const a = level.islands[i]!
      const b = level.islands[j]!
      const horizontal = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)
      const verticalGap = Math.abs(a.position.y - b.position.y)
      if (horizontal < a.radius + b.radius && verticalGap < (a.height + b.height) * 2) {
        clashes.push([a.id, b.id])
      }
    }
  }
  return clashes
}
