# Combat Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the attacks visible — a gust cone at its true reach, a dash trail, impact bursts on connects and downs, and an Avatar State aura on the character.

**Architecture:** `src/fx/` gains a named `Effect` contract (extracted from the interface `shockwave.ts` already has), a pool that owns the add/advance/cull/dispose lifecycle, and four effect modules. Three effects are fire-and-forget and live in the pool; the Avatar State aura is persistent and takes the shape the glider already uses. Every trigger reads a signal the game already produces, so no movement or combat code changes.

**Tech Stack:** TypeScript 7, three.js 0.185.1, Vitest 4 in the `node` environment, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-03-combat-visuals-design.md`

## Global Constraints

- **Branch:** all work lands on `combat-visuals`. Do not commit to `main` — pushing `main` triggers the GitHub Pages deploy.
- **Typecheck is two passes:** `npm run typecheck` runs `tsconfig.json` then `tsconfig.test.json`. Both must be clean.
- **`noUncheckedIndexedAccess` is on.** Indexed access is `T | undefined` and must be narrowed. Tests reading `object.children[0]` need that narrowing.
- **Do NOT modify anything outside `src/fx/`, `src/main.ts` and `docs/HANDOFF.md`.** In particular `src/player/*`, `src/combat/*`, `src/focus/*`, `src/core/*` and `src/ui/*` are read-only for this work. This is a layer over signals that already exist.
- **No `PointsMaterial`.** `docs/HANDOFF.md` records that its screen-facing squares read as white blocks near the camera — it is why wind motes are capped at 0.45–0.75 world units. Every effect here is a mesh.
- **Every effect sets `object.userData.excludeFromShadows = true`** (on each mesh, if the effect is a group of meshes). `enableShadows` in `src/core/sun.ts` honours the flag, and a translucent effect casting a hard shadow reads as a solid object.
- **Every material is `transparent: true` with `depthWrite: false`**, matching `createShockwave`, so effects never occlude what they overlap.
- **Comments explain *why*, not what.** Match the surrounding file's density.
- Run tests with `npx vitest run <path>`; the full suite with `npm test`.
- **Commit messages in normal prose**, imperative mood, ending with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

### Task 1: The effect contract and the pool

**Files:**
- Create: `src/fx/effect.ts`
- Create: `src/fx/effect-pool.ts`
- Create: `src/fx/effect-pool.test.ts`
- Modify: `src/fx/shockwave.ts` — re-type against the shared contract

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Effect { object: Object3D; advance(dt: number): boolean; dispose(): void }`
  - `interface EffectPool { add(effect: Effect): void; advance(dt: number): void; size(): number; dispose(): void }`
  - `createEffectPool(scene: Object3D, maxLive?: number): EffectPool`
  - `src/fx/shockwave.ts` keeps exporting the name `Shockwave`, now an alias of `Effect`.

- [ ] **Step 1: Write the failing test**

Create `src/fx/effect-pool.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Group, Object3D } from 'three'
import { createEffectPool } from './effect-pool'
import type { Effect } from './effect'

/**
 * A stand-in effect with a known lifetime and a disposal counter.
 *
 * Fakes rather than real effects on purpose: the thing under test is the lifecycle —
 * what gets removed, what gets disposed, and how many times — which real geometry would
 * only obscure.
 */
function fake(lifetime: number) {
  const object = new Object3D()
  let age = 0
  let disposals = 0
  const effect: Effect = {
    object,
    advance(dt: number): boolean {
      age += dt
      return age < lifetime
    },
    dispose(): void {
      disposals += 1
    },
  }
  return { effect, object, disposals: () => disposals }
}

describe('createEffectPool', () => {
  it('parents an added effect to the scene', () => {
    const scene = new Group()
    const pool = createEffectPool(scene)
    const a = fake(1)
    pool.add(a.effect)
    expect(scene.children).toContain(a.object)
    expect(pool.size()).toBe(1)
  })

  it('leaves a live effect alone', () => {
    const scene = new Group()
    const pool = createEffectPool(scene)
    const a = fake(1)
    pool.add(a.effect)
    pool.advance(0.1)
    expect(scene.children).toContain(a.object)
    expect(a.disposals()).toBe(0)
    expect(pool.size()).toBe(1)
  })

  it('removes and disposes a finished effect', () => {
    const scene = new Group()
    const pool = createEffectPool(scene)
    const a = fake(0.2)
    pool.add(a.effect)
    pool.advance(0.5)
    expect(scene.children).not.toContain(a.object)
    expect(a.disposals()).toBe(1)
    expect(pool.size()).toBe(0)
  })

  it('disposes a finished effect exactly once, however often it is advanced', () => {
    // A double dispose on a real effect would release geometry twice. Cheap to get
    // wrong by leaving the finished entry in the list.
    const scene = new Group()
    const pool = createEffectPool(scene)
    const a = fake(0.2)
    pool.add(a.effect)
    pool.advance(0.5)
    pool.advance(0.5)
    pool.advance(0.5)
    expect(a.disposals()).toBe(1)
  })

  it('removes every effect that finishes on the same frame', () => {
    // Regression guard on the reverse iteration: a forward loop with a splice skips
    // the entry after each removal, so the middle of three would survive.
    const scene = new Group()
    const pool = createEffectPool(scene)
    const all = [fake(0.1), fake(0.1), fake(0.1)]
    for (const f of all) pool.add(f.effect)
    pool.advance(0.5)
    expect(pool.size()).toBe(0)
    expect(scene.children.length).toBe(0)
    for (const f of all) expect(f.disposals()).toBe(1)
  })

  it('keeps the live ones when only some finish', () => {
    const scene = new Group()
    const pool = createEffectPool(scene)
    const short = fake(0.1)
    const long = fake(5)
    pool.add(short.effect)
    pool.add(long.effect)
    pool.advance(0.2)
    expect(pool.size()).toBe(1)
    expect(scene.children).toContain(long.object)
    expect(scene.children).not.toContain(short.object)
  })

  it('never grows past the cap', () => {
    const scene = new Group()
    const pool = createEffectPool(scene, 3)
    for (let i = 0; i < 10; i++) pool.add(fake(5).effect)
    expect(pool.size()).toBe(3)
    expect(scene.children.length).toBe(3)
  })

  it('evicts the oldest at the cap, not the newest', () => {
    // The oldest is the most faded, so dropping it is the least visible choice.
    // Dropping the newest would make a burst of hits show nothing at all.
    const scene = new Group()
    const pool = createEffectPool(scene, 2)
    const first = fake(5)
    const second = fake(5)
    const third = fake(5)
    pool.add(first.effect)
    pool.add(second.effect)
    pool.add(third.effect)

    expect(first.disposals()).toBe(1)
    expect(scene.children).not.toContain(first.object)
    expect(scene.children).toContain(second.object)
    expect(scene.children).toContain(third.object)
  })

  it('treats a cap below one as one, rather than looping forever', () => {
    // Guard on the eviction loop: a naive `while (size >= cap)` with cap 0 shifts an
    // empty list forever.
    const scene = new Group()
    const pool = createEffectPool(scene, 0)
    pool.add(fake(5).effect)
    pool.add(fake(5).effect)
    expect(pool.size()).toBe(1)
  })

  it('empties the scene and disposes everything on dispose', () => {
    const scene = new Group()
    const pool = createEffectPool(scene)
    const all = [fake(5), fake(5)]
    for (const f of all) pool.add(f.effect)
    pool.dispose()
    expect(pool.size()).toBe(0)
    expect(scene.children.length).toBe(0)
    for (const f of all) expect(f.disposals()).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/effect-pool.test.ts`
Expected: FAIL — cannot resolve `./effect-pool`.

- [ ] **Step 3: Write minimal implementation**

Create `src/fx/effect.ts`:

```ts
import type { Object3D } from 'three'

/**
 * A one-shot visual effect: created for an event, advanced each frame, then gone.
 *
 * `shockwave.ts` already had exactly this shape; naming it makes the pool possible and
 * stops the next effect from inventing a slightly different one. Effects own their
 * geometry and material, which is why `dispose` is part of the contract rather than an
 * afterthought — one is created per event, so a missed release accumulates.
 */
export interface Effect {
  object: Object3D
  /** Advance. Returns false once finished, so the caller can remove and dispose it. */
  advance(dt: number): boolean
  dispose(): void
}
```

Create `src/fx/effect-pool.ts`:

```ts
import type { Object3D } from 'three'
import type { Effect } from './effect'

/**
 * Owns the lifecycle of the live one-shot effects.
 *
 * This exists because `main.ts` was growing one hand-rolled reverse-iterating cull loop
 * per effect type, and a missed `dispose` in any of them leaks geometry for the session.
 * Taking a plain `Object3D` as the scene also makes the lifecycle testable with fakes,
 * which an inline loop in the frame function never was.
 */
export interface EffectPool {
  /** Add and parent to the scene. Evicts the oldest if the cap is already reached. */
  add(effect: Effect): void
  /** Advance every live effect, removing and disposing the finished ones. */
  advance(dt: number): void
  size(): number
  /** Remove and dispose everything still live. */
  dispose(): void
}

const DEFAULT_MAX_LIVE = 24

export function createEffectPool(scene: Object3D, maxLive = DEFAULT_MAX_LIVE): EffectPool {
  // Floored at one: a cap of zero would make the eviction loop shift an empty list
  // forever, and "no effects allowed" is not a state any caller wants.
  const cap = Math.max(1, Math.floor(maxLive))
  const live: Effect[] = []

  function retire(effect: Effect): void {
    scene.remove(effect.object)
    effect.dispose()
  }

  return {
    add(effect: Effect): void {
      // The oldest is the most faded, so dropping it is the least visible choice.
      // Dropping the newest would make a burst of hits show nothing at all.
      while (live.length >= cap) {
        const oldest = live.shift()
        if (!oldest) break
        retire(oldest)
      }
      scene.add(effect.object)
      live.push(effect)
    },

    advance(dt: number): void {
      // Backwards, so splicing cannot skip the entry after a removal.
      for (let i = live.length - 1; i >= 0; i--) {
        const effect = live[i]
        if (!effect) continue
        if (effect.advance(dt)) continue
        retire(effect)
        live.splice(i, 1)
      }
    },

    size(): number {
      return live.length
    },

    dispose(): void {
      for (const effect of live) retire(effect)
      live.length = 0
    },
  }
}
```

Then in `src/fx/shockwave.ts`, replace the `Shockwave` interface declaration with an alias and re-type the factory:

```ts
import type { Effect } from './effect'
```

```ts
/**
 * The ring a Pressure Wave leaves on the ground.
 *
 * ... (keep the existing doc comment)
 */
export type Shockwave = Effect
```

```ts
export function createShockwave(radius: number, strength: number): Effect {
```

If the typecheck then reports `Object3D` as an unused import in `shockwave.ts`, remove it. Change nothing else in that file — its tests must keep passing untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/fx/`
Expected: PASS, including `shockwave.test.ts` unchanged.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. In `advance`, iterate forwards (`for (let i = 0; i < live.length; i++)`) while still splicing. Expected: the "removes every effect that finishes on the same frame" test FAILS with a surviving entry. Revert.
2. In `advance`, remove the `live.splice(i, 1)` so finished entries stay. Expected: the "disposes exactly once" test FAILS with 3 disposals. Revert.
3. In `add`, evict from the end (`live.pop()`) instead of the front. Expected: the "evicts the oldest, not the newest" test FAILS. Revert.
4. In `retire`, drop the `scene.remove(...)`. Expected: the "removes and disposes a finished effect" test FAILS. Revert.
5. Replace `Math.max(1, ...)` with `maxLive` directly. Expected: the cap-below-one test fails on vitest's default 5-second timeout rather than on an assertion, because the eviction loop spins forever. A timeout is the proof here. Revert immediately.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: both passes clean, whole suite green.

- [ ] **Step 7: Commit**

```bash
git add src/fx/effect.ts src/fx/effect-pool.ts src/fx/effect-pool.test.ts src/fx/shockwave.ts
git commit -m "Extract the effect contract and give the effects a pool

shockwave.ts already had exactly the right interface; naming it makes a shared
pool possible and stops the next effect from inventing a slightly different one.

main.ts was growing one hand-rolled reverse-iterating cull loop per effect type,
and a missed dispose in any of them leaks geometry for the session. The pool takes
a plain Object3D as its scene, which also makes the lifecycle testable with fakes —
something an inline loop in the frame function never was.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The gust cone

**Files:**
- Create: `src/fx/gust-cone.ts`
- Create: `src/fx/gust-cone.test.ts`

**Interfaces:**
- Consumes: `Effect` from `./effect` (Task 1); `GustConfig` from `src/combat/gust.ts`; `inGust` from `src/combat/gust.ts` (test only).
- Produces: `createGustCone(origin: Vector3, forward: Vector3, c: GustConfig): Effect`

**The one hard part.** `RingGeometry` is authored in the XY plane with `theta` running anticlockwise from `+X`. Laying it flat and matching a `+Z` forward involves a rotation and an angular offset that are easy to get subtly wrong and impossible to see by eye — a cone rotated 90° off still looks like a cone. **The containment test in Step 1 is the authority on whether the orientation is right.** If it fails, the orientation is wrong, not the test.

The derivation to start from: with `rotation.x = -π/2`, a local pre-rotation point `(x, y, 0)` lands at `(x, 0, -y)`, so local `+Z` corresponds to pre-rotation `-Y`, i.e. `theta = -π/2`. Centring the span there gives `thetaStart = -π/2 - c.halfAngle`, `thetaLength = 2 * c.halfAngle`, with the group's `+Z` aimed along the heading by `lookAt`. If the test disagrees, try `+π/2` and re-run rather than guessing further.

- [ ] **Step 1: Write the failing test**

Create `src/fx/gust-cone.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Mesh, Quaternion, RingGeometry, Vector3 } from 'three'
import { createGustCone } from './gust-cone'
import { inGust } from '../combat/gust'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import type { Effect } from './effect'

const C = DEFAULT_COMBAT_CONFIG.gust
const ORIGIN = new Vector3(3, 12, -7)

/** The filled sector, which carries the true radius. children[0] by construction. */
function fill(cone: Effect): Mesh {
  const first = cone.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected the fill sector as children[0]')
  return first
}

function params(mesh: Mesh) {
  const geometry = mesh.geometry
  if (!(geometry instanceof RingGeometry)) throw new Error('expected a RingGeometry')
  return geometry.parameters
}

/**
 * Whether a point lies inside the sector as drawn.
 *
 * Deliberately asks the mesh's own world transform rather than reconstructing the
 * rotation: that way the test does not care HOW the orientation was achieved, only
 * whether the drawn shape and the hit test agree.
 */
function drawnContains(cone: Effect, point: Vector3): boolean {
  const mesh = fill(cone)
  cone.object.updateWorldMatrix(true, true)
  const local = mesh.worldToLocal(point.clone())
  const p = params(mesh)

  const radius = Math.hypot(local.x, local.y)
  if (radius > p.outerRadius) return false
  // Mirrors inGust's own degenerate-distance guard, so a point sitting exactly on the
  // caster does not depend on where the sector's theta happens to start.
  if (radius < 1e-6) return false

  let relative = Math.atan2(local.y, local.x) - p.thetaStart
  const turn = Math.PI * 2
  relative = ((relative % turn) + turn) % turn
  return relative <= p.thetaLength
}

describe('createGustCone', () => {
  it('draws exactly the volume the gust hits', () => {
    // The promise of this effect is that what you see is what you hit. Verified by a
    // different mechanism than the code uses — sampling the real hit test against the
    // drawn geometry's own transform — rather than by asserting the geometry equals the
    // config, which would pass for any orientation.
    const forward = new Vector3(0, 0, 1)
    const cone = createGustCone(ORIGIN, forward, C)
    // The cone is drawn at a fixed height above the origin; sample in that plane so the
    // 2D containment check is meaningful. `inGust` ignores height entirely.
    const y = fill(cone).getWorldPosition(new Vector3()).y

    const disagreements: string[] = []
    for (let dx = -14; dx <= 14; dx += 1) {
      for (let dz = -14; dz <= 14; dz += 1) {
        const point = new Vector3(ORIGIN.x + dx, y, ORIGIN.z + dz)
        const hit = inGust(ORIGIN, forward, point, C)
        const drawn = drawnContains(cone, point)
        if (hit !== drawn) disagreements.push(`(${dx},${dz}) hit=${hit} drawn=${drawn}`)
      }
    }
    // Named offenders, so a failure is a bug report rather than a puzzle.
    expect(disagreements.slice(0, 8)).toEqual([])
  })

  it('agrees with the hit test for a heading that is not an axis', () => {
    // An orientation bug can hide behind an axis-aligned heading.
    const forward = new Vector3(1, 0, 1).normalize()
    const cone = createGustCone(ORIGIN, forward, C)
    const y = fill(cone).getWorldPosition(new Vector3()).y

    const disagreements: string[] = []
    for (let dx = -14; dx <= 14; dx += 1) {
      for (let dz = -14; dz <= 14; dz += 1) {
        const point = new Vector3(ORIGIN.x + dx, y, ORIGIN.z + dz)
        if (inGust(ORIGIN, forward, point, C) !== drawnContains(cone, point)) {
          disagreements.push(`(${dx},${dz})`)
        }
      }
    }
    expect(disagreements.slice(0, 8)).toEqual([])
  })

  it('lies flat rather than standing up', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    cone.object.updateWorldMatrix(true, true)
    const rotation = new Quaternion()
    fill(cone).getWorldQuaternion(rotation)
    // A RingGeometry's own normal is local +Z; laid flat it must point up or down.
    const normal = new Vector3(0, 0, 1).applyQuaternion(rotation)
    expect(Math.abs(normal.y)).toBeCloseTo(1, 3)
  })

  it('sits above the origin so the ground does not swallow it', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    cone.object.updateWorldMatrix(true, true)
    expect(fill(cone).getWorldPosition(new Vector3()).y).toBeGreaterThan(ORIGIN.y)
  })

  it('drives the leading arc outward across its life', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    const arc = cone.object.children[1]
    if (!arc) throw new Error('expected a leading arc as children[1]')

    const start = arc.scale.x
    cone.advance(0.08)
    const mid = arc.scale.x
    cone.advance(1)
    const end = arc.scale.x

    expect(start).toBeLessThan(mid)
    expect(mid).toBeLessThan(end)
    // It should finish at the gust's actual reach, not somewhere short of it.
    expect(end).toBeCloseTo(C.range, 1)
  })

  it('runs and then finishes', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    expect(cone.advance(0.05)).toBe(true)
    expect(cone.advance(5)).toBe(false)
  })

  it('fades out', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    const material = fill(cone).material
    if (Array.isArray(material)) throw new Error('expected a single material')
    const start = material.opacity
    expect(start).toBeGreaterThan(0)
    cone.advance(0.2)
    expect(material.opacity).toBeLessThan(start)
  })

  it('casts no shadow', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    for (const child of cone.object.children) {
      expect(child.userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes without throwing', () => {
    const cone = createGustCone(ORIGIN, new Vector3(0, 0, 1), C)
    expect(() => cone.dispose()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/gust-cone.test.ts`
Expected: FAIL — cannot resolve `./gust-cone`.

- [ ] **Step 3: Write minimal implementation**

Create `src/fx/gust-cone.ts`:

```ts
import {
  DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, RingGeometry, Vector3,
} from 'three'
import type { GustConfig } from '../combat/gust'
import type { Effect } from './effect'

/**
 * The air a gust moves, drawn at the volume it actually affects.
 *
 * The honest visual here is a large one: the move really does sweep a 12-unit, 120-degree
 * wedge. A tidier, smaller puff would look better in isolation and teach the wrong
 * spacing — a hit landing outside the visible puff reads as a bug. So the filled sector
 * states the true reach at low opacity, and a brighter arc travels out through it to make
 * it read as a pulse of air rather than a wedge blinking on.
 */
const LIFETIME = 0.22
/** Above the player's origin, which is at their feet — a sector on the ground is hidden. */
const HEIGHT = 1
const FILL_OPACITY = 0.16
const ARC_OPACITY = 0.5
/** Arc thickness as a fraction of its own radius. */
const ARC_THICKNESS = 0.16
const SEGMENTS = 48
const TINT = 0xdff1ff

export function createGustCone(origin: Vector3, forward: Vector3, c: GustConfig): Effect {
  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  // Aim the group's +Z along the heading. Flattened, because inGust tests a flattened
  // heading — a cone tilted with a climbing glider would misrepresent the hit volume.
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() > 1e-8) {
    const at = group.position.clone().add(flat.normalize())
    group.lookAt(at)
  }

  // RingGeometry is authored in XY with theta anticlockwise from +X. After the -90°
  // rotation below, local +Z corresponds to pre-rotation -Y, i.e. theta = -PI/2, so the
  // span is centred there. gust-cone.test.ts's containment check is the authority on
  // this: if it disagrees, this offset is what is wrong.
  const thetaLength = 2 * c.halfAngle
  const thetaStart = -Math.PI / 2 - c.halfAngle

  const fillGeometry = new RingGeometry(0, c.range, SEGMENTS, 1, thetaStart, thetaLength)
  const fillMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: FILL_OPACITY,
  })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.rotation.x = -Math.PI / 2
  fill.userData.excludeFromShadows = true

  // A unit arc scaled at runtime, so travelling outward costs a scale rather than a
  // geometry rebuild sixty times a second.
  const arcGeometry = new RingGeometry(
    1 - ARC_THICKNESS, 1, SEGMENTS, 1, thetaStart, thetaLength,
  )
  const arcMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: ARC_OPACITY,
  })
  const arc = new Mesh(arcGeometry, arcMaterial)
  arc.rotation.x = -Math.PI / 2
  arc.userData.excludeFromShadows = true

  // Order matters to the tests and to the reader: the fill carries the true radius.
  group.add(fill)
  group.add(arc)

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    arc.scale.setScalar(Math.max(t * c.range, 1e-4))
    fillMaterial.opacity = FILL_OPACITY * (1 - t)
    // The arc brightens as it goes out, so the leading edge is what the eye follows.
    arcMaterial.opacity = ARC_OPACITY * (1 - t * t)
  }

  apply()

  return {
    object: group,
    advance(dt: number): boolean {
      age += dt
      apply()
      return age < LIFETIME
    },
    dispose(): void {
      fillGeometry.dispose()
      fillMaterial.dispose()
      arcGeometry.dispose()
      arcMaterial.dispose()
    },
  }
}
```

Note the arc starts at scale ~0, so its first-frame radius is near zero by design; the "drives the leading arc outward" test asserts growth from there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/fx/gust-cone.test.ts`
Expected: PASS.

**If the containment tests fail**, the orientation is wrong. Change `thetaStart` to `+Math.PI / 2 - c.halfAngle` and re-run. If both fail, print a few disagreeing points and work out the mapping from those rather than guessing — and record what you found in the report, because the next effect will hit the same problem.

**One legitimate exception, and only one.** If the disagreeing points are all within a hair of a boundary — right on the 12-unit rim, or exactly on the cone's edge — that is float noise on a tie, not an orientation bug. In that case, and only after confirming the disagreements are not a systematic rotation or a whole missing wedge, skip sample points whose distance to a boundary is under `1e-3`. A systematic offset produces dozens of disagreements in a coherent block; a tie produces one or two on a line. Do not reach for the epsilon first — it would hide exactly the bug this test exists to catch.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. Change `thetaStart` to `0`. Expected: BOTH containment tests FAIL with named disagreeing points. Revert.
2. Change the fill's `outerRadius` from `c.range` to `c.range * 0.5`. Expected: both containment tests FAIL. Revert.
3. Change `thetaLength` to `c.halfAngle` (half the true span). Expected: both containment tests FAIL. Revert.
4. Remove `fill.rotation.x = -Math.PI / 2`. Expected: the "lies flat" test FAILS. Revert.
5. Change the arc's final scale to `t * c.range * 0.5`. Expected: the "drives the leading arc outward" test FAILS on the final radius. Revert.

If neutralisation 1 or 3 does NOT fail, the containment test is not actually comparing what it claims — stop and report, because that test is the whole point of the task.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/fx/gust-cone.ts src/fx/gust-cone.test.ts
git commit -m "Draw the gust at the volume it actually hits

The honest visual is a large one: the move really does sweep a 12-unit,
120-degree wedge, and a tidier smaller puff would teach the wrong spacing — a hit
landing outside the visible puff reads as a bug.

The test samples points and compares the real hit test against the drawn
geometry's own world transform, so it verifies the promise by a different
mechanism than the code uses, and it does not care how the orientation was
achieved. That matters because RingGeometry is authored in XY with theta from +X
while the game's forward is +Z, and a cone rotated the wrong way still looks like
a cone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The dash trail

**Files:**
- Create: `src/fx/dash-trail.ts`
- Create: `src/fx/dash-trail.test.ts`

**Interfaces:**
- Consumes: `Effect` from `./effect` (Task 1); `GroundConfig` from `src/core/types.ts`.
- Produces: `createDashTrail(origin: Vector3, heading: Vector3, chain: number, c: GroundConfig): Effect`

- [ ] **Step 1: Write the failing test**

Create `src/fx/dash-trail.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Mesh, Quaternion, Vector3 } from 'three'
import { createDashTrail } from './dash-trail'
import { DEFAULT_GROUND_CONFIG } from '../core/config'
import type { GroundConfig } from '../core/types'
import type { Effect } from './effect'

const ORIGIN = new Vector3(0, 5, 0)
const HEADING = new Vector3(0, 0, 1)

function streak(trail: Effect): Mesh {
  const first = trail.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected a streak mesh')
  return first
}

const lengthOf = (trail: Effect) => streak(trail).scale.z

function opacityOf(trail: Effect): number {
  const material = streak(trail).material
  if (Array.isArray(material)) throw new Error('expected a single material')
  return material.opacity
}

describe('createDashTrail', () => {
  it('marks the distance the dash actually covers', () => {
    // Asserted by responsiveness rather than by restating the product: doubling the dash
    // speed must lengthen the streak, which a hardcoded length would not do.
    const fast: GroundConfig = { ...DEFAULT_GROUND_CONFIG, dashSpeed: DEFAULT_GROUND_CONFIG.dashSpeed * 2 }
    const normal = lengthOf(createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG))
    const doubled = lengthOf(createDashTrail(ORIGIN, HEADING, 1, fast))
    expect(doubled).toBeGreaterThan(normal * 1.8)
  })

  it('lengthens with a longer dash duration too', () => {
    const slowBurn: GroundConfig = {
      ...DEFAULT_GROUND_CONFIG,
      dashDurationSeconds: DEFAULT_GROUND_CONFIG.dashDurationSeconds * 2,
    }
    const normal = lengthOf(createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG))
    expect(lengthOf(createDashTrail(ORIGIN, HEADING, 1, slowBurn)))
      .toBeGreaterThan(normal * 1.8)
  })

  it('makes the last dash of the chain louder than the first', () => {
    // The chain count is information the player has no other way to read, so the third
    // burst has to look different from the first. A margin, not a bare comparison.
    const first = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    const last = createDashTrail(ORIGIN, HEADING, DEFAULT_GROUND_CONFIG.maxDashChain, DEFAULT_GROUND_CONFIG)
    expect(lengthOf(last)).toBeGreaterThan(lengthOf(first) * 1.2)
    expect(opacityOf(last)).toBeGreaterThan(opacityOf(first) * 1.2)
  })

  it('clamps a chain index outside the real range', () => {
    // Nothing should explode if a caller passes 0 or a number past the chain length.
    for (const chain of [0, -3, 99]) {
      const trail = createDashTrail(ORIGIN, HEADING, chain, DEFAULT_GROUND_CONFIG)
      expect(Number.isFinite(lengthOf(trail))).toBe(true)
      expect(lengthOf(trail)).toBeGreaterThan(0)
    }
  })

  it('points along the heading', () => {
    const trail = createDashTrail(ORIGIN, new Vector3(1, 0, 0), 1, DEFAULT_GROUND_CONFIG)
    trail.object.updateWorldMatrix(true, true)
    const rotation = new Quaternion()
    trail.object.getWorldQuaternion(rotation)
    // The streak is built along local +Z, so its world +Z must follow the heading.
    const along = new Vector3(0, 0, 1).applyQuaternion(rotation)
    expect(along.x).toBeCloseTo(1, 2)
    expect(Math.abs(along.z)).toBeLessThan(0.05)
  })

  it('runs and then finishes', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    expect(trail.advance(0.05)).toBe(true)
    expect(trail.advance(5)).toBe(false)
  })

  it('fades out', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    const start = opacityOf(trail)
    trail.advance(0.15)
    expect(opacityOf(trail)).toBeLessThan(start)
  })

  it('casts no shadow', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    expect(streak(trail).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    expect(() => trail.dispose()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/dash-trail.test.ts`
Expected: FAIL — cannot resolve `./dash-trail`.

- [ ] **Step 3: Write minimal implementation**

Create `src/fx/dash-trail.ts`:

```ts
import {
  BoxGeometry, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import type { GroundConfig } from '../core/types'
import type { Effect } from './effect'

/**
 * The streak an air blast dash leaves behind.
 *
 * Its length comes from the distance the dash actually covers, so the mark on the ground
 * is the ground the burst crossed. Its brightness and length also grow with the chain
 * index, which is not decoration: the chain count is information the player currently has
 * no way to read, and the recovery after the third dash is otherwise a mystery.
 */
const LIFETIME = 0.3
/** Off the ground, so terrain does not swallow it. */
const HEIGHT = 0.5
const WIDTH = 0.45
const THICKNESS = 0.12
const TINT = 0xd9f4ff
/** Length and opacity multipliers from the first dash of a chain to the last. */
const FIRST_LENGTH = 0.8
const LAST_LENGTH = 1.35
const FIRST_OPACITY = 0.3
const LAST_OPACITY = 0.62

export function createDashTrail(
  origin: Vector3,
  heading: Vector3,
  chain: number,
  c: GroundConfig,
): Effect {
  // Clamped, because a caller mis-reporting the chain index should look slightly wrong
  // rather than draw nothing or draw something enormous.
  const span = Math.max(1, c.maxDashChain - 1)
  const t = MathUtils.clamp((chain - 1) / span, 0, 1)

  const covered = c.dashSpeed * c.dashDurationSeconds
  const length = covered * MathUtils.lerp(FIRST_LENGTH, LAST_LENGTH, t)
  const peak = MathUtils.lerp(FIRST_OPACITY, LAST_OPACITY, t)

  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  const flat = new Vector3(heading.x, 0, heading.z)
  if (flat.lengthSq() > 1e-8) {
    group.lookAt(group.position.clone().add(flat.normalize()))
  }

  // A unit-length slab along +Z, scaled to the covered distance — so the streak can be
  // stretched without rebuilding geometry, and so tests can read the length off the scale.
  const geometry = new BoxGeometry(WIDTH, THICKNESS, 1)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false, opacity: peak,
  })
  const streak = new Mesh(geometry, material)
  streak.scale.z = length
  // Pushed forward by half its length so it starts at the origin rather than straddling it.
  streak.position.z = length / 2
  streak.userData.excludeFromShadows = true
  group.add(streak)

  let age = 0

  function apply(): void {
    const progress = MathUtils.clamp(age / LIFETIME, 0, 1)
    material.opacity = peak * (1 - progress)
  }

  apply()

  return {
    object: group,
    advance(dt: number): boolean {
      age += dt
      apply()
      return age < LIFETIME
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/fx/dash-trail.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. Replace `covered` with a hardcoded `6`. Expected: both "marks the distance" and "lengthens with a longer duration" tests FAIL. Revert.
2. Replace `MathUtils.lerp(FIRST_LENGTH, LAST_LENGTH, t)` with `1`. Expected: the "louder than the first" test FAILS on length. Revert.
3. Replace `peak` with a constant `0.5`. Expected: the same test FAILS on opacity. Revert.
4. Remove the `MathUtils.clamp(..., 0, 1)` on `t`. Expected: the clamp test FAILS for `chain: 99` or `-3`. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/fx/dash-trail.ts src/fx/dash-trail.test.ts
git commit -m "Give the air blast dash a streak that reads its chain

The length comes from the distance the dash actually covers, so the mark is the
ground the burst crossed, and both length and brightness grow with the chain
index. That last part is not decoration: the chain count is information the player
currently has no way to read, and the recovery after the third dash is otherwise a
mystery.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Impacts

**Files:**
- Create: `src/fx/impact.ts`
- Create: `src/fx/impact.test.ts`

**Interfaces:**
- Consumes: `Effect` from `./effect` (Task 1).
- Produces: `type ImpactKind = 'hit' | 'down'` and `createImpact(position: Vector3, kind: ImpactKind): Effect`

- [ ] **Step 1: Write the failing test**

Create `src/fx/impact.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { createImpact } from './impact'
import type { Effect } from './effect'

const AT = new Vector3(4, 9, -2)

function shell(impact: Effect): Mesh {
  const object = impact.object
  if (!(object instanceof Mesh)) throw new Error('expected a mesh')
  return object
}

/** Run to completion, returning how many frames it took. */
function framesToFinish(impact: Effect, dt = 1 / 60): number {
  let frames = 0
  while (impact.advance(dt) && frames < 1000) frames += 1
  return frames
}

const finalRadius = (impact: Effect) => {
  impact.advance(10)
  return shell(impact).scale.x
}

describe('createImpact', () => {
  it('lands on the body rather than at its feet', () => {
    expect(shell(createImpact(AT, 'hit')).position.y).toBeGreaterThan(AT.y)
  })

  it('keeps the horizontal position it was given', () => {
    const mesh = shell(createImpact(AT, 'hit'))
    expect(mesh.position.x).toBeCloseTo(AT.x)
    expect(mesh.position.z).toBeCloseTo(AT.z)
  })

  it('makes a down materially bigger than a hit', () => {
    // A down is the louder statement — it has to be distinguishable at a glance, not
    // just fractionally larger.
    expect(finalRadius(createImpact(AT, 'down')))
      .toBeGreaterThan(finalRadius(createImpact(AT, 'hit')) * 1.5)
  })

  it('makes a down last materially longer than a hit', () => {
    expect(framesToFinish(createImpact(AT, 'down')))
      .toBeGreaterThan(framesToFinish(createImpact(AT, 'hit')) * 1.5)
  })

  it('grows from small to full', () => {
    const impact = createImpact(AT, 'hit')
    const start = shell(impact).scale.x
    impact.advance(0.05)
    const mid = shell(impact).scale.x
    expect(start).toBeLessThan(mid)
  })

  it('fades out', () => {
    const impact = createImpact(AT, 'hit')
    const material = shell(impact).material
    if (Array.isArray(material)) throw new Error('expected a single material')
    const start = material.opacity
    expect(start).toBeGreaterThan(0)
    impact.advance(0.12)
    expect(material.opacity).toBeLessThan(start)
  })

  it('runs and then finishes, for both kinds', () => {
    for (const kind of ['hit', 'down'] as const) {
      const impact = createImpact(AT, kind)
      expect(impact.advance(0.01)).toBe(true)
      expect(impact.advance(5)).toBe(false)
    }
  })

  it('casts no shadow', () => {
    for (const kind of ['hit', 'down'] as const) {
      expect(shell(createImpact(AT, kind)).userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes without throwing', () => {
    expect(() => createImpact(AT, 'down').dispose()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/impact.test.ts`
Expected: FAIL — cannot resolve `./impact`.

- [ ] **Step 3: Write minimal implementation**

Create `src/fx/impact.ts`:

```ts
import {
  DoubleSide, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, Vector3,
} from 'three'
import type { Effect } from './effect'

/**
 * The burst where a blow lands.
 *
 * A connect and a down are deliberately different in kind, not just in size: a connect is
 * quick and tight, a down is broad and slow. Both are pale rather than red, because the
 * design document's non-lethality is meant to be encoded by the systems rather than
 * mentioned, and a red splash would say the opposite of what a downed enemy means.
 */
export type ImpactKind = 'hit' | 'down'

/** Above the enemy's own origin, which is at its feet. */
const HEIGHT = 0.9
const START_FRACTION = 0.25

interface Shape {
  radius: number
  lifetime: number
  opacity: number
  tint: number
}

const SHAPES: Record<ImpactKind, Shape> = {
  hit: { radius: 1.1, lifetime: 0.18, opacity: 0.55, tint: 0xdff1ff },
  down: { radius: 2.3, lifetime: 0.45, opacity: 0.4, tint: 0xfff3d8 },
}

export function createImpact(position: Vector3, kind: ImpactKind): Effect {
  const shape = SHAPES[kind]

  // A unit sphere scaled at runtime, so growing costs a scale rather than a rebuild.
  const geometry = new SphereGeometry(1, 18, 12)
  const material = new MeshBasicMaterial({
    color: shape.tint, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: shape.opacity,
  })

  const mesh = new Mesh(geometry, material)
  mesh.position.copy(position)
  mesh.position.y += HEIGHT
  mesh.userData.excludeFromShadows = true

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / shape.lifetime, 0, 1)
    mesh.scale.setScalar(MathUtils.lerp(START_FRACTION * shape.radius, shape.radius, t))
    material.opacity = shape.opacity * (1 - t)
  }

  apply()

  return {
    object: mesh,
    advance(dt: number): boolean {
      age += dt
      apply()
      return age < shape.lifetime
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/fx/impact.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. Set `down.radius` to `1.2`. Expected: the "materially bigger" test FAILS. Revert.
2. Set `down.lifetime` to `0.2`. Expected: the "lasts materially longer" test FAILS. Revert.
3. Remove the `+= HEIGHT`. Expected: the "lands on the body" test FAILS. Revert.
4. Set `START_FRACTION` to `1`. Expected: the "grows from small to full" test FAILS. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/fx/impact.ts src/fx/impact.test.ts
git commit -m "Show where a blow lands, and show a down differently

A connect is quick and tight; a down is broad and slow. Both are pale rather than
red, because the design document's non-lethality is meant to be encoded by the
systems rather than mentioned, and a red splash would say the opposite of what a
downed enemy means.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The Avatar State aura

**Files:**
- Create: `src/fx/avatar-aura.ts`
- Create: `src/fx/avatar-aura.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Deliberately NOT an `Effect` — it does not self-terminate.
- Produces:
  - `interface AvatarAura { object: Object3D; update(dt: number, active: boolean): void; dispose(): void }`
  - `createAvatarAura(): AvatarAura`

- [ ] **Step 1: Write the failing test**

Create `src/fx/avatar-aura.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Mesh } from 'three'
import { createAvatarAura, type AvatarAura } from './avatar-aura'

function shell(aura: AvatarAura): Mesh {
  const object = aura.object
  if (!(object instanceof Mesh)) throw new Error('expected a mesh')
  return object
}

function opacityOf(aura: AvatarAura): number {
  const material = shell(aura).material
  if (Array.isArray(material)) throw new Error('expected a single material')
  return material.opacity
}

/** Hold `active` for `seconds` at 60 Hz. */
function hold(aura: AvatarAura, seconds: number, active: boolean): void {
  for (let t = 0; t < seconds; t += 1 / 60) aura.update(1 / 60, active)
}

describe('createAvatarAura', () => {
  it('starts invisible, so it cannot flash before the state begins', () => {
    const aura = createAvatarAura()
    expect(opacityOf(aura)).toBe(0)
    expect(shell(aura).visible).toBe(false)
  })

  it('fades in while the state is active', () => {
    const aura = createAvatarAura()
    hold(aura, 0.3, true)
    expect(opacityOf(aura)).toBeGreaterThan(0.1)
    expect(shell(aura).visible).toBe(true)
  })

  it('fades back out when the state ends', () => {
    const aura = createAvatarAura()
    hold(aura, 0.3, true)
    const lit = opacityOf(aura)
    hold(aura, 0.6, false)
    expect(opacityOf(aura)).toBeLessThan(lit * 0.5)
  })

  it('winds down rather than cutting out', () => {
    // One frame of inactivity must not blank it — the state ending should read as a
    // fade, which is the whole reason this is not a one-shot effect.
    const aura = createAvatarAura()
    hold(aura, 0.5, true)
    aura.update(1 / 60, false)
    expect(opacityOf(aura)).toBeGreaterThan(0)
  })

  it('settles fully invisible once it has wound down', () => {
    const aura = createAvatarAura()
    hold(aura, 0.5, true)
    hold(aura, 3, false)
    expect(opacityOf(aura)).toBeCloseTo(0)
    expect(shell(aura).visible).toBe(false)
  })

  it('never leaves its opacity range, however long the frame', () => {
    const aura = createAvatarAura()
    aura.update(100, true)
    const peak = opacityOf(aura)
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(1)
    aura.update(100, false)
    expect(opacityOf(aura)).toBeGreaterThanOrEqual(0)
  })

  it('casts no shadow', () => {
    expect(shell(createAvatarAura()).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    expect(() => createAvatarAura().dispose()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/avatar-aura.test.ts`
Expected: FAIL — cannot resolve `./avatar-aura`.

- [ ] **Step 3: Write minimal implementation**

Create `src/fx/avatar-aura.ts`:

```ts
import {
  BackSide, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, type Object3D,
} from 'three'

/**
 * The shell of air around the character while the Avatar State runs.
 *
 * Deliberately not an Effect: an Effect self-terminates, and this lasts exactly as long as
 * the state does. It takes the shape the glider already uses instead — a long-lived child
 * of the avatar with an update that is told whether it should be showing.
 *
 * It must be added as a child of `avatar.object`, alongside the glider, and NOT of the
 * model. docs/HANDOFF.md records why: the model lives in an inner wrapper that absorbs
 * fitting and squash, and anything parented there would be squashed with it.
 */
export interface AvatarAura {
  object: Object3D
  /** Call every frame with whether the state is running. */
  update(dt: number, active: boolean): void
  dispose(): void
}

const RADIUS = 1.35
/** Centred on the character's middle, since the avatar's origin is at its feet. */
const HEIGHT = 1
const PEAK_OPACITY = 0.3
/** Snaps on, eases off — the state should arrive hard and leave as a wind-down. */
const FADE_IN_SECONDS = 0.15
const FADE_OUT_SECONDS = 0.4
const TINT = 0xfff3c4

export function createAvatarAura(): AvatarAura {
  const geometry = new SphereGeometry(RADIUS, 20, 14)
  const material = new MeshBasicMaterial({
    color: TINT,
    transparent: true,
    // Inside-out, so the shell reads as air around the character rather than a bubble
    // drawn over them.
    side: BackSide,
    depthWrite: false,
    opacity: 0,
  })

  const mesh = new Mesh(geometry, material)
  mesh.position.y = HEIGHT
  mesh.userData.excludeFromShadows = true
  mesh.visible = false

  /** 0 to 1, independent of the peak opacity so the fade curve is easy to reason about. */
  let lit = 0

  return {
    object: mesh,
    update(dt: number, active: boolean): void {
      const seconds = active ? FADE_IN_SECONDS : FADE_OUT_SECONDS
      const step = seconds > 0 ? dt / seconds : 1
      lit = MathUtils.clamp(active ? lit + step : lit - step, 0, 1)
      material.opacity = PEAK_OPACITY * lit
      // Skipped entirely when invisible, so it costs nothing the rest of the time.
      mesh.visible = lit > 0.001
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/fx/avatar-aura.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. Set the initial `opacity` to `PEAK_OPACITY` and `visible` to `true`. Expected: the "starts invisible" test FAILS. Revert.
2. Replace the eased `lit` with `lit = active ? 1 : 0`. Expected: the "winds down rather than cutting out" test FAILS. Revert.
3. Remove the `MathUtils.clamp`. Expected: the "never leaves its opacity range" test FAILS. Revert.
4. Set `mesh.visible = true` unconditionally. Expected: the "starts invisible" and "settles fully invisible" tests FAIL. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/fx/avatar-aura.ts src/fx/avatar-aura.test.ts
git commit -m "Put the Avatar State on the character, not just the screen edge

Deliberately not an Effect: an Effect self-terminates and this lasts as long as
the state does, so it takes the shape the glider already uses — a long-lived child
of the avatar with an update that is told whether it should be showing.

It snaps on and eases off, because the state should arrive hard and leave as a
wind-down rather than a cut.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire it all in

**Files:**
- Modify: `src/main.ts`
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: `createEffectPool` (`./fx/effect-pool`), `createGustCone` (`./fx/gust-cone`), `createDashTrail` (`./fx/dash-trail`), `createImpact` (`./fx/impact`), `createAvatarAura` (`./fx/avatar-aura`). `canGust` is already imported in `main.ts`.
- Produces: nothing further.

- [ ] **Step 1: Replace the shockwave array with the pool**

`main.ts` currently has, near the other mutable state:

```ts
  /** Live shockwave rings, culled as they finish. One is created per slam. */
  const shockwaves: Shockwave[] = []
```

Replace with:

```ts
  /** Every live one-shot effect. The pool owns removal and disposal. */
  const effects = createEffectPool(scene)
```

Remove the now-unused `Shockwave` type import.

Where the slam currently does:

```ts
      ring.object.position.copy(player.position)
      scene.add(ring.object)
      shockwaves.push(ring)
```

replace the last two lines with `effects.add(ring)`.

Delete the cull loop entirely:

```ts
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const ring = shockwaves[i]
      if (!ring || ring.advance(dt)) continue
      scene.remove(ring.object)
      ring.dispose()
      shockwaves.splice(i, 1)
    }
```

and put `effects.advance(dt)` in its place.

- [ ] **Step 2: Add the aura**

Beside where the glider is attached:

```ts
  const aura = createAvatarAura()
  // A child of avatar.object, alongside the glider — never of the model, which lives in
  // an inner wrapper that absorbs the fitting and squash transforms.
  avatar.object.add(aura.object)
```

And in `update`, beside `glider.update(...)`:

```ts
    aura.update(dt, avatarActive)
```

- [ ] **Step 3: Fire the gust cone**

The `stepEncounter` call currently builds its config inline. Hoist it into a `const`
immediately before, so the cone and the fight are guaranteed to be reading the same object,
then add the gust check:

```ts
    // Hoisted so the drawn cone and the resolved gust cannot read different configs.
    // During the Avatar State the gust's reach and cooldown differ from the base config,
    // and a cone drawn from the base one would misrepresent what the fight just did.
    const fightConfig = boostedCombatConfig(
      DEFAULT_COMBAT_CONFIG, avatarActive, DEFAULT_AVATAR_STATE_CONFIG,
    )

    // Asked against the pre-step encounter, so the visual agrees with what stepEncounter
    // will actually do on this same frame rather than a frame late.
    if (state.gustPressed && canGust(encounter)) {
      effects.add(createGustCone(player.position, player.forward, fightConfig.gust))
    }
```

Then change the `stepEncounter` call's last argument from the inline
`boostedCombatConfig(...)` to `fightConfig`.

- [ ] **Step 4: Fire the dash trail**

After `controllerStep` and the slam block, where `beforeStep` is still in scope:

```ts
    // A dash fired iff the chain advanced this frame. Read across the step, the same way
    // the slam is, so no movement code has to report anything.
    if (player.dashesUsed > beforeStep.dashesUsed) {
      effects.add(createDashTrail(
        beforeStep.position, player.velocity, player.dashesUsed, DEFAULT_GROUND_CONFIG,
      ))
    }
```

The heading is the post-dash velocity, which is the direction the burst pushed; the origin is the pre-step position, which is where it started.

- [ ] **Step 5: Fire the impacts**

After `encounter = fight.encounter` and the enemy view sync:

```ts
    // A down and a connect both name an enemy that went down this frame, because the two
    // lists are computed at different moments. The down is the louder statement, so it
    // wins and the connect is dropped.
    const downedNow = new Set(fight.downedThisFrame)
    const positionOf = (id: string) => encounter.enemies.find((e) => e.id === id)?.position
    for (const id of new Set([...fight.hitThisFrame, ...fight.slamHitThisFrame])) {
      if (downedNow.has(id)) continue
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'hit'))
    }
    for (const id of fight.downedThisFrame) {
      const at = positionOf(id)
      if (at) effects.add(createImpact(at, 'down'))
    }
```

- [ ] **Step 6: Verify it builds and the suite is green**

Run: `npm test && npm run typecheck && npm run build`
Expected: whole suite green, both typecheck passes clean, build succeeds.

- [ ] **Step 7: Play it**

Start the dev server through the preview tooling; never `npm run dev` in a shell. The launch configuration is `airbender-dev` (a config named `airbender-skies-dev` also exists in the project's own `.claude/launch.json` — use whichever the tooling resolves).

**Read the "preview pane" section of `docs/HANDOFF.md` FIRST.** The pane reports
`document.visibilityState === 'hidden'`, so `requestAnimationFrame` is suspended and the
game will look frozen. That section documents the synthetic-clock technique for driving the
game's own loop, which is the only way to see an effect that lives for 0.2 seconds. Dispatch
`KeyboardEvent`s on `window` for input, and reload afterwards to discard the patch.

Because these effects are short-lived, **step the clock in small increments and screenshot
mid-effect** rather than driving 60 frames and looking afterwards — by then everything has
faded.

Check, in order:

1. Press `F` on the ground: a wide translucent wedge appears ahead of the character, with a
   brighter arc travelling outward through it, gone within about a quarter second.
2. The wedge points where the character faces — turn, gust again, confirm it follows.
3. Press `Q`: a streak appears along the dash direction. Do all three of the chain and
   confirm the third is visibly longer and brighter than the first.
4. Gust into the home-island patrol: a small burst appears on each enemy the gust connects
   with, and none on an enemy out of range.
5. Keep gusting until one goes down: the down produces the bigger, paler burst, and that
   enemy does not also get a small one on the same frame.
6. Slam into the patrol (`Ctrl` held through a fast landing): the shockwave ring still
   works exactly as before, and impacts appear on the enemies it catches.
7. Trigger the Avatar State (`E` with the pip full): a shell appears around the character,
   holds for the duration, and fades out over roughly a third of a second rather than
   snapping off.
8. With many effects live at once (gust repeatedly into the patrol), nothing accumulates —
   after a few seconds of quiet the scene child count returns to what it was. Measure this
   rather than eyeballing it: record `scene.children.length` before, during and after.

Record what you actually observe, not what you expect. If a check fails, report it rather
than working around it.

- [ ] **Step 8: Update the handoff**

Add to `docs/HANDOFF.md` under "What has been built", after the action guide paragraph:

```markdown
**Combat visuals.** `src/fx/` holds the effects layer: a shared `Effect` contract and an
`EffectPool` that owns add, advance, cull and dispose for every one-shot effect, plus a
gust cone drawn at the move's *true* 12-unit, 120-degree hit volume, a dash streak whose
length and brightness read the chain index, impact bursts that distinguish a connect from
a down, and an Avatar State aura on the character. Every trigger reads a signal the game
already produced, so no movement or combat code changed. The cone's honesty is tested by
sampling points and comparing the drawn sector against `inGust` — a different mechanism
from the one the code uses. Spec at
[`docs/superpowers/specs/2026-08-03-combat-visuals-design.md`](superpowers/specs/2026-08-03-combat-visuals-design.md).
```

Also add the effect lifetimes and opacities to the untested-tuning list, noting that the
gust cone's size is deliberate rather than a value to shrink.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts docs/HANDOFF.md
git commit -m "Wire the combat visuals into the game

The shockwave array and its hand-rolled cull loop are gone; the pool owns every
one-shot effect now.

Two triggers read across controllerStep rather than asking a system to report:
the gust cone fires on the pre-step encounter so it agrees with what stepEncounter
does on the same frame, and a dash is detected by its chain advancing. The gust
cone is built from the boosted config, because during the Avatar State the base
config would draw a cone the fight is not using.

An enemy downed this frame appears in both the connect list and the downed list,
since the two are computed at different moments. The down wins.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done when

- `npm test` green, `npm run typecheck` clean on both passes, `npm run build` clean.
- Every "prove the tests are not decorative" step has been run and reverted — including
  Task 1's fifth, which proves itself by hanging rather than failing.
- The eight play checks in Task 6 Step 7 have actually been performed, with check 8's
  child-count measured rather than eyeballed.
- `docs/HANDOFF.md` describes the effects layer.
- All work is on `combat-visuals`. `main` is untouched.

## Out of scope

Carried over from the spec:

- No visual for airbending thrust or hover — they are movement, not attacks, and they run
  continuously.
- No enemy strike visual; the spear already lifts on the wind-up telegraph.
- No object pooling for reuse. Effects are created per event and disposed, matching
  `createShockwave`. Pooling is the follow-up if a profile shows churn.
- No screen shake, hit-stop, or damage numbers.
- No per-attack audio.
