# Final whole-branch review — `build/v1` → `main`

**Date:** 2026-07-30
**Scope:** 29 commits, 63 files, +6306/−25. 276 tests / 24 files green, `tsc --noEmit` clean, `npm run build` succeeds.
**Method:** read the full branch diff, the plan, the spec, the triage list and the execution ledger; read every source file under `src/`; ran mutation experiments and numeric simulations against the real code and the real generated island geometry. Working tree was left clean (verified with `git status --porcelain`) and the suite re-confirmed green after every experiment.

---

## A. MERGE VERDICT

**Merge after fixing the two items in Section B.**

The engineering discipline on this branch is high and the pure-logic core is in good shape. But two defects that no task-level review could have caught — both products of composition rather than of any single module — make the game visibly wrong in situations a player hits within the first thirty seconds. Both are small, well-understood fixes with a verified one-to-three-line shape. Neither is a feel judgement: both are reproducible with numbers.

The 35 deferred findings, by contrast, contain **nothing** that blocks merge. That includes all three of the "a real bug was fixed but the test would not catch its return" cases. My reasoning is in Section C.

---

## B. Must-fix before merge

### B1 — Critical. The follow camera snaps to an island's top surface whenever the player is below it

**`src/camera/follow-cam.ts:42-59`**, as composed in **`src/main.ts:126-131`**.

`pullInForTerrain` decides whether terrain is in the way by calling `terrain.groundHeightAt(desired.x, desired.z)`. That function raycasts *downward from above the entire world*, so it returns the **highest** surface in that column — irrespective of where the player and camera actually are. When the camera's column passes through an island and the camera is below that island's top, the guard `desired.y > ground + minDistance` is false, and the camera is lifted to `ground + minDistance`: on top of the island, with the player far below and fully occluded by the geometry in between. `camera.lookAt(player.position)` then aims the view straight down into the island's own mesh.

Reproduced against the real `ARCHIPELAGO` geometry (`home` top at (10,10) is y≈11.9):

| player y | desired camera y | camera y after `pullInForTerrain` | distance to player |
| --- | --- | --- | --- |
| −20 | −16.8 | **11.9** | 34.1 |
| −60 | −56.8 | **11.9** | 72.9 |
| −200 | −196.8 | **11.9** | 212.3 |

It is not a transient. Running 60 smoothed frames while holding position at y=−60 under `home` settles the camera at y=11.9 — 71.9 m above the player, permanently.

**Why it cannot wait.** The affected volume is the entire space beneath the islands, which is where flying happens; `worldFloorY = −600` invites a 600 m descent. It fires *before the kite is even deployed*: walk off `home`'s rim looking outward and the camera, trailing 7 m behind, sits over the island — as the player falls past the rim height the camera pins to the rim and the player drops out of frame. This is the single most-travelled path in the game. Task 20's browser session verified edge-fall and mid-fall deploy through CDP state inspection, not through the rendered view, and pointer lock was unavailable, so exactly this class of defect was outside what that session could see.

**Verified fix.** One line, inserted after the existing early return:

```ts
const ground = terrain.groundHeightAt(desired.x, desired.z)
if (ground === null || desired.y > ground + minDistance) return desired.clone()
if (target.y <= ground) return desired.clone()   // player is under this terrain: nothing to lift over
```

I applied exactly this and re-ran the suite: **276/276 still pass**, so no existing test pins the broken behaviour and the change is drop-in. Add a test that pins it (target below `ground`, desired below `ground`, assert the desired position is returned unchanged) so it cannot regress.

Note what this fix does *not* do: it does not shorten the arm when it would pass through an island *wall*, which is what the spec actually asks for ("The arm shortens when it would intersect terrain"). Doing that properly needs a general segment cast, and `TerrainQuery` exposes only `groundHeightAt` and `raycastDown`. Adding `raycast(from, direction, maxDistance)` to `TerrainQuery` is the real fix and is a reasonable follow-up, but it is a new interface method and does not belong in a merge-gate patch. The one-liner turns a broken camera into a slightly permissive one, which is the right trade for today.

### B2 — Critical. Deploying the kite from a vertical fall glides backwards or sideways

**`src/player/flight.ts:79`** (`MathUtils.clamp(effectiveAoa, -1.2, 1.2)`), with **`src/player/flight.ts:86-93`** (the degenerate `liftDir` fallback) making the worst case deterministic.

Two coupled problems:

1. **The angle-of-attack clamp defeats the module's own documented lift model.** `flight.ts:59-61` states the design intent plainly: lift uses `sin(2·aoa)` "so that lift peaks near 45 degrees and falls away past it, which is what makes stalling emerge from the geometry instead of needing a special case." The spec agrees (`design.md:152-154`). But clamping `effectiveAoa` at ±1.2 rad (68.75°) means lift **stops falling away** past 68.75° and plateaus at 96% of peak all the way through 90° and beyond. At 90° aoa the true value of `sin(2·aoa)` is zero — a broadside kite generates pure drag and no lift — and that zero is exactly what makes the direction of lift not matter when it becomes ill-conditioned.

2. **At aoa ≈ 90°, `liftDir` is unrelated to where the kite points.** `liftDir` is `up` projected off `vdir`; as `|up·vdir| → 1` that projection degenerates. Below the `1e-8` threshold the code falls back to `vdir × WORLD_UP`, then `vdir × FALLBACK_RIGHT` — both derived from world axes, neither from `forward`. So near-peak lift gets applied in a direction with no relation to the player's heading.

**The degenerate case is reachable on the first frame of the most common deployment.** `groundStep` (`ground-move.ts:35`) writes horizontal velocity directly from `desiredVelocity` with no inertia, so releasing WASD mid-fall zeroes x/z velocity *exactly*. Press Space and `controller.ts:83-92` hands `flightStep` a velocity of exactly `(0, vy, 0)`. With a level look, `forward` is exactly horizontal, `up` is exactly `(0,1,0)`, and `up·vdir` is exactly −1. The branch fires.

Measured with the shipped config, looking toward −Z (so travel should be −Z), deployed from a vertical fall at 20 m/s:

| look pitch | bank | travel after 4 s |
| --- | --- | --- |
| 0° | 0 | **z = +84** — glides backwards |
| +10° | 0 | **z = +96** — backwards |
| +30° | 0 | **z = +111** — backwards |
| −10° | 0 | z = −92 — correct |
| 0° | any (0.02…1) | **x = −59, z = 0** — glides sideways |

Over 10 s at pitch 0 the player travels **205 m backwards** while losing only 39 m of altitude. It is a functioning glide, pointed 180° wrong. Holding `W` at the moment of deploy avoids it (velocity is no longer vertical) — so the bug is precisely "coast, then deploy", which is the natural sequence because Space is the deploy key.

**Verified fix.** Clamp at ±π/2 instead of ±1.2 — lift then decays to zero broadside and never reverses, which is the principled bound and what the module already claims to do — and derive the degenerate fallback from `forward` rather than from world axes:

```ts
const clampedAoa = MathUtils.clamp(effectiveAoa, -Math.PI / 2, Math.PI / 2)
...
if (liftDir.lengthSq() < 1e-8) {
  liftDir = input.forward.clone().addScaledVector(vdir, -input.forward.dot(vdir))
  if (liftDir.lengthSq() < 1e-8) liftDir = new Vector3().crossVectors(vdir, WORLD_UP)
  if (liftDir.lengthSq() < 1e-8) liftDir = new Vector3().crossVectors(vdir, FALLBACK_RIGHT)
}
```

Measured against that candidate: every bad row above collapses to x≈0, z≈0 — the player simply falls, which is the physically correct broadside behaviour and self-corrects the moment they look down. A normal glide is bit-identical (10.19% energy loss over a 5 s unpowered glide from a level 40 m/s cruise, both before and after).

**One caveat the human must know:** this is **not** feel-neutral. A dive-and-pull-up transits the 68.75°–90° band, so the clamp currently contributes extra lift there. On my dive/zoom-climb trace the shipped code bottoms out at y=220 finishing at 18.6 m/s, and the fixed code bottoms out at y=172 finishing at 30.7 m/s. So the zoom climb changes. That is fine — Task 20 step 5 (tuning) is explicitly the human's and is still undone, so this fix lands in the same lap. It must not be merged *without* that lap, and the flight tests that encode measured behaviour will need re-baselining.

Add a regression test alongside: deploy from `velocity = (0,-20,0)` with `forward = (0,0,-1)` and assert that after a second of simulation the displacement along `forward` is positive (or at minimum non-negative). That test also happens to close deferred Group A item 1 for free — see C1.

---

## C. Deferred-findings triage

I ran the mutations rather than reasoning about them. **All four that I could mechanically revert leave 276/276 green**, confirming every claim the triage list makes:

| mutation | result |
| --- | --- |
| `flight.ts` liftDir fallback → `WORLD_UP.clone()` | 276 pass |
| `terrain-query.ts` drop both `.clone()` calls | 276 pass |
| `archipelago.ts` `climb-far` y 190 → −50 | 276 pass |
| `world.ts` delete `mesh.position.copy(def.position)` entirely | 276 pass |

### Group A — verdicts

**A1. Task 4 — `liftDir` fallback has no working regression test. → MERGE. Do not fix as a test task; it is fixed as a side effect of B2.**

Confirmed by mutation: reverting to the old `(0,1,0)` fallback keeps all 276 green. The comment on `flight-step.test.ts:137-141` claims the bank test protects against "lift doing work along the flight path" — it does not, and that misleading comment is the worst part of this item.

But the triage list's severity framing is **wrong in an important way**, and correcting it is the most useful thing I can say about Group A. The claim is that this "guards the game's load-bearing invariant — that gliding never gains net altitude." It does not. What guards that invariant is that `liftDir` is the *projection* of `up` off `vdir` on every ordinary frame — exactly perpendicular by construction — and the unpowered-glide energy-bound test covers that main path. The fallback only runs when `1 − (up·vdir)² < 1e-8`, i.e. within **0.0057° of exactly 90° aoa**. A wrong fallback there would misapply lift for a frame or two in a vanishingly narrow band; it is not the thing standing between the game and free altitude.

What is genuinely serious about that razor-thin band is something the triage list did not know: it is reachable *exactly*, not approximately, because `groundStep` produces bit-exact zero horizontal velocity. That is B2, and it is a live gameplay bug rather than a test gap. Fix B2 and the branch becomes covered by a test that pins observable behaviour, which is a better guard than a unit test on the fallback vector would have been. **Rank: subsumed by B2.**

**A2. Task 20 — the shrine full-refill fix has no call-site guard. → MERGE, but fix it: it is the highest-value item in Group A.**

I did not need to mutate this one; `main.ts` has no tests, so reverting `bonus.breath` to `bonus.maxBreath` at `main.ts:107` trivially keeps 276 green. The three `applyShrineBonus` tests pin the pure function's contract and would not notice.

This is the one I would actually close before merge, for three reasons the others lack. (a) The bug was material to the design, not to robustness: full-refill shrines let a player chain them to fly nearly indefinitely, which directly contradicts the spec's progression argument that thrust is the only source of net altitude and breath gates it. (b) It required a **human ruling** to settle, which is precisely the kind of decision that should not be re-losable by an ordinary edit. (c) The fix is genuinely cheap and does not need an e2e harness: extract the whole collection block from `main.ts:96-112` into a pure function, e.g.

```ts
export function collectStep(
  player: PlayerState, shrines: readonly Shrine[], c: FlightConfig,
): { player: PlayerState; shrines: Shrine[]; collected: string[] }
```

and unit-test that touching a shrine at 40/100 yields 40/110 and not 110/110. That also shrinks `main.ts`'s untestable `update()`, which the ledger already flagged as growing past 50 lines. This is worth doing now because the extraction is mechanical and the invariant is a design decision a human already adjudicated once.

**A3. Task 9 — the `.clone()` on returned raycast hits is unguarded. → MERGE. Do not fix.**

Confirmed: I dropped both `.clone()` calls and 276 still pass, because `three@0.185.1`'s `Mesh.raycast` already returns `point: _intersectionPoint.clone()` and a freshly allocated `normal` per call (`node_modules/three/src/objects/Mesh.js:446, 465-475`). Our clone is correct defensive practice against a future Three.js change and costs two allocations per query. The test name overpromises; renaming it to something honest ("returns a hit whose point is not the shared intersection scratch vector") would be an improvement, and that is the whole of it. There is no realistic path by which this becomes a bug. **Rank: do not fix.**

**A4. Task 14 — mesh positioning tests anchor on the origin. → MERGE, but this is second-most worth fixing, and the triage list understates the blast radius.**

The triage says the tests "cannot distinguish correct positioning from a missing `mesh.position.copy`". I verified that literally: deleting `mesh.position.copy(def.position)` from `world.ts:30` leaves **276/276 green**. That is not a subtle gap — with that line gone every island collapses onto the origin and the game is unplayable in every respect.

Two things pull in opposite directions. Against fixing: a totally collapsed world is caught by the very first playtest, and a human playtest is already scheduled, so the guard's marginal value is lower than its blast radius suggests. For fixing: the recipe is a one-line change to an existing test (re-anchor on `ring-east` at `(320,−70,40)`, where a double-apply would give `(640,−140,80)` and fail loudly), it costs nothing, and "the whole world is at the origin" is a bad thing to learn from a human's eyes rather than from CI. **Rank: 2nd. Do it if the fix pass is happening anyway; do not hold the merge on it.**

**A5. Task 10 — island tier ordering only pins 3 of 8 islands. → MERGE. Fix opportunistically.**

Confirmed: moving `climb-far` from y=190 to y=−50 keeps 276 green, so its stated "needs sustained thrust" role is unpinned, as are `ring-south` and `ring-west`. The recipe is three assertions in a loop: every `ring-*` below `home`, every `climb-*` above it, `spire` above all. Level data is hand-authored and rarely touched, and a mis-tiered island is immediately obvious in play. Cheap, low-value, no reason to block. **Rank: 4th.**

### Group A ranking, if only some are fixed

1. **A2** (shrine call-site) — a human-adjudicated design invariant with no guard at all. Extraction is mechanical and pays a second dividend by shrinking `main.ts`.
2. **A4** (mesh positioning) — one-line test edit; catastrophic-if-reverted.
3. **A1** — no separate work; closed by B2's regression test. Do fix the misleading comment on `flight-step.test.ts:137-141` while you are in the file.
4. **A5** (island tiers) — three assertions, low value.
5. **A3** (raycast clone) — do not fix; rename the test if you like.

**Is it acceptable to merge with A1/A2/A3 unguarded? Yes** — with the caveat that A2 is cheap enough that declining it is a choice about appetite rather than about risk. None of the three protects against a failure that would reach a player unnoticed: A3's revert changes nothing observable; A4's revert is instantly visible; A2's revert is visible to anyone who touches two shrines and watches the meter. A1's revert is the only one that would be genuinely silent, and B2 closes it. The 276-green-after-revert framing is alarming but the consequences behind it are not uniform, and treating them as uniform would be the wrong read.

### Group B — latent correctness, currently unreachable. → MERGE all. Two corrections.

Items 8, 9 and 10 are correctly characterised and correctly deferred. Two need amending:

**Item 6 (`groundStep` ignores `hit.normal.y`) — close as structurally unreachable, and the recorded fix recipe is wrong.** Two findings here, both verified empirically.

*The recipe is a no-op.* `three@0.185.1` flips `intersection.normal` to oppose the ray direction (`Mesh.js:469-471`). For a downward ray that makes `hit.normal.y >= 0` **unconditionally**. Anyone implementing the ledger's and the triage's recipe — "require `hit.normal.y` above ~0.5" — would add a check that can never fire on a downward-facing surface and would reasonably believe the issue closed. This is worth correcting in writing before it gets implemented. `terrain-query.test.ts:48`'s `normal.y > 0` assertion is tautological for the same reason.

*The problem does not exist today.* Island materials are `MeshLambertMaterial` with the default `side: FrontSide`, and `three` honours `material.side` in `checkIntersection` (`Mesh.js:413-419`), so a downward ray cannot hit a downward-facing triangle at all. I swept 36 angles × 5 radii over the real `home` geometry: **162 hits, 0 downward-facing, minimum `face.normal.y` = +0.100**. Flipping the material to `DoubleSide` gives 324 hits of which 162 are downward-facing. So the overhang-grounding bug is excluded by front-side culling, not merely untriggered.

The right action is therefore neither a `normal.y` gate nor a test, but a one-line comment in `terrain-query.ts` recording that `raycastDown` relies on island materials staying `FrontSide` — because the codebase already contains a `DoubleSide` precedent in `waterfall.ts:103`, so a future author flipping it is not far-fetched. Also note the recipe would be actively harmful if applied to `face.normal.y` instead: the shallowest reachable face is +0.100, so a `> 0.5` gate would stop the player standing on any slope steeper than 60°.

**Item 7 (`worldFloorY` depth bound) — fix it; it is a one-line derivation.** See F2.

### Group C — missing coverage on correct code (items 11–18). → MERGE all, fix none as a gate.

Every one is a real gap on code that a reviewer verified by hand, and none describes a defect. Item 14 ("gliding costs no breath" passing via the clamp because it starts at breath 100) is the best of them — starting from breath 50 is a two-character change that turns a tautology into a real assertion, and it is the only one I would bother with in a cleanup pass. Item 18's "finds none in a well-spaced level" running against a single-island array so the inner loop never executes is the second. Items 11, 12, 13, 15, 16 and 17 are all "verified by hand, untested"; they are the normal residue of a project that reviewed hard and shipped, and closing them is a backlog activity, not a merge gate.

### Group D — cosmetic and accepted (items 19–35). → MERGE all. Fix none.

Correctly triaged. Items 22, 23 and 35's `next < 0` branch are dead-code no-ops. Items 29–33 are lifecycle and null-safety concerns on create-once objects. Items 26, 27, 28 and 34 are documentation. Item 21 (the energy bound asserting `< 0.35` against a "few percent" design target) is worth a note: I measured 10.19% loss over a 5 s unpowered glide from a level 40 m/s cruise, against the spec's claimed 4.3% prototype figure — different initial conditions, so not a contradiction, but it does confirm the bound is loose enough to pass a materially over-draggy tune. Tighten it during the tuning lap when there is a real measured number to tighten it to; tightening it now against an untuned config would just bake in a placeholder.

Item 20 (`kiteUp`'s fallback threshold being a hard discontinuity ~0.057° from vertical) deserves to be read next to B2 rather than in isolation — it is the same family of "a threshold this tight is only reachable when some upstream code produces an exact value, and something does."

### One process note: the triage list is not the complete deferred set

The list has 35 items and `progress.md` records at least three more that did not make it in:

- **Task 11:** the unenforced tuning constraint `jumpSpeed²/(2·gravity) > snapDistance` (currently 2.025 vs 1.2). See F4.
- **Task 12:** the deploy and stow branches freeze position (`controller.ts:83-92, 96-102` clone position without integrating), dropping a tick of physics on a mode-transition frame — about 0.2 m at 12 m/s.
- **Task 12:** `respawn` sets `grounded: true` without probing for ground; self-corrects within one frame.

None changes the verdict, but if the human is treating `deferred-triage.md` as the authoritative backlog, it is short by three.

---

## D. Cross-cutting findings

### Critical

Both Critical findings are in Section B (B1 camera, B2 flight). Both are composition defects: each module is defensible against its own brief, and the wrongness only appears when you look at `main.ts`'s wiring plus the real level geometry plus the real config together. That is exactly the failure mode a whole-branch review exists to catch, and it is worth noting that the task-by-task process did not have the information to catch either one.

### Important

**D1. `PlayerMode` is a two-value union hard-branched at nine sites, all of which fail open.** `types.ts:3`. Every consumer is written as `mode === 'kite' ? … : <everything else>`: `follow-cam.ts:21`, `avatar-anim.ts:13`, `hud.ts:34`, `main.ts:115, 136, 142`, and `controller.ts:82, 140`. Adding `'scooter'` for Air Scooter — one of the four planned abilities — compiles cleanly and silently inherits the *ground* camera profile, the ground animation, the ground HUD rule, the ground wind level, and ground physics. TypeScript flags none of it. Converting `profileFor` and `animationFor` to exhaustive `Record<PlayerMode, …>` lookups would make the next mode fail loudly at the type level instead. Cheap now, annoying later, and squarely in the "makes the attacks phase harder than it should be" bucket.

**D2. The spec's claim that `FlightInput` is the seam that keeps the attacks phase cheap is not true.** The plan's deviation 1 justifies dropping `abilities/registry.ts` on the grounds that "`flightStep` takes a `FlightInput` struct, so adding abilities means extending that struct and the controller's construction of it." But `FlightInput` carries *flight forces* — `forward`, `thrust`, `flare`, `bank` — and of the four planned abilities only Air Scooter is a movement mode at all. Air Blast, Tornado and Air Shield are not forces on the kite; they need input bindings, breath costs, cooldowns and effect dispatch. What they actually run into:

- **No free bindings.** `InputState` has five fields, all consumed. `InputTracker` (`input.ts:41-68`) registers `keydown`, `keyup`, `blur` and `mousemove` and **tracks no mouse buttons at all** — there is no `mousedown` listener. Abilities will want LMB/RMB. That is `types.ts` + `input.ts` + every `InputState` literal in tests.
- **No cooldown or ability state.** `PlayerState` has no place to hold one, and it is constructed as a literal in 9 places across 5 test files, so adding a required field touches all of them.
- **`controllerStep` has no dispatch point.** It is a single if/else-if/else over mode with the flight path inlined.

The seam is thinner than advertised. I am *not* recommending building the registry now — deviation 1's core argument (don't build indirection for one hard-wired ability) is sound and I would keep the decision. But the plan's stated reason for it is wrong, and someone reading it will start the attacks phase expecting a cheap extension point that is not there. Fixing the *justification* costs nothing and prevents a bad estimate later. The genuinely load-bearing seams that do exist and should be protected are `TerrainQuery` and `flightStep`'s purity.

**D3. `ARCHIPELAGO.spawn.offset` is dead data — the `Level` contract declares a field no consumer reads.** `level.ts:12` types `spawn: { islandId, offset }`, `archipelago.ts:21` sets `offset: new Vector3(0, 6, 0)`, and `state.ts:10-24` ignores it entirely, using the island centre plus a hardcoded `SPAWN_CLEARANCE = 2`. A level author moving that offset would see no effect and no error. Either read it in `spawnPointFor` or delete it from the type and the data. Same class, lower stakes: `ShrineDef.offset.y` is ignored by design (shrines are ground-snapped), which is fine but undocumented.

**D4. `TerrainHit.normal` is a dead field with a misleading contract.** `types.ts:33` declares it, `terrain-query.ts:41` populates it, and **no production code reads it** — `grep` across `src/` outside tests finds zero consumers. As established in C/Group B item 6, its value for a downward ray is always `y >= 0` regardless of the surface hit, so the field as it stands cannot answer the one question a caller would ask of it. Either document that constraint on the type or drop the field until something needs it. Right now it is an attractive nuisance: it looks like the tool for the overhang problem and is not.

**D5. Reloading the page fully refills breath, partially re-opening the exploit the Task 20 human ruling closed.** `save.ts` persists `maxBreath` but not current breath, and `state.ts:30-32` sets `breath = maxBreath` on load. So touch a shrine at 40/110 and reload: 110/110. The ruling was that shrines raise the ceiling without refilling; a reload is a deliberate act rather than a mechanic, so this is much weaker than the original bug, but it is the same invariant and worth a decision rather than an accident.

### Minor

- **`validateFlightConfig` (`config.ts:24`) is never called at runtime.** `main.ts` does not invoke it, so its invariants — positivity, and `stallSpeed < turnRateSpeedRef` — are enforced only where `config.test.ts` calls it. That is arguably enough for a static game-owned config, but the function reads as a runtime guard and is not one. It also omits `inducedDragFactor`, `flareAoaBoost`, `rigAoa` and `bankTurnRate` from the positivity list (defensible: those may legitimately be 0) and there is no `validateGroundConfig` at all. Also cosmetic: `config.ts:42` has an `import` statement in the middle of the file.
- **The kite's maximum bank angle, `0.6`, is hardcoded at `controller.ts:113`** (`bank: input.strafe * 0.6`). It is a flight tuning value living outside `FlightConfig`, which contradicts the spec's "All tuning constants live in a single `FlightConfig` object. No magic numbers are embedded in the integration code." The human's tuning lap will look in `config.ts`, not find it, and be unable to tune bank. `LANDING_PROBE` (`controller.ts:20`) and `STAGGER_RETENTION` (`controller.ts:22`) have the same character; `LANDING_PROBE` matters for a different reason (F3).
- **`trailOpacityForSpeed` and `TRAIL_SPEED_THRESHOLD` (`fx/mapping.ts:7, 27`) are dead** — tested, never called. They are the residue of the unimplemented ribbon trails (see E2).
- **`assets.ts`'s `loadGLTF` is never called**, and `avatar.ts`'s `attachModel` / `AnimationMixer` path is consequently unreachable, so `animationFor`'s output feeds a `setAnimation` that always no-ops. This is deliberate scaffolding for a future real model (out of scope), but it means the animation state machine has never run against a mixer.
- **`waterfall`'s `if (!island) continue` at `main.ts:61` is unreachable** — `validateLevel` already guarantees every `waterfall.islandId` resolves.
- **Shrine markers, waterfalls and the avatar are added to `scene` directly, not to `world.group`** (`main.ts:56, 70, 75`). Harmless today; if a future level switch removes `world.group`, they would all linger.
- **`InputTracker.dispose()`, `hud.dispose()` and `wind.dispose()` are never called.** Correct for a create-once page lifecycle; worth knowing they exist unused.
- **`groundHeightAt` is a full-world raycast, called every frame** by `pullInForTerrain`. Each island is `IcosahedronGeometry(1, 4)` = 5120 triangles with no BVH, and up to 5 substeps per rendered frame each do this plus a movement probe. Bounding-sphere culling keeps it to roughly one island's worth of triangle tests per query, so this is not alarming, but it is the obvious first place to look if frame time becomes a problem.
- **`world.ts:31` calls `mesh.updateMatrixWorld(true)` before `group.add(mesh)`.** Correct only because `world.group` never receives a transform. The ledger already noted this as a forward-looking hazard; `createTerrainQuery` happens to call it again after attachment, which covers it today.

### Contract drift check — clean

`src/core/types.ts` was appended to by Tasks 1, 6 and 11 and I found **no contradiction**. `InputState`, `PlayerState`, `TerrainQuery`, `TerrainHit`, `FlightConfig` and `GroundConfig` are each declared exactly once and imported everywhere; nothing shadows or re-declares them; the `FlightConfig` breath fields (Task 6) and `GroundConfig` (Task 11) are additive and consistent with their consumers. The one-file-for-shared-types decision did its job. The only drift is semantic rather than structural, and it is D3/D4 above: two declared fields that no consumer reads.

### Frame-loop composition check — correct

I read `main.ts` in full and verified each item asked for:

- **`input.sample()` exactly once per update** — `main.ts:93`, and `sample()` clears the action edge (`input.ts:70-79`), so multi-substep frames cannot double-fire a jump or deploy. Correct.
- **Camera order** — `profileFor` (125) → `desiredCameraPosition` (128) → `pullInForTerrain` (126) → `smoothTowards` (131). Correct order, and `pullInForTerrain` returns a clone on its early path (`follow-cam.ts:46`) so the Task 15 aliasing concern is genuinely closed.
- **Smoothed position persists across frames** — `cameraPosition` is a closure `let` at `main.ts:90`, reassigned at 131, copied to the camera at 134. Correct. Minor: it is initialised from `camera.position.clone()`, which is the default `(0,0,0)`, so frame 1 smooths from the origin — a single-frame swoop at startup.
- **`camera.updateProjectionMatrix()` after any fov change** — `main.ts:136-137`, in that order. Correct. (Called unconditionally every frame, which is cheap and harmless.)
- **Breath not double-stepped** — the kite branch steps it once (`controller.ts:115`) and the trailing ground-regen block keys on `state.mode === 'ground' && next.mode === 'ground'` (`controller.ts:140`), so deploy, stow and touchdown frames each step breath exactly once. `groundStep` does not touch breath. Correct, and this is the subtle one the ledger says was hand-verified — it holds.
- **Shrine bonus applied once per shrine** — `collected.reduce(…)` over the newly-collected ids (`main.ts:103-106`), seeded from the current player breath/max. Correct.

The composition is right. B1 is not an ordering error; it is `pullInForTerrain` answering a different question than the caller is asking.

---

## E. Spec fidelity

The delivered branch matches the spec's major sections well. The flight model, the derived angle of attack, camera-relative steering with an airspeed-limited turn rate, the breath meter with grounded regen multiplier, camera-leads-in-flight versus character-leads-on-ground, the eight-island sequencing, air shrines at +10% of base each, `localStorage` persistence, the WebGL fallback, and the CI→Pages delivery path are all present and behave as described.

### The plan's four declared deviations — all still accurate, three still justified

1. **Ability registry not built.** Still accurate; the decision is still right; **the stated justification is wrong.** See D2. Keep the decision, fix the reasoning.
2. **`BASE_FOV` lives in `fx/mapping.ts`.** Accurate and justified — `renderer.ts:5` imports it, one definition, both consumers.
3. **Wind audio synthesised, not a file.** Accurate and justified — `fx/audio.ts` builds filtered white noise, no asset, no licence question.
4. **Level validation always throws.** Accurate and justified — `buildWorld` throws, `main.ts:30-34` catches into the visible fallback. Never blanks the screen, which was the spec's actual guiding rule.

### Gaps the spec promises and the branch does not deliver — none of them declared as deviations

- **E1. `world/props.ts` and per-island prop scattering.** In the spec's module layout and its "Environment props come from CC0 low-poly packs" art section. No module, no props. (The absence of binary assets is out of scope; the absent *code module* is a spec gap that the deviation list does not cover.)
- **E2. `fx/wind.ts` — air trails and speed streaks.** The spec's Presentation section names three speed effects: wind audio, "ribbon trails from the kite tips above a speed threshold", and the FOV kick. Two shipped. The trails did not, and their mapping function (`trailOpacityForSpeed`, `TRAIL_SPEED_THRESHOLD`) is present, tested and unused. The plan's self-review coverage table nevertheless claims "Presentation, camera profiles, wind, trails, FOV kick | 15, 19" — that row is wrong.
- **E3. The non-finite-velocity error-handling row is implemented much more heavily than sanctioned.** The spec's table says: "Non-finite velocity in flight integration → Reset velocity to the last known good value and log." The implementation respawns the player to the last island touched and resets mode to ground (`controller.ts:32-69`). That is a teleport, not a velocity restore, and it is a materially different player experience. The safety net itself is excellent work — Task 12's two fix rounds hardened it well — but the behavioural change is undeclared. Either amend the spec row or soften the response.
- **E4. No stagger animation on a fast landing.** The spec says landing above the threshold "causes a stagger animation with no damage." Momentum retention is implemented (`controller.ts:129-133`, 0.3 factor); `AnimationName` has no `'stagger'` member. Partially moot with no real model, but the animation vocabulary does not reserve a slot for it.
- **E5. `InputState`'s shape differs from the spec's.** Spec: `{ lookDirection, thrust, flare, bank, toggleKite }`. Actual: `{ lookDirection, forward, strafe, sprint, actionPressed }`. The actual shape is *better* — it is what makes the spec's own "the two modes share the same bindings with mode-appropriate meanings" claim true in code — but the spec's load-bearing-interfaces section still shows the old shape, and that section is exactly where a future implementer will look.
- **E6. The lift formula in the spec is stale.** Spec: "Lift, proportional to `v² · cos(angleOfAttack)`". Implementation: `sin(2·aoa)`, documented and reasoned at `flight.ts:56-61`. The implementation is right and the spec text cannot produce the stall behaviour the spec itself describes two paragraphs later. Update the spec.
- **E7. `Level.spawn` shape.** Spec: `{ island: string; offset: Vec3 }`. Actual: `{ islandId, offset }` with `offset` unread (D3).

### Spec self-consistency after the two amendments — one residual contradiction

The camera-relative-controls amendment is clean and consistent throughout. The dive-climb amendment is **not fully propagated**:

- `design.md:175-178` (amended): "A zoom climb is net-lossy, and this is deliberate… Gliding is therefore a way to spend height on distance and on brief bursts of reach, **never a way to gain height for free**." And `:180`: "**Thrust is the only source of net altitude.**"
- `design.md:233` (not amended): "4. A high spire reachable **only by chaining dive-and-climb cycles**, as the skill test."

Chaining net-lossy cycles cannot gain height, so as written the spire is unreachable by its own stated route. The level data already knows better — `archipelago.ts:17` comments "spire: highest. Needs a dive, a zoom climb, **and thrust** together." Line 233 is the stale text; bring it in line with the level's own comment. (Whether the spire is actually reachable with skill is a human's call and out of scope; the internal contradiction is not.)

### Present but not sanctioned by the spec

- **The `rest` island.** The spec's sequence is starting island + a ring + two thrust islands + spire. `ARCHIPELAGO` adds `rest` at y=40 as "a mid-height waypoint for recovering breath on a long crossing." Sensible and documented in the level file, but it is a ninth design element in an eight-island spec and no spec text covers it. Low stakes; mention it in the spec so the next author does not delete it as a mistake.
- **Waterfalls** are a mid-execution user request, properly scoped as Task 21 and appended to the plan, but the design spec never gained a section for them. Worth a paragraph so the spec stays the source of truth.

---

## F. Unvalidated constants

Ranked by what actually goes wrong. Note that F1 and F3 both interact with the tuning lap that is about to happen, which makes them worth reading *before* that lap rather than after.

**F1. `MathUtils.clamp(effectiveAoa, -1.2, 1.2)` — `flight.ts:79`. Load-bearing, unvalidated, and actively wrong. Fix before merge (this is B2).**

Where 1.2 rad came from is unrecorded. What it does: lift stops decaying past 68.75° aoa and plateaus at 96% of peak through 90° and beyond, which contradicts both the module's own comment and the spec's stall story, and it is the root cause of the backwards/sideways glide in B2. π/2 is the principled bound — lift reaches exactly zero broadside and never reverses — and it is not an eyeballed number. Changing it alters the zoom climb, so it belongs with the human's tuning pass rather than as a silent patch.

**F2. `worldFloorY`'s `height * 2` depth bound — `level.ts:60`. Load-bearing for future levels only. Fix now: it is a one-line derivation.**

`ROUGHNESS` displaces vertices *before* `BOTTOM_STRETCH` applies, so an island actually reaches `BOTTOM_STRETCH * (1 + ROUGHNESS) = 1.9 × 1.28 = 2.432 × height` below its position, not `2 × height` — the validation understates real depth by 17.6%. For `ARCHIPELAGO` it is harmless: the bound computes −154, real geometry reaches about −163.5, and `worldFloorY = −600` clears both by ~436 units. But it is not a safe general bound, and the failure mode for a future hand-authored level is nasty and confusing: validation passes, and the player falls *through* an island's lower spike into the void because the respawn floor sits above the geometry. Do not hardcode 2.5 — export the shaping constants from `island.ts` and derive the multiplier, so the bound cannot drift away from the geometry that produces it. This is the cheapest high-value fix in the whole review.

**F3. `LANDING_PROBE = 2.5` — `controller.ts:20`. Load-bearing, unvalidated, and the tuning lap can break it. Check before tuning, not necessarily before merge.**

Kite landing is detected by a downward raycast of 2.5 m from the post-integration position. It is safe with the shipped config, but the margin is 1.6×, and the plan's own tuning table points straight at the constant that eats it. Measured maximum vertical travel per 1/60 s step, from 30 s dives:

| config | max vertical speed | travel per step | vs 2.5 m probe |
| --- | --- | --- | --- |
| shipped, no thrust | 66.3 m/s | 1.10 m | ok |
| shipped, thrust held | 96.1 m/s | 1.60 m | ok (1.6× margin) |
| `dragCoeff` 0.003 | 117.6 m/s | 1.96 m | ok |
| `dragCoeff` 0.002 | 144.1 m/s | 2.40 m | **96% of the probe** |
| `dragCoeff` 0.002 + `thrustAccel` 45 | 179.2 m/s | 2.99 m | **tunnels straight through islands** |

The plan's tuning table (plan line 4827) says: "Sinks too fast while gliding → raise `liftCoeff`, or **lower `dragCoeff`**." Following that advice by a factor of two puts landing detection at the boundary; combining it with more thrust breaks it, and the player flies through the ground with no test failing anywhere. Fix by deriving the probe from motion rather than pinning it — `Math.max(LANDING_PROBE, Math.abs(velocity.y) * dt * 1.5)` — or, at minimum, record the constraint in the tuning table so the human knows the coupling exists. Deriving it is better; the table entry will be forgotten.

**F4. `jumpSpeed² / (2 · gravity) > snapDistance` — `config.ts:44-51`. Latent, unenforced, tuning-lap-adjacent.**

Recorded in `progress.md` for Task 11 and **missing from the triage list**. Current defaults give 2.025 vs 1.2, so it holds with a 1.7× margin. Violate it — lower `jumpSpeed` below about 6.9, or raise `snapDistance` past 2.0 — and jumps get visually squashed by the ground snap: the player presses Space, rises, and is immediately re-snapped. `validateGroundConfig` does not exist, so nothing catches it. One assertion in `validateFlightConfig`'s ground counterpart would.

**F5. `DEFAULT_FLIGHT_CONFIG`'s tuning coefficients — `config.ts:4-22`. Load-bearing by definition; validated enough for now.**

The header comment says "Validated by prototype measurement — see the plan's tuning table," and the plan reports that the flight tests encode measured behaviour. That is a real basis, and re-deriving these constants is precisely the tuning lap the human owns (Task 20 step 5). Two observations for that lap rather than for the merge gate: `stallSpeed = 8` against a measured unpowered terminal speed of 66 m/s means stall is only reachable in a sustained hard climb, which is worth confirming is intended; and the energy bound of `< 0.35` (Group D item 21) should be re-tightened against a real measured figure once one exists — I measured 10.19% over a 5 s glide from a level 40 m/s cruise, versus the spec's 4.3% prototype claim under different initial conditions.

**F6. Constants I checked and found comfortably safe — no action.** `PROBE_MARGIN = 200` and `probeHeight * 2 + PROBE_MARGIN` in `terrain-query.ts` (reach to y ≈ −927 against a lowest geometry of about −163: ~764 units of margin); `COLLECT_RADIUS = 6` (at the maximum 96 m/s the player is inside a shrine's sphere for ~7 consecutive steps, so collection cannot be skipped); `eyeProbeHeight = 2` + `snapDistance = 1.2` against `runSpeed = 13` (0.22 m of drop per step on a 45° slope, well inside the snap); `FOG_FAR = 2200` as the camera far plane against a ~600-unit archipelago; `FIXED_DT` with `MAX_STEPS_PER_FRAME = 5`; and `RIM_INSETS`, which Task 21 already hardened from a single fragile value into a sweep after a reviewer built the real geometry and measured a 14–25% per-island miss rate.

---

## G. What is genuinely good here

Specific things worth preserving as this code changes:

- **`TerrainQuery` is a real seam and it held.** Two methods, `types.ts:38`, and neither `flight.ts` nor `ground-move.ts` knows anything about how islands are represented. Every consumer — movement, camera, shrine placement, spawn resolution, waterfall anchoring — goes through it. This is the load-bearing interface the spec claimed it would be, and it is the thing most worth defending. When B1's proper fix arrives, add a general ray method *to this interface* rather than reaching around it.
- **`flightStep` is genuinely pure and genuinely tunable.** It never mutates its arguments (with non-mutation tests to prove it), takes all tuning through `FlightConfig`, and returns a fresh result. That purity is why I could characterise B2 quantitatively in minutes — sweep the input space, simulate, read the numbers — instead of guessing. Purity in the simulation core paid for itself in this review alone.
- **The non-finite safety net in `controller.ts:24-69`.** Three guarded call sites, a re-validating `safeRespawn`, `maxBreath` included in the guard so it cannot be laundered into `breath` through `respawn`, and a self-constructed finite fallback of last resort. Task 12 took two rounds to get here and the result is genuinely hard to corrupt. The `isFinitePlayer(next)` guard on the way out is the kind of thing that gets dropped as redundant — it is not.
- **Everything that touches the outside world refuses to crash.** `loadSave`/`writeSave` never throw; `hasWebGL` is try/caught; `createWindAudio.start()` degrades to silence; `loadGLTF` resolves `null`; `buildWorld`'s throw is caught into a visible message. The spec's guiding rule — never a blank screen without explanation — is actually implemented, not merely stated.
- **Determinism was taken seriously.** `mulberry32` + seeded simplex, `noiseSeed` per island, procedurally generated waterfall textures. No binary assets, no licence questions, reproducible geometry, and a level file that is readable and hand-authored exactly as the spec intended.
- **`docs`-quality comments that explain *why*.** `flight.ts:7-16` on why `kiteUp` is derived from a cross product with world up rather than with velocity; `flight.ts:86-90` on why the fallback must be perpendicular; `ground-move.ts:38` on why the snap only runs while descending; `loop.ts:23-24` on what the accumulator clamp prevents. These are the comments that survive refactors because they record decisions, not mechanics. (Two of them are now slightly overstated — see A1 — but the habit is right.)
- **The execution ledger is exemplary.** `progress.md` records not just outcomes but reasoning, human rulings, reviewer counter-assessments (Task 15's controller downgrading a reviewer's Critical, with the argument), plan defects distinguished from implementer errors (Tasks 12, 14, 20, 21), and forward-looking notes that later tasks actually acted on. Task 21's reviewer building the real geometry and sweeping 36 angles per island to find that `RIM_INSET = 0.88` sat within 0.02 of a failure boundary is exactly the standard the two Section B findings needed applied to the camera and the aoa clamp — and it is the standard this project set for itself.
