import { Vector3 } from 'three'
import { SUN_ELEVATION_DEGREES } from '../core/daylight'
import type { EnemyKind } from '../combat/enemy'
import type { Element } from '../elements/element'
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
  | 'water-grip'
  | 'ice-shell'
  | 'earth-reach'
  | 'fire-burst'
  | 'fire-thrust'
  // None of the ids in this union are deferred behind a placeholder shape any more. Several once
  // were — per §2 of `docs/superpowers/specs/2026-08-27-air-vfx-design.md`, which records why:
  // the shapes they needed were specified without reading their geometry, which had already cost
  // this step two fix rounds. Water, earth and fire were the first out of that hole
  // (`water-grip`, and the shell it and the freeze share, `ice-shell`, first, then `earth-reach`,
  // `fire-burst` and `fire-thrust`). `steam` and `mud` came next, each given its own shape rather
  // than sharing `createShockwave`'s ring the way every reaction once did. `finisher` was the
  // last: it shared that same ring as a placeholder until its own task gave it `createFinisherFlare`,
  // a vertical flare at the player rather than a ring at an enemy. `BENCH_EFFECTS` in
  // `./effects.ts` stays a total `Record` regardless — an id added to this union without a scene,
  // or a scene naming an id this union does not have, is a compile error rather than a bench shot
  // of an effect nobody fires — but that guard is no longer standing in for a shape not yet built.
  | 'steam'
  | 'mud'
  | 'finisher'
  // The impact burst's three kinds. `createImpact` takes `(position, kind)`, not
  // `(origin, forward)` — a burst has no direction of its own, the same reason `vortex` and
  // `ice-shell` above leave `forward` unused — so `./effects.ts` registers all three against
  // the same `(origin, forward) => Effect` shape and ignores the second argument, per that
  // file's own comment on the pattern.
  | 'impact-hit'
  | 'impact-down'
  | 'impact-deflect'
  // The two character shells. Neither is a one-shot `Effect` — `createGuardShell` and
  // `createAvatarAura` are held states advanced with `update(dt, active)`, the same shape
  // `air-wall` and `vortex-charge` above are — so `./effects.ts` wraps each the same way those
  // two already are.
  | 'guard-shell'
  | 'avatar-aura'
  // The staff's two swings. Not `staffArc` with a `finisher` boolean alongside it — the shape
  // itself already carries the difference (`staffShape(false, …)` against `staffShape(true, …)`),
  // and `createStaffArc`'s own doc comment argues at length for why it has no business knowing
  // which one produced the shape it was handed. Two ids rather than one, so each shot can be
  // pointed at directly instead of a scene having to pick a swing for the other to never see.
  | 'staff-opener'
  | 'staff-finisher'
  // The aim tell. Not a one-shot `Effect` — `createAimTell`'s own doc comment says why: it is
  // persistent, held up for as long as the player holds a direction, and driven every frame by
  // `update`'s five arguments rather than fired once and left to run down. `./effects.ts` wraps
  // it the same way it already wraps `air-wall`, `vortex-charge`, `guard-shell` and
  // `avatar-aura` for the identical reason.
  | 'aim-tell'

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
  /**
   * Seconds the bench runs before it freezes on the last frame. See `fireAt`'s note.
   *
   * A caller asking `resolveBench` for a specific effect age (the `AT_PARAM` query parameter,
   * documented on that constant) gets back a `BenchScene` whose `duration` has been replaced
   * to land on that age — `fireAt` is untouched. Read a `BenchScene`'s `duration` as "however
   * long this run needs to take", not as a fact about the scene's own table entry, once that
   * override is in play.
   */
  duration: number
  /**
   * Soldiers to stand in the shot, or omit for none.
   *
   * This exists because the mark pip `enemy-mesh.ts` draws above a marked soldier — the
   * chevron that tells the reaction system apart from a plain hit, per that file's own
   * `createMarkPipGeometry` comment — had never been photographed anywhere: nothing in
   * `src/bench/` has ever built a soldier, so nothing here could put a mark on one to check
   * whether the four elements read apart, whether an unmarked soldier reads as unmarked,
   * whether the pip survives being occluded by another body, or whether a nearly-expired mark
   * fades rather than jumps to a different colour.
   *
   * A field on the scene table, not a special case in `bench/main.ts`, for the reason the
   * `BenchEffectId` union's own comment gives against an `if (scene.effect === 'gust')` chain:
   * the alternative is half a scene's content living somewhere this table cannot describe it,
   * discoverable only by reading `main.ts` scene-by-scene rather than by reading this file.
   *
   * `dx`/`dz` are offsets from the scene's own `camera.target`, not absolute world coordinates.
   * Every other field on `BenchScene` is already relative to that one pose — the shared-frame
   * scenes above compose because their `camera` is a value they can literally copy — and a
   * soldier row pinned to absolute coordinates would break the moment a scene's own target
   * moved, the same coupling this file's poses already avoid everywhere else. Height is never
   * one of the offsets: `main.ts` looks each soldier up on `world.terrain.groundHeightAt` (see
   * `shrine.ts` and `payload.ts` for the identical pattern), because the target is one measured
   * point and the terrain around it is not flat — a soldier held at the target's own `y` would
   * float or sink the moment its `dx`/`dz` moved it off that exact point.
   */
  soldiers?: readonly {
    kind: EnemyKind
    /** Offset from the scene's camera target, in metres — see this field's own comment. */
    dx: number
    dz: number
    /** The element marking this soldier, or `null` for a control with no mark at all. */
    mark: Element | null
    /** Seconds left on that mark. Omit for a fresh one, at the reaction system's own full length. */
    markSeconds?: number
  }[]
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
     * The Water Grip's collar gate. Task 2 gave `water-reach.ts`'s arc a dark collar between its
     * bright core and its outer edge — `ARC_BODY`'s comment there argues the reason at length:
     * B1's rule that every bright element clears `post.ts`'s 0.82 bloom threshold cannot answer
     * whether an effect separates from the ground it is drawn over, because contrast is a
     * difference and a threshold is a level. This is the shot that answers it: whether the dark
     * band inside the arc's bright core actually reads against grass, which is the pale half of
     * the comparison the gust's own tint was retuned against.
     *
     * **Same pose as `gust`, copied field for field rather than tuned.** With an identical frame
     * the only thing that can differ between the two shots is the effect, so the collar can be
     * judged against the flat arc it replaced rather than against a differently-framed picture of
     * it. The rejected alternative was framing water's shorter 10-unit reach (`grip.range` in
     * `DEFAULT_COMBAT_CONFIG.water`, against the gust's 12) more tightly, which would have made
     * the two shots incomparable — a bigger arc in frame is not evidence of a better collar, it is
     * evidence of a different camera. See `gust`'s own comment for why this pose and this target
     * height are what they are; nothing about that argument changes for a narrower cone.
     *
     * `createWaterReach`'s `LIFETIME` is 0.3s (`water-reach.ts`), longer than the gust's 0.22s —
     * a different number from a different effect, not something copied along with the pose.
     * `fireAt: 0.1, duration: 0.22` freezes the frame at age 0.12s, 40% through that 0.3s life:
     * `lookFor`'s grip arc lerps its reach from `1` down to `GRIP_END_FRACTION` (0.15) over the
     * full life, so at t=0.4 the arc sits at roughly two-thirds of the full reach — visibly
     * mid-pull rather than freshly opened at full reach or already collapsed onto the caster,
     * either of which would leave nothing to compare.
     */
    id: 'water',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'water-grip',
    fireAt: 0.1,
    duration: 0.22,
  },
  {
    /**
     * The Water Grip's collar gate again, over the canyon's rock floor — the dark half of the
     * comparison, the same role the canyon plays for `gust-canyon` above. Same pose as
     * `gust-canyon`, copied for the identical reason `water`'s comment gives against `gust`: the
     * only thing that can differ between this shot and `gust-canyon`'s is the effect, so the
     * collar is judged against the flat arc it replaced rather than against a repositioned camera.
     *
     * `fireAt`/`duration` match `water`'s for the same timing argument given there: age 0.12s
     * against `createWaterReach`'s 0.3s `LIFETIME`, the grip's arc partway through its inward
     * travel.
     */
    id: 'water-canyon',
    regionId: CANYON_ID,
    camera: { position: new Vector3(0, 23.9, 2), target: new Vector3(0, 13.9, -18) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'water-grip',
    fireAt: 0.1,
    duration: 0.22,
  },
  {
    /**
     * The ice on a held soldier, closer than every ground effect above because it is not one.
     * `createIceShell`'s own doc comment gives its scale: a 1.3-unit octahedron centred on a
     * body, against the gust's 12-unit, 120-degree wedge the shared pose above is framed for. At
     * 20 units back that shell would be a few pixels of haze — the same "cannot support a
     * judgement about how the effect reads" argument `dash-trail`'s comment makes against the
     * cone pose, for a subject smaller still.
     *
     * **The one scene in this group that does not share the common frame, and deliberately so.**
     * Every scene from `gust` through `water-canyon` above argues for an identical pose precisely
     * because the effects it compares are all the same size and shape — a wedge is a wedge is a
     * wedge, so the only honest way to compare their tints is to hold the camera still. A shell
     * around a body is a different kind of subject, and forcing it into that same frame would not
     * buy a fair comparison; it would make the shot illegible instead. So this scene keeps the
     * region and the centre — the archipelago, the same spot every scene above stands over — and
     * moves only the camera, close enough that a 1.3-unit shell reads as a shape rather than a
     * smudge.
     *
     * Position `(0, 13.8, 4.5)` sits 4.5 units back and 1.9 above the target, at a
     * `atan(1.9 / 4.5) ≈ 23`-degree look-down close to `gust`'s own — a closer throw than the
     * cone poses' 20-odd units, but still not so close the octahedron's facets read as a wall
     * rather than a shape.
     *
     * **Target is `(0, 11.9, 0)`, the same bare ground height every other scene above uses —
     * this scene used to add `CENTRE_Y`'s 0.95 into the target itself, and that was the bug.**
     * `bench/main.ts` hands the scene's `camera.target` straight to `benchEffect` as the
     * effect's *origin* (`benchEffect(effectId, scene.camera.target.clone(), …)`), and
     * `createIceShell` then adds its own `CENTRE_Y` on top of whatever origin it is given. A
     * target of `(0, 12.85, 0)` — ground plus `CENTRE_Y` already folded in, on the theory that
     * doing so would centre the camera on the shell — instead fed the shell a *second* `CENTRE_Y`
     * on top of the first, landing its centre at 12.85 + 0.95 = 13.8: a full `CENTRE_Y` above
     * where the camera was actually aimed, not on it. At the old pose that cropped the shell's
     * own crown: camera `(0, 14.35, 3.5)` looking at that wrong `(0, 12.85, 0)` put the shell's
     * top edge (centre 13.8 plus `RADIUS` 1.3) at 35.3 degrees off the view axis, past
     * `BASE_FOV` 70's 35-degree half-height (`mapping.ts`) — the crown was clipped, not merely
     * close to clipped.
     *
     * With the target restored to bare ground height, `createIceShell` still adds its one
     * `CENTRE_Y` and lands the shell at 11.9 + 0.95 = 12.85, off-axis from the new pose by about
     * 11 degrees; the top edge sits at about 27.3 degrees off-axis, comfortably inside the
     * 35-degree half-height with roughly 7.7 degrees to spare, and the bottom edge at under 4
     * degrees is nowhere close to the frame's other side. (Recomputed independently rather than
     * assumed: `camera.target = (0, 11.9, 0)`, shell centre `(0, 12.85, 0)`, shell top
     * `(0, 14.15, 0)`, angle between the camera's view-axis vector and its vector to each point.)
     *
     * **The structural trap this scene fell into, worth naming so the next scene does not repeat
     * it.** Because the bench hands a scene's *target* to the effect as its *origin*, a scene can
     * never aim the camera at anywhere but the effect's spawn point — there is no separate "look
     * here" the target can mean once it doubles as "spawn here". Any effect that lifts itself
     * above its own origin (this shell's `CENTRE_Y`, or the plume's `HEIGHT` below) therefore
     * always sits some fixed amount above wherever the camera is aimed; that offset cannot be
     * designed away by moving the target, only by choosing a camera pose shallow and close enough
     * to absorb it. This is exactly why the `fire-thrust` scene below keeps its own target at the
     * bare 11.9 ground height rather than trying to pre-add the plume's own `HEIGHT` into it —
     * see that scene's own comment — and it is the shortcut this scene took instead, and paid
     * for.
     *
     * `fireAt`/`duration` land the frozen frame at age 0.4s. `createIceShell` also takes a
     * `holdSeconds`, a second parameter this task's own brief did not carry — `./effects.ts`
     * reaches `DEFAULT_COMBAT_CONFIG.water.gripHoldSeconds` (1.4s) for it, the shorter of the two
     * holds the game applies. The shell's own `FORM_SECONDS` (0.12) and `MELT_SECONDS` (0.25)
     * bound the two moments a frozen frame has to avoid: 0.4s is comfortably past the 0.12s
     * form-in, so the shell is at full size and full opacity, and comfortably short of the 1.4s
     * hold ending — the melt does not start until the hold itself is over — so nothing here is
     * fading either. Fully formed and not yet melting, which is the one moment worth a still
     * frame.
     */
    id: 'ice-shell',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 13.8, 4.5), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'ice-shell',
    fireAt: 0.1,
    duration: 0.5,
  },
  {
    /**
     * Stone Throw's arc, in the shared frame `water`'s own comment argues for at length: with an
     * identical pose the only thing that can differ between this shot and `gust`'s or `water`'s
     * is the effect, so earth's collar (`ARC_BODY` in `earth-reach.ts`) is judged against the
     * same island rather than against a differently-framed picture of it.
     *
     * `createEarthReach`'s `LIFETIME` is 0.26s (`earth-reach.ts`). `fireAt: 0.1, duration: 0.23`
     * freezes the frame at age 0.13s, half the life — the arc mid-travel outward rather than
     * still clipped near the caster or already faded at the far edge, the same mid-life target
     * every cone scene above picks for the same reason.
     */
    id: 'earth-reach',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'earth-reach',
    fireAt: 0.1,
    duration: 0.23,
  },
  {
    /**
     * Fire Burst's arc, the same shared frame and the same reason `earth-reach`'s comment gives
     * just above.
     *
     * `createFireBurst`'s `LIFETIME` is 0.16s (`fire-burst.ts`) — the shortest-lived effect in the
     * game, per that file's own comment. `fireAt: 0.05, duration: 0.13` freezes the frame at age
     * 0.08s, half that life, the same mid-travel target as `earth-reach` and every cone above it.
     * `fireAt` is 0.05 rather than the 0.1 the wider cones use only because a burst this short
     * would leave the frozen frame too close to the end of its life on the wider cones' own
     * `fireAt` — 0.1 would leave just 0.06s of the 0.16s life to land a frame in, still legal but
     * tighter than it needs to be.
     */
    id: 'fire-burst',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'fire-burst',
    fireAt: 0.05,
    duration: 0.13,
  },
  {
    /**
     * Fire Thrust's plume. **The second scene in this group that does not share the common
     * frame, for the same kind of reason `ice-shell`'s own comment gives, not the same reach.**
     * `earth-reach` and `fire-burst` above legitimately share `gust`'s pose because all three draw
     * a ground-scale wedge the shared 22-unit throw was framed for. The plume is not that: it is a
     * `WIDTH`/`THICKNESS` 0.34 slab (`fire-thrust.ts`), closer in scale to `ice-shell`'s 1.3-unit
     * shell than to a 12-unit cone. **The wide pose was actually shot and checked, not assumed
     * bad:** at `gust`'s frame it measured as a pale sliver a few pixels across, near the bottom
     * edge of the frame — indistinguishable from nothing, which defeats the one job this scene has
     * (fire's own doc comment: the plume is the *only* feedback a thrust gives when nobody is
     * looking at the HUD, so a bench shot that cannot show it is a bench shot that cannot catch a
     * silent shader failure here).
     *
     * **Which way the plume actually points, worked out rather than assumed.** `./effects.ts`
     * calls `createFireThrust(origin, fireThrustImpulse(forward, DEFAULT_COMBAT_CONFIG.fire))`
     * with the bench's own fixed `forward` of `(0, 0, -1)` (`bench/main.ts`). `fireThrustImpulse`
     * (`combat/fire.ts`) returns `(0, thrustUpSpeed, 0)` plus the flattened `forward` scaled by
     * `thrustForwardSpeed` — `thrustUpSpeed` 9 and `thrustForwardSpeed` 6
     * (`DEFAULT_COMBAT_CONFIG.fire`) — so the impulse here is `(0, 9, -6)`, length
     * `sqrt(81 + 36) ≈ 10.82` (the "10.8 m/s" `fire-thrust.ts`'s own comment already cites).
     * `createFireThrust` draws the plume along the *negation* of that impulse (its own comment:
     * "drawn opposite the push"), so the exhaust direction is `(0, -9, 6)` — normalised, mostly
     * down and a lesser amount toward `+Z`. A pose built on the impulse itself rather than its
     * negation would point the camera at empty air on the wrong side of the origin, the same
     * failure this comment's own heading warns against.
     *
     * **How long the plume actually is, including the stretch.** `plumeLength` is
     * `impulse.length() * PLUME_SECONDS` = `10.82 * 0.12 ≈ 1.30` at birth, and `apply()` lerps a
     * stretch factor from `1` up to `1.6` over the life — so the plume can be as long as
     * `1.30 * 1.6 ≈ 2.08` by the time it fades out. At this scene's own frozen age (0.07s, half of
     * the 0.14s `LIFETIME` — see below), the stretch is `1.3`, so the drawn length is
     * `1.30 * 1.3 ≈ 1.69`. The pose is built for the larger, once-over-the-life figure (~2.1) so a
     * later retune of `fireAt`/`duration` toward the end of the life does not immediately outgrow
     * the frame.
     *
     * **The pose itself: closer, and off to the side rather than down the barrel.** The plume's
     * travel has no `X` component at all (the bench's fixed `forward` is pure `-Z`), so a camera
     * offset mostly along `X` views its `Y`/`Z` descent broadside instead of foreshortening it
     * toward a point — the same fix `dash-trail`'s own comment makes for a streak that travels
     * along `-Z`, applied to a different plane here because the plume's own travel is diagonal in
     * `Y`/`Z` rather than flat along `Z`. Position `(4.5, 13.8, 0)` against target `(0, 11.9, 0)`
     * is a `~4.9`-unit throw (`sqrt(4.5² + 1.9²)`) at a `~21°` look-down — close to `ice-shell`'s
     * own shallow `~23°`, and close enough at this range that a ~2-unit plume reads as a shape
     * rather than a smudge, the same test `ice-shell`'s own comment applies to its shell.
     *
     * **The target is `gust`'s own point, kept rather than moved.** Every ground scene's target
     * is `(0, 11.9, 0)`, the archipelago's true measured surface height at its centre (see
     * `gust`'s own comment for how 11.9 was taken and why it is not the HUD's 14).
     * `createFireThrust` adds its own `HEIGHT` of 0.95 above whatever origin it is given, the same
     * number `ice-shell.ts`'s `CENTRE_Y` uses, so keeping the target at the bare ground height —
     * rather than pre-adding that 0.95 into the target itself, which is the mistake `ice-shell`'s
     * own scene made and its own comment now records at length — lands the plume's nozzle at
     * exactly 11.9 + 0.95 = 12.85 without double-counting the factory's own offset. The plume's own
     * vertical span (the
     * nozzle at 12.85 descending toward roughly 11.4 at its far tip) sits close enough to that
     * target height that the shallow camera above still keeps the whole thing in frame; only
     * `camera` changes here, so `fireAt` and `duration` still land the frozen frame at age 0.07s,
     * the same mid-life point the scene always froze at.
     */
    id: 'fire-thrust',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(4.5, 13.8, 0), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'fire-thrust',
    fireAt: 0.05,
    duration: 0.12,
  },
  {
    /**
     * The staff's opener, sharing one pose with `staff-finisher` below for the reason `water`'s
     * own comment makes at length against `gust`: with an identical frame the only thing that
     * can differ between the two shots is the swing itself, so the wider wedge is the thing
     * worth seeing rather than a differently-framed picture of it.
     *
     * **Not the shared `gust` pose, but the same angle — and the angle, not just the frustum
     * margin, is what this scene was originally shot and found wrong on.** A first pass at this
     * pose sat 1.9 up and 11 back from the target: inside the frustum on paper, but at
     * `atan(1.9 / 11) ≈ 9.8` degrees of look-down a flat horizontal sector reads almost edge-on
     * — a sliver, not a wedge, the exact failure `gust`'s own scene comment names in its first
     * sentence: shot from above and behind "so the ... wedge reads as a wedge instead of edge-on".
     * Fitting inside `BASE_FOV`'s half-height answers whether the shape is in frame; it says
     * nothing about whether a *flat* shape is foreshortened to nothing once it is. Both shots
     * came back empty on the first take, which is what caught this.
     *
     * **The fix holds `gust`'s own look-down angle and scales its distance to the subject.**
     * `gust` sits 10 up and 20 back from its target — `atan(10 / 20) = 26.565` degrees — and that
     * angle is what makes a *flat ground wedge* read as a wedge rather than a line; nothing about
     * it depends on `gust`'s own 12-unit range. The staff's own reach (opener 3.6, finisher 4.2,
     * `DEFAULT_COMBAT_CONFIG.staffArc`) is a fraction of that, so this pose keeps the ratio —
     * `up : back = 1 : 2`, the same `26.565`-degree look-down — and scales the distance down to
     * the subject instead: **5 up, 10 back.**
     *
     * **The distance, worked out for the finisher's own reach rather than assumed.** Because the
     * fill is an apex-centred disc (`sectorGeometry(shape.halfAngle, 0, 1)`), every point it
     * draws sits within exactly `shape.range` of the apex regardless of `halfAngle` — a bounding
     * sphere, the same simplification `impact-hit`'s own comment uses for a burst's `radius`.
     * `createStaffArc` adds its own `HEIGHT` of 1 above whatever origin it is given
     * (`staff-arc-fx.ts`), so against this scene's target of `(0, 11.9, 0)` — the bare measured
     * ground height `gust`'s own comment takes and explains — the finisher's centre sits at
     * `(0, 12.9, 0)`, radius 4.2.
     *
     * At `(0, 16.9, 10)` — `11.9 + 5` up, `10` back, the `26.565`-degree angle above — distance to
     * that centre is `sqrt(10² + 4²) ≈ 10.77`; the camera's axis toward the scene's own target
     * sits `≈4.76` degrees off the vector to the centre; the finisher's own half-angular radius
     * from the camera is `asin(4.2 / 10.77) ≈ 22.95` degrees — for a far edge at
     * `4.76 + 22.95 ≈ 27.72` degrees off-axis, inside `BASE_FOV` 70's 35-degree half-height
     * (`mapping.ts`) with about 7.3 degrees to spare, at the correct look-down angle this time.
     * The opener's shorter 3.6 reach frames with more room still (half-angular radius `≈19.53`
     * degrees, total `≈24.29`, `≈10.7` degrees to spare) — never less, which is the whole point
     * of sizing the shared pose to the wider of the two swings.
     *
     * **Timing, landed through the real clock rather than assumed from `duration - fireAt`, and
     * moved earlier in the swing's life for a second reason this scene was reshot.** A swing is
     * an instant, and its readable moment is at the start, not the middle: the first pass froze
     * at 52 per cent through `LIFETIME`, where `FILL_OPACITY * (1 - t)` had already faded from
     * 0.55 to roughly 0.29 — half-gone on top of a near-edge-on angle left nothing to
     * photograph either way. `src/bench/effects.test.ts` runs every scene through `runFixedClock`
     * (`./clock.ts`) for the reason its own comment gives: the fixed step never divides a scene's
     * own numbers evenly, so the naive subtraction is not the age the bench actually freezes on.
     * `fireAt: 0.02, duration: 0.05` lands a real age of `0.033333` s against `staff-arc-fx.ts`'s
     * 0.16 s `LIFETIME` — 20.8 per cent through the swing's life, where `FILL_OPACITY * (1 - t)`
     * is `0.55 * (1 - 0.2083) ≈ 0.435` — still close to its peak brightness, with 0.126667 s
     * (79 per cent) of margin before it would read as already faded. `staff-finisher` below
     * lands at the same real age, sharing this scene's `fireAt`/`duration` along with its pose,
     * since `LIFETIME` does not depend on which shape was handed to it.
     */
    id: 'staff-opener',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 16.9, 10), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'staff-opener',
    fireAt: 0.02,
    duration: 0.05,
  },
  {
    /**
     * The staff's finisher, from the identical pose and timing `staff-opener` above uses — see
     * its own comment for why the pose holds `gust`'s 26.565-degree look-down angle rather than
     * its distance, for why that angle (not just the frustum margin) is what the first take of
     * this scene got wrong, and for the real frozen age both scenes land on. Copied field for
     * field rather than tuned, the same discipline `water`'s own comment argues for against
     * `gust`: a hand-edit to either pose would silently break the comparison the shared frame
     * exists to make.
     */
    id: 'staff-finisher',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 16.9, 10), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'staff-finisher',
    fireAt: 0.02,
    duration: 0.05,
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
     *
     * **Its own pose, closer and off to the side, because this is not a cone.** The scenes above
     * sit 10 up and 20 back — a pose framed for the gust's 12-unit wedge, which at ~22 units of
     * throw fills a third of the frame. This streak is 3.2 units long, 0.45 wide and 0.12 thick
     * (`WIDTH`, `THICKNESS` and the chain-1 length in `dash-trail.ts`), so at that distance it is
     * a few pixels of haze: a shot that cannot support a judgement about how the effect reads,
     * which is the only thing the bench is for. From 3.5 up and 5.6 to the side the streak
     * crosses about a third of the frame instead, and it is nearly broadside — the effect is
     * fired along -Z from `camera.target` (`bench/main.ts`), so a camera on +X sees its length
     * rather than looking down the barrel of it.
     *
     * Looking down at 32 degrees rather than level, because at 0.12 thick this slab seen edge-on
     * is a hairline; the 0.45-by-3.2 top face is the silhouette worth photographing. That is the
     * opposite trade from `slipstream` below, whose slab is tall and wants a low camera, which is
     * why these two scenes do not share a pose either.
     *
     * The target stays the measured ground height at the island centre, 11.9, for the reason the
     * `gust` scene's comment gives at length. `groundHeightAt(5.5, 1)` measures 11.05 with the
     * same scratch-probe technique, so the camera at 15.4 clears the terrain by 4.3 units.
     */
    id: 'dash-trail',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(5.5, 15.4, 1), target: new Vector3(0, 11.9, 0) },
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
     *
     * **Low and to the side, which is neither the cone's pose nor `dash-trail`'s.** This slab is
     * 6 units long (`speed` 30 by `durationSeconds` 0.2, from `DEFAULT_SLIPSTREAM_CONFIG`), 0.5
     * wide and 1.5 tall, and unlike the dash streak it straddles the origin rather than running
     * forward from it. Tall is the operative difference: a camera looking steeply down at a
     * 1.5-unit wall photographs its 0.5-unit top and hides the streak-and-lead gradient that runs
     * up it, so this one sits only 2 units above the target and 8 out, a 14-degree look-down that
     * keeps the flank in frame. The 6-unit length crosses about half the frame at that range,
     * against a tenth from the cone's 10-up-20-back pose.
     *
     * Placed on the -Z side, the direction the dodge travels, so the bright leading edge
     * `TRAIL_BODY`'s `lead` term brightens is the near end rather than the far one — the whole
     * point of that term is which way the dodge went, and a shot from behind reports it as the
     * dimmer end.
     *
     * Target height 11.9 as above. `groundHeightAt(7, -4)` measures 11.15, so the camera at 13.9
     * clears the terrain by 2.7 units — the thinnest margin of any bench scene, and deliberate:
     * a low camera is the price of seeing a low effect's flank.
     */
    id: 'slipstream',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(7, 13.9, -4), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'slipstream',
    fireAt: 0.05,
    duration: 0.18,
  },
  {
    /**
     * Steam has its own effect now — `createSteam`'s rising column, wired in `./effects.ts` — so
     * it no longer shares `ringAt`'s placeholder the way it once did. (Mud and the chain
     * finisher below no longer share it either — see each one's own comment.) This shot is
     * otherwise unchanged: same camera, same `fireAt` and `duration`, so a diff between this
     * scene's frames before and after Task 7 is a diff of the effect alone.
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
    /**
     * Mud has its own effect now — `createMud`'s flat spatter, wired in `./effects.ts` — so like
     * Steam just above it no longer shares `ringAt`'s placeholder. This shot is otherwise
     * unchanged: same camera, same `fireAt` and `duration`, so a diff between this scene's frames
     * before and after Task 8 is a diff of the effect alone.
     */
    id: 'mud',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'mud',
    fireAt: 0.1,
    duration: 0.3,
  },
  {
    /**
     * The chain finisher's own flourish — `createFinisherFlare`'s vertical flare at the player's
     * feet, wired in `./effects.ts`. It no longer shares `ringAt`'s placeholder the way it did
     * before this task, the same retirement Steam and Mud already had; see either one's own
     * comment above. The pose and timing below are new rather than carried over: the placeholder
     * shot reused the wide `gust` pose (`(0, 21.9, 20)` looking at `(0, 11.9, 0)`, a 22-unit
     * shot framed for a 12-unit wedge), and this effect is nothing like that wedge's size or
     * orientation.
     *
     * **Trap 1: the effect's origin is the camera's own target, not a separate fact.**
     * `bench/main.ts` hands `scene.camera.target.clone()` to the effect as the point it is
     * spawned at, so an effect that lifts itself above that point sits above the aim point rather
     * than off to one side of it. The flare grows straight up from wherever it is spawned, so the
     * target has to stay bare ground — `(0, 11.9, 0)`, the same measured island-centre height
     * (`groundHeightAt(0, 0)` ≈ 11.87) every other scene here already targets — and the whole
     * flare then rises into frame above that point rather than the camera having to guess where
     * "above" will land.
     *
     * **Trap 2: a pose framed for a 12-metre wedge photographs a small object as nothing.** The
     * flare's own footprint is under two units across (`TOP_RADIUS` 0.9) and a little over two
     * units tall (`HEIGHT` 2.3, `finisher.ts`) — nowhere near the 12-unit reach a gust or water
     * cone needs to state honestly. Kept on the inherited wide pose, it would read as a speck.
     * The new pose sits at `(0, 13.9, 5)`, close enough that the flare's own width fills a real
     * fraction of the frame rather than the fraction a 12-unit wedge needs to.
     *
     * **Trap 3 — the one that does not apply here, said explicitly so it does not read as
     * missed.** A flat horizontal shape seen from a shallow angle foreshortens to a sliver; that
     * is what photographed the staff scenes completely empty before their own fix. This flare is
     * the opposite orientation: it stands vertically, so a shallow, near-level look is what shows
     * its height rather than hiding it — the same fact `slipstream`'s own comment gives for why a
     * *tall* shape wants a low camera, not the steep look-down a flat ground decal can afford.
     * `(0, 13.9, 5)` looking at `(0, 11.9, 0)` is a 2-unit rise over a 5-unit run, about 22
     * degrees below horizontal — shallow enough that the flare's full 2.3-unit climb stays inside
     * the frame instead of collapsing toward a dot the way a steep overhead look would.
     *
     * `groundHeightAt(0, 5)` measures 11.55 with the same probe technique `gust`'s own comment
     * uses, so the camera at 13.9 clears the terrain by 2.35 units — close to `slipstream`'s own
     * thinnest margin, and for the same reason: a close, low camera is the price of framing a
     * small effect at all.
     *
     * **Timing.** `fireAt: 0.1` matches every other reaction-scale shot in this file. `duration:
     * 0.2` — matching `gust`'s own duration, which is not a coincidence: `finisher.ts`'s own
     * `LIFETIME` is `0.22`, chosen to equal `gust-cone.ts`'s `LIFETIME` exactly, so the two share
     * a duration for the same reason they share a lifetime. Run through the real clock
     * (`runFixedClock`, the same arithmetic `effects.test.ts`'s own frozen-frame guard uses
     * rather than a second formula that could drift from it), this freezes the flare at age
     * ≈0.1167s — 53% of the way through `LIFETIME`, past halfway grown and still comfortably
     * above half its peak opacity — with a margin of ≈0.1033s (about six frames at 60Hz) before
     * `advance` would report it finished. Comfortably inside the window, and framed at the point
     * the flare is actually worth photographing rather than at its first spark or its last fade.
     */
    id: 'finisher',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 13.9, 5), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'finisher',
    fireAt: 0.1,
    duration: 0.2,
  },
  {
    /**
     * The impact burst's three kinds, sharing one pose so the only thing that can differ
     * between the three shots is the burst itself — the argument `water`'s own comment makes
     * at length against `gust`'s pose, applied here to three shots of one effect instead of
     * two effects sharing a ground scale.
     *
     * **Why not the shared cone pose.** `gust` and `water` are framed for a 12-unit wedge at
     * roughly 22 units of throw; the impact bursts run 0.7 to 2.3 units across (`SHAPES` in
     * `impact.ts`), which at that distance would be a few pixels of haze — the same "cannot
     * support a judgement about how the effect reads" failure `dash-trail`'s own comment
     * diagnoses for a subject smaller still. So this trio gets its own closer pose instead,
     * the same move `ice-shell` and `fire-thrust` made above for their own body-scale
     * subjects.
     *
     * **The trap this pose exists to dodge, named so it is not repeated a third time.**
     * `bench/main.ts` hands a scene's own `camera.target` to the effect as its *origin*
     * (`benchEffect(effectId, scene.camera.target.clone(), …)`), and `createImpact` then adds
     * its own `HEIGHT` of 0.9 on top of it — the exact shape of the trap `ice-shell`'s own
     * scene fell into in B2, recorded at length in that scene's comment above. The fix here is
     * the same one used there: keep the target at the bare measured ground height, 11.9 (see
     * `gust`'s comment for how that number was taken), and absorb the 0.9-unit lift with the
     * *camera's* placement rather than the target's.
     *
     * **The pose: `(0, 13.8, 9)` looking at `(0, 11.9, 0)`.** 13.8 is the same camera height
     * `ice-shell` and `fire-thrust` already use, and it already clears the terrain near the
     * island's centre for both of them; 9 units back is close enough to frame `down`, the
     * largest of the three (`radius: 2.3`), without cropping it. Worked out rather than
     * assumed: the burst's centre sits at 11.9 + 0.9 = 12.8, a distance of 9.055 from the
     * camera; the view axis toward the `(0, 11.9, 0)` target sits 5.58 degrees off the vector
     * to that centre, and `down`'s own half-angular radius from the camera is
     * `asin(2.3 / 9.055) ≈ 14.71` degrees — for a far edge at `5.58 + 14.71 ≈ 20.29` degrees
     * off-axis, comfortably inside `BASE_FOV` 70's 35-degree half-height (`mapping.ts`), with
     * about 14.7 degrees to spare. `hit` (radius 1.1) and `deflect` (radius 0.7) are smaller
     * subjects at the same distance, so the same pose frames both with more room still
     * (half-angular radii 6.98 and 4.43 degrees respectively), never less.
     *
     * **Timing, landed through the real clock rather than assumed from `duration - fireAt`.**
     * `src/bench/effects.test.ts` runs every scene through `runFixedClock` (`./clock.ts`) to
     * derive the frame the bench would actually freeze on, because the fixed step never
     * divides a scene's own numbers evenly and the loop always runs at least one whole step
     * past the boundary it is checking. `fireAt: 0.05, duration: 0.13` lands `hit` at a real
     * age of six steps past firing — `(1/60) * 6 ≈ 0.1s` against its 0.18s `LIFETIME`, 56%
     * through its life with 0.08s (44%) of margin before it would read as dead. `impact-down`
     * below lands at its own comparable fraction. `impact-deflect`, in a second gate round,
     * moved to a deliberately different point in its own life for a reason that does not apply
     * to either scene above — see its own comment — which leaves `impact-hit`'s 0.08s the
     * tightest margin of the three as shipped now, not `impact-deflect`'s.
     */
    id: 'impact-hit',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 13.8, 9), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'impact-hit',
    fireAt: 0.05,
    duration: 0.13,
  },
  {
    /**
     * The down burst, the same shared pose as `impact-hit` just above — see that scene's own
     * comment for why one pose serves all three impact kinds and how it was sized against
     * `down`, the largest of them.
     *
     * `fireAt: 0.1, duration: 0.32` lands at a real age of fourteen steps past firing,
     * `(1/60) * 14 ≈ 0.2333s` against `down`'s own 0.45s `LIFETIME` — 52% through its life,
     * with 0.2167s (48%) of margin to spare, the most generous of the three.
     */
    id: 'impact-down',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 13.8, 9), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'impact-down',
    fireAt: 0.1,
    duration: 0.32,
  },
  {
    /**
     * The deflect burst, the same shared pose as `impact-hit` above, for the same reason — see
     * that scene's comment for the pose. **Its timing does not follow the same rule as its two
     * siblings, and deliberately so.** `impact-hit` and `impact-down` are both photographed
     * mid-life (56% and 52% through, respectively) because each of those kinds makes its claim
     * over a stretch of time worth catching in the middle of. `deflect`'s whole claim is the
     * opposite: it exists to read as instantaneous — "that bounced" rather than "that hit a
     * bit," per this file's own top-of-module doc comment — so a mid-life frame photographs it
     * after its one readable moment has already passed. Its `alpha` peaks at spawn and fades
     * linearly across its 0.12s `LIFETIME` (`shape.opacity * (1 - t)` in `createImpact`'s own
     * `apply()`), so the earlier the frozen frame lands, the closer it sits to that peak.
     *
     * `fireAt: 0.01, duration: 0.03` lands at a real age of two steps past firing —
     * `(1/60) * 2 ≈ 0.0333s` against `deflect`'s own 0.12s `LIFETIME`, unchanged — 28% through
     * its life rather than the first gate round's 56%. At that age the alpha fade has only
     * taken it to `1 - 0.28 ≈ 72%` of peak (`0.7 * 0.7222 ≈ 0.51`, against `0.7 * 0.44 ≈ 0.31`
     * at the old timing), and the scale-up (`START_FRACTION` 0.25 lerping to 1 over the life)
     * sits at `0.25 + 0.75 * 0.28 ≈ 46%` of full radius rather than the old 65% — smaller, which
     * is the accepted trade for catching it near its peak rather than mid-fade. This still
     * clears `src/bench/effects.test.ts`'s liveness check with 0.0867s (72%) of margin before
     * `deflect` would read as dead, more margin than the old timing had, not less; `deflect`'s
     * own `radius` (0.7 against `down`'s 2.3) is why it reads smaller than its siblings at this
     * shared pose regardless of timing, by design, per `impact-hit`'s own comment on how the
     * pose was sized — not a framing bug introduced by moving this scene's clock.
     */
    id: 'impact-deflect',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 13.8, 9), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'impact-deflect',
    fireAt: 0.01,
    duration: 0.03,
  },
  {
    /**
     * The Slipstream's guard shell. There is no player here to wrap it around — `bench/main.ts`'s
     * own comment records that the player, the enemies and the input tracker do not exist in this
     * module — so this shot shows the shell's own shape against the world, and whether it reads
     * *around a character* is a thing only play can answer.
     *
     * **The same pose as `ice-shell`, reused rather than re-derived, and safely so.**
     * `createGuardShell`'s `CENTRE_Y` is 0.95, identical to `createIceShell`'s, so against the
     * same target `(0, 11.9, 0)` the two shells' centres land on the exact same point,
     * `(0, 12.85, 0)` — see `ice-shell`'s own comment for how that point and this pose were
     * checked against `bench/main.ts`'s target-is-origin trap. The only thing that changes is
     * `RADIUS`: 1.15 here against ice-shell's 1.3, strictly smaller, so a pose already proven to
     * keep a 1.3-unit shell in frame keeps a 1.15-unit one in frame with more room, not less.
     * Recomputed rather than assumed: camera `(0, 13.8, 4.5)`, view axis to target `(0, -1.9,
     * -4.5)`; the shell's top edge `(0, 14.00, 0)` sits about 25.5 degrees off that axis and its
     * bottom edge `(0, 11.70, 0)` about 2.5 degrees off, both comfortably inside `BASE_FOV` 70's
     * 35-degree half-height (`mapping.ts`), with roughly 9.5 degrees of margin on the tighter
     * (top) edge.
     *
     * **Timing.** `./effects.ts`'s `benchGuardShell` holds the shell active for its own
     * `HOLD_SECONDS` (0.5s) before releasing it, well past `createGuardShell`'s own
     * `FADE_IN_SECONDS` (0.02s) — the whole window this move's tell has to work with is 0.11s
     * long, so the fade-in itself is nearly instant, and holding for ten times that is what
     * "well past" means for a shell this fast. `fireAt: 0.1, duration: 0.3` freezes the frame at
     * a real age of about 0.2s into the hold: long past the 0.02s rise and comfortably short of
     * the 0.5s release, so the shell is at full, steady opacity rather than mid-fade in either
     * direction.
     */
    id: 'guard-shell',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 13.8, 4.5), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'guard-shell',
    fireAt: 0.1,
    duration: 0.3,
  },
  {
    /**
     * The Avatar State's aura. Same absent-player caveat as `guard-shell` just above: there is no
     * character here for it to surround, so this shot can only show its own shape against the
     * world, not whether that shape reads as air around a body — that is play's question, not the
     * bench's.
     *
     * **Its own pose, checked rather than borrowed verbatim, because the two shells do not land
     * on quite the same point.** `createAvatarAura`'s `HEIGHT` is 1 and its `RADIUS` is 1.35 —
     * both a touch larger than the guard shell's `CENTRE_Y` 0.95 and `RADIUS` 1.15 — so against
     * the shared target `(0, 11.9, 0)` this shell's centre sits at `(0, 12.9, 0)`, 0.05 units
     * above `ice-shell`'s and the guard shell's `(0, 12.85, 0)`, and its radius reaches 0.05
     * units further than `ice-shell`'s 1.3. Close enough that the guard shell's pose was worth
     * checking against this shell specifically rather than assumed to still clear it: at
     * `(0, 13.8, 4.5)` the top edge came out to within about 6 degrees of `BASE_FOV` 70's
     * 35-degree half-height, not a bad frame but a tighter margin than either sibling scene
     * carries. Pulled back to `(0, 13.8, 5.5)` instead — one unit further along the same shallow
     * approach — for a share of margin closer to `ice-shell`'s own.
     *
     * Recomputed for this pose: view axis to target `(0, -1.9, -5.5)`; the shell's top edge
     * `(0, 14.25, 0)` sits about 23.8 degrees off that axis and its bottom edge `(0, 11.55, 0)`
     * about 3.2 degrees off, both inside the 35-degree half-height with roughly 11.2 degrees of
     * margin on the tighter (top) edge — more room than the guard shell's own 9.5, not less,
     * despite the larger shell, because the extra unit of throw shrinks its angular size faster
     * than the extra size grows it.
     *
     * **Timing.** `./effects.ts`'s `benchAvatarAura` holds the shell active for its own
     * `HOLD_SECONDS` (1s), longer than the guard shell's 0.5s because `createAvatarAura`'s own
     * `FADE_IN_SECONDS` is 0.15s rather than 0.02s and the hold has to clear it by a comparable
     * margin. `fireAt: 0.2, duration: 0.6` freezes the frame at a real age of about 0.4s into the
     * hold: well past the 0.15s rise and well short of the 1s release, so the aura is at full,
     * steady opacity.
     */
    id: 'avatar-aura',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 13.8, 5.5), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'avatar-aura',
    fireAt: 0.2,
    duration: 0.6,
  },
  {
    /**
     * The aim tell. Held `targeted` and `ready` for the whole shot so both children draw —
     * `./effects.ts`'s wrapper does that, the same technique `benchAirWall` uses for a held
     * state that has no natural end. The previewed cone is `DEFAULT_COMBAT_CONFIG.gust`, the
     * shape the game actually feeds this tell for the F move, not an invented one.
     *
     * **`gust`'s own pose, taken rather than reframed, because the subject is not smaller here
     * — it is the same size.** The preview sector is drawn at the gust's own range, 12, the
     * identical wedge `gust`'s scene already frames — this is not one of the recent small-
     * object scenes (`guard-shell`, `avatar-aura`, `ice-shell`) that needed their own closer
     * pose because a 12-unit frame photographed a 1-unit shape as nothing. At `gust`'s own
     * 10-up-20-back position against the same `(0, 11.9, 0)` target, the look-down angle is
     * `atan(10 / 20) = 26.565` degrees — trap 3, the one the staff scenes hit at 9.8 degrees,
     * is squarely this scene's risk too: both meshes here are flat and sit within `HEIGHT`
     * (0.08) of the ground, closer to edge-on than anything else on the bench. Foreshortening
     * from a shallow look-down is a property of the camera angle against a horizontal plane,
     * not of how high above the ground that plane sits, so `gust`'s already-validated 26.565
     * degrees applies to this tell's near-ground preview exactly as it does to the gust cone's
     * own `HEIGHT`-1 fill — reframing closer would only shrink the frame around a wedge that
     * already fits it.
     *
     * The chevron marker sits at `markerDistance` 3, well inside the 12-unit preview, so both
     * children land in the same frame this pose already proves out for the gust.
     */
    id: 'aim-tell',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 21.9, 20), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: 'aim-tell',
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
  {
    /**
     * The mark pip, side by side across all four elements plus an unmarked control — the shot
     * that answers whether `MARK_COLOUR` in `enemy-mesh.ts` actually reads as four distinct
     * colours rather than as "a soldier has something lit up", and whether a soldier with no
     * mark at all is visibly bare next to one that has one. Nothing before this scene has ever
     * built a soldier here to check either question; see `soldiers`'s own doc comment on
     * `BenchScene` for why.
     *
     * `effect: null`, like `light` above and for the identical reason: a transient effect in
     * the same frame as five static pips would leave a reader unsure which glow they were
     * meant to be judging.
     *
     * **One kind, `spear`, for all five — the same "hold everything but the one variable
     * still" discipline `water`'s own comment argues for the shared cone pose above, applied to
     * bodies instead of cameras.** A row of five identical silhouettes means the pip is the
     * only thing that can differ between any two soldiers in the shot; mixing in `archer`'s
     * torus bow or `heavy`'s wider rig would make each soldier's read partly about the prop
     * silhouette instead of about the mark. `enemy-mesh.ts`'s own comment already establishes
     * that three of the four kinds share `BODY`'s tint for exactly this reason — the silhouette
     * is what tells kinds apart, and spending it here buys nothing this scene needs.
     *
     * **Five soldiers 1.3m apart along X, at `dz: 0` — a row facing the camera rather than in
     * file, so all five pips are broadside rather than three-quarters foreshortened.** Their
     * ground heights are not equal — the archipelago's centre slopes down to the east — which is
     * `main.ts`'s own reason for reading each one off `groundHeightAt` rather than off the
     * target's `y`: `groundHeightAt(x, 0)` measured 12.224, 12.047, 11.869, 11.691 and 11.514 at
     * `x = -2.6, -1.3, 0, 1.3, 2.6` respectively (a scratch probe against `buildWorld(ARCHIPELAGO)`,
     * the same technique `gust`'s own comment uses for its target height), so the row is a
     * shallow staircase in world space even though every soldier in it stands flat on its own
     * ground.
     *
     * Order, left to right: air, water, earth, fire — `element-radial.ts`'s own canonical order
     * — then the unmarked control last, so a reader scanning the row meets the four colours in
     * the order the game's own HUD already taught them before meeting the soldier that has
     * none of them.
     *
     * **The fight distance: 8 metres back from the row, argued rather than assumed.** A
     * soldier's own `strikeRange` (`DEFAULT_COMBAT_CONFIG.spear`) is about 3.2 and the gust
     * reaches 12 — point-blank melee at one end, the widest area effect in the game at the
     * other, neither of which is where a player actually reads a mark on an enemy they are
     * still fighting. 8 sits two-thirds of the way from the near bound to the far one: close
     * enough that five soldiers spanning 5.2m of width still fill a real fraction of the frame
     * (`impact-hit`'s own 9-unit throw makes the same trade for a much smaller subject), far
     * enough that it reads as "mid-fight, not nose-to-nose" rather than the melee range a
     * player would actually be retreating from.
     *
     * **The pose: `(0, 13.9, 8)` looking at `(0, 11.9, 0)`, a `atan(2.0 / 8) ≈ 14.04`-degree
     * look-down.** Shallower than the cone scenes' 26.565 degrees on purpose: the subject here
     * is five vertical bodies, not a flat ground wedge, so trap 3 (a flat shape foreshortening
     * to a sliver at a shallow angle) does not apply — nothing in this shot lies flat except the
     * ground itself. A steeper look-down would instead crowd the row's far ends toward the
     * frame's edges faster than a shallow one does, which is the opposite of what a row this
     * wide wants.
     *
     * **Checked against the pip, not the feet, per this task's own framing trap.** The pip
     * sits `MARK_PIP_HEIGHT_ABOVE_FEET` (2.3) plus its own apex (`size` 0.16) above each
     * soldier's feet — 2.46m up — so the point that has to clear the frustum is that apex on
     * the two end soldiers, the tallest and farthest-off-axis targets in the row, not the
     * ground point under them. At `x = -2.6` (ground 12.224, apex 14.684): view axis
     * `(0, -2.0, -8)`, vector to the apex `(-2.6, 0.784, -8)`, angle between them ≈26.4 degrees
     * — inside `BASE_FOV` 70's 35-degree half-height (`mapping.ts`) with about 8.6 degrees of
     * spare, the tightest margin in the row. At `x = 2.6` (ground 11.514, apex 13.974) the
     * angle is ≈23.0 degrees, comfortably wider, because that end's lower ground pulls its pip
     * closer to the view axis rather than further from it. Both soldiers' feet clear with far
     * more room still (≈17.7 and ≈17.4 degrees respectively) — the pip, not the feet, is what
     * this pose was sized against.
     *
     * `groundHeightAt(0, 8)` (the camera's own footprint) measured 11.367 in the same probe, so
     * the camera at 13.9 clears the terrain by about 2.5 units — in the same range as `finisher`'s
     * 2.35 and `dash-trail`'s 4.3, not the thinnest margin on the bench.
     *
     * All five marks are fresh (`markSeconds` omitted, so `main.ts` fills in the reaction
     * system's own full `markSeconds`) — `marks-occluded` below is the shot that answers what a
     * mark looks like as it runs out.
     */
    id: 'marks',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 13.9, 8), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: null,
    fireAt: 0,
    duration: 1,
    soldiers: [
      { kind: 'spear', dx: -2.6, dz: 0, mark: 'air' },
      { kind: 'spear', dx: -1.3, dz: 0, mark: 'water' },
      { kind: 'spear', dx: 0, dz: 0, mark: 'earth' },
      { kind: 'spear', dx: 1.3, dz: 0, mark: 'fire' },
      { kind: 'spear', dx: 2.6, dz: 0, mark: null },
    ],
  },
  {
    /**
     * Two soldiers, one standing behind the other, to answer the two questions `marks` above
     * cannot: does the pip still read when another body sits between it and the camera, since
     * `enemy-mesh.ts`'s own `pipMaterial` is `depthTest`-on (the default) rather than always
     * drawn on top; and does a mark with almost no time left fade toward
     * `MARK_PIP_FADE_FLOOR` rather than doing something a player could mistake for a colour
     * change.
     *
     * **Both soldiers `spear`, for `marks`'s own reason: the pip and its fade are the only
     * things this shot needs to differ, not the silhouette carrying them.**
     *
     * **Why this pose is a much closer, steeper throw than `marks`'s representative fight
     * distance, and deliberately not another "representative" pose.** The pip sits
     * `MARK_PIP_HEIGHT_ABOVE_FEET` (2.3) above the feet, above everything a standing soldier's
     * own silhouette reaches (the tallest prop, the net-thrower's wound-back torus, peaks under
     * 2.0) — so for the *front* soldier's own body to occlude the *rear* soldier's pip at all,
     * the front has to be close enough to camera that its own silhouette subtends a wider angle
     * than the rear's full reach up to its own pip does from the same camera. That is a
     * geometric constraint this scene has to satisfy to demonstrate anything, not a framing
     * preference — a `marks`-style 8-unit throw makes every soldier's own silhouette so small
     * on screen that nothing could occlude anything else's pip at all, gust-cone-pose or not.
     *
     * **Front soldier at the scene's own target, `(dx: 0, dz: 0)` — world `(0, 11.869, 0)`,
     * `fire`, freshly marked.** Rear soldier at `(dx: 0.6, dz: -4.5)` — world
     * `(0.6, 11.889, -4.5)`, 4.5m further from the camera and 0.6m to the side, `water`, at
     * `markSeconds: 0.15` against the reaction system's own 2.5-second full length — a sliver of
     * its life left, not merely "less than fresh". Both world heights are from the same
     * scratch-probe technique `marks`'s own comment uses; the two points sit within 2cm of each
     * other (11.869 against 11.889), so this pair stands on what is, for this purpose, flat
     * ground.
     *
     * **The separation and the small `dx`, checked against the live renderer rather than left
     * to the angle arithmetic alone.** The maths below establishes that both pips sit inside the
     * frustum at all; it does not by itself say how much of the rear soldier the front one's
     * body actually covers on screen, which is a full-projection question the rest of this
     * file's single-point "angle off the boresight" check was never built to answer (that check
     * asks "is this point in frame", not "does this near shape overlap that far one"). This pose
     * and this `dx`/`dz` pair were tuned directly against `bench.html?scene=marks-occluded` in a
     * live browser: at `dx: 0` the rear soldier vanished completely behind the front one
     * (answering "does depth-test hide it" but nothing about a *partial* view, which is the
     * common case — soldiers on foot are never perfectly stacked in the game itself); pulled out
     * to `dx: 0.6` the front's body still hides most of the rear one, but a sliver of the rear's
     * own shoulder and the top edge of its faded pip clear the front's silhouette, which is the
     * shot that actually answers question 3 rather than merely gesturing at it.
     *
     * At `MARK_PIP_FADE_WINDOW` (1 second) and `MARK_PIP_FADE_FLOOR` (0.35), the rear soldier's
     * `0.15` seconds left clamps its opacity to the floor itself (`0.15 / 1 = 0.15`, clamped up
     * to `0.35`) — dim, not gone, and still unmistakably `water`'s own colour rather than
     * shifted toward black or toward another element's hue, which is exactly the distinction
     * question 4 asks this scene to make; the sliver that clears the front soldier's silhouette
     * is visibly paler than the front soldier's own full-strength `fire` pip in the same shot,
     * not a different hue.
     *
     * **The pose: `(0, 13.1, 4.6)` looking at `(0, 11.9, 0)`, a `atan(1.2 / 4.6) ≈ 14.6`-degree
     * look-down.**
     *
     * **Checked against each soldier's own pip apex, not its feet.** View axis toward the target
     * is `(0, -1.2, -4.6)`. Front pip apex `(0, 14.329, 0)`: vector `(0, 1.229, -4.6)`, angle
     * ≈29.6 degrees off-axis — inside the 35-degree half-height with about 5.4 degrees of spare,
     * the tighter of the two margins in this scene precisely because it sits nearest the camera
     * (the same trade `ice-shell`'s own scene makes closer in for a small subject). Rear pip
     * apex `(0.6, 14.349, -4.5)`: vector `(0.6, 1.249, -9.1)`, angle ≈22.7 degrees, about 12.3
     * degrees of spare — wider despite being further off-centre, because the extra 4.5m of
     * throw shrinks its angular size faster than the offset grows it, the same trade
     * `avatar-aura`'s own comment measures against `ice-shell`. Both soldiers' feet clear with
     * more room still, so as with `marks`, the pip decided this pose, not the feet.
     *
     * `groundHeightAt(0, 4.6)` (the camera's own footprint) measured 11.580, so the camera at
     * 13.1 clears the terrain by about 1.52 units — the thinnest margin on the bench, tighter
     * even than `slipstream`'s 2.7, and for the same reason that comment gives taken one step
     * further: a close, low camera is the price of framing a body-scale subject at all, and this
     * shot needs the front soldier closer still than any single-body scene above it to make the
     * occlusion legible.
     */
    id: 'marks-occluded',
    regionId: ARCHIPELAGO_ID,
    camera: { position: new Vector3(0, 13.1, 4.6), target: new Vector3(0, 11.9, 0) },
    elevation: SUN_ELEVATION_DEGREES,
    effect: null,
    fireAt: 0,
    duration: 1,
    soldiers: [
      { kind: 'spear', dx: 0, dz: 0, mark: 'fire' },
      { kind: 'spear', dx: 0.6, dz: -4.5, mark: 'water', markSeconds: 0.15 },
    ],
  },
]

/** The query-string key that picks a bench scene. */
export const SCENE_PARAM = 'scene'

/**
 * The query-string key that overrides how far into its effect's life a scene's frozen frame
 * lands, in seconds — `bench.html?scene=impact-deflect&at=0.02` photographs that burst 0.02s
 * into its life, whatever `impact-deflect`'s own `duration` says.
 *
 * **Why this parameter exists at all.** Every scene in `BENCH_SCENES` hard-codes one `fireAt`
 * and one `duration`, so the frozen frame lands at exactly one age in an effect's life, chosen
 * once when the scene was written — and that one-frame limit has already cost two real fix
 * rounds. `impact-deflect` was first frozen 44% through its 0.12s life, where its own alpha
 * fade had already taken it to 56% of peak and it read as nearly nothing (see that scene's own
 * comment above for the full retune). Both `staff-opener` and `staff-finisher` were frozen at
 * 52% through their shared 0.16s `LIFETIME`, where `FILL_OPACITY * (1 - t)` had faded to
 * roughly half — also found only by looking, also a separate fix round (see that scene's own
 * comment). Both bugs were "is the readable moment where the scene assumes it is" — an
 * arithmetic claim nothing checked because nothing could ask the bench for a different age
 * without hand-editing the scene table and reasoning through `runFixedClock` by hand each time.
 * `at` turns that into `?at=0.02`, `?at=0.04`, `?at=0.06` — a five-shot filmstrip of one effect,
 * which is what would have caught both bugs on the first pass instead of the second.
 *
 * **Age, not duration.** `duration` is a property of this bench's own clock — how long the run
 * takes from its own start, an implementation detail nobody photographing an effect actually
 * cares about. Age — how far into its own life the effect is — is the thing a reader means by
 * "a third of the way through", so that is what this parameter asks for; see `durationFor`
 * below for the reason `duration` is still the field that gets overridden. `fireAt` is left
 * alone on purpose: moving it would change where in the run the effect starts existing, and
 * every scene's camera pose and world state were chosen around that one instant, not around
 * whatever age is being inspected this time.
 */
export const AT_PARAM = 'at'

// `runFixedClock`'s own `step` argument, mirrored here rather than imported. `bench/main.ts`
// defines its own `STEP_SECONDS` and does not export it — deliberately: the whole point of
// putting this override in `resolveBench` rather than in `main.ts` is that `main.ts` does not
// need to change at all for `at` to exist (see `resolveBench`'s own comment). `effects.test.ts`
// and `clock.test.ts` each keep their own copy of this same constant for the identical reason —
// there is no single exported source of truth for the bench's fixed step, so all of these names
// have to be kept in lockstep by hand. A fourth copy here is the price of that, paid once,
// rather than adding a second way to reach into `main.ts`.
const STEP_SECONDS = 1 / 60

// A generous ceiling on how many fixed steps the two search loops below will walk, entirely
// separate from `clock.ts`'s own `MAX_SANE_STEPS`. That guard bounds `runFixedClock`'s own loop
// at *run* time; this one bounds the search this module does at *resolve* time, before any
// `BenchScene` is handed back, so an absurd `at` (or, in principle, an absurd `fireAt`, though
// every table entry is already validated elsewhere) fails fast here with a thrown error stating
// why, rather than spinning this function for a very long time on a plain `for` loop with
// nothing watching it. Set well above `MAX_SANE_STEPS` (10,000): a request that lands inside
// this bound but outside that one is still a legitimate `at` value that the real clock would
// itself reject when the scene actually runs (see clock.ts's own throw) — this bound exists
// only to stop *this* function from hanging, not to anticipate that one.
const MAX_SEARCH_STEPS = 100_000

/**
 * Where `runFixedClock`'s own `elapsed` sits after `steps` fixed increments of `STEP_SECONDS`,
 * computed by the identical repeated addition `runFixedClock` performs at runtime rather than
 * by `steps * STEP_SECONDS`. The two are not interchangeable: `STEP_SECONDS` (1/60) has no
 * exact binary floating-point representation, so repeated addition drifts from the multiplied
 * value by the last bit or two — usually nothing, except right at a comparison boundary, where
 * that drift is exactly what `clock.ts`'s own comment on `MAX_SANE_STEPS` means by "this
 * codebase's own scene data needs one increment more than the exact division implies". Reusing
 * this same accumulation to build the override below is what keeps this module's arithmetic
 * from silently disagreeing with `runFixedClock`'s.
 */
function elapsedAfterSteps(steps: number): number {
  let elapsed = 0
  for (let i = 0; i < steps; i++) elapsed += STEP_SECONDS
  return elapsed
}

/**
 * The 1-indexed fixed step on which `runFixedClock` would fire a scene with this `fireAt` —
 * found by walking the same `elapsed += STEP_SECONDS; if (elapsed >= fireAt) ...` shape
 * `runFixedClock` itself runs, rather than by dividing `fireAt` by `STEP_SECONDS` and rounding.
 * Division-and-round looks equivalent and is not: verified directly against this file's own
 * `gust` and `water` scenes (both `fireAt: 0.1`) — `Math.ceil(0.1 / STEP_SECONDS)` computes 6,
 * but stepping `elapsed` up in fixed increments of `1/60` the way `runFixedClock` actually does
 * leaves it at `0.09999999999999999` after 6 steps, still short of `0.1`, so the real fire step
 * is 7. `clock.test.ts`'s own gust/water cases already measured the *consequence* of that same
 * drift (7 and 8 post-fire advances, not the 6 and 7 a clean division would suggest); this
 * function is what lets `durationFor` below agree with that measurement instead of a formula
 * that only agrees with it by accident some of the time.
 */
function fireStepIndex(fireAt: number): number {
  let elapsed = 0
  for (let step = 1; step <= MAX_SEARCH_STEPS; step++) {
    elapsed += STEP_SECONDS
    if (elapsed >= fireAt) return step
  }
  throw new Error(
    `resolveBench could not find a fire step for fireAt ${fireAt} within `
    + `${MAX_SEARCH_STEPS} steps. This indicates a broken scene table entry, not a bad "at".`,
  )
}

/**
 * The `duration` that makes `runFixedClock(fireAt, duration, STEP_SECONDS, ...)` freeze a
 * freshly-fired effect at real age `age` (in seconds) — the inverse of the relationship
 * `effects.test.ts` uses to check a scene's own `fireAt`/`duration` pair, run the other way.
 *
 * **Not `fireAt + age`, and this is the mistake this task's own brief warns against by name.**
 * `runFixedClock` fires on the first fixed step where `elapsed >= fireAt` and then calls
 * `advance` on that same step and every step after until `elapsed >= duration` — so the age at
 * freeze time is measured in whole steps *from the firing step*, not in continuous seconds from
 * `fireAt` itself. Two effects of that: the fire step itself already counts as one step of age
 * (an effect that fires and is immediately frozen is one step old, not zero), and the fire step
 * is wherever `fireStepIndex` above actually lands, which is not always `Math.ceil(fireAt /
 * STEP_SECONDS)` — see that function's own comment.
 *
 * **The construction.** `fireStepIndex(fireAt)` gives the 1-indexed step the effect is created
 * on. `Math.round(age / STEP_SECONDS)` converts the requested continuous age into a whole
 * number of steps past that — floored at 1 rather than allowed to hit 0, because age 0 is not a
 * frame this bench can freeze on: the earliest `runFixedClock` can ever stop is one step after
 * firing, the same step the fire happens on. Adding the two (minus the one step they'd
 * otherwise double-count, since the fire step is included in both counts) gives the total
 * number of steps the run needs, and `elapsedAfterSteps` turns that step count into the exact
 * `duration` value that makes `runFixedClock`'s own `elapsed < duration` loop condition stop
 * after precisely that many steps — see that function's own comment for why it is the
 * accumulated value and not the multiplied one.
 *
 * **This can produce a `duration` smaller than `fireAt`, and that is correct, not a bug to
 * paper over.** `runFixedClock` checks `elapsed >= fireAt` *inside* the same iteration that
 * checks `elapsed < duration` to decide whether to keep looping — the fire check does not care
 * what `duration` is, only that the loop reached that iteration at all. A request for an age of
 * exactly one step, fired at a `fireAt` that itself lands late in its own step (e.g.
 * `impact-deflect`'s `fireAt: 0.01`, one step past 0), can therefore land on a `duration`
 * smaller than `fireAt` while still correctly firing and freezing one step later — verified in
 * `scenes.test.ts`'s own `at`-override tests via `runFixedClock` itself, not by inspecting the
 * two numbers' ordering, which is exactly the "looks wrong, runs right" trap a naive validation
 * (like rejecting `duration <= fireAt`) would have introduced here for no reason.
 *
 * **What this function cannot do, on purpose.** It has no way to know the effect's own
 * `LIFETIME` (or `HOLD_SECONDS`, or whatever a given factory calls it) — that constant lives in
 * each effect's own module under `src/fx/`, not in this file, and this file does not import
 * effect code. So an `age` beyond what the effect actually lives for produces a `duration` that
 * runs the clock past the effect's own disposal, and the bench freezes on whatever the world
 * looked like with the effect already gone — an empty frame, indistinguishable from a shader
 * that silently draws nothing, which is the one failure this whole instrument exists to catch.
 * There is no fix for that *here*: a reader picking an `at` has to check the effect's own
 * lifetime constant first, the same way every scene's own `fireAt`/`duration` comment above
 * already had to before this parameter existed.
 */
function durationFor(fireAt: number, age: number): number {
  const fireStep = fireStepIndex(fireAt)
  const stepsPastFire = Math.max(1, Math.round(age / STEP_SECONDS))
  const totalSteps = Math.min(fireStep + stepsPastFire - 1, MAX_SEARCH_STEPS)
  return elapsedAfterSteps(totalSteps)
}

/**
 * Resolve a scene from a query string, e.g. `?scene=gust`.
 *
 * Takes the search string rather than reading `location` itself, for the reason
 * `selectLevel` does: it stays testable in node, and the one caller that knows about the
 * browser stays in the entry point.
 *
 * An `?at=<seconds>` alongside `?scene=` overrides the resolved scene's `duration` so the
 * frozen frame lands at that real age instead of whatever the table's own `duration` produces —
 * see `AT_PARAM`'s own comment for why this exists and `durationFor`'s for exactly how the
 * override is computed. The override always returns a fresh object; `BENCH_SCENES`'s own entry
 * is never mutated, so a second call with a different `at` (or none) is unaffected by the
 * first.
 *
 * A malformed `at` — anything that is not a finite, positive number — is rejected rather than
 * coerced into something plausible-looking, and falls back to the scene's own `fireAt` and
 * `duration` with a `console.warn` naming what was ignored, the same shape this function already
 * uses for an unknown scene id below. The reason is the same reason a wrong frame is worse than
 * a missing one throughout this module: a frame frozen on a silently-clamped or silently-zeroed
 * `at` looks exactly like a correctly-aimed one, and nothing about the resulting screenshot
 * would say otherwise.
 */
export function resolveBench(search = ''): BenchScene | null {
  const params = new URLSearchParams(search)
  const requested = params.get(SCENE_PARAM)
  if (requested === null || requested === '') return null

  const found = BENCH_SCENES.find((s) => s.id === requested)
  if (!found) {
    console.warn(
      `Unknown bench scene "${requested}". Known scenes: ${BENCH_SCENES.map((s) => s.id).join(', ')}.`,
    )
    return null
  }

  const rawAge = params.get(AT_PARAM)
  if (rawAge === null) return found

  const age = Number(rawAge)
  if (!Number.isFinite(age) || age <= 0) {
    console.warn(
      `Ignoring bench "${AT_PARAM}" value "${rawAge}" for scene "${found.id}": it must be a `
      + `finite, positive number of seconds. Using scene "${found.id}"'s own fireAt `
      + `(${found.fireAt}) and duration (${found.duration}) instead.`,
    )
    return found
  }

  return { ...found, duration: durationFor(found.fireAt, age) }
}
