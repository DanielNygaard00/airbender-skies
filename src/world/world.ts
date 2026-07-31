import { Group, Mesh, MeshLambertMaterial, type BufferGeometry } from 'three'
import type { TerrainQuery } from '../core/types'
import { createIslandGeometry } from './island'
import { paintIsland } from './island-paint'
import { buildProps } from './props'
import { createTerrainQuery, type IslandMesh } from './terrain-query'
import { validateLevel, type Level } from './level'

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
    paintIsland(geometry, def.biome, def.noiseSeed)
    const material = new MeshLambertMaterial({ vertexColors: true })
    const mesh = new Mesh(geometry, material)
    mesh.position.copy(def.position)
    mesh.updateMatrixWorld(true)
    group.add(mesh)
    islands.push({ id: def.id, mesh })
  }

  const terrain = createTerrainQuery(islands)

  for (const def of level.islands) {
    const offsets = level.shrines
      .filter((s) => s.islandId === def.id)
      .map((s) => s.offset)
    const props = buildProps(def, terrain, offsets)
    if (props) group.add(props)
  }

  return { islands, terrain, group }
}
