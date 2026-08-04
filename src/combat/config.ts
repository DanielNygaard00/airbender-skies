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
    // Matches DEFAULT_GROUND_CONFIG's gravity, so a lifted soldier falls at the
    // same rate the player does.
    gravity: 20,
    // Matches DEFAULT_GROUND_CONFIG's own snapDistance, so a soldier sticks to a
    // slope underfoot the same way the player does.
    snapDistance: 1.2,
  },
  gust: {
    range: 12,
    // A 60 degree half-angle: a sweep that catches a group, not a shot at one.
    halfAngle: Math.PI / 3,
    damage: 0.5,
    knockback: 26,
    cooldownSeconds: 0.45,
  },
  /**
   * Pressure Wave.
   *
   * The floor sits above a normal jump's landing speed (about 9 m/s from jumpSpeed 9)
   * so that hopping is not an attack. A charged jump at 20 m/s does clear it, at
   * strength 0.24 — deliberate: charge, hop, slam is a legitimate small ground combo.
   * Full strength needs a real tucked dive.
   *
   * The damage ceiling of 2.2 is past a soldier's 1.5 health, so a committed dive
   * downs one outright. That cliff lands around 30.6 m/s of descent and is the whole
   * feel of the move.
   *
   * Every value here is an argued guess. None of it has been played.
   */
  pressureWave: {
    minImpactSpeed: 12,
    fullImpactSpeed: 45,
    minRadius: 4,
    // Close to the gust's 12 range, so a full slam is a crowd move.
    maxRadius: 11,
    minDamage: 0.6,
    maxDamage: 2.2,
    minKnockback: 12,
    // Above the gust's 26, and radial, so it clears space in every direction.
    maxKnockback: 30,
    // A 45 m/s dive returns about 20 m/s, roughly 10 m of climb: enough to re-deploy.
    bounceFactor: 0.45,
  },
  /**
   * Vortex. A setup tool, so the cooldown is long next to the gust's 0.45s — you get
   * one gather per exchange, not a way to keep a group permanently airborne.
   */
  vortex: {
    maxChargeSeconds: 1.2,
    minChargeSeconds: 0.2,
    minRadius: 5,
    // A full charge reaches as far as a gust, so the two moves cover the same ground
    // by different rules rather than one outranging the other.
    maxRadius: 12,
    minPullSpeed: 10,
    maxPullSpeed: 18,
    // Under gravity 20: about 0.5s airborne at the minimum, 1.1s and roughly 3m of
    // apex at full charge. "Lifts them briefly" is the doc's wording.
    minLiftSpeed: 5,
    maxLiftSpeed: 11,
    cooldownSeconds: 3.5,
  },
  /**
   * The staff's arcs. Reach just past the spear's strikeRange of 3.2, so the staff can
   * out-space infantry rather than trading with it. Two openers leave a 1.5-health soldier
   * one hit from down and the finisher takes anyone still standing; a gust does 0.5 with 26
   * knockback, so the staff buys damage with the reach and displacement it gives up.
   */
  staffArc: {
    opener: { range: 3.6, halfAngle: Math.PI / 2.2 },      // about 164 degrees swept
    finisher: { range: 4.2, halfAngle: Math.PI / 1.9 },    // about 190 degrees swept: front hemisphere plus a few degrees past each flank, not reaching behind
    openerDamage: 0.7,
    finisherDamage: 1.2,
    // Low on the openers so the combo keeps its targets in reach; the finisher clears space.
    openerKnockback: 4,
    finisherKnockback: 18,
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
