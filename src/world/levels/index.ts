import type { Level } from '../level'
import { ARCHIPELAGO } from './archipelago'
import { CANYON_COUNTRY } from './canyon-country'

/**
 * Every region the game can load, and the one line that chooses between them.
 *
 * The game loads exactly one level, and until Canyon Country there was exactly one to load, so
 * `main.ts` read `ARCHIPELAGO` directly. Two regions do not justify a region-selection screen or
 * a loading flow — §3.1's regions connect *in the world*, at altitude and at ground level, so
 * the eventual answer is one scene containing both rather than a menu between them, and a menu
 * built now would be a menu to throw away. What is needed today is a way to load either one:
 *
 *   - `DEFAULT_REGION_ID` is what ships. The archipelago keeps that job, because it is the
 *     region with the teaching sequence, the patrol, the payload and the waterfalls, and the
 *     canyon is a traversal region with no encounter in it yet.
 *   - `?region=<id>` overrides it, which is how the canyon gets looked at in a browser.
 *
 * An unknown id falls back to the default rather than throwing. A mistyped query parameter
 * should not be the difference between a game and a blank page.
 */
export const LEVELS: readonly Level[] = [ARCHIPELAGO, CANYON_COUNTRY]

export const DEFAULT_REGION_ID = ARCHIPELAGO.id

/** The query-string key that picks a region. */
export const REGION_PARAM = 'region'

/**
 * Resolve a region from a query string, e.g. `?region=canyon-country`.
 *
 * Takes the search string rather than reading `location` itself, so it is testable in node and
 * so the one caller that knows about the browser stays in `main.ts`.
 */
export function selectLevel(search = ''): Level {
  const requested = new URLSearchParams(search).get(REGION_PARAM)
  const fallback = LEVELS.find((l) => l.id === DEFAULT_REGION_ID)!
  if (requested === null || requested === '') return fallback

  const found = LEVELS.find((l) => l.id === requested)
  if (found) return found
  console.warn(
    `Unknown region "${requested}"; loading "${fallback.id}". ` +
    `Known regions: ${LEVELS.map((l) => l.id).join(', ')}.`,
  )
  return fallback
}
