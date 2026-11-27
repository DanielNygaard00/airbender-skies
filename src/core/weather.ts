import { Vector2 } from 'three'

/**
 * The world's weather clock: wind for the trees and grass, drift for the clouds.
 *
 * In `core/` because two layers read it: the sky dome here and the swaying props and grass in
 * `world/`. It started life in `world/wind-sway.ts`, and the sky could not import it from there
 * without `core` depending on `world`.
 *
 * **Shared uniform objects.** Every material that reads the weather is handed these exact objects
 * as its uniforms, so `advanceWeather` is two assignments a frame however many islands, chunks and
 * surfaces there are. Nothing on the FX bench advances them, so the bench's trees stand still and
 * its clouds hold position, and its photographs stay comparable across commits.
 */

/** Seconds, wrapped so float32 precision never decays in a long session. Drives sway. */
export const WIND_CLOCK = { value: 0 }

/**
 * Wrap point for the wind clock. The sway oscillators' periods share no common multiple, so the
 * wrap cannot be seamless; ten minutes makes the seam one frame in ten minutes, a jump of a few
 * centimetres at a crown tip, which mid-sway is invisible.
 */
const WRAP_SECONDS = 600

/** The direction the wind blows across the archipelago, in the ground plane (unit length). */
export const WIND_DIRECTION = [0.8, 0.6] as const

/**
 * How far the cloud layer has travelled, in cloud-noise units, downwind.
 *
 * **Not wrapped, and not derived from `WIND_CLOCK`, which is.** The clouds translate rather than
 * oscillate, so a wrapped clock would jump every cloud in the sky back to where it started once
 * every ten minutes. Value noise has no period to wrap at seamlessly either. At `CLOUD_SPEED` the
 * offset reaches 10,000 units -- where float32 still resolves a thousandth of a unit -- after about
 * four and a half days of continuous play.
 */
export const CLOUD_DRIFT = { value: new Vector2() }

/**
 * Cloud-noise units per second. With `CLOUD_SHADOW_SCALE` (70 m a unit) the shadows cross the
 * ground at about 3 m/s -- slow enough to watch, quick enough to see moving within a few seconds.
 */
export const CLOUD_SPEED = 0.04

export function advanceWeather(dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return
  WIND_CLOCK.value = (WIND_CLOCK.value + dt) % WRAP_SECONDS
  CLOUD_DRIFT.value.x += WIND_DIRECTION[0] * CLOUD_SPEED * dt
  CLOUD_DRIFT.value.y += WIND_DIRECTION[1] * CLOUD_SPEED * dt
}

/**
 * The cloud noise, shared by the sky dome and the cloud shadows on the ground.
 *
 * One definition so a retune of the clouds' shape reaches both. Prefixed names, because the
 * shadows are spliced into three's own lit shaders, where a bare `hash` or `fbm` could collide
 * with a chunk's. Five octaves for the sky, which is seen sharp; three for the shadows, which
 * are soft by nature and run on every lit pixel in the frame.
 */
export const CLOUD_NOISE_GLSL = /* glsl */ `
  float cloudHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float cloudNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x),
      mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float cloudFbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
    for (int k = 0; k < 5; k++) {
      sum += amplitude * cloudNoise(p);
      p = turn * p;
      amplitude *= 0.5;
    }
    return sum;
  }
  float cloudFbmSoft(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
    for (int k = 0; k < 3; k++) {
      sum += amplitude * cloudNoise(p);
      p = turn * p;
      amplitude *= 0.5;
    }
    // Rescaled to the five-octave sum's range, so one coverage threshold suits both.
    return sum / 0.875 * 0.96875;
  }
`

/** Where the cloud cover starts and becomes solid, on the noise's 0-1 range. */
export const CLOUD_COVER = [0.52, 0.78] as const
