# Deferred findings backlog

Carried out of the first version's task-by-task execution. **Nothing here blocked the merge** —
the final whole-branch review gave per-item verdicts and cleared all of it. This is the backlog,
not a defect list.

Read it alongside [the final review](2026-07-30-final-review.md), which corrected three things
in the list below and is the authority where they disagree:

1. **Item 1's severity is overstated.** The `liftDir` fallback does not guard the
   "gliding never gains net altitude" invariant — the projection of `up` off `vdir` does that on
   every ordinary frame. The fallback's branch needs an angle of attack within 0.0057° of exactly
   90°. What it was actually hiding was the backwards-glide bug, which is now fixed with a
   regression test, so item 1 is closed.
2. **Item 6's recorded fix recipe is a no-op.** "Require `hit.normal.y` above ~0.5" can never
   fire: Three.js flips `intersection.normal` to oppose the ray direction, so a downward ray
   always yields `normal.y >= 0`. The overhang problem it describes also does not exist, because
   island materials are `FrontSide` and front-side culling excludes every downward-facing face
   (measured: 162 hits across 36 angles × 5 radii, zero downward-facing). Close it as unreachable
   and do not implement the recipe.
3. **Items 2, 4, 5 and 7 were fixed in the pre-merge wave** (shrine call-site guard, mesh
   positioning test anchor, island tier assertions were declined as low-value, and the
   `worldFloorY` bound is now derived from the island shaping constants).

Three findings recorded during execution never made it into this list: the unenforced
`jumpSpeed² / (2 · gravity) > snapDistance` constraint, the dropped tick of physics on a
mode-transition frame, and `respawn` setting `grounded: true` without probing. See the final
review's Section C for those.

---


1. **Task 4 — the `liftDir` fallback has no working regression test.** The fix (a layered
   cross-product fallback, provably perpendicular to velocity) is correct. But the `bank != 0`
   test added alongside it never reaches the degenerate branch: `simulate()` builds both `forward`
   and `velocity` purely in the y-z plane, and `WORLD_UP` lies in that plane too, so a banked `up`
   gains an x-component that in-plane velocity can never match. Max reachable `|up·vdir|` at
   bank 0.7 is ~0.76; the branch only fires near bank 180°. Reverting to the old `(0,1,0)` fallback
   would still pass. **This guards the game's load-bearing invariant** — that gliding never gains
   net altitude. Fix: add a case with a yawed `forward` and `velPitchDeg` diverging sharply from
   `pitchDeg`, or unit-test the fallback in isolation.

2. **Task 20 — the shrine-refill bug has no call-site guard.** The bug (every shrine acting as a
   full breath refill) is fixed, and three tests pin `applyShrineBonus`'s contract. But those tests
   observe the pure function, not `main.ts`'s use of it. Reverting `bonus.breath` to
   `bonus.maxBreath` in `main.ts` would pass all 270+ tests. Fix: an integration test that
   simulates collection and reads the resulting breath, or extract the collection step from
   `main.ts` into a pure function that can be tested.

3. **Task 9 — the `.clone()` on returned raycast hits is unguarded.** The test named "does not
   alias its returned point into caller state" does not actually pin it: three@0.185.1's
   `Mesh.raycast` already clones `point` and builds a fresh `normal` per call
   (`Mesh.js:434,467`), so `intersectObjects` returns independent objects regardless. Deleting our
   `.clone()` would not fail the test. Our clone is still correct defensive practice against a
   future Three.js change.

4. **Task 14 — mesh positioning tests anchor on the origin.** Both the "positions each mesh" and
   "terrain query finds home" tests use `home` at `(0,0,0)`, where `0 == 2*0 == never-set`. Neither
   can distinguish correct positioning from a missing `mesh.position.copy`, a double-applied
   offset, or a missing `updateMatrixWorld`. Mitigating: `island.ts` never reads `def.position` at
   all, so the double-apply class is structurally unreachable. Fix: anchor on `ring-east` at
   `(320,-70,40)`.

5. **Task 10 — island tier ordering only pins 3 of 8 islands.** `climb-far` could be moved from
   y=190 to y=-50, contradicting its stated "needs thrust" role, and no test would fail.
   `ring-south` and `ring-west` tiers are also unpinned. Fix: assert every `ring-*` below `home`,
   every `climb-*` above it, and `spire` above all others.

## Group B — Latent correctness, currently unreachable

Real gaps whose trigger conditions the current code cannot produce. Cheap to close; safe to defer.

6. **Task 11 — `groundStep` ignores `hit.normal.y`.** Island geometry has documented overhangs, so
   a downward ray clipping the underside of a rim bump would set `grounded = true` on a
   downward-facing surface. Confined to island rims, not the walkable top. Fix: require
   `hit.normal.y` above ~0.5. Note the controller's kite-mode landing check has the same shape.

7. **Task 10 — `worldFloorY` validation understates real geometry depth by ~17.6%.** It uses
   `min(position.y - height*2)`, but `ROUGHNESS` displaces vertices before `BOTTOM_STRETCH`
   applies, so islands actually reach `2.432 * height` below their position. Harmless in
   `ARCHIPELAGO` (446 units of margin against a ~9.5 unit shortfall) but not a safe general bound
   for a future hand-authored level. Fix: use `height * 2.5`, or derive the constant from
   `island.ts`'s shaping constants.

8. **Task 12 — `safeRespawn`'s last-resort fallback trusts `deps.flight.baseMaxBreath`.** A config
   with a non-finite `baseMaxBreath` would recreate the infinite-corruption shape through a
   different root cause. Acceptable: config is static and game-owned, a materially different trust
   boundary from an injected per-call `spawnPointFor`.

9. **Task 12 — a permanently broken `spawnPointFor` can loop.** The fallback's `grounded: false` at
   the origin gives fall → worldFloor → fallback → fall. Always finite, so the corruption
   guarantee holds, but could visually strand the player.

10. **Task 10 — `findOverlappingIslands` can miss overlaps** when island heights differ by more
    than ~3.6×. `ARCHIPELAGO`'s worst ratio is 0.36, safe.

## Group C — Missing coverage on correct code

11. **Task 12 — no test drives the third `isFinitePlayer` call site** (the final result guard on
    state corrupted mid-computation). Verified by inspection; structurally identical to the two
    covered sites.
12. **Task 11 — only `state.position` has a non-mutation test.** `velocity`, `forward` and
    `input.lookDirection` are unguarded; all verified safe by hand.
13. **Task 12 — the non-mutation test covers `position` and `breath`, not `velocity` or `forward`.**
14. **Task 12 — "gliding costs no breath" passes via the clamp, not by proving zero cost.** It
    starts at breath 100 (already max); gliding actually regenerates in air. Changing the airborne
    regen rate would not fail it. Fix: start from breath 50.
15. **Task 12 — "fast touchdown keeps momentum" only asserts `length > 0`,** pinning neither the
    0.3 `STAGGER_RETENTION` factor nor the Y-zeroing.
16. **Task 18 — no combined test** proving a corrupt `maxBreath` alongside valid
    `collectedShrines` preserves the shrines. Fields are validated independently and each has a
    single-field test.
17. **Task 5 — the triple-degenerate `steerToward` fallback is untested** (current parallel to
    `WORLD_UP` AND target antiparallel). Verified correct by hand.
18. **Task 10 — two weak tests:** "finds none in a well-spaced level" runs against a single-island
    array so the inner loop never executes; the `worldFloorY` rejection test has a 140-unit margin
    so it does not pin the multiplier.

## Group D — Cosmetic and accepted

19. Task 3 — `kiteUp` does not normalise `forward` before using it as a rotation axis. All callers
    pass unit vectors.
20. Task 3 — `kiteUp`'s fallback threshold is a hard discontinuity ~0.057° from vertical; watch for
    an orientation pop near vertical dives during tuning.
21. Task 4 — the unpowered-glide energy bound asserts `< 0.35` while the design target is "a few
    percent"; loose enough to pass a materially over-draggy tune.
22. Task 4 — `Math.max(0, ...)` in `stallFactor` is a no-op.
23. Task 5 — `Math.max(speed, 1)` in `turnRateFor` only matters for negative speed.
24. Task 7 — the generic `on<E>` listener helper uses an unsound contravariant cast. Safe because
    every call site registers under the matching DOM event name.
25. Task 7 — no `pointerlockchange`/`pointerlockerror` listener, so nothing signals UI state if the
    lock drops. The mousemove guard already prevents bad input accumulation.
26. Task 9 — `PROBE_MARGIN`'s comment implies a tight 200-unit clearance; real clearance is much
    larger because the bounding-sphere centre sits below `mesh.position.y`.
27. Task 9 — nothing documents that island meshes must stay static after `createTerrainQuery`.
28. Task 10 — the `worldFloorY` error message does not name which island sets the bound.
29. Task 14 — `createRenderer` adds a window resize listener with no removal path.
30. Task 16 — `attachModel` does not dispose the placeholder's geometry/material.
31. Task 16 — `loadGLTF` caches a null result, so a transient load failure is permanent for the
    session.
32. Task 17 — `createHud` injects a `<style>` tag per call.
33. Task 17 — four `querySelector` results cast without runtime null checks.
34. Task 18 — `Shrine.id` is the island id, not a unique shrine id; two shrines on one island would
    share an id.
35. Task 21 — width/length validation messages omit the `Level "${id}"` prefix the others use; the
    two `home` waterfalls share a texture because `createWaterfallTexture` seeds off
    `island.noiseSeed`; `advanceScroll`'s `next < 0` branch is unreachable.

## Cross-task note

Groups A and B both contain items where a **plan-level** constant or formula was imprecise rather
than a coding error: the `worldFloorY` depth bound, the `liftDir` fallback, and `RIM_INSET` (already
fixed in Task 21). Worth asking whether any other constant chosen by eye during planning deserves
the same empirical check the Task 21 reviewer applied.
