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
/**
 * How far this island's surface sits from its centre along a unit direction, before the halves are
 * flattened or stretched and before the world scale goes on.
 *
 * One definition, used by the geometry builder below and by `insideIsland`. They were separate for
 * a moment while `insideIsland` was written and that was the wrong shape immediately: a containment
 * test that reproduces the displacement maths is a second copy that has to be kept in step with
 * this one, which is exactly the drift that let a wind-visibility test measure a scatter the game
 * no longer drew.
 */
function shellRadius(unit: Vector3, noise: (x: number, z: number) => number): number {
  let n = 0
  for (const { frequency, amplitude } of OCTAVES) {
    n += noise(unit.x * frequency, unit.z * frequency) * amplitude
  }
  // The walkable crown keeps less roughness than the ragged underside.
  return 1 + n * (1 - TOP_DAMPENING * Math.max(unit.y, 0))
}

export function createIslandGeometry(def: IslandDef): BufferGeometry {
  const sphere = new IcosahedronGeometry(1, DETAIL)
  const position = sphere.attributes.position
  if (!position) throw new Error('IcosahedronGeometry produced no position attribute')
  const noise = seededNoise2D(def.noiseSeed)
  const v = new Vector3()

  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
    v.multiplyScalar(shellRadius(v, noise))
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

/**
 * Whether a world point lies inside an island's shell.
 *
 * Analytic rather than a raycast, and it exists because the obvious test is wrong in this world.
 * `groundHeightAt(x, z) > y` reads as "underground", which holds for terrain you cannot get
 * beneath — and every island here floats, so the air *under* one satisfies it too. Using that as
 * an open-air test collapsed two of the archipelago's eight wind tells to a stub: a thermal 320
 * units up and a dead-air pocket 150 below the islands were both classified as solid rock.
 *
 * Undoing `createIslandGeometry`'s transform — the world scale, then the flatten or stretch on
 * whichever half the point is in — puts the point back in unit-sphere space, where `shellRadius`
 * answers where this island's own surface is along that direction. So this asks the island's real
 * noise rather than a bound on it.
 *
 * Bounds were tried first, both ways round, and neither was good enough. Counting the whole
 * `1 ± ROUGHNESS` band as rock collapsed the archipelago's high thermal and its under-island dead
 * air to stubs, because both sit legitimately inside a large island's ragged envelope. Counting
 * only the inner bound fixed that and left Canyon Country's hoodoos clamping at 58 per cent of
 * their nominal shell, so motes stayed buried in the outer noise. The exact query has neither
 * problem, and it costs three octaves of 2D noise.
 *
 * The one approximation left: the noise is sampled along the *displaced* direction rather than the
 * original undisplaced one, since inverting the displacement exactly is not worth it for a mote
 * cloud. That is a second-order error well inside one mote's width.
 */
export function insideIsland(
  x: number, y: number, z: number, def: IslandDef,
  noise: (nx: number, nz: number) => number = seededNoise2D(def.noiseSeed),
): boolean {
  const dx = (x - def.position.x) / def.radius
  const dz = (z - def.position.z) / def.radius
  const rawY = y - def.position.y
  const dy = rawY >= 0
    ? rawY / (def.height * TOP_FLATTEN)
    : rawY / (def.height * BOTTOM_STRETCH)
  const q = Math.hypot(dx, dy, dz)
  // Dead centre: inside by definition, and there is no direction to sample.
  if (q < 1e-9) return true
  SCRATCH_UNIT.set(dx / q, dy / q, dz / q)
  return q < shellRadius(SCRATCH_UNIT, noise)
}

/** Reused, because `openAirTest` runs this per probe and per island. */
const SCRATCH_UNIT = new Vector3()

/**
 * An open-air test over a whole level, for `createWindTell`.
 *
 * One definition so the game and the tests that measure it cannot drift — the wind-visibility
 * measurement in `canyon-country.test.ts` and the tells `main.ts` builds ask exactly the same
 * question. That duplication is a mistake this file's neighbours have already made once.
 */
export function openAirTest(
  islands: readonly IslandDef[],
): (x: number, y: number, z: number) => boolean {
  // Noise functions built once per island rather than per probe: `seededNoise2D` allocates a
  // permutation table, and this is called dozens of times per wind feature at load.
  const shells = islands.map((def) => ({ def, noise: seededNoise2D(def.noiseSeed) }))
  return (x, y, z) => !shells.some(({ def, noise }) => insideIsland(x, y, z, def, noise))
}
