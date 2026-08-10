# Vertical Reach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the player's four offensive moves a vertical extent, so an enemy far above or below is out of reach rather than inside an infinite column.

**Architecture:** `ConeShape` gains a `verticalReach` half-extent and `inCone` tests it, which covers the gust and both staff arcs through the existing single definition. The two radial moves get their own field, since they are not cones. The cone stays horizontal; aiming is untouched.

**Tech Stack:** TypeScript 7.0.2, three.js 0.185.1, Vitest 4.1.10 (node environment).

## Global Constraints

- **Exact values:** staff opener `2.0`, staff finisher `2.0`, gust `5.0`, `pressureWave.verticalReach` `4.0`, `vortex.verticalReach` `8.0`.
- **Test environment is node** (`vitest.config.ts`). `npx vitest run <path> --reporter=verbose` to see `console.log`. Full suite `npx vitest run`. Typecheck `npm run typecheck` — two passes; `noUncheckedIndexedAccess` on.
- **Comments explain *why*, not what.** `src/combat/config.ts` and `src/combat/cone.ts` carry the reasoning behind each value; match that register.
- **Every measured number in a comment must also be asserted somewhere.** A number in a comment and nowhere else is a plan failure. This repo has shipped wrong numbers as prose above code nobody re-derived.
- **After writing a test, neutralise the feature and confirm the test goes red.** Make the change, run the suite, watch it redden, revert. This project's register stands at **fourteen assertions across six cycles that could not fail**; every one was found by making the change, none by reading the assertion and judging it adequate. `docs/HANDOFF.md`'s "Testing discipline" section has the list and the shapes.
- **The cone stays horizontal.** Do not add a second aim vector, do not tilt the cone, do not touch `forward`.
- **Enemy ranges are already 3D and must not change.**
- **Never commit to `main`.** Work on `vertical-reach`, which exists and is checked out.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/combat/cone.ts` | **Modify.** `ConeShape` gains `verticalReach`; `inCone` tests it. |
| `src/combat/cone.test.ts` | **Modify.** Boundary and neutralisation cases for the shared predicate. |
| `src/combat/config.ts` | **Modify.** Five values: two staff arcs, the gust, and a new field on each of `pressureWave` and `vortex`. |
| `src/combat/pressure-wave.ts` | **Modify.** Height test beside the existing `horizontalDistance` check. |
| `src/combat/vortex.ts` | **Modify.** Same. |
| `src/combat/pressure-wave.test.ts`, `src/combat/vortex.test.ts` | **Modify.** Boundary cases. |
| `src/combat/encounter.test.ts` or a new `src/combat/reach-geometry.test.ts` | **New/modify.** The real-geometry battery. Decide which during Task 2 and say why. |
| `README.md`, `docs/HANDOFF.md` | **Modify.** Record the cycle and the cosmetic mismatch. |

---

### Task 1: The four moves gain a vertical extent

**Files:**
- Modify: `src/combat/cone.ts`, `src/combat/config.ts`, `src/combat/pressure-wave.ts`, `src/combat/vortex.ts`
- Test: `src/combat/cone.test.ts`, `src/combat/pressure-wave.test.ts`, `src/combat/vortex.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ConeShape.verticalReach: number`; `pressureWave.verticalReach: number`; `vortex.verticalReach: number`. `inCone`'s signature is unchanged — the new constraint arrives inside the shape it already takes.

- [ ] **Step 1: Add `verticalReach` to `ConeShape` and the height test to `inCone`**

In `src/combat/cone.ts`, extend the interface and the predicate. The existing doc comment says "Horizontal: height is ignored entirely" — that sentence is now false and must be rewritten, not left standing.

The test is `Math.abs(target.y - origin.y) <= c.verticalReach`, placed **before** the horizontal normalise so a target far above or below costs nothing to reject.

Keep the existing degenerate-distance guard (`distance < 1e-6` returns false, so a target directly on top of the caster has no direction to compare and is out rather than normalised into a NaN). Do not fold the two guards together — they reject different things for different reasons.

- [ ] **Step 2: Run typecheck to find every `ConeShape` literal**

Run: `npm run typecheck`

Expected: FAIL, naming every object literal that builds a `ConeShape` without the new field — production and test. **Take the compiler's list as authoritative** over anything this plan says, and report any site the plan does not mention.

- [ ] **Step 3: Set the five values**

In `src/combat/config.ts`:

- `staffArc.opener` gains `verticalReach: 2.0`
- `staffArc.finisher` gains `verticalReach: 2.0`
- `gust` gains `verticalReach: 5.0`
- `pressureWave` gains `verticalReach: 4.0`
- `vortex` gains `verticalReach: 8.0`

Each needs a comment giving its reasoning, in the register the file already uses. The spec's table has the arguments: the staff is a swing with a physical implement against the character's own 1.8 height; the gust is a sweep of air, wide but not a column; the Pressure Wave is deliberately smallest relative to its reach because the fiction is a shockwave across the surface and it must not become a sphere as its radius grows with fall speed; the Vortex is tallest because lifting is its whole payoff.

Write the reasoning, not the numbers again — a comment that restates the literal beside it says nothing.

- [ ] **Step 4: Add the height test to the two radial moves**

`src/combat/pressure-wave.ts:60` and `src/combat/vortex.ts:42` both filter on `horizontalDistance(origin, enemy.position) <= radius`. Add the height test beside it. These are not cones and do not share `ConeShape`; each reads its own config's `verticalReach`.

- [ ] **Step 5: Write the unit tests**

For `inCone`, in `src/combat/cone.test.ts`:

- A target exactly at `verticalReach` is **in**; one just past it is **out**. Assert both, at a height derived from the shape rather than a literal, so the boundary moves with the value.
- The existing horizontal behaviour is unchanged at `dy = 0` — the whole existing suite covers this, so add nothing, but confirm it still passes.
- The degenerate guard still holds: a target at the same position is out.
- A target within `verticalReach` but outside the horizontal cone is out, so the two constraints are `AND` and not `OR`. This is the case a wrong implementation most plausibly gets backwards.

For each of `pressure-wave.test.ts` and `vortex.test.ts`: a target inside the radius but past `verticalReach` is out, and one at the boundary is in.

For `staffShape`: assert the two arcs' `verticalReach` values are **equal to each other**, not equal to `2.0` twice. A future change to one should show up as a change to both.

- [ ] **Step 6: Run the tests, then the full suite and typecheck**

Run: `npx vitest run src/combat/ --reporter=verbose`, then `npx vitest run && npm run typecheck`.

Some existing combat tests may now fail, because fixtures that placed enemies at convenient heights are suddenly out of reach. **That is a finding to report, not a fixture to quietly adjust.** For each failure, say whether the fixture was unrealistic (fix the fixture, and say what was unrealistic) or the new extent is too tight (report it — the number may be wrong).

- [ ] **Step 7: Neutralise each of the five extents and confirm the suite reddens**

Required, one at a time: raise the value far above its setting (1000 is fine), run the suite, confirm **FAIL**, revert. Five runs.

Record a table with the catching test for each. **A neutralisation that leaves the suite green is a finding to report, not a formality** — a value nothing pins is a value that can drift, and this project's register is at fourteen for exactly this reason.

- [ ] **Step 8: Commit**

```bash
git add src/combat/
git commit -m "Give the player's four attacks a vertical extent"
```

---

### Task 2: Prove it against the real archipelago, and record it

The discriminating half. Task 1's boundary tests prove the mechanism exists; this task proves the numbers do not break a fight that used to work.

**Files:**
- Test: `src/combat/reach-geometry.test.ts` (new), or an addition to `src/combat/encounter.test.ts` — decide which and say why in the report
- Modify: `README.md`, `docs/HANDOFF.md`

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces: nothing further consumes this.

- [ ] **Step 1: Build the real-geometry fixture**

Use `ARCHIPELAGO` from `src/world/levels/archipelago.ts`, `buildWorld` from `src/world/world.ts`, and `HOME_PATROL` from `src/combat/config.ts`. `src/player/terrain-collision.test.ts` already builds real terrain in a node test — read how it does that and follow it rather than inventing a second way.

- [ ] **Step 2: Assert every soldier that should be hittable still is**

For each of the four moves, from a player standing on the real ground at a realistic engagement distance from each `HOME_PATROL` soldier: every soldier inside the move's horizontal reach is still hit.

**Measure the real vertical gaps first and log them**, then assert against the measured worst case. Do not assume the ground is flat — `groundHeightAt` is what decides, and the patrol stands where it stands.

- [ ] **Step 3: Establish whether the Pressure Wave's 4.0 is tight enough**

This is the value the spec names as most likely wrong, because the player lands wherever the ground allows.

Measure the vertical gap between a realistic landing position and each home-island soldier, log every gap, and assert the worst case is inside `4.0`. **If it is not, do not change the number and do not loosen the test — report it.** The number moving is a design decision, not an implementation one.

- [ ] **Step 4: Run the battery, the full suite and typecheck**

Run: `npx vitest run src/combat/ --reporter=verbose`, then `npx vitest run && npm run typecheck`.

- [ ] **Step 5: Update the README**

The combat prose already describes the gust, the staff, the Vortex and the Pressure Wave. Add that reach now has a vertical limit — an enemy far below or above is out of range. Do not put the five numbers in the README; they are tuning values and belong in the config with their assertions.

- [ ] **Step 6: Update the handoff**

In `docs/HANDOFF.md`, record: the measurements that motivated the cycle (an enemy 8 m ahead and 2000 m below inside a gust; 3 m ahead and 50 m below inside a staff opener), that the asymmetry inverted the archer cycle's whole point since enemy ranges were already 3D, the five extents and the shape of the set rather than just the values, the real-geometry results including the measured Pressure Wave gaps, and — explicitly — the cosmetic mismatch: `src/fx/gust-cone.ts` draws a flat sector while the hit volume is now a slab, so the effect under-draws the move's height, deliberately unfixed because the visuals phase has not started.

- [ ] **Step 7: Commit**

```bash
git add src/combat/ README.md docs/HANDOFF.md
git commit -m "Prove the vertical extents against the real archipelago"
```

---

## Self-review notes

**Spec coverage.** The shape and `inCone` → Task 1 Steps 1-2. The five values → Task 1 Step 3. The radial moves → Task 1 Step 4. The spec's six testing bullets: the boundary and `AND`-not-`OR` cases and the shared-`verticalReach` assertion → Task 1 Step 5; the five neutralisations → Task 1 Step 7; the real-geometry battery and the Pressure Wave measurement → Task 2 Steps 2-3. The cosmetic mismatch → Task 2 Step 6. The spec's "deliberately does not do" list adds no tasks by construction.

**Where this plan expects trouble.** Task 1 Step 6 anticipates existing combat tests failing because their fixtures placed enemies at heights that are now out of reach. The plan deliberately does not pre-judge which way each should be resolved, because "adjust the fixture until it passes" is exactly how a too-tight number would ship unnoticed. Each failure gets a stated reason.

**The one number most likely to be wrong** is `pressureWave.verticalReach` 4.0, and Task 2 Step 3 is built to catch it rather than to confirm it — it measures first, logs everything, and forbids both changing the number and loosening the test.
