# Island Visuals: Shape, Color, and Props

**Date:** 2026-07-31
**Status:** Approved

## Overview

The floating islands currently render as single-color `MeshLambertMaterial`
icospheres with a one-octave noise silhouette — smooth, blobby, empty, and
uniformly colored. This spec makes them read as real places in a stylized
low-poly art direction:

1. **Shape:** multi-octave noise for cliffs and rock detail, flat-shaded
   facets, gentler on the walkable top.
2. **Color:** per-face vertex colors zoned by slope and height — grass top,
   rocky cliffs, dirt-to-rock underside — with per-biome palettes.
3. **Props:** deterministic scattered decoration — low-poly trees on grass
   islands, boulders everywhere, a pillar ring and arch on the temple spire.

Everything stays procedural (no textures or model assets), deterministic per
island seed, and gameplay-neutral: island positions, radii, heights, the
`TerrainQuery` API, and all movement behavior are unchanged.

## 1. Shape (`src/world/island.ts`)

`createIslandGeometry` replaces its single noise call with three octaves,
summed per vertex:

| Octave | Frequency | Amplitude | Gives |
| --- | --- | --- | --- |
| base | 1.6 | 0.28 | large silhouette (unchanged from today) |
| medium | 3.5 | 0.10 | bumps and ledge masses |
| fine | 8.0 | 0.04 | small rock detail |

All three octaves sample the same `seededNoise2D(def.noiseSeed)` instance at
their own frequencies, so one seed still fully determines one island.

- **Top dampening:** the summed displacement is scaled by
  `1 - 0.55 * max(v.y, 0)`, where `v.y` is the vertex's y on the unit sphere
  before displacement and squashing are applied, so the walkable
  crown keeps roughly 45% of the roughness while undersides stay fully ragged.
  The existing ground-snap logic already tolerates small surface bumps.
- **Flat shading:** after displacement the geometry is converted with
  `toNonIndexed()` and normals recomputed with `computeVertexNormals()`,
  producing per-face normals — crisp low-poly facets instead of smooth
  shading. `DETAIL` stays 4 (~5,120 triangles per island; 8 islands is
  trivial load).
- **Derived constant:** `MAX_DEPTH_MULTIPLIER` becomes
  `BOTTOM_STRETCH * (1 + 0.28 + 0.10 + 0.04)`, keeping the existing
  derivation comment pattern. Level validation depends on this constant and
  must keep passing. The bottom of the sphere has `max(v.y, 0) = 0`, so the
  full summed amplitude applies there — the derivation stays exact.
- `IslandDef` is unchanged. Same seed → identical geometry remains a tested
  invariant.

## 2. Color (new `src/world/island-paint.ts`)

A new pure module exports:

```ts
paintIsland(geometry: BufferGeometry, biome: Biome, seed: number): void
```

It writes a `color` BufferAttribute onto the (non-indexed) geometry, one
color per face (all three vertices of a face get the same color):

- **Zone rules:** for each face, compute the face normal and centroid in the
  island's local space. A face is **top** when normal `y > 0.65` and its
  centroid is above the equator (`y > 0`); **underside** when its centroid is
  below 40% of the geometry's minimum y; otherwise **cliff**.
- **Per-face jitter:** lightness varied ±4% per face using
  `mulberry32(seed)`, so facets vary subtly instead of reading as one flat
  sheet. Deterministic.
- **Palettes** (starting values, tunable later):

| Biome | Top | Cliff | Underside |
| --- | --- | --- | --- |
| grass | 0x7fa85c | 0x8a7f6d | 0x6b5d4f |
| rock | 0x9a9484 | 0x8a8579 | 0x6e675c |
| temple | 0xcbb98f | 0xa89878 | 0x7e7260 |

`src/world/world.ts` switches the island material to
`MeshLambertMaterial({ vertexColors: true })` and drops `BIOME_COLOURS`
(the palette table above replaces it).

## 3. Props (new `src/world/props.ts`)

Two layers, split so the placement logic is testable without three.js
mesh assembly.

### Pure placement

```ts
interface PropPlacement {
  kind: 'tree' | 'boulder' | 'pillar' | 'arch'
  position: Vector3      // world space, on the ground
  scale: number          // 0.8 – 1.4, seeded
  rotationY: number      // 0 – 2π, seeded
}

propPlacements(
  def: IslandDef,
  terrain: TerrainQuery,
  shrineOffsets: Vector3[],   // this island's shrine offsets, island-local
): PropPlacement[]
```

- Points are rejection-sampled from `mulberry32(def.noiseSeed + 1)` inside a
  disc of `radius * 0.75` around the island center.
- A candidate is rejected when `terrain.groundHeightAt` returns null, when
  the surface there is too steep (downward raycast normal `y < 0.7`), or when
  it lies within 8 m (xz distance) of any shrine's world position — shrine
  offsets are island-local, so each is compared as
  `def.position + offset` to match the world-space candidate points.
- Counts scale with island size: trees `round(radius / 6)` on grass islands
  only; boulders `round(radius / 9)` on every biome. The temple biome gets no
  trees; instead a fixed ring of 5 pillars at radius 10 m around the island
  center plus 1 arch, each ground-snapped the same way (a ring position that
  finds no ground is dropped).
- Sampling caps attempts (e.g. 10 per wanted prop) so a hostile island shape
  cannot loop forever; fewer props than requested is acceptable.

### Mesh construction

```ts
buildProps(def: IslandDef, terrain: TerrainQuery, shrineOffsets: Vector3[]): Mesh | null
```

- Low-poly primitives, all vertex-colored in the island's palette family:
  - **Tree:** cylinder trunk + two stacked cones; three seeded green
    variants.
  - **Boulder:** `IcosahedronGeometry(r, 0)` squashed non-uniformly,
    cliff-grey.
  - **Pillar:** cylinder + box cap. **Arch:** two pillars + box lintel.
    Temple palette.
- All of one island's props are merged into a single `BufferGeometry` via
  `mergeGeometries` (`three/addons/utils/BufferGeometryUtils.js`) — one mesh,
  one `MeshLambertMaterial({ vertexColors: true })`, one draw call per
  island. Returns null when an island ends up with zero placements.
- Props are **purely decorative**: they are never added to
  `createTerrainQuery`'s island list, so nothing collides with them, the
  player cannot land on them, and terrain raycasts are unaffected. The
  follow-camera only avoids terrain, so it may occasionally clip through a
  tree — accepted.

## 4. Integration (`src/world/world.ts`)

`buildWorld` gains a props pass after the terrain query exists: for each
island, `buildProps(def, terrain, shrineOffsetsFor(def.id))` and add the
resulting mesh (if any) to the world group. The `World` interface and
`buildWorld` signature are unchanged; `level.shrines` already carries
per-island offsets.

`paintIsland` is called from the island loop with `def.noiseSeed` as its
seed, so face jitter is deterministic per island like everything else.

## 5. Testing

Vitest, colocated per repo convention:

- `island.test.ts` updates: same-seed determinism still holds; geometry
  bounds respect the new `MAX_DEPTH_MULTIPLIER`; top vertices are displaced
  less than underside vertices (dampening works); the geometry is
  non-indexed.
- New `island-paint.test.ts`: a `color` attribute exists and is per-face
  uniform; a steep side face receives the cliff color family; a flat top
  face receives the top color; output is deterministic for a seed.
- New `props.test.ts` (placement layer): deterministic for a seed; every
  placement lies on ground (`groundHeightAt` non-null at its xz); no
  placement within 8 m of a shrine offset; no trees on rock or temple
  biomes; pillars only on temple; attempt cap terminates on a terrain that
  always rejects.
- Existing suites (terrain-query, level validation, waterfall, controller,
  ground-move) stay green — proving gameplay is untouched.

## Out of scope

- Lighting, shadows, or fog changes (user excluded the lighting pain point).
- Grass tufts (declined).
- Textures, image assets, or custom shaders.
- Prop collision or gameplay interaction with props.
- Level layout changes.
