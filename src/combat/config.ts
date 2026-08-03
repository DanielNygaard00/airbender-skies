import { Vector3 } from 'three'
import type { CombatConfig, EnemySpawn } from './encounter'

/**
 * Combat tuning.
 *
 * Health is five hits and regenerates at 0.4 a second after four quiet seconds, so
 * a fight is survivable but never something to stand and trade through. Gust does a
 * tenth of an enemy's health and shoves them 26 m/s: three connects to down one,
 * and the knockback is big enough that it blows them out of gust range, so they
 * have to be re-engaged rather than held down in a corner.
 */
export const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  player: { maxHealth: 5, outOfCombatSeconds: 4, regenPerSecond: 0.4 },
  enemy: {
    maxHealth: 1.5,
    outOfCombatSeconds: 6,
    // Enemies do not heal. Chipping one down over a long fight has to stay viable.
    regenPerSecond: 0,
    // Slower than a walk, so distance is always a real defence.
    moveSpeed: 4.2,
    strikeRange: 3.2,
    // Notices at 26 units: enough to be a threat on approach, short enough that
    // leaving the island leaves the fight behind.
    aggroRange: 26,
    windUpSeconds: 0.55,
    recoverSeconds: 0.7,
    strikeDamage: 1,
    knockbackDamping: 2.6,
  },
  gust: {
    range: 12,
    // A 60 degree half-angle: a sweep that catches a group, not a shot at one.
    halfAngle: Math.PI / 3,
    damage: 0.5,
    knockback: 26,
    cooldownSeconds: 0.45,
  },
}

/**
 * Where the first fight lives: on the home island, near the spawn.
 *
 * Deliberately placed where the player already is rather than gated behind a
 * traversal challenge, because this is the only encounter in the game and it should
 * be findable. Three of them, spread out, so the gust's cone matters.
 */
export const HOME_PATROL: EnemySpawn[] = [
  { id: 'spear-1', position: new Vector3(26, 0, -18) },
  { id: 'spear-2', position: new Vector3(34, 0, -8) },
  { id: 'spear-3', position: new Vector3(20, 0, -4) },
]
