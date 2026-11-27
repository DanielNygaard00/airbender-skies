import { MeshStandardMaterial, type MeshStandardMaterialParameters } from 'three'

/**
 * What a surface is made of, as the two numbers a physically based material needs.
 *
 * **Why the world moved off `MeshLambertMaterial`.** Lambert is diffuse and nothing else: a rock,
 * a wet net, a steel plate and a canvas wing all scatter light the same way, and only their colour
 * tells them apart. A physically based material adds what the eye actually uses to read material
 * at a distance — how sharply a surface reflects the sun, and how much brighter it gets at a
 * grazing angle (Fresnel). Paired with the sky environment from `environment.ts`, it also lets a
 * shaded face pick up the blue of the sky above it and a downward face the green of the ground,
 * instead of every unlit face being the same flat fill.
 *
 * **Named kinds rather than numbers at each call site**, so "wood" means one thing across the
 * staff, the bow, the spear shaft and the arrow, and retuning it is one edit. A
 * `Record<SurfaceKind, …>` so a new kind fails to compile until it has both numbers.
 *
 * **Almost everything is rough.** The art is flat-shaded and low-poly, and a glossy facet flashes
 * the full sun across a whole triangle at once, which reads as plastic, not as polish. The
 * roughness values sit high enough that the sun's highlight spreads into a soft sheen; only metal
 * and the air-bender's translucent board are allowed a visible highlight.
 */
export type SurfaceKind =
  | 'ground' | 'stone' | 'foliage' | 'wood' | 'fabric' | 'painted' | 'metal' | 'glass'

export interface SurfaceFinish {
  roughness: number
  metalness: number
}

export const SURFACES: Record<SurfaceKind, SurfaceFinish> = {
  /** Terrain and island cliffs: soil, grass and weathered rock seen from far away. */
  ground: { roughness: 0.95, metalness: 0 },
  /** Boulders, earth-bent rocks and pillars: rough, with the faintest sheen at grazing angles. */
  stone: { roughness: 0.85, metalness: 0 },
  /** Merged prop meshes carry trees and rocks together, so this sits between the two. */
  foliage: { roughness: 0.88, metalness: 0 },
  /** Staffs, bows, shafts: worked wood with a little polish from handling. */
  wood: { roughness: 0.7, metalness: 0 },
  /** Cloth, sailcloth, rope and nets. */
  fabric: { roughness: 0.92, metalness: 0 },
  /**
   * The character pack's hand-painted textures. Their shading is baked into the map, so a strong
   * highlight on top would double-light them; rough enough that the sun only lifts them.
   */
  painted: { roughness: 0.8, metalness: 0 },
  /**
   * Armour plate. Not fully metallic: a pure metal takes its whole colour from the environment,
   * and a sky-only environment would turn the plate a flat blue-grey on every face.
   */
  metal: { roughness: 0.42, metalness: 0.65 },
  /** The air board: translucent, smooth, catches the sun as it banks. */
  glass: { roughness: 0.3, metalness: 0 },
}

/** Every material parameter except the two the kind decides. */
export type SurfaceParameters = Omit<MeshStandardMaterialParameters, 'roughness' | 'metalness'>

export function createSurface(kind: SurfaceKind, params: SurfaceParameters = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({ ...params, ...SURFACES[kind] })
}
