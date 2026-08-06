import { Vector3 } from 'three'
import type { TerrainQuery } from '../core/types'

/**
 * Stopping the player passing through solid rock.
 *
 * Before this existed, `TerrainQuery` could only cast downward, so nothing ever asked
 * whether something was in the way sideways. Measured against the real archipelago: a
 * glider flown at the `needle` island at 50 m/s entered at x 210 and left at x 112,
 * straight through a rock centred at x 150.
 *
 * On foot, a related mechanism is real but is a latent hazard rather than an observed
 * failure. Inside the `needle` and `home` meshes, the ground snap's downward ray meets
 * back faces, a `FrontSide` material culls them, and the ray returns null — that part is
 * confirmed directly. Whether a player walking around this archipelago ever reaches that
 * state was also measured directly, and the answer is no: 83 inward runs, all thirteen
 * islands, eight bearings each, 400 frames at sprint, with collision disabled, produced
 * zero respawns, because the ground snap climbs everything this island noise generates.
 * Arriving inside a mesh by a jump, a dash, a charged-jump landing, or a glide impact was
 * not tested. So the walker's deflection below is a guard against a hazard that is real
 * even though no walking route to it was found — not a fix for an observed death.
 *
 * The response is a deflection rather than a stop. The design document is explicit that
 * landing at speed never hard-stops the character, and a wall is no more welcome to. The
 * velocity going into the surface is removed and the rest is kept, so a fast approach to
 * a cliff skims along it.
 */
export interface CollisionConfig {
  /** How far from a surface the body is held. */
  radius: number
  /**
   * Surfaces at or above this `normal.y` are ground, not wall, and are ignored here.
   *
   * This is the one rule that keeps collision from fighting the two systems that already
   * own ground: `groundStep`'s snap, which pulls a walker onto slopes and small drops, and
   * the glider's landing probe. Deliberately the same threshold in both postures — a
   * glider that skimmed along gentle ground instead of landing on it would be a second,
   * competing answer to a question `controllerStep` already answers.
   */
  wallNormalY: number
}

export interface CollisionResult {
  position: Vector3
  velocity: Vector3
  /** The surface deflected off, or null when nothing was in the way. */
  normal: Vector3 | null
}

/** Steeper than the threshold is a wall. Flatter is ground, and ground is not ours. */
export function isWall(normal: Vector3, c: CollisionConfig): boolean {
  return normal.y < c.wallNormalY
}

/**
 * Two passes. One pass deflects off the near face of an inside corner and sends the
 * player along it, straight through the far face; the second catches that. A third
 * changes nothing measurable and costs a raycast every frame.
 */
const PASSES = 2

/**
 * Resolve one step of movement against terrain. Pure: never mutates its arguments.
 *
 * The sweep runs `radius` past the destination, so a surface is found before the body
 * reaches it rather than after.
 */
export function resolveMovement(
  from: Vector3,
  to: Vector3,
  velocity: Vector3,
  terrain: TerrainQuery,
  c: CollisionConfig,
): CollisionResult {
  let origin = from.clone()
  let target = to.clone()
  const resolved = velocity.clone()
  let normal: Vector3 | null = null

  for (let pass = 0; pass < PASSES; pass++) {
    const delta = new Vector3().subVectors(target, origin)
    const travel = delta.length()
    if (!(travel > 1e-8)) break

    const hit = terrain.raycast(origin, delta, travel + c.radius)
    if (!hit || !isWall(hit.normal, c)) break

    normal = hit.normal.clone()
    const stopped = hit.point.clone().addScaledVector(hit.normal, c.radius)
    const into = resolved.dot(hit.normal)
    // Only when moving into the surface. A player already travelling away from a wall
    // they are standing against must not be pushed off it.
    if (into < 0) resolved.addScaledVector(hit.normal, -into)

    // The last pass has nothing after it to verify a slide, so it stops at the wall
    // instead of sliding to a destination that could itself be inside geometry.
    if (pass === PASSES - 1) {
      target = stopped
      break
    }

    const remaining = Math.max(0, travel - stopped.distanceTo(origin))
    origin = stopped
    target = resolved.lengthSq() > 1e-12
      ? stopped.clone().addScaledVector(resolved.clone().normalize(), remaining)
      : stopped.clone()
  }

  return { position: target, velocity: resolved, normal }
}
