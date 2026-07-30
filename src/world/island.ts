import { IcosahedronGeometry, BufferGeometry, Vector3 } from 'three'
import { seededNoise2D } from '../core/rng'

export type Biome = 'grass' | 'rock' | 'temple'

export interface IslandDef {
  id: string
  position: Vector3
  radius: number
  height: number
  biome: Biome
  noiseSeed: number
}

/** How strongly noise displaces the silhouette, and how the shape is squashed. */
export const ROUGHNESS = 0.28
const NOISE_FREQUENCY = 1.6
const TOP_FLATTEN = 0.35
export const BOTTOM_STRETCH = 1.9
const DETAIL = 4

/**
 * How far below its position an island can reach, as a multiple of its height.
 *
 * Derived rather than measured or guessed, because level validation depends on
 * it and a hardcoded number would drift away from the geometry the moment the
 * shaping constants change. Noise displaces a vertex before the vertical squash
 * applies, so the lowest a unit-sphere vertex can go is (1 + ROUGHNESS) and the
 * stretch then scales that by BOTTOM_STRETCH.
 */
export const MAX_DEPTH_MULTIPLIER = BOTTOM_STRETCH * (1 + ROUGHNESS)

/**
 * A floating island: a noise-displaced sphere squashed flat on top so it is
 * walkable, and stretched into a spike below so it reads as torn from the ground.
 * Deterministic — the same noiseSeed always produces identical geometry.
 *
 * An icosphere is used rather than a heightmap because a heightmap cannot
 * express the underside and overhangs a floating island needs.
 */
export function createIslandGeometry(def: IslandDef): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, DETAIL)
  const position = geometry.attributes.position
  if (!position) throw new Error('IcosahedronGeometry produced no position attribute')
  const noise = seededNoise2D(def.noiseSeed)
  const v = new Vector3()

  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
    const displacement = 1 + noise(v.x * NOISE_FREQUENCY, v.z * NOISE_FREQUENCY) * ROUGHNESS
    v.multiplyScalar(displacement)
    v.y *= v.y > 0 ? TOP_FLATTEN : BOTTOM_STRETCH
    v.x *= def.radius
    v.z *= def.radius
    v.y *= def.height
    position.setXYZ(i, v.x, v.y, v.z)
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
