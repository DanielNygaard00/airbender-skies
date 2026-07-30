# Airbender Skies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a third-person browser game in which the player explores an archipelago of floating islands while flying on an air kite.

**Architecture:** A fixed-step imperative game loop drives pure simulation functions. All movement logic (flight aerodynamics, ground movement, breath) is written as pure functions over explicit state, so it is unit-testable without a renderer. Three.js is used only for rendering, asset loading, and raycasting. Flight is camera-relative: the mouse aims the camera and the kite steers toward it, with angle of attack derived from the angle between the kite's forward vector and its velocity.

**Tech Stack:** TypeScript 7, Three.js r185, Vite 8, vitest 4, simplex-noise 4. No UI framework, no physics engine.

## Global Constraints

- Node 26.5.0 or later. The toolchain below was verified working on Node 26.5.0.
- Exact dependency versions: `three@0.185.1`, `@types/three@0.185.1`, `simplex-noise@4.0.3`.
- Exact dev dependency versions: `typescript@7.0.2`, `vite@8.1.5`, `vitest@4.1.10`.
- `three` does not ship its own TypeScript types. `@types/three` is required and its version must match the `three` version.
- Three.js addons are imported from `three/addons/*`, which maps to `examples/jsm/*`. Example: `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'`.
- TypeScript runs in `strict` mode with `noEmit`. Vite does the transpiling; `tsc` is only a type checker.
- Every simulation function is **pure**: it takes state and returns new state, and never mutates its arguments. Three.js `Vector3` methods mutate in place, so always `.clone()` before modifying an input vector.
- No `Math.random()` in world generation. All randomness comes from a seeded PRNG so islands are reproducible.
- All committed art assets must be CC0 or equivalently permissive, and every asset must be listed in `ASSETS.md` with its source and license.
- The game must never present a blank screen without explanation. Every failure path has a visible fallback.
- Repository: `DanielNygaard00/airbender-skies`, public. The `gh` CLI is already authenticated as `DanielNygaard00`.
- The Vite `base` must be `/airbender-skies/` so GitHub Pages serves assets correctly.

## Tuning Constants Are Pre-Validated

The flight model in this plan was prototyped and measured before the plan was written. **The prototype code was exploration and has been discarded** — implementers write tests first and implement fresh. What carries forward is the validated constants and this measured behavior table, which the tests in Tasks 3–5 assert against:

| Scenario | Measured result |
| --- | --- |
| Level glide, 6s, from 18 m/s | altitude 500 → 475.5, speed settles 23.9 m/s (≈6:1 glide) |
| Dive 45°, 2.5s | altitude 500 → 442.7, speed 18 → 42.1 m/s |
| Zoom climb 35°, 2.5s, from 42.1 m/s | +28.6 m above the pull-up point, speed drops to 12.4 m/s |
| Slow kite (12 m/s) pointing 30° up | sinks to 487.1 — cannot climb without energy |
| Thrust 3s at 5° up | altitude 500 → 510.9, speed 55.4 m/s |
| Unpowered glide, 5s | 4.3% total energy loss |

The important consequence, which the tests must lock in: **a dive-then-climb cycle is net-lossy** (costs ~57 m, buys back ~29 m). Thrust is the only source of net altitude.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/types.ts` | Every cross-module contract: `InputState`, `PlayerState`, `TerrainQuery`, `FlightConfig`. Created first so no task invents its own types. |
| `src/core/config.ts` | `DEFAULT_FLIGHT_CONFIG` and its validation. |
| `src/core/rng.ts` | Seeded PRNG and seeded 2D noise factory. |
| `src/core/loop.ts` | Fixed-step accumulator loop with delta clamping. |
| `src/core/input.ts` | Pure key-event reducer plus a thin DOM/pointer-lock adapter. |
| `src/core/assets.ts` | GLTF loading with a cache and placeholder fallback. |
| `src/core/renderer.ts` | Renderer and scene bootstrap, WebGL capability check. |
| `src/core/save.ts` | `localStorage` persistence behind an injectable storage interface. |
| `src/player/flight.ts` | Kite up-vector, derived angle of attack, force integration. |
| `src/player/steering.ts` | Turning the kite toward the look direction at an airspeed-limited rate. |
| `src/player/breath.ts` | Breath drain, regeneration, clamping. |
| `src/player/ground-move.ts` | Camera-relative walk, run, jump, gravity, ground snap. |
| `src/player/state.ts` | `PlayerState` construction and helpers. |
| `src/player/controller.ts` | Mode switching, landing rules, respawn, non-finite guard. |
| `src/player/avatar.ts` | Animation state machine, and the Three.js model it drives. |
| `src/world/island.ts` | Deterministic island mesh generation from noise. |
| `src/world/terrain-query.ts` | The only way to ask about ground: height and downward raycasts. |
| `src/world/level.ts` | Level types and validation. |
| `src/world/levels/archipelago.ts` | The eight-island level data. |
| `src/world/shrine.ts` | Air shrine placement and collection. |
| `src/camera/follow-cam.ts` | Spring-arm camera with ground and flight profiles. |
| `src/fx/wind.ts` | Air trails, speed streaks, field-of-view kick. |
| `src/fx/audio.ts` | Wind loop driven by airspeed. |
| `src/ui/hud.ts` | Breath, altitude, and airspeed readouts. |
| `src/main.ts` | Assembles everything and starts the loop. |

---

### Task 1: Project scaffold, shared contracts, and deployment

Sets up the toolchain, creates the shared type contracts every later task imports, and gets a deploy pipeline running so the game is publishable from day one.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore` (already exists — verify), `README.md`
- Create: `src/core/types.ts`, `src/core/config.ts`, `src/main.ts`
- Create: `.github/workflows/deploy.yml`
- Test: `src/core/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the contracts below. **Every later task imports from `src/core/types.ts` rather than redeclaring these.**
  - `type PlayerMode = 'ground' | 'kite'`
  - `interface InputState { lookDirection: Vector3; forward: number; strafe: number; sprint: boolean; actionPressed: boolean }`
  - `interface PlayerState { mode: PlayerMode; position: Vector3; velocity: Vector3; forward: Vector3; breath: number; maxBreath: number; grounded: boolean; lastGroundIslandId: string | null }`
  - `interface TerrainHit { point: Vector3; normal: Vector3; islandId: string }`
  - `interface TerrainQuery { groundHeightAt(x: number, z: number): number | null; raycastDown(from: Vector3, maxDistance: number): TerrainHit | null }`
  - `interface FlightConfig { ... }` (full shape in Step 3)
  - `DEFAULT_FLIGHT_CONFIG: FlightConfig` and `validateFlightConfig(c: FlightConfig): void` from `src/core/config.ts`

- [ ] **Step 1: Initialise the project and install exact versions**

```bash
cd /Users/danielnygaard/Developer/airbender-skies
npm init -y
npm i three@0.185.1 simplex-noise@4.0.3
npm i -D typescript@7.0.2 vite@8.1.5 vitest@4.1.10 @types/three@0.185.1
```

- [ ] **Step 2: Write the config files**

`package.json` — replace the `scripts` block and set `"type": "module"`:

```json
{
  "name": "airbender-skies",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`vite.config.ts`:

```typescript
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/airbender-skies/',
  build: { target: 'es2022' },
})
```

`vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Airbender Skies</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #0b1020; }
      canvas { display: block; width: 100%; height: 100%; }
      #fallback { display: none; color: #e8eaf0; font: 16px/1.5 system-ui, sans-serif; padding: 2rem; }
    </style>
  </head>
  <body>
    <canvas id="game"></canvas>
    <div id="fallback"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Write `src/core/types.ts`**

This file has no runtime behavior, so it is not tested directly. It is the contract every other task imports.

```typescript
import type { Vector3 } from 'three'

export type PlayerMode = 'ground' | 'kite'

/** Player intent for one frame. Produced by input, consumed by movement. */
export interface InputState {
  /** Normalised camera forward direction. */
  lookDirection: Vector3
  /** W = +1, S = -1. Thrust in kite mode, walk in ground mode. */
  forward: number
  /** D = +1, A = -1. Bank in kite mode, strafe in ground mode. */
  strafe: number
  /** Shift held. */
  sprint: boolean
  /** Space, edge-triggered: jump, deploy, or stow. */
  actionPressed: boolean
}

export interface PlayerState {
  mode: PlayerMode
  position: Vector3
  velocity: Vector3
  /** Where the character or kite points. Always normalised. */
  forward: Vector3
  breath: number
  maxBreath: number
  grounded: boolean
  lastGroundIslandId: string | null
}

export interface TerrainHit {
  point: Vector3
  normal: Vector3
  islandId: string
}

/** The only channel through which movement code may ask about the world. */
export interface TerrainQuery {
  groundHeightAt(x: number, z: number): number | null
  raycastDown(from: Vector3, maxDistance: number): TerrainHit | null
}

export interface FlightConfig {
  /** Downward acceleration, m/s². */
  gravity: number
  /** Lift scale. Lift ∝ liftCoeff · v² · sin(2·aoa). */
  liftCoeff: number
  /** Parasitic drag scale. Drag ∝ dragCoeff · v². */
  dragCoeff: number
  /** How much angle of attack multiplies drag. */
  inducedDragFactor: number
  /** Below this airspeed lift falls off linearly to zero. */
  stallSpeed: number
  /** Forward acceleration while thrusting, m/s². */
  thrustAccel: number
  /** Extra angle of attack added while flaring, radians. */
  flareAoaBoost: number
  /** Built-in trim angle of the kite, radians. Gives a natural cruise speed. */
  rigAoa: number
  /** Turn rate at or below turnRateSpeedRef, radians/s. */
  baseTurnRate: number
  /** Airspeed above which turns start widening, m/s. */
  turnRateSpeedRef: number
  /** Extra roll rate contributed by bank input, radians/s. */
  bankTurnRate: number
  /** Breath consumed per second of thrust. */
  breathDrainPerSecond: number
  /** Touching ground at or below this speed lands cleanly. */
  landingSpeed: number
  /** Starting maximum breath, before any shrines. */
  baseMaxBreath: number
  /** Breath recovered per second while not thrusting, in the air. */
  breathRegenPerSecond: number
  /** Regeneration is multiplied by this while standing on ground. */
  breathRegenGroundedMultiplier: number
  /** Each shrine adds this fraction of baseMaxBreath to the maximum. */
  shrineBreathBonusFraction: number
}
```

- [ ] **Step 4: Write the failing test for config validation**

`src/core/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { DEFAULT_FLIGHT_CONFIG, validateFlightConfig } from './config'

describe('flight config', () => {
  it('accepts the default config', () => {
    expect(() => validateFlightConfig(DEFAULT_FLIGHT_CONFIG)).not.toThrow()
  })

  it('rejects non-positive gravity', () => {
    expect(() => validateFlightConfig({ ...DEFAULT_FLIGHT_CONFIG, gravity: 0 }))
      .toThrow(/gravity/)
  })

  it('rejects a stall speed above the cruise reference', () => {
    expect(() => validateFlightConfig({ ...DEFAULT_FLIGHT_CONFIG, stallSpeed: 100 }))
      .toThrow(/stallSpeed/)
  })

  it('defaults produce a roughly 6 to 1 glide ratio input pair', () => {
    // Guards against fat-fingering the two coefficients that set glide feel.
    const { liftCoeff, dragCoeff } = DEFAULT_FLIGHT_CONFIG
    expect(liftCoeff / dragCoeff).toBeGreaterThan(10)
    expect(liftCoeff / dragCoeff).toBeLessThan(25)
  })
})
```

- [ ] **Step 5: Run the test and verify it fails**

Run: `npm test -- src/core/config.test.ts`
Expected: FAIL — cannot resolve module `./config`.

- [ ] **Step 6: Write `src/core/config.ts`**

```typescript
import type { FlightConfig } from './types'

/** Validated by prototype measurement — see the plan's tuning table. */
export const DEFAULT_FLIGHT_CONFIG: FlightConfig = {
  gravity: 20,
  liftCoeff: 0.075,
  dragCoeff: 0.0045,
  inducedDragFactor: 6,
  stallSpeed: 8,
  thrustAccel: 22,
  flareAoaBoost: 0.35,
  rigAoa: 0.09,
  baseTurnRate: 2.2,
  turnRateSpeedRef: 40,
  bankTurnRate: 1.5,
  breathDrainPerSecond: 18,
  landingSpeed: 14,
  baseMaxBreath: 100,
  breathRegenPerSecond: 12,
  breathRegenGroundedMultiplier: 2.5,
  shrineBreathBonusFraction: 0.1,
}

export function validateFlightConfig(c: FlightConfig): void {
  const positive: (keyof FlightConfig)[] = [
    'gravity', 'liftCoeff', 'dragCoeff', 'stallSpeed',
    'thrustAccel', 'baseTurnRate', 'turnRateSpeedRef',
    'breathDrainPerSecond', 'landingSpeed', 'baseMaxBreath',
    'breathRegenPerSecond', 'breathRegenGroundedMultiplier',
    'shrineBreathBonusFraction',
  ]
  for (const key of positive) {
    if (!(c[key] > 0)) throw new Error(`FlightConfig.${key} must be > 0, got ${c[key]}`)
  }
  if (c.stallSpeed >= c.turnRateSpeedRef) {
    throw new Error(
      `FlightConfig.stallSpeed (${c.stallSpeed}) must be below turnRateSpeedRef (${c.turnRateSpeedRef})`,
    )
  }
}
```

- [ ] **Step 7: Run the test and verify it passes**

Run: `npm test -- src/core/config.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Write a placeholder `src/main.ts` so the build succeeds**

```typescript
import { DEFAULT_FLIGHT_CONFIG, validateFlightConfig } from './core/config'

validateFlightConfig(DEFAULT_FLIGHT_CONFIG)
console.log('Airbender Skies: scaffold OK')
```

- [ ] **Step 9: Verify typecheck and build both succeed**

Run: `npm run typecheck && npm run build`
Expected: no type errors, and `dist/` is produced.

- [ ] **Step 10: Write the deploy workflow**

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '26'
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - id: deploy
        uses: actions/deploy-pages@v4
```

- [ ] **Step 11: Write `README.md`**

```markdown
# Airbender Skies

A third-person browser game: explore an archipelago of floating islands while flying on an
air kite.

**Play:** https://danielnygaard00.github.io/airbender-skies/

## Controls

| Input | Ground | Kite |
| --- | --- | --- |
| Mouse | Look | Steer — the kite turns toward where you look |
| `W` / `S` | Walk forward / back | Airbending thrust / flare |
| `A` / `D` | Strafe | Bank into the turn |
| `Shift` | Sprint | — |
| `Space` | Jump | Deploy or stow the kite |

Gliding costs nothing. Thrust costs breath, and thrust is the only way to gain net altitude.
Collect air shrines to raise your maximum breath.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run typecheck  # type check only
npm run build      # production build into dist/
```

Design documents live in `docs/superpowers/`.
```

- [ ] **Step 12: Create the GitHub repository and push**

```bash
gh repo create DanielNygaard00/airbender-skies --public --source=. --remote=origin --push
```

- [ ] **Step 13: Enable GitHub Pages with Actions as the source**

```bash
gh api -X POST repos/DanielNygaard00/airbender-skies/pages -f build_type=workflow
```

If this returns 409, Pages is already configured — continue.

- [ ] **Step 14: Verify the deploy succeeded**

```bash
gh run watch --exit-status
```

Expected: the `Deploy` workflow passes and the Pages URL responds.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "Add project scaffold, shared type contracts, and Pages deploy"
git push
```

---

### Task 2: Seeded randomness and noise

World generation must be reproducible: the same seed always produces the same island. `simplex-noise` needs a random source injected, and a constant function produces a degenerate permutation table, so a real PRNG is required.

**Files:**
- Create: `src/core/rng.ts`
- Test: `src/core/rng.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `mulberry32(seed: number): () => number` — deterministic PRNG returning values in `[0, 1)`.
  - `seededNoise2D(seed: number): (x: number, y: number) => number` — deterministic 2D simplex noise in roughly `[-1, 1]`.

- [ ] **Step 1: Write the failing tests**

`src/core/rng.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mulberry32, seededNoise2D } from './rng'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('produces different sequences for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('stays within the unit interval', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('seededNoise2D', () => {
  it('is deterministic for a given seed', () => {
    expect(seededNoise2D(99)(1.5, 2.5)).toBe(seededNoise2D(99)(1.5, 2.5))
  })

  it('varies across the sampled domain', () => {
    // A degenerate random source collapses the permutation table and the noise
    // field goes flat. This test is what catches that.
    const n = seededNoise2D(1234)
    let min = 1
    let max = -1
    for (let i = 0; i < 400; i++) {
      const v = n(i * 0.11, i * 0.07)
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    expect(max - min).toBeGreaterThan(0.8)
  })

  it('stays roughly within minus one to one', () => {
    const n = seededNoise2D(5)
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(n(i * 0.3, i * 0.9))).toBeLessThanOrEqual(1.001)
    }
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/core/rng.test.ts`
Expected: FAIL — cannot resolve module `./rng`.

- [ ] **Step 3: Write `src/core/rng.ts`**

```typescript
import { createNoise2D } from 'simplex-noise'

/**
 * Small fast deterministic PRNG. Chosen over Math.random because world
 * generation must be reproducible from a seed.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 2D simplex noise seeded deterministically. */
export function seededNoise2D(seed: number): (x: number, y: number) => number {
  return createNoise2D(mulberry32(seed))
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/core/rng.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/rng.ts src/core/rng.test.ts
git commit -m "Add seeded PRNG and deterministic 2D noise"
```

---

### Task 3: Kite orientation and derived angle of attack

The two geometric primitives the flight model rests on. Angle of attack is **derived**, not an input: it is the angle between where the kite points and where it is actually moving. Getting the sign right is what makes pitch control work.

**Files:**
- Create: `src/player/flight.ts`
- Test: `src/player/flight.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure Three.js math).
- Produces:
  - `kiteUp(forward: Vector3, bank: number): Vector3` — the kite's up axis, rolled about `forward` by `bank` radians. Always perpendicular to `forward`.
  - `angleOfAttack(forward: Vector3, velocity: Vector3, up: Vector3): number` — signed radians. Positive means the nose is above the flight path (generating lift), negative means below.

- [ ] **Step 1: Write the failing tests**

`src/player/flight.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { kiteUp, angleOfAttack } from './flight'

const FWD_LEVEL = new Vector3(0, 0, -1)

describe('kiteUp', () => {
  it('is perpendicular to forward when level', () => {
    expect(kiteUp(FWD_LEVEL, 0).dot(FWD_LEVEL)).toBeCloseTo(0, 6)
  })

  it('is perpendicular to forward when pitched up', () => {
    const f = new Vector3(0, 0.4, -1).normalize()
    expect(kiteUp(f, 0).dot(f)).toBeCloseTo(0, 6)
  })

  it('points world-up when the kite is level and unbanked', () => {
    const up = kiteUp(FWD_LEVEL, 0)
    expect(up.y).toBeCloseTo(1, 5)
  })

  it('is still normalised and perpendicular when banked', () => {
    const f = new Vector3(0, -0.2, -1).normalize()
    const up = kiteUp(f, 0.7)
    expect(up.length()).toBeCloseTo(1, 6)
    expect(up.dot(f)).toBeCloseTo(0, 6)
  })

  it('rolls the up axis sideways when banked', () => {
    expect(Math.abs(kiteUp(FWD_LEVEL, 0.7).x)).toBeGreaterThan(0.1)
  })

  it('does not produce NaN when forward is straight down', () => {
    const up = kiteUp(new Vector3(0, -1, 0), 0)
    expect(Number.isFinite(up.x + up.y + up.z)).toBe(true)
    expect(up.length()).toBeCloseTo(1, 6)
  })
})

describe('angleOfAttack', () => {
  it('is zero when the kite moves exactly where it points', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 0, -20), kiteUp(FWD_LEVEL, 0))
    expect(aoa).toBeCloseTo(0, 5)
  })

  it('is zero when the kite is barely moving', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 0, 0), kiteUp(FWD_LEVEL, 0))
    expect(aoa).toBe(0)
  })

  it('is positive when the nose is above the flight path', () => {
    // Pointing level but sinking: the nose is above where it is going.
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, -10, -10), kiteUp(FWD_LEVEL, 0))
    expect(aoa).toBeGreaterThan(0)
    expect(aoa).toBeCloseTo(Math.PI / 4, 3)
  })

  it('is negative when the nose is below the flight path', () => {
    // Pointing level but climbing: the nose is below where it is going.
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 10, -10), kiteUp(FWD_LEVEL, 0))
    expect(aoa).toBeLessThan(0)
    expect(aoa).toBeCloseTo(-Math.PI / 4, 3)
  })

  it('reaches ninety degrees when moving straight down while pointing level', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, -10, 0), kiteUp(FWD_LEVEL, 0))
    expect(aoa).toBeCloseTo(Math.PI / 2, 4)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/player/flight.test.ts`
Expected: FAIL — cannot resolve module `./flight`.

- [ ] **Step 3: Write `src/player/flight.ts`**

```typescript
import { Vector3, MathUtils } from 'three'

const WORLD_UP = new Vector3(0, 1, 0)
const FALLBACK_RIGHT = new Vector3(1, 0, 0)

/**
 * The kite's up axis: perpendicular to forward, rolled about forward by `bank`.
 *
 * Lift acts along this axis rather than along world up. Deriving it from a
 * cross product with velocity instead would degenerate whenever the kite moves
 * exactly where it points, and a fallback of world up in that case is not
 * perpendicular to velocity, which silently injects energy along the flight
 * path. This formulation has no degenerate case except forward being vertical,
 * which is handled explicitly.
 */
export function kiteUp(forward: Vector3, bank: number): Vector3 {
  let right = new Vector3().crossVectors(forward, WORLD_UP)
  if (right.lengthSq() < 1e-6) right = FALLBACK_RIGHT.clone()
  else right.normalize()
  const up = new Vector3().crossVectors(right, forward).normalize()
  return up.applyAxisAngle(forward, -bank)
}

/**
 * Signed angle between where the kite points and where it is moving.
 * Positive means the nose is above the flight path, which is what generates lift.
 */
export function angleOfAttack(forward: Vector3, velocity: Vector3, up: Vector3): number {
  if (velocity.lengthSq() < 1e-6) return 0
  const vdir = velocity.clone().normalize()
  const magnitude = Math.acos(MathUtils.clamp(forward.dot(vdir), -1, 1))
  // If velocity leans toward the kite's up axis, the nose is below the path.
  return up.dot(vdir) > 0 ? -magnitude : magnitude
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/player/flight.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/player/flight.ts src/player/flight.test.ts
git commit -m "Add kite orientation and derived angle of attack"
```

---

### Task 4: Flight force integration

The heart of the game. Integrates gravity, lift, drag, and thrust into a new position and velocity. This is where the measured behavior table becomes executable.

**Files:**
- Modify: `src/player/flight.ts` (append `flightStep`)
- Test: `src/player/flight-step.test.ts`

**Interfaces:**
- Consumes: `kiteUp`, `angleOfAttack` from Task 3; `FlightConfig` from `src/core/types.ts`; `DEFAULT_FLIGHT_CONFIG` from `src/core/config.ts`.
- Produces:
  - `interface FlightInput { forward: Vector3; thrust: boolean; flare: boolean; bank: number }`
  - `interface FlightResult { position: Vector3; velocity: Vector3 }`
  - `flightStep(position: Vector3, velocity: Vector3, input: FlightInput, dt: number, c: FlightConfig): FlightResult`
  - `totalEnergy(position: Vector3, velocity: Vector3, gravity: number): number` — specific energy, used by tests and by nothing else.

- [ ] **Step 1: Write the failing tests**

`src/player/flight-step.test.ts`. The `simulate` helper is the harness the whole behavior table runs through:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3, MathUtils } from 'three'
import { flightStep, totalEnergy } from './flight'
import { DEFAULT_FLIGHT_CONFIG as C } from '../core/config'

/** Fly for `seconds` holding a fixed attitude. Returns the final state. */
function simulate(opts: {
  pitchDeg: number
  seconds: number
  thrust?: boolean
  flare?: boolean
  startSpeed?: number
  /** Velocity direction, if it should differ from where the kite points. */
  velPitchDeg?: number
}) {
  const { pitchDeg, seconds, thrust = false, flare = false, startSpeed = 18 } = opts
  const rad = MathUtils.degToRad(pitchDeg)
  const forward = new Vector3(0, Math.sin(rad), -Math.cos(rad)).normalize()
  const vrad = MathUtils.degToRad(opts.velPitchDeg ?? pitchDeg)
  let position = new Vector3(0, 500, 0)
  let velocity = new Vector3(0, Math.sin(vrad), -Math.cos(vrad))
    .normalize()
    .multiplyScalar(startSpeed)
  const startEnergy = totalEnergy(position, velocity, C.gravity)
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    const next = flightStep(position, velocity, { forward, thrust, flare, bank: 0 }, dt, C)
    position = next.position
    velocity = next.velocity
  }
  return {
    altitude: position.y,
    speed: velocity.length(),
    startEnergy,
    endEnergy: totalEnergy(position, velocity, C.gravity),
  }
}

describe('flightStep', () => {
  it('does not mutate the position or velocity it is given', () => {
    const position = new Vector3(0, 100, 0)
    const velocity = new Vector3(0, 0, -20)
    flightStep(position, velocity, {
      forward: new Vector3(0, 0, -1), thrust: false, flare: false, bank: 0,
    }, 1 / 60, C)
    expect(position.toArray()).toEqual([0, 100, 0])
    expect(velocity.toArray()).toEqual([0, 0, -20])
  })

  it('a level glide sinks slowly and settles at a cruise speed', () => {
    const r = simulate({ pitchDeg: 0, seconds: 6 })
    expect(r.altitude).toBeLessThan(500)
    expect(r.altitude).toBeGreaterThan(430)
    expect(r.speed).toBeGreaterThan(20)
    expect(r.speed).toBeLessThan(28)
  })

  it('diving builds speed', () => {
    const dive = simulate({ pitchDeg: -40, seconds: 4 })
    const level = simulate({ pitchDeg: 0, seconds: 4 })
    expect(dive.speed).toBeGreaterThan(level.speed)
  })

  it('a 45 degree dive reaches roughly 42 metres per second in 2.5 seconds', () => {
    const r = simulate({ pitchDeg: -45, seconds: 2.5 })
    expect(r.speed).toBeGreaterThan(38)
    expect(r.speed).toBeLessThan(46)
  })

  it('a fast kite pulling up converts speed into altitude', () => {
    const r = simulate({ pitchDeg: 30, seconds: 2, startSpeed: 55 })
    expect(r.altitude).toBeGreaterThan(500)
    expect(r.speed).toBeLessThan(55)
  })

  it('a zoom climb gains roughly 30 metres above the pull-up point', () => {
    const r = simulate({ pitchDeg: 35, seconds: 2.5, startSpeed: 42 })
    expect(r.altitude - 500).toBeGreaterThan(18)
    expect(r.altitude - 500).toBeLessThan(45)
  })

  it('a slow kite pointing up cannot climb', () => {
    const r = simulate({ pitchDeg: 30, seconds: 2, startSpeed: 12 })
    expect(r.altitude).toBeLessThan(500)
  })

  it('a dive then climb cycle is net lossy in both height and speed', () => {
    // This is the load-bearing design property: gliding never gains net height.
    const dive = simulate({ pitchDeg: -45, seconds: 2.5 })
    const heightSpentDiving = 500 - dive.altitude
    const climb = simulate({ pitchDeg: 35, seconds: 2.5, startSpeed: dive.speed })
    const heightRegained = climb.altitude - 500
    expect(heightRegained).toBeLessThan(heightSpentDiving)
    expect(climb.speed).toBeLessThan(18)
  })

  it('an unpowered glide loses only a little energy', () => {
    const r = simulate({ pitchDeg: -10, seconds: 5 })
    const loss = (r.startEnergy - r.endEnergy) / r.startEnergy
    expect(loss).toBeGreaterThan(0)
    expect(loss).toBeLessThan(0.35)
  })

  it('thrust adds net energy, unlike gliding', () => {
    const powered = simulate({ pitchDeg: 5, seconds: 3, thrust: true })
    const glide = simulate({ pitchDeg: 5, seconds: 3, thrust: false })
    expect(powered.endEnergy).toBeGreaterThan(glide.endEnergy)
    expect(powered.altitude).toBeGreaterThan(500)
  })

  it('flaring slows the kite more than not flaring', () => {
    const flared = simulate({ pitchDeg: 0, seconds: 2, startSpeed: 40, flare: true })
    const clean = simulate({ pitchDeg: 0, seconds: 2, startSpeed: 40, flare: false })
    expect(flared.speed).toBeLessThan(clean.speed)
  })

  it('stalls: a very slow kite at high angle of attack loses lift and falls', () => {
    const r = simulate({ pitchDeg: 60, seconds: 1.5, startSpeed: 4, velPitchDeg: 0 })
    expect(r.altitude).toBeLessThan(500)
  })

  it('recovers from a stall by building speed in the fall', () => {
    const r = simulate({ pitchDeg: 60, seconds: 1.5, startSpeed: 4, velPitchDeg: 0 })
    expect(r.speed).toBeGreaterThan(4)
  })

  it('never produces non-finite values', () => {
    for (const pitchDeg of [-90, -45, 0, 45, 90]) {
      const r = simulate({ pitchDeg, seconds: 3, thrust: true })
      expect(Number.isFinite(r.altitude)).toBe(true)
      expect(Number.isFinite(r.speed)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/player/flight-step.test.ts`
Expected: FAIL — `flightStep` and `totalEnergy` are not exported.

- [ ] **Step 3: Append the implementation to `src/player/flight.ts`**

```typescript
import type { FlightConfig } from '../core/types'

export interface FlightInput {
  /** Where the kite points. Normalised. Produced by steering (Task 5). */
  forward: Vector3
  thrust: boolean
  flare: boolean
  /** Roll about the forward axis, radians. */
  bank: number
}

export interface FlightResult {
  position: Vector3
  velocity: Vector3
}

/** Specific energy: potential plus kinetic, per unit mass. */
export function totalEnergy(position: Vector3, velocity: Vector3, gravity: number): number {
  return gravity * position.y + 0.5 * velocity.lengthSq()
}

/**
 * Integrate one step of kite flight. Pure: never mutates its arguments.
 *
 * Lift uses sin(2·aoa) rather than cos(aoa) so that lift peaks near 45 degrees
 * and falls away past it, which is what makes stalling emerge from the geometry
 * instead of needing a special case.
 */
export function flightStep(
  position: Vector3,
  velocity: Vector3,
  input: FlightInput,
  dt: number,
  c: FlightConfig,
): FlightResult {
  const speed = velocity.length()
  const vdir = speed > 0.01 ? velocity.clone().normalize() : input.forward.clone()
  const up = kiteUp(input.forward, input.bank)

  const aoa = angleOfAttack(input.forward, velocity, up)
  const effectiveAoa = aoa + (input.flare ? c.flareAoaBoost : 0) + c.rigAoa

  // Lift falls off linearly below stall speed rather than cutting off abruptly.
  const stallFactor = speed < c.stallSpeed ? Math.max(0, speed / c.stallSpeed) : 1
  const clampedAoa = MathUtils.clamp(effectiveAoa, -1.2, 1.2)
  const liftMag = c.liftCoeff * speed * speed * Math.sin(2 * clampedAoa) * stallFactor
  const dragMag =
    c.dragCoeff * speed * speed * (1 + c.inducedDragFactor * Math.sin(effectiveAoa) ** 2)

  // Lift acts perpendicular to velocity, in the plane containing the kite's up axis.
  let liftDir = up.clone().addScaledVector(vdir, -up.dot(vdir))
  if (liftDir.lengthSq() < 1e-8) liftDir = new Vector3(0, 1, 0)
  else liftDir.normalize()

  const accel = new Vector3(0, -c.gravity, 0)
  accel.addScaledVector(liftDir, liftMag)
  accel.addScaledVector(vdir, -dragMag)
  if (input.thrust) accel.addScaledVector(input.forward, c.thrustAccel)

  const nextVelocity = velocity.clone().addScaledVector(accel, dt)
  const nextPosition = position.clone().addScaledVector(nextVelocity, dt)
  return { position: nextPosition, velocity: nextVelocity }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/player/flight-step.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/player/flight.ts src/player/flight-step.test.ts
git commit -m "Add flight force integration with validated tuning"
```

---

### Task 5: Steering the kite toward the look direction

Turns the camera direction into the kite's forward vector, at a rate limited by airspeed. This single constant is what makes the kite feel like a kite: fast flight turns wide, slow flight turns tight.

**Files:**
- Create: `src/player/steering.ts`
- Test: `src/player/steering.test.ts`

**Interfaces:**
- Consumes: `FlightConfig` from `src/core/types.ts`, `DEFAULT_FLIGHT_CONFIG` from `src/core/config.ts`.
- Produces:
  - `turnRateFor(speed: number, bankInput: number, c: FlightConfig): number` — radians per second.
  - `steerToward(current: Vector3, target: Vector3, speed: number, bankInput: number, dt: number, c: FlightConfig): Vector3` — a new normalised forward vector, rotated toward `target` by at most the turn rate.

- [ ] **Step 1: Write the failing tests**

`src/player/steering.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { steerToward, turnRateFor } from './steering'
import { DEFAULT_FLIGHT_CONFIG as C } from '../core/config'

const FWD = new Vector3(0, 0, -1)

describe('turnRateFor', () => {
  it('turns tighter when slow than when fast', () => {
    expect(turnRateFor(10, 0, C)).toBeGreaterThan(turnRateFor(55, 0, C))
  })

  it('bank input increases the turn rate', () => {
    expect(turnRateFor(30, 1, C)).toBeGreaterThan(turnRateFor(30, 0, C))
  })

  it('is always positive even at absurd speed', () => {
    expect(turnRateFor(10000, 0, C)).toBeGreaterThan(0)
  })
})

describe('steerToward', () => {
  it('snaps to the target when it is within reach this step', () => {
    const target = new Vector3(0, 0.02, -1).normalize()
    const out = steerToward(FWD, target, 24, 0, 1 / 60, C)
    expect(out.angleTo(target)).toBeCloseTo(0, 6)
  })

  it('clamps the step to the turn rate when the target is far', () => {
    const target = new Vector3(1, 0, 0)
    const dt = 1 / 60
    const out = steerToward(FWD, target, 24, 0, dt, C)
    expect(out.angleTo(FWD)).toBeCloseTo(turnRateFor(24, 0, C) * dt, 5)
  })

  it('moves toward the target, not away from it', () => {
    const target = new Vector3(1, 0, 0)
    const out = steerToward(FWD, target, 24, 0, 1 / 60, C)
    expect(out.angleTo(target)).toBeLessThan(FWD.angleTo(target))
  })

  it('returns a normalised vector', () => {
    expect(steerToward(FWD, new Vector3(1, 1, 1), 24, 0, 1 / 60, C).length())
      .toBeCloseTo(1, 6)
  })

  it('handles an exactly opposite target without NaN', () => {
    const out = steerToward(FWD, new Vector3(0, 0, 1), 24, 0, 1 / 60, C)
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
    expect(out.length()).toBeCloseTo(1, 6)
  })

  it('a fast kite takes more steps to reverse than a slow one', () => {
    const turns = (speed: number) => {
      let f = FWD.clone()
      const target = new Vector3(0, 0, 1)
      let n = 0
      while (f.angleTo(target) > 0.05 && n < 10000) {
        f = steerToward(f, target, speed, 0, 1 / 60, C)
        n++
      }
      return n
    }
    expect(turns(55)).toBeGreaterThan(turns(12))
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/player/steering.test.ts`
Expected: FAIL — cannot resolve module `./steering`.

- [ ] **Step 3: Write `src/player/steering.ts`**

```typescript
import { Vector3, MathUtils } from 'three'
import type { FlightConfig } from '../core/types'

const WORLD_UP = new Vector3(0, 1, 0)

/**
 * Angular speed the kite can turn at. Slow flight turns tight, fast flight
 * turns wide, which is where the sense of the kite having weight comes from.
 */
export function turnRateFor(speed: number, bankInput: number, c: FlightConfig): number {
  const speedFactor = MathUtils.clamp(c.turnRateSpeedRef / Math.max(speed, 1), 0.25, 1.5)
  return c.baseTurnRate * speedFactor + Math.abs(bankInput) * c.bankTurnRate
}

/** Rotate `current` toward `target` by at most this step's allowed turn. */
export function steerToward(
  current: Vector3,
  target: Vector3,
  speed: number,
  bankInput: number,
  dt: number,
  c: FlightConfig,
): Vector3 {
  const from = current.clone().normalize()
  const to = target.clone().normalize()
  const angle = from.angleTo(to)
  if (angle < 1e-6) return to

  const maxStep = turnRateFor(speed, bankInput, c) * dt
  if (angle <= maxStep) return to

  let axis = new Vector3().crossVectors(from, to)
  if (axis.lengthSq() < 1e-12) {
    // Exactly opposite: the cross product gives no axis, so pick any perpendicular.
    axis = new Vector3().crossVectors(from, WORLD_UP)
    if (axis.lengthSq() < 1e-12) axis = new Vector3(1, 0, 0)
  }
  return from.applyAxisAngle(axis.normalize(), maxStep).normalize()
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/player/steering.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/player/steering.ts src/player/steering.test.ts
git commit -m "Add airspeed-limited kite steering"
```

---

### Task 6: Breath meter

The single resource behind all airbending, now and after attacks are added. Thrust spends it, rest restores it, and shrines raise its ceiling.

**Files:**
- Create: `src/player/breath.ts`
- Test: `src/player/breath.test.ts`

**Interfaces:**
- Consumes: `FlightConfig` from `src/core/types.ts`, `DEFAULT_FLIGHT_CONFIG` from `src/core/config.ts`.
- Produces:
  - `interface BreathState { breath: number; maxBreath: number }`
  - `stepBreath(s: BreathState, thrusting: boolean, grounded: boolean, dt: number, c: FlightConfig): BreathState`
  - `canThrust(s: BreathState): boolean`
  - `applyShrineBonus(s: BreathState, c: FlightConfig): BreathState`

- [ ] **Step 1: Write the failing tests**

`src/player/breath.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { stepBreath, canThrust, applyShrineBonus } from './breath'
import { DEFAULT_FLIGHT_CONFIG as C } from '../core/config'

const full = { breath: 100, maxBreath: 100 }

describe('stepBreath', () => {
  it('drains while thrusting', () => {
    expect(stepBreath(full, true, false, 1, C).breath)
      .toBeCloseTo(100 - C.breathDrainPerSecond, 5)
  })

  it('regenerates while not thrusting', () => {
    const s = stepBreath({ breath: 50, maxBreath: 100 }, false, false, 1, C)
    expect(s.breath).toBeCloseTo(50 + C.breathRegenPerSecond, 5)
  })

  it('regenerates faster on the ground', () => {
    const air = stepBreath({ breath: 50, maxBreath: 100 }, false, false, 1, C)
    const ground = stepBreath({ breath: 50, maxBreath: 100 }, false, true, 1, C)
    expect(ground.breath).toBeGreaterThan(air.breath)
  })

  it('never goes below zero', () => {
    expect(stepBreath({ breath: 1, maxBreath: 100 }, true, false, 5, C).breath).toBe(0)
  })

  it('never exceeds the maximum', () => {
    expect(stepBreath(full, false, true, 10, C).breath).toBe(100)
  })

  it('does not mutate the state it is given', () => {
    const s = { breath: 50, maxBreath: 100 }
    stepBreath(s, true, false, 1, C)
    expect(s.breath).toBe(50)
  })
})

describe('canThrust', () => {
  it('is false when out of breath', () => {
    expect(canThrust({ breath: 0, maxBreath: 100 })).toBe(false)
  })

  it('is true with breath remaining', () => {
    expect(canThrust({ breath: 0.5, maxBreath: 100 })).toBe(true)
  })
})

describe('applyShrineBonus', () => {
  it('raises the maximum by ten percent of the base', () => {
    expect(applyShrineBonus(full, C).maxBreath).toBeCloseTo(110, 5)
  })

  it('eight shrines roughly double the maximum', () => {
    let s = full
    for (let i = 0; i < 8; i++) s = applyShrineBonus(s, C)
    expect(s.maxBreath).toBeCloseTo(180, 5)
  })

  it('does not raise current breath above the new maximum', () => {
    expect(applyShrineBonus({ breath: 100, maxBreath: 100 }, C).breath).toBe(100)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/player/breath.test.ts`
Expected: FAIL — cannot resolve module `./breath`.

- [ ] **Step 3: Write `src/player/breath.ts`**

```typescript
import { MathUtils } from 'three'
import type { FlightConfig } from '../core/types'

export interface BreathState {
  breath: number
  maxBreath: number
}

/** Drain while thrusting, otherwise recover — faster with feet on the ground. */
export function stepBreath(
  s: BreathState,
  thrusting: boolean,
  grounded: boolean,
  dt: number,
  c: FlightConfig,
): BreathState {
  const rate = thrusting
    ? -c.breathDrainPerSecond
    : c.breathRegenPerSecond * (grounded ? c.breathRegenGroundedMultiplier : 1)
  return { ...s, breath: MathUtils.clamp(s.breath + rate * dt, 0, s.maxBreath) }
}

export function canThrust(s: BreathState): boolean {
  return s.breath > 0
}

/** Collecting a shrine permanently raises the ceiling. */
export function applyShrineBonus(s: BreathState, c: FlightConfig): BreathState {
  const maxBreath = s.maxBreath + c.baseMaxBreath * c.shrineBreathBonusFraction
  return { breath: Math.min(s.breath, maxBreath), maxBreath }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/player/breath.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/player/breath.ts src/player/breath.test.ts
git commit -m "Add breath meter with shrine bonuses"
```

---

### Task 7: Input

Turns keyboard and mouse into a single `InputState` of *intent*, so movement code never sees key codes. The look-direction maths and the key mapping are pure and tested; only a thin adapter touches the DOM.

**Files:**
- Create: `src/core/input.ts`
- Test: `src/core/input.test.ts`

**Interfaces:**
- Consumes: `InputState` from `src/core/types.ts`.
- Produces:
  - `PITCH_LIMIT: number` — radians, just under 90° so the view never flips.
  - `clampPitch(pitch: number): number`
  - `lookDirectionFrom(yaw: number, pitch: number): Vector3`
  - `toInputState(held: ReadonlySet<string>, lookDirection: Vector3, actionPressed: boolean): InputState`
  - `class InputTracker { constructor(target: EventTarget, canvas: HTMLCanvasElement); sample(): InputState; dispose(): void }` — DOM adapter. `sample()` clears the `actionPressed` edge, so call it exactly once per frame.

- [ ] **Step 1: Write the failing tests**

`src/core/input.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3, MathUtils } from 'three'
import { clampPitch, lookDirectionFrom, toInputState, PITCH_LIMIT } from './input'

describe('clampPitch', () => {
  it('leaves a level view alone', () => {
    expect(clampPitch(0)).toBe(0)
  })

  it('stops the view before straight up', () => {
    expect(clampPitch(Math.PI)).toBeCloseTo(PITCH_LIMIT, 6)
    expect(PITCH_LIMIT).toBeLessThan(Math.PI / 2)
  })

  it('stops the view before straight down', () => {
    expect(clampPitch(-Math.PI)).toBeCloseTo(-PITCH_LIMIT, 6)
  })
})

describe('lookDirectionFrom', () => {
  it('looks down negative Z at zero yaw and pitch', () => {
    const d = lookDirectionFrom(0, 0)
    expect(d.x).toBeCloseTo(0, 6)
    expect(d.y).toBeCloseTo(0, 6)
    expect(d.z).toBeCloseTo(-1, 6)
  })

  it('is always normalised', () => {
    for (const yaw of [0, 1, 2, -3]) {
      for (const pitch of [-1, 0, 0.5]) {
        expect(lookDirectionFrom(yaw, pitch).length()).toBeCloseTo(1, 6)
      }
    }
  })

  it('positive pitch looks upward', () => {
    expect(lookDirectionFrom(0, MathUtils.degToRad(30)).y).toBeGreaterThan(0)
  })

  it('yawing ninety degrees looks down negative X', () => {
    const d = lookDirectionFrom(Math.PI / 2, 0)
    expect(d.x).toBeCloseTo(-1, 6)
    expect(d.z).toBeCloseTo(0, 6)
  })
})

const LOOK = new Vector3(0, 0, -1)

describe('toInputState', () => {
  it('W gives positive forward', () => {
    expect(toInputState(new Set(['KeyW']), LOOK, false).forward).toBe(1)
  })

  it('S gives negative forward', () => {
    expect(toInputState(new Set(['KeyS']), LOOK, false).forward).toBe(-1)
  })

  it('W and S together cancel', () => {
    expect(toInputState(new Set(['KeyW', 'KeyS']), LOOK, false).forward).toBe(0)
  })

  it('D gives positive strafe and A negative', () => {
    expect(toInputState(new Set(['KeyD']), LOOK, false).strafe).toBe(1)
    expect(toInputState(new Set(['KeyA']), LOOK, false).strafe).toBe(-1)
  })

  it('either shift key sprints', () => {
    expect(toInputState(new Set(['ShiftLeft']), LOOK, false).sprint).toBe(true)
    expect(toInputState(new Set(['ShiftRight']), LOOK, false).sprint).toBe(true)
    expect(toInputState(new Set(), LOOK, false).sprint).toBe(false)
  })

  it('passes the action edge through', () => {
    expect(toInputState(new Set(), LOOK, true).actionPressed).toBe(true)
  })

  it('normalises the look direction it is handed', () => {
    expect(toInputState(new Set(), new Vector3(0, 0, -7), false).lookDirection.length())
      .toBeCloseTo(1, 6)
  })

  it('does not alias the caller look vector', () => {
    const look = new Vector3(0, 0, -1)
    toInputState(new Set(), look, false).lookDirection.set(1, 1, 1)
    expect(look.toArray()).toEqual([0, 0, -1])
  })

  it('ignores unmapped keys', () => {
    const s = toInputState(new Set(['KeyQ', 'Digit1']), LOOK, false)
    expect(s.forward).toBe(0)
    expect(s.strafe).toBe(0)
    expect(s.sprint).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/core/input.test.ts`
Expected: FAIL — cannot resolve module `./input`.

- [ ] **Step 3: Write the pure part of `src/core/input.ts`**

```typescript
import { Vector3, MathUtils } from 'three'
import type { InputState } from './types'

/** Just under vertical, so looking straight up can never flip the view. */
export const PITCH_LIMIT = MathUtils.degToRad(85)

export function clampPitch(pitch: number): number {
  return MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT)
}

export function lookDirectionFrom(yaw: number, pitch: number): Vector3 {
  const cp = Math.cos(pitch)
  return new Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp).normalize()
}

/** Map held key codes to intent. Movement code never sees key codes. */
export function toInputState(
  held: ReadonlySet<string>,
  lookDirection: Vector3,
  actionPressed: boolean,
): InputState {
  const axis = (pos: string, neg: string) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0)
  return {
    lookDirection: lookDirection.clone().normalize(),
    forward: axis('KeyW', 'KeyS'),
    strafe: axis('KeyD', 'KeyA'),
    sprint: held.has('ShiftLeft') || held.has('ShiftRight'),
    actionPressed,
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/core/input.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Append the DOM adapter to `src/core/input.ts`**

This is deliberately thin — all the logic it could get wrong lives in the tested functions above. It is exercised by hand in Task 20.

```typescript
const MOUSE_SENSITIVITY = 0.0022

export class InputTracker {
  private readonly held = new Set<string>()
  private yaw = 0
  private pitch = 0
  private actionPressed = false
  private readonly listeners: (() => void)[] = []

  constructor(target: EventTarget, canvas: HTMLCanvasElement) {
    const on = <E extends Event>(type: string, handler: (e: E) => void) => {
      const fn = handler as (e: Event) => void
      target.addEventListener(type, fn)
      this.listeners.push(() => target.removeEventListener(type, fn))
    }

    on<KeyboardEvent>('keydown', (e) => {
      this.held.add(e.code)
      if (e.code === 'Space') {
        this.actionPressed = true
        e.preventDefault()
      }
    })
    on<KeyboardEvent>('keyup', (e) => this.held.delete(e.code))
    // Held keys would otherwise stick when the window loses focus.
    on('blur', () => this.held.clear())

    on<MouseEvent>('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return
      this.yaw -= e.movementX * MOUSE_SENSITIVITY
      this.pitch = clampPitch(this.pitch - e.movementY * MOUSE_SENSITIVITY)
    })

    const requestLock = () => void canvas.requestPointerLock()
    canvas.addEventListener('click', requestLock)
    this.listeners.push(() => canvas.removeEventListener('click', requestLock))
  }

  /** Call exactly once per frame: reading clears the action edge. */
  sample(): InputState {
    const state = toInputState(
      this.held,
      lookDirectionFrom(this.yaw, this.pitch),
      this.actionPressed,
    )
    this.actionPressed = false
    return state
  }

  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners.length = 0
  }
}
```

- [ ] **Step 6: Verify the suite and typecheck still pass**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/input.ts src/core/input.test.ts
git commit -m "Add input mapping and pointer-lock tracker"
```

---

### Task 8: Island mesh generation

Generates a floating island's geometry deterministically from a seed: a noise-displaced sphere, squashed flat on top so it is walkable and stretched into a spike below so it reads as torn from the ground.

**Files:**
- Create: `src/world/island.ts`
- Test: `src/world/island.test.ts`

**Interfaces:**
- Consumes: `seededNoise2D` from `src/core/rng.ts`.
- Produces:
  - `type Biome = 'grass' | 'rock' | 'temple'`
  - `interface IslandDef { id: string; position: Vector3; radius: number; height: number; biome: Biome; noiseSeed: number }`
  - `createIslandGeometry(def: IslandDef): BufferGeometry` — geometry centred on the origin. The caller positions the mesh; `def.position` is carried for level data, not baked into the vertices.

- [ ] **Step 1: Write the failing tests**

`src/world/island.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createIslandGeometry, type IslandDef } from './island'

const def = (over: Partial<IslandDef> = {}): IslandDef => ({
  id: 'test',
  position: new Vector3(0, 0, 0),
  radius: 40,
  height: 30,
  biome: 'grass',
  noiseSeed: 1234,
  ...over,
})

function positions(d: IslandDef): Float32Array {
  return createIslandGeometry(d).attributes.position!.array as Float32Array
}

describe('createIslandGeometry', () => {
  it('produces geometry with vertices', () => {
    expect(createIslandGeometry(def()).attributes.position!.count).toBeGreaterThan(100)
  })

  it('is deterministic for the same seed', () => {
    expect(Array.from(positions(def()))).toEqual(Array.from(positions(def())))
  })

  it('differs for different seeds', () => {
    expect(Array.from(positions(def({ noiseSeed: 1 }))))
      .not.toEqual(Array.from(positions(def({ noiseSeed: 2 }))))
  })

  it('respects the requested radius', () => {
    const box = createIslandGeometry(def({ radius: 40 })).boundingBox!
    const horizontal = Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z)
    expect(horizontal).toBeGreaterThan(40 * 0.6)
    expect(horizontal).toBeLessThan(40 * 1.4)
  })

  it('scales with radius', () => {
    const small = createIslandGeometry(def({ radius: 20 })).boundingBox!
    const large = createIslandGeometry(def({ radius: 60 })).boundingBox!
    expect(large.max.x).toBeGreaterThan(small.max.x)
  })

  it('has a flatter top than bottom, so it reads as a floating island', () => {
    const box = createIslandGeometry(def()).boundingBox!
    expect(Math.abs(box.min.y)).toBeGreaterThan(box.max.y * 2)
  })

  it('computes vertex normals', () => {
    expect(createIslandGeometry(def()).attributes.normal).toBeDefined()
  })

  it('computes a bounding sphere, required for raycasting', () => {
    expect(createIslandGeometry(def()).boundingSphere!.radius).toBeGreaterThan(0)
  })

  it('contains no non-finite coordinates', () => {
    for (const n of positions(def())) expect(Number.isFinite(n)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/world/island.test.ts`
Expected: FAIL — cannot resolve module `./island`.

- [ ] **Step 3: Write `src/world/island.ts`**

```typescript
import { IcosahedronGeometry, BufferGeometry, Vector3 } from 'three'
import { seededNoise2D } from '../core/rng'

export type Biome = 'grass' | 'rock' | 'temple'

export interface IslandDef {
  id: string
  position: Vector3
  radius: number
  height: number
  biome: Biome
  noiseSeed: number
}

/** How strongly noise displaces the silhouette, and how the shape is squashed. */
const ROUGHNESS = 0.28
const NOISE_FREQUENCY = 1.6
const TOP_FLATTEN = 0.35
const BOTTOM_STRETCH = 1.9
const DETAIL = 4

/**
 * A floating island: a noise-displaced sphere squashed flat on top so it is
 * walkable, and stretched into a spike below so it reads as torn from the ground.
 * Deterministic — the same noiseSeed always produces identical geometry.
 *
 * An icosphere is used rather than a heightmap because a heightmap cannot
 * express the underside and overhangs a floating island needs.
 */
export function createIslandGeometry(def: IslandDef): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, DETAIL)
  const position = geometry.attributes.position
  if (!position) throw new Error('IcosahedronGeometry produced no position attribute')
  const noise = seededNoise2D(def.noiseSeed)
  const v = new Vector3()

  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
    const displacement = 1 + noise(v.x * NOISE_FREQUENCY, v.z * NOISE_FREQUENCY) * ROUGHNESS
    v.multiplyScalar(displacement)
    v.y *= v.y > 0 ? TOP_FLATTEN : BOTTOM_STRETCH
    v.x *= def.radius
    v.z *= def.radius
    v.y *= def.height
    position.setXYZ(i, v.x, v.y, v.z)
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/world/island.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/world/island.ts src/world/island.test.ts
git commit -m "Add deterministic island mesh generation"
```

---

### Task 9: Terrain query

The only channel through which movement code may ask about the ground. Because movement depends on this interface and never on island meshes, the island representation stays swappable.

**Files:**
- Create: `src/world/terrain-query.ts`
- Test: `src/world/terrain-query.test.ts`

**Interfaces:**
- Consumes: `TerrainQuery` and `TerrainHit` from `src/core/types.ts`; `createIslandGeometry` and `IslandDef` from Task 8.
- Produces:
  - `interface IslandMesh { id: string; mesh: Mesh }`
  - `createTerrainQuery(islands: readonly IslandMesh[]): TerrainQuery`

- [ ] **Step 1: Write the failing tests**

Raycasting is pure CPU work in Three.js, so this needs no WebGL context and runs headless.

`src/world/terrain-query.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { createIslandGeometry, type IslandDef } from './island'
import { createTerrainQuery, type IslandMesh } from './terrain-query'

function island(id: string, position: Vector3, radius = 40): IslandMesh {
  const def: IslandDef = { id, position, radius, height: 30, biome: 'grass', noiseSeed: 7 }
  const mesh = new Mesh(createIslandGeometry(def), new MeshBasicMaterial())
  mesh.position.copy(position)
  mesh.updateMatrixWorld(true)
  return { id, mesh }
}

describe('createTerrainQuery', () => {
  const origin = island('origin', new Vector3(0, 0, 0))
  const far = island('far', new Vector3(500, 120, 0))
  const query = createTerrainQuery([origin, far])

  it('finds ground above the centre of an island', () => {
    expect(query.groundHeightAt(0, 0)).not.toBeNull()
  })

  it('returns null in open sky between islands', () => {
    expect(query.groundHeightAt(250, 0)).toBeNull()
  })

  it('reports a higher surface for an island placed higher', () => {
    const low = query.groundHeightAt(0, 0)!
    const high = query.groundHeightAt(500, 0)!
    expect(high).toBeGreaterThan(low)
    expect(high).toBeGreaterThan(100)
  })

  it('raycastDown reports which island was hit', () => {
    expect(query.raycastDown(new Vector3(0, 300, 0), 1000)!.islandId).toBe('origin')
    expect(query.raycastDown(new Vector3(500, 400, 0), 1000)!.islandId).toBe('far')
  })

  it('raycastDown returns null when nothing is below', () => {
    expect(query.raycastDown(new Vector3(250, 300, 0), 1000)).toBeNull()
  })

  it('respects the max distance', () => {
    expect(query.raycastDown(new Vector3(0, 300, 0), 5)).toBeNull()
  })

  it('returns an upward-ish normal on top of an island', () => {
    expect(query.raycastDown(new Vector3(0, 300, 0), 1000)!.normal.y).toBeGreaterThan(0)
  })

  it('does not alias its returned point into caller state', () => {
    const hit = query.raycastDown(new Vector3(0, 300, 0), 1000)!
    const y = hit.point.y
    hit.point.set(0, 0, 0)
    expect(query.raycastDown(new Vector3(0, 300, 0), 1000)!.point.y).toBeCloseTo(y, 6)
  })

  it('an empty world reports no ground anywhere', () => {
    const empty = createTerrainQuery([])
    expect(empty.groundHeightAt(0, 0)).toBeNull()
    expect(empty.raycastDown(new Vector3(0, 100, 0), 1000)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/world/terrain-query.test.ts`
Expected: FAIL — cannot resolve module `./terrain-query`.

- [ ] **Step 3: Write `src/world/terrain-query.ts`**

```typescript
import { Raycaster, Vector3, Mesh } from 'three'
import type { TerrainQuery, TerrainHit } from '../core/types'

const DOWN = new Vector3(0, -1, 0)
/** How far above the tallest island to start a height probe. */
const PROBE_MARGIN = 200

export interface IslandMesh {
  id: string
  mesh: Mesh
}

/**
 * The single channel through which movement code asks about the ground.
 * One shared Raycaster is reused rather than allocated per query, because this
 * runs every frame.
 */
export function createTerrainQuery(islands: readonly IslandMesh[]): TerrainQuery {
  const raycaster = new Raycaster()
  const meshes = islands.map((i) => i.mesh)
  const idByMesh = new Map<Mesh, string>(islands.map((i) => [i.mesh, i.id]))

  // Probe from above everything, so groundHeightAt finds the highest surface.
  let probeHeight = PROBE_MARGIN
  for (const { mesh } of islands) {
    mesh.updateMatrixWorld(true)
    const sphere = mesh.geometry.boundingSphere
    if (sphere) {
      probeHeight = Math.max(probeHeight, mesh.position.y + sphere.radius + PROBE_MARGIN)
    }
  }

  function raycastDown(from: Vector3, maxDistance: number): TerrainHit | null {
    raycaster.set(from, DOWN)
    raycaster.near = 0
    raycaster.far = maxDistance
    const hit = raycaster.intersectObjects(meshes, false)[0]
    if (!hit) return null
    return {
      point: hit.point.clone(),
      normal: hit.normal ? hit.normal.clone() : new Vector3(0, 1, 0),
      islandId: idByMesh.get(hit.object as Mesh) ?? 'unknown',
    }
  }

  return {
    raycastDown,
    groundHeightAt(x: number, z: number): number | null {
      const hit = raycastDown(new Vector3(x, probeHeight, z), probeHeight * 2 + PROBE_MARGIN)
      return hit ? hit.point.y : null
    },
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/world/terrain-query.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/world/terrain-query.ts src/world/terrain-query.test.ts
git commit -m "Add terrain query for ground height and downward raycasts"
```

---
