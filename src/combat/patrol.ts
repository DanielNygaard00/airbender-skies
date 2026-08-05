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
   * Must stay comfortably above the enemy's `aggroRange`, or a fresh soldier appears
   * already inside its own notice range and the player turns around into a fight that
   * spawned on top of them.
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
  // Horizontal, matching how aggroRange is measured: flying overhead is not leaving.
  return spawns.every(
    (spawn) => horizontalDistance(playerPosition, spawn.position) > c.respawnRange,
  )
}
