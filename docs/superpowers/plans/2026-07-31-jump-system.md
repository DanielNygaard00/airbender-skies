# Jump System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the mid-jump snap-back bug, add a double jump, and add a hold-to-charge high jump, per `docs/superpowers/specs/2026-07-31-jump-system-design.md`.

**Architecture:** A new pure module `src/player/jump.ts` owns the jump state machine (charge timer, air-jump count, tap-vs-hold). `groundStep` consumes its output; the controller routes airborne Space presses (double jump before glider deploy). The ground snap in `groundStep` becomes two regimes: distance snap while walking, contact-only landing while airborne.

**Tech Stack:** TypeScript (strict), three.js 0.185, Vitest 4. No new dependencies.

## Global Constraints

- All movement code is pure: never mutate the incoming `PlayerState` or `InputState`; return new objects (`state.position.clone()` pattern used throughout).
- Tests are colocated: `src/<area>/<file>.test.ts`, written with Vitest `describe`/`it`/`expect`.
- Run tests with `npm test` (whole suite) or `npx vitest run src/player/jump.test.ts` (one file). Type-check with `npm run typecheck`. Vitest does not type-check, so run both at every gate.
- Movement code never sees key codes; keys map to intent in `src/core/input.ts` only.
- Commit messages: plain descriptive sentences, matching repo history (e.g. "Fix inverted fore-aft glider constants and add signed regression tests").
- Comments only where the code cannot say it (see existing style in `ground-move.ts`).

---

### Task 1: Snap-back bug fix in groundStep

The snap in `groundStep` fires from up to `snapDistance` (1.2 m) away whenever the character descends. A normal jump apex is only ~2 m, so the descent visibly teleports to the ground. Gate the distance snap on having been grounded the previous frame; airborne bodies land only on contact.

**Files:**
- Modify: `src/player/ground-move.ts:38-50`
- Test: `src/player/ground-move.test.ts`

**Interfaces:**
- Consumes: existing `groundStep(state, input, dt, terrain, c)` — signature unchanged.
- Produces: nothing new; behavior change only.

- [ ] **Step 1: Write the failing regression tests**

Add to the `groundStep` describe block in `src/player/ground-move.test.ts`:

```ts
  it('a jump reaches its full ballistic apex with no early snap', () => {
    // Apex should be jumpSpeed^2 / (2*gravity) ≈ 2.0 m. The old snap-from-a-
    // distance behavior capped the visible arc roughly at apex - snapDistance.
    let s = groundStep(player(), input({ actionPressed: true }), 1 / 60, flatGround, G)
    let peak = 0
    for (let i = 0; i < 200; i++) {
      s = groundStep(s, input(), 1 / 60, flatGround, G)
      peak = Math.max(peak, s.position.y)
    }
    const expectedApex = (G.jumpSpeed * G.jumpSpeed) / (2 * G.gravity)
    expect(peak).toBeGreaterThan(expectedApex * 0.9)
    expect(s.grounded).toBe(true)
  })

  it('does not snap to the ground while descending mid-jump', () => {
    // Descending, 1.0 m above ground: inside the old 1.2 m snap distance.
    const midFall = player({
      position: new Vector3(0, 1.0, 0), grounded: false, velocity: new Vector3(0, -3, 0),
    })
    const s = groundStep(midFall, input(), 1 / 60, flatGround, G)
    expect(s.grounded).toBe(false)
    expect(s.position.y).toBeGreaterThan(0.5)
  })

  it('still snaps down small drops while walking', () => {
    // Walking (grounded) with ground 0.5 m below: slope-stick must survive.
    const step: TerrainQuery = {
      groundHeightAt: () => -0.5,
      raycastDown: (from, maxDistance) =>
        from.y >= -0.5 && from.y - maxDistance <= -0.5
          ? { point: new Vector3(from.x, -0.5, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
          : null,
    }
    const s = groundStep(player(), input({ forward: 1 }), 1 / 60, step, G)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(-0.5, 6)
  })

  it('an airborne body lands exactly on contact, not before', () => {
    // One frame at -20 m/s from 0.1 m up crosses the surface this frame.
    const aboutToLand = player({
      position: new Vector3(0, 0.1, 0), grounded: false, velocity: new Vector3(0, -20, 0),
    })
    const s = groundStep(aboutToLand, input(), 1 / 60, flatGround, G)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 6)
    expect(s.velocity.y).toBe(0)
  })
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/player/ground-move.test.ts`
Expected: "does not snap to the ground while descending mid-jump" FAILS — the old snap grabs the body from 1.2 m away. The other three may already pass (the apex test measures the peak, which the old code also reached before snapping the descent); they pin behavior that must survive the fix. Confirm the mid-descent test fails before proceeding.

- [ ] **Step 3: Gate the snap on prior groundedness**

In `src/player/ground-move.ts`, replace the snap block (lines 38–50):

```ts
  // Walking keeps a distance snap so slopes and small drops stick underfoot.
  // An airborne body must not be grabbed from a distance — that cancelled the
  // top of every jump — so it lands only when its feet actually reach ground.
  let grounded = false
  let lastGroundIslandId = state.lastGroundIslandId
  if (velocity.y <= 0) {
    const probe = position.clone().setY(position.y + c.eyeProbeHeight)
    const hit = terrain.raycastDown(probe, c.eyeProbeHeight + c.snapDistance)
    if (hit && (state.grounded || position.y <= hit.point.y)) {
      position.y = hit.point.y
      velocity.y = 0
      grounded = true
      lastGroundIslandId = hit.islandId
    }
  }
```

- [ ] **Step 4: Run the full ground-move suite**

Run: `npx vitest run src/player/ground-move.test.ts`
Expected: all PASS, including the pre-existing "a jump rises then returns to the ground".

- [ ] **Step 5: Full suite and type-check**

Run: `npm test && npm run typecheck`
Expected: PASS (controller landing tests exercise the kite path, which has its own raycast and is untouched).

- [ ] **Step 6: Commit**

```bash
git add src/player/ground-move.ts src/player/ground-move.test.ts
git commit -m "Fix mid-jump snap-back by landing airborne bodies on contact only"
```

---

### Task 2: Space held and released edges in input

**Files:**
- Modify: `src/core/types.ts:6-17` (InputState)
- Modify: `src/core/input.ts`
- Test: `src/core/input.test.ts`
- Modify: `src/player/ground-move.test.ts:17-20`, `src/player/controller.test.ts:28-31` (input factories gain the new fields)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `InputState.actionHeld: boolean`, `InputState.actionReleased: boolean`; `toInputState(held, lookDirection, actionPressed, actionReleased = false)`; `InputTracker.sample()` returns both edges and clears them.

- [ ] **Step 1: Write the failing tests**

Add to `src/core/input.test.ts`:

```ts
describe('action hold and release', () => {
  it('reports the space key as held', () => {
    expect(toInputState(new Set(['Space']), LOOK, false).actionHeld).toBe(true)
    expect(toInputState(new Set(), LOOK, false).actionHeld).toBe(false)
  })

  it('passes the release edge through and defaults it to false', () => {
    expect(toInputState(new Set(), LOOK, false, true).actionReleased).toBe(true)
    expect(toInputState(new Set(), LOOK, false).actionReleased).toBe(false)
  })
})
```

Note: vitest runs in the `node` environment (see `vitest.config.ts`), so `InputTracker`'s DOM event handling is not unit-tested here — same as today. The blur invariant ("held vanished without a release edge cancels the charge silently") is covered at the jump-module level by Task 4's test `'cancels silently when the hold vanishes without a release edge'`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/input.test.ts`
Expected: FAIL — `actionHeld` is `undefined`.

- [ ] **Step 3: Extend InputState and toInputState**

In `src/core/types.ts`, extend `InputState` after `actionPressed`:

```ts
  /** Space, edge-triggered: jump, deploy, or stow. */
  actionPressed: boolean
  /** Space currently held down. Drives jump charging. */
  actionHeld: boolean
  /** Space, edge-triggered on key-up: releases a charged jump. */
  actionReleased: boolean
```

In `src/core/input.ts`, extend `toInputState`:

```ts
export function toInputState(
  held: ReadonlySet<string>,
  lookDirection: Vector3,
  actionPressed: boolean,
  actionReleased = false,
): InputState {
  const axis = (pos: string, neg: string) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0)
  return {
    lookDirection: lookDirection.clone().normalize(),
    forward: axis('KeyW', 'KeyS'),
    strafe: axis('KeyD', 'KeyA'),
    sprint: held.has('ShiftLeft') || held.has('ShiftRight'),
    actionPressed,
    actionHeld: held.has('Space'),
    actionReleased,
  }
}
```

In `InputTracker`, add a release edge beside the press edge. The field:

```ts
  private actionPressed = false
  private actionReleased = false
```

The `keyup` handler (replaces the existing one-liner):

```ts
    on<KeyboardEvent>('keyup', (e) => {
      this.held.delete(e.code)
      if (e.code === 'Space') this.actionReleased = true
    })
```

The `blur` handler stays exactly as it is — it clears `held` (so `actionHeld` goes false) but must NOT set `actionReleased`; the jump module treats "held vanished without a release edge" as a silent charge cancel, so focus loss cannot fire a jump.

`sample()` passes and clears both edges:

```ts
  sample(): InputState {
    const state = toInputState(
      this.held,
      lookDirectionFrom(this.yaw, this.pitch),
      this.actionPressed,
      this.actionReleased,
    )
    this.actionPressed = false
    this.actionReleased = false
    return state
  }
```

- [ ] **Step 4: Fix the two test input factories**

The `input()` factories build complete `InputState` literals, so the new required fields must be added.

`src/player/ground-move.test.ts` and `src/player/controller.test.ts`, same change in both:

```ts
const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, actionPressed: false, actionHeld: false, actionReleased: false,
  ...over,
})
```

- [ ] **Step 5: Run suite and type-check**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/input.ts src/core/input.test.ts src/player/ground-move.test.ts src/player/controller.test.ts
git commit -m "Track space held state and key-up edge in input"
```

---

### Task 3: Jump fields on PlayerState and GroundConfig

Pure scaffolding for the jump machine: two state fields, six config knobs, and resets at every place a player state is created or lands.

**Files:**
- Modify: `src/core/types.ts` (PlayerState, GroundConfig)
- Modify: `src/core/config.ts` (defaults)
- Modify: `src/player/state.ts:31-40` (createPlayerState)
- Modify: `src/player/controller.ts` (respawn, safeRespawn fallback, kite-landing block, isFinitePlayer)
- Modify test factories: `src/player/ground-move.test.ts`, `src/player/controller.test.ts`, `src/player/state.test.ts`, `src/player/avatar-anim.test.ts`, `src/player/shrine-collect.test.ts`, `src/ui/hud.test.ts`
- Test: `src/player/state.test.ts`, `src/player/controller.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `PlayerState.airJumpsUsed: number`, `PlayerState.chargeTime: number`; `GroundConfig.maxAirJumps/airJumpSpeed/chargeThresholdSeconds/chargeMaxSeconds/chargedJumpSpeed/chargeWalkFactor`. Task 4 and 5 rely on these exact names.

- [ ] **Step 1: Write the failing tests**

In `src/player/state.test.ts`, add to the `createPlayerState` describe block. The file already defines `level`, `terrain(groundY)`, and `save(maxBreath)` fixtures at the top; use them exactly like the neighboring tests do:

```ts
  it('spawns with no air jumps used and no charge', () => {
    const state = createPlayerState(level, terrain(0), save(0), DEFAULT_FLIGHT_CONFIG)
    expect(state.airJumpsUsed).toBe(0)
    expect(state.chargeTime).toBe(0)
  })
```

In `src/player/controller.test.ts`, add:

```ts
describe('jump field resets', () => {
  it('respawn clears air jumps and charge', () => {
    const s = respawn(player({ airJumpsUsed: 1, chargeTime: 0.8 }), deps(voidWorld))
    expect(s.airJumpsUsed).toBe(0)
    expect(s.chargeTime).toBe(0)
  })

  it('landing the kite clears air jumps and charge', () => {
    const slow = player({
      mode: 'kite', position: new Vector3(0, 1, 0), grounded: false,
      velocity: new Vector3(0, -2, 0), airJumpsUsed: 1, chargeTime: 0.8,
    })
    const s = controllerStep(slow, input(), 1 / 60, deps(flatGround))
    expect(s.grounded).toBe(true)
    expect(s.airJumpsUsed).toBe(0)
    expect(s.chargeTime).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/player/state.test.ts src/player/controller.test.ts`
Expected: FAIL — the fields do not exist (`undefined` is not `0`).

- [ ] **Step 3: Add the fields and defaults**

`src/core/types.ts`, extend `PlayerState`:

```ts
  grounded: boolean
  lastGroundIslandId: string | null
  /** Air jumps spent since last standing on ground. */
  airJumpsUsed: number
  /** Seconds space has been held toward a charged jump. 0 = not charging. */
  chargeTime: number
```

`src/core/types.ts`, extend `GroundConfig`:

```ts
  /** Extra jumps available while airborne. */
  maxAirJumps: number
  /** Vertical speed set by an air jump. */
  airJumpSpeed: number
  /** Holds shorter than this are taps: a normal jump. */
  chargeThresholdSeconds: number
  /** Hold time at which the charge is full. */
  chargeMaxSeconds: number
  /** Vertical speed at full charge. */
  chargedJumpSpeed: number
  /** Movement speed multiplier while charging. */
  chargeWalkFactor: number
```

`src/core/config.ts`, extend `DEFAULT_GROUND_CONFIG`:

```ts
export const DEFAULT_GROUND_CONFIG: GroundConfig = {
  walkSpeed: 7,
  runSpeed: 13,
  jumpSpeed: 9,
  gravity: 20,
  snapDistance: 1.2,
  eyeProbeHeight: 2,
  maxAirJumps: 1,
  airJumpSpeed: 9,
  chargeThresholdSeconds: 0.2,
  chargeMaxSeconds: 1.5,
  chargedJumpSpeed: 20,
  chargeWalkFactor: 0.4,
}
```

- [ ] **Step 4: Reset the fields everywhere a state is created or lands**

`src/player/state.ts`, in the `createPlayerState` return:

```ts
    grounded: true,
    lastGroundIslandId: level.spawn.islandId,
    airJumpsUsed: 0,
    chargeTime: 0,
```

`src/player/controller.ts`:

1. `respawn` return gains `airJumpsUsed: 0, chargeTime: 0` (after `maxBreath`).
2. The hand-built fallback state in `safeRespawn` gains `airJumpsUsed: 0, chargeTime: 0`.
3. The kite-landing block (`if (hit) { ... }` inside the flying branch) gains `airJumpsUsed: 0, chargeTime: 0` beside `lastGroundIslandId: hit.islandId`.
4. `isFinitePlayer` adds both fields to its number list:

```ts
  const nums = [
    ...s.position.toArray(), ...s.velocity.toArray(), ...s.forward.toArray(),
    s.breath, s.maxBreath, s.airJumpsUsed, s.chargeTime,
  ]
```

- [ ] **Step 5: Fix every player factory**

Add `airJumpsUsed: 0, chargeTime: 0` before `...over` in the `player(...)`/`p(...)` state factories of all six test files:

- `src/player/ground-move.test.ts` (~line 21)
- `src/player/controller.test.ts` (~line 32)
- `src/player/state.test.ts` (only if it builds a `PlayerState` literal)
- `src/player/avatar-anim.test.ts` (~line 9)
- `src/player/shrine-collect.test.ts` (~line 11)
- `src/ui/hud.test.ts` (~line 9)

- [ ] **Step 6: Run suite and type-check**

Run: `npm test && npm run typecheck`
Expected: PASS. The type-check is the real gate here — it catches any `PlayerState` literal that was missed.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/config.ts src/player/state.ts src/player/controller.ts src/player/ground-move.test.ts src/player/controller.test.ts src/player/state.test.ts src/player/avatar-anim.test.ts src/player/shrine-collect.test.ts src/ui/hud.test.ts
git commit -m "Add air-jump and charge fields to player state and ground config"
```

---

### Task 4: The jump module

A pure state machine: tap fires a normal jump on release, a hold past the threshold charges toward a higher jump, an airborne press spends an air jump.

**Files:**
- Create: `src/player/jump.ts`
- Test: `src/player/jump.test.ts`

**Interfaces:**
- Consumes: `PlayerState.airJumpsUsed/chargeTime`, `InputState.actionPressed/actionHeld/actionReleased`, the six `GroundConfig` fields from Task 3.
- Produces (Task 5 and 6 rely on these exact signatures):

```ts
export interface JumpStep {
  chargeTime: number
  airJumpsUsed: number
  /** Vertical speed to set this frame, or null for no jump. */
  jumpVelocityY: number | null
  /** Horizontal speed multiplier: chargeWalkFactor while charging, else 1. */
  walkFactor: number
}
export function isCharging(chargeTime: number, c: GroundConfig): boolean
export function canAirJump(state: PlayerState, c: GroundConfig): boolean
export function stepJump(state: PlayerState, input: InputState, dt: number, c: GroundConfig): JumpStep
```

- [ ] **Step 1: Write the failing tests**

Create `src/player/jump.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { stepJump, canAirJump, isCharging } from './jump'
import { DEFAULT_GROUND_CONFIG as G } from '../core/config'
import type { InputState, PlayerState } from '../core/types'

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, actionPressed: false, actionHeld: false, actionReleased: false,
  ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', airJumpsUsed: 0, chargeTime: 0,
  ...over,
})
const DT = 1 / 60

/** Hold space for `seconds`, starting from a fresh press, then release. */
function holdAndRelease(seconds: number) {
  let s = player()
  let j = stepJump(s, input({ actionPressed: true, actionHeld: true }), DT, G)
  for (let t = DT; t < seconds; t += DT) {
    s = { ...s, chargeTime: j.chargeTime, airJumpsUsed: j.airJumpsUsed }
    j = stepJump(s, input({ actionHeld: true }), DT, G)
  }
  s = { ...s, chargeTime: j.chargeTime, airJumpsUsed: j.airJumpsUsed }
  return stepJump(s, input({ actionReleased: true }), DT, G)
}

describe('tap jump', () => {
  it('a quick tap fires a normal jump on release', () => {
    const j = holdAndRelease(2 * DT)
    expect(j.jumpVelocityY).toBe(G.jumpSpeed)
    expect(j.chargeTime).toBe(0)
  })

  it('press-and-release on the same frame still jumps', () => {
    const j = stepJump(
      player(), input({ actionPressed: true, actionReleased: true }), DT, G,
    )
    expect(j.jumpVelocityY).toBe(G.jumpSpeed)
  })

  it('holding below the threshold does not slow walking', () => {
    const j = stepJump(
      player({ chargeTime: G.chargeThresholdSeconds / 2 }), input({ actionHeld: true }), DT, G,
    )
    expect(j.walkFactor).toBe(1)
  })
})

describe('charged jump', () => {
  it('a full charge fires at chargedJumpSpeed', () => {
    const j = holdAndRelease(G.chargeMaxSeconds + 0.2)
    expect(j.jumpVelocityY).toBeCloseTo(G.chargedJumpSpeed, 5)
  })

  it('a partial charge lands between normal and full speed', () => {
    const j = holdAndRelease(G.chargeMaxSeconds / 2)
    expect(j.jumpVelocityY!).toBeGreaterThan(G.jumpSpeed)
    expect(j.jumpVelocityY!).toBeLessThan(G.chargedJumpSpeed)
  })

  it('slows walking while charging', () => {
    const j = stepJump(
      player({ chargeTime: G.chargeThresholdSeconds + 0.1 }), input({ actionHeld: true }), DT, G,
    )
    expect(j.walkFactor).toBe(G.chargeWalkFactor)
  })

  it('charging accumulates time while held', () => {
    const j = stepJump(player({ chargeTime: 0.5 }), input({ actionHeld: true }), DT, G)
    expect(j.chargeTime).toBeCloseTo(0.5 + DT, 6)
    expect(j.jumpVelocityY).toBeNull()
  })

  it('a held key without a fresh grounded press never starts a charge', () => {
    // E.g. space still held from before a glider landing: chargeTime is 0.
    const j = stepJump(player(), input({ actionHeld: true }), DT, G)
    expect(j.chargeTime).toBe(0)
    const release = stepJump(player(), input({ actionReleased: true }), DT, G)
    expect(release.jumpVelocityY).toBeNull()
  })

  it('cancels silently when the hold vanishes without a release edge', () => {
    // Window blur clears held keys without a key-up event.
    const j = stepJump(player({ chargeTime: 0.8 }), input(), DT, G)
    expect(j.chargeTime).toBe(0)
    expect(j.jumpVelocityY).toBeNull()
  })

  it('cancels when the ground is lost mid-charge', () => {
    const j = stepJump(
      player({ chargeTime: 0.8, grounded: false }), input({ actionHeld: true }), DT, G,
    )
    expect(j.chargeTime).toBe(0)
    expect(j.jumpVelocityY).toBeNull()
  })
})

describe('air jump', () => {
  it('an airborne press with jumps in reserve fires an air jump', () => {
    const j = stepJump(
      player({ grounded: false }), input({ actionPressed: true, actionHeld: true }), DT, G,
    )
    expect(j.jumpVelocityY).toBe(G.airJumpSpeed)
    expect(j.airJumpsUsed).toBe(1)
  })

  it('an exhausted air jump does not fire again', () => {
    const j = stepJump(
      player({ grounded: false, airJumpsUsed: G.maxAirJumps }),
      input({ actionPressed: true, actionHeld: true }), DT, G,
    )
    expect(j.jumpVelocityY).toBeNull()
    expect(j.airJumpsUsed).toBe(G.maxAirJumps)
  })

  it('canAirJump reflects the reserve and groundedness', () => {
    expect(canAirJump(player({ grounded: false }), G)).toBe(true)
    expect(canAirJump(player({ grounded: false, airJumpsUsed: G.maxAirJumps }), G)).toBe(false)
    expect(canAirJump(player(), G)).toBe(false)
  })
})

describe('isCharging', () => {
  it('is true only at or past the threshold', () => {
    expect(isCharging(0, G)).toBe(false)
    expect(isCharging(G.chargeThresholdSeconds, G)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/player/jump.test.ts`
Expected: FAIL — module `./jump` does not exist.

- [ ] **Step 3: Implement the module**

Create `src/player/jump.ts`:

```ts
import type { GroundConfig, InputState, PlayerState } from '../core/types'

/** Result of one frame of jump logic. Consumed by groundStep. */
export interface JumpStep {
  chargeTime: number
  airJumpsUsed: number
  /** Vertical speed to set this frame, or null for no jump. */
  jumpVelocityY: number | null
  /** Horizontal speed multiplier: chargeWalkFactor while charging, else 1. */
  walkFactor: number
}

/** Holds shorter than the threshold are taps; from the threshold on, a charge. */
export function isCharging(chargeTime: number, c: GroundConfig): boolean {
  return chargeTime >= c.chargeThresholdSeconds
}

export function canAirJump(state: PlayerState, c: GroundConfig): boolean {
  return !state.grounded && state.airJumpsUsed < c.maxAirJumps
}

function releaseSpeed(chargeTime: number, c: GroundConfig): number {
  if (!isCharging(chargeTime, c)) return c.jumpSpeed
  const t = Math.min(chargeTime, c.chargeMaxSeconds) / c.chargeMaxSeconds
  return c.jumpSpeed + (c.chargedJumpSpeed - c.jumpSpeed) * t
}

export function stepJump(
  state: PlayerState,
  input: InputState,
  dt: number,
  c: GroundConfig,
): JumpStep {
  if (!state.grounded) {
    // A charge cannot survive leaving the ground; a press may spend an air jump.
    if (input.actionPressed && state.airJumpsUsed < c.maxAirJumps) {
      return {
        chargeTime: 0,
        airJumpsUsed: state.airJumpsUsed + 1,
        jumpVelocityY: c.airJumpSpeed,
        walkFactor: 1,
      }
    }
    return { chargeTime: 0, airJumpsUsed: state.airJumpsUsed, jumpVelocityY: null, walkFactor: 1 }
  }

  // A hold is tracked only from a fresh grounded press, so a key carried over
  // from before a landing cannot start a charge.
  let chargeTime = state.chargeTime
  if (input.actionPressed) chargeTime = dt
  else if (chargeTime > 0 && input.actionHeld) chargeTime += dt
  else if (!input.actionReleased) chargeTime = 0

  if (input.actionReleased && chargeTime > 0) {
    return {
      chargeTime: 0,
      airJumpsUsed: state.airJumpsUsed,
      jumpVelocityY: releaseSpeed(chargeTime, c),
      walkFactor: 1,
    }
  }

  return {
    chargeTime,
    airJumpsUsed: state.airJumpsUsed,
    jumpVelocityY: null,
    walkFactor: isCharging(chargeTime, c) ? c.chargeWalkFactor : 1,
  }
}
```

Note on the release branch: `chargeTime > 0` requires a tracked hold, so a bare release edge (carried-over key) fires nothing. The same-frame press-and-release case works because the press sets `chargeTime = dt` before the release check.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/player/jump.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Full suite and type-check**

Run: `npm test && npm run typecheck`
Expected: PASS (nothing else consumes the module yet).

- [ ] **Step 6: Commit**

```bash
git add src/player/jump.ts src/player/jump.test.ts
git commit -m "Add pure jump state machine with tap, charge, and air jumps"
```

---

### Task 5: Wire the jump machine into groundStep

`groundStep` swaps its inline press-to-jump for `stepJump` output. Two pre-existing tests change meaning: a normal jump is now fired by release (bounded by the 0.2 s tap threshold), and an airborne press with reserve now double-jumps.

**Files:**
- Modify: `src/player/ground-move.ts`
- Test: `src/player/ground-move.test.ts`

**Interfaces:**
- Consumes: `stepJump` from Task 4 (exact signature above); state/config fields from Task 3.
- Produces: `groundStep` signature unchanged, but jumps now trigger on `actionReleased` (tap or charged) or on `actionPressed` while airborne with reserve. Task 6's controller relies on `groundStep` performing the air jump itself.

- [ ] **Step 1: Update the two obsolete tests and add new ones**

In `src/player/ground-move.test.ts`, replace the test `'jumps when the action is pressed while grounded'` with:

```ts
  it('jumps on release of a quick tap', () => {
    const tapped = groundStep(
      player(), input({ actionPressed: true, actionReleased: true }), 1 / 60, flatGround, G,
    )
    expect(tapped.velocity.y).toBe(G.jumpSpeed)
  })
```

Replace the test `'cannot jump while airborne'` with:

```ts
  it('cannot jump while airborne once air jumps are spent', () => {
    const airborne = player({
      position: new Vector3(0, 50, 0), grounded: false, airJumpsUsed: G.maxAirJumps,
    })
    expect(groundStep(airborne, input({ actionPressed: true }), 1 / 60, voidWorld, G).velocity.y)
      .toBeLessThan(0)
  })
```

In the pre-existing test `'a jump rises then returns to the ground'`, change the first line to fire the jump the new way:

```ts
    let s = groundStep(
      player(), input({ actionPressed: true, actionReleased: true }), 1 / 60, flatGround, G,
    )
```

Do the same one-line change in the Task 1 test `'a jump reaches its full ballistic apex with no early snap'`.

Then add:

```ts
  it('an airborne press with reserve fires a double jump', () => {
    const falling = player({
      position: new Vector3(0, 50, 0), grounded: false, velocity: new Vector3(0, -10, 0),
    })
    const s = groundStep(falling, input({ actionPressed: true }), 1 / 60, voidWorld, G)
    expect(s.velocity.y).toBe(G.airJumpSpeed)
    expect(s.airJumpsUsed).toBe(1)
  })

  it('a charged release jumps higher than a tap', () => {
    const charged = player({ chargeTime: G.chargeMaxSeconds })
    const s = groundStep(charged, input({ actionReleased: true }), 1 / 60, flatGround, G)
    expect(s.velocity.y).toBeGreaterThan(G.jumpSpeed)
  })

  it('walking is slowed while charging', () => {
    const charging = player({ chargeTime: G.chargeThresholdSeconds + 0.1 })
    const s = groundStep(
      charging, input({ forward: 1, actionHeld: true }), 1 / 60, flatGround, G,
    )
    const speed = Math.hypot(s.velocity.x, s.velocity.z)
    expect(speed).toBeCloseTo(G.walkSpeed * G.chargeWalkFactor, 5)
  })

  it('landing resets the air jump reserve', () => {
    const aboutToLand = player({
      position: new Vector3(0, 0.05, 0), grounded: false,
      velocity: new Vector3(0, -10, 0), airJumpsUsed: 1,
    })
    const s = groundStep(aboutToLand, input(), 1 / 60, flatGround, G)
    expect(s.grounded).toBe(true)
    expect(s.airJumpsUsed).toBe(0)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/player/ground-move.test.ts`
Expected: the new and updated tests FAIL (`groundStep` still jumps on press and ignores the jump fields).

- [ ] **Step 3: Rewire groundStep**

In `src/player/ground-move.ts`, add the import:

```ts
import { stepJump } from './jump'
```

Replace the body of `groundStep` up to (not including) the snap block:

```ts
  const jump = stepJump(state, input, dt, c)
  const horizontal = desiredVelocity(input, c).multiplyScalar(jump.walkFactor)
  const velocityY = jump.jumpVelocityY !== null
    ? jump.jumpVelocityY
    : state.velocity.y - c.gravity * dt

  const velocity = new Vector3(horizontal.x, velocityY, horizontal.z)
  const position = state.position.clone().addScaledVector(velocity, dt)
```

And extend the return object (the snap block from Task 1 is unchanged):

```ts
  return {
    ...state, position, velocity,
    forward: state.forward.clone(), grounded, lastGroundIslandId,
    chargeTime: jump.chargeTime,
    airJumpsUsed: grounded ? 0 : jump.airJumpsUsed,
  }
```

(`grounded ? 0` covers both staying on ground and fresh landings; the air branch of `stepJump` already returns `chargeTime: 0`, so a fresh landing cannot carry a charge.)

- [ ] **Step 4: Run the ground-move suite**

Run: `npx vitest run src/player/ground-move.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and type-check**

Run: `npm test && npm run typecheck`
Expected: PASS. The controller still short-circuits every airborne press to a kite deploy, so its tests are unaffected until Task 6 changes that routing.

- [ ] **Step 6: Commit**

```bash
git add src/player/ground-move.ts src/player/ground-move.test.ts
git commit -m "Drive ground jumps through the jump state machine"
```

---

### Task 6: Controller routing — double jump before glider deploy

The Space escalation chain: jump → double jump → glider. The controller deploys the kite on an airborne press only when the air-jump reserve is spent.

**Files:**
- Modify: `src/player/controller.ts:82-95`
- Test: `src/player/controller.test.ts`

**Interfaces:**
- Consumes: `canAirJump(state, c)` from Task 4; `groundStep`'s air-jump handling from Task 5.
- Produces: final controller behavior; no new exports.

- [ ] **Step 1: Update the obsolete deploy test and add chain tests**

In `src/player/controller.test.ts`, replace `'pressing action mid-fall deploys the kite'` with:

```ts
  it('pressing action mid-fall with the air jump spent deploys the kite', () => {
    const falling = player({
      position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, -12, 0), airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    })
    expect(controllerStep(falling, input({ actionPressed: true }), 1 / 60, deps(voidWorld)).mode)
      .toBe('kite')
  })
```

In `'deploying points the kite where the player is looking'`, add `airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps` to the `falling` state the same way, so it still exercises the deploy path.

Then add:

```ts
describe('the space escalation chain', () => {
  it('the first airborne press double jumps instead of deploying', () => {
    const falling = player({
      position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3(0, -12, 0),
    })
    const s = controllerStep(falling, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
    expect(s.mode).toBe('ground')
    expect(s.velocity.y).toBe(DEFAULT_GROUND_CONFIG.airJumpSpeed)
    expect(s.airJumpsUsed).toBe(1)
  })

  it('the second airborne press deploys the kite', () => {
    const falling = player({
      position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3(0, -12, 0),
    })
    const afterDouble = controllerStep(
      falling, input({ actionPressed: true }), 1 / 60, deps(voidWorld),
    )
    const s = controllerStep(afterDouble, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
    expect(s.mode).toBe('kite')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/player/controller.test.ts`
Expected: the chain tests FAIL (first press deploys the kite today).

- [ ] **Step 3: Gate the deploy on an empty reserve**

In `src/player/controller.ts`, add the import:

```ts
import { canAirJump } from './jump'
```

Change the ground-mode branch condition:

```ts
  if (state.mode === 'ground') {
    if (input.actionPressed && !state.grounded && !canAirJump(state, deps.ground)) {
      // Deploy the kite mid-fall — but only once the air jump is spent.
      // Grounded presses charge or jump; airborne presses with reserve
      // double-jump. Both are handled by groundStep.
```

The rest of the branch is unchanged: presses with reserve fall through to `groundStep`, which performs the double jump.

- [ ] **Step 4: Run the controller suite, then everything**

Run: `npx vitest run src/player/controller.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/player/controller.ts src/player/controller.test.ts
git commit -m "Route airborne presses to a double jump before deploying the kite"
```

---

### Task 7: Charge crouch feedback

A vertical squash on the avatar proportional to charge. Pure scale computation in `avatar-anim.ts`, applied in `main.ts`.

**Files:**
- Modify: `src/player/avatar-anim.ts`
- Modify: `src/main.ts:123-124`
- Test: `src/player/avatar-anim.test.ts`

**Interfaces:**
- Consumes: `PlayerState.chargeTime`, `isCharging` from Task 4, `GroundConfig.chargeMaxSeconds`.
- Produces: `chargeSquashScale(state: PlayerState, c: GroundConfig): number` — 1 when not charging, easing down to 0.7 at full charge.

- [ ] **Step 1: Write the failing tests**

Add to `src/player/avatar-anim.test.ts` (import `chargeSquashScale` beside `animationFor`, and `DEFAULT_GROUND_CONFIG as G` from `'../core/config'`):

```ts
describe('chargeSquashScale', () => {
  it('stands at full height when not charging', () => {
    expect(chargeSquashScale(p(), G)).toBe(1)
  })

  it('is below the threshold not squashed at all', () => {
    expect(chargeSquashScale(p({ chargeTime: G.chargeThresholdSeconds / 2 }), G)).toBe(1)
  })

  it('squashes to 0.7 at full charge', () => {
    expect(chargeSquashScale(p({ chargeTime: G.chargeMaxSeconds }), G)).toBeCloseTo(0.7, 6)
  })

  it('squashes partially mid-charge', () => {
    const s = chargeSquashScale(p({ chargeTime: G.chargeMaxSeconds / 2 }), G)
    expect(s).toBeLessThan(1)
    expect(s).toBeGreaterThan(0.7)
  })

  it('never squashes in the air', () => {
    expect(chargeSquashScale(p({ grounded: false, chargeTime: 1 }), G)).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/player/avatar-anim.test.ts`
Expected: FAIL — `chargeSquashScale` is not exported.

- [ ] **Step 3: Implement the scale**

In `src/player/avatar-anim.ts`:

```ts
import type { GroundConfig, PlayerState } from '../core/types'
import { isCharging } from './jump'

const FULL_CHARGE_SQUASH = 0.7

/** Vertical crouch while charging a jump. 1 = full height. */
export function chargeSquashScale(state: PlayerState, c: GroundConfig): number {
  if (!state.grounded || !isCharging(state.chargeTime, c)) return 1
  const t = Math.min(state.chargeTime, c.chargeMaxSeconds) / c.chargeMaxSeconds
  return 1 - (1 - FULL_CHARGE_SQUASH) * t
}
```

(The existing `import type { PlayerState }` line is replaced by the wider one above.)

- [ ] **Step 4: Apply it in main.ts**

In `src/main.ts`, import `chargeSquashScale` beside `animationFor`:

```ts
import { animationFor, chargeSquashScale } from './player/avatar-anim'
```

And after `avatar.setAnimation(animationFor(player))` (before `avatar.update(dt)`):

```ts
    avatar.object.scale.y = chargeSquashScale(player, DEFAULT_GROUND_CONFIG)
```

- [ ] **Step 5: Run suite and type-check**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/player/avatar-anim.ts src/player/avatar-anim.test.ts src/main.ts
git commit -m "Crouch the avatar while a jump charges"
```

---

### Task 8: End-to-end verification

**Files:**
- No new code. Modify only if verification finds a defect.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified feature.

- [ ] **Step 1: Full suite, type-check, build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 2: Manual verification in the running game**

Use the superpowers:verification-before-completion skill. Start the dev server (`npm run dev`) and verify in the browser:

1. Tap Space on an island: a snappy normal jump with a full visible arc — no teleport back to ground on the way down.
2. Tap Space, then tap again mid-air: a double jump. A third press deploys the glider.
3. Hold Space ~1.5 s on the ground: the avatar crouches, walking slows; release launches ~10 m up (about 5× the normal apex).
4. Hold Space, walk off the island edge while charging, release mid-air: no jump fires.
5. Land the glider, keep Space held from before the landing: no charge starts until a fresh press.

Report each check's outcome; fix and re-run on any failure.

- [ ] **Step 3: Final commit if anything changed**

```bash
git status
```

If verification required fixes, commit them with a message describing the defect found.
