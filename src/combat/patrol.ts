import type { Vector3 } from 'three'
import { horizontalDistance, type Enemy } from './enemy'
import { isDowned } from './health'
import type { EnemySpawn } from './encounter'

/**
 * When a cleared patrol comes back.
 *
 * The simplest rule that makes a fight repeatable: restore once every soldier is down
 * and the player is far enough away that nothing appears in view. Restoring while the
 * player is elsewhere *is* leave-and-return, without a second piece of state — an
 * arm-on-leaving, fire-on-returning machine buys nothing here and adds a flag that can
 * desynchronise from the enemy list.
 */
export interface PatrolConfig {
  /**
   * How far the player must be from every spawn point before the patrol restores.
   *
   * Must stay comfortably above *every* kind's `aggroRange` — not just the melee one's —
   * or a fresh soldier appears already inside its own notice range and the player turns
   * around into a fight that spawned on top of them.
   *
   * The margin cannot be borrowed from the fact that a ranged soldier measures its
   * aggroRange in 3D while this measures horizontally. 3D distance is never below
   * horizontal distance, but the two are equal whenever the player stands at the
   * soldier's own altitude, so the comparison has to hold on the horizontal figure
   * alone. This is exactly how the archer slipped past: at 48 it out-ranged a
   * respawnRange of 40, and every ground-level position between the two restored a
   * patrol straight into its own notice range.
   */
  respawnRange: number
}

export function shouldRestorePatrol(
  enemies: readonly Enemy[],
  spawns: readonly EnemySpawn[],
  playerPosition: Vector3,
  c: PatrolConfig,
): boolean {
  // Both guards matter. "Every enemy is downed" is vacuously true for an empty list,
  // which would restore every frame forever; and with no spawn points there is nowhere
  // to restore to, so the distance test below would also be vacuously satisfied.
  if (enemies.length === 0 || spawns.length === 0) return false
  if (!enemies.every((enemy) => isDowned(enemy.health))) return false
  // Horizontal: flying overhead is not leaving. This matches how a spear measures its
  // aggroRange but not how an archer does — see the note on `respawnRange` above, which
  // is why that value has to clear the widest aggroRange outright rather than rely on
  // the two measurements agreeing.
  return spawns.every(
    (spawn) => horizontalDistance(playerPosition, spawn.position) > c.respawnRange,
  )
}
