import { Vector3 } from 'three'
import { mulberry32 } from '../core/rng'
import type { TerrainQuery, TerrainHit } from '../core/types'
import type { IslandDef } from './island'

export interface PropPlacement {
  kind: 'tree' | 'boulder' | 'pillar' | 'arch'
  position: Vector3
  scale: number
  rotationY: number
}

/** Props scatter inside this fraction of the island radius. */
const DISC_FRACTION = 0.75
/** No prop closer than this (in xz) to a shrine. */
const SHRINE_CLEARANCE = 8
/** Ground steeper than this (by normal y) rejects a prop. */
const MIN_GROUND_NORMAL_Y = 0.7
/** Rejection sampling gives up after this many tries per wanted prop. */
const ATTEMPTS_PER_PROP = 10
const TREE_RADIUS_DIVISOR = 6
const BOULDER_RADIUS_DIVISOR = 9
const PILLAR_COUNT = 5
const PILLAR_RING_RADIUS = 10
const ARCH_DISTANCE = 16

/**
 * Deterministic decorative prop placements for one island. Purely visual —
 * callers must never feed the resulting meshes into the terrain query.
 */
export function propPlacements(
  def: IslandDef,
  terrain: TerrainQuery,
  shrineOffsets: readonly Vector3[],
): PropPlacement[] {
  // +1 keeps the prop stream independent of the geometry noise stream.
  const rng = mulberry32(def.noiseSeed + 1)
  const shrines = shrineOffsets.map((o) => new Vector3().addVectors(def.position, o))
  const placements: PropPlacement[] = []

  const groundAt = (x: number, z: number): TerrainHit | null => {
    const probeY = def.position.y + def.height + 50
    const hit = terrain.raycastDown(new Vector3(x, probeY, z), def.height * 3 + 100)
    if (!hit || hit.normal.y < MIN_GROUND_NORMAL_Y) return null
    return hit
  }

  const nearShrine = (x: number, z: number): boolean =>
    shrines.some((s) => Math.hypot(s.x - x, s.z - z) < SHRINE_CLEARANCE)

  const scatter = (kind: PropPlacement['kind'], wanted: number): void => {
    let placed = 0
    let attempts = 0
    while (placed < wanted && attempts < wanted * ATTEMPTS_PER_PROP) {
      attempts++
      // All draws happen every attempt, so rejections never shift the stream.
      const angle = rng() * Math.PI * 2
      const r = Math.sqrt(rng()) * def.radius * DISC_FRACTION
      const scale = 0.8 + rng() * 0.6
      const rotationY = rng() * Math.PI * 2
      const x = def.position.x + Math.cos(angle) * r
      const z = def.position.z + Math.sin(angle) * r
      const hit = groundAt(x, z)
      if (!hit || nearShrine(x, z)) continue
      placements.push({ kind, position: hit.point.clone(), scale, rotationY })
      placed++
    }
  }

  if (def.biome === 'grass') scatter('tree', Math.round(def.radius / TREE_RADIUS_DIVISOR))
  scatter('boulder', Math.round(def.radius / BOULDER_RADIUS_DIVISOR))

  if (def.biome === 'temple') {
    for (let i = 0; i < PILLAR_COUNT; i++) {
      const angle = (i / PILLAR_COUNT) * Math.PI * 2
      const x = def.position.x + Math.cos(angle) * PILLAR_RING_RADIUS
      const z = def.position.z + Math.sin(angle) * PILLAR_RING_RADIUS
      const hit = groundAt(x, z)
      if (!hit || nearShrine(x, z)) continue
      placements.push({
        kind: 'pillar', position: hit.point.clone(), scale: 1,
        rotationY: angle + Math.PI / 2,
      })
    }
    const x = def.position.x + ARCH_DISTANCE
    const z = def.position.z
    const hit = groundAt(x, z)
    if (hit && !nearShrine(x, z)) {
      placements.push({
        kind: 'arch', position: hit.point.clone(), scale: 1, rotationY: Math.PI / 2,
      })
    }
  }

  return placements
}
