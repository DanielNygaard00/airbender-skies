# Aim And Hit Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reticle that shows where an attack will actually go, and an indicator that shows where a hit came from.

**Architecture:** Two pure tested modules — one turning a hit's world position into a screen bearing and ageing the marks, one turning a projected aim point into a viewport position — plus two thin untested DOM views. The reporting half is new: `EncounterStep` gains a list of where each hit on the player came from.

**Tech Stack:** TypeScript 7.0.2, three.js 0.185.1, Vitest 4.1.10 (node environment).

## Global Constraints

- **Exact value:** `HIT_MARK_SECONDS` = **1.2**.
- **Test environment is node** (`vitest.config.ts`). No DOM. `npx vitest run <path> --reporter=verbose` to see `console.log`. Typecheck `npm run typecheck` — two passes; `noUncheckedIndexedAccess` on.
- **The hit-direction indicator must NOT be scaled by any motion scalar.** Reduce-motion sets `motionScales().hurtFlash` to 0, so under that setting this indicator is the player's only hit feedback. It fades rather than shaking or pulsing, so there is nothing vestibular in it to soften. A reviewer will check this specifically.
- **Comments explain *why*, not what.** **Every measured number in a comment must also be asserted somewhere.**
- **After writing a test, neutralise the feature and confirm the test goes red.** This project's register stands at **fifteen assertions across six cycles that could not fail**; `docs/HANDOFF.md`'s "Testing discipline" section has the list. Live hazards here: asserting a **magnitude** where the sign is the thing that matters, a **fixture default** making an assertion vacuous, and a **probe derived from the value under test**.
- **Never commit to `main`.** Work on `aim-and-hit-direction`, which exists and is checked out.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/fx/hit-direction.ts` | **New.** `PlayerHit` re-export, `bearingFromCamera`, `HitMark`, `stepHitMarks`, `HIT_MARK_SECONDS`. Pure. |
| `src/fx/hit-direction.test.ts` | **New.** Signed bearings, ageing, the degenerate vertical case. |
| `src/ui/reticle.ts` | **New.** `ReticleModel`, `reticleModel`. Pure. |
| `src/ui/reticle.test.ts` | **New.** NDC conversion, the y flip, behind-camera. |
| `src/combat/encounter.ts` | **Modify.** Report `playerHitsThisFrame`. |
| `src/combat/encounter.test.ts` | **Modify.** Spear, arrow, both on one frame, and the avoided case. |
| `src/ui/reticle-view.ts`, `src/ui/hit-direction-view.ts` | **New.** The DOM halves. Untested. |
| `src/main.ts` | **Modify.** Project the aim, hold the marks, drive both views. |
| `README.md`, `docs/HANDOFF.md` | **Modify.** Record the cycle. |

---

### Task 1: Report where a hit came from

**Files:**
- Modify: `src/combat/encounter.ts`
- Test: `src/combat/encounter.test.ts`

**Interfaces produced:**

```ts
export interface PlayerHit { from: Vector3; damage: number }
// EncounterStep gains:
playerHitsThisFrame: PlayerHit[]
```

- [ ] **Step 1: Read how damage is counted today**

`src/combat/encounter.ts` accumulates `damageToPlayer` at roughly line 359 from each soldier's `stepEnemy` result, and adds `projectileDamage` at roughly line 377 from the projectile loop above it. Read both loops and the `avoided`/`applied` lines that follow before writing anything — the list has to be built in both places and the ordering matters for the test that asserts both on one frame.

- [ ] **Step 2: Write the failing tests**

In `src/combat/encounter.test.ts`, matching its existing fixtures:

1. **A spear strike reports the soldier's position.** Assert the `from` equals the soldier's position, component by component — not merely that the list has one entry.
2. **An arrow reports the projectile's position**, not the archer's. These differ by the distance the arrow has flown, which is the whole point of reporting the projectile: a player hit by an arrow needs to know where the arrow came from, and by then the archer may have moved.
3. **A spear and an arrow on the same frame produce two entries with distinct `from` values.** This is the case that justifies a list rather than one aggregated direction, so it must exist.
4. **A hit avoided by a Slipstream still appears in the list, while `playerHealth` is unchanged.** Both halves in one test: the list reports what was aimed, and `applied` decides what landed. Nothing else would catch a wiring that only reports landed damage.
5. **No hits, no entries** — an empty list rather than `undefined`, so consumers need no guard.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/combat/encounter.test.ts --reporter=verbose`

Expected: FAIL — `playerHitsThisFrame` does not exist.

- [ ] **Step 4: Implement the reporting**

Add `PlayerHit`, build the list in both loops, and return it from `stepEncounter`. Report a hit whenever damage was aimed at the player, **before** the `avoided` check zeroes it — with a comment saying why, because the reverse reads as more obvious and is wrong.

- [ ] **Step 5: Run the tests, then the full suite and typecheck**

Run: `npx vitest run src/combat/ --reporter=verbose`, then `npx vitest run && npm run typecheck`.

`EncounterStep` gains a required field, so the compiler will name every test that builds one. Take its list as authoritative and report any site this plan does not mention.

- [ ] **Step 6: Neutralise and confirm each reddens**

1. Report only when `applied > 0` — must redden the avoided test.
2. Report the archer's position instead of the arrow's — must redden test 2.
3. Report only the first hit each frame — must redden test 3.

Record the table with the catching test for each.

- [ ] **Step 7: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "Report where each hit on the player came from"
```

---

### Task 2: The two pure modules

**Files:**
- Create: `src/fx/hit-direction.ts`, `src/fx/hit-direction.test.ts`, `src/ui/reticle.ts`, `src/ui/reticle.test.ts`

**Interfaces:**
- Consumes: `PlayerHit` from Task 1.
- Produces:

```ts
export const HIT_MARK_SECONDS = 1.2
export function bearingFromCamera(cameraForward: Vector3, playerPosition: Vector3, from: Vector3): number
export interface HitMark { bearing: number; life: number }
export function stepHitMarks(marks: readonly HitMark[], dt: number): HitMark[]
export function markFor(cameraForward: Vector3, playerPosition: Vector3, hit: PlayerHit): HitMark
// reticle.ts
export interface ReticleModel { visible: boolean; x: number; y: number; hot: boolean }
export function reticleModel(ndc: { x: number; y: number; z: number }, hot: boolean): ReticleModel
```

- [ ] **Step 1: Write the failing bearing tests**

`bearingFromCamera` returns a turn in radians: 0 dead ahead, **positive clockwise on screen**, ±π directly behind. Computed horizontally — flatten both the camera forward and the player-to-source vector.

The cases:

- Source dead ahead of the camera's forward: 0.
- Source directly behind: `Math.abs` equals π (either sign is correct at the antipode, so this is the one case where a magnitude assertion is right — say so in the comment).
- **Source to the player's right, and source to the player's left, asserted as opposite signs with the specific sign for each.** Assert the actual signed values. A test on `Math.abs` would pass an implementation that mirrored left and right, which is the single most likely error in this module and the one that makes the whole feature actively harmful.
- A source at 45 degrees, asserted against `Math.PI / 4` with a sign.
- **A source directly above the player**: no NaN, and a defined finite bearing. Use the same guard shape `inCone` uses — below a small horizontal distance, report dead ahead rather than normalising a zero-length vector.
- A camera forward that is straight down: still no NaN, since flattening it leaves nothing to normalise.

- [ ] **Step 2: Write the failing mark-ageing tests**

- `markFor` produces a mark with `life` equal to `HIT_MARK_SECONDS` and the bearing `bearingFromCamera` would give.
- `stepHitMarks` reduces every life by `dt` and **preserves order**, asserted with three marks at different lives.
- A mark whose life reaches exactly 0 is dropped; one with any life left is kept. Assert the boundary at exactly zero, since that is where an off-by-one lives.
- A mark's bearing is unchanged by ageing. This is the design's deliberate choice — marks are not re-aimed as the camera turns, so turning toward one leaves it behind rather than dragging it around, which is what makes turning feel like it worked. Assert it, because "recompute the bearing every frame" is the instinct and it is the wrong one.

- [ ] **Step 3: Write the failing reticle tests**

`reticleModel` converts normalised device coordinates to viewport fractions.

- NDC `(0, 0)` maps to `(0.5, 0.5)`.
- **The y axis is flipped**: NDC `+1` is the top of the screen and CSS `0` is. Assert with a point on **neither** axis — `(0.5, 0.5)` in NDC → `(0.75, 0.25)` — so a swapped or unflipped axis is visible. A point on an axis would pass both.
- `z > 1` means the point is beyond the far plane and `z < -1` in front of the near one; either way a point not in the visible depth range yields `visible: false`. The case that matters: a point **behind** the camera, which `Vector3.project` returns with `z` outside `[-1, 1]`. A naive `(x + 1) / 2` with no z check draws it mirrored on screen, which is the specific bug this test exists to catch.
- `hot` passes through both ways.

- [ ] **Step 4: Run all four test files to verify they fail, then implement, then pass**

Run: `npx vitest run src/fx/hit-direction.test.ts src/ui/reticle.test.ts --reporter=verbose`

- [ ] **Step 5: Neutralise and confirm each reddens**

1. Negate the bearing sign — must redden the left/right tests.
2. Compute the bearing in 3D rather than flattened — must redden the directly-above test.
3. Drop the horizontal-distance guard — must produce a NaN and redden.
4. Recompute a mark's bearing in `stepHitMarks` — must redden the unchanged-bearing test.
5. Drop the `<= 0` boundary so a zero-life mark survives — must redden.
6. Remove the y flip in `reticleModel` — must redden.
7. Remove the z check — must redden the behind-camera test.

Record the table with catching tests. **A neutralisation that leaves the suite green is a finding to report, not a formality.**

- [ ] **Step 6: Commit**

```bash
git add src/fx/hit-direction.ts src/fx/hit-direction.test.ts src/ui/reticle.ts src/ui/reticle.test.ts
git commit -m "Turn a hit into a bearing, and an aim point into a screen position"
```

---

### Task 3: The views, the wiring, and the record

**Files:**
- Create: `src/ui/reticle-view.ts`, `src/ui/hit-direction-view.ts`
- Modify: `src/main.ts`, `README.md`, `docs/HANDOFF.md`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: `createReticle(parent)` and `createHitDirection(parent)`, each returning `{ update(...), dispose() }`.

- [ ] **Step 1: Build the two views**

Both mirror `createHud`: a `STYLE` string appended to `document.head`, a root element appended to the parent, handles cached once, `update(model)` and `dispose()`. Both untested — the node environment has no DOM, and everything in them that a test could catch lives in Task 2's modules.

The reticle is a small dot with a thin ring, positioned with `left`/`top` as percentages from the model's `x`/`y`. The `hot` state changes one thing only — brightness or ring weight, your call — and **there are no per-move variants**: four reticles for four moves is noise, and the gust cone effect already draws the real footprint when it fires.

The hit indicator draws one wedge per mark, rotated by its bearing, at a fixed radius from the reticle's own position rather than from screen centre, so the two read as one system. Opacity is `life / HIT_MARK_SECONDS`.

Both are `pointer-events: none`, like every other overlay in this project.

- [ ] **Step 2: Project the aim point in `main.ts`**

In `syncVisuals`, after the camera is positioned and `updateProjectionMatrix` has run — the projection is only valid once the camera's matrices are current, and this is the ordering mistake that produces a reticle one frame behind:

```ts
// A point along the real heading, not screen centre. The camera looks AT the player from
// behind and above, so screen centre is the character's body; and on foot `forward` is the
// flattened look direction, so aim stays horizontal however far the player looks up. The
// projection is the only thing that reports both truthfully.
```

Pick the distance along `forward` deliberately and say why in a comment — a point too close projects almost onto the character, one too far barely moves with a turn. The gust's range is a defensible anchor since it is the longest-reaching aimed move.

- [ ] **Step 3: Hold and age the marks**

Keep a `HitMark[]` beside the other render state. In `update`, append a `markFor` per entry of `playerHitsThisFrame`. In `syncVisuals`, age them with real frame time via `stepHitMarks`, the same way `shake` is stepped with `frameDt` rather than the fixed step.

**Do not scale either view by anything from `motionScales`.** Reduce-motion zeroes `hurtFlash`, which makes this indicator the player's only hit feedback in that mode. It fades rather than shaking, so there is nothing vestibular to soften. Put that reasoning in a comment next to where the other scalars are applied, or a future reader will "fix" the inconsistency.

- [ ] **Step 4: Hide both while paused**

`frame()` already branches on `pauseReason`. Both views hide when it is non-null: the guide and the pause card own the screen then, and a reticle floating over a settings panel is noise.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`.

- [ ] **Step 6: Verify what can be verified, and be exact about what cannot**

Start the dev server. **Verifiable:** both roots exist in the DOM, the reticle's `left`/`top` are plausible percentages, `pointer-events` is `none` on both, and a synthetic hit produces a wedge with a bearing.

**Not verifiable here:** whether the reticle tracks a turn, whether it sits where an attack actually lands, and whether a wedge reads as a direction — all need pointer lock, which this environment cannot hold, since it never receives OS focus and `requestPointerLock` always errors. Report those as unestablished rather than inferring them from the DOM. If you drive the loop with the documented synthetic-clock technique, note that a hidden preview pane makes `documentHidden` true and the game paused by design, so both views will be hidden.

- [ ] **Step 7: Update the README and the handoff**

README: a sentence in the combat prose that the reticle shows where an attack will go and that a hit shows the direction it came from. No numbers.

`docs/HANDOFF.md`: the two gaps that motivated the cycle; **why the reticle is projected rather than centred**, with both reasons (the follow cam's offset, and `forward` being flattened on foot); that hits are reported before the avoided check and why; that marks are not re-aimed as the camera turns and why that is deliberate; and **that the indicator is deliberately outside reduce-motion's scaling**, since that is the decision most likely to look like an oversight later.

- [ ] **Step 8: Commit**

```bash
git add src/ui/ src/main.ts README.md docs/HANDOFF.md
git commit -m "Show where an attack goes, and where a hit came from"
```

---

## Self-review notes

**Spec coverage.** The reporting → Task 1. Both pure modules → Task 2. The views, the projection, the mark lifecycle, the pause hiding → Task 3. Each of the spec's seven testing bullets maps to a step: the signed bearings and the vertical case to Task 2 Step 1, ageing to Step 2, the NDC flip and behind-camera to Step 3, and the four `playerHitsThisFrame` cases to Task 1 Step 2. The spec's out-of-scope list adds no tasks by construction.

**The two places this is most likely to go wrong.** A mirrored left/right bearing would make the feature worse than nothing, and a magnitude assertion would not catch it — hence the explicit "assert the signed value" instruction and neutralisation 1. And Task 3's projection depends on being run after `updateProjectionMatrix`, which is an ordering nothing tests, so the plan names it rather than leaving it to be discovered.

**Known gap, stated rather than papered over.** Task 3 has no tests, because `main.ts` has none and neither DOM view can be tested in node. Nothing automated catches a projection run against stale camera matrices, a view left visible while paused, or a motion scalar applied to the indicator against the design. A reviewer should read `syncVisuals` and `frame()` directly rather than treating a green suite as covering them.
