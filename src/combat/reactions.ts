import type { Element } from '../elements/element'
import type { BendingSource } from './enemy'

/**
 * Which element threw each blow.
 *
 * `resolveBlow` already knows the `BendingSource` of everything it applies, and a mark is written
 * in the element's name rather than the move's — water's grip and its freeze both leave a soldier
 * *wet*, and a reaction that fired for one but not the other would be a distinction no player
 * could see.
 *
 * A `Record` over `BendingSource` rather than a switch with a default, so a tenth source fails to
 * compile until someone decides which element owns it. The same device `ArmourTable` uses over the
 * identical union, three files away.
 *
 * **The staff maps to `null` and that is a ruling, not a gap.** It is a weapon rather than a
 * bending verb: it advances the chain, because a landed blow is a landed blow, and it writes no
 * mark, because the reaction table is indexed by `Element` and giving the staff a row would mean
 * inventing a fifth element for the one part of the kit §4.2 keeps separate from bending.
 */
export const SOURCE_ELEMENTS: Record<BendingSource, Element | null> = {
  gust: 'air',
  vortex: 'air',
  // The Pressure Wave is airbending too: §4.2 lists it among the always-available airbending
  // moves, and it is a slam of air whatever the fall that powered it.
  wave: 'air',
  staff: null,
  grip: 'water',
  freeze: 'water',
  stone: 'earth',
  pillar: 'earth',
  burst: 'fire',
}

export function elementOf(source: BendingSource): Element | null {
  return SOURCE_ELEMENTS[source]
}

/**
 * What a pairing produces. `'none'` is a decision, not a hole.
 *
 * Two live reactions, and the shortness of that list is the constraint rather than an admission:
 * the chain's finisher displaces, Steam damages, Mud holds. A third reaction that also damaged or
 * also held would make the table longer without making the fight richer, and would give two
 * mechanisms the same job.
 */
export type ReactionKind = 'none' | 'steam' | 'mud'

/**
 * The mark already on the soldier, against the element now landing.
 *
 * Two nested `Record`s over `Element`, so a fifth element fails to compile until every pairing
 * with it — in both directions — has been ruled on. `LOOKS` in `element-radial.ts` and
 * `WIND_LEGEND` in `wind.ts` use the same device for the same reason.
 *
 * **The table is directional.** A wet soldier hit by fire steams; a burning soldier hit by water
 * does not. Sequence is the thing being rewarded, so a symmetric table would be rewarding a *set*
 * of elements rather than an order.
 *
 * **The diagonal is `'none'` by rule**, stated here once rather than four times below: repetition
 * is the chain's business, and paying for it twice would price one press twice.
 *
 * Two pairings were designed and rejected, and they are recorded in §4.2 of the design note so
 * nobody re-proposes them blind. Dust (earth then air) needs a notion of a soldier whose aim is
 * spoiled, which nothing in the game has, and inventing per-enemy perception state for one
 * reaction is the status bag arriving through the back door. Backdraft (air then fire) would widen
 * the burst's cone, and that cone's 30° half-angle *is* how §4.2's "only element with real
 * single-target damage" is implemented — widening it dissolves the one property that makes fire
 * fire.
 */
export const REACTIONS: Record<Element, Record<Element, ReactionKind>> = {
  air: { air: 'none', water: 'none', earth: 'none', fire: 'none' },
  water: { air: 'none', water: 'none', earth: 'mud', fire: 'steam' },
  earth: { air: 'none', water: 'none', earth: 'none', fire: 'none' },
  fire: { air: 'none', water: 'none', earth: 'none', fire: 'none' },
}

export function reactionFor(mark: Element, verb: Element): ReactionKind {
  return REACTIONS[mark][verb]
}

/**
 * Tuning for the mark-and-reaction system.
 *
 * Its own interface rather than an inline `{ markSeconds: number }` on `CombatConfig`, because
 * this block grows to four fields across the tasks that follow — declaring it here lets each of
 * them extend one type in one place instead of hunting `CombatConfig` in `encounter.ts` for a
 * block that actually belongs to this module.
 */
export interface ReactionConfig {
  /** How long a mark counts, in seconds. */
  markSeconds: number
}
