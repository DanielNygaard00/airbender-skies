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
}

export interface ImpactTargets {
  /** Deduplicated, and with everything in `downs` removed. */
  hits: string[]
  downs: string[]
}

export function impactTargets(lists: ImpactLists): ImpactTargets {
  const downs = [...new Set(lists.downed)]
  const down = new Set(downs)
  const hits = [...new Set([...lists.hits, ...lists.slamHits, ...lists.staffHits])]
    .filter((id) => !down.has(id))
  return { hits, downs }
}
