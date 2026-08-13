/**
 * Which enemies get a burst this frame, and which kind.
 *
 * The fight reports its connects in six separate lists, because each one feeds a
 * differently tuned Focus grant — or, in `redirectHits`' and `stoneHits`' cases, deliberately
 * feeds none. The
 * effects layer wants the opposite: one union, with a down overriding a connect for the same
 * enemy. That rule lived as a loop and a comment in `main.ts`, which has no tests, and the
 * differently tuned Focus grant — or, in `redirectHits`' and `fireHits`' case, deliberately feeds
 * none. The effects layer wants the opposite: one union, with a down overriding a connect for the
 * same enemy. That rule lived as a loop and a comment in `main.ts`, which has no tests, and the
 * staff was added to the fight without being added to the loop.
 */
export interface ImpactLists {
  /** Enemies a gust connected with. */
  hits: readonly string[]
  slamHits: readonly string[]
  staffHits: readonly string[]
  /**
   * Enemies a thrown stone hit.
   *
   * The second list here that pays no Focus of its own, alongside `redirectHits`, and for a
   * different reason: earth's heavy verb spends Focus, so a light verb that earned it would let the
   * element fund its own cover. See `stoneHitThisFrame` in `encounter.ts`. It earns a burst because
   * it is the hardest-hitting single press in the borrowed elements and the player has to see it
   * land.
   */
  stoneHits: readonly string[]
   /**
   * Enemies a Fire Burst connected with.
   *
   * The second list here that pays no Focus of its own, and for a different reason from
   * `redirectHits`: fire deliberately earns none, so that the damage element does not also become
   * the income that funds the Ice Lock and the Avatar State. It earns a burst on exactly the same
   * terms as everything else, because it is the biggest aimed hit in the game and the player has to
   * see it land.
   */
  fireHits: readonly string[]
  /**
   * Enemies a redirected arrow struck.
   *
   * The one list here that pays no Focus of its own — the Air Wall is paid for at the moment
   * of the redirect. It still earns a burst, because a soldier taking an arrow it fired is
   * exactly the kind of thing a player needs to see happen.
   */
  redirectHits: readonly string[]
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
  const hits = [...new Set([
    ...lists.hits, ...lists.slamHits, ...lists.staffHits, ...lists.stoneHits,
    ...lists.redirectHits,
    ...lists.hits, ...lists.slamHits, ...lists.staffHits, ...lists.redirectHits,
    ...lists.fireHits,
  ])].filter((id) => !down.has(id))
  const hit = new Set(hits)
  // A returned arrow counts as a hit, which is what keeps it out of `deflects` below. That
  // matters on the one frame both could be true of the same soldier: a heavy armoured body
  // that shrugged off a gust and took a deflected arrow in the same frame has one thing worth
  // saying about it, and "the arrow landed" outranks "the gust did not". The ordering is the
  // same reason a down suppresses both — the stronger event owns the frame.
  const deflects = [...new Set(lists.deflected)]
    .filter((id) => !down.has(id) && !hit.has(id))
  return { hits, downs, deflects }
}
