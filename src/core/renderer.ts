import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog,
  HemisphereLight, DirectionalLight,
} from 'three'
import { BASE_FOV } from '../fx/mapping'

export const WEBGL_MESSAGE =
  'This game needs WebGL, which your browser has disabled or does not support. ' +
  'Try a recent version of Chrome, Firefox, Safari, or Edge with hardware acceleration enabled.'

const SKY_COLOUR = 0x9dc4e8
const FOG_NEAR = 400
const FOG_FAR = 2200

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

  const scene = new Scene()
  scene.background = new Color(SKY_COLOUR)
  // Fog hides the empty void between islands and sells the sense of altitude.
  scene.fog = new Fog(SKY_COLOUR, FOG_NEAR, FOG_FAR)

  scene.add(new HemisphereLight(SKY_COLOUR, 0x4a5a3a, 1.5))
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
