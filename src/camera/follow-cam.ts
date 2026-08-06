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

/**
 * How far short of a hit surface the camera stops.
 *
 * Placing the camera exactly on the surface puts that surface at distance zero from the
 * camera — behind the near clip plane — so the near-plane clip carves a hole in it and
 * the player sees straight through, which is the exact failure `pullInForTerrain` exists
 * to fix. This is not `minDistance`: `minDistance` is a floor on distance from the player,
 * unrelated to the near plane, and does not by itself keep the camera off a surface that
 * sits further from the player than `minDistance` but still closer than this skin.
 */
const CAMERA_SKIN = 0.3

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
 * Pull the camera in when terrain stands between it and the player.
 *
 * This used to lift the camera out of any column that contained terrain, because
 * `groundHeightAt` reports the highest surface in a column and cannot say whether that
 * surface is between the camera and the player or merely overhead. That ambiguity is gone:
 * `TerrainQuery.raycast` answers the question directly, so the arm shortens to the first
 * surface along it.
 *
 * No wall test here, unlike movement. The camera should be pushed out of any geometry, a
 * ceiling and the ground included — where movement leaves ground to the ground snap and
 * the landing probe, the camera has no other owner.
 *
 * The camera stops `CAMERA_SKIN` short of the hit, not on it, so the surface stays in
 * front of the near clip plane instead of behind it. `minDistance` wins over that when
 * the surface sits close enough that skinning back from it would land inside
 * `minDistance` of the player. Deliberate: a camera jammed into the character's head is
 * worse than a camera briefly clipping a wall.
 */
export function pullInForTerrain(
  target: Vector3, desired: Vector3, terrain: TerrainQuery, minDistance = 2,
): Vector3 {
  const arm = new Vector3().subVectors(desired, target)
  const length = arm.length()
  // The camera is already on the player. There is no arm to shorten and no direction to
  // shorten it along.
  if (!(length > 1e-6)) return desired.clone()

  const hit = terrain.raycast(target, arm, length)
  if (!hit) return desired.clone()

  const kept = Math.max(minDistance, target.distanceTo(hit.point) - CAMERA_SKIN)
  return target.clone().addScaledVector(arm.divideScalar(length), kept)
}
