# Jump Forgiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coyote time and a jump buffer, so a press that straddles a ledge or arrives just before a landing is honoured instead of discarded.

**Architecture:** Two seconds-remaining counters on `PlayerState`, two windows in `GroundConfig`. `stepJump` consumes them and reports what happened; `groundStep` does the bookkeeping against the freshly computed `grounded`, the same split it already uses for `airJumpsUsed`.

**Tech Stack:** TypeScript 7.0.2, three.js 0.185.1, Vitest 4.1.10 (node environment).

## Global Constraints

- **Exact values:** `coyoteSeconds: 0.1`, `jumpBufferSeconds: 0.1`. Both are 6 fixed steps at 60 Hz (`FIXED_DT = 1/60`).
- **Test environment is node** (`vitest.config.ts`). Run tests with `npx vitest run <path> --reporter=verbose` — `--reporter=verbose` is required to see `console.log`. Full suite: `npx vitest run`.
- **Typecheck is two passes:** `npm run typecheck` runs `tsconfig.json` then `tsconfig.test.json`. `noUncheckedIndexedAccess` is on, so indexed access is `T | undefined`.
- **No `validateGroundConfig` is to be created.** A window of zero or below must simply disable that one piece of forgiveness and leave today's behaviour standing. Two tests assert that.
- **Comments explain *why*, not what.** Match the register of `src/player/jump.ts` and `src/player/ground-move.ts`, both of which carry the reasoning behind each rule.
- **Every measured number in a comment must also be asserted somewhere.** A number in a comment and nowhere else is a plan failure. This repo has shipped wrong numbers as prose above code nobody re-derived — the scooter's turn times were wrong by an order of magnitude in exactly that way.
- **After writing a test, neutralise the feature and confirm the test goes red.** Make the change, run the suite, watch it redden, revert. This project has recorded twelve assertions across five cycles that could not fail; every one was found by making the change and none by reading the assertion and judging it adequate.
- **Never commit to `main`.** Work on `jump-forgiveness`, which exists and is checked out.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/types.ts` | **Modify.** `GroundConfig` gains two windows; `PlayerState` gains two counters. |
| `src/core/config.ts` | **Modify.** `DEFAULT_GROUND_CONFIG` gains the two values. |
| `src/player/state.ts` | **Modify.** Zero both in `createPlayerState`. |
| `src/player/controller.ts` | **Modify.** Zero both at three reset sites; add both to `isFinitePlayer`. |
| `src/player/jump.ts` | **Modify.** `JumpStep` gains `jumpBuffer` and `jumped`; `stepJump` consumes both counters. |
| `src/player/jump.test.ts` | **Modify.** The unit battery. |
| `src/player/ground-move.ts` | **Modify.** Bookkeeping for both counters against the computed `grounded`. |
| `src/player/ground-move.test.ts` | **Modify.** The integration battery, including the ground-charge carry. |
| `README.md`, `docs/HANDOFF.md` | **Modify.** Record the cycle. |

---

### Task 1: The state and the windows

Mechanical and behaviour-neutral: after this task the counters exist, are zeroed everywhere a player is built or reset, and nothing reads them. The suite must stay green with no test changes, which is the point — if a test changes here, something was not behaviour-neutral.

**Files:**
- Modify: `src/core/types.ts`, `src/core/config.ts`, `src/player/state.ts`, `src/player/controller.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GroundConfig.coyoteSeconds: number`, `GroundConfig.jumpBufferSeconds: number`, `PlayerState.coyoteTime: number`, `PlayerState.jumpBuffer: number`.

- [ ] **Step 1: Add the config values**

In `src/core/types.ts`, inside `GroundConfig`, beside the other jump values:

```ts
  /**
   * Grace after walking off an edge during which a jump still counts as a ground jump.
   *
   * Note the interaction with `chargeThresholdSeconds`: at 0.1 against a threshold of 0.2,
   * this window cannot let a charge *complete* in the air. What it carries is a charge
   * already earned on the ground.
   */
  coyoteSeconds: number
  /** How long a jump press is remembered across a landing. */
  jumpBufferSeconds: number
```

In `src/core/config.ts`, inside `DEFAULT_GROUND_CONFIG`, immediately after `chargeWalkFactor`:

```ts
  // Both are 6 fixed steps at 60 Hz -- the common platformer standard, and argued
  // guesses rather than a measurement of this game. Measured before they existed: a
  // press on the last grounded frame released one frame later produced no jump at all,
  // and a press released up to 8 frames before a landing produced nothing on landing.
  coyoteSeconds: 0.1,
  jumpBufferSeconds: 0.1,
```

- [ ] **Step 2: Add the state fields**

In `src/core/types.ts`, inside `PlayerState`, beside `chargeTime`:

```ts
  /** Seconds of grace left to still jump as though grounded. Pinned while grounded. */
  coyoteTime: number
  /** Seconds left on a jump press remembered across a landing. */
  jumpBuffer: number
```

- [ ] **Step 3: Run typecheck to see exactly which sites must be updated**

Run: `npm run typecheck`

Expected: FAIL, with errors naming every object literal that builds a `PlayerState` without the new fields. **Use that list rather than the one below as the authority** — the line numbers below were correct when this plan was written and the compiler is correct now. Report any site the compiler names that this plan does not.

Expected sites: `src/player/state.ts:41`, `src/player/controller.ts:104`, `:132`, `:274`.

- [ ] **Step 4: Zero both at every construction and reset site**

At each site the compiler named, add `coyoteTime: 0, jumpBuffer: 0,` beside the existing `chargeTime: 0`.

Zero rather than `coyoteSeconds` at all four, including the ones that place a player on the ground: the very next `groundStep` pins the window while grounded, so seeding it buys nothing, and a respawned player holding a window from before the respawn is the kind of state that outlives its reason.

- [ ] **Step 5: Add both to `isFinitePlayer`**

In `src/player/controller.ts`, extend the `nums` array at roughly line 69:

```ts
    s.breath, s.maxBreath, s.airJumpsUsed, s.chargeTime, s.coyoteTime, s.jumpBuffer,
```

This is the check that stops a NaN spreading. Both counters are fed by `dt` arithmetic, so both can carry one.

- [ ] **Step 6: Confirm the suite is green with no test changes**

Run: `npx vitest run && npm run typecheck`

Expected: both clean, and **no test file edited in this task.** If a test needed changing, say so in the report and explain what was not behaviour-neutral — that is a finding, not a chore.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/config.ts src/player/state.ts src/player/controller.ts
git commit -m "Two counters and two windows for jump forgiveness"
```

---

### Task 2: The forgiveness itself

**Files:**
- Modify: `src/player/jump.ts`, `src/player/ground-move.ts`
- Test: `src/player/jump.test.ts`, `src/player/ground-move.test.ts`
- Modify: `README.md`, `docs/HANDOFF.md`

**Interfaces:**
- Consumes: `GroundConfig.coyoteSeconds`, `GroundConfig.jumpBufferSeconds`, `PlayerState.coyoteTime`, `PlayerState.jumpBuffer` (Task 1).
- Produces: `JumpStep` gains `jumpBuffer: number` and `jumped: boolean`.

- [ ] **Step 1: Write the failing unit tests**

Add to `src/player/jump.test.ts`. Read the file first and match its existing fixture helpers rather than introducing new ones.

The cases, each with the change that must break it named in a comment:

1. **A press on the last grounded frame, released one frame later while airborne inside the window, fires a ground jump.** Assert against `c.jumpSpeed` exactly (9), not "greater than zero" — one frame of an air jump would also be positive, and the air jump's speed is *also* 9, so additionally assert `airJumpsUsed` is unchanged. Both halves are needed: the speed alone cannot tell a coyote jump from an air jump at this tuning.
2. **The same press outside the window** (`coyoteTime: 0`) with an air jump available spends the air jump — `airJumpsUsed` becomes 1.
3. **The same press outside the window with no air jump left** returns `jumpVelocityY: null` and `jumpBuffer` equal to `c.jumpBufferSeconds`.
4. **A grounded step with `jumpBuffer > 0` fires `c.jumpSpeed` immediately and returns `jumpBuffer: 0`**, with no press in the input at all — the buffer is the whole trigger.
5. **The buffered jump is uncharged even when the key is still held.** Grounded, `jumpBuffer > 0`, `actionHeld: true`: still exactly `c.jumpSpeed`. Consistent with `jump.ts:60`, which already refuses to charge from a key carried across a landing.
6. **`jumped` is true exactly when `jumpVelocityY !== null`**, across the cases above. The two are the same fact and `groundStep` reads only one of them.

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx vitest run src/player/jump.test.ts --reporter=verbose`

Expected: FAIL — `jumpBuffer` and `jumped` do not exist on `JumpStep`, and the coyote branch does not exist.

- [ ] **Step 3: Implement `stepJump`**

In `src/player/jump.ts`, extend `JumpStep`:

```ts
  /** Seconds of buffered press to carry, or 0. */
  jumpBuffer: number
  /**
   * Whether a jump fired this frame.
   *
   * Returned rather than left for the caller to derive from `jumpVelocityY !== null`:
   * `groundStep` needs it to close the coyote window, and the same fact computed in two
   * places is two places to keep in step.
   */
  jumped: boolean
```

Rewrite the airborne branch so it reads, in order: the coyote window, then the air jump, then the buffer. The grounded branch gains the buffer check ahead of everything else.

The rules, which the implementation must realise but not necessarily in this shape:

- Airborne with `state.coyoteTime > 0`: track `chargeTime` exactly as the grounded branch does, and on `actionReleased` with `chargeTime > 0` return `releaseSpeed(chargeTime, c)` with `airJumpsUsed` **unchanged**.
- Airborne otherwise, fresh press, `airJumpsUsed < c.maxAirJumps`: the air jump, as today.
- Airborne otherwise, fresh press, no air jump: `jumpVelocityY: null`, `jumpBuffer: c.jumpBufferSeconds`.
- Grounded with `state.jumpBuffer > 0`: `jumpVelocityY: c.jumpSpeed`, `jumpBuffer: 0`, `chargeTime: 0`.
- Every other return carries `state.jumpBuffer` forward unchanged so `groundStep` can decay it, and sets `jumped` correctly.

Keep the existing comments; they explain rules this task does not change.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx vitest run src/player/jump.test.ts --reporter=verbose`

Expected: PASS.

- [ ] **Step 5: Write the failing integration tests**

Add to `src/player/ground-move.test.ts`, using its existing `flatGround` and `input` helpers and adding a ledge fake if none fits — flat ground at `y = 0` for `x < 0` and open void for `x >= 0` works, and its `raycast` must answer only downward casts, scaled by the direction's length, exactly as the existing fakes in that file do and for the reason their comments give.

1. **The ground-charge carry — the discriminating case.** Hold Space while walking for 0.5 s on the ground, walk off the ledge, release 3 frames later. **Measure the resulting vertical speed with a `console.log` first, then assert the measured figure.** The spec predicts about 13.03 m/s from `9 + (20 - 9) × (0.55 / 1.5)`; if the real value differs, the measurement wins and the spec is wrong — say so in the report. Assert the exact measured number, not a range.
2. **All five buffer timings as a table** — 1, 2, 3, 5 and 8 frames before landing, air jump already spent, press released mid-air — each producing a jump on the landing frame. A table, so a fix that works at 1 frame and not at 8 cannot pass.
3. **A press beyond the buffer window is still discarded.** Pick a timing clearly past `jumpBufferSeconds` (12 frames is 0.2 s, twice the window) and assert no jump on landing. Without this the buffer could be unbounded and every other case would still pass.
4. **Coyote does not grant a third jump.** Ground jump, air jump, then a third press: no jump. Assert on the vertical speed being negative, not merely "not equal to jumpSpeed".
5. **A normal ground jump zeroes the window.** Check `coyoteTime` on the returned state directly, on the frame the jump fires. Case 4 would also pass if the air jump were what ran out, so this is the one that isolates the rule.
6. **Landing re-arms the window**, so forgiveness is not once per life: after a full jump and landing, `coyoteTime` is back to `c.coyoteSeconds`.
7. **The two windows are independent.** With `coyoteSeconds: 0` the buffer still works; with `jumpBufferSeconds: 0` coyote still works. This is what the "safe degradation, so no validator" decision rests on, so it is asserted rather than argued.

- [ ] **Step 6: Run the integration tests to verify they fail**

Run: `npx vitest run src/player/ground-move.test.ts --reporter=verbose`

Expected: FAIL — `groundStep` does no bookkeeping yet, so the counters never move.

- [ ] **Step 7: Implement the bookkeeping in `groundStep`**

In `src/player/ground-move.ts`'s returned object, beside the existing `airJumpsUsed: grounded ? 0 : jump.airJumpsUsed`:

```ts
    // Pinned while grounded, decaying while airborne, and zeroed by any jump. That one
    // rule is the whole of coyote time: it needs no "did I leave the ground this frame"
    // comparison, because the last grounded frame already left the window full -- and
    // zeroing it on a jump is what stops a ground jump being followed by a second one,
    // without which every jump would be a double jump for its first six frames.
    coyoteTime: jump.jumped ? 0 : grounded ? c.coyoteSeconds : Math.max(0, state.coyoteTime - dt),
    jumpBuffer: jump.jumped ? 0 : Math.max(0, jump.jumpBuffer - dt),
```

Both are written here rather than in `stepJump` because `stepJump` runs before the ground probe and cannot know the authoritative `grounded`. That is the same split this function already uses for `airJumpsUsed`.

Note the decay reads `jump.jumpBuffer`, not `state.jumpBuffer`: `stepJump` may have just set it this frame, and a buffer set and then decayed in the same frame is one frame shorter than the window says.

- [ ] **Step 8: Run the integration tests to verify they pass**

Run: `npx vitest run src/player/ground-move.test.ts --reporter=verbose`

Expected: PASS.

- [ ] **Step 9: Neutralise each rule and confirm the suite reddens**

Required, one at a time: make the edit, run `npx vitest run src/player/jump.test.ts src/player/ground-move.test.ts`, confirm **FAIL**, revert.

1. `coyoteSeconds: 0` in `DEFAULT_GROUND_CONFIG`
2. `jumpBufferSeconds: 0` in `DEFAULT_GROUND_CONFIG`
3. `coyoteTime: grounded ? c.coyoteSeconds : Math.max(0, state.coyoteTime - dt)` — drop the `jump.jumped ? 0 :` guard, which is the third-jump bug
4. In the coyote branch, ignore `chargeTime` and always return `c.jumpSpeed` — this is the ground-charge carry
5. In the coyote branch, also increment `airJumpsUsed` — a coyote jump must not cost the air jump
6. `Math.max(0, state.jumpBuffer - dt)` instead of `jump.jumpBuffer` in the decay — the off-by-one-frame case

Record a table of all six with the catching test named for each. **A neutralisation that leaves the suite green is a finding to report, not a formality** — replace the assertion, then re-run to confirm the replacement reddens.

- [ ] **Step 10: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`

- [ ] **Step 11: Update the README**

The controls table needs no new row — `Space` is already documented and forgiveness is not a new control. In the ground-movement prose paragraph that begins "On the ground, momentum is the resource", add a sentence that a jump is forgiven slightly at both ends: pressed just after an edge it still counts, and pressed just before a landing it waits. Do **not** state the window lengths in the README; they are tuning values and belong in the config with the assertions.

- [ ] **Step 12: Update the handoff**

In `docs/HANDOFF.md`'s "What has been built" section, record: the two measurements that motivated the cycle (`-0.667` off the ledge, five buffer timings all discarded, 2.09 m of double-jump height at stake), the one-rule coyote design and why it needs no edge detection, the `chargeThresholdSeconds` 0.2 versus 0.1 window interaction and what it means the window can and cannot do, the accepted edge (press inside the window, release outside, spends the air jump), and that nothing was played.

- [ ] **Step 13: Commit**

```bash
git add src/player/jump.ts src/player/jump.test.ts src/player/ground-move.ts src/player/ground-move.test.ts README.md docs/HANDOFF.md
git commit -m "Forgive a jump at both ends"
```

---

## Self-review notes

**Spec coverage.** Config and state → Task 1. `stepJump`'s branches, `groundStep`'s bookkeeping, and all eight of the spec's testing bullets → Task 2. The spec's "out of scope" list adds no tasks by construction. The spec's "no validator" decision is enforced by Task 2's independence test rather than by a code change, which is the only way an absence can be tested.

**Task 1 is deliberately behaviour-neutral and its test instruction is "change no tests".** That is the check: adding two zeroed fields nothing reads cannot alter behaviour, so a test that needs editing means something else happened.

**Where this plan expects to be wrong.** Step 5's case 1 predicts 13.03 m/s from the spec's arithmetic. The plan tells the implementer to measure first and assert the measurement, and to report a discrepancy rather than reconcile it silently — because a predicted number asserted from reasoning is precisely how this repo shipped the scooter's turn times wrong by an order of magnitude.
