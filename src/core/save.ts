/**
 * What persists between sessions.
 *
 * **There is deliberately no `act` field, and that is the act structure's central save
 * decision.** The act is *derived* from `collectedShrines` — see `actFromShrines` in
 * `src/progress/acts.ts` — rather than stored beside it, because a stored act would be a second
 * fact that could disagree with the first. This codebase refuses that shape elsewhere on the same
 * grounds: `PlayerState.wallRideNormal` is a normal rather than a boolean plus a normal because
 * "a second field could disagree with this one", and `Down.respawnNow` is derived for the same
 * reason.
 *
 * The disagreement here would not be hypothetical, and it is what a hand-edited save file
 * produces. Given both fields, `{"act": 3, "collectedShrines": []}` is a state the game has to
 * have a policy for — trust the act, trust the shrines, or take the lower — and every one of the
 * three is a rule that has to be written, tested, and kept true as the thresholds move. Deriving
 * means that state cannot be written down: the only way to claim Act 3 is to claim eight distinct
 * shrine ids that name real islands, and claiming those *is* Act 3, with the breath ceiling that
 * comes with them. One fact, no policy, nothing to keep in step.
 */
export interface SaveData {
  /**
   * The islands whose shrines have been taken. Distinct, and `loadSave` enforces it.
   *
   * The count is what advances the acts, so this array is load-bearing in a way it was not
   * before, and duplicates would be the cheap way to forge progress.
   */
  collectedShrines: string[]
  maxBreath: number
}

/** Injectable so persistence is testable and a blocked localStorage is survivable. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const SAVE_KEY = 'airbender-skies:save:v1'

export function defaultSave(baseMaxBreath: number): SaveData {
  return { collectedShrines: [], maxBreath: baseMaxBreath }
}

/**
 * Never throws. A corrupt, hand-edited, or unavailable save falls back to a
 * fresh one rather than preventing the game from starting.
 *
 * A fresh save is Act 1, because `defaultSave` has no shrines and the act is derived from them.
 * That falls out of the derivation rather than needing a rule: there is no act field to reset, so
 * there is no path by which a corrupt save can produce a corrupt act.
 */
export function loadSave(storage: StorageLike, baseMaxBreath: number): SaveData {
  try {
    const raw = storage.getItem(SAVE_KEY)
    if (!raw) return defaultSave(baseMaxBreath)

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaultSave(baseMaxBreath)

    const data = parsed as Partial<SaveData>
    /**
     * Deduplicated as well as filtered to strings, which the type-filter alone did not do.
     *
     * Added with the act structure, because the count now decides what the player can do:
     * `{"collectedShrines":["home","home","home","home"]}` is one shrine and four entries, and
     * before this line it would have read as four. Collapsing here means the array this function
     * hands back satisfies what `SaveData` claims of it, so no caller has to know.
     *
     * It is not the only guard — `actFromShrines` counts *placed* shrines, so ids naming no
     * island are discarded too — and the two are independent on purpose. This one fixes the save;
     * that one fixes the count. Either alone would be the only thing between a text editor and
     * Act 2.
     */
    const shrines = Array.isArray(data.collectedShrines)
      ? [...new Set(data.collectedShrines.filter((s): s is string => typeof s === 'string'))]
      : []
    const maxBreath =
      typeof data.maxBreath === 'number' && Number.isFinite(data.maxBreath) && data.maxBreath > 0
        ? data.maxBreath
        : baseMaxBreath

    return { collectedShrines: shrines, maxBreath }
  } catch {
    return defaultSave(baseMaxBreath)
  }
}

/** Never throws. Private browsing and a full quota must not crash the game. */
export function writeSave(storage: StorageLike, data: SaveData): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}
