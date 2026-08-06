import { Vector3 } from 'three'
import type { CombatConfig, EnemySpawn } from './encounter'
import type { PatrolConfig } from './patrol'

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
  enemies: {
    spear: {
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
      attack: { kind: 'melee', damage: 1 },
      knockbackDamping: 2.6,
      gravity: 20,
      snapDistance: 1.2,
      /**
       * Long enough that clearing a patrol feels like progress, short enough that the
       * island does not go quiet while the player is still standing on it.
       */
      downedSeconds: 18,
      // Well above the strike's windUpSeconds of 0.55: getting up is a bigger commitment
      // than a spear thrust and should read as one.
      risingSeconds: 1.2,
      /**
       * Against maxHealth 1.5 and the gust's 0.5 damage, these are three gusts, then two,
       * then one — 1.5, then 0.9, then 0.45. The ladder is legible from playing it rather
       * than from reading this, and each rung costs less of the player's time than the last.
       */
      recoveryHealthFractions: [0.6, 0.3],
    },
    /**
     * The archer. Section 4.4 gives it altitude to pressure, and its numbers are the
     * inverse of the spear's: fragile, slower on its feet, and dangerous from far away.
     *
     * Both its ranges are measured in 3D by `stepEnemy`, which is what makes climbing
     * stop being a win condition. Before this type existed, getting above the spear's
     * 26 units ended any fight.
     */
    archer: {
      // Under the spear's 1.5: ranged and fragile. A staff opener at 0.7 plus anything
      // finishes one.
      maxHealth: 1.2,
      outOfCombatSeconds: 6,
      regenPerSecond: 0,
      // Slower than the spear's 4.2. It wants distance, not contact.
      moveSpeed: 3.4,
      // Its firing range, below aggroRange so it closes before shooting rather than
      // opening fire the instant it notices.
      strikeRange: 40,
      // Nearly double the spear's 26, and in 3D.
      aggroRange: 48,
      // Longer than the spear's 0.55: a draw is slower than a thrust, and this window
      // is the dodge.
      windUpSeconds: 0.8,
      // Longer than the spear's 0.7. The gap between shots is the opening to close.
      recoverSeconds: 1.1,
      // Same damage as a spear thrust. 34 units/sec crosses its 40-unit range in about
      // 1.2 seconds: fast enough to threaten, slow enough to see coming.
      attack: { kind: 'projectile', damage: 1, speed: 34 },
      knockbackDamping: 2.6,
      gravity: 20,
      snapDistance: 1.2,
      /**
       * The same recovery ladder as the spear, deliberately. Nothing in the ladder is
       * kind-specific — the fractions are of this archer's own maxHealth, so the rungs
       * come to 1.2, then 0.72, then 0.36, which is the same three-gusts-then-two-then-one
       * shape the spear's numbers produce. Giving the archer a different countdown would
       * be a tuning decision, and there is no argument for one yet.
       */
      downedSeconds: 18,
      risingSeconds: 1.2,
      recoveryHealthFractions: [0.6, 0.3],
    },
  },
  /**
   * Arrows. `hitRadius` is roughly half the character's 1.8 height — generous enough not
   * to feel arbitrary, tight enough that moving works. `maxSeconds` is well past the
   * archer's own range at 34 units/sec, so it is a backstop rather than a mechanic.
   */
  projectile: { hitRadius: 0.9, maxSeconds: 4 },
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
 * Where the first fight lives: on the home island, out from the spawn.
 *
 * Three spears and two archers, with the archers further back, so the group has a shape
 * rather than being a blob. Section 4.4 builds encounters as combinations of types, and
 * this is the intended bind: close the distance and the spears punish you, hold back or
 * climb and the archers do.
 *
 * **Every soldier sits outside its own notice range of the player's spawn point**, so a
 * player who loads the game and touches nothing is not engaged. `patrol-placement.test.ts`
 * pins that against the real island geometry, because it is a property of these
 * coordinates *and* the terrain under them and cannot be read off either alone.
 *
 * It was not always true. The archers first landed at 34 and 47 units out, against a
 * 40-unit firing range and a 48-unit notice range measured in 3D — so one of them loosed
 * an arrow 0.8 seconds after load and a motionless player reached zero health in about
 * five. The spears had the same problem more mildly and for longer, which is why nobody
 * noticed: `spear-3` sat 20 units out against a notice range of 26 and had been advancing
 * on the spawn since long before archers existed.
 *
 * The radii are what matter, not the exact bearings: spears at roughly 34 to 36, archers
 * at roughly 55. Both lines are on the −Z side, and the archers deliberately stop short of
 * radius 60 — the island's ground runs out near 65, and a soldier parked much closer to the
 * rim gets deleted by ordinary knockback, which turns every fight into free environmental
 * removals. Avoid the +X+Z quadrant entirely past radius 56: the spire island is stacked
 * overhead there and `groundHeightAt` returns its surface, hundreds of units up.
 */
export const HOME_PATROL: EnemySpawn[] = [
  { id: 'spear-1', position: new Vector3(26, 0, -22), kind: 'spear' },
  { id: 'spear-2', position: new Vector3(34, 0, -12), kind: 'spear' },
  { id: 'spear-3', position: new Vector3(18, 0, -30), kind: 'spear' },
  { id: 'archer-1', position: new Vector3(40, 0, -38), kind: 'archer' },
  { id: 'archer-2', position: new Vector3(18, 0, -52), kind: 'archer' },
]

/**
 * Above the widest notice range of any enemy kind -- currently the archer's 48, not
 * the spear's 26 -- by enough that a restored soldier can never appear already inside
 * its own notice range. The margin exists because a restore fires the instant the
 * player passes respawnRange, and they may be walking back in, so "just outside
 * aggroRange" is not enough separation.
 *
 * Raising this to clear the archer means a patrol restore now needs the player 66
 * units from every spawn point, not 40. That is a longer trip than before, so
 * respawns are rarer than they used to be. The alternative -- shrinking the archer's
 * aggroRange instead -- was rejected: 48 is what makes climbing stop being a win
 * condition, which is this whole enemy type's purpose, so the hygiene value moves
 * and not the design one.
 */
export const DEFAULT_PATROL_CONFIG: PatrolConfig = { respawnRange: 66 }
