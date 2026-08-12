# Contact Shadows

> **Status (2026-08-12): built, measured on screen, and removed. Nothing described below is in
> the codebase.** The pass's apparent effect turned out to be its own self-occlusion artefact;
> once the artefact was fixed the effect was invisible at this game's camera distance. This
> document is kept as the historical record of the design. For what was measured and why the
> pass came out, see "Contact shadows: built, measured, and removed" in `docs/HANDOFF.md`.

## The problem

The shadow map cannot resolve a contact. `SHADOW_MAP_SIZE` 4096 over a `SHADOW_EXTENT` of 90
gives 0.044 world units per texel, and PCF filters over a kernel on top of that, so the junction
where a tree trunk meets the ground — or a rock rests on it, or a character's feet land — is
softened away into the surrounding lit ground. Nothing darkens it.

There is also no ambient occlusion of any kind. The scene's fill light is a single
`HemisphereLight`, which lights every crevice as evenly as every exposed face, so a prop sitting
on the terrain has no gradient anywhere near its base. Together these are why props read as
pasted onto the ground rather than resting on it.

This is the last of the four shadow options this project has considered, and the only one that
addresses a deficiency the other three could not. The record of the other three is in
`docs/HANDOFF.md` and beside the constants in `src/core/sun.ts`:

- **VSM** — closed. No `normalBias` exists that is both free of terrain acne and solid enough to
  keep the character's shadow readable, at either map size.
- **A 4096 map** — shipped. A real if modest gain in shadow *detail*, at roughly 50 MB.
- **A smaller `SHADOW_EXTENT`** — closed. `sun.test.ts` pins its floor above the largest island's
  70-unit radius, so the whole usable range buys at most 1.27× texel density, and the largest
  safe step was indistinguishable side by side.

## Two findings that shape the design

**The project has no post-processing at all, and the main render path is worth protecting.**
There are exactly two `renderer.render(scene, camera)` calls in `src/main.ts` — the stepper's
render callback and the paused branch of `frame()` — and no `EffectComposer`, no
`WebGLRenderTarget`, no `setRenderTarget` anywhere in `src/`.

The conventional way to add a screen-space effect is to render the scene into a colour target
with a depth attachment, run the pass, and blit to the canvas. That costs the `antialias: true`
path: MSAA on the default framebuffer stops applying, and recovering it means a multisampled
render target and a resolve. In a low-poly game whose silhouettes are long straight edges,
antialiasing is one of the most visible things on screen — so that route trades a *certain*
visible regression for an uncertain gain.

**So the pass composites over the finished frame instead.** Render the scene's depth into a
render target using `scene.overrideMaterial`, let the normal `renderer.render` draw the canvas
exactly as it does today, then draw a single fullscreen quad over it with `MultiplyBlending` and
`renderer.autoClear = false`. MSAA, tone mapping, fog, and every existing `depthTest: false`
overlay behave precisely as they do now, because none of them are touched. The cost is submitting
the scene's geometry a second time — cheap, because that pass is depth-only with no shading — and
the whole thing is reversible by deleting two calls.

**Depth is packed into RGBA8, not a depth texture.** `MeshDepthMaterial` with
`RGBADepthPacking` writes into an ordinary colour target, and three.js ships
`unpackRGBAToDepth` in its own shader chunks to read it back. That avoids depending on
`WEBGL_depth_texture` and avoids the question of how a depth attachment resolves on a
multisampled target — neither of which this feature needs to answer.

## The change

### `src/fx/contact-shadow.ts` — new, pure, tested

The parts that are not the shader:

```ts
/** How far from a surface an occluder still counts, in world units. */
export const CONTACT_RANGE = 0.6
export const CONTACT_STEPS = 8
/** How dark a fully occluded pixel goes. 1 would be black. */
export const CONTACT_STRENGTH = 0.55
/** View-space depth difference below which a hit is the surface finding itself. */
export const CONTACT_BIAS = 0.02
/** Above this, the "occluder" is something far behind rather than near. */
export const CONTACT_THICKNESS = 0.5
/** Camera distances between which the effect fades out entirely. */
export const CONTACT_FADE_START = 40
export const CONTACT_FADE_END = 70

/**
 * The sun's direction in view space, which is what the march needs.
 *
 * `SUN_DIRECTION` is a world-space unit vector pointing from the scene toward the sun,
 * and the camera turns constantly, so this is recomputed per frame.
 */
export function sunDirectionInView(
  worldDirection: Vector3, camera: Camera, target: Vector3,
): Vector3

/** The pixel dimensions the depth target should have for a given canvas size. */
export function depthTargetSize(
  canvasWidth: number, canvasHeight: number,
): { width: number; height: number }
```

`CONTACT_RANGE` 0.6 is a **contact** distance rather than an ambient-occlusion radius — about a
third of the 1.8-unit character, so it darkens where a body, a trunk or a rock is genuinely
touching, and does not attempt to be a general occlusion term. Every number above is an argued
guess; nothing here has been played.

`CONTACT_FADE_START` and `CONTACT_FADE_END` exist because a fixed world-space range subtends
fewer pixels the further away it is. Past a certain depth the eight steps land inside one or two
pixels, the march stops sampling anything meaningful, and the result is noise that flickers as
the camera moves. Fading to 1 is the honest answer there rather than a cheaper march.

`depthTargetSize` returns the canvas dimensions unchanged and exists as a named, tested rule
rather than an inline expression, because the one thing that must not drift is the depth target's
size against the canvas: a mismatch does not fail, it silently offsets every sample by a fraction
of a pixel and reads as a soft halo along every edge. **Full resolution, deliberately** — the
fine detail at a contact is the entire point, and a half-resolution pass would blur exactly the
signal it exists to produce.

### What goes into the depth pass, which is not "everything"

`scene.overrideMaterial` replaces the material on **every** mesh it renders, including its
`side`, its `depthWrite` and its `depthTest`. Two groups in this scene must not contribute depth,
and both would if the pass were written naively:

- **The sky dome.** `src/core/sky.ts` sets `depthWrite: false` and `side: BackSide` precisely so
  the dome never occludes anything. An override material discards both. It is tempting to argue
  the dome is harmless because a `FrontSide` sphere viewed from inside has its front faces culled
  — but that is a chain of three defaults holding, and if any of them changes the whole screen
  fills with depth at the dome's radius.
- **Every attack effect that draws over the world.** `src/fx/gust-cone.ts`,
  `src/fx/dash-trail.ts`, `src/fx/aim-tell.ts` and their siblings deliberately set
  `depthTest: false` so terrain cannot bury them. Under an override they would write depth
  instead, and a gust fired at the camera would put a wall of near depth across the frame — the
  contact pass would read it as an occluder and darken everything behind it for the length of
  the effect.

**The rule reuses `userData.excludeFromShadows`**, which already exists for exactly this question
and already marks both groups: `enableShadows` in `src/core/sun.ts` skips those nodes, the sky
dome sets it, and each effect mesh sets it as it is built. The depth pass hides those nodes for
its duration and restores their previous `visible` values afterwards. That keeps one definition in
the codebase of "this mesh does not participate in shadowing", so a future effect that opts out of
the shadow map opts out of this pass for free rather than having to know it exists.

Restoring `visible` matters as much as restoring `overrideMaterial`: a node left hidden is
invisible in the *colour* pass too, which reads as an effect that failed to draw rather than as a
depth pass that forgot to clean up.

### The shader

Per pixel: unpack the stored depth, reconstruct the view-space position, then step toward the sun
in view space across `CONTACT_RANGE` in `CONTACT_STEPS` increments. Each step is projected back to
screen space and the stored depth there is compared against the ray's own depth. A sample counts
as an occluder when it is nearer than the ray by more than `CONTACT_BIAS` — below that the
surface is finding itself — and by less than `CONTACT_THICKNESS`, above which the hit is
something far behind rather than an occluder near the surface.

Occlusion accumulates across the steps, scales by `CONTACT_STRENGTH`, fades out with camera
distance, and the fragment outputs `1 - occlusion` as a greyscale value that `MultiplyBlending`
applies to the finished frame.

**`toneMapped: false` on the material, and this is the inverse of the lesson `src/core/sky.ts`
records.** That file has to `#include <tonemapping_fragment>` and `<colorspace_fragment>` so its
dome matches the tone-mapped terrain, and its comment warns against adding the matching `_pars_`
chunks because the renderer already injects them for a `ShaderMaterial` with `toneMapped` left
on. This quad is not a colour — it is a multiplier — so it must not be tone mapped at all, and
turning `toneMapped` off is what keeps those chunks from being injected in the first place.

### `src/fx/contact-shadow-pass.ts` — the WebGL half

Built the way the view modules are: a factory returning an object with the resources it owns and
a `dispose`. Untested for the reason they are untested — the node environment has no WebGL
context, so a render target cannot be created and a shader cannot be compiled.

```ts
export interface ContactShadowPass {
  /** Draw depth, then multiply the contact term over whatever is already in the canvas. */
  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void
  /** Match the depth target to a resized canvas. */
  resize(width: number, height: number): void
  dispose(): void
}
```

`render` sets the depth target, swaps in `scene.overrideMaterial`, renders, restores both, then
draws the quad with `renderer.autoClear = false` and puts `autoClear` back. Restoring the
override and the autoClear flag is the part that matters: leaving either set turns the next
ordinary frame into a depth-only or an un-cleared one, and both look like the game breaking
rather than like this pass misbehaving.

### Wiring

`src/main.ts` has two `renderer.render(scene, camera)` calls, and **both** get the pass —
the playing path and the paused path. Missing the paused one would make the front door and every
paused frame look different from play, which is the defect class this project has shipped twice.
The existing `resize` listener in `createRenderer` gains the pass's `resize`.

## Out of scope

- **SSAO.** The deficiency most visible in the current screenshots is arguably the absence of
  ambient occlusion rather than the coarseness of contact shadows, and this pass's plumbing —
  the depth target, the fullscreen quad, the multiply composite — is exactly what SSAO needs. It
  is the natural next occupant of this slot. But it is a different effect with a different radius,
  a different sampling pattern and its own tuning surface, and folding both into one cycle would
  make neither reviewable.
- **A settings toggle.** The infrastructure exists from the settings cycle, and this is the
  obvious follow-up, especially because frame cost cannot be measured in this environment. It
  needs a `Settings` field, a row, persistence and guide copy, which is its own small cycle.
- **Half-resolution or a temporal filter.** Both trade the fine detail this exists to produce.
- **Any change to `src/core/sun.ts`'s constants.** All three of that file's levers are settled
  and documented; this cycle adds a term beside them rather than retuning them.

## Testing

- `sunDirectionInView` against a camera with a known orientation, asserted as a **signed** vector
  rather than by magnitude: a sign error here marches the ray away from the light and darkens the
  lit side of every object, which is the one failure mode that would look deliberate.
- The same function with the camera yawed 90°, asserting the view-space direction rotates by the
  matching amount — so an implementation that ignored the camera and returned the world vector
  reddens. That mutant is the reason this function is tested at all, and it is the exact shape of
  a defect this project has shipped before: eight tests once shared a camera basis that was also
  three.js's default, so an implementation ignoring the camera passed all of them. The fixture
  here therefore uses a camera whose orientation is **not** the default `-Z`.
- The returned vector is normalised, and the function writes into the `target` it is given rather
  than allocating — asserted by identity, because this runs every frame and the no-allocation
  habit is what the rest of the presentation layer holds to.
- `depthTargetSize` at a typical canvas size, at a 1×1 canvas, and at a 0×0 canvas — the last
  because `resize` runs before layout in some embeddings and a zero-dimension render target
  throws in WebGL rather than degrading.
- **The opt-out collection, as a pure function over a scene graph.** `excludedFromDepth(root)`
  returns the nodes the depth pass must hide, tested against a hand-built `Object3D` tree —
  three.js's scene graph classes work in the node environment, since nothing about them needs a
  WebGL context. Asserted: a flagged mesh is collected, an unflagged mesh is not, a flagged node
  nested two levels deep is still found, and **a flagged `Group` is collected even though it is
  not a mesh.**

  That last case is the one worth spelling out, because it is a deliberate divergence from
  `enableShadows`, which collects meshes only. `src/world/wind-tell.ts` sets the flag on a
  `Group` whose child is a `Points`, and it is the only flag site in the codebase that is not on a
  mesh. `enableShadows` gets away with ignoring both — a `Group` has nothing to set `castShadow`
  on, and its `Points` child fails the `isMesh` test anyway — but this pass cannot: under
  `scene.overrideMaterial` a `Points` renders with the depth material and writes a screenful of
  near depth from its sprites. Hiding the flagged ancestor covers the child through visibility
  inheritance, which is why the rule is "any flagged node" rather than "any flagged mesh".

  Asserting the `Group` case is what stops someone narrowing this to match `enableShadows` for
  consistency and silently reintroducing the wind motes into the depth buffer.
- Every exported constant asserted to sit in the range its comment claims, and
  `CONTACT_FADE_START < CONTACT_FADE_END`, so a fade that runs backwards fails here rather than
  silently disabling the effect at close range.

Not tested, each for a stated reason: the shader (no WebGL context in the node environment), the
pass factory (it constructs a render target on line one), and `main.ts`'s wiring (untested by
standing property of this project, measured in an earlier cycle rather than assumed).

## What will not be verified

**Frame cost, and it is now a compounding risk.** The harness only runs its render loop while its
pane is frontmost, so no `requestAnimationFrame` timing probe can complete — this was established
while measuring the 4096 map and is unchanged. That map already added an unmeasured cost; this
cycle adds a second geometry submission and a fullscreen pass on top of it. Neither can be
measured here, and the exposure is on GPUs weaker than the development machine.

Whether the effect reads as grounding or as grime is also unverifiable beyond a still frame. The
harness cannot hold a pointer lock, so the pass can be looked at on the paused front door and
nowhere else — it cannot be watched while the camera moves, which is exactly when a screen-space
march shows its artefacts.
