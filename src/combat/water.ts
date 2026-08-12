import { Vector3 } from 'three'
import { inCone, type ConeShape } from './cone'
import { isTargetable, type Enemy } from './enemy'

/**
 * Water: pull, hold, freeze. The control element.
 *
 * Section 4.2 gives water three verbs and this module is two moves, not three, because the
 * three verbs are not three buttons — pull and hold are one gesture and freeze is its
 * escalation:
 *
 * - **Water Grip** (the light verb, on the element's light key) yanks everyone in a narrow
 *   forward reach toward the caster and holds them there for a moment. Pull and hold in one
 *   press. No damage at all.
 * - **Ice Lock** (the heavy verb, on the element's heavy key) freezes a wider band where it
 *   stands — no pull, a much longer hold, and it costs Focus. No damage either.
 *
 * They are one kit rather than two moves because they write the same field: `holdEnemy`'s
 * `heldSeconds`, taking whichever hold is longer. Gripping a group drags it into one place;
 * freezing it locks that place down. Grip is the setup and freeze is the payoff, which is the
 * same relationship the Vortex has with everything else in the air kit.
 *
 * **Neither move does any damage, and there is no damage parameter for either.** Water is the
 * control element: its job is denial and positioning. The same defence `vortex.ts` gives for
 * having no damage field applies with more force here, because water has two moves and a
 * config that could quietly grow damage on one of them would make water a strictly better
 * gust — denial *and* chip damage for the same key.
 *
 * **What section 4.2 asks for and this does not build.** "Extinguishes fire hazards" and
 * "turns pooled water into a hazard surface" are both absent, because the archipelago has
 * neither fire hazards nor pooled water for them to act on. Inventing either to justify the
 * verb would be a world-content cycle wearing a combat cycle's clothes. See
 * `isElementAvailable` in `src/elements/element.ts` for the related decision about drawing
 * from a source.
 *
 * **Water is inside the armour model, and the heavy's two rows are a decision.** This used to
 * be an open question recorded here, because `BendingSource` named only the four air moves:
 * `ArmourTable` had no row for a grip or a freeze, `deflects` could not be asked about either,
 * and the one type built around refusing a blow therefore had no defence against water at all.
 * That was an expressiveness gap before it was a balance one — there was no way to write the
 * rule down.
 *
 * `BendingSource` now carries `'grip'` and `'freeze'`, so the table is total over both, and the
 * heavy armoured soldier answers each differently:
 *
 * - **The pull is refused** (`grip` knockback 0). Displacement is the currency section 4.4 gives
 *   that type, and a pull is displacement. The water still takes hold — the row is not a full
 *   deflect — so plate resists being dragged without being immune to the control element.
 * - **The hold lands in full** (`freeze` 1 and 1). Ice round the legs is not a blow shrugged off
 *   by a breastplate, and a freeze cannot break a heavy in any case: water carries no damage, so
 *   nothing here moves a soldier down the recovery ladder. What it buys is the seconds to set up
 *   the wave, which is the answer the design document names for the type, and section 4.2's own
 *   worked example is exactly that chain.
 *
 * Both rows carry their full argument in `config.ts`, and `encounter.test.ts`'s "water against
 * plate" block pins them. A full deflect on either row is a live branch with a test behind it
 * rather than dead config, so blocking either move against a kind is now one line.
 */
export interface WaterConfig {
  /**
   * The grip's reach: how far it pulls from, and how wide.
   *
   * Narrow next to the gust's 60-degree sweep, and that contrast is the point. A gust is a
   * sweep of moving air and catches a group; water is drawn and directed as a rope, so it is a
   * reach rather than a sweep. Given the gust's width it would be a strictly better gust — it
   * denies where a gust merely shoves — so the width is what it pays.
   */
  grip: { range: number; halfAngle: number }
  /**
   * The freeze's reach: shorter than the grip and much wider.
   *
   * "Freeze the front rank" is a directional statement, so this is a cone and not a radial
   * like the Vortex or the Pressure Wave. A radial freeze would also lock the soldier behind
   * the player they were about to disengage from, and a move this expensive has to go where it
   * is aimed.
   */
  freeze: { range: number; halfAngle: number }
  /**
   * Half-height of the band both water moves sweep. **One number for the whole element,
   * deliberately.**
   *
   * The same reasoning `staffArc`'s two equal `verticalReach` values carry: grip and freeze
   * are one kit, and a grip that could reach a soldier the freeze could not would make
   * "yank them in, then lock them" fail for reasons the player cannot see. If it ever moves,
   * it moves for both, and `water.test.ts` asserts the two shapes share it rather than
   * asserting a literal.
   *
   * Its value is argued against the five bands that already exist — staff opener and finisher
   * at 2.0, the Pressure Wave at 4.0, the gust at 5.0, the Vortex at 8.0 — and it is
   * deliberately the second shortest of them.
   *
   * Above the staff's 2.0, because this is bending rather than a swing with a physical
   * implement, and it has to reach a soldier on a low ledge better than an arm's length does.
   *
   * Below the Pressure Wave's 4.0 and the gust's 5.0, which are both slabs of moving air
   * filling a volume, and far below the Vortex's 8.0, which must reach whatever it intends to
   * lift. And that is the argument that actually decides the number: **a control move that
   * reaches high wins fights from altitude with no counterplay.** A gusted soldier is up again
   * in a moment and an unlifted one is merely not lifted, but a frozen soldier cannot answer
   * at all — so the ability to deny has to be paid for with proximity, or hovering above a
   * patrol and freezing it in rotation becomes the whole game. That is the same exploit the
   * archer exists to close, and it would be reopened by one number.
   */
  verticalReach: number
  /**
   * How hard the grip yanks a target toward the caster, in metres per second.
   *
   * Under the Vortex's 10-to-18 pull, because that move gathers a whole group and this drags
   * what is in front of it. Against `knockbackDamping` 2.6 a pull of this size travels
   * `pullSpeed / knockbackDamping` before it stops, and the number is chosen so that distance
   * is more than the spear's `strikeRange` of 3.2 and lands inside the staff's 3.6-to-4.2
   * reach: the grip's mechanical job is to take a soldier out of its own reach and put it
   * inside yours.
   */
  pullSpeed: number
  /**
   * Seconds a gripped target is held.
   *
   * Longer than a spear's whole exchange — `windUpSeconds` 0.55 plus `recoverSeconds` 0.7 —
   * so a grip genuinely removes one soldier from one exchange rather than merely delaying it.
   */
  gripHoldSeconds: number
  /**
   * Seconds between grips.
   *
   * Longer than the gust's 0.45, because a grip denies where a gust shoves. Deliberately just
   * *under* `gripHoldSeconds`, which means one target can be held indefinitely by re-gripping
   * — and that is intended rather than overlooked. It costs the player their entire light-verb
   * budget and does no damage, so it buys time and not progress: the same bargain section 4.6
   * describes for standing over a rising soldier and knocking it back down. `water.test.ts`
   * pins the inequality, because the moment the cooldown rises above the hold, single-target
   * lockdown quietly stops existing and the move's whole feel changes.
   */
  gripCooldownSeconds: number
  /**
   * Breath a grip spends, deducted on the frame it fires, and it refuses to fire below the
   * cost — the contract `stepSlipstream` uses for a dodge.
   *
   * Well under the Slipstream's 28. A dodge is the move that saves the player's life and it is
   * priced to be spendable three times from a full bar; the grip is an offensive utility and
   * its real price is its cooldown, so breath here is a rate limit on mashing rather than the
   * gate. At this cost a full bar of 100 buys eight grips, which the 1.1-second cooldown
   * already spreads over nearly nine seconds — long enough that `breathRegenPerSecond` has
   * paid most of it back, so a player who only grips never runs dry, and a player who grips
   * *and* dodges *and* thrusts does.
   */
  gripBreathCost: number
  /**
   * Seconds a frozen target is held.
   *
   * Decisively longer than `gripHoldSeconds`, because it costs Focus, and well under the
   * downed timer's 18: a freeze is a lock, not a knockdown. Sized at roughly two full spear
   * exchanges plus the walk back into reach, and kept under the Avatar State's 8 seconds so
   * that freezing one rank is never "most of an Avatar State for a third of the price".
   */
  freezeHoldSeconds: number
  /**
   * Focus one freeze spends, and the reason Focus is a resource rather than only a gauge.
   *
   * Section 4.5 says Focus "spends on elemental heavy moves" and this is the first such spend
   * the game has. Priced against what a full bar is worth today rather than picked:
   *
   * - `maxFocus` is 100, and a clean glide fills it from empty in roughly 45 seconds unramped.
   *   So a freeze is about 16 seconds of clean flying.
   * - `downGain` is 14, so a freeze costs what two and a half knockdowns pay.
   * - `damageDrain` is 30, so spending a freeze costs a shade *more* than taking a spear hit.
   *   That comparison is the one that matters: the player should feel a freeze in the meter the
   *   way they feel getting hit, or it is not a decision.
   * - The Avatar State needs the bar at maximum and held there for `armSeconds` 4. At this
   *   price, one freeze from a full bar destroys the arm pip and leaves 65 — two freezes are
   *   affordable and the Avatar State is then a long way off. That is the trade the design asks
   *   for: the control move and the escalation draw on the same pool, and taking one is
   *   visibly giving up the other.
   *
   * Every number here is an argued guess. None of it has been played.
   */
  freezeFocusCost: number
  /**
   * Breath a freeze spends, on top of the Focus.
   *
   * Above the grip's cost, for the same reason the freeze holds longer: it is the committed
   * move. Kept low next to the Focus price, though, because two meters gating one press is one
   * more refusal the player has to diagnose, and Focus is the gate that is meant to be felt.
   */
  freezeBreathCost: number
}

/** The grip's cone, assembled from the element's shared band. */
export function gripShape(c: WaterConfig): ConeShape {
  return { range: c.grip.range, halfAngle: c.grip.halfAngle, verticalReach: c.verticalReach }
}

/** The freeze's cone, from the same band. */
export function freezeShape(c: WaterConfig): ConeShape {
  return { range: c.freeze.range, halfAngle: c.freeze.halfAngle, verticalReach: c.verticalReach }
}

/**
 * Whether a target lies inside a grip.
 *
 * Kept as its own name over a bare `inCone` for the reason `inGust` is: it gives the effect
 * that draws the reach an independent mechanism to be checked against, so the drawn cone and
 * the cone that bites cannot drift apart.
 */
export function inWaterGrip(
  origin: Vector3, forward: Vector3, target: Vector3, c: WaterConfig,
): boolean {
  return inCone(origin, forward, target, gripShape(c))
}

/** Whether a target lies inside a freeze. */
export function inIceLock(
  origin: Vector3, forward: Vector3, target: Vector3, c: WaterConfig,
): boolean {
  return inCone(origin, forward, target, freezeShape(c))
}

/**
 * Everyone one grip catches. Named so a caller cannot forget the cone test.
 *
 * Filters by geometry only, exactly as `gustTargets` and `staffTargets` do: `stepEncounter`
 * applies `isTargetable` itself, so that "connected" means a live soldier was gripped rather
 * than a body being dragged around the island.
 */
export function waterGripTargets(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: WaterConfig,
): Enemy[] {
  return enemies.filter((enemy) => inWaterGrip(origin, forward, enemy.position, c))
}

/** Everyone one freeze catches. Geometry only, for the same reason. */
export function iceLockTargets(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: WaterConfig,
): Enemy[] {
  return enemies.filter((enemy) => inIceLock(origin, forward, enemy.position, c))
}

/**
 * Everyone a grip would catch who is worth aiming at, for the aim preview.
 *
 * The same split `gust.ts` makes between `gustTargets` and `liveGustTargets`, and for the same
 * reason: a preview that lights up for a body promises something the move cannot deliver.
 */
export function liveWaterGripTargets(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: WaterConfig,
): Enemy[] {
  return waterGripTargets(origin, forward, enemies, c).filter(isTargetable)
}

/**
 * Whether a grip thrown now would catch anyone worth aiming at.
 *
 * The cheap form of `liveWaterGripTargets`, for the reticle and the world-space tell, which
 * only need a yes or no. `.some` rather than two `filter` passes because this runs every frame
 * for the whole session; `water.test.ts` holds it to the list form on a range of arrangements
 * rather than restating the rule, exactly as `gust.test.ts` does for `anyLiveGustTarget`.
 */
export function anyLiveWaterGripTarget(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: WaterConfig,
): boolean {
  return enemies.some(
    (enemy) => isTargetable(enemy) && inWaterGrip(origin, forward, enemy.position, c),
  )
}

/**
 * The yank a grip puts on a target: inward, toward the caster, and flat.
 *
 * No vertical component, and that is the deliberate contrast with the Vortex, which lifts. Air
 * takes people off their feet; water drags them across the ground. It also matters
 * mechanically: an airborne enemy is inert on its own, so lifting would make the hold
 * redundant for as long as the target was in the air, and the hold is the move.
 *
 * Delivered as a decaying knockback impulse rather than as a teleport, so the pull is a visible
 * drag that the interpolated view can follow — the same physics a gust's shove already uses,
 * read the other way round.
 */
export function waterGripImpulse(origin: Vector3, target: Vector3, c: WaterConfig): Vector3 {
  const inward = new Vector3(origin.x - target.x, 0, origin.z - target.z)
  // Standing on the caster leaves the direction undefined: hold, and do not divide. Zero
  // rather than a fabricated heading, because a target already on top of the caster has
  // nowhere left to be pulled to.
  if (inward.lengthSq() < 1e-8) return new Vector3()
  return inward.normalize().multiplyScalar(c.pullSpeed)
}

/**
 * Whether a grip can fire: off cooldown and with the breath to pay for it.
 *
 * Both halves, the way `canSlipstream` reads both its cooldown and its breath. The action
 * guide asks this function rather than restating either half, and `stepEncounter` asks it too,
 * so the panel cannot claim a grip is ready while the fight refuses it.
 */
export function canWaterGrip(cooldown: number, breath: number, c: WaterConfig): boolean {
  return cooldown <= 0 && breath >= c.gripBreathCost
}

/**
 * Whether a freeze can fire: enough Focus, and enough breath.
 *
 * No cooldown, deliberately, and it is the one gate this move does not get. Focus is the
 * price, and a hidden timer on top would refuse the move for a reason the player cannot see —
 * the HUD draws the Focus bar and does not draw a cooldown. Two freezes back to back from a
 * full bar are affordable and are meant to be: the bar is then empty, which is the cost the
 * player can read.
 */
export function canIceLock(focus: number, breath: number, c: WaterConfig): boolean {
  return focus >= c.freezeFocusCost && breath >= c.freezeBreathCost
}
