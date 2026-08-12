# Contact Shadows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Darken the places where geometry touches other geometry — a trunk's base, a rock's underside, a character's feet — with a screen-space contact shadow pass that the shadow map cannot resolve at 0.044 world units per texel.

**Architecture:** The scene's depth is rendered into a render target using `scene.overrideMaterial`, the canvas is drawn exactly as it is today, and then one fullscreen quad is multiplied over the finished frame. The main render path is never redirected, so MSAA, tone mapping and fog are untouched and the whole feature is reversible by deleting two calls.

**Tech Stack:** TypeScript 7.0.2 (`noUncheckedIndexedAccess`, two-pass typecheck), three.js 0.185.1, Vitest 4.1.10 in the **node** environment (no DOM, no WebGL, no `AudioContext`), Vite.

## Global Constraints

- Never commit to `main`. Work on the branch `contact-shadows`, which exists and holds the design doc.
- The design is `docs/superpowers/specs/2026-08-11-contact-shadows-design.md`. Where this plan and the spec disagree, stop and ask.
- Comments and documentation are **normal, full English prose** explaining *why*. Match the surrounding files; read one before adding to it.
- Exact values: `CONTACT_RANGE` 0.6, `CONTACT_STEPS` 8, `CONTACT_STRENGTH` 0.55, `CONTACT_BIAS` 0.02, `CONTACT_THICKNESS` 0.5, `CONTACT_FADE_START` 40, `CONTACT_FADE_END` 70.
- The quad material **must** set `premultipliedAlpha: true`. `MultiplyBlending` without it makes three.js log `MultiplyBlending requires material.premultipliedAlpha = true` and skip the blend (`node_modules/three/src/renderers/webgl/WebGLState.js:686`). The effect then does nothing and there is no crash to point at.
- The depth target **must** be cleared to white. Packed depth occupies the colour channels, and the default black clear unpacks to depth `0.0` — geometry against the near plane — so every pixel would find occluders.
- The depth target **must** use `NearestFilter` for both `minFilter` and `magFilter`. Interpolating packed RGBA depth produces meaningless values, and the artefact is a subtle halo rather than an obvious failure.
- `render` must restore, in every case: `scene.overrideMaterial`, `renderer.autoClear`, the clear colour and alpha, the previous render target, and the `visible` flag of every node it hid.
- Do not modify `src/core/sun.ts`'s constants. All three of that file's levers are settled and documented.
- Run the whole suite (`npm test -- --run`) and both typecheck passes (`npm run typecheck`) before every commit.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/fx/contact-shadow.ts` | **New, pure.** The seven constants, `sunDirectionInView`, `depthTargetSize`, `excludedFromDepth`. Everything about the pass that does not need a GL context. |
| `src/fx/contact-shadow.test.ts` | **New.** Tests for the three functions and the constants' relationships. |
| `src/fx/contact-shadow-pass.ts` | **New.** The GLSL, the render target, the quad, and the state save/restore. Untested — constructing it needs a WebGL context. |
| `src/core/renderer.ts` | Modified: creates the pass, exposes it, and resizes it alongside the camera. |
| `src/main.ts` | Modified: both `renderer.render(scene, camera)` call sites route through the pass. |
| `docs/HANDOFF.md` | Modified: this cycle's section. |

---

### Task 1: The pure half

**Files:**
- Create: `src/fx/contact-shadow.ts`
- Test: `src/fx/contact-shadow.test.ts`

**Interfaces:**
- Consumes: `Vector3`, `Camera`, `Object3D` from `three`.
- Produces:
  ```ts
  export const CONTACT_RANGE = 0.6
  export const CONTACT_STEPS = 8
  export const CONTACT_STRENGTH = 0.55
  export const CONTACT_BIAS = 0.02
  export const CONTACT_THICKNESS = 0.5
  export const CONTACT_FADE_START = 40
  export const CONTACT_FADE_END = 70
  export function sunDirectionInView(worldDirection: Vector3, camera: Camera, target: Vector3): Vector3
  export function depthTargetSize(canvasWidth: number, canvasHeight: number): { width: number; height: number }
  export function excludedFromDepth(root: Object3D): Object3D[]
  ```
  Task 2 imports all of them.

**Context you need.**

`three.js`'s math and scene-graph classes work fine under Vitest's node environment — only WebGL is missing. So `Vector3`, `PerspectiveCamera`, `Object3D`, `Mesh` and `Group` are all usable in tests here.

`Vector3.transformDirection(m)` applies a matrix's upper-left 3×3 and then **normalises**, which is exactly right for a direction. `camera.matrixWorldInverse` is the world→view transform. A camera's `matrixWorldInverse` is only current after `camera.updateMatrixWorld()`, so the tests must call it after positioning.

`userData.excludeFromShadows` is this project's existing opt-out flag, set at about fifteen sites and asserted by tests in most of them. `enableShadows` in `src/core/sun.ts` reads it and skips meshes that carry it.

- [ ] **Step 1: Write the failing test**

Create `src/fx/contact-shadow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Group, Mesh, Object3D, PerspectiveCamera, Points, Vector3 } from 'three'
import {
  CONTACT_BIAS, CONTACT_FADE_END, CONTACT_FADE_START, CONTACT_RANGE, CONTACT_STEPS,
  CONTACT_STRENGTH, CONTACT_THICKNESS, depthTargetSize, excludedFromDepth, sunDirectionInView,
} from './contact-shadow'

/**
 * A camera looking along world +X, which is deliberately **not** three.js's default
 * heading of -Z.
 *
 * This project has shipped a set of eight tests that all shared a camera basis which
 * happened to be the library's default, so an implementation ignoring the camera
 * entirely passed every one of them. A non-default basis is what makes the assertions
 * below able to fail.
 */
function cameraLookingAlongX(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.5, 2200)
  camera.position.set(0, 0, 0)
  camera.lookAt(1, 0, 0)
  camera.updateMatrixWorld()
  return camera
}

describe('sunDirectionInView', () => {
  it('maps the camera\'s own heading onto view -Z', () => {
    // A camera looks along its local -Z, so whatever it is pointed at must come back
    // as (0, 0, -1) whichever way that is in the world.
    const result = sunDirectionInView(new Vector3(1, 0, 0), cameraLookingAlongX(), new Vector3())
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
    expect(result.z).toBeCloseTo(-1)
  })

  it('maps world up onto view up, and world +Z onto view +X', () => {
    // Signed components, not magnitudes. A sign error here marches the ray away from
    // the light and darkens the lit side of every object in the game, which is the one
    // failure mode that would look deliberate rather than broken.
    const camera = cameraLookingAlongX()
    const up = sunDirectionInView(new Vector3(0, 1, 0), camera, new Vector3())
    expect(up.y).toBeCloseTo(1)

    // For a camera whose forward is world +X and whose up is world +Y, the camera's
    // own right-hand axis is world +Z. So world +Z must arrive as view +X, positive.
    const right = sunDirectionInView(new Vector3(0, 0, 1), camera, new Vector3())
    expect(right.x).toBeCloseTo(1)
    expect(right.z).toBeCloseTo(0)
  })

  it('does not simply hand back the world direction', () => {
    // The mutant this exists for: `return target.copy(worldDirection)`. It passes any
    // test written against a camera at the default heading, and fails here.
    const result = sunDirectionInView(new Vector3(1, 0, 0), cameraLookingAlongX(), new Vector3())
    expect(result.equals(new Vector3(1, 0, 0))).toBe(false)
  })

  it('normalises, so an unnormalised sun direction is still a unit ray', () => {
    const result = sunDirectionInView(new Vector3(3, 0, 0), cameraLookingAlongX(), new Vector3())
    expect(result.length()).toBeCloseTo(1)
  })

  it('writes into the target it is given rather than allocating', () => {
    // Asserted by identity. This runs once per frame for the whole session, and the
    // rest of the presentation layer holds to the same no-allocation habit.
    const target = new Vector3()
    expect(sunDirectionInView(new Vector3(1, 0, 0), cameraLookingAlongX(), target)).toBe(target)
  })
})

describe('depthTargetSize', () => {
  it('matches the canvas exactly at a normal size', () => {
    // Full resolution, deliberately: the fine detail at a contact is the whole point,
    // and any mismatch against the canvas offsets every sample by a fraction of a
    // pixel, which reads as a soft halo along every edge rather than as a bug.
    expect(depthTargetSize(1280, 720)).toEqual({ width: 1280, height: 720 })
  })

  it('floors fractional sizes, which device pixel ratios produce', () => {
    // A render target cannot have a fractional dimension.
    expect(depthTargetSize(800.6, 450.2)).toEqual({ width: 800, height: 450 })
  })

  it('never returns a zero dimension', () => {
    // `resize` runs before layout in some embeddings, and a zero-dimension render
    // target throws in WebGL rather than degrading — so the floor is 1, not 0.
    expect(depthTargetSize(0, 0)).toEqual({ width: 1, height: 1 })
    expect(depthTargetSize(1, 1)).toEqual({ width: 1, height: 1 })
  })
})

describe('excludedFromDepth', () => {
  it('collects a flagged mesh and leaves an unflagged one alone', () => {
    const root = new Object3D()
    const flagged = new Mesh()
    flagged.userData.excludeFromShadows = true
    const plain = new Mesh()
    root.add(flagged, plain)

    expect(excludedFromDepth(root)).toEqual([flagged])
  })

  it('finds a flagged node nested two levels down', () => {
    const root = new Object3D()
    const middle = new Object3D()
    const deep = new Mesh()
    deep.userData.excludeFromShadows = true
    middle.add(deep)
    root.add(middle)

    expect(excludedFromDepth(root)).toEqual([deep])
  })

  it('collects a flagged Group even though a Group is not a mesh', () => {
    // The deliberate divergence from `enableShadows`, which collects meshes only.
    // `src/world/wind-tell.ts` sets the flag on a Group whose child is a Points, and it
    // is the only non-mesh flag site in the codebase. `enableShadows` can ignore both —
    // a Group has no `castShadow` to set and a Points fails its `isMesh` test — but
    // this pass cannot: under `scene.overrideMaterial` those point sprites render with
    // the depth material and write a screenful of near depth. Hiding the flagged
    // ancestor covers the child through visibility inheritance.
    //
    // This assertion is what stops someone narrowing the rule to match
    // `enableShadows` for consistency and silently putting the wind motes back into
    // the depth buffer.
    const root = new Object3D()
    const group = new Group()
    group.userData.excludeFromShadows = true
    group.add(new Points())
    root.add(group)

    expect(excludedFromDepth(root)).toEqual([group])
  })

  it('includes the root itself when the root is flagged', () => {
    const root = new Mesh()
    root.userData.excludeFromShadows = true
    expect(excludedFromDepth(root)).toEqual([root])
  })
})

describe('the tuning constants', () => {
  it('fades out over a positive range', () => {
    // A backwards fade would not fail loudly; it would silently disable the effect at
    // close range, which is exactly where it is supposed to work.
    expect(CONTACT_FADE_START).toBeLessThan(CONTACT_FADE_END)
  })

  it('keeps the bias below the thickness', () => {
    // The two guards bracket a window: below the bias a hit is the surface finding
    // itself, above the thickness it is something far behind. Crossed over, the window
    // is empty and nothing is ever occluded.
    expect(CONTACT_BIAS).toBeLessThan(CONTACT_THICKNESS)
  })

  it('keeps the strength short of black and the range short of an AO radius', () => {
    expect(CONTACT_STRENGTH).toBeGreaterThan(0)
    expect(CONTACT_STRENGTH).toBeLessThan(1)
    // A contact distance, not an occlusion radius: a third of the 1.8-unit character.
    expect(CONTACT_RANGE).toBeLessThan(1)
  })

  it('uses an integer step count, because it becomes a GLSL loop bound', () => {
    // `CONTACT_STEPS` is injected as a `#define` and used as `i <= CONTACT_STEPS`.
    // GLSL ES 1.0 requires a constant loop bound, and a non-integer would emit
    // `#define CONTACT_STEPS 8.5` and fail the shader compile at runtime — where this
    // suite cannot see it.
    expect(Number.isInteger(CONTACT_STEPS)).toBe(true)
    expect(CONTACT_STEPS).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/fx/contact-shadow.test.ts`
Expected: FAIL — the module does not exist, so every test errors on the import.

- [ ] **Step 3: Write the implementation**

Create `src/fx/contact-shadow.ts`:

```ts
import type { Camera, Object3D, Vector3 } from 'three'

/**
 * How far from a surface an occluder still counts, in world units.
 *
 * A *contact* distance rather than an ambient-occlusion radius — about a third of the
 * 1.8-unit character — so this darkens where a body, a trunk or a rock is genuinely
 * touching and does not attempt to be a general occlusion term. An argued guess:
 * nothing in this cycle has been played.
 */
export const CONTACT_RANGE = 0.6

/**
 * Samples along the ray.
 *
 * Injected into the shader as a `#define` and used as a loop bound, which GLSL ES 1.0
 * requires to be constant — so this must stay an integer literal.
 */
export const CONTACT_STEPS = 8

/** How dark a fully occluded pixel goes. 1 would be black. */
export const CONTACT_STRENGTH = 0.55

/**
 * The view-space depth difference below which a "hit" is the surface finding itself.
 *
 * Without it every pixel occludes itself at the first step and the whole screen
 * darkens uniformly, which reads as the exposure being wrong rather than as a bug in
 * this file.
 */
export const CONTACT_BIAS = 0.02

/**
 * The difference above which the hit is something far behind rather than an occluder
 * near the surface.
 *
 * A screen-space march has no way to know whether the depth it sampled belongs to a
 * pebble one centimetre away or a mountain two hundred units back. Without this bound
 * every silhouette edge would trail a dark smear across the distance behind it.
 */
export const CONTACT_THICKNESS = 0.5

/**
 * Camera distances between which the effect fades away entirely.
 *
 * A fixed world-space range subtends fewer pixels the further away it is. Past a
 * certain depth all `CONTACT_STEPS` samples land within a pixel or two, the march stops
 * sampling anything meaningful, and what is left is noise that flickers as the camera
 * moves. Fading to nothing is the honest answer there.
 */
export const CONTACT_FADE_START = 40
export const CONTACT_FADE_END = 70

/**
 * The sun's direction in view space, which is the space the march happens in.
 *
 * `SUN_DIRECTION` is a world-space unit vector and the camera turns constantly, so this
 * is recomputed every frame. `transformDirection` applies the matrix's rotation and
 * renormalises, which is what a direction needs and what a full `applyMatrix4` would
 * get wrong by also applying the translation.
 *
 * The caller is responsible for `camera.matrixWorldInverse` being current. In practice
 * this runs after `renderer.render`, which updates it.
 */
export function sunDirectionInView(
  worldDirection: Vector3, camera: Camera, target: Vector3,
): Vector3 {
  return target.copy(worldDirection).transformDirection(camera.matrixWorldInverse)
}

/**
 * The pixel dimensions the depth target should have for a canvas of this size.
 *
 * Full resolution, deliberately: the fine detail at a contact is the entire point, and
 * a half-resolution pass would blur exactly the signal it exists to produce. It is a
 * named, tested rule rather than an inline expression because the one thing that must
 * not drift is this size against the canvas — a mismatch does not fail, it offsets every
 * sample by a fraction of a pixel and reads as a soft halo along every edge.
 *
 * Floored because a render target cannot have a fractional dimension and a device pixel
 * ratio readily produces one, and floored to at least 1 because `resize` runs before
 * layout in some embeddings and a zero-dimension target throws rather than degrading.
 */
export function depthTargetSize(
  canvasWidth: number, canvasHeight: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(canvasWidth)),
    height: Math.max(1, Math.floor(canvasHeight)),
  }
}

/**
 * The nodes the depth pass must hide while it renders.
 *
 * `scene.overrideMaterial` replaces the material on every mesh it draws — including its
 * `side`, its `depthWrite` and its `depthTest` — so two groups of objects that are
 * carefully arranged never to occlude anything would start writing depth. The sky dome
 * sets `depthWrite: false` and `side: BackSide` for exactly that reason, and every
 * attack effect that draws over the world sets `depthTest: false`; a gust fired toward
 * the camera would otherwise put a wall of near depth across the frame.
 *
 * The rule reuses `userData.excludeFromShadows`, which already exists for this question
 * and already marks both groups, so a future effect that opts out of the shadow map
 * opts out of this pass for free.
 *
 * **Deliberately wider than `enableShadows`, which collects meshes only.** A `Points`
 * renders under an override material and writes depth from its sprites, and
 * `src/world/wind-tell.ts` sets the flag on the `Group` above one. Collecting any
 * flagged node and hiding it covers such a child through visibility inheritance.
 */
export function excludedFromDepth(root: Object3D): Object3D[] {
  const excluded: Object3D[] = []
  root.traverse((node) => {
    if (node.userData.excludeFromShadows) excluded.push(node)
  })
  return excluded
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test -- --run src/fx/contact-shadow.test.ts`
Expected: PASS, all tests.

Run: `npm test -- --run`
Expected: PASS, whole suite.

Run: `npm run typecheck`
Expected: clean, both passes.

- [ ] **Step 5: Commit**

```bash
git add src/fx/contact-shadow.ts src/fx/contact-shadow.test.ts
git commit -m "Add the contact shadow pass's tunable constants and its testable rules"
```

---

### Task 2: The pass

**Files:**
- Create: `src/fx/contact-shadow-pass.ts`

**Interfaces:**
- Consumes, from Task 1: `CONTACT_BIAS`, `CONTACT_FADE_END`, `CONTACT_FADE_START`, `CONTACT_RANGE`, `CONTACT_STEPS`, `CONTACT_STRENGTH`, `CONTACT_THICKNESS`, `depthTargetSize`, `excludedFromDepth`, `sunDirectionInView`. From the existing codebase: `SUN_DIRECTION` from `../core/sun`.
- Produces:
  ```ts
  export interface ContactShadowPass {
    render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void
    resize(width: number, height: number): void
    dispose(): void
  }
  export function createContactShadowPass(width: number, height: number): ContactShadowPass
  ```
  Task 3 calls all three methods.

**Context you need, and most of it fails silently if you get it wrong.**

- **`MultiplyBlending` needs `premultipliedAlpha: true`.** Read `node_modules/three/src/renderers/webgl/WebGLState.js:686`: without it three.js logs `MultiplyBlending requires material.premultipliedAlpha = true` and applies no blend at all. With it the blend is `blendFuncSeparate(DST_COLOR, ONE_MINUS_SRC_ALPHA, ZERO, ONE)`, so a fragment output of `vec4(vec3(shade), 1.0)` gives `shade * dst` — a true multiply. **The output alpha must be 1.0**; at any lower alpha the second term adds unmultiplied destination back and the result is not a multiply.
- **The depth target must be cleared to white.** Packed depth lives in the colour channels. `unpackRGBAToDepth(vec4(1.0))` is 1.0 — the far plane — while the renderer's default black clear unpacks to 0.0, which is geometry pressed against the near plane. Cleared black, every pixel finds an occluder and the screen goes uniformly dark.
- **`NearestFilter` on both filters.** Interpolating packed RGBA depth between texels produces a value that is not any depth at all.
- **The built-in `projectionMatrix` uniform is the wrong matrix.** For a `ShaderMaterial` on a quad drawn with an orthographic camera, three.js sets `projectionMatrix` from *that* camera. The scene camera's matrices must be passed under different names — `uProjection` and `uProjectionInverse` below — or the reconstruction silently uses the ortho projection and produces garbage.
- **`toneMapped: false`.** `src/core/sky.ts` carries a hard-won comment about tone-mapping chunks: the renderer injects the `_pars_` declarations for a `ShaderMaterial` whose `toneMapped` is left on, and including them again fails the compile with redefinition errors that leave the object silently undrawn. This quad is a multiplier rather than a colour, so it must not be tone mapped, and turning the flag off is what keeps those chunks out.
- **Restore the previous `visible` value, not `true`.** Some flagged nodes are legitimately hidden already — `src/fx/aim-tell.ts` builds its preview mesh with `visible = false` and shows it only when a target is in the cone. Forcing them all visible afterwards would make the aim preview appear permanently. Hide only the ones that were visible, and re-show exactly those.
- The quad's vertex shader writes `gl_Position` straight from `position.xy`, so a `PlaneGeometry(2, 2)` fills the screen with no camera matrices involved. A camera is still required by `renderer.render`, so an `OrthographicCamera` is constructed and never configured.

- [ ] **Step 1: Write the pass**

Create `src/fx/contact-shadow-pass.ts`:

```ts
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
    // `src * DST_COLOR + dst * (1 - SRC_ALPHA)`, so any lower alpha adds unmultiplied
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
```

- [ ] **Step 2: Run the whole suite and the typecheck**

Run: `npm test -- --run`
Expected: PASS. This file has no tests of its own; the suite must stay green.

Run: `npm run typecheck`
Expected: clean, both passes. This is the only automated check on this file, so read it once more against the Global Constraints before committing — `premultipliedAlpha`, the white clear, `NearestFilter`, the five restores, and the alpha of exactly 1.

- [ ] **Step 3: Commit**

```bash
git add src/fx/contact-shadow-pass.ts
git commit -m "Draw a contact shadow term and multiply it over the finished frame"
```

---

### Task 3: Wire it into the game

**Files:**
- Modify: `src/core/renderer.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `createContactShadowPass` and `ContactShadowPass` from `../fx/contact-shadow-pass` (Task 2).
- Produces: `createRenderer`'s returned object gains `renderScene(scene, camera): void`. `src/main.ts` calls it in place of `renderer.render(scene, camera)`.

**Context you need.** `src/main.ts` has **two** `renderer.render(scene, camera)` calls — one in the stepper's render callback and one in the paused branch of `frame()`. Both must go through the pass. Missing the paused one would make the front door and every paused frame look different from play, and shipping exactly that defect twice is why this plan says so twice.

`src/core/renderer.ts` already owns a `resize()` that runs on construction and on every `window` resize event. The pass's `resize` belongs there, next to the renderer's own `setSize`, so there is one place that knows the canvas dimensions.

Exposing a `renderScene` function rather than the pass itself keeps `main.ts` unaware that a pass exists: it renders, and how many draws that takes is the renderer module's business.

- [ ] **Step 1: Create and resize the pass in `createRenderer`**

In `src/core/renderer.ts`, add the import:

```ts
import { createContactShadowPass } from '../fx/contact-shadow-pass'
```

After the `camera` is constructed and **before** `resize` is defined, add:

```ts
  /**
   * The contact shadow pass, which owns a depth target the size of the canvas.
   *
   * Constructed with the window's dimensions rather than the canvas's, because `resize`
   * below is what establishes the canvas size and it has not run yet.
   */
  const contactShadows = createContactShadowPass(window.innerWidth, window.innerHeight)
```

Inside `resize`, after `renderer.setSize(...)`:

```ts
    contactShadows.resize(width, height)
```

And add to the returned object:

```ts
    /**
     * Draw one frame, including the contact shadow pass.
     *
     * Callers use this instead of `renderer.render`. The pass performs the scene render
     * itself, in between rendering depth and multiplying the contact term over the
     * result, so calling both would draw the frame twice.
     */
    renderScene(scene: Scene, camera: PerspectiveCamera): void {
      contactShadows.render(renderer, scene, camera)
    },
```

- [ ] **Step 2: Route both render sites through it**

In `src/main.ts`, add `renderScene` to the destructuring of `createRenderer`:

```ts
  const { renderer, scene, camera, followSun, renderScene } = createRenderer(canvas)
```

Then replace **both** occurrences of `renderer.render(scene, camera)` with:

```ts
      renderScene(scene, camera)
```

One is in the `render` callback passed to `createStepper`; the other is in the paused branch of `frame()`. Search for `renderer.render` afterwards and confirm no occurrence remains in `src/main.ts`.

- [ ] **Step 3: Run the whole suite and the typecheck**

Run: `npm test -- --run`
Expected: PASS, unchanged count from Task 2.

Run: `npm run typecheck`
Expected: clean, both passes.

- [ ] **Step 4: Confirm the wiring cannot be silently absent**

`src/main.ts` has no tests, so demonstrate rather than assume. Grep for `renderer.render` in `src/main.ts` and confirm zero results, then run `npm run typecheck` once more and record in your report whether removing `renderScene` from the destructuring is caught by the typecheck. Report the actual answer either way — "nothing complains" is the outcome a reviewer most needs.

- [ ] **Step 5: Commit**

```bash
git add src/core/renderer.ts src/main.ts
git commit -m "Route both render paths through the contact shadow pass"
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/HANDOFF.md`

**Context.** The controller will have looked at the running game between Task 3 and this task and will supply what it saw, including any parameter that had to change and any artefact found. Ask for those findings before writing if they were not included in your dispatch — this section must not invent visual results.

- [ ] **Step 1: Write the handoff section**

Append a section to `docs/HANDOFF.md`, matching the structure and voice of the sections already there — read the last one first. Cover:

- What shipped: the pure module, the pass, the two wired render sites.
- **Why it composites over the finished frame instead of rendering through a chain**, with the MSAA reasoning: the conventional colour-target route would have put `antialias: true` at risk, and in a low-poly game long straight silhouette edges make AA one of the most visible things on screen. Note that the whole feature is reversible by deleting two calls.
- **The four traps**, each of which fails silently rather than loudly, and each of which was found by reading the three.js source rather than by debugging: `MultiplyBlending` needing `premultipliedAlpha`; the depth target needing a white clear because packed depth lives in the colour channels; `NearestFilter` because interpolated packed depth is not a depth; and the built-in `projectionMatrix` uniform belonging to the quad's camera rather than the scene's.
- **`excludedFromDepth` being deliberately wider than `enableShadows`**, and why: `src/world/wind-tell.ts` flags a `Group` above a `Points`, which `enableShadows` can ignore and this pass cannot.
- **The `visible` restore**, and that restoring `true` rather than the previous value would have left `aim-tell.ts`'s preview mesh on screen permanently.
- The numbers that are argued guesses: all seven constants.
- **The compounding unmeasured cost**: the 4096 map already added an unmeasured GPU cost, and this adds a second geometry submission plus a fullscreen pass. The harness only runs its render loop while its pane is frontmost, so no `requestAnimationFrame` probe completes — the same limitation recorded for the map.
- **What could not be looked at**: pointer lock is refused, so the pass can be seen on the paused front door and nowhere else. It cannot be watched while the camera moves, which is when a screen-space march shows its artefacts.
- Anything the controller reported from the running game, and anything a reviewer raised that was recorded rather than fixed.

- [ ] **Step 2: Run the suite and commit**

Run: `npm test -- --run`
Expected: PASS.

```bash
git add docs/HANDOFF.md
git commit -m "Write down what the contact shadow pass does and what it cost"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: the constants, `sunDirectionInView`, `depthTargetSize` and `excludedFromDepth` to Task 1; the depth-pass opt-out rule, the shader, the state restores and `toneMapped: false` to Task 2; both render sites and the resize to Task 3; `docs/HANDOFF.md` to Task 4. The spec's out-of-scope list needs no task by construction — no SSAO, no settings toggle, no half-resolution, no change to `sun.ts`'s constants — and nothing in the plan introduces any of them.

**Type consistency.** `ContactShadowPass`'s three methods are defined in Task 2 and called by the same names in Task 3. `createContactShadowPass(width, height)` takes the same two numbers `depthTargetSize` does. The seven constants are declared once in Task 1 and imported by the same names in Task 2. `renderScene(scene, camera)` is defined in Task 3 Step 1 and called in Step 2 with the same signature.

**One thing a reviewer should check rather than take on trust.** Tasks 2 and 3 have no tests between them — the shader cannot be compiled in the node environment and `main.ts` has never been tested. Task 3 Step 4 measures that rather than asserting it, and the five state restores in `render` are the highest-risk lines in the cycle: each one is invisible when correct and looks like the game breaking when wrong.
