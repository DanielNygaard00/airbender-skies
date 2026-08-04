# Staff Melee Combos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build §4.2's staff — three-swing combos with wide horizontal arcs — and the rule that holding the staff as a weapon blocks the glider.

**Architecture:** The combo is a player-side state machine that labels each swing and never sees an enemy; the arc is a combat-side hit resolved by `stepEncounter`; the cone test both the gust and the staff need is extracted once into `cone.ts`. The tell is built rather than animated, because the model ships no attack clip.

**Tech Stack:** TypeScript, three.js 0.185.1, Vitest 4 (node environment), Vite 8.

## Global Constraints

- **Never commit to `main`.** Work on the `staff-melee` branch. Pushing `main` triggers the GitHub Pages deploy.
- **Typecheck is two passes, both must pass:** `npx tsc -p tsconfig.json --noEmit` then `npx tsc -p tsconfig.test.json --noEmit`.
- `noUncheckedIndexedAccess` is on. Indexed access yields `T | undefined` and must be narrowed.
- **Full suite green:** `npx vitest run`. Baseline is 956 tests across 67 files.
- **Red-proof every test.** Write it, run it, confirm it FAILS for the stated reason, then implement. A test that passes before the feature exists is decorative — say so and rewrite it rather than keeping it.
- **Derive expectations from config, never hardcode.** `C.opener.range`, not `3.6`.
- **Comments explain why, not what.** Mark regression guards as such.
- **Adding a required field to a shared struct breaks every hand-built fixture in the suite.** This has happened eight times across the last two plans and the file lists never predict it. After any struct change, run `npx tsc -p tsconfig.test.json --noEmit` and let it name the complete list, then add the field to each. That fixture work is authorised beyond a task's file list; report every file touched.
- Fixed config values, verbatim: staff `maxChain: 3`, `swingSeconds: 0.26`, `continueSeconds: 0.3`, `recoverySeconds: 0.4`; arc `opener: { range: 3.6, halfAngle: Math.PI / 2.2 }`, `finisher: { range: 4.2, halfAngle: Math.PI / 1.9 }`, `openerDamage: 0.7`, `finisherDamage: 1.2`, `openerKnockback: 4`, `finisherKnockback: 18`; focus `staffConnectGain: 3`.
- Binding: **left mouse button**.

## File Structure

| File | Responsibility |
|---|---|
| `src/combat/cone.ts` (create) | `ConeShape` and `inCone` — the one definition of "inside a horizontal cone". |
| `src/combat/gust.ts` (modify) | `inGust` becomes a delegation to `inCone`. |
| `src/player/staff.ts` (create) | The combo: state, timing, and which swing just started. Never sees an enemy. |
| `src/combat/staff-arc.ts` (create) | The hit: shape, damage, targets, impulse. Never sees a chain length. |
| `src/combat/encounter.ts` (modify) | Resolves a swing it is told about, and reports who it hit. |
| `src/player/controller.ts` (modify) | Runs the combo, and gates glider deploy on it. |
| `src/focus/focus.ts`, `src/focus/config.ts` (modify) | `staffConnects` and its gain. |
| `src/fx/staff-arc-fx.ts` (create) | The arc, drawn at the swing's true reach and angle. |
| `src/player/glider.ts` (modify) | The staff sweeps through the swing, composed into the pose it already owns. |
| `src/core/types.ts`, `src/core/config.ts`, `src/core/input.ts` (modify) | Player fields, both configs, the mouse edge. |
| `src/ui/guide/actions.ts`, `README.md`, `docs/HANDOFF.md` (modify) | Documentation. A drift test binds the guide and README key sets. |
| `src/main.ts` (modify) | Wiring. |

---

### Task 1: One definition of a cone test

**Files:**
- Create: `src/combat/cone.ts`, `src/combat/cone.test.ts`
- Modify: `src/combat/gust.ts`

**Interfaces:**
- Produces: `export interface ConeShape { range: number; halfAngle: number }` and `inCone(origin: Vector3, forward: Vector3, target: Vector3, c: ConeShape): boolean`.
- `inGust(origin, forward, target, c: GustConfig): boolean` keeps its exact signature and behaviour.

- [ ] **Step 1: Write the failing tests**

Create `src/combat/cone.test.ts`. These are the guards that must survive the move, lifted from what `inGust` actually promises:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { inCone } from './cone'

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
const WIDE = { range: 10, halfAngle: Math.PI / 3 }
const at = (x: number, z: number) => new Vector3(x, 0, z)

describe('inCone', () => {
  it('catches a target straight ahead', () => {
    expect(inCone(ORIGIN, NORTH, at(0, -5), WIDE)).toBe(true)
  })

  it('ignores a target behind', () => {
    expect(inCone(ORIGIN, NORTH, at(0, 5), WIDE)).toBe(false)
  })

  it('ignores a target past the range', () => {
    expect(inCone(ORIGIN, NORTH, at(0, -(WIDE.range + 1)), WIDE)).toBe(false)
  })

  it('catches a target at the edge of the angle and not past it', () => {
    // Just inside and just outside the half-angle at the same distance, so the test
    // pins the angle rather than the range.
    const r = WIDE.range / 2
    const inside = WIDE.halfAngle - 0.05
    const outside = WIDE.halfAngle + 0.05
    expect(inCone(ORIGIN, NORTH, at(Math.sin(inside) * r, -Math.cos(inside) * r), WIDE)).toBe(true)
    expect(inCone(ORIGIN, NORTH, at(Math.sin(outside) * r, -Math.cos(outside) * r), WIDE)).toBe(false)
  })

  it('ignores height entirely', () => {
    // The cone is a horizontal sweep, so a target directly above at the same footprint
    // is inside it. Callers that care about height must check separately.
    expect(inCone(ORIGIN, NORTH, new Vector3(0, 40, -5), WIDE)).toBe(true)
  })

  it('rejects a target sitting exactly on the origin rather than dividing by zero', () => {
    expect(inCone(ORIGIN, NORTH, ORIGIN.clone(), WIDE)).toBe(false)
  })

  it('rejects a degenerate heading rather than dividing by zero', () => {
    expect(inCone(ORIGIN, new Vector3(0, 1, 0), at(0, -5), WIDE)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/combat/cone.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Create the module**

Create `src/combat/cone.ts`, moving the body out of `inGust` unchanged:

```ts
import { Vector3 } from 'three'
import { horizontalDistance } from './enemy'

/**
 * A horizontal cone: how far it reaches, and how wide it opens either side of a heading.
 *
 * Named separately from any one move because two of them share the shape — a gust sweeps a
 * long narrow one and a staff swing a short wide one — and a second copy of this test is a
 * second thing to keep in step.
 */
export interface ConeShape {
  range: number
  halfAngle: number
}

/** Whether a target lies inside the cone. Horizontal: height is ignored entirely. */
export function inCone(
  origin: Vector3, forward: Vector3, target: Vector3, c: ConeShape,
): boolean {
  const distance = horizontalDistance(origin, target)
  // A target on top of the caster has no direction to compare, so it is out rather than
  // normalised into a NaN.
  if (distance > c.range || distance < 1e-6) return false

  const toTarget = new Vector3(target.x - origin.x, 0, target.z - origin.z).normalize()
  const heading = new Vector3(forward.x, 0, forward.z)
  if (heading.lengthSq() < 1e-8) return false

  return toTarget.dot(heading.normalize()) >= Math.cos(c.halfAngle)
}
```

- [ ] **Step 4: Make `inGust` delegate**

In `src/combat/gust.ts`, replace `inGust`'s body. Keep the export and the signature:

```ts
/**
 * Whether a target lies inside the blast. Horizontal: a gust is a sweep, not a shot.
 *
 * Kept as its own name over `inCone` for two reasons: `GustConfig` satisfies `ConeShape`
 * structurally so this costs nothing, and `src/fx/gust-cone.test.ts` uses this function as
 * the independent mechanism it compares the drawn cone against. Inlining it at the call
 * sites would quietly delete that check.
 */
export function inGust(
  origin: Vector3,
  forward: Vector3,
  target: Vector3,
  c: GustConfig,
): boolean {
  return inCone(origin, forward, target, c)
}
```

Import `inCone` from `./cone`, and drop any imports `gust.ts` no longer uses.

- [ ] **Step 5: Verify nothing else moved**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
```

Expected: everything green, including `src/combat/gust.test.ts` and `src/fx/gust-cone.test.ts`
**unedited**. If any existing assertion needs changing, the extraction altered behaviour and is
wrong — stop and report rather than editing the test.

- [ ] **Step 6: Commit**

```bash
git add src/combat/cone.ts src/combat/cone.test.ts src/combat/gust.ts
git commit -m "Extract the cone test so the staff can reuse it"
```

---

### Task 2: The combo

**Files:**
- Create: `src/player/staff.ts`, `src/player/staff.test.ts`
- Modify: `src/core/config.ts`

**Interfaces:**
- Produces: `StaffConfig`, `StaffState`, `StaffSwing`, `idleStaff()`, `isSwinging(s)`, `staffBusy(s)`, `staffOf(player)`, `stepStaff(s, pressed, dt, c) => { state, started: StaffSwing | null }`, and `DEFAULT_STAFF_CONFIG`.

- [ ] **Step 1: Write the failing tests**

Create `src/player/staff.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  idleStaff, isSwinging, staffBusy, staffOf, stepStaff,
} from './staff'
import { DEFAULT_STAFF_CONFIG as S } from '../core/config'

/** Press once from the given state. */
const press = (state = idleStaff()) => stepStaff(state, true, 1 / 60, S)
/** Let time pass with no press. */
function wait(state: ReturnType<typeof idleStaff>, seconds: number) {
  let s = state
  for (let t = 0; t < seconds; t += 1 / 60) s = stepStaff(s, false, 1 / 60, S).state
  return s
}
/** Press, let the swing finish, press again — the shortest legal continuation. */
function chain(times: number) {
  let s = idleStaff()
  const started = []
  for (let i = 0; i < times; i++) {
    const swung = stepStaff(s, true, 1 / 60, S)
    s = swung.state
    started.push(swung.started)
    s = wait(s, S.swingSeconds)
  }
  return { state: s, started }
}

describe('stepStaff', () => {
  it('starts a swing on a press', () => {
    const { started, state } = press()
    expect(started).not.toBeNull()
    expect(started?.index).toBe(1)
    expect(started?.finisher).toBe(false)
    expect(isSwinging(state)).toBe(true)
  })

  it('reports nothing on frames with no press', () => {
    expect(stepStaff(idleStaff(), false, 1 / 60, S).started).toBeNull()
  })

  it('ignores a press while a swing is already running', () => {
    // Mashing must not stack swings on top of each other.
    const swinging = press().state
    expect(stepStaff(swinging, true, 1 / 60, S).started).toBeNull()
  })

  it('continues the combo when pressed inside the window', () => {
    const { started } = chain(2)
    expect(started[1]?.index).toBe(2)
  })

  it('marks only the last swing of the chain as the finisher', () => {
    const { started } = chain(S.maxChain)
    expect(started.slice(0, -1).every((s) => s?.finisher === false)).toBe(true)
    expect(started[S.maxChain - 1]?.finisher).toBe(true)
  })

  it('resets the chain when the continue window lapses', () => {
    let s = press().state
    s = wait(s, S.swingSeconds + S.continueSeconds + S.recoverySeconds + 0.1)
    expect(stepStaff(s, true, 1 / 60, S).started?.index).toBe(1)
  })

  it('will not exceed the chain length', () => {
    // A press after the finisher lands during recovery, and recovery is not a swing.
    const { state } = chain(S.maxChain)
    expect(stepStaff(state, true, 1 / 60, S).started).toBeNull()
  })

  it('owes recovery once the combo ends', () => {
    const { state } = chain(S.maxChain)
    const after = wait(state, S.swingSeconds)
    expect(isSwinging(after)).toBe(false)
    expect(staffBusy(after)).toBe(true)
  })

  it('does not extend recovery when mashed', () => {
    // Recovery is the price of the combo, not a punishment for pressing again.
    let a = wait(chain(S.maxChain).state, S.swingSeconds)
    let b = a
    for (let t = 0; t < 0.1; t += 1 / 60) {
      a = stepStaff(a, true, 1 / 60, S).state
      b = stepStaff(b, false, 1 / 60, S).state
    }
    expect(a.recovery).toBeCloseTo(b.recovery, 6)
  })

  it('is free again once recovery expires', () => {
    const spent = wait(chain(S.maxChain).state, S.swingSeconds + S.recoverySeconds + 0.05)
    expect(staffBusy(spent)).toBe(false)
    expect(stepStaff(spent, true, 1 / 60, S).started?.index).toBe(1)
  })
})

describe('staffBusy', () => {
  it('is true while swinging and while recovering, and false when idle', () => {
    expect(staffBusy(idleStaff())).toBe(false)
    expect(staffBusy(press().state)).toBe(true)
    expect(staffBusy(wait(chain(S.maxChain).state, S.swingSeconds))).toBe(true)
  })
})

describe('staffOf', () => {
  it('reads the three flat player fields', () => {
    const s = staffOf({ staffChain: 2, staffElapsed: 0.1, staffRecovery: 0 })
    expect(s).toEqual({ chain: 2, elapsed: 0.1, recovery: 0 })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/player/staff.test.ts
```

Expected: FAIL — neither the module nor `DEFAULT_STAFF_CONFIG` exists.

- [ ] **Step 3: Implement the module**

Create `src/player/staff.ts`:

```ts
/**
 * The staff as a weapon: short combos of wide arcs, and the commitment they cost.
 *
 * Player-side, like `dash.ts` and `slipstream.ts`, because a combo is a state machine over
 * time rather than something that happens to enemies. This module never sees an enemy — it
 * reports which swing began and lets the caller decide what that means, the same contract
 * `stepDash` and `detectSlam` use.
 *
 * The commitment is the point of the move. The design document calls no-glide-while-swinging
 * the game's central risk decision, and `recovery` is what gives that decision weight: the
 * combo keeps the staff for a beat after the last swing, so committing costs more than the
 * swings themselves.
 */
export interface StaffConfig {
  maxChain: number
  /** How long one swing occupies the staff. */
  swingSeconds: number
  /** Grace after a swing during which another press continues the combo. */
  continueSeconds: number
  /** Commitment owed once the combo ends, however it ended. */
  recoverySeconds: number
}

export interface StaffState {
  /** Swings thrown in the current combo, 0 to maxChain. */
  chain: number
  /** Seconds into the active swing, or null between swings. */
  elapsed: number | null
  /** Seconds of commitment left after the combo ended. */
  recovery: number
}

/** The swing that just began. */
export interface StaffSwing {
  /** 1-based position in the combo. Drives the alternating sweep of the tell. */
  index: number
  /** The last swing of the chain: wider, heavier. */
  finisher: boolean
}

export function idleStaff(): StaffState {
  return { chain: 0, elapsed: null, recovery: 0 }
}

export function isSwinging(s: StaffState): boolean {
  return s.elapsed !== null
}

/** Swinging or still recovering: the staff is not available as a wing. */
export function staffBusy(s: StaffState): boolean {
  return isSwinging(s) || s.recovery > 0
}

/**
 * Read the three flat fields off a player as a `StaffState`.
 *
 * Exists so the controller and the action guide do not each assemble the struct by hand;
 * two copies of the same three fields is how one of them ends up reading a stale one.
 */
export function staffOf(player: {
  staffChain: number
  staffElapsed: number | null
  staffRecovery: number
}): StaffState {
  return {
    chain: player.staffChain,
    elapsed: player.staffElapsed,
    recovery: player.staffRecovery,
  }
}

export function stepStaff(
  s: StaffState, pressed: boolean, dt: number, c: StaffConfig,
): { state: StaffState; started: StaffSwing | null } {
  // A press only lands when the staff is free: not mid-swing, not recovering, and with a
  // swing left in the chain. Everything else is a no-op, so mashing cannot stack swings.
  const free = !isSwinging(s) && s.recovery <= 0 && s.chain < c.maxChain
  if (pressed && free) {
    const index = s.chain + 1
    return {
      state: { chain: index, elapsed: 0, recovery: 0 },
      started: { index, finisher: index >= c.maxChain },
    }
  }

  const recovery = Math.max(0, s.recovery - dt)

  if (s.elapsed === null) {
    // Between swings: the combo survives for `continueSeconds` past the last one, then the
    // chain is spent and the recovery is owed. `chain` doubles as the "was mid-combo" flag.
    if (s.chain === 0 || recovery > 0) return { state: { ...s, recovery }, started: null }
    const sinceSwing = s.recovery > 0 ? 0 : 0
    void sinceSwing
    return { state: { ...s, recovery }, started: null }
  }

  const elapsed = s.elapsed + dt
  if (elapsed < c.swingSeconds) {
    return { state: { ...s, elapsed, recovery }, started: null }
  }

  // The swing is over. The chain is spent if this was the finisher; otherwise the window
  // is open, which is modelled as recovery being owed only once the window has lapsed.
  return {
    state: {
      chain: s.chain,
      elapsed: null,
      recovery: s.chain >= c.maxChain ? c.recoverySeconds : 0,
    },
    started: null,
  }
}
```

**Note to the implementer:** the between-swings branch above is deliberately left as the
sketch it is — it does not yet implement the continue window, and the `sinceSwing`/`void`
lines are a placeholder that must not survive. You need a fourth piece of state to know how
long it has been since the last swing ended. Add `sinceSwing: number` to `StaffState`,
documented, and use it: it accumulates while `elapsed === null` and `chain > 0`; when it
passes `continueSeconds` the combo ends and `recoverySeconds` is owed; a press resets it.
Update `idleStaff`, `staffOf`'s return, and the `staffOf` test's expectation to match — the
test asserts a whole object with `toEqual`, so it will tell you. Get the tests green on your
own reading of the timing rules rather than forcing this sketch to work.

- [ ] **Step 4: Add the config**

In `src/core/config.ts`:

```ts
/**
 * The staff. A full three-swing combo occupies it for about 0.8s of swinging plus 0.4s of
 * recovery, so committing to melee costs over a second with no wing — which is the price
 * the design document's "central risk decision" is supposed to have.
 */
export const DEFAULT_STAFF_CONFIG: StaffConfig = {
  maxChain: 3,
  swingSeconds: 0.26,
  continueSeconds: 0.3,
  recoverySeconds: 0.4,
}
```

- [ ] **Step 5: Run to verify they pass**

```bash
npx vitest run src/player/staff.test.ts
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
```

- [ ] **Step 6: Red-proof the two timing rules**

Both of these decide how the move feels, so prove the tests can see them:

1. Make the continue window infinite (never end the combo on lapse). Confirm "resets the
   chain when the continue window lapses" FAILS.
2. Make `staffBusy` return `isSwinging(s)` only. Confirm "owes recovery once the combo ends"
   FAILS.

Restore each BY HAND — do not use `git checkout` or `git restore`. Quote both failures in
your report.

- [ ] **Step 7: Commit**

```bash
git add src/player/staff.ts src/player/staff.test.ts src/core/config.ts
git commit -m "Add the staff combo: three swings and a commitment"
```

---

### Task 3: The arc

**Files:**
- Create: `src/combat/staff-arc.ts`, `src/combat/staff-arc.test.ts`
- Modify: `src/combat/config.ts`, `src/combat/encounter.ts` (`CombatConfig` gains `staffArc`)

**Interfaces:**
- Consumes: `ConeShape`, `inCone` from `src/combat/cone.ts`; `Enemy`, `horizontalDistance` from `src/combat/enemy.ts`.
- Produces: `StaffArcConfig`, `staffShape(finisher, c)`, `staffDamage(finisher, c)`, `staffTargets(origin, forward, finisher, enemies, c)`, `staffImpulse(origin, target, finisher, c)`.

- [ ] **Step 1: Write the failing tests**

Create `src/combat/staff-arc.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { staffShape, staffDamage, staffTargets, staffImpulse } from './staff-arc'
import { spawnEnemy, horizontalDistance } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

const A = DEFAULT_COMBAT_CONFIG.staffArc
const E = DEFAULT_COMBAT_CONFIG.enemy
const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
const at = (x: number, z: number) => new Vector3(x, 0, z)
const enemyAt = (id: string, x: number, z: number) => spawnEnemy(id, at(x, z), E)

describe('staffShape', () => {
  it('sweeps wider and further on the finisher', () => {
    // Three assertions rather than one, so swapping two of the numbers cannot pass.
    expect(staffShape(true, A).range).toBeGreaterThan(staffShape(false, A).range)
    expect(staffShape(true, A).halfAngle).toBeGreaterThan(staffShape(false, A).halfAngle)
    expect(staffDamage(true, A)).toBeGreaterThan(staffDamage(false, A))
  })

  it('outreaches a spear', () => {
    // The point of 3.6 against the enemy's strikeRange: melee is a spacing tool, not a
    // trade. Derived from config so retuning either side keeps this honest.
    expect(staffShape(false, A).range).toBeGreaterThan(E.strikeRange)
  })
})

describe('staffTargets', () => {
  it('hits several enemies at once', () => {
    // The doc's stated purpose for the staff: several enemies, not one hard.
    const r = staffShape(false, A).range * 0.6
    const spread = [
      enemyAt('left', -r * 0.7, -r * 0.5),
      enemyAt('centre', 0, -r),
      enemyAt('right', r * 0.7, -r * 0.5),
    ]
    expect(staffTargets(ORIGIN, NORTH, false, spread, A).map((e) => e.id))
      .toEqual(['left', 'centre', 'right'])
  })

  it('ignores an enemy behind', () => {
    const behind = enemyAt('behind', 0, staffShape(false, A).range * 0.5)
    expect(staffTargets(ORIGIN, NORTH, false, [behind], A)).toHaveLength(0)
  })

  it('reaches enemies on the finisher that an opener misses', () => {
    const beyond = enemyAt('beyond', 0, -(staffShape(false, A).range + 0.3))
    expect(staffTargets(ORIGIN, NORTH, false, [beyond], A)).toHaveLength(0)
    expect(staffTargets(ORIGIN, NORTH, true, [beyond], A)).toHaveLength(1)
  })
})

describe('staffImpulse', () => {
  it('pushes outward, away from the player', () => {
    const target = at(0, -2)
    const push = staffImpulse(ORIGIN, target, false, A)
    const after = target.clone().addScaledVector(push, 0.1)
    expect(horizontalDistance(ORIGIN, after)).toBeGreaterThan(horizontalDistance(ORIGIN, target))
  })

  it('does not lift, unlike air', () => {
    // Lift belongs to bending. A staff sweep slides a soldier sideways; lifting one would
    // make it inert, which is the Vortex's job and would blur the two moves.
    expect(staffImpulse(ORIGIN, at(0, -2), true, A).y).toBe(0)
  })

  it('shoves harder on the finisher', () => {
    expect(staffImpulse(ORIGIN, at(0, -2), true, A).length())
      .toBeGreaterThan(staffImpulse(ORIGIN, at(0, -2), false, A).length())
  })

  it('stays finite for an enemy standing on the player', () => {
    expect(Number.isFinite(staffImpulse(ORIGIN, ORIGIN.clone(), false, A).x)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/combat/staff-arc.test.ts
```

Expected: FAIL — the module does not exist and `DEFAULT_COMBAT_CONFIG.staffArc` is undefined.

- [ ] **Step 3: Implement the module**

Create `src/combat/staff-arc.ts`:

```ts
import { Vector3 } from 'three'
import { inCone, type ConeShape } from './cone'
import type { Enemy } from './enemy'

/**
 * What a staff swing hits.
 *
 * Every function here takes a `finisher` flag rather than a swing index, because this module
 * has no business knowing how long a combo is — `stepStaff` owns `maxChain` and labels the
 * swing on the way out. An index here would mean two modules agreeing about the chain
 * length, which is the kind of shared constant that drifts.
 */
export interface StaffArcConfig {
  opener: ConeShape
  finisher: ConeShape
  openerDamage: number
  finisherDamage: number
  openerKnockback: number
  finisherKnockback: number
}

export function staffShape(finisher: boolean, c: StaffArcConfig): ConeShape {
  return finisher ? c.finisher : c.opener
}

export function staffDamage(finisher: boolean, c: StaffArcConfig): number {
  return finisher ? c.finisherDamage : c.openerDamage
}

/** Everyone caught by one swing. Named so a caller cannot forget the arc. */
export function staffTargets(
  origin: Vector3, forward: Vector3, finisher: boolean,
  enemies: readonly Enemy[], c: StaffArcConfig,
): Enemy[] {
  const shape = staffShape(finisher, c)
  return enemies.filter((enemy) => inCone(origin, forward, enemy.position, shape))
}

/**
 * The shove a swing puts on a target: outward, and flat.
 *
 * No vertical component, deliberately. Lift is what air does, and a lifted enemy is inert —
 * that is the Vortex's whole payoff. A staff sweep slides a soldier sideways instead, which
 * is why the two moves read differently at the same range.
 */
export function staffImpulse(
  origin: Vector3, target: Vector3, finisher: boolean, c: StaffArcConfig,
): Vector3 {
  const away = new Vector3(target.x - origin.x, 0, target.z - origin.z)
  const direction = away.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : away.normalize()
  return direction.multiplyScalar(finisher ? c.finisherKnockback : c.openerKnockback)
}
```

- [ ] **Step 4: Add the config**

`CombatConfig` in `src/combat/encounter.ts` gains `staffArc: StaffArcConfig` (import the type).
In `src/combat/config.ts`:

```ts
  /**
   * The staff's arcs. Reach just past the spear's strikeRange of 3.2, so the staff can
   * out-space infantry rather than trading with it. Two openers leave a 1.5-health soldier
   * one hit from down and the finisher takes anyone still standing; a gust does 0.5 with 26
   * knockback, so the staff buys damage with the reach and displacement it gives up.
   */
  staffArc: {
    opener: { range: 3.6, halfAngle: Math.PI / 2.2 },      // about 164 degrees swept
    finisher: { range: 4.2, halfAngle: Math.PI / 1.9 },    // about 190: nearly all round
    openerDamage: 0.7,
    finisherDamage: 1.2,
    // Low on the openers so the combo keeps its targets in reach; the finisher clears space.
    openerKnockback: 4,
    finisherKnockback: 18,
  },
```

- [ ] **Step 5: Run to verify they pass, then commit**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
git add src/combat/staff-arc.ts src/combat/staff-arc.test.ts src/combat/config.ts src/combat/encounter.ts
git commit -m "Add the staff arc: a wide flat sweep"
```

---

### Task 4: The fight resolves a swing

**Files:**
- Modify: `src/combat/encounter.ts`, `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `StaffSwing` from `src/player/staff.ts`; `staffTargets`, `staffDamage`, `staffImpulse` from `src/combat/staff-arc.ts`.
- Produces: `EncounterInput` gains `staffSwing: StaffSwing | null`; `EncounterStep` gains `staffHitThisFrame: string[]`.

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/encounter.test.ts`. Its step helper's defaults object needs
`staffSwing: null` added once.

```ts
describe('a staff swing', () => {
  const swing = (finisher: boolean, spawns: EnemySpawn[]) => stepEncounter(
    startEncounter(spawns, DEFAULT_COMBAT_CONFIG),
    { ...defaults, staffSwing: { index: finisher ? 3 : 1, finisher } },
    1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
  )

  it('damages an enemy in the arc and reports the hit', () => {
    const step = swing(false, [{ id: 'a', position: new Vector3(0, 0, -2) }])
    const enemy = step.encounter.enemies[0]
    if (!enemy) throw new Error('expected an enemy')
    expect(enemy.health.current).toBeCloseTo(
      DEFAULT_COMBAT_CONFIG.enemy.maxHealth - DEFAULT_COMBAT_CONFIG.staffArc.openerDamage, 5,
    )
    expect(step.staffHitThisFrame).toEqual(['a'])
  })

  it('leaves an enemy outside the arc alone', () => {
    const step = swing(false, [{ id: 'a', position: new Vector3(0, 0, 20) }])
    expect(step.staffHitThisFrame).toEqual([])
  })

  it('hits a whole group with one swing', () => {
    const step = swing(false, [
      { id: 'a', position: new Vector3(-1.5, 0, -1.5) },
      { id: 'b', position: new Vector3(0, 0, -2) },
      { id: 'c', position: new Vector3(1.5, 0, -1.5) },
    ])
    expect(step.staffHitThisFrame.sort()).toEqual(['a', 'b', 'c'])
  })

  it('hits harder on the finisher', () => {
    const spawns = [{ id: 'a', position: new Vector3(0, 0, -2) }]
    const opener = swing(false, spawns).encounter.enemies[0]
    const finisher = swing(true, spawns).encounter.enemies[0]
    if (!opener || !finisher) throw new Error('expected enemies')
    expect(finisher.health.current).toBeLessThan(opener.health.current)
  })

  it('keeps its hits apart from gust connects and slam hits', () => {
    // Each of the three feeds a differently tuned Focus grant, so folding them together
    // would pay the wrong rate.
    const step = swing(false, [{ id: 'a', position: new Vector3(0, 0, -2) }])
    expect(step.hitThisFrame).toEqual([])
    expect(step.slamHitThisFrame).toEqual([])
  })

  it('interrupts a wind-up', () => {
    // Stepped into a genuine wind-up first rather than assumed: a fixture that never
    // reaches one would pass against a swing that interrupts nothing.
    let encounter = startEncounter(
      [{ id: 'a', position: new Vector3(0, 0, -2) }], DEFAULT_COMBAT_CONFIG,
    )
    for (let t = 0; t < 1; t += 1 / 60) {
      encounter = stepEncounter(encounter, defaults, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS).encounter
      if (encounter.enemies[0]?.stance === 'wind-up') break
    }
    expect(encounter.enemies[0]?.stance).toBe('wind-up')
    const struck = stepEncounter(
      encounter, { ...defaults, staffSwing: { index: 1, finisher: false } },
      1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
    expect(struck.encounter.enemies[0]?.stance).not.toBe('wind-up')
  })

  it('does not hit a downed enemy', () => {
    const spawns = [{ id: 'a', position: new Vector3(0, 0, -2) }]
    let encounter = startEncounter(spawns, DEFAULT_COMBAT_CONFIG)
    for (let i = 0; i < 4; i++) {
      encounter = stepEncounter(
        encounter, { ...defaults, staffSwing: { index: 3, finisher: true } },
        1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      ).encounter
    }
    const again = stepEncounter(
      encounter, { ...defaults, staffSwing: { index: 1, finisher: false } },
      1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
    expect(again.staffHitThisFrame).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/combat/encounter.test.ts
```

Expected: FAIL — `staffSwing` and `staffHitThisFrame` do not exist.

- [ ] **Step 3: Implement**

Add to the two interfaces:

```ts
export interface EncounterInput {
  // ...
  /** The swing the player's staff started this frame, or null. */
  staffSwing: StaffSwing | null
}

export interface EncounterStep {
  // ...
  /** Enemies a staff swing connected with. Kept apart from hitThisFrame and
   *  slamHitThisFrame because each feeds a differently tuned Focus grant. */
  staffHitThisFrame: string[]
}
```

Inside `stepEncounter`, after the vortex block and before the slam block — with the other
interrupts, and before enemies are stepped, so a swing cancels a wind-up rather than trading
with it:

```ts
  let staffHitThisFrame: string[] = []

  if (input.staffSwing) {
    const { finisher } = input.staffSwing
    const caught = new Set(
      staffTargets(input.playerPosition, input.playerForward, finisher, enemies, c.staffArc)
        .map((enemy) => enemy.id),
    )
    // Read before the hits land, so a connect means a live enemy took it rather than a body
    // being shoved around the island.
    staffHitThisFrame = enemies
      .filter((enemy) => caught.has(enemy.id) && !isDowned(enemy.health))
      .map((enemy) => enemy.id)
    const damage = staffDamage(finisher, c.staffArc)
    enemies = enemies.map((enemy) =>
      caught.has(enemy.id) && !isDowned(enemy.health)
        ? hitEnemy(enemy, damage, staffImpulse(
            input.playerPosition, enemy.position, finisher, c.staffArc,
          ))
        : enemy)
  }
```

Return `staffHitThisFrame` in the step. Update the ordering comment at the top of
`stepEncounter` to name the staff in the sequence.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "Resolve a staff swing in the fight"
```

---

### Task 5: The player swings, and cannot glide while doing it

**Files:**
- Modify: `src/player/controller.ts`, `src/player/controller.test.ts`, `src/core/types.ts`, `src/core/input.ts`, `src/main.ts`

**Interfaces:**
- Consumes: `stepStaff`, `staffOf`, `staffBusy`, `StaffConfig`, `DEFAULT_STAFF_CONFIG`.
- Produces: `PlayerState` gains `staffChain: number`, `staffElapsed: number | null`, `staffRecovery: number`, plus whatever fourth field Task 2 added for the continue window; `InputState` gains `staffPressed: boolean`; `ControllerDeps` gains `staff: StaffConfig`; `controllerStep` returns the swing it started via a new field on its result — see step 3.

**EXPECTED FIXTURE FALLOUT.** This adds required fields to both `PlayerState` and `InputState`.
Every hand-built fixture of either will stop typechecking. Run
`npx tsc -p tsconfig.test.json --noEmit` after the struct change and let it list them; the last
comparable task named three test files plus one production file (`src/player/state.ts`'s
`createPlayerState`). That work is authorised; list every file you touch.

- [ ] **Step 1: Write the failing tests**

Add to `src/player/controller.test.ts`, extending its `player()`, `input()` and `deps()`
helpers with the new fields and `staff: DEFAULT_STAFF_CONFIG`.

```ts
describe('the staff', () => {
  const swinging = () => controllerStep(
    player(), input({ staffPressed: true }), 1 / 60, deps(flatGround),
  )

  it('starts a swing on a press', () => {
    expect(staffBusy(staffOf(swinging()))).toBe(true)
  })

  it('reports the swing it started, so the fight can resolve it', () => {
    const step = controllerStepWithSwing(
      player(), input({ staffPressed: true }), 1 / 60, deps(flatGround),
    )
    expect(step.staffSwing?.index).toBe(1)
  })

  it('does not swing in the glider, where the staff is a wing', () => {
    const flying = player({
      mode: 'glider', position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, 0, -20),
    })
    const pressed = controllerStep(flying, input({ staffPressed: true }), 1 / 60, deps(voidWorld))
    expect(staffBusy(staffOf(pressed))).toBe(false)
  })

  it('blocks a glider deploy while swinging', () => {
    // The design document's central risk decision: commit to melee and the wing is not
    // available until the staff is done with you.
    const falling = player({
      position: new Vector3(0, 200, 0), grounded: false,
      airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    })
    const mid = controllerStep(falling, input({ staffPressed: true }), 1 / 60, deps(voidWorld))
    expect(staffBusy(staffOf(mid))).toBe(true)
    const deployed = controllerStep(mid, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
    expect(deployed.mode).toBe('ground')
  })

  it('still blocks a deploy during recovery, after the swinging has stopped', () => {
    // A gate that only covers the swing itself would make the commitment nearly free.
    let s = player({
      position: new Vector3(0, 400, 0), grounded: false,
      airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    })
    s = controllerStep(s, input({ staffPressed: true }), 1 / 60, deps(voidWorld))
    for (let i = 0; i < DEFAULT_STAFF_CONFIG.maxChain - 1; i++) {
      for (let t = 0; t < DEFAULT_STAFF_CONFIG.swingSeconds; t += 1 / 60) {
        s = controllerStep(s, input(), 1 / 60, deps(voidWorld))
      }
      s = controllerStep(s, input({ staffPressed: true }), 1 / 60, deps(voidWorld))
    }
    for (let t = 0; t < DEFAULT_STAFF_CONFIG.swingSeconds + 0.02; t += 1 / 60) {
      s = controllerStep(s, input(), 1 / 60, deps(voidWorld))
    }
    expect(isSwinging(staffOf(s))).toBe(false)
    expect(staffBusy(staffOf(s))).toBe(true)
    const blocked = controllerStep(s, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
    expect(blocked.mode).toBe('ground')
  })

  it('allows the deploy once the staff is free again', () => {
    // The control for the two tests above: without it they only prove deploy never works.
    let s = player({
      position: new Vector3(0, 400, 0), grounded: false,
      airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    })
    s = controllerStep(s, input({ staffPressed: true }), 1 / 60, deps(voidWorld))
    for (let t = 0; t < 3; t += 1 / 60) s = controllerStep(s, input(), 1 / 60, deps(voidWorld))
    expect(staffBusy(staffOf(s))).toBe(false)
    const deployed = controllerStep(s, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
    expect(deployed.mode).toBe('glider')
  })

  it('clears on respawn', () => {
    const broken = player({ position: new Vector3(Number.NaN, 0, 0), staffElapsed: 0.1 })
    const back = controllerStep(broken, input(), 1 / 60, deps(flatGround))
    expect(staffBusy(staffOf(back))).toBe(false)
  })
})
```

**The `controllerStepWithSwing` in the second test does not exist yet** — that is the
interface question step 3 settles. Write the test against whatever you implement there and say
in your report which shape you chose.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/player/controller.test.ts
```

Expected: FAIL — the fields, the input and the deps entry do not exist.

- [ ] **Step 3: Decide how the swing leaves the controller, then implement**

`controllerStep` currently returns a `PlayerState`. The fight needs to know a swing started,
and the state alone cannot say so — `staffElapsed` being 0 is true for the whole first frame
either way.

Two shapes work. Pick one, implement it, and record the choice and your reasoning in the
report:

- **A parallel function**, `staffStep(state, input, dt, c)`, that `main.ts` calls beside
  `controllerStep`, in the way `detectSlam` sits beside it today comparing before and after.
  Keeps `controllerStep`'s return type untouched; costs one more call in the loop.
- **Compare before and after in `main.ts`**, exactly as the dash trail and the slipstream
  trail already do (`player.dashesUsed > beforeStep.dashesUsed`). Needs no new function, but
  the `finisher` flag has to be recomputed from `staffChain` against `maxChain`, which puts
  the chain-length knowledge in a second place — the thing Task 3 was careful to avoid.

The first is recommended for that reason. Whichever you choose, the rule stands: **only
`stepStaff` decides `finisher`.**

Then, in `controllerStep`, add the combo to every path that returns a stepped state, and gate
the deploy:

```ts
  if (input.actionPressed && !state.grounded && !canAirJump(state, deps.ground)
      && !staffBusy(staffOf(state))) {
```

The staff steps only in ground mode; in the glider a press is ignored, because the staff is
the wing. `respawn` must clear all the staff fields, which is what the "clears on respawn"
test checks.

In `src/core/input.ts`, add `staffPressed` as a **mouse** edge. `dashPressed` is the precedent
for the edge handling — a field on the class, read in `toInputState`, cleared in `sample()` —
but the source is new:

```ts
    on<MouseEvent>('mousedown', (e) => {
      // Left button only, and only while the canvas holds the pointer: otherwise a click
      // on the page chrome would swing the staff.
      if (e.button === 0 && document.pointerLockElement === canvas) this.staffPressed = true
    })
```

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
git add -u && git commit -m "Swing the staff, and hold the wing shut while it swings"
```

---

### Task 6: Focus from staff connects

**Files:**
- Modify: `src/focus/focus.ts`, `src/focus/focus.test.ts`, `src/focus/config.ts`, `src/main.ts`

**Interfaces:**
- Produces: `FocusEvents` gains `staffConnects: number`; `noFocusEvents()` includes it; `FocusConfig` gains `staffConnectGain: number`.

- [ ] **Step 1: Write the failing tests**

Add to `src/focus/focus.test.ts`, reusing its local config and event helpers:

```ts
describe('focus from the staff', () => {
  const withEvents = (over: Partial<FocusEvents>) => stepFocus(
    emptyFocus(C),
    { ratePerSecond: 0, events: { ...noFocusEvents(), ...over }, frozen: false, reset: false },
    1 / 60, C,
  )

  it('grants per enemy the swing connected with', () => {
    // A wide arc on three soldiers is three connects, which is the point of the move.
    expect(withEvents({ staffConnects: 3 }).value)
      .toBeCloseTo(withEvents({ staffConnects: 1 }).value * 3, 5)
  })

  it('grants nothing without a connect', () => {
    expect(withEvents({}).value).toBe(0)
  })

  it('pays less per hit than a gust connect', () => {
    // A gust pays once per enemy at range and off cooldown; the staff pays three times a
    // combo at melee range. Per-hit parity would make the staff the way to farm the meter.
    expect(C.staffConnectGain).toBeLessThan(C.gustConnectGain)
  })
})
```

- [ ] **Step 2: Run to verify they fail, then implement**

```bash
npx vitest run src/focus/focus.test.ts
```

Expected: FAIL — `staffConnects` and `staffConnectGain` do not exist.

`FocusEvents` gains `staffConnects: number`, `noFocusEvents()` returns it as `0`, and
`FocusConfig` gains:

```ts
  /** Focus per enemy a staff swing connected with. */
  staffConnectGain: number
```

In `stepFocus`, add it to the existing event group that is multiplied by the chain ramp:

```ts
  value += (events.gustConnects * c.gustConnectGain + events.downs * c.downGain
    + events.slamStrength * c.slamGainAtFullImpact
    + events.staffConnects * c.staffConnectGain
    + (events.damageAvoided ? c.dodgeGain : 0)) * ramp
```

In `src/focus/config.ts`:

```ts
  // Below gustConnectGain (6): a wide arc on three soldiers pays three times, and it pays
  // at melee range where the risk is already its own reward.
  staffConnectGain: 3,
```

Wire `staffConnects: fight.staffHitThisFrame.length` into the Focus events in `src/main.ts`.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
git add -u && git commit -m "Build Focus from staff connects"
```

---

### Task 7: The arc is visible

**Files:**
- Create: `src/fx/staff-arc-fx.ts`, `src/fx/staff-arc-fx.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Effect` from `src/fx/effect.ts`; `ConeShape` and `inCone` from `src/combat/cone.ts`; `staffShape` from `src/combat/staff-arc.ts`.
- Produces: `createStaffArc(origin: Vector3, forward: Vector3, shape: ConeShape): Effect`.

Note the signature takes a `ConeShape`, not a `finisher` flag: the effect draws whatever
shape it is handed and does not need to know which swing produced it. `main.ts` passes
`staffShape(swing.finisher, fightConfig.staffArc)`, which is the same call the fight resolved
with.

- [ ] **Step 1: Write the failing tests**

Create `src/fx/staff-arc-fx.test.ts`. Read `src/fx/gust-cone.test.ts` first — its containment
sampling is the pattern to follow here, and the honesty check is the reason this test exists:

```ts
import { describe, it, expect } from 'vitest'
import { Group, Mesh, Vector3 } from 'three'
import { createStaffArc } from './staff-arc-fx'
import { inCone } from '../combat/cone'
import { staffShape } from '../combat/staff-arc'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import type { Effect } from './effect'

const A = DEFAULT_COMBAT_CONFIG.staffArc
const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)

function meshes(effect: Effect): Mesh[] {
  const object = effect.object
  if (!(object instanceof Group)) throw new Error('expected a group')
  return object.children.filter((c): c is Mesh => c instanceof Mesh)
}

describe('createStaffArc', () => {
  it('draws the shape it was handed, not a fixed one', () => {
    const opener = createStaffArc(ORIGIN, NORTH, staffShape(false, A))
    const finisher = createStaffArc(ORIGIN, NORTH, staffShape(true, A))
    const radius = (e: Effect) => Math.max(...meshes(e).map((m) => m.scale.x || 1))
    expect(radius(finisher)).toBeGreaterThan(radius(opener))
  })

  it('agrees with inCone about what is inside the sweep', () => {
    // The honesty rule this repo holds attack effects to: a hit landing outside the drawn
    // arc reads as a bug. Checked against inCone, a different mechanism from the geometry.
    // Necessary but not sufficient — the gust cone passed a check like this while being
    // invisible on screen, so the in-game pass is what confirms it can be seen.
    const shape = staffShape(false, A)
    const arc = createStaffArc(ORIGIN, NORTH, shape)
    const fill = meshes(arc)[0]
    if (!fill) throw new Error('expected a fill mesh')
    arc.object.updateMatrixWorld(true)

    for (let angle = -Math.PI; angle < Math.PI; angle += Math.PI / 24) {
      for (const r of [shape.range * 0.5, shape.range * 1.4]) {
        const point = new Vector3(Math.sin(angle) * r, 0, -Math.cos(angle) * r)
        const expected = inCone(ORIGIN, NORTH, point, shape)
        const local = fill.worldToLocal(point.clone())
        const inSector = local.length() <= 1.001 &&
          Math.abs(Math.atan2(local.x, -local.y)) <= shape.halfAngle + 1e-3
        expect({ angle, r, inSector }).toEqual({ angle, r, inSector: expected })
      }
    }
  })

  it('runs and then finishes', () => {
    const arc = createStaffArc(ORIGIN, NORTH, staffShape(false, A))
    expect(arc.advance(0.01)).toBe(true)
    expect(arc.advance(5)).toBe(false)
  })

  it('fades out', () => {
    const arc = createStaffArc(ORIGIN, NORTH, staffShape(false, A))
    const first = meshes(arc)[0]
    if (!first) throw new Error('expected a mesh')
    const material = first.material
    if (Array.isArray(material)) throw new Error('expected one material')
    const start = material.opacity
    arc.advance(0.1)
    expect(material.opacity).toBeLessThan(start)
  })

  it('does not alias the position it was handed', () => {
    const at = ORIGIN.clone()
    createStaffArc(at, NORTH, staffShape(false, A))
    expect(at.toArray()).toEqual([0, 0, 0])
  })

  it('casts no shadow', () => {
    for (const m of meshes(createStaffArc(ORIGIN, NORTH, staffShape(false, A)))) {
      expect(m.userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes without throwing', () => {
    expect(() => createStaffArc(ORIGIN, NORTH, staffShape(false, A)).dispose()).not.toThrow()
  })
})
```

The containment maths in the second test depends on how you build the sector. `gust-cone.ts`
lays a `RingGeometry` in XY and rotates it `-PI/2` about X, with `thetaStart` offset so the
span centres on local `+Z`; if you follow that construction the `local` conversion above
holds. If you build it differently, adjust the conversion — but the assertion must stay a
comparison against `inCone`, not against your own geometry maths.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/fx/staff-arc-fx.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `src/fx/staff-arc-fx.ts`, following `src/fx/gust-cone.ts`'s construction closely: a
`RingGeometry` sector in a `Group` aimed along the flattened heading, `depthTest: false` so a
ground-level arc is not buried by a slope, `excludeFromShadows` on every mesh. Differences
from the cone: much shorter lifetime (`0.16`), a brighter and warmer tint so a staff sweep does
not read as bending, and it appears at full opacity and fades rather than travelling outward —
a swing is an instant, not a pulse of air.

Draw the sector at radius 1 and scale by `shape.range`, so the drawn radius comes from the
shape rather than being baked into the geometry — that is what makes the first test meaningful.

- [ ] **Step 4: Wire it in**

In `src/main.ts`, when the staff reports a swing this frame, add the effect using the same
shape the fight resolved with:

```ts
    if (swing) {
      effects.add(createStaffArc(
        player.position, player.forward, staffShape(swing.finisher, fightConfig.staffArc),
      ))
    }
```

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
git add src/fx/staff-arc-fx.ts src/fx/staff-arc-fx.test.ts src/main.ts
git commit -m "Draw the staff arc at its true reach"
```

---

### Task 8: The staff sweeps

**Files:**
- Modify: `src/player/glider.ts`, `src/player/glider.test.ts`, `src/main.ts`

**Interfaces:**
- Produces: `createGlider().update(dt: number, deployed: boolean, swing: number | null): void` — `swing` is 0-to-1 progress through the active swing, or null when not swinging.

- [ ] **Step 1: Write the failing tests**

Add to `src/player/glider.test.ts` (read it first for its existing helpers):

```ts
describe('the staff sweeping through a swing', () => {
  it('moves the staff while a swing is in progress', () => {
    const a = createGlider()
    a.update(1 / 60, false, 0)
    const start = a.object.rotation.y
    const b = createGlider()
    b.update(1 / 60, false, 0.5)
    expect(b.object.rotation.y).not.toBeCloseTo(start, 4)
  })

  it('leaves the stowed pose alone when not swinging', () => {
    // Regression guard: the sweep composes onto the pose this module already owns, so a
    // null swing has to leave that pose exactly as it was before the argument existed.
    const stowed = createGlider()
    stowed.update(1 / 60, false, null)
    const reference = createGlider()
    reference.update(1 / 60, false, null)
    expect(stowed.object.rotation.y).toBeCloseTo(reference.object.rotation.y, 6)
    expect(stowed.object.position.toArray()).toEqual(reference.object.position.toArray())
  })

  it('returns to the stowed pose once the swing ends', () => {
    const g = createGlider()
    g.update(1 / 60, false, null)
    const rest = g.object.rotation.y
    g.update(1 / 60, false, 0.5)
    expect(g.object.rotation.y).not.toBeCloseTo(rest, 4)
    g.update(1 / 60, false, null)
    expect(g.object.rotation.y).toBeCloseTo(rest, 6)
  })

  it('ignores a swing while deployed, where the staff is a wing', () => {
    const g = createGlider()
    for (let t = 0; t < 1; t += 1 / 60) g.update(1 / 60, true, null)
    const deployed = g.object.rotation.y
    g.update(1 / 60, true, 0.5)
    expect(g.object.rotation.y).toBeCloseTo(deployed, 6)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/player/glider.test.ts
```

Expected: FAIL — `update` takes two arguments.

- [ ] **Step 3: Implement**

In `src/player/glider.ts`, hold the swing in a module-level variable that `update` sets and
`apply` reads. It must compose **inside** `apply`, after the stow/deploy lerp writes
`object.rotation`, because that write happens every frame and would overwrite anything an
outside caller set:

```ts
/** How far the staff sweeps through a swing, radians either side of the stowed pose. */
const SWEEP_ARC = MathUtils.degToRad(150)
```

In `apply`, after the existing `object.rotation.set(...)`:

```ts
    // The sweep composes onto the stowed pose rather than replacing it, and only while
    // stowed: a deployed glider is a wing and has nothing to swing with. `openness` gates
    // it rather than the `deployed` flag so a glider still folding away does not twitch.
    if (swing !== null && openness < 1e-3) {
      object.rotation.y += MathUtils.lerp(-SWEEP_ARC / 2, SWEEP_ARC / 2, swing)
    }
```

and `update` becomes:

```ts
    update(dt: number, deployed: boolean, swingProgress: number | null): void {
      openness = advanceOpenness(openness, deployed, dt, OPEN_SECONDS)
      swing = swingProgress
      apply()
    },
```

The tell is deliberately modest — the arc effect from Task 7 is what makes the swing readable,
and this is what stops the character standing perfectly still while it happens.

- [ ] **Step 4: Wire it in**

In `src/main.ts`, pass the progress through the active swing. It comes from the staff state:
`staffElapsed` over `swingSeconds`, clamped, or null when `staffElapsed` is null. Alternating
the direction per swing index is optional polish — if you do it, take the index from the state,
not from a second counter.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
npx vite build
git add src/player/glider.ts src/player/glider.test.ts src/main.ts
git commit -m "Sweep the staff through a swing"
```

---

### Task 9: Document the staff

**Files:**
- Modify: `src/ui/guide/actions.ts`, `README.md`, `src/main.ts`
- Test: the existing drift test in `src/ui/guide/actions.test.ts`

- [ ] **Step 1: Read the drift test first**

```bash
npx vitest run src/ui/guide
```

`src/ui/guide/actions.test.ts` binds `ACTIONS`'s keys to the README's controls table in both
directions, and `readmeKeys()` parses that table. Read both before editing either file. Note
that the existing `Mouse` row is bare while every other key is in backticks, and the parser
strips backticks when present — so `Mouse left` works in either style as long as the two files
agree.

- [ ] **Step 2: Add the staff to the catalogue**

`ActionContext` gains nothing: the staff's state is on `PlayerState`, so availability calls the
real predicate directly, the way the dash calls `canDash`:

```ts
  {
    key: 'Mouse left', name: 'Staff combo', mode: 'ground',
    // staffBusy is the same predicate the controller gates the glider on, so the panel
    // cannot claim the staff is free while the fight disagrees.
    available: (ctx) => ctx.player.mode === 'ground' && !staffBusy(staffOf(ctx.player)),
    detail: 'Up to three swings, each a wide horizontal arc that hits everyone in front of '
      + 'you rather than one enemy hard. The third sweeps wider and shoves harder. Keep '
      + 'swinging inside the window to continue the combo. While the staff is swinging it '
      + 'is not a glider, so you cannot deploy until it is done — that is the price.',
  },
```

Also update the **"Deploy the glider"** row so the panel reflects the gate: its `available`
gains `&& !staffBusy(staffOf(ctx.player))`.

- [ ] **Step 3: Add the README row and verify the drift test**

Add a `Mouse left` row to the controls table, spelled exactly as the catalogue spells it.

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
```

Expected: green, including the drift test.

- [ ] **Step 4: Commit**

```bash
git add src/ui/guide/actions.ts README.md src/main.ts
git commit -m "Document the staff combo in the guide and README"
```

---

### Task 10: See it work, and write it down

**This task is for the controller, not a subagent.** It needs the browser preview and its
screenshots go to a human.

- [ ] **Step 1: Verify in the running game**

Tests cannot tell you whether a 0.26s swing feels snappy, whether a 164-degree arc reads as
wide, or whether the commitment is fun rather than annoying. Start the preview and play it.

The preview pane reports `document.visibilityState === 'hidden'`, so `requestAnimationFrame`
is suspended and the game looks frozen. Drive it with a synthetic clock — the technique is
under "The preview pane's animation loop" in `docs/HANDOFF.md`. Install the hook, take one
screenshot so the loop re-registers through it, then drive frames. Note that Vite reloads the
page on every source edit and wipes the hook.

Confirm, by measurement where possible and by eye where not:

- A click swings, the arc effect appears at the reach the fight resolved with, and the staff
  visibly moves.
- Clicking three times in rhythm chains, and the third arc is visibly wider.
- Waiting too long between clicks restarts at swing one.
- Two or three soldiers in front all take damage from one swing.
- Mid-air: click, then press Space — the glider does **not** deploy. Wait for the staff to
  finish and it does. This is the feature; confirm it directly rather than trusting the test.
- The Focus meter rises as swings connect.

Record what you saw. If something is present but unreadable or unusable, say so rather than
reporting the geometry as correct — that failure has happened in this repo before, with the
gust cone, where every geometry test passed while nothing was visible on screen.

- [ ] **Step 2: Update the handoff**

Add the staff to `docs/HANDOFF.md` beside the other combat sections. Record the two facts a
future reader will otherwise rediscover the hard way: the glider *is* the staff, which is why
the gate is physical; and the model ships no attack clip, which is why the tell is an arc
effect plus a procedural sweep. Update the repo-state counts, and remove staff melee from the
"What has NOT been built" list. State plainly what was confirmed on screen and what was not.

---

## Self-Review

**Spec coverage.** Every section maps to a task: the cone extraction to Task 1; the combo, its
state and `DEFAULT_STAFF_CONFIG` to Task 2; the arc, its config and the no-lift rule to Task 3;
the fight's resolution and the separate hit list to Task 4; the player fields, the mouse edge,
the ground-only rule and the gate to Task 5; Focus to Task 6; the arc effect and its honesty
check to Task 7; the procedural sweep to Task 8; the guide and README to Task 9; the in-game
pass and the handoff to Task 10. The "Out of scope" list needs no task.

**Two places the plan deliberately refuses to decide for the implementer,** both flagged in
place rather than papered over: the fourth field the combo needs to time its continue window
(Task 2, step 3 — the sketch there is explicitly incomplete and says so), and how the started
swing leaves `controllerStep` (Task 5, step 3 — two shapes, a recommendation, and a
requirement to record the choice). Everything else is specified.

**Placeholders.** None, with the one exception above, which is labelled as a sketch and carries
instructions rather than pretending to be finished code.

**Type consistency.** Checked across tasks: `ConeShape`, `inCone`, `inGust`, `StaffConfig`,
`StaffState`, `StaffSwing`, `idleStaff`, `isSwinging`, `staffBusy`, `staffOf`, `stepStaff`,
`StaffArcConfig`, `staffShape`, `staffDamage`, `staffTargets`, `staffImpulse`,
`EncounterInput.staffSwing`, `EncounterStep.staffHitThisFrame`, `PlayerState.staffChain` /
`staffElapsed` / `staffRecovery`, `InputState.staffPressed`, `ControllerDeps.staff`,
`FocusEvents.staffConnects`, `FocusConfig.staffConnectGain`, `DEFAULT_STAFF_CONFIG`,
`createStaffArc`, and `update(dt, deployed, swing)` — each spelled identically everywhere.

**Test counts are deliberately not predicted.** Two earlier plans in this repo stated expected
totals, got them wrong, and one implementer nearly padded a test to match. Each task says
"green" instead.
