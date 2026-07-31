import {
  BoxGeometry, BufferAttribute, Color, ConeGeometry, CylinderGeometry,
  IcosahedronGeometry, Matrix4, Mesh, MeshLambertMaterial, Quaternion, Vector3,
  type BufferGeometry,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../core/rng'
import type { TerrainQuery, TerrainHit } from '../core/types'
import type { IslandDef } from './island'
import { BIOME_PALETTES } from './island-paint'

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

const TREE_GREENS = [0x4f7a3a, 0x5d8a44, 0x6a9a50] as const
const TRUNK_BROWN = 0x6b4f35

/** Flat-shade and fill a primitive with one color, ready for merging. */
function colored(source: BufferGeometry, hex: number): BufferGeometry {
  // Cylinders, cones, and boxes are indexed; icosahedra already are not.
  // Calling toNonIndexed on a non-indexed geometry logs a warning and
  // returns the same object, so guard on the index.
  const geometry = source.index ? source.toNonIndexed() : source
  if (geometry !== source) source.dispose()
  const color = new Color(hex)
  const count = geometry.attributes.position!.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

function treeParts(variant: number): BufferGeometry[] {
  const green = TREE_GREENS[variant % TREE_GREENS.length]!
  const trunk = colored(new CylinderGeometry(0.35, 0.45, 2.4, 6), TRUNK_BROWN)
  trunk.translate(0, 1.2, 0)
  const lower = colored(new ConeGeometry(2.2, 2.8, 7), green)
  lower.translate(0, 3.4, 0)
  const upper = colored(new ConeGeometry(1.5, 2.2, 7), green)
  upper.translate(0, 5.2, 0)
  return [trunk, lower, upper]
}

function boulderParts(cliffColor: number): BufferGeometry[] {
  const rock = colored(new IcosahedronGeometry(1.3, 0), cliffColor)
  rock.scale(1, 0.7, 1.3)
  rock.translate(0, 0.6, 0)
  return [rock]
}

function pillarParts(top: number, cliff: number): BufferGeometry[] {
  const shaft = colored(new CylinderGeometry(0.7, 0.8, 7, 6), top)
  shaft.translate(0, 3.5, 0)
  const cap = colored(new BoxGeometry(2.2, 0.8, 2.2), cliff)
  cap.translate(0, 7.4, 0)
  return [shaft, cap]
}

function archParts(top: number, cliff: number): BufferGeometry[] {
  const parts: BufferGeometry[] = []
  for (const side of [-2.2, 2.2]) {
    for (const part of pillarParts(top, cliff)) {
      part.translate(side, 0, 0)
      parts.push(part)
    }
  }
  const lintel = colored(new BoxGeometry(6.2, 1.1, 1.8), cliff)
  lintel.translate(0, 8.3, 0)
  parts.push(lintel)
  return parts
}

/**
 * Build one merged decorative mesh for an island, or null when nothing was
 * placed. One mesh per island keeps the whole prop layer at one draw call
 * per island. Never add the result to the terrain query.
 */
export function buildProps(
  def: IslandDef,
  terrain: TerrainQuery,
  shrineOffsets: readonly Vector3[],
): Mesh | null {
  const placements = propPlacements(def, terrain, shrineOffsets)
  if (placements.length === 0) return null

  const palette = BIOME_PALETTES[def.biome]
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const merged: BufferGeometry[] = []

  placements.forEach((placement, index) => {
    const parts =
      placement.kind === 'tree' ? treeParts(index)
      : placement.kind === 'boulder' ? boulderParts(palette.cliff)
      : placement.kind === 'pillar' ? pillarParts(palette.top, palette.cliff)
      : archParts(palette.top, palette.cliff)
    quaternion.setFromAxisAngle(up, placement.rotationY)
    matrix.compose(
      placement.position, quaternion,
      new Vector3(placement.scale, placement.scale, placement.scale),
    )
    for (const part of parts) {
      part.applyMatrix4(matrix)
      merged.push(part)
    }
  })

  const geometry = mergeGeometries(merged)
  for (const part of merged) part.dispose()
  if (!geometry) return null
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }))
}
