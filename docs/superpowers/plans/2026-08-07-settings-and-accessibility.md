# Settings And Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mouse sensitivity, inverted vertical look, master volume with mute, and a reduce-motion switch — adjustable in the guide and persisted.

**Architecture:** One pure tested module (`src/core/settings.ts`) owns defaults, tolerant reading, clamping, and the derived scalars. Three delivery paths take values to where they are consumed: a setter on `InputTracker`, `setVolume` on both audio modules, and five per-frame motion scalars read in `main.ts`. The panel lives in the guide, which releases pointer lock on open so a cursor exists.

**Tech Stack:** TypeScript 7.0.2, three.js 0.185.1, Vitest 4.1.10 (node environment).

## Global Constraints

- **Exact defaults:** `sensitivity` 1, `invertY` false, `volume` 0.7, `muted` false, `reduceMotion` from `prefers-reduced-motion`. Sensitivity clamped to **0.25 – 4**. Storage key **`airbender-skies:settings:v1`**.
- **Reduced motion scalars:** `shake` 0, `hurtFlash` 0, `dashKick` 0, `hitstop` **0.4**, `vignette` **0.35**. Normal is 1 for all five.
- **Test environment is node** (`vitest.config.ts`). No DOM, no `AudioContext`, no `window.matchMedia`. `npx vitest run <path> --reporter=verbose` to see `console.log`. Typecheck `npm run typecheck` — two passes; `noUncheckedIndexedAccess` on.
- **`prefersReducedMotion` is a parameter, never read inside `settings.ts`.** The module must stay pure and testable in node; only `main.ts` touches `matchMedia`.
- **Comments explain *why*, not what.** **Every measured number in a comment must also be asserted somewhere.**
- **After writing a test, neutralise the feature and confirm the test goes red.** Make the change, run the suite, watch it redden, revert. This project's register stands at **fifteen assertions across six cycles that could not fail**; `docs/HANDOFF.md`'s "Testing discipline" section has the list and the shapes. Two shapes to watch for here specifically: a **fixture default** that makes an assertion vacuous, and a **probe derived from the value under test**, which survives that value moving.
- **Never commit to `main`.** Work on `settings-and-accessibility`, which exists and is checked out.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/settings.ts` | **New.** `Settings`, `MotionScales`, `defaultSettings`, `readSettings`, `effectiveVolume`, `motionScales`. Pure. |
| `src/core/settings.test.ts` | **New.** The tolerant reader, clamps, per-effect scalars. |
| `src/core/settings-store.ts` | **New.** `loadSettings(storage, prefersReducedMotion)` and `writeSettings(storage, settings)`, both never-throws, mirroring `src/core/save.ts`. |
| `src/core/settings-store.test.ts` | **New.** Round-trip, blocked storage, corrupt payload. |
| `src/core/input.ts` | **Modify.** `MOUSE_SENSITIVITY` becomes the base; `InputTracker` gains a look setter and applies the multiplier and the invert. |
| `src/core/input.test.ts` | **Modify.** Sensitivity and invert behaviour. |
| `src/fx/audio.ts`, `src/fx/combat-audio.ts` | **Modify.** `setVolume(v)` on each. |
| `src/ui/guide/settings-rows.ts` | **New.** `settingsRows(settings)` — the pure view-model. |
| `src/ui/guide/settings-rows.test.ts` | **New.** Every field gets a row. |
| `src/ui/guide/panel.ts` | **Modify.** Render the settings section; rows take pointer events; `open()` releases pointer lock. |
| `src/main.ts` | **Modify.** Load settings, wire the three paths, apply the five scalars, persist on change. |
| `README.md`, `docs/HANDOFF.md` | **Modify.** Record the cycle. |

---

### Task 1: The settings model and its store

**Files:**
- Create: `src/core/settings.ts`, `src/core/settings.test.ts`, `src/core/settings-store.ts`, `src/core/settings-store.test.ts`

**Interfaces produced:**

```ts
export interface Settings {
  sensitivity: number; invertY: boolean; volume: number; muted: boolean; reduceMotion: boolean
}
export interface MotionScales {
  shake: number; hurtFlash: number; dashKick: number; hitstop: number; vignette: number
}
export function defaultSettings(prefersReducedMotion: boolean): Settings
export function readSettings(raw: unknown, prefersReducedMotion: boolean): Settings
export function effectiveVolume(s: Settings): number
export function motionScales(s: Settings): MotionScales
export const SENSITIVITY_MIN = 0.25
export const SENSITIVITY_MAX = 4
// settings-store.ts
export const SETTINGS_KEY = 'airbender-skies:settings:v1'
export function loadSettings(storage: StorageLike, prefersReducedMotion: boolean): Settings
export function writeSettings(storage: StorageLike, s: Settings): boolean
```

`StorageLike` is already exported from `src/core/save.ts` — import it rather than redeclaring.

- [ ] **Step 1: Write the failing tests for `settings.ts`**

Read `src/core/save.test.ts` first and match its style. The cases:

- **`readSettings` with junk in each field independently.** One test per field: a string `sensitivity`, a `NaN` volume, a `null` `invertY`, an absent `muted`, a `reduceMotion` of `"yes"`. Each asserts the **bad field falls back and every other field survives from the input.** Give the other fields non-default values in each fixture, or the assertion cannot tell a field-by-field fallback from a whole-object one — that is the discriminating detail.
- `readSettings(null, …)`, `readSettings("nonsense", …)` and `readSettings(undefined, …)` all give defaults.
- Sensitivity clamped: `0.1 → 0.25`, `10 → 4`, and `0.25` / `4` pass through unchanged.
- Volume clamped to 0–1 the same way.
- `effectiveVolume` is 0 when muted; **and `volume` is unchanged by muting**, so unmuting restores it. Assert both.
- `motionScales` **per effect**, both states — five assertions each way. A test asserting only "reduced is lower" would pass a single uniform scalar, which the design explicitly rejects.
- `defaultSettings(true)` vs `defaultSettings(false)`: differ in `reduceMotion` and nothing else. Assert the other four are equal rather than asserting their literals, so the media query cannot quietly move volume.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/core/settings.test.ts --reporter=verbose`

Expected: FAIL — `Failed to resolve import "./settings"`.

- [ ] **Step 3: Implement `settings.ts`**

`readSettings` reads each field independently: check the type, check finiteness for numbers, clamp, and fall back to that field's default on any failure. Never throw. The `prefersReducedMotion` parameter supplies the `reduceMotion` default when that field is absent or unusable.

`motionScales` returns the five values from the table in the Global Constraints. Comment *why* hitstop and the vignette soften rather than vanish — hitstop is the main signal a hit landed, and the vignette marks the Avatar State being active — not what the numbers are.

- [ ] **Step 4: Write and pass the store tests**

`settings-store.test.ts`, using a fake `StorageLike` as `save.test.ts` does:

- Round-trip: write then load gives the same settings.
- A `getItem` that throws, and a `setItem` that throws (private browsing, full quota): `loadSettings` returns defaults, `writeSettings` returns `false`, neither throws.
- A stored payload that is not JSON, and one that is JSON but not an object: defaults.
- A payload with one bad field: that field defaults, the rest survive. This is the store's version of the discriminating case above.
- Absent key: defaults, and `prefersReducedMotion` is honoured.

- [ ] **Step 5: Run the tests, then the full suite and typecheck**

Run: `npx vitest run src/core/ --reporter=verbose`, then `npx vitest run && npm run typecheck`.

- [ ] **Step 6: Neutralise and confirm each reddens**

One at a time, make the edit, run, confirm FAIL, revert:

1. Make `readSettings` return `defaultSettings(...)` whenever **any** field is bad — the whole-object fallback. Must redden the field-independence tests.
2. Remove the sensitivity clamp.
3. Make `effectiveVolume` return `s.volume` unconditionally.
4. Make muting also set `volume` to 0. Must redden the restore-on-unmute test.
5. Make `motionScales` return a single uniform scalar (0 reduced, 1 normal) for all five. Must redden the hitstop and vignette assertions.
6. Make `defaultSettings` ignore its parameter.

Record a table with the catching test for each. **A neutralisation that leaves the suite green is a finding to report** — replace the assertion, then re-run to confirm the replacement reddens.

- [ ] **Step 7: Commit**

```bash
git add src/core/settings.ts src/core/settings.test.ts src/core/settings-store.ts src/core/settings-store.test.ts
git commit -m "Settings, tolerantly read and separately stored"
```

---

### Task 2: Deliver the values — input, audio, and the motion scalars

**Files:**
- Modify: `src/core/input.ts`, `src/core/input.test.ts`, `src/fx/audio.ts`, `src/fx/combat-audio.ts`

**Interfaces:**
- Consumes: `Settings`, `effectiveVolume` (Task 1).
- Produces: `InputTracker.setLook(sensitivity: number, invertY: boolean): void`; `setVolume(v: number): void` on both audio factories.

- [ ] **Step 1: Write the failing input tests**

`src/core/input.test.ts` already tests `lookDirectionFrom`, `clampPitch` and `toInputState` as pure functions. `InputTracker` needs a DOM, so **it cannot be constructed in the node environment** — read the existing file and see what it does and does not cover before deciding what to test.

What *can* be tested purely is the arithmetic. Extract it:

```ts
/** How far a mouse delta turns the view, given the player's sensitivity and invert choice. */
export function lookDelta(movementX: number, movementY: number, sensitivity: number, invertY: boolean): { yaw: number; pitch: number }
```

Then `InputTracker`'s handler calls it. Tests:

- Sensitivity 1 reproduces today's numbers exactly, so the default is not a behaviour change. Assert against `MOUSE_SENSITIVITY` arithmetic, and **also against the literal it produces** — asserting only against the constant would pass if the constant itself changed.
- Sensitivity 2 doubles both axes; 0.5 halves them.
- `invertY` flips the pitch sign and **leaves yaw alone**. The second half is what a wrong implementation fails.
- Sensitivity applies before the invert, so a negative result is the same magnitude either way.

- [ ] **Step 2: Implement `lookDelta` and rewire `InputTracker`**

`MOUSE_SENSITIVITY` stays as the base and is no longer the whole answer — rename nothing, but its doc comment must say it is now a base that a player multiplier scales, or the next reader will think the setting replaced it.

`InputTracker` holds `sensitivity` and `invertY` fields defaulting to 1 and false, gains `setLook`, and its `mousemove` handler routes through `lookDelta`. Pitch still goes through `clampPitch`.

- [ ] **Step 3: Add `setVolume` to both audio modules**

In `src/fx/audio.ts`, the wind's gain is written by `update()` from `windVolumeForSpeed`. Add a stored volume multiplier that `update()` applies, plus:

```ts
    /**
     * The player's master volume, applied on top of the airspeed mix. Stored rather than
     * written straight to the gain node, because `update` recomputes that node every frame
     * from airspeed and would overwrite a direct write on the next one.
     */
    setVolume(v: number): void
```

In `src/fx/combat-audio.ts` the `master` gain is written once at `start()`, so `setVolume` can write it directly — but it must also survive a `start()` that happens *after* `setVolume`, which it will if the stored value is applied in `start()` too. Handle that; it is the ordering bug this shape invites.

Both no-op safely with no context, matching every other method there.

- [ ] **Step 4: Run the tests, the full suite, and typecheck**

Run: `npx vitest run src/core/input.test.ts --reporter=verbose`, then `npx vitest run && npm run typecheck`.

- [ ] **Step 5: Neutralise and confirm each reddens**

1. Ignore `sensitivity` in `lookDelta`.
2. Ignore `invertY`.
3. Apply `invertY` to yaw as well as pitch.

Report the table. Then state plainly in the report **which of the audio changes are untested and why** — there is no `AudioContext` in node, and a mock would test the mock. A green suite after this task does not mean the audio works.

- [ ] **Step 6: Commit**

```bash
git add src/core/input.ts src/core/input.test.ts src/fx/audio.ts src/fx/combat-audio.ts
git commit -m "Take sensitivity, invert and volume to where they are used"
```

---

### Task 3: The panel, the lock release, and the wiring

**Files:**
- Create: `src/ui/guide/settings-rows.ts`, `src/ui/guide/settings-rows.test.ts`
- Modify: `src/ui/guide/panel.ts`, `src/main.ts`, `README.md`, `docs/HANDOFF.md`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: `settingsRows(s: Settings): SettingsRow[]`, and a `Guide` that renders them.

- [ ] **Step 1: Write the failing view-model tests**

```ts
export type SettingsRow =
  | { kind: 'slider'; key: 'sensitivity' | 'volume'; label: string; value: number; min: number; max: number; step: number; display: string }
  | { kind: 'toggle'; key: 'invertY' | 'muted' | 'reduceMotion'; label: string; on: boolean }
```

Tests:

- Every key of `Settings` appears in exactly one row. Derive the expected key list from `Object.keys` of a real `Settings` object, **not** from a hand-written list — that way adding a field to `Settings` without a row fails this test rather than passing silently.
- The sensitivity slider's `min`/`max` come from `SENSITIVITY_MIN`/`SENSITIVITY_MAX`.
- Toggles reflect their values both ways.
- `display` for sensitivity and volume is human-readable and changes with the value — assert two different values produce two different strings, and assert what each is.

- [ ] **Step 2: Implement `settings-rows.ts`, run the tests**

Run: `npx vitest run src/ui/guide/settings-rows.test.ts --reporter=verbose`. Expected FAIL then PASS.

- [ ] **Step 3: Release pointer lock when the guide opens**

In `src/ui/guide/panel.ts`'s `api.open()`, call `document.exitPointerLock()`.

This is the interaction the whole panel depends on: while the lock is held there is no visible cursor, so no mouse-driven control is possible. Releasing it gives a cursor, and `pauseReason` orders `guide` before `unlocked`, so the pause card stays hidden. Comment that reasoning — it spans two modules written in different cycles and is not obvious from either.

- [ ] **Step 4: Render the section and let the rows take pointer events**

Add the settings section to the panel's `update`. The rows get `pointer-events: auto`; **everything else keeps `pointer-events: none`.**

The existing comment explains why the panel is `pointer-events: none` — a panel that swallows a click meant for the canvas breaks pointer lock. Extend that comment rather than deleting it: the rows are safe because the lock is deliberately released while the guide is open, so there is no lock for a swallowed click to cost. Do not relax it for the whole panel.

`createGuide` needs a way to report a change. Add a callback parameter, and keep the existing `onToggle` working — `main.ts` is the only caller.

- [ ] **Step 5: Wire it into `main.ts`**

- Read `prefers-reduced-motion` once: `window.matchMedia('(prefers-reduced-motion: reduce)').matches`. Guard it — `matchMedia` may be absent.
- `loadSettings(localStorage, prefersReducedMotion)` at startup, beside the existing `loadSave`.
- Apply immediately: `input.setLook(...)`, `wind.setVolume(effectiveVolume(settings))`, `combatAudio.setVolume(...)`.
- On a change from the panel: update the object, re-apply, and `writeSettings`.
- Apply the five motion scalars where those effects already are: `triggerShake`/`shakeOffset`, the hurt flash, `fovKickForDash`, `triggerHitstop`, and the vignette. **Multiply at the point of application, and check each one** — the five live in different places and one silently unscaled is exactly the kind of gap that ships.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`.

- [ ] **Step 7: Verify what can be verified in the browser, and be exact about what cannot**

Start the dev server. Verifiable: the guide opens and shows the settings section, the rows are in the DOM with the loaded values, `getComputedStyle` reports `pointer-events: auto` on a row and `none` on the panel root, and a written setting survives a reload.

**Not verifiable here, and it must be reported as unverified rather than assumed: the pointer-lock release itself.** This environment never receives OS focus, so `requestPointerLock` always errors and there is no lock to release. That is this cycle's central interaction. If you exercise `exitPointerLock` synthetically, label it as exercising the call and not the browser's behaviour.

- [ ] **Step 8: Update the README and the handoff**

README: a short settings line in the controls area — `H` opens the guide, which now also holds settings. Do not list the values.

`docs/HANDOFF.md`: what was missing and that `prefers-reduced-motion` was read nowhere; the five motion scalars and **why hitstop and the vignette soften rather than vanish**; the separate storage key and why preferences are not `SaveData`; the pointer-lock release and how it composes with `pauseReason`'s ordering; and plainly, that the lock release is unverified because the harness cannot hold a lock.

- [ ] **Step 9: Commit**

```bash
git add src/ui/guide/ src/main.ts README.md docs/HANDOFF.md
git commit -m "Settings in the guide, with the cursor to use them"
```

---

## Self-review notes

**Spec coverage.** `settings.ts` and the store → Task 1. The three delivery paths → Task 2 (input, audio) and Task 3 Step 5 (motion scalars). The panel and the lock release → Task 3. Each of the spec's seven testing bullets maps to a step: field independence and the scalars to Task 1 Step 1, `effectiveVolume`'s restore-on-unmute to the same, the `pauseReason` interaction to Task 3 Step 3's comment plus the existing `pause.test.ts`, and `settingsRows` completeness to Task 3 Step 1.

**One spec bullet this plan handles differently, and says so.** The spec asks for the guide/lock interaction to be "asserted at the `pauseReason` level with both inputs set". `pause.test.ts` already enumerates all eight input combinations including `guideOpen: true, pointerLocked: false`, so that assertion **already exists** and needs nothing added. What this plan asks for instead is the comment explaining why the release is safe, because the risk here is not an untested predicate but a future reader deleting the `exitPointerLock()` call without knowing what depends on it.

**Where this plan expects trouble.** Task 2 Step 3's combat-audio ordering: `setVolume` before `start()` must not be lost when `start()` writes the master gain. The plan names it rather than leaving it to be found. And Task 3 Step 5's five scalars are in five different places in a file with no tests, which is the likeliest place for a silent gap.
