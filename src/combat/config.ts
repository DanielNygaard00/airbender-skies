import { Vector3 } from 'three'
import { UNARMOURED } from './enemy'
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
      armour: UNARMOURED,
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
      //
      // `tangleSeconds: 0` said out loud rather than defaulted. An arrow does not ground the
      // player, and the field being required on every projectile is what forces a future
      // ranged kind to make that decision on purpose. See `EnemyAttack` in `enemy.ts`.
      attack: { kind: 'projectile', damage: 1, speed: 34, tangleSeconds: 0 },
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
      armour: UNARMOURED,
    },
    /**
     * Heavy armoured infantry. Section 4.4 gives it **knockback economy** to pressure, and
     * that phrase is the whole design: the player's cheap displacement move does nothing to
     * it, and the expensive one does everything.
     *
     * The doc's other half — "must be broken with earth or the environment" — now names two
     * tools the game has. Earth arrived after this type did, and the `stone` row below is where
     * that sentence becomes true or false; before it, the environment carried the whole load, and
     * the environment in an archipelago means the rim. `heavy-environment.test.ts` measures that
     * route at the real home island rather than asserting it here, because it is a property of
     * these numbers *and* the terrain and cannot be read off either alone. Both routes are
     * deliberately kept: the rim is the free answer that needs a rim, and earth is the answer that
     * works wherever the heavy is standing.
     *
     * Its armour is the only non-`UNARMOURED` table in the game, and each row is a decision:
     *
     * - **gust: nothing at all.** Section 4.4's word is "immune", so it is 0 and 0 rather than
     *   a large reduction. A gust is a sweep of moving air, and a soldier in plate with its
     *   weight behind a shield does not move and does not care. This is the row the whole type
     *   exists for, and `deflects` reports it so the player hears a clang and sees a spark
     *   instead of watching a move do nothing — see `deflectedThisFrame` in `encounter.ts`.
     * - **wave: everything.** A Pressure Wave is a shock travelling through the ground rather
     *   than air pushed at a body, and it is the move the doc ties to the traversal layer. So
     *   the heavy is the enemy that only *earned* knockback moves, which is what makes this a
     *   knockback economy rather than a knockback immunity. It is also the only reason the type
     *   is beatable at all in the current kit.
     * - **vortex: knockback at 0.45.** Reduced, not removed. Full charge gives 18 pull and 11
     *   lift, so 8.1 and 4.95 get through: about half a second off the ground — inert, per
     *   `stepEnemy`'s airborne branch — and roughly three metres of drift toward the player.
     *   Enough to drag a heavy toward a rim from a hover beyond it; nowhere near enough to
     *   juggle one. Zeroing it was the first draft and it made the type unbeatable, because the
     *   vortex is the only move that can move a body the player is not standing next to.
     *   `damage` here is 1 and is moot: the vortex carries no damage by design, and writing 0
     *   would have made `deflects` report every vortex on every soldier as turned away.
     * - **staff: 0.35 damage, 0.3 knockback.** A wooden staff against plate. Left as a real but
     *   deliberately bad answer rather than nothing: an opener does 0.245 and a finisher 0.42,
     *   so a full three-swing combo is 0.91 against 4.0 health. Grinding one down with the staff
     *   alone is about four and a half combos for the first rung and roughly **eight for the
     *   whole ladder** — 7.6 health across the three rungs, or twenty-five swings. (This used to
     *   read "eight combos per rung", which was the whole-ladder figure wearing the wrong label;
     *   the arithmetic below for the stone is set against the corrected numbers.) That is meant
     *   to feel wrong.
     * - **grip: knockback 0, and the hold still lands.** The Water Grip is a pull, and a pull
     *   is displacement -- the currency this type exists to defend. So the water takes hold and
     *   the body does not move: plate resists being dragged, and the ice shell drawn around a
     *   heavy that visibly did not slide is the tell, so nothing happens silently. `damage` is 1
     *   and moot, exactly as the vortex row above explains, because the grip carries none.
     *
     *   Deliberately not 0 and 0. That would make `deflects` report the grip as turned away and
     *   skip it whole, which reads as "water does not work on plate" -- and water is the control
     *   element, so refusing it outright would leave the type with no answer at all from the one
     *   element whose entire job is answering things you cannot hurt.
     * - **freeze: everything, and this is a decision rather than an omission.** The Ice Lock
     *   holds a heavy for its full duration. Ice closing round the legs is not a blow being
     *   shrugged off by a breastplate, and more importantly the freeze cannot *break* a heavy:
     *   water carries no damage, so nothing about it moves this soldier down the recovery
     *   ladder. What a freeze buys is the seconds to set up the wave, which is the answer
     *   section 4.4 names -- and section 4.2's own worked example is "vortex a group, freeze the
     *   front rank, drop a pillar under them", the control element enabling the removal.
     *
     *   Recorded because it was raised as a balance problem and settled the other way: if it
     *   should be blocked after playing it, this row is now the one line that does it, which it
     *   was not before -- `BendingSource` had no entry for water at all.
     * - **stone: full damage, 0.6 knockback. This is the row section 4.4's sentence stands on.**
     *   The design document says this type "must be broken with earth or the environment", so
     *   plate does not reduce a thrown rock at all: `damage` is 1, exactly as the `wave` row is 1,
     *   because those are the two answers the document names and it would be incoherent for one
     *   of them to be resisted and the other not.
     *
     *   The arithmetic, because "the only reliable armour-breaker" has to be true in numbers.
     *   `stoneDamage` is 1.1 and comes through in full, against rungs of 4.0, 2.4 and 1.2: that
     *   is **four stones for the first rung, three for the second and two for the third — nine
     *   presses for a permanent down**, spread over about 16 seconds by the 1.8-second cooldown.
     *   Set that against the two routes that already exist. The staff needs twenty-five swings
     *   for the same ladder, at melee range, from a 2-damage swing. The Pressure Wave needs five
     *   full-strength dives, each of which needs 30-plus metres a second of descent and therefore
     *   real altitude to spend first. Earth is not the *fastest* of the three — a perfect dive is
     *   fewer presses — it is the one that works from twelve units away with nothing set up
     *   beforehand, which is what "reliable" has to mean for a move on a cooldown.
     *
     *   Knockback at 0.6 rather than 1, and reduced for the reason every reduced row here is
     *   reduced: displacement is the currency this type defends. At `stoneKnockback` 10 that is
     *   6 through the plate, about 2.3 m against `knockbackDamping` 2.6 — a stagger, and nowhere
     *   near enough to walk a heavy to a rim. Deliberately so: environmental removals pay less
     *   Focus by design, and a cheap repeatable move that produced them would make the stingy
     *   line the easy one.
     * - **pillar: 0.5 knockback, damage moot.** A column of rock coming up under a soldier's feet
     *   shoves it off them, and plate is shoved less far than a spear is because it is heavier —
     *   not immune, though, and the contrast with the `gust` row above is the whole argument. A
     *   gust is air pushed at a body and plate is proof against it. This is the *ground moving*,
     *   which is the same reason the `wave` row takes everything. `damage` is 1 and is moot,
     *   exactly as on the vortex and grip rows, because a pillar carries no damage at all.
     * - **burst: half the damage, and none of the shove.** A Fire Burst is the largest aimed damage
     *   figure in the game, and this is the row that decides whether fire quietly becomes the
     *   armour-breaker section 4.4 promises to *earth*. It does not, and the arithmetic is what
     *   makes that true rather than the intent: at 0.5 a burst does 0.5 to this soldier, so its
     *   4.0 health is eight bursts for the first rung and sixteen for a permanent down, against
     *   two full dives per rung for the Pressure Wave and five dives in total. Fire is capped
     *   harder still by its own resource -- three charges per touchdown is 1.5 damage per landing,
     *   so grinding a heavy down with fire means walking away and coming back three times, which
     *   is the same "this is the wrong tool" feeling the staff route is deliberately given.
     *
     *   Halved rather than refused, because a blast of burning air is neither a sweep this soldier
     *   can ignore (gust 0) nor a shock travelling through the ground beneath it (wave 1). Plate
     *   over padding takes real heat badly and the body inside it takes it much less badly than
     *   bare skin would, and half is the honest reading of that. A full deflect was the other
     *   candidate and it is worse for the same reason a full deflect on the grip would be: it would
     *   read as "fire does not work on plate", and the element the design document builds around
     *   single-target damage should not have *nothing* to say to the one high-health single target.
     *
     *   Knockback 0, joining the gust and the grip. This type is never displaced by anything except
     *   an earned Pressure Wave, and that is what "knockback economy" means. The burst's shove is
     *   tiny anyway -- 5 against the gust's 26 -- so scaling it would be a distinction without a
     *   difference, and zero says the rule out loud. It is safe to write 0 here only because the
     *   damage fraction is non-zero: `deflects` needs both at 0, so this row lands as a real hit
     *   with a real number rather than as a clang.
     *
     * Every number below is an argued guess. Nothing here has been played.
     */
    heavy: {
      /**
       * Well over twice the spear's 1.5, and picked against the Pressure Wave rather than in
       * the abstract: a full-strength slam does 2.2, so two committed dives put one down, and
       * the ladder below asks for two more and then one. Five real dives for a permanent down.
       */
      maxHealth: 4,
      outOfCombatSeconds: 6,
      regenPerSecond: 0,
      // The slowest thing in the game, well under the spear's 4.2. Armour is heavy, and
      // walking away from this one always works — which is the point of a wall.
      moveSpeed: 2.6,
      // A little past the spear's 3.2: a longer, heavier weapon swung with both arms.
      strikeRange: 3.6,
      /**
       * The *shortest* notice range in the game, below the spear's 26 on purpose. A leash is a
       * promise to pursue, and at 2.6 m/s this one cannot keep it: noticing at 26 would mean a
       * heavy trudging after a player for twenty seconds and never arriving, which reads as a
       * broken enemy rather than a slow one. Short enough that it holds a piece of ground
       * instead of chasing, which is what it is for.
       */
      aggroRange: 20,
      // The most generous telegraph of the three melee-class windows (spear 0.55): a heavy
      // swing is slow to start, and at 2 damage the dodge has to be genuinely available.
      windUpSeconds: 0.95,
      // Nearly double the spear's 0.7. The punish window is where the staff route lives.
      recoverSeconds: 1.3,
      // Twice a spear thrust, so two connects and a bit take the player's whole 5-point bar.
      // The trade for being unable to chase: standing next to one is the mistake.
      attack: { kind: 'melee', damage: 2 },
      knockbackDamping: 2.6,
      gravity: 20,
      snapDistance: 1.2,
      downedSeconds: 18,
      // Half again the spear's 1.2: more to lift, and the extra window is worth having on the
      // one enemy the player most wants to hit again before it is up.
      risingSeconds: 1.8,
      /**
       * The same ladder shape as everyone else, deliberately. Against maxHealth 4 the rungs
       * come to 4, then 2.4, then 1.2, so each descent costs fewer full slams than the last —
       * the same "three, then two, then one" curve the spear's numbers produce, in the currency
       * this type is actually paid in.
       */
      recoveryHealthFractions: [0.6, 0.3],
      armour: {
        gust: { damage: 0, knockback: 0 },
        vortex: { damage: 1, knockback: 0.45 },
        wave: { damage: 1, knockback: 1 },
        staff: { damage: 0.35, knockback: 0.3 },
        grip: { damage: 1, knockback: 0 },
        freeze: { damage: 1, knockback: 1 },
        stone: { damage: 1, knockback: 0.6 },
        pillar: { damage: 1, knockback: 0.5 },
        burst: { damage: 0.5, knockback: 0 },
      },
    },
    /**
     * The net thrower. Section 4.4 gives it **flight itself** to pressure: a net that connects
     * stows the glider and refuses a redeploy for a spell, which drops the player into the
     * ground layer — the posture section 2.2 calls his most vulnerable.
     *
     * Mechanically it is the archer's path: a wind-up, a projectile, a recovery, both ranges
     * measured in 3D. What is different is the payload, and it is the payload that carries the
     * whole type — see `tangleSeconds` on `EnemyAttack`.
     *
     * The numbers are all bought from the archer's, in the direction that makes a net readable
     * rather than oppressive: slower in the air, shorter reach, a longer telegraph, and a
     * longer recovery. Being grounded is the worst thing in the game that is not damage, so
     * every figure here leans toward "the player could have seen that coming".
     */
    nets: {
      // The most fragile of the four, under the archer's 1.2. Its job is done the instant one
      // net lands, so it has no business also being durable — and the recovery window below is
      // long enough that a player who closes on it should be rewarded for the read.
      maxHealth: 1,
      outOfCombatSeconds: 6,
      regenPerSecond: 0,
      // Between the archer's 3.4 and the spear's 4.2. It wants to stay in throwing range of a
      // player who is trying to leave it, which needs more than the archer's walk.
      moveSpeed: 3.8,
      /**
       * Its throwing range, eight units below `aggroRange` — the same closing band the archer
       * uses, and for the same reason: a patrol member must not open fire the instant it
       * notices. At `moveSpeed` 3.8 that band is about 2.1 seconds of walking.
       *
       * A third of the archer's 30, and this is the load-bearing number of the type. A net is
       * heavy, thrown by hand, and it has to be escapable by *moving up* — at 22 units a player
       * who climbs is out of a netter's reach long before they are out of an archer's, so the
       * two ranged types pressure altitude in opposite directions: the archer punishes hovering
       * low, the netter punishes flying close.
       */
      strikeRange: 22,
      /**
       * Eight above `strikeRange`, and comfortably below the archer's 38, which is what keeps
       * `DEFAULT_PATROL_CONFIG.respawnRange` where it is — see the note on that value.
       */
      aggroRange: 30,
      /**
       * The longest telegraph in the game, past the archer's 0.8. Deliberately the most
       * generous window of the four: an arrow costs a fifth of the player's health, and a net
       * costs the entire air layer for two seconds. The dodge has to be there for the taking.
       */
      windUpSeconds: 1,
      /**
       * The longest recovery too, past the archer's 1.1. A thrown net has to be gathered back
       * up before the next throw, and that gap is the answer to a netter: close on it during
       * the recovery rather than trading with it at range.
       */
      recoverSeconds: 1.6,
      /**
       * Half a spear thrust — one gust's worth — and 22 units a second, well under the arrow's
       * 34. A net is heavy and it tumbles: crossing the full 22-unit throwing range takes a
       * whole second, which is a real chance to leave the lane after it is in the air.
       *
       * The damage is small on purpose. The cost of a net is the two seconds on the ground,
       * and stacking real damage on top of that would make one connect decide a fight. It is
       * not *zero* only because a mechanic that costs no health should still register as a hit
       * — the hurt flash, the direction wedge and the Focus drain all key off damage.
       *
       * `tangleSeconds: 2` is the whole type, and it is measured against the fall rather than
       * chosen for feel. Two seconds of ground-mode fall from a stow is 40 m at gravity 20,
       * against the 600 m of drop between the island band and `worldFloorY`: the refusal costs
       * about a fifteenth of the air available over open sky, so being netted mid-crossing is a
       * scare and a loss of altitude rather than a death. `net-recovery.test.ts` measures that
       * over the real level instead of trusting this paragraph.
       */
      attack: { kind: 'projectile', damage: 0.5, speed: 22, tangleSeconds: 2 },
      knockbackDamping: 2.6,
      gravity: 20,
      snapDistance: 1.2,
      // The shared ladder again. Against maxHealth 1 the rungs are 1, then 0.6, then 0.3 —
      // two gusts, then two, then one. Nothing about this type argues for its own countdown.
      downedSeconds: 18,
      risingSeconds: 1.2,
      recoveryHealthFractions: [0.6, 0.3],
      // A net and a coil of chain, not plate. Every one of the player's moves works on it,
      // which is the trade for the thing it does.
      armour: UNARMOURED,
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
   * "Out-space infantry" is true of the spear and not of the heavy, which arrived later with a
   * `strikeRange` of 3.6 — exactly the opener's range. Both comparisons include their boundary
   * (`inCone` rejects `distance > range`, `stepEnemy` strikes at `distance <= strikeRange`), so
   * at 3.6 the opener and the two-handed weapon reach each other and the opener buys no standoff
   * against a heavy at all. Only the finisher's 4.2 does, by 0.6. That sits consistently with
   * how the heavy is meant to be answered — `windUpSeconds` 0.95 is the game's most generous
   * telegraph and `recoverSeconds` 1.3 is the punish window, so it is a timing problem rather
   * than a spacing one — but the parity itself was never chosen, so `staff-arc.test.ts` asserts
   * the opener as `>=` and the finisher as `>` and says why.
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
   * Air Wall.
   *
   * The odd one out among the five moves: it is the only one whose numbers are set by the
   * *archer* rather than by the other four moves. Three of the six come straight off the
   * archer's shipped attack — `range` from how far an arrow travels in a frame at speed 34,
   * `halfAngle` from how far a glider can turn inside the 0.88 s an arrow takes to cross the
   * 30-unit firing range, `maxSeconds` from that same 0.88 s — because a barrier is defined by
   * what it has to stop and not by what the rest of the kit does.
   *
   * The other three are set against the kit: `verticalReach` against `range` rather than
   * against the other moves' bands, `cooldownSeconds` composed out of the Slipstream's own 1.5,
   * and `breathCost` under the Slipstream's 28 because the general defensive tool should cost
   * more than the specific one. Each field carries its own argument in `air-wall.ts`; this is
   * the summary.
   *
   * Two consequences worth having in hand before playing it. The wall is available 37% of the
   * time, against two archers who between them put an arrow up about every 0.95 s, so most
   * arrows still have to be answered with movement. And a return that reaches the archer that
   * fired it is a roughly one-degree shot at maximum range — the reliable payoff is the arrow
   * going into whatever stands close in front of the wall, which is section 4.1's "his damage
   * largely comes from ... enemies hitting each other" arriving literally.
   *
   * Every value here is an argued guess. None of it has been played.
   */
  airWall: {
    range: 4.0,
    // 90 degrees spanned, against the gust's 120.
    halfAngle: Math.PI / 4,
    // Equal to `range`, deliberately, and the only one of the five bands that is not chosen
    // against the other four. `air-wall.test.ts` pins the relationship, not the literal.
    verticalReach: 4.0,
    maxSeconds: 0.9,
    // 0.9 up plus 1.5 down, the 1.5 being DEFAULT_SLIPSTREAM_CONFIG.cooldownSeconds exactly.
    cooldownSeconds: 2.4,
    // Under the Slipstream's 28 and above FlightConfig.bendFloor's 15.
    breathCost: 20,
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
  /**
   * Earth: raise, throw, wall. The armour-breaker and the only hard cover.
   *
   * Every number's argument lives on the field it belongs to in `src/combat/earth.ts`, because
   * that is where the next person to retune one will be reading. What is worth stating in one
   * place is the shape the numbers add up to, and it is the mirror image of water's.
   *
   * **Earth is the element that hurts, and it is priced so that hurting is slow.** A stone does
   * 1.1 — more than twice a gust and just under a staff finisher — from twelve units away at a
   * target that cannot answer, and it takes 1.8 seconds and 16 breath to do it again. Four of them
   * put a heavy armoured soldier down a rung of the recovery ladder where the staff needs
   * thirteen swings in its face; nine take one through the whole ladder. That is the arithmetic
   * behind section 4.4's claim that this type "must be broken with earth or the environment", and
   * it is spelled out on the heavy's `stone` armour row above rather than here.
   *
   * **The pillar is the only object either side of the fight can hide behind.** Six seconds of
   * cover for 30 Focus, two standing at once, and it stops arrows and nets dead — in both
   * directions, including one the player's own Air Wall turned round. It does nothing to a soldier
   * except shove one standing where it comes up. What it deliberately does *not* do is stop
   * anybody walking, which is a limit of the world system rather than a design choice and is
   * recorded in full on `pillarBlocks` in `earth.ts`.
   *
   * So the three elements now divide cleanly: air moves people, water stops them acting, and
   * earth hurts them and changes the shape of the ground. None of the three is a better version
   * of another, which is the property the whole radial depends on.
   *
   * Every value here is an argued guess. None of it has been played.
   */
  earth: {
    // The same reach as the gust and as a fully charged Vortex, so no light verb out-ranges
    // another; the narrowest cone in the game, because a rock is one object thrown at one body.
    stone: { range: 12, halfAngle: Math.PI / 9 },       // 40 degrees swept, against the gust's 120
    // Middle of the six bands, with the Pressure Wave and the Air Wall: above water's 3.0 because
    // a thrown mass is not a rope, below the gust's 5.0 because a gust fills a volume. The long
    // argument — a damage move that reaches high wins from a hover — is on the field itself.
    stoneVerticalReach: 4.0,
    // Just under the staff finisher's 1.2, so the safe move never pays better than the dangerous
    // one, and over twice the gust's 0.5. Against a spear's 1.5 it is deliberately not a one-shot.
    stoneDamage: 1.1,
    // Well under the gust's 26: displacement is air's currency. At knockbackDamping 2.6 this
    // travels about 3.8 m, which is a stagger and not a route to the rim.
    stoneKnockback: 10,
    // Four times the gust's 0.45 and well past the grip's 1.1 — the longest cooldown on any light
    // verb, and the whole of what "slow, committed" costs. See the field for why not a wind-up.
    stoneCooldownSeconds: 1.8,
    // Above the grip's 12 because this is the move that does damage; under the Slipstream's 28
    // because nothing offensive should crowd the dodge out of the bar.
    stoneBreathCost: 16,
    // Past every melee reach in the game (the heavy's 3.6 is the longest), so cover lands between
    // the player and what is closing rather than behind it.
    raiseDistance: 6,
    // How far the ground may be from the player's own feet. A jump's worth of clearance, not a
    // glide's: manufacturing hard cover from a hover would answer the archer with no counterplay.
    raiseVerticalReach: 3.0,
    // With raiseDistance 6, this gives the player about 1.5 m of lateral freedom before the cover
    // stops covering them against the archer at its 30-unit firing range. Cover has to be kept.
    pillarRadius: 1.2,
    // Over the character's 1.8 and over a standing jump, so it is a thing to stand behind. The
    // margin is for an archer on higher ground, since a shot on flat ground always descends.
    pillarHeight: 4.5,
    // Three of the archer's 1.9-second shot cycles from one press. Far under the downed timer's
    // 18, so cover can never outlast a knockdown; far over the Air Wall's 0.9, because these are
    // opposite tools.
    pillarSeconds: 6.0,
    // Two bearings covered out of the patrol's three shooters, so the player has to choose which.
    // A third press retires the oldest rather than being refused — see the field.
    maxPillars: 2,
    // Enough to put a body outside the rock's own footprint and no more: a large shove here would
    // be a gust that cost Focus.
    raiseShoveSpeed: 6,
    // Under the Vortex's minimum lift of 5. At gravity 20 that is 0.4 s off the ground — enough to
    // cancel a wind-up through stepEnemy's airborne branch, nowhere near enough to juggle.
    raiseLiftSpeed: 4,
    // Exactly damageDrain's 30: the cover is priced at precisely the hit it is bought to prevent.
    // Below the Ice Lock's 35, because a freeze is the stronger effect; three pillars from a full
    // bar, or one pillar and one freeze with 35 left, which is section 4.2's own worked example.
    raiseFocusCost: 30,
    // Exactly the Ice Lock's freezeBreathCost, and equal on purpose: the two heavy verbs are
    // differentiated in Focus and in what they do, not twice over in a second meter.
    raiseBreathCost: 18,
  },
  /**
   * Fire: burst and propulsion. The only element with real single-target damage.
   *
   * Every number's argument lives on the field it belongs to in `src/combat/fire.ts`, because that
   * is where the next person to retune one will be reading. What is worth stating in one place is
   * the shape they add up to: **fire is the only thing in the kit that hurts one soldier properly,
   * and it is rationed by landings rather than by a meter.** Three charges, both verbs spending
   * one, refilled by touching down and by nothing else. So a burst is 1.0 damage — twice a gust,
   * just under a staff finisher, half a committed dive — and there are exactly three of them
   * between one touchdown and the next, shared with the emergency thrust that is the other half of
   * the element.
   *
   * What that buys and what it costs, in one place:
   *
   * - Two spears from full, per landing, and not a third. Fire alone never clears the patrol.
   * - One press puts a net thrower down, which is the pairing section 4.4 already implies: the type
   *   that takes the air away against the element that answers being grounded.
   * - Sixteen bursts for a permanent down on a heavy, against five dives. Fire is not the
   *   armour-breaker; earth is, and its rows are still waiting for it.
   * - No Focus at all, in either direction. See the module comment in `fire.ts`.
   *
   * Every value here is an argued guess. None of it has been played.
   */
  fire: {
    // The narrowest cone in the game by a wide margin: 30 degrees swept, against water's 60 and the
    // gust's 120. At range 7 that is a band about 3.6 m across at full reach, well inside the
    // shipped patrol's closest pair of 11.31 m, which is what makes "single-target" a property of
    // the geometry rather than a rule in the code.
    burst: { range: 7, halfAngle: Math.PI / 12 },
    // The shortest band of the six after the staff's 2.0, and below water's 3.0 on purpose:
    // reaching high is what fire pays for doing the game's best aimed damage.
    verticalReach: 2.5,
    // Two gusts, and the number the recovery ladder is read against: two bursts for a spear's first
    // down, one per rung after it, one press for a net thrower. Under the Pressure Wave's 2.2, so a
    // committed dive stays the biggest single blow in the game.
    burstDamage: 1.0,
    // Against knockbackDamping 2.6 this travels 1.92 m, so a target hit inside 5.08 m is still
    // inside the burst's own 7 m reach for the next one. A fifth of the gust's 26: fire hurts,
    // air displaces.
    burstKnockback: 5,
    // Above the grip's 1.1 -- damage costs more than denial -- and sized so three charges take 2.4
    // seconds to spend, longer than a spear's whole exchange of 1.25.
    burstCooldownSeconds: 1.2,
    // Three, per the owner's ruling: a count a player reads at a glance rather than a fourth gauge.
    maxCharges: 3,
    // DEFAULT_GROUND_CONFIG.airJumpSpeed exactly: one thrust is worth one push of air. With the
    // forward component that is 10.8 m/s, about 0.49 s of bent-air thrust at thrustAccel 22 -- so
    // all three charges together are under a third of a Breath bar, and they do not come back until
    // the player lands.
    thrustUpSpeed: 9,
    // Under the up component, and less than a quarter of the blast dash's 26, so this can never be
    // used as a third horizontal burst move. Enough that the total impulse clears stallSpeed 8 and
    // a stalled wing comes out of the push flying.
    thrustForwardSpeed: 6,
  },
  /**
   * The chain, and why the window is three times the staff's.
   *
   * `DEFAULT_STAFF_CONFIG.continueSeconds` is 0.3, tuned for repeated presses of one key.
   * Continuing a string across elements costs a radial flick or a number key *plus* a press, so a
   * 0.3 window would make mixed strings impossible and quietly turn the chain into a staff-only
   * mechanic. 0.9 is the seed and it is a guess: it has not been played.
   *
   * `maxLinks` matches `DEFAULT_STAFF_CONFIG.maxChain` at 3, not for symmetry but because three is
   * the number of landings the staff already proved a player will commit to before standing still
   * costs more than the payoff. Note what the cooldowns do to this: inside 0.9s no move can follow
   * itself (the gust's 0.45 is the only one under half the window, and even it cannot reach three),
   * so a single-element string is the light verb into that element's heavy verb, and a mixed string
   * is the quicker route to a finisher without a line of code rewording variety directly.
   */
  chain: { maxLinks: 3, windowSeconds: 0.9 },
  reactions: {
    /**
     * How long a mark counts, in seconds.
     *
     * Longer than the chain's 0.9s window, so a mark outlives the string that made it and a
     * player can come back to a wet soldier after dealing with someone else — the mark is a
     * property of the fight, not of the combo. Shorter than the freeze's 3.2s, so being wet is
     * never as durable as being frozen. Both bounds are the argument; 2.5 is the guess inside
     * them.
     */
    markSeconds: 2.5,
    /**
     * Steam's damage: the Fire Burst's own `burstDamage` of 1.0, applied without the armour
     * multiplier. Borrowed rather than invented so the figure needs no defence of its own — Steam
     * is "a burst the plate cannot stop" rather than a new damage tier.
     */
    steamDamage: 1.0,
    /** Mud's hold: the water grip's own `gripHoldSeconds`, added to whatever is on the clock. */
    mudHoldSeconds: 1.4,
    /**
     * The hold ceiling: the freeze's own `freezeHoldSeconds`.
     *
     * The freeze pays 35 Focus — §4.5's one sink — for the privilege of holding a soldier this
     * long. A free path past it would make that sink pointless, so grip, freeze and Mud together
     * cannot exceed it. Not a tuning number: it is the same 3.2 the freeze uses, and it should
     * move only if that one does.
     */
    holdCeilingSeconds: 3.2,
  },
}

/**
 * Where the first fight lives: on the home island, out from the spawn.
 *
 * Four ranks now, in radius order out from the spawn: one heavy, three spears, one net
 * thrower, two archers. Section 4.4 builds encounters as combinations of types, and this is
 * the intended bind — every posture the player might retreat into is covered by something:
 * close the distance and the spears punish you, hold back or climb high and the archers do,
 * fly *near* and the netter grounds you, and the one thing that would answer all three at
 * once (a gust to open a gap) does nothing at all to the heavy holding the front.
 *
 * **One encounter site rather than two, deliberately.** Seven soldiers on one island is a
 * bigger fight than five, and the argument for splitting them was that the heavy and the
 * netter each teach a lesson the other four do not. But both lessons are *comparative* — the
 * gust works on these and not on that one; climbing escapes the archer and closing escapes
 * the netter — and a lesson taught by contrast needs the thing it contrasts with standing
 * next to it. A second site would also have needed a second `patrolSpawns`, a second
 * `PatrolConfig` and a second restore rule in `main.ts`, none of which exists yet, for a
 * fight the player would meet later and learn less from.
 *
 * The cost is real and worth writing down: the heavy at radius 28 sits inside the spears, so
 * a player walking out meets the wall first and the gust-immunity lesson lands before they
 * have anything else to worry about. That is the ordering this layout is buying.
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
 * The radii are what matter, not the exact bearings: the heavy at roughly 28, spears at
 * roughly 34 to 36, the netter at roughly 48, archers at roughly 55. Every line is on the −Z
 * side, and the archers deliberately stop short of radius 60 — the island's ground runs out
 * near 65, and a soldier parked much closer to the rim gets deleted by ordinary knockback,
 * which turns every fight into free environmental removals. Avoid the +X+Z quadrant entirely
 * past radius 56: the spire island is stacked overhead there and `groundHeightAt` returns its
 * surface, hundreds of units up.
 *
 * The heavy is the tightest fit of the seven and the one to check first when retuning. Its
 * `aggroRange` is only 20, so radius 30 leaves it 10.5 units of 3D margin beyond noticing the
 * spawn — comfortable, but it is comfortable *because* the notice range is short, and pushing
 * that range up without moving this coordinate out is how the "does not engage a player who has
 * just loaded the game" guard breaks. Measured at the real terrain: the ground under (4, −30) is
 * 9.98, the spawn point is 13.87, so the 3D distance is 30.51.
 */
export const HOME_PATROL: EnemySpawn[] = [
  /**
   * Innermost by radius, and holding the near flank of the line rather than standing in front
   * of its middle. Both halves of that are measurements rather than taste.
   *
   * It first shipped at (22, −18), directly inboard of `spear-1` on the same bearing, which put
   * the two 5.66 m apart. That broke a property `reach-geometry.test.ts` records and
   * `HOME_PATROL`'s own note above depends on: the patrol's closest pair is 11.31 m, which is
   * what keeps neither staff arc nor either radial move at its weakest able to hold two
   * soldiers at once — the group has a shape instead of being a blob. It also put the hardest
   * melee attacker in the game, at 2 damage a swing, inside its own reach of the first spear a
   * new player closes on.
   *
   * There is no slot on the spear line's own bearings that fixes it. The heavy's `aggroRange` of
   * 20 needs about 26 m of 3D separation from the spawn to stay asleep at load, and the spears
   * sit at radius 34 to 36, so a position 11.3 m inboard of one of them on its own bearing lands
   * at radius 23 and wakes up on the first step the player takes. Moving round to a flank is the
   * only answer, and this is the flattest one: ground varying by 1.705 m inside a 12 m footprint
   * (under even the staff's 2.0 band, so no move loses a stance around it), 30.51 m from the
   * spawn in 3D against a notice range of 20, and 14.0 m from the nearest other soldier.
   */
  { id: 'heavy-1', position: new Vector3(4, 0, -30), kind: 'heavy' },
  { id: 'spear-1', position: new Vector3(26, 0, -22), kind: 'spear' },
  { id: 'spear-2', position: new Vector3(34, 0, -12), kind: 'spear' },
  { id: 'spear-3', position: new Vector3(18, 0, -30), kind: 'spear' },
  // Between the spears and the archers: close enough that its 22-unit throw covers the spear
  // line, far enough back that a player fighting the spears is inside its reach and does not
  // yet know it.
  //
  // Sited at (42, −24) rather than the (30, −34) this first shipped as, and the reason is a
  // measurement rather than a preference. `reach-geometry.test.ts` pins the property that every
  // stance the vertical bands take away is on the two rim archers, which is what makes the
  // coverage shortfall readable as one piece of terrain rather than a systematic shortage. At
  // (30, −34) the ground inside a 12 m gust footprint varies by 5.741 m against the gust's 5.0
  // band, so the netter became a third place the fight quietly stopped working — and it broke
  // that test, which is that test doing its job. Here the same figure is 1.535 m, under even
  // the staff's 2.0, so no move loses a single stance around it.
  //
  // (36, −28) was the first replacement and was rejected for a second reason: it sits 10.77 m
  // from `archer-1`, closer than the patrol's previous closest pair, which cuts the margin
  // under a least-charge vortex's 10 m diameter to 0.77 m. This position is 14.14 m from its
  // nearest neighbour and leaves the closest pair in the patrol exactly where it was.
  { id: 'nets-1', position: new Vector3(42, 0, -24), kind: 'nets' },
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
 *
 * **It did not move for the heavy armoured soldier or the net thrower, and that is a
 * measurement rather than an oversight.** The heavy notices at 20 and the netter at 30, both
 * comfortably under the archer's 38, so the archer is still the widest and still the value
 * this one tracks: `38 × 1.3 = 49.4` is the floor `patrol.test.ts` enforces and 52 clears it.
 * The slack that was left here for "the next few units of retuning" is exactly what paid for
 * two new kinds without a change, which is the argument for having left it.
 *
 * The check is not free, though. Raising the netter's 30 past 40 would put it over this
 * value's floor, and the ceiling in the other direction is `patrol-placement.test.ts`'s
 * requirement that somewhere on the home island lies beyond `respawnRange` of *every* spawn
 * point — the far rim clears the closest of the seven by about 90 units today, so there is
 * headroom, but a patrol spread further out would eat it.
 */
export const DEFAULT_PATROL_CONFIG: PatrolConfig = { respawnRange: 52 }
