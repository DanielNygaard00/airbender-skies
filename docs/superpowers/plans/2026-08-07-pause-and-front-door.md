# The Pause And The Front Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pause the game whenever the mouse is not captured, gate the first frame behind a click-to-play card, and stop the audio when the tab is hidden.

**Architecture:** One pure tested module (`src/core/pause.ts`) decides whether the game runs and what the card says, from three booleans. A thin untested view (`src/ui/pause-overlay.ts`) draws the card, following the split `hud.ts` already uses. `main.ts` feeds the module from two new document listeners and the guide's existing accessor, and its `frame()` gains a single branch that absorbs the guide's existing pause branch.

**Tech Stack:** TypeScript 7.0.2, three.js 0.185.1, Vitest 4.1.10 (node environment), Vite.

## Global Constraints

- **Test environment is node** (`vitest.config.ts`: `environment: 'node'`). There is no DOM and no `AudioContext`. Modules that touch either are not unit-tested; the logic they call into must live in a pure module that is.
- **Typecheck is two passes:** `npm run typecheck` runs `tsconfig.json` then `tsconfig.test.json`. App code cannot see Node globals; only tests can. `noUncheckedIndexedAccess` is on, so indexed access is `T | undefined`.
- **Comments explain *why*, not *what*.** Match the surrounding style: derive expectations from data rather than restating literals, and mark regression guards as such.
- **Every measured number in a comment must also be asserted somewhere.** This repo has had wrong numbers survive review as prose above code that nobody re-derived. A number in a comment and nowhere else is a plan failure.
- **After writing a test, neutralise the feature and confirm the test goes red.** Not "reason about whether it would catch it" — make the change, run the suite, watch it redden, revert. If it stays green the test is decorative. This project has recorded nine assertions that could not fail; do not add a tenth.
- **The pause card must be `pointer-events: none`.** `src/ui/guide/panel.ts` carries the reason: a panel that can swallow a click meant for the canvas breaks pointer lock.
- **Never commit to `main`.** Work happens on the `pause-and-front-door` branch, which already exists and is checked out.
- **Copy strings are exact.** Title `Airbender Skies` before first play, `Paused` after. Action `Click to play` before first play, `Click to resume` after. Hint `H — guide` (an em dash, U+2014) whenever the card is visible.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/pause.ts` | **New.** `PauseInputs`, `PauseReason`, `pauseReason`, `OverlayModel`, `pauseOverlayModel`. Pure. No DOM, no imports beyond types. |
| `src/core/pause.test.ts` | **New.** The eight-combination truth table, reason precedence and reachability, and the two wordings. |
| `src/ui/pause-overlay.ts` | **New.** `createPauseOverlay(parent)` → `{ update, dispose }`. DOM only, untested, mirrors `createHud`. |
| `src/fx/audio.ts` | **Modify.** Add `suspend()` and `resume()` to the returned object. |
| `src/fx/combat-audio.ts` | **Modify.** Add `suspend()` and `resume()` to the returned object. |
| `src/main.ts` | **Modify.** Two document listeners, an `everStarted` flag, the overlay, audio edge transitions, and the rewritten `frame()`. |
| `README.md` | **Modify.** Note that Escape pauses. |
| `docs/HANDOFF.md` | **Modify.** Record the cycle, and what stayed unverified. |

---

### Task 1: The pause verdict and the card's copy

**Files:**
- Create: `src/core/pause.ts`
- Test: `src/core/pause.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PauseInputs { pointerLocked: boolean; documentHidden: boolean; guideOpen: boolean }`
  - `type PauseReason = 'unlocked' | 'hidden' | 'guide'`
  - `function pauseReason(i: PauseInputs): PauseReason | null` — the single verdict. `null` means the game runs. There is deliberately **no** separate `isPlaying`: it would be a second independent implementation of the same question with only one production caller, so nothing would notice the two drifting apart.
  - `interface OverlayModel { visible: boolean; title: string; action: string; hint: string }`
  - `function pauseOverlayModel(reason: PauseReason | null, everStarted: boolean): OverlayModel`

- [ ] **Step 1: Write the failing tests**

Create `src/core/pause.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pauseReason, pauseOverlayModel, type PauseInputs, type PauseReason } from './pause'

/**
 * All eight combinations of the three inputs, built rather than hand-listed so no
 * combination can be quietly omitted.
 *
 * The exhaustive table is the point. A test that fixes `documentHidden` at false and
 * varies only the other two passes an implementation that ignores `documentHidden`
 * entirely -- which is precisely the input this design added on purpose, because the
 * browser behaviour that would have made it redundant could not be verified.
 */
const ALL_INPUTS: PauseInputs[] = [false, true].flatMap((pointerLocked) =>
  [false, true].flatMap((documentHidden) =>
    [false, true].map((guideOpen) => ({ pointerLocked, documentHidden, guideOpen })),
  ),
)

const label = (i: PauseInputs) =>
  `locked=${i.pointerLocked} hidden=${i.documentHidden} guide=${i.guideOpen}`

describe('pauseReason', () => {
  it('yields null for exactly one of the eight combinations, and it is the right one', () => {
    const playing = ALL_INPUTS.filter((i) => pauseReason(i) === null)
    // Asserted as which combination rather than as a count: a bare toHaveLength(1) would
    // pass an implementation where the wrong single combination is the playing one.
    expect(playing.map(label)).toEqual(['locked=true hidden=false guide=false'])
  })

  it('names a reason for every combination with any pausing cause', () => {
    for (const i of ALL_INPUTS) {
      const anyCause = !i.pointerLocked || i.documentHidden || i.guideOpen
      expect(pauseReason(i) !== null, label(i)).toBe(anyCause)
    }
  })

  it('prefers the guide over every other cause', () => {
    // The guide is the only cause the player chose on purpose, so telling someone who
    // opened it that the game is paused for some other reason would be wrong.
    expect(pauseReason({ pointerLocked: false, documentHidden: true, guideOpen: true }))
      .toBe('guide')
    expect(pauseReason({ pointerLocked: true, documentHidden: true, guideOpen: true }))
      .toBe('guide')
  })

  it('prefers hidden over unlocked', () => {
    // A hidden tab has almost certainly also lost the lock, and the more specific cause
    // is the more useful one to report.
    expect(pauseReason({ pointerLocked: false, documentHidden: true, guideOpen: false }))
      .toBe('hidden')
  })

  it('reports unlocked when that is the only cause', () => {
    expect(pauseReason({ pointerLocked: false, documentHidden: false, guideOpen: false }))
      .toBe('unlocked')
  })

  it('covers every reason across the table, so none is unreachable', () => {
    // A branch nothing can reach is dead code wearing a feature's clothes.
    const reasons = new Set(ALL_INPUTS.map(pauseReason))
    expect(reasons).toEqual(new Set<PauseReason | null>(['guide', 'hidden', 'unlocked', null]))
  })
})

describe('pauseOverlayModel', () => {
  it('is invisible while playing', () => {
    expect(pauseOverlayModel(null, false).visible).toBe(false)
    expect(pauseOverlayModel(null, true).visible).toBe(false)
  })

  it('is invisible for the guide, which is its own full-screen panel', () => {
    // Two stacked panels both saying the game is paused is a defect. The guide's own
    // subtitle already says it.
    expect(pauseOverlayModel('guide', true).visible).toBe(false)
  })

  it('names the game before the first play and says Paused after', () => {
    // Asserted as the exact strings a player reads, not as "the two differ": asserting
    // only difference would pass an implementation that swapped them.
    const first = pauseOverlayModel('unlocked', false)
    expect(first.visible).toBe(true)
    expect(first.title).toBe('Airbender Skies')
    expect(first.action).toBe('Click to play')

    const later = pauseOverlayModel('unlocked', true)
    expect(later.visible).toBe(true)
    expect(later.title).toBe('Paused')
    expect(later.action).toBe('Click to resume')
  })

  it('shows the resume wording when the tab comes back, whatever the reason was', () => {
    // Nobody reads a hidden tab, so this copy only matters on the way back -- at which
    // point it is a resume, not a first play.
    const back = pauseOverlayModel('hidden', true)
    expect(back.title).toBe('Paused')
    expect(back.action).toBe('Click to resume')
  })

  it('offers the guide key whenever the card is visible', () => {
    for (const reason of ['unlocked', 'hidden'] as const) {
      for (const everStarted of [false, true]) {
        expect(pauseOverlayModel(reason, everStarted).hint).toBe('H — guide')
      }
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/core/pause.test.ts --reporter=verbose`

Expected: FAIL — `Failed to resolve import "./pause"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/pause.ts`:

```ts
/**
 * Whether the game is running, and what the card over it says when it is not.
 *
 * Pure and tested because the two things that consume it are not: `main.ts` has no tests
 * and `src/ui/pause-overlay.ts` cannot have any, the test environment being node with no
 * DOM. Everything here that could be wrong in a way a test would catch lives here.
 */

/** Every reason the game might not be running. */
export interface PauseInputs {
  /** The canvas holds the pointer lock, so the mouse is aiming rather than pointing. */
  pointerLocked: boolean
  /** The tab is in the background. */
  documentHidden: boolean
  /** The guide panel is up, which was already a pause before this module existed. */
  guideOpen: boolean
}

export type PauseReason = 'unlocked' | 'hidden' | 'guide'

/**
 * Which cause to report when several apply, and null exactly when the game runs.
 *
 * One function for both questions -- "is it running" is `pauseReason(i) === null`. An
 * earlier draft also had an `isPlaying` returning the conjunction directly, which is a
 * second independent implementation of the same thing with only one production caller, so
 * nothing would have noticed the two drifting apart.
 *
 * The guide comes first because it is the only cause the player chose on purpose, and
 * `hidden` beats `unlocked` because a backgrounded tab has almost certainly lost the lock
 * as well, so the more specific cause is the more useful one.
 *
 * `documentHidden` is deliberately its own input rather than being folded into
 * `pointerLocked`. Hiding a tab very probably releases the pointer lock too, which would
 * make this input redundant -- but that could not be verified: the harness this was built
 * in never receives OS focus, so `requestPointerLock` always errors and there is no lock to
 * watch being released. Kept separate, the verdict is right either way, and if the browser
 * does drop the lock the two causes simply coincide.
 */
export function pauseReason(i: PauseInputs): PauseReason | null {
  if (i.guideOpen) return 'guide'
  if (i.documentHidden) return 'hidden'
  if (!i.pointerLocked) return 'unlocked'
  return null
}

export interface OverlayModel {
  visible: boolean
  title: string
  action: string
  hint: string
}

const HIDDEN: OverlayModel = { visible: false, title: '', action: '', hint: '' }

/** What a visible card always offers, alongside whatever brought it up. */
const HINT = 'H — guide'

/**
 * The card's copy, as a total function of the reason.
 *
 * The guide gets no card: it is already a full-screen panel whose own subtitle says the
 * game is paused, and a second panel over it saying the same thing would be a defect.
 */
export function pauseOverlayModel(
  reason: PauseReason | null,
  everStarted: boolean,
): OverlayModel {
  if (reason === null || reason === 'guide') return HIDDEN
  return everStarted
    ? { visible: true, title: 'Paused', action: 'Click to resume', hint: HINT }
    : { visible: true, title: 'Airbender Skies', action: 'Click to play', hint: HINT }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/core/pause.test.ts --reporter=verbose`

Expected: PASS, all cases.

- [ ] **Step 5: Neutralise each branch and confirm the suite reddens**

This is a required step, not a suggestion. For each edit below: make the edit, run `npx vitest run src/core/pause.test.ts`, confirm it **FAILS**, then revert the edit.

Each of `pauseReason`'s three guards, deleted one at a time — this is what proves no input is load-bearing only in the author's head, and `documentHidden` is the one that matters most, since it exists only because a browser behaviour could not be verified:

1. Delete `if (i.guideOpen) return 'guide'`
2. Delete `if (i.documentHidden) return 'hidden'`
3. Delete `if (!i.pointerLocked) return 'unlocked'`

Then the ordering: swap the `guideOpen` and `documentHidden` guards, confirm the precedence test fails, revert. Swap the `documentHidden` and `!pointerLocked` guards, confirm, revert.

Then the copy: swap the two branches of `pauseOverlayModel`'s ternary, confirm the wording test fails, revert. And make `pauseOverlayModel` return `HIDDEN` for `'hidden'` as well as `'guide'`, confirm the resume-wording test fails, revert.

Record in the task report which of the seven neutralisations reddened and which test caught each. **A neutralisation that leaves the suite green is a finding to report, not something to move past** — this project has recorded nine assertions that could not fail, every one of them found this way and none of them found by reasoning about whether the test looked adequate.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`

Expected: every existing test still passes; both typecheck passes clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/pause.ts src/core/pause.test.ts
git commit -m "One verdict for whether the game is running"
```

---

### Task 2: The card, and an off switch for the audio

**Files:**
- Create: `src/ui/pause-overlay.ts`
- Modify: `src/fx/audio.ts` (add to the returned object, beside `dispose`)
- Modify: `src/fx/combat-audio.ts` (add to the returned object, beside `dispose`)

**Interfaces:**
- Consumes: `OverlayModel` from `src/core/pause.ts` (Task 1).
- Produces:
  - `function createPauseOverlay(parent: HTMLElement): { update(model: OverlayModel): void; dispose(): void }`
  - `createWindAudio()` and `createCombatAudio()` both gain `suspend(): void` and `resume(): void`.

There are no tests in this task, and that is deliberate rather than an omission: the test environment is node, so there is no DOM for the overlay and no `AudioContext` for the audio. `src/fx/combat-audio.ts` already states this reason in its own header. Everything here that a test could catch was moved into `pause.ts` in Task 1.

- [ ] **Step 1: Create the overlay view**

Create `src/ui/pause-overlay.ts`:

```ts
import type { OverlayModel } from '../core/pause'

/**
 * The card shown when the game is not running.
 *
 * Untested, like `createHud` and `createGuide`: the test environment is node, so there is
 * no DOM to build against. The decision about what the card says, and whether it is shown
 * at all, lives in `src/core/pause.ts` and is tested there.
 */
const STYLE = `
.pause { position: fixed; inset: 0; display: grid; place-items: center;
  /* Never interactive. The canvas underneath owns the click that requests the pointer
     lock, and a panel that can swallow that click breaks the lock -- the same reason
     src/ui/guide/panel.ts gives for its own pointer-events: none. */
  pointer-events: none;
  background: rgba(11,16,32,.55); opacity: 0; transition: opacity .2s;
  font: 500 16px/1.5 system-ui, sans-serif; color: #f3f6fb; }
.pause.is-on { opacity: 1; }
.pause-card { text-align: center; padding: 28px 40px; border-radius: 12px;
  background: rgba(11,16,32,.72); box-shadow: 0 8px 40px rgba(0,0,0,.45); }
.pause-title { margin: 0 0 14px; font-size: 28px; font-weight: 600;
  letter-spacing: .01em; }
.pause-action { margin: 0; }
.pause-hint { margin: 14px 0 0; font-size: 13px; opacity: .5; }
`

export function createPauseOverlay(parent: HTMLElement) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'pause'
  root.innerHTML = `
    <div class="pause-card">
      <p class="pause-title" data-title></p>
      <p class="pause-action" data-action></p>
      <p class="pause-hint" data-hint></p>
    </div>
  `
  parent.append(root)

  const title = root.querySelector('[data-title]') as HTMLElement
  const action = root.querySelector('[data-action]') as HTMLElement
  const hint = root.querySelector('[data-hint]') as HTMLElement

  return {
    update(model: OverlayModel): void {
      root.classList.toggle('is-on', model.visible)
      // Written even while invisible, so the card never fades in showing the previous
      // reason's wording for the length of the transition.
      title.textContent = model.title
      action.textContent = model.action
      hint.textContent = model.hint
    },
    dispose(): void {
      root.remove()
      style.remove()
    },
  }
}
```

- [ ] **Step 2: Add `suspend` and `resume` to the wind audio**

In `src/fx/audio.ts`, insert these two methods into the returned object immediately before `dispose`:

```ts
    /**
     * Stop the audio clock. Called when the game pauses, which includes a hidden tab:
     * `update` is driven from the render callback, and a hidden tab stops receiving
     * animation frames, so without this the GainNode simply holds the last airspeed's
     * value and the roar carries on in the background.
     *
     * A no-op with no context, which is the state this module already falls back to when
     * the browser blocks audio, so pausing a game whose audio never started is harmless.
     */
    suspend(): void {
      void context?.suspend()
    },

    resume(): void {
      void context?.resume()
    },
```

- [ ] **Step 3: Add `suspend` and `resume` to the combat audio**

In `src/fx/combat-audio.ts`, insert these two methods into the returned object immediately before `dispose`:

```ts
    /**
     * Stop the audio clock, for the same reason `audio.ts` does: a paused or hidden tab
     * must not keep making noise. Any burst already scheduled resumes where it left off
     * rather than being cut, which is what suspending a context means.
     *
     * A no-op with no context, matching every other method here.
     */
    suspend(): void {
      void context?.suspend()
    },

    resume(): void {
      void context?.resume()
    },
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`

Expected: every existing test still passes; both typecheck passes clean. Nothing in this task is tested, so a green suite here means "nothing broke", not "this works" — say so plainly in the task report rather than reporting it as verification.

- [ ] **Step 5: Commit**

```bash
git add src/ui/pause-overlay.ts src/fx/audio.ts src/fx/combat-audio.ts
git commit -m "The card the player clicks, and an off switch for the audio"
```

---

### Task 3: Wire it into the game

**Files:**
- Modify: `src/main.ts` — imports at the top; the overlay beside `const hud = createHud(document.body)` at line 241; new listeners near `const input = new InputTracker(window, canvas)` at line 240; `frame()` at lines 884-899.
- Modify: `README.md` — the controls table's `H` row area, and the paragraph noting the guide.
- Modify: `docs/HANDOFF.md` — the "What has been built" section and the "Suggested next steps" list.

**Interfaces:**
- Consumes: `pauseReason`, `pauseOverlayModel` from `src/core/pause.ts` (Task 1); `createPauseOverlay` from `src/ui/pause-overlay.ts`, and `suspend`/`resume` on both audio modules (Task 2).
- Produces: nothing further consumes this.

- [ ] **Step 1: Add the imports**

In `src/main.ts`, beside the other `./core/*` and `./ui/*` imports:

```ts
import { pauseReason, pauseOverlayModel } from './core/pause'
import { createPauseOverlay } from './ui/pause-overlay'
```

- [ ] **Step 2: Create the overlay and track the three inputs**

After `const hud = createHud(document.body)` (line 241), add:

```ts
  const overlay = createPauseOverlay(document.body)
```

Then, after the `InputTracker` is constructed, add the two listeners and the flag:

```ts
  // Pointer lock is the signal for "the mouse is aiming rather than pointing", and losing
  // it is what Escape does. Before this, Escape released the mouse and the simulation
  // carried on: the look direction froze wherever it was and the patrol kept closing.
  let pointerLocked = document.pointerLockElement === canvas
  let documentHidden = document.hidden
  /** True from the first time the lock is actually held, which is what "play" means here. */
  let everStarted = pointerLocked
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas
    if (pointerLocked) everStarted = true
  })
  document.addEventListener('visibilitychange', () => {
    documentHidden = document.hidden
  })
```

- [ ] **Step 3: Rewrite `frame()`**

Replace the whole of `frame()` and the `let last` above it (lines 884-899) with:

```ts
  let last = performance.now()
  /** Whether the previous frame was running, so audio follows the edge and not the state. */
  let wasPlaying = false
  function frame(now: number): void {
    const reason = pauseReason({ pointerLocked, documentHidden, guideOpen: guide.isOpen() })
    overlay.update(pauseOverlayModel(reason, everStarted))
    const playing = reason === null
    if (playing !== wasPlaying) {
      // Driven from the transition rather than called every paused frame: suspend() and
      // resume() move an AudioContext through a state machine, and a redundant pair of
      // them on a context that is mid-transition is exactly what produces an audible click.
      if (playing) { wind.resume(); combatAudio.resume() }
      else { wind.suspend(); combatAudio.suspend() }
      wasPlaying = playing
    }
    if (!playing) {
      // Drain the input edges so a jump pressed just before pausing does not fire on
      // resume, and hold `last` at now so no time accumulates to lurch through when it
      // does. The scene still renders, so the world stays visible behind the card.
      // This is the treatment the guide branch already had; the guide is now one of the
      // reasons rather than the only one.
      input.sample()
      last = now
      renderer.render(scene, camera)
    } else {
      stepper.advance((now - last) / 1000)
      last = now
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`

Expected: every existing test passes; both typecheck passes clean.

- [ ] **Step 5: Verify the pieces that can be verified in a browser, and be explicit about the ones that cannot**

Start the dev server and load the page. Then:

**Verifiable here:** that the page loads without a console error, that the card is in the DOM with the first-play copy, and that the card does not intercept pointer events. Check by reading the DOM and the computed style:

```js
const card = document.querySelector('.pause')
JSON.stringify({
  onScreen: card.classList.contains('is-on'),
  title: card.querySelector('[data-title]').textContent,
  action: card.querySelector('[data-action]').textContent,
  hint: card.querySelector('[data-hint]').textContent,
  pointerEvents: getComputedStyle(card).pointerEvents,
})
```

Expected: `is-on` true, `Airbender Skies`, `Click to play`, `H — guide`, `pointerEvents: 'none'`.

Also confirm the simulation is genuinely held: read the player's altitude from the HUD twice, several seconds apart, and confirm it has not changed. Before this cycle the game simulated from the first frame, so a falling spawn would have moved.

**Not verifiable here, and it must be reported as unverified rather than assumed:** that Escape brings the card up, that a click takes it down, that Chrome's post-Escape re-lock cooldown behaves as the spec describes, and that suspending the contexts silences a backgrounded tab. This environment never receives OS focus, so `requestPointerLock` always errors — pointer lock is this cycle's whole subject and it is exactly what cannot be exercised. Do not dispatch a synthetic `pointerlockchange` event and report the result as verification of the browser's behaviour; a dispatched event tests this file's own listener, which is a different and much smaller claim. If you do exercise the listener that way, label it as exactly that.

- [ ] **Step 6: Update the README**

In the controls table, the `H` row currently reads:

```
| `H` | Guide — every action, and whether you can use it right now | Guide |
```

Add a row directly after it:

```
| `Escape` | Pause — releases the mouse; click to resume | Pause |
```

- [ ] **Step 7: Update the handoff**

In `docs/HANDOFF.md`, add to the "What has been built" section a short entry for this cycle covering: what the three holes were, that pointer lock is now the signal for whether the game runs, that `documentHidden` is a separate input because the tab-hiding behaviour could not be verified, and — plainly — which four claims stayed unverified because the harness cannot hold a pointer lock.

Remove nothing from the "Blockers and constraints" note about playtesting; this cycle does not change it.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts README.md docs/HANDOFF.md
git commit -m "Pause whenever the mouse is not captured"
```

---

## Self-review notes

**Spec coverage.** `pause.ts` → Task 1. `pause-overlay.ts` → Task 2. Audio `suspend`/`resume` → Task 2. `main.ts` wiring, including the audio edge transition and `everStarted` → Task 3. Each of the spec's testing bullets maps to a case in Task 1's Step 1. The spec's "out of scope" list adds no tasks by construction.

**A change this plan made to the spec rather than inheriting.** The spec's first draft had both an `isPlaying` and a `pauseReason` — two independent implementations of one question, with `main.ts` calling only one, plus a test whose sole purpose was stopping them drifting apart. Writing the tasks out made it obvious that the second predicate was the problem the test was there to solve, so `isPlaying` is gone and the spec was amended to match. Callers ask `pauseReason(i) === null`.

**Known gap, stated rather than papered over.** Task 3 has no test, because `main.ts` has none today and this cycle does not change that. What that means concretely: nothing automated catches a wiring mistake in `frame()` — a listener attached to the wrong target, `everStarted` set on the wrong edge, or the audio transition inverted. Task 3's Step 5 is the compensating check, and it is explicit about which of those it can and cannot reach. A reviewer should read `frame()` directly rather than treating a green suite as covering it.
