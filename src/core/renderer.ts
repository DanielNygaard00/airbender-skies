import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, Vector3, Vector2,
  HemisphereLight, ACESFilmicToneMapping, PCFShadowMap,
} from 'three'
import { BASE_FOV } from '../fx/mapping'
import { createSkyDome, SKY_HORIZON } from './sky'
import { aimSun, createSun } from './sun'
import { createContactShadowPass } from '../fx/contact-shadow-pass'

export const WEBGL_MESSAGE =
  'This game needs WebGL, which your browser has disabled or does not support. ' +
  'Try a recent version of Chrome, Firefox, Safari, or Edge with hardware acceleration enabled.'

const FOG_NEAR = 400
/** Doubles as the camera's far plane, so the sky dome must sit inside it. */
export const FOG_FAR = 2200

/**
 * Tone mapping is what stops flat-lit geometry reading as raw WebGL: it rolls the
 * sunlit highlights off instead of clipping them to a hard white. The exposure
 * compensates for ACES darkening the midtones, and the light intensities below
 * were raised for the same reason.
 */
const EXPOSURE = 1.0

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** Reveal the fallback message and hide the canvas. Never leaves a blank screen. */
export function showFallback(message: string): void {
  const fallback = document.getElementById('fallback')
  const canvas = document.getElementById('game')
  if (canvas) canvas.style.display = 'none'
  if (fallback) {
    fallback.style.display = 'block'
    fallback.textContent = message
  }
}

export function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = EXPOSURE
  renderer.shadowMap.enabled = true
  /*
   * `PCFShadowMap`, named explicitly, and the history matters because the obvious
   * "improvement" here has already been tried and measured.
   *
   * This line asked for `PCFSoftShadowMap` until three.js 0.185 deprecated it. From
   * then on the library logged a warning to the console and silently substituted this
   * harder `PCFShadowMap` — so the game rendered these shadows either way, while the
   * comment above claimed soft ones. Naming the real value is the fix: the line now
   * says which shadows the game draws, and the console is quiet.
   *
   * **VSM is the surviving soft option and it does not work in this scene.** Measured
   * on the home island at the spawn view, varying `shadow.normalBias`:
   *
   *   0, 0.05, 0.1 — every slope banded with its own shadow, wide concentric stripes
   *   0.2          — acne gone, shadows visibly washed out
   *   0.6          — acne gone, the character's shadow a faint featureless smudge
   *
   * There is no window between the two failures. Below roughly 0.2 the terrain shadows
   * itself; at and above it, VSM's variance test bleeds enough light that the
   * character's shadow — the one shadow a player actually looks at — stops reading as a
   * body carrying a staff. Tightening the shadow camera from 1..640 to 100..510 to buy
   * depth precision was tried alongside and changed nothing measurable. VSM would also
   * add two separable blur passes over the whole shadow map every frame.
   *
   * And the premise turned out to be weak anyway: at this map resolution over a
   * 90-unit `SHADOW_EXTENT`, from the distance the follow cam watches, PCF's tree and
   * character shadows already read as soft-edged *and* keep their silhouettes. The
   * deprecation was a real defect in what this file claimed and close to a non-issue in
   * what the player saw — the opposite of how it looked from the warning alone.
   *
   * The 4096 map has since been tried, and it is worth knowing what it did and did not
   * do. It sharpens PCF's shadows visibly at 1:1 — it is a *detail* lever, not a softness
   * one, since PCF's kernel is fixed in texel space and smaller texels make edges
   * crisper — and it is now what `SHADOW_MAP_SIZE` is set to. It does **not** rescue VSM:
   * retested at 4096, the acne threshold barely moved (still banded at `normalBias` 0.2,
   * where the character's shadow is already washing out), which says texel footprint was
   * never what drove it. A smaller `SHADOW_EXTENT` has since been tried too, and it is
   * exhausted: `sun.test.ts` pins its floor just above the largest island's 70-unit
   * radius, so the whole usable range buys at most 1.27 times the texel density, and the
   * largest safe step was indistinguishable side by side. There is no lever left here —
   * and in particular no way to recover the 4096 map's memory without giving up its
   * density, which this file previously claimed there was. Not another pass at VSM.
   */
  renderer.shadowMap.type = PCFShadowMap

  const scene = new Scene()
  // A fallback for anything the dome does not cover, and the colour the fog fades
  // distant geometry into, so islands dissolve into the horizon band.
  scene.background = new Color(SKY_HORIZON)
  // Fog hides the empty void between islands and sells the sense of altitude.
  scene.fog = new Fog(SKY_HORIZON, FOG_NEAR, FOG_FAR)
  scene.add(createSkyDome())

  scene.add(new HemisphereLight(SKY_HORIZON, 0x4a5a3a, 1.5))
  const sun = createSun()
  scene.add(sun)
  // The light aims at its target object, which has to be in the graph to be found.
  scene.add(sun.target)
  aimSun(sun, new Vector3())

  const camera = new PerspectiveCamera(BASE_FOV, 1, 0.5, FOG_FAR)

  /**
   * Scratch for `renderer.getDrawingBufferSize`, reused rather than allocated on
   * construction and on every `resize` call below.
   */
  const drawingBufferSize = new Vector2()

  /**
   * The contact shadow pass, which owns a depth target that must align pixel-for-pixel
   * with the canvas it reads from and draws over.
   *
   * Sized from `renderer.getDrawingBufferSize`, not from `window.innerWidth/innerHeight`.
   * `setPixelRatio` above makes the WebGL drawing buffer up to twice the window's CSS
   * pixel dimensions — on a device pixel ratio of 2, an 800x450 window produces a
   * 1600x900 drawing buffer — so sizing the depth target from the window would hand it a
   * quarter of the pixels of the canvas it has to line up with. `contact-shadow.ts`'s
   * `depthTargetSize` is "Full resolution, deliberately", and that comment is only true
   * if the resolution it is handed is the canvas's real one. The mismatch would not
   * throw or warn — every sample would land a fraction of a pixel off from where it
   * should, which reads as a soft halo along every edge in the finished frame.
   */
  renderer.getDrawingBufferSize(drawingBufferSize)
  const contactShadows = createContactShadowPass(drawingBufferSize.x, drawingBufferSize.y)

  function resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
    // Read back after `setSize`, not before: the drawing buffer only reflects the new
    // dimensions once the renderer has actually resized, and reading the window's own
    // width/height here would reintroduce the pixel-ratio mismatch described above.
    renderer.getDrawingBufferSize(drawingBufferSize)
    contactShadows.resize(drawingBufferSize.x, drawingBufferSize.y)
  }
  resize()
  window.addEventListener('resize', resize)

  /**
   * Keep the shadow frustum over the player. One map cannot cover the whole
   * archipelago at a useful resolution, so it follows them instead.
   */
  function followSun(target: Vector3): void {
    aimSun(sun, target)
  }

  /**
   * Draw one frame, including the contact shadow pass.
   *
   * Callers use this instead of `renderer.render`. The pass performs the scene render
   * itself, in between rendering depth and multiplying the contact term over the
   * result, so calling both would draw the frame twice.
   */
  function renderScene(scene: Scene, camera: PerspectiveCamera): void {
    contactShadows.render(renderer, scene, camera)
  }

  return { renderer, scene, camera, resize, followSun, renderScene }
}
