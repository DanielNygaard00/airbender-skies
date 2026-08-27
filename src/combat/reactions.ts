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
