# Island Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the floating islands read as real places — multi-octave flat-shaded terrain, slope/height vertex-color zones, and deterministic scattered props — per `docs/superpowers/specs/2026-07-31-island-visuals-design.md`.

**Architecture:** Three focused modules. `island.ts` gains octaves, top dampening, and flat shading. New `island-paint.ts` writes per-face vertex colors from slope/height rules. New `props.ts` has a pure placement layer plus a mesh builder that merges each island's props into one draw call. `world.ts` wires paint and props in; gameplay (positions, radii, heights, `TerrainQuery` API) is untouched.

**Tech Stack:** TypeScript (strict), three.js 0.185 (`three/addons` for `mergeGeometries` — the import style already used by `src/player/avatar.ts`), Vitest 4, simplex-noise via existing `src/core/rng.ts`. No new dependencies, no assets.

## Global Constraints

- Determinism: the same `noiseSeed` must always produce identical geometry, colors, and prop placements. Existing tests assert this; new code must keep it.
- Gameplay-neutral: island `position`/`radius`/`height` semantics, the `TerrainQuery` API, and all movement code are unchanged. Prop meshes must NEVER be passed to `createTerrainQuery`.
- All world-generation code is pure with respect to its inputs: never mutate an `IslandDef` or a `Level`.
- Tests are colocated `src/<area>/<file>.test.ts`, Vitest. Run one file: `npx vitest run src/world/island.test.ts`. Full suite: `npm test`. Type-check: `npm run typecheck`. Vitest does not type-check — run both at every gate.
- Commit messages: plain descriptive sentences, matching repo history.
- Comments only where the code cannot say it; keep the existing derivation-comment style for `MAX_DEPTH_MULTIPLIER`.
- Exact spec values: octaves (1.6/0.28, 3.5/0.10, 8.0/0.04), top dampening `1 - 0.55 * max(unitY, 0)`, top-face rule normal `y > 0.65` and centroid `y > 0`, underside rule centroid below `0.4 * min.y`, jitter ±4%, disc `radius * 0.75`, shrine clearance 8 m, slope reject normal `y < 0.7`, attempts cap 10 per wanted prop, trees `round(radius / 6)` grass-only, boulders `round(radius / 9)` all biomes, temple ring of 5 pillars at radius 10 plus 1 arch.

---

### Task 1: Multi-octave flat-shaded island geometry

**Files:**
- Modify: `src/world/island.ts`
- Test: `src/world/island.test.ts`

**Interfaces:**
- Consumes: `seededNoise2D` from `src/core/rng.ts` (existing).
- Produces: `createIslandGeometry(def)` returns a **non-indexed** BufferGeometry — it already is one (`IcosahedronGeometry` is `PolyhedronGeometry`-based and ships without an index in three r185, and the existing `computeVertexNormals()` call on unshared vertices already yields per-face flat normals); the new test pins that invariant because Task 2's painter depends on 3 vertices per face. `ROUGHNESS` becomes the summed octave amplitude 0.42; `MAX_DEPTH_MULTIPLIER = BOTTOM_STRETCH * (1 + ROUGHNESS)` = 2.698 (still exported, still consumed by `level.ts`).

- [ ] **Step 1: Update and extend the tests**

In `src/world/island.test.ts`, replace the body of the test `'respects the requested radius'` (the 1.4 bound no longer holds with summed amplitude 0.42):

```ts
  it('respects the requested radius', () => {
    const box = createIslandGeometry(def({ radius: 40 })).boundingBox!
    const horizontal = Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z)
    expect(horizontal).toBeGreaterThan(40 * 0.6)
    // Summed noise amplitude is 0.42, so the silhouette can reach 1.42×radius.
    expect(horizontal).toBeLessThan(40 * 1.45)
  })
```

Add these tests to the describe block:

```ts
  it('is non-indexed, so every face has its own vertices for flat shading', () => {
    expect(createIslandGeometry(def()).index).toBeNull()
  })

  it('keeps the walkable crown gentler than the full noise amplitude', () => {
    const d = def()
    const box = createIslandGeometry(d).boundingBox!
    // At the top pole only (1 - 0.55) = 45% of the 0.42 amplitude applies, and
    // u·(1 + 0.42·(1 - 0.55u)) is maximised at u = 1, so the crown can never
    // rise above TOP_FLATTEN · height · 1.189.
    expect(box.max.y).toBeLessThan(d.height * 0.35 * (1 + 0.42 * 0.45) + 1e-6)
  })

  it('derives MAX_DEPTH_MULTIPLIER from the summed octave amplitude', () => {
    expect(MAX_DEPTH_MULTIPLIER).toBeCloseTo(1.9 * 1.42, 6)
  })
```

Add `MAX_DEPTH_MULTIPLIER` to the import from `'./island'`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/world/island.test.ts`
Expected: the MAX_DEPTH derivation test FAILS (multiplier is still 1.9 × 1.28). The non-indexed and crown tests pass already — they pin invariants the change must keep (IcosahedronGeometry ships non-indexed; the crown bound is loose against the old 0.28 amplitude). Confirm the derivation test fails before proceeding.

- [ ] **Step 3: Implement octaves, dampening, and flat shading**

Replace the constants block and `createIslandGeometry` in `src/world/island.ts` (imports and `IslandDef`/`Biome` stay):

```ts
/** Noise octaves: large silhouette, ledge masses, small rock detail. */
const OCTAVES = [
  { frequency: 1.6, amplitude: 0.28 },
  { frequency: 3.5, amplitude: 0.1 },
  { frequency: 8.0, amplitude: 0.04 },
] as const

/** Summed octave amplitude: how strongly noise can displace the silhouette. */
export const ROUGHNESS = OCTAVES.reduce((sum, o) => sum + o.amplitude, 0)
const TOP_FLATTEN = 0.35
export const BOTTOM_STRETCH = 1.9
/** How much of the roughness is removed at the top pole, keeping the crown walkable. */
const TOP_DAMPENING = 0.55
const DETAIL = 4

/**
 * How far below its position an island can reach, as a multiple of its height.
 *
 * Derived rather than measured or guessed, because level validation depends on
 * it and a hardcoded number would drift away from the geometry the moment the
 * shaping constants change. Noise displaces a vertex before the vertical squash
 * applies, dampening never applies below the equator, so the lowest a
 * unit-sphere vertex can go is (1 + ROUGHNESS) and the stretch then scales
 * that by BOTTOM_STRETCH.
 */
export const MAX_DEPTH_MULTIPLIER = BOTTOM_STRETCH * (1 + ROUGHNESS)

/**
 * A floating island: a noise-displaced sphere squashed flat on top so it is
 * walkable, and stretched into a spike below so it reads as torn from the ground.
 * Deterministic — the same noiseSeed always produces identical geometry.
 *
 * An icosphere is used rather than a heightmap because a heightmap cannot
 * express the underside and overhangs a floating island needs. The geometry
 * is non-indexed (IcosahedronGeometry ships that way), so each face has its
 * own vertices: computeVertexNormals then gives per-face flat normals, and
 * the painter can give each face its own color.
 */
export function createIslandGeometry(def: IslandDef): BufferGeometry {
  const sphere = new IcosahedronGeometry(1, DETAIL)
  const position = sphere.attributes.position
  if (!position) throw new Error('IcosahedronGeometry produced no position attribute')
  const noise = seededNoise2D(def.noiseSeed)
  const v = new Vector3()

  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
    let n = 0
    for (const { frequency, amplitude } of OCTAVES) {
      n += noise(v.x * frequency, v.z * frequency) * amplitude
    }
    // The walkable crown keeps less roughness than the ragged underside.
    const dampening = 1 - TOP_DAMPENING * Math.max(v.y, 0)
    v.multiplyScalar(1 + n * dampening)
    v.y *= v.y > 0 ? TOP_FLATTEN : BOTTOM_STRETCH
    v.x *= def.radius
    v.z *= def.radius
    v.y *= def.height
    position.setXYZ(i, v.x, v.y, v.z)
  }
  position.needsUpdate = true
  sphere.computeVertexNormals()
  sphere.computeBoundingBox()
  sphere.computeBoundingSphere()
  return sphere
}
```

(Note the icosphere is already non-indexed — do NOT call `toNonIndexed()` on it; three logs a "already non-indexed" warning and returns the same object, which would pollute test output.)

- [ ] **Step 4: Run the island suite**

Run: `npx vitest run src/world/island.test.ts`
Expected: PASS, including the pre-existing determinism, radius, and flat-top tests.

- [ ] **Step 5: Full suite and type-check**

Run: `npm test && npm run typecheck`
Expected: PASS. `level.test.ts` asserts `MAX_DEPTH_MULTIPLIER > 2.4` — the new 2.698 satisfies it. If a waterfall placement warning appears in test output, note it in your report (the rim got bumpier), but tests should still pass.

- [ ] **Step 6: Commit**

```bash
git add src/world/island.ts src/world/island.test.ts
git commit -m "Shape islands with three noise octaves and flat-shaded facets"
```

---

### Task 2: Slope/height vertex colors

**Files:**
- Create: `src/world/island-paint.ts`
- Modify: `src/world/world.ts`
- Test: `src/world/island-paint.test.ts`

**Interfaces:**
- Consumes: non-indexed geometry from Task 1; `mulberry32` from `src/core/rng.ts`; `Biome` from `./island`.
- Produces: `paintIsland(geometry: BufferGeometry, biome: Biome, seed: number): void` (writes a `color` BufferAttribute); `BIOME_PALETTES: Record<Biome, { top: number; cliff: number; under: number }>` (Task 4's boulders reuse the cliff colors).

- [ ] **Step 1: Write the failing tests**

Create `src/world/island-paint.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createIslandGeometry, type IslandDef } from './island'
import { paintIsland, BIOME_PALETTES } from './island-paint'

const def: IslandDef = {
  id: 'paint-test',
  position: new Vector3(0, 0, 0),
  radius: 40,
  height: 30,
  biome: 'grass',
  noiseSeed: 4321,
}

/** Face index → { normal, centroid, color } for a painted geometry. */
function faces(biome: IslandDef['biome'] = 'grass', seed = 99) {
  const geometry = createIslandGeometry(def)
  paintIsland(geometry, biome, seed)
  const pos = geometry.attributes.position!
  const col = geometry.attributes.color!
  const out: { normal: Vector3; centroid: Vector3; color: [number, number, number] }[] = []
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  for (let f = 0; f < pos.count / 3; f++) {
    a.fromBufferAttribute(pos, f * 3)
    b.fromBufferAttribute(pos, f * 3 + 1)
    c.fromBufferAttribute(pos, f * 3 + 2)
    const normal = new Vector3().subVectors(b, a)
      .cross(new Vector3().subVectors(c, a)).normalize()
    const centroid = new Vector3().add(a).add(b).add(c).divideScalar(3)
    out.push({
      normal, centroid,
      color: [col.getX(f * 3), col.getY(f * 3), col.getZ(f * 3)],
    })
  }
  return { geometry, faces: out }
}

/** True when the face color is the palette color within the ±4% jitter. */
function matches(color: [number, number, number], hex: number): boolean {
  const r = ((hex >> 16) & 0xff) / 255
  const g = ((hex >> 8) & 0xff) / 255
  const b = (hex & 0xff) / 255
  const within = (got: number, want: number) =>
    Math.abs(got - want) <= want * 0.05 + 1e-3
  return within(color[0], r) && within(color[1], g) && within(color[2], b)
}

describe('paintIsland', () => {
  it('writes one color per vertex, uniform within each face', () => {
    const { geometry } = faces()
    const col = geometry.attributes.color!
    expect(col.count).toBe(geometry.attributes.position!.count)
    for (let f = 0; f < col.count / 3; f++) {
      expect(col.getX(f * 3)).toBe(col.getX(f * 3 + 1))
      expect(col.getX(f * 3)).toBe(col.getX(f * 3 + 2))
    }
  })

  it('paints flat upward faces above the equator with the top color', () => {
    const flatTop = faces().faces.filter((f) => f.normal.y > 0.9 && f.centroid.y > 1)
    expect(flatTop.length).toBeGreaterThan(0)
    for (const f of flatTop) expect(matches(f.color, BIOME_PALETTES.grass.top)).toBe(true)
  })

  it('paints steep faces above the equator with the cliff color', () => {
    const steep = faces().faces.filter(
      (f) => Math.abs(f.normal.y) < 0.3 && f.centroid.y > 1,
    )
    expect(steep.length).toBeGreaterThan(0)
    for (const f of steep) expect(matches(f.color, BIOME_PALETTES.grass.cliff)).toBe(true)
  })

  it('paints the deep underside with the underside color', () => {
    const { geometry, faces: all } = faces()
    const minY = geometry.boundingBox!.min.y
    const deep = all.filter((f) => f.centroid.y < minY * 0.6)
    expect(deep.length).toBeGreaterThan(0)
    for (const f of deep) expect(matches(f.color, BIOME_PALETTES.grass.under)).toBe(true)
  })

  it('uses the palette of the requested biome', () => {
    const flatTop = faces('temple').faces.filter((f) => f.normal.y > 0.9 && f.centroid.y > 1)
    expect(flatTop.length).toBeGreaterThan(0)
    for (const f of flatTop) expect(matches(f.color, BIOME_PALETTES.temple.top)).toBe(true)
  })

  it('is deterministic for the same seed', () => {
    const a = faces('grass', 7).geometry.attributes.color!.array
    const b = faces('grass', 7).geometry.attributes.color!.array
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('rejects indexed geometry', () => {
    const { geometry } = faces()
    const indexed = geometry.clone()
    indexed.setIndex([0, 1, 2])
    expect(() => paintIsland(indexed, 'grass', 1)).toThrow(/non-indexed/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/world/island-paint.test.ts`
Expected: FAIL — module `./island-paint` does not exist.

- [ ] **Step 3: Implement the paint module**

Create `src/world/island-paint.ts`:

```ts
import { BufferAttribute, Color, Vector3, type BufferGeometry } from 'three'
import { mulberry32 } from '../core/rng'
import type { Biome } from './island'

export interface BiomePalette {
  top: number
  cliff: number
  under: number
}

export const BIOME_PALETTES: Record<Biome, BiomePalette> = {
  grass: { top: 0x7fa85c, cliff: 0x8a7f6d, under: 0x6b5d4f },
  rock: { top: 0x9a9484, cliff: 0x8a8579, under: 0x6e675c },
  temple: { top: 0xcbb98f, cliff: 0xa89878, under: 0x7e7260 },
}

/** Faces steeper than this (by normal y) are cliff, not walkable top. */
const TOP_SLOPE = 0.65
/** Faces whose centroid sits below this fraction of min.y are underside. */
const UNDER_FRACTION = 0.4
/** Per-face lightness jitter, so facets vary instead of reading as one sheet. */
const JITTER = 0.04

/**
 * Paint a non-indexed island geometry with per-face colors zoned by slope and
 * height: walkable top, cliff sides, and a darker underside. Deterministic for
 * a given seed.
 */
export function paintIsland(geometry: BufferGeometry, biome: Biome, seed: number): void {
  if (geometry.index) throw new Error('paintIsland requires non-indexed geometry')
  const position = geometry.attributes.position
  if (!position) throw new Error('paintIsland requires a position attribute')
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const minY = geometry.boundingBox!.min.y

  const palette = BIOME_PALETTES[biome]
  const rng = mulberry32(seed)
  const colors = new Float32Array(position.count * 3)
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const edge1 = new Vector3()
  const edge2 = new Vector3()
  const color = new Color()

  for (let f = 0; f < position.count / 3; f++) {
    a.fromBufferAttribute(position, f * 3)
    b.fromBufferAttribute(position, f * 3 + 1)
    c.fromBufferAttribute(position, f * 3 + 2)
    const normalY = edge1.subVectors(b, a).cross(edge2.subVectors(c, a)).normalize().y
    const centroidY = (a.y + b.y + c.y) / 3

    const zone =
      centroidY < minY * UNDER_FRACTION ? palette.under
      : normalY > TOP_SLOPE && centroidY > 0 ? palette.top
      : palette.cliff

    const jitter = 1 + (rng() * 2 - 1) * JITTER
    color.setHex(zone)
    const r = Math.min(color.r * jitter, 1)
    const g = Math.min(color.g * jitter, 1)
    const bl = Math.min(color.b * jitter, 1)
    for (let vtx = 0; vtx < 3; vtx++) {
      colors[(f * 3 + vtx) * 3] = r
      colors[(f * 3 + vtx) * 3 + 1] = g
      colors[(f * 3 + vtx) * 3 + 2] = bl
    }
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
}
```

- [ ] **Step 4: Wire it into world.ts**

In `src/world/world.ts`, replace the `BIOME_COLOURS` table and the island loop's material with paint + vertex colors:

```ts
import { Group, Mesh, MeshLambertMaterial, type BufferGeometry } from 'three'
import type { TerrainQuery } from '../core/types'
import { createIslandGeometry } from './island'
import { paintIsland } from './island-paint'
import { createTerrainQuery, type IslandMesh } from './terrain-query'
import { validateLevel, type Level } from './level'
```

and in the loop:

```ts
  for (const def of level.islands) {
    const geometry: BufferGeometry = createIslandGeometry(def)
    paintIsland(geometry, def.biome, def.noiseSeed)
    const material = new MeshLambertMaterial({ vertexColors: true })
    const mesh = new Mesh(geometry, material)
    mesh.position.copy(def.position)
    mesh.updateMatrixWorld(true)
    group.add(mesh)
    islands.push({ id: def.id, mesh })
  }
```

(The `Color` import and the `Biome` type import disappear from `world.ts`.)

- [ ] **Step 5: Run suite and type-check**

Run: `npx vitest run src/world/island-paint.test.ts src/world/world.test.ts && npm test && npm run typecheck`
Expected: PASS — `world.test.ts` counts only island meshes and checks determinism, both unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/world/island-paint.ts src/world/island-paint.test.ts src/world/world.ts
git commit -m "Paint islands with slope and height zoned vertex colors"
```

---

### Task 3: Prop placement logic

**Files:**
- Create: `src/world/props.ts` (placement layer only)
- Test: `src/world/props.test.ts`

**Interfaces:**
- Consumes: `TerrainQuery` from `src/core/types`, `mulberry32` from `src/core/rng.ts`, `IslandDef` from `./island`.
- Produces (Task 4 relies on these exact names):

```ts
export interface PropPlacement {
  kind: 'tree' | 'boulder' | 'pillar' | 'arch'
  position: Vector3
  scale: number
  rotationY: number
}
export function propPlacements(
  def: IslandDef, terrain: TerrainQuery, shrineOffsets: readonly Vector3[],
): PropPlacement[]
```

- [ ] **Step 1: Write the failing tests**

Create `src/world/props.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { propPlacements } from './props'
import type { IslandDef } from './island'
import type { TerrainQuery } from '../core/types'

const def = (over: Partial<IslandDef> = {}): IslandDef => ({
  id: 'prop-test',
  position: new Vector3(0, 0, 0),
  radius: 60,
  height: 30,
  biome: 'grass',
  noiseSeed: 777,
  ...over,
})

/** Flat ground at y=5 everywhere, with a configurable surface normal. */
const flat = (normalY = 1): TerrainQuery => ({
  groundHeightAt: () => 5,
  raycastDown: (from, maxDistance) =>
    from.y >= 5 && from.y - maxDistance <= 5
      ? {
          point: new Vector3(from.x, 5, from.z),
          normal: new Vector3(Math.sqrt(1 - normalY * normalY), normalY, 0),
          islandId: 'prop-test',
        }
      : null,
})
const voidTerrain: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }

describe('propPlacements', () => {
  it('is deterministic for the same island', () => {
    const a = propPlacements(def(), flat(), [])
    const b = propPlacements(def(), flat(), [])
    expect(a.map((p) => ({ ...p, position: p.position.toArray() })))
      .toEqual(b.map((p) => ({ ...p, position: p.position.toArray() })))
  })

  it('plants the requested tree and boulder counts on friendly ground', () => {
    const placements = propPlacements(def({ radius: 60 }), flat(), [])
    expect(placements.filter((p) => p.kind === 'tree')).toHaveLength(10) // 60 / 6
    expect(placements.filter((p) => p.kind === 'boulder')).toHaveLength(7) // round(60 / 9)
  })

  it('sets every placement on the ground surface', () => {
    for (const p of propPlacements(def(), flat(), [])) {
      expect(p.position.y).toBe(5)
    }
  })

  it('keeps clear of shrines', () => {
    // Shrine offsets are island-local; def.position is the origin here.
    const shrine = new Vector3(10, 0, -5)
    for (const p of propPlacements(def(), flat(), [shrine])) {
      expect(Math.hypot(p.position.x - 10, p.position.z + 5)).toBeGreaterThanOrEqual(8)
    }
  })

  it('stays within the placement disc', () => {
    const d = def({ radius: 60 })
    for (const p of propPlacements(d, flat(), [])) {
      expect(Math.hypot(p.position.x, p.position.z)).toBeLessThanOrEqual(60 * 0.75 + 1e-6)
    }
  })

  it('plants no trees on rock islands', () => {
    const kinds = propPlacements(def({ biome: 'rock' }), flat(), []).map((p) => p.kind)
    expect(kinds).not.toContain('tree')
    expect(kinds).toContain('boulder')
  })

  it('gives temple islands a pillar ring and an arch instead of trees', () => {
    const placements = propPlacements(def({ biome: 'temple' }), flat(), [])
    expect(placements.filter((p) => p.kind === 'pillar')).toHaveLength(5)
    expect(placements.filter((p) => p.kind === 'arch')).toHaveLength(1)
    expect(placements.filter((p) => p.kind === 'tree')).toHaveLength(0)
  })

  it('rejects steep ground and terminates', () => {
    expect(propPlacements(def(), flat(0.5), [])).toHaveLength(0)
  })

  it('terminates on terrain with no ground at all', () => {
    expect(propPlacements(def(), voidTerrain, [])).toHaveLength(0)
  })

  it('varies scale within 0.8 to 1.4', () => {
    for (const p of propPlacements(def(), flat(), [])) {
      expect(p.scale).toBeGreaterThanOrEqual(0.8)
      expect(p.scale).toBeLessThanOrEqual(1.4)
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/world/props.test.ts`
Expected: FAIL — module `./props` does not exist.

- [ ] **Step 3: Implement the placement layer**

Create `src/world/props.ts`:

```ts
import { Vector3 } from 'three'
import { mulberry32 } from '../core/rng'
import type { TerrainQuery, TerrainHit } from '../core/types'
import type { IslandDef } from './island'

export interface PropPlacement {
  kind: 'tree' | 'boulder' | 'pillar' | 'arch'
  position: Vector3
  scale: number
  rotationY: number
}

/** Props scatter inside this fraction of the island radius. */
const DISC_FRACTION = 0.75
/** No prop closer than this (in xz) to a shrine. */
const SHRINE_CLEARANCE = 8
/** Ground steeper than this (by normal y) rejects a prop. */
const MIN_GROUND_NORMAL_Y = 0.7
/** Rejection sampling gives up after this many tries per wanted prop. */
const ATTEMPTS_PER_PROP = 10
const TREE_RADIUS_DIVISOR = 6
const BOULDER_RADIUS_DIVISOR = 9
const PILLAR_COUNT = 5
const PILLAR_RING_RADIUS = 10
const ARCH_DISTANCE = 16

/**
 * Deterministic decorative prop placements for one island. Purely visual —
 * callers must never feed the resulting meshes into the terrain query.
 */
export function propPlacements(
  def: IslandDef,
  terrain: TerrainQuery,
  shrineOffsets: readonly Vector3[],
): PropPlacement[] {
  // +1 keeps the prop stream independent of the geometry noise stream.
  const rng = mulberry32(def.noiseSeed + 1)
  const shrines = shrineOffsets.map((o) => new Vector3().addVectors(def.position, o))
  const placements: PropPlacement[] = []

  const groundAt = (x: number, z: number): TerrainHit | null => {
    const probeY = def.position.y + def.height + 50
    const hit = terrain.raycastDown(new Vector3(x, probeY, z), def.height * 3 + 100)
    if (!hit || hit.normal.y < MIN_GROUND_NORMAL_Y) return null
    return hit
  }

  const nearShrine = (x: number, z: number): boolean =>
    shrines.some((s) => Math.hypot(s.x - x, s.z - z) < SHRINE_CLEARANCE)

  const scatter = (kind: PropPlacement['kind'], wanted: number): void => {
    let placed = 0
    let attempts = 0
    while (placed < wanted && attempts < wanted * ATTEMPTS_PER_PROP) {
      attempts++
      // All draws happen every attempt, so rejections never shift the stream.
      const angle = rng() * Math.PI * 2
      const r = Math.sqrt(rng()) * def.radius * DISC_FRACTION
      const scale = 0.8 + rng() * 0.6
      const rotationY = rng() * Math.PI * 2
      const x = def.position.x + Math.cos(angle) * r
      const z = def.position.z + Math.sin(angle) * r
      const hit = groundAt(x, z)
      if (!hit || nearShrine(x, z)) continue
      placements.push({ kind, position: hit.point.clone(), scale, rotationY })
      placed++
    }
  }

  if (def.biome === 'grass') scatter('tree', Math.round(def.radius / TREE_RADIUS_DIVISOR))
  scatter('boulder', Math.round(def.radius / BOULDER_RADIUS_DIVISOR))

  if (def.biome === 'temple') {
    for (let i = 0; i < PILLAR_COUNT; i++) {
      const angle = (i / PILLAR_COUNT) * Math.PI * 2
      const x = def.position.x + Math.cos(angle) * PILLAR_RING_RADIUS
      const z = def.position.z + Math.sin(angle) * PILLAR_RING_RADIUS
      const hit = groundAt(x, z)
      if (!hit || nearShrine(x, z)) continue
      placements.push({
        kind: 'pillar', position: hit.point.clone(), scale: 1,
        rotationY: angle + Math.PI / 2,
      })
    }
    const x = def.position.x + ARCH_DISTANCE
    const z = def.position.z
    const hit = groundAt(x, z)
    if (hit && !nearShrine(x, z)) {
      placements.push({
        kind: 'arch', position: hit.point.clone(), scale: 1, rotationY: Math.PI / 2,
      })
    }
  }

  return placements
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/world/props.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and type-check**

Run: `npm test && npm run typecheck`
Expected: PASS (nothing consumes the module yet).

- [ ] **Step 6: Commit**

```bash
git add src/world/props.ts src/world/props.test.ts
git commit -m "Add deterministic prop placement with shrine and slope rules"
```

---

### Task 4: Prop meshes and world integration

**Files:**
- Modify: `src/world/props.ts` (add the mesh layer)
- Modify: `src/world/world.ts`
- Test: `src/world/world.test.ts` (children-count test changes), `src/world/props.test.ts` (buildProps tests)

**Interfaces:**
- Consumes: `propPlacements` from Task 3, `BIOME_PALETTES` from Task 2, `mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`.
- Produces: `buildProps(def: IslandDef, terrain: TerrainQuery, shrineOffsets: readonly Vector3[]): Mesh | null` — one merged, vertex-colored mesh per island, or null when nothing was placed.

- [ ] **Step 1: Write the failing tests**

Add to `src/world/props.test.ts` (import `buildProps` beside `propPlacements`; import `Mesh` from `'three'`):

```ts
describe('buildProps', () => {
  it('merges all props into a single mesh with vertex colors', () => {
    const mesh = buildProps(def(), flat(), [])
    expect(mesh).toBeInstanceOf(Mesh)
    expect(mesh!.geometry.attributes.color).toBeDefined()
    expect(mesh!.geometry.attributes.position!.count).toBeGreaterThan(0)
    expect(mesh!.geometry.boundingSphere!.radius).toBeGreaterThan(0)
  })

  it('returns null when nothing can be placed', () => {
    expect(buildProps(def(), voidTerrain, [])).toBeNull()
  })

  it('is deterministic', () => {
    const a = buildProps(def(), flat(), [])!.geometry.attributes.position!.array
    const b = buildProps(def(), flat(), [])!.geometry.attributes.position!.array
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('builds props near the ground height', () => {
    const mesh = buildProps(def(), flat(), [])!
    // Flat ground sits at y=5; every prop part lives on or above it, and no
    // prop is taller than ~12 m at max scale.
    const pos = mesh.geometry.attributes.position!
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeGreaterThan(4)
      expect(pos.getY(i)).toBeLessThan(5 + 14)
    }
  })
})
```

In `src/world/world.test.ts`, replace the test `'adds every mesh to the returned group'` with:

```ts
  it('adds every island mesh to the returned group', () => {
    const world = buildWorld(ARCHIPELAGO)
    for (const island of world.islands) {
      expect(world.group.children).toContain(island.mesh)
    }
  })

  it('adds prop meshes beyond the island meshes', () => {
    const world = buildWorld(ARCHIPELAGO)
    expect(world.group.children.length).toBeGreaterThan(ARCHIPELAGO.islands.length)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/world/props.test.ts src/world/world.test.ts`
Expected: FAIL — `buildProps` is not exported; the world prop-count test fails (group only holds islands).

- [ ] **Step 3: Implement the mesh layer**

Extend `src/world/props.ts`. New imports:

```ts
import {
  BoxGeometry, BufferAttribute, Color, ConeGeometry, CylinderGeometry,
  IcosahedronGeometry, Matrix4, Mesh, MeshLambertMaterial, Quaternion, Vector3,
  type BufferGeometry,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { BIOME_PALETTES } from './island-paint'
```

New code below `propPlacements`:

```ts
const TREE_GREENS = [0x4f7a3a, 0x5d8a44, 0x6a9a50] as const
const TRUNK_BROWN = 0x6b4f35

/** Flat-shade and fill a primitive with one color, ready for merging. */
function colored(source: BufferGeometry, hex: number): BufferGeometry {
  // Cylinders, cones, and boxes are indexed; icosahedra already are not.
  // Calling toNonIndexed on a non-indexed geometry logs a warning and
  // returns the same object, so guard on the index.
  const geometry = source.index ? source.toNonIndexed() : source
  if (geometry !== source) source.dispose()
  const color = new Color(hex)
  const count = geometry.attributes.position!.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

function treeParts(variant: number): BufferGeometry[] {
  const green = TREE_GREENS[variant % TREE_GREENS.length]!
  const trunk = colored(new CylinderGeometry(0.35, 0.45, 2.4, 6), TRUNK_BROWN)
  trunk.translate(0, 1.2, 0)
  const lower = colored(new ConeGeometry(2.2, 2.8, 7), green)
  lower.translate(0, 3.4, 0)
  const upper = colored(new ConeGeometry(1.5, 2.2, 7), green)
  upper.translate(0, 5.2, 0)
  return [trunk, lower, upper]
}

function boulderParts(cliffColor: number): BufferGeometry[] {
  const rock = colored(new IcosahedronGeometry(1.3, 0), cliffColor)
  rock.scale(1, 0.7, 1.3)
  rock.translate(0, 0.6, 0)
  return [rock]
}

function pillarParts(top: number, cliff: number): BufferGeometry[] {
  const shaft = colored(new CylinderGeometry(0.7, 0.8, 7, 6), top)
  shaft.translate(0, 3.5, 0)
  const cap = colored(new BoxGeometry(2.2, 0.8, 2.2), cliff)
  cap.translate(0, 7.4, 0)
  return [shaft, cap]
}

function archParts(top: number, cliff: number): BufferGeometry[] {
  const parts: BufferGeometry[] = []
  for (const side of [-2.2, 2.2]) {
    for (const part of pillarParts(top, cliff)) {
      part.translate(side, 0, 0)
      parts.push(part)
    }
  }
  const lintel = colored(new BoxGeometry(6.2, 1.1, 1.8), cliff)
  lintel.translate(0, 8.3, 0)
  parts.push(lintel)
  return parts
}

/**
 * Build one merged decorative mesh for an island, or null when nothing was
 * placed. One mesh per island keeps the whole prop layer at one draw call
 * per island. Never add the result to the terrain query.
 */
export function buildProps(
  def: IslandDef,
  terrain: TerrainQuery,
  shrineOffsets: readonly Vector3[],
): Mesh | null {
  const placements = propPlacements(def, terrain, shrineOffsets)
  if (placements.length === 0) return null

  const palette = BIOME_PALETTES[def.biome]
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const merged: BufferGeometry[] = []

  placements.forEach((placement, index) => {
    const parts =
      placement.kind === 'tree' ? treeParts(index)
      : placement.kind === 'boulder' ? boulderParts(palette.cliff)
      : placement.kind === 'pillar' ? pillarParts(palette.top, palette.cliff)
      : archParts(palette.top, palette.cliff)
    quaternion.setFromAxisAngle(up, placement.rotationY)
    matrix.compose(
      placement.position, quaternion,
      new Vector3(placement.scale, placement.scale, placement.scale),
    )
    for (const part of parts) {
      part.applyMatrix4(matrix)
      merged.push(part)
    }
  })

  const geometry = mergeGeometries(merged)
  for (const part of merged) part.dispose()
  if (!geometry) return null
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }))
}
```

- [ ] **Step 4: Wire props into buildWorld**

In `src/world/world.ts`, import `buildProps` and add the props pass after the terrain query exists (`buildWorld`'s return changes shape only internally):

```ts
import { buildProps } from './props'
```

```ts
  const terrain = createTerrainQuery(islands)

  for (const def of level.islands) {
    const offsets = level.shrines
      .filter((s) => s.islandId === def.id)
      .map((s) => s.offset)
    const props = buildProps(def, terrain, offsets)
    if (props) group.add(props)
  }

  return { islands, terrain, group }
```

- [ ] **Step 5: Run suite and type-check**

Run: `npx vitest run src/world/props.test.ts src/world/world.test.ts && npm test && npm run typecheck`
Expected: PASS. Watch for `Mesh` import errors in the test (must come from `'three'`).

- [ ] **Step 6: Commit**

```bash
git add src/world/props.ts src/world/props.test.ts src/world/world.ts src/world/world.test.ts
git commit -m "Scatter merged low-poly trees, boulders, and temple ruins"
```

---

### Task 5: End-to-end verification

**Files:**
- No new code. Modify only if verification finds a defect.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified feature.

- [ ] **Step 1: Full suite, type-check, build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS. Note any waterfall placement warnings in the test/build output — the bumpier rim can legitimately drop a waterfall, but it should be reported, not silently accepted.

- [ ] **Step 2: Visual verification in the running game**

Use the superpowers:verification-before-completion skill. Start the dev server (`npm run dev`) and have the user verify in the browser:

1. Islands show three color zones: green/sand top, grey-brown cliffs, dark underside — no island is one flat color.
2. Silhouettes look craggy (visible facets, ledges) rather than smooth blobs; the underside spike reads as torn rock.
3. Walking on `home` feels unchanged — no potholes or invisible walls; ground snap still glues small bumps.
4. Trees and boulders on grass islands; boulders only on rock islands; pillar ring + arch on the spire. Nothing floats in the air, nothing intersects a shrine marker.
5. Gliding between islands: no frame hitches; distant islands still fade into fog correctly.
6. Waterfalls still appear on their islands.

Report each check's outcome; fix and re-run on any failure.

- [ ] **Step 3: Final commit if anything changed**

```bash
git status
```

If verification required fixes, commit them with a message describing the defect found.
