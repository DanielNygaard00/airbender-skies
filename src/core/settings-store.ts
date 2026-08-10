import type { StorageLike } from './save'
import { defaultSettings, readSettings, type Settings } from './settings'

/**
 * Its own key, separate from `SAVE_KEY`: progress and preferences have
 * different lifetimes. A player who clears their shrines should not lose
 * their sensitivity, and this schema is versioned on its own schedule.
 */
export const SETTINGS_KEY = 'airbender-skies:settings:v1'

/** Never throws. A corrupt, hand-edited, or unavailable store falls back to defaults. */
export function loadSettings(storage: StorageLike, prefersReducedMotion: boolean): Settings {
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings(prefersReducedMotion)

    const parsed: unknown = JSON.parse(raw)
    return readSettings(parsed, prefersReducedMotion)
  } catch {
    return defaultSettings(prefersReducedMotion)
  }
}

/** Never throws. Private browsing and a full quota must not crash the game. */
export function writeSettings(storage: StorageLike, s: Settings): boolean {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s))
    return true
  } catch {
    return false
  }
}
