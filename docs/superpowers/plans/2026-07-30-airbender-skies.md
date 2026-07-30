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

## Execution Order

Tasks run in numeric order **except that Task 19 runs before Task 14**:

```
1 … 13, 19, 14, 15, 16, 17, 18, 20
```

Task 14's `src/core/renderer.ts` imports `BASE_FOV` from `src/fx/mapping.ts`, which
Task 19 creates. Field of view is a speed effect, so the constant belongs in `fx/mapping.ts`
rather than being duplicated in the renderer — and Task 19 depends on nothing from Tasks
14–18, so moving it earlier costs nothing. Numbering is left alone so task references stay
stable.

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
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore` (already exists — verify), `.npmrc`, `README.md`
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
npm i --save-exact three@0.185.1 simplex-noise@4.0.3
npm i --save-exact -D typescript@7.0.2 vite@8.1.5 vitest@4.1.10 @types/three@0.185.1
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
  /** Roll about the forward axis, radians. */
  bank?: number
}) {
  const { pitchDeg, seconds, thrust = false, flare = false, startSpeed = 18, bank = 0 } = opts
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
    const next = flightStep(position, velocity, { forward, thrust, flare, bank }, dt, C)
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

  it('an unpowered glide still loses energy with a non-zero bank', () => {
    // Regression: liftDir must stay perpendicular to velocity even when kiteUp
    // sweeps off vertical under bank, otherwise lift does work along the flight
    // path and gliding could gain energy instead of losing it.
    for (const bank of [0.7, -0.7, 1.5, -1.5]) {
      const r = simulate({ pitchDeg: 0, seconds: 4, bank })
      expect(r.endEnergy).toBeLessThan(r.startEnergy)
    }
  })

  it('does not mutate the position or velocity it is given, with a non-zero bank', () => {
    const position = new Vector3(0, 100, 0)
    const velocity = new Vector3(0, 0, -20)
    flightStep(position, velocity, {
      forward: new Vector3(0, 0, -1), thrust: false, flare: false, bank: 0.7,
    }, 1 / 60, C)
    expect(position.toArray()).toEqual([0, 100, 0])
    expect(velocity.toArray()).toEqual([0, 0, -20])
  })

  it('never produces non-finite values across a range of bank angles', () => {
    for (const bank of [-1.5, -0.7, 0, 0.7, 1.5]) {
      const r = simulate({ pitchDeg: -20, seconds: 3, thrust: true, bank })
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
  if (liftDir.lengthSq() < 1e-8) {
    // up is parallel to velocity, so the projection gives no direction. Any vector
    // perpendicular to velocity will do, and it MUST be perpendicular: a fallback
    // with a velocity-parallel component would do work along the flight path and
    // inject energy, which would break the invariant that gliding never gains height.
    liftDir = new Vector3().crossVectors(vdir, WORLD_UP)
    if (liftDir.lengthSq() < 1e-8) liftDir = new Vector3().crossVectors(vdir, FALLBACK_RIGHT)
  }
  liftDir.normalize()

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
Expected: PASS, 17 tests.

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

### Task 10: Level data, validation, and the archipelago

The level is authored by hand so exploration has designed sightlines and a route that teaches flight. Validation catches authoring mistakes with readable messages instead of letting the player fall through a broken world.

**Files:**
- Create: `src/world/level.ts`
- Create: `src/world/levels/archipelago.ts`
- Test: `src/world/level.test.ts`

**Interfaces:**
- Consumes: `IslandDef` and `Biome` from Task 8.
- Produces:
  - `interface ShrineDef { islandId: string; offset: Vector3 }`
  - `interface Level { id: string; spawn: { islandId: string; offset: Vector3 }; worldFloorY: number; islands: IslandDef[]; shrines: ShrineDef[] }`
  - `validateLevel(level: Level): void` — throws with a readable message on any structural error.
  - `findOverlappingIslands(level: Level): [string, string][]` — authoring feedback, does not throw.
  - `ARCHIPELAGO: Level` from `src/world/levels/archipelago.ts`.

- [ ] **Step 1: Write the failing tests**

`src/world/level.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { validateLevel, findOverlappingIslands, type Level } from './level'
import { ARCHIPELAGO } from './levels/archipelago'

const base = (): Level => ({
  id: 'test',
  spawn: { islandId: 'a', offset: new Vector3(0, 5, 0) },
  worldFloorY: -500,
  islands: [{
    id: 'a', position: new Vector3(0, 0, 0), radius: 40, height: 20,
    biome: 'grass', noiseSeed: 1,
  }],
  shrines: [],
})

describe('validateLevel', () => {
  it('accepts a minimal valid level', () => {
    expect(() => validateLevel(base())).not.toThrow()
  })

  it('rejects a level with no islands', () => {
    expect(() => validateLevel({ ...base(), islands: [] })).toThrow(/no islands/)
  })

  it('rejects duplicate island ids', () => {
    const l = base()
    l.islands.push({ ...l.islands[0]! })
    expect(() => validateLevel(l)).toThrow(/duplicate island id "a"/)
  })

  it('rejects a spawn on an unknown island', () => {
    expect(() => validateLevel({ ...base(), spawn: { islandId: 'nope', offset: new Vector3() } }))
      .toThrow(/unknown island "nope"/)
  })

  it('rejects a shrine on an unknown island', () => {
    expect(() => validateLevel({
      ...base(), shrines: [{ islandId: 'ghost', offset: new Vector3() }],
    })).toThrow(/unknown island "ghost"/)
  })

  it('rejects a non-positive radius', () => {
    const l = base()
    l.islands[0]!.radius = 0
    expect(() => validateLevel(l)).toThrow(/radius > 0/)
  })

  it('rejects a non-positive height', () => {
    const l = base()
    l.islands[0]!.height = -5
    expect(() => validateLevel(l)).toThrow(/height > 0/)
  })

  it('rejects a world floor above the lowest island', () => {
    expect(() => validateLevel({ ...base(), worldFloorY: 100 })).toThrow(/worldFloorY/)
  })
})

describe('findOverlappingIslands', () => {
  it('finds none in a well-spaced level', () => {
    expect(findOverlappingIslands(base())).toEqual([])
  })

  it('flags two islands sharing the same space', () => {
    const l = base()
    l.islands.push({
      id: 'b', position: new Vector3(5, 0, 5), radius: 40, height: 20,
      biome: 'rock', noiseSeed: 2,
    })
    expect(findOverlappingIslands(l)).toEqual([['a', 'b']])
  })

  it('does not flag islands separated vertically', () => {
    const l = base()
    l.islands.push({
      id: 'b', position: new Vector3(0, 400, 0), radius: 40, height: 20,
      biome: 'rock', noiseSeed: 2,
    })
    expect(findOverlappingIslands(l)).toEqual([])
  })
})

describe('ARCHIPELAGO', () => {
  it('is valid', () => {
    expect(() => validateLevel(ARCHIPELAGO)).not.toThrow()
  })

  it('has exactly eight islands', () => {
    expect(ARCHIPELAGO.islands).toHaveLength(8)
  })

  it('has one shrine per island', () => {
    expect(ARCHIPELAGO.shrines).toHaveLength(ARCHIPELAGO.islands.length)
    expect(new Set(ARCHIPELAGO.shrines.map((s) => s.islandId)).size).toBe(8)
  })

  it('has no overlapping islands', () => {
    expect(findOverlappingIslands(ARCHIPELAGO)).toEqual([])
  })

  it('spawns on the home island', () => {
    expect(ARCHIPELAGO.spawn.islandId).toBe('home')
  })

  it('places the spire highest and above the glide ring', () => {
    const y = (id: string) => ARCHIPELAGO.islands.find((i) => i.id === id)!.position.y
    expect(y('spire')).toBeGreaterThan(y('climb-far'))
    expect(y('climb-north')).toBeGreaterThan(y('home'))
    expect(y('ring-east')).toBeLessThan(y('home'))
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/world/level.test.ts`
Expected: FAIL — cannot resolve module `./level`.

- [ ] **Step 3: Write `src/world/level.ts`**

```typescript
import type { Vector3 } from 'three'
import type { IslandDef } from './island'

export interface ShrineDef {
  islandId: string
  offset: Vector3
}

export interface Level {
  id: string
  spawn: { islandId: string; offset: Vector3 }
  /** Falling below this height triggers a respawn. */
  worldFloorY: number
  islands: IslandDef[]
  shrines: ShrineDef[]
}

/** Throws on any structural error, with a message that names the offender. */
export function validateLevel(level: Level): void {
  if (level.islands.length === 0) throw new Error(`Level "${level.id}" has no islands`)

  const ids = new Set<string>()
  for (const island of level.islands) {
    if (ids.has(island.id)) {
      throw new Error(`Level "${level.id}" has duplicate island id "${island.id}"`)
    }
    ids.add(island.id)
    if (!(island.radius > 0)) {
      throw new Error(`Island "${island.id}" must have radius > 0, got ${island.radius}`)
    }
    if (!(island.height > 0)) {
      throw new Error(`Island "${island.id}" must have height > 0, got ${island.height}`)
    }
  }

  if (!ids.has(level.spawn.islandId)) {
    throw new Error(`Level "${level.id}" spawn references unknown island "${level.spawn.islandId}"`)
  }
  for (const shrine of level.shrines) {
    if (!ids.has(shrine.islandId)) {
      throw new Error(`Level "${level.id}" shrine references unknown island "${shrine.islandId}"`)
    }
  }

  const lowest = Math.min(...level.islands.map((i) => i.position.y - i.height * 2))
  if (level.worldFloorY >= lowest) {
    throw new Error(
      `Level "${level.id}" worldFloorY (${level.worldFloorY}) must sit below ` +
      `the lowest island (${lowest})`,
    )
  }
}

/**
 * Islands close enough to intersect visually. Reported rather than thrown,
 * because it is a design smell rather than a broken level.
 */
export function findOverlappingIslands(level: Level): [string, string][] {
  const clashes: [string, string][] = []
  for (let i = 0; i < level.islands.length; i++) {
    for (let j = i + 1; j < level.islands.length; j++) {
      const a = level.islands[i]!
      const b = level.islands[j]!
      const horizontal = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)
      const verticalGap = Math.abs(a.position.y - b.position.y)
      if (horizontal < a.radius + b.radius && verticalGap < (a.height + b.height) * 2) {
        clashes.push([a.id, b.id])
      }
    }
  }
  return clashes
}
```

- [ ] **Step 4: Write `src/world/levels/archipelago.ts`**

```typescript
import { Vector3 } from 'three'
import type { Level } from '../level'
import type { Biome } from '../island'

const island = (
  id: string, x: number, y: number, z: number, radius: number, height: number,
  biome: Biome, noiseSeed: number,
) => ({ id, position: new Vector3(x, y, z), radius, height, biome, noiseSeed })

/**
 * Eight islands sequenced to teach the flight model:
 *  - home:    large and flat. Learn walking, jumping, deploying the kite.
 *  - ring-*:  below and outward. Reachable by gliding alone, which teaches that
 *             altitude converts to distance.
 *  - climb-*: above home. Need sustained thrust, which introduces breath as a cost.
 *  - rest:    a mid-height waypoint for recovering breath on a long crossing.
 *  - spire:   highest. Needs a dive, a zoom climb, and thrust together.
 */
export const ARCHIPELAGO: Level = {
  id: 'archipelago',
  spawn: { islandId: 'home', offset: new Vector3(0, 6, 0) },
  worldFloorY: -600,
  islands: [
    island('home', 0, 0, 0, 70, 34, 'grass', 1001),
    island('ring-east', 320, -70, 40, 46, 24, 'grass', 1002),
    island('ring-south', -60, -110, 340, 42, 22, 'grass', 1003),
    island('ring-west', -350, -60, -80, 50, 26, 'rock', 1004),
    island('climb-north', 40, 120, -330, 38, 20, 'rock', 1005),
    island('climb-far', 380, 190, -300, 34, 18, 'rock', 1006),
    island('rest', -300, 40, 320, 30, 16, 'grass', 1007),
    island('spire', 60, 420, 60, 26, 44, 'temple', 1008),
  ],
  shrines: [
    { islandId: 'home', offset: new Vector3(20, 0, -14) },
    { islandId: 'ring-east', offset: new Vector3(0, 0, 0) },
    { islandId: 'ring-south', offset: new Vector3(-8, 0, 6) },
    { islandId: 'ring-west', offset: new Vector3(10, 0, 10) },
    { islandId: 'climb-north', offset: new Vector3(0, 0, 0) },
    { islandId: 'climb-far', offset: new Vector3(0, 0, 0) },
    { islandId: 'rest', offset: new Vector3(0, 0, 0) },
    { islandId: 'spire', offset: new Vector3(0, 0, 0) },
  ],
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm test -- src/world/level.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 6: Commit**

```bash
git add src/world/level.ts src/world/levels/archipelago.ts src/world/level.test.ts
git commit -m "Add level validation and the eight-island archipelago"
```

---

### Task 11: Ground movement

Camera-relative walking, running, jumping, and ground snapping. Depends only on `TerrainQuery`, so it is tested against a synthetic flat world rather than real island geometry.

**Files:**
- Create: `src/player/ground-move.ts`
- Modify: `src/core/types.ts` (add `GroundConfig`), `src/core/config.ts` (add `DEFAULT_GROUND_CONFIG`)
- Test: `src/player/ground-move.test.ts`

**Interfaces:**
- Consumes: `InputState`, `PlayerState`, `TerrainQuery` from `src/core/types.ts`.
- Produces:
  - `interface GroundConfig { walkSpeed: number; runSpeed: number; jumpSpeed: number; gravity: number; snapDistance: number; eyeProbeHeight: number }` — added to `src/core/types.ts`.
  - `DEFAULT_GROUND_CONFIG: GroundConfig` — added to `src/core/config.ts`.
  - `horizontalForward(lookDirection: Vector3): Vector3`
  - `desiredVelocity(input: InputState, c: GroundConfig): Vector3`
  - `groundStep(state: PlayerState, input: InputState, dt: number, terrain: TerrainQuery, c: GroundConfig): PlayerState`

- [ ] **Step 1: Add the config**

Append to `src/core/types.ts`:

```typescript
export interface GroundConfig {
  walkSpeed: number
  runSpeed: number
  jumpSpeed: number
  gravity: number
  /** How far below the feet the ground still counts as underfoot. */
  snapDistance: number
  /** How far above the feet the ground probe starts. */
  eyeProbeHeight: number
}
```

Append to `src/core/config.ts`:

```typescript
import type { GroundConfig } from './types'

export const DEFAULT_GROUND_CONFIG: GroundConfig = {
  walkSpeed: 7,
  runSpeed: 13,
  jumpSpeed: 9,
  gravity: 20,
  snapDistance: 1.2,
  eyeProbeHeight: 2,
}
```

- [ ] **Step 2: Write the failing tests**

`src/player/ground-move.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { groundStep, desiredVelocity, horizontalForward } from './ground-move'
import { DEFAULT_GROUND_CONFIG as G } from '../core/config'
import type { InputState, PlayerState, TerrainQuery } from '../core/types'

/** Flat ground at y=0 everywhere, so movement can be reasoned about exactly. */
const flatGround: TerrainQuery = {
  groundHeightAt: () => 0,
  raycastDown: (from, maxDistance) =>
    from.y >= 0 && from.y - maxDistance <= 0
      ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
      : null,
}
const voidWorld: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, actionPressed: false, ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', ...over,
})

describe('horizontalForward', () => {
  it('strips the vertical component', () => {
    expect(horizontalForward(new Vector3(0, 0.9, -1)).y).toBe(0)
  })

  it('stays normalised', () => {
    expect(horizontalForward(new Vector3(0, 0.9, -1)).length()).toBeCloseTo(1, 6)
  })

  it('falls back to negative Z when looking straight down', () => {
    expect(horizontalForward(new Vector3(0, -1, 0)).toArray()).toEqual([0, 0, -1])
  })
})

describe('desiredVelocity', () => {
  it('is zero with no input', () => {
    expect(desiredVelocity(input(), G).length()).toBe(0)
  })

  it('moves along the look direction on W', () => {
    expect(desiredVelocity(input({ forward: 1 }), G).z).toBeCloseTo(-G.walkSpeed, 5)
  })

  it('moves right on D', () => {
    expect(desiredVelocity(input({ strafe: 1 }), G).x).toBeCloseTo(G.walkSpeed, 5)
  })

  it('is camera-relative, so yawing changes the world direction', () => {
    const v = desiredVelocity(input({ forward: 1, lookDirection: new Vector3(-1, 0, 0) }), G)
    expect(v.x).toBeCloseTo(-G.walkSpeed, 5)
  })

  it('sprinting is faster than walking', () => {
    expect(desiredVelocity(input({ forward: 1, sprint: true }), G).length())
      .toBeGreaterThan(desiredVelocity(input({ forward: 1 }), G).length())
  })

  it('diagonal movement is not faster than straight', () => {
    expect(desiredVelocity(input({ forward: 1, strafe: 1 }), G).length())
      .toBeCloseTo(G.walkSpeed, 5)
  })
})

describe('groundStep', () => {
  it('stays grounded standing still on flat ground', () => {
    const s = groundStep(player(), input(), 1 / 60, flatGround, G)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 6)
  })

  it('jumps when the action is pressed while grounded', () => {
    expect(groundStep(player(), input({ actionPressed: true }), 1 / 60, flatGround, G).velocity.y)
      .toBeGreaterThan(0)
  })

  it('cannot jump while airborne', () => {
    const airborne = player({ position: new Vector3(0, 50, 0), grounded: false })
    expect(groundStep(airborne, input({ actionPressed: true }), 1 / 60, voidWorld, G).velocity.y)
      .toBeLessThan(0)
  })

  it('falls when there is no ground below', () => {
    const s = groundStep(player({ grounded: false }), input(), 1 / 60, voidWorld, G)
    expect(s.grounded).toBe(false)
    expect(s.position.y).toBeLessThan(0)
  })

  it('records which island it is standing on', () => {
    expect(groundStep(player(), input(), 1 / 60, flatGround, G).lastGroundIslandId).toBe('flat')
  })

  it('does not mutate the state it is given', () => {
    const s = player()
    groundStep(s, input({ forward: 1 }), 1 / 60, flatGround, G)
    expect(s.position.toArray()).toEqual([0, 0, 0])
  })

  it('walking off an edge begins a fall', () => {
    const s = groundStep(player(), input({ forward: 1 }), 1 / 60, voidWorld, G)
    expect(s.grounded).toBe(false)
  })

  it('a jump rises then returns to the ground', () => {
    let s = groundStep(player(), input({ actionPressed: true }), 1 / 60, flatGround, G)
    expect(s.velocity.y).toBeGreaterThan(0)
    let peak = s.position.y
    for (let i = 0; i < 200; i++) {
      s = groundStep(s, input(), 1 / 60, flatGround, G)
      peak = Math.max(peak, s.position.y)
    }
    expect(peak).toBeGreaterThan(1)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 4)
  })
})
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `npm test -- src/player/ground-move.test.ts`
Expected: FAIL — cannot resolve module `./ground-move`.

- [ ] **Step 4: Write `src/player/ground-move.ts`**

```typescript
import { Vector3 } from 'three'
import type { GroundConfig, InputState, PlayerState, TerrainQuery } from '../core/types'

const WORLD_UP = new Vector3(0, 1, 0)

/** Flatten a look direction onto the horizontal plane. */
export function horizontalForward(lookDirection: Vector3): Vector3 {
  const flat = new Vector3(lookDirection.x, 0, lookDirection.z)
  if (flat.lengthSq() < 1e-8) return new Vector3(0, 0, -1)
  return flat.normalize()
}

/** Camera-relative desired horizontal velocity. Normalised so diagonals are not faster. */
export function desiredVelocity(input: InputState, c: GroundConfig): Vector3 {
  const forward = horizontalForward(input.lookDirection)
  const right = new Vector3().crossVectors(forward, WORLD_UP).normalize()
  const move = forward.multiplyScalar(input.forward).addScaledVector(right, input.strafe)
  if (move.lengthSq() < 1e-8) return new Vector3()
  return move.normalize().multiplyScalar(input.sprint ? c.runSpeed : c.walkSpeed)
}

export function groundStep(
  state: PlayerState,
  input: InputState,
  dt: number,
  terrain: TerrainQuery,
  c: GroundConfig,
): PlayerState {
  const horizontal = desiredVelocity(input, c)
  let velocityY = state.velocity.y

  if (state.grounded && input.actionPressed) velocityY = c.jumpSpeed
  else velocityY -= c.gravity * dt

  const velocity = new Vector3(horizontal.x, velocityY, horizontal.z)
  const position = state.position.clone().addScaledVector(velocity, dt)

  // Snap only while descending, otherwise a jump is cancelled on its first frame.
  let grounded = false
  let lastGroundIslandId = state.lastGroundIslandId
  if (velocity.y <= 0) {
    const probe = position.clone().setY(position.y + c.eyeProbeHeight)
    const hit = terrain.raycastDown(probe, c.eyeProbeHeight + c.snapDistance)
    if (hit) {
      position.y = hit.point.y
      velocity.y = 0
      grounded = true
      lastGroundIslandId = hit.islandId
    }
  }

  return {
    ...state, position, velocity,
    forward: state.forward.clone(), grounded, lastGroundIslandId,
  }
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm test -- src/player/ground-move.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 6: Commit**

```bash
git add src/player/ground-move.ts src/player/ground-move.test.ts src/core/types.ts src/core/config.ts
git commit -m "Add camera-relative ground movement"
```

---

### Task 12: Player controller

Owns the ground-to-kite transitions and every safety net. This is the only module that knows both movement modes exist.

**Files:**
- Create: `src/player/controller.ts`
- Test: `src/player/controller.test.ts`

**Interfaces:**
- Consumes: `flightStep` (Task 4), `steerToward` (Task 5), `stepBreath` and `canThrust` (Task 6), `groundStep` (Task 11), and the config types.
- Produces:
  - `interface ControllerDeps { terrain: TerrainQuery; flight: FlightConfig; ground: GroundConfig; worldFloorY: number; spawnPointFor(islandId: string | null): Vector3 }`
  - `respawn(state: PlayerState, deps: ControllerDeps): PlayerState`
  - `controllerStep(state: PlayerState, input: InputState, dt: number, deps: ControllerDeps): PlayerState`

**Behaviour rules this task locks in:**

| Situation | Result |
| --- | --- |
| `Space` while grounded | Jump. The kite does not deploy. |
| `Space` while falling in ground mode | Deploy the kite, pointing where the player looks. |
| `Space` while flying | Stow the kite and fall. |
| Touchdown at or below `landingSpeed` | Land cleanly, velocity zeroed. |
| Touchdown above `landingSpeed` | Land with 30% horizontal momentum kept as a stagger. |
| Position below `worldFloorY` | Respawn at the last island stood on. |
| Any non-finite value in state | Respawn rather than propagate the corruption. |

- [ ] **Step 1: Write the failing tests**

`src/player/controller.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { controllerStep, respawn, type ControllerDeps } from './controller'
import { DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG } from '../core/config'
import type { InputState, PlayerState, TerrainQuery } from '../core/types'

const flatGround: TerrainQuery = {
  groundHeightAt: () => 0,
  raycastDown: (from, maxDistance) =>
    from.y >= 0 && from.y - maxDistance <= 0
      ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
      : null,
}
const voidWorld: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }

const deps = (
  terrain: TerrainQuery,
  spawnPointFor?: (id: string | null) => Vector3,
): ControllerDeps => ({
  terrain,
  flight: DEFAULT_FLIGHT_CONFIG,
  ground: DEFAULT_GROUND_CONFIG,
  worldFloorY: -600,
  spawnPointFor:
    spawnPointFor ?? ((id) => (id === 'flat' ? new Vector3(0, 0, 0) : new Vector3(1, 1, 1))),
})

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, actionPressed: false, ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', ...over,
})

describe('mode switching', () => {
  it('pressing action while grounded jumps rather than deploying', () => {
    const s = controllerStep(player(), input({ actionPressed: true }), 1 / 60, deps(flatGround))
    expect(s.mode).toBe('ground')
    expect(s.velocity.y).toBeGreaterThan(0)
  })

  it('pressing action mid-fall deploys the kite', () => {
    const falling = player({
      position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3(0, -12, 0),
    })
    expect(controllerStep(falling, input({ actionPressed: true }), 1 / 60, deps(voidWorld)).mode)
      .toBe('kite')
  })

  it('deploying points the kite where the player is looking', () => {
    const falling = player({ position: new Vector3(0, 200, 0), grounded: false })
    const s = controllerStep(
      falling, input({ actionPressed: true, lookDirection: new Vector3(1, 0, 0) }),
      1 / 60, deps(voidWorld),
    )
    expect(s.forward.x).toBeCloseTo(1, 5)
  })

  it('pressing action in the air while flying stows the kite', () => {
    const flying = player({
      mode: 'kite', position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, 0, -20),
    })
    expect(controllerStep(flying, input({ actionPressed: true }), 1 / 60, deps(voidWorld)).mode)
      .toBe('ground')
  })
})

describe('flying', () => {
  const flying = (over: Partial<PlayerState> = {}) => player({
    mode: 'kite', position: new Vector3(0, 300, 0), grounded: false,
    velocity: new Vector3(0, 0, -24), ...over,
  })

  it('gliding costs no breath', () => {
    expect(controllerStep(flying(), input(), 1 / 60, deps(voidWorld)).breath).toBe(100)
  })

  it('thrusting spends breath', () => {
    expect(controllerStep(flying(), input({ forward: 1 }), 1 / 60, deps(voidWorld)).breath)
      .toBeLessThan(100)
  })

  it('cannot thrust with an empty meter', () => {
    const empty = flying({ breath: 0 })
    const thrust = controllerStep(empty, input({ forward: 1 }), 1 / 60, deps(voidWorld))
    const glide = controllerStep(empty, input(), 1 / 60, deps(voidWorld))
    expect(thrust.velocity.length()).toBeCloseTo(glide.velocity.length(), 5)
  })

  it('steers the kite toward the look direction over time', () => {
    let s = flying()
    const look = new Vector3(1, 0, 0)
    for (let i = 0; i < 120; i++) {
      s = controllerStep(s, input({ lookDirection: look }), 1 / 60, deps(voidWorld))
    }
    expect(s.forward.angleTo(look)).toBeLessThan(flying().forward.angleTo(look))
  })

  it('does not mutate the state it is given', () => {
    const s = flying()
    controllerStep(s, input({ forward: 1 }), 1 / 60, deps(voidWorld))
    expect(s.position.toArray()).toEqual([0, 300, 0])
    expect(s.breath).toBe(100)
  })
})

describe('landing', () => {
  it('a slow touchdown lands cleanly and stops', () => {
    const slow = player({
      mode: 'kite', position: new Vector3(0, 1, 0), grounded: false,
      velocity: new Vector3(0, -2, -4),
    })
    const s = controllerStep(slow, input(), 1 / 60, deps(flatGround))
    expect(s.mode).toBe('ground')
    expect(s.grounded).toBe(true)
    expect(s.velocity.length()).toBe(0)
  })

  it('a fast touchdown keeps some momentum as a stagger', () => {
    const fast = player({
      mode: 'kite', position: new Vector3(0, 1, 0), grounded: false,
      velocity: new Vector3(0, -5, -50),
    })
    const s = controllerStep(fast, input(), 1 / 60, deps(flatGround))
    expect(s.mode).toBe('ground')
    expect(s.velocity.length()).toBeGreaterThan(0)
  })

  it('records the island landed on', () => {
    const slow = player({
      mode: 'kite', position: new Vector3(0, 1, 0), grounded: false,
      velocity: new Vector3(0, -2, 0), lastGroundIslandId: null,
    })
    expect(controllerStep(slow, input(), 1 / 60, deps(flatGround)).lastGroundIslandId).toBe('flat')
  })
})

describe('safety nets', () => {
  it('respawns after falling past the world floor', () => {
    const lost = player({ mode: 'kite', position: new Vector3(0, -900, 0), grounded: false })
    const s = controllerStep(lost, input(), 1 / 60, deps(voidWorld))
    expect(s.mode).toBe('ground')
    expect(s.position.toArray()).toEqual([0, 0, 0])
  })

  it('respawns at the last island stood on', () => {
    const lost = player({ position: new Vector3(0, -900, 0), lastGroundIslandId: 'elsewhere' })
    expect(controllerStep(lost, input(), 1 / 60, deps(voidWorld)).position.toArray())
      .toEqual([1, 1, 1])
  })

  it('respawns rather than propagating non-finite state', () => {
    const broken = player({ position: new Vector3(NaN, 10, 0) })
    expect(Number.isFinite(controllerStep(broken, input(), 1 / 60, deps(voidWorld)).position.x))
      .toBe(true)
  })

  it('restores breath on respawn', () => {
    expect(respawn(player({ breath: 3 }), deps(voidWorld)).breath).toBe(100)
  })

  it('regenerates breath while standing on the ground', () => {
    expect(controllerStep(player({ breath: 50 }), input(), 1 / 60, deps(flatGround)).breath)
      .toBeGreaterThan(50)
  })

  it('a NaN maxBreath on the incoming state produces a finite result', () => {
    const broken = player({ maxBreath: NaN })
    const s = controllerStep(broken, input(), 1 / 60, deps(voidWorld))
    expect(Number.isFinite(s.breath)).toBe(true)
    expect(Number.isFinite(s.maxBreath)).toBe(true)
    expect(s.maxBreath).toBeGreaterThan(0)
    expect(s.breath).toBeGreaterThan(0)
  })

  it('a spawnPointFor that returns a non-finite position still yields a finite result', () => {
    const brokenSpawn = deps(voidWorld, () => new Vector3(NaN, NaN, NaN))
    const lost = player({ position: new Vector3(0, -900, 0) })
    const s = controllerStep(lost, input(), 1 / 60, brokenSpawn)
    expect(Number.isFinite(s.position.x)).toBe(true)
    expect(Number.isFinite(s.position.y)).toBe(true)
    expect(Number.isFinite(s.position.z)).toBe(true)
    expect(Number.isFinite(s.velocity.length())).toBe(true)
    expect(Number.isFinite(s.breath)).toBe(true)
    expect(Number.isFinite(s.maxBreath)).toBe(true)
  })

  it('a broken spawnPointFor never lets non-finite state escape across repeated frames', () => {
    const brokenSpawn = deps(voidWorld, () => new Vector3(NaN, NaN, NaN))
    let s = player({ position: new Vector3(0, -900, 0) })
    for (let i = 0; i < 10; i++) {
      s = controllerStep(s, input(), 1 / 60, brokenSpawn)
      expect(Number.isFinite(s.position.x)).toBe(true)
      expect(Number.isFinite(s.position.y)).toBe(true)
      expect(Number.isFinite(s.position.z)).toBe(true)
      expect(Number.isFinite(s.velocity.x)).toBe(true)
      expect(Number.isFinite(s.breath)).toBe(true)
      expect(Number.isFinite(s.maxBreath)).toBe(true)
    }
  })

  it('respawn sanitises a NaN maxBreath', () => {
    const s = respawn(player({ maxBreath: NaN }), deps(voidWorld))
    expect(Number.isFinite(s.breath)).toBe(true)
    expect(Number.isFinite(s.maxBreath)).toBe(true)
    expect(s.maxBreath).toBe(DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
    expect(s.breath).toBe(DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
  })

  it('respawn falls back to baseMaxBreath for a non-positive maxBreath', () => {
    const zero = respawn(player({ maxBreath: 0 }), deps(voidWorld))
    const negative = respawn(player({ maxBreath: -5 }), deps(voidWorld))
    expect(zero.maxBreath).toBe(DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
    expect(negative.maxBreath).toBe(DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/player/controller.test.ts`
Expected: FAIL — cannot resolve module `./controller`.

- [ ] **Step 3: Write `src/player/controller.ts`**

```typescript
import { Vector3 } from 'three'
import type {
  FlightConfig, GroundConfig, InputState, PlayerState, TerrainQuery,
} from '../core/types'
import { flightStep } from './flight'
import { steerToward } from './steering'
import { stepBreath, canThrust } from './breath'
import { groundStep } from './ground-move'

export interface ControllerDeps {
  terrain: TerrainQuery
  flight: FlightConfig
  ground: GroundConfig
  worldFloorY: number
  /** Where to respawn for the given island, or the level spawn when null. */
  spawnPointFor(islandId: string | null): Vector3
}

/** Distance below the kite at which touching down counts as landing. */
const LANDING_PROBE = 2.5
/** Fraction of horizontal speed kept after a too-fast landing. */
const STAGGER_RETENTION = 0.3

function isFinitePlayer(s: PlayerState): boolean {
  const nums = [
    ...s.position.toArray(), ...s.velocity.toArray(), ...s.forward.toArray(),
    s.breath, s.maxBreath,
  ]
  return nums.every(Number.isFinite)
}

export function respawn(state: PlayerState, deps: ControllerDeps): PlayerState {
  // A corrupt maxBreath would otherwise be laundered into breath and escape the guard.
  const maxBreath =
    Number.isFinite(state.maxBreath) && state.maxBreath > 0
      ? state.maxBreath
      : deps.flight.baseMaxBreath
  return {
    ...state,
    mode: 'ground',
    position: deps.spawnPointFor(state.lastGroundIslandId),
    velocity: new Vector3(),
    forward: new Vector3(0, 0, -1),
    grounded: true,
    breath: maxBreath,
    maxBreath,
  }
}

/**
 * Respawn, then verify the result. spawnPointFor is injected, so a caller bug
 * could hand us a non-finite position; without this check the corrupted state
 * would be returned and re-corrupted every frame thereafter.
 */
function safeRespawn(state: PlayerState, deps: ControllerDeps): PlayerState {
  const respawned = respawn(state, deps)
  if (isFinitePlayer(respawned)) return respawned
  console.warn('spawnPointFor returned a non-finite position; falling back to the origin.')
  return {
    mode: 'ground',
    position: new Vector3(),
    velocity: new Vector3(),
    forward: new Vector3(0, 0, -1),
    breath: deps.flight.baseMaxBreath,
    maxBreath: deps.flight.baseMaxBreath,
    grounded: false,
    lastGroundIslandId: null,
  }
}

export function controllerStep(
  state: PlayerState,
  input: InputState,
  dt: number,
  deps: ControllerDeps,
): PlayerState {
  if (!isFinitePlayer(state)) return safeRespawn(state, deps)
  if (state.position.y < deps.worldFloorY) return safeRespawn(state, deps)

  let next: PlayerState

  if (state.mode === 'ground') {
    if (input.actionPressed && !state.grounded) {
      // Deploy the kite mid-fall. Grounded presses are jumps, handled by groundStep.
      next = {
        ...state,
        mode: 'kite',
        forward: input.lookDirection.clone().normalize(),
        position: state.position.clone(),
        velocity: state.velocity.clone(),
        grounded: false,
      }
    } else {
      next = groundStep(state, input, dt, deps.terrain, deps.ground)
    }
  } else if (input.actionPressed) {
    next = {
      ...state, mode: 'ground', grounded: false,
      position: state.position.clone(),
      velocity: state.velocity.clone(),
      forward: state.forward.clone(),
    }
  } else {
    const speed = state.velocity.length()
    const thrusting = input.forward > 0 && canThrust(state)
    const forward = steerToward(
      state.forward, input.lookDirection, speed, input.strafe, dt, deps.flight,
    )
    const moved = flightStep(state.position, state.velocity, {
      forward,
      thrust: thrusting,
      flare: input.forward < 0,
      bank: input.strafe * 0.6,
    }, dt, deps.flight)
    const breath = stepBreath(state, thrusting, false, dt, deps.flight)

    next = {
      ...state, forward,
      position: moved.position, velocity: moved.velocity,
      breath: breath.breath, grounded: false,
    }

    const hit = deps.terrain.raycastDown(next.position, LANDING_PROBE)
    if (hit) {
      const landingSpeed = next.velocity.length()
      next = {
        ...next, mode: 'ground', grounded: true,
        position: hit.point.clone(),
        velocity: landingSpeed <= deps.flight.landingSpeed
          ? new Vector3()
          : new Vector3(
              next.velocity.x * STAGGER_RETENTION, 0, next.velocity.z * STAGGER_RETENTION,
            ),
        lastGroundIslandId: hit.islandId,
      }
    }
  }

  // Breath recovers on foot. Flight handles its own drain above.
  if (state.mode === 'ground' && next.mode === 'ground') {
    next = { ...next, breath: stepBreath(next, false, next.grounded, dt, deps.flight).breath }
  }

  return isFinitePlayer(next) ? next : safeRespawn(state, deps)
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/player/controller.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. The suite should now be around 148 tests.

- [ ] **Step 6: Commit**

```bash
git add src/player/controller.ts src/player/controller.test.ts
git commit -m "Add player controller with mode switching and safety nets"
```

---

### Task 13: Fixed-step loop

Simulation must advance in fixed increments so the flight model behaves identically on a 60 Hz and a 144 Hz display, and so a browser tab stall does not teleport the player.

**Files:**
- Create: `src/core/loop.ts`
- Test: `src/core/loop.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FIXED_DT: number` (1/60), `MAX_STEPS_PER_FRAME: number` (5)
  - `interface LoopCallbacks { update(dt: number): void; render(): void }`
  - `createStepper(callbacks: LoopCallbacks, fixedDt?: number): { advance(elapsed: number): number; pendingTime(): number }` — `advance` takes real elapsed seconds and returns how many simulation steps ran.

- [ ] **Step 1: Write the failing tests**

`src/core/loop.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createStepper, FIXED_DT, MAX_STEPS_PER_FRAME } from './loop'

function spy() {
  const dts: number[] = []
  let renders = 0
  return {
    dts,
    renders: () => renders,
    cb: { update: (dt: number) => dts.push(dt), render: () => { renders++ } },
  }
}

describe('createStepper', () => {
  it('runs one step for exactly one frame of time', () => {
    const s = spy()
    expect(createStepper(s.cb).advance(FIXED_DT)).toBe(1)
    expect(s.dts).toEqual([FIXED_DT])
  })

  it('always steps by the fixed delta, never the real one', () => {
    const s = spy()
    createStepper(s.cb).advance(FIXED_DT * 2.5)
    expect(new Set(s.dts)).toEqual(new Set([FIXED_DT]))
  })

  it('runs no step when too little time has passed', () => {
    expect(createStepper(spy().cb).advance(FIXED_DT / 3)).toBe(0)
  })

  it('accumulates leftover time across frames', () => {
    const stepper = createStepper(spy().cb)
    stepper.advance(FIXED_DT * 0.6)
    expect(stepper.advance(FIXED_DT * 0.6)).toBe(1)
  })

  it('renders once per frame even with no simulation step', () => {
    const s = spy()
    createStepper(s.cb).advance(FIXED_DT / 4)
    expect(s.renders()).toBe(1)
  })

  it('renders once per frame when several steps run', () => {
    const s = spy()
    createStepper(s.cb).advance(FIXED_DT * 3)
    expect(s.renders()).toBe(1)
  })

  it('clamps a long stall instead of simulating minutes at once', () => {
    expect(createStepper(spy().cb).advance(30)).toBe(MAX_STEPS_PER_FRAME)
  })

  it('does not build up debt after a stall', () => {
    const stepper = createStepper(spy().cb)
    stepper.advance(30)
    expect(stepper.pendingTime()).toBeLessThan(FIXED_DT)
  })

  it('ignores a non-finite or negative delta but still renders', () => {
    const s = spy()
    const stepper = createStepper(s.cb)
    expect(stepper.advance(NaN)).toBe(0)
    expect(stepper.advance(-1)).toBe(0)
    expect(s.renders()).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/core/loop.test.ts`
Expected: FAIL — cannot resolve module `./loop`.

- [ ] **Step 3: Write `src/core/loop.ts`**

```typescript
export const FIXED_DT = 1 / 60
/** Never simulate more than this in one frame, or a stall cascades into a freeze. */
export const MAX_STEPS_PER_FRAME = 5

export interface LoopCallbacks {
  update(dt: number): void
  render(): void
}

/**
 * Fixed-step accumulator. Simulation always advances in FIXED_DT increments so
 * the flight model behaves identically regardless of display refresh rate.
 */
export function createStepper(callbacks: LoopCallbacks, fixedDt = FIXED_DT) {
  let accumulator = 0
  return {
    /** Feed real elapsed seconds. Returns how many simulation steps ran. */
    advance(elapsed: number): number {
      if (!Number.isFinite(elapsed) || elapsed <= 0) {
        callbacks.render()
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
      callbacks.render()
      return steps
    },
    pendingTime: () => accumulator,
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/core/loop.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/loop.ts src/core/loop.test.ts
git commit -m "Add fixed-step simulation loop"
```

---

### Task 14: Renderer and first pixels

The first task with something visible. Builds the renderer, scene, lighting, and sky, generates the archipelago's meshes, and puts them on screen. No player yet — this proves the world renders before anything moves through it.

**Files:**
- Create: `src/core/renderer.ts`
- Create: `src/world/world.ts`
- Modify: `src/main.ts`
- Test: `src/core/renderer.test.ts`, `src/world/world.test.ts`

**Interfaces:**
- Consumes: `createIslandGeometry` (Task 8), `createTerrainQuery` and `IslandMesh` (Task 9), `Level` and `validateLevel` (Task 10).
- Produces:
  - `hasWebGL(): boolean` and `WEBGL_MESSAGE: string`
  - `showFallback(message: string): void` — reveals the `#fallback` div and hides the canvas.
  - `createRenderer(canvas: HTMLCanvasElement): { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; resize(): void }`
  - `interface World { islands: IslandMesh[]; terrain: TerrainQuery; group: Group }`
  - `buildWorld(level: Level): World` — validates the level, generates meshes, returns them grouped.

**On level validation in production:** the spec requires validation to throw in development but skip the offending island in production. `buildWorld` throws; `main.ts` catches, logs, and calls `showFallback` with the validation message. This keeps `buildWorld` simple and testable while still never showing a blank screen.

- [ ] **Step 1: Write the failing tests for `buildWorld`**

`src/world/world.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { buildWorld } from './world'
import { ARCHIPELAGO } from './levels/archipelago'
import type { Level } from './level'

describe('buildWorld', () => {
  it('creates one mesh per island', () => {
    expect(buildWorld(ARCHIPELAGO).islands).toHaveLength(ARCHIPELAGO.islands.length)
  })

  it('positions each mesh where the level says', () => {
    const world = buildWorld(ARCHIPELAGO)
    const home = ARCHIPELAGO.islands.find((i) => i.id === 'home')!
    const mesh = world.islands.find((i) => i.id === 'home')!.mesh
    expect(mesh.position.toArray()).toEqual(home.position.toArray())
  })

  it('adds every mesh to the returned group', () => {
    const world = buildWorld(ARCHIPELAGO)
    expect(world.group.children).toHaveLength(ARCHIPELAGO.islands.length)
  })

  it('exposes a terrain query that finds the home island', () => {
    const world = buildWorld(ARCHIPELAGO)
    const home = ARCHIPELAGO.islands.find((i) => i.id === 'home')!
    expect(world.terrain.groundHeightAt(home.position.x, home.position.z)).not.toBeNull()
  })

  it('rejects an invalid level rather than building a broken world', () => {
    const broken: Level = { ...ARCHIPELAGO, spawn: { islandId: 'nope', offset: new Vector3() } }
    expect(() => buildWorld(broken)).toThrow(/unknown island "nope"/)
  })

  it('is deterministic, so the same level always builds the same geometry', () => {
    const a = buildWorld(ARCHIPELAGO).islands[0]!.mesh.geometry.attributes.position!.array
    const b = buildWorld(ARCHIPELAGO).islands[0]!.mesh.geometry.attributes.position!.array
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test -- src/world/world.test.ts`
Expected: FAIL — cannot resolve module `./world`.

- [ ] **Step 3: Write `src/world/world.ts`**

```typescript
import { Group, Mesh, MeshLambertMaterial, Color, type BufferGeometry } from 'three'
import type { TerrainQuery } from '../core/types'
import { createIslandGeometry, type Biome } from './island'
import { createTerrainQuery, type IslandMesh } from './terrain-query'
import { validateLevel, type Level } from './level'

const BIOME_COLOURS: Record<Biome, number> = {
  grass: 0x7fa85c,
  rock: 0x8a8579,
  temple: 0xb9a67f,
}

export interface World {
  islands: IslandMesh[]
  terrain: TerrainQuery
  group: Group
}

/** Validate, generate geometry, and assemble the scene graph for a level. */
export function buildWorld(level: Level): World {
  validateLevel(level)

  const group = new Group()
  const islands: IslandMesh[] = []

  for (const def of level.islands) {
    const geometry: BufferGeometry = createIslandGeometry(def)
    const material = new MeshLambertMaterial({ color: new Color(BIOME_COLOURS[def.biome]) })
    const mesh = new Mesh(geometry, material)
    mesh.position.copy(def.position)
    mesh.updateMatrixWorld(true)
    group.add(mesh)
    islands.push({ id: def.id, mesh })
  }

  return { islands, terrain: createTerrainQuery(islands), group }
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test -- src/world/world.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing test for the WebGL fallback**

`src/core/renderer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { WEBGL_MESSAGE } from './renderer'

describe('WEBGL_MESSAGE', () => {
  it('explains the problem in plain language', () => {
    expect(WEBGL_MESSAGE.toLowerCase()).toContain('webgl')
  })

  it('tells the player what to do about it', () => {
    expect(WEBGL_MESSAGE.length).toBeGreaterThan(40)
  })
})
```

- [ ] **Step 6: Run and verify it fails**

Run: `npm test -- src/core/renderer.test.ts`
Expected: FAIL — cannot resolve module `./renderer`.

- [ ] **Step 7: Write `src/core/renderer.ts`**

```typescript
import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog,
  HemisphereLight, DirectionalLight,
} from 'three'
import { BASE_FOV } from '../fx/mapping'

export const WEBGL_MESSAGE =
  'This game needs WebGL, which your browser has disabled or does not support. ' +
  'Try a recent version of Chrome, Firefox, Safari, or Edge with hardware acceleration enabled.'

const SKY_COLOUR = 0x9dc4e8
const FOG_NEAR = 400
const FOG_FAR = 2200

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** Reveal the fallback message and hide the canvas. Never leaves a blank screen. */
export function showFallback(message: string): void {
  const fallback = document.getElementById('fallback')
  const canvas = document.getElementById('game')
  if (canvas) canvas.style.display = 'none'
  if (fallback) {
    fallback.style.display = 'block'
    fallback.textContent = message
  }
}

export function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new Scene()
  scene.background = new Color(SKY_COLOUR)
  // Fog hides the empty void between islands and sells the sense of altitude.
  scene.fog = new Fog(SKY_COLOUR, FOG_NEAR, FOG_FAR)

  scene.add(new HemisphereLight(SKY_COLOUR, 0x4a5a3a, 1.5))
  const sun = new DirectionalLight(0xfff2d8, 1.8)
  sun.position.set(200, 400, 150)
  scene.add(sun)

  const camera = new PerspectiveCamera(BASE_FOV, 1, 0.5, FOG_FAR)

  function resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  return { renderer, scene, camera, resize }
}
```

- [ ] **Step 8: Run and verify it passes**

Run: `npm test -- src/core/renderer.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 9: Wire `src/main.ts` to render the archipelago**

```typescript
import { createRenderer, hasWebGL, showFallback, WEBGL_MESSAGE } from './core/renderer'
import { createStepper } from './core/loop'
import { buildWorld } from './world/world'
import { ARCHIPELAGO } from './world/levels/archipelago'
import { Vector3 } from 'three'

function start(): void {
  if (!hasWebGL()) {
    showFallback(WEBGL_MESSAGE)
    return
  }

  const canvas = document.getElementById('game')
  if (!(canvas instanceof HTMLCanvasElement)) {
    showFallback('Could not find the game canvas.')
    return
  }

  let world
  try {
    world = buildWorld(ARCHIPELAGO)
  } catch (error) {
    showFallback(`The level failed to load: ${(error as Error).message}`)
    return
  }

  const { renderer, scene, camera } = createRenderer(canvas)
  scene.add(world.group)

  // Temporary fixed vantage point. Task 15 replaces this with the follow camera.
  camera.position.set(160, 90, 200)
  camera.lookAt(new Vector3(0, 0, 0))

  const stepper = createStepper({
    update: () => {},
    render: () => renderer.render(scene, camera),
  })

  let last = performance.now()
  function frame(now: number): void {
    stepper.advance((now - last) / 1000)
    last = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

start()
```

- [ ] **Step 10: Verify visually in the browser**

```bash
npm run dev
```

Open the served URL. Expected: a blue sky with islands visible as green and grey shapes, each with
a flat top and a spike below, fading into fog with distance. Check the browser console is free of
errors.

**Do not expect all eight islands in frame.** This vantage point is a fixed placeholder and the
archipelago spans roughly x −350 to 380 and y −110 to 420, so only the nearest few — `home` and a
couple of its neighbours — fall inside the frustum. What this step verifies is that geometry,
materials, lighting and fog all work, not that the level is fully framed. Task 15's follow camera
replaces this vantage point entirely.

- [ ] **Step 11: Verify the whole suite, typecheck, and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add src/core/renderer.ts src/core/renderer.test.ts src/world/world.ts src/world/world.test.ts src/main.ts
git commit -m "Add renderer, world assembly, and first rendered archipelago"
```

---

### Task 15: Follow camera

In flight the camera is the steering device, not just presentation, so it is a gameplay-critical system. The two modes invert the camera-character relationship: on ground the character leads and the camera trails; in flight the camera leads and the kite follows.

**Files:**
- Create: `src/camera/follow-cam.ts`
- Test: `src/camera/follow-cam.test.ts`

**Interfaces:**
- Consumes: `PlayerState` and `TerrainQuery` from `src/core/types.ts`.
- Produces:
  - `interface CamProfile { distance: number; height: number; smoothing: number }`
  - `GROUND_PROFILE`, `KITE_PROFILE`, `profileFor(mode: PlayerState['mode']): CamProfile`
  - `desiredCameraPosition(target: Vector3, lookDirection: Vector3, profile: CamProfile): Vector3`
  - `smoothTowards(current: Vector3, desired: Vector3, smoothing: number, dt: number): Vector3`
  - `pullInForTerrain(target: Vector3, desired: Vector3, terrain: TerrainQuery, minDistance?: number): Vector3`

- [ ] **Step 1: Write the failing tests**

`src/camera/follow-cam.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  profileFor, desiredCameraPosition, smoothTowards, pullInForTerrain,
  GROUND_PROFILE, KITE_PROFILE,
} from './follow-cam'
import type { TerrainQuery } from '../core/types'

const noGround: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }
const groundAt = (y: number): TerrainQuery => ({
  groundHeightAt: () => y,
  raycastDown: (from) => ({
    point: new Vector3(from.x, y, from.z), normal: new Vector3(0, 1, 0), islandId: 'g',
  }),
})

describe('profileFor', () => {
  it('uses the ground profile on foot', () => {
    expect(profileFor('ground')).toBe(GROUND_PROFILE)
  })

  it('uses the kite profile in flight', () => {
    expect(profileFor('kite')).toBe(KITE_PROFILE)
  })

  it('pulls further back in flight to sell speed', () => {
    expect(KITE_PROFILE.distance).toBeGreaterThan(GROUND_PROFILE.distance)
  })

  it('smooths tighter in flight, because the camera is the steering device', () => {
    expect(KITE_PROFILE.smoothing).toBeGreaterThan(GROUND_PROFILE.smoothing)
  })
})

describe('desiredCameraPosition', () => {
  const target = new Vector3(0, 0, 0)

  it('sits behind the look direction', () => {
    expect(desiredCameraPosition(target, new Vector3(0, 0, -1), GROUND_PROFILE).z)
      .toBeCloseTo(GROUND_PROFILE.distance, 5)
  })

  it('sits above the target', () => {
    expect(desiredCameraPosition(target, new Vector3(0, 0, -1), GROUND_PROFILE).y)
      .toBeCloseTo(GROUND_PROFILE.height, 5)
  })

  it('follows the look direction around', () => {
    expect(desiredCameraPosition(target, new Vector3(-1, 0, 0), GROUND_PROFILE).x)
      .toBeCloseTo(GROUND_PROFILE.distance, 5)
  })

  it('does not mutate the target it is given', () => {
    const t = new Vector3(1, 2, 3)
    desiredCameraPosition(t, new Vector3(0, 0, -1), GROUND_PROFILE)
    expect(t.toArray()).toEqual([1, 2, 3])
  })
})

describe('smoothTowards', () => {
  it('moves toward the desired position', () => {
    const out = smoothTowards(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 9, 1 / 60)
    expect(out.x).toBeGreaterThan(0)
    expect(out.x).toBeLessThan(10)
  })

  it('converges over many frames', () => {
    let c = new Vector3(0, 0, 0)
    const d = new Vector3(10, 0, 0)
    for (let i = 0; i < 200; i++) c = smoothTowards(c, d, 9, 1 / 60)
    expect(c.x).toBeCloseTo(10, 3)
  })

  it('is frame-rate independent to within a small tolerance', () => {
    let fast = new Vector3()
    let slow = new Vector3()
    const d = new Vector3(10, 0, 0)
    for (let i = 0; i < 120; i++) fast = smoothTowards(fast, d, 9, 1 / 120)
    for (let i = 0; i < 60; i++) slow = smoothTowards(slow, d, 9, 1 / 60)
    expect(Math.abs(fast.x - slow.x)).toBeLessThan(0.01)
  })

  it('never overshoots the target', () => {
    expect(smoothTowards(new Vector3(), new Vector3(10, 0, 0), 1000, 1).x)
      .toBeLessThanOrEqual(10)
  })

  it('does not mutate the current vector', () => {
    const c = new Vector3(0, 0, 0)
    smoothTowards(c, new Vector3(10, 0, 0), 9, 1 / 60)
    expect(c.toArray()).toEqual([0, 0, 0])
  })

  it('does not mutate the desired vector', () => {
    const d = new Vector3(10, 0, 0)
    smoothTowards(new Vector3(0, 0, 0), d, 9, 1 / 60)
    expect(d.toArray()).toEqual([10, 0, 0])
  })
})

describe('pullInForTerrain', () => {
  const target = new Vector3(0, 20, 0)

  it('leaves the camera alone in open air', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, noGround).toArray()).toEqual(desired.toArray())
  })

  it('leaves the camera alone when well above terrain', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, groundAt(0)).toArray()).toEqual(desired.toArray())
  })

  it('lifts the camera above terrain it would clip into', () => {
    const desired = new Vector3(0, 1, 10)
    expect(pullInForTerrain(target, desired, groundAt(5)).y).toBeGreaterThan(desired.y)
  })

  it('never returns a non-finite position', () => {
    const out = pullInForTerrain(target, new Vector3(0, 19, 0), groundAt(19))
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
  })

  it('handles the zero-length case when lifted camera lands on player', () => {
    // Target at y=20, ground at y=18, minDistance=2, so lifted would be at y=20.
    // This makes toTarget = (0, 0, 0), a degenerate case.
    const out = pullInForTerrain(target, new Vector3(0, 18, 0), groundAt(18))
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
    const dist = out.clone().sub(target).length()
    expect(dist).toBeGreaterThanOrEqual(2)
  })

  it('does not return a reference-identical copy on early return', () => {
    const desired = new Vector3(0, 20, 10)
    const out = pullInForTerrain(target, desired, noGround)
    expect(out).not.toBe(desired)
  })

  it('does not mutate the target vector', () => {
    const t = new Vector3(0, 20, 0)
    const orig = t.toArray()
    pullInForTerrain(t, new Vector3(0, 1, 10), groundAt(5))
    expect(t.toArray()).toEqual(orig)
  })

  it('does not mutate the desired vector', () => {
    const d = new Vector3(0, 1, 10)
    const orig = d.toArray()
    pullInForTerrain(target, d, groundAt(5))
    expect(d.toArray()).toEqual(orig)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/camera/follow-cam.test.ts`
Expected: FAIL — cannot resolve module `./follow-cam`.

- [ ] **Step 3: Write `src/camera/follow-cam.ts`**

```typescript
import { Vector3, MathUtils } from 'three'
import type { PlayerState, TerrainQuery } from '../core/types'

export interface CamProfile {
  distance: number
  height: number
  /** Higher is snappier. */
  smoothing: number
}

/** On foot the character leads and the camera trails. */
export const GROUND_PROFILE: CamProfile = { distance: 7, height: 2.6, smoothing: 9 }
/**
 * In flight the camera leads: the kite steers toward it. Smoothing must stay
 * tight here or steering feels laggy — the kite's weight comes from the
 * airspeed-limited turn rate, not from a sluggish camera.
 */
export const KITE_PROFILE: CamProfile = { distance: 12, height: 3.2, smoothing: 16 }

export function profileFor(mode: PlayerState['mode']): CamProfile {
  return mode === 'kite' ? KITE_PROFILE : GROUND_PROFILE
}

/** Where the camera wants to sit, before smoothing or terrain collision. */
export function desiredCameraPosition(
  target: Vector3, lookDirection: Vector3, profile: CamProfile,
): Vector3 {
  return target.clone()
    .addScaledVector(lookDirection.clone().normalize(), -profile.distance)
    .add(new Vector3(0, profile.height, 0))
}

/** Exponential smoothing, stable at any frame rate and never overshooting. */
export function smoothTowards(
  current: Vector3, desired: Vector3, smoothing: number, dt: number,
): Vector3 {
  const alpha = 1 - Math.exp(-smoothing * dt)
  return current.clone().lerp(desired, MathUtils.clamp(alpha, 0, 1))
}

/** Lift the camera when terrain would sit between it and the player. */
export function pullInForTerrain(
  target: Vector3, desired: Vector3, terrain: TerrainQuery, minDistance = 2,
): Vector3 {
  const ground = terrain.groundHeightAt(desired.x, desired.z)
  if (ground === null || desired.y > ground + minDistance) return desired.clone()

  const lifted = desired.clone()
  lifted.y = ground + minDistance
  const toTarget = target.clone().sub(lifted)
  if (toTarget.lengthSq() < 1e-12) {
    // The lifted camera landed exactly on the player. Any direction will do;
    // back off along world +Z so the result stays a sane distance away.
    return target.clone().add(new Vector3(0, 0, minDistance))
  }
  if (toTarget.length() < minDistance) {
    return target.clone().addScaledVector(toTarget.normalize(), -minDistance)
  }
  return lifted
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- src/camera/follow-cam.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add src/camera/follow-cam.ts src/camera/follow-cam.test.ts
git commit -m "Add follow camera with ground and flight profiles"
```

---

### Task 16: Avatar and asset loading

The character on screen. The animation state machine is pure and tested; the Three.js model and mixer are thin glue around it. Assets load with a placeholder fallback so the game is never blocked on a download.

**Files:**
- Create: `src/player/avatar-anim.ts`
- Create: `src/core/assets.ts`
- Create: `src/player/avatar.ts`
- Create: `ASSETS.md`
- Test: `src/player/avatar-anim.test.ts`

**Interfaces:**
- Consumes: `PlayerState` from `src/core/types.ts`.
- Produces:
  - `type AnimationName = 'idle' | 'walk' | 'run' | 'fall' | 'glide'`
  - `animationFor(state: PlayerState): AnimationName`
  - `loadGLTF(url: string): Promise<GLTF | null>` — resolves `null` on failure rather than rejecting.
  - `createAvatar(): { object: Object3D; setAnimation(name: AnimationName): void; update(dt: number): void; attachModel(gltf: GLTF): void }`

**Asset strategy:** the placeholder is built first and the real model swapped in when it arrives. The game is fully playable before any asset exists, which means this task never blocks on a download.

- [ ] **Step 1: Write the failing tests for the animation state machine**

`src/player/avatar-anim.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { animationFor } from './avatar-anim'
import type { PlayerState } from '../core/types'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, ...over,
})

describe('animationFor', () => {
  it('glides whenever the kite is out', () => {
    expect(animationFor(p({ mode: 'kite', grounded: false }))).toBe('glide')
  })

  it('glides even when the kite is barely moving', () => {
    expect(animationFor(p({ mode: 'kite', grounded: false, velocity: new Vector3() })))
      .toBe('glide')
  })

  it('falls when airborne without the kite', () => {
    expect(animationFor(p({ grounded: false }))).toBe('fall')
  })

  it('idles when standing still', () => {
    expect(animationFor(p())).toBe('idle')
  })

  it('walks at a walking pace', () => {
    expect(animationFor(p({ velocity: new Vector3(0, 0, -7) }))).toBe('walk')
  })

  it('runs at a running pace', () => {
    expect(animationFor(p({ velocity: new Vector3(0, 0, -13) }))).toBe('run')
  })

  it('ignores vertical speed when picking a ground clip', () => {
    expect(animationFor(p({ velocity: new Vector3(0, -30, 0) }))).toBe('idle')
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test -- src/player/avatar-anim.test.ts`
Expected: FAIL — cannot resolve module `./avatar-anim`.

- [ ] **Step 3: Write `src/player/avatar-anim.ts`**

```typescript
import type { PlayerState } from '../core/types'

export type AnimationName = 'idle' | 'walk' | 'run' | 'fall' | 'glide'

const WALK_THRESHOLD = 0.5
const RUN_THRESHOLD = 9

/**
 * Which clip should be playing. Pure, so the state machine is testable without
 * a Three.js AnimationMixer.
 */
export function animationFor(state: PlayerState): AnimationName {
  if (state.mode === 'kite') return 'glide'
  if (!state.grounded) return 'fall'
  const horizontal = Math.hypot(state.velocity.x, state.velocity.z)
  if (horizontal < WALK_THRESHOLD) return 'idle'
  return horizontal >= RUN_THRESHOLD ? 'run' : 'walk'
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test -- src/player/avatar-anim.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write `src/core/assets.ts`**

```typescript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
const cache = new Map<string, Promise<GLTF | null>>()

/**
 * Load a model, resolving null on any failure. Callers substitute a placeholder
 * rather than failing to start, so a missing asset never blanks the screen.
 */
export function loadGLTF(url: string): Promise<GLTF | null> {
  const cached = cache.get(url)
  if (cached) return cached

  const promise = loader.loadAsync(url).catch((error: unknown) => {
    console.warn(`Failed to load "${url}", using a placeholder instead.`, error)
    return null
  })
  cache.set(url, promise)
  return promise
}
```

- [ ] **Step 6: Write `src/player/avatar.ts`**

```typescript
import {
  Object3D, Group, Mesh, CapsuleGeometry, ConeGeometry,
  MeshLambertMaterial, AnimationMixer, type AnimationClip,
} from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { AnimationName } from './avatar-anim'

const FADE_SECONDS = 0.18

/** Primitive stand-in used until a real model loads, and if none ever does. */
function createPlaceholder(): Group {
  const group = new Group()

  const body = new Mesh(
    new CapsuleGeometry(0.4, 1.0, 4, 8),
    new MeshLambertMaterial({ color: 0xf0e6d2 }),
  )
  body.position.y = 0.9
  group.add(body)

  // A cone marks the facing direction, so orientation is readable while testing.
  const nose = new Mesh(
    new ConeGeometry(0.22, 0.5, 8),
    new MeshLambertMaterial({ color: 0xd9863f }),
  )
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 1.1, -0.45)
  group.add(nose)

  return group
}

export function createAvatar() {
  const object: Object3D = new Group()
  object.add(createPlaceholder())

  let mixer: AnimationMixer | null = null
  let clips = new Map<AnimationName, AnimationClip>()
  let current: AnimationName | null = null

  return {
    object,

    /** Swap the placeholder for a real model once it has loaded. */
    attachModel(gltf: GLTF): void {
      object.clear()
      object.add(gltf.scene)
      mixer = new AnimationMixer(gltf.scene)
      clips = new Map()
      for (const clip of gltf.animations) {
        const name = clip.name.toLowerCase() as AnimationName
        clips.set(name, clip)
      }
      current = null
    },

    setAnimation(name: AnimationName): void {
      if (name === current) return
      const clip = clips.get(name)
      if (!mixer || !clip) {
        // No model or no matching clip: the placeholder simply does not animate.
        current = name
        return
      }
      const next = mixer.clipAction(clip)
      if (current) {
        const previous = clips.get(current)
        if (previous) mixer.clipAction(previous).fadeOut(FADE_SECONDS)
      }
      next.reset().fadeIn(FADE_SECONDS).play()
      current = name
    },

    update(dt: number): void {
      mixer?.update(dt)
    },
  }
}
```

- [ ] **Step 7: Write `ASSETS.md`**

```markdown
# Assets

Every asset in this repository is CC0 or equivalently permissive, so the project
stays clean as a public repository.

| Asset | Path | Source | License |
| --- | --- | --- | --- |
| Placeholder character | generated in code | `src/player/avatar.ts` | n/a |

## Adding an asset

1. Confirm the license is CC0, public domain, or equally permissive. If
   redistribution in a public repository is unclear, do not commit it.
2. Put the file under `public/models/` or `public/audio/`.
3. Add a row to the table above with its real source URL.

## Recommended sources

- Quaternius (CC0) — animated low-poly characters and environment packs
- Kenney (CC0) — props and audio
- Poly Pizza (mixed, check per asset) — low-poly models

When adding a rigged character, name its clips `idle`, `walk`, `run`, `fall`,
and `glide` so `avatar.ts` matches them automatically.
```

- [ ] **Step 8: Verify the suite, typecheck, and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/player/avatar-anim.ts src/player/avatar-anim.test.ts src/player/avatar.ts src/core/assets.ts ASSETS.md
git commit -m "Add avatar with animation state machine and placeholder fallback"
```

---

### Task 17: HUD

Breath, altitude, and airspeed. The formatting is pure and tested; the DOM writing is a thin wrapper.

**Files:**
- Create: `src/ui/hud.ts`
- Test: `src/ui/hud.test.ts`

**Interfaces:**
- Consumes: `PlayerState` from `src/core/types.ts`.
- Produces:
  - `formatAltitude(y: number): string`, `formatAirspeed(speed: number): string`
  - `breathFraction(state: PlayerState): number`
  - `interface HudModel { altitude: string; airspeed: string; breath: number; showBreath: boolean }`
  - `hudModelFor(state: PlayerState): HudModel`
  - `createHud(parent: HTMLElement): { update(model: HudModel): void; dispose(): void }`

- [ ] **Step 1: Write the failing tests**

`src/ui/hud.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { formatAltitude, formatAirspeed, breathFraction, hudModelFor } from './hud'
import type { PlayerState } from '../core/types'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, ...over,
})

describe('formatAltitude', () => {
  it('rounds to whole metres', () => {
    expect(formatAltitude(123.7)).toBe('124 m')
  })

  it('handles negative altitude below the islands', () => {
    expect(formatAltitude(-42.2)).toBe('-42 m')
  })

  it('never shows a non-finite value to the player', () => {
    expect(formatAltitude(NaN)).toBe('— m')
  })
})

describe('formatAirspeed', () => {
  it('rounds to whole metres per second', () => {
    expect(formatAirspeed(23.91)).toBe('24 m/s')
  })

  it('shows zero at rest', () => {
    expect(formatAirspeed(0)).toBe('0 m/s')
  })

  it('never shows a non-finite value to the player', () => {
    expect(formatAirspeed(Infinity)).toBe('— m/s')
  })
})

describe('breathFraction', () => {
  it('is one at full breath', () => {
    expect(breathFraction(p())).toBe(1)
  })

  it('is a half at half breath', () => {
    expect(breathFraction(p({ breath: 50 }))).toBe(0.5)
  })

  it('is zero when empty', () => {
    expect(breathFraction(p({ breath: 0 }))).toBe(0)
  })

  it('accounts for a raised maximum from shrines', () => {
    expect(breathFraction(p({ breath: 90, maxBreath: 180 }))).toBeCloseTo(0.5, 5)
  })

  it('guards against a zero maximum rather than dividing by zero', () => {
    expect(breathFraction(p({ breath: 0, maxBreath: 0 }))).toBe(0)
  })
})

describe('hudModelFor', () => {
  it('reports altitude from the player position', () => {
    expect(hudModelFor(p({ position: new Vector3(0, 250, 0) })).altitude).toBe('250 m')
  })

  it('reports airspeed from the velocity magnitude', () => {
    expect(hudModelFor(p({ velocity: new Vector3(0, 0, -30) })).airspeed).toBe('30 m/s')
  })

  it('hides the breath meter when full and on the ground', () => {
    expect(hudModelFor(p()).showBreath).toBe(false)
  })

  it('shows the breath meter while flying', () => {
    expect(hudModelFor(p({ mode: 'kite', grounded: false })).showBreath).toBe(true)
  })

  it('shows the breath meter when it is not full, even on the ground', () => {
    expect(hudModelFor(p({ breath: 60 })).showBreath).toBe(true)
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test -- src/ui/hud.test.ts`
Expected: FAIL — cannot resolve module `./hud`.

- [ ] **Step 3: Write `src/ui/hud.ts`**

```typescript
import type { PlayerState } from '../core/types'

/** Shown when a value is not finite, so the player never sees NaN. */
const NO_VALUE = '—'

export function formatAltitude(y: number): string {
  return Number.isFinite(y) ? `${Math.round(y)} m` : `${NO_VALUE} m`
}

export function formatAirspeed(speed: number): string {
  return Number.isFinite(speed) ? `${Math.round(speed)} m/s` : `${NO_VALUE} m/s`
}

export function breathFraction(state: PlayerState): number {
  if (!(state.maxBreath > 0)) return 0
  return state.breath / state.maxBreath
}

export interface HudModel {
  altitude: string
  airspeed: string
  /** 0 to 1. */
  breath: number
  showBreath: boolean
}

export function hudModelFor(state: PlayerState): HudModel {
  const breath = breathFraction(state)
  return {
    altitude: formatAltitude(state.position.y),
    airspeed: formatAirspeed(state.velocity.length()),
    breath,
    // Keep the screen clean when the meter has nothing to say.
    showBreath: state.mode === 'kite' || breath < 1,
  }
}

const STYLE = `
.hud { position: fixed; inset: auto auto 20px 20px; color: #f3f6fb;
  font: 500 14px/1.4 system-ui, sans-serif; text-shadow: 0 1px 3px rgba(0,0,0,.6);
  pointer-events: none; }
.hud-readouts { display: flex; gap: 16px; margin-bottom: 8px; }
.hud-breath { width: 180px; height: 8px; border-radius: 4px;
  background: rgba(255,255,255,.22); overflow: hidden; transition: opacity .2s; }
.hud-breath-fill { height: 100%; width: 100%; background: linear-gradient(90deg,#8fd8ff,#d9f4ff);
  transform-origin: left center; }
`

export function createHud(parent: HTMLElement) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'hud'
  root.innerHTML = `
    <div class="hud-readouts">
      <span data-altitude></span>
      <span data-airspeed></span>
    </div>
    <div class="hud-breath"><div class="hud-breath-fill"></div></div>
  `
  parent.append(root)

  const altitude = root.querySelector('[data-altitude]') as HTMLElement
  const airspeed = root.querySelector('[data-airspeed]') as HTMLElement
  const breathBar = root.querySelector('.hud-breath') as HTMLElement
  const breathFill = root.querySelector('.hud-breath-fill') as HTMLElement

  return {
    update(model: HudModel): void {
      altitude.textContent = model.altitude
      airspeed.textContent = model.airspeed
      breathBar.style.opacity = model.showBreath ? '1' : '0'
      breathFill.style.transform = `scaleX(${model.breath})`
    },
    dispose(): void {
      root.remove()
      style.remove()
    },
  }
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test -- src/ui/hud.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/hud.ts src/ui/hud.test.ts
git commit -m "Add HUD with breath, altitude, and airspeed readouts"
```

---

### Task 18: Air shrines and save persistence

The reward that makes exploration compound: each shrine permanently raises maximum breath, so the islands you reach extend the reach you have. Persistence is behind an injectable storage interface, so it is tested without a browser and never crashes on blocked or full storage.

**Files:**
- Create: `src/world/shrine.ts`
- Create: `src/core/save.ts`
- Test: `src/world/shrine.test.ts`, `src/core/save.test.ts`

**Interfaces:**
- Consumes: `TerrainQuery` from `src/core/types.ts`, `Level` from Task 10.
- Produces:
  - `interface Shrine { id: string; position: Vector3; collected: boolean }`
  - `COLLECT_RADIUS: number`
  - `placeShrines(level: Level, terrain: TerrainQuery, collected: readonly string[]): Shrine[]`
  - `collectShrinesAt(shrines: readonly Shrine[], position: Vector3): string[]`
  - `interface SaveData { collectedShrines: string[]; maxBreath: number }`
  - `interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }`
  - `SAVE_KEY`, `defaultSave(baseMaxBreath: number): SaveData`
  - `loadSave(storage: StorageLike, baseMaxBreath: number): SaveData` — never throws.
  - `writeSave(storage: StorageLike, data: SaveData): boolean` — never throws; returns success.

- [ ] **Step 1: Write the failing tests for shrines**

`src/world/shrine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { placeShrines, collectShrinesAt, COLLECT_RADIUS } from './shrine'
import { ARCHIPELAGO } from './levels/archipelago'
import type { TerrainQuery } from '../core/types'
import type { Level } from './level'

const flat: TerrainQuery = {
  groundHeightAt: () => 10,
  raycastDown: (from) => ({
    point: new Vector3(from.x, 10, from.z), normal: new Vector3(0, 1, 0), islandId: 'x',
  }),
}
const empty: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }

describe('placeShrines', () => {
  it('places one shrine per level shrine definition', () => {
    expect(placeShrines(ARCHIPELAGO, flat, [])).toHaveLength(ARCHIPELAGO.shrines.length)
  })

  it('sits shrines above the ground surface', () => {
    expect(placeShrines(ARCHIPELAGO, flat, [])[0]!.position.y).toBeGreaterThan(10)
  })

  it('marks already-collected shrines', () => {
    const shrines = placeShrines(ARCHIPELAGO, flat, ['home'])
    expect(shrines.find((s) => s.id === 'home')!.collected).toBe(true)
    expect(shrines.find((s) => s.id === 'spire')!.collected).toBe(false)
  })

  it('drops shrines whose island has no ground beneath them', () => {
    expect(placeShrines(ARCHIPELAGO, empty, [])).toHaveLength(0)
  })

  it('skips shrines referencing a missing island', () => {
    const level: Level = { ...ARCHIPELAGO, shrines: [{ islandId: 'ghost', offset: new Vector3() }] }
    expect(placeShrines(level, flat, [])).toHaveLength(0)
  })
})

describe('collectShrinesAt', () => {
  const shrines = [
    { id: 'a', position: new Vector3(0, 0, 0), collected: false },
    { id: 'b', position: new Vector3(100, 0, 0), collected: false },
    { id: 'c', position: new Vector3(0, 0, 0), collected: true },
  ]

  it('collects a shrine within range', () => {
    expect(collectShrinesAt(shrines, new Vector3(1, 0, 0))).toEqual(['a'])
  })

  it('ignores shrines out of range', () => {
    expect(collectShrinesAt(shrines, new Vector3(50, 0, 0))).toEqual([])
  })

  it('does not re-collect an already-collected shrine', () => {
    expect(collectShrinesAt(shrines, new Vector3(0, 0, 0))).toEqual(['a'])
  })

  it('collects exactly at the radius boundary', () => {
    expect(collectShrinesAt(shrines, new Vector3(COLLECT_RADIUS, 0, 0))).toEqual(['a'])
  })

  it('returns empty when nothing is nearby', () => {
    expect(collectShrinesAt(shrines, new Vector3(0, 500, 0))).toEqual([])
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test -- src/world/shrine.test.ts`
Expected: FAIL — cannot resolve module `./shrine`.

- [ ] **Step 3: Write `src/world/shrine.ts`**

```typescript
import { Vector3 } from 'three'
import type { TerrainQuery } from '../core/types'
import type { Level } from './level'

export interface Shrine {
  id: string
  position: Vector3
  collected: boolean
}

/** How close the player must be to collect a shrine. */
export const COLLECT_RADIUS = 6
/** How far above the surface a shrine floats. */
const HOVER_HEIGHT = 1.5

/** Place shrines on their island's surface, dropping any that miss the ground. */
export function placeShrines(
  level: Level, terrain: TerrainQuery, collected: readonly string[],
): Shrine[] {
  const already = new Set(collected)
  const shrines: Shrine[] = []

  for (const def of level.shrines) {
    const island = level.islands.find((i) => i.id === def.islandId)
    if (!island) continue
    const x = island.position.x + def.offset.x
    const z = island.position.z + def.offset.z
    const groundY = terrain.groundHeightAt(x, z)
    // A shrine with no ground under it would be unreachable, so drop it.
    if (groundY === null) continue
    shrines.push({
      id: def.islandId,
      position: new Vector3(x, groundY + HOVER_HEIGHT, z),
      collected: already.has(def.islandId),
    })
  }
  return shrines
}

/** Ids newly collected this frame. Empty when nothing is in range. */
export function collectShrinesAt(shrines: readonly Shrine[], position: Vector3): string[] {
  return shrines
    .filter((s) => !s.collected && s.position.distanceTo(position) <= COLLECT_RADIUS)
    .map((s) => s.id)
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test -- src/world/shrine.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the failing tests for save persistence**

`src/core/save.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { loadSave, writeSave, defaultSave, SAVE_KEY, type StorageLike } from './save'

function memory(initial: Record<string, string> = {}): StorageLike {
  const data = { ...initial }
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v } }
}
const hostile: StorageLike = {
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('quota exceeded') },
}

describe('loadSave', () => {
  it('returns a fresh save when storage is empty', () => {
    expect(loadSave(memory(), 100)).toEqual(defaultSave(100))
  })

  it('round-trips a written save', () => {
    const s = memory()
    writeSave(s, { collectedShrines: ['home', 'spire'], maxBreath: 120 })
    expect(loadSave(s, 100)).toEqual({ collectedShrines: ['home', 'spire'], maxBreath: 120 })
  })

  it('falls back on malformed JSON rather than throwing', () => {
    expect(loadSave(memory({ [SAVE_KEY]: '{not json' }), 100)).toEqual(defaultSave(100))
  })

  it('falls back when the stored value is not an object', () => {
    expect(loadSave(memory({ [SAVE_KEY]: '42' }), 100)).toEqual(defaultSave(100))
  })

  it('discards non-string shrine entries', () => {
    const raw = JSON.stringify({ collectedShrines: ['home', 7, null], maxBreath: 110 })
    expect(loadSave(memory({ [SAVE_KEY]: raw }), 100).collectedShrines).toEqual(['home'])
  })

  it('rejects an implausible maxBreath', () => {
    const raw = JSON.stringify({ collectedShrines: [], maxBreath: -5 })
    expect(loadSave(memory({ [SAVE_KEY]: raw }), 100).maxBreath).toBe(100)
  })

  it('survives storage that throws on read', () => {
    expect(loadSave(hostile, 100)).toEqual(defaultSave(100))
  })
})

describe('writeSave', () => {
  it('reports success on a working store', () => {
    expect(writeSave(memory(), defaultSave(100))).toBe(true)
  })

  it('reports failure instead of throwing when storage is full', () => {
    expect(writeSave(hostile, defaultSave(100))).toBe(false)
  })
})
```

- [ ] **Step 6: Run and verify it fails**

Run: `npm test -- src/core/save.test.ts`
Expected: FAIL — cannot resolve module `./save`.

- [ ] **Step 7: Write `src/core/save.ts`**

```typescript
export interface SaveData {
  collectedShrines: string[]
  maxBreath: number
}

/** Injectable so persistence is testable and a blocked localStorage is survivable. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const SAVE_KEY = 'airbender-skies:save:v1'

export function defaultSave(baseMaxBreath: number): SaveData {
  return { collectedShrines: [], maxBreath: baseMaxBreath }
}

/**
 * Never throws. A corrupt, hand-edited, or unavailable save falls back to a
 * fresh one rather than preventing the game from starting.
 */
export function loadSave(storage: StorageLike, baseMaxBreath: number): SaveData {
  try {
    const raw = storage.getItem(SAVE_KEY)
    if (!raw) return defaultSave(baseMaxBreath)

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaultSave(baseMaxBreath)

    const data = parsed as Partial<SaveData>
    const shrines = Array.isArray(data.collectedShrines)
      ? data.collectedShrines.filter((s): s is string => typeof s === 'string')
      : []
    const maxBreath =
      typeof data.maxBreath === 'number' && Number.isFinite(data.maxBreath) && data.maxBreath > 0
        ? data.maxBreath
        : baseMaxBreath

    return { collectedShrines: shrines, maxBreath }
  } catch {
    return defaultSave(baseMaxBreath)
  }
}

/** Never throws. Private browsing and a full quota must not crash the game. */
export function writeSave(storage: StorageLike, data: SaveData): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 8: Run and verify it passes**

Run: `npm test -- src/core/save.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 9: Commit**

```bash
git add src/world/shrine.ts src/world/shrine.test.ts src/core/save.ts src/core/save.test.ts
git commit -m "Add air shrines and resilient save persistence"
```

---

### Task 19: Speed effects and wind audio

Cheap effects with a disproportionate payoff for the sense of speed. Every mapping from airspeed to an effect parameter is a pure function, so the feel is tunable and testable in one place.

**Files:**
- Create: `src/fx/mapping.ts`
- Create: `src/fx/audio.ts`
- Test: `src/fx/mapping.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FX_SPEED_REFERENCE`, `BASE_FOV`, `MAX_FOV_KICK`, `TRAIL_SPEED_THRESHOLD`
  - `speedIntensity(airspeed: number): number` — 0 at rest, 1 at the reference speed.
  - `fovForSpeed`, `windVolumeForSpeed`, `windPitchForSpeed`, `trailOpacityForSpeed`
  - `createWindAudio(): { start(): void; update(airspeed: number): void; dispose(): void }`

**Note:** `BASE_FOV` lives here rather than in the renderer because the field of view is a speed effect, and Task 14 already imports it from this module.

- [ ] **Step 1: Write the failing tests**

`src/fx/mapping.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  speedIntensity, fovForSpeed, windVolumeForSpeed, windPitchForSpeed, trailOpacityForSpeed,
  BASE_FOV, MAX_FOV_KICK, FX_SPEED_REFERENCE, TRAIL_SPEED_THRESHOLD,
} from './mapping'

describe('speedIntensity', () => {
  it('is zero at rest', () => { expect(speedIntensity(0)).toBe(0) })
  it('is one at the reference speed', () => { expect(speedIntensity(FX_SPEED_REFERENCE)).toBe(1) })
  it('clamps above the reference', () => { expect(speedIntensity(500)).toBe(1) })
  it('clamps below zero', () => { expect(speedIntensity(-10)).toBe(0) })
})

describe('fovForSpeed', () => {
  it('is the base field of view at rest', () => { expect(fovForSpeed(0)).toBe(BASE_FOV) })

  it('kicks out at full speed', () => {
    expect(fovForSpeed(FX_SPEED_REFERENCE)).toBe(BASE_FOV + MAX_FOV_KICK)
  })

  it('increases monotonically', () => {
    expect(fovForSpeed(40)).toBeGreaterThan(fovForSpeed(20))
  })

  it('stays within a sane range', () => {
    expect(fovForSpeed(1000)).toBeLessThanOrEqual(BASE_FOV + MAX_FOV_KICK)
  })
})

describe('windVolumeForSpeed', () => {
  it('is silent at rest', () => { expect(windVolumeForSpeed(0)).toBe(0) })

  it('is full at the reference speed', () => {
    expect(windVolumeForSpeed(FX_SPEED_REFERENCE)).toBe(1)
  })

  it('ramps in slowly rather than linearly', () => {
    expect(windVolumeForSpeed(FX_SPEED_REFERENCE / 2)).toBeLessThan(0.5)
  })

  it('never exceeds one', () => { expect(windVolumeForSpeed(1000)).toBe(1) })
})

describe('windPitchForSpeed', () => {
  it('rises with speed', () => {
    expect(windPitchForSpeed(50)).toBeGreaterThan(windPitchForSpeed(5))
  })

  it('stays positive at rest so playback never stops', () => {
    expect(windPitchForSpeed(0)).toBeGreaterThan(0)
  })
})

describe('trailOpacityForSpeed', () => {
  it('shows nothing below the threshold', () => {
    expect(trailOpacityForSpeed(TRAIL_SPEED_THRESHOLD - 1)).toBe(0)
  })

  it('fades in above the threshold', () => {
    expect(trailOpacityForSpeed(TRAIL_SPEED_THRESHOLD + 5)).toBeGreaterThan(0)
  })

  it('is fully opaque at the reference speed', () => {
    expect(trailOpacityForSpeed(FX_SPEED_REFERENCE)).toBe(1)
  })

  it('never exceeds one', () => { expect(trailOpacityForSpeed(1000)).toBe(1) })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test -- src/fx/mapping.test.ts`
Expected: FAIL — cannot resolve module `./mapping`.

- [ ] **Step 3: Write `src/fx/mapping.ts`**

```typescript
import { MathUtils } from 'three'

/** Airspeed at which speed effects reach full strength. */
export const FX_SPEED_REFERENCE = 55
export const BASE_FOV = 70
export const MAX_FOV_KICK = 14
export const TRAIL_SPEED_THRESHOLD = 30

/** 0 at rest, 1 at the reference speed. Drives every speed-reactive effect. */
export function speedIntensity(airspeed: number): number {
  return MathUtils.clamp(airspeed / FX_SPEED_REFERENCE, 0, 1)
}

export function fovForSpeed(airspeed: number): number {
  return BASE_FOV + MAX_FOV_KICK * speedIntensity(airspeed)
}

export function windVolumeForSpeed(airspeed: number): number {
  // Squared so slow flight stays quiet and only fast flight gets loud.
  return speedIntensity(airspeed) ** 2
}

export function windPitchForSpeed(airspeed: number): number {
  return 0.7 + 0.8 * speedIntensity(airspeed)
}

export function trailOpacityForSpeed(airspeed: number): number {
  if (airspeed <= TRAIL_SPEED_THRESHOLD) return 0
  return MathUtils.clamp(
    (airspeed - TRAIL_SPEED_THRESHOLD) / (FX_SPEED_REFERENCE - TRAIL_SPEED_THRESHOLD),
    0, 1,
  )
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test -- src/fx/mapping.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Write `src/fx/audio.ts`**

Wind is synthesised with filtered noise rather than shipped as an audio file, which avoids an asset and a licence entirely.

```typescript
import { windVolumeForSpeed, windPitchForSpeed } from './mapping'

const NOISE_SECONDS = 2

/** Filtered white noise, pitched and mixed by airspeed. No audio asset needed. */
export function createWindAudio() {
  let context: AudioContext | null = null
  let source: AudioBufferSourceNode | null = null
  let gain: GainNode | null = null
  let filter: BiquadFilterNode | null = null

  return {
    /** Must be called from a user gesture, or the browser blocks audio. */
    start(): void {
      if (context) return
      try {
        context = new AudioContext()
        const buffer = context.createBuffer(
          1, context.sampleRate * NOISE_SECONDS, context.sampleRate,
        )
        const data = buffer.getChannelData(0)
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

        source = context.createBufferSource()
        source.buffer = buffer
        source.loop = true

        filter = context.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = 700

        gain = context.createGain()
        gain.gain.value = 0

        source.connect(filter).connect(gain).connect(context.destination)
        source.start()
      } catch (error) {
        console.warn('Wind audio unavailable, continuing without it.', error)
        context = null
      }
    },

    update(airspeed: number): void {
      if (!context || !gain || !filter) return
      const now = context.currentTime
      // Ramps rather than direct assignment, otherwise the audio clicks.
      gain.gain.setTargetAtTime(windVolumeForSpeed(airspeed) * 0.35, now, 0.1)
      filter.frequency.setTargetAtTime(400 + 900 * windPitchForSpeed(airspeed), now, 0.1)
    },

    dispose(): void {
      source?.stop()
      void context?.close()
      context = null
    },
  }
}
```

- [ ] **Step 6: Verify the suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/fx/mapping.ts src/fx/mapping.test.ts src/fx/audio.ts
git commit -m "Add speed effect mappings and synthesised wind audio"
```

---

### Task 20: Assemble the game and tune

Wires every module into a playable game and tunes the feel. This is the first task whose deliverable is judged by playing rather than by tests.

**Files:**
- Modify: `src/main.ts` (full rewrite)
- Create: `src/player/state.ts`
- Modify: `README.md` (record the tuning outcome)

**Interfaces:**
- Consumes: everything built in Tasks 1–19.
- Produces:
  - `createPlayerState(level: Level, terrain: TerrainQuery, save: SaveData, config: FlightConfig): PlayerState`
  - `spawnPointFor(level: Level, terrain: TerrainQuery): (islandId: string | null) => Vector3`

- [ ] **Step 1: Write `src/player/state.ts`**

```typescript
import { Vector3 } from 'three'
import type { FlightConfig, PlayerState, TerrainQuery } from '../core/types'
import type { Level } from '../world/level'
import type { SaveData } from '../core/save'

/** How far above the surface to place a spawning player. */
const SPAWN_CLEARANCE = 2

/** Resolve a respawn position, falling back to the level spawn island. */
export function spawnPointFor(
  level: Level, terrain: TerrainQuery,
): (islandId: string | null) => Vector3 {
  return (islandId) => {
    const island =
      level.islands.find((i) => i.id === islandId) ??
      level.islands.find((i) => i.id === level.spawn.islandId)!
    const x = island.position.x
    const z = island.position.z
    const groundY = terrain.groundHeightAt(x, z)
    // If the surface cannot be found, sit above the island's nominal top.
    const y = groundY === null ? island.position.y + island.height : groundY
    return new Vector3(x, y + SPAWN_CLEARANCE, z)
  }
}

export function createPlayerState(
  level: Level, terrain: TerrainQuery, save: SaveData, config: FlightConfig,
): PlayerState {
  const position = spawnPointFor(level, terrain)(level.spawn.islandId)
  const maxBreath = Math.max(save.maxBreath, config.baseMaxBreath)
  return {
    mode: 'ground',
    position,
    velocity: new Vector3(),
    forward: new Vector3(0, 0, -1),
    breath: maxBreath,
    maxBreath,
    grounded: true,
    lastGroundIslandId: level.spawn.islandId,
  }
}
```

- [ ] **Step 2: Rewrite `src/main.ts` to assemble the game**

```typescript
import { Vector3, Mesh, OctahedronGeometry, MeshBasicMaterial, Group } from 'three'
import { createRenderer, hasWebGL, showFallback, WEBGL_MESSAGE } from './core/renderer'
import { createStepper } from './core/loop'
import { InputTracker } from './core/input'
import { DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG } from './core/config'
import { loadSave, writeSave } from './core/save'
import { buildWorld, type World } from './world/world'
import { ARCHIPELAGO } from './world/levels/archipelago'
import { placeShrines, collectShrinesAt } from './world/shrine'
import { createPlayerState, spawnPointFor } from './player/state'
import { controllerStep, type ControllerDeps } from './player/controller'
import { applyShrineBonus } from './player/breath'
import { createAvatar } from './player/avatar'
import { animationFor } from './player/avatar-anim'
import { profileFor, desiredCameraPosition, smoothTowards, pullInForTerrain } from './camera/follow-cam'
import { createHud, hudModelFor } from './ui/hud'
import { createWindAudio } from './fx/audio'
import { fovForSpeed } from './fx/mapping'

function start(): void {
  if (!hasWebGL()) return showFallback(WEBGL_MESSAGE)

  const canvas = document.getElementById('game')
  if (!(canvas instanceof HTMLCanvasElement)) {
    return showFallback('Could not find the game canvas.')
  }

  let world: World
  try {
    world = buildWorld(ARCHIPELAGO)
  } catch (error) {
    return showFallback(`The level failed to load: ${(error as Error).message}`)
  }

  const { renderer, scene, camera } = createRenderer(canvas)
  scene.add(world.group)

  const save = loadSave(localStorage, DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
  let player = createPlayerState(ARCHIPELAGO, world.terrain, save, DEFAULT_FLIGHT_CONFIG)
  let shrines = placeShrines(ARCHIPELAGO, world.terrain, save.collectedShrines)

  // Shrine markers: a spinning octahedron each, hidden once collected.
  const shrineGroup = new Group()
  const markers = new Map<string, Mesh>()
  for (const shrine of shrines) {
    const mesh = new Mesh(
      new OctahedronGeometry(1.2),
      new MeshBasicMaterial({ color: 0xd9f4ff }),
    )
    mesh.position.copy(shrine.position)
    mesh.visible = !shrine.collected
    markers.set(shrine.id, mesh)
    shrineGroup.add(mesh)
  }
  scene.add(shrineGroup)

  const avatar = createAvatar()
  scene.add(avatar.object)

  const input = new InputTracker(window, canvas)
  const hud = createHud(document.body)
  const wind = createWindAudio()
  canvas.addEventListener('click', () => wind.start(), { once: true })

  const deps: ControllerDeps = {
    terrain: world.terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    spawnPointFor: spawnPointFor(ARCHIPELAGO, world.terrain),
  }

  let cameraPosition = camera.position.clone()

  function update(dt: number): void {
    const state = input.sample()
    player = controllerStep(player, state, dt, deps)

    const collected = collectShrinesAt(shrines, player.position)
    if (collected.length > 0) {
      for (const id of collected) {
        const marker = markers.get(id)
        if (marker) marker.visible = false
      }
      shrines = shrines.map((s) => (collected.includes(s.id) ? { ...s, collected: true } : s))
      const bonus = collected.reduce(
        (acc) => applyShrineBonus(acc, DEFAULT_FLIGHT_CONFIG),
        { breath: player.breath, maxBreath: player.maxBreath },
      )
      player = { ...player, breath: bonus.breath, maxBreath: bonus.maxBreath }
      writeSave(localStorage, {
        collectedShrines: shrines.filter((s) => s.collected).map((s) => s.id),
        maxBreath: player.maxBreath,
      })
    }

    // Face the character along the kite forward, or along travel on foot.
    const facing = player.mode === 'kite'
      ? player.forward
      : new Vector3(player.velocity.x, 0, player.velocity.z)
    avatar.object.position.copy(player.position)
    if (facing.lengthSq() > 1e-4) {
      avatar.object.lookAt(player.position.clone().add(facing))
    }
    avatar.setAnimation(animationFor(player))
    avatar.update(dt)

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
    camera.fov = player.mode === 'kite' ? fovForSpeed(airspeed) : fovForSpeed(0)
    camera.updateProjectionMatrix()

    for (const marker of markers.values()) marker.rotation.y += dt * 1.5

    wind.update(player.mode === 'kite' ? airspeed : 0)
    hud.update(hudModelFor(player))
  }

  const stepper = createStepper({ update, render: () => renderer.render(scene, camera) })

  let last = performance.now()
  function frame(now: number): void {
    stepper.advance((now - last) / 1000)
    last = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

start()
```

`bonus.breath` (not `bonus.maxBreath`) is deliberate: a shrine permanently raises the breath
ceiling but must not refund the breath already spent getting there, or breath stops being a real
constraint on how high the player can climb. `applyShrineBonus` (Task 6, `src/player/breath.ts`)
already returns `breath: Math.min(s.breath, maxBreath)` to preserve current breath — this step
must consume that value rather than overriding it.

Add `src/world/shrine-collection.test.ts`, pinning that contract at the values a collection event
actually produces, using `applyShrineBonus` directly against `DEFAULT_FLIGHT_CONFIG`:
- starting at breath 40 / maxBreath 100, one shrine gives breath 40 and maxBreath 110 — current
  breath unchanged, ceiling raised.
- starting at breath 100 / maxBreath 100 (full), one shrine gives breath 100 and maxBreath 110 —
  a full player is not clamped downward.
- applying the bonus twice from breath 40 gives maxBreath 120 with breath still 40.

- [ ] **Step 3: Verify the suite, typecheck, and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass, roughly 230 tests.

- [ ] **Step 4: Play the game and work through this checklist**

```bash
npm run dev
```

Click the canvas to capture the mouse, then confirm each item:

- [ ] Walking with `WASD` moves relative to where the camera points.
- [ ] `Shift` visibly sprints.
- [ ] `Space` jumps while grounded, and the jump lands cleanly.
- [ ] Walking off the edge of `home` starts a fall.
- [ ] `Space` mid-fall deploys the kite and flight begins.
- [ ] Looking down builds airspeed; looking up trades airspeed for height.
- [ ] Holding `W` accelerates and visibly drains the breath meter.
- [ ] Releasing `W` lets breath recover.
- [ ] `S` slows the kite noticeably.
- [ ] `A` and `D` tighten a turn.
- [ ] A fast turn is visibly wider than a slow one.
- [ ] The field of view widens and the wind gets louder at speed.
- [ ] Touching down slowly stows the kite; touching down fast staggers.
- [ ] Each `ring-*` island is reachable from `home` by gliding alone.
- [ ] `climb-north` requires holding `W`.
- [ ] `spire` requires a dive, a zoom climb, and thrust together.
- [ ] Touching a shrine hides its marker and raises maximum breath.
- [ ] Reloading the page keeps collected shrines and the raised maximum.
- [ ] Falling into the void respawns at the last island.
- [ ] The console has no errors or warnings.

- [ ] **Step 5: Tune anything the checklist exposed**

All flight tuning lives in `DEFAULT_FLIGHT_CONFIG`. Adjust one constant at a time and re-run `npm test` — the flight tests encode the measured behaviour table, so a change that breaks the feel usually breaks a test first. If a test now contradicts a deliberate design change, update the test and say so in the commit message.

Common adjustments:

| Symptom | Constant to change |
| --- | --- |
| Sinks too fast while gliding | raise `liftCoeff`, or lower `dragCoeff` |
| Never slows down | raise `dragCoeff` or `inducedDragFactor` |
| Climbing feels free | lower `thrustAccel` or raise `breathDrainPerSecond` |
| Turning feels twitchy at speed | lower `turnRateSpeedRef` |
| Stalls constantly | lower `stallSpeed` |
| Cannot reach `spire` at all | raise `baseMaxBreath`, or move the island down in `archipelago.ts` |

- [ ] **Step 6: Record the outcome in `README.md`**

Add a short "Feel notes" section describing the final cruise speed, the glide ratio, and which islands need thrust. This gives the next change a baseline to compare against.

- [ ] **Step 7: Commit and deploy**

```bash
git add -A
git commit -m "Assemble the playable game and tune flight feel"
git push
gh run watch --exit-status
```

- [ ] **Step 8: Confirm the deployed build plays**

Open `https://danielnygaard00.github.io/airbender-skies/` and repeat a short version of the Step 4 checklist: deploy the kite, fly to one island, collect a shrine, reload, and confirm the shrine stayed collected.

---

## Plan Self-Review

**Spec coverage.** Every section of the design document maps to a task:

| Spec section | Task |
| --- | --- |
| Technology choices | 1 |
| Module layout, load-bearing interfaces | 1, and each module's own task |
| Flight model, derived angle of attack, zoom climb | 3, 4 |
| Camera-relative steering, airspeed-limited turn rate | 5 |
| Breath meter | 6 |
| Controls table | 7, and verified in 20 |
| Ground movement | 11 |
| Landscape, island generation, eight-island sequence | 8, 9, 10 |
| Exploration reward, air shrines, persistence | 18 |
| Presentation, camera profiles, wind, trails, FOV kick | 15, 19 |
| Art assets, placeholder fallback, `ASSETS.md` | 16 |
| Error handling table | asset failure in 16, level validation in 10 and 14, non-finite guard in 12, respawn in 12, WebGL fallback in 14 |
| Testing strategy | every task; rendering deliberately manual in 14 and 20 |
| Delivery, Pages deploy | 1, confirmed in 20 |
| Roadmap beyond v1 | not implemented by design; the ability registry seam is noted below |

**Deviations from the spec, and why:**

1. **The ability registry is not built.** The spec listed `abilities/registry.ts` with `thrust` as its only entry. Building a registry to hold one hard-wired ability would be indirection with no payoff — thrust lives in `flight.ts` as a boolean. The seam the registry was protecting is real and is preserved differently: `flightStep` takes a `FlightInput` struct, so adding abilities means extending that struct and the controller's construction of it, not restructuring movement. Add the registry in the first task of the attacks phase, when there is more than one ability to register.

2. **`BASE_FOV` lives in `src/fx/mapping.ts`, not the renderer.** Field of view is a speed effect and both modules need the constant. One definition, imported by the renderer.

3. **Wind audio is synthesised, not a file.** Filtered white noise through a `BiquadFilterNode` avoids shipping an audio asset and its licence question entirely.

4. **Level validation always throws.** The spec asked for skip-in-production. `buildWorld` throws and `main.ts` catches it into the visible fallback, which keeps validation simple and testable while still never blanking the screen. A half-built world silently missing an island is harder to diagnose than a clear message.

**Type consistency.** `InputState`, `PlayerState`, `TerrainQuery`, `TerrainHit`, `FlightConfig`, and `GroundConfig` are declared once in `src/core/types.ts` and imported everywhere. Task 1 creates that file precisely so no later task invents a competing shape. `FlightConfig` grows twice — Task 6 adds the four breath fields, Task 11 adds `GroundConfig` alongside it — and both are called out in the task that does it.

**Verification status.** Every code block and test in Tasks 1–13, 15, and 17–19, plus `buildWorld` from Task 14, was executed against the real toolchain before being written into this plan: **231 tests across 20 files pass, and `tsc --noEmit` is clean** on Node 26.5.0 with the exact pinned versions. The prototype used to establish this has been discarded, per TDD — implementers write the tests first and implement fresh. Not executed, because they need a browser: the `InputTracker` DOM adapter, `createRenderer`, `createHud`'s DOM half, `createWindAudio`, `avatar.ts`'s Three.js half, and `main.ts`. Each is deliberately thin, with its logic in a tested pure function, and each is covered by the Task 20 manual checklist.

---

## Execution Handoff

Two ways to run this plan:

1. **Subagent-driven (recommended)** — a fresh subagent per task with review between tasks. Best fit here: tasks are small, sharply bounded, and each ends with a green test run, so a reviewer can accept or reject one task without untangling its neighbours.
2. **Inline execution** — batch through tasks in one session with checkpoints.

Tasks 1–13 and 15–19 are pure logic with a hard pass/fail signal. Task 14 and Task 20 need a human at a browser, so expect to stop there regardless of which mode is used.

---

### Task 21: Waterfalls

Added after the plan was written, at the user's request. Water spilling off an island's rim and
dissolving into the void below is the signature image of a floating archipelago, and it costs
almost nothing because it needs no new assets and no gameplay changes.

**Runs after Task 20**, not inserted mid-plan: waterfalls are pure scenery with no effect on
flight, and by the end of Task 20 the renderer, fog, camera profiles and field-of-view kick are
all settled — so the look gets tuned once against the finished image rather than re-tuned when
Task 20 changes it.

**Scope boundary:** decorative only. Waterfalls have no collision, do not affect flight, do not
consume or restore breath, and are not collectible. The player flies straight through them.

**Files:**
- Create: `src/world/waterfall.ts`
- Modify: `src/world/level.ts` (add `WaterfallDef`, extend `Level`, validate)
- Modify: `src/world/levels/archipelago.ts` (add waterfall entries)
- Modify: `src/main.ts` (build the meshes, advance the scroll each frame)
- Test: `src/world/waterfall.test.ts`
- Modify: `src/world/level.test.ts` (validation cases for the new field)

**Interfaces:**
- Consumes: `IslandDef` (Task 8), `TerrainQuery` (Task 9), `Level` (Task 10), `seededNoise2D` (Task 2).
- Produces:
  - `interface WaterfallDef { islandId: string; angle: number; width: number; length: number }` — `angle` in radians around the island's rim, `length` in metres of visible fall before it fades out.
  - `waterfallAnchor(island: IslandDef, def: WaterfallDef, terrain: TerrainQuery): { position: Vector3; rotationY: number } | null` — where the curtain hangs and which way it faces. Returns `null` if the rim point has no ground, so a misplaced waterfall is dropped rather than left hanging in the air.
  - `advanceScroll(offset: number, dt: number, speed: number): number` — the scrolling texture offset, wrapped into `[0, 1)`.
  - `createWaterfallTexture(seed: number): CanvasTexture` — vertical streaks generated in code, seeded, so no image asset is needed and the result is reproducible.
  - `createWaterfall(island: IslandDef, def: WaterfallDef, terrain: TerrainQuery): { mesh: Mesh; advance(dt: number): void } | null`

**Why a scrolling curtain rather than particles:** a translucent quad with a vertically scrolling
texture is one draw call and needs no simulation, which suits scenery that may be visible from a
long way off. A GPU particle system would look better up close and cost far more for something the
player mostly sees from a distance. The texture is generated procedurally so nothing has to be
licensed, downloaded, or committed — consistent with the project's CC0-only asset rule.

- [ ] **Step 1: Write the failing tests**

`src/world/waterfall.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { waterfallAnchor, advanceScroll, type WaterfallDef } from './waterfall'
import { createIslandGeometry, type IslandDef } from './island'
import { createTerrainQuery, type IslandMesh } from './terrain-query'
import { ARCHIPELAGO } from './levels/archipelago'
import type { TerrainQuery } from '../core/types'

const island: IslandDef = {
  id: 'home', position: new Vector3(100, 20, -50), radius: 40, height: 30,
  biome: 'grass', noiseSeed: 1,
}
const def = (over: Partial<WaterfallDef> = {}): WaterfallDef => ({
  islandId: 'home', angle: 0, width: 8, length: 60, ...over,
})

const solid: TerrainQuery = {
  groundHeightAt: () => 25,
  raycastDown: (from) => ({
    point: new Vector3(from.x, 25, from.z), normal: new Vector3(0, 1, 0), islandId: 'home',
  }),
}
const empty: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }

describe('advanceScroll', () => {
  it('advances with time', () => {
    expect(advanceScroll(0, 1, 0.25)).toBeCloseTo(0.25, 6)
  })

  it('wraps back into the unit range instead of growing without bound', () => {
    expect(advanceScroll(0.9, 1, 0.25)).toBeCloseTo(0.15, 6)
  })

  it('stays within the unit range over a long run', () => {
    let offset = 0
    for (let i = 0; i < 10000; i++) offset = advanceScroll(offset, 1 / 60, 1.4)
    expect(offset).toBeGreaterThanOrEqual(0)
    expect(offset).toBeLessThan(1)
  })

  it('does not move when time does not pass', () => {
    expect(advanceScroll(0.4, 0, 1.4)).toBeCloseTo(0.4, 6)
  })
})

describe('waterfallAnchor', () => {
  it('places the curtain out at the island rim, not at its centre', () => {
    const anchor = waterfallAnchor(island, def(), solid)!
    const horizontal = Math.hypot(
      anchor.position.x - island.position.x, anchor.position.z - island.position.z,
    )
    expect(horizontal).toBeGreaterThan(island.radius * 0.7)
  })

  it('puts the curtain at the ground height it found', () => {
    expect(waterfallAnchor(island, def(), solid)!.position.y).toBeCloseTo(25, 5)
  })

  it('faces outward, so the angle follows the rim position', () => {
    const north = waterfallAnchor(island, def({ angle: 0 }), solid)!
    const east = waterfallAnchor(island, def({ angle: Math.PI / 2 }), solid)!
    expect(north.rotationY).not.toBeCloseTo(east.rotationY, 3)
  })

  it('moves around the rim as the angle changes', () => {
    const a = waterfallAnchor(island, def({ angle: 0 }), solid)!
    const b = waterfallAnchor(island, def({ angle: Math.PI }), solid)!
    expect(a.position.distanceTo(b.position)).toBeGreaterThan(island.radius)
  })

  it('returns null when the rim point has no ground beneath it', () => {
    expect(waterfallAnchor(island, def(), empty)).toBeNull()
  })

  it('does not mutate the island position it is given', () => {
    waterfallAnchor(island, def(), solid)
    expect(island.position.toArray()).toEqual([100, 20, -50])
  })

  it('is deterministic for the same inputs', () => {
    const a = waterfallAnchor(island, def(), solid)!
    const b = waterfallAnchor(island, def(), solid)!
    expect(a.position.toArray()).toEqual(b.position.toArray())
    expect(a.rotationY).toBeCloseTo(b.rotationY, 10)
  })
})

describe('waterfallAnchor rim retry', () => {
  // Ground only under the two innermost insets (0.76, 0.72 of the radius),
  // so the outermost probes must miss before this returns a hit.
  const outerMissesInnerHits: TerrainQuery = {
    groundHeightAt: (x, z) => {
      const reach = Math.hypot(x - island.position.x, z - island.position.z)
      return reach <= island.radius * 0.78 ? 25 : null
    },
    raycastDown: () => null,
  }

  it('steps inward and finds ground when the outermost rim point misses', () => {
    expect(waterfallAnchor(island, def(), outerMissesInnerHits)).not.toBeNull()
  })

  it('the retried point is still a plausible rim distance from the centre', () => {
    const anchor = waterfallAnchor(island, def(), outerMissesInnerHits)!
    const horizontal = Math.hypot(
      anchor.position.x - island.position.x, anchor.position.z - island.position.z,
    )
    expect(horizontal).toBeGreaterThan(island.radius * 0.7)
  })

  it('still returns null when there is no ground at any inset', () => {
    const noGroundAnywhere: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }
    expect(waterfallAnchor(island, def(), noGroundAnywhere)).toBeNull()
  })

  it('resolves a real island angle that the single fixed inset used to miss', () => {
    const home = ARCHIPELAGO.islands.find((i) => i.id === 'ring-east')!
    const waterfallDef = ARCHIPELAGO.waterfalls.find((w) => w.islandId === 'ring-east')!
    const mesh = new Mesh(createIslandGeometry(home), new MeshBasicMaterial())
    mesh.position.copy(home.position)
    mesh.updateMatrixWorld(true)
    const islandMesh: IslandMesh = { id: home.id, mesh }
    const terrain = createTerrainQuery([islandMesh])

    expect(waterfallAnchor(home, waterfallDef, terrain)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test -- src/world/waterfall.test.ts`
Expected: FAIL — cannot resolve module `./waterfall`.

- [ ] **Step 3: Write `src/world/waterfall.ts`**

```typescript
import {
  Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, RepeatWrapping,
  Vector3, DoubleSide, type Texture,
} from 'three'
import type { IslandDef } from './island'
import type { TerrainQuery } from '../core/types'
import { mulberry32 } from '../core/rng'

export interface WaterfallDef {
  islandId: string
  /** Radians around the island rim, measured from +X toward +Z. */
  angle: number
  width: number
  /** Metres of visible fall before it fades out. */
  length: number
}

/** Insets to try, outermost first. Noise displacement means the outermost rim
 *  point often has no ground under it, so stepping inward finds the real edge
 *  instead of silently dropping the waterfall. */
const RIM_INSETS = [0.88, 0.84, 0.8, 0.76, 0.72] as const
/** How far above the found ground the curtain starts, hiding the seam. */
const LIP_RAISE = 0.6
const TEXTURE_SIZE = 64
const SCROLL_SPEED = 1.4

/** Scrolling texture offset, wrapped so it never grows without bound. */
export function advanceScroll(offset: number, dt: number, speed: number): number {
  const next = (offset + dt * speed) % 1
  return next < 0 ? next + 1 : next
}

/**
 * Where the curtain hangs and which way it faces. Steps inward through
 * RIM_INSETS until it finds ground, so noise-displaced silhouettes that miss
 * the outermost probe still resolve to the real edge. Returns null only when
 * every inset comes up empty, so a genuinely misplaced waterfall is dropped
 * rather than left hanging in mid-air.
 */
export function waterfallAnchor(
  island: IslandDef, def: WaterfallDef, terrain: TerrainQuery,
): { position: Vector3; rotationY: number } | null {
  for (const inset of RIM_INSETS) {
    const reach = island.radius * inset
    const x = island.position.x + Math.cos(def.angle) * reach
    const z = island.position.z + Math.sin(def.angle) * reach

    const groundY = terrain.groundHeightAt(x, z)
    if (groundY === null) continue

    return {
      position: new Vector3(x, groundY, z),
      // Face outward, away from the island centre.
      rotationY: -def.angle + Math.PI / 2,
    }
  }
  return null
}

/**
 * Vertical streaks generated in code rather than loaded, so the effect needs no
 * asset and no licence. Seeded, so it is reproducible.
 */
export function createWaterfallTexture(seed: number): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_SIZE
  canvas.height = TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D context for the waterfall texture')

  const random = mulberry32(seed)
  ctx.fillStyle = 'rgba(226, 244, 255, 0.30)'
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE)

  for (let i = 0; i < 26; i++) {
    const x = Math.floor(random() * TEXTURE_SIZE)
    const height = TEXTURE_SIZE * (0.3 + random() * 0.7)
    const y = random() * TEXTURE_SIZE
    ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + random() * 0.5})`
    ctx.fillRect(x, y, 1 + Math.floor(random() * 2), height)
  }

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  return texture
}

/** A curtain of falling water, or null if it has nowhere to hang. */
export function createWaterfall(
  island: IslandDef, def: WaterfallDef, terrain: TerrainQuery,
): { mesh: Mesh; advance(dt: number): void } | null {
  const anchor = waterfallAnchor(island, def, terrain)
  if (!anchor) return null

  const geometry = new PlaneGeometry(def.width, def.length)
  const texture: Texture = createWaterfallTexture(island.noiseSeed)
  // Repeat vertically so the streaks tile as the offset scrolls.
  texture.repeat.set(1, Math.max(1, Math.round(def.length / def.width)))

  const material = new MeshBasicMaterial({
    map: texture, transparent: true, opacity: 0.55,
    side: DoubleSide, depthWrite: false,
  })

  const mesh = new Mesh(geometry, material)
  // The plane's origin is its centre, so drop it half its length to hang from the lip,
  // raised by LIP_RAISE above the found ground so the mesh overlaps the rock and hides the seam.
  mesh.position.set(
    anchor.position.x,
    anchor.position.y + LIP_RAISE - def.length / 2,
    anchor.position.z,
  )
  mesh.rotation.y = anchor.rotationY

  let offset = 0
  return {
    mesh,
    advance(dt: number): void {
      offset = advanceScroll(offset, dt, SCROLL_SPEED)
      texture.offset.y = -offset
    },
  }
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test -- src/world/waterfall.test.ts`
Expected: PASS, 15 tests. Note `createWaterfallTexture` and `createWaterfall` touch `document`
and are therefore not covered by these tests — the same deliberate split used for the input
adapter in Task 7. They are verified by eye in Step 8.

- [ ] **Step 5: Extend the level format**

In `src/world/level.ts`, add the import and the field:

```typescript
import type { WaterfallDef } from './waterfall'
```

Add to `Level`:

```typescript
  waterfalls: WaterfallDef[]
```

And inside `validateLevel`, after the shrine reference check, add:

```typescript
  for (const waterfall of level.waterfalls) {
    if (!ids.has(waterfall.islandId)) {
      throw new Error(
        `Level "${level.id}" waterfall references unknown island "${waterfall.islandId}"`,
      )
    }
    if (!(waterfall.width > 0)) {
      throw new Error(`Waterfall on "${waterfall.islandId}" must have width > 0`)
    }
    if (!(waterfall.length > 0)) {
      throw new Error(`Waterfall on "${waterfall.islandId}" must have length > 0`)
    }
  }
```

- [ ] **Step 6: Add the validation tests**

Append to `src/world/level.test.ts`. Note the existing `base()` helper needs `waterfalls: []`
added to it, and the `ARCHIPELAGO` block gains one case:

```typescript
describe('waterfall validation', () => {
  it('rejects a waterfall on an unknown island', () => {
    expect(() => validateLevel({
      ...base(), waterfalls: [{ islandId: 'ghost', angle: 0, width: 8, length: 60 }],
    })).toThrow(/waterfall references unknown island "ghost"/)
  })

  it('rejects a non-positive width', () => {
    expect(() => validateLevel({
      ...base(), waterfalls: [{ islandId: 'a', angle: 0, width: 0, length: 60 }],
    })).toThrow(/width > 0/)
  })

  it('rejects a non-positive length', () => {
    expect(() => validateLevel({
      ...base(), waterfalls: [{ islandId: 'a', angle: 0, width: 8, length: -1 }],
    })).toThrow(/length > 0/)
  })

  it('accepts a level with no waterfalls at all', () => {
    expect(() => validateLevel({ ...base(), waterfalls: [] })).not.toThrow()
  })

  it('ARCHIPELAGO waterfalls all reference real islands', () => {
    const ids = new Set(ARCHIPELAGO.islands.map((i) => i.id))
    for (const w of ARCHIPELAGO.waterfalls) expect(ids.has(w.islandId)).toBe(true)
  })
})
```

- [ ] **Step 7: Add waterfalls to the archipelago**

In `src/world/levels/archipelago.ts`, add the field to `ARCHIPELAGO`. Placed on the larger,
wetter islands only — the bare `rock` islands and the `temple` spire stay dry, which makes the
biomes read as different places rather than decorated copies:

```typescript
  waterfalls: [
    { islandId: 'home', angle: 2.1, width: 10, length: 90 },
    { islandId: 'home', angle: 4.4, width: 6, length: 70 },
    { islandId: 'ring-east', angle: 0.7, width: 8, length: 80 },
    { islandId: 'ring-south', angle: 3.5, width: 7, length: 75 },
    { islandId: 'ring-west', angle: 5.2, width: 9, length: 85 },
    { islandId: 'rest', angle: 1.2, width: 5, length: 55 },
  ],
```

- [ ] **Step 8: Wire them into `src/main.ts` and verify by eye**

Add the import, build the waterfalls alongside the shrines, and advance them in `update`:

```typescript
import { createWaterfall } from './world/waterfall'

// ...after the shrine markers are built:
const waterfalls: { advance(dt: number): void }[] = []
for (const def of ARCHIPELAGO.waterfalls) {
  const island = ARCHIPELAGO.islands.find((i) => i.id === def.islandId)
  if (!island) continue
  const waterfall = createWaterfall(island, def, world.terrain)
  if (!waterfall) {
    console.warn(
      `Dropped waterfall on island "${def.islandId}" at angle ${def.angle}: no ground found ` +
      'at any rim inset.',
    )
    continue
  }
  scene.add(waterfall.mesh)
  waterfalls.push(waterfall)
}

// ...inside update(dt), near the shrine marker rotation:
for (const waterfall of waterfalls) waterfall.advance(dt)
```

Then run `npm run dev` and confirm:

- [ ] Water curtains hang from the rim of `home`, the three `ring-*` islands, and `rest`.
- [ ] The `climb-*` islands and `spire` have none.
- [ ] The texture scrolls downward, and the speed reads as falling water rather than sliding wallpaper.
- [ ] Each curtain meets the rock at its top with no visible gap.
- [ ] Curtains are visible from a distance and fade into the fog with everything else.
- [ ] Flying straight through a waterfall passes through it with no collision and no stutter.
- [ ] Frame rate is unchanged — six extra transparent draw calls should not register.
- [ ] The console is free of errors.

- [ ] **Step 9: Run the whole suite, typecheck, build, and commit**

Run: `npm test && npm run typecheck && npm run build`

```bash
git add -A
git commit -m "Add scrolling waterfalls to the island scenery"
git push
```

