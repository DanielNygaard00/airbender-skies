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
 * interface keeps that untestable surface four methods wide and leaves the decision it acts
 * on — which effects exist at which tier — as a pure function that is fully tested.
 *
 * **Why pmndrs `postprocessing` rather than three's `examples/jsm` composer.** Pass count.
 * The pmndrs library merges independent effects into a single fullscreen pass through
 * `EffectPass`, where three's composer runs one fullscreen pass per effect. Bloom, the grade
 * and tone mapping as one pass instead of three is the difference between fitting the frame
 * budget and not, on the machines the low tier exists for.
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
 * ACES already darkens midtones, which the renderer's exposure was raised to compensate for.
 * A small contrast and saturation lift on top is what separates a graded image from a tone
 * mapped one. Kept deliberately subtle — anything stronger is a colour direction, and a
 * colour direction belongs in a step where it can be judged against the elemental effects it
 * has to leave readable.
 */
const GRADE = { brightness: 0, contrast: 0.06, saturation: 0.08 }

export interface Post {
  /** Draw one frame. `dt` is real frame time, in seconds. */
  render(dt: number): void
  setSize(width: number, height: number): void
  /** Rebuild for a new tier. Safe to call with the tier already in force. */
  setProfile(p: QualityProfile): void
  dispose(): void
}

export function createPost(
  renderer: WebGLRenderer, scene: Scene, camera: Camera, profile: QualityProfile,
): Post {
  let composer: EffectComposer | null = null
  let current = profile

  function build(p: QualityProfile): void {
    teardown()
    if (!p.composer) return

    const made = new EffectComposer(renderer, { frameBufferType: HalfFloatType })
    made.addPass(new RenderPass(scene, camera))

    const effects: Effect[] = []
    for (const name of postEffects(p)) {
      if (name === 'bloom') effects.push(new BloomEffect(BLOOM))
      if (name === 'grade') {
        effects.push(new BrightnessContrastEffect({
          brightness: GRADE.brightness, contrast: GRADE.contrast,
        }))
        effects.push(new HueSaturationEffect({ saturation: GRADE.saturation }))
      }
      if (name === 'tone-mapping') {
        effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }))
      }
      if (name === 'smaa') effects.push(new SMAAEffect())
    }
    // One EffectPass over the whole list, which is the reason this library was chosen: the
    // effects are merged into a single fullscreen shader rather than run as a pass each.
    made.addPass(new EffectPass(camera, ...effects))
    /**
     * **The unit trap.** `EffectComposer.setSize(width, height)` takes *CSS* pixels, not
     * device pixels: internally it compares its arguments against `renderer.getSize()` (CSS)
     * to decide whether to re-call `renderer.setSize()`, and only afterwards reads
     * `renderer.getDrawingBufferSize()` to size its actual render targets. `renderer
     * .domElement.width/height` are the canvas's drawing-buffer attributes — already
     * multiplied by the pixel ratio — so passing them here is a device-pixel number handed
     * to a CSS-pixel parameter. Every caller of `Post.setSize` has to agree on the same
     * units for this to work at all: the resize hook below calls it with `window.innerWidth
     * /innerHeight`, which are CSS pixels, so construction has to start from the same source
     * — `renderer.getSize()` — rather than from the canvas's own attributes.
     *
     * **The construction-order trap.** `createRenderer` calls its own `resize()` once during
     * construction, before this module or its caller exist to subscribe to the resize hook —
     * so this call is the composer's *only* sizing until a real `resize` event fires. If the
     * page has not finished laying out yet at that point, `renderer.getSize()` can still
     * legitimately read as `0x0` here: this call cannot fix that by itself, which is why the
     * caller is also required to route the resize hook to `setSize` (see `Post.setSize`
     * below) so a subsequent real resize corrects a bad initial size instead of leaving it
     * wrong for the life of the renderer.
     */
    const cssSize = renderer.getSize(new Vector2())
    made.setSize(cssSize.width, cssSize.height)
    composer = made
  }

  function teardown(): void {
    composer?.dispose()
    composer = null
  }

  build(profile)

  return {
    render(dt: number): void {
      // The bypass, and the reason `toneMappingOwner` exists: on the low tier this draws
      // straight to the canvas and the renderer is the one applying ACES.
      if (composer) composer.render(dt)
      else renderer.render(scene, camera)
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
