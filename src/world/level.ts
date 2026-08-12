import type { Vector3 } from 'three'
import { MAX_DEPTH_MULTIPLIER, type IslandDef } from './island'
import type { WaterfallDef } from './waterfall'
import type { WindDef } from './wind'

export interface ShrineDef {
  islandId: string
  offset: Vector3
}

/**
 * A carryable payload, and where it is meant to end up.
 *
 * Two island references rather than one, because a payload without a destination is just
 * scenery: the whole point of §2.4's escort framing is that the weight is carried *somewhere*,
 * and the pair of islands is what makes the degraded flight model a route rather than a
 * handicap. `validateLevel` checks both, so a level cannot ship a payload nobody can deliver.
 */
export interface PayloadDef {
  /** The island it starts on. */
  islandId: string
  /** Where on that island, relative to the island's centre. */
  offset: Vector3
  /** Setting it down anywhere on this island counts as delivered. */
  destinationIslandId: string
}

export interface Level {
  id: string
  spawn: { islandId: string; offset: Vector3 }
  /** Falling below this height triggers a respawn. */
  worldFloorY: number
  islands: IslandDef[]
  shrines: ShrineDef[]
  /** Things the player can carry on the glider. Optional. */
  payloads?: PayloadDef[]
  waterfalls: WaterfallDef[]
  /** Thermals, ridge lift, rivers, downdrafts and dead air. Optional. */
  winds?: WindDef[]
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
  for (const payload of level.payloads ?? []) {
    // Both ends, and the destination is the one worth being strict about: a payload whose
    // source island is missing simply never appears, but a payload with an unknown
    // destination appears, gets carried, and can never be delivered — a dead objective that
    // looks alive.
    if (!ids.has(payload.islandId)) {
      throw new Error(`Level "${level.id}" payload references unknown island "${payload.islandId}"`)
    }
    if (!ids.has(payload.destinationIslandId)) {
      throw new Error(
        `Level "${level.id}" payload on "${payload.islandId}" references unknown ` +
        `destination island "${payload.destinationIslandId}"`,
      )
    }
    if (payload.islandId === payload.destinationIslandId) {
      throw new Error(
        `Level "${level.id}" payload on "${payload.islandId}" is already at its ` +
        'destination, so carrying it would be a walk rather than a flight',
      )
    }
  }
  for (const waterfall of level.waterfalls) {
    if (!ids.has(waterfall.islandId)) {
      throw new Error(
        `Level "${level.id}" waterfall references unknown island "${waterfall.islandId}"`,
      )
    }
    if (!(waterfall.width > 0)) {
      throw new Error(`Waterfall on "${waterfall.islandId}" must have width > 0`)
    }
    if (!(waterfall.length > 0)) {
      throw new Error(`Waterfall on "${waterfall.islandId}" must have length > 0`)
    }
  }

  // Uses the multiplier derived from the island shaping constants rather than a
  // literal, so the bound cannot understate the geometry that produces it. A
  // floor above an island's lower spike passes a looser check and then lets the
  // player fall straight through that spike into the void.
  const lowest = Math.min(
    ...level.islands.map((i) => i.position.y - i.height * MAX_DEPTH_MULTIPLIER),
  )
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
