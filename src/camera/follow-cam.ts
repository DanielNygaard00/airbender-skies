import { Vector3, MathUtils } from 'three'
import type { PlayerState, TerrainQuery } from '../core/types'

export interface CamProfile {
  distance: number
  height: number
  /** Higher is snappier. */
  smoothing: number
}

/** On foot the character leads and the camera trails. */
export const GROUND_PROFILE: CamProfile = { distance: 7, height: 2.6, smoothing: 9 }
/**
 * In flight the camera leads: the kite steers toward it. Smoothing must stay
 * tight here or steering feels laggy — the kite's weight comes from the
 * airspeed-limited turn rate, not from a sluggish camera.
 */
export const KITE_PROFILE: CamProfile = { distance: 12, height: 3.2, smoothing: 16 }

export function profileFor(mode: PlayerState['mode']): CamProfile {
  return mode === 'kite' ? KITE_PROFILE : GROUND_PROFILE
}

/** Where the camera wants to sit, before smoothing or terrain collision. */
export function desiredCameraPosition(
  target: Vector3, lookDirection: Vector3, profile: CamProfile,
): Vector3 {
  return target.clone()
    .addScaledVector(lookDirection.clone().normalize(), -profile.distance)
    .add(new Vector3(0, profile.height, 0))
}

/** Exponential smoothing, stable at any frame rate and never overshooting. */
export function smoothTowards(
  current: Vector3, desired: Vector3, smoothing: number, dt: number,
): Vector3 {
  const alpha = 1 - Math.exp(-smoothing * dt)
  return current.clone().lerp(desired, MathUtils.clamp(alpha, 0, 1))
}

/** Lift the camera when terrain would sit between it and the player. */
export function pullInForTerrain(
  target: Vector3, desired: Vector3, terrain: TerrainQuery, minDistance = 2,
): Vector3 {
  const ground = terrain.groundHeightAt(desired.x, desired.z)
  if (ground === null || desired.y > ground + minDistance) return desired

  const lifted = desired.clone()
  lifted.y = ground + minDistance
  const toTarget = target.clone().sub(lifted)
  if (toTarget.length() < minDistance) {
    return target.clone().addScaledVector(toTarget.normalize(), -minDistance)
  }
  return lifted
}
