# The Pause And The Front Door

## The problem

Three related holes, all in the layer between the browser and the game.

**Escape does not pause.** Escape is the browser's own pointer-lock release key, and nothing
in this codebase listens for `pointerlockchange` — grepped across `src/`, there is no
handler anywhere. `src/ui/guide/panel.ts:195` handles Escape only when the guide is already
open, so pressing it during play releases the mouse and the simulation carries on: the look
direction freezes wherever it was, and the patrol keeps closing while the player has no way
to aim. Every mouse-look browser game pauses here.

**There is no front door.** `index.html` is a canvas, a fallback `div`, and a module script.
The game starts simulating before the player has clicked anything, and nothing on screen says
that a click is what grabs the mouse. The audio unblock already rides the first canvas click
(`main.ts`, `{ once: true }`), so a click gate is where that gesture belongs anyway.

**Audio outlives the tab.** `createWindAudio`'s gain is written only inside `update()`, which
is called from the render callback, which stops when the tab is hidden — browsers suspend
`requestAnimationFrame` in hidden tabs, as this repo's own handoff records. The `GainNode`
holds its last value, so backgrounding the tab mid-glide leaves that airspeed's roar playing.
There is no `visibilitychange` handler and neither audio module exposes a way to stop.

## What is deliberately not assumed

The obvious simplification is that hiding a tab releases the pointer lock, which would make
`pointerlockchange` the single signal for both cases. That may well be true, but **it cannot
be verified in this environment**: the harness never receives OS focus, so
`requestPointerLock` always errors and there is no lock to observe being released. This
design therefore treats `documentHidden` as its own input, and is correct whether or not the
browser also drops the lock. If it does, the two reasons simply coincide.

## The change

### `src/core/pause.ts` — new, pure, tested

Every reason the game might not be running, and one verdict:

```ts
export interface PauseInputs {
  pointerLocked: boolean
  documentHidden: boolean
  guideOpen: boolean
}

export type PauseReason = 'unlocked' | 'hidden' | 'guide'

/** True only when the mouse is captured, the tab is visible, and the guide is closed. */
export function isPlaying(i: PauseInputs): boolean

/** Which reason to show when several apply at once, or null while playing. */
export function pauseReason(i: PauseInputs): PauseReason | null

export interface OverlayModel {
  visible: boolean
  title: string
  action: string
  hint: string
}

/** The card's copy. `everStarted` chooses "play" from "resume". */
export function pauseOverlayModel(
  reason: PauseReason | null,
  everStarted: boolean,
): OverlayModel
```

`isPlaying` is the conjunction: `pointerLocked && !documentHidden && !guideOpen`.

`pauseReason` orders the causes `guide`, then `hidden`, then `unlocked`. The guide wins
because it is the only cause the player chose on purpose, and telling someone who opened the
guide that the game is paused for a different reason would be wrong. `hidden` beats
`unlocked` for the same reason the input exists at all: a hidden tab has almost certainly
also lost the lock, and the more specific cause is the more useful one.

`everStarted` is a parameter, not module state, so the wording stays a pure function of it.
The copy:

| Reason | `visible` | `title` | `action` |
| --- | --- | --- | --- |
| `null` | `false` | — | — |
| `unlocked`, never started | `true` | `Airbender Skies` | `Click to play` |
| `unlocked`, started | `true` | `Paused` | `Click to resume` |
| `hidden` | `true` | `Paused` | `Click to resume` |
| `guide` | `false` | — | — |

`hint` is `H — guide` whenever the card is visible.

The guide reason yields an invisible card deliberately: the guide already fills the screen
and already says "The game is paused" in its own subtitle. Two stacked panels saying the same
thing is a defect, not a belt-and-braces.

`hidden` sharing the started wording is also deliberate. Nobody is looking at a hidden tab, so
the copy only matters on the way back — at which point "Paused / Click to resume" is exactly
right. It is listed as its own row rather than folded into `unlocked` so that the table is a
total function of the reason, with no case left to the reader.

### `src/ui/pause-overlay.ts` — new, the DOM half

`createPauseOverlay(parent)` returning `{ update(model: OverlayModel): void, dispose(): void }`,
built the same way `createHud` is: a `<style>` element appended to `document.head` and a root
`div` appended to the parent.

**The card is `pointer-events: none`.** `src/ui/guide/panel.ts` carries the warning this
follows: a panel that can swallow a click meant for the canvas underneath breaks pointer lock.
The card therefore never handles its own click. The canvas's existing `click` listener calls
`requestPointerLock`, and the card comes down only when `pointerlockchange` reports that the
lock actually landed.

That ordering also absorbs a browser behaviour worth naming rather than fighting: after an
Escape-release, Chrome imposes a short cooldown during which `requestPointerLock` is rejected.
Because the card is driven by the event and not by the click, a rejected attempt simply leaves
the card up and the next click works. Correct by construction; nothing to catch.

Untested, like `createHud` and `createGuide`. The test environment is node
(`vitest.config.ts`), so there is no DOM for a view module to be tested against, and
everything in this pair that could be wrong in a way a test would catch lives in
`pause.ts`.

### Audio — `suspend()` and `resume()`

Both `createWindAudio` (`src/fx/audio.ts`) and `createCombatAudio`
(`src/fx/combat-audio.ts`) gain:

```ts
suspend(): void   // void context?.suspend()
resume(): void    // void context?.resume()
```

No-ops when `context` is null, which is the state both modules already fall back to when the
browser blocks audio, so a suspend on a game whose audio never started is harmless.

`start()` stays on the canvas click. It has to: it needs a user gesture, and
`pointerlockchange` is not one.

Both remain untested, for the reason `combat-audio.ts` already states in its own header —
there is no `AudioContext` in the node environment and a mock of one would only test the
mock.

### `src/main.ts` — the wiring

Three tracked booleans, fed by two new listeners plus the guide's existing accessor:

- `document.addEventListener('pointerlockchange', …)` sets `pointerLocked` from
  `document.pointerLockElement === canvas`.
- `document.addEventListener('visibilitychange', …)` sets `documentHidden` from
  `document.hidden`.
- `guideOpen` comes from `guide.isOpen()`, read per frame as it is today.

`frame()` gains one branch, and the guide's existing branch collapses into it, because the
treatment is already exactly what a pause needs:

```ts
function frame(now: number): void {
  const inputs = { pointerLocked, documentHidden, guideOpen: guide.isOpen() }
  const reason = pauseReason(inputs)
  overlay.update(pauseOverlayModel(reason, everStarted))
  if (reason !== null) {
    input.sample()          // drain the edges so a held key does not fire on resume
    last = now              // accumulate no time to lurch through
    renderer.render(scene, camera)
  } else {
    stepper.advance((now - last) / 1000)
    last = now
  }
  requestAnimationFrame(frame)
}
```

The branch is taken on `reason !== null` rather than on `!isPlaying(inputs)` so that only one
of the two functions decides whether the game runs. Both exist — `isPlaying` is the readable
name and the one other callers would want — but they must agree, and the way to keep them
agreeing is a test, not a second call site.

The scene still renders while paused, so the world stays visible behind the card — the
behaviour the guide branch already had, and the reason the card can afford to be small.

`everStarted` is set true the first time `pointerLocked` becomes true.

Audio follows the transition, not the state: on the edge into paused, `wind.suspend()` and
`combatAudio.suspend()`; on the edge into playing, `resume()` on both. Driving it from the
edge rather than calling `suspend()` every paused frame keeps the `AudioContext` state
machine out of a per-frame path, where a redundant `suspend()`/`resume()` pair on a context
mid-transition is exactly the sort of thing that produces an audible click.

## Out of scope

- **Settings, volume, and mouse sensitivity.** A later cycle. This one gives the pause state
  a home; a settings panel is what eventually lives inside it, and building the panel first
  would mean building it twice.
- **A full title screen.** One card with two texts, per the chosen option. The game's name on
  it is the whole of the branding this cycle adds.
- **Pausing on window blur without losing the lock.** Losing OS focus while keeping a pointer
  lock is not a state a browser produces; `blur` already clears the held-key set in
  `InputTracker`, which is the part that mattered.
- **`prefers-reduced-motion` and accessibility toggles.** A later cycle, and independent of
  this one.

## Testing

`src/core/pause.test.ts`:

- **All eight combinations of the three inputs, asserting `isPlaying` for each.** This is the
  shape that discriminates, and it is the point: a test that fixes `documentHidden` at
  `false` and varies only the other two passes an implementation that ignores
  `documentHidden` altogether. The named neutralisation is to delete one conjunct from
  `isPlaying` and confirm the suite reddens — once per conjunct, three runs, so no conjunct is
  load-bearing only in the author's head.
- **Reason precedence with several causes at once**, including all three true, asserting the
  full order rather than one pair. Deleting a branch from `pauseReason` must redden.
- **`isPlaying(i)` and `pauseReason(i) === null` agree across all eight combinations.** The
  two functions answer the same question and `main.ts` calls only one of them, so nothing else
  would notice them drifting apart. Asserted over the same table as the first item rather than
  on a hand-picked case, because a disagreement would appear in exactly one combination.
- **The two wordings**, asserted as the distinct strings a player reads: `everStarted` false
  gives `Click to play`, true gives `Click to resume`. Asserting only that the two differ
  would pass an implementation that swapped them.
- **The guide reason yields `visible: false`**, and a non-guide reason yields `visible: true`,
  so the invisible case cannot be a blanket "never visible".

Not tested, and each for a stated reason: `createPauseOverlay` (no DOM in the node
environment), the audio `suspend`/`resume` pair (no `AudioContext`, and a mock tests the
mock), and `main.ts`'s wiring (untested today, and this cycle does not change that — the
verdict logic it calls into is what moved into a tested module).

## What is not verified

Whether any of it feels right in a browser. Pointer lock cannot be held in this
environment at all, which is the same limitation the previous four cycles recorded, and it
bites harder here because pointer lock is this cycle's subject. Specifically unverifiable
here: that the card appears on Escape, that a click brings it down, that the Chrome
re-lock cooldown behaves as described, and that suspending the contexts actually silences a
backgrounded tab. All four are reasoned from documented browser behaviour and from this
repo's own recorded traps, and all four need a human at a keyboard.
