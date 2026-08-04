# Enemy Health Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a small bar above each enemy's head showing how much health it has left, visible once the enemy has been damaged and hidden once it is downed.

**Architecture:** A new `HealthBar` module owns two quads and knows nothing about enemies — it takes a `Health` and a camera rotation. `createEnemyView` composes one and drives it from `sync`. Enemy health already exists and is already reduced by every attack, so no combat code changes: this is rendering only.

**Tech Stack:** TypeScript, three.js 0.185.1, Vitest 4 (node environment), Vite 8.

## Global Constraints

- **Never commit to `main`.** Work on the `enemy-health-bars` branch. Pushing `main` triggers the GitHub Pages deploy.
- **Typecheck is two passes:** `npx tsc -p tsconfig.json --noEmit` then `npx tsc -p tsconfig.test.json --noEmit`. App code cannot see Node globals; only tests can.
- `noUncheckedIndexedAccess` is on. Indexed access yields `T | undefined` and must be narrowed.
- **Red-proof every test.** After writing a test, run it and confirm it FAILS for the stated reason before implementing. A test that passes before the feature exists is decorative and must be rewritten or deleted. If a test passes unexpectedly, say so rather than moving on.
- **Comments explain why, not what.** Match the surrounding style: derive expectations from config rather than hardcoding, and mark regression guards as such.
- Full suite: `npx vitest run`. Baseline is 826 tests across 58 files, all passing.
- Colours and numbers are fixed by the spec: track `0x1b1f24` at opacity `0.55`, fill `0xe4614a`, width `0.9`, height `0.11`, height above feet `2.0`, fill z-offset `0.001`.

## File Structure

| File | Responsibility |
|---|---|
| `src/combat/health.ts` (modify) | Gains `healthFraction(h)`. A fraction is a property of `Health`, so it belongs with `Health`. |
| `src/combat/health.test.ts` (modify) | Tests for `healthFraction`, including the non-finite and zero-max cases. |
| `src/combat/health-bar.ts` (create) | The bar: two quads, a visibility predicate, billboarding. Knows about `Health`, not about `Enemy`. |
| `src/combat/health-bar.test.ts` (create) | Visibility, fill scale, left-edge anchoring, billboarding, `depthTest` guard, dispose. |
| `src/combat/enemy-mesh.ts` (modify) | Composes one bar. Gains an inner `rig` Group so the bar's parent is unrotated. |
| `src/combat/enemy-mesh.test.ts` (create) | Composition plus characterisation tests for behaviour that has none today. |
| `src/main.ts` (modify, line 323) | Passes `camera.quaternion` to `sync`. |

### Deviation from the spec, deliberate

The spec says the bar is a child of the enemy's Group and billboards by copying the camera
rotation. Both are kept, but a Group is inserted between them.

`sync` rotates the view's root Group — by the facing heading, and by `PI/2` when downed. A
child's world orientation is its parent's times its own, so a bar parented directly to that
root and given the camera's rotation would come out rotated by the soldier's heading as
well, and would never actually face the camera. The bug would be invisible in a test that
only checks `bar.object.quaternion`.

So: the **root** Group carries position only, a new inner **rig** Group carries the rotation
and holds the body and spear, and the bar hangs off the unrotated root. The alternative —
multiplying by the inverse of the parent's world quaternion in `update` — works too, but
puts a piece of the enemy view's structure inside the bar's maths, where the next person to
add a child to the enemy view will not find it.

---

### Task 1: `healthFraction`

**Files:**
- Modify: `src/combat/health.ts`
- Test: `src/combat/health.test.ts`

**Interfaces:**
- Consumes: `Health`, `HealthConfig` (already in `src/combat/health.ts`).
- Produces: `healthFraction(h: Health): number` — 0 to 1, clamped; 0 for a non-finite `current` or a `max` of 0 or less.

- [ ] **Step 1: Write the failing tests**

Append to `src/combat/health.test.ts`. Check the file's existing imports first and extend the
`from './health'` import to include `healthFraction` rather than adding a second import line.

```ts
describe('healthFraction', () => {
  const at = (current: number, max = 4): Health => ({ current, max, sinceHit: 0 })

  it('is 1 at full health', () => {
    expect(healthFraction(at(4))).toBe(1)
  })

  it('is a half at half health', () => {
    expect(healthFraction(at(2))).toBeCloseTo(0.5, 6)
  })

  it('is 0 at the floor', () => {
    expect(healthFraction(at(0))).toBe(0)
  })

  it('clamps a current above max', () => {
    // Regeneration clamps already, but a fraction above 1 would scale a quad past
    // the track it sits in, so this stays a guard rather than an assumption.
    expect(healthFraction(at(9))).toBe(1)
  })

  it('clamps a negative current', () => {
    expect(healthFraction(at(-3))).toBe(0)
  })

  it('is 0 rather than NaN for a non-finite current', () => {
    // This value reaches a transform. NaN in scale.x corrupts the matrix rather
    // than merely looking wrong, so it must not survive this function.
    expect(healthFraction(at(Number.NaN))).toBe(0)
  })

  it('is 0 rather than dividing by a zero max', () => {
    expect(healthFraction({ current: 0, max: 0, sinceHit: 0 })).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/combat/health.test.ts
```

Expected: FAIL — `healthFraction is not a function`, or a TypeScript error that it is not
exported. All seven fail for that one reason.

- [ ] **Step 3: Implement**

Add to `src/combat/health.ts`. `MathUtils` is already imported at the top of that file.

```ts
/**
 * Health as a 0-to-1 fraction, for anything that draws it.
 *
 * Fails closed rather than propagating a bad number: the result is multiplied into a
 * transform, where a NaN corrupts the matrix instead of just looking wrong. Note that
 * `hudModelFor` returns 1 for a missing pool, because there an absent health pool means
 * "nothing to report"; here a `max` of zero means there is nothing to fill.
 */
export function healthFraction(h: Health): number {
  if (!(h.max > 0) || !Number.isFinite(h.current)) return 0
  return MathUtils.clamp(h.current / h.max, 0, 1)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/combat/health.test.ts
```

Expected: PASS, all seven.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
git add src/combat/health.ts src/combat/health.test.ts
git commit -m "Add healthFraction, clamped and NaN-safe"
```

---

### Task 2: The health bar

**Files:**
- Create: `src/combat/health-bar.ts`
- Test: `src/combat/health-bar.test.ts`

**Interfaces:**
- Consumes: `healthFraction(h: Health): number` and `isDowned(h: Health): boolean` from `src/combat/health.ts`.
- Produces:
  - `healthBarVisible(h: Health): boolean`
  - `interface HealthBar { object: Object3D; update(health: Health, cameraQuaternion: Quaternion): void; dispose(): void }`
  - `createHealthBar(): HealthBar`
  - The returned `object` is named `health-bar`; its children are named `track` and `fill`.

- [ ] **Step 1: Write the failing tests**

Create `src/combat/health-bar.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Box3, Euler, Mesh, MeshBasicMaterial, Quaternion } from 'three'
import { createHealthBar, healthBarVisible } from './health-bar'
import type { Health } from './health'

const at = (current: number, max = 4): Health => ({ current, max, sinceHit: 0 })
const FACING = new Quaternion()

/** The bar's children are named, so a test does not depend on the order they were added. */
function meshNamed(bar: { object: { getObjectByName(name: string): unknown } }, name: string): Mesh {
  const found = bar.object.getObjectByName(name)
  if (!(found instanceof Mesh)) throw new Error(`expected a mesh named ${name}`)
  return found
}

function materialOf(mesh: Mesh): MeshBasicMaterial {
  const material = mesh.material
  if (Array.isArray(material) || !(material instanceof MeshBasicMaterial)) {
    throw new Error('expected a single MeshBasicMaterial')
  }
  return material
}

describe('healthBarVisible', () => {
  it('is hidden at full health', () => {
    expect(healthBarVisible(at(4))).toBe(false)
  })

  it('is shown once damaged', () => {
    expect(healthBarVisible(at(3))).toBe(true)
  })

  it('is hidden when downed', () => {
    // Damaged as well as downed, so this cannot pass by way of the damage check.
    expect(healthBarVisible(at(0))).toBe(false)
  })
})

describe('createHealthBar', () => {
  it('sits above the head rather than at the feet', () => {
    // The body capsule is radius 0.35 and length 1.0 centred at y 0.85, so its top
    // is at 1.7. The bar has to clear that.
    expect(createHealthBar().object.position.y).toBeGreaterThan(1.7)
  })

  it('scales the fill to the health fraction', () => {
    const bar = createHealthBar()
    bar.update(at(1), FACING)
    expect(meshNamed(bar, 'fill').scale.x).toBeCloseTo(0.25, 4)
  })

  it('empties from the right, not from both ends', () => {
    // A quad scaled about its centre shrinks toward the middle from both sides, which
    // reads as a bar draining from both ends at once. The scale value alone cannot
    // tell the two apart, so this compares edges.
    const bar = createHealthBar()
    bar.update(at(2), FACING)
    const fill = new Box3().setFromObject(meshNamed(bar, 'fill'))
    const track = new Box3().setFromObject(meshNamed(bar, 'track'))
    expect(fill.min.x).toBeCloseTo(track.min.x, 5)
    expect(fill.max.x).toBeLessThan(track.max.x - 0.1)
  })

  it('faces where the camera faces', () => {
    const bar = createHealthBar()
    const camera = new Quaternion().setFromEuler(new Euler(-0.4, 1.2, 0))
    bar.update(at(2), camera)
    expect(bar.object.quaternion.angleTo(camera)).toBeLessThan(1e-6)
  })

  it('hides itself at full health and shows itself once damaged', () => {
    const bar = createHealthBar()
    bar.update(at(4), FACING)
    expect(bar.object.visible).toBe(false)
    bar.update(at(2), FACING)
    expect(bar.object.visible).toBe(true)
  })

  it('keeps a finite scale for a non-finite health', () => {
    const bar = createHealthBar()
    bar.update({ current: Number.NaN, max: 4, sinceHit: 0 }, FACING)
    expect(Number.isFinite(meshNamed(bar, 'fill').scale.x)).toBe(true)
  })

  it('is depth-tested, so terrain hides it', () => {
    // Regression guard, and a deliberate difference from src/fx/, where every effect
    // sets depthTest false. A bar drawn over a hill would reveal an enemy the player
    // cannot see.
    const bar = createHealthBar()
    for (const name of ['track', 'fill']) {
      expect(materialOf(meshNamed(bar, name)).depthTest).toBe(true)
    }
  })

  it('casts no shadow', () => {
    const bar = createHealthBar()
    for (const name of ['track', 'fill']) {
      expect(meshNamed(bar, name).userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes without throwing', () => {
    expect(() => createHealthBar().dispose()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/combat/health-bar.test.ts
```

Expected: FAIL — the module `./health-bar` does not exist. Every test fails on the import.

- [ ] **Step 3: Implement**

Create `src/combat/health-bar.ts`:

```ts
import {
  Group, Mesh, MeshBasicMaterial, PlaneGeometry, type Object3D, type Quaternion,
} from 'three'
import { healthFraction, isDowned, type Health } from './health'

/**
 * A health bar above a combatant's head.
 *
 * Takes a `Health` and a camera rotation, and knows nothing about enemies — which is what
 * keeps it testable without one, and what would let the same bar sit over anything else
 * with health.
 *
 * It owns its geometry and materials, so `dispose` is part of the contract for the same
 * reason it is on `Effect` in `src/fx/effect.ts`: one exists per combatant.
 */
export interface HealthBar {
  object: Object3D
  update(health: Health, cameraQuaternion: Quaternion): void
  dispose(): void
}

const WIDTH = 0.9
const HEIGHT = 0.11
/** Clears the body capsule, whose top is at 1.7, without floating free of the head. */
const HEIGHT_ABOVE_FEET = 2
const TRACK_COLOR = 0x1b1f24
const TRACK_OPACITY = 0.55
/**
 * A cooler red than the player's own bar, which runs #ff8f6b to #ffd0a8, so a glance
 * never reads an enemy's health as the player's.
 */
const FILL_COLOR = 0xe4614a
/** In front of the track, so the two do not z-fight. */
const FILL_OFFSET = 0.001
/** A zero scale is a degenerate matrix, so the fill keeps a sliver. */
const MIN_SCALE = 1e-4

/**
 * Shown once damaged, hidden when downed.
 *
 * Hidden at full health for the same reason `hudModelFor` hides the player's bar there:
 * a meter with nothing to say is clutter. Hidden when downed because a body lying flat
 * already says it is out of the fight, and a bar over every past fight would never leave.
 *
 * Calls `isDowned` rather than restating `current <= 0`, so there is one definition of
 * downed in the codebase.
 */
export function healthBarVisible(h: Health): boolean {
  return !isDowned(h) && h.current < h.max
}

export function createHealthBar(): HealthBar {
  const object = new Group()
  object.name = 'health-bar'
  object.position.y = HEIGHT_ABOVE_FEET

  const trackGeometry = new PlaneGeometry(WIDTH, HEIGHT)
  const trackMaterial = new MeshBasicMaterial({
    color: TRACK_COLOR, transparent: true, opacity: TRACK_OPACITY, depthWrite: false,
  })
  const track = new Mesh(trackGeometry, trackMaterial)
  track.name = 'track'
  track.userData.excludeFromShadows = true

  // The fill's origin is moved to its left edge, so scaling x empties it from the right
  // rather than shrinking it toward its middle from both sides.
  const fillGeometry = new PlaneGeometry(WIDTH, HEIGHT).translate(WIDTH / 2, 0, 0)
  const fillMaterial = new MeshBasicMaterial({ color: FILL_COLOR })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.name = 'fill'
  fill.position.set(-WIDTH / 2, 0, FILL_OFFSET)
  fill.userData.excludeFromShadows = true

  object.add(track)
  object.add(fill)

  return {
    object,
    update(health: Health, cameraQuaternion: Quaternion): void {
      object.visible = healthBarVisible(health)
      fill.scale.x = Math.max(healthFraction(health), MIN_SCALE)
      // Copied whole rather than yaw-only: the camera looks down at the player, and a
      // yaw-only bar would lean away from it.
      object.quaternion.copy(cameraQuaternion)
    },
    dispose(): void {
      trackGeometry.dispose()
      trackMaterial.dispose()
      fillGeometry.dispose()
      fillMaterial.dispose()
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/combat/health-bar.test.ts
```

Expected: PASS, all thirteen.

- [ ] **Step 5: Red-proof the anchoring test**

The left-edge test is the one guarding the mistake most likely to ship. Prove it can fail:
temporarily remove `.translate(WIDTH / 2, 0, 0)` from `fillGeometry` and set
`fill.position.set(0, 0, FILL_OFFSET)` — a centre-anchored fill, the naive version.

```bash
npx vitest run src/combat/health-bar.test.ts
```

Expected: FAIL on "empties from the right, not from both ends". If it still passes, the test
is decorative and must be rewritten before continuing.

Then restore both lines by hand and re-run to confirm PASS. Do not use `git checkout` to
restore — it would discard the rest of the file too.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
git add src/combat/health-bar.ts src/combat/health-bar.test.ts
git commit -m "Add a billboarded health bar"
```

---

### Task 3: Put a bar on every enemy

**Files:**
- Modify: `src/combat/enemy-mesh.ts`
- Modify: `src/main.ts` (the `sync` call, currently line 323)
- Test: `src/combat/enemy-mesh.test.ts` (create)

**Interfaces:**
- Consumes: `createHealthBar()`, `HealthBar` from `src/combat/health-bar.ts`.
- Produces: `EnemyView.sync(enemy: Enemy, cameraQuaternion: Quaternion): void` — the second parameter is new and required. The view's root object gains two named children: `rig` (the body and spear, which rotates) and `health-bar`.

- [ ] **Step 1: Write the failing tests**

Create `src/combat/enemy-mesh.test.ts`. The characterisation tests cover behaviour that
`enemy-mesh.ts` has today and has never had a test for; they exist so this task's
restructuring cannot silently change how a soldier reads.

```ts
import { describe, it, expect } from 'vitest'
import { Group, Object3D, Quaternion, Vector3 } from 'three'
import { createEnemyView } from './enemy-mesh'
import { spawnEnemy, hitEnemy, type Enemy } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

const C = DEFAULT_COMBAT_CONFIG.enemy
const FACING = new Quaternion()
const enemyAt = (x: number, z: number): Enemy => spawnEnemy('a', new Vector3(x, 0, z), C)
const damaged = (enemy: Enemy): Enemy => hitEnemy(enemy, C.maxHealth / 2, new Vector3())
const downed = (enemy: Enemy): Enemy => hitEnemy(enemy, C.maxHealth, new Vector3())

function child(view: { object: Object3D }, name: string): Object3D {
  const found = view.object.getObjectByName(name)
  if (!found) throw new Error(`expected a child named ${name}`)
  return found
}

/** The rig carries the rotation; the root carries only position. */
function rig(view: { object: Object3D }): Group {
  const found = child(view, 'rig')
  if (!(found instanceof Group)) throw new Error('expected the rig to be a Group')
  return found
}

describe('createEnemyView', () => {
  it('carries a health bar', () => {
    expect(createEnemyView().object.getObjectByName('health-bar')).toBeDefined()
  })

  it('hides the bar on a downed enemy', () => {
    const view = createEnemyView()
    view.sync(downed(enemyAt(0, 0)), FACING)
    expect(child(view, 'health-bar').visible).toBe(false)
  })

  it('shows the bar on a damaged one', () => {
    const view = createEnemyView()
    view.sync(damaged(enemyAt(0, 0)), FACING)
    expect(child(view, 'health-bar').visible).toBe(true)
  })

  it('leaves the bar upright while the soldier turns', () => {
    // The whole reason the rig exists. If the bar were parented to the rotating root,
    // its world orientation would be the soldier's heading times the camera's, and it
    // would never actually face the camera.
    const view = createEnemyView()
    const turned = { ...damaged(enemyAt(0, 0)), facing: new Vector3(1, 0, 0) }
    view.sync(turned, FACING)
    const world = new Quaternion()
    child(view, 'health-bar').getWorldQuaternion(world)
    expect(world.angleTo(FACING)).toBeLessThan(1e-6)
  })

  it('stands the soldier at its own position', () => {
    const view = createEnemyView()
    view.sync(enemyAt(3, -7), FACING)
    expect(view.object.position.toArray()).toEqual([3, 0, -7])
  })

  it('turns the soldier to face its heading', () => {
    const view = createEnemyView()
    view.sync({ ...enemyAt(0, 0), facing: new Vector3(1, 0, 0) }, FACING)
    expect(rig(view).rotation.y).toBeCloseTo(Math.PI / 2, 5)
  })

  it('lays a downed soldier flat', () => {
    const view = createEnemyView()
    view.sync(downed(enemyAt(0, 0)), FACING)
    expect(rig(view).rotation.x).toBeCloseTo(Math.PI / 2, 5)
  })

  it('stands a living soldier upright', () => {
    const view = createEnemyView()
    view.sync(enemyAt(0, 0), FACING)
    expect(rig(view).rotation.x).toBeCloseTo(0, 5)
  })

  it('cocks the spear back on a wind-up and not otherwise', () => {
    // The dodge window depends on the player seeing this, so it is worth pinning.
    const view = createEnemyView()
    const spear = child(view, 'spear')
    view.sync({ ...enemyAt(0, 0), stance: 'wind-up' }, FACING)
    const winding = spear.rotation.x
    view.sync({ ...enemyAt(0, 0), stance: 'advance' }, FACING)
    expect(winding).toBeLessThan(spear.rotation.x)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/combat/enemy-mesh.test.ts
```

Expected: FAIL. A TypeScript error on the two-argument `sync` calls, and failures for the
missing `rig`, `spear` and `health-bar` names. Note which of the characterisation tests fail
only because of the missing names — those are the ones the restructure must keep green.

- [ ] **Step 3: Implement**

Rewrite `src/combat/enemy-mesh.ts`. The changes: name the spear, add a `rig` Group that
takes the rotation and holds the body and spear, add a bar to the unrotated root, and take
the camera rotation in `sync`.

```ts
import {
  CapsuleGeometry, ConeGeometry, Group, Mesh, MeshLambertMaterial,
  type Object3D, type Quaternion,
} from 'three'
import { isDowned } from './health'
import { createHealthBar } from './health-bar'
import type { Enemy } from './enemy'

/**
 * A spear infantryman, as primitives.
 *
 * Placeholder art on purpose: the point of this slice is that the fight reads, not
 * that the soldier does. What has to be legible is the stance, because the doc's
 * whole dodge window depends on the player seeing a wind-up coming — so the spear
 * lifts on the telegraph and the body falls flat when downed.
 *
 * The object is in two parts. The root carries position only; the `rig` carries the
 * rotation. That split exists so the health bar, which hangs off the root, can face the
 * camera by copying its rotation — parented to the rotating part, its world orientation
 * would be the soldier's heading times the camera's, and it would never face anything.
 */
export interface EnemyView {
  object: Object3D
  sync(enemy: Enemy, cameraQuaternion: Quaternion): void
}

const BODY = 0x8d6b4a
const SPEAR = 0x4a3c2a
/** Warm and bright, so a telegraph is the most visible thing on screen. */
const WINDUP = 0xe4763c

export function createEnemyView(): EnemyView {
  const object = new Group()

  const rig = new Group()
  rig.name = 'rig'
  object.add(rig)

  const bodyMaterial = new MeshLambertMaterial({ color: BODY })
  const body = new Mesh(new CapsuleGeometry(0.35, 1.0, 4, 8), bodyMaterial)
  body.name = 'body'
  body.position.y = 0.85
  rig.add(body)

  const spear = new Mesh(new ConeGeometry(0.09, 1.9, 6), new MeshLambertMaterial({ color: SPEAR }))
  spear.name = 'spear'
  spear.position.set(0.32, 1.1, 0)
  rig.add(spear)

  const healthBar = createHealthBar()
  object.add(healthBar.object)

  return {
    object,
    sync(enemy: Enemy, cameraQuaternion: Quaternion): void {
      object.position.copy(enemy.position)
      // Ahead of the downed branch below: the bar's own rule already covers being
      // downed, so there is one place that decides when a bar shows.
      healthBar.update(enemy.health, cameraQuaternion)

      if (isDowned(enemy.health)) {
        // Down, not gone: the body stays in the world, lying where it was put.
        rig.rotation.set(Math.PI / 2, 0, 0)
        bodyMaterial.color.setHex(BODY)
        spear.rotation.set(0, 0, 0)
        return
      }

      // Facing is horizontal, so atan2 of the heading is the whole rotation.
      rig.rotation.set(0, Math.atan2(enemy.facing.x, enemy.facing.z), 0)

      const winding = enemy.stance === 'wind-up'
      bodyMaterial.color.setHex(winding ? WINDUP : BODY)
      // Spear cocked back on the telegraph, level otherwise.
      spear.rotation.set(winding ? -1.1 : 0, 0, 0)
    },
  }
}
```

Note what is *not* added: a `dispose` on `EnemyView`. Views are created once per enemy in
`src/main.ts` and never removed, so there is nothing to release. `HealthBar.dispose` exists
because the bar owns GPU resources and the next caller may have a shorter-lived bar.

- [ ] **Step 4: Wire it into the game**

In `src/main.ts`, the enemy sync line (currently 323) becomes:

```ts
for (const enemy of encounter.enemies) enemyViews.get(enemy.id)?.sync(enemy, camera.quaternion)
```

This already runs after the camera is positioned and aimed (currently line 293), so the
rotation is this frame's rather than last frame's.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/combat/enemy-mesh.test.ts
```

Expected: PASS, all ten.

- [ ] **Step 6: Red-proof the rig test**

The upright-bar test is the one guarding the deviation this plan makes. Prove it can fail:
temporarily change `object.add(healthBar.object)` to `rig.add(healthBar.object)` — the
structure the spec originally described.

```bash
npx vitest run src/combat/enemy-mesh.test.ts
```

Expected: FAIL on "leaves the bar upright while the soldier turns". Restore the line by hand
and re-run to confirm PASS.

- [ ] **Step 7: Full suite, both typechecks, and build**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
npx vite build
```

Expected: all tests pass — 826 at the start of this plan, plus 7 from Task 1, 13 from Task 2
and 10 from Task 3, for 856 across 60 files. Both typechecks clean. Build clean.

If any pre-existing test fails, stop: the `sync` signature change or the rig restructure has
broken something, and that is worth understanding rather than patching.

- [ ] **Step 8: Commit**

```bash
git add src/combat/enemy-mesh.ts src/combat/enemy-mesh.test.ts src/main.ts
git commit -m "Put a health bar over every enemy"
```

- [ ] **Step 9: Verify it in the running game**

Tests cannot show whether a bar is legible, the right size, or in the right place. Start the
preview and look.

The preview pane reports `document.visibilityState === 'hidden'`, so `requestAnimationFrame`
is suspended and the game will appear frozen. Drive it with a synthetic clock — the technique
is documented under "The preview pane's animation loop" in `docs/HANDOFF.md`. Install the
hook, then take one screenshot so the loop re-registers through it, then drive frames.

To see a bar you need a damaged enemy: walk into `HOME_PATROL` range and gust one. Then
confirm by eye:

- A bar appears over a soldier only after it has been hit.
- It faces the camera from several angles, including while the soldier turns to track you.
- It empties from the right as the soldier takes more hits.
- It disappears when the soldier goes down.
- It is hidden when the soldier is behind a hill.

Record what you saw. If the bar is present but unreadable — wrong size, wrong height, lost
against the terrain — say so rather than reporting the geometry as correct: that exact
failure has already happened once in this repo, with the gust cone, where every geometry
test passed while nothing was visible on screen.

- [ ] **Step 10: Update the handoff**

Add the feature to `docs/HANDOFF.md` alongside the other combat sections, and update the
repo-state line at the top to the new test and file counts. State plainly whether the bars
were confirmed on screen or not.

```bash
git add docs/HANDOFF.md
git commit -m "Document the enemy health bars"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: `healthFraction` and its edge cases to
Task 1; the module boundary, geometry, colours, left-edge fill, billboarding, `depthTest`
and dispose to Task 2; the `enemy-mesh` composition, the required camera parameter, the
`main.ts` call and the characterisation tests to Task 3. The spec's four settled decisions
are each pinned by a test: in-world billboard (Task 3's world-quaternion test), visible only
once damaged (`healthBarVisible`), hidden when downed (both tasks), depth-tested (Task 2's
regression guard). "Out of scope" needs no task.

**One deliberate deviation,** documented under File Structure: the bar hangs off an
unrotated root rather than the rotating Group the spec described, because the spec's
structure would have produced bars that never face the camera.

**Placeholders.** None. Every code step carries the code; every test step carries the
assertions; both red-proof steps name the exact line to change and the exact test that must
fail.

**Type consistency.** `healthFraction(h: Health): number`, `healthBarVisible(h: Health):
boolean`, `createHealthBar(): HealthBar`, `update(health, cameraQuaternion)`, and
`sync(enemy, cameraQuaternion)` are spelled identically in every task that mentions them.
Child names `rig`, `body`, `spear`, `health-bar`, `track` and `fill` are consistent between
the implementations and the tests that look them up.
