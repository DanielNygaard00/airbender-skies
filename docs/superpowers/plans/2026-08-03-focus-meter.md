# Focus and the Avatar State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Focus — a meter that builds from clean traversal and combat chains — and the Avatar State it arms.

**Architecture:** Five pure modules in a new `src/focus/` directory, mirroring the layout of `src/combat/`. The meter, its input sources, and the arm-then-fire state machine are all pure functions over plain structs. Avatar State effects are expressed as pure *transforms* of existing config and samples (`boostedCombatConfig`, `surgeWind`, `refillBreath`), so the flight, combat and wind models are never modified to know the Avatar State exists. `main.ts` wires everything in one specific frame order that resolves a circular dependency between the three systems.

**Tech Stack:** TypeScript 7, three.js 0.185.1 (used only for `MathUtils` and `Vector3` in these modules — no scene access), Vitest 4 in the `node` environment, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-03-focus-meter-design.md`

## Global Constraints

- **Branch:** all work lands on `focus-meter`. Do not commit to `main` — pushing `main` triggers the GitHub Pages deploy.
- **Typecheck is two passes:** `npm run typecheck` runs `tsc -p tsconfig.json` then `tsc -p tsconfig.test.json`. App code cannot see Node globals; only tests can. Both passes must be clean.
- **`noUncheckedIndexedAccess` is on.** Any indexed access is `T | undefined` and must be narrowed.
- **New modules must stay pure.** No DOM, no three.js scene objects, no `Math.random`, no `Date.now`, no time source of their own. `MathUtils` and `Vector3` are fine.
- **Test discipline.** `docs/HANDOFF.md` records four failure modes that each produced a green suite proving nothing. Do not assert against the same config value the code reads; do not write assertions that collapse to a tautology; do not use a bare `>` where a margin is meant; do not write an assertion that holds whether or not the feature works. **After writing each test, neutralise the relevant config value or feature and confirm the test goes red.** If it stays green, the test is decorative and must be rewritten.
- **Comment style.** Comments explain *why*, not what. Mark regression guards as such. Match the density of the surrounding file.
- **Commit messages in normal prose**, imperative mood, explaining the reasoning. End each with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Do not touch `src/core/save.ts`.** Focus is a live meter and is deliberately not persisted.

---

### Task 1: The Focus meter

**Files:**
- Create: `src/focus/focus.ts`
- Create: `src/focus/config.ts`
- Test: `src/focus/focus.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface Focus { value: number; max: number; chainTime: number }`
  - `interface FocusConfig` with fields `maxFocus`, `glideGainPerSecond`, `windGainMultiplier`, `scooterGainPerSecond`, `idleDrainPerSecond`, `chainRampSeconds`, `chainRampMax`, `gustConnectGain`, `downGain`, `damageDrain`, `crashDrain` — all `number`
  - `interface FocusEvents { gustConnects: number; downs: number; playerHit: boolean; fellOutOfWorld: boolean }`
  - `interface FocusInput { ratePerSecond: number; events: FocusEvents; frozen: boolean; reset: boolean }`
  - `emptyFocus(c: FocusConfig): Focus`
  - `isFull(focus: Focus): boolean`
  - `chainRamp(focus: Focus, c: FocusConfig): number`
  - `noFocusEvents(): FocusEvents`
  - `stepFocus(focus: Focus, input: FocusInput, dt: number, c: FocusConfig): Focus`
  - `DEFAULT_FOCUS_CONFIG: FocusConfig` from `src/focus/config.ts`

- [ ] **Step 1: Write the failing test**

Create `src/focus/focus.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  chainRamp, emptyFocus, isFull, noFocusEvents, stepFocus,
  type Focus, type FocusConfig, type FocusEvents,
} from './focus'

/**
 * Round numbers chosen so every expectation below can be a hand-computed literal
 * rather than a restatement of the config the code reads.
 */
const C: FocusConfig = {
  maxFocus: 100,
  glideGainPerSecond: 2,
  windGainMultiplier: 2,
  scooterGainPerSecond: 4,
  idleDrainPerSecond: 3,
  chainRampSeconds: 10,
  chainRampMax: 2,
  gustConnectGain: 5,
  downGain: 10,
  damageDrain: 30,
  crashDrain: 50,
}

const focusAt = (value: number, chainTime = 0): Focus => ({ value, max: C.maxFocus, chainTime })

const input = (over: Partial<{
  ratePerSecond: number
  events: Partial<FocusEvents>
  frozen: boolean
  reset: boolean
}> = {}) => ({
  ratePerSecond: over.ratePerSecond ?? 0,
  events: { ...noFocusEvents(), ...over.events },
  frozen: over.frozen ?? false,
  reset: over.reset ?? false,
})

describe('emptyFocus', () => {
  it('starts empty with no chain', () => {
    expect(emptyFocus(C)).toEqual({ value: 0, max: 100, chainTime: 0 })
  })
})

describe('isFull', () => {
  it('is true only at the top of the meter', () => {
    expect(isFull(focusAt(99.9))).toBe(false)
    expect(isFull(focusAt(100))).toBe(true)
  })

  it('stays true if a gain path ever overshoots', () => {
    // Guards the arming rule against an exact-equality comparison.
    expect(isFull(focusAt(120))).toBe(true)
  })
})

describe('chainRamp', () => {
  it('is 1 with no chain built', () => {
    expect(chainRamp(focusAt(0, 0), C)).toBeCloseTo(1)
  })

  it('is halfway up at half the ramp time', () => {
    // 1 -> 2 over 10s, so 5s in is 1.5.
    expect(chainRamp(focusAt(0, 5), C)).toBeCloseTo(1.5)
  })

  it('holds at the cap past the ramp time', () => {
    expect(chainRamp(focusAt(0, 10), C)).toBeCloseTo(2)
    expect(chainRamp(focusAt(0, 45), C)).toBeCloseTo(2)
  })
})

describe('stepFocus', () => {
  it('gains the traversal rate over a second', () => {
    const next = stepFocus(focusAt(0), input({ ratePerSecond: 2 }), 1, C)
    expect(next.value).toBeCloseTo(2)
  })

  it('gains twice as fast once the chain is fully ramped', () => {
    const cold = stepFocus(focusAt(0, 0), input({ ratePerSecond: 2 }), 1, C)
    const hot = stepFocus(focusAt(0, 30), input({ ratePerSecond: 2 }), 1, C)
    // Absolute values, not a bare comparison: the ramp is worth exactly 2x here.
    expect(cold.value).toBeCloseTo(2)
    expect(hot.value).toBeCloseTo(4)
  })

  it('drains while the rate is negative', () => {
    const next = stepFocus(focusAt(50), input({ ratePerSecond: -3 }), 1, C)
    expect(next.value).toBeCloseTo(47)
  })

  it('advances the chain when nothing breaks it', () => {
    const next = stepFocus(focusAt(10, 4), input(), 0.5, C)
    expect(next.chainTime).toBeCloseTo(4.5)
  })

  it('pays for a gust connect and a down', () => {
    const next = stepFocus(
      focusAt(0),
      input({ events: { gustConnects: 2, downs: 1 } }),
      1 / 60,
      C,
    )
    // 2 connects at 5, one down at 10, unramped.
    expect(next.value).toBeCloseTo(20)
  })

  it('drains and resets the chain when the player is hit', () => {
    const next = stepFocus(focusAt(80, 30), input({ events: { playerHit: true } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(50)
    expect(next.chainTime).toBe(0)
  })

  it('grants the unramped amount for a down on the frame the chain broke', () => {
    // Regression guard on ordering. The break must zero the ramp before the gain
    // is scaled, or a hit-and-down frame pays the 2x bonus for a chain that just
    // ended: 80 - 30 + 10 = 60, not 80 - 30 + 20 = 70.
    const next = stepFocus(
      focusAt(80, 30),
      input({ events: { playerHit: true, downs: 1 } }),
      1 / 60,
      C,
    )
    expect(next.value).toBeCloseTo(60)
  })

  it('costs more to fall out of the world than to take a spear', () => {
    const hit = stepFocus(focusAt(90, 30), input({ events: { playerHit: true } }), 1 / 60, C)
    const fell = stepFocus(focusAt(90, 30), input({ events: { fellOutOfWorld: true } }), 1 / 60, C)
    expect(hit.value).toBeCloseTo(60)
    expect(fell.value).toBeCloseTo(40)
  })

  it('holds the meter exactly still while frozen', () => {
    const before = focusAt(64, 12)
    const next = stepFocus(
      before,
      input({ ratePerSecond: 5, events: { downs: 3 }, frozen: true }),
      1,
      C,
    )
    expect(next).toEqual(before)
  })

  it('empties the meter and the chain on reset', () => {
    const next = stepFocus(focusAt(100, 40), input({ reset: true }), 1 / 60, C)
    expect(next).toEqual({ value: 0, max: 100, chainTime: 0 })
  })

  it('resets even while frozen, because the state ends on the same frame', () => {
    const next = stepFocus(focusAt(100, 40), input({ frozen: true, reset: true }), 1 / 60, C)
    expect(next.value).toBe(0)
  })

  it('never leaves the meter outside its range', () => {
    expect(stepFocus(focusAt(95), input({ ratePerSecond: 2 }), 60, C).value).toBe(100)
    expect(stepFocus(focusAt(5), input({ events: { fellOutOfWorld: true } }), 1, C).value).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/focus/focus.test.ts`
Expected: FAIL — cannot resolve `./focus`.

- [ ] **Step 3: Write minimal implementation**

Create `src/focus/focus.ts`:

```ts
import { MathUtils } from 'three'

/**
 * Focus: the meter that rewards sustained clean play.
 *
 * The design document has Focus build "from unbroken chains", and this module encodes
 * the chain as a ramp on the gain rate rather than as a separate combo counter. Going
 * unbroken makes everything pay better; a break costs a chunk of the meter and puts the
 * ramp back to nothing. One number, two behaviours, no second meter to explain.
 *
 * Deliberately not part of PlayerState. Movement is a pure function of a struct that a
 * dozen tests build fixtures for, and a scoring meter has no business widening it.
 */
export interface Focus {
  value: number
  max: number
  /** Seconds the chain has gone unbroken. Drives the gain ramp. */
  chainTime: number
}

export interface FocusConfig {
  maxFocus: number
  /** Focus per second for clean gliding above stall speed. */
  glideGainPerSecond: number
  /** Multiplies the glide rate while inside a wind feature. */
  windGainMultiplier: number
  /** Focus per second on a fully charged air scooter. */
  scooterGainPerSecond: number
  /** Focus per second lost while doing nothing worth rewarding. */
  idleDrainPerSecond: number
  /** Unbroken seconds needed to reach the full ramp. */
  chainRampSeconds: number
  /** Gain multiplier at the top of the ramp. */
  chainRampMax: number
  /** Focus for one gust connecting with a live enemy. */
  gustConnectGain: number
  /** Focus for downing an enemy. */
  downGain: number
  /** Focus lost to a single hit. */
  damageDrain: number
  /** Focus lost to falling out of the world. */
  crashDrain: number
}

/** What happened this frame that Focus cares about. */
export interface FocusEvents {
  /** Enemies a gust connected with. */
  gustConnects: number
  /** Enemies downed. */
  downs: number
  playerHit: boolean
  fellOutOfWorld: boolean
}

export interface FocusInput {
  /** Focus per second from traversal. Negative while idling. */
  ratePerSecond: number
  events: FocusEvents
  /** The Avatar State is running: the meter holds still. */
  frozen: boolean
  /** The Avatar State just ended: the meter empties. */
  reset: boolean
}

export function noFocusEvents(): FocusEvents {
  return { gustConnects: 0, downs: 0, playerHit: false, fellOutOfWorld: false }
}

export function emptyFocus(c: FocusConfig): Focus {
  return { value: 0, max: c.maxFocus, chainTime: 0 }
}

/**
 * An inequality rather than an exact comparison. The meter is clamped with `Math.min`
 * so a full one holds `max` exactly today, but the Avatar State's arming rule hangs off
 * this and must not silently stop working if a future gain path overshoots.
 */
export function isFull(focus: Focus): boolean {
  return focus.value >= focus.max
}

export function chainRamp(focus: Focus, c: FocusConfig): number {
  const t = MathUtils.clamp(focus.chainTime / c.chainRampSeconds, 0, 1)
  return MathUtils.lerp(1, c.chainRampMax, t)
}

/**
 * Advance the meter one frame.
 *
 * The order is load-bearing. Breaks apply before gains, and the ramp is measured after
 * the break — so an enemy downed on the same frame the player takes a spear pays the
 * base rate, because the chain really did end that frame.
 */
export function stepFocus(
  focus: Focus,
  input: FocusInput,
  dt: number,
  c: FocusConfig,
): Focus {
  // Reset wins over freeze: the state ends and the meter empties on the same frame.
  if (input.reset) return { value: 0, max: focus.max, chainTime: 0 }
  if (input.frozen) return focus

  const { events } = input
  const broke = events.playerHit || events.fellOutOfWorld

  let value = focus.value
  if (events.playerHit) value -= c.damageDrain
  if (events.fellOutOfWorld) value -= c.crashDrain

  const chainTime = broke ? 0 : focus.chainTime + dt
  const ramp = chainRamp({ ...focus, chainTime: broke ? 0 : focus.chainTime }, c)

  // The ramp scales the drain as well as the gain: a long clean run bleeds away
  // faster once it stops, so idling costs more the better the run was.
  value += input.ratePerSecond * ramp * dt
  value += (events.gustConnects * c.gustConnectGain + events.downs * c.downGain) * ramp

  return { value: MathUtils.clamp(value, 0, focus.max), max: focus.max, chainTime }
}
```

Create `src/focus/config.ts`:

```ts
import type { FocusConfig } from './focus'

/**
 * Focus tuning.
 *
 * Clean gliding fills the meter in roughly 45 seconds unramped, nearer 30 once the
 * chain is up — long enough that a full meter is earned rather than incidental. Combat
 * pays far better per second than traversal, and a single spear costs nearly a third of
 * the bar, which is what makes it a break rather than a scratch.
 *
 * Every value here is an argued guess. None of it has been played.
 */
export const DEFAULT_FOCUS_CONFIG: FocusConfig = {
  maxFocus: 100,
  glideGainPerSecond: 2.2,
  // Riding a feature is the skilled version of flying, so it pays double.
  windGainMultiplier: 2,
  // At a full accumulator, slightly better than plain gliding: the ground kit should
  // not be strictly worse than the air.
  scooterGainPerSecond: 3.5,
  // Faster than the base gain, so standing still loses ground rather than holding it.
  idleDrainPerSecond: 3,
  chainRampSeconds: 12,
  chainRampMax: 1.8,
  gustConnectGain: 6,
  downGain: 14,
  damageDrain: 30,
  crashDrain: 50,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/focus/focus.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Prove the tests are not decorative**

Do all three, one at a time, reverting after each:

1. In `chainRamp`, drop the `MathUtils.clamp` and pass the raw ratio to `lerp`. Expected: the "holds at the cap past the ramp time" test FAILS — 45 seconds of chain extrapolates to 5.5 instead of holding at 2. Revert.
2. In `stepFocus`, move the `ramp` computation above the two drain lines and use `focus.chainTime` unconditionally. Expected: the "unramped amount for a down on the frame the chain broke" test FAILS with 70 instead of 60. Revert.
3. In `stepFocus`, change `if (input.frozen) return focus` to fall through. Expected: the frozen test FAILS. Revert.

If any of these stays green, the test is wrong — fix the test before continuing.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: both passes clean.

- [ ] **Step 7: Commit**

```bash
git add src/focus/focus.ts src/focus/config.ts src/focus/focus.test.ts
git commit -m "Add the Focus meter, with the chain as a ramp on the gain rate

The design document has Focus build from unbroken chains. This encodes the
chain as a multiplier that grows with unbroken time rather than as a separate
combo counter: going unbroken makes everything pay better, and a break costs a
chunk of the meter and puts the ramp back to nothing.

Breaks resolve before gains and the ramp is measured after the break, so an
enemy downed on the same frame the player is hit pays the base rate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Focus sources

**Files:**
- Create: `src/focus/sources.ts`
- Test: `src/focus/sources.test.ts`

**Interfaces:**
- Consumes: `FocusConfig` from `src/focus/focus.ts` (Task 1). Also `PlayerState` and `FlightConfig` from `src/core/types.ts`, both of which already exist.
- Produces:
  - `traversalRatePerSecond(player: PlayerState, inWind: boolean, flight: FlightConfig, c: FocusConfig): number`
  - `fellOutOfWorld(player: PlayerState, worldFloorY: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/focus/sources.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { traversalRatePerSecond, fellOutOfWorld } from './sources'
import type { FocusConfig } from './focus'
import type { FlightConfig, PlayerState } from '../core/types'
import { DEFAULT_FLIGHT_CONFIG } from '../core/config'

const C: FocusConfig = {
  maxFocus: 100,
  glideGainPerSecond: 2,
  windGainMultiplier: 3,
  scooterGainPerSecond: 4,
  idleDrainPerSecond: 3,
  chainRampSeconds: 10,
  chainRampMax: 2,
  gustConnectGain: 5,
  downGain: 10,
  damageDrain: 30,
  crashDrain: 50,
}

const FLIGHT: FlightConfig = { ...DEFAULT_FLIGHT_CONFIG, stallSpeed: 10 }

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, ...over,
})

const gliding = (speed: number) =>
  p({ mode: 'glider', grounded: false, velocity: new Vector3(0, 0, speed) })

describe('traversalRatePerSecond', () => {
  it('pays for gliding above stall speed', () => {
    expect(traversalRatePerSecond(gliding(30), false, FLIGHT, C)).toBeCloseTo(2)
  })

  it('pays triple inside a wind feature', () => {
    expect(traversalRatePerSecond(gliding(30), true, FLIGHT, C)).toBeCloseTo(6)
  })

  it('drains while stalled in the air', () => {
    // Hanging below stall speed is not clean traversal, whatever the mode says.
    expect(traversalRatePerSecond(gliding(4), false, FLIGHT, C)).toBeCloseTo(-3)
  })

  it('drains while standing on the ground', () => {
    expect(traversalRatePerSecond(p(), false, FLIGHT, C)).toBeCloseTo(-3)
  })

  it('drains while running without the scooter', () => {
    expect(traversalRatePerSecond(
      p({ velocity: new Vector3(0, 0, 13) }), false, FLIGHT, C,
    )).toBeCloseTo(-3)
  })

  it('pays for a fully charged scooter line', () => {
    expect(traversalRatePerSecond(
      p({ scooterActive: true, scooterCharge: 1 }), false, FLIGHT, C,
    )).toBeCloseTo(4)
  })

  it('scales the scooter rate with the accumulator', () => {
    expect(traversalRatePerSecond(
      p({ scooterActive: true, scooterCharge: 0.5 }), false, FLIGHT, C,
    )).toBeCloseTo(2)
  })

  it('pays nothing for a scooter that has built no charge', () => {
    // Mounting the scooter must not be worth Focus on its own; the line is.
    expect(traversalRatePerSecond(
      p({ scooterActive: true, scooterCharge: 0 }), false, FLIGHT, C,
    )).toBeCloseTo(0)
  })

  it('ignores wind on the ground', () => {
    // inWind is sampled for the glider; it must not leak into the ground rate.
    expect(traversalRatePerSecond(
      p({ scooterActive: true, scooterCharge: 1 }), true, FLIGHT, C,
    )).toBeCloseTo(4)
  })
})

describe('fellOutOfWorld', () => {
  it('is true below the floor', () => {
    expect(fellOutOfWorld(p({ position: new Vector3(0, -260, 0) }), -250)).toBe(true)
  })

  it('is false above the floor', () => {
    expect(fellOutOfWorld(p({ position: new Vector3(0, -240, 0) }), -250)).toBe(false)
  })

  it('is false at exactly the floor, matching the controller', () => {
    // The controller respawns on a strict less-than. This must not disagree, or the
    // player loses Focus on a frame they were not respawned.
    expect(fellOutOfWorld(p({ position: new Vector3(0, -250, 0) }), -250)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/focus/sources.test.ts`
Expected: FAIL — cannot resolve `./sources`.

- [ ] **Step 3: Write minimal implementation**

Create `src/focus/sources.ts`:

```ts
import { MathUtils } from 'three'
import type { FlightConfig, PlayerState } from '../core/types'
import type { FocusConfig } from './focus'

/**
 * What the player is doing, as a Focus rate.
 *
 * Every branch reads a signal the movement systems already produce. Nothing here
 * measures anything new — in particular the scooter's hidden accumulator is reused
 * rather than a second notion of "a clean line" being invented next to it.
 *
 * There is deliberately no neutral state: everything either builds or drains, so the
 * meter can never be parked.
 */
export function traversalRatePerSecond(
  player: PlayerState,
  inWind: boolean,
  flight: FlightConfig,
  c: FocusConfig,
): number {
  if (player.mode === 'glider' && !player.grounded) {
    // Below stall the wing is not flying, it is falling with a sail out.
    if (player.velocity.length() > flight.stallSpeed) {
      return c.glideGainPerSecond * (inWind ? c.windGainMultiplier : 1)
    }
    return -c.idleDrainPerSecond
  }

  if (player.mode === 'ground' && player.scooterActive) {
    return c.scooterGainPerSecond * MathUtils.clamp(player.scooterCharge, 0, 1)
  }

  return -c.idleDrainPerSecond
}

/**
 * Whether the player fell out of the world this frame.
 *
 * This duplicates the condition `controllerStep` uses to trigger a respawn, and the
 * duplication is deliberate: the controller resolves the fall internally and hands back
 * an already-respawned state, so there is no way to observe it afterwards. Exported and
 * tested so the duplication is visible rather than buried in a call site, and it must be
 * evaluated *before* the controller runs.
 */
export function fellOutOfWorld(player: PlayerState, worldFloorY: number): boolean {
  return player.position.y < worldFloorY
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/focus/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. In `sources.ts`, drop the `inWind` multiplier — return `c.glideGainPerSecond` unconditionally. Expected: the "pays triple inside a wind feature" test FAILS. Revert.
2. Remove the `MathUtils.clamp(player.scooterCharge, 0, 1)` factor, returning `c.scooterGainPerSecond` flat. Expected: the accumulator-scaling and zero-charge tests FAIL. Revert.
3. Change `fellOutOfWorld` to `<=`. Expected: the exactly-at-the-floor test FAILS. Revert.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: both passes clean.

- [ ] **Step 7: Commit**

```bash
git add src/focus/sources.ts src/focus/sources.test.ts
git commit -m "Read Focus rates off the movement signals that already exist

Gliding above stall pays, and pays double inside a wind feature, because riding
the air is the skill the world was built to teach. The scooter reuses its own
hidden accumulator rather than inventing a second measure of a clean line.

No branch is neutral: everything either builds or drains, so the meter cannot be
parked by standing still.

fellOutOfWorld duplicates the controller's respawn condition on purpose. The
controller resolves a fall internally and returns an already-respawned state, so
there is nothing left to observe after the fact.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The Avatar State machine

**Files:**
- Create: `src/focus/avatar-state.ts`
- Modify: `src/focus/config.ts` — append `DEFAULT_AVATAR_STATE_CONFIG`
- Test: `src/focus/avatar-state.test.ts`

**Interfaces:**
- Consumes: `Focus`, `isFull` from `src/focus/focus.ts` (Task 1).
- Produces:
  - `interface AvatarState { armTime: number; remaining: number }`
  - `interface AvatarStateConfig { armSeconds: number; durationSeconds: number; gustDamageMultiplier: number; gustKnockbackMultiplier: number; surgeAccelMultiplier: number; relentFactor: number }`
  - `interface AvatarStateStep { state: AvatarState; active: boolean; justEnded: boolean }`
  - `restingAvatarState(): AvatarState`
  - `isActive(state: AvatarState): boolean`
  - `isArmed(state: AvatarState, c: AvatarStateConfig): boolean`
  - `armFraction(state: AvatarState, c: AvatarStateConfig): number`
  - `stepAvatarState(state: AvatarState, focus: Focus, triggerPressed: boolean, dt: number, c: AvatarStateConfig): AvatarStateStep`
  - `DEFAULT_AVATAR_STATE_CONFIG: AvatarStateConfig` from `src/focus/config.ts`

- [ ] **Step 1: Write the failing test**

Create `src/focus/avatar-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  armFraction, isActive, isArmed, restingAvatarState, stepAvatarState,
  type AvatarState, type AvatarStateConfig,
} from './avatar-state'
import type { Focus } from './focus'

const C: AvatarStateConfig = {
  armSeconds: 4,
  durationSeconds: 8,
  gustDamageMultiplier: 3,
  gustKnockbackMultiplier: 1.5,
  surgeAccelMultiplier: 2,
  relentFactor: 0.2,
}

const FULL: Focus = { value: 100, max: 100, chainTime: 30 }
const PARTIAL: Focus = { value: 99, max: 100, chainTime: 30 }

/** Hold the trigger unpressed and feed one-second frames of full Focus. */
function charge(seconds: number): AvatarState {
  let state = restingAvatarState()
  for (let i = 0; i < seconds; i++) {
    state = stepAvatarState(state, FULL, false, 1, C).state
  }
  return state
}

describe('stepAvatarState', () => {
  it('arms only after Focus has been held at maximum long enough', () => {
    expect(isArmed(charge(3), C)).toBe(false)
    expect(isArmed(charge(4), C)).toBe(true)
  })

  it('does not arm from Focus below maximum, however long it is held', () => {
    let state = restingAvatarState()
    for (let i = 0; i < 20; i++) state = stepAvatarState(state, PARTIAL, false, 1, C).state
    expect(state.armTime).toBe(0)
    expect(isArmed(state, C)).toBe(false)
  })

  it('loses the charge the moment Focus drops below maximum', () => {
    // The disarm rule: one spear hit drains Focus and takes the charge with it.
    const nearlyArmed = charge(3)
    expect(nearlyArmed.armTime).toBeCloseTo(3)
    const after = stepAvatarState(nearlyArmed, PARTIAL, false, 1, C).state
    expect(after.armTime).toBe(0)
  })

  it('does nothing when the trigger is pressed unarmed', () => {
    const step = stepAvatarState(charge(2), FULL, true, 1, C)
    expect(step.active).toBe(false)
    expect(step.state.remaining).toBe(0)
  })

  it('is active on the same frame the trigger fires', () => {
    // No dead frame: the effects have to apply from the frame the player pressed.
    const step = stepAvatarState(charge(4), FULL, true, 1 / 60, C)
    expect(step.active).toBe(true)
    expect(step.state.remaining).toBeCloseTo(8)
  })

  it('runs for its full duration and ends exactly once', () => {
    let state = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    let ends = 0
    let activeFrames = 0
    for (let i = 0; i < 8; i++) {
      const step = stepAvatarState(state, FULL, false, 1, C)
      state = step.state
      if (step.active) activeFrames++
      if (step.justEnded) ends++
    }
    expect(activeFrames).toBe(8)
    expect(ends).toBe(1)
    expect(isActive(state)).toBe(false)
  })

  it('cannot be extended by pressing the trigger again while it runs', () => {
    const started = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    const after = stepAvatarState(started, FULL, true, 3, C).state
    expect(after.remaining).toBeCloseTo(5)
  })

  it('cannot re-arm from the maximum Focus it is holding frozen', () => {
    // Focus is frozen at full during the state, so an accumulating armTime would
    // hand the player a second charge for free the instant the first one ended.
    let state = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    for (let i = 0; i < 6; i++) {
      state = stepAvatarState(state, FULL, false, 1, C).state
      expect(state.armTime).toBe(0)
    }
  })

  it('reports the end without leaving a negative timer behind', () => {
    const started = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    const step = stepAvatarState(started, FULL, false, 20, C)
    expect(step.justEnded).toBe(true)
    expect(step.state.remaining).toBe(0)
  })
})

describe('armFraction', () => {
  it('reports progress toward the charge', () => {
    expect(armFraction(charge(2), C)).toBeCloseTo(0.5)
    expect(armFraction(charge(4), C)).toBeCloseTo(1)
  })

  it('is zero while the state is running, so the HUD pip hides', () => {
    const started = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    expect(armFraction(started, C)).toBe(0)
  })
})

describe('isArmed', () => {
  it('is false while the state is already running', () => {
    const started = stepAvatarState(charge(4), FULL, true, 1 / 60, C).state
    expect(isArmed(started, C)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/focus/avatar-state.test.ts`
Expected: FAIL — cannot resolve `./avatar-state`.

- [ ] **Step 3: Write minimal implementation**

Create `src/focus/avatar-state.ts`:

```ts
import { MathUtils } from 'three'
import { isFull, type Focus } from './focus'

/**
 * The Avatar State: armed by sustained maximum Focus, fired by the player.
 *
 * Not to be confused with `src/player/avatar.ts`, which is the character *model* and
 * has nothing to do with this file. The name is the design document's term.
 *
 * The document asks for something situational that cannot be farmed, and those pull in
 * opposite directions. The resolution is that the charge is held rather than banked: it
 * fills only while Focus sits at maximum and empties the moment Focus drops, so keeping
 * it means continuing to play cleanly. The player still chooses the moment.
 */
export interface AvatarState {
  /** Seconds Focus has been pinned at maximum. Fills the arming charge. */
  armTime: number
  /** Seconds of Avatar State remaining. 0 means not running. */
  remaining: number
}

export interface AvatarStateConfig {
  /** Seconds at maximum Focus needed to arm. */
  armSeconds: number
  /** How long the state runs. Short, per the document. */
  durationSeconds: number
  /** Multiplies gust damage while active. */
  gustDamageMultiplier: number
  /** Multiplies gust knockback while active. */
  gustKnockbackMultiplier: number
  /** Multiplies a helpful wind feature's acceleration while active. */
  surgeAccelMultiplier: number
  /** Scales a downdraft's acceleration toward zero while active. */
  relentFactor: number
}

export interface AvatarStateStep {
  state: AvatarState
  /** The state is running this frame: effects apply. */
  active: boolean
  /** The state ended this frame: Focus empties. */
  justEnded: boolean
}

export function restingAvatarState(): AvatarState {
  return { armTime: 0, remaining: 0 }
}

export function isActive(state: AvatarState): boolean {
  return state.remaining > 0
}

export function isArmed(state: AvatarState, c: AvatarStateConfig): boolean {
  return !isActive(state) && state.armTime >= c.armSeconds
}

export function armFraction(state: AvatarState, c: AvatarStateConfig): number {
  if (!(c.armSeconds > 0)) return isActive(state) ? 0 : 1
  return MathUtils.clamp(state.armTime / c.armSeconds, 0, 1)
}

/**
 * Advance the state one frame.
 *
 * `active` is reported true on the frame the trigger fires, so the effects apply from
 * that frame rather than the next one. `armTime` is held at zero for the whole run: the
 * state freezes Focus at maximum, so an accumulating charge would hand the player a
 * second one for free the instant the first ended.
 */
export function stepAvatarState(
  state: AvatarState,
  focus: Focus,
  triggerPressed: boolean,
  dt: number,
  c: AvatarStateConfig,
): AvatarStateStep {
  if (isActive(state)) {
    const remaining = state.remaining - dt
    if (remaining > 0) {
      return { state: { armTime: 0, remaining }, active: true, justEnded: false }
    }
    // Clamped rather than left negative, so a long frame cannot leave the state
    // looking like it has time owed to it.
    return { state: { armTime: 0, remaining: 0 }, active: true, justEnded: true }
  }

  const charged: AvatarState = {
    armTime: isFull(focus) ? state.armTime + dt : 0,
    remaining: 0,
  }

  if (triggerPressed && isArmed(charged, c)) {
    return {
      state: { armTime: 0, remaining: c.durationSeconds },
      active: true,
      justEnded: false,
    }
  }

  return { state: charged, active: false, justEnded: false }
}
```

Append to `src/focus/config.ts`:

```ts
import type { AvatarStateConfig } from './avatar-state'

/**
 * Avatar State tuning.
 *
 * Short and loud, per the design document. The gust multiplier is set so a single
 * gust downs a spear soldier outright — 0.5 damage times 3 reaches their 1.5 health —
 * which turns the whole patrol over in a few seconds and is the point of the state.
 *
 * Every value here is an argued guess. None of it has been played.
 */
export const DEFAULT_AVATAR_STATE_CONFIG: AvatarStateConfig = {
  // Long enough that arriving at maximum Focus is not instantly a trigger.
  armSeconds: 4,
  durationSeconds: 8,
  gustDamageMultiplier: 3,
  // Loud, without launching enemies clean out of the level.
  gustKnockbackMultiplier: 1.5,
  surgeAccelMultiplier: 1.8,
  // Downdrafts nearly stop rather than inverting into lift.
  relentFactor: 0.15,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/focus/avatar-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. In `stepAvatarState`, change the non-active branch to `armTime: state.armTime + dt` unconditionally. Expected: the "does not arm from Focus below maximum" and "loses the charge" tests FAIL. Revert.
2. In the active branch, return `armTime: state.armTime + dt` instead of 0. Expected: the "cannot re-arm from the maximum Focus it is holding frozen" test FAILS. Revert.
3. Change the trigger branch's `active` to `false`. Expected: the "active on the same frame the trigger fires" test FAILS. Revert.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: both passes clean.

- [ ] **Step 7: Commit**

```bash
git add src/focus/avatar-state.ts src/focus/config.ts src/focus/avatar-state.test.ts
git commit -m "Arm the Avatar State from sustained maximum Focus

The document wants something situational that cannot be farmed, and those pull
against each other. The charge is held rather than banked: it fills only while
Focus sits at maximum and empties the moment Focus drops, so a single spear hit
costs the player both. The moment of use is still theirs to choose.

armTime is pinned at zero for the whole run, because the state freezes Focus at
maximum and an accumulating charge would hand out a second one for free the
instant the first ended.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The Avatar State's effects

**Files:**
- Create: `src/focus/effects.ts`
- Test: `src/focus/effects.test.ts`

**Interfaces:**
- Consumes: `AvatarStateConfig` from `src/focus/avatar-state.ts` (Task 3); `CombatConfig` from `src/combat/encounter.ts`; `WindSample` from `src/world/wind.ts`; `PlayerState` from `src/core/types.ts`. The last three already exist.
- Produces:
  - `boostedCombatConfig(c: CombatConfig, active: boolean, a: AvatarStateConfig): CombatConfig`
  - `surgeWind(sample: WindSample, t: number, a: AvatarStateConfig): WindSample`
  - `refillBreath(player: PlayerState): PlayerState`

- [ ] **Step 1: Write the failing test**

Create `src/focus/effects.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { boostedCombatConfig, refillBreath, surgeWind } from './effects'
import type { AvatarStateConfig } from './avatar-state'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { stillAir, type WindSample } from '../world/wind'
import type { PlayerState } from '../core/types'

const C: AvatarStateConfig = {
  armSeconds: 4,
  durationSeconds: 8,
  gustDamageMultiplier: 3,
  gustKnockbackMultiplier: 1.5,
  surgeAccelMultiplier: 2,
  relentFactor: 0.2,
}

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'glider', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: false, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, ...over,
})

const sample = (accel: Vector3, liftScale = 1): WindSample => ({ accel, liftScale })

describe('boostedCombatConfig', () => {
  it('hands back the same config untouched while inactive', () => {
    const base = DEFAULT_COMBAT_CONFIG
    expect(boostedCombatConfig(base, false, C)).toBe(base)
  })

  it('makes a gust down a spear soldier in one hit', () => {
    // The claim, stated against the enemy's health rather than against the
    // multiplier the code reads: boosted gust must reach a full health bar.
    const boosted = boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, C)
    expect(boosted.gust.damage).toBeGreaterThanOrEqual(DEFAULT_COMBAT_CONFIG.enemy.maxHealth)
    expect(DEFAULT_COMBAT_CONFIG.gust.damage)
      .toBeLessThan(DEFAULT_COMBAT_CONFIG.enemy.maxHealth)
  })

  it('drops the gust cooldown entirely', () => {
    expect(boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, C).gust.cooldownSeconds).toBe(0)
  })

  it('raises knockback to 39 from 26', () => {
    expect(boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, C).gust.knockback).toBeCloseTo(39)
  })

  it('leaves the original config alone', () => {
    // Regression guard: the fight config is a module-level constant, so a mutating
    // boost would permanently buff gust for the rest of the session.
    boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, C)
    expect(DEFAULT_COMBAT_CONFIG.gust.damage).toBeCloseTo(0.5)
    expect(DEFAULT_COMBAT_CONFIG.gust.cooldownSeconds).toBeCloseTo(0.45)
  })

  it('leaves the enemy and player config alone', () => {
    const boosted = boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, C)
    expect(boosted.enemy).toBe(DEFAULT_COMBAT_CONFIG.enemy)
    expect(boosted.player).toBe(DEFAULT_COMBAT_CONFIG.player)
  })
})

describe('surgeWind', () => {
  it('returns the sample untouched at zero intensity', () => {
    const s = sample(new Vector3(0, 5, 0))
    expect(surgeWind(s, 0, C)).toBe(s)
  })

  it('amplifies a thermal', () => {
    expect(surgeWind(sample(new Vector3(0, 5, 0)), 1, C).accel.y).toBeCloseTo(10)
  })

  it('amplifies a wind river, whose push is horizontal', () => {
    // accel.y is zero here, so a sign test alone would leave rivers unsurged.
    expect(surgeWind(sample(new Vector3(8, 0, 0)), 1, C).accel.x).toBeCloseTo(16)
  })

  it('makes a downdraft relent instead of pushing harder', () => {
    expect(surgeWind(sample(new Vector3(0, -6, 0)), 1, C).accel.y).toBeCloseTo(-1.2)
  })

  it('never inverts a downdraft into lift', () => {
    expect(surgeWind(sample(new Vector3(0, -6, 0)), 1, C).accel.y).toBeLessThan(0)
  })

  it('lets dead air relent back to normal lift', () => {
    expect(surgeWind(sample(new Vector3(), 0), 1, C).liftScale).toBeCloseTo(1)
  })

  it('scales in with intensity', () => {
    expect(surgeWind(sample(new Vector3(), 0), 0.5, C).liftScale).toBeCloseTo(0.5)
  })

  it('never reduces a lift scale it is handed', () => {
    // Guard for any future wind kind that reports lift above normal.
    expect(surgeWind(sample(new Vector3(), 1.4), 1, C).liftScale).toBeCloseTo(1.4)
  })

  it('does not mutate the sample it is given', () => {
    const s = sample(new Vector3(0, 5, 0))
    surgeWind(s, 1, C)
    expect(s.accel.y).toBeCloseTo(5)
  })

  it('leaves still air still', () => {
    const surged = surgeWind(stillAir(), 1, C)
    expect(surged.accel.lengthSq()).toBeCloseTo(0)
    expect(surged.liftScale).toBeCloseTo(1)
  })
})

describe('refillBreath', () => {
  it('fills a drained meter', () => {
    expect(refillBreath(p({ breath: 12 })).breath).toBeCloseTo(100)
  })

  it('leaves the maximum alone', () => {
    const filled = refillBreath(p({ breath: 12, maxBreath: 140 }))
    expect(filled.breath).toBeCloseTo(140)
    expect(filled.maxBreath).toBeCloseTo(140)
  })

  it('hands back the same object when already full', () => {
    const full = p({ breath: 100, maxBreath: 100 })
    expect(refillBreath(full)).toBe(full)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/focus/effects.test.ts`
Expected: FAIL — cannot resolve `./effects`.

- [ ] **Step 3: Write minimal implementation**

Create `src/focus/effects.ts`:

```ts
import { MathUtils } from 'three'
import type { PlayerState } from '../core/types'
import type { CombatConfig } from '../combat/encounter'
import type { WindSample } from '../world/wind'
import type { AvatarStateConfig } from './avatar-state'

/**
 * What the Avatar State does, as pure transforms.
 *
 * The point of this module is that the flight model, the combat model and the wind
 * model contain no mention of the Avatar State. Each effect is a function from their
 * existing config or samples to different config or samples, applied at the call site
 * for the frames the state is running. Nothing downstream has to know why the numbers
 * changed.
 */

/**
 * Gust with the state's damage and knockback, and no cooldown at all.
 *
 * Returns the input by reference when inactive, so the common path allocates nothing,
 * and copies rather than mutates when active — `DEFAULT_COMBAT_CONFIG` is a module
 * constant, so a mutating boost would permanently buff the gust for the session.
 */
export function boostedCombatConfig(
  c: CombatConfig,
  active: boolean,
  a: AvatarStateConfig,
): CombatConfig {
  if (!active) return c
  return {
    ...c,
    gust: {
      ...c.gust,
      damage: c.gust.damage * a.gustDamageMultiplier,
      knockback: c.gust.knockback * a.gustKnockbackMultiplier,
      cooldownSeconds: 0,
    },
  }
}

/**
 * The air taking Aang's side, at intensity `t` from 0 to 1.
 *
 * This is an interpretation of the document's "every wind feature in the arena reacts
 * to Aang", which it states as an effect rather than as a rule. Helpful features
 * amplify; downdrafts relent toward nothing; dead air comes back to normal lift. For
 * the duration, the wind-as-terrain lesson is suspended — a short, loud state in which
 * the world stops resisting is the point of it.
 *
 * The sign test is on `accel.y` alone rather than on the feature's kind, because a
 * WindSample does not carry its kind. A wind river's push is horizontal, so it falls on
 * the amplify side, which is what we want.
 */
export function surgeWind(sample: WindSample, t: number, a: AvatarStateConfig): WindSample {
  const k = MathUtils.clamp(t, 0, 1)
  if (k === 0) return sample

  const scale = sample.accel.y < 0
    ? MathUtils.lerp(1, a.relentFactor, k)
    : MathUtils.lerp(1, a.surgeAccelMultiplier, k)

  return {
    accel: sample.accel.clone().multiplyScalar(scale),
    // Never reduces the lift it was handed, whatever a future wind kind reports.
    liftScale: Math.max(sample.liftScale, MathUtils.lerp(sample.liftScale, 1, k)),
  }
}

/**
 * Unlimited Breath, expressed as a full meter.
 *
 * Applied once per frame while the state runs, this is indistinguishable from a
 * suspended drain, and it leaves the flight model untouched. Both alternatives were
 * worse: a FlightConfig with a zeroed drain violates validateFlightConfig's own
 * invariant that hovering must cost more than thrust, and threading a flag through
 * PlayerState widens a struct that a dozen movement tests build fixtures for.
 */
export function refillBreath(player: PlayerState): PlayerState {
  if (player.breath >= player.maxBreath) return player
  return { ...player, breath: player.maxBreath }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/focus/effects.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. In `boostedCombatConfig`, drop the `damage` line from the boosted gust. Expected: the one-hit-down test FAILS. Revert.
2. In `surgeWind`, remove the `accel.y < 0` branch so everything amplifies. Expected: the downdraft-relents test FAILS with `-12`. Revert.
3. In `surgeWind`, drop the `Math.max` guard. Expected: the "never reduces a lift scale" test FAILS with 1 instead of 1.4. Revert.
4. In `surgeWind`, use `sample.accel.multiplyScalar(scale)` without the `clone()`. Expected: the "does not mutate" test FAILS. Revert.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: both passes clean.

- [ ] **Step 7: Commit**

```bash
git add src/focus/effects.ts src/focus/effects.test.ts
git commit -m "Express the Avatar State as pure transforms of existing config

The flight, combat and wind models contain no mention of the Avatar State.
Each effect is a function from their own config or samples to different ones,
applied at the call site for the frames the state runs.

The wind surge interprets the document's line about every wind feature reacting
to Aang: helpful features amplify, downdrafts relent, dead air comes back to
normal lift. It suspends the wind-as-terrain lesson for eight seconds, which is
the point of a short loud state.

Unlimited Breath is a full meter refilled each frame rather than a zeroed drain,
because a zeroed drain would violate validateFlightConfig's own invariant that
hovering costs more than thrust.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Report gust connects from the fight

**Files:**
- Modify: `src/combat/encounter.ts` — `EncounterStep` and `stepEncounter`
- Test: `src/combat/encounter.test.ts` — additions

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `EncounterStep` gains `hitThisFrame: string[]`.

- [ ] **Step 1: Write the failing test**

Add to `src/combat/encounter.test.ts`, inside the existing `describe('stepEncounter', ...)` block. Match the fixture helpers already in that file rather than introducing new ones — read the top of the file first and reuse its existing spawn and input builders.

```ts
  it('reports the enemies a gust connected with', () => {
    const encounter = startEncounter(
      [{ id: 'a', position: new Vector3(0, 0, 5) }, { id: 'b', position: new Vector3(0, 0, 40) }],
      DEFAULT_COMBAT_CONFIG,
    )
    const step = stepEncounter(encounter, {
      playerPosition: new Vector3(),
      playerForward: new Vector3(0, 0, 1),
      gustPressed: true,
    }, 1 / 60, DEFAULT_COMBAT_CONFIG)

    // 'a' is inside the 12 unit range; 'b' at 40 is well outside it.
    expect(step.hitThisFrame).toEqual(['a'])
  })

  it('reports nothing on a frame with no gust', () => {
    const encounter = startEncounter(
      [{ id: 'a', position: new Vector3(0, 0, 5) }],
      DEFAULT_COMBAT_CONFIG,
    )
    const step = stepEncounter(encounter, {
      playerPosition: new Vector3(),
      playerForward: new Vector3(0, 0, 1),
      gustPressed: false,
    }, 1 / 60, DEFAULT_COMBAT_CONFIG)

    expect(step.hitThisFrame).toEqual([])
  })

  it('does not report a gust that swept an already-downed enemy', () => {
    // A connect has to mean a live enemy took it, or Focus would pay for blowing a
    // body around the island.
    let encounter = startEncounter(
      [{ id: 'a', position: new Vector3(0, 0, 5) }],
      DEFAULT_COMBAT_CONFIG,
    )
    encounter = {
      ...encounter,
      enemies: encounter.enemies.map((enemy) => ({
        ...enemy, health: { ...enemy.health, current: 0 },
      })),
    }
    const step = stepEncounter(encounter, {
      playerPosition: new Vector3(),
      playerForward: new Vector3(0, 0, 1),
      gustPressed: true,
    }, 1 / 60, DEFAULT_COMBAT_CONFIG)

    expect(step.hitThisFrame).toEqual([])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/combat/encounter.test.ts`
Expected: FAIL — `hitThisFrame` does not exist on `EncounterStep`.

- [ ] **Step 3: Write minimal implementation**

In `src/combat/encounter.ts`, add the field to `EncounterStep`:

```ts
export interface EncounterStep {
  encounter: Encounter
  /** Enemies knocked down this frame, for feedback and for scoring later. */
  downedThisFrame: string[]
  /** Enemies a gust connected with this frame, for feedback and for Focus. */
  hitThisFrame: string[]
  /** Whether the player was hit this frame, for feedback. */
  playerHit: boolean
}
```

In `stepEncounter`, hoist the connect list out of the gust branch. Replace:

```ts
  if (input.gustPressed && canGust(encounter)) {
    const caught = new Set(
      gustTargets(input.playerPosition, input.playerForward, enemies, c.gust)
        .map((enemy) => enemy.id),
    )
    enemies = enemies.map((enemy) =>
```

with:

```ts
  let hitThisFrame: string[] = []

  if (input.gustPressed && canGust(encounter)) {
    const caught = new Set(
      gustTargets(input.playerPosition, input.playerForward, enemies, c.gust)
        .map((enemy) => enemy.id),
    )
    // Read before the hits land, so "connected" means a live enemy took it rather
    // than a body being blown around the island.
    hitThisFrame = enemies
      .filter((enemy) => caught.has(enemy.id) && !isDowned(enemy.health))
      .map((enemy) => enemy.id)
    enemies = enemies.map((enemy) =>
```

and add it to the return:

```ts
  return {
    encounter: { enemies, playerHealth, gustCooldown },
    downedThisFrame,
    hitThisFrame,
    playerHit: damageToPlayer > 0,
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/combat/encounter.test.ts`
Expected: PASS, including every test that was already there.

- [ ] **Step 5: Prove the tests are not decorative**

Change the `hitThisFrame` filter to drop its `!isDowned(enemy.health)` clause. Expected: the already-downed test FAILS. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: both typecheck passes clean, whole suite green. No existing test should have needed a change — the new field is additive.

- [ ] **Step 7: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "Report the enemies a gust connected with

stepEncounter already computes the caught set inside its gust branch and then
throws it away. Focus needs it, and feedback will want it later.

Read before the hits land, so a connect means a live enemy took it rather than a
downed body being blown around the island.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The trigger input

**Files:**
- Modify: `src/core/types.ts` — `InputState`
- Modify: `src/core/input.ts` — `toInputState` and `InputTracker`
- Test: `src/core/input.test.ts` — additions

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `InputState` gains `avatarStatePressed: boolean`. `toInputState` gains an eighth positional parameter, `avatarStatePressed = false`.

- [ ] **Step 1: Write the failing test**

Add to `src/core/input.test.ts`, in the `describe('toInputState', ...)` block:

```ts
  it('passes the Avatar State trigger through', () => {
    const state = toInputState(
      new Set(), new Vector3(0, 0, -1), false, false, false, false, false, true,
    )
    expect(state.avatarStatePressed).toBe(true)
  })

  it('leaves the Avatar State trigger unpressed by default', () => {
    const state = toInputState(new Set(), new Vector3(0, 0, -1), false)
    expect(state.avatarStatePressed).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/core/input.test.ts`
Expected: FAIL — `avatarStatePressed` does not exist on `InputState`.

- [ ] **Step 3: Write minimal implementation**

In `src/core/types.ts`, add the last field of `InputState`:

```ts
  /** F, edge-triggered: a gust of air. */
  gustPressed: boolean
  /** E, edge-triggered: enter the Avatar State when it is armed. */
  avatarStatePressed: boolean
```

In `src/core/input.ts`, add the eighth parameter to `toInputState` and return it:

```ts
export function toInputState(
  held: ReadonlySet<string>,
  lookDirection: Vector3,
  actionPressed: boolean,
  actionReleased = false,
  scooterPressed = false,
  dashPressed = false,
  gustPressed = false,
  avatarStatePressed = false,
): InputState {
```

```ts
    gustPressed,
    avatarStatePressed,
  }
```

In `InputTracker`, add the field, the key, and the clear:

```ts
  private gustPressed = false
  private avatarStatePressed = false
```

```ts
      if (!e.repeat && e.code === 'KeyF') this.gustPressed = true
      if (!e.repeat && e.code === 'KeyE') this.avatarStatePressed = true
```

```ts
      this.gustPressed,
      this.avatarStatePressed,
    )
```

```ts
    this.gustPressed = false
    this.avatarStatePressed = false
    return state
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/core/input.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix every other `InputState` construction**

`InputState` has no optional fields, so adding one breaks every test fixture that builds a literal. Find them and add `avatarStatePressed: false`:

Run: `npm run typecheck`

Work through the reported errors. Expect several across `src/player/*.test.ts`. Do not make the field optional to avoid this work — a missing trigger should be a type error, not a silent `undefined`.

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: whole suite green, both typecheck passes clean.

- [ ] **Step 7: Commit**

```bash
git add -A src/core src/player
git commit -m "Add the Avatar State trigger on E

Edge-triggered and cleared on sample, with the same auto-repeat guard as the
gust and dash keys so a held E cannot re-fire it.

toInputState is now eight positional parameters deep, which is one more than it
should be. Left alone here to keep this change small; it wants an edges object
next time something is added.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Focus on the HUD

**Files:**
- Modify: `src/ui/hud.ts` — `HudModel`, `hudModelFor`, `STYLE`, `createHud`
- Test: `src/ui/hud.test.ts` — additions

**Interfaces:**
- Consumes: nothing from earlier tasks. `hud.ts` deliberately does **not** import from `src/focus/` — it takes plain numbers, so the HUD stays decoupled from the meter's internals.
- Produces:
  - `interface FocusReadout { focus: number; avatarCharge: number; avatarActive: boolean }`
  - `hudModelFor(state: PlayerState, playerHealth?: { current: number; max: number }, focus?: FocusReadout): HudModel`
  - `HudModel` gains `focus: number`, `showFocus: boolean`, `avatarCharge: number`, `avatarActive: boolean`

- [ ] **Step 1: Write the failing test**

Add to `src/ui/hud.test.ts`. The file already has the `p(over)` PlayerState fixture at the top; reuse it.

```ts
describe('hudModelFor focus', () => {
  it('hides the meter before the player has built anything', () => {
    const model = hudModelFor(p(), undefined, {
      focus: 0, avatarCharge: 0, avatarActive: false,
    })
    expect(model.showFocus).toBe(false)
  })

  it('shows the meter once there is something in it', () => {
    const model = hudModelFor(p(), undefined, {
      focus: 0.02, avatarCharge: 0, avatarActive: false,
    })
    expect(model.showFocus).toBe(true)
  })

  it('shows the meter during the Avatar State even at zero', () => {
    // The state freezes Focus, but an empty bar vanishing mid-state would read as
    // the HUD breaking at the loudest moment in the game.
    const model = hudModelFor(p(), undefined, {
      focus: 0, avatarCharge: 0, avatarActive: true,
    })
    expect(model.showFocus).toBe(true)
  })

  it('clamps a fraction that arrives out of range', () => {
    const model = hudModelFor(p(), undefined, {
      focus: 1.4, avatarCharge: -0.2, avatarActive: false,
    })
    expect(model.focus).toBe(1)
    expect(model.avatarCharge).toBe(0)
  })

  it('never shows a non-finite fraction', () => {
    const model = hudModelFor(p(), undefined, {
      focus: NaN, avatarCharge: NaN, avatarActive: false,
    })
    expect(model.focus).toBe(0)
    expect(model.avatarCharge).toBe(0)
  })

  it('works with no focus readout at all, for anywhere Focus is not running', () => {
    const model = hudModelFor(p())
    expect(model.focus).toBe(0)
    expect(model.showFocus).toBe(false)
    expect(model.avatarActive).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/hud.test.ts`
Expected: FAIL — `hudModelFor` takes two arguments; `showFocus` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `src/ui/hud.ts`, add the readout type and a clamp helper above `HudModel`:

```ts
/**
 * The Focus values the HUD draws, as plain fractions.
 *
 * Deliberately not the Focus and AvatarState structs themselves — the HUD has no
 * business knowing how the meter works, and the caller already has to divide.
 */
export interface FocusReadout {
  /** 0 to 1. */
  focus: number
  /** 0 to 1: progress toward arming the Avatar State. */
  avatarCharge: number
  avatarActive: boolean
}

/** Fractions arrive from a division, so a non-finite one must not reach the DOM. */
function fraction(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}
```

Extend `HudModel`:

```ts
  /** 0 to 1. */
  health: number
  showHealth: boolean
  /** 0 to 1. */
  focus: number
  showFocus: boolean
  /** 0 to 1: progress toward arming the Avatar State. */
  avatarCharge: number
  avatarActive: boolean
}
```

Extend `hudModelFor`:

```ts
export function hudModelFor(
  state: PlayerState,
  playerHealth?: { current: number; max: number },
  focus?: FocusReadout,
): HudModel {
```

and inside, before the return:

```ts
  const focusValue = fraction(focus?.focus ?? 0)
  const avatarActive = focus?.avatarActive ?? false
```

and in the returned object:

```ts
    focus: focusValue,
    // Quiet until the player has earned something, and never hidden mid-state.
    showFocus: focusValue > 0 || avatarActive,
    avatarCharge: fraction(focus?.avatarCharge ?? 0),
    avatarActive,
  }
```

Add to `STYLE`:

```css
.hud-focus { width: 180px; height: 8px; border-radius: 4px; margin-bottom: 4px;
  background: rgba(255,255,255,.22); overflow: hidden; transition: opacity .2s; }
.hud-focus-fill { height: 100%; width: 100%;
  background: linear-gradient(90deg,#e6b23c,#ffe9a8); transform-origin: left center;
  transition: background .3s; }
.hud-focus.is-avatar .hud-focus-fill {
  background: linear-gradient(90deg,#fff3c4,#ffffff); }
.hud-arm { width: 180px; height: 3px; border-radius: 2px; margin-bottom: 6px;
  background: rgba(255,255,255,.15); overflow: hidden; transition: opacity .2s; }
.hud-arm-fill { height: 100%; width: 100%; background: #fff8dc;
  transform-origin: left center; }
.hud-vignette { position: fixed; inset: 0; pointer-events: none; opacity: 0;
  transition: opacity .35s; box-shadow: inset 0 0 180px 40px rgba(255,214,102,.55); }
.hud-vignette.is-on { opacity: 1; }
```

In `createHud`, add the markup above the health bar — Focus sits at the top of the stack, since it is the slowest-moving of the three meters:

```ts
  root.innerHTML = `
    <div class="hud-readouts">
      <span data-altitude></span>
      <span data-airspeed></span>
    </div>
    <div class="hud-focus"><div class="hud-focus-fill"></div></div>
    <div class="hud-arm"><div class="hud-arm-fill"></div></div>
    <div class="hud-health"><div class="hud-health-fill"></div></div>
    <div class="hud-breath"><div class="hud-breath-fill"></div></div>
    <div class="hud-vignette"></div>
  `
```

Add the lookups next to the existing ones:

```ts
  const focusBar = root.querySelector('.hud-focus') as HTMLElement
  const focusFill = root.querySelector('.hud-focus-fill') as HTMLElement
  const armBar = root.querySelector('.hud-arm') as HTMLElement
  const armFill = root.querySelector('.hud-arm-fill') as HTMLElement
  const vignette = root.querySelector('.hud-vignette') as HTMLElement
```

and to `update`:

```ts
      focusBar.style.opacity = model.showFocus ? '1' : '0'
      focusFill.style.transform = `scaleX(${model.focus})`
      focusBar.classList.toggle('is-avatar', model.avatarActive)
      // The pip only ever fills at maximum Focus, so its appearance is itself the
      // signal that the Avatar State is coming.
      armBar.style.opacity = model.avatarCharge > 0 && !model.avatarActive ? '1' : '0'
      armFill.style.transform = `scaleX(${model.avatarCharge})`
      vignette.classList.toggle('is-on', model.avatarActive)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ui/hud.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. Change `showFocus` to `focusValue > 0` only. Expected: the "shows the meter during the Avatar State even at zero" test FAILS. Revert.
2. Replace `fraction(...)` with the raw value for `focus`. Expected: the clamp and non-finite tests FAIL. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm test && npm run typecheck`
Expected: whole suite green, both passes clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/hud.ts src/ui/hud.test.ts
git commit -m "Put Focus, the arming pip and the Avatar State vignette on the HUD

Focus takes the top of the meter stack, being the slowest-moving of the three.
The arming pip only ever fills at maximum Focus, so it appearing is itself the
signal that the Avatar State is available.

hudModelFor takes plain fractions rather than the Focus structs, so the HUD does
not need to know how the meter works.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire it into the game

**Files:**
- Modify: `src/fx/audio.ts` — `update` gains a `swell` parameter
- Modify: `src/main.ts` — frame wiring
- Modify: `README.md` — controls table and prose
- Modify: `docs/HANDOFF.md` — move Focus out of "not built"

**Interfaces:**
- Consumes: everything from Tasks 1–7. Exact names: `DEFAULT_FOCUS_CONFIG`, `DEFAULT_AVATAR_STATE_CONFIG` (`src/focus/config.ts`); `emptyFocus`, `stepFocus`, `type FocusEvents` (`src/focus/focus.ts`); `traversalRatePerSecond`, `fellOutOfWorld` (`src/focus/sources.ts`); `restingAvatarState`, `stepAvatarState`, `armFraction` (`src/focus/avatar-state.ts`); `boostedCombatConfig`, `surgeWind`, `refillBreath` (`src/focus/effects.ts`); `stillAir`, `type WindSample` (`src/world/wind.ts`).
- Produces: nothing further.

- [ ] **Step 1: Add the audio swell**

`main.ts` is not unit-tested and neither is `createWindAudio`, which needs a real `AudioContext`. This task is verified by the full suite, both typecheck passes, a clean build, and playing it.

In `src/fx/audio.ts`, change `update`:

```ts
    /** `swell` from 0 to 1 lifts the wind for the Avatar State. */
    update(airspeed: number, swell = 0): void {
      if (!context || !gain || !filter) return
      const now = context.currentTime
      // Ramps rather than direct assignment, otherwise the audio clicks.
      gain.gain.setTargetAtTime(windVolumeForSpeed(airspeed) * 0.35 + swell * 0.25, now, 0.1)
      filter.frequency.setTargetAtTime(
        400 + 900 * windPitchForSpeed(airspeed) + 700 * swell, now, 0.1,
      )
    },
```

- [ ] **Step 2: Add the imports and state to `main.ts`**

Imports, next to the existing combat ones:

```ts
import { DEFAULT_FOCUS_CONFIG, DEFAULT_AVATAR_STATE_CONFIG } from './focus/config'
import { emptyFocus, stepFocus, type FocusEvents } from './focus/focus'
import { traversalRatePerSecond, fellOutOfWorld } from './focus/sources'
import { restingAvatarState, stepAvatarState, armFraction } from './focus/avatar-state'
import { boostedCombatConfig, surgeWind, refillBreath } from './focus/effects'
```

Change the wind import to pull in what the surge needs:

```ts
import { windSampler, stillAir, type WindSample } from './world/wind'
```

Presentation constants, near the top of `start()`:

```ts
  /** How much faster the mote clouds drift while the Avatar State runs. */
  const WIND_TELL_SURGE = 2.5
  /** Wind audio lift while the Avatar State runs. */
  const AUDIO_SWELL = 0.45
```

State, next to `let player = ...`:

```ts
  let focus = emptyFocus(DEFAULT_FOCUS_CONFIG)
  let avatarState = restingAvatarState()
  let avatarActive = false
  /** The unsurged sample from the last windAt call, so the surge cannot feed itself. */
  let lastWind: WindSample = stillAir()
```

- [ ] **Step 3: Wrap the wind sampler**

Replace the `windAt: windSampler(ARCHIPELAGO.winds ?? [])` line in `deps` with a base sampler declared above `deps` and a wrapper:

```ts
  const baseWindAt = windSampler(ARCHIPELAGO.winds ?? [])

  const deps: ControllerDeps = {
    terrain: world.terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    spawnPointFor: spawnPointFor(ARCHIPELAGO, world.terrain),
    // Surged for the Avatar State on the way out, and the unsurged sample kept so
    // the Focus rate reads the real air rather than the boosted one.
    windAt: (position, forward) => {
      lastWind = baseWindAt(position, forward)
      return surgeWind(lastWind, avatarActive ? 1 : 0, DEFAULT_AVATAR_STATE_CONFIG)
    },
  }
```

- [ ] **Step 4: Rewrite the frame body**

In `update`, replace the opening two lines and the combat/audio/HUD tail. The full ordering:

```ts
  function update(dt: number): void {
    const state = input.sample()

    // Read before controllerStep: it resolves a fall internally and hands back an
    // already-respawned state, so there is nothing left to observe afterwards.
    const crashed = fellOutOfWorld(player, ARCHIPELAGO.worldFloorY)

    // Steps first, off last frame's Focus, so the effects apply from the frame the
    // player pressed rather than the one after. The cost is a frame of latency on
    // arming, which nobody can feel; the benefit is that no system here needs a
    // value that depends on itself.
    const asStep = stepAvatarState(
      avatarState, focus, state.avatarStatePressed, dt, DEFAULT_AVATAR_STATE_CONFIG,
    )
    avatarState = asStep.state
    avatarActive = asStep.active

    // Cleared each frame; windAt overwrites it when the glider asks about the air.
    lastWind = stillAir()
    player = controllerStep(player, state, dt, deps)
    if (avatarActive) player = refillBreath(player)
```

Leave the shrine collection, facing, avatar, camera, marker and waterfall blocks exactly as they are. Change the wind tell loop:

```ts
    for (const tell of windTells) tell.advance(dt * (avatarActive ? WIND_TELL_SURGE : 1))
```

Change the combat step to take the boosted config, and add the Focus step after it:

```ts
    const fight = stepEncounter(encounter, {
      playerPosition: player.position,
      playerForward: player.forward,
      gustPressed: state.gustPressed,
    }, dt, boostedCombatConfig(DEFAULT_COMBAT_CONFIG, avatarActive, DEFAULT_AVATAR_STATE_CONFIG))
    encounter = fight.encounter
    for (const enemy of encounter.enemies) enemyViews.get(enemy.id)?.sync(enemy)

    const events: FocusEvents = {
      gustConnects: fight.hitThisFrame.length,
      downs: fight.downedThisFrame.length,
      playerHit: fight.playerHit,
      fellOutOfWorld: crashed,
    }
    const inWind = lastWind.accel.lengthSq() > 1e-6 || lastWind.liftScale !== 1
    focus = stepFocus(focus, {
      ratePerSecond: traversalRatePerSecond(
        player, inWind, DEFAULT_FLIGHT_CONFIG, DEFAULT_FOCUS_CONFIG,
      ),
      events,
      frozen: avatarActive,
      reset: asStep.justEnded,
    }, dt, DEFAULT_FOCUS_CONFIG)

    wind.update(
      player.mode === 'glider' ? airspeed : 0,
      avatarActive ? AUDIO_SWELL : 0,
    )
    hud.update(hudModelFor(player, encounter.playerHealth, {
      focus: focus.max > 0 ? focus.value / focus.max : 0,
      avatarCharge: armFraction(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
      avatarActive,
    }))
  }
```

- [ ] **Step 5: Verify it builds and the suite is green**

Run: `npm test && npm run typecheck && npm run build`
Expected: whole suite green, both typecheck passes clean, build succeeds.

- [ ] **Step 6: Play it**

Start the dev server through the preview tooling (never `npm run dev` via a shell) and check, in order:

1. The Focus bar is hidden at spawn, and appears once you take off and glide.
2. Gliding above stall fills it; landing and standing still drains it.
3. Flying through a wind feature's mote cloud fills it visibly faster.
4. At full Focus, the thin pip appears and fills over about four seconds.
5. `E` with the pip full triggers the state: vignette on, wind audio swells, motes speed up, breath pinned at full, and one `F` downs a spear soldier outright.
6. After eight seconds it ends, the vignette fades and Focus is empty.
7. Taking a spear hit at full Focus drops the bar and removes the pip.

Note: `docs/HANDOFF.md` records that the preview pane's animation loop stalls intermittently. If the game renders but stops advancing, that is the known issue, not a bug in this feature — reload and continue. Check the browser console for errors either way.

- [ ] **Step 7: Update the README**

Add the row to the controls table, after the `F` row:

```markdown
| `E` | Avatar State — when the pip under your Focus is full | Avatar State |
```

Add a paragraph after the existing combat paragraph:

```markdown
Focus is the reward for playing well rather than just surviving. It builds while you hold
a clean line — gliding above stall speed, and about twice as fast riding a thermal or a
wind river — and much faster in a fight, on every gust that connects and every soldier you
put down. Standing still drains it, and a spear hit takes nearly a third of the bar. The
longer you go unbroken the better everything pays, so a long run is worth more than the sum
of its parts, and losing it costs more too.

Hold Focus at maximum and a thin pip fills beneath the bar. Once it is full, `E` spends the
whole meter on the Avatar State: eight seconds of free breath, a gust that downs a soldier
outright, and every wind feature in the archipelago turning to your side — thermals surge,
downdrafts relent, dead air comes back to life. The pip only holds while Focus stays at
maximum, so one hit takes both.
```

- [ ] **Step 8: Update the handoff**

In `docs/HANDOFF.md`:

1. In "What has NOT been built", remove `the Focus meter,` and `and the Avatar State` from the §4 combat bullet, and rewrite the §4.6 bullet, which currently says Focus does not exist:

```markdown
- **§4.6 non-lethality scoring.** Downing an enemy grants Focus, but nothing yet grants
  *more* for a non-lethal removal than for an environmental accident, because enemies
  have no fall physics — every down is already a gust. The distinction waits for enemies
  that can be blown off a ledge.
```

2. Add a paragraph to "What has been built", after the combat one:

```markdown
**Focus and the Avatar State.** `src/focus/` holds the second of the design document's
three meters: it builds from clean traversal and combat chains, drains on damage, and
encodes "unbroken chains" as a ramp on the gain rate rather than a separate combo
counter. Holding it at maximum arms the Avatar State, which the player fires with `E`
for eight seconds of free breath, a one-hit gust, and every wind feature in the
archipelago surging. The state's effects are pure transforms of existing config and
samples, so the flight, combat and wind models contain no mention of it.
```

3. Add to the untested-tuning list, in the "Nothing has been playtested" paragraph, after `every wind strength`: `, every value in src/focus/config.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts src/fx/audio.ts README.md docs/HANDOFF.md
git commit -m "Wire Focus and the Avatar State into the game

The frame order resolves a circularity between the three systems: the Avatar
State steps first off last frame's Focus, so its effects apply from the frame the
player pressed rather than the one after. One frame of latency on arming, which
nobody can feel.

The wind sampler is wrapped rather than replaced, and the unsurged sample is kept
so the Focus rate reads the real air. Otherwise the surge would feed itself: the
state boosts the wind, the boosted wind pays more Focus.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done when

- `npm test` green, `npm run typecheck` clean on both passes, `npm run build` clean.
- Every "prove the tests are not decorative" step has been run and reverted.
- The seven play checks in Task 8 Step 6 have actually been performed in a browser.
- `README.md` and `docs/HANDOFF.md` reflect the new feature.
- All work is on `focus-meter`. `main` is untouched.

## Out of scope

Carried over from the spec, and not to be added opportunistically:

- §4.6's extra Focus for non-lethal removals over environmental accidents — needs enemies with fall physics.
- Redirected projectiles and damage avoided at close range as Focus sources — need archers and a near-miss test.
- Elemental heavy moves as a Focus sink, and "all elements simultaneously" in the Avatar State.
- Story-locking the Avatar State — there is no act structure yet.
- Persisting Focus across sessions.
- Refactoring `toInputState` away from positional parameters.
