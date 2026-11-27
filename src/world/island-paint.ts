import { BufferAttribute, Color, Vector3, type BufferGeometry } from 'three'
import { mulberry32, seededNoise2D } from '../core/rng'
import type { Biome } from './island'

export interface BiomePalette {
  top: number
  cliff: number
  under: number
}

export const BIOME_PALETTES: Record<Biome, BiomePalette> = {
  grass: { top: 0x7fa85c, cliff: 0x8a7f6d, under: 0x6b5d4f },
  rock: { top: 0x9a9484, cliff: 0x8a8579, under: 0x6e675c },
  temple: { top: 0xcbb98f, cliff: 0xa89878, under: 0x7e7260 },
}

/** Faces steeper than this (by normal y) are cliff, not walkable top. */
const TOP_SLOPE = 0.65

/**
 * Whether a face is walkable top rather than cliff or underside. Exported so `grass.ts` plants
 * blades on exactly the faces painted as top — grass on a cliff painted rock colour would be the
 * one place the two disagreed.
 */
export function isTopFace(normalY: number, centroidY: number): boolean {
  return normalY > TOP_SLOPE && centroidY > 0
}
/** Faces whose centroid sits below this fraction of min.y are underside. */
const UNDER_FRACTION = 0.4
/** Per-face lightness jitter, so facets vary instead of reading as one sheet. */
export const JITTER = 0.04

/**
 * Broad patches of lighter and darker ground, the way a real meadow is never one even green:
 * wetter hollows, drier rises, thinner soil over rock. Without them an island top read as a single
 * flat sheet of colour from any distance, and per-face jitter cannot fix that — it varies faces
 * independently, so it averages back out to the same sheet as soon as the faces are small on
 * screen.
 *
 * `PATCH_SIZE` is the noise's wavelength in metres, about a tree's spacing times four, so a patch
 * is large enough to read from the follow camera and small enough that every island has several.
 * `PATCH_DEPTH` is the most a patch moves lightness either way, as a fraction.
 */
const PATCH_SIZE = 28
export const PATCH_DEPTH = 0.12

/**
 * Horizontal strata on exposed rock: the cliffs and the island's underside.
 *
 * Bare rock in the real world is layered -- sediment laid down flat, then cut through -- and a
 * cliff face is read as rock largely by those bands. Without them every cliff was one even grey,
 * which at the scale of an island's flank reads as plaster. The bands run with height, wobble
 * with the patch noise so no two cliffs share the same lines, and are left off the walkable top,
 * which is soil and grass rather than exposed stone.
 *
 * `STRATA_SPACING` is the band's wavelength in metres; `STRATA_DEPTH` the most a band moves
 * lightness either way.
 *
 * 9 m, because the colour is per face and an island's cliff faces are six to eight metres tall:
 * 3.6 m bands were finer than the faces sampling them and came out as random shading rather than
 * layers. At 9 m neighbouring faces at one height agree, and the bands read.
 */
const STRATA_SPACING = 9
export const STRATA_DEPTH = 0.12

/**
 * Paint a non-indexed island geometry with per-face colors zoned by slope and
 * height: walkable top, cliff sides, and a darker underside. Deterministic for
 * a given seed.
 *
 * **The palette is converted to linear light before it is written.** A vertex colour attribute is
 * read as linear by the renderer, and this function used to write the hex's raw sRGB bytes into
 * it, so every island rendered paler and greyer than its own palette — 0x7fa85c, a mid grass
 * green, arrived on screen as a washed sage. `props.ts` has always gone through `Color`, which
 * converts, so a boulder and the cliff behind it, both painted `palette.cliff`, were two
 * different colours.
 */
export function paintIsland(geometry: BufferGeometry, biome: Biome, seed: number): void {
  if (geometry.index) throw new Error('paintIsland requires non-indexed geometry')
  const position = geometry.attributes.position
  if (!position) throw new Error('paintIsland requires a position attribute')
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const minY = geometry.boundingBox!.min.y

  const palette = BIOME_PALETTES[biome]
  const rng = mulberry32(seed)
  // A separate stream from the jitter's, so adding patches left every face's jitter unchanged.
  const patches = seededNoise2D(seed ^ 0x5bd1e995)
  const base = new Color()
  const colors = new Float32Array(position.count * 3)
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const edge1 = new Vector3()
  const edge2 = new Vector3()

  for (let f = 0; f < position.count / 3; f++) {
    a.fromBufferAttribute(position, f * 3)
    b.fromBufferAttribute(position, f * 3 + 1)
    c.fromBufferAttribute(position, f * 3 + 2)
    const normalY = edge1.subVectors(b, a).cross(edge2.subVectors(c, a)).normalize().y
    const centroidY = (a.y + b.y + c.y) / 3

    const zone =
      centroidY < minY * UNDER_FRACTION ? palette.under
      : isTopFace(normalY, centroidY) ? palette.top
      : palette.cliff

    const jitter = 1 + (rng() * 2 - 1) * JITTER
    const field = patches(
      (a.x + b.x + c.x) / 3 / PATCH_SIZE, (a.z + b.z + c.z) / 3 / PATCH_SIZE,
    )
    const patch = 1 + field * PATCH_DEPTH
    const strata = zone === palette.top
      ? 1
      : 1 + Math.sin((centroidY / STRATA_SPACING + field * 0.8) * Math.PI * 2) * STRATA_DEPTH
    base.setHex(zone)
    const shade = jitter * patch * strata
    const r = Math.min(base.r * shade, 1)
    const g = Math.min(base.g * shade, 1)
    const bl = Math.min(base.b * shade, 1)
    for (let vtx = 0; vtx < 3; vtx++) {
      colors[(f * 3 + vtx) * 3] = r
      colors[(f * 3 + vtx) * 3 + 1] = g
      colors[(f * 3 + vtx) * 3 + 2] = bl
    }
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
}
