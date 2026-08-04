# Render Interpolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the player, camera, and enemies at positions interpolated between fixed simulation steps, so movement renders smoothly on displays whose refresh rate does not match the 60 Hz simulation rate.

**Architecture:** The fixed-step simulation is untouched. `createStepper` passes `alpha` (the un-simulated fraction of a step) and `frameDt` (real elapsed seconds) to the render callback. A new `src/core/interpolation.ts` module owns prev/current snapshot pairs with a snap rule for teleports. `main.ts` splits its per-step visual code: `update()` keeps simulation and records snapshots; a new `syncVisuals(alpha, frameDt)` places the avatar, enemy views, and camera once per rendered frame.

**Tech Stack:** TypeScript (strict), three.js 0.185, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-04-render-interpolation-design.md`

## Global Constraints

- Simulation behaviour must not change: no edits to `update`'s simulation logic, only to where visuals are written.
- `alpha` is always in `[0, 1)`; default snap distance is exactly 20 (metres per step).
- All existing tests and both typecheck configs (`npm run typecheck`) must stay green after every task.
- Commit messages in normal prose, matching repo style (e.g. "Give enemies gravity and a ground snap"), ending with the Claude co-author line.
- Comments explain constraints, not narration — match the existing house style.

---

### Task 1: Alpha and frameDt through the render callback

**Files:**
- Modify: `src/core/loop.ts`
- Test: `src/core/loop.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `LoopCallbacks.render(alpha: number, frameDt: number): void` — `alpha = accumulator / fixedDt` after stepping, in `[0, 1)`; `frameDt` = the raw `elapsed` seconds passed to `advance`, or `0` on the invalid-elapsed path. Task 3 wires `syncVisuals` to this signature.

- [ ] **Step 1: Write the failing tests**

Replace the `spy` helper in `src/core/loop.test.ts` so it captures the new render arguments (existing tests keep passing — `renders()` becomes `alphas.length`):

```ts
function spy() {
  const dts: number[] = []
  const alphas: number[] = []
  const frameDts: number[] = []
  return {
    dts,
    alphas,
    frameDts,
    renders: () => alphas.length,
    cb: {
      update: (dt: number) => dts.push(dt),
      render: (alpha: number, frameDt: number) => {
        alphas.push(alpha)
        frameDts.push(frameDt)
      },
    },
  }
}
```

Append these tests inside the existing `describe('createStepper', ...)` block:

```ts
it('reports the un-simulated fraction of a step as alpha', () => {
  const s = spy()
  createStepper(s.cb).advance(FIXED_DT * 1.5)
  expect(s.alphas[0]).toBeCloseTo(0.5, 6)
})

it('grows alpha across zero-step frames', () => {
  const s = spy()
  const stepper = createStepper(s.cb)
  stepper.advance(FIXED_DT * 0.25)
  stepper.advance(FIXED_DT * 0.25)
  expect(s.alphas[0]).toBeCloseTo(0.25, 6)
  expect(s.alphas[1]).toBeCloseTo(0.5, 6)
})

it('keeps alpha in [0, 1) even after a clamped stall', () => {
  const s = spy()
  createStepper(s.cb).advance(30)
  expect(s.alphas[0]).toBeGreaterThanOrEqual(0)
  expect(s.alphas[0]).toBeLessThan(1)
})

it('passes the real elapsed seconds through as frameDt', () => {
  const s = spy()
  createStepper(s.cb).advance(0.021)
  expect(s.frameDts[0]).toBeCloseTo(0.021, 6)
})

it('renders an invalid delta with a frameDt of zero and alpha unchanged', () => {
  const s = spy()
  const stepper = createStepper(s.cb)
  stepper.advance(FIXED_DT * 0.5)
  stepper.advance(NaN)
  expect(s.frameDts[1]).toBe(0)
  expect(s.alphas[1]).toBeCloseTo(s.alphas[0], 6)
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/core/loop.test.ts`
Expected: the five new tests FAIL (alpha/frameDt are `undefined`); the nine existing tests PASS.

- [ ] **Step 3: Implement the callback change**

In `src/core/loop.ts`, change the interface:

```ts
export interface LoopCallbacks {
  update(dt: number): void
  /**
   * alpha is the fraction of the next step already elapsed but not yet
   * simulated, always in [0, 1); frameDt is the real elapsed seconds this
   * frame (0 when the delta was invalid). Together they let the renderer
   * draw between fixed steps instead of snapping to the last one.
   */
  render(alpha: number, frameDt: number): void
}
```

And the two render call sites inside `advance`:

```ts
advance(elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    callbacks.render(accumulator / fixedDt, 0)
    return 0
  }
  // Clamping here is what stops a backgrounded tab from discharging
  // thousands of steps the moment it regains focus.
  accumulator += Math.min(elapsed, fixedDt * MAX_STEPS_PER_FRAME)
  let steps = 0
  while (accumulator >= fixedDt && steps < MAX_STEPS_PER_FRAME) {
    callbacks.update(fixedDt)
    accumulator -= fixedDt
    steps++
  }
  callbacks.render(accumulator / fixedDt, elapsed)
  return steps
},
```

(The `[0, 1)` invariant holds without extra clamping: the accumulator enters `advance` below `fixedDt`, gains at most `MAX_STEPS_PER_FRAME × fixedDt`, and the loop drains up to `MAX_STEPS_PER_FRAME` steps, so it always exits below `fixedDt`.)

`src/main.ts` still compiles unchanged — its `render: () => renderer.render(scene, camera)` callback simply ignores the new arguments until Task 3.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/loop.test.ts`
Expected: all PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/core/loop.ts src/core/loop.test.ts
git commit -m "Pass interpolation alpha and frame time through the render callback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Interpolated vector snapshots

**Files:**
- Create: `src/core/interpolation.ts`
- Test: `src/core/interpolation.test.ts`

**Interfaces:**
- Consumes: `Vector3` from three.
- Produces (Task 3 relies on these exact names):

```ts
export const DEFAULT_SNAP_DISTANCE = 20
export interface InterpolatedVector {
  record(current: Vector3): void
  sample(alpha: number, out: Vector3): Vector3
  reset(): void
}
export function createInterpolatedVector(snapDistance?: number): InterpolatedVector
```

- [ ] **Step 1: Write the failing tests**

Create `src/core/interpolation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createInterpolatedVector, DEFAULT_SNAP_DISTANCE } from './interpolation'

describe('createInterpolatedVector', () => {
  it('samples midway between two recorded values', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(0, 0, 0))
    lerp.record(new Vector3(2, 4, 6))
    expect(lerp.sample(0.5, new Vector3()).toArray()).toEqual([1, 2, 3])
  })

  it('returns the previous value at alpha zero', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(1, 1, 1))
    lerp.record(new Vector3(2, 2, 2))
    expect(lerp.sample(0, new Vector3()).toArray()).toEqual([1, 1, 1])
  })

  it('returns the sole recorded value at any alpha before a second record', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(3, 2, 1))
    expect(lerp.sample(0.75, new Vector3()).toArray()).toEqual([3, 2, 1])
  })

  it('rolls current into previous on each record', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(1, 0, 0))
    lerp.record(new Vector3(2, 0, 0))
    lerp.record(new Vector3(3, 0, 0))
    expect(lerp.sample(0, new Vector3()).x).toBe(2)
  })

  it('snaps to current when a step jumps farther than the snap distance', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(0, 0, 0))
    lerp.record(new Vector3(0, 0, DEFAULT_SNAP_DISTANCE + 5))
    expect(lerp.sample(0.25, new Vector3()).z).toBe(DEFAULT_SNAP_DISTANCE + 5)
  })

  it('still blends just below the snap distance', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(0, 0, 0))
    lerp.record(new Vector3(0, 0, DEFAULT_SNAP_DISTANCE - 1))
    expect(lerp.sample(0.5, new Vector3()).z).toBeCloseTo((DEFAULT_SNAP_DISTANCE - 1) / 2, 6)
  })

  it('honours a custom snap distance', () => {
    const lerp = createInterpolatedVector(2)
    lerp.record(new Vector3(0, 0, 0))
    lerp.record(new Vector3(0, 0, 3))
    expect(lerp.sample(0.5, new Vector3()).z).toBe(3)
  })

  it('forgets the previous value on reset', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(1, 0, 0))
    lerp.record(new Vector3(5, 0, 0))
    lerp.reset()
    expect(lerp.sample(0, new Vector3()).x).toBe(5)
  })

  it('writes into and returns the out vector', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(1, 2, 3))
    const out = new Vector3()
    expect(lerp.sample(0.5, out)).toBe(out)
    expect(out.toArray()).toEqual([1, 2, 3])
  })

  it('does not hold a reference to the recorded vector', () => {
    const lerp = createInterpolatedVector()
    const value = new Vector3(1, 1, 1)
    lerp.record(value)
    value.set(9, 9, 9)
    expect(lerp.sample(1, new Vector3()).toArray()).toEqual([1, 1, 1])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/interpolation.test.ts`
Expected: FAIL — module `./interpolation` not found.

- [ ] **Step 3: Implement the module**

Create `src/core/interpolation.ts`:

```ts
import { Vector3 } from 'three'

/**
 * Beyond this many metres in one simulation step, the move was a teleport
 * (a respawn), not travel — 20 m per step is 1200 m/s, far past anything the
 * flight model or the air blast dash can produce — and blending through it
 * would streak the visual across the map for a frame.
 */
export const DEFAULT_SNAP_DISTANCE = 20

/**
 * A previous/current pair of one simulation-stepped vector, sampled between
 * steps by the renderer. Rendered frames outnumber simulation steps on
 * high-refresh displays; this is what lets them differ.
 */
export interface InterpolatedVector {
  /** Roll current into previous and store the new current. Copies, never holds. */
  record(current: Vector3): void
  /** Write previous.lerp(current, alpha) into out; snaps when the step jumped. */
  sample(alpha: number, out: Vector3): Vector3
  /** Forget the previous value, so the next sample returns current unblended. */
  reset(): void
}

export function createInterpolatedVector(
  snapDistance = DEFAULT_SNAP_DISTANCE,
): InterpolatedVector {
  const previous = new Vector3()
  const current = new Vector3()
  let primed = false
  const snapSq = snapDistance * snapDistance
  return {
    record(value: Vector3): void {
      if (primed) {
        previous.copy(current)
      } else {
        // Seed both ends, so sampling never blends from the origin-zero a
        // fresh Vector3 starts at.
        previous.copy(value)
        primed = true
      }
      current.copy(value)
      // A jump past the snap distance is a teleport; collapsing the pair here
      // keeps sample() branch-free and allocation-free.
      if (previous.distanceToSquared(current) > snapSq) previous.copy(current)
    },
    sample(alpha: number, out: Vector3): Vector3 {
      return out.copy(previous).lerp(current, alpha)
    },
    reset(): void {
      previous.copy(current)
    },
  }
}
```

(The snap collapses the pair at `record` time rather than branching in `sample`, so `sample` stays allocation- and branch-free on the hot path. Observable behaviour matches the spec: a sample after a teleport-sized jump returns current unblended.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/interpolation.test.ts`
Expected: all PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/core/interpolation.ts src/core/interpolation.test.ts
git commit -m "Add interpolated vector snapshots for rendering between fixed steps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Render the player, enemies, and camera at interpolated positions

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `render(alpha, frameDt)` from Task 1; `createInterpolatedVector`, `InterpolatedVector` from Task 2.
- Produces: nothing downstream — this is the final wiring. `main.ts` has no test file (it is DOM/WebGL glue); verification is the full suite, typecheck, and running the game.

- [ ] **Step 1: Add the interpolators and scratch vectors**

In `src/main.ts`, add to the import from `'three'` nothing new (Vector3 is already imported), and add:

```ts
import { createInterpolatedVector, type InterpolatedVector } from './core/interpolation'
```

Directly after `let cameraPosition = camera.position.clone()` insert:

```ts
// Rendered frames outnumber simulation steps on high-refresh displays. update()
// records each step's result into these; syncVisuals() draws between them.
const playerPositionLerp = createInterpolatedVector()
playerPositionLerp.record(player.position)
const playerForwardLerp = createInterpolatedVector()
playerForwardLerp.record(player.forward)
const enemyPositionLerps = new Map<string, InterpolatedVector>()
// The camera reads the look direction per rendered frame, but input is only
// sampled per simulation step; this carries the last sample across.
const lookDirection = new Vector3(0, 0, -1)
// Scratch for sample() so syncVisuals allocates nothing per frame.
const sampledPosition = new Vector3()
const sampledForward = new Vector3()
const sampledEnemy = new Vector3()
```

- [ ] **Step 2: Strip the per-step visual writes out of `update`**

In `update(dt)`:

Delete the avatar placement (keep `setAnimation`, `setSquash`, `followSun`, `avatar.update`, `glider.update`, `aura.update` where they are):

```ts
avatar.object.position.copy(player.position)
if (player.forward.lengthSq() > 1e-4) {
  avatar.object.lookAt(player.position.clone().add(player.forward))
}
```

Delete the whole camera block:

```ts
const profile = profileFor(player.mode)
const desired = pullInForTerrain(
  player.position,
  desiredCameraPosition(player.position, state.lookDirection, profile),
  world.terrain,
)
cameraPosition = smoothTowards(cameraPosition, desired, profile.smoothing, dt)

const airspeed = player.velocity.length()
camera.position.copy(cameraPosition)
camera.lookAt(player.position)
camera.fov = player.mode === 'glider' ? fovForSpeed(airspeed) : fovForSpeed(0)
camera.updateProjectionMatrix()
```

but keep `const airspeed = player.velocity.length()` — `wind.update` below still needs it. Add in its place:

```ts
lookDirection.copy(state.lookDirection)
const airspeed = player.velocity.length()
```

The enemy-view `sync` loop stays in `update` untouched — pose, tint, and health bar legitimately change at step rate; only travel judders.

At the very end of `update` (after the `hud.update` call), record the step's results:

```ts
playerPositionLerp.record(player.position)
playerForwardLerp.record(player.forward)
for (const enemy of encounter.enemies) {
  let lerp = enemyPositionLerps.get(enemy.id)
  if (!lerp) {
    lerp = createInterpolatedVector()
    enemyPositionLerps.set(enemy.id, lerp)
  }
  lerp.record(enemy.position)
}
```

- [ ] **Step 3: Add `syncVisuals` and wire the stepper**

After `update`, add:

```ts
/**
 * Runs once per rendered frame, not per simulation step. The hard split:
 * update() writes simulation state and records snapshots; only this function
 * touches the avatar transform, enemy-view positions, and the camera.
 */
function syncVisuals(alpha: number, frameDt: number): void {
  playerPositionLerp.sample(alpha, sampledPosition)
  playerForwardLerp.sample(alpha, sampledForward)
  avatar.object.position.copy(sampledPosition)
  if (sampledForward.lengthSq() > 1e-4) {
    avatar.object.lookAt(
      sampledPosition.x + sampledForward.x,
      sampledPosition.y + sampledForward.y,
      sampledPosition.z + sampledForward.z,
    )
  }

  for (const enemy of encounter.enemies) {
    const view = enemyViews.get(enemy.id)
    const lerp = enemyPositionLerps.get(enemy.id)
    if (view && lerp) view.object.position.copy(lerp.sample(alpha, sampledEnemy))
  }

  // smoothTowards is exponential decay, so feeding real frame time instead of
  // the fixed step changes nothing at 60 Hz and adds samples above it.
  const profile = profileFor(player.mode)
  const desired = pullInForTerrain(
    sampledPosition,
    desiredCameraPosition(sampledPosition, lookDirection, profile),
    world.terrain,
  )
  cameraPosition = smoothTowards(cameraPosition, desired, profile.smoothing, frameDt)
  camera.position.copy(cameraPosition)
  camera.lookAt(sampledPosition)
  camera.fov = player.mode === 'glider' ? fovForSpeed(player.velocity.length()) : fovForSpeed(0)
  camera.updateProjectionMatrix()
}
```

Replace the stepper construction:

```ts
const stepper = createStepper({
  update,
  render: (alpha, frameDt) => {
    syncVisuals(alpha, frameDt)
    renderer.render(scene, camera)
  },
})
```

The guide-open branch in `frame` keeps calling `renderer.render(scene, camera)` directly — the world holds its last drawn state behind the panel, exactly as today.

- [ ] **Step 4: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: everything green with no test churn outside the two files from Tasks 1–2.

- [ ] **Step 5: Run the game and verify no regression**

Run: `npm run dev`, play on the 60 Hz display: walk, glide, dash, gust the patrol, slam, respawn by diving off the world edge. Pass criterion from the spec: looks and plays identically to before — especially the respawn, which must not streak the avatar across the sky (the snap rule covers it), and the camera, which must feel unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "Render player, enemies, and camera between fixed simulation steps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
