import { Color, MathUtils } from 'three'
import { SKY_HORIZON, SKY_ZENITH } from './sky'
import { SUN_DIRECTION } from './sun'

/**
 * Sky, fog and light derived from one number: how high the sun is.
 *
 * **Why bind them together.** Zenith colour, horizon band, fog colour, sun colour and
 * hemisphere fill are one physical phenomenon, and a scene where they disagree looks wrong in
 * a way players notice without being able to name. Before this module they were five
 * independently chosen constants in three files, so trying a warmer hour meant editing all of
 * them consistently — which is the kind of edit that gets done inconsistently.
 *
 * **The elevation is authored, not animated.** There is no day/night cycle here and this is
 * not an oversight. `sun.ts` requires the sun's *direction* to be constant, because the
 * shadow map follows the player and a moving sun would swing every shadow in the world. A
 * moving sun would also destroy the FX bench, whose whole value is that two screenshots taken
 * a week apart differ only by what changed in the code.
 *
 * **The shipped elevation reproduces the game's existing palette exactly**, which is what
 * makes "this step changed nothing but the passes" a claim a test can hold rather than an
 * assurance. Of the three stops below, only `SHIPPED` is anchored — every value in it is
 * copied from the file that owns it today (`sky.ts`, `sun.ts`, `renderer.ts`), and it is what
 * the claim above rests on. `SUNSET` and `NOON` are both invented: nothing in the game ships
 * a sunset or a measured noon, so their numbers are chosen to satisfy the tests, not measured
 * from anything that ships.
 */
export interface Daylight {
  sunColour: number
  sunIntensity: number
  hemiSky: number
  hemiGround: number
  hemiIntensity: number
  skyZenith: number
  skyHorizon: number
  /** Always equal to `skyHorizon`. Distant geometry must dissolve into the band it meets. */
  fogColour: number
}

/**
 * How high the sun already is, in degrees, derived from the direction the game ships rather
 * than written down as a literal — so the two cannot drift apart. `SUN_DIRECTION` is a unit
 * vector, so its y component is the sine of the elevation.
 */
export const SUN_ELEVATION_DEGREES = MathUtils.radToDeg(Math.asin(SUN_DIRECTION.y))

interface Stop extends Daylight { elevation: number }

/**
 * Warm, low, and dimmer. The invented stop: nothing in the game ships a sunset, so these are
 * chosen rather than measured. The constraints they satisfy are the ones the tests state —
 * the horizon stays lighter than the zenith, and the light is warmer and weaker than midday.
 */
const SUNSET: Stop = {
  elevation: 0,
  sunColour: 0xffb066, sunIntensity: 1.1,
  hemiSky: 0xe8c8a8, hemiGround: 0x3a3a2a, hemiIntensity: 1.1,
  skyZenith: 0x1d4f8f, skyHorizon: 0xf0c49a, fogColour: 0xf0c49a,
}

/** The palette the game ships. Every value here is copied from the file that owns it today. */
const SHIPPED: Stop = {
  elevation: SUN_ELEVATION_DEGREES,
  sunColour: 0xfff2d8, sunIntensity: 1.8,
  hemiSky: SKY_HORIZON, hemiGround: 0x4a5a3a, hemiIntensity: 1.5,
  skyZenith: SKY_ZENITH, skyHorizon: SKY_HORIZON, fogColour: SKY_HORIZON,
}

/** Overhead: cooler, brighter, and a deeper zenith. Also invented. */
const NOON: Stop = {
  elevation: 90,
  sunColour: 0xffffff, sunIntensity: 2.1,
  hemiSky: 0xcfe6f5, hemiGround: 0x53603f, hemiIntensity: 1.6,
  skyZenith: 0x275f9c, skyHorizon: 0xcfe6f5, fogColour: 0xcfe6f5,
}

const mixHex = (a: number, b: number, t: number): number =>
  new Color(a).lerp(new Color(b), t).getHex()

export function daylightFor(elevationDegrees: number): Daylight {
  // NaN first, and deliberately: MathUtils.clamp returns NaN for a NaN input, and a NaN
  // elevation would then travel into every colour and intensity below. A black screen with
  // no error in the console is the worst failure mode available here.
  const raw = Number.isFinite(elevationDegrees) ? elevationDegrees : SUN_ELEVATION_DEGREES
  const elevation = MathUtils.clamp(raw, SUNSET.elevation, NOON.elevation)

  // Three stops, two segments: below the shipped elevation blends SUNSET into SHIPPED,
  // above it blends SHIPPED into NOON. Named directly rather than indexed out of an array,
  // since there are only ever these two segments to choose between.
  const [lower, upper] = elevation <= SHIPPED.elevation ? [SUNSET, SHIPPED] : [SHIPPED, NOON]

  const span = upper.elevation - lower.elevation
  // Exactly 0 at a stop, so `daylightFor(SUN_ELEVATION_DEGREES)` returns the shipped values
  // bit for bit rather than a rounding of them.
  const t = span === 0 ? 0 : (elevation - lower.elevation) / span

  const skyHorizon = mixHex(lower.skyHorizon, upper.skyHorizon, t)
  return {
    sunColour: mixHex(lower.sunColour, upper.sunColour, t),
    sunIntensity: MathUtils.lerp(lower.sunIntensity, upper.sunIntensity, t),
    hemiSky: mixHex(lower.hemiSky, upper.hemiSky, t),
    hemiGround: mixHex(lower.hemiGround, upper.hemiGround, t),
    hemiIntensity: MathUtils.lerp(lower.hemiIntensity, upper.hemiIntensity, t),
    skyZenith: mixHex(lower.skyZenith, upper.skyZenith, t),
    skyHorizon,
    fogColour: skyHorizon,
  }
}
