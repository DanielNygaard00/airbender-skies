import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog,
  HemisphereLight, DirectionalLight, ACESFilmicToneMapping,
} from 'three'
import { BASE_FOV } from '../fx/mapping'
import { createSkyDome, SKY_HORIZON } from './sky'

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

  const scene = new Scene()
  // A fallback for anything the dome does not cover, and the colour the fog fades
  // distant geometry into, so islands dissolve into the horizon band.
  scene.background = new Color(SKY_HORIZON)
  // Fog hides the empty void between islands and sells the sense of altitude.
  scene.fog = new Fog(SKY_HORIZON, FOG_NEAR, FOG_FAR)
  scene.add(createSkyDome())

  scene.add(new HemisphereLight(SKY_HORIZON, 0x4a5a3a, 1.5))
  const sun = new DirectionalLight(0xfff2d8, 1.8)
  sun.position.set(200, 400, 150)
  scene.add(sun)

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

  return { renderer, scene, camera, resize }
}
