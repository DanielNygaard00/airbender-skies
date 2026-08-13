import type { Element } from '../elements/element'

/**
 * The act structure: which of section 5's three rows the player is standing in, and what
 * each row hands over.
 *
 * Section 5 is a table of three acts against the unlocks each one grants. It says nothing
 * whatsoever about what *advances* an act, and that is the one genuinely open decision this
 * module makes. It is made here, in one place, with the reasoning written down, because the
 * trigger is the part most likely to be replaced later and the gate is the part that must not
 * be.
 *
 * **The trigger is the shrine count.** Air shrines already exist — thirteen of them in
 * `src/world/levels/archipelago.ts` — are already collected (`src/player/shrine-collect.ts`),
 * and already persist across sessions (`src/core/save.ts`). They are the only progression
 * signal the game has. The alternatives were considered and all of them lose on the same
 * ground: a story system, dialogue, cutscenes and quest state do not exist, and inventing one
 * to carry three integers would be a narrative cycle wearing a progression cycle's clothes.
 *
 * It also happens to be the most coherent of the available options rather than merely the only
 * one. Section 5's Act 3 movement unlock is "Extended Breath", and Extended Breath *is* the
 * shrine reward (`applyShrineBonus` in `src/player/breath.ts`) — so the meter that advances the
 * acts and the reward the last act is named for are already the same system. See
 * `actFromShrineCount` for why that is elegant rather than circular.
 *
 * **The trigger is deliberately separable from the gate.** Everything below this comment that
 * decides what an act *grants* reads only an `Act`. Nothing reads a shrine. The day a story
 * system arrives, `actFromShrineCount` is the only function that has to change, and every gate
 * in the game carries on unaltered.
 */

/**
 * Which act the player is in.
 *
 * A numeric literal union rather than named strings, for two reasons. Section 5 numbers its
 * rows, so `2` is the document's own word for the middle act and a `'water-and-earth'` would be
 * a second vocabulary to translate. And the acts are *ordered* — an unlock granted in Act 2 is
 * still in hand in Act 3 — so the gate is an inequality, and an inequality over strings would
 * need a lookup to express what `>=` already says.
 */
export type Act = 1 | 2 | 3

/** Every act, in order. Exported so a test can sweep the acts rather than list them. */
export const ACTS: readonly Act[] = [1, 2, 3]

/**
 * The abilities section 5 gates that are not elements.
 *
 * Three of them, and each one is a capability that already exists in the codebase — nothing
 * here was gated into existence. See `UNLOCKED_IN` for what each maps to and section 3 of
 * `docs/superpowers/specs/2026-08-12-act-structure-design.md` for the two rows of section 5
 * that turned out **not** to be separable from something Act 1 already grants.
 */
export type GatedMove = 'wall-ride' | 'dive-rebound' | 'avatar-state'

/**
 * Anything the act structure can withhold.
 *
 * The elements are folded into the same union as the moves rather than given a table of their
 * own, and that is the point of the shape. One union means one table, and one table means
 * section 5 is transcribed exactly once — a reader comparing the code against the document has
 * a single place to look, and there is no second table that could disagree about which act
 * water belongs to.
 */
export type Ability = Element | GatedMove

/**
 * Section 5, transcribed. The act each ability becomes available in.
 *
 * **A total `Record` rather than a switch or a lookup with a fallback, and this is the most
 * load-bearing decision in the module.** `ArmourTable` and `CombatConfig.enemies` are both
 * total Records for the same reason: a new member of the key type fails to *compile* until
 * somebody has decided about it. Earth and fire are being built on branches that cannot see
 * this file, and both will add a name to the `Element` union — at which point this object stops
 * compiling until each has been given an act. That is the whole mechanism, and it is why there
 * is deliberately no `switch (ability)` and no `?? 1` anywhere below.
 *
 * **Adding an element is one line here.** Per section 5's Act 2 column, `earth: 2`; per its Act
 * 3 column, `fire: 3`. Nothing else in this module changes, and nothing else in the game needs
 * to learn that a third or fourth element exists in order to gate it — `isElementAvailable`
 * already asks this table for whatever it is handed.
 *
 * Air is written in at 1 even though Act 1 is where the player starts and the entry can
 * therefore never refuse anything. Two reasons it is not omitted. Air being *unconditionally*
 * available is a promise section 2.3 of the water design note makes explicitly ("Air is never
 * gated"), and a promise is worth stating in the one place it could be broken. And a partial
 * Record would defeat the compile error above: the moment the map is allowed to be missing a
 * key, earth can be missing too.
 */
export const UNLOCKED_IN: Record<Ability, Act> = {
  // Section 5, Act 1: "Airbending core, staff". Air is the baseline and is never withheld.
  air: 1,
  // Section 5, Act 2: "Water, Earth". Water shipped unlocked because there was no act
  // structure to hold it; this line is the cycle the water design note's section 3.4 was
  // waiting for.
  water: 2,
  // Section 5, Act 2 again, and the pairing matters: whatever gates one of these gates the other.
  // Handing over earth without water would give the player the armour-breaker and not the thing
  // that buys the time to use it, which is not what the row means.
  earth: 2,
  // Section 5, Act 3: "Fire, Avatar State". The two arrive together, which is the act that turns
  // a controlled fight into a decisive one -- fire is the only real single-target damage in the
  // kit and the Avatar State is the only thing that boosts everything at once.
  //
  // These two lines are the whole of what adding an element costs this table, which is what the
  // total `Record` over `Ability` exists to guarantee: earth and fire each failed the compile here
  // when they merged, rather than shipping ungated and unnoticed.
  fire: 3,
  // Section 5, Act 2: "Wall-riding". A property of the air scooter rather than a move of its
  // own — the scooter itself is Act 1 — so this gates the climb and leaves the ball alone.
  'wall-ride': 2,
  // Section 5, Act 3: "dive-shockwave". Not the whole Pressure Wave, which section 4.2 lists
  // under "Airbending — always available" and section 5's own Act 1 row therefore grants as part
  // of the "Airbending core". What Act 3 adds is the second half of section 4.3's flagship
  // aerial combo — "then bounce Aang back into the air" — which is `applyBounce`, and which is
  // separable from the slam without inventing anything. The design note argues this at length
  // because it is the reading the owner will want to check.
  'dive-rebound': 3,
  // Section 5, Act 3: "Avatar State", which section 4.5 independently calls "Story-locked in the
  // early game, always situational later". The two agree, so this is the least contested row in
  // the table.
  'avatar-state': 3,
}

/**
 * Whether an ability is in the player's hands yet.
 *
 * An inequality rather than an equality, so an unlock stays unlocked: the acts are cumulative,
 * and Act 3 keeps everything Act 2 handed over. Written once here rather than at each of the
 * four call sites, which is what makes `UNLOCKED_IN` the only statement of the rule.
 */
export function isUnlocked(ability: Ability, act: Act): boolean {
  return act >= UNLOCKED_IN[ability]
}

/**
 * Collected shrines needed to enter Act 2.
 *
 * Four, and the number is taken from the archipelago's own teaching sequence rather than picked
 * as a fraction of thirteen. `src/world/levels/archipelago.ts` documents its islands in tiers,
 * and the first tier is `home` plus the three `ring-*` islands: "below and outward. Reachable by
 * gliding alone, which teaches that altitude converts to distance." Four islands, four shrines,
 * and they are exactly the set a player holding nothing but the Act 1 kit can reach without
 * spending breath. Section 5 says "each act's world design assumes the previous act's kit is
 * fully internalized", and clearing the tier that needs only the glider is the strongest
 * available evidence that the glider is internalised.
 *
 * The wind features line up with section 5's "world teaches" column only partly, and that is
 * worth stating rather than glossing. Act 1 is to teach thermals and ridge lift: the thermal
 * over `home` and the ridge lift along `ring-west`'s cliff face are both inside this tier, so
 * that half holds. Act 2 is to teach wind rivers and downdrafts, and the downdraft is the soft
 * boundary past `ring-east` — which is in this tier, not the next one. The archipelago is one
 * region built as one continuous tutorial, before acts existed, so its air was never sequenced
 * against a table that did not yet apply to it. Region-to-act mapping is the cycle that fixes
 * that, and it needs more than one region.
 */
export const ACT_TWO_SHRINES = 4

/**
 * Collected shrines needed to enter Act 3.
 *
 * Eight: the whole first arc, ending on `spire`. The level file's second tier is `climb-north`,
 * `climb-far`, `rest` and `spire` — the islands that "need sustained thrust, which introduces
 * breath as a cost", finishing with the one that "needs a dive, a zoom climb, and thrust
 * together". A player who has all eight has demonstrated the entire altitude game, which is the
 * kit Act 3's combat is meant to be built on top of.
 *
 * That leaves the five shrines of the hover arc — `perch-east`, the two `gate-*` stumps,
 * `needle` and `beacon` — inside Act 3, which is deliberate rather than a remainder. Section 5
 * asks that "each new region opens with an unpressured traversal sequence before the first
 * encounter", and the hover arc is precisely that: five islands too small to arrive at fast,
 * with no enemy anywhere near any of them (the game's only encounter, `HOME_PATROL`, is on
 * `home`). It is the one stretch of the shipped level that already satisfies that sentence, so
 * Act 3 is the act it belongs to.
 *
 * **Measured, because the thresholds would be worthless if a gated ability were needed to reach
 * a shrine.** All thirteen sit on islands reachable with the Act 1 kit alone — glider, thrust
 * and hover. Not one of them needs wall-riding, water, the rebound or the Avatar State, so no
 * threshold can deadlock: there is no state from which the player is short of shrines *and*
 * short of the ability needed to get more.
 */
export const ACT_THREE_SHRINES = 8

/**
 * Which act a given number of collected shrines puts the player in.
 *
 * **The one function a story system would replace.** Everything else in this module reads an
 * `Act` and knows nothing about shrines, so swapping this out for a quest flag is a change to
 * one function body and to whatever calls it — not to any gate.
 *
 * **Whether "Extended Breath is both the trigger and an Act 3 reward" is circular: it is not,
 * and the distinction is worth being precise about.** A circular gate would be one where the
 * reward is needed to earn the reward — if the breath bonus itself were withheld until Act 3,
 * a player would need extended breath to reach the eight shrines that grant extended breath.
 * That is exactly why the bonus is *not* gated: `applyShrineBonus` pays out from the first
 * shrine, in every act. What Act 3 is named for is the ceiling having become large, and by the
 * eighth shrine it has: `baseMaxBreath` is 100 and `shrineBreathBonusFraction` is 0.1, so the
 * ceiling reads 140 at the Act 2 threshold and 180 at the Act 3 one, against a base of 100.
 * The remaining five shrines carry it to 230. So the act opens on a wing that is already
 * eighty per cent better than the one the game started with, and keeps extending inside the
 * act. The trigger and the reward being one axis is what makes the threshold *mean* something
 * rather than being an arbitrary counter — a story flag would gate Act 3 on nothing the player
 * can feel.
 *
 * **Non-finite and out-of-range counts fall to Act 1 rather than throwing.** This is fed from
 * the save, which `src/core/save.ts` is explicit must never brick the game, and a count is the
 * one thing a hand-edited save file can put anything at all into. `>=` comparisons are false
 * for NaN, so the two thresholds are written in descending order and NaN falls through both to
 * Act 1 — the safe end. A negative count lands there too, and a count past thirteen is Act 3,
 * which is the highest act there is and needs no clamp of its own.
 */
export function actFromShrineCount(collected: number): Act {
  if (collected >= ACT_THREE_SHRINES) return 3
  if (collected >= ACT_TWO_SHRINES) return 2
  return 1
}

/**
 * Which act a shrine list puts the player in.
 *
 * Takes the *placed* shrines and counts the collected ones, rather than taking the save's array
 * of ids and reading its length, and that is a deliberate guard against a hand-edited save.
 * `placeShrines` resolves each saved id against the level through a `Set`, so by the time a
 * shrine list exists an unknown id has been discarded and a repeated one has been collapsed.
 * Counting here therefore cannot be fooled by `["home","home","home","home"]` or by four ids
 * that name no island. (`loadSave` deduplicates as well, for its own reasons; the two guards
 * are independent on purpose, because either one alone would be the only thing standing between
 * a text editor and Act 2.)
 *
 * Structurally typed rather than importing `Shrine`, so `src/progress` does not depend on
 * `src/world`: the only property the rule needs is whether each one is collected.
 */
export function actFromShrines(shrines: readonly { collected: boolean }[]): Act {
  let collected = 0
  for (const shrine of shrines) if (shrine.collected) collected += 1
  return actFromShrineCount(collected)
}
