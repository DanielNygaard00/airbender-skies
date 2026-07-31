import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three'

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
  varying vec3 vDirection;
  void main() {
    float t = pow(clamp(vDirection.y, 0.0, 1.0), 0.45);
    gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function createSkyDome(): Mesh {
  const material = new ShaderMaterial({
    uniforms: {
      zenith: { value: new Color(SKY_ZENITH) },
      horizon: { value: new Color(SKY_HORIZON) },
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
