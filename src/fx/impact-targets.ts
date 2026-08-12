/**
 * Which enemies get a burst this frame, and which kind.
 *
 * The fight reports its connects in five separate lists, because each one feeds a
 * differently tuned Focus grant — or, in `redirectHits`' case, deliberately feeds none. The
 * effects layer wants the opposite: one union, with a down overriding a connect for the same
 * enemy. That rule lived as a loop and a comment in `main.ts`, which has no tests, and the
 * staff was added to the fight without being added to the loop.
 */
export interface ImpactLists {
  /** Enemies a gust connected with. */
  hits: readonly string[]
  slamHits: readonly string[]
  staffHits: readonly string[]
  /**
   * Enemies a redirected arrow struck.
   *
   * The one list here that pays no Focus of its own — the Air Wall is paid for at the moment
   * of the redirect. It still earns a burst, because a soldier taking an arrow it fired is
   * exactly the kind of thing a player needs to see happen.
   */
  redirectHits: readonly string[]
  downed: readonly string[]
}

export interface ImpactTargets {
  /** Deduplicated, and with everything in `downs` removed. */
  hits: string[]
  downs: string[]
}

export function impactTargets(lists: ImpactLists): ImpactTargets {
  const downs = [...new Set(lists.downed)]
  const down = new Set(downs)
  const hits = [...new Set([
    ...lists.hits, ...lists.slamHits, ...lists.staffHits, ...lists.redirectHits,
  ])].filter((id) => !down.has(id))
  return { hits, downs }
}
