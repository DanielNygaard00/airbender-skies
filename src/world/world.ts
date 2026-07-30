import { Group, Mesh, MeshLambertMaterial, Color, type BufferGeometry } from 'three'
import type { TerrainQuery } from '../core/types'
import { createIslandGeometry, type Biome } from './island'
import { createTerrainQuery, type IslandMesh } from './terrain-query'
import { validateLevel, type Level } from './level'

const BIOME_COLOURS: Record<Biome, number> = {
  grass: 0x7fa85c,
  rock: 0x8a8579,
  temple: 0xb9a67f,
}

export interface World {
  islands: IslandMesh[]
  terrain: TerrainQuery
  group: Group
}

/** Validate, generate geometry, and assemble the scene graph for a level. */
export function buildWorld(level: Level): World {
  validateLevel(level)

  const group = new Group()
  const islands: IslandMesh[] = []

  for (const def of level.islands) {
    const geometry: BufferGeometry = createIslandGeometry(def)
    const material = new MeshLambertMaterial({ color: new Color(BIOME_COLOURS[def.biome]) })
    const mesh = new Mesh(geometry, material)
    mesh.position.copy(def.position)
    mesh.updateMatrixWorld(true)
    group.add(mesh)
    islands.push({ id: def.id, mesh })
  }

  return { islands, terrain: createTerrainQuery(islands), group }
}
