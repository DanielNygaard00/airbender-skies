# Impact feel and encounter lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every combat event a body — a freeze, a shake, a spark, a sound — and make a fight repeatable so those values can be felt more than once.

**Architecture:** Every rule is a pure function with a test; the only untested code is the imperative shell that hands numbers to three.js or WebAudio, matching how `src/fx/audio.ts` already splits from `src/fx/mapping.ts`. Hitstop is an early return in `main.ts`'s `update`, which the fixed-step accumulator in `src/core/loop.ts` tolerates without change. Shake is a render-time camera offset that never enters the simulation.

**Tech Stack:** TypeScript 7, three.js 0.185.1, Vitest 4 (node environment), Vite 8.

Spec: [`docs/superpowers/specs/2026-08-05-impact-feel-and-encounter-lifecycle-design.md`](../specs/2026-08-05-impact-feel-and-encounter-lifecycle-design.md)

## Global Constraints

- **Branch is `impact-feel`. Never commit to `main`** — pushing `main` triggers the GitHub Pages deploy in `.github/workflows/deploy.yml`.
- **Typecheck is two passes:** `npm run typecheck` runs `tsconfig.json` then `tsconfig.test.json`. App code deliberately cannot see Node globals; only tests can. Run it after every task, not just at the end.
- **`noUncheckedIndexedAccess` is on.** Indexed access is `T | undefined`. `array[0]` needs a guard or a non-null assertion with a reason.
- **Red-proof every test.** After writing a test, neutralise the feature in config or code and confirm the test goes red. If it stays green, the test is decorative. This repo has shipped fourteen tests that could not fail; do not add the fifteenth.
- **Assert intended literals, never the config the code reads.** `expect(gain).toBe(c.accidentDownGain)` passes for any value including the one it exists to differ from. Use a test config with values distinct from the defaults.
- **No bare `>` comparisons for "materially bigger" claims.** Assert a margin. A bare `>` passes on a millionth of a unit.
- **Struct widening — the verified blast radius for this cycle.** Checked, and it is narrow because the fixtures use spread helpers:
  - `FocusEvents.accidents` — `noFocusEvents()` covers `focus.test.ts` (it builds events as `{ ...noFocusEvents(), ...over.events }`). Only **`src/main.ts`**'s literal needs the new field.
  - `EncounterDeps.spawns` / `.patrol` — `src/combat/encounter.test.ts:50` has a single `const DEPS`, used by all 36 `stepEncounter` calls. One line.
  - `EnemyStep.fellOutOfWorld`, `EncounterStep.lostThisFrame`, `EncounterStep.restoredThisFrame`, `HudModel.hurtFlash` — all **outputs**. No test builds one, and no test asserts a whole step with `toEqual`, so nothing breaks.
  - Still re-run both typecheck passes after each struct change rather than trusting this list.
- **Run one test file with** `npx vitest run src/path/to/file.test.ts`. Run everything with `npm test`.
- **Prose in code, comments, commits and docs is normal English.** Explain *why* in comments, mark regression guards as such.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/fx/config.ts` (new) | `HitstopConfig`, `ShakeConfig` and their defaults. Tuning tables, kept out of `mapping.ts` so that stays pure functions. |
| `src/fx/hitstop.ts` (new) | The freeze timer. Longest-wins. |
| `src/fx/shake.ts` (new) | Camera kick state and its offset. Strongest-wins. |
| `src/fx/pulse.ts` (new) | One decaying 0-to-1 value, shared by the hurt flash and the dash FOV kick. |
| `src/fx/impact-targets.ts` (new) | Which enemies get a hit burst and which get a down burst. |
| `src/fx/combat-audio.ts` (new) | Five synthesised voices. Imperative, untested. |
| `src/fx/mapping.ts` (mod) | `fovKickForDash`, swing level and duration. |
| `src/ui/hud.ts` (mod) | `hurtFlash` on the model, red overlay in the DOM. |
| `src/combat/enemy.ts` (mod) | `EnemyStep.fellOutOfWorld`. |
| `src/combat/patrol.ts` (new) | When a downed patrol restores. |
| `src/combat/encounter.ts` (mod) | `lostThisFrame`, `restoredThisFrame`, the restore call. |
| `src/combat/config.ts` (mod) | `DEFAULT_PATROL_CONFIG`. |
| `src/focus/focus.ts` (mod) | `accidents` event, `accidentDownGain`. |
| `src/focus/config.ts` (mod) | The gain value. |
| `src/main.ts` (mod) | All wiring. Untested, so every rule it uses lives in a module above. |
| `docs/HANDOFF.md` (mod) | New sections, and the §4.6 correction. |

---

### Task 1: The hitstop timer

**Files:**
- Create: `src/fx/config.ts`
- Create: `src/fx/hitstop.ts`
- Test: `src/fx/hitstop.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `HitstopConfig { finisherSeconds, downSeconds, slamMinSeconds, slamMaxSeconds }`, `DEFAULT_HITSTOP_CONFIG`, `HitstopState { remaining: number }`, `noHitstop(): HitstopState`, `isFrozen(s: HitstopState): boolean`, `triggerHitstop(s: HitstopState, seconds: number): HitstopState`, `stepHitstop(s: HitstopState, dt: number): HitstopState`, `slamHitstopSeconds(strength: number, c: HitstopConfig): number`.

- [ ] **Step 1: Write the failing test**

`src/fx/hitstop.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isFrozen, noHitstop, slamHitstopSeconds, stepHitstop, triggerHitstop,
} from './hitstop'
import type { HitstopConfig } from './config'

// Deliberately unlike DEFAULT_HITSTOP_CONFIG, so an assertion that accidentally
// reads the shipped values instead of these is visible rather than silent.
const C: HitstopConfig = {
  finisherSeconds: 0.2,
  downSeconds: 0.3,
  slamMinSeconds: 0.1,
  slamMaxSeconds: 0.5,
}

describe('the freeze', () => {
  it('starts unfrozen', () => {
    expect(isFrozen(noHitstop())).toBe(false)
  })

  it('freezes for the requested time', () => {
    expect(triggerHitstop(noHitstop(), 0.05).remaining).toBeCloseTo(0.05)
  })

  it('decays to exactly zero and stops there', () => {
    const frozen = triggerHitstop(noHitstop(), 0.05)
    const done = stepHitstop(stepHitstop(frozen, 0.04), 0.04)
    expect(done.remaining).toBe(0)
    expect(isFrozen(done)).toBe(false)
    // Clamped, not negative: a negative remaining would read as frozen under a
    // `!== 0` test and would drift further from zero every frame.
    expect(stepHitstop(done, 0.04).remaining).toBe(0)
  })

  it('ignores a non-positive or non-finite request', () => {
    const idle = noHitstop()
    expect(triggerHitstop(idle, 0).remaining).toBe(0)
    expect(triggerHitstop(idle, -1).remaining).toBe(0)
    expect(triggerHitstop(idle, Number.NaN).remaining).toBe(0)
  })
})

describe('two events on one frame', () => {
  // Asserted in BOTH orders on purpose. A single trigger passes identically under
  // longest-wins and under an additive implementation, so a one-directional test
  // proves nothing. Additive is the bug being guarded: a staff finisher that downs
  // a soldier is two triggers on one frame, and a slam into three soldiers is four,
  // so summing turns a good hit into a visible stall.
  it('keeps the longest, whichever arrived first', () => {
    const longThenShort = triggerHitstop(triggerHitstop(noHitstop(), 0.05), 0.03)
    const shortThenLong = triggerHitstop(triggerHitstop(noHitstop(), 0.03), 0.05)
    expect(longThenShort.remaining).toBeCloseTo(0.05)
    expect(shortThenLong.remaining).toBeCloseTo(0.05)
  })

  it('does not shorten a freeze already running', () => {
    const running = stepHitstop(triggerHitstop(noHitstop(), 0.09), 0.01)
    expect(triggerHitstop(running, 0.02).remaining).toBeCloseTo(0.08)
  })
})

describe('a slam scales with its own strength', () => {
  it('freezes for the minimum at zero strength', () => {
    expect(slamHitstopSeconds(0, C)).toBeCloseTo(0.1)
  })

  it('freezes for the maximum at full strength', () => {
    expect(slamHitstopSeconds(1, C)).toBeCloseTo(0.5)
  })

  it('interpolates between them', () => {
    expect(slamHitstopSeconds(0.5, C)).toBeCloseTo(0.3)
  })

  it('clamps a strength outside the range', () => {
    expect(slamHitstopSeconds(-2, C)).toBeCloseTo(0.1)
    expect(slamHitstopSeconds(9, C)).toBeCloseTo(0.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/hitstop.test.ts`
Expected: FAIL — cannot resolve `./hitstop` or `./config`.

- [ ] **Step 3: Write the config**

`src/fx/config.ts`:

```ts
/**
 * Tuning for the effects that are felt rather than seen.
 *
 * Separate from `mapping.ts`, which is pure functions over a handful of named
 * constants — dropping tables of tuning values into it would blur what that module
 * is for.
 *
 * Every value here is a guess about feel, which no test can check. The point of
 * naming them is that they are in one place and tunable, not that they are right.
 */
export interface HitstopConfig {
  /** A staff finisher connecting. */
  finisherSeconds: number
  /** An enemy going down. The loudest event in the fight. */
  downSeconds: number
  /** A minimum-strength Pressure Wave. */
  slamMinSeconds: number
  /** A full committed dive. The heaviest thing in the game. */
  slamMaxSeconds: number
}

export const DEFAULT_HITSTOP_CONFIG: HitstopConfig = {
  // Three frames at 60Hz: enough to register, short enough not to read as a stutter.
  finisherSeconds: 0.05,
  downSeconds: 0.07,
  slamMinSeconds: 0.04,
  slamMaxSeconds: 0.09,
}
```

- [ ] **Step 4: Write the module**

`src/fx/hitstop.ts`:

```ts
import { MathUtils } from 'three'
import type { HitstopConfig } from './config'

/**
 * The freeze that gives a heavy hit weight.
 *
 * A module rather than two lines in `main.ts` because of one rule: the longest
 * freeze wins, and freezes never add. Any real hit produces several triggers on one
 * frame — a finisher that downs a soldier is two, a slam into three soldiers is four
 * — and the difference between longest-wins and additive is invisible until it
 * happens in play, at which point a good hit reads as the game hanging.
 */
export interface HitstopState {
  /** Seconds of simulation still to skip. */
  remaining: number
}

export function noHitstop(): HitstopState {
  return { remaining: 0 }
}

export function isFrozen(state: HitstopState): boolean {
  return state.remaining > 0
}

/** Longest wins. A shorter request never shortens a freeze already running. */
export function triggerHitstop(state: HitstopState, seconds: number): HitstopState {
  if (!Number.isFinite(seconds) || seconds <= 0) return state
  return { remaining: Math.max(state.remaining, seconds) }
}

/**
 * Clamped at zero rather than allowed negative: a negative remaining reads as frozen
 * under any `!== 0` test and drifts further from zero every frame it is stepped.
 */
export function stepHitstop(state: HitstopState, dt: number): HitstopState {
  if (!Number.isFinite(dt)) return state
  return { remaining: Math.max(0, state.remaining - dt) }
}

/** How long a slam freezes for, from the same 0-to-1 strength its damage reads. */
export function slamHitstopSeconds(strength: number, c: HitstopConfig): number {
  return MathUtils.lerp(
    c.slamMinSeconds, c.slamMaxSeconds, MathUtils.clamp(strength, 0, 1),
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/fx/hitstop.test.ts`
Expected: PASS.

- [ ] **Step 6: Red-proof the longest-wins rule**

Temporarily change `triggerHitstop`'s return to `{ remaining: state.remaining + seconds }`.

Run: `npx vitest run src/fx/hitstop.test.ts`
Expected: FAIL on "keeps the longest, whichever arrived first" and "does not shorten a freeze already running". If either stays green, the test is decorative — fix the test, not the code.

Revert the change and confirm PASS again.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/fx/config.ts src/fx/hitstop.ts src/fx/hitstop.test.ts
git commit -m "Add the hitstop timer, where the longest freeze wins"
```

---

### Task 2: The camera shake

**Files:**
- Create: `src/fx/shake.ts`
- Modify: `src/fx/config.ts`
- Test: `src/fx/shake.test.ts`

**Interfaces:**
- Consumes: `src/fx/config.ts` from Task 1.
- Produces: `ShakeConfig { slamMinAmplitude, slamMaxAmplitude, slamSeconds, downAmplitude, downSeconds, hurtAmplitude, hurtSeconds }`, `DEFAULT_SHAKE_CONFIG`, `ShakeState { remaining, duration, amplitude }`, `noShake(): ShakeState`, `triggerShake(s, amplitude, seconds): ShakeState`, `stepShake(s, dt): ShakeState`, `shakeOffset(s, out: Vector3): Vector3`, `slamShakeAmplitude(strength, c): number`.

- [ ] **Step 1: Write the failing test**

`src/fx/shake.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { noShake, shakeOffset, slamShakeAmplitude, stepShake, triggerShake } from './shake'
import type { ShakeConfig } from './config'

const C: ShakeConfig = {
  slamMinAmplitude: 0.1,
  slamMaxAmplitude: 0.5,
  slamSeconds: 0.3,
  downAmplitude: 0.2,
  downSeconds: 0.2,
  hurtAmplitude: 0.4,
  hurtSeconds: 0.25,
}

const out = () => new Vector3()

/**
 * The largest offset magnitude seen across a whole shake, sampled every frame.
 *
 * Sampling rather than probing one moment, because the offset is a sine and a single
 * probe can land on a zero crossing. A test that reads 0.5 of the way through a
 * decaying oscillation is exactly the shape that shipped green-and-useless here
 * during the staff work.
 */
function peakOver(amplitude: number, seconds: number, from = 0, to = seconds): number {
  let state = triggerShake(noShake(), amplitude, seconds)
  const dt = 1 / 240
  let elapsed = 0
  let peak = 0
  const v = out()
  while (state.remaining > 0) {
    if (elapsed >= from && elapsed < to) {
      peak = Math.max(peak, shakeOffset(state, v).length())
    }
    state = stepShake(state, dt)
    elapsed += dt
  }
  return peak
}

describe('the kick', () => {
  it('is nothing before anything happens', () => {
    expect(shakeOffset(noShake(), out()).length()).toBe(0)
  })

  it('actually moves the camera, by a real fraction of the amplitude', () => {
    // A margin rather than `> 0`, which passes on a millionth of a unit.
    expect(peakOver(0.4, 0.25)).toBeGreaterThan(0.4 * 0.5)
  })

  it('never exceeds the amplitude it was given', () => {
    expect(peakOver(0.4, 0.25)).toBeLessThanOrEqual(0.4 + 1e-9)
  })

  it('decays: the second half is materially quieter than the first', () => {
    const early = peakOver(0.4, 0.25, 0, 0.125)
    const late = peakOver(0.4, 0.25, 0.125, 0.25)
    // Half, not merely smaller. A bare `>` would pass on a decay of nothing.
    expect(late).toBeLessThan(early * 0.6)
  })

  it('is exactly zero once spent, not merely small', () => {
    let state = triggerShake(noShake(), 0.4, 0.05)
    state = stepShake(state, 0.06)
    expect(state.remaining).toBe(0)
    expect(shakeOffset(state, out()).length()).toBe(0)
  })

  it('does not trace a straight line', () => {
    // Two axes at different frequencies. If both used one frequency the offset would
    // oscillate along a single diagonal, which reads as a slide rather than a shake.
    let state = triggerShake(noShake(), 0.4, 0.25)
    const ratios: number[] = []
    const v = out()
    for (let i = 0; i < 20; i++) {
      const o = shakeOffset(state, v)
      if (Math.abs(o.x) > 1e-6) ratios.push(o.y / o.x)
      state = stepShake(state, 1 / 240)
    }
    const spread = Math.max(...ratios) - Math.min(...ratios)
    expect(spread).toBeGreaterThan(0.5)
  })
})

describe('two events on one frame', () => {
  // Both orders, for the same reason hitstop's longest-wins is tested both ways.
  it('keeps the strongest, whichever arrived first', () => {
    const bigThenSmall = triggerShake(triggerShake(noShake(), 0.4, 0.2), 0.1, 0.2)
    const smallThenBig = triggerShake(triggerShake(noShake(), 0.1, 0.2), 0.4, 0.2)
    expect(bigThenSmall.amplitude).toBeCloseTo(0.4)
    expect(smallThenBig.amplitude).toBeCloseTo(0.4)
  })

  it('restarts the clock when the stronger one arrives', () => {
    const running = stepShake(triggerShake(noShake(), 0.1, 0.2), 0.15)
    expect(triggerShake(running, 0.4, 0.2).remaining).toBeCloseTo(0.2)
  })

  it('ignores a non-positive or non-finite request', () => {
    const idle = noShake()
    expect(triggerShake(idle, 0, 0.2).amplitude).toBe(0)
    expect(triggerShake(idle, 0.4, 0).amplitude).toBe(0)
    expect(triggerShake(idle, Number.NaN, 0.2).amplitude).toBe(0)
    expect(triggerShake(idle, 0.4, Number.POSITIVE_INFINITY).amplitude).toBe(0)
  })
})

describe('a slam scales with its own strength', () => {
  it('runs from the minimum to the maximum amplitude', () => {
    expect(slamShakeAmplitude(0, C)).toBeCloseTo(0.1)
    expect(slamShakeAmplitude(1, C)).toBeCloseTo(0.5)
    expect(slamShakeAmplitude(0.5, C)).toBeCloseTo(0.3)
  })

  it('clamps a strength outside the range', () => {
    expect(slamShakeAmplitude(-1, C)).toBeCloseTo(0.1)
    expect(slamShakeAmplitude(4, C)).toBeCloseTo(0.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/shake.test.ts`
Expected: FAIL — cannot resolve `./shake`.

- [ ] **Step 3: Add the config**

Append to `src/fx/config.ts`:

```ts
export interface ShakeConfig {
  /** A minimum-strength Pressure Wave. */
  slamMinAmplitude: number
  /** A full committed dive. */
  slamMaxAmplitude: number
  slamSeconds: number
  downAmplitude: number
  downSeconds: number
  /** Above a down: the player's own damage is what they most need to notice. */
  hurtAmplitude: number
  hurtSeconds: number
}

export const DEFAULT_SHAKE_CONFIG: ShakeConfig = {
  slamMinAmplitude: 0.15,
  slamMaxAmplitude: 0.35,
  slamSeconds: 0.25,
  // Present but not disruptive: downs come in threes.
  downAmplitude: 0.18,
  downSeconds: 0.18,
  hurtAmplitude: 0.22,
  hurtSeconds: 0.2,
}
```

- [ ] **Step 4: Write the module**

`src/fx/shake.ts`:

```ts
import { MathUtils, Vector3 } from 'three'
import type { ShakeConfig } from './config'

/**
 * Frequencies in radians per second, deliberately different per axis.
 *
 * One frequency for both axes makes the offset oscillate along a single diagonal,
 * which reads as the camera sliding rather than shaking. These give roughly five and
 * seven cycles across a 0.2 second kick.
 */
const FREQ_X = 160
const FREQ_Y = 215

/**
 * A decaying camera kick.
 *
 * Trigonometric rather than random on purpose. A random offset cannot be asserted
 * about, and this project already keeps `src/core/rng.ts` because unrepeatable
 * randomness has been a problem here before. At 60Hz a decaying sine pair is
 * indistinguishable from noise, and it is testable.
 */
export interface ShakeState {
  remaining: number
  /** Held so the decay can be expressed as a fraction of the original length. */
  duration: number
  amplitude: number
}

export function noShake(): ShakeState {
  return { remaining: 0, duration: 0, amplitude: 0 }
}

/**
 * Strongest wins, for the same reason `triggerHitstop`'s longest wins: a real hit
 * fires several of these on one frame, and adding them would put the camera through
 * the floor.
 */
export function triggerShake(
  state: ShakeState, amplitude: number, seconds: number,
): ShakeState {
  if (!Number.isFinite(amplitude) || !Number.isFinite(seconds)) return state
  if (amplitude <= 0 || seconds <= 0) return state
  // A weaker kick never interrupts a stronger one already running, but it does start
  // one when nothing is running.
  if (state.remaining > 0 && amplitude <= state.amplitude) return state
  return { remaining: seconds, duration: seconds, amplitude }
}

/** Resets to exactly `noShake()` when spent, so `shakeOffset` returns a true zero. */
export function stepShake(state: ShakeState, dt: number): ShakeState {
  if (!Number.isFinite(dt)) return state
  const remaining = Math.max(0, state.remaining - dt)
  return remaining > 0 ? { ...state, remaining } : noShake()
}

/**
 * The offset to add to the camera this frame, written into `out`.
 *
 * Writes into a caller-owned vector rather than allocating: this runs once per
 * rendered frame, which is the one place in the project where a per-frame allocation
 * is worth avoiding.
 */
export function shakeOffset(state: ShakeState, out: Vector3): Vector3 {
  if (state.remaining <= 0 || state.duration <= 0) return out.set(0, 0, 0)
  const elapsed = state.duration - state.remaining
  const scaled = state.amplitude * (state.remaining / state.duration)
  return out.set(
    Math.sin(elapsed * FREQ_X) * scaled,
    Math.sin(elapsed * FREQ_Y) * scaled,
    0,
  )
}

/** How hard a slam shakes, from the same 0-to-1 strength its damage reads. */
export function slamShakeAmplitude(strength: number, c: ShakeConfig): number {
  return MathUtils.lerp(
    c.slamMinAmplitude, c.slamMaxAmplitude, MathUtils.clamp(strength, 0, 1),
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/fx/shake.test.ts`
Expected: PASS.

- [ ] **Step 6: Red-proof the decay and the two axes**

Two separate neutralisations, run one at a time:

1. Change `shakeOffset`'s `scaled` to `state.amplitude` (no decay). Expected: FAIL on "decays: the second half is materially quieter than the first".
2. Change `FREQ_Y` to equal `FREQ_X`. Expected: FAIL on "does not trace a straight line".

Run after each: `npx vitest run src/fx/shake.test.ts`. Revert both and confirm PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/fx/config.ts src/fx/shake.ts src/fx/shake.test.ts
git commit -m "Add the camera shake, as a decaying sine pair rather than noise"
```

---

### Task 3: The decaying pulse, and the dash FOV kick

**Files:**
- Create: `src/fx/pulse.ts`
- Modify: `src/fx/mapping.ts`
- Test: `src/fx/pulse.test.ts`, `src/fx/mapping.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `stepPulse(value: number, dt: number, decayPerSecond: number): number`, `MAX_DASH_FOV_KICK`, `fovKickForDash(pulse: number): number`.

A single decaying 0-to-1 value, shared by the hurt flash (Task 4) and the dash FOV kick. Triggering is assignment to 1, which needs no function. One module, two consumers, rather than two near-identical timers.

- [ ] **Step 1: Write the failing tests**

`src/fx/pulse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { stepPulse } from './pulse'

describe('a decaying pulse', () => {
  it('decays at the rate it is given', () => {
    // 4 per second over a quarter second lands on zero.
    expect(stepPulse(1, 0.125, 4)).toBeCloseTo(0.5)
  })

  it('clamps at zero rather than going negative', () => {
    expect(stepPulse(0.1, 1, 4)).toBe(0)
    expect(stepPulse(0, 1, 4)).toBe(0)
  })

  it('never exceeds one, so a re-trigger cannot stack', () => {
    expect(stepPulse(5, 0, 4)).toBe(1)
  })

  it('returns zero for a non-finite value rather than propagating it', () => {
    // The value reaches the DOM as an opacity and the camera as a FOV, so a NaN here
    // would show up as an invisible overlay or a blank screen.
    expect(stepPulse(Number.NaN, 1 / 60, 4)).toBe(0)
    expect(stepPulse(1, Number.NaN, 4)).toBe(0)
  })
})
```

Add to `src/fx/mapping.test.ts`:

```ts
describe('the dash FOV kick', () => {
  it('is nothing when no dash is running', () => {
    expect(fovKickForDash(0)).toBe(0)
  })

  it('peaks at six degrees on the frame the dash fires', () => {
    // A literal, not MAX_DASH_FOV_KICK: asserting the constant the code reads would
    // pass for any value, including the 14 that full glider speed already uses.
    expect(fovKickForDash(1)).toBeCloseTo(6)
  })

  it('scales with the pulse', () => {
    expect(fovKickForDash(0.5)).toBeCloseTo(3)
  })

  it('stays well under the glider speed kick, so a dash is a burst not flight', () => {
    expect(fovKickForDash(1)).toBeLessThan(MAX_FOV_KICK * 0.6)
  })

  it('composes additively with the speed FOV', () => {
    // On foot fovForSpeed(0) is a constant 70, which is why a 26 m/s dash currently
    // has no visual weight at all. The kick has to add to it rather than replace it,
    // or a dash on landing would fight the speed FOV.
    expect(fovForSpeed(0) + fovKickForDash(1)).toBeCloseTo(76)
  })

  it('clamps a pulse outside the range', () => {
    expect(fovKickForDash(-1)).toBe(0)
    expect(fovKickForDash(3)).toBeCloseTo(6)
    expect(fovKickForDash(Number.NaN)).toBe(0)
  })
})
```

Extend that file's existing import to include `fovKickForDash` and `MAX_DASH_FOV_KICK` alongside whatever it already imports from `./mapping`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/fx/pulse.test.ts src/fx/mapping.test.ts`
Expected: FAIL — cannot resolve `./pulse`; `fovKickForDash` is not exported.

- [ ] **Step 3: Write the pulse module**

`src/fx/pulse.ts`:

```ts
/**
 * One decaying 0-to-1 value.
 *
 * Shared by the hurt flash and the dash FOV kick, which want exactly the same
 * behaviour — jump to 1 on an event, fall linearly to 0 — and would otherwise be two
 * timers that drift apart. Triggering is assignment to 1, so there is no `trigger`
 * function to keep in step with this one.
 */
export function stepPulse(value: number, dt: number, decayPerSecond: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(dt) || !Number.isFinite(decayPerSecond)) {
    return 0
  }
  return Math.max(0, Math.min(1, value) - decayPerSecond * dt)
}
```

- [ ] **Step 4: Add the FOV kick**

Append to `src/fx/mapping.ts`:

```ts
/**
 * Degrees of extra field of view at the peak of a dash.
 *
 * Well under `MAX_FOV_KICK`'s 14 for full glider speed: a dash should read as a
 * burst, not as flight. On foot the field of view is otherwise pinned at
 * `fovForSpeed(0)`, which is why a 26 m/s dash has no visual weight today.
 */
export const MAX_DASH_FOV_KICK = 6

/** Additive on top of `fovForSpeed`, so a dash on landing does not fight it. */
export function fovKickForDash(pulse: number): number {
  if (!Number.isFinite(pulse)) return 0
  return MAX_DASH_FOV_KICK * MathUtils.clamp(pulse, 0, 1)
}
```

`MathUtils` is already imported at the top of that file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/fx/pulse.test.ts src/fx/mapping.test.ts`
Expected: PASS.

- [ ] **Step 6: Red-proof**

Set `MAX_DASH_FOV_KICK` to 0. Expected: FAIL on "peaks at six degrees", "scales with the pulse" and "composes additively with the speed FOV". Revert and confirm PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/fx/pulse.ts src/fx/pulse.test.ts src/fx/mapping.ts src/fx/mapping.test.ts
git commit -m "Add a shared decaying pulse and the dash field-of-view kick"
```

---

### Task 4: The hurt flash

**Files:**
- Modify: `src/ui/hud.ts`
- Test: `src/ui/hud.test.ts`

**Interfaces:**
- Consumes: nothing (`stepPulse` from Task 3 is used by `main.ts` in Task 9, not here).
- Produces: `HudModel.hurtFlash: number`, and `hudModelFor(state, playerHealth?, focus?, hurtFlash?)` with `hurtFlash` defaulting to 0.

`fight.playerHit` currently reaches Focus and nothing else. This is the visual half of fixing that.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/hud.test.ts`:

```ts
describe('the hurt flash', () => {
  it('is nothing when the caller does not pass one', () => {
    // Optional on purpose: every existing call site and test keeps working, which is
    // what keeps this a widening rather than a migration.
    expect(hudModelFor(p()).hurtFlash).toBe(0)
  })

  it('passes a fraction through', () => {
    expect(hudModelFor(p(), undefined, undefined, 0.6).hurtFlash).toBeCloseTo(0.6)
  })

  it('clamps out of range values, so the overlay cannot go opaque', () => {
    expect(hudModelFor(p(), undefined, undefined, 4).hurtFlash).toBe(1)
    expect(hudModelFor(p(), undefined, undefined, -2).hurtFlash).toBe(0)
  })

  it('turns a non-finite flash into nothing rather than into a broken opacity', () => {
    expect(hudModelFor(p(), undefined, undefined, Number.NaN).hurtFlash).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/hud.test.ts`
Expected: FAIL — `hurtFlash` does not exist on the returned model.

- [ ] **Step 3: Widen the model**

In `src/ui/hud.ts`, add to `HudModel`:

```ts
  /** 0 to 1: how hard the screen is flashing from a hit taken. */
  hurtFlash: number
```

Change the signature and the return of `hudModelFor`:

```ts
export function hudModelFor(
  state: PlayerState,
  playerHealth?: { current: number; max: number },
  focus?: FocusReadout,
  hurtFlash = 0,
): HudModel {
```

and add `hurtFlash: fraction(hurtFlash),` to the returned object. The existing `fraction` helper already clamps and rejects non-finite values, which is exactly the guard this needs.

- [ ] **Step 4: Add the overlay**

Add to `STYLE`:

```css
.hud-hurt { position: fixed; inset: 0; pointer-events: none; opacity: 0;
  box-shadow: inset 0 0 220px 60px rgba(198,40,40,.75); }
```

Deliberately **no** CSS transition, unlike `.hud-vignette`: the decay is driven from the simulation by `stepPulse`, and a transition would fight it and smear the flash past its own timer.

Add `<div class="hud-hurt"></div>` to `root.innerHTML`, immediately after the existing vignette div. Query it beside the others:

```ts
  const hurt = root.querySelector('.hud-hurt') as HTMLElement
```

And set it in `update`:

```ts
      hurt.style.opacity = String(model.hurtFlash)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ui/hud.test.ts`
Expected: PASS.

- [ ] **Step 6: Red-proof**

Change `hurtFlash: fraction(hurtFlash)` to `hurtFlash: 0`. Expected: FAIL on "passes a fraction through" and "clamps out of range values". Revert and confirm PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/ui/hud.ts src/ui/hud.test.ts
git commit -m "Flash the screen red when the player takes a hit"
```

---

### Task 5: Who gets a spark

**Files:**
- Create: `src/fx/impact-targets.ts`
- Test: `src/fx/impact-targets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ImpactLists { hits, slamHits, staffHits, downed }` (all `readonly string[]`), `ImpactTargets { hits: string[]; downs: string[] }`, `impactTargets(lists: ImpactLists): ImpactTargets`.

The staff spark is one missing name in a union in `main.ts`, and `main.ts` has no tests. Extracting the rule makes the fix guarded and gives the "a down beats a connect" policy — currently a loop and a comment — a home that three more attacks can be added to.

- [ ] **Step 1: Write the failing test**

`src/fx/impact-targets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { impactTargets, type ImpactLists } from './impact-targets'

const lists = (over: Partial<ImpactLists> = {}): ImpactLists => ({
  hits: [], slamHits: [], staffHits: [], downed: [], ...over,
})

describe('the union of everything that connected', () => {
  it('sparks a gust connect', () => {
    expect(impactTargets(lists({ hits: ['a'] })).hits).toEqual(['a'])
  })

  it('sparks a slam connect', () => {
    expect(impactTargets(lists({ slamHits: ['a'] })).hits).toEqual(['a'])
  })

  it('sparks a staff connect', () => {
    // The regression this module exists for. `main.ts` built its impact list from the
    // gust and slam lists only, so the staff was the one attack in the game with no
    // hit spark -- and a staff swing that downed a soldier still sparked, through the
    // separate downed loop, which is what hid it.
    expect(impactTargets(lists({ staffHits: ['a'] })).hits).toEqual(['a'])
  })

  it('sparks one enemy once when two attacks land on it in a frame', () => {
    const targets = impactTargets(lists({ hits: ['a'], staffHits: ['a'], slamHits: ['a'] }))
    expect(targets.hits).toEqual(['a'])
  })

  it('keeps every distinct enemy', () => {
    const targets = impactTargets(lists({ hits: ['a'], staffHits: ['b'], slamHits: ['c'] }))
    expect([...targets.hits].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('a down is the louder statement', () => {
  it('gives an enemy that both took a hit and went down only the down', () => {
    const targets = impactTargets(lists({ hits: ['a'], staffHits: ['a'], downed: ['a'] }))
    expect(targets.downs).toEqual(['a'])
    expect(targets.hits).toEqual([])
  })

  it('still sparks the others in the same frame', () => {
    const targets = impactTargets(lists({ hits: ['a', 'b'], downed: ['b'] }))
    expect(targets.hits).toEqual(['a'])
    expect(targets.downs).toEqual(['b'])
  })

  it('deduplicates the downed list too', () => {
    expect(impactTargets(lists({ downed: ['a', 'a'] })).downs).toEqual(['a'])
  })

  it('produces nothing from nothing', () => {
    const targets = impactTargets(lists())
    expect(targets.hits).toEqual([])
    expect(targets.downs).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/impact-targets.test.ts`
Expected: FAIL — cannot resolve `./impact-targets`.

- [ ] **Step 3: Write the module**

`src/fx/impact-targets.ts`:

```ts
/**
 * Which enemies get a burst this frame, and which kind.
 *
 * The fight reports its connects in four separate lists, because each one feeds a
 * differently tuned Focus grant. The effects layer wants the opposite: one union, with
 * a down overriding a connect for the same enemy. That rule lived as a loop and a
 * comment in `main.ts`, which has no tests, and the staff was added to the fight
 * without being added to the loop.
 */
export interface ImpactLists {
  /** Enemies a gust connected with. */
  hits: readonly string[]
  slamHits: readonly string[]
  staffHits: readonly string[]
  downed: readonly string[]
}

export interface ImpactTargets {
  /** Deduplicated, and with everything in `downs` removed. */
  hits: string[]
  downs: string[]
}

export function impactTargets(lists: ImpactLists): ImpactTargets {
  const downs = [...new Set(lists.downed)]
  const down = new Set(downs)
  const hits = [...new Set([...lists.hits, ...lists.slamHits, ...lists.staffHits])]
    .filter((id) => !down.has(id))
  return { hits, downs }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/fx/impact-targets.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-proof the staff regression**

Remove `...lists.staffHits` from the union. Expected: FAIL on "sparks a staff connect" — and *only* that test plus the two multi-list ones, which confirms the test is aimed at the real bug. Revert and confirm PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/fx/impact-targets.ts src/fx/impact-targets.test.ts
git commit -m "Name which enemies get a spark, so the staff gets one too"
```

---

### Task 6: The enemy reports how it went down

**Files:**
- Modify: `src/combat/enemy.ts`
- Test: `src/combat/enemy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EnemyStep.fellOutOfWorld: boolean`, true only on the frame an enemy went down by passing the world floor.

- [ ] **Step 1: Write the failing test**

Add to `src/combat/enemy.test.ts`, using that file's existing fixture helpers for an enemy and a config:

```ts
describe('reporting an environmental removal', () => {
  // Ground that is not there: every query misses, so the enemy falls freely. This is
  // the shape of walking off the edge of an island.
  const noGround = { groundHeightAt: () => null }

  it('reports nothing on an ordinary grounded frame', () => {
    const step = stepEnemy(enemy(), new Vector3(0, 0, -10), flatGround, -50, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(false)
  })

  it('reports nothing while merely falling, above the floor', () => {
    const falling = { ...enemy(), position: new Vector3(0, 0, 0), grounded: false }
    const step = stepEnemy(falling, new Vector3(0, 0, -10), noGround, -50, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(false)
    expect(isDowned(step.enemy.health)).toBe(false)
  })

  it('reports the removal on the frame it crosses the floor, and downs it', () => {
    const brink = { ...enemy(), position: new Vector3(0, -49.9, 0), grounded: false }
    const step = stepEnemy(brink, new Vector3(0, 0, -10), noGround, -50, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(true)
    expect(isDowned(step.enemy.health)).toBe(true)
  })

  it('reports it exactly once, not on every frame afterwards', () => {
    // The latching bug this test exists for: a flag that stays true pays Focus every
    // frame for one event, and a parked body sits below the floor forever.
    let current = { ...enemy(), position: new Vector3(0, -49.9, 0), grounded: false }
    const reports: boolean[] = []
    for (let i = 0; i < 20; i++) {
      const step = stepEnemy(current, new Vector3(0, 0, -10), noGround, -50, 1 / 60, C)
      reports.push(step.fellOutOfWorld)
      current = step.enemy
    }
    expect(reports.filter(Boolean).length).toBe(1)
    expect(reports[0]).toBe(true)
  })

  it('does not report a body that was already downed before it fell', () => {
    // It was removed by a gust and already paid for. Reporting the fall as well would
    // pay twice for one soldier.
    const corpse = {
      ...enemy(),
      position: new Vector3(0, -49.9, 0),
      grounded: false,
      health: { current: 0, max: 1.5, sinceHit: 0 },
    }
    const step = stepEnemy(corpse, new Vector3(0, 0, -10), noGround, -50, 1 / 60, C)
    expect(step.fellOutOfWorld).toBe(false)
  })
})
```

If `enemy.test.ts` names its fixtures differently, use its existing names rather than introducing new ones — check the top of the file first.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/enemy.test.ts`
Expected: FAIL — `fellOutOfWorld` does not exist on `EnemyStep`.

- [ ] **Step 3: Widen `EnemyStep`**

In `src/combat/enemy.ts`:

```ts
export interface EnemyStep {
  enemy: Enemy
  /** Damage to deal to the player this frame. Zero on most frames. */
  damageToPlayer: number
  /**
   * True only on the frame this enemy went down by passing the world floor.
   *
   * Section 4.6 pays a non-lethal removal more than an environmental accident, so the
   * fight has to know which happened. It must not latch: the parked branch below
   * returns false for a body that is already down and already below the floor, which
   * is every frame after the first.
   */
  fellOutOfWorld: boolean
}
```

- [ ] **Step 4: Set it at all five return sites**

`stepEnemy` has five returns. Add `fellOutOfWorld: false` to four of them — the parked branch, the already-downed branch, the airborne-and-inert branch, and the final grounded return. Add `fellOutOfWorld: true` to exactly one: the branch guarded by `moved.position.y < worldFloorY && !isDowned(enemy.health)`.

That branch is the transition, and the separation that makes this correct already exists for an unrelated reason — a parked corpse has to stop integrating physics, so it returns before reaching the transition test.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/combat/enemy.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Red-proof the latch**

Change the parked branch's `fellOutOfWorld` to `true`. Expected: FAIL on "reports it exactly once, not on every frame afterwards". Revert and confirm PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/combat/enemy.ts src/combat/enemy.test.ts
git commit -m "Report the frame an enemy goes down by leaving the world"
```

---

### Task 7: Two lists, disjoint

**Files:**
- Modify: `src/combat/encounter.ts`
- Test: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `EnemyStep.fellOutOfWorld` from Task 6.
- Produces: `EncounterStep.lostThisFrame: string[]`, and `downedThisFrame` with those ids removed.

- [ ] **Step 1: Write the failing test**

Add to `src/combat/encounter.test.ts`:

```ts
describe('a removal by accident is reported apart from a knockdown', () => {
  // Ground that is not there, and a floor just below the spawn, so one step takes the
  // soldier out of the world.
  const voidDeps = { ground: { groundHeightAt: () => null }, worldFloorY: -1 }

  it('reports a fallen enemy as lost', () => {
    const start = startEncounter([{ id: 'a', position: new Vector3(0, 0, -2) }], C)
    const step = stepEncounter(start, defaults, 1 / 60, C, voidDeps)
    expect(step.lostThisFrame).toEqual(['a'])
  })

  it('does not also report it as downed', () => {
    // The double-pay bug. `downedThisFrame` is computed by diffing the downed set
    // across the step, so a fallen enemy lands in it as well -- and Focus would grant
    // both downGain and accidentDownGain for one soldier. A test that only checks
    // `lostThisFrame` passes while that is live, which is why this asserts both.
    const start = startEncounter([{ id: 'a', position: new Vector3(0, 0, -2) }], C)
    const step = stepEncounter(start, defaults, 1 / 60, C, voidDeps)
    expect(step.lostThisFrame).toEqual(['a'])
    expect(step.downedThisFrame).toEqual([])
  })

  it('reports a gusted enemy as downed and not as lost', () => {
    // The other direction: the split must not have moved ordinary knockdowns.
    let encounter = startEncounter([{ id: 'a', position: new Vector3(0, 0, -2) }], C)
    const downs: string[] = []
    const losses: string[] = []
    for (let i = 0; i < 240; i++) {
      const step = stepEncounter(
        encounter, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS,
      )
      downs.push(...step.downedThisFrame)
      losses.push(...step.lostThisFrame)
      encounter = step.encounter
    }
    expect(downs).toEqual(['a'])
    expect(losses).toEqual([])
  })

  it('reports nothing on a quiet frame', () => {
    const step = stepEncounter(near(), defaults, 1 / 60, C, DEPS)
    expect(step.lostThisFrame).toEqual([])
    expect(step.downedThisFrame).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — `lostThisFrame` does not exist on `EncounterStep`.

- [ ] **Step 3: Collect the flag while stepping enemies**

In `stepEncounter`, the enemy step loop currently accumulates `damageToPlayer` only. Add a second accumulator beside it:

```ts
  let damageToPlayer = 0
  const lostThisFrame: string[] = []
  enemies = enemies.map((enemy) => {
    const step = stepEnemy(enemy, input.playerPosition, deps.ground, deps.worldFloorY, dt, c.enemy)
    damageToPlayer += step.damageToPlayer
    if (step.fellOutOfWorld) lostThisFrame.push(step.enemy.id)
    return step.enemy
  })
```

- [ ] **Step 4: Subtract them from the downed list**

Change the `downedThisFrame` computation:

```ts
  // Subtracted, not merely reported alongside. `downedThisFrame` is a diff of the
  // downed set across the step, so an enemy that left the world appears in both -- and
  // Focus would pay downGain and accidentDownGain for the same soldier. The codebase
  // has met this overlap once already: `main.ts` drops a connect for an enemy that
  // also went down this frame. Same shape, same fix.
  const lost = new Set(lostThisFrame)
  const downedThisFrame = enemies
    .filter((enemy) => isDowned(enemy.health) && !wasDowned.has(enemy.id) && !lost.has(enemy.id))
    .map((enemy) => enemy.id)
```

Add `lostThisFrame` to the `EncounterStep` interface with a comment explaining the §4.6 split, and to the returned object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS, including all 36 pre-existing `stepEncounter` tests.

- [ ] **Step 6: Red-proof the subtraction**

Remove `&& !lost.has(enemy.id)`. Expected: FAIL on "does not also report it as downed". Revert and confirm PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "Split an accidental removal out of the downed list"
```

---

### Task 8: Focus pays less for an accident

**Files:**
- Modify: `src/focus/focus.ts`, `src/focus/config.ts`
- Test: `src/focus/focus.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FocusEvents.accidents: number`, `FocusConfig.accidentDownGain: number`, `DEFAULT_FOCUS_CONFIG.accidentDownGain = 5`.

- [ ] **Step 1: Write the failing test**

Add to `src/focus/focus.test.ts`. That file's `C` is a local test config — give `accidentDownGain` a value there that is distinct from both `downGain` and the shipped default.

```ts
describe('a removal by accident pays less than a knockdown', () => {
  it('pays the accident gain for one soldier lost over the edge', () => {
    // A literal. `expect(gained).toBe(C.accidentDownGain)` passes for any value,
    // including downGain itself, which is the exact bug this field exists to prevent.
    const next = stepFocus(focusAt(0, 0), input({ events: { accidents: 1 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(4, 5)
  })

  it('pays materially less than a knockdown', () => {
    // A margin, not a bare `>`. The design rule is that the generous play is the
    // strong play, which a fraction of a percent would not deliver.
    const down = stepFocus(focusAt(0, 0), input({ events: { downs: 1 } }), 1 / 60, C)
    const accident = stepFocus(focusAt(0, 0), input({ events: { accidents: 1 } }), 1 / 60, C)
    expect(accident.value).toBeLessThan(down.value * 0.6)
  })

  it('pays per soldier', () => {
    const next = stepFocus(focusAt(0, 0), input({ events: { accidents: 3 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(12, 5)
  })

  it('rides the chain ramp like every other gain', () => {
    const cold = stepFocus(focusAt(0, 0), input({ events: { accidents: 1 } }), 1 / 60, C)
    const hot = stepFocus(focusAt(0, 30), input({ events: { accidents: 1 } }), 1 / 60, C)
    expect(hot.value).toBeGreaterThan(cold.value * 1.2)
  })

  it('pays nothing when nothing was lost', () => {
    const next = stepFocus(focusAt(0, 0), input({ events: { accidents: 0 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(0, 5)
  })
})
```

Set `accidentDownGain: 4` in that file's `C`, with `downGain` left at whatever it already is. Adjust the two literals above if `C`'s `chainRampMax` makes the cold-ramp value differ from 1 — read `C` before writing the numbers rather than assuming, and derive `4` and `12` from `accidentDownGain` times the cold ramp.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/focus/focus.test.ts`
Expected: FAIL — `accidents` is not a property of `FocusEvents`, and `accidentDownGain` is not on `FocusConfig`.

- [ ] **Step 3: Widen the config and the events**

In `src/focus/focus.ts`, add to `FocusConfig`:

```ts
  /**
   * Focus for an enemy removed by environmental accident, as opposed to put down.
   *
   * Section 4.6: "Enemies removed non-lethally grant more Focus than enemies removed
   * by environmental accident, so the generous play is also the strong play." The
   * document lists "blown off a ledge into water" among the non-lethal downs, so a
   * fall into empty air is the accident, and it pays less than `downGain`. Not zero:
   * the threat is gone and the player caused it.
   */
  accidentDownGain: number
```

Add to `FocusEvents`:

```ts
  /** Enemies removed by environmental accident — today, by leaving the world. */
  accidents: number
```

Add `accidents: 0` to `noFocusEvents()`. This is what keeps `focus.test.ts`'s existing fixtures working: they build events as `{ ...noFocusEvents(), ...over.events }`.

- [ ] **Step 4: Pay it**

In `stepFocus`, add one term to the ramped sum, beside `events.downs * c.downGain`:

```ts
    + events.accidents * c.accidentDownGain
```

- [ ] **Step 5: Set the default**

In `src/focus/config.ts`, add to `DEFAULT_FOCUS_CONFIG`:

```ts
  // Roughly a third of downGain's 14, and just below dodgeGain's 8: losing a soldier
  // over the edge still pays, but putting one down is clearly the better line.
  accidentDownGain: 5,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/focus/focus.test.ts`
Expected: PASS.

- [ ] **Step 7: Red-proof**

Set `accidentDownGain` in the test's `C` equal to its `downGain`. Expected: FAIL on "pays materially less than a knockdown". Revert and confirm PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add src/focus/focus.ts src/focus/config.ts src/focus/focus.test.ts
git commit -m "Pay less Focus for a soldier lost than for one put down"
```

---

### Task 9: The patrol restores

**Files:**
- Create: `src/combat/patrol.ts`
- Modify: `src/combat/config.ts`, `src/combat/encounter.ts`
- Test: `src/combat/patrol.test.ts`, `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `Enemy`, `EnemySpawn`, `spawnEnemy`, `isDowned`.
- Produces: `PatrolConfig { respawnRange: number }`, `DEFAULT_PATROL_CONFIG`, `shouldRestorePatrol(enemies, spawns, playerPosition, c): boolean`, `EncounterDeps.spawns: readonly EnemySpawn[]`, `EncounterDeps.patrol: PatrolConfig`, `EncounterStep.restoredThisFrame: string[]`.

- [ ] **Step 1: Write the failing test for the rule**

`src/combat/patrol.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { shouldRestorePatrol, type PatrolConfig } from './patrol'
import { spawnEnemy, type Enemy, type EnemyConfig } from './enemy'
import type { EnemySpawn } from './encounter'

const C: PatrolConfig = { respawnRange: 40 }

const ENEMY_CONFIG: EnemyConfig = {
  maxHealth: 1.5, outOfCombatSeconds: 6, regenPerSecond: 0,
  moveSpeed: 4.2, strikeRange: 3.2, aggroRange: 26, windUpSeconds: 0.55,
  recoverSeconds: 0.7, strikeDamage: 1, knockbackDamping: 2.6,
  gravity: 20, snapDistance: 1.2,
}

const SPAWNS: EnemySpawn[] = [
  { id: 'a', position: new Vector3(0, 0, 0) },
  { id: 'b', position: new Vector3(10, 0, 0) },
]

const standing = (): Enemy[] =>
  SPAWNS.map((s) => spawnEnemy(s.id, s.position, ENEMY_CONFIG))

const allDowned = (): Enemy[] =>
  standing().map((e) => ({ ...e, health: { ...e.health, current: 0 }, stance: 'downed' as const }))

const far = new Vector3(0, 0, -200)
const near = new Vector3(0, 0, -5)

describe('when a patrol restores', () => {
  it('restores once everyone is down and the player has gone', () => {
    expect(shouldRestorePatrol(allDowned(), SPAWNS, far, C)).toBe(true)
  })

  it('does not restore while anyone is still standing', () => {
    const one = allDowned()
    const first = one[0]
    if (!first) throw new Error('fixture')
    expect(shouldRestorePatrol([first, ...standing().slice(1)], SPAWNS, far, C)).toBe(false)
  })

  it('does not restore while the player can still see the bodies', () => {
    expect(shouldRestorePatrol(allDowned(), SPAWNS, near, C)).toBe(false)
  })

  it('measures against every spawn point, not just the nearest', () => {
    // Standing beyond one spawn but close to the other must not restore, or a soldier
    // materialises behind the player.
    const beyondOneOnly = new Vector3(10, 0, 0)
    expect(shouldRestorePatrol(allDowned(), SPAWNS, beyondOneOnly, C)).toBe(false)
  })

  it('does not restore an empty patrol', () => {
    // "Every enemy is downed" is vacuously true for an empty list, which would restore
    // on every frame forever.
    expect(shouldRestorePatrol([], SPAWNS, far, C)).toBe(false)
    expect(shouldRestorePatrol([], [], far, C)).toBe(false)
  })

  it('does not restore when there is nowhere to restore to', () => {
    expect(shouldRestorePatrol(allDowned(), [], far, C)).toBe(false)
  })

  it('ignores altitude, because flying over is not leaving', () => {
    // Horizontal distance only, matching how aggroRange is measured in stepEnemy.
    const overhead = new Vector3(0, 300, 0)
    expect(shouldRestorePatrol(allDowned(), SPAWNS, overhead, C)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/patrol.test.ts`
Expected: FAIL — cannot resolve `./patrol`.

- [ ] **Step 3: Write the rule**

`src/combat/patrol.ts`:

```ts
import type { Vector3 } from 'three'
import { horizontalDistance, type Enemy } from './enemy'
import { isDowned } from './health'
import type { EnemySpawn } from './encounter'

/**
 * When a cleared patrol comes back.
 *
 * The simplest rule that makes a fight repeatable: restore once every soldier is down
 * and the player is far enough away that nothing appears in view. Restoring while the
 * player is elsewhere *is* leave-and-return, without a second piece of state — an
 * arm-on-leaving, fire-on-returning machine buys nothing here and adds a flag that can
 * desynchronise from the enemy list.
 */
export interface PatrolConfig {
  /**
   * How far the player must be from every spawn point before the patrol restores.
   *
   * Must stay comfortably above the enemy's `aggroRange`, or a fresh soldier appears
   * already inside its own notice range and the player turns around into a fight that
   * spawned on top of them.
   */
  respawnRange: number
}

export function shouldRestorePatrol(
  enemies: readonly Enemy[],
  spawns: readonly EnemySpawn[],
  playerPosition: Vector3,
  c: PatrolConfig,
): boolean {
  // Both guards matter. "Every enemy is downed" is vacuously true for an empty list,
  // which would restore every frame forever; and with no spawn points there is nowhere
  // to restore to, so the distance test below would also be vacuously satisfied.
  if (enemies.length === 0 || spawns.length === 0) return false
  if (!enemies.every((enemy) => isDowned(enemy.health))) return false
  // Horizontal, matching how aggroRange is measured: flying overhead is not leaving.
  return spawns.every(
    (spawn) => horizontalDistance(playerPosition, spawn.position) > c.respawnRange,
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/combat/patrol.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the default config**

In `src/combat/config.ts`:

```ts
import type { PatrolConfig } from './patrol'

/**
 * Above the enemy's aggroRange of 26 by enough that a restored soldier can never
 * appear already inside its own notice range.
 */
export const DEFAULT_PATROL_CONFIG: PatrolConfig = { respawnRange: 40 }
```

- [ ] **Step 6: Write the failing integration test**

Add to `src/combat/encounter.test.ts`:

```ts
describe('a cleared patrol comes back', () => {
  const SPAWNS: EnemySpawn[] = [{ id: 'a', position: new Vector3(0, 0, -2) }]
  const withPatrol = { ...DEPS, spawns: SPAWNS, patrol: { respawnRange: 40 } }

  /** Gust the soldier down, standing next to it. */
  function clear() {
    let encounter = startEncounter(SPAWNS, C)
    for (let i = 0; i < 240; i++) {
      encounter = stepEncounter(
        encounter, { ...defaults, gustPressed: true }, 1 / 60, C, withPatrol,
      ).encounter
    }
    return encounter
  }

  it('does not come back while the player is standing over it', () => {
    const cleared = clear()
    const step = stepEncounter(cleared, defaults, 1 / 60, C, withPatrol)
    expect(step.restoredThisFrame).toEqual([])
    expect(isDowned(step.encounter.enemies[0]!.health)).toBe(true)
  })

  it('comes back at full health once the player has left', () => {
    const cleared = clear()
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const step = stepEncounter(cleared, away, 1 / 60, C, withPatrol)
    expect(step.restoredThisFrame).toEqual(['a'])
    const restored = step.encounter.enemies[0]
    if (!restored) throw new Error('the patrol should have been restored')
    expect(restored.health.current).toBe(C.enemy.maxHealth)
    expect(isDowned(restored.health)).toBe(false)
    expect(restored.position.z).toBeCloseTo(-2)
  })

  it('reports no phantom events on the frame it restores', () => {
    // The ordering bug this guards. `wasDowned` is diffed at the top of stepEncounter,
    // so replacing the enemy array before those lists are built would compare a fresh
    // soldier against a downed one. Restoring last means the frame reports nothing.
    const cleared = clear()
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const step = stepEncounter(cleared, away, 1 / 60, C, withPatrol)
    expect(step.downedThisFrame).toEqual([])
    expect(step.lostThisFrame).toEqual([])
    expect(step.hitThisFrame).toEqual([])
  })

  it('reports nothing on the frame after, having already restored', () => {
    const cleared = clear()
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const once = stepEncounter(cleared, away, 1 / 60, C, withPatrol)
    const twice = stepEncounter(once.encounter, away, 1 / 60, C, withPatrol)
    expect(twice.restoredThisFrame).toEqual([])
    expect(twice.downedThisFrame).toEqual([])
  })

  it('leaves a fight with no spawns configured alone', () => {
    // DEPS carries an empty spawns list, which is what keeps every pre-existing test
    // in this file unaffected by the restore.
    const cleared = clear()
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const step = stepEncounter(cleared, away, 1 / 60, C, DEPS)
    expect(step.restoredThisFrame).toEqual([])
    expect(isDowned(step.encounter.enemies[0]!.health)).toBe(true)
  })
})
```

- [ ] **Step 7: Widen `EncounterDeps` and update `DEPS`**

In `src/combat/encounter.ts`:

```ts
export interface EncounterDeps {
  ground: GroundHeightQuery
  worldFloorY: number
  /**
   * Where this fight's soldiers stand when fresh.
   *
   * On the deps rather than on `Encounter`: a running fight is not a level
   * definition, and this interface already means "what the fight needs from the
   * world" as opposed to "what the player did this frame".
   */
  spawns: readonly EnemySpawn[]
  patrol: PatrolConfig
}
```

In `src/combat/encounter.test.ts`, change line 50:

```ts
// An empty spawn list, so shouldRestorePatrol always declines and every test in this
// file that predates the respawn keeps exercising exactly what it used to. The
// restore has its own deps, built in its own describe block.
const DEPS = { ground: flatGround, worldFloorY: -50, spawns: [], patrol: { respawnRange: 40 } }
```

- [ ] **Step 8: Restore, last**

At the very end of `stepEncounter`, after `downedThisFrame` is computed and before the return:

```ts
  // Last, deliberately. `wasDowned` is diffed at the top of this function, so
  // replacing the enemy array any earlier would compare a fresh soldier against a
  // downed one and report a phantom down or hit. Restoring here means the next frame
  // starts from a healthy patrol and an empty wasDowned, which reports nothing.
  let restoredThisFrame: string[] = []
  if (shouldRestorePatrol(enemies, deps.spawns, input.playerPosition, deps.patrol)) {
    enemies = deps.spawns.map((spawn) => spawnEnemy(spawn.id, spawn.position, c.enemy))
    restoredThisFrame = enemies.map((enemy) => enemy.id)
  }
```

Add `restoredThisFrame` to `EncounterStep` — documenting that `main.ts` needs it to reset the position interpolators — and to the returned object. Import `shouldRestorePatrol` and `PatrolConfig` from `./patrol`.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run src/combat/patrol.test.ts src/combat/encounter.test.ts`
Expected: PASS, including all 36 pre-existing `stepEncounter` tests.

- [ ] **Step 10: Red-proof the ordering**

Move the restore block to immediately *before* `const wasDowned = ...` at the top of `stepEncounter` (it will need the enemies read from `encounter.enemies`). Expected: FAIL on "reports no phantom events on the frame it restores". Revert and confirm PASS.

- [ ] **Step 11: Full suite, typecheck and commit**

```bash
npm test
npm run typecheck
git add src/combat/patrol.ts src/combat/patrol.test.ts src/combat/config.ts src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "Bring a cleared patrol back once the player has left"
```

---

### Task 10: The combat voices

**Files:**
- Create: `src/fx/combat-audio.ts`
- Modify: `src/fx/mapping.ts`
- Test: `src/fx/mapping.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `COMBAT_LEVELS`, `swingLevel(finisher: boolean): number`, `swingSeconds(finisher: boolean): number`, `createCombatAudio()` returning `{ start, gust, swing, impact, down, hurt, dispose }`.

The graph wiring is untested, exactly as `src/fx/audio.ts` is: there is no `AudioContext` in the Vitest node environment, and mocking one would test the mock. The levels and durations are pure and are tested.

- [ ] **Step 1: Write the failing test**

Add to `src/fx/mapping.test.ts`:

```ts
describe('the combat voices', () => {
  it('makes the finisher louder than an opener, by a real margin', () => {
    expect(swingLevel(true)).toBeGreaterThan(swingLevel(false) * 1.2)
  })

  it('makes the finisher longer than an opener, by a real margin', () => {
    expect(swingSeconds(true)).toBeGreaterThan(swingSeconds(false) * 1.2)
  })

  it('keeps every voice audible and none of them clipping', () => {
    for (const [name, level] of Object.entries(COMBAT_LEVELS)) {
      expect(level, `${name} is silent`).toBeGreaterThan(0.05)
      expect(level, `${name} will clip`).toBeLessThanOrEqual(0.5)
    }
  })

  it('makes a hit taken the loudest thing in the fight', () => {
    // The player's own damage is the event they most need to notice, and today it has
    // no feedback of any kind.
    const others = [
      COMBAT_LEVELS.gust, COMBAT_LEVELS.swing, COMBAT_LEVELS.finisher,
      COMBAT_LEVELS.impact, COMBAT_LEVELS.down,
    ]
    expect(COMBAT_LEVELS.hurt).toBeGreaterThanOrEqual(Math.max(...others))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/mapping.test.ts`
Expected: FAIL — `COMBAT_LEVELS`, `swingLevel` and `swingSeconds` are not exported.

- [ ] **Step 3: Add the levels**

Append to `src/fx/mapping.ts`:

```ts
/**
 * Peak gain per combat voice.
 *
 * Held here rather than in `combat-audio.ts` so the mix is testable: the WebAudio
 * graph cannot be exercised in the node test environment, but the relative levels are
 * the part that can actually be wrong.
 */
export const COMBAT_LEVELS = {
  gust: 0.22,
  swing: 0.18,
  finisher: 0.26,
  impact: 0.3,
  down: 0.36,
  hurt: 0.4,
} as const

export function swingLevel(finisher: boolean): number {
  return finisher ? COMBAT_LEVELS.finisher : COMBAT_LEVELS.swing
}

export function swingSeconds(finisher: boolean): number {
  return finisher ? 0.26 : 0.16
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/fx/mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the audio module**

`src/fx/combat-audio.ts`:

```ts
import { COMBAT_LEVELS, swingLevel, swingSeconds } from './mapping'

const NOISE_SECONDS = 1

/**
 * The fight's voices, synthesised.
 *
 * No asset files, for the same reasons `createWindAudio` has none: nothing to load,
 * nothing to license, and nothing that has to be routed through
 * `import.meta.env.BASE_URL` and then 404 only on the deployed site.
 *
 * Untested, like `audio.ts`. There is no AudioContext in the node test environment,
 * and a mock of one would only test the mock. Everything here that could be wrong in
 * a way a test would catch — the relative levels, the finisher's emphasis — lives in
 * `mapping.ts` and is tested there.
 */
export function createCombatAudio() {
  let context: AudioContext | null = null
  let noise: AudioBuffer | null = null
  let master: GainNode | null = null

  /** A short burst of filtered noise: air moving. */
  function burst(level: number, seconds: number, fromHz: number, toHz: number): void {
    if (!context || !noise || !master) return
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = noise
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(fromHz, now)
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, toHz), now + seconds)
    const gain = context.createGain()
    gain.gain.setValueAtTime(level, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    source.connect(filter).connect(gain).connect(master)
    source.start(now)
    source.stop(now + seconds)
  }

  /** A pitch dropping under a fast decay: a thud. */
  function thud(level: number, seconds: number, fromHz: number, detune = 0): void {
    if (!context || !master) return
    const now = context.currentTime
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(fromHz, now)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, fromHz * 0.3), now + seconds)
    if (detune !== 0) osc.detune.setValueAtTime(detune, now)
    const gain = context.createGain()
    gain.gain.setValueAtTime(level, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    osc.connect(gain).connect(master)
    osc.start(now)
    osc.stop(now + seconds)
  }

  return {
    /** Must be called from a user gesture, or the browser blocks audio. */
    start(): void {
      if (context) return
      try {
        context = new AudioContext()
        const buffer = context.createBuffer(
          1, context.sampleRate * NOISE_SECONDS, context.sampleRate,
        )
        const data = buffer.getChannelData(0)
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
        noise = buffer
        master = context.createGain()
        master.gain.value = 1
        master.connect(context.destination)
      } catch (error) {
        console.warn('Combat audio unavailable, continuing without it.', error)
        context = null
      }
    },

    gust(): void {
      burst(COMBAT_LEVELS.gust, 0.35, 1800, 200)
    },

    swing(finisher: boolean): void {
      burst(swingLevel(finisher), swingSeconds(finisher), finisher ? 2600 : 3200, 400)
    },

    impact(): void {
      thud(COMBAT_LEVELS.impact, 0.12, 180)
    },

    down(): void {
      thud(COMBAT_LEVELS.down, 0.3, 120)
      burst(COMBAT_LEVELS.down * 0.5, 0.35, 900, 120)
    },

    /** Two detuned sines, so it beats. Unpleasant on purpose. */
    hurt(): void {
      thud(COMBAT_LEVELS.hurt, 0.22, 220)
      thud(COMBAT_LEVELS.hurt * 0.8, 0.22, 220, 35)
    },

    dispose(): void {
      void context?.close()
      context = null
      noise = null
      master = null
    },
  }
}
```

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/fx/combat-audio.ts src/fx/mapping.ts src/fx/mapping.test.ts
git commit -m "Give the fight five synthesised voices"
```

---

### Task 11: Wire it into the game

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: nothing. This is the wiring layer, and it has no tests, which is why every rule it uses lives in a tested module.

- [ ] **Step 1: Add the state and the imports**

Near the other module-level state in `start()`:

```ts
  let hitstop = noHitstop()
  let shake = noShake()
  let hurtFlash = 0
  let dashKick = 0
  const shakeVec = new Vector3()
  const combatAudio = createCombatAudio()
```

Import `noHitstop`, `isFrozen`, `triggerHitstop`, `stepHitstop`, `slamHitstopSeconds` from `./fx/hitstop`; `noShake`, `triggerShake`, `stepShake`, `shakeOffset`, `slamShakeAmplitude` from `./fx/shake`; `stepPulse` from `./fx/pulse`; `fovKickForDash` from `./fx/mapping`; `impactTargets` from `./fx/impact-targets`; `createCombatAudio` from `./fx/combat-audio`; `DEFAULT_HITSTOP_CONFIG`, `DEFAULT_SHAKE_CONFIG` from `./fx/config`; `DEFAULT_PATROL_CONFIG` from `./combat/config`.

Call `combatAudio.start()` wherever the existing wind audio is started from a user gesture — the same handler, since one gesture unblocks both.

- [ ] **Step 2: Freeze at the top of `update`**

`update` currently begins `const state = input.sample()`. Put the freeze **before** that line:

```ts
  function update(dt: number): void {
    hitstop = stepHitstop(hitstop, dt)
    // Returns before input.sample(), and that order is the whole trick. input.ts
    // documents sample() as "Call exactly once per frame: reading clears the action
    // edge", so sampling and then discarding would eat any press made during the
    // freeze -- a click landing inside a 60ms hitstop simply would not happen.
    // Returning first leaves the edge pending in the tracker, and it fires on the
    // first live frame.
    //
    // The accumulator needs no special handling: createStepper decrements it around
    // every update call regardless of what that call does, so an early return cannot
    // bank time and discharge it on resume.
    if (isFrozen(hitstop)) return

    const state = input.sample()
```

- [ ] **Step 3: Pass the new deps to the fight**

The `stepEncounter` call's fifth argument becomes:

```ts
    }, dt, fightConfig, {
      ground: world.terrain,
      worldFloorY: ARCHIPELAGO.worldFloorY,
      spawns: HOME_PATROL,
      patrol: DEFAULT_PATROL_CONFIG,
    })
```

`HOME_PATROL` is already imported — it is what `startEncounter` was called with.

- [ ] **Step 4: Replace the impact loops**

Delete the two existing loops (the `new Set([...fight.hitThisFrame, ...fight.slamHitThisFrame])` loop with its `downedNow` guard, and the `fight.downedThisFrame` loop) and the `downedNow` const. Replace with:

```ts
    // impactTargets owns the union and the rule that a down beats a connect. It lives
    // in a tested module because this file has none, and because the staff was added
    // to the fight without being added to the loop that used to live here.
    const positionOf = (id: string) => encounter.enemies.find((e) => e.id === id)?.position
    const bursts = impactTargets({
      hits: fight.hitThisFrame,
      slamHits: fight.slamHitThisFrame,
      staffHits: fight.staffHitThisFrame,
      downed: fight.downedThisFrame,
    })
    for (const id of bursts.hits) {
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'hit'))
    }
    for (const id of bursts.downs) {
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'down'))
    }
    if (bursts.hits.length > 0) combatAudio.impact()
    if (bursts.downs.length > 0) combatAudio.down()
```

- [ ] **Step 5: Trigger the freeze, the shake, the flash and the sounds**

After the `stepEncounter` call and the burst block:

```ts
    // Heavy events only. Never a gust: a move with a 0.45s cooldown that hitches on
    // every use is nausea, not weight.
    if (staffSwing?.finisher && fight.staffHitThisFrame.length > 0) {
      hitstop = triggerHitstop(hitstop, DEFAULT_HITSTOP_CONFIG.finisherSeconds)
    }
    if (bursts.downs.length > 0) {
      hitstop = triggerHitstop(hitstop, DEFAULT_HITSTOP_CONFIG.downSeconds)
      shake = triggerShake(
        shake, DEFAULT_SHAKE_CONFIG.downAmplitude, DEFAULT_SHAKE_CONFIG.downSeconds,
      )
    }
    if (slam) {
      hitstop = triggerHitstop(hitstop, slamHitstopSeconds(slam.strength, DEFAULT_HITSTOP_CONFIG))
      shake = triggerShake(
        shake,
        slamShakeAmplitude(slam.strength, DEFAULT_SHAKE_CONFIG),
        DEFAULT_SHAKE_CONFIG.slamSeconds,
      )
    }
    if (fight.playerHit) {
      hurtFlash = 1
      shake = triggerShake(
        shake, DEFAULT_SHAKE_CONFIG.hurtAmplitude, DEFAULT_SHAKE_CONFIG.hurtSeconds,
      )
      combatAudio.hurt()
    }
    hurtFlash = stepPulse(hurtFlash, dt, HURT_FLASH_DECAY_PER_SECOND)
```

with `const HURT_FLASH_DECAY_PER_SECOND = 4` beside the file's other local constants — a quarter-second flash, long enough to catch peripherally and short enough not to obscure the fight.

Beside the existing gust cone effect, add `combatAudio.gust()`. Beside the existing staff arc effect, add `combatAudio.swing(staffSwing.finisher)`.

- [ ] **Step 6: Reset the interpolators for a restored patrol**

Immediately after `encounter = fight.encounter`:

```ts
    // A restored soldier reuses its id, so its interpolator still holds wherever the
    // body fell. Left alone the view would blend from there to the spawn point --
    // sliding across the map, or climbing up out of the void for one that fell off the
    // world. Dropping the entry makes the next record start clean.
    for (const id of fight.restoredThisFrame) enemyPositionLerps.delete(id)
```

- [ ] **Step 7: Drive the dash kick and the HUD flash**

Beside the existing dash trail trigger (`if (player.dashesUsed > beforeStep.dashesUsed)`), add `dashKick = 1`. After it:

```ts
    // Decays over roughly the dash's own duration, so the kick is gone by the time the
    // burst is.
    dashKick = stepPulse(dashKick, dt, 1 / DEFAULT_GROUND_CONFIG.dashDurationSeconds)
```

Pass the flash to the HUD by adding a fourth argument to the existing `hudModelFor` call:

```ts
    hud.update(hudModelFor(player, encounter.playerHealth, {
      focus: focus.max > 0 ? focus.value / focus.max : 0,
      avatarCharge: armFraction(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
      avatarActive,
    }, hurtFlash))
```

- [ ] **Step 8: Report accidents to Focus**

Add to the `FocusEvents` literal:

```ts
      accidents: fight.lostThisFrame.length,
```

- [ ] **Step 9: Apply the shake and the FOV kick in `syncVisuals`**

Replace the camera lines:

```ts
    cameraPosition = smoothTowards(cameraPosition, desired, profile.smoothing, frameDt)
    // Stepped here rather than in update(), with real frame time: shake is a
    // render-time offset, so it keeps animating through a hitstop. A freeze with a
    // shaking camera is the impact; a freeze that holds still and then shakes is two
    // separate events, which is what stepping it in update() would produce, because
    // update() is exactly what the freeze stops.
    shake = stepShake(shake, frameDt)
    // Added to the transform, never written back into cameraPosition. That is the
    // smoothed state smoothTowards reads and writes every frame, so integrating the
    // shake into it would make the camera drift away from the player rather than
    // vibrate around him. lookAt keeps targeting the unshaken sampledPosition too:
    // shaking the target rotates the view instead of translating it, which reads as
    // the world tilting.
    camera.position.copy(cameraPosition).add(shakeOffset(shake, shakeVec))
    camera.lookAt(sampledPosition)
    camera.fov = (player.mode === 'glider' ? fovForSpeed(player.velocity.length()) : fovForSpeed(0))
      + fovKickForDash(dashKick)
    camera.updateProjectionMatrix()
```

- [ ] **Step 10: Verify the build**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all three clean.

- [ ] **Step 11: Commit**

```bash
git add src/main.ts
git commit -m "Wire the freeze, the shake, the flash, the voices and the respawn in"
```

---

### Task 12: Verify it in the running game

**Files:** none — this task produces measurements, not code.

The repo's rule is that a claim about the running game is worth more than a green suite, and this whole cycle is about things that only exist when the game runs. Use the synthetic-clock technique documented in `docs/HANDOFF.md` under "The preview pane's animation loop stalls because the tab is hidden": patch `window.requestAnimationFrame` to capture the callback, take one screenshot so the loop re-registers, then drive frames manually. Vite HMR wipes the harness on every source edit, so do this after the code is final.

- [ ] **Step 1: Confirm the freeze actually freezes, and does not eat input**

Drive frames while forcing a hitstop, and read a simulation value that should not move — the player's position — across the frozen frames. Then dispatch a keypress during the freeze and confirm the action happens once the freeze ends. A press that vanishes is the failure this is looking for.

- [ ] **Step 2: Confirm the shake moves the camera and settles**

Sample `camera.position` against the smoothed follow position across a slam, and confirm the difference is non-zero during the shake and returns to zero after. Critically, confirm `cameraPosition` itself has **not** drifted — that is the feedback bug the design guards against, and it would show up as the camera never returning to its resting offset.

- [ ] **Step 3: Confirm a staff connect now sparks**

Count effects in the pool across a staff swing that connects but does not down. Before this cycle the count was zero.

- [ ] **Step 4: Confirm the patrol restores**

Clear the home patrol, fly beyond 40 units, and read enemy health. Then confirm no soldier appeared inside aggro range while the player was watching, and that the enemy views are in the right place rather than mid-slide from where the bodies fell.

- [ ] **Step 5: Confirm the accident pays less**

Blow a soldier off a ledge and read the Focus gain; put one down in place and read it again. The second should be materially larger. Verify by a different route than the assertion that produced it — read the meter's rendered `scaleX` rather than the internal value, or vice versa.

- [ ] **Step 6: Record the results**

Write the measured numbers into the handoff in Task 13. Numbers, not adjectives.

---

### Task 13: Documentation

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Correct the §4.6 error**

Two places state it backwards and both must change. In "What has NOT been built", the §4.6 bullet says enemies have no fall physics — they gained gravity in the Vortex work. In "Suggested next steps", item 2 says the missing piece is "paying that removal *more* than an in-place knockdown" — the design document lists "blown off a ledge into water" among the *non-lethal* downs, so a fall into empty air is the environmental accident and pays **less**.

- [ ] **Step 2: Add the new sections**

Cover, in the style of the existing entries: the freeze and why it returns before `input.sample()`; the shake and the two rules that keep it from drifting; the hurt flash; the staff spark and the `impactTargets` module that now owns the union; the dash FOV kick; the five voices; the patrol restore, including why it happens last in `stepEncounter` and why `main.ts` deletes the interpolator; and the accident gain.

- [ ] **Step 3: Add the honest caveats**

At minimum: every value in this cycle is a guess about feel, which no test can check; and whatever Task 12 could not establish. State what was measured and what was not, the way the existing entries do.

- [ ] **Step 4: Update the repo state line**

Run `npm test` and copy the real test and file counts. Do not predict them — that has been wrong twice.

- [ ] **Step 5: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "Document the impact feel pass and correct the section 4.6 note"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: hitstop → 1, shake → 2, dash FOV → 3, hurt flash → 4 and 11, staff spark → 5, enemy fall reporting → 6, list split → 7, accident gain → 8, patrol → 9, audio → 10, wiring → 11, in-game verification → 12, the handoff correction → 13. The spec's `stepFlash` became `stepPulse` in `src/fx/pulse.ts`, shared with the dash kick, which is one fewer near-duplicate timer than the spec described.

**Type consistency.** `HitstopState.remaining`, `ShakeState.{remaining,duration,amplitude}`, `ImpactLists.{hits,slamHits,staffHits,downed}`, `ImpactTargets.{hits,downs}`, `EnemyStep.fellOutOfWorld`, `EncounterStep.{lostThisFrame,restoredThisFrame}`, `EncounterDeps.{spawns,patrol}`, `FocusEvents.accidents`, `FocusConfig.accidentDownGain`, `HudModel.hurtFlash`, `PatrolConfig.respawnRange` — each defined once and referred to by the same name everywhere after.

**Ordering.** Task 7 needs Task 6's flag. Task 9 needs Task 7's list computation to already be in place, since it inserts after it. Task 11 needs everything. Tasks 1–6, 8 and 10 are independent of each other.

**Known risk.** Task 9 changes a struct that 36 existing tests pass through a single `DEPS` const. The mitigation is in the task: `DEPS` gets an **empty** spawns list, so `shouldRestorePatrol` declines unconditionally and no pre-existing test can change behaviour. If a pre-existing test does change, that is a real finding, not a fixture problem — stop and report it.
