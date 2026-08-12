import {
  Color, Matrix4, Mesh, MeshDepthMaterial, MultiplyBlending, NearestFilter,
  OrthographicCamera, PlaneGeometry, RGBADepthPacking, Scene, ShaderMaterial, Vector3,
  WebGLRenderTarget, type Object3D, type PerspectiveCamera, type WebGLRenderer,
} from 'three'
import { SUN_DIRECTION } from '../core/sun'
import {
  CONTACT_BIAS, CONTACT_FADE_END, CONTACT_FADE_START, CONTACT_NORMAL_OFFSET,
  CONTACT_RANGE, CONTACT_STEPS,
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
 * There are deliberately no tone-mapping or colour-space includes, because this shader
 * outputs a multiplier rather than a colour. `toneMapped: false` on the material states
 * that intent, but it is worth being accurate about what it actually does, because the
 * obvious reading is only half right. `WebGLPrograms` turns it into
 * `toneMapping: NoToneMapping`, and `WebGLProgram` gates `tonemapping_pars_fragment` on
 * `toneMapping !== NoToneMapping` — so that half of the prefix really is suppressed.
 * `colorspace_pars_fragment` is a different matter: it is prepended to every
 * non-`RawShaderMaterial` fragment shader unconditionally, and `toneMapped` has no
 * bearing on it. Since this shader includes neither `<tonemapping_fragment>` nor
 * `<colorspace_fragment>`, both prefixes are unused declarations either way and the flag
 * is inert in practice. It stays as a statement of intent, not as a mechanism.
 *
 * The consequence of no colour-space chunk running is the part that matters and is
 * documented nowhere else: the multiply lands on sRGB-encoded values rather than linear
 * ones. See `CONTACT_STRENGTH` in `contact-shadow.ts` for what that costs.
 *
 * `src/core/sky.ts` documents the other half of that trap.
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
  uniform float uNormalOffset;
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
    // The sky, and anywhere else nothing was drawn. This is an optimisation and nothing
    // more, which is worth stating because the comment here used to claim the horizon
    // would darken without it. It would not. With the target correctly cleared to white a
    // sky pixel unpacks to depth 1.0, which reconstructs to a view Z of -2200 — the far
    // plane — so 'cameraDistance' is 2200, 'smoothstep(40, 70, 2200)' is 1, 'fade' is 0,
    // and 'shade' comes out at exactly 1.0 no matter what the march found. Deleting this
    // branch could not darken a single sky pixel.
    //
    // It stays because of what it costs to reach that answer the long way: up to eight
    // texture fetches and a full march per pixel, over what is most of the frame whenever
    // the camera looks up. Skipping work the distance fade would zero anyway.
    if (depth >= SKY_DEPTH) {
      gl_FragColor = vec4(1.0);
      return;
    }

    float viewZ = perspectiveDepthToViewZ(depth, uNear, uFar);
    vec3 surface = viewPositionAt(vUv, depth, viewZ);

    /*
     * The surface's own normal, and it is what makes the march usable on anything that is
     * not a flat wall square to the camera.
     *
     * 'uBias' plus the per-step 'selfOcclusion' term below cancel the depth gap the march
     * opens up against a *plane perpendicular to the view axis*, exactly. Nothing in this
     * scene is that. On a sloped or curved surface a residual survives the cancellation,
     * proportional to the surface's own depth gradient along the sun direction — and the
     * measured consequence was that tree trunks, the character's limbs and every facet of
     * a floating rock reported themselves fully occluded at the very first step. The
     * occlusion mask read almost black over every cylinder in the scene while the flat
     * ground read white, which is the signature of a correction that only handles flatness.
     *
     * Reconstructed from the depth buffer with screen-space derivatives rather than carried
     * in a second render target, because the depth pass already exists and a normal pass
     * would double its cost for a value that is one cross product away. The sign is chosen
     * so the normal faces the camera: 'dFdy' runs down the screen while view Y runs up it,
     * so the naive cross product points away.
     */
    vec3 normal = normalize(cross(dFdx(surface), dFdy(surface)));

    /*
     * Start the ray off the surface rather than on it.
     *
     * This is the fix for the residual above, and it works where a larger 'uBias' does not:
     * a bias big enough to clear a trunk's curvature — measured at around 0.15, seven times
     * the current value — throws away every genuine shallow contact in the scene at the same
     * time, because a constant cannot tell curvature from a real occluder pressed against a
     * surface. Lifting the origin along the normal instead scales the correction with the
     * geometry that caused it: a facet's neighbour is no longer nearer than the ray, while
     * an occluder genuinely standing above the surface still is.
     */
    vec3 origin = surface + normal * uNormalOffset;

    /*
     * A surface facing away from the sun is already dark, and darkening it again is the
     * double-count this pass has no way to see.
     *
     * The multiply lands on a frame the shadow map and the diffuse term have both already
     * shaded, so on a face angled away from the light the direct contribution is at or near
     * zero before this pass touches it. Contact-darkening it a second time is not a subtler
     * shadow, it is the same shadow twice — and it is precisely where the false hits
     * concentrate, because a back-facing surface is the case the flat-plane cancellation is
     * furthest from describing. 'smoothstep' rather than a hard cut, so the term arrives as
     * the surface turns into the light rather than switching on along a visible contour.
     */
    float facing = smoothstep(0.0, 0.25, dot(normal, uSunView));
    if (facing <= 0.0) {
      gl_FragColor = vec4(1.0);
      return;
    }

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
      // Same as the early-out at the top: a skip, not a correction. A sky sample sits at
      // the far plane, so its 'difference' below comes out around -2190 against a surface
      // ten units out — nowhere near the 'uBias' lower bound, so the hit test could never
      // fire on it. This only spares the arithmetic.
      if (sampleDepth >= SKY_DEPTH) continue;

      float sampleViewZ = perspectiveDepthToViewZ(sampleDepth, uNear, uFar);
      // View Z is negative ahead of the camera, so a larger value is nearer. A positive
      // difference means the stored surface sits in front of the ray: an occluder.
      float difference = sampleViewZ - samplePoint.z;

      // A flat, camera-facing surface reports itself as an "occluder" here with no real
      // geometry in the way: marching toward the sun steps the ray's Z by
      // 'stepLength * uSunView.z' each iteration, but re-reading the depth buffer at the
      // new screen position finds the *same* flat surface, at the view Z it always had.
      // For a plane perpendicular to the view axis this gap is exact —
      // 'i * stepLength * -uSunView.z' — so it is computed and added to both bounds
      // rather than folded into a bigger constant bias, which could only be correct at
      // one step index. 'max(0.0, ...)' keeps it at zero when the sun faces the camera
      // rather than the screen, where this artefact does not arise.
      float selfOcclusion = float(i) * stepLength * max(0.0, -uSunView.z);

      if (difference > uBias + selfOcclusion && difference < uThickness + selfOcclusion) {
        // Nearer hits are darker. A hit at the first step is a true contact; one at the
        // last step is an occluder at the far end of the range and barely registers.
        occlusion = 1.0 - float(i - 1) / float(CONTACT_STEPS);
        break;
      }
    }

    float cameraDistance = -origin.z;
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, cameraDistance);
    // 'facing' is folded in here rather than only used as the early-out above, so a
    // surface turning into the light gains its contact term gradually instead of at a
    // single contour the eye can find.
    float shade = 1.0 - occlusion * uStrength * fade * facing;

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
    uNormalOffset: { value: CONTACT_NORMAL_OFFSET },
    uFadeStart: { value: CONTACT_FADE_START },
    uFadeEnd: { value: CONTACT_FADE_END },
  }

  const quadMaterial = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    // Emitted as `#define CONTACT_STEPS 8`. It has to stay an integer so that
    // `i <= CONTACT_STEPS` in the loop below stays an int-to-int comparison; three.js
    // compiles this as GLSL ES 3.00, which rejects the int-to-float form. See
    // `CONTACT_STEPS` in `contact-shadow.ts`.
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

  const quadGeometry = new PlaneGeometry(2, 2)
  const quad = new Mesh(quadGeometry, quadMaterial)
  /*
   * The shader ignores every camera matrix; `renderer.render` does not.
   *
   * `WebGLRenderer.projectObject` frustum-culls each object whose `frustumCulled` is
   * true — the default for a `Mesh` — against the camera it was handed, before the
   * vertex shader ever runs. `PlaneGeometry(2, 2)` has a bounding-sphere radius of
   * 1.4142 about the origin, and the default `OrthographicCamera` has `near = 0.1`, so
   * the sphere clears the near-plane test by 1.31 units. That is the entire margin: at
   * `near = 1.5` the composite is culled outright, the pass silently stops drawing, and
   * the only symptom is the game looking exactly as it did before this pass existed —
   * no error, nothing in the console.
   *
   * Turning culling off is what makes the camera's configuration genuinely unable to
   * matter, which is what the comment here used to claim on the shader's behalf alone.
   * `src/core/sky.ts` and `src/world/wind-tell.ts` use the same idiom for the same
   * reason: an object whose bounding-sphere test can only ever waste work or be wrong.
   */
  quad.frustumCulled = false
  const quadScene = new Scene()
  quadScene.add(quad)
  // Never configured, and now genuinely inert: the shader reads none of its matrices,
  // and the quad above is exempt from the culling that was the one remaining route by
  // which this camera's settings could affect the render. `renderer.render` requires a
  // camera, so this satisfies the signature.
  const quadCamera = new OrthographicCamera()

  const previousClearColour = new Color()
  /**
   * Scratch for `excludedFromDepth`, which clears and refills it rather than allocating a
   * fresh array on every frame.
   *
   * Kept separate from `hidden` below because the two hold different sets and both have to
   * be accurate at the same time: this one is every flagged node in the scene, and
   * `hidden` is the subset that this pass actually turned off. Compacting one into the
   * other in place would leave `hidden` briefly holding nodes it had not hidden, which is
   * the one thing its own name promises it never does.
   */
  const excluded: Object3D[] = []
  /** Nodes this pass hid, so exactly those can be shown again. */
  const hidden: Object3D[] = []

  return {
    render(renderer, scene, camera) {
      hidden.length = 0
      for (const node of excludedFromDepth(scene, excluded)) {
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
      const previousBackground = scene.background
      const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate
      renderer.getClearColor(previousClearColour)
      const previousClearAlpha = renderer.getClearAlpha()

      scene.overrideMaterial = depthMaterial
      // `WebGLBackground.render` clears to `scene.background` whenever it is a Color,
      // and it ORs that into its own `forceClear` rather than gating it on `autoClear`
      // — so with the sky colour left in place here, it silently overwrites the white
      // clear below on every frame. The sky would then read back as a surface roughly
      // one view-space unit from the camera instead of the untouched far plane. Nulling
      // the background is the only way to reach the branch that respects
      // `setClearColor` below; `renderer.ts` sets the real one and this restores it.
      scene.background = null
      // `WebGLShadowMap` reads each object's own `material`, not `scene.overrideMaterial`,
      // so it does not know this render is depth-only — left enabled it would rasterise
      // the same 4096-square shadow map a second time, for a map this pass never reads.
      renderer.shadowMap.autoUpdate = false
      renderer.setRenderTarget(depthTarget)
      // With `scene.background` null, `WebGLBackground` takes the branch that clears to
      // whatever `setClearColor` last set instead of forcing the scene's sky colour, so
      // this is now the clear that actually lands. White is depth 1.0 once unpacked —
      // the far plane — while black would be depth 0.0, geometry against the near
      // plane, and every pixel would find an occluder.
      renderer.setClearColor(0xffffff, 1)
      // Strictly redundant, and kept anyway. `autoClear` is still true at this point and
      // `scene.background` was nulled one line above, so `WebGLBackground` performs an
      // identical clear a moment later from inside `renderer.render`. It stays as
      // belt-and-braces because the blocking defect on this branch was precisely that
      // something else silently took over this clear — an explicit clear here fails
      // visibly if that ever happens again, rather than leaving the depth target holding
      // whatever the other path decided.
      renderer.clear()
      renderer.render(scene, camera)

      scene.overrideMaterial = previousOverride
      scene.background = previousBackground
      renderer.shadowMap.autoUpdate = previousShadowAutoUpdate
      renderer.setRenderTarget(previousTarget)
      renderer.setClearColor(previousClearColour, previousClearAlpha)
      for (const node of hidden) node.visible = true

      // The ordinary frame's *appearance* is untouched — MSAA, tone mapping and fog
      // all behave exactly as they did before this pass existed. Its cost is not: this
      // is now the second `renderer.render` call of the frame, so (with
      // `shadowMap.autoUpdate` restored above) it also pays for the one shadow-map
      // rasterisation that the depth pass just skipped, rather than the zero it used to
      // share the call with.
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

    /**
     * Release everything this pass owns.
     *
     * **Nothing calls this today.** `createRenderer` builds the pass and never exposes it,
     * so there is no path from the game to this method. It is kept because every view
     * module in this codebase has one and a pass that could not be disposed of would be the
     * odd one out the moment anything does need to tear the renderer down.
     *
     * The body disposes the one geometry through the local that holds it, rather than
     * traversing `quadScene` looking for meshes. The traversal was written for a scene that
     * might hold anything; this one holds exactly one quad, built ten lines up, and naming
     * it directly is both shorter and honest about that.
     */
    dispose() {
      depthTarget.dispose()
      depthMaterial.dispose()
      quadMaterial.dispose()
      quadGeometry.dispose()
    },
  }
}
