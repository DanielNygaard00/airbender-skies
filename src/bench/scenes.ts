import { Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'

/**
 * Fixed camera poses that render the same frame every time.
 *
 * **Why this exists.** Every one of this project's tests runs in node with no DOM, so nothing
 * in the suite can see a pixel — the visual half of this work has no automated gate at all.
 * And `docs/deferred-findings.md` records what that costs: the gust cone's first colour pass
 * measured correctly in tests and was invisible in play, found only by looking. A shot framed
 * identically every time is the cheapest instrument that would have caught it.
 *
 * **Why a registry rather than a debug camera.** A camera the operator flies to roughly the
 * same place produces shots that differ by where they flew. The point is that two shots taken
 * a week apart differ only by what changed in the code, so the pose is data, tested, and
 * never touched by hand between comparisons.
 *
 * This is not a level, not a debug menu, and nothing gameplay runs in. The player, the
 * enemies and the input tracker do not exist here.
 */
export type BenchEffectId = 'gust'

export interface BenchScene {
  id: string
  /** Which region to build. Must be an id in `LEVELS`. */
  regionId: string
  camera: { position: Vector3; target: Vector3 }
  /** Sun elevation in degrees, fed to `daylightFor`. */
  elevation: number
  /** The effect to fire, or `null` for a scene that only shows the world and the light. */
  effect: BenchEffectId | null
  /** Seconds from start before the effect fires. */
  fireAt: number
  /** Seconds the bench runs before it freezes on the last frame. */
  duration: number
}

// Imported directly rather than read as `LEVELS[0]`: under `noUncheckedIndexedAccess` an
// array index returns `T | undefined` even for a literal 0, and the archipelago is what the
// bench is deliberately anchored to, not "whichever level happens to be first".
const ARCHIPELAGO_ID = ARCHIPELAGO.id

export const BENCH_SCENES: readonly BenchScene[] = [
  {
    /**
     * The lighting shot: no effect at all, looking across the home island into the horizon
     * band so the sky gradient, the fog and the shadow direction are all in frame at once.
     * This is the shot that says whether the pipeline changed the world's look, and it has
     * no effect in it precisely so nothing transient can be mistaken for the light.
     */
    id: 'light',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(40, 26, 60), target: new Vector3(0, 8, 0) },
    elevation: 57.9,
    effect: null,
    fireAt: 0,
    duration: 1,
  },
  {
    /**
     * The effect shot: close, level with the ground, so a 12-unit wedge fills the frame. The
     * gust is the first effect on the bench because it is the one the deferred-findings file
     * records as having been invisible in play at its first tint.
     */
    id: 'gust',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 4, 16), target: new Vector3(0, 2, 0) },
    elevation: 57.9,
    effect: 'gust',
    fireAt: 0.2,
    duration: 0.6,
  },
]

/** The query-string key that picks a bench scene. */
export const SCENE_PARAM = 'scene'

/**
 * Resolve a scene from a query string, e.g. `?scene=gust`.
 *
 * Takes the search string rather than reading `location` itself, for the reason
 * `selectLevel` does: it stays testable in node, and the one caller that knows about the
 * browser stays in the entry point.
 */
export function resolveBench(search = ''): BenchScene | null {
  const requested = new URLSearchParams(search).get(SCENE_PARAM)
  if (requested === null || requested === '') return null

  const found = BENCH_SCENES.find((s) => s.id === requested)
  if (found) return found
  console.warn(
    `Unknown bench scene "${requested}". Known scenes: ${BENCH_SCENES.map((s) => s.id).join(', ')}.`,
  )
  return null
}
