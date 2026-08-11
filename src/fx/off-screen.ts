import type { Vector3 } from 'three'
import { horizontalDistance, isTargetable, type Enemy, type EnemyConfig } from '../combat/enemy'

/**
 * How far past the frame edge, in normalised device coordinates, a soldier travels
 * before its chevron reaches full strength. A quarter of the half-width, so an eighth
 * of a screen width.
 *
 * Far enough that the chevron is only fully up once the soldier is definitively gone,
 * close enough that it arrives before the player wonders where they went. An argued
 * guess, not measured: nobody has played this.
 */
export const OFF_SCREEN_RAMP = 0.25

/**
 * How strongly to draw a marker for something at `ndc`: 0 while it is comfortably on
 * screen, ramping to 1 once it is definitively off it.
 *
 * A ramp read straight off the projection rather than a fade timer, and that is the
 * whole reason this function exists instead of a boolean. Soldiers cross the frame edge
 * constantly as the player turns, so a marker that switched on at the boundary would
 * blink through ordinary camera movement. The obvious fix is a per-soldier fade counter
 * stepped every frame; this needs no state at all, cannot drift out of sync with a
 * soldier that was removed from the fight, and is frame-rate independent without anyone
 * having to think about it.
 *
 * Two inputs mean "not on screen" rather than "somewhere off to one side", and both
 * return 1. A point behind the camera comes back from `Vector3.project` with `z` outside
 * [-1, 1] and an x/y mirrored across the screen — a finite number that is not a
 * position — and that is the population this feature mostly serves, since a follow cam's
 * blind spot is directly behind the player. A projection with a non-finite component is
 * the same story for a different reason: a camera whose `aspect` is not finite, which a
 * 0×0 canvas produces, gives a NaN `x` beside a perfectly finite `y` and `z`.
 *
 * `reticleModel` treats both of those as "hide", and this treating them as "show at full
 * strength" is deliberate rather than an inconsistency to tidy up. The reticle needs a
 * screen position and has none; a marker needs only a bearing, which comes from world
 * space and is unaffected by either.
 */
export function offScreenPresence(ndc: { x: number; y: number; z: number }): number {
  const placeable = Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Number.isFinite(ndc.z)
  if (!placeable || ndc.z < -1 || ndc.z > 1) return 1

  // The larger of the two axes' excesses: the further out on either, the more
  // definitely gone. Note for anyone writing tests against this — `Math.max` is
  // commutative, so swapping x and y here is a provable no-op and no test can catch
  // it. What tests can catch is reading only one axis, or dropping the absolute value
  // (which would report a point off the left or the bottom as fully on screen).
  const overshoot = Math.max(Math.abs(ndc.x) - 1, Math.abs(ndc.y) - 1)
  if (overshoot <= 0) return 0
  return Math.min(overshoot / OFF_SCREEN_RAMP, 1)
}

/** One soldier's chevron: which way, how strongly, and whether it is about to strike. */
export interface EnemyMarker {
  /**
   * Screen bearing in radians: 0 dead ahead, positive clockwise on screen. Handed in
   * rather than computed, because it comes from `bearingFromCamera` — the same function
   * the hit wedges use, so the two overlays cannot disagree about which way is right.
   */
  bearing: number
  /** 0 at the frame edge, rising to 1 once the soldier is definitively off screen. */
  strength: number
  /** This soldier is in its wind-up: the release is coming. */
  winding: boolean
}

/**
 * A marker for this soldier, or null when it has not earned one.
 *
 * Three rules, all here rather than split between this and the caller, because
 * `src/main.ts` has no tests: whatever the caller decides is untested by construction.
 *
 * **The range rule has two clauses, and the second one exists because a spear underfoot
 * genuinely can hit a hovering player.** The primary test is 3D distance against
 * `aggroRange`, which is deliberately not how the fight measures a spear's notice range:
 * `stepEnemy` measures melee horizontally — that is what makes an archer the type that
 * pressures altitude — so a spear 20 units out and 300 units below a hovering player is
 * still inside its horizontal `aggroRange` of 26 and has noticed them. Marking every such
 * soldier would hang a permanent ring of chevrons around a player who has climbed out of
 * the fight, which is the clutter `HIT_MARK_SECONDS` was picked to avoid, so the 3D test
 * is intentionally stricter than the fight for a spear and identical to it for an archer.
 *
 * What that alone got wrong is that horizontal reach means height is *ignored*, not
 * protective. A melee soldier measures `strikeRange` horizontally too, so a spear at
 * horizontal distance 0 is inside its 3.2 reach at any altitude, winds up, and deals
 * damage — `enemy.test.ts`'s 'still thrusts at a player almost directly overhead' pins
 * that as shipped behaviour. With only the 3D clause, a player hovering 30 units above a
 * spear took repeated damage from a soldier this overlay stayed silent about, which is the
 * exact case it exists for. So a melee soldier also earns a marker on its horizontal
 * strike reach, gated on `attack.kind === 'melee'` because an archer measures both notice
 * and commit in 3D and cannot shoot a target the first clause has already rejected.
 *
 * The anti-clutter property survives: a spear 10 units out and 30 units below is outside
 * both clauses and earns nothing. Both ranges are read from the config rather than written
 * here, so retuning either moves the markers with it.
 *
 * `isTargetable` rather than a fresh health test, so there is one definition in the
 * codebase of a soldier worth aiming at — it is the same predicate the gust cone uses,
 * and it counts a rising soldier as live.
 */
export function enemyMarker(
  enemy: Enemy,
  playerPosition: Vector3,
  ndc: { x: number; y: number; z: number },
  bearing: number,
  c: EnemyConfig,
): EnemyMarker | null {
  if (!isTargetable(enemy)) return null
  const noticed = enemy.position.distanceTo(playerPosition) <= c.aggroRange
  const inMeleeReach = c.attack.kind === 'melee'
    && horizontalDistance(enemy.position, playerPosition) <= c.strikeRange
  if (!noticed && !inMeleeReach) return null
  const strength = offScreenPresence(ndc)
  if (strength <= 0) return null
  return { bearing, strength, winding: enemy.stance === 'wind-up' }
}
