# Going Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Aang's health reaching zero a consequence and a recovery — a 1.5 second frozen beat, then a respawn at the last island at full health with Focus wiped.

**Architecture:** A new pure timer module `src/player/down.ts` owns the beat and the fade curve, in the same shape as `slipstream.ts` and `staff.ts`: no scene, no `PlayerState`, no enemies. `main.ts` holds one `Down | null`, freezes the simulation while it runs, and calls the already-existing `safeRespawn` at the moment the screen reaches full black. `src/combat/health.ts` is not modified — its `isDowned` branch was always waiting for exactly this system.

**Tech Stack:** TypeScript, Three.js 0.185, Vite, Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-05-player-down-design.md`](../specs/2026-08-05-player-down-design.md)

## Global Constraints

- No new dependencies. `three` and `simplex-noise` are the only runtime deps and that does not change.
- Tests are colocated: `src/player/down.ts` is tested by `src/player/down.test.ts`. There is no `tests/` directory.
- `npm test` (vitest run) and `npm run typecheck` must both pass at the end of every task.
- Tuning constants live in `src/core/config.ts` as `DEFAULT_*_CONFIG` exports. Do not inline magic numbers at call sites.
- `src/combat/health.ts` and `src/combat/health.test.ts` must not be modified by any task in this plan. If an assertion there needs editing, the change is wrong.
- Comments explain *why*, not *what*. This codebase's comments argue for decisions; match that. Do not narrate the code.
- Never use `any`. `strict` is on.
- Test names are lowercase sentences describing behaviour (`it('resets the chain when the continue window lapses')`), not `it('should ...')`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/player/down.ts` | create | The beat: a timer, the respawn moment, the fade curve, the collapse curve. Pure. |
| `src/player/down.test.ts` | create | Every behaviour of the above. This is where the confidence lives. |
| `src/core/config.ts` | modify | `DEFAULT_DOWN_CONFIG`. |
| `src/ui/hud.ts` | modify | A black full-screen overlay driven by a `fade` fraction. |
| `src/ui/hud.test.ts` | modify | Four cases for the new `fade` field. |
| `src/player/controller.ts` | modify | Export `safeRespawn`. One keyword and a comment. |
| `src/main.ts` | modify | Owns the `Down | null`, freezes the loop, runs `recover()`. |
| `docs/design/aang-playable-character.md` | modify | §6 gains the missing failure-state entry. |
| `README.md` | modify | One sentence in the combat prose. |
| `docs/HANDOFF.md` | modify | An entry in "What has been built". |

---

### Task 1: The `down.ts` timer

**Files:**
- Create: `src/player/down.ts`
- Create: `src/player/down.test.ts`
- Modify: `src/core/config.ts` (append `DEFAULT_DOWN_CONFIG`)

**Interfaces:**
- Consumes: nothing from earlier tasks. `MathUtils` from `three`.
- Produces, relied on by Tasks 2 and 3:
  - `interface DownConfig { fadeOutSeconds: number; fadeInSeconds: number }`
  - `interface Down { elapsed: number }`
  - `const COLLAPSE_SCALE: number` (0.35)
  - `startDown(): Down`
  - `stepDown(down: Down, dt: number, c: DownConfig): { down: Down | null; respawnNow: boolean }`
  - `fadeOpacity(down: Down | null, c: DownConfig): number`
  - `collapseSquash(down: Down | null, c: DownConfig): number`
  - `DEFAULT_DOWN_CONFIG: DownConfig` exported from `src/core/config.ts`

- [ ] **Step 1: Add the config**

Append to `src/core/config.ts`. That file puts each type import directly above the config it types rather than grouping them at the top — see lines 98 and 113 for `SlipstreamConfig` and `StaffConfig`. Follow it:

```ts
import type { DownConfig } from '../player/down'

```
```ts
/**
 * The beat between going down and standing back up.
 *
 * 1.5 seconds total. Long enough to register as an event, short enough not to read as a
 * loading screen. The fade in is the longer half on purpose: coming back should feel
 * slower than going down.
 *
 * Every value here is an argued guess. None of it has been played.
 */
export const DEFAULT_DOWN_CONFIG: DownConfig = {
  fadeOutSeconds: 0.6,
  fadeInSeconds: 0.9,
}
```

- [ ] **Step 2: Write the failing test**

Create `src/player/down.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  COLLAPSE_SCALE, collapseSquash, fadeOpacity, startDown, stepDown, type Down,
} from './down'
import { DEFAULT_DOWN_CONFIG as D } from '../core/config'

const WHOLE_BEAT = D.fadeOutSeconds + D.fadeInSeconds

/**
 * Step a fresh down at 60 Hz for `seconds`, recording the elapsed time at every frame
 * that reported a respawn. Mirrors how main.ts drives it.
 */
function run(seconds: number, dt = 1 / 60) {
  let down: Down | null = startDown()
  const respawnsAt: number[] = []
  for (let t = 0; t < seconds && down; t += dt) {
    const step = stepDown(down, dt, D)
    down = step.down
    if (step.respawnNow) respawnsAt.push(t + dt)
  }
  return { down, respawnsAt }
}

describe('stepDown', () => {
  it('starts at the beginning of the beat', () => {
    expect(startDown().elapsed).toBe(0)
  })

  it('advances by the step', () => {
    expect(stepDown(startDown(), 0.25, D).down?.elapsed).toBeCloseTo(0.25)
  })

  it('respawns exactly once, on the frame the screen reaches full black', () => {
    // Once, not never and not every frame: a repeat would respawn the player in a loop.
    const { respawnsAt } = run(WHOLE_BEAT + 1)
    expect(respawnsAt).toHaveLength(1)
    expect(respawnsAt[0]).toBeGreaterThanOrEqual(D.fadeOutSeconds)
    expect(respawnsAt[0]).toBeLessThan(D.fadeOutSeconds + 1 / 60 + 1e-9)
  })

  it('does not respawn while the screen is still fading', () => {
    // The teleport has to happen behind full black or the player watches it happen.
    const almost: Down = { elapsed: D.fadeOutSeconds - 1 / 60 }
    expect(stepDown(almost, 1 / 120, D).respawnNow).toBe(false)
  })

  it('clears itself once the fade in has finished', () => {
    expect(run(WHOLE_BEAT + 1).down).toBeNull()
  })

  it('respawns and clears in one step when a frame spans the whole beat', () => {
    const step = stepDown(startDown(), WHOLE_BEAT + 1, D)
    expect(step.respawnNow).toBe(true)
    expect(step.down).toBeNull()
  })

  it('escapes the state rather than hanging on a non-finite step', () => {
    // Clamping here would trap the player in a frozen world with no input, which is
    // strictly worse than an unexplained recovery.
    const step = stepDown(startDown(), NaN, D)
    expect(step.respawnNow).toBe(true)
    expect(step.down).toBeNull()
  })
})

describe('fadeOpacity', () => {
  it('is clear when nobody is down', () => {
    expect(fadeOpacity(null, D)).toBe(0)
  })

  it('is clear at the start of the beat', () => {
    expect(fadeOpacity(startDown(), D)).toBe(0)
  })

  it('is half way through the fade out', () => {
    expect(fadeOpacity({ elapsed: D.fadeOutSeconds / 2 }, D)).toBeCloseTo(0.5)
  })

  it('is fully black on the frame the respawn lands', () => {
    expect(fadeOpacity({ elapsed: D.fadeOutSeconds }, D)).toBe(1)
  })

  it('is clear again at the end of the beat', () => {
    expect(fadeOpacity({ elapsed: WHOLE_BEAT }, D)).toBeCloseTo(0)
  })

  it('clamps rather than going negative past the end', () => {
    expect(fadeOpacity({ elapsed: WHOLE_BEAT + 5 }, D)).toBe(0)
  })

  it('never sends a non-finite opacity to the DOM', () => {
    expect(fadeOpacity({ elapsed: NaN }, D)).toBe(0)
  })
})

describe('collapseSquash', () => {
  it('is full height when nobody is down', () => {
    expect(collapseSquash(null, D)).toBe(1)
  })

  it('is full height at the start of the beat', () => {
    expect(collapseSquash(startDown(), D)).toBe(1)
  })

  it('has sunk by the end of the fade out', () => {
    expect(collapseSquash({ elapsed: D.fadeOutSeconds - 1e-6 }, D)).toBeCloseTo(COLLAPSE_SCALE)
  })

  it('stands back up the moment the respawn lands', () => {
    // The boundary belongs to the standing-up side. He is already at the island by then,
    // and a squashed statue revealed by the lifting black would undo the whole effect.
    expect(collapseSquash({ elapsed: D.fadeOutSeconds }, D)).toBe(1)
    expect(collapseSquash({ elapsed: WHOLE_BEAT }, D)).toBe(1)
  })

  it('is full height for a non-finite timer', () => {
    expect(collapseSquash({ elapsed: NaN }, D)).toBe(1)
  })
})
```

- [ ] **Step 3: Run the test and watch it fail**

```bash
npm test -- src/player/down.test.ts
```

Expected: FAIL — `Failed to resolve import "./down"`.

- [ ] **Step 4: Write the implementation**

Create `src/player/down.ts`:

```ts
import { MathUtils } from 'three'

/**
 * The beat between going down and standing back up.
 *
 * `health.ts` refuses to regenerate a downed combatant off the floor, and says standing
 * them up is a decision for a system above it. This is that system for the player.
 *
 * Pure and posture-free, like `slipstream.ts` and `staff.ts`: it knows nothing about a
 * scene, a PlayerState, or an enemy. It reports *when* to respawn; main.ts decides what a
 * respawn means.
 */
export interface DownConfig {
  /** Blackout ramp. The respawn lands at full black, so it is never seen. */
  fadeOutSeconds: number
  /** Ramp back in afterwards. */
  fadeInSeconds: number
}

export interface Down {
  /** Seconds since the player went down. */
  elapsed: number
}

/**
 * How far the avatar sinks, as a fraction of full height.
 *
 * Exported so the test asserts against the constant rather than a second copy of the
 * number, which is how the two drift apart.
 */
export const COLLAPSE_SCALE = 0.35

export function startDown(): Down {
  return { elapsed: 0 }
}

/**
 * Advance the beat.
 *
 * `respawnNow` is derived from the before and after times rather than recorded on `Down`,
 * so it fires on exactly one frame and there is no second field to drift out of step with
 * the timer it describes.
 *
 * A step long enough to cross both boundaries reports the respawn *and* clears the state.
 * The respawn still applies; a frame that long has worse problems than a skipped fade.
 */
export function stepDown(
  down: Down, dt: number, c: DownConfig,
): { down: Down | null; respawnNow: boolean } {
  const elapsed = down.elapsed + dt
  // Fails open, not closed. Clamping a non-finite timer would leave the player in a
  // frozen world with no input and no way out, which is strictly worse than standing them
  // up a moment early with no explanation.
  if (!Number.isFinite(elapsed)) return { down: null, respawnNow: true }

  const respawnNow = down.elapsed < c.fadeOutSeconds && elapsed >= c.fadeOutSeconds
  if (elapsed >= c.fadeOutSeconds + c.fadeInSeconds) return { down: null, respawnNow }
  return { down: { elapsed }, respawnNow }
}

/**
 * How black the screen is, 0 to 1.
 *
 * Two ramps rather than one flat hold, because the whole reason for the beat is that the
 * teleport happens at full black and the player never sees it.
 */
export function fadeOpacity(down: Down | null, c: DownConfig): number {
  if (!down || !Number.isFinite(down.elapsed)) return 0
  if (down.elapsed < c.fadeOutSeconds) {
    // A zero-length ramp is instant rather than a division by zero.
    if (!(c.fadeOutSeconds > 0)) return 1
    return MathUtils.clamp(down.elapsed / c.fadeOutSeconds, 0, 1)
  }
  if (!(c.fadeInSeconds > 0)) return 0
  return MathUtils.clamp(1 - (down.elapsed - c.fadeOutSeconds) / c.fadeInSeconds, 0, 1)
}

/**
 * Vertical scale for the avatar as he sinks, driving the same squash channel jump
 * charging uses. There is no collapse clip to play, and teaching `planClips` about one
 * needs an asset the character model may not ship.
 *
 * Back to 1 from `fadeOutSeconds` onward: the respawn has already landed by then, and a
 * squashed avatar revealed by the lifting black would undo the effect.
 */
export function collapseSquash(down: Down | null, c: DownConfig): number {
  if (!down || !Number.isFinite(down.elapsed)) return 1
  if (down.elapsed >= c.fadeOutSeconds) return 1
  if (!(c.fadeOutSeconds > 0)) return COLLAPSE_SCALE
  const t = MathUtils.clamp(down.elapsed / c.fadeOutSeconds, 0, 1)
  return 1 - (1 - COLLAPSE_SCALE) * t
}
```

- [ ] **Step 5: Run the tests and the typecheck**

```bash
npm test -- src/player/down.test.ts && npm run typecheck
```

Expected: 19 passing, no type errors.

- [ ] **Step 6: Run the whole suite**

```bash
npm test
```

Expected: everything green. Nothing else imports `down.ts` yet, so a failure here means the `config.ts` edit broke something.

- [ ] **Step 7: Commit**

```bash
git add src/player/down.ts src/player/down.test.ts src/core/config.ts
git commit -m "Add the downed beat: a timer, a fade, and a collapse"
```

---

### Task 2: The HUD fade

**Files:**
- Modify: `src/ui/hud.ts`
- Modify: `src/ui/hud.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly — `fade` arrives as a plain number.
- Produces, relied on by Task 3:
  - `HudModel` gains `fade: number`
  - `hudModelFor(state: PlayerState, playerHealth?: { current: number; max: number }, focus?: FocusReadout, fade?: number): HudModel`

- [ ] **Step 1: Write the failing test**

Append to `src/ui/hud.test.ts`. The `p()` helper already exists at the top of that file — use it, do not redefine it.

```ts
describe('hudModelFor fade', () => {
  it('is clear when no fade is given', () => {
    expect(hudModelFor(p()).fade).toBe(0)
  })

  it('passes a mid fade through', () => {
    expect(hudModelFor(p(), undefined, undefined, 0.4).fade).toBeCloseTo(0.4)
  })

  it('clamps a fade above one', () => {
    expect(hudModelFor(p(), undefined, undefined, 4).fade).toBe(1)
  })

  it('never lets a non-finite fade reach the DOM', () => {
    // Same rule the focus fractions follow: opacity is written straight into a style.
    expect(hudModelFor(p(), undefined, undefined, NaN).fade).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm test -- src/ui/hud.test.ts
```

Expected: FAIL — `Expected 3 arguments, but got 4` at typecheck, or `undefined` for `.fade` at runtime.

- [ ] **Step 3: Add `fade` to the model**

In `src/ui/hud.ts`, add to the `HudModel` interface, after `avatarActive`:

```ts
  /** 0 to 1: how black the full-screen overlay is. */
  fade: number
```

Change the `hudModelFor` signature and add the field to its return object:

```ts
export function hudModelFor(
  state: PlayerState,
  playerHealth?: { current: number; max: number },
  focus?: FocusReadout,
  fade = 0,
): HudModel {
```

```ts
    avatarCharge: fraction(focus?.avatarCharge ?? 0),
    avatarActive,
    fade: fraction(fade),
  }
```

- [ ] **Step 4: Add the overlay element**

Append to the `STYLE` template literal in `src/ui/hud.ts`:

```css
.hud-fade { position: fixed; inset: 0; background: #000; pointer-events: none;
  opacity: 0; }
```

There is deliberately no `transition` here, unlike `.hud-vignette`: `fadeOpacity` already owns the curve and a transition would fight it.

Add the element as the **last** child in the `root.innerHTML` template, after `<div class="hud-vignette"></div>`, so it covers the vignette:

```html
    <div class="hud-fade"></div>
```

Add the query beside the others:

```ts
  const fade = root.querySelector('.hud-fade') as HTMLElement
```

And the write, as the last line of `update`:

```ts
      fade.style.opacity = String(model.fade)
```

- [ ] **Step 5: Run the tests and the typecheck**

```bash
npm test -- src/ui/hud.test.ts && npm run typecheck
```

Expected: PASS. The typecheck matters here — `hudModelFor`'s existing call in `main.ts` passes three arguments and must still compile against the new optional fourth.

- [ ] **Step 6: Run the whole suite**

```bash
npm test
```

Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add src/ui/hud.ts src/ui/hud.test.ts
git commit -m "Give the HUD a full-screen fade"
```

---

### Task 3: Wire the beat into the game

**Files:**
- Modify: `src/player/controller.ts:111` (export `safeRespawn`)
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `startDown`, `stepDown`, `fadeOpacity`, `collapseSquash`, `Down`, `DEFAULT_DOWN_CONFIG` from Task 1; the four-argument `hudModelFor` from Task 2.
- Produces: nothing consumed by a later task. Task 4 documents what this builds.

There are no unit tests in this task. `main.ts` has none and never has — the verification is Step 7, in the running game, which is how this gap was found in the first place.

- [ ] **Step 1: Export `safeRespawn`**

In `src/player/controller.ts`, change line 111 from `function safeRespawn(` to `export function safeRespawn(`, and extend its existing doc comment with a second paragraph:

```ts
/**
 * Respawn, then verify the result. spawnPointFor is injected, so a caller bug
 * could hand us a non-finite position; without this check the corrupted state
 * would be returned and re-corrupted every frame thereafter.
 *
 * Exported because going down uses the same recovery as falling out of the world does.
 * Two triggers, one mechanism — and both want this guard, not the unguarded `respawn`.
 */
```

- [ ] **Step 2: Add the imports to `main.ts`**

Add `fullHealth, isDowned` to the imports from `./combat/health` (there is no such import line today — add one beside the `./combat/encounter` import):

```ts
import { fullHealth, isDowned } from './combat/health'
```

Add `safeRespawn` to the existing `./player/controller` import:

```ts
import {
  controllerStep, safeRespawn, staffStep, willRespawn, type ControllerDeps,
} from './player/controller'
```

Add the new module:

```ts
import {
  collapseSquash, fadeOpacity, startDown, stepDown, type Down,
} from './player/down'
```

And add `DEFAULT_DOWN_CONFIG` to the existing import from `./core/config`.

- [ ] **Step 3: Add the state**

Beside `let avatarActive = false` (around line 87):

```ts
  /** The beat between going down and standing back up, or null while playing. */
  let down: Down | null = null
```

- [ ] **Step 4: Add `recover()`**

Insert immediately before `function update(dt: number): void`:

```ts
  /**
   * Stand the player back up, at the moment the screen is fully black.
   *
   * Health is restored with the existing `fullHealth` rather than a new `revive` in
   * `health.ts`: it already returns exactly the right pool, and a second name for one
   * behaviour is a second thing to keep true.
   *
   * The fight is deliberately left alone. Enemies keep their damage, positions and
   * stances; the island spawn sits outside their aggroRange, so the patrol drops its
   * aggro on its own and the player walks back in.
   */
  function recover(): void {
    player = safeRespawn(player, deps)
    encounter = { ...encounter, playerHealth: fullHealth(DEFAULT_COMBAT_CONFIG.player) }
    focus = emptyFocus(DEFAULT_FOCUS_CONFIG)
    avatarState = restingAvatarState()
    avatarActive = false
    // Snapped, not smoothed. smoothTowards would converge across the fade in at
    // GROUND_PROFILE's smoothing of 9, but "converges in time" depends on two tuning
    // constants in different files agreeing, and a snap behind full black is free.
    // Composed the same way syncVisuals composes them, so the snapped position is one
    // the smoothing would have been allowed to reach rather than a seat inside a hillside.
    cameraPosition = pullInForTerrain(
      player.position,
      desiredCameraPosition(player.position, lookDirection, profileFor(player.mode)),
      world.terrain,
    )
  }
```

- [ ] **Step 5: Add the frozen branch**

In `update(dt)`, immediately after `const state = input.sample()` and **before** `const crashed = ...`:

```ts
    // The whole simulation holds while the beat runs, the same way frame() holds it while
    // the guide panel is open. No controllerStep, no stepEncounter, no Focus: the pose
    // freezes mid-stride, which is the point. `state` is sampled and thrown away above,
    // which drains the input edges — a jump held through the blackout must not fire on the
    // other side.
    if (down) {
      const step = stepDown(down, dt, DEFAULT_DOWN_CONFIG)
      down = step.down
      if (step.respawnNow) recover()
      avatar.setSquash(collapseSquash(down, DEFAULT_DOWN_CONFIG))
      // The one thing that keeps moving. The 'down' burst is the punctuation of the event,
      // not the world carrying on.
      effects.advance(dt)
      hud.update(hudModelFor(player, encounter.playerHealth, {
        focus: focus.max > 0 ? focus.value / focus.max : 0,
        avatarCharge: armFraction(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
        avatarActive,
      }, fadeOpacity(down, DEFAULT_DOWN_CONFIG)))
      return
    }
```

- [ ] **Step 6: Enter the state**

At the very end of `update(dt)`, after the `for (const enemy of encounter.enemies) { ... lerp.record(...) }` loop:

```ts
    // Detected last, so the killing hit still pays its ordinary damageDrain and impact
    // effect on this frame: one normal step, then the beat. The 'down' burst is the same
    // one an enemy gets, because §4.6 says both sides of the fight go down rather than die.
    if (!down && isDowned(encounter.playerHealth)) {
      down = startDown()
      effects.add(createImpact(player.position, 'down'))
    }
```

- [ ] **Step 7: Typecheck and run the suite**

```bash
npm run typecheck && npm test
```

Expected: no type errors, everything green. No test covers this wiring; this step only proves nothing else broke.

- [ ] **Step 8: Verify in the running game**

Start the dev server through the preview tooling (`preview_start`, not Bash) and drive it. Walk east into the spear patrol on the home island and let them hit you five times.

Check all five:

1. The screen blacks out over roughly 0.6s and the world holds mid-stride.
2. You come back at the island spawn, at full health, with the Focus bar empty.
3. The enemies still carry the damage you did and are still where they were.
4. Do it a second time. It works again — no stuck state, no frozen world.
5. Hold `Space` through the blackout. No jump fires when you come back.

If any of these fail, fix it and re-verify before committing. Do not commit on an unverified beat — a frozen world with no way out is the one failure mode this feature can produce, and it is not covered by a test.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts src/player/controller.ts
git commit -m "Stand the player back up after going down"
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/design/aang-playable-character.md` (§6)
- Modify: `README.md`
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: the behaviour built in Tasks 1–3.
- Produces: nothing.

- [ ] **Step 1: Add the missing failure state to the design document**

In `docs/design/aang-playable-character.md` §6, insert as the **second** bullet — directly after "Falling is not death" and before "Drowning is a soft fail", so the three failure states sit together:

```markdown
- **Going down is a setback, not a reload.** Health reaching zero drops Aang for a beat and
  then stands him back up at the last island he was on, at full health and with Focus emptied.
  He is downed, exactly as his enemies are downed, and for the same reason: nothing in this
  game dies. The fight he left keeps whatever state he put it in, so walking back in is the
  cost, along with everything the meter had accumulated.
```

- [ ] **Step 2: Add a sentence to the README**

In `README.md`, the paragraph beginning "A patrol of spear infantry holds the east side" ends with "...a downed soldier stays lying where the air put them." Append one sentence to that paragraph:

```markdown
It cuts both ways: run your own health out and you go down too, waking up back at the island
with a full bar of health, an empty bar of Focus, and the patrol exactly as you left it.
```

- [ ] **Step 3: Add an entry to the handoff**

In `docs/HANDOFF.md`, add at the end of the "What has been built" section, immediately before the `## What has NOT been built` heading:

```markdown
**Going down.** `src/player/down.ts` is the system `health.ts` was waiting for when it said
standing a downed combatant back up is "a decision for a system above this one". Health at
zero freezes the simulation for 1.5 seconds, fades to black, and stands the player back up at
`lastGroundIslandId` at full health with Focus wiped — reusing `safeRespawn`, the same path
falling out of the world already takes. The fight is left untouched, so respawning is a free
heal and attrition-by-dying is technically viable; that was accepted rather than overlooked,
because closing it means resetting an encounter and nothing else in this codebase resets.

The beat is a pure timer with no scene in it, so all of its behaviour is in
`down.test.ts` — including the non-finite guard, which fails *open*. A clamped timer would
leave the player in a permanently frozen world with no input, and that is the only way this
feature can break badly. The `main.ts` wiring has no test, as usual for that file; it was
verified in the running game.

There is no collapse animation — the model still ships only idle, walk, run, fall and glide,
so the sink is driven through the squash channel that jump charging uses. A real clip is
the obvious follow-up. Spec:
[`docs/superpowers/specs/2026-08-05-player-down-design.md`](superpowers/specs/2026-08-05-player-down-design.md).
```

- [ ] **Step 4: Commit**

```bash
git add docs/design/aang-playable-character.md README.md docs/HANDOFF.md
git commit -m "Document going down"
```

---

## Out of scope

Carried from the spec, so nobody adds them here:

- A downed-and-recover window in place, with a Focus cost to stand up.
- A real collapse animation clip.
- Resetting the encounter, and with it any answer to attrition-by-dying.
- A death screen, retry prompt, or lives.
- Persisting anything about the down.
- Enemies recovering from their own downed state.
