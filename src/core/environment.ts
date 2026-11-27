import {
  BackSide, Color, Mesh, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry,
  type Texture, type WebGLRenderer,
} from 'three'
import type { Daylight } from './daylight'

/**
 * The sky, baked into the light every physically based surface receives from all directions.
 *
 * **What it replaces.** The world used to be filled by a `HemisphereLight`: one colour from above,
 * one from below, blended by how far a face tilts. That is a two-sample guess at the sky. An
 * environment map is the sky itself — the deep zenith overhead, the pale band at the horizon, the
 * ground beneath — prefiltered so a rough surface sees a soft average of it and a smoother one a
 * sharper reflection. Shaded faces turn the cool blue that outdoor shadows actually are; vertical
 * faces pick up the bright horizon; undersides go dark and green.
 *
 * **Built from the same `Daylight` the visible sky dome is**, so the light on the terrain cannot
 * disagree with the sky behind it. And built once: the sun's elevation is authored, not animated
 * (see `daylight.ts`), so there is nothing to regenerate per frame.
 *
 * **Its own dome rather than the visible one.** The visible dome holds the horizon colour all the
 * way down, because below the horizon the player only ever sees it through fog of that same
 * colour. Lighting cannot get away with that: a horizon-bright lower half would light every
 * underside from below as brightly as the sky lights it from above, and islands would float with
 * glowing bellies. So below the horizon this dome fades quickly to the ground colour that the
 * hemisphere light used to supply.
 */
const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Same 0.45 exponent as the visible dome above the horizon, but the zenith only ever reaches half
// strength. At full strength the cosine-weighted average of the upper half is mostly the saturated
// zenith blue, and every shadow on the grass went cyan — photographed on the bench's earth-rocks
// scene, a boulder in a tree's shade turned navy. Real skylight is bluer than sunlight, but it is
// the whole scattering sky, haze included, not the deepest patch overhead.
//
// Below the horizon the ground takes over within a few degrees: an island's underside should see
// earth, not haze.
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 ground;
  varying vec3 vDirection;
  void main() {
    float y = vDirection.y;
    vec3 sky = mix(horizon, zenith, 0.5 * pow(clamp(y, 0.0, 1.0), 0.45));
    vec3 below = mix(horizon, ground, smoothstep(0.0, 0.18, -y));
    gl_FragColor = vec4(y >= 0.0 ? sky : below, 1.0);
  }
`

/**
 * How strongly the environment lights diffuse surfaces, per unit of the daylight's fill.
 *
 * `Daylight.hemiIntensity` still carries how strong the fill should be at each hour — dimmer at
 * sunset, stronger at noon — so the environment scales with it rather than taking a second,
 * independent number that could drift from the rest of the palette.
 *
 * three.js divides a hemisphere light's contribution by pi and does not divide an environment's,
 * so with identical colours the old fill would correspond to about 0.32 per unit. The colours are
 * not identical — the hemisphere's "sky" was the pale horizon, the environment's upper half is
 * mostly the deeper zenith — so the factor is set by eye on the bench rather than by that
 * arithmetic alone.
 */
export const ENVIRONMENT_PER_FILL = 0.4

export function environmentIntensityFor(light: Daylight): number {
  return light.hemiIntensity * ENVIRONMENT_PER_FILL
}

/** Inside the cube camera's default far plane of 100, which `fromScene` is given explicitly. */
const DOME_RADIUS = 50

export function createSkyEnvironment(renderer: WebGLRenderer, light: Daylight): Texture {
  const material = new ShaderMaterial({
    uniforms: {
      zenith: { value: new Color(light.skyZenith) },
      horizon: { value: new Color(light.skyHorizon) },
      ground: { value: new Color(light.hemiGround) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: BackSide,
    depthWrite: false,
  })
  const geometry = new SphereGeometry(DOME_RADIUS, 32, 16)
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))

  const pmrem = new PMREMGenerator(renderer)
  const target = pmrem.fromScene(scene, 0, 0.1, DOME_RADIUS * 2)
  pmrem.dispose()
  geometry.dispose()
  material.dispose()
  return target.texture
}
