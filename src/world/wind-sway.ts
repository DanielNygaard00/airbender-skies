import {
  BufferAttribute, MeshDepthMaterial, RGBADepthPacking, type BufferGeometry, type Material,
} from 'three'
import { addShaderPatch } from '../core/surface'
import { WIND_CLOCK, WIND_DIRECTION } from '../core/weather'

/**
 * Trees that move in the wind.
 *
 * Every tree in the game used to stand perfectly still, and a still tree on an island the player
 * is gliding past in a strong wind is one of the quickest ways a world reads as a model rather
 * than a place. Real foliage never stops: the crown drifts downwind and back on a slow swell, and
 * a quicker flutter rides on top of it.
 *
 * **Done in the vertex shader, on the one merged prop mesh, at no extra draw calls.** Props are
 * merged per island so the whole prop layer costs one draw per island; animating trees as
 * separate objects would undo that. Instead every vertex carries a `sway` weight — zero where a
 * trunk meets the ground, one at the crown's tip, zero throughout on rocks and pillars — and the
 * shader bends each vertex downwind by that weight. The trunk's foot stays planted, the top moves
 * most, and stone never moves.
 *
 * **The phase comes from where the vertex is in the world**, at a wavelength of tens of metres,
 * so neighbouring trees move almost together and trees across an island do not — a gust visibly
 * travelling over the ground rather than the whole forest pumping in step. Because the wavelength
 * is many times a tree's width, the few centimetres between one side of a crown and the other
 * shift the phase by almost nothing, so a tree bends as one piece rather than warping.
 *
 * **The shadow sways with the tree.** A directional light renders its shadow map through the
 * mesh's depth material, which knows nothing about this bend unless it is given the same patch;
 * without it every swaying crown would cast a shadow that stood still beneath it.
 *
 * **One clock for every island.** `WIND_CLOCK`, in `core/weather.ts`, is a single uniform object
 * shared by every patched material, so advancing it is one assignment a frame however many
 * islands there are. Nothing on the FX bench advances it, so the bench's trees stand at phase zero
 * and its photographs stay comparable across commits.
 */

/**
 * How far a crown tip travels downwind at the peak of a gust, in metres at prop scale 1.
 *
 * 0.4 on a tree 6.3 tall. 0.22 was tried first and is closer to a real conifer in a moderate
 * breeze, but from the follow camera it moved a crown by about a pixel and read as nothing at
 * all; this is a world of constant strong wind, which is what the player is flying on.
 */
export const SWAY_AMPLITUDE = 0.4

/**
 * Add a `sway` weight to every vertex of a part.
 *
 * `top` is the part's height above its own base in which the weight runs from 0 to 1; pass 0 for
 * a part that must never move. The weight rises with the square of height, which is how a
 * cantilever bends: the lower trunk barely moves and the crown carries nearly all the motion.
 */
export function withSway(geometry: BufferGeometry, top: number): BufferGeometry {
  const position = geometry.attributes.position!
  const weights = new Float32Array(position.count)
  if (top > 0) {
    for (let i = 0; i < position.count; i++) {
      const t = Math.min(Math.max(position.getY(i) / top, 0), 1)
      weights[i] = t * t
    }
  }
  geometry.setAttribute('sway', new BufferAttribute(weights, 1))
  return geometry
}

const SWAY_PARS = /* glsl */ `
  attribute float sway;
  uniform float windClock;
`

// Object space is world space here: the prop mesh sits untransformed at the world origin, with
// every placement already baked into its vertices.
const SWAY_BEGIN = /* glsl */ `
  #include <begin_vertex>
  {
    float phase = transformed.x * 0.07 + transformed.z * 0.05;
    float gust = 0.55 + 0.45 * sin(windClock * 1.1 + phase);
    float flutter = 0.18 * sin(windClock * 2.7 + phase * 2.3);
    float bend = sway * (gust + flutter) * ${SWAY_AMPLITUDE.toFixed(3)};
    transformed.x += ${WIND_DIRECTION[0].toFixed(3)} * bend;
    transformed.z += ${WIND_DIRECTION[1].toFixed(3)} * bend;
    // A bending crown also drops a little, so the tip travels on an arc rather than sliding.
    transformed.y -= bend * bend * 0.6;
  }
`

/** Patch a material so geometry carrying a `sway` attribute bends in the wind. */
export function applyWindSway<T extends Material>(material: T): T {
  // Chained rather than assigned: the prop material already carries the cloud-shadow patch from
  // `createSurface`, and assigning `onBeforeCompile` would silently throw it away.
  addShaderPatch(material, 'wind-sway', (shader) => {
    shader.uniforms['windClock'] = WIND_CLOCK
    shader.vertexShader = SWAY_PARS + shader.vertexShader
      .replace('#include <begin_vertex>', SWAY_BEGIN)
  })
  return material
}

/** The depth material a swaying mesh's shadow has to be drawn with; see the module comment. */
export function createSwayDepthMaterial(): MeshDepthMaterial {
  return applyWindSway(new MeshDepthMaterial({ depthPacking: RGBADepthPacking }))
}
