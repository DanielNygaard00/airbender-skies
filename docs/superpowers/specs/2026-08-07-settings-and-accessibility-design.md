# Settings And Accessibility

## The problem

There are no settings at all.

`MOUSE_SENSITIVITY = 0.0022` is a module constant in `src/core/input.ts`. There is no way to
change it, no way to invert the vertical axis, no volume control and no mute — the wind and the
combat voices play at whatever `windVolumeForSpeed` decides and that is the end of it. Sensitivity
is the first thing most players change in a mouse-look game and volume is the one whose absence
gets a tab closed.

And nothing is optional about the game's motion. Camera shake, hitstop, a full-screen red hurt
flash, the Avatar State's gold vignette and the dash's FOV kick all fire unconditionally.
`prefers-reduced-motion` is read nowhere in the codebase.

## Two findings that shape the design

**Pointer lock hides the cursor, so mouse-driven settings are impossible until the lock is
released.** This is what would otherwise force keyboard-only controls. The way out composes with
the pause cycle rather than fighting it: `pauseReason` orders its causes `guide`, then `hidden`,
then `unlocked`, so if opening the guide calls `document.exitPointerLock()`, the cursor returns,
the reason stays `guide`, and the pause card stays hidden because the guide already fills the
screen. Closing the guide leaves the player unlocked, which drops them into exactly the
click-to-resume flow Escape already uses.

That also settles the panel's own warning. `src/ui/guide/panel.ts` keeps `pointer-events: none`
so it "can never swallow a click meant for the canvas underneath — that would break pointer
lock." The concern is a panel intercepting the click that *requests* the lock. Here the lock is
deliberately gone and the game is paused, so the settings rows can take pointer events safely.
The rest of the panel keeps `pointer-events: none`; only the rows opt in.

**The dash FOV kick belongs under reduce-motion.** A field-of-view punch is a more aggressive
vestibular trigger than the vignette, and it was missing from the first list of effects. Five
effects, not four.

## The change

### `src/core/settings.ts` — new, pure, tested

```ts
export interface Settings {
  /** Multiplier on the base look speed. 1 is the shipped feel. */
  sensitivity: number
  invertY: boolean
  /** 0 to 1. */
  volume: number
  muted: boolean
  reduceMotion: boolean
}

export interface MotionScales {
  shake: number
  hurtFlash: number
  dashKick: number
  hitstop: number
  vignette: number
}

export function defaultSettings(prefersReducedMotion: boolean): Settings
export function readSettings(raw: unknown, prefersReducedMotion: boolean): Settings
export function effectiveVolume(s: Settings): number
export function motionScales(s: Settings): MotionScales
```

Defaults: `sensitivity` 1, `invertY` false, `volume` 0.7, `muted` false, `reduceMotion` from the
media query.

`sensitivity` is a **multiplier**, not a replacement. `MOUSE_SENSITIVITY` 0.0022 is demoted from
the value to the base the multiplier scales, so the shipped feel is exactly `1` and a player who
never opens the panel is unaffected. Range 0.25 to 4, clamped.

`effectiveVolume` returns 0 when muted, and `volume` otherwise. Mute does not overwrite `volume`,
so unmuting restores what the player had rather than a default.

**`motionScales` returns five named scalars rather than one number, and they are deliberately not
uniform:**

| Effect | Normal | Reduced | Why |
| --- | --- | --- | --- |
| `shake` | 1 | **0** | The primary vestibular trigger. Off, not softened. |
| `hurtFlash` | 1 | **0** | A full-screen red pulse. Closer to photosensitivity than motion, and the same switch is the right home for it. |
| `dashKick` | 1 | **0** | A FOV punch, the other strong vestibular trigger. |
| `hitstop` | 1 | **0.4** | Softened, not removed. Hitstop is the main signal that a hit landed; removing it costs legibility rather than buying comfort, and a freeze is the absence of motion. |
| `vignette` | 1 | **0.35** | Softened. It marks the Avatar State being active, which the player needs to know. |

A single scalar applied to all five would be simpler and wrong: it would either delete the two
signals the player needs or leave the three triggers running.

### Persistence — its own key, not `SaveData`

`airbender-skies:settings:v1`, reusing the existing `StorageLike` interface and the same
never-throws pattern `loadSave` already uses.

Deliberately separate from `SAVE_KEY`. Progress and preferences have different lifetimes: a player
who clears their shrines should not lose their sensitivity, and `SaveData` is versioned on its own
schedule. `readSettings` is tolerant field by field, so junk in one field falls back to that
field's default and leaves the others alone — a whole-object fallback would let one bad number
reset everything.

### Three delivery paths, each to where the value is consumed

- **`InputTracker`** gains a setter for sensitivity and invert. It is already a class with mutable
  state, so this is its natural shape. The `mousemove` handler multiplies by the sensitivity and
  flips the pitch sign when inverted.
- **Both audio modules** gain `setVolume(v: number)`. `createWindAudio` already holds a `GainNode`
  and `createCombatAudio` a `master` gain; each scales its own output by the effective volume.
  No-ops with no context, matching every other method there.
- **The five motion scalars** are read per frame in `src/main.ts`, at the points those effects are
  already applied. Nothing new is threaded into the simulation — every one of the five is a
  render-time or presentation concern.

### The panel

A settings section in the guide, built the way `hud.ts` splits: a pure tested view-model
(`settingsRows(settings)`) and a thin DOM half. The rows take pointer events; the rest of the
panel does not.

Changing a setting writes it through immediately and persists it — no apply button, because
nothing here is expensive enough to batch and an apply button is a state machine that can
disagree with itself.

## Out of scope

- **Key rebinding.** A real feature with its own storage shape, conflict detection and display
  problems. `InputTracker` reads `event.code`, so the physical WASD positions already work on
  AZERTY and Dvorak, which is the part that matters most.
- **Gamepad support.** Named in the same analysis as this cycle, and genuinely separate work.
- **A FOV slider and quality settings.** Both are real gaps; neither is accessibility, and quality
  settings want a performance pass to have numbers to aim at.
- **Separate music and SFX sliders.** There is no music.

## Testing

- `readSettings` against junk in **each field independently** — a string sensitivity, a
  `NaN` volume, a null invert, a missing key, a whole non-object — asserting the other fields
  survive. This is what the field-by-field claim rests on, and a single "corrupt input gives
  defaults" test would pass a whole-object fallback.
- `sensitivity` clamped at both ends, asserted at the bounds and just past them.
- `effectiveVolume` is 0 when muted **and `volume` is unchanged by muting**, so unmuting restores
  the player's value. The second half is the one a wrong implementation fails.
- `motionScales` asserted **per effect**, both normal and reduced. A test asserting only that
  reduced values are lower would pass a single uniform scalar, which is the implementation this
  design explicitly rejects.
- `defaultSettings(true)` differs from `defaultSettings(false)` in `reduceMotion` and **nothing
  else**, so the media query cannot quietly change volume or sensitivity.
- **The load-bearing integration claim: opening the guide releases pointer lock, and
  `pauseReason` still returns `'guide'` rather than `'unlocked'`.** That interaction is what makes
  the cursor available without the pause card appearing, and it spans two modules that were
  written in different cycles. `pause.ts` is already tested, so this is asserted at the
  `pauseReason` level with both inputs set, not through the DOM.
- `settingsRows` renders every setting, so a field added to `Settings` without a row is visible.

Not tested, each for a stated reason: the guide's DOM half and the settings rows' event handlers
(no DOM in the node environment), `setVolume` on either audio module (no `AudioContext`, and a
mock would test the mock), and `main.ts`'s wiring (untested today and unchanged by this cycle).

## What will not be verified

Whether any of it feels right, and specifically whether `sensitivity` 1 is a good centre for a
0.25–4 range — that depends on the base 0.0022 being a sensible default, which no human has
judged. The reduce-motion scalars 0.4 and 0.35 are argued guesses. And the pointer-lock release
on opening the guide cannot be exercised here at all: this environment never receives OS focus, so
`requestPointerLock` always errors and there is no lock to release. That is the same limitation
the pause cycle recorded, and it lands on this cycle's central interaction.
