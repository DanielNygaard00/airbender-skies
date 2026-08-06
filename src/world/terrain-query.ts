import { Raycaster, Vector3, Mesh } from 'three'
import type { TerrainQuery, TerrainHit } from '../core/types'

const DOWN = new Vector3(0, -1, 0)
/** Reused so the hot path allocates nothing to normalise a direction. */
const SCRATCH_DIRECTION = new Vector3()
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

  function raycast(from: Vector3, direction: Vector3, maxDistance: number): TerrainHit | null {
    const lengthSq = direction.lengthSq()
    // Written as the negated form so a NaN direction falls out here rather than being
    // normalised into a NaN ray that silently reports no hit from anywhere.
    if (!(lengthSq > 1e-12)) return null
    // three.js documents Raycaster.direction as required to be normalized. What's actually
    // measured, against this version (0.185.1): Mesh.js's checkIntersection compares `far`
    // against raycaster.ray.origin.distanceTo(hitPoint), a real Euclidean distance, so
    // direction length does not rescale `far` there. The bounding-sphere prefilter one level
    // up (Mesh.js's early-return before checkIntersection runs) is not scale-invariant --
    // it projects onto the direction vector and walks along it by that same vector's
    // length, so an unnormalised direction shifts where it looks -- but it errs permissive,
    // so it has never been observed to reject a hit `far` would have accepted. We normalise
    // rather than depend on either of those unmeasured-in-general internals surviving a
    // three.js upgrade.
    SCRATCH_DIRECTION.copy(direction).divideScalar(Math.sqrt(lengthSq))
    raycaster.set(from, SCRATCH_DIRECTION)
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
    raycast,
    groundHeightAt(x: number, z: number): number | null {
      const hit = raycast(new Vector3(x, probeHeight, z), DOWN, probeHeight * 2 + PROBE_MARGIN)
      return hit ? hit.point.y : null
    },
  }
}

/**
 * A downward cast, which is what most callers want.
 *
 * A free function rather than a second interface method: `raycastDown` is a special case
 * of `raycast`, and putting both on the interface would make every fake owe two methods
 * where one would do.
 */
export function raycastDown(
  terrain: TerrainQuery, from: Vector3, maxDistance: number,
): TerrainHit | null {
  return terrain.raycast(from, DOWN, maxDistance)
}
