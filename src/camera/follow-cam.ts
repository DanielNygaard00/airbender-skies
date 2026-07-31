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
 * In flight the camera leads: the glider steers toward it. Smoothing must stay
 * tight here or steering feels laggy — the glider's weight comes from the
 * airspeed-limited turn rate, not from a sluggish camera.
 */
export const GLIDER_PROFILE: CamProfile = { distance: 12, height: 3.2, smoothing: 16 }

export function profileFor(mode: PlayerState['mode']): CamProfile {
  return mode === 'glider' ? GLIDER_PROFILE : GROUND_PROFILE
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

/**
 * Lift the camera when terrain would sit between it and the player.
 *
 * This is an approximation, bounded by what `TerrainQuery` can answer.
 * `groundHeightAt` reports the highest surface in a column, so it cannot say
 * whether that surface is between the camera and the player or merely somewhere
 * overhead. Two consequences worth knowing:
 *
 *  - When the player is at or below that surface, the terrain is above them
 *    both and lifting would pin the camera to a roof with the player out of
 *    frame, so we leave the camera where it is.
 *  - The arm still does not shorten when it would pass through a terrain wall,
 *    which is what the spec asks for. Doing that needs a general segment cast
 *    (`TerrainQuery.raycast(from, direction, maxDistance)`), which does not
 *    exist yet. Until it does, the camera is permissive rather than wrong.
 */
export function pullInForTerrain(
  target: Vector3, desired: Vector3, terrain: TerrainQuery, minDistance = 2,
): Vector3 {
  const ground = terrain.groundHeightAt(desired.x, desired.z)
  if (ground === null || desired.y > ground + minDistance) return desired.clone()
  if (target.y <= ground) return desired.clone()

  const lifted = desired.clone()
  lifted.y = ground + minDistance
  const toTarget = target.clone().sub(lifted)
  if (toTarget.lengthSq() < 1e-12) {
    // The lifted camera landed exactly on the player. Any direction will do;
    // back off along world +Z so the result stays a sane distance away.
    return target.clone().add(new Vector3(0, 0, minDistance))
  }
  if (toTarget.length() < minDistance) {
    return target.clone().addScaledVector(toTarget.normalize(), -minDistance)
  }
  return lifted
}
