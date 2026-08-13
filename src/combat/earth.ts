import { Vector3 } from 'three'
import { inCone, type ConeShape } from './cone'
import { horizontalDistance, isTargetable, type Enemy } from './enemy'

/**
 * Earth: raise, throw, wall. The armour-breaker, and the only hard cover in the game.
 *
 * Section 4.2 gives earth three verbs and one sentence: "the only source of hard cover and the
 * only reliable armor-breaker. Slow, committed, high payoff." Two moves, mapped the way water's
 * three verbs mapped onto two:
 *
 * - **Stone Throw** (the light verb, on the element's light key) hurls a rock down a narrow
 *   forward reach. This is the *throw*, and it is the only move in the borrowed elements that
 *   does real damage. It is what makes section 4.4's promise about the heavy armoured soldier
 *   true — see the armour discussion below, which is the load-bearing part of this whole module.
 * - **Stone Pillar** (the heavy verb, pressed and released) raises a column of rock out of the
 *   ground a few metres ahead. This is the *raise* and the *wall* in one gesture: the pillar is
 *   what the player puts between themselves and an archer, and anything standing on the spot it
 *   comes up through is shoved off its feet.
 *
 * **Why raise and wall are one verb rather than two.** They are the same act — rock leaving the
 * ground where you aimed — and they differ only in what the player wanted out of it. A wall is
 * a pillar you stood behind; a raise is a pillar you put under someone. Splitting them would
 * have needed a third binding, and section 2.1 of the water design note is explicit that there
 * is no third binding to have: "Each element gets one quick verb and one committed verb, and if
 * a design needs a third, it needs a different design." One object, two uses, is the design that
 * fits.
 *
 * **Earth is additive, not terrain deformation, and that is the insight that made it buildable.**
 * Nothing in the world system can deform an island mesh — `createTerrainQuery` closes over a
 * fixed list of island meshes, and `props.ts` states outright that decorative geometry must never
 * be fed into it. A raised pillar does not need deformation: it is a *new collidable object*,
 * owned by the fight, living in `Encounter.pillars` beside the arrows. What it collides with is
 * discussed under `pillarBlocks` below, and what it deliberately does not collide with is
 * discussed there too, because "hard cover" must not quietly come to mean less than it says.
 *
 * **What section 4.2 asks for and this builds.** All three words are here. The earthbender
 * duelist of section 4.4 — the enemy that "removes his cover and his landing spots" — is not,
 * and cannot be: removing the player's cover means removing a pillar, which this module could
 * support, but removing landing spots means deforming an island, which is the thing the world
 * cannot do. It is a world-system cycle rather than a combat one, exactly as water's pooled
 * hazard surface is.
 *
 * **Earth is inside the armour model, and the heavy's two rows are the whole point.**
 * `BendingSource` carries `'stone'` and `'pillar'`, so `ArmourTable` is total over both and the
 * heavy armoured soldier answers each:
 *
 * - **The stone breaks plate at full damage** (`stone` damage 1). This is the row section 4.4's
 *   sentence lives or dies on. Any fraction below 1 would make the only *reliable*
 *   armour-breaker less reliable than the Pressure Wave, whose row is already 1 — and the doc
 *   names earth and the environment as the two answers to this type, so the two answers taking
 *   the same fraction is the consistent reading. Its knockback is reduced rather than full,
 *   because displacement is the currency this type exists to defend.
 * - **The pillar shoves plate less far** (`pillar` knockback below 1, damage moot). A pillar
 *   carries no damage at all. What it can do to a soldier is displace one, and this is the
 *   ground itself moving rather than air pushed at a body — which is why plate is not proof
 *   against it the way it is against a gust, and why the fraction is a reduction rather than the
 *   zero the gust row gets.
 *
 * Both rows carry their full argument in `config.ts`, and `encounter.test.ts` pins the
 * arithmetic that makes the design document's claim true rather than merely asserted.
 *
 * **Nothing here kills anything.** The stone does real damage and damage is what moves a soldier
 * down `recoveryHealthFractions`, which is the ladder section 4.6 describes; it never removes
 * one. Nine stones take a heavy through every rung of that ladder and the ninth is a permanent
 * down, in exactly the sense every other move in the game means it.
 */
export interface EarthConfig {
  /**
   * The thrown stone's reach: how far, and how wide.
   *
   * The narrowest cone any move in the game sweeps, and that is the trade for being the light
   * verb that does real damage. A gust spans 120 degrees and shoves; a grip spans 60 and holds;
   * this spans 40 and *hurts*, so the three light verbs are separated by what they do rather
   * than by how much ground they cover. A rock is one object thrown at one body: a wide earth
   * cone would be a gust that also broke armour, which is the shape water's design note warns
   * about when it explains why the grip has no damage parameter.
   *
   * The range is deliberately equal to the gust's 12 and to the Vortex's radius at full charge,
   * so **no light verb out-ranges another** — what differs between the three is width, price and
   * payload, never reach. It also has to clear the heavy's `strikeRange` of 3.6 by a wide margin,
   * because the whole point of the move is breaking plate without standing inside its swing.
   */
  stone: { range: number; halfAngle: number }
  /**
   * Half-height of the band the stone sweeps.
   *
   * Two vertical extents in this config rather than water's one, and the reason is that earth's
   * two verbs are not one kit the way pull-and-hold is: this one is a band around a thrown
   * object, and `raiseVerticalReach` below is a limit on where the *ground* may be. They measure
   * different things, so sharing a number would be a coincidence dressed as a rule.
   *
   * Against the six bands that already exist — staff 2.0, water 3.0, Pressure Wave 4.0, Air Wall
   * 4.0, gust 5.0, Vortex 8.0 — this sits with the wave and the wall in the middle. Above
   * water's 3.0, because a thrown mass is not a rope held at arm's length and it has to reach a
   * soldier on a low ledge. Below the gust's 5.0, because a gust is a slab of moving air filling
   * a volume and this is one rock.
   *
   * The deciding argument is the same one that fixed water's number: **a damage move that
   * reaches high wins fights from a hover with no counterplay.** Earth is slow, and slow is only
   * a real cost if the player has to be somewhere a soldier can answer. A test pins that a
   * player hovering just out of this band is still inside an archer's 3D reach, which is the
   * enemy whose whole job is to make altitude expensive.
   */
  stoneVerticalReach: number
  /**
   * Damage one stone does.
   *
   * The largest single-press damage figure in the game outside a committed dive, and every
   * comparison that sets it is to a number already shipped: the gust's 0.5, the staff opener's
   * 0.7, the staff finisher's 1.2, the Pressure Wave's ceiling of 2.2.
   *
   * Under the finisher's 1.2, deliberately and narrowly. The finisher sweeps 190 degrees at 4.2
   * and is the reward for closing to melee range with a character who has no block; a stone is
   * thrown from 12 units at a target that cannot answer. If the safe move paid better than the
   * dangerous one, section 4.1's whole "he is not a damage-per-second character" would be
   * something the numbers contradicted.
   *
   * Above the gust's 0.5 by more than a factor of two, because it is on a cooldown four times
   * as long, costs breath the gust does not, and catches a third of the bodies.
   *
   * Against a spear's 1.5 health this is deliberately *not* a one-shot: one stone leaves a spear
   * at 0.4, so even the game's slowest attack needs a follow-up. Against the heavy's 4.0 and its
   * rungs of 4.0, 2.4 and 1.2 it is four stones, then three, then two — see `config.ts` for that
   * arithmetic set against the staff's, which is what "the only reliable armour-breaker" has to
   * mean in numbers rather than in prose.
   */
  stoneDamage: number
  /**
   * How hard a stone shoves what it hits, in metres per second.
   *
   * Well under the gust's 26 and under the staff finisher's 18, and that ordering is the point:
   * displacement is air's currency, and an earth move that also shoved hardest would leave the
   * gust with nothing of its own. It is above the staff opener's 4 because a rock has mass.
   *
   * Sized against the rim as much as against the other moves. At `knockbackDamping` 2.6 this
   * travels `stoneKnockback / knockbackDamping` — about 3.8 m — so a stone cannot walk a soldier
   * off the island in one press the way a gust's 10 m can. That matters because environmental
   * removals pay less Focus by design (section 4.6), and a cheap repeatable move that produced
   * them would make the stingy path the easy one.
   */
  stoneKnockback: number
  /**
   * Seconds between stones. **This is what "slow, committed" costs.**
   *
   * The longest cooldown on any light verb: four times the gust's 0.45 and well past the grip's
   * 1.1. Earth's identity is commitment, and of the four ways to charge for it — a wind-up, a
   * recovery, a cooldown, or a meter — a cooldown is the only one the game already has a shape
   * for on this key, and it is the one the player can learn without being shown a number.
   *
   * A wind-up was the more faithful answer and was rejected on a measurement rather than on
   * taste: no player move in this game has one. The Vortex charges, but charging is the *heavy*
   * key's gesture and it produces a stronger move for longer holds, which is the opposite of a
   * commitment the player cannot back out of. Adding a wind-up to the light key would have meant
   * a new piece of player state, a new refusal for `main.ts` to draw, and a tell for a window
   * during which the player is neither attacking nor able to stop — for a feel that this
   * cooldown already delivers from the other side of the press.
   *
   * Deliberately far above `pillarSeconds / maxPillars`, so throwing is never the thing that
   * rations cover: the two verbs are priced in different currencies on purpose.
   */
  stoneCooldownSeconds: number
  /**
   * Breath one stone spends, deducted on the frame it fires, refusing to fire below the cost —
   * the contract `stepSlipstream` uses for a dodge and `canWaterGrip` for a grip.
   *
   * Above the grip's 12 and under the Slipstream's 28. Above the grip because this is the move
   * that does damage and the grip's real price is its cooldown; under the dodge because the
   * dodge is what saves the player's life and nothing offensive should crowd it out of the bar.
   * At this cost a full bar of 100 buys six stones, which the cooldown already spreads over
   * nearly eleven seconds — long enough that `breathRegenPerSecond` has paid most of it back, so
   * a player who only throws never runs dry, and one who throws *and* dodges *and* thrusts does.
   */
  stoneBreathCost: number
  /**
   * How far ahead of the player a pillar comes up, in metres.
   *
   * Past every melee reach in the game — the spear's 3.2 and the heavy's 3.6 — so a pillar
   * raised in front of the player lands *between* them and whatever is closing, rather than
   * behind it. That is the difference between cover and decoration.
   *
   * Not so far that aiming it is a separate skill: at this distance the pillar is inside the
   * stone's own 12-unit reach and comfortably on screen, so the player can see where it will go
   * from where they are looking. It also fixes how forgiving the cover is, and that is a
   * measurement rather than a feeling — see the note on `pillarRadius`.
   */
  raiseDistance: number
  /**
   * How far above or below the player's own feet the ground may be for a raise to take.
   *
   * The heavy verb's vertical extent, and it is a limit on the *world* rather than a band around
   * a target — which is why it is its own number and not shared with `stoneVerticalReach`. If
   * there is no ground within this much of the player's height at the raise point, the move is
   * refused and costs nothing.
   *
   * **This is the number that stops cover from being free.** Without it, a player hovering fifty
   * metres up could drop a pillar onto ground they are nowhere near, and repeat it: the archer
   * exists to make hovering expensive, and hard cover manufactured from altitude would answer
   * the archer with no counterplay at all. Bending rock takes a bender standing more or less on
   * it, which is both the faithful reading and the one that keeps the move in the ground layer
   * where section 4.2's "drop a pillar under them" happens.
   *
   * Equal to water's whole-element band of 3.0, and equal for a different reason than water's:
   * there it bounds how far a control move reaches, here it bounds how far from the ground the
   * bender may be. The shared value is a coincidence worth naming rather than a rule, and
   * `earth.test.ts` asserts what it means — a jump's worth of clearance is fine, a glide is not.
   */
  raiseVerticalReach: number
  /**
   * The pillar's radius, in metres.
   *
   * This one number decides how good the cover is, and the arithmetic is worth having in hand.
   * An arrow is aimed at `playerPosition`, so the pillar covers the player exactly while it sits
   * within its own radius of the line from the archer to them. If the player then steps sideways
   * by `x`, the pillar's offset from that new line is about `x * (D - raiseDistance) / D` for an
   * archer at distance `D` — so against the shipped archer at its 30-unit firing range, this
   * radius and a `raiseDistance` of 6 give the player about 1.5 m of lateral freedom before the
   * cover stops covering.
   *
   * That is deliberately tight. Section 4.1 makes every defensive option positional, and cover
   * the player can wander away from is cover they have to keep *using*. Wider would make it a
   * fixed installation; much narrower and staying behind it would be a precision task at the one
   * moment the player is being shot at.
   *
   * Also chosen to read as bent earth beside the decorative pillars already on the temple
   * islands, whose shafts are 0.7 to 0.8: a raised one is visibly chunkier than architecture.
   */
  pillarRadius: number
  /**
   * The pillar's height above the ground it rises from, in metres.
   *
   * Well over the character's own 1.8, so it is a thing to stand behind rather than a boulder to
   * crouch behind, and over a standing jump's apex so an archer cannot simply be waited out by
   * the arrow arriving over the top. Every arrow in the game is loosed from `SHOT_HEIGHT` 1.1 and
   * aimed at the player's feet, so on flat ground a shot is always descending and this height has
   * enormous margin; the margin is for the case that actually threatens it, which is an archer
   * standing on higher ground than the player.
   */
  pillarHeight: number
  /**
   * Seconds a pillar stands before it sinks back.
   *
   * **A permanent pillar is a level editor and a one-second pillar is not cover**, so this is the
   * number the move's whole feel sits on. Set against the archer's own cycle rather than picked:
   * `windUpSeconds` 0.8 plus `recoverSeconds` 1.1 is 1.9 seconds a shot, so this is three shots'
   * worth of shelter from one press. Two would be a trade and four would be a place to live.
   *
   * Far under the enemy `downedSeconds` of 18, so a pillar can never outlast a knockdown and
   * become the thing the player waits behind while the patrol gets up. Far over the Air Wall's
   * `maxSeconds` of 0.9, because these are opposite tools on purpose: the wall is held, aimed,
   * and returns fire for as long as breath allows; the pillar is placed once, costs Focus, and
   * only ever stops things.
   *
   * **One clock owns this, and nothing may shorten it.** Not the patrol restore, not the player's
   * own down beat. That is a decision with a mechanical reason as well as a thematic one — see
   * `Pillar.secondsLeft`.
   */
  pillarSeconds: number
  /**
   * How many pillars may stand at once.
   *
   * Two, and the third press retires the oldest rather than being refused. Both halves are
   * decisions.
   *
   * **Two**, because one pillar covers one bearing and the shipped patrol has three things that
   * shoot — two archers and a net thrower. Two pillars therefore let the player answer two of the
   * three and force a choice about which, where three would let them build a box and section
   * 4.4 is explicit that "the intended answer is almost always movement rather than a specific
   * counter-move". It also bounds the arithmetic: at `pillarSeconds` and `raiseFocusCost` as
   * shipped, a full Focus bar cannot buy more cover than this cap allows to stand anyway.
   *
   * **Retiring the oldest rather than refusing**, because a refusal the player cannot see is the
   * worst kind. Every other refusal in the game is legible — a cooldown they learn, a meter the
   * HUD draws — and "you already have two pillars" is a rule with nothing on screen to say so,
   * except the two rocks themselves. Since those two rocks *are* on screen, replacing the older
   * one is a rule the player can read directly off the world: the far pillar sinks as the new one
   * rises. It also keeps the invariant that a press which is paid for always produces something.
   */
  maxPillars: number
  /**
   * How hard a rising pillar shoves a soldier standing where it comes up, in metres per second.
   *
   * The mechanical answer to section 4.2's "drop a pillar under them". Small: at
   * `knockbackDamping` 2.6 this is a little over 2 m of travel, which is enough to put a body
   * outside the rock's own footprint and no more. A large shove here would make the heavy verb a
   * second gust, which is both a worse gust — it costs Focus — and a theft of the one currency
   * air owns.
   *
   * Directed outward from the pillar's centre, which is the direction that resolves the thing it
   * exists to resolve: a soldier standing exactly where a column of rock arrives has to end up
   * beside it rather than inside it.
   */
  raiseShoveSpeed: number
  /**
   * Upward speed a rising pillar gives a soldier it comes up under, in metres per second.
   *
   * Under the Vortex's *minimum* lift of 5, deliberately: at gravity 20 this is about 0.4 seconds
   * off the ground and less than half a metre of apex, which is a stumble rather than a lift.
   * That is still mechanically real, because `stepEnemy`'s airborne branch makes an enemy off its
   * feet inert and cancels a wind-up in progress — so a pillar under a soldier interrupts it,
   * which is what the design document's worked example asks for. What it must not be is a
   * Vortex: gathering and lifting a group is air's payoff, and a cheaper version of it on earth's
   * heavy key would make the Vortex the move nobody presses.
   */
  raiseLiftSpeed: number
  /**
   * Focus one pillar spends. **The second Focus sink in the game, and priced against the first.**
   *
   * Section 4.5 gives Focus one job — "spends on elemental heavy moves" — and the water design
   * note left open whether earth also spends it. It does, and the reason is that the alternative
   * is worse: an earth heavy verb priced only in breath would be hard cover on a fast-refilling
   * meter, which is a permanent answer to the archer for a price the player stops noticing. Focus
   * is the one meter in the game that is *earned*, and cover is exactly the kind of thing that
   * should cost something earned.
   *
   * The number is anchored to `damageDrain`, which is 30: **a pillar costs precisely what taking
   * a spear hit costs.** That is the comparison that decides it, because it makes the trade
   * legible without a tutorial — the cover is priced at exactly the hit it is bought to prevent,
   * so a pillar that stops one arrow has broken even and one that stops three is a win.
   *
   * Below the Ice Lock's 35, and the two prices are the whole relationship between the elements'
   * heavy verbs. They share one bar, so this is a comparison and not two independent numbers:
   *
   * - A freeze takes a whole rank out of the fight for 3.2 seconds and it is the strongest single
   *   effect the player can produce. A pillar does nothing to anybody: it changes the shape of
   *   the ground. The stronger effect should cost more, so the freeze keeps the top price.
   * - Against a full bar of 100 the two are three pillars, or two freezes, or one of each with 35
   *   left over. That last is the interesting line and it is deliberately affordable: section
   *   4.2's own worked example chains water into earth, and a pricing where the document's
   *   example sequence could not be paid for would be a pricing that contradicted the document.
   * - Any spend at all destroys the Avatar State's arm pip, which needs the bar held at maximum
   *   for `armSeconds` 4. So both elements' heavy verbs are still bought against the escalation,
   *   which is the trade section 4.5 asks for, and adding a second sink does not soften it.
   *
   * Every number here is an argued guess. None of it has been played.
   */
  raiseFocusCost: number
  /**
   * Breath one pillar spends, on top of the Focus.
   *
   * **Exactly the Ice Lock's 18, and equal on purpose.** The instinct is to charge more for
   * lifting rock than for freezing water, and it is the wrong instinct here: breath is not where
   * either heavy verb is priced. Focus is the gate that is meant to be felt, and two meters
   * gating one press is one more refusal for the player to diagnose — so the differentiation
   * between the two heavy verbs belongs in the Focus price and in what they do, not in a second
   * meter saying the same thing twice. `earth.test.ts` asserts the equality against
   * `freezeBreathCost` rather than against the literal, so a retune of either moves both.
   */
  raiseBreathCost: number
}

/**
 * A column of rock the player raised, standing in the world for a few seconds.
 *
 * Owned by `Encounter` beside the arrows, and for the same reason: it is a thing this fight put
 * into the world, with a lifetime of its own, that both sides can meet. It is deliberately *not*
 * a prop and deliberately not part of the terrain — see the module comment.
 */
export interface Pillar {
  /**
   * A counter-derived id, unique within the fight.
   *
   * The same contract `Projectile.id` has and for the same reason: the view layer keys a mesh off
   * it, so an id that repeated would let one pillar's mesh be reused for another's lifetime, and
   * `Math.random()` would make the fight unrepeatable in a test.
   */
  id: string
  /** The centre of the base, on the ground it rose from. */
  position: Vector3
  /**
   * The radius and height it was raised with, copied from the config rather than read back from
   * it.
   *
   * Carried on the object for the reason `Projectile.damage` is: a pillar that had to ask the
   * config what shape it is would change shape under a retune while it was standing, and every
   * consumer — the block test, the view, the shove — would then be measuring something else than
   * the rock the player is looking at.
   */
  radius: number
  height: number
  /**
   * Seconds of life left.
   *
   * Remaining rather than elapsed, like `Enemy.heldSeconds`, so expiry needs no config lookup and
   * the countdown can be applied in one place.
   *
   * **Nothing shortens this except time.** Not the patrol restore, which discards the arrows
   * beside it, and not the player's own respawn. The thematic argument is section 6's rule that
   * the fight "keeps whatever state he put it in" — a pillar is more clearly the player's own mark
   * on the world than a hold on a soldier is. The mechanical argument is stronger and is the one
   * that decided it: the view layer has no way to be told an object died early. `Effect` has no
   * kill hook and the pillar's mesh is disposed when its record disappears, so a fight that
   * deleted a pillar early would leave either a rock drawn where nothing blocks arrows or a rock
   * vanishing while it still does. That is the exact failure `ice-shell.ts` exists to avoid, said
   * about a longer-lived object. One clock, and no exceptions to it, is what makes the drawn rock
   * and the blocking rock the same rock.
   *
   * In practice neither beat can outlive a pillar anyway: a restore needs the player past
   * `respawnRange` 52, which no ground speed in the game covers in `pillarSeconds`, and the down
   * beat's two ramps are shorter than one. So this is a guard rather than a fix, the same
   * standing the `hitMarks` clear has — and it is written down for the same reason, that nobody
   * retuning either constant would think to check the relationship.
   */
  secondsLeft: number
}

/** The stone's cone, assembled from its own band. */
export function stoneShape(c: EarthConfig): ConeShape {
  return {
    range: c.stone.range, halfAngle: c.stone.halfAngle, verticalReach: c.stoneVerticalReach,
  }
}

/**
 * Whether a target lies inside a stone throw.
 *
 * Kept as its own name over a bare `inCone` for the reason `inGust` and `inWaterGrip` are: it
 * gives the effect that draws the reach an independent mechanism to be checked against, so the
 * drawn cone and the cone that bites cannot drift apart.
 */
export function inStoneThrow(
  origin: Vector3, forward: Vector3, target: Vector3, c: EarthConfig,
): boolean {
  return inCone(origin, forward, target, stoneShape(c))
}

/**
 * Everyone one stone catches. Named so a caller cannot forget the cone test.
 *
 * Filters by geometry only, exactly as `gustTargets` and `waterGripTargets` do: `stepEncounter`
 * applies `isTargetable` itself, so that "connected" means a live soldier took the rock rather
 * than a body being shoved across the island.
 */
export function stoneThrowTargets(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: EarthConfig,
): Enemy[] {
  return enemies.filter((enemy) => inStoneThrow(origin, forward, enemy.position, c))
}

/**
 * Everyone a stone would catch who is worth aiming at, for the aim preview.
 *
 * The same split `gust.ts` makes between `gustTargets` and `liveGustTargets`, and for the same
 * reason: a preview that lights up for a body promises something the move cannot deliver.
 */
export function liveStoneThrowTargets(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: EarthConfig,
): Enemy[] {
  return stoneThrowTargets(origin, forward, enemies, c).filter(isTargetable)
}

/**
 * Whether a stone thrown now would catch anyone worth aiming at.
 *
 * The cheap form of `liveStoneThrowTargets`, for the reticle and the world-space tell, which only
 * need a yes or no. `.some` rather than two `filter` passes because this runs every frame for the
 * whole session; `earth.test.ts` holds it to the list form on a range of arrangements rather than
 * restating the rule, exactly as `gust.test.ts` does for `anyLiveGustTarget`.
 *
 * **Deliberately does not ask about armour**, unlike the gust's version of this predicate. That
 * one takes the enemy configs so the reticle stays cold on a heavy a gust cannot touch — the
 * armour's cheapest tell. Earth has nothing to say there: no armour in the game turns a stone
 * away, and a reach preview that warmed only for targets the move could hurt would, the day one
 * did, be teaching the opposite lesson about the move whose entire job is hurting them.
 */
export function anyLiveStoneThrowTarget(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: EarthConfig,
): boolean {
  return enemies.some(
    (enemy) => isTargetable(enemy) && inStoneThrow(origin, forward, enemy.position, c),
  )
}

/**
 * The shove a stone puts on what it hits: outward, away from the thrower, and flat.
 *
 * Outward is the deliberate contrast with the grip, which drags inward, and it is the same
 * direction a gust pushes — the vocabulary the whole game reads by, per the water design note's
 * section 5. No vertical component: a rock thrown at a body knocks it back, and lifting is the
 * Vortex's job. An airborne enemy is also inert on its own, so lift would soften the one move
 * that is supposed to hurt.
 */
export function stoneImpulse(origin: Vector3, target: Vector3, c: EarthConfig): Vector3 {
  const outward = new Vector3(target.x - origin.x, 0, target.z - origin.z)
  // Standing on the thrower leaves the direction undefined: do no push, and do not divide. Zero
  // rather than a fabricated heading, for the reason `horizontalTo` in `enemy.ts` reports an
  // absence rather than answering (0, 0, -1) — a made-up direction is indistinguishable from a
  // real one to every caller downstream.
  if (outward.lengthSq() < 1e-8) return new Vector3()
  return outward.normalize().multiplyScalar(c.stoneKnockback)
}

/**
 * Where a pillar would rise, or null when there is nowhere to raise one from.
 *
 * Null in two cases, and both are refusals rather than failures. There may be no ground at all
 * under the raise point — `groundHeightAt` answers null over the void between islands, and a
 * pillar founded on nothing is not a thing to invent a fallback for. Or the ground may be
 * further from the player's own height than `raiseVerticalReach` allows, which is the rule that
 * stops cover being manufactured from a hover; see that field for the argument.
 *
 * Takes the ground query rather than a height, so the one place that decides where a pillar can
 * stand is also the place that knows why it cannot. The heading is flattened before it is
 * followed, because the raise point is a spot on the ground ahead of the player and a player
 * looking at the sky is not asking for a pillar behind them.
 */
export function pillarSite(
  origin: Vector3,
  forward: Vector3,
  ground: { groundHeightAt(x: number, z: number): number | null },
  c: EarthConfig,
): Vector3 | null {
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() < 1e-8) return null
  flat.normalize()
  const x = origin.x + flat.x * c.raiseDistance
  const z = origin.z + flat.z * c.raiseDistance
  const height = ground.groundHeightAt(x, z)
  if (height === null) return null
  if (Math.abs(height - origin.y) > c.raiseVerticalReach) return null
  return new Vector3(x, height, z)
}

/** A fresh pillar at a site, carrying the shape it was raised with. */
export function spawnPillar(id: string, position: Vector3, c: EarthConfig): Pillar {
  return {
    id,
    position: position.clone(),
    radius: c.pillarRadius,
    height: c.pillarHeight,
    secondsLeft: c.pillarSeconds,
  }
}

/**
 * Every pillar one frame older, with the expired ones gone.
 *
 * A free function so the countdown exists once. It runs every frame **whatever element is
 * selected**, for the reason every cooldown in `stepEncounter` does: a lifetime that only
 * advanced while earth was in hand would let a player park a pillar by switching away, and cover
 * that lasts as long as you do not use the rest of your kit is not a cost.
 */
export function stepPillars(pillars: readonly Pillar[], dt: number): Pillar[] {
  const alive: Pillar[] = []
  for (const pillar of pillars) {
    const secondsLeft = pillar.secondsLeft - dt
    if (secondsLeft > 0) alive.push({ ...pillar, secondsLeft })
  }
  return alive
}

/**
 * Add a pillar, retiring the oldest if the cap is already reached.
 *
 * The eviction, rather than a refusal, is argued on `maxPillars`. Kept here rather than inline in
 * `stepEncounter` so the cap is enforced in one place and can be tested without building a
 * fight, and written as a slice off the front because the array is in raise order — the same
 * oldest-first rule `effect-pool.ts` applies to its own cap, and for the same reason.
 *
 * A non-positive cap yields an empty list rather than throwing. That is the honest reading of
 * "no pillars may stand", and it means a misconfigured cap disables the move rather than
 * corrupting the array — which `stepEncounter` then reports as a raise that fired and produced
 * nothing, not as a crash mid-frame.
 */
export function addPillar(
  pillars: readonly Pillar[], raised: Pillar, c: EarthConfig,
): Pillar[] {
  const next = [...pillars, raised]
  if (next.length <= c.maxPillars) return next
  return next.slice(Math.max(0, next.length - Math.max(0, c.maxPillars)))
}

/**
 * Whether a straight step from `from` to `to` runs into a pillar.
 *
 * **This is what makes "the only source of hard cover" true, and it is worth being precise about
 * what it covers and what it does not.**
 *
 * It stops projectiles, which is the whole of the claim that matters: the game's ranged threats
 * are the archer and the net thrower, and a rock between the player and a bow is cover in the
 * sense section 4.2 means. It works in both directions and for both sides — an arrow an Air Wall
 * turned around is stopped by a pillar in its way just as an incoming one is, because cover that
 * only obstructed the enemy would be a wall the player could shoot through, which is a promise no
 * physical object makes.
 *
 * It does **not** stop anybody walking, and that is a limitation of the world system rather than
 * a design choice, so it is recorded here rather than quietly omitted. Two separate mechanisms
 * would have to exist and neither does. Enemies have no horizontal collision of any kind:
 * `stepEnemy` asks the world for `groundHeightAt` and nothing else, so a soldier already walks
 * through every boulder and temple pillar in the archipelago, and teaching one to walk round a
 * rock would mean giving the enemy model a collider it has never had. The player's own collision
 * *is* a raycast, through `resolveMovement`, but it casts against a `TerrainQuery` built once
 * from a closed list of island meshes — and `props.ts` states the rule that decorative geometry
 * must never be fed into that query. A pillar could be pushed into it through a composed query,
 * and the reason that was not done is what it would drag in: the same cast answers the ground
 * snap, so a standable pillar top would start reporting a surface whose `islandId` is not an
 * island, and `lastGroundIslandId` — the respawn anchor — is read straight off those hits.
 *
 * The honest consequence, stated rather than papered over: **a pillar is cover against arrows and
 * nets, and it is not an obstacle.** A spear soldier walks through it to reach the player. That is
 * a smaller thing than it sounds, because the melee types are the ones the player's whole
 * movement kit already answers and the ranged ones are what the design document says cover is
 * for — but it is less than the words "hard cover" promise on their own, and the fix is a world
 * cycle that gives enemies a collider, not a combat one.
 *
 * The test itself is the *entry* point into the footprint rather than the closest approach, and
 * the difference is small but free: the height is sampled where the arrow crosses the rock's
 * surface, which is the point at which a real pillar would stop it. An arrow that begins the step
 * already inside the footprint is tested at its start, which is the same answer taken at the only
 * position that exists.
 */
export function pillarBlocks(from: Vector3, to: Vector3, pillar: Pillar): boolean {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const fx = from.x - pillar.position.x
  const fz = from.z - pillar.position.z
  const a = dx * dx + dz * dz
  const b = 2 * (fx * dx + fz * dz)
  const c = fx * fx + fz * fz - pillar.radius * pillar.radius

  let t: number
  if (c <= 0) {
    // Already inside the footprint when the step began. Sample there: it is the only position
    // the step offers, and an object that is inside a rock has already met it.
    t = 0
  } else if (!(a > 1e-12)) {
    // No horizontal travel and outside the footprint: a purely vertical step cannot enter it.
    return false
  } else {
    const discriminant = b * b - 4 * a * c
    if (discriminant < 0) return false
    // The nearer root is the entry. Both roots share a sign whenever the step starts outside the
    // circle (their product is `c / a`, which is positive there), so a negative entry means the
    // whole intersection lies behind the step rather than ahead of it — nothing to test.
    const entry = (-b - Math.sqrt(discriminant)) / (2 * a)
    if (entry < 0 || entry > 1) return false
    t = entry
  }

  const y = from.y + (to.y - from.y) * t
  return y >= pillar.position.y && y <= pillar.position.y + pillar.height
}

/**
 * The first pillar a step runs into, or null.
 *
 * "First" by list order rather than by distance along the step, and that is deliberate: the
 * outcome is identical either way, because every caller only needs to know that the flight ended
 * and where — and a pillar the step meets at all is a pillar the step ends at. Ordering by
 * distance would be arithmetic in aid of a distinction nothing downstream can observe, with two
 * pillars standing at once.
 */
export function blockingPillar(
  from: Vector3, to: Vector3, pillars: readonly Pillar[],
): Pillar | null {
  for (const pillar of pillars) {
    if (pillarBlocks(from, to, pillar)) return pillar
  }
  return null
}

/**
 * Soldiers standing where a pillar is coming up.
 *
 * Feet inside the footprint, which needs no tuning number of its own: a body is shoved off a
 * rising column exactly when it is standing on the column. A generous skirt around it was the
 * first draft and it makes the raise a small radial knockback, which is a gust with extra steps.
 *
 * Bounded vertically by the pillar's own height rather than by a band from the config, so a
 * soldier on a ledge well above the rock is not shoved by something it is not standing on. The
 * pillar's own extent is the honest measure of what it can reach, and it means this rule needs no
 * number that could disagree with the geometry.
 *
 * Geometry only, no `isTargetable`: `stepEncounter` applies that itself, exactly as it does for
 * every other move's target query.
 */
export function pillarShoveTargets(
  pillar: Pillar, enemies: readonly Enemy[],
): Enemy[] {
  return enemies.filter((enemy) => {
    if (horizontalDistance(enemy.position, pillar.position) > pillar.radius) return false
    const above = enemy.position.y - pillar.position.y
    return above >= -pillar.height && above <= pillar.height
  })
}

/**
 * The shove a rising pillar puts on a soldier standing on it: outward and up.
 *
 * Outward from the pillar rather than away from the player, because the thing being resolved is a
 * body sharing space with a column of rock, and which way the bender happens to be standing has
 * nothing to do with which way is out.
 */
export function pillarShoveImpulse(pillar: Pillar, target: Vector3, c: EarthConfig): Vector3 {
  const outward = new Vector3(target.x - pillar.position.x, 0, target.z - pillar.position.z)
  if (outward.lengthSq() < 1e-8) {
    // Dead centre: there is no outward direction, so give the lift alone rather than inventing a
    // bearing. A soldier standing exactly on the axis goes straight up, which is both the honest
    // answer and the most legible one.
    return new Vector3(0, c.raiseLiftSpeed, 0)
  }
  return outward.normalize().multiplyScalar(c.raiseShoveSpeed).setY(c.raiseLiftSpeed)
}

/**
 * Whether a stone can be thrown: off cooldown and with the breath to pay for it.
 *
 * Both halves, the way `canWaterGrip` reads both its cooldown and its breath. The action guide
 * asks this function rather than restating either half, and `stepEncounter` asks it too, so the
 * panel cannot claim a stone is ready while the fight refuses it.
 */
export function canStoneThrow(cooldown: number, breath: number, c: EarthConfig): boolean {
  return cooldown <= 0 && breath >= c.stoneBreathCost
}

/**
 * Whether a pillar can be raised: enough Focus, and enough breath.
 *
 * No cooldown, deliberately, and for the reason the Ice Lock has none: Focus is the price, and a
 * hidden timer on top would refuse the move for a reason the player cannot see — the HUD draws
 * the Focus bar and does not draw a cooldown. The cap on standing pillars is the second gate and
 * it is a *visible* one, which is exactly why it was chosen over a cooldown; see `maxPillars`.
 *
 * Deliberately says nothing about whether there is ground to raise a pillar from. That is
 * `pillarSite`'s answer, and it has to stay separate: this predicate is what the action guide
 * dims a row on, and a row that flickered as the player looked around — because the ground six
 * metres ahead came and went — would be reporting terrain through a widget that is meant to
 * report readiness. The fight asks both, in that order, and a raise refused for want of ground
 * costs nothing, exactly as one refused for want of Focus does.
 */
export function canRaisePillar(focus: number, breath: number, c: EarthConfig): boolean {
  return focus >= c.raiseFocusCost && breath >= c.raiseBreathCost
}
