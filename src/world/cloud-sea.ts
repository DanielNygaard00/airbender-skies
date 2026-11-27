import {
  Color, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, type Vector3,
} from 'three'
import { FOG_FAR } from '../core/renderer'
import { SKY_HORIZON, SKY_ZENITH } from '../core/sky'
import { SUN_DIRECTION } from '../core/sun'
import { CLOUD_DRIFT, CLOUD_NOISE_GLSL } from '../core/weather'

/**
 * A sea of cloud far below the islands.
 *
 * **Why.** Look down from the edge of any island, or while gliding between them, and there was
 * nothing: the horizon colour all the way down, a flat pale void that gave no sense of how high
 * up the player was or what they would fall into. A floating archipelago reads as floating
 * because there is something far beneath it -- here a cloud deck, lit from above, with darker gaps
 * where it thins, drifting on the same wind as the sky.
 *
 * **At the world floor, deliberately.** It sits a few metres above `worldFloorY`, the height a
 * fall triggers a respawn, so falling into the clouds *is* falling out of the world: the player
 * never passes through the deck and sees its flat underside, and the respawn happens at the
 * moment the fall visibly ends.
 *
 * **One plane that follows the camera.** It is `FOG_FAR` in every direction from the camera, and
 * its noise is sampled in world space, so the clouds stay put while the plane slides under them.
 * The linear fog reaches full strength at its edge, which is also the camera's far plane, so the
 * deck dissolves into the horizon band rather than ending at a line.
 *
 * **Fogged and hazed like the rest of the world**, through three's fog chunks, which `haze.ts`
 * has already rewritten: the deck is 600 m down from the home island, and at that distance the
 * aerial perspective is a large part of what makes it read as far away.
 *
 * **Kept below bloom's threshold.** The tops are lit, but held under the bloom pass's luminance
 * threshold, or the whole lower half of the frame would glow.
 */

/** Height above the world floor the deck's surface sits at, in metres. */
export const CLOUD_SEA_CLEARANCE = 6
/** Metres per cloud-noise unit: the deck's billows are a couple of hundred metres across. */
const SEA_SCALE = 260

const VERTEX = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec2 cloudDrift;
  uniform vec3 litColour;
  uniform vec3 shadeColour;
  uniform vec3 gapColour;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  ${CLOUD_NOISE_GLSL}

  void main() {
    // Slower than the sky's drift: a deck this far below appears to move less.
    vec2 p = vWorld.xz / ${SEA_SCALE.toFixed(1)} - cloudDrift * 0.6;
    float shape = cloudFbm(p);
    // Mostly covered, with gaps -- a deck, not scattered cumulus. The noise averages about a
    // half, so the ramp sits well below that: 0.34-0.58 left half the deck open, and blue gaps
    // with white patches read as the sky reflected in water rather than as cloud.
    float cover = smoothstep(0.2, 0.42, shape);
    // Relief: the billow's sunward side is where the noise rises toward the sun.
    float towardSun = cloudFbm(p + vec2(${SUN_DIRECTION.x.toFixed(3)}, ${SUN_DIRECTION.z.toFixed(3)}) * 0.04);
    float relief = clamp((towardSun - shape) * 5.0 + 0.55, 0.0, 1.0);
    vec3 top = mix(shadeColour, litColour, relief);
    gl_FragColor = vec4(mix(gapColour, top, cover), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export interface CloudSea {
  mesh: Mesh
  /** Slide the deck under the camera. Once a frame. */
  update(camera: Vector3): void
}

export function createCloudSea(worldFloorY: number): CloudSea {
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      // Lit tops, warm-white but held under bloom's threshold; see the module comment.
      litColour: { value: new Color(0.74, 0.73, 0.70) },
      shadeColour: { value: new Color(SKY_HORIZON).multiplyScalar(0.62) },
      // Deep slate rather than sky blue, so a gap reads as depth beneath the deck, not as sky.
      gapColour: { value: new Color(SKY_ZENITH).lerp(new Color(0x4a5560), 0.6).multiplyScalar(0.5) },
    },
  ])
  // The shared object itself, after the merge -- `merge` clones, and a clone would never move.
  uniforms['cloudDrift'] = CLOUD_DRIFT

  const material = new ShaderMaterial({
    uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, fog: true,
  })
  const geometry = new PlaneGeometry(FOG_FAR * 2, FOG_FAR * 2, 1, 1)
  geometry.rotateX(-Math.PI / 2)
  const mesh = new Mesh(geometry, material)
  mesh.name = 'cloud-sea'
  mesh.position.y = worldFloorY + CLOUD_SEA_CLEARANCE
  // It follows the camera, so a bounding test against its authored position is meaningless.
  mesh.frustumCulled = false
  // Nothing casts onto it from within the shadow map's reach, and it casts onto nothing.
  mesh.userData.excludeFromShadows = true
  // At 600 m and grazing angles the occlusion pass reads only noise off it.
  mesh.userData.cannotReceiveAO = true

  return {
    mesh,
    update(camera: Vector3): void {
      mesh.position.x = camera.x
      mesh.position.z = camera.z
    },
  }
}
