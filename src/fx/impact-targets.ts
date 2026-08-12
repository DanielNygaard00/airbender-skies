/**
 * Which enemies get a burst this frame, and which kind.
 *
 * The fight reports its connects in four separate lists, because each one feeds a
 * differently tuned Focus grant. The effects layer wants the opposite: one union, with
 * a down overriding a connect for the same enemy. That rule lived as a loop and a
 * comment in `main.ts`, which has no tests, and the staff was added to the fight
 * without being added to the loop.
 */
export interface ImpactLists {
  /** Enemies a gust connected with. */
  hits: readonly string[]
  slamHits: readonly string[]
  staffHits: readonly string[]
  downed: readonly string[]
  /**
   * Enemies whose armour turned a whole blow away this frame.
   *
   * The lowest-priority list, and the only one that is not a hit. It arrives already disjoint
   * from the three connect lists *for the move that produced it* — `resolveBlow` puts each
   * caught soldier in exactly one of the two — but not across moves: a gust and a staff swing
   * can land on the same heavy on the same frame, and the gust bounces while the staff bites.
   * The precedence rule below is what settles that.
   */
  deflected: readonly string[]
}

export interface ImpactTargets {
  /** Deduplicated, and with everything in `downs` removed. */
  hits: string[]
  downs: string[]
  /**
   * Deduplicated, and with everything in `downs` *and* `hits` removed.
   *
   * The strictest of the three, because a deflect is the absence of an event and the other two
   * are events. A soldier that both took a real hit and bounced one has had something happen to
   * it, and drawing a "nothing happened" spark on top of a connect would contradict the connect
   * — worse than saying nothing, because the player has to guess which burst to believe.
   */
  deflects: string[]
}

/**
 * One burst per soldier, at the highest priority it earned: down beats hit beats deflect.
 *
 * Three tiers rather than two, and the ordering is the whole content of this function. Written
 * as three independent filters — each list merely deduplicated — a heavy caught by a gust and a
 * finisher on the same frame would get a down burst, a hit burst and a deflect spark stacked at
 * the same point, and `main.ts` would play the down thud, the impact thud and the clang over
 * each other.
 */
export function impactTargets(lists: ImpactLists): ImpactTargets {
  const downs = [...new Set(lists.downed)]
  const down = new Set(downs)
  const hits = [...new Set([...lists.hits, ...lists.slamHits, ...lists.staffHits])]
    .filter((id) => !down.has(id))
  const hit = new Set(hits)
  const deflects = [...new Set(lists.deflected)]
    .filter((id) => !down.has(id) && !hit.has(id))
  return { hits, downs, deflects }
}
