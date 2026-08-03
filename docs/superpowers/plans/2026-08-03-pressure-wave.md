# Pressure Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pressure Wave — a ground slam out of a committed dive whose strength scales with the impact, granting Focus and bouncing the player back into the air.

**Architecture:** One pure combat module for the blast geometry, one pure player module that detects the slam by comparing the player either side of `controllerStep` (so no movement code changes at all), one small effect module for the visible ring, and additive fields on the Focus and encounter structs. Everything except the ring is a pure function over plain data.

**Tech Stack:** TypeScript 7, three.js 0.185.1, Vitest 4 in the `node` environment, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-03-pressure-wave-design.md`

## Global Constraints

- **Branch:** all work lands on `pressure-wave`. Do not commit to `main` — pushing `main` triggers the GitHub Pages deploy.
- **Typecheck is two passes:** `npm run typecheck` runs `tsconfig.json` then `tsconfig.test.json`. Both must be clean. `noUncheckedIndexedAccess` is on, so indexed access is `T | undefined` and must be narrowed.
- **New logic modules stay pure.** No DOM, no scene objects, no `Math.random`, no `Date.now`. `MathUtils` and `Vector3` are fine. `src/fx/shockwave.ts` is the one exception: it builds a mesh, and it is tested through its object rather than by rendering.
- **Do not modify `src/player/controller.ts`, `ground-move.ts`, or `flight.ts`.** Slam detection deliberately works from outside movement. If you find yourself wanting to change movement, stop and re-read §2 of the spec.
- **Test discipline.** `docs/HANDOFF.md` records four failure modes that each produced a green suite proving nothing: asserting against the same config the code reads, tautologies, bare `>` where a margin is meant, and assertions that hold either way. **After writing each test, neutralise the relevant config value or branch and confirm the test goes red.** If it stays green, the test is decorative and must be rewritten.
- **Comment style:** explain *why*, not what. Mark regression guards as such. Match the surrounding file's density.
- **Commit messages in normal prose**, imperative mood, ending with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

**One refinement to the spec, already decided:** the spec's config lists a single
`knockback` ("at full strength"), which would give a minimum-strength slam *zero*
knockback while still dealing 0.6 damage — a slam that hurts but does not move anyone,
which contradicts the whole crowd-control identity. Use `minKnockback` and `maxKnockback`
instead, mirroring how radius and damage are already a min/max pair. Values: 12 and 30.

---

### Task 1: The blast

**Files:**
- Create: `src/combat/pressure-wave.ts`
- Modify: `src/combat/config.ts` — add the `pressureWave` block to `DEFAULT_COMBAT_CONFIG`
- Modify: `src/combat/encounter.ts` — add `pressureWave` to `CombatConfig`
- Test: `src/combat/pressure-wave.test.ts`

**Interfaces:**
- Consumes: `horizontalDistance` and `Enemy` from `src/combat/enemy.ts`, both of which already exist.
- Produces:
  - `interface PressureWaveConfig { minImpactSpeed, fullImpactSpeed, minRadius, maxRadius, minDamage, maxDamage, minKnockback, maxKnockback, bounceFactor, focusAtFullImpact }` — all `number`
  - `slamStrength(impactSpeed: number, c: PressureWaveConfig): number`
  - `waveRadius(strength: number, c: PressureWaveConfig): number`
  - `waveDamage(strength: number, c: PressureWaveConfig): number`
  - `waveTargets(origin: Vector3, enemies: readonly Enemy[], strength: number, c: PressureWaveConfig): Enemy[]`
  - `waveImpulse(origin: Vector3, target: Vector3, strength: number, c: PressureWaveConfig): Vector3`
  - `CombatConfig` gains `pressureWave: PressureWaveConfig`

- [ ] **Step 1: Write the failing test**

Create `src/combat/pressure-wave.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  slamStrength, waveRadius, waveDamage, waveTargets, waveImpulse,
  type PressureWaveConfig,
} from './pressure-wave'
import { DEFAULT_COMBAT_CONFIG } from './config'
import { spawnEnemy, type Enemy } from './enemy'

/** Round numbers, so every expectation below is a hand-computed literal. */
const C: PressureWaveConfig = {
  minImpactSpeed: 10,
  fullImpactSpeed: 50,
  minRadius: 4,
  maxRadius: 12,
  minDamage: 0.5,
  maxDamage: 2.5,
  minKnockback: 10,
  maxKnockback: 30,
  bounceFactor: 0.5,
  focusAtFullImpact: 20,
}

const ORIGIN = new Vector3(0, 0, 0)
const at = (x: number, z: number): Enemy =>
  spawnEnemy(`${x}:${z}`, new Vector3(x, 0, z), DEFAULT_COMBAT_CONFIG.enemy)

describe('slamStrength', () => {
  it('is zero at the minimum impact and one at full', () => {
    expect(slamStrength(10, C)).toBeCloseTo(0)
    expect(slamStrength(50, C)).toBeCloseTo(1)
  })

  it('is halfway at halfway', () => {
    // 10 -> 50, so 30 is the midpoint.
    expect(slamStrength(30, C)).toBeCloseTo(0.5)
  })

  it('clamps beyond both ends', () => {
    expect(slamStrength(2, C)).toBe(0)
    expect(slamStrength(400, C)).toBe(1)
  })
})

describe('waveRadius', () => {
  it('interpolates between the minimum and maximum radius', () => {
    expect(waveRadius(0, C)).toBeCloseTo(4)
    expect(waveRadius(0.5, C)).toBeCloseTo(8)
    expect(waveRadius(1, C)).toBeCloseTo(12)
  })
})

describe('waveDamage', () => {
  it('interpolates between the minimum and maximum damage', () => {
    expect(waveDamage(0, C)).toBeCloseTo(0.5)
    expect(waveDamage(0.5, C)).toBeCloseTo(1.5)
    expect(waveDamage(1, C)).toBeCloseTo(2.5)
  })

  it('downs a spear soldier outright at full impact but not at minimum', () => {
    // The claim, stated against the enemy's health rather than against the damage
    // numbers the code reads. This threshold is the whole payoff of the move.
    const wave = DEFAULT_COMBAT_CONFIG.pressureWave
    const health = DEFAULT_COMBAT_CONFIG.enemy.maxHealth
    expect(waveDamage(1, wave)).toBeGreaterThanOrEqual(health)
    expect(waveDamage(0, wave)).toBeLessThan(health)
  })
})

describe('waveTargets', () => {
  it('catches an enemy inside the radius', () => {
    expect(waveTargets(ORIGIN, [at(0, 6)], 1, C).map((e) => e.id)).toEqual(['0:6'])
  })

  it('misses an enemy beyond the radius', () => {
    expect(waveTargets(ORIGIN, [at(0, 20)], 1, C)).toEqual([])
  })

  it('reaches further at full strength than at minimum', () => {
    // An enemy at 6 is inside the full radius of 12 and outside the minimum of 4.
    expect(waveTargets(ORIGIN, [at(0, 6)], 0, C)).toEqual([])
    expect(waveTargets(ORIGIN, [at(0, 6)], 1, C).length).toBe(1)
  })

  it('ignores facing entirely', () => {
    // Regression guard: a slam is radial. Anyone reusing the gust's cone test would
    // silently drop everyone standing behind the player.
    const ids = waveTargets(ORIGIN, [at(0, 6), at(0, -6), at(6, 0), at(-6, 0)], 1, C)
      .map((e) => e.id)
    expect(ids.length).toBe(4)
  })

  it('ignores height, so an enemy on a ledge overhead is not caught by luck', () => {
    const overhead = spawnEnemy('up', new Vector3(0, 40, 0), DEFAULT_COMBAT_CONFIG.enemy)
    // Horizontal distance is zero, so it IS caught — pinning that this is the chosen
    // behaviour rather than an accident, matching how the gust measures reach.
    expect(waveTargets(ORIGIN, [overhead], 1, C).length).toBe(1)
  })
})

describe('waveImpulse', () => {
  it('pushes outward from the slam', () => {
    const push = waveImpulse(ORIGIN, new Vector3(0, 0, 5), 1, C)
    expect(push.z).toBeGreaterThan(0)
    expect(push.x).toBeCloseTo(0)
  })

  it('lifts as well as pushes, so bodies can go off a ledge', () => {
    expect(waveImpulse(ORIGIN, new Vector3(0, 0, 5), 1, C).y).toBeGreaterThan(0)
  })

  it('pushes materially harder at full strength than at minimum', () => {
    const weak = waveImpulse(ORIGIN, new Vector3(0, 0, 5), 0, C).length()
    const full = waveImpulse(ORIGIN, new Vector3(0, 0, 5), 1, C).length()
    // A margin, not a bare comparison: 10 -> 30 is three times the push.
    expect(full).toBeGreaterThan(weak * 2.5)
  })

  it('still moves someone at minimum strength', () => {
    // A slam that damages without displacing would contradict the crowd-control
    // identity, and is what a single full-strength-only knockback value would give.
    expect(waveImpulse(ORIGIN, new Vector3(0, 0, 5), 0, C).length()).toBeGreaterThan(5)
  })

  it('has a defined direction for a target standing exactly on the origin', () => {
    const push = waveImpulse(ORIGIN, ORIGIN.clone(), 1, C)
    expect(Number.isFinite(push.x)).toBe(true)
    expect(Number.isFinite(push.z)).toBe(true)
    expect(push.length()).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/pressure-wave.test.ts`
Expected: FAIL — cannot resolve `./pressure-wave`.

- [ ] **Step 3: Write minimal implementation**

Create `src/combat/pressure-wave.ts`:

```ts
import { MathUtils, Vector3 } from 'three'
import { horizontalDistance, type Enemy } from './enemy'

/**
 * Pressure Wave: a ground slam out of a fall, scaled by the impact.
 *
 * The design document calls this a direct payoff for the traversal layer, and that is
 * the whole shape of it — height earned in the flight model turns into combat value.
 * It is the one move in the kit with real damage, and the only one with no facing: a
 * slam goes out in every direction, so there is no cone test here.
 *
 * Whether a slam happened at all is not this module's business. That is decided in
 * `src/player/slam.ts`, which is why a strength of 0 here means a legitimate minimum
 * slam rather than the absence of one.
 */
export interface PressureWaveConfig {
  /** Downward speed at impact below which a landing is just a landing. */
  minImpactSpeed: number
  /** Downward speed at which the slam is at full strength. */
  fullImpactSpeed: number
  minRadius: number
  maxRadius: number
  minDamage: number
  maxDamage: number
  minKnockback: number
  maxKnockback: number
  /** Upward bounce as a fraction of the impact speed. */
  bounceFactor: number
  /** Focus granted by a full-strength slam. */
  focusAtFullImpact: number
}

/** 0 at the minimum impact, 1 at full. Clamped at both ends. */
export function slamStrength(impactSpeed: number, c: PressureWaveConfig): number {
  const span = c.fullImpactSpeed - c.minImpactSpeed
  // A degenerate span would divide by zero; treat the threshold as a step instead.
  if (!(span > 0)) return impactSpeed >= c.minImpactSpeed ? 1 : 0
  return MathUtils.clamp((impactSpeed - c.minImpactSpeed) / span, 0, 1)
}

export function waveRadius(strength: number, c: PressureWaveConfig): number {
  return MathUtils.lerp(c.minRadius, c.maxRadius, MathUtils.clamp(strength, 0, 1))
}

export function waveDamage(strength: number, c: PressureWaveConfig): number {
  return MathUtils.lerp(c.minDamage, c.maxDamage, MathUtils.clamp(strength, 0, 1))
}

/**
 * Everyone caught in one slam. Named so callers cannot forget the radius test.
 *
 * Horizontal distance only, matching how the gust measures its reach: the fight is a
 * ground fight, and an enemy is where they stand rather than where their head is.
 */
export function waveTargets(
  origin: Vector3,
  enemies: readonly Enemy[],
  strength: number,
  c: PressureWaveConfig,
): Enemy[] {
  const radius = waveRadius(strength, c)
  return enemies.filter((enemy) => horizontalDistance(origin, enemy.position) <= radius)
}

/**
 * The push a slam puts on a target: outward and up.
 *
 * Lifts harder than a gust does, because the air here is going up past the player
 * rather than out from their hands — and the lift is what lets a slam clear a ledge.
 */
export function waveImpulse(
  origin: Vector3,
  target: Vector3,
  strength: number,
  c: PressureWaveConfig,
): Vector3 {
  const away = new Vector3(target.x - origin.x, 0, target.z - origin.z)
  const direction = away.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : away.normalize()
  const push = MathUtils.lerp(c.minKnockback, c.maxKnockback, MathUtils.clamp(strength, 0, 1))
  return direction.multiplyScalar(push).setY(push * 0.4)
}
```

In `src/combat/encounter.ts`, extend `CombatConfig` (import the type at the top):

```ts
import { gustImpulse, gustTargets, type GustConfig } from './gust'
import type { PressureWaveConfig } from './pressure-wave'
```

```ts
export interface CombatConfig {
  player: HealthConfig
  enemy: EnemyConfig
  gust: GustConfig
  pressureWave: PressureWaveConfig
}
```

In `src/combat/config.ts`, add the block to `DEFAULT_COMBAT_CONFIG` after `gust`:

```ts
  /**
   * Pressure Wave.
   *
   * The floor sits above a normal jump's landing speed (about 9 m/s from jumpSpeed 9)
   * so that hopping is not an attack. A charged jump at 20 m/s does clear it, at
   * strength 0.24 — deliberate: charge, hop, slam is a legitimate small ground combo.
   * Full strength needs a real tucked dive.
   *
   * The damage ceiling of 2.2 is past a soldier's 1.5 health, so a committed dive
   * downs one outright. That cliff lands around 33 m/s of descent and is the whole
   * feel of the move.
   *
   * Every value here is an argued guess. None of it has been played.
   */
  pressureWave: {
    minImpactSpeed: 12,
    fullImpactSpeed: 45,
    minRadius: 4,
    // Close to the gust's 12 range, so a full slam is a crowd move.
    maxRadius: 11,
    minDamage: 0.6,
    maxDamage: 2.2,
    minKnockback: 12,
    // Above the gust's 26, and radial, so it clears space in every direction.
    maxKnockback: 30,
    // A 45 m/s dive returns about 20 m/s, roughly 10 m of climb: enough to re-deploy.
    bounceFactor: 0.45,
    // A shade more than a down, because the slam is harder to execute.
    focusAtFullImpact: 18,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/combat/pressure-wave.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. In `waveTargets`, replace the radius test with the gust's cone test (`inGust(origin, new Vector3(0,0,1), enemy.position, ...)`-style directional dot product). Expected: the "ignores facing entirely" test FAILS. Revert.
2. In `slamStrength`, drop the `MathUtils.clamp`. Expected: the "clamps beyond both ends" test FAILS. Revert.
3. In `waveImpulse`, replace the lerp with `c.maxKnockback * strength`. Expected: the "still moves someone at minimum strength" test FAILS with a zero-length push. Revert.
4. In `src/combat/config.ts` set `maxDamage: 1.2`. Expected: the one-hit-down test FAILS. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: the typecheck FAILS on `src/combat/encounter.test.ts`, whose local `CombatConfig` fixture now lacks the required `pressureWave`. Add this to that fixture's `C` object so the fight tests stay independent of shipped tuning:

```ts
  pressureWave: {
    minImpactSpeed: 10, fullImpactSpeed: 50, minRadius: 4, maxRadius: 12,
    minDamage: 0.5, maxDamage: 2.5, minKnockback: 10, maxKnockback: 30,
    bounceFactor: 0.5, focusAtFullImpact: 20,
  },
```

`maxDamage` 2.5 deliberately exceeds that fixture's `enemy.maxHealth` of 1.5, and `minDamage` 0.5 deliberately does not — Task 4 depends on both. Re-run until clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/combat/pressure-wave.ts src/combat/pressure-wave.test.ts src/combat/config.ts src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "Add the Pressure Wave blast, radial and scaled by impact

The design document's direct payoff for the traversal layer: height earned in the
flight model becomes combat value. Damage at full impact is past a spear
soldier's health, so a committed dive downs one outright, which is the point of
the move.

Radial with no facing test at all, unlike the gust. Knockback is a min/max pair
rather than a single full-strength value, because interpolating from zero would
give a minimum slam damage without displacement, and displacement is the identity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Detection and the bounce

**Files:**
- Create: `src/player/slam.ts`
- Test: `src/player/slam.test.ts`

**Interfaces:**
- Consumes: `slamStrength` and `PressureWaveConfig` from `src/combat/pressure-wave.ts` (Task 1); `PlayerState` from `src/core/types.ts`.
- Produces:
  - `interface Slam { impactSpeed: number; strength: number }`
  - `detectSlam(before: PlayerState, after: PlayerState, tuckHeld: boolean, respawned: boolean, c: PressureWaveConfig): Slam | null`
  - `applyBounce(player: PlayerState, slam: Slam, c: PressureWaveConfig): PlayerState`

- [ ] **Step 1: Write the failing test**

Create `src/player/slam.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { detectSlam, applyBounce } from './slam'
import type { PressureWaveConfig } from '../combat/pressure-wave'
import type { PlayerState } from '../core/types'

const C: PressureWaveConfig = {
  minImpactSpeed: 10,
  fullImpactSpeed: 50,
  minRadius: 4,
  maxRadius: 12,
  minDamage: 0.5,
  maxDamage: 2.5,
  minKnockback: 10,
  maxKnockback: 30,
  bounceFactor: 0.5,
  focusAtFullImpact: 20,
}

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: false, lastGroundIslandId: null, airJumpsUsed: 1, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, ...over,
})

/** Falling at `speed`, then landed: velocity.y is zeroed by the landing. */
const falling = (speed: number) => p({ grounded: false, velocity: new Vector3(3, -speed, 0) })
const landed = () => p({ grounded: true, velocity: new Vector3(3, 0, 0) })

describe('detectSlam', () => {
  it('reports a slam for a committed landing above the floor', () => {
    const slam = detectSlam(falling(30), landed(), true, false, C)
    expect(slam).not.toBeNull()
    expect(slam?.impactSpeed).toBeCloseTo(30)
    expect(slam?.strength).toBeCloseTo(0.5)
  })

  it('reads the impact from the frame before the landing', () => {
    // The landing zeroes velocity.y, so reading `after` would make every slam a
    // zero-speed slam. This is the regression guard for that.
    const slam = detectSlam(falling(40), landed(), true, false, C)
    expect(slam?.impactSpeed).toBeCloseTo(40)
  })

  it('reports nothing without the commit key', () => {
    expect(detectSlam(falling(40), landed(), false, false, C)).toBeNull()
  })

  it('reports nothing for a landing softer than the floor', () => {
    // A normal jump lands at about 9 m/s. Hopping must not be an attack.
    expect(detectSlam(falling(9), landed(), true, false, C)).toBeNull()
  })

  it('reports nothing after a respawn, however fast the fall was', () => {
    // Regression guard for the death plunge: respawning also sets grounded true, and
    // the fall speed is enormous, so without this a death would be the biggest slam
    // in the game.
    expect(detectSlam(falling(400), landed(), true, true, C)).toBeNull()
  })

  it('reports nothing while staying airborne', () => {
    expect(detectSlam(falling(40), falling(45), true, false, C)).toBeNull()
  })

  it('reports nothing while staying grounded', () => {
    // Walking around with Ctrl held must not slam every frame.
    expect(detectSlam(landed(), landed(), true, false, C)).toBeNull()
  })

  it('reports nothing for a rising player, even with the key held', () => {
    const rising = p({ grounded: false, velocity: new Vector3(0, 25, 0) })
    expect(detectSlam(rising, landed(), true, false, C)).toBeNull()
  })

  it('caps strength at one for an enormous impact', () => {
    expect(detectSlam(falling(300), landed(), true, false, C)?.strength).toBe(1)
  })
})

describe('applyBounce', () => {
  it('throws the player back up in proportion to the impact', () => {
    const bounced = applyBounce(landed(), { impactSpeed: 40, strength: 0.75 }, C)
    // bounceFactor 0.5 of a 40 m/s impact.
    expect(bounced.velocity.y).toBeCloseTo(20)
  })

  it('leaves the ground, so the bounce is not swallowed by the ground snap', () => {
    expect(applyBounce(landed(), { impactSpeed: 40, strength: 0.75 }, C).grounded).toBe(false)
  })

  it('refreshes the air jump, which is what makes the re-deploy reachable', () => {
    const before = p({ grounded: true, airJumpsUsed: 1 })
    expect(applyBounce(before, { impactSpeed: 40, strength: 0.75 }, C).airJumpsUsed).toBe(0)
  })

  it('keeps the horizontal momentum', () => {
    // The doc is explicit that landing never hard-stops the player.
    const bounced = applyBounce(landed(), { impactSpeed: 40, strength: 0.75 }, C)
    expect(bounced.velocity.x).toBeCloseTo(3)
  })

  it('does not alias the velocity it was handed', () => {
    const before = landed()
    applyBounce(before, { impactSpeed: 40, strength: 0.75 }, C)
    expect(before.velocity.y).toBeCloseTo(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/player/slam.test.ts`
Expected: FAIL — cannot resolve `./slam`.

- [ ] **Step 3: Write minimal implementation**

Create `src/player/slam.ts`:

```ts
import { Vector3 } from 'three'
import type { PlayerState } from '../core/types'
import { slamStrength, type PressureWaveConfig } from '../combat/pressure-wave'

/**
 * Detecting a Pressure Wave without touching the movement code.
 *
 * A slam is a thing that can be *observed* about a frame — the player was in the air,
 * now they are on the ground, and they were holding the commit key — so it is read by
 * comparing the player either side of `controllerStep` rather than by teaching movement
 * about combat. `src/combat/encounter.ts` is explicit that a fight is something
 * happening in the world rather than a property of the character's kinematics, and this
 * keeps that boundary intact.
 */
export interface Slam {
  /** Downward speed at the moment of contact, m/s. */
  impactSpeed: number
  /** 0 to 1. */
  strength: number
}

export function detectSlam(
  before: PlayerState,
  after: PlayerState,
  tuckHeld: boolean,
  respawned: boolean,
  c: PressureWaveConfig,
): Slam | null {
  // A respawn also lands the player, and it lands them from an arbitrarily fast fall.
  // Without this guard, dying is the hardest slam in the game.
  if (respawned) return null
  if (!tuckHeld) return null
  // Contact has to have happened on this frame, or walking around with the key held
  // would slam continuously.
  if (before.grounded || !after.grounded) return null

  // Read from `before`: landing zeroes the vertical velocity, so `after` no longer
  // knows how hard the contact was.
  const impactSpeed = -before.velocity.y
  if (impactSpeed < c.minImpactSpeed) return null

  return { impactSpeed, strength: slamStrength(impactSpeed, c) }
}

/**
 * The bounce out of a slam, which is what makes §4.3's dive → wave → re-deploy possible.
 *
 * Clearing `grounded` while the player is standing on the surface is safe: `groundStep`
 * snaps only a player who was already grounded or who is descending onto the surface,
 * and a bouncing player is neither.
 */
export function applyBounce(
  player: PlayerState,
  slam: Slam,
  c: PressureWaveConfig,
): PlayerState {
  return {
    ...player,
    velocity: new Vector3(
      player.velocity.x,
      slam.impactSpeed * c.bounceFactor,
      player.velocity.z,
    ),
    grounded: false,
    airJumpsUsed: 0,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/player/slam.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

One at a time, reverting after each:

1. Delete the `if (respawned) return null` guard. Expected: the death-plunge test FAILS. Revert.
2. Change `impactSpeed` to read `-after.velocity.y`. Expected: the "reads the impact from the frame before" and the main detection test FAIL. Revert.
3. Delete `if (before.grounded || !after.grounded) return null`. Expected: the staying-grounded and staying-airborne tests FAIL. Revert.
4. In `applyBounce`, drop `grounded: false`. Expected: the leaves-the-ground test FAILS. Revert.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/player/slam.ts src/player/slam.test.ts
git commit -m "Detect a Pressure Wave by comparing the player across a frame

A slam is observable about a frame rather than something movement needs to know
about: airborne, then grounded, with the commit key held. So no movement code
changes, and the boundary encounter.ts asks for stays intact.

Two details are load-bearing. The impact speed is read from before the step,
because landing zeroes the vertical velocity. And a respawn is excluded
explicitly, because it also lands the player, from an arbitrarily fast fall —
without that guard, dying would be the hardest slam in the game.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Focus pays for a slam

**Files:**
- Modify: `src/focus/focus.ts` — `FocusEvents`, `noFocusEvents`, `stepFocus`
- Modify: `src/focus/config.ts` — add `slamGainAtFullImpact`
- Test: `src/focus/focus.test.ts` — additions

**Interfaces:**
- Consumes: nothing from earlier tasks — the strength arrives as a plain number, so `src/focus/` gains no dependency on `src/combat/`.
- Produces: `FocusEvents` gains `slamStrength: number`; `FocusConfig` gains `slamGainAtFullImpact: number`.

- [ ] **Step 1: Write the failing test**

In `src/focus/focus.test.ts`, add `slamGainAtFullImpact: 20` to the `C` fixture, then add this block at the end:

```ts
describe('stepFocus slams', () => {
  it('pays for a full-strength slam', () => {
    const next = stepFocus(focusAt(0), input({ events: { slamStrength: 1 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(20)
  })

  it('pays in proportion to the impact', () => {
    const next = stepFocus(focusAt(0), input({ events: { slamStrength: 0.25 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(5)
  })

  it('pays nothing when there was no slam', () => {
    const next = stepFocus(focusAt(0), input({ events: { slamStrength: 0 } }), 1 / 60, C)
    expect(next.value).toBeCloseTo(0)
  })

  it('pays more for a slam landed during a long clean run', () => {
    const cold = stepFocus(focusAt(0, 0), input({ events: { slamStrength: 1 } }), 1 / 60, C)
    const hot = stepFocus(focusAt(0, 30), input({ events: { slamStrength: 1 } }), 1 / 60, C)
    // The ramp is worth exactly 2x with this fixture.
    expect(cold.value).toBeCloseTo(20)
    expect(hot.value).toBeCloseTo(40)
  })

  it('pays nothing for a slam on a frame that also broke the chain', () => {
    // Not zero Focus overall — the drain applies — but the slam's own grant is
    // unramped, exactly like a down on a broken frame.
    const next = stepFocus(
      focusAt(80, 30),
      input({ events: { slamStrength: 1, playerHit: true } }),
      1 / 60,
      C,
    )
    // 80 - 30 damage + 20 unramped slam.
    expect(next.value).toBeCloseTo(70)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/focus/focus.test.ts`
Expected: FAIL — `slamStrength` is not a property of `FocusEvents`, and the slam tests report 0.

- [ ] **Step 3: Write minimal implementation**

In `src/focus/focus.ts`, add to `FocusEvents`:

```ts
  /** Enemies downed. */
  downs: number
  /** Strength of a Pressure Wave landed this frame, 0 to 1. Zero when there was none. */
  slamStrength: number
```

Add to `noFocusEvents`:

```ts
export function noFocusEvents(): FocusEvents {
  return { gustConnects: 0, downs: 0, slamStrength: 0, playerHit: false, fellOutOfWorld: false }
}
```

Add to `FocusConfig`:

```ts
  /** Focus for a full-strength Pressure Wave. */
  slamGainAtFullImpact: number
```

And extend the event-gain line in `stepFocus`:

```ts
  value += (events.gustConnects * c.gustConnectGain
    + events.downs * c.downGain
    + events.slamStrength * c.slamGainAtFullImpact) * ramp
```

In `src/focus/config.ts`, add to `DEFAULT_FOCUS_CONFIG`:

```ts
  downGain: 14,
  // A shade more than a down: a slam is harder to execute, and rewarding it is how
  // the traversal layer feeds the meter.
  slamGainAtFullImpact: 18,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/focus/focus.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

1. Remove the `events.slamStrength * c.slamGainAtFullImpact` term. Expected: all four paying tests FAIL. Revert.
2. Move the slam term outside the `* ramp` multiplication. Expected: the "pays more during a long clean run" test FAILS. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean and green. `src/focus/sources.test.ts` and `effects.test.ts` build their own `FocusConfig` fixtures — add `slamGainAtFullImpact` where the typecheck reports it missing.

- [ ] **Step 7: Commit**

```bash
git add src/focus src/focus/config.ts
git commit -m "Pay Focus for a landed Pressure Wave

The design document has Focus spend on elemental heavy moves and lists Pressure
Wave as airbending that is always available, so the slam grants Focus rather than
costing it. Traversal feeding the meter connects the two systems the other way
round, and it means the flagship dive combo builds toward the Avatar State.

Scaled by the chain ramp with the other event gains, so a slam landed mid-run is
worth more than a slam landed cold.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The fight resolves the wave

**Files:**
- Modify: `src/combat/encounter.ts` — `EncounterInput`, `EncounterStep`, `stepEncounter`
- Test: `src/combat/encounter.test.ts` — additions

**Interfaces:**
- Consumes: `waveTargets`, `waveDamage`, `waveImpulse` from `src/combat/pressure-wave.ts` (Task 1).
- Produces: `EncounterInput` gains `slam: { strength: number } | null`; `EncounterStep` gains `slamHitThisFrame: string[]`.

- [ ] **Step 1: Write the failing test**

First update the shared fixtures in `src/combat/encounter.test.ts`: add `slam: null` to the input literal inside the `run` helper, and to each standalone `stepEncounter` call. Then add at the end of the file:

```ts
describe('slamming', () => {
  const slamAt = (strength: number) => ({
    playerPosition: ORIGIN, playerForward: NORTH, gustPressed: false, slam: { strength },
  })

  it('damages an enemy inside the blast', () => {
    const before = near().enemies[0]!.health.current
    const step = stepEncounter(near(), slamAt(1), 1 / 60, C)
    expect(step.encounter.enemies[0]!.health.current).toBeLessThan(before)
  })

  it('leaves an enemy outside the blast alone', () => {
    const far = startEncounter([{ id: 'a', position: new Vector3(0, 0, -60) }], C)
    const step = stepEncounter(far, slamAt(1), 1 / 60, C)
    expect(step.encounter.enemies[0]!.health.current).toBeCloseTo(C.enemy.maxHealth)
  })

  it('downs an enemy in one full-strength slam', () => {
    // The payoff, and the thing that separates the wave from the gust: a gust needs
    // three connects, a committed dive needs one.
    const step = stepEncounter(near(), slamAt(1), 1 / 60, C)
    expect(step.downedThisFrame).toEqual(['a'])
    expect(isDowned(step.encounter.enemies[0]!.health)).toBe(true)
  })

  it('does not down an enemy in one minimum slam', () => {
    const step = stepEncounter(near(), slamAt(0), 1 / 60, C)
    expect(step.downedThisFrame).toEqual([])
    expect(isDowned(step.encounter.enemies[0]!.health)).toBe(false)
  })

  it('hits enemies behind the player, unlike a gust', () => {
    const behind = startEncounter([{ id: 'b', position: new Vector3(0, 0, 2) }], C)
    const step = stepEncounter(behind, slamAt(1), 1 / 60, C)
    expect(step.slamHitThisFrame).toEqual(['b'])
  })

  it('reports slam connects apart from gust connects', () => {
    // Kept separate on purpose: hitThisFrame feeds a per-enemy Focus grant, so
    // folding the wave in would pay the player twice for one slam.
    const step = stepEncounter(near(), slamAt(1), 1 / 60, C)
    expect(step.slamHitThisFrame).toEqual(['a'])
    expect(step.hitThisFrame).toEqual([])
  })

  it('does not report a slam that swept an already-downed enemy', () => {
    const base = near()
    const alreadyDowned = {
      ...base,
      enemies: base.enemies.map((enemy) => ({
        ...enemy, health: { ...enemy.health, current: 0 },
      })),
    }
    const step = stepEncounter(alreadyDowned, slamAt(1), 1 / 60, C)
    expect(step.slamHitThisFrame).toEqual([])
  })

  it('changes nothing on a frame with no slam', () => {
    const step = stepEncounter(near(), {
      playerPosition: ORIGIN, playerForward: NORTH, gustPressed: false, slam: null,
    }, 1 / 60, C)
    expect(step.slamHitThisFrame).toEqual([])
    expect(step.encounter.enemies[0]!.health.current).toBeCloseTo(C.enemy.maxHealth)
  })

  it('interrupts a wind-up instead of trading with it', () => {
    // Same rule as the gust: the wave resolves before the enemies act.
    const winding = run(C.enemy.windUpSeconds - 0.1).encounter
    expect(winding.enemies[0]!.stance).toBe('wind-up')
    const slammed = stepEncounter(winding, slamAt(0.5), 1 / 60, C)
    expect(slammed.encounter.enemies[0]!.stance).not.toBe('wind-up')
    expect(slammed.playerHit).toBe(false)
  })

  it('knocks a slammed enemy away from the player', () => {
    const step = stepEncounter(near(), slamAt(1), 1 / 60, C)
    // 'a' starts at z -2, so it is pushed further negative.
    expect(step.encounter.enemies[0]!.knockback.z).toBeLessThan(0)
    expect(step.encounter.enemies[0]!.knockback.y).toBeGreaterThan(0)
  })
})
```

Also add a `pressureWave` block to the `C` fixture at the top of the file, using the
Task 1 test values (`minImpactSpeed: 10, fullImpactSpeed: 50, minRadius: 4, maxRadius: 12,
minDamage: 0.5, maxDamage: 2.5, minKnockback: 10, maxKnockback: 30, bounceFactor: 0.5,
focusAtFullImpact: 20`), so these tests do not depend on shipped tuning. Note `maxDamage`
2.5 exceeds the fixture's `enemy.maxHealth` of 1.5, which is what makes the one-hit-down
test meaningful, and `minDamage` 0.5 does not.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — `slamHitThisFrame` does not exist, and the damage tests see untouched enemies.

- [ ] **Step 3: Write minimal implementation**

In `src/combat/encounter.ts`, import the blast:

```ts
import {
  waveDamage, waveImpulse, waveTargets, type PressureWaveConfig,
} from './pressure-wave'
```

Add to `EncounterInput`:

```ts
  /** Edge-triggered: the player asked to gust this frame. */
  gustPressed: boolean
  /** A Pressure Wave landed at the player's feet this frame, or null. */
  slam: { strength: number } | null
```

Add to `EncounterStep`:

```ts
  /** Enemies a gust connected with this frame, for feedback and for Focus. */
  hitThisFrame: string[]
  /** Enemies a Pressure Wave connected with this frame. Kept apart from hitThisFrame:
   *  that one feeds a per-enemy Focus grant, and a slam is already paid for by its
   *  own strength, so folding them together would pay twice for one slam. */
  slamHitThisFrame: string[]
```

In `stepEncounter`, after the gust branch and **before** the enemies are stepped:

```ts
  let slamHitThisFrame: string[] = []

  if (input.slam) {
    const { strength } = input.slam
    const caught = new Set(
      waveTargets(input.playerPosition, enemies, strength, c.pressureWave)
        .map((enemy) => enemy.id),
    )
    // Read before the hits land, so a connect means a live enemy took it.
    slamHitThisFrame = enemies
      .filter((enemy) => caught.has(enemy.id) && !isDowned(enemy.health))
      .map((enemy) => enemy.id)
    const damage = waveDamage(strength, c.pressureWave)
    enemies = enemies.map((enemy) =>
      caught.has(enemy.id) && !isDowned(enemy.health)
        ? hitEnemy(
            enemy,
            damage,
            waveImpulse(input.playerPosition, enemy.position, strength, c.pressureWave),
          )
        : enemy)
  }
```

Add it to the return:

```ts
    downedThisFrame,
    hitThisFrame,
    slamHitThisFrame,
    playerHit: damageToPlayer > 0,
```

Update `stepEncounter`'s doc comment to record the ordering: the gust resolves, then the
wave, then the enemies act — so both interrupt a wind-up, and the wave sees the gust's
knockback already applied.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS, including every test that was already there.

- [ ] **Step 5: Prove the tests are not decorative**

1. Move the slam block to *after* the enemy step. Expected: the interrupt test FAILS. Revert.
2. Drop `&& !isDowned(enemy.health)` from the `slamHitThisFrame` filter. Expected: the already-downed test FAILS. Revert.
3. Replace `waveDamage(strength, ...)` with `c.pressureWave.minDamage`. Expected: the one-hit-down test FAILS. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "Resolve the Pressure Wave in the fight

The wave resolves before the enemies act, for the same reason the gust does: a
slam should interrupt a wind-up rather than trade with it. Gust first, then wave,
then the enemies — arbitrary between the two moves but deterministic, and it means
the wave sees the gust's knockback already applied.

Slam connects are reported apart from gust connects. hitThisFrame feeds a
per-enemy Focus grant, and a slam is already paid for by its strength, so folding
them together would pay the player twice for one landing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The visible ring

**Files:**
- Create: `src/fx/shockwave.ts`
- Test: `src/fx/shockwave.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface Shockwave { object: Object3D; advance(dt: number): boolean; dispose(): void }`
  - `createShockwave(radius: number, strength: number): Shockwave`

- [ ] **Step 1: Write the failing test**

Create `src/fx/shockwave.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Mesh, MeshBasicMaterial } from 'three'
import { createShockwave } from './shockwave'

function meshOf(wave: ReturnType<typeof createShockwave>): Mesh {
  const object = wave.object
  if (!(object instanceof Mesh)) throw new Error('expected a mesh')
  return object
}

function opacityOf(wave: ReturnType<typeof createShockwave>): number {
  const material = meshOf(wave).material
  if (!(material instanceof MeshBasicMaterial)) throw new Error('expected a basic material')
  return material.opacity
}

describe('createShockwave', () => {
  it('reports true while it is still running and false once finished', () => {
    const wave = createShockwave(10, 1)
    expect(wave.advance(0.1)).toBe(true)
    expect(wave.advance(5)).toBe(false)
  })

  it('grows toward the radius it was given', () => {
    const wave = createShockwave(10, 1)
    const start = meshOf(wave).scale.x
    wave.advance(0.2)
    const mid = meshOf(wave).scale.x
    wave.advance(5)
    const end = meshOf(wave).scale.x

    expect(start).toBeLessThan(mid)
    expect(mid).toBeLessThan(end)
    expect(end).toBeCloseTo(10, 1)
  })

  it('scales with the radius it was given', () => {
    // A big slam must read as a big ring, or the visual carries no information.
    const small = createShockwave(4, 1)
    const big = createShockwave(12, 1)
    small.advance(5)
    big.advance(5)
    expect(meshOf(big).scale.x).toBeGreaterThan(meshOf(small).scale.x * 2.5)
  })

  it('fades out as it expands', () => {
    const wave = createShockwave(10, 1)
    const start = opacityOf(wave)
    wave.advance(0.2)
    expect(opacityOf(wave)).toBeLessThan(start)
    wave.advance(5)
    expect(opacityOf(wave)).toBeCloseTo(0)
  })

  it('starts fainter for a weaker slam', () => {
    // Strength has to be visible, not just felt.
    expect(opacityOf(createShockwave(10, 0))).toBeLessThan(opacityOf(createShockwave(10, 1)))
  })

  it('is visible from the first frame', () => {
    // A ring that starts transparent and fades would never be seen at all.
    expect(opacityOf(createShockwave(10, 1))).toBeGreaterThan(0)
  })

  it('lies flat on the ground rather than standing up facing the camera', () => {
    expect(meshOf(createShockwave(10, 1)).rotation.x).toBeCloseTo(-Math.PI / 2)
  })

  it('casts no shadow', () => {
    // A transparent effect ring throwing a hard shadow reads as a solid disc.
    expect(meshOf(createShockwave(10, 1)).userData.excludeFromShadows).toBe(true)
  })

  it('can be disposed without throwing', () => {
    const wave = createShockwave(10, 1)
    expect(() => wave.dispose()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/shockwave.test.ts`
Expected: FAIL — cannot resolve `./shockwave`.

- [ ] **Step 3: Write minimal implementation**

Create `src/fx/shockwave.ts`:

```ts
import {
  DoubleSide, MathUtils, Mesh, MeshBasicMaterial, RingGeometry, type Object3D,
} from 'three'

/**
 * The ring a Pressure Wave leaves on the ground.
 *
 * This repo treats a wind feature the player cannot see as a bug, and an invisible
 * slam is the same mistake — especially here, where the strength of the slam is the
 * whole mechanic. So the ring carries the same information the damage does: a weak
 * slam is a faint ring, a full one is bright.
 */
export interface Shockwave {
  object: Object3D
  /** Advance the ring. False once it has finished and can be removed. */
  advance(dt: number): boolean
  /** Release the geometry and material. One ring is created per slam. */
  dispose(): void
}

const LIFETIME = 0.4
/** Fraction of the final radius the ring starts at. */
const START_FRACTION = 0.2
/** Ring thickness as a fraction of its radius. */
const THICKNESS = 0.35
/** Opacity of a minimum-strength slam, so a weak one is still visible. */
const FAINTEST = 0.25

export function createShockwave(radius: number, strength: number): Shockwave {
  // A unit ring scaled at runtime. Rebuilding the geometry each frame to grow it
  // would allocate sixty times a second for something a scale already does.
  const geometry = new RingGeometry(1 - THICKNESS, 1, 48)
  const material = new MeshBasicMaterial({
    color: 0xdff1ff,
    transparent: true,
    side: DoubleSide,
    // The ring sits on the ground and must not occlude what it overlaps.
    depthWrite: false,
  })

  const mesh = new Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.userData.excludeFromShadows = true

  const peak = MathUtils.lerp(FAINTEST, 1, MathUtils.clamp(strength, 0, 1))
  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    mesh.scale.setScalar(Math.max(MathUtils.lerp(START_FRACTION * radius, radius, t), 1e-4))
    material.opacity = peak * (1 - t)
  }

  apply()

  return {
    object: mesh,
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

Run: `npx vitest run src/fx/shockwave.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests are not decorative**

1. Set `FAINTEST` to 1. Expected: the "starts fainter for a weaker slam" test FAILS. Revert.
2. Remove `mesh.userData.excludeFromShadows = true`. Expected: the shadow test FAILS. Revert.
3. Remove the `apply()` call before the return. Expected: the "visible from the first frame" test FAILS with opacity 0. Revert.
4. Change `advance` to return `age < LIFETIME * 100`. Expected: the true-then-false test FAILS. Revert.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/fx/shockwave.ts src/fx/shockwave.test.ts
git commit -m "Give the Pressure Wave a visible ring

This repo treats a wind feature the player cannot see as a bug, and an invisible
slam is the same mistake — more so here, where the strength of the slam is the
mechanic. The ring's opacity scales with strength, so it carries the same
information the damage does.

A unit ring scaled at runtime rather than geometry rebuilt per frame, and it
exposes dispose because one is created per slam.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire it into the game

**Files:**
- Modify: `src/main.ts`
- Modify: `README.md`
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: everything from Tasks 1–5. Exact names: `waveRadius` (`src/combat/pressure-wave.ts`); `detectSlam`, `applyBounce`, `type Slam` (`src/player/slam.ts`); `createShockwave`, `type Shockwave` (`src/fx/shockwave.ts`); plus `DEFAULT_COMBAT_CONFIG` and the existing Focus wiring.
- Produces: nothing further.

- [ ] **Step 1: Add the imports and the live-ring list**

`main.ts` is not unit-tested. This task is verified by the full suite, both typecheck passes, a clean build, and playing it.

Imports, beside the existing combat ones:

```ts
import { waveRadius } from './combat/pressure-wave'
import { detectSlam, applyBounce } from './player/slam'
import { createShockwave, type Shockwave } from './fx/shockwave'
```

Beside the other mutable game state:

```ts
/** Live shockwave rings, culled as they finish. One is created per slam. */
const shockwaves: Shockwave[] = []
```

- [ ] **Step 2: Detect the slam and bounce**

In `update`, the existing lines are:

```ts
    lastWind = stillAir()
    player = controllerStep(player, state, dt, deps)
    if (avatarActive) player = refillBreath(player)
```

Replace with:

```ts
    lastWind = stillAir()
    // Held across the step so the impact speed survives the landing that zeroes it.
    const beforeStep = player
    player = controllerStep(player, state, dt, deps)
    if (avatarActive) player = refillBreath(player)

    const slam = detectSlam(
      beforeStep, player, state.tuck, crashed, DEFAULT_COMBAT_CONFIG.pressureWave,
    )
    if (slam) {
      // The ring is placed at the point of contact, before the bounce moves the player.
      const ring = createShockwave(
        waveRadius(slam.strength, DEFAULT_COMBAT_CONFIG.pressureWave), slam.strength,
      )
      ring.object.position.copy(player.position)
      scene.add(ring.object)
      shockwaves.push(ring)
      player = applyBounce(player, slam, DEFAULT_COMBAT_CONFIG.pressureWave)
    }
```

- [ ] **Step 3: Feed the fight and Focus**

Add `slam` to the encounter input:

```ts
    const fight = stepEncounter(encounter, {
      playerPosition: player.position,
      playerForward: player.forward,
      gustPressed: state.gustPressed,
      slam: slam ? { strength: slam.strength } : null,
    }, dt, boostedCombatConfig(DEFAULT_COMBAT_CONFIG, avatarActive, DEFAULT_AVATAR_STATE_CONFIG))
```

And to the Focus events:

```ts
    const events: FocusEvents = {
      gustConnects: fight.hitThisFrame.length,
      downs: fight.downedThisFrame.length,
      slamStrength: slam?.strength ?? 0,
      playerHit: fight.playerHit,
      fellOutOfWorld: crashed,
    }
```

Note the encounter is given `player.position` *after* the bounce. The bounce only changes
vertical velocity and the grounded flag, not the position, so the blast still centres on
the point of contact.

- [ ] **Step 4: Advance and cull the rings**

Beside the other per-frame effect updates, after the wind tells:

```ts
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const ring = shockwaves[i]
      if (!ring || ring.advance(dt)) continue
      scene.remove(ring.object)
      ring.dispose()
      shockwaves.splice(i, 1)
    }
```

Iterating backwards so the splice cannot skip an entry. The `!ring` guard is for
`noUncheckedIndexedAccess`, which types the indexed access as possibly undefined.

- [ ] **Step 5: Verify it builds and the suite is green**

Run: `npm test && npm run typecheck && npm run build`
Expected: whole suite green, both typecheck passes clean, build succeeds.

- [ ] **Step 6: Play it**

Start the dev server through the preview tooling — never `npm run dev` in a shell.

The preview pane reports `visibilityState: hidden`, so `requestAnimationFrame` is
suspended and the game will look frozen. **Read the "preview pane" trap in
`docs/HANDOFF.md` first** — it documents the synthetic-clock technique for driving the
loop, which is the only way to check anything needing sustained simulation. Dispatch
`KeyboardEvent`s on `window` for input, and reload afterwards to discard the patch.

Check, in order:

1. A normal jump with Ctrl held does **not** slam — no ring, no bounce.
2. A dive from height with Ctrl held produces a ring at the point of contact and throws
   the player back upward.
3. Space right after the bounce re-deploys the glider — the flagship combo.
4. Landing from the same dive *without* Ctrl produces neither ring nor bounce.
5. The Focus bar jumps on a landed slam, and jumps further for a harder one.
6. A dive onto the home-island patrol downs a soldier outright and knocks the others
   outward in every direction, including any standing behind the player.
7. Falling out of the world with Ctrl held produces **no** slam and still costs Focus —
   the death-plunge guard, in the running game rather than only in a unit test.

- [ ] **Step 7: Update the README**

The controls table row for `Ctrl` currently reads `| \`Ctrl\` | — | Tuck — fold the wings for a fast dive |`. Replace it with:

```markdown
| `Ctrl` | Hold through a landing to slam | Tuck — fold the wings for a fast dive, and hold it through the landing to slam |
```

Add a paragraph after the combat one:

```markdown
Height is a weapon. Hold `Ctrl` through a landing and the fall becomes a Pressure Wave — a
ring of air that goes out in every direction, with no facing to aim and nobody safe behind
you. How hard it hits scales with how fast you were falling: a short drop is a gust with no
aim, while a committed dive downs a soldier outright and clears the space around them. It
costs nothing but the commitment, and it pays Focus for landing it.

The slam also throws you back into the air with your second jump restored, so the dive is
not the end of the move. Tuck into a dive, slam, and deploy the wings on the way back up.
```

- [ ] **Step 8: Update the handoff**

In `docs/HANDOFF.md`:

1. In "What has NOT been built", remove `Pressure Wave, ` from the §4 combat bullet.
2. Add to "What has been built", after the Focus paragraph:

```markdown
**Pressure Wave.** `src/combat/pressure-wave.ts` is the blast — radial, with no facing
test at all — and `src/player/slam.ts` detects a committed landing by comparing the
player either side of `controllerStep`, so no movement code knows combat exists. Damage,
radius, knockback and the Focus grant all scale with downward impact speed, and a full
dive downs a spear soldier outright. The slam bounces the player back up with their air
jump restored, which is what makes §4.3's dive → wave → re-deploy possible. Spec at
[`docs/superpowers/specs/2026-08-03-pressure-wave-design.md`](superpowers/specs/2026-08-03-pressure-wave-design.md).
```

3. Add `, and the pressureWave block in src/combat/config.ts` to the untested-tuning list,
   and note that the damage cliff — where the slam starts downing a soldier in one hit,
   around 33 m/s of descent — is the value most worth feeling out by hand.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts README.md docs/HANDOFF.md
git commit -m "Wire the Pressure Wave into the game

The player is held across controllerStep so the impact speed survives the landing
that zeroes it, and the ring is placed at the point of contact before the bounce
is applied.

Rings are culled backwards through the list and disposed, because one is created
per slam and an undisposed ring per landing is a leak over a long session.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done when

- `npm test` green, `npm run typecheck` clean on both passes, `npm run build` clean.
- Every "prove the tests are not decorative" step has been run and reverted.
- The seven play checks in Task 6 Step 6 have actually been performed, using the
  synthetic-clock technique from `docs/HANDOFF.md`.
- `README.md` and `docs/HANDOFF.md` reflect the new move.
- All work is on `pressure-wave`. `main` is untouched.

## Out of scope

Carried over from the spec, and not to be added opportunistically:

- The Avatar State boosting the wave.
- The wave hurting the player, or hard landings costing health.
- Auto-deploying the glider on the bounce.
- Apex-height tracking on `PlayerState`.
- The rest of §4.2 — Vortex, Air Wall, Slipstream, staff melee — and the borrowed
  elements.
