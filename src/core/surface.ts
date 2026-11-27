import {
  Material, MeshStandardMaterial, ShaderChunk, type MeshStandardMaterialParameters,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { SUN_DIRECTION } from './sun'
import { CLOUD_COVER, CLOUD_DRIFT, CLOUD_NOISE_GLSL } from './weather'

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
  return applyCloudShadows(new MeshStandardMaterial({ ...params, ...SURFACES[kind] }))
}

type ShaderPatch = (shader: WebGLProgramParametersWithUniforms) => void

/**
 * Add a shader patch to a material without displacing the ones it already has.
 *
 * `onBeforeCompile` is a single slot, and three surfaces patch it independently: every surface
 * here gets cloud shadows, the prop mesh adds wind sway on top, the grass adds its own blade
 * projection. Assigning the slot would silently drop whichever patch came first, with nothing
 * failing -- the clouds' shadows would just stop falling on trees. So patches are chained, run in
 * the order they were added, and the program cache key names every one of them: three reuses a
 * compiled program for any material whose key matches, so two materials with different patch
 * sets must never share a key.
 */
export function addShaderPatch<T extends Material>(material: T, key: string, patch: ShaderPatch): T {
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey === Material.prototype.customProgramCacheKey
    ? null
    : material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    patch(shader)
  }
  material.customProgramCacheKey = () => (previousKey ? `${previousKey()}|${key}` : key)
  return material
}

/**
 * How much of the sun's direct light a cloud overhead takes away.
 *
 * Not all of it: under a real cumulus the ground still gets the whole sky's light, which here is
 * the environment map, and only the direct beam is blocked. Blocking the direct light alone is
 * also why shade already cast by a tree is left as it is: there is no beam left to lose.
 *
 * 0.7, from 0.55, measured on the bench: with the sky still filling the shade, 0.55 dimmed the
 * ground under a cloud by about 14%, which read as a passing haze rather than a shadow.
 */
export const CLOUD_SHADOW_DEPTH = 0.7
/**
 * Metres of ground per cloud-noise unit.
 *
 * 70, from 120: at 120 one shadow covered most of an island and read as the whole island dimming
 * rather than as a cloud passing over it. At 70 an island carries several shadows at once, with
 * sunlit ground between them, and the eye can follow one as it moves.
 */
export const CLOUD_SHADOW_SCALE = 70
/** Height of the cloud layer the shadows are cast from, in metres. */
const CLOUD_ALTITUDE = 400

const CLOUD_SHADOW_PARS = /* glsl */ `
  uniform vec2 cloudDrift;
  ${CLOUD_NOISE_GLSL}
`

// The fragment's world position, from the view-space position every lit material already carries:
// the view matrix is a rotation R plus a translation t, so world = R^T (view - t), and multiplying
// a vector on the left of a mat3 is multiplying by its transpose. Then up the sun's direction to
// the cloud layer, and sample the cloud there.
const CLOUD_SHADE = /* glsl */ `
  float cloudShade = 1.0;
  {
    vec3 cloudWorld = (-vViewPosition - viewMatrix[3].xyz) * mat3(viewMatrix);
    vec2 cloudAt = (cloudWorld.xz + vec2(${(SUN_DIRECTION.x / SUN_DIRECTION.y).toFixed(4)},
      ${(SUN_DIRECTION.z / SUN_DIRECTION.y).toFixed(4)}) * (${CLOUD_ALTITUDE.toFixed(1)} - cloudWorld.y))
      / ${CLOUD_SHADOW_SCALE.toFixed(1)} - cloudDrift;
    // A narrower edge than the sky's coverage ramp: seen from above, a cumulus shadow has a
    // fairly definite edge, and a wide ramp turns every shadow into a vague dimming.
    float cloudCover = smoothstep(${CLOUD_COVER[0].toFixed(2)}, ${(CLOUD_COVER[0] + 0.12).toFixed(2)},
      cloudFbmSoft(cloudAt + vec2(3.7, 1.9)));
    cloudShade = 1.0 - ${CLOUD_SHADOW_DEPTH.toFixed(2)} * cloudCover;
  }
`

// Only the sun: it is the one directional light, and the only light a cloud can stand in front of.
const SHADED_LIGHTS = CLOUD_SHADE + ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= cloudShade;',
)

/**
 * Let the drifting clouds' shadows cross a surface.
 *
 * Applied by `createSurface` to every lit surface in the game, so the islands, the props, the
 * grass, the soldiers and the rider all darken together as a cloud passes -- a shadow that fell on
 * the ground but not on the character standing in it would look like a texture rather than
 * weather. The shared `CLOUD_DRIFT` uniform moves every one of them at once.
 */
export function applyCloudShadows<T extends Material>(material: T): T {
  return addShaderPatch(material, 'cloud-shadow', (shader) => {
    shader.uniforms['cloudDrift'] = CLOUD_DRIFT
    shader.fragmentShader = CLOUD_SHADOW_PARS + shader.fragmentShader
      .replace('#include <lights_fragment_begin>', SHADED_LIGHTS)
  })
}

if (!SHADED_LIGHTS.includes('directLight.color *= cloudShade')) {
  // three's light loop changed shape and the splice found nothing to attach to. Fail loudly at
  // load, where a test sees it, rather than shipping clouds that quietly cast no shadow.
  throw new Error('surface.ts: three\'s lights_fragment_begin no longer matches the cloud splice')
}
