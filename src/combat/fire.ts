import { Vector3 } from 'three'
import { inCone, type ConeShape } from './cone'
import { isTargetable, type Enemy } from './enemy'
import type { PlayerMode } from '../core/types'

/**
 * Fire: burst and propulsion. The only element with real single-target damage.
 *
 * Section 4.2 gives fire two halves and this module is both of them, one on each bending key:
 *
 * - **Fire Burst** (the light verb, on the element's light key) throws a narrow blast at one
 *   soldier and does the most damage of anything the player can aim. It is the one move in the
 *   kit that is about hurting one soldier rather than controlling several.
 * - **Fire Thrust** (the heavy verb, on the element's heavy key) shoves the glider up and
 *   forward for a charge. It is the emergency section 4.2 asks for — a way to arrest a fall
 *   with an empty Breath bar — and it does nothing at all on the ground.
 *
 * **The resource is three discrete charges that refill on landing, and both verbs spend one.**
 * That is an owner ruling and it is the load-bearing decision of the whole element, so the
 * reasoning is recorded rather than left to be rediscovered. A count reads instantly, cannot be
 * trickled, and makes each press a decision; three of them keep a fourth gauge out of a HUD that
 * already carries health, breath and Focus. And the refill condition is *touching down* rather
 * than a rate, because a fire resource that came back in the air would be a second Breath bar
 * however it was labelled: `src/player/flight.ts` is a soaring model where thrust is the only
 * source of net climb and running dry is the intended failure state, so a meter that refilled
 * mid-air would let the player alternate the two and never run out of either. Section 6's tuning
 * target — "a player who never lands should run out of Breath in any encounter" — is the sentence
 * this rule exists to keep true.
 *
 * The consequence, which is the point rather than a cost: **an engagement fought entirely in the
 * air is three fire actions long**, in whatever mix of bursts and thrusts the player chooses, and
 * then fire is gone until they touch ground.
 *
 * **The two verbs draw on the same three charges, and that is the element's whole tension.** A
 * burst spent on a soldier is a thrust not available when the wing runs out of air, which is why
 * the pips are worth watching and why neither verb needs a meter of its own to feel expensive.
 *
 * **Fire's heavy verb is a movement move, and it is the only element where that is true.** The
 * asymmetry is real and is argued rather than glossed over. Three things make it the right
 * mapping. The heavy slot has never been the damage slot — the Vortex does no damage at all and
 * the Ice Lock does none either, so what R means across the kit is "the committed, expensive
 * thing this element does", which the thrust is exactly. Section 4.2 gives fire precisely two
 * things and section 2.1 of the water cycle's contract forbids a third binding, so the
 * propulsion has to sit on one of the two keys. And the split follows the *gesture* rather than
 * the category: F is the aimed, cheap, repeatable press everywhere in the kit, and R is the
 * unaimed press-and-release, which is what a thrust is. The price of the mapping is that the
 * emergency is only in hand if the player is already holding fire, and that is intended — it is
 * "the emergency mid-air thrust", not a universal recovery. If play says that is too punishing,
 * the honest fix is a cheaper Breath floor rather than a fifth binding.
 *
 * **Fire spends no Focus, deliberately.** Water's Ice Lock already spends 35 of 100 and earth's
 * price is being decided on a parallel branch, so a three-way Focus pricing problem that nobody
 * has played would be a worse bug than a fire that turns out slightly cheap. Charges are the
 * price, plus the burst's cooldown. It earns none either: a per-connect grant would make the
 * damage element the Focus engine that funds water's freeze and the Avatar State, and fire is
 * already the best-paying element through `firstDownsThisFrame`, because it is the element that
 * actually puts soldiers down. See `FireConfig.burstDamage` for that arithmetic.
 *
 * **Nothing here burns.** Section 4.6 allows no deaths and this module adds no damage over time
 * and no burning state: fire does its damage on the frame it lands, the recovery ladder takes it
 * from there, and a soldier goes down rather than out exactly as it does for every other move. A
 * burning condition would be a second countdown beside `heldSeconds` for a mechanic section 4.6
 * does not ask for, and the one thing it would add — damage the player did not have to aim — is
 * the opposite of what "real single-target damage" means.
 */
export interface FireConfig {
  /**
   * The burst's reach: how far it throws, and how narrow.
   *
   * The narrowest cone in the game, and that is what "single-target" is made of rather than a
   * rule that says one target. At the range below, a half-angle this tight sweeps a band about
   * 3.6 m across at full reach — well inside `HOME_PATROL`'s closest pair of 11.31 m, which
   * `reach-geometry.test.ts` measures — so on the shipped patrol a burst genuinely cannot catch
   * two soldiers at once, while a gust catches three.
   *
   * The range is the shortest of the aimed bending moves: under the freeze's 8, the grip's 10 and
   * the gust's 12, because this is the only one that hurts. It is still comfortably past every
   * melee reach in the game — a spear's 3.2, a heavy's 3.6 and the staff finisher's 4.2 — so
   * bursting is not the same commitment as swinging.
   */
  burst: { range: number; halfAngle: number }
  /**
   * Half-height of the band the burst sweeps.
   *
   * The second shortest of the seven bands in the game, above only the staff's 2.0. Water's own
   * `verticalReach` comment carries the argument and it applies here with more force: a move that
   * reaches high wins fights from a hover with no counterplay, and where a frozen soldier at
   * least cannot be *hurt* from up there, this one does the most damage in the kit. So reach in
   * height is what fire pays for its damage, and it pays more of it than water does.
   *
   * Above the staff's 2.0 all the same, because this is bending rather than a swing with a
   * physical implement and it has to reach a soldier on a low ledge. `fire.test.ts` pins that a
   * player hovering just outside this band is still well inside an archer's `strikeRange`, so the
   * soldier that exists to punish altitude still answers a player who tries to burn a patrol down
   * from above it.
   */
  verticalReach: number
  /**
   * Damage one burst does, and the number the whole element is built around.
   *
   * Anchored to the recovery ladder rather than picked, because "real single-target damage" is a
   * claim about how many presses put a soldier down. Against `recoveryHealthFractions` of
   * [0.6, 0.3], at this value:
   *
   * - **A spear** (1.5 health) takes two bursts for the first down, then one per rung: four in
   *   total. A gust at 0.5 takes six, and a staff finisher at 1.2 takes four — but the finisher
   *   is the third swing of a combo that cannot be thrown from the air at all.
   * - **An archer** (1.2) is the same shape: two, then one, then one.
   * - **A net thrower** (1.0) goes down to a single burst, and that is deliberate rather than
   *   incidental. The netter is the type that takes the air layer away, and fire is the element
   *   that answers being grounded, so one press for the first down is the pairing the two designs
   *   already imply.
   * - **A heavy** (4.0) takes eight bursts a rung through its 0.5 armour row, against two full
   *   dives. Fire is emphatically not the armour-breaker; see `config.ts` for that row's argument.
   *
   * Held under the Pressure Wave's 2.2 ceiling, so the committed dive stays the biggest single
   * blow in the game — it should be, since it costs a real fall.
   *
   * Three charges therefore buy 3.0 damage between touchdowns, which is two spears from full and
   * not a third: fire alone never clears the patrol, which is what keeps section 4.1's "not a
   * damage-per-second character" true of an element whose whole job is damage.
   */
  burstDamage: number
  /**
   * How hard the burst shoves, in metres per second, outward.
   *
   * Small, and sized by a measurement rather than by feel: against `knockbackDamping` 2.6 this
   * travels `burstKnockback / knockbackDamping` = 1.92 m before it stops, so a target hit
   * anywhere inside 5.08 m of the caster is still inside the burst's own 7 m reach for the next
   * one. A burst thrown at the outer quarter of the cone does push its target out of range, which
   * is the honest limit of that claim.
   *
   * That is the same reason `staffArc.openerKnockback` is 4: a move that means to keep working on
   * one target must not throw it out of reach. It is also why fire is not a displacement tool —
   * the gust's 26 is what displacement costs, and giving fire a real shove as well as the game's
   * best single-target damage would make it a strictly better gust.
   */
  burstKnockback: number
  /**
   * Seconds between bursts.
   *
   * Above the grip's 1.1, because damage costs more than denial, and well under the Vortex's 3.5.
   * The number is chosen against the enemy telegraphs rather than against the other cooldowns
   * though: at this value three bursts take 2.4 seconds to spend, which is longer than a spear's
   * whole exchange of 1.25 and longer than a heavy's 0.95-second wind-up, so a patrol gets to act
   * between them and the charges cannot be dumped inside one telegraph.
   *
   * **It gates the burst only, and never the thrust.** A shared fire cooldown would let a burst
   * refuse the emergency thrust for as long as it ran, and the emergency is the one thing the
   * thrust exists for.
   *
   * Note what the cooldown does *not* do: on the ground, where a hop refills the charges, it is
   * the only real rate limit on the burst. That is a known consequence of the landing rule and it
   * is written down rather than patched — the burst is meant to be available on foot, the jump
   * that reloads it is a second of standing still in front of a patrol, and 1.2 seconds between
   * presses is what keeps that from being a machine gun.
   */
  burstCooldownSeconds: number
  /**
   * How many charges the player holds when full, and therefore how many pips the HUD draws.
   *
   * Three, per the owner's ruling. Two would make the choice between a burst and a thrust
   * mechanical rather than interesting; four starts to read as a bar, which is the thing this
   * resource is deliberately not.
   */
  maxCharges: number
  /**
   * Upward speed one thrust adds, in metres per second.
   *
   * `DEFAULT_GROUND_CONFIG.airJumpSpeed`'s 9 — the game's existing unit of "one push of air is
   * worth this much". A fire thrust is one air jump's worth of climb, delivered where the air jump
   * is not available, and at gravity 20 that is 2.03 m of ballistic apex or about 2.3 seconds of a
   * glider's own sink arrested.
   *
   * **This is what keeps the thrust from reading as extra Breath, and it is a measurement.**
   * Bending air costs `thrustAccel` 22 m/s of acceleration per second, so the 10.8 m/s this move
   * delivers in total is about 0.49 s of held thrust, or 8.8 of the 100-unit Breath bar. Three
   * charges are therefore worth roughly 1.5 seconds of thrust against the 4.7 seconds a full bar
   * buys above `bendFloor` — under a third of one bar, and they do not come back until the player
   * lands. A player who tries to fly on fire gets a third of a Breath bar for the whole crossing
   * and no way to earn more without touching down.
   */
  thrustUpSpeed: number
  /**
   * Forward speed one thrust adds, along the flattened heading.
   *
   * Under the up component, because section 4.2 calls this propulsion in the sense of a climb
   * rather than a dash — and because the game already has two horizontal burst moves, the blast
   * dash at 26 and the Slipstream at 30. At less than a quarter of either, fire cannot be used as
   * a third one, and what the forward part buys is a wing that comes out of the push flying rather
   * than ballooning: the total impulse of 10.8 m/s is above `stallSpeed` 8, so one thrust returns
   * even a completely stalled glider to a speed where the wing makes lift again.
   */
  thrustForwardSpeed: number
}

/** The burst's cone, assembled from the element's band. */
export function burstShape(c: FireConfig): ConeShape {
  return { range: c.burst.range, halfAngle: c.burst.halfAngle, verticalReach: c.verticalReach }
}

/**
 * Whether a target lies inside a burst.
 *
 * Kept as its own name over a bare `inCone` for the reason `inGust` and `inWaterGrip` are: it
 * gives the effect that draws the reach an independent mechanism to be checked against, so the
 * drawn cone and the cone that bites cannot drift apart.
 */
export function inFireBurst(
  origin: Vector3, forward: Vector3, target: Vector3, c: FireConfig,
): boolean {
  return inCone(origin, forward, target, burstShape(c))
}

/**
 * Everyone one burst catches. Named so a caller cannot forget the cone test.
 *
 * Filters by geometry only, exactly as `gustTargets` and `waterGripTargets` do: `stepEncounter`
 * applies `isTargetable` itself, so that "connected" means a live soldier was burned rather than a
 * body being shoved around the island.
 *
 * It returns a list rather than a single nearest target, and the cone is what makes the move
 * single-target rather than a rule enforced here. Picking one target in code would be a second
 * authority on the move's reach, and it would make the drawn cone a lie the first time two
 * soldiers stood inside it.
 */
export function fireBurstTargets(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: FireConfig,
): Enemy[] {
  return enemies.filter((enemy) => inFireBurst(origin, forward, enemy.position, c))
}

/**
 * Everyone a burst would catch who is worth aiming at, for the aim preview.
 *
 * The same split `gust.ts` makes between `gustTargets` and `liveGustTargets`, and for the same
 * reason: a preview that lights up for a body promises something the move cannot deliver.
 */
export function liveFireBurstTargets(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: FireConfig,
): Enemy[] {
  return fireBurstTargets(origin, forward, enemies, c).filter(isTargetable)
}

/**
 * Whether a burst thrown now would catch anyone worth aiming at.
 *
 * The cheap form of `liveFireBurstTargets`, for the reticle and the world-space tell, which only
 * need a yes or no. `.some` rather than two `filter` passes because this runs every frame for the
 * whole session; `fire.test.ts` holds it to the list form across a sweep of arrangements rather
 * than restating the rule, exactly as `gust.test.ts` does for `anyLiveGustTarget`.
 */
export function anyLiveFireBurstTarget(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: FireConfig,
): boolean {
  return enemies.some(
    (enemy) => isTargetable(enemy) && inFireBurst(origin, forward, enemy.position, c),
  )
}

/**
 * The shove a burst puts on a target: outward, away from the caster, and flat.
 *
 * Outward is the opposite of the grip's inward pull, which is how the two light verbs read apart
 * at a glance, and flat for the reason the grip is flat: an airborne enemy is inert, so lifting
 * would hand the target the Vortex's own payoff for free and take away the follow-up the burst is
 * setting up.
 *
 * Delivered as a decaying knockback impulse rather than a teleport, the same physics every other
 * displacement in the fight uses.
 */
export function fireBurstImpulse(origin: Vector3, target: Vector3, c: FireConfig): Vector3 {
  const outward = new Vector3(target.x - origin.x, 0, target.z - origin.z)
  // Standing on the caster leaves the direction undefined: hurt, and do not divide. Zero rather
  // than a fabricated heading, for the reason `waterGripImpulse` gives — a NaN here would corrupt
  // the body's position for the rest of the session.
  if (outward.lengthSq() < 1e-8) return new Vector3()
  return outward.normalize().multiplyScalar(c.burstKnockback)
}

/**
 * A full hand of charges.
 *
 * The one place the count comes from, so the initial value, the refill on landing and the refill
 * on a respawn cannot disagree about what "full" is.
 */
export function fullCharges(c: FireConfig): number {
  return c.maxCharges
}

/**
 * Charges gone, floored at nothing.
 *
 * Takes a count rather than always spending one, because the fight bills its spend as a number —
 * `EncounterStep.chargesSpent` — and the alternative was the caller looping. One charge is the
 * default because that is what both verbs cost today and a bare `spendCharges(n)` at the call site
 * would read as a total rather than as a debit.
 *
 * `Math.max` rather than a bare subtraction: every gate here refuses at zero, so a negative count is
 * unreachable, but it would draw as an empty pip row that a landing could not refill past — silent,
 * and indistinguishable from an element that had stopped working.
 */
export function spendCharges(charges: number, count = 1): number {
  return Math.max(0, charges - Math.max(0, count))
}

/**
 * The charges after this frame, which is the refill rule and nothing else.
 *
 * **It takes no `dt`, and that absence is the design.** A refill that could be expressed as a rate
 * would be a second Breath bar; this one is an event, so there is no elapsed time for it to
 * consume and no way for a future edit to trickle charges back without changing the signature.
 *
 * `landed` is the touchdown edge the game already has — `touchedDown` in `src/player/slam.ts`,
 * which is the same predicate `detectSlam` reads, so fire and the Pressure Wave cannot come to
 * different conclusions about when the player arrived on the ground. Standing on the ground is
 * deliberately *not* the condition: refilling every grounded frame would make the pips permanently
 * full on foot, so a player would never see the resource at all until they were airborne, and
 * spending it on the ground would cost nothing. Arriving is the condition, so three bursts on foot
 * do run the element dry and the player has to leave the ground and come back.
 */
export function stepFireCharges(charges: number, landed: boolean, c: FireConfig): number {
  return landed ? fullCharges(c) : charges
}

/**
 * Whether a burst can fire: off cooldown, and with a charge to spend.
 *
 * Both halves, the way `canWaterGrip` reads both its cooldown and its breath. The action guide
 * asks this function rather than restating either half, and `stepEncounter` asks it too, so the
 * panel cannot claim a burst is ready while the fight refuses it.
 */
export function canFireBurst(cooldown: number, charges: number, c: FireConfig): boolean {
  return cooldown <= 0 && charges >= 1 && c.maxCharges >= 1
}

/**
 * Whether a thrust can fire: a charge in hand, and wings out.
 *
 * **Gated on the glider rather than on `!grounded`, and that is the owner's ruling about the
 * ground made precise.** Fire moves the player in the air layer and nowhere else, so a player in
 * ground mode gets nothing from this key however far off the ground they are. Two things follow
 * that make the narrower gate the right one rather than merely the simpler one.
 *
 * A falling player in ground mode already has an escalation for exactly this situation — the air
 * jump, then the deploy — and a fire push there would compete with both for the same moment.
 *
 * And a netted player is *forced* into ground mode and refused the deploy for two seconds, which
 * section 4.4 gives the net thrower as its entire job. A thrust that worked in ground mode would
 * hand the player a way out of the one mechanic built to take the air away, which is the opposite
 * of the pairing `burstDamage` describes: fire answers a netter by putting it down, not by
 * ignoring its net.
 *
 * There is deliberately no cooldown. The charge is the price, exactly as Focus is the Ice Lock's,
 * and a hidden timer on top would refuse an emergency move for a reason the player cannot see —
 * the HUD draws pips and does not draw a timer. The key is edge-triggered, so one press is one
 * thrust already; spending all three takes three deliberate presses and the whole element with it.
 */
export function canFireThrust(charges: number, mode: PlayerMode): boolean {
  return mode === 'glider' && charges >= 1
}

/**
 * The impulse one thrust adds to the glider's velocity.
 *
 * World up for the lift and the **flattened** heading for the push, which is a deliberate mix. The
 * move exists to arrest a fall, and a diving glider's nose points down — so taking the 3D heading
 * would spend a charge to dive harder, which is the exact opposite of the emergency. Flattening it
 * means the horizontal part always goes where the player is pointed and the vertical part always
 * goes up, whatever attitude the wing is in.
 *
 * A nose pointing straight up or down has no horizontal component to normalise, so the push is
 * dropped and the lift is delivered alone rather than a NaN reaching `player.velocity` and
 * corrupting the state until the controller's own guard respawns it.
 */
export function fireThrustImpulse(forward: Vector3, c: FireConfig): Vector3 {
  const impulse = new Vector3(0, c.thrustUpSpeed, 0)
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() < 1e-8) return impulse
  return impulse.addScaledVector(flat.normalize(), c.thrustForwardSpeed)
}
