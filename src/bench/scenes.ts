import { Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'

/**
 * Fixed camera poses that render the same frame every time.
 *
 * **Why this exists.** Every one of this project's tests runs in node with no DOM, so nothing
 * in the suite can see a pixel — the visual half of this work has no automated gate at all, which
 * is exactly the gap `docs/deferred-findings.md` names in "Never verified at the controls":
 * nothing in this project has been played. And the gust cone has already paid for that gap once —
 * `FILL_OPACITY`'s comment in `src/fx/gust-cone.ts` records that its first colour pass, a pale
 * blue at 0.16 and 0.5 opacity, measured correctly in every test and was invisible against the
 * terrain and sky in play, found only by looking. A shot framed identically every time is the
 * cheapest instrument that would have caught it.
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
  /**
   * Seconds from start before the effect fires.
   *
   * For a scene with an `effect`, `duration` must land while that effect is still alive —
   * check its lifetime constant (e.g. `LIFETIME` in `gust-cone.ts`) against `fireAt +
   * duration`. The bench freezes on whatever the last frame drew, so a scene whose clock
   * outlives its effect holds a picture of nothing: the effect has already finished and been
   * disposed by the time anyone looks at the frozen frame.
   */
  fireAt: number
  /** Seconds the bench runs before it freezes on the last frame. See `fireAt`'s note. */
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
     * The effect shot: looking down at the home island's centre from above and behind, so
     * the 12-unit, 120-degree wedge reads as a wedge instead of edge-on. The gust is the
     * first effect on the bench because it is the one `gust-cone.ts` records as having been
     * invisible in play at its first tint — see `FILL_OPACITY`'s comment there.
     *
     * The target's height, 11.9, is the home island's actual raycast surface height at its
     * centre (`world.terrain.groundHeightAt(0, 0)`, measured at ≈11.87 with a scratch probe
     * against `buildWorld(ARCHIPELAGO)` and rounded), not the 14 the game's HUD shows at
     * spawn — the HUD adds `SPAWN_CLEARANCE` (`src/player/state.ts`), a 2-unit clearance the
     * player stands on top of, which is not part of the ground itself. `createGustCone` adds
     * its own `HEIGHT` of 1 above whatever origin it is given, so a target already sitting on
     * the true surface is what keeps the sector from being buried in the terrain.
     *
     * `fireAt`/`duration` land the frozen frame at 0.1s into the gust's 0.22s `LIFETIME`
     * (`gust-cone.ts`) — mid-pulse, with the bright arc partway out through the fill rather
     * than at either extreme. An earlier version of this scene fired at 0.2s and froze at
     * 0.6s, well after the gust had already expired and been disposed: every screenshot of
     * it showed an empty island. See `fireAt`'s doc comment on `BenchScene` for the rule this
     * scene now follows.
     */
    id: 'gust',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: 57.9,
    effect: 'gust',
    fireAt: 0.1,
    duration: 0.2,
  },
  {
    /**
     * Proves the elevation parameter actually reaches the sky rather than sitting unread in
     * the registry. Same pose and region as `light`, and deliberately so: with an identical
     * frame the only thing that can differ between the two shots is the hour, so if `light`
     * and `golden-hour` render identically, `createRenderer`'s elevation argument is still
     * wired to nothing. A low elevation rather than a token change from 57.9, so the two are
     * unmistakably different lighting conditions side by side, not a rounding error.
     */
    id: 'golden-hour',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(40, 26, 60), target: new Vector3(0, 8, 0) },
    elevation: 8,
    effect: null,
    fireAt: 0,
    duration: 1,
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
