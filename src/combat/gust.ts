import { Vector3 } from 'three'
import { isTargetable, type Enemy } from './enemy'
import { inCone } from './cone'

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

/**
 * Whether a target lies inside the blast. Horizontal: a gust is a sweep, not a shot.
 *
 * Kept as its own name over `inCone` for two reasons: `GustConfig` satisfies `ConeShape`
 * structurally so this costs nothing, and `src/fx/gust-cone.test.ts` uses this function as
 * the independent mechanism it compares the drawn cone against. Inlining it at the call
 * sites would quietly delete that check.
 */
export function inGust(
  origin: Vector3,
  forward: Vector3,
  target: Vector3,
  c: GustConfig,
): boolean {
  return inCone(origin, forward, target, c)
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

/**
 * Everyone a gust would catch who is worth aiming at — on their feet, or pushing back up
 * onto them.
 *
 * `gustTargets` deliberately does not filter by state at all — `stepEncounter` applies that
 * filter itself so that "connected" means a live soldier took the hit rather than a body
 * being blown around the island. The aim preview needs the same distinction, and the same
 * `isTargetable` stepEncounter's own resolvers ask: a preview that lights up for a corpse
 * promises something a gust cannot deliver, and one that stays dark for a soldier mid-push-up
 * promises less than a gust actually does.
 *
 * A separate name rather than a boolean parameter, because `gustTargets(o, f, e, c, true)`
 * at a call site says nothing about what the flag means.
 *
 * The preview itself asks `anyLiveGustTarget` below, which only needs a yes or no. This is
 * the list form, kept because it is the right shape for anything that needs to know *who* —
 * and because `gust.test.ts` checks the cheap answer against this one rather than restating
 * the rule, which makes it the independent mechanism the boolean is held to.
 */
export function liveGustTargets(
  origin: Vector3,
  forward: Vector3,
  enemies: readonly Enemy[],
  c: GustConfig,
): Enemy[] {
  return gustTargets(origin, forward, enemies, c).filter(isTargetable)
}

/**
 * Whether a gust thrown now would catch anyone worth aiming at.
 *
 * The same rule as `liveGustTargets`, asked as a yes-or-no. The aim preview only needs to
 * know whether to light up, and `liveGustTargets(...).length > 0` at the call site is a rule
 * — "at least one" — expressed in `main.ts`, the one module with no tests. Here it is a rule
 * in a tested module instead, and `main.ts` only wires.
 *
 * `.some` rather than the two `filter` passes the length check went through, because this
 * runs every frame for the whole session and stops at the first live soldier in the cone
 * instead of allocating two arrays to count them.
 *
 * `liveGustTargets` stays alongside it as the list form, and `gust.test.ts` compares this
 * function against it on a range of arrangements rather than restating the rule — so the
 * cheap answer is held to the expensive one.
 */
export function anyLiveGustTarget(
  origin: Vector3,
  forward: Vector3,
  enemies: readonly Enemy[],
  c: GustConfig,
): boolean {
  return enemies.some(
    (enemy) => isTargetable(enemy) && inGust(origin, forward, enemy.position, c),
  )
}
