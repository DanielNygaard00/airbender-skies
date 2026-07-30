import { Vector3 } from 'three'
import type { TerrainQuery } from '../core/types'
import type { Level } from './level'

export interface Shrine {
  id: string
  position: Vector3
  collected: boolean
}

/** How close the player must be to collect a shrine. */
export const COLLECT_RADIUS = 6
/** How far above the surface a shrine floats. */
const HOVER_HEIGHT = 1.5

/** Place shrines on their island's surface, dropping any that miss the ground. */
export function placeShrines(
  level: Level, terrain: TerrainQuery, collected: readonly string[],
): Shrine[] {
  const already = new Set(collected)
  const shrines: Shrine[] = []

  for (const def of level.shrines) {
    const island = level.islands.find((i) => i.id === def.islandId)
    if (!island) continue
    const x = island.position.x + def.offset.x
    const z = island.position.z + def.offset.z
    const groundY = terrain.groundHeightAt(x, z)
    // A shrine with no ground under it would be unreachable, so drop it.
    if (groundY === null) continue
    shrines.push({
      id: def.islandId,
      position: new Vector3(x, groundY + HOVER_HEIGHT, z),
      collected: already.has(def.islandId),
    })
  }
  return shrines
}

/** Ids newly collected this frame. Empty when nothing is in range. */
export function collectShrinesAt(shrines: readonly Shrine[], position: Vector3): string[] {
  return shrines
    .filter((s) => !s.collected && s.position.distanceTo(position) <= COLLECT_RADIUS)
    .map((s) => s.id)
}
