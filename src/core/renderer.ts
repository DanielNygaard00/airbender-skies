import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, Vector3,
  HemisphereLight, ACESFilmicToneMapping, NoToneMapping, PCFShadowMap,
} from 'three'
import { BASE_FOV } from '../fx/mapping'
import { createSkyDome } from './sky'
import { aimSun, createSun } from './sun'
import { toneMappingOwner, type QualityProfile } from './quality'
import { daylightFor, SUN_ELEVATION_DEGREES } from './daylight'

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

export function createRenderer(
  canvas: HTMLCanvasElement,
  profile: QualityProfile,
  /**
   * Defaulted so `main.ts`'s call site is untouched and the shipped game's look cannot move.
   * The one caller that needs a different value is the FX bench: it has to be able to
   * photograph a different hour without a day/night cycle, which still does not exist and
   * is not being added here — `daylight.ts` requires the sun's *direction* to stay constant
   * so the shadow map's frustum and the bench's determinism are unaffected either way. Only
   * the derived colours change; `SUN_DIRECTION` itself is untouched.
   */
  elevationDegrees: number = SUN_ELEVATION_DEGREES,
) {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  /*
   * `antialias` stays on for the life of the renderer, and it is not a leftover.
   * `WebGLRenderer` takes the flag at construction, so changing it means rebuilding the
   * renderer — and with it every material, texture and shadow map in the scene. Quality is a
   * live setting, so that is not on the table. The consequence is deliberate: the composited
   * tiers pay for a multisample buffer they do not use, and the low tier, which bypasses the
   * composer and therefore has no SMAA, gets antialiasing out of it. That is the right way
   * round — the tier that cannot afford SMAA is the one that keeps its MSAA.
   */
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

  // One number, five consumers. See daylight.ts for why they must agree.
  const light = daylightFor(elevationDegrees)

  const scene = new Scene()
  // A fallback for anything the dome does not cover, and the colour the fog fades
  // distant geometry into, so islands dissolve into the horizon band.
  scene.background = new Color(light.skyHorizon)
  // Fog hides the empty void between islands and sells the sense of altitude.
  scene.fog = new Fog(light.fogColour, FOG_NEAR, FOG_FAR)
  scene.add(createSkyDome(light.skyZenith, light.skyHorizon))

  scene.add(new HemisphereLight(light.hemiSky, light.hemiGround, light.hemiIntensity))
  const sun = createSun(profile.shadowMapSize)
  // The light's colour is a property with a public setter, and a three-argument factory
  // would put two things that always travel together behind separate parameters.
  sun.color.setHex(light.sunColour)
  sun.intensity = light.sunIntensity
  scene.add(sun)
  // The light aims at its target object, which has to be in the graph to be found.
  scene.add(sun.target)
  aimSun(sun, new Vector3())

  const camera = new PerspectiveCamera(BASE_FOV, 1, 0.5, FOG_FAR)

  /**
   * Extra listeners for the one resize this module already owns.
   *
   * The composer keeps its own render targets and has to be resized with the canvas. The
   * alternative — a second `window` listener in `main.ts` — would work by luck: two
   * listeners on the same event have an order, and the composer resizing before the
   * renderer would size its targets to the previous frame's dimensions.
   */
  const resizeHooks: ((width: number, height: number) => void)[] = []

  function resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
    for (const hook of resizeHooks) hook(width, height)
  }

  /**
   * Applying a tier. Three things move: how many pixels are drawn, how big the shadow map
   * is, and who tone maps.
   *
   * The shadow map is disposed rather than resized in place. `mapSize` is read when the map
   * is allocated, so setting it on a live light changes nothing until the existing render
   * target is thrown away — which looks exactly like the tier not working.
   */
  function applyProfile(p: QualityProfile): void {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatioCap))
    renderer.toneMapping =
      toneMappingOwner(p) === 'renderer' ? ACESFilmicToneMapping : NoToneMapping
    renderer.toneMappingExposure = EXPOSURE
    if (sun.shadow.mapSize.x !== p.shadowMapSize) {
      sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    }
    resize()
  }
  applyProfile(profile)
  window.addEventListener('resize', resize)

  /**
   * Keep the shadow frustum over the player. One map cannot cover the whole
   * archipelago at a useful resolution, so it follows them instead.
   */
  function followSun(target: Vector3): void {
    aimSun(sun, target)
  }

  return {
    renderer, scene, camera, resize, followSun, applyProfile,
    onResize(fn: (width: number, height: number) => void): void { resizeHooks.push(fn) },
  }
}
