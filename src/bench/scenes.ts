import { Vector3 } from 'three'
import { SUN_ELEVATION_DEGREES } from '../core/daylight'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { CANYON_COUNTRY } from '../world/levels/canyon-country'

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
export type BenchEffectId =
  | 'gust'
  | 'air-wall'
  | 'vortex'
  | 'vortex-charge'
  | 'shockwave'
  | 'dash-trail'
  | 'slipstream'
  // `steam`, `mud` and `finisher` do not exist yet — they are deferred to step B2, along with
  // water, earth and fire (§2 of `docs/superpowers/specs/2026-08-27-air-vfx-design.md` records
  // why: the shapes they need were specified without reading their geometry, which had already
  // cost this step two fix rounds). Registered here anyway, pointing at `createShockwave` in
  // `./effects.ts` until B2 repoints them, so `BENCH_EFFECTS` stays a total `Record` in the
  // meantime: an id added to this union without a scene, or a scene naming an id this union does
  // not have, is a compile error rather than a bench shot of an effect nobody fires.
  | 'steam'
  | 'mud'
  | 'finisher'

export interface BenchScene {
  id: string
  /** Which region to build. Must be an id in `LEVELS`. */
  regionId: string
  camera: { position: Vector3; target: Vector3 }
  /**
   * Sun elevation in degrees, fed to `daylightFor`.
   *
   * A scene meant to photograph the game's own hour takes `SUN_ELEVATION_DEGREES` rather than
   * a literal. Both such scenes used to hand-round it to 57.9, which is the bench quietly
   * agreeing to drift from the game the moment `SUN_DIRECTION` moves.
   */
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
const CANYON_ID = CANYON_COUNTRY.id

export const BENCH_SCENES: readonly BenchScene[] = [
  {
    /**
     * The lighting shot: no effect at all, looking across the home island into the horizon
     * band so the sky gradient, the fog and the trees' cast shadows are all in frame at once.
     * This is the shot that says whether the pipeline changed the world's look, and it has
     * no effect in it precisely so nothing transient can be mistaken for the light.
     *
     * The shadows are in frame because `src/bench/main.ts` calls `enableShadows`, which it did
     * not always do — and they are the reason this shot can tell the high tier from the medium
     * one, since `shadowMapSize` is the tiers' most visible difference and it shows up nowhere
     * else in a still frame.
     */
    id: 'light',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(40, 26, 60), target: new Vector3(0, 8, 0) },
    elevation: SUN_ELEVATION_DEGREES,
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
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'gust',
    fireAt: 0.1,
    duration: 0.2,
  },
  {
    /**
     * The gust again, over the canyon's slot floor rather than the home island's grass — the
     * dark half of the legibility comparison the `gust` scene's own tint was retuned against.
     * `FILL_OPACITY`'s comment in `gust-cone.ts` records the cyan being chosen so the fill
     * separates from both the archipelago's pale terrain *and* the sky; nothing in the bench
     * checked the other side of that claim until this scene existed, since every prior shot of
     * an effect was taken over the same pale island. Same pose shape as `gust` — 10 up and 20
     * back from the target — recentred on the narrows room, whose floor is the `rock` biome the
     * canyon is built from.
     *
     * `groundHeightAt(0, -18)` measured 13.887 with the same probe technique the archipelago
     * comment used, rounded to 13.9. `(10, -18)` and `(-10, -18)` returned heights above 42 in
     * the same probe — the flank of a hoodoo wall rather than the floor — so the narrows'
     * *centre* is the position on this room that is provably floor and not rock face.
     */
    id: 'gust-canyon',
    regionId: CANYON_ID,
    camera: { position: new Vector3(0, 23.9, 2), target: new Vector3(0, 13.9, -18) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'gust',
    fireAt: 0.1,
    duration: 0.2,
  },
  {
    /**
     * Air Wall. `createAirWallPanel` is a held state rather than a one-shot `Effect` — see its
     * own doc comment — so `./effects.ts`'s `benchEffect` wraps it around a clock that holds the
     * panel up for `DEFAULT_COMBAT_CONFIG.airWall.maxSeconds` (0.9s) before releasing it, which
     * is the closest thing this effect has to a `LIFETIME`. `fireAt`/`duration` land the frozen
     * frame 0.2s into that hold: past `FADE_IN_SECONDS` (0.05s, `air-wall.ts`), so the panel is
     * at full opacity with its streaks visible, and well inside the 0.9s hold, so it is nowhere
     * near the release that starts `FADE_OUT_SECONDS`.
     */
    id: 'air-wall',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'air-wall',
    fireAt: 0.1,
    duration: 0.3,
  },
  {
    /**
     * Vortex. `createVortexRing`'s `LIFETIME` is 0.45s (`vortex-ring.ts`), and the ring sweeps
     * inward from the full radius to `END_FRACTION` of it — so a frame taken at half its life is
     * the one where the sweep itself reads, rather than the frame at either end where the ring
     * is either at rest or nearly gone. 0.1s in, frozen 0.22s later: age 0.22 against LIFETIME
     * 0.45, the same near-half fraction the `gust` scene's own 0.1/0.22 uses.
     */
    id: 'vortex',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'vortex',
    fireAt: 0.1,
    duration: 0.32,
  },
  {
    /**
     * The Vortex's charge tell. `createVortexChargeTell` takes no origin at all in its own
     * signature — it is parented to the avatar in the shipped game — so `./effects.ts` wraps it
     * around a clock that reports `heldSeconds` up to `DEFAULT_COMBAT_CONFIG.vortex
     * .maxChargeSeconds` (1.2s), which is this effect's `LIFETIME` in every sense that matters
     * here: past it the tell would be reporting a charge beyond what the move can ever reach.
     * Frozen at 0.6s in, half of 1.2s, so the ring reads as roughly half-charged rather than
     * freshly opened or fully lit.
     */
    id: 'vortex-charge',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'vortex-charge',
    fireAt: 0.2,
    duration: 0.8,
  },
  {
    /**
     * The Pressure Wave's ring. `createShockwave`'s `LIFETIME` is 0.4s (`shockwave.ts`) and it
     * takes no position of its own — every real caller sets `effect.object.position` after
     * construction, which `./effects.ts` does too. Frozen at age 0.2s, exactly half of 0.4s, so
     * the ring is mid-expansion rather than just born or nearly faded.
     */
    id: 'shockwave',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'shockwave',
    fireAt: 0.1,
    duration: 0.3,
  },
  {
    /**
     * The air-blast dash's streak. `createDashTrail`'s `LIFETIME` is 0.3s (`dash-trail.ts`).
     * Frozen at age 0.15s, half of that, so the streak is mid-fade rather than at either end.
     */
    id: 'dash-trail',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'dash-trail',
    fireAt: 0.05,
    duration: 0.2,
  },
  {
    /**
     * The Slipstream dodge's streak. `createSlipstreamTrail`'s `LIFETIME` is 0.26s
     * (`slipstream-trail.ts`). Frozen at age 0.13s, half of that, for the same mid-fade reason
     * as `dash-trail`.
     */
    id: 'slipstream',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'slipstream',
    fireAt: 0.05,
    duration: 0.18,
  },
  {
    /**
     * Steam, Mud and the staff finisher do not have their own effects yet — they are deferred to
     * step B2 (see the `BenchEffectId` comment above, and §2 of
     * `docs/superpowers/specs/2026-08-27-air-vfx-design.md`) — so all three are wired to
     * `./effects.ts`'s placeholder, which is `createShockwave` at a size closer to the reaction
     * rings `main.ts` draws for Steam and Mud today (`REACTION_RING_RADIUS` 1.4,
     * `REACTION_RING_STRENGTH` 0.85 — private to that file, so this scene cites rather than
     * imports them) than to the Pressure Wave's own full-size ring. `shockwave`'s own `LIFETIME`
     * of 0.4s and its half-life framing apply to all three, since they share the one placeholder
     * factory.
     */
    id: 'steam',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'steam',
    fireAt: 0.1,
    duration: 0.3,
  },
  {
    /** Mud's placeholder shot. See `steam`'s comment above — same factory, same reasoning. */
    id: 'mud',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'mud',
    fireAt: 0.1,
    duration: 0.3,
  },
  {
    /** The staff finisher's placeholder shot. See `steam`'s comment above. */
    id: 'finisher',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'finisher',
    fireAt: 0.1,
    duration: 0.3,
  },
  {
    /**
     * Proves the elevation parameter actually reaches the sky rather than sitting unread in
     * the registry. Same pose and region as `light`, and deliberately so: with an identical
     * frame the only thing that can differ between the two shots is the hour, so if `light`
     * and `golden-hour` render identically, `createRenderer`'s elevation argument is still
     * wired to nothing. A low elevation rather than a token step down from the shipped one, so
     * the two are unmistakably different lighting conditions side by side, not a rounding
     * error. A literal here and not `SUN_ELEVATION_DEGREES`, because differing from the game's
     * hour is the entire point of this scene.
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
