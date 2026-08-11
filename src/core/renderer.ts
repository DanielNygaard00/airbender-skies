import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, Vector3,
  HemisphereLight, ACESFilmicToneMapping, VSMShadowMap,
} from 'three'
import { BASE_FOV } from '../fx/mapping'
import { createSkyDome, SKY_HORIZON } from './sky'
import { aimSun, createSun } from './sun'

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
  // Soft edges suit the stylised look; hard shadow edges make the low-poly terrain
  // read as jagged rather than faceted.
  //
  // Variance shadow mapping, and the reason it is not `PCFSoftShadowMap` is worth
  // knowing: that constant was what this line asked for until three.js 0.185
  // deprecated it, after which the library logged a warning and silently substituted
  // the *harder* `PCFShadowMap`. So the game rendered hard shadows for as long as the
  // deprecation stood, while this comment claimed soft ones — nobody had read the
  // console. VSM is the surviving soft option, and unlike PCF its blur is a real
  // penumbra measured in shadow-map texels rather than a fixed tap pattern, which is
  // why the softness is tunable at all.
  //
  // **What the switch actually bought, measured on the home island rather than
  // assumed: less than it cost.** VSM needs `normalBias` 0.6 to stop the terrain
  // shadowing itself, and at that offset its variance test bleeds enough light that the
  // character's own shadow — the one shadow a player looks at — degrades from a readable
  // body-and-staff silhouette into a faint grey smudge. Below 0.2 the island is banded
  // with concentric stripes instead. There is no setting that is both clean and solid;
  // `SHADOW_NORMAL_BIAS` in `src/core/sun.ts` carries the full table, and two extra
  // separable blur passes over a 2048-square map every frame is the standing cost.
  //
  // Meanwhile the substituted `PCFShadowMap` was never the hard-edged failure the
  // deprecation implied. At this map resolution over a 90-unit extent, and at the
  // distance the follow cam actually watches from, its tree and character shadows
  // already read as soft-edged — and they keep their silhouettes. The deprecation was a
  // real defect in what this file *claimed* and close to a non-issue in what the player
  // saw, which is the opposite of how it looked from the console warning alone.
  //
  // If this goes back to PCF, name `PCFShadowMap` explicitly rather than restoring the
  // deprecated constant: the whole point is that this line should say which shadows the
  // game is rendering.
  renderer.shadowMap.type = VSMShadowMap

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

  function resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
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

  return { renderer, scene, camera, resize, followSun }
}
