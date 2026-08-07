# The Feel Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four independent movement defects found by measurement — the scooter's inert turn trade, `Shift` meaning three things, thrust buzzing at empty breath, and the dash trail being drawn longer than the dash travels.

**Architecture:** Each is a small change in one layer. The scooter's `authority` moves from the strafe axis to the easing rate, which is what actually governs turning. The scooter toggle moves off `Shift` onto `Z`. `canBend` gains a floor to re-engage at. The dash trail is sized from the constants the simulation obeys, and the two dead values that invited the mismatch are deleted.

**Tech Stack:** TypeScript 7.0.2, three.js 0.185.1, Vitest 4.1.10 (node environment).

## Global Constraints

- Run `npm run typecheck` after every code change: two passes, `tsconfig.json` then `tsconfig.test.json`.
- `noUncheckedIndexedAccess` is on.
- Config is injected, never imported, by modules under `src/player/`, `src/camera/`, `src/world/`, `src/fx/`. Test files may import it.
- Pure functions never mutate arguments.
- Exact values: the scooter's key is **`KeyZ`**; `bendFloor` is **15**. Nothing else in `DEFAULT_GROUND_CONFIG` or `DEFAULT_FLIGHT_CONFIG` changes.
- Comments explain *why*, in full English sentences, at this codebase's high density.
- Commit messages and documentation are normal full English prose.
- Never commit to `main`. Work stays on the current branch, `feel-batch`.

### On falsifiable tests — read before writing any test

The two previous cycles on this repo shipped **eight** assertions that could not fail. Every one had the same shape: **asserting a relationship that both the correct and the broken implementation satisfy.** Examples that shipped: `Math.abs(y) > 0.1` (holds for either sign), `cross(a,b)·b == 0` (an identity for any implementation), `position.y > worldFloorY` (a respawn puts it back above ground), and `z > 0.5` where both outcomes were 5 and 6.76.

So for **every** test here: name the change it would catch, make that change, run it, confirm it fails, restore. If it stays green, **the test is wrong, not the claim** — fix the test and report that you did.

Prefer asserting a **measured quantity or a direction** over a relationship. Where a relationship is the only honest assertion, say in a comment what it does *not* catch.

---

### Task 1: The scooter gets its own key, and a turn trade that exists

**Files:**
- Modify: `src/player/ground-move.ts` (`desiredVelocity` loses `authority`; `easeHorizontal` gains it)
- Modify: `src/core/input.ts:84-86` (the keydown that sets `scooterPressed`)
- Modify: `src/ui/guide/actions.ts` (the air scooter entry's `key`)
- Modify: `README.md:17` (the controls table row)
- Test: `src/player/ground-move.test.ts`, `src/core/input.test.ts` if one exists

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `desiredVelocity(input: InputState, c: GroundConfig, speedScale?: number): Vector3` — the fourth parameter is **removed**
  - `easeHorizontal(current: Vector3, desired: Vector3, dt: number, c: GroundConfig, authority?: number): Vector3`

**Why this is a defect.** `scooterTurnAuthority` is the design document's "doubles speed and halves steering", and `groundStep` fed it into `desiredVelocity`, where it scaled the strafe axis only. On foot the heading comes from the camera via `horizontalForward(input.lookDirection)`, so turning is done with the mouse and scaling one axis before `move.normalize()` barely rotates the result. Measured: a 90-degree turn with W held while the camera swings takes **0.45 s on foot, 0.45 s at charge 0, and 0.45 s at charge 1**. Identical. What governs turning is `groundResponse` 7, which never saw `authority`.

- [ ] **Step 1: Write the failing test for the turn trade**

In `src/player/ground-move.test.ts`. Read the file for its existing `input()` and `player()` helpers and the `G` alias for `DEFAULT_GROUND_CONFIG`.

```ts
describe('the scooter trades turning for speed', () => {
  /** Seconds for velocity to come within 0.05 rad of a 90-degree change of desired heading. */
  const turnTime = (authority: number) => {
    const north = input({ forward: 1, sprint: true, lookDirection: new Vector3(0, 0, -1) })
    const east = input({ forward: 1, sprint: true, lookDirection: new Vector3(1, 0, 0) })
    let v = desiredVelocity(north, G)
    const target = desiredVelocity(east, G)
    for (let frame = 0; frame < 1200; frame++) {
      if (v.angleTo(target) < 0.05) return frame / 60
      v = easeHorizontal(v, target, 1 / 60, G, authority)
    }
    return Infinity
  }

  it('turns slower on a scooter than on foot', () => {
    // The measurement that made this a defect: before the fix these were 0.45, 0.45 and
    // 0.45 -- identical -- because authority scaled the strafe axis, which the camera-
    // relative heading barely uses, instead of the easing rate that actually turns you.
    expect(turnTime(scooterTurnAuthority(0, G))).toBeGreaterThan(turnTime(1) * 1.5)
  })

  it('turns slower still as the accumulator fills', () => {
    expect(turnTime(scooterTurnAuthority(1, G)))
      .toBeGreaterThan(turnTime(scooterTurnAuthority(0, G)))
  })

  it('leaves an on-foot turn exactly as it was', () => {
    // authority defaults to 1, so nothing off a scooter changes. If this moves, the fix
    // has leaked into ordinary running.
    expect(turnTime(1)).toBeCloseTo(0.45, 2)
  })
})
```

The third assertion pins the literal 0.45 deliberately — it is the measured on-foot figure and the whole point is that it must not move. If it comes out different, **report the number rather than editing the assertion**: it means the fix changed on-foot behaviour, which it must not.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/player/ground-move.test.ts`
Expected: FAIL — `easeHorizontal` takes four arguments, and the first two assertions fail once it takes five because nothing yet varies with `authority`.

- [ ] **Step 3: Move authority from the axis to the easing**

In `src/player/ground-move.ts`, drop the fourth parameter from `desiredVelocity` and the `* authority` from its `addScaledVector`, updating its docblock: `speedScale` still carries the scooter's speed multiplier, and steering is no longer its business.

Then `easeHorizontal`:

```ts
/**
 * Ease horizontal velocity towards what the player asked for.
 *
 * The design doc's air-assisted run has soft acceleration and slides on stops, so ground
 * speed chases the stick rather than snapping to it. Exponential easing is used so the
 * result is independent of frame rate.
 *
 * `authority` is how much steering the mover keeps, 1 being full on-foot control. It scales
 * the response rate, because that is what actually turns you: the heading comes from the
 * camera, so a rider who kept full response would carve exactly as tightly as a runner no
 * matter what the accumulator said. It used to scale the strafe axis inside
 * `desiredVelocity` instead, which measured as no effect at all -- a 90-degree turn took
 * 0.45 seconds on foot, at charge 0 and at charge 1 alike.
 */
export function easeHorizontal(
  current: Vector3,
  desired: Vector3,
  dt: number,
  c: GroundConfig,
  authority = 1,
): Vector3 {
  const blend = 1 - Math.exp(-c.groundResponse * authority * dt)
  return new Vector3(
    current.x + (desired.x - current.x) * blend,
    0,
    current.z + (desired.z - current.z) * blend,
  )
}
```

In `groundStep`, `desired` no longer takes `authority` and `easeHorizontal` now does:

```ts
  const desired = desiredVelocity(input, c, speedScale).multiplyScalar(jump.walkFactor)
  // Eased rather than assigned, so the run leans into turns and slides on stops -- and at
  // reduced authority the lean becomes a genuine cost, which is the scooter's whole trade.
  const horizontal = easeHorizontal(state.velocity, desired, dt, c, authority)
```

- [ ] **Step 4: Run and record the real turn times**

Run: `npx vitest run src/player/ground-move.test.ts --reporter=verbose`

Add a temporary `console.log` of all three turn times, read them, and **put the measured figures in the describe block's comment**. Then remove the log. The spec predicted roughly 0.9 s and 1.8 s from the formula; report what they actually are.

- [ ] **Step 5: Move the scooter to `Z`**

In `src/core/input.ts`, the keydown handler currently sets `scooterPressed` for `ShiftLeft`/`ShiftRight`. Replace with `KeyZ`, and rewrite the comment: it explains that auto-repeat must not re-fire a toggle, which is still true, but the reason it mentioned Shift is gone. Record why the binding moved — `Shift` was simultaneously sprint, the scooter toggle and the glider's hover, so the key that summoned the scooter also changed its speed while still held: measured, cruise was 27.5 m/s with Shift held against 14.8 m/s released, at identical charge.

`Shift` keeps `sprint`, which `toInputState` reads from the held set, and that line does not change.

- [ ] **Step 6: Update the guide and the README together**

`src/ui/guide/actions.ts` — find the air scooter entry and change its `key` to `'Z'`. Its `detail` text should stop describing the sprint coupling and say what the key does now.

`README.md:17` — that row currently reads "`Shift` | Air scooter (tap to ride, tap to step off) — or hold to sprint instead, which also raises the scooter's speed | Hover — hold position in mid-air". Split it: a `Z` row for the scooter, and `Shift` for sprint on foot and hover in the glider.

There is a drift test comparing the action catalogue's keys against that table in both directions. It will fail if you change one and not the other — that is the test working. Run `npx vitest run src/ui/guide` and make it pass by making both correct, not by loosening the test.

- [ ] **Step 7: Test the binding**

Add to whichever suite covers `InputTracker` or `toInputState` — check whether `src/core/input.test.ts` exists first, and if not, put these in the file that already tests input:

```ts
it('rides the scooter on Z, not on Shift', () => {
  // Shift used to toggle the scooter as well as meaning sprint and hover, so the key that
  // summoned it also changed its speed while still held.
  expect(toInputState(new Set(['KeyZ']), NORTH, false).sprint).toBe(false)
  expect(toInputState(new Set(['ShiftLeft']), NORTH, false).sprint).toBe(true)
})
```

`scooterPressed` is an edge flag set by the `InputTracker`'s listener rather than derived in `toInputState`, so the honest unit test is that `Shift` still means sprint and `Z` does not. If the suite has a way to dispatch a real `keydown` at an `InputTracker`, prefer that and assert `scooterPressed` directly — that is the assertion with teeth.

- [ ] **Step 8: Run everything**

Run: `npm run typecheck && npm test`
Expected: clean and green. The `desiredVelocity` tests that passed a fourth argument need updating; check whether any of them was the only coverage of something else before deleting an assertion.

- [ ] **Step 9: Red-proof**

1. Revert `easeHorizontal` to ignore `authority`. Expected red: "turns slower on a scooter than on foot" and "turns slower still as the accumulator fills".
2. Change the `KeyZ` check back to `ShiftLeft`. Expected red: the guide drift test, and your binding test.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Give the scooter its own key and a turn trade that exists

Two defects in one move, both measured.

The trade did not exist. scooterTurnAuthority is the design document's
"doubles speed and halves steering", and groundStep fed it into
desiredVelocity, where it scaled the strafe axis only. On foot the heading
comes from the camera, so turning is done with the mouse and scaling one
axis before normalising barely rotates the result. A 90-degree turn took
0.45 seconds on foot, 0.45 at charge 0 and 0.45 at charge 1 -- identical.
The scooter doubled speed and cost nothing. Authority now scales
groundResponse, which is what actually turns you, and it no longer
touches the axis, so there is one mechanism rather than two half-working
ones.

Shift meant three things: sprint while held, the scooter toggle on
keydown, and hover in the glider. So the key that summoned the scooter
also changed its speed while still held -- measured at identical charge,
cruise was 27.5 m/s with Shift held against 14.8 released. The scooter
moves to Z. Shift keeps sprint and hover, which are the same idea in both
postures.

The README already described the tangle rather than hiding it, and the
guide panel's drift test enforces that the catalogue and that table agree,
so both had to move together.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Thrust stops buzzing at empty breath

**Files:**
- Modify: `src/player/breath.ts` (`canBend`)
- Modify: `src/core/types.ts` (`FlightConfig.bendFloor`)
- Modify: `src/core/config.ts` (`bendFloor: 15`, and `validateFlightConfig`)
- Modify: `src/player/controller.ts:220,223` (both `canBend` calls)
- Modify: `src/ui/guide/actions.ts:60` (`hasBreath` calls `canBend`)
- Test: `src/player/breath.test.ts`, `src/player/controller.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `canBend(s: BreathState, c: FlightConfig): boolean`, and `FlightConfig.bendFloor: number`.

**Why this is a defect.** `canBend` is `breath > 0` with no floor to re-engage at. At zero breath in the glider, regeneration adds 0.2 in a frame, thrust drains 0.3, and the bar oscillates around zero. Measured over 600 frames of holding W at empty breath: **thrust engaged on 300 of them.** A 50% duty cycle at 30 Hz — a buzz, not exhaustion.

- [ ] **Step 1: Write the failing test**

In `src/player/controller.test.ts`, because the defect is a duty cycle over time and only the controller produces one:

```ts
describe('an exhausted glider does not buzz', () => {
  /** Frames out of 600 on which thrust actually engaged, holding W from empty. */
  const engagedFrames = () => {
    let p = player({
      mode: 'glider', breath: 0, grounded: false,
      position: new Vector3(0, 300, 0), velocity: new Vector3(0, 0, -30),
    })
    let engaged = 0
    for (let frame = 0; frame < 600; frame++) {
      const before = p.breath
      p = controllerStep(p, input({ forward: 1 }), 1 / 60, deps(flatGround))
      // Breath failing to rise means the drain ran, which means thrust engaged.
      if (p.breath <= before) engaged++
    }
    return engaged
  }

  it('does not stutter thrust on and off at empty breath', () => {
    // Measured before the fix: 300 of 600 frames, a 50 percent duty cycle at 30 Hz.
    // A test asserting only "cannot bend at exactly 0" passes today and catches nothing.
    expect(engagedFrames()).toBe(0)
  })
})
```

And in `src/player/breath.test.ts`, replace the two existing `canBend` assertions (which pass `{ breath: 0 }` and `{ breath: 0.5 }`) with ones that exercise the floor:

```ts
it('cannot bend below the floor', () => {
  expect(canBend({ breath: F.bendFloor - 0.01, maxBreath: 100 }, F)).toBe(false)
})

it('can bend at exactly the floor', () => {
  expect(canBend({ breath: F.bendFloor, maxBreath: 100 }, F)).toBe(true)
})

it('the floor buys most of a second of thrust', () => {
  // The reason the number is 15 rather than something token: an exhausted player gets a
  // legible beat of thrust, then a beat of nothing, instead of a per-frame flicker.
  expect(F.bendFloor / F.breathDrainPerSecond).toBeGreaterThan(0.5)
})
```

`F` is the file's alias for `DEFAULT_FLIGHT_CONFIG`; add it if absent.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/player/controller.test.ts src/player/breath.test.ts`
Expected: FAIL — `canBend` takes one argument, and the duty-cycle test reports about 300.

- [ ] **Step 3: Add the floor**

In `src/core/types.ts`, add to `FlightConfig`:

```ts
  /**
   * Breath needed to start bending, as opposed to zero.
   *
   * Without a floor, an empty bar oscillates: regeneration adds a fraction, the drain takes
   * slightly more, and thrust flickers on and off every other frame -- measured at 300 of
   * 600 frames engaged, which reads as a buzz rather than as exhaustion.
   */
  bendFloor: number
```

In `src/player/breath.ts`:

```ts
/**
 * Any airbending needs breath in hand, not merely a non-zero bar.
 *
 * The floor is what stops an exhausted player buzzing. It converts the failure from a 30 Hz
 * flicker into a rhythm: at `bendFloor` 15 against `breathDrainPerSecond` 18 a player gets
 * 0.83 s of thrust, then 1.25 s of regeneration at 12/s to earn it back.
 *
 * Deliberately not true hysteresis. Remembering "was bending" would need a field on
 * PlayerState carried through every respawn and save path, which is a real cost for a
 * smaller improvement than the floor already buys.
 */
export function canBend(s: BreathState, c: FlightConfig): boolean {
  return s.breath >= c.bendFloor
}
```

In `src/core/config.ts`, add `bendFloor: 15` to `DEFAULT_FLIGHT_CONFIG` with a comment giving those two figures, and extend `validateFlightConfig`:

```ts
  if (!(c.bendFloor > 0) || !(c.bendFloor < c.baseMaxBreath)) {
    throw new Error(
      `FlightConfig.bendFloor (${c.bendFloor}) must sit strictly between 0 and ` +
      `baseMaxBreath (${c.baseMaxBreath}): at 0 there is no floor and at the ceiling the ` +
      'glider could never bend at all',
    )
  }
```

Add `bendFloor` to the `positive` key list in that function as well, or note in your report why it is covered by the check above instead.

- [ ] **Step 4: Update the three call sites**

`src/player/controller.ts:220,223` — `canBend(state, deps.flight)`.

`src/ui/guide/actions.ts:60` — `hasBreath` becomes `inGlider(ctx) && canBend(ctx.player, <the flight config>)`. Read how `ActionContext` is shaped: if it does not already carry a `FlightConfig`, it must, and `main.ts` must pass it. Check before assuming — the context already carries `ground` and `wave`, so there is a pattern to follow.

- [ ] **Step 5: Run and confirm the tests pass**

Run: `npx vitest run src/player/controller.test.ts src/player/breath.test.ts src/ui/guide`
Expected: PASS. The duty cycle should now be 0.

- [ ] **Step 6: Red-proof**

Revert `canBend` to `s.breath > 0`. Expected red: "does not stutter thrust on and off at empty breath" (back to about 300) and "cannot bend below the floor". Restore.

- [ ] **Step 7: Run everything and commit**

Run: `npm run typecheck && npm test`

```bash
git add -A
git commit -F - <<'EOF'
Give bending a floor, so an empty bar stops buzzing

canBend was breath > 0, with nothing to re-engage at. At zero breath in
the glider, regeneration adds a fraction of a unit in a frame and the
drain takes slightly more, so thrust flickered on and off every other
frame: measured at 300 of 600 frames engaged while holding W. That reads
as a buzz, not as exhaustion.

bendFloor 15 converts it into a rhythm. Against breathDrainPerSecond 18
it buys 0.83 seconds of thrust, and at breathRegenPerSecond 12 it takes
1.25 seconds to earn back, so an exhausted player gets a beat of thrust
and then a beat of nothing.

Deliberately not true hysteresis. Remembering "was bending" would need a
field on PlayerState carried through every respawn and save path, and the
floor alone already turns a 30 Hz artifact into something legible.

The test asserts the duty cycle over 600 frames rather than that bending
fails at exactly zero -- the latter passes against the old code and
catches nothing, which is the failure shape the last two cycles kept
producing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The dash trail matches the dash

**Files:**
- Modify: `src/fx/dash-trail.ts:38`
- Modify: `src/main.ts:488` (the FOV kick's decay rate)
- Modify: `src/core/types.ts:211`, `src/core/config.ts:94` (delete `dashDurationSeconds`)
- Modify: `src/player/dash.ts:78-87` (delete `dashDecay`)
- Modify: `src/player/dash.test.ts` (delete its `dashDecay` tests)
- Test: `src/fx/dash-trail.test.ts` if one exists, plus a displacement test

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2.
- Produces: `GroundConfig` **loses** `dashDurationSeconds`; `src/player/dash.ts` **loses** `dashDecay`.

**Why this is a defect.** `dash-trail.ts` sizes its streak as `dashSpeed × dashDurationSeconds` = 26 × 0.22 = **5.72 m**. A dash actually covers **3.94 m**, measured from a standstill: it is an impulse added to horizontal velocity and bled off by `easeHorizontal`, whose time constant is `1 / groundResponse` ≈ 0.14 s. `dashDurationSeconds` never touches the simulation, and `dashDecay` — the function that would have used it — is exported and called nowhere but its own tests.

**Note the interaction with Task 1.** Task 1 makes `easeHorizontal` take an `authority`. A dash on foot runs at authority 1, so `dashSpeed / groundResponse` stays the right figure; a dash while riding a scooter decays more slowly. Do not try to account for that in the trail — it is drawn for the common case and the difference is smaller than a frame's travel. Say so in the comment.

- [ ] **Step 1: Write the failing test**

Create or extend the dash-trail suite. The assertion worth having is the one that would have caught the mismatch — that what is drawn matches what happens:

```ts
describe('the dash trail is as long as the dash', () => {
  it('is sized from the rate the dash actually decays at', () => {
    expect(trailLength(DEFAULT_GROUND_CONFIG))
      .toBeCloseTo(DEFAULT_GROUND_CONFIG.dashSpeed / DEFAULT_GROUND_CONFIG.groundResponse, 6)
  })

  it('matches the ground a real dash covers, within a frame of travel', () => {
    // The assertion that would have caught the original defect: the trail was drawn
    // 5.72 m long for a dash that covers 3.94 m, because it was sized from
    // dashDurationSeconds -- a config value the simulation never read.
    const covered = /* drive one dash through groundStep from a standstill and measure */
    expect(Math.abs(trailLength(DEFAULT_GROUND_CONFIG) - covered))
      .toBeLessThan(DEFAULT_GROUND_CONFIG.dashSpeed / 60)
  })
})
```

`trailLength` stands for however `dash-trail.ts` exposes the figure — read the file. If the length is computed inline inside a factory and not reachable from a test, **extract it to an exported function** so it can be asserted; that extraction is part of this task, and the second test is the reason for it.

For the measurement, drive `groundStep` from a standstill on flat ground with `dashPressed` on the first frame and no movement keys after, for 120 frames, and take the horizontal distance travelled — the same shape the original measurement used.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/fx/dash-trail.test.ts`
Expected: FAIL — the trail is 5.72 and the dash covers about 3.94.

- [ ] **Step 3: Size the trail from the real rate**

In `src/fx/dash-trail.ts`:

```ts
  // The distance an impulse of dashSpeed covers while easeHorizontal bleeds it off at
  // groundResponse -- which is what the dash actually does. It used to be sized from
  // dashSpeed * dashDurationSeconds, 5.72 m, for a dash that covers 3.94: that config
  // value looked live and the simulation never read it, so it has been deleted.
  //
  // Authority is taken as 1, the on-foot case. A dash while riding a scooter decays more
  // slowly and so travels further, but by less than a frame's worth of movement, which is
  // not worth a second trail length.
  const covered = c.dashSpeed / c.groundResponse
```

- [ ] **Step 4: Delete the dead values**

- `src/core/types.ts:211` — remove `dashDurationSeconds` from `GroundConfig`.
- `src/core/config.ts:94` — remove `dashDurationSeconds: 0.22`.
- `src/player/dash.ts` — remove `dashDecay` entirely, including its docblock.
- `src/player/dash.test.ts` — remove its `dashDecay` tests. Read them first: if any of them incidentally covered something else about `DashState`, keep that coverage under a different test rather than losing it.
- `src/main.ts:488` — the FOV kick's decay rate was `1 / DEFAULT_GROUND_CONFIG.dashDurationSeconds`. It becomes `DEFAULT_GROUND_CONFIG.groundResponse`, which is the same quantity expressed directly: the rate the dash actually decays at. Add a short comment saying so.

`npm run typecheck` is what proves you found every reference. Run it before believing the list above is complete.

- [ ] **Step 5: Run everything**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 6: Red-proof**

Restore the trail's length to `c.dashSpeed * 0.22`. Expected red: both new tests. Restore.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Draw the dash trail as long as the dash actually is

The streak was sized dashSpeed * dashDurationSeconds, 26 * 0.22 = 5.72 m,
for a dash that covers 3.94 m measured from a standstill. The dash is an
impulse bled off by easeHorizontal at groundResponse, so its real reach is
dashSpeed / groundResponse -- and dashDurationSeconds never touched the
simulation at all.

Sizing the trail from the constants the simulation obeys means the two
cannot drift again. dashDurationSeconds and dashDecay are deleted:
dashDecay was exported and called from nowhere but its own tests, and a
config value that looks live and is not is an invitation to reintroduce
exactly this mismatch. The dash FOV kick, which drove its decay from
1 / dashDurationSeconds, now uses groundResponse, which is the same
quantity said directly.

The test that matters is the one comparing the drawn length against a
dash driven through groundStep and measured. Asserting the formula alone
would have been satisfied by the old code too, with a different formula.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Read the handoff**

Read `docs/HANDOFF.md` in full and match its voice. It records reasoning and measurements for whoever picks this up next. It has a testing-discipline section from the previous two cycles; check what it already says before adding to it.

- [ ] **Step 2: Write the section**

Cover, with the measured before-and-after for each:

- The scooter's turn trade: 0.45 s at every charge before, and the figures Task 1 measured after. Why it was inert — authority scaled the strafe axis while the camera-relative heading made `groundResponse` the thing that actually turns you.
- `Shift`'s three meanings, the 27.5 against 14.8 m/s measurement at identical charge, and that the scooter now lives on `Z`. Note that the README already described the tangle, so the documentation was the honest artifact and the code was the problem — the second time that has happened in three cycles.
- `bendFloor` 15: the 300-of-600-frames duty cycle before, 0 after, and the 0.83 s / 1.25 s rhythm the number buys. That true hysteresis was declined on purpose and why.
- The dash trail: 5.72 m drawn against 3.94 m travelled, now sized `dashSpeed / groundResponse`, with `dashDurationSeconds` and `dashDecay` deleted.
- **What is still not done:** the scooter's `clipped` tier drop is still hardcoded `false`, and terrain collision has made a wall detectable, so it is now genuinely available; `scooterTurnFactor` and `scooterChargeTurnPenalty` should be judged in play now that they mean something rather than retuned blind; and none of this cycle has been played, because the browser harness cannot hold pointer lock.

- [ ] **Step 3: Commit**

```bash
git add docs/HANDOFF.md
git commit -F - <<'EOF'
Record the feel batch in the handoff

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Self-Review

**Spec coverage.** All four sections have a task: the scooter's authority and its key are Task 1 (one task because both touch `groundStep` and the guide/README pair, and a reviewer would judge them together), the breath floor is Task 2, the dash trail and the two deletions are Task 3, documentation is Task 4. Every test the spec lists has a home. The spec's three out-of-scope items are restated in Task 4 so they are recorded rather than forgotten.

**Placeholders.** One deliberate gap: Task 3's first test has `const covered = /* drive one dash ... */`, with the method specified in prose immediately below it because the exact call shape depends on how `dash-trail.ts` exposes its length, which the implementer must read first. Task 1 step 4 and Task 3 step 1 both ask for a measurement to be taken and written down rather than guessed. Those are instructions, not deferrals.

**Type consistency.** `desiredVelocity(input, c, speedScale?)` and `easeHorizontal(current, desired, dt, c, authority?)` have the same shapes in the interfaces block, the implementation, and `groundStep`'s call. `canBend(s, c)` is consistent across `breath.ts`, both `controller.ts` sites, `actions.ts` and the tests. `bendFloor` is on `FlightConfig` in `types.ts`, set in `config.ts`, validated in `validateFlightConfig`, and read only through the config parameter. `dashDurationSeconds` is removed from `types.ts` and `config.ts` in the same task that removes its last two readers.

**One risk this review cannot settle.** Task 2 step 4 tells the implementer to check whether `ActionContext` carries a `FlightConfig` and to add it if not. If it does not, that is a wider change than the rest of the task — it touches `main.ts`, the panel's view model and its test fixtures. Expect it in the diff and judge it as part of Task 2 rather than as scope creep.
