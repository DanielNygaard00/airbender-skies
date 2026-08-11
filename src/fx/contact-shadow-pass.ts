import {
  Color, Matrix4, Mesh, MeshDepthMaterial, MultiplyBlending, NearestFilter,
  OrthographicCamera, PlaneGeometry, RGBADepthPacking, Scene, ShaderMaterial, Vector3,
  WebGLRenderTarget, type Object3D, type PerspectiveCamera, type WebGLRenderer,
} from 'three'
import { SUN_DIRECTION } from '../core/sun'
import {
  CONTACT_BIAS, CONTACT_FADE_END, CONTACT_FADE_START, CONTACT_RANGE, CONTACT_STEPS,
  CONTACT_STRENGTH, CONTACT_THICKNESS, depthTargetSize, excludedFromDepth, sunDirectionInView,
} from './contact-shadow'

/**
 * A fullscreen quad in clip space, with no camera involved.
 *
 * `PlaneGeometry(2, 2)` spans -1 to 1, so writing `position.xy` straight into
 * `gl_Position` fills the screen exactly. That keeps the quad independent of whatever
 * camera `renderer.render` is handed, which matters because the fragment shader needs
 * the *scene* camera's matrices and must not be confused by a second set.
 */
const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/*
 * The march.
 *
 * `#include <packing>` brings in three.js's own `unpackRGBAToDepth` and
 * `perspectiveDepthToViewZ`, so this file does not restate either. Note that view Z is
 * *negative* ahead of the camera, which makes a larger value the nearer one — the
 * comparison below reads backwards until that lands.
 *
 * There are deliberately no tone-mapping or colour-space includes. This shader outputs
 * a multiplier, not a colour, and `toneMapped: false` on the material keeps the
 * renderer from injecting the declarations that would go with them. `src/core/sky.ts`
 * documents the other half of that trap.
 */
const FRAGMENT_SHADER = /* glsl */ `
  #include <packing>

  uniform sampler2D tDepth;
  uniform mat4 uProjection;
  uniform mat4 uProjectionInverse;
  uniform vec3 uSunView;
  uniform float uNear;
  uniform float uFar;
  uniform float uRange;
  uniform float uStrength;
  uniform float uBias;
  uniform float uThickness;
  uniform float uFadeStart;
  uniform float uFadeEnd;

  varying vec2 vUv;

  /** Anything at or past this depth is the cleared target: nothing was drawn there. */
  const float SKY_DEPTH = 0.9999;

  float readDepth(vec2 uv) {
    return unpackRGBAToDepth(texture2D(tDepth, uv));
  }

  /**
   * The view-space position of a pixel, from its uv and its stored depth.
   *
   * This is three.js's own SSAO reconstruction: build the clip-space point and undo the
   * projection, recovering the w that the perspective divide threw away from the
   * projection matrix's third column.
   */
  vec3 viewPositionAt(vec2 uv, float depth, float viewZ) {
    float clipW = uProjection[2][3] * viewZ + uProjection[3][3];
    vec4 clipPosition = vec4((vec3(uv, depth) - 0.5) * 2.0, 1.0);
    clipPosition *= clipW;
    return (uProjectionInverse * clipPosition).xyz;
  }

  void main() {
    float depth = readDepth(vUv);
    // The sky, and anywhere else nothing was drawn. Leaving early keeps it at full
    // brightness; without this the horizon darkens and the effect reads as fog.
    if (depth >= SKY_DEPTH) {
      gl_FragColor = vec4(1.0);
      return;
    }

    float viewZ = perspectiveDepthToViewZ(depth, uNear, uFar);
    vec3 origin = viewPositionAt(vUv, depth, viewZ);

    float stepLength = uRange / float(CONTACT_STEPS);
    float occlusion = 0.0;

    for (int i = 1; i <= CONTACT_STEPS; i++) {
      vec3 samplePoint = origin + uSunView * (stepLength * float(i));

      vec4 clip = uProjection * vec4(samplePoint, 1.0);
      // Behind the camera: the perspective divide would mirror the point onto the
      // screen and sample somewhere unrelated.
      if (clip.w <= 0.0) break;
      vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
      // Off screen: there is no depth to compare against. A screen-space march simply
      // cannot answer this, so it stops rather than guessing.
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

      float sampleDepth = readDepth(uv);
      if (sampleDepth >= SKY_DEPTH) continue;

      float sampleViewZ = perspectiveDepthToViewZ(sampleDepth, uNear, uFar);
      // View Z is negative ahead of the camera, so a larger value is nearer. A positive
      // difference means the stored surface sits in front of the ray: an occluder.
      float difference = sampleViewZ - samplePoint.z;

      if (difference > uBias && difference < uThickness) {
        // Nearer hits are darker. A hit at the first step is a true contact; one at the
        // last step is an occluder at the far end of the range and barely registers.
        occlusion = 1.0 - float(i - 1) / float(CONTACT_STEPS);
        break;
      }
    }

    float cameraDistance = -origin.z;
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, cameraDistance);
    float shade = 1.0 - occlusion * uStrength * fade;

    // Alpha must be exactly 1. MultiplyBlending resolves to
    // 'src * DST_COLOR + dst * (1 - SRC_ALPHA)', so any lower alpha adds unmultiplied
    // destination back and the result stops being a multiply.
    gl_FragColor = vec4(vec3(shade), 1.0);
  }
`

export interface ContactShadowPass {
  /**
   * Render the scene's depth, then multiply the contact term over whatever is already
   * in the canvas.
   *
   * Call this *instead of* `renderer.render(scene, camera)` — it performs that render
   * itself, in the middle.
   */
  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void
  resize(width: number, height: number): void
  dispose(): void
}

export function createContactShadowPass(width: number, height: number): ContactShadowPass {
  const initial = depthTargetSize(width, height)
  const depthTarget = new WebGLRenderTarget(initial.width, initial.height, {
    // Nearest on both, because the values in here are packed depth. Interpolating two
    // packed depths produces a number that is not a depth at all, and the artefact is a
    // faint halo along every edge rather than an obvious failure.
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    // No stencil, and a depth buffer is needed so the depth pass occludes itself.
    stencilBuffer: false,
    depthBuffer: true,
  })

  const depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })

  const uniforms = {
    tDepth: { value: depthTarget.texture },
    uProjection: { value: new Matrix4() },
    uProjectionInverse: { value: new Matrix4() },
    uSunView: { value: new Vector3() },
    uNear: { value: 0 },
    uFar: { value: 0 },
    uRange: { value: CONTACT_RANGE },
    uStrength: { value: CONTACT_STRENGTH },
    uBias: { value: CONTACT_BIAS },
    uThickness: { value: CONTACT_THICKNESS },
    uFadeStart: { value: CONTACT_FADE_START },
    uFadeEnd: { value: CONTACT_FADE_END },
  }

  const quadMaterial = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    // A constant loop bound, which GLSL ES 1.0 requires.
    defines: { CONTACT_STEPS },
    blending: MultiplyBlending,
    // Required by MultiplyBlending. Without it three.js logs an error and applies no
    // blend, so the pass draws a grey rectangle over the game or nothing at all.
    premultipliedAlpha: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // A multiplier, not a colour. See the note above FRAGMENT_SHADER.
    toneMapped: false,
    fog: false,
  })

  const quadScene = new Scene()
  quadScene.add(new Mesh(new PlaneGeometry(2, 2), quadMaterial))
  // Never configured: the vertex shader ignores every camera matrix. `renderer.render`
  // requires a camera, so this satisfies the signature and nothing else.
  const quadCamera = new OrthographicCamera()

  const previousClearColour = new Color()
  /** Nodes this pass hid, so exactly those can be shown again. */
  const hidden: Object3D[] = []

  return {
    render(renderer, scene, camera) {
      hidden.length = 0
      for (const node of excludedFromDepth(scene)) {
        // Only the ones that were actually visible. Some flagged nodes are hidden by
        // design — `aim-tell.ts`'s preview is built invisible and shown only when a
        // target is in the cone — and forcing them visible afterwards would leave them
        // on screen permanently.
        if (!node.visible) continue
        node.visible = false
        hidden.push(node)
      }

      const previousTarget = renderer.getRenderTarget()
      const previousOverride = scene.overrideMaterial
      const previousAutoClear = renderer.autoClear
      renderer.getClearColor(previousClearColour)
      const previousClearAlpha = renderer.getClearAlpha()

      scene.overrideMaterial = depthMaterial
      renderer.setRenderTarget(depthTarget)
      // White is depth 1.0 once unpacked — the far plane. The default black would be
      // depth 0.0, geometry against the near plane, and every pixel would find an
      // occluder.
      renderer.setClearColor(0xffffff, 1)
      renderer.clear()
      renderer.render(scene, camera)

      scene.overrideMaterial = previousOverride
      renderer.setRenderTarget(previousTarget)
      renderer.setClearColor(previousClearColour, previousClearAlpha)
      for (const node of hidden) node.visible = true

      // The ordinary frame, untouched: MSAA, tone mapping and fog all behave exactly as
      // they did before this pass existed, because this is the same call that was here.
      renderer.render(scene, camera)

      uniforms.uProjection.value.copy(camera.projectionMatrix)
      uniforms.uProjectionInverse.value.copy(camera.projectionMatrixInverse)
      // `camera.matrixWorldInverse` is current: the render above updated it.
      sunDirectionInView(SUN_DIRECTION, camera, uniforms.uSunView.value)
      uniforms.uNear.value = camera.near
      uniforms.uFar.value = camera.far

      // Without this the quad's own render would clear the frame it is meant to
      // multiply, leaving a blank screen.
      renderer.autoClear = false
      renderer.render(quadScene, quadCamera)
      renderer.autoClear = previousAutoClear
    },

    resize(width, height) {
      const size = depthTargetSize(width, height)
      depthTarget.setSize(size.width, size.height)
    },

    dispose() {
      depthTarget.dispose()
      depthMaterial.dispose()
      quadMaterial.dispose()
      quadScene.traverse((node) => {
        const mesh = node as Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
      })
    },
  }
}
