# In-Game Action Guide

**Date:** 2026-08-03
**Status:** Approved

## Overview

A panel, opened with `H`, listing every movement and action the player can perform —
what the key is, what it does, and whether it is available right now. It exists for two
audiences: a player who cannot remember what `Ctrl` does, and a tester who needs to know
whether a move failing is a bug or a rule.

The game currently has eleven inputs and several are context-dependent. `Space` alone
means jump, double jump, charged jump, deploy, or stow depending on state; `Ctrl` means
dive in the air but commits a Pressure Wave through a landing. None of that is
discoverable in-game, and the HUD's three meters are unlabelled bars.

Four decisions shape the design:

1. **Availability is live, and it calls the real predicates.** The guide asks
   `canDash`, `canAirJump` and `isArmed` — the same functions the game asks — rather than
   restating their rules. A guide that reimplements the rules will eventually lie about
   them, and a lying guide is worse than no guide for a tester.
2. **It pauses the game.** A tester will want it mid-flight, and reading while falling is
   not reading. Availability therefore shows a snapshot from the instant it opened.
3. **It owns its own key listener** and never touches `InputState`. See §4 — routing it
   through `InputState` invites a real bug.
4. **A test binds it to the README**, so the two control lists cannot silently diverge.

## 1. The action catalogue (`src/ui/guide/actions.ts`)

```ts
export type ActionMode = 'ground' | 'glider' | 'both'

export interface GameAction {
  /**
   * The physical key, spelled exactly as the README's controls table spells it.
   * The drift test in §6 compares these against that table.
   */
  key: string
  /** How it is pressed, when that distinguishes it from another action on the same key. */
  press?: string
  name: string
  /** One line on what it does. */
  detail: string
  mode: ActionMode
  /** Whether the player could use this at the instant the guide opened. */
  available(ctx: ActionContext): boolean
}

export interface ActionContext {
  player: PlayerState
  /** `canDash` and `canAirJump` both need it. */
  ground: GroundConfig
  /** For the Pressure Wave's fall-speed threshold. */
  wave: PressureWaveConfig
  /** A gust is off cooldown. Pre-computed by the caller — see below. */
  gustReady: boolean
  /** The Avatar State is armed and not already running. Pre-computed by the caller. */
  avatarStateReady: boolean
}

export const ACTIONS: readonly GameAction[]

/** Physical keys the catalogue uses, deduplicated. For the drift test. */
export function actionKeys(): string[]
```

**Why two pre-computed booleans rather than six objects.** Movement availability reads
`PlayerState`, which the guide already holds, so `canDash` and `canAirJump` are called
directly. Gust readiness lives on an `Encounter`, and Avatar State readiness on an
`AvatarState` plus its config — both are other systems' internal structs with no business
in a UI module. `main.ts` calls `canGust` and `isArmed` itself and passes the answers in.
Either way no rule is restated; the difference is only where the call sits.

**Two gates are unavoidably duplicated**, because no combined predicate exists to import:

- The dash's ground requirement. `canDash` covers only the chain count and recovery;
  `controllerStep` separately requires `grounded`. The catalogue's predicate is
  `player.mode === 'ground' && player.grounded && canDash(...)`, with a comment naming
  `src/player/controller.ts` as the original.
- The Pressure Wave's fall-speed threshold, `-player.velocity.y >= wave.minImpactSpeed`,
  which lives inside `detectSlam` and cannot be asked without a landing to test. Comment
  points at `src/player/slam.ts`.

Note `canDash` takes a `DashState` (`{ used, recovery }`), so the predicate maps from
`PlayerState`'s `dashesUsed` and `dashRecovery`.

### The catalogue's contents

| Key | Press | Mode | Name |
|---|---|---|---|
| Mouse | — | both | Look / trim |
| `W` / `S` | — | ground | Walk forward / back |
| `W` | — | glider | Airbending thrust |
| `S` | — | glider | Flare |
| `A` / `D` | — | ground | Strafe |
| `A` / `D` | — | glider | Weight shift — this is how you steer |
| `Shift` | tap | ground | Air scooter |
| `Shift` | hold | glider | Hover |
| `Q` | — | ground | Air blast dash |
| `F` | — | both | Gust |
| `E` | — | both | Avatar State |
| `Ctrl` | hold | glider | Tuck — fold the wings into a dive |
| `Ctrl` | hold through a landing | both | Pressure Wave |
| `Space` | tap | ground | Jump |
| `Space` | hold, then release | ground | Charged jump |
| `Space` | tap, airborne | ground | Double jump |
| `Space` | tap, airborne, jump spent | ground | Deploy the glider |
| `Space` | — | glider | Stow the glider |
| `H` | — | both | This guide |

Availability rules, beyond the two duplicated gates above:

- Walk, strafe, look, flare, weight shift, tuck, stow: available whenever their mode is
  the current one. There is no state that forbids them.
- Air scooter: `mode === 'ground' && grounded`.
- Thrust and hover: `mode === 'glider' && player.breath > 0`.
- Jump and charged jump: `mode === 'ground' && grounded`.
- Double jump: `!grounded && canAirJump(player, ground)`.
- Deploy: `!grounded && !canAirJump(player, ground)` — the escalation chain means the air
  jump must be spent first. This is why the combo in §2 takes two presses.
- Gust: `gustReady`. Avatar State: `avatarStateReady`. This guide: always.

## 2. The reference sections (`src/ui/guide/reference.ts`)

Static data, no availability. Three exports.

```ts
export interface Combo {
  name: string
  /** Physical keys used, in order. Checked against the catalogue by the drift test. */
  keys: string[]
  detail: string
}
export const COMBOS: readonly Combo[]

export interface MeterNote {
  name: string
  detail: string
}
export const METERS: readonly MeterNote[]

export const WIND_LEGEND: Record<WindKind, string>
```

**Combos are structured rather than prose** so the drift test can check that every key
they name exists in the catalogue. Contents: dive → slam → double jump → deploy;
deploying out of a rising double jump, which climbs higher than either move alone;
the three-dash chain into its recovery.

**Meters** covers Breath (flight and dash fuel, spent by thrust and fastest by hover,
refills when unspent), Focus (builds from clean traversal and combat chains, drains on
damage, arms the Avatar State at maximum), and health (small, regenerates out of combat,
enemies are downed rather than killed).

**`WIND_LEGEND` is typed as `Record<WindKind, string>`**, so adding a sixth wind kind
fails to compile until it is documented. This is deliberately a type constraint rather
than a test — the compiler is the cheaper and stronger guard.

## 3. The view model and panel (`src/ui/guide/panel.ts`)

Split the way `hud.ts` already splits: a pure model function, then the DOM.

```ts
export interface GuideRow {
  key: string
  press?: string
  name: string
  detail: string
  available: boolean
}

export interface GuideModel {
  ground: GuideRow[]
  glider: GuideRow[]
  /** Which mode the player is in, so the panel can emphasise that column. */
  current: PlayerMode
  combos: readonly Combo[]
  meters: readonly MeterNote[]
  wind: Record<WindKind, string>
}

export function guideModelFor(ctx: ActionContext): GuideModel

export function createGuide(parent: HTMLElement, onToggle: () => void): {
  isOpen(): boolean
  open(): void
  close(): void
  toggle(): void
  update(model: GuideModel): void
  dispose(): void
}
```

Actions with `mode: 'both'` appear in both columns. The column matching `current` is
emphasised; the other is dimmed as a whole, which is how the panel says "these are your
options right now" without hiding the rest.

An unavailable row is dimmed and struck through rather than hidden — a tester needs to
see that dash exists and is currently impossible, not that it has vanished.

There is deliberately no `FlightConfig` in the context. Thrust and hover gate on
`player.breath > 0`, which needs no config, and adding a field no predicate reads would
be exactly the dead config this project has already had to delete once.

`createGuide` installs its own `keydown` listener for `KeyH` and `Escape` and returns a
`dispose` that removes it. The flow on open is: the listener flips the panel's own state,
then calls `onToggle`; `main.ts`'s callback builds a fresh `GuideModel` and calls
`update(model)`. The panel therefore never reaches for game state itself — it is handed
what to draw, like the HUD.

There is no close button. The panel is keyboard-only by design, which is why
`pointer-events: none` is safe: it can never swallow a click meant for the canvas, so it
cannot break pointer lock.

Styling follows `hud.ts`: one injected `<style>` block, a fixed-position panel, a
translucent dark backdrop, `pointer-events: none` on everything (the panel is read-only,
so it never needs to swallow a click and never interferes with pointer lock).

## 4. Pausing, and the bug this design avoids

The obvious implementation is to hoist `input.sample()` out of `update` so a paused loop
can still read keys. **That would be a bug.** `createStepper` runs fixed sub-steps and may
call `update` more than once per rendered frame; one sampled state shared across sub-steps
would let an edge-triggered action fire twice, so a single `Space` could spend two jumps.

So the guide's keys bypass `InputState` entirely, exactly as the canvas already handles
its pointer-lock click directly. `InputState` and `toInputState` are unchanged.

`main.ts`'s frame function becomes:

```ts
function frame(now: number): void {
  if (guide.isOpen()) {
    // Drain the edges so a jump pressed just before opening does not fire on close.
    input.sample()
    // No time accumulates while paused, so nothing lurches when it closes.
    last = now
    renderer.render(scene, camera)
  } else {
    stepper.advance((now - last) / 1000)
    last = now
  }
  requestAnimationFrame(frame)
}
```

The model is rebuilt once on open (in the `onToggle` callback), not per frame — the
simulation is frozen, so there is nothing to refresh.

## 5. The HUD hint (`src/ui/hud.ts`)

`HudModel` gains nothing. `createHud`'s markup gains one static element,
`<div class="hud-hint">H — guide</div>`, styled small and dim. It is static text with no
model field because it never changes; adding it to `HudModel` would be a field that is
always the same string.

## 6. Testing

Vitest, colocated. The suite must avoid the four failure modes in `docs/HANDOFF.md`, and
each test is to be verified by neutralising the rule and confirming it goes red.

`actions.test.ts`:

- Dash is available standing on the ground; unavailable in mid-air; unavailable once the
  chain is spent; unavailable during recovery.
- Double jump is available airborne with the jump unspent, and unavailable once spent.
- Deploy is the mirror: unavailable with the jump unspent, available once spent. Asserted
  together with double jump in one test, because the pair being mutually exclusive is the
  actual rule and testing them apart would let both be true.
- Thrust and hover are unavailable at zero breath.
- The air scooter is unavailable in mid-air.
- Pressure Wave is unavailable while grounded, unavailable falling slower than
  `minImpactSpeed`, available falling faster.
- Every action in the catalogue reports *some* availability without throwing for a
  default ground state and a default glider state — a cheap guard against a predicate
  that reads a field its mode does not have.
- **Drift test:** `actionKeys()` equals the set of keys parsed from the README's controls
  table. Both directions, with a failure message naming which side is missing what.
  Note the table is not uniformly formatted: every key is in backticks except `Mouse`,
  which is bare. The parser must strip backticks when present rather than require them,
  or the test fails on a row that is perfectly correct. Read the README relative to the
  test file with `fileURLToPath(new URL(...))`, as `glide-pose.test.ts` already does for
  the model file — vitest's `node` environment allows it, and the test-only tsconfig pass
  is what makes Node globals visible.
- **Combo drift test:** every key named in `COMBOS` appears in the catalogue.

`panel.test.ts`:

- `guideModelFor` puts a `mode: 'both'` action in both columns and a `mode: 'ground'`
  action only in the ground column.
- `current` reflects the player's mode.
- An unavailable action is present in the model with `available: false` rather than
  omitted — the panel dims rather than hides, and a tester must still see it.
- The wind legend passes through with all five kinds.

`createGuide` and the DOM are not unit-tested, matching how `createHud` is left alone;
vitest runs in the `node` environment.

## 7. Documentation

`README.md`'s controls table gains an `H` row. Without it the drift test fails, which is
the intended behaviour — the test exists to force exactly this update.

`docs/HANDOFF.md` gains a line under what is built.

## Out of scope

- **No auto-show on first load.** It would need a save-schema change to avoid nagging on
  every visit, and the HUD hint makes it discoverable without one.
- **No key rebinding, and no controller support.** The catalogue's `key` fields are
  display strings, not a binding table.
- **No teaching of the wind system**, only labels for the five clouds. Explaining lift
  and ridge behaviour is a tutorial, which is a different piece of work.
- **No pause menu.** `H` pauses as a side effect of reading; there is no resume button,
  no settings, and no quit.
- **Availability does not animate.** Because the game is frozen, the panel shows the
  instant it opened.
