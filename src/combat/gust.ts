import { Vector3 } from 'three'
import { horizontalDistance, type Enemy } from './enemy'

/**
 * Gust: fast, low damage, high knockback.
 *
 * Per the doc it interrupts, staggers and opens gaps. It is a positioning tool
 * rather than a damage tool, so the numbers are deliberately lopsided — a gust
 * barely hurts anyone and moves everyone. That is what makes Aang a crowd-control
 * fighter instead of a damage-per-second one.
 *
 * It hits a cone rather than a single target, because the doc's staff and bending
 * are both built for hitting several enemies at once instead of one enemy hard.
 */
export interface GustConfig {
  /** How far the blast reaches. */
  range: number
  /** Half-angle of the cone, radians. Wide: this is a sweep, not a laser. */
  halfAngle: number
  /** Low on purpose. */
  damage: number
  /** High on purpose. */
  knockback: number
  /** Seconds between gusts. */
  cooldownSeconds: number
}

/** Whether a target lies inside the blast. Horizontal: a gust is a sweep, not a shot. */
export function inGust(
  origin: Vector3,
  forward: Vector3,
  target: Vector3,
  c: GustConfig,
): boolean {
  const distance = horizontalDistance(origin, target)
  if (distance > c.range || distance < 1e-6) return false

  const toTarget = new Vector3(target.x - origin.x, 0, target.z - origin.z).normalize()
  const heading = new Vector3(forward.x, 0, forward.z)
  if (heading.lengthSq() < 1e-8) return false

  return toTarget.dot(heading.normalize()) >= Math.cos(c.halfAngle)
}

/**
 * The push a gust puts on a target: outward from the caster, and slightly upward.
 *
 * The lift is what makes a gust read as air rather than as a shove, and it is what
 * lets a gust blow someone off a ledge — which the doc lists as one of the
 * non-lethal ways an enemy goes down.
 */
export function gustImpulse(origin: Vector3, target: Vector3, c: GustConfig): Vector3 {
  const away = new Vector3(target.x - origin.x, 0, target.z - origin.z)
  const direction = away.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : away.normalize()
  return direction.multiplyScalar(c.knockback).setY(c.knockback * 0.25)
}

/** Everyone caught in one gust. Named so callers cannot forget the cone test. */
export function gustTargets(
  origin: Vector3,
  forward: Vector3,
  enemies: readonly Enemy[],
  c: GustConfig,
): Enemy[] {
  return enemies.filter((enemy) => inGust(origin, forward, enemy.position, c))
}
