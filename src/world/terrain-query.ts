import { Raycaster, Vector3, Mesh } from 'three'
import type { TerrainQuery, TerrainHit } from '../core/types'

const DOWN = new Vector3(0, -1, 0)
/** How far above the tallest island to start a height probe. */
const PROBE_MARGIN = 200

export interface IslandMesh {
  id: string
  mesh: Mesh
}

/**
 * The single channel through which movement code asks about the ground.
 * One shared Raycaster is reused rather than allocated per query, because this
 * runs every frame.
 */
export function createTerrainQuery(islands: readonly IslandMesh[]): TerrainQuery {
  const raycaster = new Raycaster()
  const meshes = islands.map((i) => i.mesh)
  const idByMesh = new Map<Mesh, string>(islands.map((i) => [i.mesh, i.id]))

  // Probe from above everything, so groundHeightAt finds the highest surface.
  let probeHeight = PROBE_MARGIN
  for (const { mesh } of islands) {
    mesh.updateMatrixWorld(true)
    const sphere = mesh.geometry.boundingSphere
    if (sphere) {
      probeHeight = Math.max(probeHeight, mesh.position.y + sphere.radius + PROBE_MARGIN)
    }
  }

  function raycastDown(from: Vector3, maxDistance: number): TerrainHit | null {
    raycaster.set(from, DOWN)
    raycaster.near = 0
    raycaster.far = maxDistance
    const hit = raycaster.intersectObjects(meshes, false)[0]
    if (!hit) return null
    return {
      point: hit.point.clone(),
      normal: hit.normal ? hit.normal.clone() : new Vector3(0, 1, 0),
      islandId: idByMesh.get(hit.object as Mesh) ?? 'unknown',
    }
  }

  return {
    raycastDown,
    groundHeightAt(x: number, z: number): number | null {
      const hit = raycastDown(new Vector3(x, probeHeight, z), probeHeight * 2 + PROBE_MARGIN)
      return hit ? hit.point.y : null
    },
  }
}
