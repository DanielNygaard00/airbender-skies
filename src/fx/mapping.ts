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
