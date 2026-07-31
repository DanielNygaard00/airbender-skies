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

/** Noise octaves: large silhouette, ledge masses, small rock detail. */
const OCTAVES = [
  { frequency: 1.6, amplitude: 0.28 },
  { frequency: 3.5, amplitude: 0.1 },
  { frequency: 8.0, amplitude: 0.04 },
] as const

/** Summed octave amplitude: how strongly noise can displace the silhouette. */
export const ROUGHNESS = OCTAVES.reduce((sum, o) => sum + o.amplitude, 0)
const TOP_FLATTEN = 0.35
export const BOTTOM_STRETCH = 1.9
/** How much of the roughness is removed at the top pole, keeping the crown walkable. */
const TOP_DAMPENING = 0.55
const DETAIL = 4

/**
 * How far below its position an island can reach, as a multiple of its height.
 *
 * Derived rather than measured or guessed, because level validation depends on
 * it and a hardcoded number would drift away from the geometry the moment the
 * shaping constants change. Noise displaces a vertex before the vertical squash
 * applies, dampening never applies below the equator, so the lowest a
 * unit-sphere vertex can go is (1 + ROUGHNESS) and the stretch then scales
 * that by BOTTOM_STRETCH.
 */
export const MAX_DEPTH_MULTIPLIER = BOTTOM_STRETCH * (1 + ROUGHNESS)

/**
 * A floating island: a noise-displaced sphere squashed flat on top so it is
 * walkable, and stretched into a spike below so it reads as torn from the ground.
 * Deterministic — the same noiseSeed always produces identical geometry.
 *
 * An icosphere is used rather than a heightmap because a heightmap cannot
 * express the underside and overhangs a floating island needs. The geometry
 * is non-indexed (IcosahedronGeometry ships that way), so each face has its
 * own vertices: computeVertexNormals then gives per-face flat normals, and
 * the painter can give each face its own color.
 */
export function createIslandGeometry(def: IslandDef): BufferGeometry {
  const sphere = new IcosahedronGeometry(1, DETAIL)
  const position = sphere.attributes.position
  if (!position) throw new Error('IcosahedronGeometry produced no position attribute')
  const noise = seededNoise2D(def.noiseSeed)
  const v = new Vector3()

  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
    let n = 0
    for (const { frequency, amplitude } of OCTAVES) {
      n += noise(v.x * frequency, v.z * frequency) * amplitude
    }
    // The walkable crown keeps less roughness than the ragged underside.
    const dampening = 1 - TOP_DAMPENING * Math.max(v.y, 0)
    v.multiplyScalar(1 + n * dampening)
    v.y *= v.y > 0 ? TOP_FLATTEN : BOTTOM_STRETCH
    v.x *= def.radius
    v.z *= def.radius
    v.y *= def.height
    position.setXYZ(i, v.x, v.y, v.z)
  }
  position.needsUpdate = true
  sphere.computeVertexNormals()
  sphere.computeBoundingBox()
  sphere.computeBoundingSphere()
  return sphere
}
