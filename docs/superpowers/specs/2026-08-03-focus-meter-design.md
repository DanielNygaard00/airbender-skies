# Focus and the Avatar State

**Date:** 2026-08-03
**Status:** Approved
**Implements:** §4.5 of `docs/design/aang-playable-character.md`, partially

## Overview

Focus is the second of the design document's three meters. Breath already exists and
governs moment-to-moment flight; Focus rewards sustained clean play, and holding it at
maximum arms the Avatar State.

The document specifies that Focus "spends on elemental heavy moves", and none of those
exist — water, earth, fire, Vortex and Pressure Wave are all unbuilt. So this spec
gives Focus its other sink instead: the Avatar State, which §4.5 defines as filling
"only from Focus held at maximum for a sustained period". That makes the meter mean
something the moment it ships rather than filling up with nothing to pay for.

Four decisions shape the design:

1. **Focus is world-scoped, not encounter-scoped.** It builds while flying, not only
   while fighting. The document lists "clean traversal" as a build source and §6 has
   drowning drain Focus, which is a traversal event; and with one encounter and
   thirteen islands, an encounter-scoped meter would be invisible almost everywhere.
2. **The Avatar State is armed by sustained maximum Focus and fired by the player.**
   The arming charge holds only while Focus stays pinned at maximum, so a single hit
   both drains Focus and disarms the state. This gives the situational choice §4.5
   asks for without becoming the farmable timer it rules out.
3. **The unbroken chain is the gain mechanism, not a separate counter.** Focus gains at
   a rate scaled by a ramp that grows with unbroken time. Breaking drains a chunk and
   resets the ramp.
4. **Effects are expressed as pure transforms of existing config and samples**, so the
   flight model, the combat model and the wind model are not modified to know about the
   Avatar State.

## 1. Module layout (`src/focus/`)

A new directory, mirroring the file-per-concern layout of `src/combat/`. Every module
is pure: no three.js scene access, no DOM, no time source of its own.

| File | Responsibility |
| --- | --- |
| `focus.ts` | The meter: value, maximum, chain time. Gain, drain, break, clamp. |
| `sources.ts` | Reads a frame and reports the traversal rate and the break signals. |
| `avatar-state.ts` | The arm-then-fire machine: arming charge, active timer, end signal. |
| `effects.ts` | The three effect transforms: gust boost, wind surge, breath refill. |
| `config.ts` | Tuning, with the reasoning in comments as elsewhere in the repo. |

### 1.1 `focus.ts`

```ts
export interface Focus {
  value: number
  max: number
  /** Seconds the chain has gone unbroken. Drives the gain ramp. */
  chainTime: number
}

export interface FocusInput {
  /** Focus per second from traversal. Negative when the player is idling. */
  ratePerSecond: number
  events: FocusEvents
  /** Avatar State is running: the meter holds still. */
  frozen: boolean
  /** Avatar State just ended: the meter empties. */
  reset: boolean
}

export function emptyFocus(c: FocusConfig): Focus
export function chainRamp(focus: Focus, c: FocusConfig): number
export function isFull(focus: Focus): boolean
export function stepFocus(focus: Focus, input: FocusInput, dt: number, c: FocusConfig): Focus
```

`chainRamp` grows linearly from 1 to `chainRampMax` over `chainRampSeconds` and then
holds. `isFull` is `value >= max`, not an exact comparison — the meter is clamped with
`Math.min`, so a full meter holds `max` exactly, but the inequality keeps the arming
rule safe against any future gain path that overshoots.

`stepFocus` resolves in a fixed order, and the order is load-bearing:

1. **`reset`** wins outright: value 0, chain 0. Nothing else applies.
2. **`frozen`** returns the meter untouched.
3. **Breaks** apply next. `playerHit` subtracts `damageDrain`; `fellOutOfWorld`
   subtracts `crashDrain`. Either sets `chainTime` to 0.
4. **Gains** apply last, scaled by the ramp computed *after* the break. So an enemy
   downed on the same frame the player is hit grants the unramped amount, because the
   chain really was broken that frame.
5. Value clamps to `0 … max`; `chainTime` advances by `dt` only if no break fired.

Gains are `ratePerSecond · ramp · dt`, plus `gustConnects · gustConnectGain · ramp`,
plus `downs · downGain · ramp`. The ramp applies to event gains as well as to the
traversal rate, because a chain of connecting gusts is exactly what §4.5 means by an
unbroken chain.

A negative `ratePerSecond` is multiplied by the ramp too. This is intentional and
worth stating: a long clean chain bleeds away faster once the player stops, so idling
costs more the better the run was.

### 1.2 `sources.ts`

```ts
export interface FocusEvents {
  /** Enemies a gust connected with this frame. */
  gustConnects: number
  /** Enemies downed this frame. */
  downs: number
  playerHit: boolean
  fellOutOfWorld: boolean
}

export function traversalRatePerSecond(
  player: PlayerState,
  inWind: boolean,
  flight: FlightConfig,
  c: FocusConfig,
): number

export function fellOutOfWorld(player: PlayerState, worldFloorY: number): boolean
```

`traversalRatePerSecond` reads only signals that already exist:

- **Gliding, airborne, above stall speed** → `glideGainPerSecond`, multiplied by
  `windGainMultiplier` when `inWind`. Riding the air is the skill the world was built
  to teach, so it pays roughly double.
- **On the ground with the air scooter active** → `scooterGainPerSecond · scooterCharge`.
  The scooter's hidden accumulator already measures a clean line; this reuses it rather
  than inventing a second measure of the same thing.
- **Anything else** — walking, standing, stalled, gliding below stall speed →
  `-idleDrainPerSecond`. There is no state that neither builds nor drains, so the meter
  can never be parked.

`fellOutOfWorld` mirrors the condition `controllerStep` uses to trigger a respawn
(`position.y < worldFloorY`). This is a deliberate, named duplication: the controller
resolves the respawn internally and returns an already-respawned state, so there is no
signal to observe after the fact. The function is exported and tested so the
duplication is visible rather than buried in `main.ts`, and it must be evaluated
*before* `controllerStep` runs.

### 1.3 `avatar-state.ts`

Named for the design document's term. Note the collision hazard: `src/player/avatar.ts`
is the character *model*, and has nothing to do with this file. The module header says
so.

```ts
export interface AvatarState {
  /** Seconds Focus has been pinned at maximum. Fills the arming charge. */
  armTime: number
  /** Seconds of Avatar State remaining. 0 means not active. */
  remaining: number
}

export interface AvatarStateStep {
  state: AvatarState
  /** The state is running this frame: effects apply. */
  active: boolean
  /** The state ended this frame: Focus empties. */
  justEnded: boolean
}

export function restingAvatarState(): AvatarState
export function isArmed(state: AvatarState, c: AvatarStateConfig): boolean
export function isActive(state: AvatarState): boolean
export function armFraction(state: AvatarState, c: AvatarStateConfig): number

export function stepAvatarState(
  state: AvatarState,
  focus: Focus,
  triggerPressed: boolean,
  dt: number,
  c: AvatarStateConfig,
): AvatarStateStep
```

Rules:

- **While active:** `remaining` decreases by `dt`. Reaching zero or below sets
  `remaining` to 0 and reports `justEnded`. `armTime` is 0 throughout, so the state
  cannot re-arm from the maximum Focus it is holding frozen.
- **While not active and Focus is full:** `armTime` accumulates. Armed once
  `armTime >= armSeconds`.
- **While not active and Focus is not full:** `armTime` resets to 0. This is the
  disarm rule — one spear hit drains Focus below maximum and the charge is gone.
- **Trigger:** `triggerPressed && isArmed(...) && !isActive(...)` starts the state with
  `remaining = durationSeconds` and `armTime = 0`.
- `active` is reported true on the frame the trigger fires, so effects apply from that
  frame onward with no dead frame.

### 1.4 `effects.ts`

Three pure transforms. None of them mutate their input.

```ts
/** Gust with the Avatar State's damage, knockback and no cooldown. */
export function boostedCombatConfig(c: CombatConfig, active: boolean): CombatConfig

/** The air taking Aang's side. `t` is 0 to 1. */
export function surgeWind(sample: WindSample, t: number, c: AvatarStateConfig): WindSample

/** Unlimited Breath, expressed as a full meter. */
export function refillBreath(player: PlayerState): PlayerState
```

`boostedCombatConfig` returns `c` unchanged when inactive — reference-identical, so the
common path allocates nothing. When active it multiplies `gust.damage` and
`gust.knockback` and sets `gust.cooldownSeconds` to 0.

`surgeWind` interprets §4.5's "every wind feature in the arena reacts to Aang", which
the document states as an effect rather than as a rule:

- `accel.y < 0` — a downdraft — is scaled toward zero by `relentFactor`. The air stops
  fighting him.
- Otherwise the whole `accel` is amplified by `surgeAccelMultiplier`. This covers
  thermals and ridge lift, and wind rivers too, whose acceleration is horizontal.
- `liftScale` becomes `Math.max(s.liftScale, lerp(s.liftScale, 1, t))`, so dead air
  relents toward normal lift. The `Math.max` guard means the transform can never
  *reduce* lift, whatever a future wind kind reports.

The consequence is deliberate: for the duration, the wind-as-terrain lesson is
suspended. A short, loud state in which the world stops resisting is the point.

`refillBreath` sets `breath` to `maxBreath`. Applied once per frame while active, this
is indistinguishable from a suspended drain, and it leaves the flight model untouched.
The two alternatives were both worse: a `FlightConfig` with a zeroed drain violates
`validateFlightConfig`'s own invariant that `hoverBreathPerSecond > breathDrainPerSecond`,
and threading a flag through `PlayerState` widens a struct that a dozen movement tests
build fixtures for.

### 1.5 `config.ts`

```ts
export interface FocusConfig {
  maxFocus: number
  glideGainPerSecond: number
  windGainMultiplier: number
  scooterGainPerSecond: number
  idleDrainPerSecond: number
  chainRampSeconds: number
  chainRampMax: number
  gustConnectGain: number
  downGain: number
  damageDrain: number
  crashDrain: number
}

export interface AvatarStateConfig {
  armSeconds: number
  durationSeconds: number
  gustDamageMultiplier: number
  gustKnockbackMultiplier: number
  surgeAccelMultiplier: number
  relentFactor: number
}
```

Defaults:

| Field | Default | Reasoning |
| --- | --- | --- |
| `maxFocus` | 100 | A percentage reads naturally in a bar. |
| `glideGainPerSecond` | 2.2 | Roughly 45 s of clean unramped gliding to fill, closer to 30 s once the ramp is up. Long enough that the meter is earned. |
| `windGainMultiplier` | 2 | Riding a feature is the skilled version of flying. |
| `scooterGainPerSecond` | 3.5 | At full accumulator, slightly better than gliding: the ground kit should not be strictly worse. |
| `idleDrainPerSecond` | 3 | Faster than the base gain, so standing still loses ground. |
| `chainRampSeconds` | 12 | Long enough to feel like a run rather than a rhythm. |
| `chainRampMax` | 1.8 | Meaningful without dwarfing the base rate. |
| `gustConnectGain` | 6 | Combat pays far better per second than traversal. |
| `downGain` | 14 | Downing one of three patrol members is visible progress. |
| `damageDrain` | 30 | Nearly a third of the meter: getting hit is the break. |
| `crashDrain` | 50 | Falling out of the world costs more than a spear. |
| `armSeconds` | 4 | Long enough that arriving at maximum is not instantly a trigger. |
| `durationSeconds` | 8 | Short and loud, per the document. |
| `gustDamageMultiplier` | 3 | Gust becomes a one-hit down (0.5 × 3 = 1.5 = enemy maximum health). |
| `gustKnockbackMultiplier` | 1.5 | Loud, without launching enemies out of the level. |
| `surgeAccelMultiplier` | 1.8 | Noticeable in flight without being uncontrollable. |
| `relentFactor` | 0.15 | Downdrafts nearly stop rather than fully invert. |

Every one of these is an argued guess. Nothing here has been played.

## 2. Reporting gust connects (`src/combat/encounter.ts`)

`EncounterStep` gains one field:

```ts
/** Enemies a gust connected with this frame, for feedback and for Focus. */
hitThisFrame: string[]
```

`stepEncounter` already computes the caught set inside its gust branch; this reports it
instead of discarding it. Empty array on frames with no gust. No behaviour changes.

## 3. Input (`src/core/types.ts`, `src/core/input.ts`)

`InputState` gains one field:

```ts
/** E, edge-triggered: enter the Avatar State when it is armed. */
avatarStatePressed: boolean
```

Edge-triggered and cleared by `sample()`, exactly like `gustPressed` and `dashPressed`,
including the `e.repeat` guard so a held key does not re-fire.

## 4. HUD (`src/ui/hud.ts`)

`HudModel` gains four fields:

```ts
/** 0 to 1. */
focus: number
showFocus: boolean
/** 0 to 1: the Avatar State arming charge. */
avatarCharge: number
avatarActive: boolean
```

`hudModelFor` gains an optional third parameter carrying the Focus and Avatar State
values, defaulting to absent so the HUD still works anywhere Focus is not running —
matching how health was added.

`showFocus` is true when `focus > 0` or the state is active, keeping the screen quiet
before the player has built anything.

Rendering:

- A **Focus bar** above breath, gold, same 180 × 8 geometry as the others.
- An **arming pip**: a thin strip under the Focus bar that fills with `avatarCharge`.
  It is only visible while the charge is non-zero, which happens only at maximum Focus,
  so its appearance is itself the signal that the state is coming.
- A **vignette**: a fixed full-screen inset box-shadow, faded in while `avatarActive`.
  Appended to the HUD root, `pointer-events: none`. The Focus bar switches to a
  brighter fill while active so the meter reads as a different thing rather than a full
  one.

## 5. Audio (`src/fx/audio.ts`)

`update` gains an optional second parameter:

```ts
update(airspeed: number, swell = 0): void
```

`swell` (0 to 1) adds to the gain target and opens the low-pass further, so the wind
rises during the state. Default 0 keeps every existing call site unchanged.

## 6. Wiring (`src/main.ts`)

Frame order, which resolves a circularity between the three systems:

1. `input.sample()`.
2. `fellOutOfWorld(player, ARCHIPELAGO.worldFloorY)` — evaluated **before**
   `controllerStep`, because the controller respawns internally.
3. `stepAvatarState(avatarState, focus, state.avatarStatePressed, dt, ...)`, using last
   frame's Focus. This yields `active` for the rest of this frame, so the effects apply
   from the triggering frame onward. The cost is one frame of latency on arming, which
   is imperceptible; the benefit is that no system needs a value that depends on
   itself.
4. `controllerStep(...)`, then `refillBreath(player)` when active.
5. `stepEncounter(..., boostedCombatConfig(DEFAULT_COMBAT_CONFIG, active))`.
6. `stepFocus` with the traversal rate, the frame's events, `frozen: active` and
   `reset: justEnded`.
7. `hud.update(hudModelFor(player, encounter.playerHealth, { focus, avatarState }))`.

Two dependency injections change:

- `deps.windAt` is wrapped so the sample is surged while active:
  `(p, f) => surgeWind(base(p, f), active ? 1 : 0, AVATAR_STATE_CONFIG)`. The closure
  reads the same `active` flag the rest of the frame uses. `inWind` for the Focus
  source is read from the unsurged base sample, so the surge cannot feed itself.
- Wind tells advance faster while active: `tell.advance(dt · WIND_TELL_SURGE)`. Visual
  only — `wind-tell.ts` states that nothing in it feeds back into flight, and that stays
  true.

Two presentation constants live in `main.ts` rather than in `FocusConfig` or
`AvatarStateConfig`, because they tune how the state *reads* rather than how it plays,
and the config modules should stay simulation tuning:

| Constant | Value | Effect |
| --- | --- | --- |
| `WIND_TELL_SURGE` | 2.5 | Mote drift speed while the state is active. |
| `AUDIO_SWELL` | 0.45 | Passed as `wind.update`'s `swell` while active. |

Focus is **not** persisted. It is a live meter, and `src/core/save.ts` is untouched.

## 7. Testing

Vitest, colocated `.test.ts` files per repo convention. The suite must avoid the four
failure modes recorded in `docs/HANDOFF.md`: no asserting against the config the code
reads, no tautologies, no bare `>` where a margin is meant, no assertion that holds
whether or not the feature works. Each test below is to be verified by neutralising the
relevant config value and confirming it goes red.

`focus.test.ts`:

- The ramp is 1 at zero chain time and `chainRampMax` at and beyond
  `chainRampSeconds`; asserted against intended literals.
- A frame of clean gliding gains the expected amount; the same frame after a long chain
  gains a materially larger amount — asserted as a ratio with a margin, not a bare `>`.
- `playerHit` drains and zeroes the chain; a down on the same frame grants the unramped
  amount, proving the ordering.
- `fellOutOfWorld` drains more than `playerHit`, by a margin.
- `frozen` leaves the meter bit-identical, including `chainTime`.
- `reset` empties value and chain even from full.
- Value never leaves `0 … max` under a large `dt` or a large drain.

`sources.test.ts`:

- Gliding above stall gains; gliding below stall drains.
- `inWind` multiplies the glide rate by the intended literal.
- Scooter rate scales with `scooterCharge`; a zero accumulator does not pay.
- Standing on the ground drains.
- `fellOutOfWorld` is true below the floor and false above it.

`avatar-state.test.ts`:

- Sustained full Focus arms after `armSeconds` and not before.
- Focus dropping below full mid-charge resets `armTime` to zero — the disarm rule.
- A trigger while unarmed does nothing.
- A trigger while armed reports `active` on that same frame.
- The state runs for its duration and reports `justEnded` exactly once.
- A trigger while already active does not extend it.
- `armTime` stays zero throughout an active state, so it cannot re-arm from the frozen
  maximum.

`effects.test.ts`:

- `boostedCombatConfig` returns the identical object when inactive.
- When active, gust damage reaches the enemy's full health in one hit — asserted
  against `DEFAULT_COMBAT_CONFIG.enemy.maxHealth`, which is the claim, not the input.
- `surgeWind` amplifies an updraft and a horizontal river, and scales a downdraft
  toward zero.
- `surgeWind` raises dead air's `liftScale` toward 1, and never reduces a `liftScale`
  it is given.
- `surgeWind` at `t = 0` returns the sample unchanged.
- `refillBreath` fills a drained meter and leaves `maxBreath` alone.

`encounter.test.ts` addition: a connecting gust reports the caught enemies in
`hitThisFrame`; a gust that catches nobody reports an empty array.

`hud.test.ts` additions: `showFocus` is false at zero Focus and true while active;
`avatarCharge` passes through clamped.

`input.test.ts` addition: `avatarStatePressed` passes through `toInputState`.

## 8. Documentation

- `README.md`: the controls table gains `E`, and the prose gains a paragraph on Focus
  and the Avatar State in the voice of the existing sections.
- `docs/HANDOFF.md`: move Focus and the Avatar State out of "not built", and record the
  two exclusions below as still open.

## Out of scope

- **§4.6's non-lethality bonus.** The rule is that non-lethal removals grant more Focus
  than environmental accidents. Enemies have no fall physics, so every down is already
  a gust and the second branch is unreachable in play. Building it now would ship dead
  code. Downs simply grant Focus; the distinction waits for enemies that can be blown
  off a ledge.
- **Redirected projectiles and damage avoided at close range**, both §4.5 build
  sources. The first needs archers, the second needs a near-miss test. Neither exists.
- **Elemental heavy moves** as a Focus sink. Water, earth and fire are unbuilt; the
  Avatar State is the sink this slice provides.
- **"All elements simultaneously available"** in the Avatar State, for the same reason.
  The other three §4.5 effects — free Breath, greatly increased damage, wind features
  reacting — are all implemented.
- **Story-locking the Avatar State.** §4.5 says it is story-locked in the early game;
  there is no story or act structure yet (§5 is unbuilt), so it is available from the
  start.
- Persisting Focus across sessions.
