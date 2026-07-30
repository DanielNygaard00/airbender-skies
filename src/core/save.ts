export interface SaveData {
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
 */
export function loadSave(storage: StorageLike, baseMaxBreath: number): SaveData {
  try {
    const raw = storage.getItem(SAVE_KEY)
    if (!raw) return defaultSave(baseMaxBreath)

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaultSave(baseMaxBreath)

    const data = parsed as Partial<SaveData>
    const shrines = Array.isArray(data.collectedShrines)
      ? data.collectedShrines.filter((s): s is string => typeof s === 'string')
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
