# Glider Staff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the player a visible glider — a staff carried across the character's back that fans open into a wing overhead on deploy and folds away on stow.

**Architecture:** A single eased `openness` float, 0 stowed to 1 deployed, drives both the staff's transform and a folding fan of panels, so the two read as one motion and stowing is the same interpolation running backwards. The fan geometry and the easing are pure functions; the Three.js assembly around them is thin. Nothing in the flight model is touched.

**Tech Stack:** TypeScript 7, Three.js r185, vitest 4. Procedural geometry, no assets.

## Global Constraints

- Dependencies are pinned and installed: `three@0.185.1`, `@types/three@0.185.1`, `simplex-noise@4.0.3`, `typescript@7.0.2`, `vite@8.1.5`, `vitest@4.1.10`. Do not install, upgrade, or change any dependency.
- A `.npmrc` with `save-exact=true` is in place. Leave it.
- TypeScript runs `strict` with `noEmit` and `noUncheckedIndexedAccess` ON.
- **Add no binary asset.** All geometry is built in code, consistent with the project's CC0-only rule and the precedent of the procedurally generated waterfall texture.
- No `Math.random()`.
- Pure functions must not mutate their arguments. Three.js `Vector3` methods mutate in place, so `.clone()` before modifying an input vector.
- **Do not modify `src/player/flight.ts`, `src/player/steering.ts`, `src/player/controller.ts`, `src/player/ground-move.ts`, `src/core/config.ts`, or `src/core/types.ts`.** Two Critical defects in the flight model were fixed immediately before this work, and the flight tests encode measured behaviour that a human tuning pass has not yet re-baselined. This feature is purely visual and has no business touching any of it.
- The suite currently stands at 298 tests across 25 files, typecheck clean, build succeeding. Every task must leave all 298 passing.

## Geometry Is Pre-Validated

The fan model and every constant below were prototyped and measured before this plan was written. **The prototype was exploration and has been discarded** — implementers write the tests first and implement fresh. What carries forward is the constants and this measured table, which the tests in Task 2 assert against:

| State | span (X) | height (Y) | depth (Z) | top of wing |
| --- | --- | --- | --- | --- |
| Stowed | 1.20 | 2.12 | 0.51 | y = 2.06 |
| Deployed | 2.42 | 0.24 | 1.19 | y = 2.19 |

Fore-aft depth grows 2.34×. Fully opening takes 18 frames at 60 fps, which is 0.30 s.

**Two errors the prototype caught, both of which become regression tests.** They are worth understanding before you start, because both produce a glider that is visibly wrong while every pure-math test still passes:

1. **A folding fan does not get longer when it opens — it gets wider.** Closed, a fan is a stick; open, it is a membrane. An early attempt gave each panel its own pivot spaced along the staff, each extending further outward, so "closed" laid them end-to-end and the stowed glider was *wider* than the deployed one (2.48 against 1.90). The fix is a single shared pivot per side, the way a real fan turns on its rivet. The test that catches this asserts fore-aft **depth** growth, not span growth.
2. **The staff must be laid along local X exactly once.** The cylinder's own axis is local Y, so the staff mesh is rotated a quarter turn about Z at build time. An early attempt *also* carried `z: Math.PI / 2` in the deployed rotation, left over from an earlier iteration. The two rotations compounded, standing the wing on its end and collapsing the deployed span to 0.09. The test that catches this asserts the deployed **height** is small — a near-horizontal wing.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/player/glider.ts` | The whole feature: fan easing and angles as pure functions, plus `createGlider()` which assembles and animates the meshes. |
| `src/player/glider.test.ts` | Tests for the pure functions. |
| `src/player/glider-mesh.test.ts` | Tests for the assembled object's geometry, which run headlessly because Three.js mesh construction needs no WebGL. |
| `src/main.ts` | Parents the glider under the avatar and updates it in the frame loop. Two small additions. |

`src/player/avatar.ts` is deliberately **not** touched. It owns the character model, the `AnimationMixer`, and the delicate placeholder-to-real-model swap in `attachModel`. The glider is a different concern and lives in its own module.

---

### Task 1: Fan easing and angles

The pure half of the feature. Both functions are frame-rate independent and clamped, so a long session or a stalled frame cannot drive the fan out of range or into NaN.

**Files:**
- Create: `src/player/glider.ts`
- Test: `src/player/glider.test.ts`

**Interfaces:**
- Consumes: `MathUtils` from `three`. Nothing from earlier work.
- Produces:
  - `OPEN_SECONDS = 0.3`, `PANELS_PER_SIDE = 4`, `FAN_SPREAD` (78° in radians)
  - `advanceOpenness(current: number, deployed: boolean, dt: number, seconds: number): number`
  - `easeOpenness(openness: number): number` — smoothstep
  - `panelAngle(index: number, count: number, openness: number, spread: number): number`

- [ ] **Step 1: Write the failing tests**

`src/player/glider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  advanceOpenness, easeOpenness, panelAngle,
  OPEN_SECONDS, PANELS_PER_SIDE, FAN_SPREAD,
} from './glider'

describe('advanceOpenness', () => {
  it('starts closed and opens toward one', () => {
    expect(advanceOpenness(0, true, OPEN_SECONDS / 3, OPEN_SECONDS)).toBeCloseTo(1 / 3, 5)
  })

  it('reaches exactly one and does not overshoot', () => {
    expect(advanceOpenness(0.9, true, 10, OPEN_SECONDS)).toBe(1)
  })

  it('closes toward zero', () => {
    expect(advanceOpenness(1, false, OPEN_SECONDS / 3, OPEN_SECONDS)).toBeCloseTo(2 / 3, 5)
  })

  it('reaches exactly zero and does not undershoot', () => {
    expect(advanceOpenness(0.1, false, 10, OPEN_SECONDS)).toBe(0)
  })

  it('reverses cleanly when interrupted mid-open', () => {
    let openness = 0
    for (let i = 0; i < 5; i++) openness = advanceOpenness(openness, true, 1 / 60, OPEN_SECONDS)
    const mid = openness
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    openness = advanceOpenness(openness, false, 1 / 60, OPEN_SECONDS)
    expect(openness).toBeLessThan(mid)
  })

  it('stays in range over a long run of alternating input', () => {
    let openness = 0
    for (let i = 0; i < 10000; i++) {
      openness = advanceOpenness(openness, i % 200 < 100, 1 / 60, OPEN_SECONDS)
      expect(openness).toBeGreaterThanOrEqual(0)
      expect(openness).toBeLessThanOrEqual(1)
    }
  })

  it('is frame-rate independent', () => {
    let fast = 0
    let slow = 0
    for (let i = 0; i < 36; i++) fast = advanceOpenness(fast, true, 1 / 120, OPEN_SECONDS)
    for (let i = 0; i < 18; i++) slow = advanceOpenness(slow, true, 1 / 60, OPEN_SECONDS)
    expect(Math.abs(fast - slow)).toBeLessThan(1e-9)
  })

  it('survives a non-finite or negative dt without corrupting openness', () => {
    expect(advanceOpenness(0.5, true, NaN, OPEN_SECONDS)).toBe(0.5)
    expect(advanceOpenness(0.5, true, -1, OPEN_SECONDS)).toBe(0.5)
  })

  it('recovers from a non-finite current value', () => {
    expect(advanceOpenness(NaN, true, 1 / 60, OPEN_SECONDS)).toBe(0)
  })
})

describe('easeOpenness', () => {
  it('is zero at zero and one at one', () => {
    expect(easeOpenness(0)).toBe(0)
    expect(easeOpenness(1)).toBe(1)
  })

  it('is symmetric about the midpoint', () => {
    expect(easeOpenness(0.5)).toBeCloseTo(0.5, 6)
  })

  it('eases, moving slower than linear near each end', () => {
    expect(easeOpenness(0.1)).toBeLessThan(0.1)
    expect(easeOpenness(0.9)).toBeGreaterThan(0.9)
  })

  it('clamps out-of-range input', () => {
    expect(easeOpenness(-1)).toBe(0)
    expect(easeOpenness(2)).toBe(1)
  })
})

describe('panelAngle', () => {
  it('collapses every panel to zero when fully closed', () => {
    for (let i = 0; i < PANELS_PER_SIDE; i++) {
      expect(panelAngle(i, PANELS_PER_SIDE, 0, FAN_SPREAD)).toBe(0)
    }
  })

  it('leaves the root panel along the staff even when open', () => {
    expect(panelAngle(0, PANELS_PER_SIDE, 1, FAN_SPREAD)).toBe(0)
  })

  it('opens the outermost panel to the full spread', () => {
    expect(panelAngle(PANELS_PER_SIDE - 1, PANELS_PER_SIDE, 1, FAN_SPREAD))
      .toBeCloseTo(FAN_SPREAD, 6)
  })

  it('fans monotonically outward', () => {
    let previous = -1
    for (let i = 0; i < PANELS_PER_SIDE; i++) {
      const angle = panelAngle(i, PANELS_PER_SIDE, 1, FAN_SPREAD)
      expect(angle).toBeGreaterThan(previous)
      previous = angle
    }
  })

  it('spreads progressively as openness rises', () => {
    const outer = PANELS_PER_SIDE - 1
    expect(panelAngle(outer, PANELS_PER_SIDE, 0.5, FAN_SPREAD))
      .toBeLessThan(panelAngle(outer, PANELS_PER_SIDE, 1, FAN_SPREAD))
  })

  it('never produces a non-finite angle', () => {
    for (const openness of [0, 0.5, 1, -1, 2]) {
      for (let i = 0; i < PANELS_PER_SIDE; i++) {
        expect(Number.isFinite(panelAngle(i, PANELS_PER_SIDE, openness, FAN_SPREAD))).toBe(true)
      }
    }
  })

  it('handles a single-panel fan without dividing by zero', () => {
    expect(panelAngle(0, 1, 1, FAN_SPREAD)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/player/glider.test.ts`
Expected: FAIL — cannot resolve module `./glider`.

- [ ] **Step 3: Write the pure half of `src/player/glider.ts`**

```typescript
import { MathUtils } from 'three'

/** How long the fan takes to travel from fully stowed to fully deployed. */
export const OPEN_SECONDS = 0.3
export const PANELS_PER_SIDE = 4
export const FAN_SPREAD = MathUtils.degToRad(78)

/**
 * Move `openness` toward its target at a constant rate, clamped to [0, 1].
 * Guarding non-finite input matters: a stalled frame or a corrupted delta would
 * otherwise drive the fan angles to NaN and corrupt every mesh transform.
 */
export function advanceOpenness(
  current: number, deployed: boolean, dt: number, seconds: number,
): number {
  if (!Number.isFinite(current) || !Number.isFinite(dt) || dt <= 0) {
    return MathUtils.clamp(Number.isFinite(current) ? current : 0, 0, 1)
  }
  const target = deployed ? 1 : 0
  const next = current + Math.sign(target - current) * (dt / seconds)
  return target > current
    ? MathUtils.clamp(Math.min(next, target), 0, 1)
    : MathUtils.clamp(Math.max(next, target), 0, 1)
}

/** Smoothstep, so the fan eases in and out rather than moving mechanically. */
export function easeOpenness(openness: number): number {
  const t = MathUtils.clamp(openness, 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Where fan leaf `index` sits, as an angle from the staff. All leaves collapse to
 * zero when closed, which is what makes them stack into a stick.
 */
export function panelAngle(
  index: number, count: number, openness: number, spread: number,
): number {
  if (count <= 1) return 0
  return easeOpenness(openness) * spread * (index / (count - 1))
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/player/glider.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add src/player/glider.ts src/player/glider.test.ts
git commit -m "Add fan easing and panel angles for the glider staff"
```

---

### Task 2: Glider assembly

Builds the staff and the two fans, and animates both from `openness`. Three.js mesh construction and bounding-box maths are pure CPU work, so this is testable headlessly against real geometry.

**Files:**
- Modify: `src/player/glider.ts` (append the assembly)
- Test: `src/player/glider-mesh.test.ts`

**Interfaces:**
- Consumes: `advanceOpenness`, `easeOpenness`, `panelAngle`, `OPEN_SECONDS`, `PANELS_PER_SIDE`, `FAN_SPREAD` from Task 1.
- Produces:
  - `createGlider(): { object: Object3D; update(dt: number, deployed: boolean): void; opennessForTest(): number }`

`opennessForTest` exists so the tests can assert the animation settled without reaching into the closure. It is read-only and cheap; leave it exported.

- [ ] **Step 1: Write the failing tests**

`src/player/glider-mesh.test.ts`. Note the two tests carrying a `REGRESSION` comment — each pins one of the errors described in the plan's pre-validation section, and each would pass if only the pure-maths tests existed:

```typescript
import { describe, it, expect } from 'vitest'
import { Box3 } from 'three'
import { createGlider } from './glider'

function span(glider: ReturnType<typeof createGlider>) {
  glider.object.updateMatrixWorld(true)
  const box = new Box3().setFromObject(glider.object)
  return {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
    box,
  }
}

function settle(glider: ReturnType<typeof createGlider>, deployed: boolean) {
  for (let i = 0; i < 120; i++) glider.update(1 / 60, deployed)
}

describe('createGlider assembly', () => {
  it('constructs without throwing', () => {
    expect(() => createGlider()).not.toThrow()
  })

  it('starts stowed', () => {
    expect(createGlider().opennessForTest()).toBe(0)
  })

  it('has a staff plus one fan root per side', () => {
    expect(createGlider().object.children).toHaveLength(3)
  })

  it('produces finite geometry when stowed', () => {
    const stowed = span(createGlider())
    for (const value of [stowed.x, stowed.y, stowed.z]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('sweeps much deeper fore-and-aft when deployed', () => {
    // REGRESSION: a folding fan does not get longer when it opens, it gets wider.
    // Giving each panel its own pivot spaced along the staff makes the stowed
    // glider WIDER than the deployed one. Depth is the axis that proves it opened.
    const stowed = span(createGlider())
    const glider = createGlider()
    settle(glider, true)
    expect(span(glider).z).toBeGreaterThan(stowed.z * 2)
  })

  it('holds the deployed wing near horizontal', () => {
    // REGRESSION: the staff mesh is rotated a quarter turn about Z at build time
    // to lie along local X. Carrying another quarter turn in DEPLOYED_ROTATION
    // compounds the two, stands the wing on its end, and collapses the span to
    // almost nothing. A near-horizontal wing is short in Y and wide in X.
    const glider = createGlider()
    settle(glider, true)
    const deployed = span(glider)
    expect(deployed.y).toBeLessThan(0.6)
    expect(deployed.x).toBeGreaterThan(2)
  })

  it('reads as a compact staff when stowed', () => {
    expect(span(createGlider()).z).toBeLessThan(0.9)
  })

  it('widens its span when deployed', () => {
    const stowed = span(createGlider())
    const glider = createGlider()
    settle(glider, true)
    expect(span(glider).x).toBeGreaterThan(stowed.x * 1.5)
  })

  it('sits overhead when deployed', () => {
    const glider = createGlider()
    settle(glider, true)
    expect(span(glider).box.max.y).toBeGreaterThan(2)
  })

  it('returns to its stowed shape after stowing', () => {
    const stowed = span(createGlider())
    const glider = createGlider()
    settle(glider, true)
    settle(glider, false)
    expect(glider.opennessForTest()).toBe(0)
    expect(span(glider).z).toBeCloseTo(stowed.z, 5)
  })

  it('is symmetric about the centre line when deployed', () => {
    const glider = createGlider()
    settle(glider, true)
    const { box } = span(glider)
    expect(Math.abs(box.max.x + box.min.x)).toBeLessThan(0.35)
  })

  it('never produces non-finite geometry mid-animation', () => {
    const glider = createGlider()
    for (let i = 0; i < 200; i++) {
      glider.update(1 / 60, i % 40 < 20)
      const current = span(glider)
      for (const value of [current.x, current.y, current.z]) {
        expect(Number.isFinite(value)).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/player/glider-mesh.test.ts`
Expected: FAIL — `createGlider` is not exported.

- [ ] **Step 3: Append the assembly to `src/player/glider.ts`**

```typescript
import {
  Object3D, Group, Mesh, CylinderGeometry, BufferGeometry, BufferAttribute,
  MeshLambertMaterial, Vector3, DoubleSide,
} from 'three'

const STAFF_LENGTH = 1.9
const STAFF_RADIUS = 0.045
/** How far out from the grip each side's fan pivots, along the staff. */
const PIVOT_OFFSET = 0.16
const PANEL_LENGTH = 1.05
const PANEL_HALF_WIDTH = 0.15

const STOWED_POSITION = new Vector3(0, 1.0, 0.3)
/** Tilted well off horizontal so the stowed staff reads as slung across the back. */
const STOWED_ROTATION = new Vector3(0.1, 0, 1.05)
const DEPLOYED_POSITION = new Vector3(0, 2.0, -0.4)
/**
 * Near-level. The staff mesh is already laid along local X at build time, so this
 * rotation must NOT add another quarter turn about Z — doing so stands the wing on
 * its end and collapses the span to nothing.
 */
const DEPLOYED_ROTATION = new Vector3(0.18, 0, 0)

/**
 * One fan leaf: a long thin triangle running out along +X from the pivot, widening
 * slightly in Z at its tip so the open fan reads as a membrane rather than spokes.
 */
function createPanelGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    PANEL_LENGTH, 0, -PANEL_HALF_WIDTH,
    PANEL_LENGTH, 0, PANEL_HALF_WIDTH,
  ]), 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

export function createGlider(): {
  object: Object3D
  update(dt: number, deployed: boolean): void
  opennessForTest(): number
} {
  const object = new Group()

  const staffMaterial = new MeshLambertMaterial({ color: 0x6b4a2f })
  const fabricMaterial = new MeshLambertMaterial({ color: 0xe0913f, side: DoubleSide })

  // The cylinder's axis is local Y, so lay it along local X to be the spanwise staff.
  const staff = new Mesh(
    new CylinderGeometry(STAFF_RADIUS, STAFF_RADIUS, STAFF_LENGTH, 8), staffMaterial,
  )
  staff.rotation.z = Math.PI / 2
  object.add(staff)

  // Each side fans from a single shared pivot, the way a real fan turns on its rivet.
  // Spacing the pivots along the staff instead would lay the leaves end-to-end when
  // closed, making the stowed glider wider than the deployed one.
  const panels: { pivot: Group; index: number; side: number }[] = []
  for (const side of [-1, 1]) {
    const root = new Group()
    root.position.x = PIVOT_OFFSET * side
    object.add(root)
    for (let index = 0; index < PANELS_PER_SIDE; index++) {
      const pivot = new Group()
      const panel = new Mesh(createPanelGeometry(), fabricMaterial)
      panel.scale.x = side
      pivot.add(panel)
      root.add(pivot)
      panels.push({ pivot, index, side })
    }
  }

  let openness = 0

  function apply(): void {
    const eased = easeOpenness(openness)
    object.position.lerpVectors(STOWED_POSITION, DEPLOYED_POSITION, eased)
    object.rotation.set(
      MathUtils.lerp(STOWED_ROTATION.x, DEPLOYED_ROTATION.x, eased),
      MathUtils.lerp(STOWED_ROTATION.y, DEPLOYED_ROTATION.y, eased),
      MathUtils.lerp(STOWED_ROTATION.z, DEPLOYED_ROTATION.z, eased),
    )
    for (const { pivot, index, side } of panels) {
      // Rotating about Y sweeps each leaf fore-aft in the wing plane. Closed, every
      // leaf sits at zero and they stack into a stick along the staff.
      pivot.rotation.y = panelAngle(index, PANELS_PER_SIDE, openness, FAN_SPREAD) * side
    }
  }
  apply()

  return {
    object,
    update(dt: number, deployed: boolean): void {
      openness = advanceOpenness(openness, deployed, dt, OPEN_SECONDS)
      apply()
    },
    opennessForTest: () => openness,
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/player/glider-mesh.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify the measured dimensions match the plan's table**

Run the whole suite and typecheck: `npm test && npm run typecheck`
Expected: all pass, suite now around 330 tests.

If any of the geometry assertions fail, the constants have drifted from the prototype — fix the transcription rather than relaxing the assertion.

- [ ] **Step 6: Commit**

```bash
git add src/player/glider.ts src/player/glider-mesh.test.ts
git commit -m "Add glider staff assembly with a folding fan wing"
```

---

### Task 3: Wire the glider into the game

Two small additions to `src/main.ts`, then a browser check. This is the task whose deliverable is judged by looking at it.

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `createGlider` from Task 2.
- Produces: nothing new.

**Why it parents under the avatar:** `main.ts` already sets `avatar.object.position` from the player and calls `avatar.object.lookAt(...)` to face it along travel or along the kite's forward vector. Making the glider a child of `avatar.object` means it inherits both for free. Three.js `lookAt` orients local −Z toward the target, which is the same convention the placeholder's direction cone already uses, so the glider's local −Z is forward and its local +X is spanwise.

- [ ] **Step 1: Add the import and construction**

Add to the imports at the top of `src/main.ts`:

```typescript
import { createGlider } from './player/glider'
```

Immediately after the existing avatar construction and `scene.add(avatar.object)`, add:

```typescript
  const glider = createGlider()
  // A child of the avatar, so it inherits the character's position and facing.
  avatar.object.add(glider.object)
```

- [ ] **Step 2: Drive it from the frame loop**

In `update(dt)`, directly after the existing `avatar.update(dt)` call, add:

```typescript
    glider.update(dt, player.mode === 'kite')
```

- [ ] **Step 3: Verify the suite, typecheck and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass. No test count change — `main.ts` has no unit tests, by the same deliberate split used for the renderer, the HUD's DOM half and the input adapter.

- [ ] **Step 4: Look at it**

```bash
npm run dev
```

Open `http://localhost:5173/airbender-skies/` — note the `/airbender-skies/` path, which `vite.config.ts` sets as `base`; the bare root will 404. Click the canvas to capture the mouse, then confirm:

- [ ] Walking around, a staff is visible slung diagonally across the character's back.
- [ ] Walking off the edge of `home` and pressing `Space` fans a wing open overhead, over roughly a third of a second, and the staff swings up as it opens.
- [ ] The deployed wing is wide and roughly horizontal above the character, not vertical or edge-on.
- [ ] Pressing `Space` again folds it back down to the staff on the back.
- [ ] Interrupting a deploy by pressing `Space` twice quickly reverses the fan mid-open without snapping.
- [ ] The wing does not fill the screen or hide the character from the flight camera.
- [ ] The console is free of errors.

Report what you actually observed. Whether the wing looks *good* — proportions, colour, how the fan reads in motion — is an aesthetic judgement for the human, not something to claim.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "Show the glider staff in the game"
git push
```

---

## Plan Self-Review

**Spec coverage.** Every section of the design maps to a task:

| Spec section | Task |
| --- | --- |
| The silhouette, staff-glider fanning open | 2 |
| A new module, avatar left alone | 1, 2 |
| One value drives the whole motion | 1 (the value), 2 (both interpolations) |
| Geometry and palette | 2 |
| Load-bearing interface | 1, 2 |
| Parenting and frame-loop wiring | 3 |
| Error handling, the clamp against non-finite input | 1 |
| Testing, pure functions plus by-eye assembly | 1, 2, 3 |
| Known limitation 1, re-parenting for a rigged model | not implemented, by design |
| Known limitation 2, no roll with bank input | not implemented, by design |

**Placeholder scan.** No TBDs, no "add error handling", no "similar to Task N". Every code step carries the code.

**Type consistency.** `advanceOpenness`, `easeOpenness`, `panelAngle`, `createGlider`, `OPEN_SECONDS`, `PANELS_PER_SIDE` and `FAN_SPREAD` are named identically in Task 1's definitions, Task 2's consumption, and Task 3's import. `createGlider`'s returned shape is stated once in Task 2's Interfaces block and used unchanged in Task 3.

**Verification status.** Every code block and test in Tasks 1 and 2 was executed against the real toolchain before being written into this plan: **30 tests pass and `tsc --noEmit` is clean**. The prototype has been discarded, per TDD — implementers write the tests first and implement fresh. Task 3's `main.ts` edit and the browser check were not executed; they are two lines and a human's eyes.
