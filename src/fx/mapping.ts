import { MathUtils } from 'three'

/** Airspeed at which speed effects reach full strength. */
export const FX_SPEED_REFERENCE = 55
export const BASE_FOV = 70
export const MAX_FOV_KICK = 14
export const TRAIL_SPEED_THRESHOLD = 30

/** 0 at rest, 1 at the reference speed. Drives every speed-reactive effect. */
export function speedIntensity(airspeed: number): number {
  return MathUtils.clamp(airspeed / FX_SPEED_REFERENCE, 0, 1)
}

export function fovForSpeed(airspeed: number): number {
  return BASE_FOV + MAX_FOV_KICK * speedIntensity(airspeed)
}

export function windVolumeForSpeed(airspeed: number): number {
  // Squared so slow flight stays quiet and only fast flight gets loud.
  return speedIntensity(airspeed) ** 2
}

export function windPitchForSpeed(airspeed: number): number {
  return 0.7 + 0.8 * speedIntensity(airspeed)
}

export function trailOpacityForSpeed(airspeed: number): number {
  if (airspeed <= TRAIL_SPEED_THRESHOLD) return 0
  return MathUtils.clamp(
    (airspeed - TRAIL_SPEED_THRESHOLD) / (FX_SPEED_REFERENCE - TRAIL_SPEED_THRESHOLD),
    0, 1,
  )
}

/**
 * Degrees of extra field of view at the peak of a dash.
 *
 * Well under `MAX_FOV_KICK`'s 14 for full glider speed: a dash should read as a
 * burst, not as flight. On foot the field of view is otherwise pinned at
 * `fovForSpeed(0)`, which is why a 26 m/s dash has no visual weight today.
 */
export const MAX_DASH_FOV_KICK = 6

/** Additive on top of `fovForSpeed`, so a dash on landing does not fight it. */
export function fovKickForDash(pulse: number): number {
  if (!Number.isFinite(pulse)) return 0
  return MAX_DASH_FOV_KICK * MathUtils.clamp(pulse, 0, 1)
}
