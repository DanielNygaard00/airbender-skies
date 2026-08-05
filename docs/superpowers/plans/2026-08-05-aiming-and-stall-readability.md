# Aiming and stall readability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player see where a gust will go before firing it, and see that the glider has stalled.

**Architecture:** The sector geometry that `gust-cone.ts` already builds moves into a shared module so the preview cannot drift from the fired cone. A persistent `AimTell` — the shape `VortexChargeTell` already uses — draws a ground marker along `player.forward` plus the true cone, shown only when a live soldier is inside it. A pure `stallSeverity` mirrors the flight model's own `stallFactor` and drives both a reddening airspeed readout and a procedural wing shudder composed inside `glider.ts`'s `apply()`.

**Tech Stack:** TypeScript 7, three.js 0.185.1, Vitest 4 (node environment), Vite 8.

Spec: [`docs/superpowers/specs/2026-08-05-aiming-and-stall-readability-design.md`](../specs/2026-08-05-aiming-and-stall-readability-design.md)

## Global Constraints

- **Branch is `aiming-readability`. Never commit to `main`** — pushing `main` triggers the GitHub Pages deploy in `.github/workflows/deploy.yml`.
- **Typecheck is two passes:** `npm run typecheck` runs `tsconfig.json` then `tsconfig.test.json`. App code deliberately cannot see Node globals; only tests can. Run it after every task.
- **`noUncheckedIndexedAccess` is on.** Indexed access is `T | undefined`.
- **Red-proof every test.** After writing a test, neutralise the feature and confirm it goes red. This repo has shipped fourteen tests that could not fail; the last cycle found four more in its own plan. If a test stays green under neutralisation, the test is wrong, not the code.
- **Assert intended literals, never the config the code reads.** `expect(x).toBe(c.previewOpacity)` passes for any value.
- **No bare `>` for "materially bigger" claims.** Assert a margin.
- **Verify a fixture actually produces the state it asserts.** Three fixtures in the last plan asserted events that never occurred — a brink 0.1 m above a floor that needs 18 frames to reach, a void floor needing 19, and a two-spawn fixture where `every` and `some` were indistinguishable. Do the arithmetic before trusting a number in this plan.
- **Struct widening — the verified blast radius for this cycle:**
  - `glider.update` gains a **required** fourth argument, so **three call sites break**: `src/main.ts:423`, `src/player/glider-mesh.test.ts:17` and `:147`, and `src/player/avatar.test.ts:389`. (The spec named only two of these; `avatar.test.ts` was found while planning.)
  - `HudModel.stall` is an output and `hudModelFor` takes it as an optional fifth argument, so nothing breaks — `hud.test.ts` calls `hudModelFor` and never builds a `HudModel` literal.
  - `sector.ts`, `stall.ts`, `aim-tell.ts` and `liveGustTargets` are all additive.
  - Re-run both typecheck passes after each struct change rather than trusting this list.
- **A concurrent session may be editing `src/main.ts` and `src/ui/hud.ts`** for unrelated work on player health at zero. If either file is not as this plan describes, stop and report rather than forcing an edit.
- **Run one test file with** `npx vitest run src/path/to/file.test.ts`. Everything: `npm test`. The branch starts at **1102 tests across 76 files**.
- **Prose in code, comments, commits and docs is normal English.** Explain *why*; mark regression guards as such.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/fx/sector.ts` (new) | The theta maths and geometry for a flat cone sector. One definition, two consumers. |
| `src/fx/gust-cone.ts` (mod) | Refactored to call `sector.ts` instead of computing theta itself. |
| `src/combat/gust.ts` (mod) | `liveGustTargets` — the cone query with downed soldiers filtered out. |
| `src/fx/aim-tell.ts` (new) | The persistent ground marker and cone preview. |
| `src/fx/config.ts` (mod) | `DEFAULT_AIM_TELL_CONFIG`. |
| `src/player/stall.ts` (new) | `stallSeverity`, including the posture gate. |
| `src/ui/hud.ts` (mod) | `HudModel.stall`; the airspeed readout reddens. |
| `src/player/glider.ts` (mod) | The wing shudder, composed inside `apply()`. |
| `src/main.ts` (mod) | Wiring. Untested by design, so it holds no rules. |
| `docs/HANDOFF.md` (mod) | New sections and honest caveats. |

---

### Task 1: One definition of a flat cone sector

**Files:**
- Create: `src/fx/sector.ts`
- Modify: `src/fx/gust-cone.ts:47-80`
- Test: `src/fx/sector.test.ts`

**Interfaces:**
- Consumes: `inCone` and `ConeShape` from `src/combat/cone.ts` (test only).
- Produces: `SECTOR_SEGMENTS: number`, `SECTOR_FLAT_ROTATION_X: number`, `sectorTheta(halfAngle: number): { thetaStart: number; thetaLength: number }`, `sectorGeometry(halfAngle: number, innerRadius: number, outerRadius: number): RingGeometry`.

`src/fx/gust-cone.ts` currently computes `thetaStart = -Math.PI / 2 - c.halfAngle` with a comment admitting the offset is subtle enough that only `gust-cone.test.ts` can adjudicate it. Task 3 needs the same sector, and a second copy of that line would drift into a silent aiming error.

- [ ] **Step 1: Write the failing test**

`src/fx/sector.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry, sectorTheta } from './sector'
import { inCone, type ConeShape } from '../combat/cone'

const ORIGIN = new Vector3(0, 0, 0)
const FORWARD = new Vector3(0, 0, 1)

/**
 * Where a point at pre-rotation angle `theta` ends up once the sector is laid flat.
 *
 * Derived rather than copied from the implementation: a rotation of -PI/2 about X maps
 * (x, y, z) to (x, z, -y), so a point at (cos t, sin t, 0) in the authored XY plane lands
 * at (cos t, 0, -sin t) in the world. This is the mapping the whole convention rests on,
 * and expressing it here rather than importing it is what makes the test independent.
 */
function flattened(theta: number, radius: number): Vector3 {
  return new Vector3(Math.cos(theta) * radius, 0, -Math.sin(theta) * radius)
}

describe('the flat-sector convention', () => {
  it('lays a sector flat by a quarter turn backwards about X', () => {
    expect(SECTOR_FLAT_ROTATION_X).toBeCloseTo(-Math.PI / 2)
  })

  it('centres the span on +Z once flat', () => {
    // The midpoint of the span must map to the heading itself. If this is wrong, every
    // cone in the game is drawn rotated away from the volume it claims to show.
    const halfAngle = Math.PI / 3
    const { thetaStart, thetaLength } = sectorTheta(halfAngle)
    const mid = flattened(thetaStart + thetaLength / 2, 1)
    expect(mid.x).toBeCloseTo(0)
    expect(mid.z).toBeCloseTo(1)
  })

  it('spans exactly twice the half angle', () => {
    expect(sectorTheta(Math.PI / 3).thetaLength).toBeCloseTo((2 * Math.PI) / 3)
    expect(sectorTheta(Math.PI / 6).thetaLength).toBeCloseTo(Math.PI / 3)
  })

  it('puts its edges exactly the half angle off the heading', () => {
    const halfAngle = Math.PI / 5
    const { thetaStart, thetaLength } = sectorTheta(halfAngle)
    for (const theta of [thetaStart, thetaStart + thetaLength]) {
      expect(flattened(theta, 1).angleTo(FORWARD)).toBeCloseTo(halfAngle)
    }
  })
})

describe('the drawn span agrees with the hit test', () => {
  // The same cross-check gust-cone.test.ts uses on the fired cone, applied to the helper:
  // compare the drawn sector against inCone, which decides membership by a completely
  // different mechanism (a dot product against the heading).
  const shape: ConeShape = { range: 12, halfAngle: Math.PI / 3 }

  it('marks every direction inside the span as inside the cone', () => {
    const { thetaStart, thetaLength } = sectorTheta(shape.halfAngle)
    // Inset from the edges, so floating point at the boundary is not what is under test.
    for (let i = 1; i < 20; i++) {
      const theta = thetaStart + (thetaLength * i) / 20
      const point = flattened(theta, shape.range * 0.5)
      expect(inCone(ORIGIN, FORWARD, point, shape), `theta ${theta}`).toBe(true)
    }
  })

  it('marks directions outside the span as outside the cone', () => {
    const { thetaStart, thetaLength } = sectorTheta(shape.halfAngle)
    for (const theta of [thetaStart - 0.15, thetaStart + thetaLength + 0.15]) {
      const point = flattened(theta, shape.range * 0.5)
      expect(inCone(ORIGIN, FORWARD, point, shape), `theta ${theta}`).toBe(false)
    }
  })
})

describe('the geometry', () => {
  it('reaches exactly the outer radius', () => {
    const geometry = sectorGeometry(Math.PI / 3, 0, 12)
    // The farthest vertex from the apex, NOT computeBoundingSphere. three.js centres that
    // sphere on the bounding-box centroid rather than on the wedge's apex, so for a wedge
    // it reports radius * sqrt(5/4 - cos(halfAngle)) — about 0.866 of the truth at a
    // 60-degree half angle, and only exact near 75.5 degrees. Measuring the vertices tests
    // the property the comment claims: that the geometry is built at the radius asked for.
    // A literal 12, not the argument echoed back.
    const positions = geometry.getAttribute('position')
    let reach = 0
    for (let i = 0; i < positions.count; i++) {
      reach = Math.max(reach, Math.hypot(positions.getX(i), positions.getY(i)))
    }
    expect(reach).toBeCloseTo(12, 1)
    geometry.dispose()
  })

  it('leaves a hole when given an inner radius', () => {
    // The arc in gust-cone.ts is a ring, not a wedge, so this parameter has to work.
    const ring = sectorGeometry(Math.PI / 3, 0.84, 1)
    const positions = ring.getAttribute('position')
    let closest = Infinity
    for (let i = 0; i < positions.count; i++) {
      closest = Math.min(closest, Math.hypot(positions.getX(i), positions.getY(i)))
    }
    expect(closest).toBeCloseTo(0.84, 5)
    ring.dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/sector.test.ts`
Expected: FAIL — cannot resolve `./sector`.

- [ ] **Step 3: Write the module**

`src/fx/sector.ts`:

```ts
import { RingGeometry } from 'three'

/**
 * The shape of a horizontal cone, as geometry.
 *
 * Extracted from `gust-cone.ts` because the aim preview draws the same sector and a second
 * copy of the theta offset below would drift — silently, since a rotated cone still looks
 * like a cone. `gust-cone.test.ts`'s containment check against `inGust` remains the
 * independent authority on whether the convention here is right.
 */
export const SECTOR_SEGMENTS = 48

/**
 * The rotation that lays a sector flat, exported so no caller has to remember the sign.
 *
 * RingGeometry is authored in the XY plane. A rotation of -PI/2 about X maps (x, y, z) to
 * (x, z, -y), so the authored plane becomes the ground and the authored +Y becomes world -Z.
 */
export const SECTOR_FLAT_ROTATION_X = -Math.PI / 2

/**
 * Theta for a sector centred on local +Z once laid flat.
 *
 * RingGeometry measures theta anticlockwise from +X. Under the mapping above, world +Z
 * corresponds to authored -Y, which is theta = -PI/2 — so the span is centred there rather
 * than at zero. Getting this wrong draws every cone in the game rotated a quarter turn from
 * the volume it claims to show.
 */
export function sectorTheta(halfAngle: number): { thetaStart: number; thetaLength: number } {
  return { thetaStart: -Math.PI / 2 - halfAngle, thetaLength: 2 * halfAngle }
}

/** `innerRadius` 0 gives a filled wedge; a positive one gives an arc band. */
export function sectorGeometry(
  halfAngle: number, innerRadius: number, outerRadius: number,
): RingGeometry {
  const { thetaStart, thetaLength } = sectorTheta(halfAngle)
  return new RingGeometry(
    innerRadius, outerRadius, SECTOR_SEGMENTS, 1, thetaStart, thetaLength,
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/fx/sector.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `gust-cone.ts` onto the shared helper**

In `src/fx/gust-cone.ts`, delete the local `SEGMENTS` constant and the two theta lines, and replace the geometry construction:

```ts
  const fillGeometry = sectorGeometry(c.halfAngle, 0, c.range)
```

```ts
  const arcGeometry = sectorGeometry(c.halfAngle, 1 - ARC_THICKNESS, 1)
```

and both `rotation.x` assignments:

```ts
  fill.rotation.x = SECTOR_FLAT_ROTATION_X
```

```ts
  arc.rotation.x = SECTOR_FLAT_ROTATION_X
```

Import `SECTOR_FLAT_ROTATION_X` and `sectorGeometry` from `./sector`. Keep the module's existing comment about the offset, but change it to point at `sector.ts` as where the convention now lives.

- [ ] **Step 6: Confirm the refactor changed no behaviour**

Run: `npx vitest run src/fx/gust-cone.test.ts`
Expected: PASS, with **no edits to that test file**. It samples points and compares the drawn sector against `inGust` by a different mechanism than the code uses, so it is the real gate on this refactor. If it fails, the refactor is wrong — do not adjust the test.

- [ ] **Step 7: Red-proof the convention**

Change `sectorTheta`'s `thetaStart` to `-halfAngle` (dropping the `-PI/2`).

Run: `npx vitest run src/fx/sector.test.ts src/fx/gust-cone.test.ts`
Expected: FAIL in both files — "centres the span on +Z once flat" and the containment checks. Two independent files catching one mistake is the point. Revert and confirm PASS.

- [ ] **Step 8: Full suite, typecheck, commit**

```bash
npm test
npm run typecheck
git add src/fx/sector.ts src/fx/sector.test.ts src/fx/gust-cone.ts
git commit -m "Give the cone sector one definition, shared by the fired cone and the preview"
```

---

### Task 2: A live-target query

**Files:**
- Modify: `src/combat/gust.ts`
- Test: `src/combat/gust.test.ts`

**Interfaces:**
- Consumes: `inGust`, `Enemy`, `GustConfig`, all already in scope in that file.
- Produces: `liveGustTargets(origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: GustConfig): Enemy[]`.

`gustTargets` deliberately does not filter downed soldiers — `stepEncounter` applies that filter itself, so that "connected" means a live enemy took the hit rather than a body being blown around the island. The preview needs the same distinction, and "is a live enemy inside the cone" is a rule, so it belongs beside the query it wraps rather than as a `.filter()` in the untested `main.ts`.

- [ ] **Step 1: Write the failing test**

Add to `src/combat/gust.test.ts`, using that file's existing fixture helpers for an enemy and a config — read the top of the file and use its real names rather than inventing new ones:

```ts
describe('only the soldiers still standing', () => {
  it('includes a live enemy inside the cone', () => {
    const live = enemyAt(new Vector3(0, 0, -4))
    expect(liveGustTargets(ORIGIN, NORTH, [live], C).map((e) => e.id)).toEqual([live.id])
  })

  it('excludes a downed enemy inside the cone', () => {
    // The whole reason this function exists next to gustTargets. A preview that lights up
    // for a body is a preview that lies about what a gust would achieve.
    const corpse = { ...enemyAt(new Vector3(0, 0, -4)), health: { current: 0, max: 1.5, sinceHit: 0 } }
    expect(liveGustTargets(ORIGIN, NORTH, [corpse], C)).toEqual([])
  })

  it('excludes a live enemy outside the cone', () => {
    const behind = enemyAt(new Vector3(0, 0, 4))
    expect(liveGustTargets(ORIGIN, NORTH, [behind], C)).toEqual([])
  })

  it('keeps only the live ones from a mixed group', () => {
    const live = enemyAt(new Vector3(0, 0, -4))
    const corpse = { ...enemyAt(new Vector3(1, 0, -4)), id: 'corpse', health: { current: 0, max: 1.5, sinceHit: 0 } }
    const far = { ...enemyAt(new Vector3(0, 0, -400)), id: 'far' }
    const caught = liveGustTargets(ORIGIN, NORTH, [live, corpse, far], C).map((e) => e.id)
    expect(caught).toEqual([live.id])
  })

  it('agrees with gustTargets when nobody is down', () => {
    // Derived rather than restated: with every enemy healthy the two must return the same
    // set, which pins that this function adds a filter and changes nothing else.
    const group = [
      enemyAt(new Vector3(0, 0, -4)),
      { ...enemyAt(new Vector3(3, 0, -5)), id: 'b' },
      { ...enemyAt(new Vector3(0, 0, 6)), id: 'behind' },
    ]
    expect(liveGustTargets(ORIGIN, NORTH, group, C).map((e) => e.id))
      .toEqual(gustTargets(ORIGIN, NORTH, group, C).map((e) => e.id))
  })
})
```

Adjust the fixture names to whatever `gust.test.ts` already uses. If it has no per-enemy helper, build one from `spawnEnemy(id, position, enemyConfig)` in `src/combat/enemy.ts` and note it in your report.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/gust.test.ts`
Expected: FAIL — `liveGustTargets` is not exported.

- [ ] **Step 3: Write the function**

Append to `src/combat/gust.ts`:

```ts
/**
 * Everyone a gust would catch who is still standing.
 *
 * `gustTargets` deliberately does not filter downed enemies — `stepEncounter` applies that
 * filter itself so that "connected" means a live soldier took the hit rather than a body
 * being blown around the island. The aim preview needs the same distinction: a preview that
 * lights up for a corpse promises something a gust cannot deliver.
 *
 * A separate name rather than a boolean parameter, because `gustTargets(o, f, e, c, true)`
 * at a call site says nothing about what the flag means.
 */
export function liveGustTargets(
  origin: Vector3,
  forward: Vector3,
  enemies: readonly Enemy[],
  c: GustConfig,
): Enemy[] {
  return gustTargets(origin, forward, enemies, c).filter((enemy) => !isDowned(enemy.health))
}
```

Add `isDowned` to the file's import from `./health` if it is not already there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/combat/gust.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-proof the filter**

Delete the `.filter(...)` so the function just returns `gustTargets(...)`.

Run: `npx vitest run src/combat/gust.test.ts`
Expected: FAIL on "excludes a downed enemy inside the cone" and "keeps only the live ones from a mixed group". The "agrees with gustTargets" test must stay GREEN — if it goes red, it is testing the wrong thing. Revert and confirm PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/combat/gust.ts src/combat/gust.test.ts
git commit -m "Ask which soldiers a gust would catch who are still standing"
```

---

### Task 3: The aim tell

**Files:**
- Create: `src/fx/aim-tell.ts`
- Modify: `src/fx/config.ts`
- Test: `src/fx/aim-tell.test.ts`

**Interfaces:**
- Consumes: `sectorGeometry`, `SECTOR_FLAT_ROTATION_X` from Task 1; `GustConfig` from `src/combat/gust.ts`.
- Produces: `AimTellConfig { markerDistance, markerSize, previewOpacity, dimmedFactor }`, `DEFAULT_AIM_TELL_CONFIG`, `AimTell { object, update(position, forward, targeted, ready, c), dispose() }`, `createAimTell(c?: AimTellConfig): AimTell`.

Persistent, not an `Effect` — it lives as long as the player does. The shape is `createVortexChargeTell`'s in `src/fx/vortex-charge.ts`, which exists for the same reason and says so in its own doc comment. Read that file first.

- [ ] **Step 1: Write the failing test**

`src/fx/aim-tell.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { createAimTell } from './aim-tell'
import { DEFAULT_AIM_TELL_CONFIG } from './config'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { inCone } from '../combat/cone'

const GUST = DEFAULT_COMBAT_CONFIG.gust
const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)

/** The preview sector and the marker, by name, so a test cannot grab the wrong one. */
function parts(tell: { object: { getObjectByName(name: string): unknown } }) {
  const preview = tell.object.getObjectByName('aim-preview') as Mesh
  const marker = tell.object.getObjectByName('aim-marker') as Mesh
  if (!preview || !marker) throw new Error('the aim tell must name its two children')
  return { preview, marker }
}

describe('the marker', () => {
  it('always shows, whether or not anything is in range', () => {
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, false, true, GUST)
    expect(parts(tell).marker.visible).toBe(true)
    tell.dispose()
  })

  it('sits ahead of the player along the heading', () => {
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, false, true, GUST)
    const world = parts(tell).marker.getWorldPosition(new Vector3())
    // Along -Z because that is the heading given. A marker that ignored `forward` would
    // sit at the origin and this would catch it.
    expect(world.z).toBeCloseTo(-DEFAULT_AIM_TELL_CONFIG.markerDistance, 2)
    expect(world.x).toBeCloseTo(0, 2)
    tell.dispose()
  })

  it('follows the heading round, not just the position', () => {
    const tell = createAimTell()
    tell.update(ORIGIN, new Vector3(1, 0, 0), false, true, GUST)
    const world = parts(tell).marker.getWorldPosition(new Vector3())
    expect(world.x).toBeCloseTo(DEFAULT_AIM_TELL_CONFIG.markerDistance, 2)
    expect(world.z).toBeCloseTo(0, 2)
    tell.dispose()
  })

  it('ignores the vertical part of the heading', () => {
    // In the glider `forward` climbs and dives, but inGust tests a flattened heading, so a
    // marker that tilted with the nose would point somewhere the gust does not go.
    const tell = createAimTell()
    tell.update(ORIGIN, new Vector3(0, 0.9, -0.4).normalize(), false, true, GUST)
    const world = parts(tell).marker.getWorldPosition(new Vector3())
    expect(world.y).toBeCloseTo(0, 2)
    tell.dispose()
  })
})

describe('the cone preview', () => {
  it('hides when nothing live is in the cone', () => {
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, false, true, GUST)
    expect(parts(tell).preview.visible).toBe(false)
    tell.dispose()
  })

  it('shows when a live soldier is in the cone', () => {
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, true, true, GUST)
    expect(parts(tell).preview.visible).toBe(true)
    tell.dispose()
  })

  it('stays visible but dimmer while the gust is on cooldown', () => {
    // Dimming rather than hiding, so the shape does not blink off and on every 0.45s.
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, true, true, GUST)
    const ready = (parts(tell).preview.material as { opacity: number }).opacity
    tell.update(ORIGIN, NORTH, true, false, GUST)
    const cooling = (parts(tell).preview.material as { opacity: number }).opacity
    expect(parts(tell).preview.visible).toBe(true)
    // A margin, not a bare `<`: a dim of a millionth would pass that.
    expect(cooling).toBeLessThan(ready * 0.6)
    expect(cooling).toBeGreaterThan(0)
    tell.dispose()
  })

  it('is quieter than the fired cone it previews', () => {
    // gust-cone.ts draws its fill at 0.34. A persistent indicator as loud as the one-shot
    // would swamp it, and the fired cone is the louder statement.
    expect(DEFAULT_AIM_TELL_CONFIG.previewOpacity).toBeLessThan(0.34 * 0.6)
  })

  it('draws the cone at the gust the caller hands it, not a fixed one', () => {
    // The preview must draw whatever range it is handed, not a value compiled into this
    // module: main.ts feeds it fightConfig.gust every frame precisely so the drawn reach
    // tracks the config, whatever that config turns out to be. A hard-coded radius would
    // silently stop matching the fired cone the moment the config it reads ever changes.
    //
    // Measured as the farthest transformed vertex from the tell's origin, NOT via
    // computeBoundingSphere: that centres on the bounding-box centroid rather than the
    // wedge's apex and under-reports a wedge by a factor that depends on the half angle.
    // Task 1 hit exactly this. Measuring transformed vertices also covers the radius
    // itself, which lives on the mesh's scale rather than in the geometry.
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, true, true, { ...GUST, range: 40 })
    tell.object.updateMatrixWorld(true)
    const { preview } = parts(tell)
    const positions = preview.geometry.getAttribute('position')
    let reach = 0
    for (let i = 0; i < positions.count; i++) {
      const world = preview.localToWorld(
        new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)),
      )
      reach = Math.max(reach, Math.hypot(world.x - ORIGIN.x, world.z - ORIGIN.z))
    }
    expect(reach).toBeCloseTo(40, 1)
    tell.dispose()
  })

  it('covers the volume the hit test covers', () => {
    // The independent cross-check, as with the fired cone: a point the preview's own span
    // contains must also be inside inCone. A preview drawn narrower than the hit volume
    // teaches the wrong spacing, which is the defect this whole cycle exists to fix.
    const tell = createAimTell()
    tell.update(ORIGIN, NORTH, true, true, GUST)
    // Required before localToWorld: nothing has added this tell to a scene, so no render
    // pass has updated its matrices, and localToWorld would silently use a stale identity.
    tell.object.updateMatrixWorld(true)
    const { preview } = parts(tell)
    const positions = preview.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      const local = new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i))
      const world = preview.localToWorld(local.clone())
      // Skip the apex, which has no direction to compare.
      if (Math.hypot(world.x - ORIGIN.x, world.z - ORIGIN.z) < 1e-3) continue
      // Pulled in a hair off the rim so boundary floating point is not what is under test.
      const inset = new Vector3(world.x, 0, world.z).multiplyScalar(0.98)
      expect(inCone(ORIGIN, NORTH, inset, GUST), `vertex ${i}`).toBe(true)
    }
    tell.dispose()
  })
})

describe('the whole tell', () => {
  it('moves with the player', () => {
    const tell = createAimTell()
    tell.update(new Vector3(10, 5, -20), NORTH, true, true, GUST)
    expect(tell.object.position.x).toBeCloseTo(10)
    expect(tell.object.position.z).toBeCloseTo(-20)
    tell.dispose()
  })

  it('survives a zero heading without producing NaN', () => {
    // A standing player whose forward has not been set yet, or a corrupt state one frame
    // before the controller respawns it. three.js normalises a zero vector to zero rather
    // than to NaN, so the risk here is a lookAt on a degenerate target, not a divide.
    const tell = createAimTell()
    tell.update(ORIGIN, new Vector3(0, 0, 0), true, true, GUST)
    const world = parts(tell).marker.getWorldPosition(new Vector3())
    expect(Number.isFinite(world.x)).toBe(true)
    expect(Number.isFinite(world.z)).toBe(true)
    expect(Number.isFinite(tell.object.quaternion.w)).toBe(true)
    tell.dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/aim-tell.test.ts`
Expected: FAIL — cannot resolve `./aim-tell`.

- [ ] **Step 3: Add the config**

Append to `src/fx/config.ts`:

```ts
export interface AimTellConfig {
  /** How far ahead of the player the direction marker sits, in metres. */
  markerDistance: number
  markerSize: number
  /** Peak opacity of the cone preview. */
  previewOpacity: number
  /** Multiplies the preview's opacity while the gust is on cooldown. */
  dimmedFactor: number
}

/**
 * The aim tell.
 *
 * `markerDistance` is well inside the gust's 12-unit reach so the marker reads as "you are
 * pointing this way" rather than as a range indicator. `previewOpacity` is under half of
 * `gust-cone.ts`'s 0.34 fill, because a permanent indicator as loud as the move it previews
 * would swamp the move.
 */
export const DEFAULT_AIM_TELL_CONFIG: AimTellConfig = {
  markerDistance: 3,
  markerSize: 0.55,
  previewOpacity: 0.14,
  dimmedFactor: 0.4,
}
```

- [ ] **Step 4: Write the module**

`src/fx/aim-tell.ts`:

```ts
import {
  BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Vector3,
  type Object3D,
} from 'three'
import type { GustConfig } from '../combat/gust'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry } from './sector'
import { DEFAULT_AIM_TELL_CONFIG, type AimTellConfig } from './config'

/** Just above the ground, so a flat shape is not z-fighting the terrain it sits on. */
const HEIGHT = 0.08
const TINT = 0x7fe4ff
const MARKER_OPACITY = 0.5

/**
 * Where a gust will go, shown before it is thrown.
 *
 * Persistent rather than an `Effect` because it lives as long as the player does, which is
 * not a one-shot — the same reason `createVortexChargeTell` is shaped this way.
 *
 * Aimed from the simulation's `player.forward`, and parented to the scene rather than to the
 * avatar. Parenting would inherit the facing for free, but the avatar is rotated from the
 * *interpolated* heading, and a tell for a hit volume has to read the value the hit reads.
 */
export interface AimTell {
  object: Object3D
  /**
   * Call every frame. `targeted` is whether a live soldier is inside the cone; `ready` is
   * whether the gust is off cooldown.
   */
  update(
    position: Vector3, forward: Vector3, targeted: boolean, ready: boolean, c: GustConfig,
  ): void
  dispose(): void
}

/**
 * A flat chevron pointing along local +Z.
 *
 * A chevron rather than a bar or a dot because it carries a direction on its own, so it still
 * reads at the shallow camera angle this game mostly plays at, where a bar foreshortens into
 * a line and a dot says nothing.
 */
function createChevronGeometry(size: number): BufferGeometry {
  const geometry = new BufferGeometry()
  const halfWidth = size * 0.6
  const tailZ = -size * 0.4
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, size,
    -halfWidth, 0, tailZ,
    halfWidth, 0, tailZ,
  ]), 3))
  geometry.computeVertexNormals()
  return geometry
}

export function createAimTell(c: AimTellConfig = DEFAULT_AIM_TELL_CONFIG): AimTell {
  const object = new Group()

  const markerGeometry = createChevronGeometry(c.markerSize)
  const markerMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: MARKER_OPACITY,
    // Drawn over the world, like every other attack tell in this directory: a flat shape
    // near the ground is otherwise buried by terrain sloping up away from the player, which
    // is the defect that made the gust cone invisible in play.
    depthTest: false,
  })
  const marker = new Mesh(markerGeometry, markerMaterial)
  marker.name = 'aim-marker'
  marker.position.z = c.markerDistance
  marker.userData.excludeFromShadows = true
  object.add(marker)

  // Built at unit radius and scaled, so a changing gust range costs a scale rather than a
  // geometry rebuild sixty times a second. No boost changes halfAngle today —
  // `boostedCombatConfig` (`src/focus/effects.ts`) only touches the gust's damage, knockback
  // and cooldown, and `AvatarStateConfig` has no field that could widen an angle — so the
  // conditional rebuild below never actually fires in the current game. It stays anyway: it
  // costs one comparison a frame, and without it a future config that does widen the angle
  // would draw a stale, wrong sector instead of failing loudly.
  const previewGeometry = sectorGeometry(1, 0, 1)
  const previewMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: c.previewOpacity, depthTest: false,
  })
  const preview = new Mesh(previewGeometry, previewMaterial)
  preview.name = 'aim-preview'
  preview.rotation.x = SECTOR_FLAT_ROTATION_X
  preview.userData.excludeFromShadows = true
  preview.visible = false
  object.add(preview)

  // Reused each frame rather than allocated: this runs every frame for the whole session.
  const flat = new Vector3()
  const target = new Vector3()
  /** The half angle the geometry was last built for, so it is rebuilt only when it changes. */
  let builtHalfAngle = 1

  return {
    object,

    update(
      position: Vector3, forward: Vector3, targeted: boolean, ready: boolean, gust: GustConfig,
    ): void {
      object.position.set(position.x, position.y + HEIGHT, position.z)

      // Flattened, because inGust tests a flattened heading: a tell tilted with a climbing
      // glider would point somewhere the gust does not reach.
      flat.set(forward.x, 0, forward.z)
      if (flat.lengthSq() > 1e-8) {
        flat.normalize()
        target.copy(object.position).add(flat)
        object.lookAt(target)
      }

      marker.position.z = c.markerDistance

      preview.visible = targeted
      if (targeted) {
        // A RingGeometry cannot change its theta after construction, so a changed half angle
        // needs a rebuild. The radius is a scale, which is why only this is conditional.
        if (Math.abs(gust.halfAngle - builtHalfAngle) > 1e-6) {
          preview.geometry.dispose()
          preview.geometry = sectorGeometry(gust.halfAngle, 0, 1)
          builtHalfAngle = gust.halfAngle
        }
        preview.scale.setScalar(Math.max(gust.range, 1e-4))
        previewMaterial.opacity = c.previewOpacity * (ready ? 1 : c.dimmedFactor)
      }
    },

    dispose(): void {
      markerGeometry.dispose()
      markerMaterial.dispose()
      preview.geometry.dispose()
      previewMaterial.dispose()
    },
  }
}
```

Note on the scale: `preview.scale.setScalar` scales the whole mesh including its Y, but the geometry is flat in the authored plane so there is nothing to distort — the same trick `gust-cone.ts` uses for its travelling arc.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/fx/aim-tell.test.ts`
Expected: PASS. If "covers the volume the hit test covers" fails, the sector convention or the scale is wrong — fix the code, not the test.

- [ ] **Step 6: Red-proof three separate things**

One at a time, reverting between each:

1. Set `preview.visible = true` unconditionally. Expected: FAIL on "hides when nothing live is in the cone".
2. Set `previewMaterial.opacity = c.previewOpacity` with no `ready` term. Expected: FAIL on "stays visible but dimmer while the gust is on cooldown".
3. Change `flat.set(forward.x, 0, forward.z)` to `flat.copy(forward)`. Expected: FAIL on "ignores the vertical part of the heading".

Run after each: `npx vitest run src/fx/aim-tell.test.ts`. Confirm PASS after reverting all three.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
npm test
npm run typecheck
git add src/fx/aim-tell.ts src/fx/aim-tell.test.ts src/fx/config.ts
git commit -m "Show where a gust will go before it is thrown"
```

---

### Task 4: How badly the wing has stopped working

**Files:**
- Create: `src/player/stall.ts`
- Test: `src/player/stall.test.ts`

**Interfaces:**
- Consumes: `PlayerState` and `FlightConfig` from `src/core/types.ts`.
- Produces: `stallSeverity(state: PlayerState, c: FlightConfig): number`.

- [ ] **Step 1: Write the failing test**

`src/player/stall.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { stallSeverity } from './stall'
import { DEFAULT_FLIGHT_CONFIG } from '../core/config'
import type { PlayerState } from '../core/types'

const C = DEFAULT_FLIGHT_CONFIG

/** A glider moving at the given speed. Direction is irrelevant: only the magnitude counts. */
const gliding = (speed: number): PlayerState => ({
  mode: 'glider', position: new Vector3(), velocity: new Vector3(0, 0, -speed),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: false, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
})

const walking = (speed: number): PlayerState =>
  ({ ...gliding(speed), mode: 'ground', grounded: true })

describe('a stalling wing', () => {
  it('reports nothing at stall speed exactly', () => {
    // Exactly zero, not merely small: an off-by-epsilon here flickers the warning at cruise.
    expect(stallSeverity(gliding(C.stallSpeed), C)).toBe(0)
  })

  it('reports nothing above stall speed', () => {
    expect(stallSeverity(gliding(C.stallSpeed + 20), C)).toBe(0)
    expect(stallSeverity(gliding(60), C)).toBe(0)
  })

  it('reports full severity at a standstill', () => {
    expect(stallSeverity(gliding(0), C)).toBe(1)
  })

  it('ramps linearly between', () => {
    // stallSpeed is 8, so half of it is 4 and severity should be 0.5. Literals, so a changed
    // ramp shape is caught rather than absorbed.
    expect(stallSeverity(gliding(C.stallSpeed / 2), C)).toBeCloseTo(0.5)
    expect(stallSeverity(gliding(C.stallSpeed * 0.25), C)).toBeCloseTo(0.75)
  })

  it('mirrors the flight model rather than holding a second opinion', () => {
    // flightStep computes stallFactor as speed / stallSpeed below stall speed. Severity must
    // be exactly 1 minus that, or the tell can say "stalling" while the wing still makes
    // full lift, or stay quiet while lift is already gone.
    for (const speed of [0, 1, 3.5, 6, 7.99]) {
      const stallFactor = speed / C.stallSpeed
      expect(stallSeverity(gliding(speed), C), `speed ${speed}`).toBeCloseTo(1 - stallFactor, 10)
    }
  })
})

describe('on foot there is no such thing as a stall', () => {
  it('reports nothing while walking, however slowly', () => {
    // The trap this guards. A walk is 7 and a sprint 13, so a severity computed from speed
    // alone would paint the airspeed readout red while the player strolls around the island.
    expect(stallSeverity(walking(7), C)).toBe(0)
    expect(stallSeverity(walking(0), C)).toBe(0)
    expect(stallSeverity(walking(1), C)).toBe(0)
  })

  it('reports nothing while standing still on the ground', () => {
    expect(stallSeverity(walking(0), C)).toBe(0)
  })
})

describe('bad numbers', () => {
  it('reports nothing rather than NaN for a corrupt velocity', () => {
    // The controller respawns a non-finite state, but the HUD reads the model on the same
    // frame, and a NaN would reach the DOM as a colour.
    const broken = { ...gliding(0), velocity: new Vector3(Number.NaN, 0, 0) }
    expect(stallSeverity(broken, C)).toBe(0)
  })

  it('reports nothing rather than dividing by a zero stall speed', () => {
    expect(stallSeverity(gliding(0), { ...C, stallSpeed: 0 })).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/player/stall.test.ts`
Expected: FAIL — cannot resolve `./stall`.

- [ ] **Step 3: Write the module**

`src/player/stall.ts`:

```ts
import { MathUtils } from 'three'
import type { FlightConfig, PlayerState } from '../core/types'

/**
 * How badly the wing has stopped flying: 0 while it flies, 1 at rest.
 *
 * The arithmetic mirror of the `stallFactor` that `flightStep` already computes
 * (`speed < stallSpeed ? speed / stallSpeed : 1`), so the tell cannot claim a stall while the
 * flight model is still making full lift. A second, differently-shaped opinion about where a
 * stall begins is exactly how a warning ends up disagreeing with the physics.
 *
 * Its own module rather than an export from `flight.ts`: that file is the integrator, and this
 * is a presentation query over the same threshold. Nothing in the flight model imports it.
 *
 * Takes the whole state rather than a bare speed so the posture gate lives here, in one tested
 * place, rather than at each of the two call sites — the HUD and the wing shudder — that need
 * it. On foot a walk is 7 and stall speed is 8, so an ungated severity would report a
 * permanent stall while the player strolls around an island.
 */
export function stallSeverity(state: PlayerState, c: FlightConfig): number {
  if (state.mode !== 'glider') return 0
  if (!(c.stallSpeed > 0)) return 0
  const speed = state.velocity.length()
  if (!Number.isFinite(speed)) return 0
  return MathUtils.clamp(1 - speed / c.stallSpeed, 0, 1)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/player/stall.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-proof the posture gate**

Delete the `if (state.mode !== 'glider') return 0` line.

Run: `npx vitest run src/player/stall.test.ts`
Expected: FAIL on both tests in "on foot there is no such thing as a stall". Revert and confirm PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/player/stall.ts src/player/stall.test.ts
git commit -m "Measure how badly the wing has stopped flying"
```

---

### Task 5: The airspeed reddens

**Files:**
- Modify: `src/ui/hud.ts`
- Test: `src/ui/hud.test.ts`

**Interfaces:**
- Consumes: nothing — the caller passes an already-gated fraction from Task 4.
- Produces: `HudModel.stall: number`, and `hudModelFor(state, playerHealth?, focus?, hurtFlash?, stall?)` with `stall` defaulting to 0.

`hud.ts` takes the finished fraction rather than computing it, because it has no business importing a `FlightConfig` — the same shape `hurtFlash` took last cycle.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/hud.test.ts`:

```ts
describe('the stall warning', () => {
  it('is nothing when the caller does not pass one', () => {
    expect(hudModelFor(p()).stall).toBe(0)
  })

  it('passes a fraction through', () => {
    expect(hudModelFor(p(), undefined, undefined, 0, 0.7).stall).toBeCloseTo(0.7)
  })

  it('clamps out of range values', () => {
    expect(hudModelFor(p(), undefined, undefined, 0, 3).stall).toBe(1)
    expect(hudModelFor(p(), undefined, undefined, 0, -1).stall).toBe(0)
  })

  it('turns a non-finite value into nothing rather than a broken colour', () => {
    expect(hudModelFor(p(), undefined, undefined, 0, Number.NaN).stall).toBe(0)
  })

  it('does not disturb the hurt flash beside it', () => {
    // Both are trailing optional numbers, which is exactly the shape where two arguments get
    // swapped and nothing complains.
    const model = hudModelFor(p(), undefined, undefined, 0.25, 0.75)
    expect(model.hurtFlash).toBeCloseTo(0.25)
    expect(model.stall).toBeCloseTo(0.75)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/hud.test.ts`
Expected: FAIL — `stall` does not exist on the returned model.

- [ ] **Step 3: Widen the model**

In `src/ui/hud.ts`, add to `HudModel`:

```ts
  /** 0 to 1: how far below stall speed the glider is. Always 0 on foot. */
  stall: number
```

Change the signature and add the field to the returned object:

```ts
export function hudModelFor(
  state: PlayerState,
  playerHealth?: { current: number; max: number },
  focus?: FocusReadout,
  hurtFlash = 0,
  stall = 0,
): HudModel {
```

```ts
    stall: fraction(stall),
```

The existing private `fraction` helper already clamps and rejects non-finite values.

- [ ] **Step 4: Redden the readout**

In `update`, colour the airspeed from the fraction:

```ts
      // Interpolated in the DOM rather than by swapping a class, so the warning arrives
      // gradually as airspeed decays instead of snapping on at a threshold — a stall is a
      // slide into trouble, and a binary light would misrepresent it.
      airspeed.style.color = model.stall > 0
        ? `color-mix(in srgb, #f3f6fb, ${STALL_COLOUR} ${Math.round(model.stall * 100)}%)`
        : ''
```

with, beside the other module constants:

```ts
/** The health bar's warm tint, reused so the HUD gains no new colour vocabulary. */
const STALL_COLOUR = '#ff8f6b'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ui/hud.test.ts`
Expected: PASS.

- [ ] **Step 6: Red-proof**

Change `stall: fraction(stall)` to `stall: 0`.

Run: `npx vitest run src/ui/hud.test.ts`
Expected: FAIL on "passes a fraction through", "clamps out of range values" and "does not disturb the hurt flash beside it". Revert and confirm PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/ui/hud.ts src/ui/hud.test.ts
git commit -m "Redden the airspeed readout as the wing stalls"
```

---

### Task 6: The wings shudder

**Files:**
- Modify: `src/player/glider.ts`, `src/player/glider-mesh.test.ts:17`, `src/player/glider-mesh.test.ts:147`, `src/player/avatar.test.ts:389`
- Test: `src/player/glider-mesh.test.ts`

**Interfaces:**
- Consumes: nothing — takes a severity from Task 4 via the caller.
- Produces: `createGlider().update(dt: number, deployed: boolean, swing: number | null, stall: number): void` — a **required** fourth argument.

Required, not optional, for the reason `swing` was: an optional argument lets a future caller silently drop the tell.

- [ ] **Step 1: Write the failing test**

Add to `src/player/glider-mesh.test.ts`. Read the top of that file for its existing helpers — there is a loop helper that settles the glider over 120 frames, and it will need the new argument.

```ts
describe('the stall shudder', () => {
  /** Panel pivot Y angles, which is what the shudder perturbs. */
  function panelAngles(glider: { object: Object3D }): number[] {
    const angles: number[] = []
    glider.object.traverse((node) => {
      if (node.name === 'wing-panel-pivot') angles.push(node.rotation.y)
    })
    return angles
  }

  it('holds the panels still while the wing is flying', () => {
    const glider = createGlider()
    for (let i = 0; i < 120; i++) glider.update(1 / 60, true, null, 0)
    const first = panelAngles(glider)
    for (let i = 0; i < 20; i++) glider.update(1 / 60, true, null, 0)
    expect(panelAngles(glider)).toEqual(first)
  })

  it('moves the panels while stalling', () => {
    const glider = createGlider()
    for (let i = 0; i < 120; i++) glider.update(1 / 60, true, null, 0)
    const settled = panelAngles(glider)
    // Sampled across frames rather than probed once, because the shudder is an oscillation
    // and a single sample can land on a zero crossing — the exact shape that shipped green
    // and useless in this repo before.
    let peak = 0
    for (let i = 0; i < 40; i++) {
      glider.update(1 / 60, true, null, 1)
      const now = panelAngles(glider)
      for (let p = 0; p < now.length; p++) {
        peak = Math.max(peak, Math.abs((now[p] ?? 0) - (settled[p] ?? 0)))
      }
    }
    // A real margin against the amplitude, not a bare `> 0`.
    expect(peak).toBeGreaterThan(0.04)
  })

  it('shudders harder the worse the stall', () => {
    const peakAt = (stall: number) => {
      const glider = createGlider()
      for (let i = 0; i < 120; i++) glider.update(1 / 60, true, null, 0)
      const settled = panelAngles(glider)
      let peak = 0
      for (let i = 0; i < 40; i++) {
        glider.update(1 / 60, true, null, stall)
        const now = panelAngles(glider)
        for (let p = 0; p < now.length; p++) {
          peak = Math.max(peak, Math.abs((now[p] ?? 0) - (settled[p] ?? 0)))
        }
      }
      return peak
    }
    expect(peakAt(1)).toBeGreaterThan(peakAt(0.3) * 1.5)
  })

  it('leaves a stowed staff perfectly still, however bad the stall', () => {
    // The gate here is the OPPOSITE of the staff sweep's. The sweep applies while the glider
    // is stowed, because that is when the staff is a weapon. A stowed walking stick must not
    // vibrate because the player happens to be moving slowly on foot.
    const glider = createGlider()
    for (let i = 0; i < 120; i++) glider.update(1 / 60, false, null, 0)
    const stowed = panelAngles(glider)
    const rotation = glider.object.rotation.clone()
    for (let i = 0; i < 40; i++) glider.update(1 / 60, false, null, 1)
    expect(panelAngles(glider)).toEqual(stowed)
    expect(glider.object.rotation.x).toBeCloseTo(rotation.x, 10)
    expect(glider.object.rotation.y).toBeCloseTo(rotation.y, 10)
    expect(glider.object.rotation.z).toBeCloseTo(rotation.z, 10)
  })

  it('is deterministic, so two gliders shudder identically', () => {
    // Trigonometric rather than random, for the same reason src/fx/shake.ts is: a random
    // shudder cannot be asserted about at all.
    const a = createGlider()
    const b = createGlider()
    for (let i = 0; i < 30; i++) {
      a.update(1 / 60, true, null, 1)
      b.update(1 / 60, true, null, 1)
    }
    expect(panelAngles(a)).toEqual(panelAngles(b))
  })
})
```

The test reads `node.name === 'wing-panel-pivot'`, which does not exist yet — Step 3 names the pivots. If you would rather find the pivots another way, say so in your report, but naming them is the smaller change and makes the test readable.

- [ ] **Step 2: Update the three existing call sites so the file compiles**

Add a fourth argument of `0` to each:

- `src/player/glider-mesh.test.ts:17` — `glider.update(1 / 60, deployed, null, 0)`
- `src/player/glider-mesh.test.ts:147` — `glider.update(1 / 60, i % 40 < 20, null, 0)`
- `src/player/avatar.test.ts:389` — `glider.update(1 / 60, true, null, 0)`

`src/main.ts:423` is Task 7's job; the app typecheck pass will fail on it until then, and that is expected.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/player/glider-mesh.test.ts`
Expected: FAIL — `update` takes three arguments, and no node is named `wing-panel-pivot`.

- [ ] **Step 4: Implement the shudder**

In `src/player/glider.ts`, add module constants beside `SWEEP_ARC`:

```ts
/**
 * The stall shudder.
 *
 * Amplitude is roughly an eighth of one panel's `FAN_SPREAD` share, so a full stall flutters
 * the leaves rather than flapping them. The frequency is about 5.4 cycles a second: fast
 * enough to read as a shudder rather than as a wobble.
 */
const SHUDDER_AMPLITUDE = 0.09
const SHUDDER_FREQUENCY = 34
```

Name the pivots where they are created, so a test can find them:

```ts
      const pivot = new Group()
      pivot.name = 'wing-panel-pivot'
```

Track the severity and an accumulated time beside `openness` and `swing`:

```ts
  let stall = 0
  let shudderTime = 0
```

In `apply()`, after the existing panel loop:

```ts
    // Composed after the fan angles rather than replacing them, and only while the wing is
    // actually open. Note the gate is the OPPOSITE of the sweep's above: a sweep happens
    // while the staff is stowed and a weapon, a shudder while it is open and a wing.
    //
    // Deterministic from an accumulated time, not Math.random(), for the same reason
    // src/fx/shake.ts is trigonometric: a random shudder cannot be asserted about.
    if (stall > 0 && openness > 1e-3) {
      const swing = Math.sin(shudderTime * SHUDDER_FREQUENCY) * SHUDDER_AMPLITUDE * stall
      for (const { pivot, index, side } of panels) {
        // Alternating by index so neighbouring leaves fight each other, which reads as a
        // flutter. Moving them all together would read as one more fan movement.
        pivot.rotation.y += swing * (index % 2 === 0 ? 1 : -1) * side
      }
    }
```

And in `update`, advance the clock and store the severity before calling `apply()`:

```ts
    update(dt: number, deployed: boolean, swingProgress: number | null, stallSeverity: number): void {
      openness = advanceOpenness(openness, deployed, dt, OPEN_SECONDS)
      swing = swingProgress
      stall = Number.isFinite(stallSeverity) ? MathUtils.clamp(stallSeverity, 0, 1) : 0
      shudderTime += dt
      apply()
    },
```

Update the returned type annotation on `createGlider` to match.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/player/glider-mesh.test.ts src/player/avatar.test.ts`
Expected: PASS, including every pre-existing test in both files.

- [ ] **Step 6: Red-proof the stowed gate and the scaling**

One at a time, reverting between each:

1. Change the gate to `if (stall > 0)`, dropping the `openness` test. Expected: FAIL on "leaves a stowed staff perfectly still, however bad the stall".
2. Drop the `* stall` factor from `swing`. Expected: FAIL on "shudders harder the worse the stall" and "holds the panels still while the wing is flying".

Run after each: `npx vitest run src/player/glider-mesh.test.ts`. Revert both and confirm PASS.

- [ ] **Step 7: Commit**

The app typecheck pass will still fail on `src/main.ts:423` until Task 7. Run the test pass only:

```bash
npx tsc --noEmit -p tsconfig.test.json
npm test
git add src/player/glider.ts src/player/glider-mesh.test.ts src/player/avatar.test.ts
git commit -m "Shudder the wings as the glider stalls"
```

---

### Task 7: Wire it into the game

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing. This is the wiring layer, and it has no tests, which is why every rule it uses lives in a tested module.

- [ ] **Step 1: Create the tell and add it to the scene**

Beside the other persistent tells — `chargeTell` is created around line 186 and added to the avatar; this one goes on the **scene**, not the avatar:

```ts
  const aimTell = createAimTell()
  scene.add(aimTell.object)
```

Parented to the scene deliberately: the avatar is rotated in `syncVisuals` from the interpolated heading, and this tell must read the simulation's `player.forward`, which is the value `inGust` tests.

Import `createAimTell` from `./fx/aim-tell`, `liveGustTargets` from `./combat/gust`, and `stallSeverity` from `./player/stall`.

- [ ] **Step 2: Update the tell each frame**

In `update`, after `encounter = fight.encounter` and the interpolator resets, where `chargeTell.update` already runs:

```ts
    // fightConfig, not the unboosted default, so the preview and the fired cone
    // (`createGustCone` below, also fed `fightConfig.gust`) read one source and cannot
    // diverge if a future boost ever does touch the gust's range or half angle — the same
    // reason chargeTell reads it. Today's Avatar State does not: `boostedCombatConfig`
    // (`src/focus/effects.ts`) only scales damage, knockback and cooldown.
    aimTell.update(
      player.position,
      player.forward,
      liveGustTargets(player.position, player.forward, encounter.enemies, fightConfig.gust)
        .length > 0,
      canGust(encounter),
      fightConfig.gust,
    )
```

`canGust` is already imported in this file.

- [ ] **Step 3: Compute the stall severity once and feed both consumers**

In `update`, after `player = controllerStep(...)` and the Avatar State breath refill:

```ts
    // One value, two consumers: the HUD readout and the wing shudder. stallSeverity applies
    // the posture gate itself, so neither of them has to know that a walk is slower than
    // stall speed.
    const stall = stallSeverity(player, DEFAULT_FLIGHT_CONFIG)
```

Pass it to the glider, replacing the existing call:

```ts
    glider.update(dt, player.mode === 'glider', staffProgress, stall)
```

And to the HUD, as a fifth argument on the existing call:

```ts
    hud.update(hudModelFor(player, encounter.playerHealth, {
      focus: focus.max > 0 ? focus.value / focus.max : 0,
      avatarCharge: armFraction(avatarState, DEFAULT_AVATAR_STATE_CONFIG),
      avatarActive,
    }, hurtFlash, stall))
```

- [ ] **Step 4: Dispose the tell where the others are disposed**

If `main.ts` has a teardown path that disposes `chargeTell`, add `aimTell.dispose()` beside it. If it has none, add nothing — do not invent a teardown, and say so in your report.

- [ ] **Step 5: Verify the build**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all three clean. This is the task where the app typecheck pass starts passing again.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "Wire the aim tell and the stall severity in"
```

---

### Task 8: Verify it in the running game

**Files:** none — this task produces measurements, not code.

Use the synthetic-clock technique documented in `docs/HANDOFF.md` under the preview-pane section: patch `window.requestAnimationFrame` to capture the callback, take one screenshot so the loop re-registers, then drive frames manually. Start the dev server with the preview tool using the config in `.claude/launch.json` — never through a shell. Do not edit source files during this pass; Vite HMR wipes the harness.

Two notes from the last cycle's pass, which cost real time to find: on a fresh `npm run dev` Vite full-reloads several times in the first few seconds while it pre-bundles `three` and friends, and any harness installed before that settles is wiped — wait for the `[vite] connected` pairs to stop growing. And `WebGLRenderer.prototype.render` cannot be patched, because this build assigns `render` as an own property in the constructor; capture `scene` and `camera` via `Object3D.prototype.updateMatrixWorld` and `PerspectiveCamera.prototype.updateProjectionMatrix` instead.

Measure each of these, with a control where one is possible, and **verify by a different mechanism than the one that produced the behaviour**:

- [ ] **Step 1: The marker points where the gust goes**

Read the marker's world position and the avatar's, derive the heading between them, and compare it against the direction a gust actually resolves — turn on the spot and confirm the marker follows. The control that matters: this is the exact bug that shipped before, where the blast direction and the facing disagreed.

- [ ] **Step 2: The preview appears only with a live target**

Walk toward the home patrol and record the frame the preview becomes visible, then compare the player-to-soldier distance and angle at that moment against the gust's 12-unit range and 60-degree half angle. Then down that soldier and confirm the preview hides while the body is still inside the cone — that is the case that distinguishes `liveGustTargets` from `gustTargets`.

- [ ] **Step 3: The preview matches the fired cone**

Fire a gust while the preview is up and compare the drawn radii of the two sectors. They must agree; the preview exists to teach the reach, and a preview narrower than the blast is worse than none.

- [ ] **Step 4: The stall tell fires when the wing stops flying, and never on foot**

Deploy, climb steeply until airspeed falls below 8, and read the airspeed element's `style.color` and the panel pivot rotations across frames. Then walk on the ground at a normal pace and confirm the colour is unset — a red readout while strolling is the specific defect Task 4's posture gate exists to prevent, and it is worth seeing rather than trusting.

- [ ] **Step 5: The preview and the fired cone still agree while the Avatar State is running**

This step previously asked to confirm the preview's radius grows with the boosted gust config while the Avatar State is active. That was wrong: nothing in the game widens the gust's range or half angle, boosted or not — `boostedCombatConfig` only scales damage, knockback and cooldown, and `AvatarStateConfig` has no field that could widen either. Fill Focus, trigger the Avatar State, and confirm instead that the preview's radius and the fired cone's radius still match each other and still read 12 — i.e. that reading `fightConfig.gust` rather than a hard-coded default has not introduced any drift, even though there is currently nothing for it to track.

- [ ] **Step 6: Record the results**

Numbers, not adjectives, and state plainly anything you could not establish. A caveat is worth more than a guess.

---

### Task 9: Documentation

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Add the new sections**

In the handoff's existing voice — it explains why rather than what, names traps that cost real time, and prefers numbers to adjectives. Cover:

- The aim tell: a ground chevron along `player.forward` plus the true cone, shown only when a live soldier is inside and dimmed while on cooldown. Say why it is parented to the scene rather than the avatar: the avatar carries the *interpolated* heading, and a tell for a hit volume has to read the value the hit reads.
- `src/fx/sector.ts` now owns the sector theta convention, and why: `gust-cone.ts` and the preview both need it, and a second copy of `-PI/2 - halfAngle` would drift into a silent aiming error. Note that `gust-cone.test.ts`'s containment check against `inGust` remains the independent authority, and that `sector.test.ts` derives the flattening mapping rather than importing it.
- `liveGustTargets` and why it is separate from `gustTargets`.
- `stallSeverity`, and **the trap**: airspeed is shown in both postures and a walk at 7 is under stall speed's 8, so the posture gate is what stops the readout going red while strolling. The gate lives in `stall.ts` rather than the HUD because the shudder needs the same value.
- The wing shudder, and **the trap**: its `openness` gate is the *opposite* of the staff sweep's in the same `apply()` function. The sweep runs while stowed because that is when the staff is a weapon; the shudder runs while open.

- [ ] **Step 2: Add the honest caveats**

At minimum: every value here is an unplayed guess about feel; that §2.2 also asks for control softening on a stall and this cycle deliberately does not deliver it, with the reason; and whatever Task 8 could not establish.

- [ ] **Step 3: Update the repo state line and the spec list**

Run `npm test` and copy the real counts. Do not predict them. Add this cycle's spec path to wherever the handoff lists specs.

- [ ] **Step 4: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "Document the aim tell and the stall warning"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: `sector.ts` and the `gust-cone.ts` refactor → 1; `liveGustTargets` → 2; `aim-tell.ts` and its config → 3; `stall.ts` → 4; the HUD → 5; the shudder → 6; wiring → 7; in-game verification → 8; docs → 9. The spec's "no per-enemy highlight" and "no control softening" are out-of-scope decisions with no task, correctly.

**Type consistency.** `sectorTheta`/`sectorGeometry`/`SECTOR_FLAT_ROTATION_X`/`SECTOR_SEGMENTS`, `liveGustTargets`, `AimTellConfig.{markerDistance,markerSize,previewOpacity,dimmedFactor}`, `AimTell.update(position, forward, targeted, ready, c)`, `stallSeverity(state, c)`, `HudModel.stall`, `glider.update(dt, deployed, swing, stall)` — each defined once and used under the same name after. The child names `aim-marker` and `aim-preview` in Task 3's test match those set in its implementation, and `wing-panel-pivot` in Task 6's test matches the name set in its Step 4.

**Ordering.** Task 3 needs Task 1's geometry helper. Tasks 5 and 6 both need Task 4's severity only through their caller, so they are independent of it and of each other. Task 7 needs all of 1–6. Task 6 deliberately leaves the app typecheck pass failing until Task 7, and says so in its own commit step — the same situation the last cycle hit without warning.

**Known risk.** Task 6 changes a required signature with three call sites across two test files plus `main.ts`. They are enumerated in Task 6 Step 2 and in the Global Constraints. A concurrent session may also be editing `main.ts` and `hud.ts`; both Task 5 and Task 7 touch those, and the constraint to stop and report rather than force an edit covers it.
