import { HalfFloatType, Vector2, type Camera, type Scene, type WebGLRenderer } from 'three'
import {
  BloomEffect, BrightnessContrastEffect, type Effect, EffectComposer, EffectPass,
  HueSaturationEffect, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing'
import type { QualityProfile } from './quality'

/**
 * The post-processing pipeline, behind four methods.
 *
 * **Why a seam rather than setup inlined in `main.ts`.** The composer is the one part of this
 * step that cannot be tested for correctness in this project — there is no DOM and no GL
 * context in the test environment, so nothing here can be exercised. Putting it behind an
 * interface keeps that untestable surface four methods wide and leaves the decisions it acts
 * on — which effects exist at which tier, and which of them may share a pass — as pure
 * functions that are fully tested.
 *
 * **Why pmndrs `postprocessing` rather than three's `examples/jsm` composer.** Pass count.
 * The pmndrs library merges independent effects into a single fullscreen pass through
 * `EffectPass`, where three's composer runs one fullscreen pass per effect. Bloom, the grade
 * and tone mapping as one pass instead of three is the difference between fitting the frame
 * budget and not, on the machines the low tier exists for. Antialiasing is the one effect
 * that cannot join them, and `postPasses` records why.
 *
 * **Why a half-float buffer.** Bloom needs headroom above white to bloom *from*. In an 8-bit
 * buffer every bright thing has already clipped to 1.0 by the time the bloom pass reads it,
 * so the sun and a white wall bloom identically.
 */
export type PostEffectName = 'bloom' | 'grade' | 'tone-mapping' | 'smaa'

/**
 * Which effects a tier asks for, in the order they must run.
 *
 * The order is the part worth testing and the part a reader will not guess: bloom and the
 * grade operate on scene colour, tone mapping maps that range down to the display, and SMAA
 * has to be last because it reads the composited image. Smoothing before the grade means
 * grading the smoothed edges back into hard ones.
 *
 * This is the *intent*. It is not by itself what ships, because `EffectPass` re-orders the
 * effects handed to one pass — see `postPasses`, which is where the order above is actually
 * enforced.
 */
export function postEffects(p: QualityProfile): readonly PostEffectName[] {
  if (!p.composer) return []
  const list: PostEffectName[] = []
  if (p.bloom) list.push('bloom')
  if (p.grade) list.push('grade')
  list.push('tone-mapping')
  if (p.smaa) list.push('smaa')
  return list
}

/**
 * The same effects, grouped into the `EffectPass`es they actually ship as.
 *
 * **Why not one pass over the whole list, which is what this module used to do.**
 * `EffectPass` re-orders what it is given: `setEffects` sorts the effects by attribute
 * bitmask, descending. `SMAAEffect` declares `CONVOLUTION | DEPTH`, which is 3; bloom,
 * brightness/contrast, hue/saturation and tone mapping are all `NONE`, which is 0. So a
 * single merged pass runs SMAA *first* — the exact inversion `postEffects` forbids, applied
 * silently, with the call site still reading in the right order. Bloom-before-grade survives
 * the merge only because those attributes are equal and the sort is stable.
 *
 * So SMAA gets its own pass, added after the merged one. This split is the whole guarantee
 * that antialiasing runs last: it is not an implementation detail of `build` below, which is
 * why it is a pure function with tests rather than a loop nobody can exercise.
 *
 * The cost is one extra fullscreen pass on the composited tiers. The alternative is
 * antialiasing that smooths edges the grade and the tone map then re-harden — and, less
 * obviously, SMAA reading a linear HDR image: its default `EdgeDetectionMode.COLOR`
 * threshold of 0.1 is calibrated for display-referred 0–1 values, which is what it now gets,
 * because after this split it reads the tone-mapped result rather than the scene's raw
 * radiance.
 */
export function postPasses(p: QualityProfile): readonly (readonly PostEffectName[])[] {
  const all = postEffects(p)
  const merged = all.filter((name) => name !== 'smaa')
  const passes: PostEffectName[][] = []
  if (merged.length > 0) passes.push(merged)
  if (all.includes('smaa')) passes.push(['smaa'])
  return passes
}

/**
 * Bloom, tuned to bite on light rather than on paint.
 *
 * The threshold is the load-bearing number: below roughly 0.8 the pale terrain and the
 * horizon band start glowing, which reads as fog rather than as light. Mipmap blur rather
 * than a kernel pass because it is both cheaper and wider, and a narrow bloom looks like a
 * halo sticker rather than air scattering light.
 */
const BLOOM = { intensity: 0.9, luminanceThreshold: 0.82, luminanceSmoothing: 0.2, mipmapBlur: true }

/**
 * The grade: a trim, not a look.
 *
 * ACES darkens midtones, and nothing compensates for that — `EXPOSURE` in `renderer.ts` is
 * 1.0 and always has been, so the graded image is the tone-mapped one with a trim on top,
 * not a brightened one. That trim is what separates a graded image from a tone mapped one.
 * Kept deliberately subtle — anything stronger is a colour direction, and a colour direction
 * belongs in a step where it can be judged against the elemental effects it has to leave
 * readable.
 *
 * `renderer.toneMappingExposure` looks dead once the composer owns tone mapping, and it is
 * not: the `ToneMappingEffect` shader includes three's `<tonemapping_pars_fragment>`, which
 * declares a `toneMappingExposure` uniform, and three uploads `renderer.toneMappingExposure`
 * into any program that declares it. So the renderer's exposure still reaches ACES on the
 * composited tiers, which is what keeps the curve identical to the pre-composer build.
 */
const GRADE = { brightness: 0, contrast: 0.06, saturation: 0.08 }

/**
 * Hardware MSAA *inside* the composer, because the canvas's own is unreachable from here.
 *
 * The canvas is created with `antialias: true`, but that buffer only antialiases what is
 * drawn to the canvas. Once `RenderPass` renders the world into a composer render target
 * instead, the canvas's multisample buffer is bypassed entirely — and
 * `EffectComposer`'s `multisampling` option defaults to `0`, so the world was being
 * rasterised into a target with no multisampling at all. That left SMAA as a *substitute*
 * for MSAA on the composited tiers rather than a supplement to it, which is a concrete route
 * to high tier being more aliased than the build it replaces. "Nothing changed but the
 * passes" does not survive that, so it is fixed here rather than noted.
 *
 * **4 samples, and one number rather than a `QualityProfile` field.** Frame cost could not be
 * measured on this machine — the browser harness only runs its render loop while its pane is
 * frontmost, the same limitation `sun.ts` records against the 4096 shadow map — so a per-tier
 * split would be a guess wearing the clothes of a measurement. Requires WebGL 2, which
 * `hasWebGL` already prefers.
 */
const MULTISAMPLING = 4

export interface Post {
  /** Draw one frame. `dt` is real frame time, in seconds. */
  render(dt: number): void
  setSize(width: number, height: number): void
  /** Rebuild for a new tier. Safe to call with the tier already in force. */
  setProfile(p: QualityProfile): void
  dispose(): void
}

/** The effects one name stands for. `grade` is two, which is why this returns a list. */
function effectsFor(name: PostEffectName): Effect[] {
  switch (name) {
    case 'bloom':
      return [new BloomEffect(BLOOM)]
    case 'grade':
      return [
        new BrightnessContrastEffect({
          brightness: GRADE.brightness, contrast: GRADE.contrast,
        }),
        new HueSaturationEffect({ saturation: GRADE.saturation }),
      ]
    case 'tone-mapping':
      return [new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })]
    case 'smaa':
      return [new SMAAEffect()]
  }
}

export function createPost(
  renderer: WebGLRenderer, scene: Scene, camera: Camera, profile: QualityProfile,
): Post {
  let composer: EffectComposer | null = null
  let current = profile
  // Reused rather than allocated per call: `render` reads one of these every frame.
  const cssSize = new Vector2()
  const deviceSize = new Vector2()

  function build(p: QualityProfile): void {
    teardown()
    if (!p.composer) return

    const made = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType, multisampling: MULTISAMPLING,
    })
    made.addPass(new RenderPass(scene, camera))
    for (const group of postPasses(p)) {
      made.addPass(new EffectPass(camera, ...group.flatMap(effectsFor)))
    }
    /**
     * **The unit trap, which is what the composer's original sizing got wrong.**
     * `EffectComposer.setSize(width, height)` takes *CSS* pixels, not device pixels:
     * internally it compares its arguments against `renderer.getSize()` (CSS) and calls
     * `renderer.setSize()` if they differ, then derives its own render-target sizes from
     * `renderer.getDrawingBufferSize()` (device). `renderer.domElement.width/height` — what
     * this used to pass — are the canvas's drawing-buffer attributes, already multiplied by
     * the pixel ratio, so they are a device-pixel number handed to a CSS-pixel parameter. On
     * any retina display that made the numbers disagree, so the composer *resized the
     * renderer* to the device-pixel figure, and with `updateStyle` left at its default of
     * `true` it rewrote the canvas's CSS size with it. Every caller of `Post.setSize` has to
     * agree on the unit for this to work at all: the resize hook is fed `window.innerWidth
     * /innerHeight`, which are CSS pixels, so construction starts from the same kind of
     * source — `renderer.getSize()`.
     *
     * **What was observed, kept separate from the mechanism.** Two symptoms went away when
     * the units were corrected and the bench was subscribed to the resize hook: a startup
     * flicker in the game, where the first frames rendered ungraded before snapping to
     * graded, and a black bench reporting `GL_INVALID_FRAMEBUFFER_OPERATION: Attachment has
     * zero size` on every draw call. The route from a too-large size to a driver complaint
     * about a *zero* size was never traced, and the earlier explanation here — that
     * `renderer.getSize()` legitimately reads `0x0` at this point — does not hold up: a
     * `window.innerWidth` of `0` would come back as `0` from `getSize()` too, so it cannot be
     * what the unit change fixed. The unit mismatch is what was wrong and what was fixed; the
     * exact path to that particular error string is unexplained.
     *
     * Sizing here at all is belt-and-braces: `EffectComposer`'s constructor already sizes
     * itself from `renderer.getSize()` and `addPass` sizes each pass as it is added. It stays
     * because it is the one line that states the unit, and because `render` below re-checks
     * it every frame rather than trusting this moment.
     */
    renderer.getSize(cssSize)
    made.setSize(cssSize.width, cssSize.height)
    composer = made
  }

  function teardown(): void {
    if (composer === null) return
    composer.dispose()
    composer = null
    // `EffectComposer`'s constructor sets `renderer.autoClear = false` and `dispose()` never
    // puts it back, so a high-to-low switch would leave the fallback render below clearing
    // nothing. Restored to three's default rather than to a remembered value: nothing in this
    // project ever sets it to anything else.
    renderer.autoClear = true
  }

  /**
   * Re-size the composer when its buffers no longer match the canvas.
   *
   * The previous design made a correct initial size the caller's problem: if `createPost` ran
   * before the page had its final size, only a real `resize` event could put it right — and a
   * player who never touches the window never generates one, so a bad size would last the
   * life of the page. This is once-per-frame and self-healing instead, so no user action is
   * load-bearing.
   *
   * Compared in *device* pixels — the composer's render targets against
   * `renderer.getDrawingBufferSize()` — rather than in CSS pixels against `renderer
   * .getSize()`. That is the invariant the composer actually maintains, and it also catches a
   * pixel-ratio change, which moves the drawing buffer without moving `getSize()`.
   *
   * The limit, stated rather than hidden: this cannot invent a size the renderer does not
   * have. If `renderer.getSize()` is genuinely `0x0` then so is the drawing buffer, nothing
   * is renderable anyway, and the next `resize()` fixes renderer and composer together.
   */
  function healSize(made: EffectComposer): void {
    renderer.getDrawingBufferSize(deviceSize)
    if (made.inputBuffer.width === deviceSize.width
      && made.inputBuffer.height === deviceSize.height) return
    renderer.getSize(cssSize)
    made.setSize(cssSize.width, cssSize.height)
  }

  build(profile)

  return {
    render(dt: number): void {
      // The bypass, and the reason `toneMappingOwner` exists: on the low tier this draws
      // straight to the canvas and the renderer is the one applying ACES.
      if (composer) {
        healSize(composer)
        composer.render(dt)
      } else renderer.render(scene, camera)
    },
    setSize(width: number, height: number): void {
      composer?.setSize(width, height)
    },
    setProfile(p: QualityProfile): void {
      if (p === current) return
      current = p
      build(p)
    },
    dispose: teardown,
  }
}
