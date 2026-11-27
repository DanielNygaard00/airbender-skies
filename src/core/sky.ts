import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three'
import { SUN_COLOUR, SUN_DIRECTION } from './sun'

/**
 * A gradient dome instead of a flat background colour. For a game about altitude,
 * a single flat blue gives the player nothing to read height against — the sky
 * looks identical on the ground and at the top of the spire.
 */
export const SKY_ZENITH = 0x2f6fb0
/**
 * The pale band at eye level. The scene's fog is set to this same colour, so
 * distant islands fade into the horizon rather than into a mismatched grey.
 */
export const SKY_HORIZON = 0xbcd8ee

/**
 * Large enough that the player never reaches it — the archipelago spans roughly
 * 800 units — while staying inside the camera's far plane, or it would be clipped
 * away and leave the background empty.
 */
export const SKY_RADIUS = 2000

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// The exponent biases the blend so the pale band hugs the horizon instead of
// washing out the whole dome.
//
// Clouds: a bare gradient was the least real thing on screen, and the sky fills the top third of
// the follow camera's frame. They are fractal value noise projected onto a flat ceiling --
// direction.xz / direction.y -- which is what makes them shrink and crowd toward the horizon the
// way a real cloud layer does, and they fade out over the last stretch above the horizon, where
// that projection stretches a texel across kilometres and would shimmer. Lit from the sun's side
// and greyed toward their undersides so they read as volumes rather than as stickers. Static:
// the dome has no clock, and the FX bench depends on two photographs of the sky matching.
//
// The sun: a small HDR disk above 1.0, so bloom catches it, inside a wide soft glow. The glow is
// the part that matters from gameplay angles -- the disk sits high, and is mostly out of frame.
//
// The two trailing includes apply tone mapping and the output colour transform.
// Without them the dome would keep its raw linear colour while the terrain around
// it is tone mapped, so the horizon would no longer match the fog it fades into.
// Do NOT also include the matching `..._pars_fragment` chunks: the renderer already
// injects those declarations for a ShaderMaterial whose `toneMapped` is left on, and
// adding them again fails the compile with a wall of "redefinition" errors — which
// silently leaves the sky undrawn, showing scene.background instead.
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 sunColour;
  uniform vec3 sunDirection;
  varying vec3 vDirection;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
    for (int k = 0; k < 5; k++) {
      sum += amplitude * valueNoise(p);
      p = turn * p;
      amplitude *= 0.5;
    }
    return sum;
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float t = pow(clamp(dir.y, 0.0, 1.0), 0.45);
    vec3 sky = mix(horizon, zenith, t);

    float toSun = max(dot(dir, sunDirection), 0.0);
    sky += sunColour * (pow(toSun, 6.0) * 0.18 + pow(toSun, 90.0) * 0.5);

    float up = max(dir.y, 0.0);
    vec2 ceiling = dir.xz / (up + 0.06) * 1.4;
    float shape = fbm(ceiling + vec2(3.7, 1.9));
    float cover = smoothstep(0.52, 0.78, shape) * smoothstep(0.03, 0.22, up);
    // Thicker cloud is darker underneath; the sun's side of every cloud is lit.
    float thickness = smoothstep(0.55, 0.95, shape);
    vec3 lit = mix(vec3(1.0), sunColour, 0.35) * (0.95 + 0.25 * toSun);
    vec3 shade = mix(horizon, zenith, 0.25) * 0.82;
    vec3 cloud = mix(lit, shade, thickness * 0.65);
    sky = mix(sky, cloud, cover * 0.9);

    float disk = smoothstep(0.99955, 0.99975, toSun);
    sky = mix(sky, sunColour * 6.0, disk);

    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * The colours are parameters with the shipped defaults, because `daylight.ts` now derives
 * them from the sun's elevation. Defaulted rather than required so the constants stay the
 * one place the shipped gradient is written down, and so a caller that does not care about
 * time of day — a test, a tool — does not have to know about elevation at all.
 */
export function createSkyDome(
  zenith: number = SKY_ZENITH, horizon: number = SKY_HORIZON, sun: number = SUN_COLOUR,
): Mesh {
  const material = new ShaderMaterial({
    uniforms: {
      zenith: { value: new Color(zenith) },
      horizon: { value: new Color(horizon) },
      sunColour: { value: new Color(sun) },
      // The same direction the light shines from, so the glow sits where the shadows point away.
      sunDirection: { value: SUN_DIRECTION.clone() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: BackSide,
    // Fog would tint the dome towards the fog colour and flatten the very gradient
    // the dome exists to provide.
    fog: false,
    depthWrite: false,
  })

  const dome = new Mesh(new SphereGeometry(SKY_RADIUS, 32, 16), material)
  // Drawn first and writing no depth, so it can never paint over nearer geometry.
  dome.renderOrder = -1
  // It encloses the camera, so the usual bounding-sphere test only wastes work.
  dome.frustumCulled = false
  // It also encloses the whole scene, so casting shadows from it would put
  // everything in shade.
  dome.userData.excludeFromShadows = true
  return dome
}
