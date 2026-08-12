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
      /**
       * Its firing range, kept a full 8 units below `aggroRange` so it closes before
       * shooting rather than opening fire the instant it notices. At `moveSpeed` 3.4 that
       * band is about 2.4 seconds of walking, which is the warning the player gets.
       *
       * The two values move together for that reason. Dropping `aggroRange` alone squeezes
       * the band — at 44 it is 4 units, at 42 it is 2, and at 40 the archer fires on sight
       * and the sentence above stops being true.
       */
      strikeRange: 30,
      /**
       * Measured in 3D, which is the whole point of the type: before archers existed,
       * getting above the spear's 26 ended any fight.
       *
       * Came down from 48 with `strikeRange` from 40, as a first pass at making the archer
       * less oppressive from both ends — the escape climb is 38 rather than 48, and arrows
       * start at 30 rather than 40. Still comfortably wider than the spear's 26, so height
       * still costs something. Unplayed, like every number here.
       */
      aggroRange: 38,
      // Longer than the spear's 0.55: a draw is slower than a thrust, and this window
      // is the dodge.
      windUpSeconds: 0.8,
      // Longer than the spear's 0.7. The gap between shots is the opening to close.
      recoverSeconds: 1.1,
      // Same damage as a spear thrust. At 34 units/sec an arrow crosses the 30-unit firing
      // range in about 0.9 seconds: fast enough to threaten, slow enough to see coming.
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
    /**
     * A sweep of moving air, so it is allowed real height where the staff is not — but it
     * is still a sweep and not a column. Sized to reach a soldier standing on a low ledge
     * or partway up a shallow slope, which is the situation this is for; a player who wants
     * to hit something a storey away has to close the gap.
     */
    verticalReach: 5.0,
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
    /**
     * The smallest of the four relative to its reach, and deliberately so: the fiction is a
     * shockwave travelling out across the surface rather than a blast around the player.
     *
     * Bounded by `minRadius` above it, not by `maxRadius`. A full slam reaches 11 and is
     * decisively wider than it is tall, so full strength never constrains this number. The
     * *weakest* slam does: its radius is `minRadius`, which this value already exactly
     * equals, so a minimum-strength wave is a ball rather than a disc, and anything taller
     * makes the smallest slam a column. That equality is where the argument for this number
     * is thinnest and is the case the archipelago measurement has to settle —
     * `pressure-wave.test.ts` pins the comparison against `minRadius` for that reason.
     */
    verticalReach: 4.0,
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
    /**
     * The tallest of the four, because getting enemies off their feet is the whole payoff
     * and a target out of reach is a target not lifted. It is also the one move whose own
     * effect moves targets vertically, so a band that could not hold them would fight
     * itself.
     */
    verticalReach: 8.0,
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
   *
   * Both arcs reach the same height, and the shortest of the four moves: this is a swing with
   * a physical implement, bounded by the character's own 1.8 height — the reference
   * `CollisionConfig.radius` and `projectile.hitRadius` both take — with margin so a soldier
   * standing on a low rise is still reachable. The two values are equal deliberately, and
   * `staff-arc.test.ts` asserts them equal to each other rather than to a literal: the
   * finisher sweeps wider and shoves harder, not taller, so if one ever moves both should.
   */
  staffArc: {
    opener: { range: 3.6, halfAngle: Math.PI / 2.2, verticalReach: 2.0 },      // about 164 degrees swept
    finisher: { range: 4.2, halfAngle: Math.PI / 1.9, verticalReach: 2.0 },    // about 190 degrees swept: front hemisphere plus a few degrees past each flank, not reaching behind
    openerDamage: 0.7,
    finisherDamage: 1.2,
    // Low on the openers so the combo keeps its targets in reach; the finisher clears space.
    openerKnockback: 4,
    finisherKnockback: 18,
  },
  /**
   * Water: pull, hold, freeze. The control element's two moves.
   *
   * Every number's argument lives on the field it belongs to in `src/combat/water.ts`, because
   * that is where the next person to retune one will be reading. What is worth stating in one
   * place is the shape the numbers add up to: **water does no damage at all and buys time.** A
   * grip removes one soldier from one exchange for 1.2 seconds and drags it into staff reach; a
   * freeze removes a rank for 3.2 seconds and costs a third of the Focus bar. Neither number
   * moves a soldier down the recovery ladder, so a player who only bends water never wins — the
   * element makes the fight winnable with the staff and the traversal kit, which is what
   * "control element" has to mean in a game whose damage comes from somewhere else.
   *
   * Every value here is an argued guess. None of it has been played.
   */
  water: {
    // Two thirds of the gust's 12: water is drawn and directed rather than swept outward, and
    // it holds rather than shoves, so it works closer in.
    grip: { range: 10, halfAngle: Math.PI / 6 },        // 60 degrees swept, against the gust's 120
    // Shorter still, and much wider: this is "the front rank", so it takes in a group at
    // conversational distance rather than reaching across a courtyard.
    freeze: { range: 8, halfAngle: Math.PI / 2.5 },     // 144 degrees swept
    // Second shortest of the six bands in this file, and the long argument for that is on the
    // field itself: a control move that reaches high wins from altitude with no counterplay.
    verticalReach: 3.0,
    // Against knockbackDamping 2.6 this drags a soldier 4.6 m: out of its own strikeRange of
    // 3.2 and into the staff finisher's 4.2.
    pullSpeed: 12,
    /**
     * Past a spear's whole exchange, which is windUpSeconds 0.55 plus recoverSeconds 0.7 — 1.25.
     *
     * It was 1.2 first, on the assumption that "a bit over a second" cleared that sum. It does
     * not: 1.2 is under 1.25, so a gripped spear was released a hair *before* it would have
     * finished the thrust the grip interrupted, which is a hold that costs the soldier nothing.
     * `water.test.ts` asserts against the sum rather than the literal, which is what caught it.
     */
    gripHoldSeconds: 1.4,
    // Just under gripHoldSeconds, so one target can be chain-held at the cost of the entire
    // light-verb budget. Deliberate; water.test.ts pins the inequality.
    gripCooldownSeconds: 1.1,
    // Well under the Slipstream's 28: the grip's real price is its cooldown, and breath is a
    // rate limit on mashing rather than the gate.
    gripBreathCost: 12,
    // Roughly two more spear exchanges than a grip, and well under the downed timer's 18 and
    // the Avatar State's 8.
    freezeHoldSeconds: 3.2,
    // Just above damageDrain's 30, so spending a freeze costs a shade more than taking a spear
    // hit; against maxFocus 100 that is two freezes from a full bar, and it destroys the
    // Avatar State's arm pip. The one Focus sink section 4.5 asks for.
    freezeFocusCost: 35,
    // Above the grip's, because it is the committed move; low against the Focus price, because
    // two meters gating one press is one more refusal to diagnose.
    freezeBreathCost: 18,
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
 * Above the widest notice range of any enemy kind -- currently the archer's 38, not
 * the spear's 26 -- by enough that a restored soldier can never appear already inside
 * its own notice range. The margin exists because a restore fires the instant the
 * player passes respawnRange, and they may be walking back in, so "just outside
 * aggroRange" is not enough separation.
 *
 * This value tracks the archer rather than standing on its own. It went to 66 when the
 * archer noticed at 48, and comes back down to 52 now that the archer notices at 38 --
 * clearing `38 × 1.3 = 49.4`, the margin `patrol.test.ts` enforces, by about the same
 * slack 66 had over 62.4. The order of authority has not changed: the archer's
 * aggroRange is the design number and moves for design reasons, and this hygiene value
 * follows it. It was raised to 66 rather than shrinking the archer back when 48 was
 * what made climbing stop being a win condition; the archer has since come down on its
 * own terms, so the trip back to a patrol restore gets shorter as a consequence rather
 * than as a trade.
 *
 * Left deliberately above the bare floor. Sitting at 50 would satisfy the test and
 * leave nothing for the next few units of retuning, and the whole reason this number
 * needed fixing once already is that it was pinned to a value the archer then outgrew.
 */
export const DEFAULT_PATROL_CONFIG: PatrolConfig = { respawnRange: 52 }
