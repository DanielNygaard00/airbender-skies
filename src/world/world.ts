import { Group, Mesh, type BufferGeometry, type Vector3 } from 'three'
import { createCloudSea, type CloudSea } from './cloud-sea'
import { createSurface } from '../core/surface'
import type { TerrainQuery } from '../core/types'
import { createIslandGeometry } from './island'
import { paintIsland } from './island-paint'
import { buildProps } from './props'
import { createGrassField, scatterTufts, type GrassField, type Tuft } from './grass'
import { createTerrainQuery, type IslandMesh } from './terrain-query'
import { validateLevel, type Level } from './level'

export interface World {
  islands: IslandMesh[]
  terrain: TerrainQuery
  group: Group
  /** Blades on the grass islands' tops; also a child of `group`. See `grass.ts`. */
  grass: GrassField
  /** The cloud deck at the world floor; also a child of `group`. See `cloud-sea.ts`. */
  cloudSea: CloudSea
  /** Everything in the world that depends on where the camera is. Once a frame, before drawing. */
  updateView(camera: Vector3): void
}

/** Validate, generate geometry, and assemble the scene graph for a level. */
export function buildWorld(level: Level): World {
  validateLevel(level)

  const group = new Group()
  const islands: IslandMesh[] = []
  const tufts: Tuft[] = []

  for (const def of level.islands) {
    const geometry: BufferGeometry = createIslandGeometry(def)
    paintIsland(geometry, def.biome, def.noiseSeed)
    // Grass only where the ground is grass: temple sand and bare rock stay bare. +2 keeps the
    // grass's stream independent of the geometry's (+0) and the props' (+1).
    // A loop rather than a spread: a large island grows tens of thousands of tufts, past the
    // argument count a spread into `push` can safely pass.
    if (def.biome === 'grass') {
      for (const tuft of scatterTufts(geometry, def.position, def.noiseSeed + 2)) tufts.push(tuft)
    }
    const material = createSurface('ground', { vertexColors: true })
    const mesh = new Mesh(geometry, material)
    mesh.position.copy(def.position)
    mesh.updateMatrixWorld(true)
    group.add(mesh)
    islands.push({ id: def.id, mesh })
  }

  const terrain = createTerrainQuery(islands)

  for (const def of level.islands) {
    // Shrines and payloads both, because both are things the player has to be able to walk
    // up to: a payload inside a boulder is a proximity interaction with no way in.
    const offsets = [
      ...level.shrines.filter((s) => s.islandId === def.id).map((s) => s.offset),
      ...(level.payloads ?? []).filter((p) => p.islandId === def.id).map((p) => p.offset),
    ]
    const props = buildProps(def, terrain, offsets)
    if (props) group.add(props)
  }

  const grass = createGrassField(tufts, level.islands.length)
  group.add(grass.group)
  const cloudSea = createCloudSea(level.worldFloorY)
  group.add(cloudSea.mesh)

  return {
    islands, terrain, group, grass, cloudSea,
    updateView(camera: Vector3): void {
      grass.update(camera)
      cloudSea.update(camera)
    },
  }
}
