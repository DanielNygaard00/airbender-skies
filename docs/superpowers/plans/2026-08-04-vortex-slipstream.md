# Vortex and Slipstream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build §4.2's two remaining always-available airbending moves — Vortex (charged pull and lift) and Slipstream (directional dash with an invulnerability window) — plus the enemy gravity Vortex needs to work.

**Architecture:** Enemies gain a ballistic vertical velocity and a ground snap, which both makes Vortex's lift real and fixes an existing bug where gusted soldiers levitate permanently. Vortex is a radial, facing-free move whose charge lives on the `Encounter` beside `gustCooldown`. Slipstream is a player-side move returning an impulse, with its invulnerability crossing into combat through the existing input struct.

**Tech Stack:** TypeScript, three.js 0.185.1, Vitest 4 (node environment), Vite 8.

## Global Constraints

- **Never commit to `main`.** Work on the `airbending-kit` branch. Pushing `main` triggers the GitHub Pages deploy.
- **Typecheck is two passes:** `npx tsc -p tsconfig.json --noEmit` then `npx tsc -p tsconfig.test.json --noEmit`. App code cannot see Node globals; only tests can.
- `noUncheckedIndexedAccess` is on. Indexed access yields `T | undefined` and must be narrowed.
- **Red-proof every test.** Write the test, run it, confirm it FAILS for the stated reason, then implement. A test that passes before the feature exists is decorative — say so and rewrite it rather than keeping it.
- **Derive expectations from config, never hardcode.** `C.strikeRange`, not `3.2`. The suite's existing style, and it survives retuning.
- **Comments explain why, not what.** Mark regression guards as such.
- Baseline before this plan: 854 tests across 60 files, all passing.
- Fixed config values, verbatim from the spec: `enemy.gravity: 20`; vortex `maxChargeSeconds: 1.2`, `minChargeSeconds: 0.2`, `minRadius: 5`, `maxRadius: 12`, `minPullSpeed: 10`, `maxPullSpeed: 18`, `minLiftSpeed: 5`, `maxLiftSpeed: 11`, `cooldownSeconds: 3.5`; slipstream `speed: 30`, `durationSeconds: 0.2`, `invulnerableSeconds: 0.11`, `cooldownSeconds: 1.5`; focus `dodgeGain: 8`.
- Key bindings: `R` holds and releases a Vortex, `C` fires a Slipstream.

## File Structure

| File | Responsibility |
|---|---|
| `src/combat/enemy.ts` (modify) | Gains `verticalVelocity`, `grounded`, gravity, a ground snap, fall-out downing, and inert-while-airborne. |
| `src/combat/enemy.test.ts` (modify) | Gravity, the float regression, fall-out, and the airborne-inert rules. |
| `src/combat/vortex.ts` (create) | The pull: radius from charge, radial targeting, inward-plus-lift impulse. No damage. |
| `src/combat/vortex.test.ts` (create) | Radial-ness, the inward sign, charge scaling. |
| `src/combat/encounter.ts` (modify) | Threads the ground query through; owns the vortex charge and cooldown; the invulnerability seam. |
| `src/combat/encounter.test.ts` (modify) | Vortex resolution, cancel-below-minimum, damage avoided. |
| `src/player/slipstream.ts` (create) | The dodge: state, availability, the invulnerable window, the heading rule. |
| `src/player/slipstream.test.ts` (create) | The window being shorter than the dash, cooldown, heading. |
| `src/player/controller.ts` (modify) | Runs the slipstream in both postures and adds its impulse. |
| `src/focus/focus.ts` (modify) | `FocusEvents.damageAvoided` and its gain. |
| `src/fx/vortex-ring.ts`, `src/fx/vortex-charge.ts` (create) | The release ring at the true radius, and the charge tell while held. |
| `src/fx/slipstream-trail.ts`, `src/fx/guard-shell.ts` (create) | The dash streak, and the shell shown for exactly the invulnerable window. |
| `src/core/types.ts`, `src/core/config.ts`, `src/core/input.ts` (modify) | Player fields, the slipstream config, the two new keys. |
| `src/main.ts` (modify) | Wiring. |
| `src/ui/guide/actions.ts`, `README.md`, `docs/HANDOFF.md` (modify) | Documentation. A drift test binds the guide and README together. |

---

### Task 1: Enemies fall

**Files:**
- Modify: `src/combat/enemy.ts`
- Modify: `src/combat/config.ts` (add `gravity` to the enemy block)
- Test: `src/combat/enemy.test.ts`

**Interfaces:**
- Produces:
  - `export interface GroundHeightQuery { groundHeightAt(x: number, z: number): number | null }`
  - `Enemy` gains `verticalVelocity: number` and `grounded: boolean`
  - `EnemyConfig` gains `gravity: number`
  - `stepEnemy(enemy, playerPosition, ground: GroundHeightQuery, worldFloorY: number, dt, c)` — two new parameters, third and fourth

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/enemy.test.ts`. The file already builds a local `C` config and an `AT(x, z)`
helper — read the top of the file and reuse them. You will also need two ground fixtures:

```ts
/** Flat ground at y=0, so an arc can be reasoned about exactly. */
const flatGround: GroundHeightQuery = { groundHeightAt: () => 0 }
/** No ground anywhere: what being blown off an island looks like. */
const emptyAir: GroundHeightQuery = { groundHeightAt: () => null }
const FLOOR = -50

/** Step an enemy for `seconds` with no player nearby, so only physics acts. */
function settle(enemy: Enemy, seconds: number, ground = flatGround): Enemy {
  let current = enemy
  const far = AT(0, 500)
  for (let t = 0; t < seconds; t += 1 / 60) {
    current = stepEnemy(current, far, ground, FLOOR, 1 / 60, C).enemy
  }
  return current
}

describe('enemy gravity', () => {
  it('returns a lifted enemy to the ground', () => {
    // Regression guard for a measured bug: gust and Pressure Wave both apply an
    // upward impulse, and with no gravity the soldier stayed up permanently — a
    // gusted enemy was measured 2.4m above the ground twenty seconds later.
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), C), 0, new Vector3(0, 9, 0))
    expect(settle(lifted, 3).position.y).toBeCloseTo(0, 3)
  })

  it('rises before it falls', () => {
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), C), 0, new Vector3(0, 9, 0))
    expect(settle(lifted, 0.2).position.y).toBeGreaterThan(0.5)
  })

  it('reports itself airborne while up, and grounded once it lands', () => {
    const lifted = hitEnemy(spawnEnemy('a', AT(0, 0), C), 0, new Vector3(0, 9, 0))
    expect(settle(lifted, 0.2).grounded).toBe(false)
    expect(settle(lifted, 3).grounded).toBe(true)
  })

  it('lets a downed body fall rather than stranding it in the air', () => {
    // stepEnemy returns early for the downed. Leaving gravity out of that branch
    // would strand any corpse that was airborne when it went down.
    const downed = hitEnemy(spawnEnemy('a', AT(0, 0), C), C.maxHealth, new Vector3(0, 9, 0))
    const settled = settle(downed, 3)
    expect(settled.stance).toBe('downed')
    expect(settled.position.y).toBeCloseTo(0, 3)
  })

  it('downs an enemy that falls out of the world', () => {
    // Section 4.6 counts being blown off a ledge as a down. Without this, adding
    // gravity would make an enemy off the island fall forever.
    const pushed = settle(spawnEnemy('a', AT(0, 0), C), 6, emptyAir)
    expect(isDowned(pushed.health)).toBe(true)
  })

  it('still decays a horizontal push', () => {
    // Pre-existing behaviour that the split of knockback must not lose.
    const shoved = hitEnemy(spawnEnemy('a', AT(0, 0), C), 0, new Vector3(20, 0, 0))
    const after = settle(shoved, 2)
    expect(after.position.x).toBeGreaterThan(1)
    expect(Math.hypot(after.knockback.x, after.knockback.z)).toBeLessThan(1)
  })
})
```

Every existing call to `stepEnemy` in this file and in `encounter.ts` now has the wrong arity.
Update the calls in `enemy.test.ts` to pass `flatGround, FLOOR` in the new positions. Leave
`encounter.ts` alone — Task 3 owns it; it will not compile until then, which is expected and
is why the two tasks are ordered this way.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/combat/enemy.test.ts
```

Expected: FAIL. `GroundHeightQuery` does not exist, `stepEnemy` takes four parameters, and
`grounded`/`verticalVelocity` are not on `Enemy`.

- [ ] **Step 3: Extend the enemy model**

In `src/combat/enemy.ts`, add the query type and the two fields:

```ts
/**
 * Just the ground height, and nothing else.
 *
 * `TerrainQuery` also carries `raycastDown`, which stepping an enemy has no use for.
 * Asking for the narrower thing keeps the combat model independent of the parts of
 * terrain it does not need, and makes a test fixture one line instead of six.
 */
export interface GroundHeightQuery {
  groundHeightAt(x: number, z: number): number | null
}
```

```ts
export interface Enemy {
  // ... existing fields, with knockback's comment narrowed:
  /** Decaying horizontal push from a gust, a slam or a vortex. Horizontal only. */
  knockback: Vector3
  /** Ballistic vertical speed. Gravity acts on this; the ground snap ends it. */
  verticalVelocity: number
  /**
   * Set by the ground snap, and the authority on "airborne".
   *
   * Stored rather than derived because every consumer would otherwise re-test y
   * against the ground with its own epsilon and drift from the snap that decides it.
   */
  grounded: boolean
}
```

`EnemyConfig` gains:

```ts
  /** Matches the world's own gravity in DEFAULT_GROUND_CONFIG. */
  gravity: number
```

`spawnEnemy` initialises `verticalVelocity: 0, grounded: true`.

- [ ] **Step 4: Route an impulse's vertical part**

Replace `hitEnemy`'s body so the impulse splits. Callers keep passing one `Vector3`, so
`gustImpulse` and `waveImpulse` do not change shape:

```ts
export function hitEnemy(enemy: Enemy, damage: number, impulse: Vector3): Enemy {
  const health = applyDamage(enemy.health, damage)
  return {
    ...enemy,
    health,
    // Horizontal push and ballistic lift are different physics: damping a fall would
    // make a body float down, which is why they are separate fields now.
    knockback: enemy.knockback.clone().add(new Vector3(impulse.x, 0, impulse.z)),
    verticalVelocity: enemy.verticalVelocity + impulse.y,
    // grounded is deliberately not set here: the physics step below recomputes it from
    // the snap, and two places deciding it is how they drift apart.
    stance: isDowned(health) ? 'downed' : 'recover',
    stanceTime: 0,
  }
}
```

- [ ] **Step 5: Add the physics step**

Add this helper above `stepEnemy` in `src/combat/enemy.ts`:

```ts
interface Fallen {
  position: Vector3
  verticalVelocity: number
  grounded: boolean
  knockback: Vector3
}

/** One frame of ballistics: decaying horizontal push, gravity, then a ground snap. */
function fall(
  enemy: Enemy, ground: GroundHeightQuery, dt: number, c: EnemyConfig,
): Fallen {
  const knockback = enemy.knockback.clone()
    .multiplyScalar(Math.max(0, 1 - c.knockbackDamping * dt))
  let verticalVelocity = enemy.verticalVelocity - c.gravity * dt
  const position = enemy.position.clone()
  position.x += knockback.x * dt
  position.z += knockback.z * dt
  position.y += verticalVelocity * dt

  let grounded = false
  const height = ground.groundHeightAt(position.x, position.z)
  // Only a descending enemy lands, so a lift is not cancelled on its first frame.
  if (height !== null && verticalVelocity <= 0 && position.y <= height) {
    position.y = height
    verticalVelocity = 0
    grounded = true
  }
  return { position, verticalVelocity, grounded, knockback }
}
```

- [ ] **Step 6: Rewrite `stepEnemy`'s signature and its physics**

Change the signature and replace the knockback lines at the top of the function:

```ts
export function stepEnemy(
  enemy: Enemy,
  playerPosition: Vector3,
  ground: GroundHeightQuery,
  worldFloorY: number,
  dt: number,
  c: EnemyConfig,
): EnemyStep {
  const moved = fall(enemy, ground, dt, c)

  // Off the island and below the floor: downed, per section 4.6's list of ways an
  // enemy goes down. Without this, gravity would mean falling forever.
  if (moved.position.y < worldFloorY && !isDowned(enemy.health)) {
    return {
      enemy: {
        ...enemy, ...moved,
        health: applyDamage(enemy.health, enemy.health.current),
        stance: 'downed', stanceTime: 0,
      },
      damageToPlayer: 0,
    }
  }

  if (isDowned(enemy.health)) {
    // Down, not gone: the body stays in the world — but it still falls, and settles.
    return {
      enemy: { ...enemy, ...moved, stance: 'downed', stanceTime: enemy.stanceTime + dt },
      damageToPlayer: 0,
    }
  }

  // ... the existing stance logic follows, reading `moved.position` where it used to
  // read `pushed`, and returning `...moved` fields alongside stance and facing.
```

Work through the rest of the existing function replacing `pushed` with `moved.position` and
`knockback` with `moved.knockback`, and include `verticalVelocity` and `grounded` from `moved`
in the returned enemy. Do not change any stance timing.

- [ ] **Step 7: Add the config value**

In `src/combat/config.ts`, inside the `enemy` block:

```ts
    // Matches DEFAULT_GROUND_CONFIG's gravity, so a lifted soldier falls at the
    // same rate the player does.
    gravity: 20,
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx vitest run src/combat/enemy.test.ts
```

Expected: PASS. `src/combat/encounter.test.ts` will still fail to compile — Task 3 fixes that.

- [ ] **Step 9: Red-proof the float regression**

That test is the one guarding the reported bug. Prove it can fail: temporarily change `fall` so
`verticalVelocity` is not decremented by gravity (`let verticalVelocity = enemy.verticalVelocity`).

```bash
npx vitest run src/combat/enemy.test.ts
```

Expected: FAIL on "returns a lifted enemy to the ground". Restore the line BY HAND — do not
use `git checkout` or `git restore`, which would discard the rest of your work in the file.
Re-run to confirm PASS.

- [ ] **Step 10: Commit**

```bash
git add src/combat/enemy.ts src/combat/enemy.test.ts src/combat/config.ts
git commit -m "Give enemies gravity and a ground snap"
```

---

### Task 2: An airborne enemy is inert

**Files:**
- Modify: `src/combat/enemy.ts`
- Test: `src/combat/enemy.test.ts`

**Interfaces:**
- Consumes: `Enemy.grounded`, `GroundHeightQuery`, and the six-parameter `stepEnemy` from Task 1.
- Produces: no new exports. `stepEnemy` deals no damage and does not advance a stance while `grounded` is false.

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/enemy.test.ts`, reusing `flatGround`, `emptyAir`, `FLOOR`, `C`, `AT` and
`settle` from Task 1:

```ts
describe('an airborne enemy', () => {
  /** Lift an enemy standing right next to the player. */
  const liftedBesidePlayer = () =>
    hitEnemy(spawnEnemy('a', AT(0, 1), C), 0, new Vector3(0, 9, 0))

  it('deals no damage even from inside strike range', () => {
    // The whole payoff of a vortex: a lifted group stops acting. Range is derived
    // from config so this survives retuning.
    const player = AT(0, 0)
    let enemy = liftedBesidePlayer()
    expect(horizontalDistance(enemy.position, player)).toBeLessThan(C.strikeRange)
    let dealt = 0
    for (let t = 0; t < C.windUpSeconds * 3; t += 1 / 60) {
      const step = stepEnemy(enemy, player, flatGround, FLOOR, 1 / 60, C)
      enemy = step.enemy
      dealt += step.damageToPlayer
      if (enemy.grounded) break
    }
    expect(dealt).toBe(0)
  })

  it('drops a wind-up in progress when it leaves the ground', () => {
    const player = AT(0, 1)
    // Get it genuinely winding up first, rather than assuming a fixture is.
    let enemy = spawnEnemy('a', AT(0, 2), C)
    for (let t = 0; t < 1 && enemy.stance !== 'wind-up'; t += 1 / 60) {
      enemy = stepEnemy(enemy, player, flatGround, FLOOR, 1 / 60, C).enemy
    }
    expect(enemy.stance).toBe('wind-up')

    const lifted = stepEnemy(
      hitEnemy(enemy, 0, new Vector3(0, 9, 0)), player, flatGround, FLOOR, 1 / 60, C,
    ).enemy
    expect(lifted.grounded).toBe(false)
    expect(lifted.stance).not.toBe('wind-up')
  })

  it('strikes again once it has landed', () => {
    // Inertness must be temporary, or a vortex would be a permanent disable.
    const player = AT(0, 1)
    let enemy = settle(liftedBesidePlayer(), 3)
    expect(enemy.grounded).toBe(true)
    let dealt = 0
    for (let t = 0; t < C.windUpSeconds * 4; t += 1 / 60) {
      const step = stepEnemy(enemy, player, flatGround, FLOOR, 1 / 60, C)
      enemy = step.enemy
      dealt += step.damageToPlayer
    }
    expect(dealt).toBeGreaterThan(0)
  })
})
```

`horizontalDistance` is already exported from `src/combat/enemy.ts`; add it to the test file's
existing import if it is not there.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/combat/enemy.test.ts
```

Expected: FAIL on "deals no damage even from inside strike range" and "drops a wind-up in
progress" — after Task 1 an airborne enemy still runs its stance logic and will strike.

- [ ] **Step 3: Implement**

In `src/combat/enemy.ts`, immediately after the downed branch and before the stance logic:

```ts
  // Airborne: inert. This is what makes a Vortex setup rather than damage — the payoff
  // for lifting a group is that the group stops acting. A wind-up in progress is
  // dropped, consistent with hitEnemy already treating a hit as an interruption.
  if (!moved.grounded) {
    const winding = enemy.stance === 'wind-up'
    return {
      enemy: {
        ...enemy, ...moved,
        stance: winding ? 'recover' : enemy.stance,
        stanceTime: winding ? 0 : enemy.stanceTime + dt,
      },
      damageToPlayer: 0,
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/combat/enemy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/combat/enemy.ts src/combat/enemy.test.ts
git commit -m "Make an airborne enemy inert"
```

---

### Task 3: Thread the ground through the encounter

**Files:**
- Modify: `src/combat/encounter.ts`
- Modify: `src/main.ts` (the `stepEncounter` call)
- Test: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `GroundHeightQuery` and the six-parameter `stepEnemy` from Task 1.
- Produces: `export interface EncounterDeps { ground: GroundHeightQuery; worldFloorY: number }`, and `stepEncounter(encounter, input, dt, c, deps)` — `deps` is a new fifth parameter.

- [ ] **Step 1: Add the deps type and thread it**

In `src/combat/encounter.ts`:

```ts
import { hitEnemy, spawnEnemy, stepEnemy, type Enemy, type EnemyConfig, type GroundHeightQuery } from './enemy'

/**
 * What the fight needs from the world, separate from the per-frame input.
 *
 * Mirrors how `ControllerDeps` sits beside `InputState` in the player controller:
 * a terrain query is a dependency, not something the player did this frame.
 */
export interface EncounterDeps {
  ground: GroundHeightQuery
  worldFloorY: number
}
```

Change the signature to `stepEncounter(encounter, input, dt, c, deps: EncounterDeps)` and the
enemy step to:

```ts
    const step = stepEnemy(enemy, input.playerPosition, deps.ground, deps.worldFloorY, dt, c.enemy)
```

- [ ] **Step 2: Update the test file's helper and run it**

`src/combat/encounter.test.ts` builds its steps through a local helper (read the top of the
file — it wraps `stepEncounter` with a defaults object). Add the fifth argument there once,
rather than at every call site:

```ts
const flatGround = { groundHeightAt: () => 0 }
const DEPS = { ground: flatGround, worldFloorY: -50 }
```

```bash
npx vitest run src/combat/encounter.test.ts
```

Expected: PASS. If a test fails on enemy positions rather than arity, read it before changing
it — gravity is new behaviour and a position expectation may have been written against the
floating bug.

- [ ] **Step 3: Wire the game**

In `src/main.ts`, the `stepEncounter` call gains its fifth argument. `world.terrain` already
has a `groundHeightAt` method, so it satisfies `GroundHeightQuery` structurally with no
adapter, and `ARCHIPELAGO.worldFloorY` is the constant the player controller already uses:

```ts
    const fight = stepEncounter(encounter, {
      // ... existing input fields unchanged
    }, dt, fightConfig, { ground: world.terrain, worldFloorY: ARCHIPELAGO.worldFloorY })
```

- [ ] **Step 4: Full suite and both typechecks**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
```

Expected: all green. This is the first point since Task 1 where the whole tree compiles.

- [ ] **Step 5: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts src/main.ts
git commit -m "Give the fight a ground query for enemy gravity"
```

---

### Task 4: The Vortex

**Files:**
- Create: `src/combat/vortex.ts`
- Modify: `src/combat/config.ts` (add the `vortex` block), `src/combat/encounter.ts` (`CombatConfig` gains `vortex`)
- Test: `src/combat/vortex.test.ts`

**Interfaces:**
- Consumes: `Enemy`, `horizontalDistance` from `src/combat/enemy.ts`.
- Produces:
  - `export interface VortexConfig { maxChargeSeconds, minChargeSeconds, minRadius, maxRadius, minPullSpeed, maxPullSpeed, minLiftSpeed, maxLiftSpeed, cooldownSeconds: number }`
  - `vortexCharge(heldSeconds: number, c: VortexConfig): number` — 0 to 1
  - `vortexRadius(charge: number, c: VortexConfig): number`
  - `vortexTargets(origin: Vector3, enemies: readonly Enemy[], charge: number, c: VortexConfig): Enemy[]`
  - `vortexImpulse(origin: Vector3, target: Vector3, charge: number, c: VortexConfig): Vector3`

- [ ] **Step 1: Write the failing tests**

Create `src/combat/vortex.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { vortexCharge, vortexRadius, vortexTargets, vortexImpulse } from './vortex'
import { spawnEnemy, horizontalDistance } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

const V = DEFAULT_COMBAT_CONFIG.vortex
const E = DEFAULT_COMBAT_CONFIG.enemy
const ORIGIN = new Vector3(0, 0, 0)
const at = (x: number, z: number) => new Vector3(x, 0, z)
const enemyAt = (id: string, x: number, z: number) => spawnEnemy(id, at(x, z), E)

describe('vortexCharge', () => {
  it('is 0 at the start and 1 at the cap', () => {
    expect(vortexCharge(0, V)).toBe(0)
    expect(vortexCharge(V.maxChargeSeconds, V)).toBe(1)
  })

  it('clamps past the cap rather than over-charging', () => {
    expect(vortexCharge(V.maxChargeSeconds * 4, V)).toBe(1)
  })
})

describe('vortexRadius', () => {
  it('grows with charge, from the minimum to the maximum', () => {
    expect(vortexRadius(0, V)).toBeCloseTo(V.minRadius, 6)
    expect(vortexRadius(1, V)).toBeCloseTo(V.maxRadius, 6)
    expect(vortexRadius(0.5, V)).toBeGreaterThan(V.minRadius)
  })
})

describe('vortexTargets', () => {
  it('catches an enemy directly behind the caster', () => {
    // Radial with no facing test: a vortex is a place, not a direction. This is the
    // contrast with a gust, which only catches what is in front.
    const behind = enemyAt('behind', 0, V.minRadius - 1)
    const ahead = enemyAt('ahead', 0, -(V.minRadius - 1))
    const caught = vortexTargets(ORIGIN, [behind, ahead], 0, V).map((e) => e.id)
    expect(caught).toContain('behind')
    expect(caught).toContain('ahead')
  })

  it('leaves an enemy outside the radius alone', () => {
    const far = enemyAt('far', V.maxRadius + 2, 0)
    expect(vortexTargets(ORIGIN, [far], 1, V)).toHaveLength(0)
  })

  it('reaches further on a full charge than on none', () => {
    const mid = enemyAt('mid', (V.minRadius + V.maxRadius) / 2, 0)
    expect(vortexTargets(ORIGIN, [mid], 0, V)).toHaveLength(0)
    expect(vortexTargets(ORIGIN, [mid], 1, V)).toHaveLength(1)
  })
})

describe('vortexImpulse', () => {
  it('pulls inward, toward the caster', () => {
    // The sign is the whole move. A gust pushes away; this gathers. Asserting the
    // direction rather than merely that something moved.
    const target = at(6, 0)
    const pull = vortexImpulse(ORIGIN, target, 1, V)
    expect(pull.x).toBeLessThan(0)
    const after = target.clone().addScaledVector(pull, 0.1)
    expect(horizontalDistance(ORIGIN, after)).toBeLessThan(horizontalDistance(ORIGIN, target))
  })

  it('lifts', () => {
    expect(vortexImpulse(ORIGIN, at(6, 0), 1, V).y).toBeGreaterThan(0)
  })

  it('lifts harder on a full charge', () => {
    expect(vortexImpulse(ORIGIN, at(3, 0), 1, V).y)
      .toBeGreaterThan(vortexImpulse(ORIGIN, at(3, 0), 0, V).y)
  })

  it('still lifts an enemy standing exactly on the caster', () => {
    // The inward direction is undefined there; it must not produce NaN.
    const pull = vortexImpulse(ORIGIN, ORIGIN.clone(), 1, V)
    expect(Number.isFinite(pull.x)).toBe(true)
    expect(pull.y).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/combat/vortex.test.ts
```

Expected: FAIL — the module does not exist, and `DEFAULT_COMBAT_CONFIG.vortex` is undefined.

- [ ] **Step 3: Implement the module**

Create `src/combat/vortex.ts`:

```ts
import { MathUtils, Vector3 } from 'three'
import { horizontalDistance, type Enemy } from './enemy'

/**
 * Vortex: charged, gathers a group inward and lifts them briefly.
 *
 * The design doc calls it "setup, not damage", so there is no damage parameter to set
 * — the move cannot quietly become a damage tool through config drift. Its whole value
 * is that a lifted enemy is inert, which is enforced in `stepEnemy`, not here.
 *
 * Radial with no facing test, like the Pressure Wave: a vortex is a place rather than
 * a direction. That is the deliberate contrast with a gust, which sweeps a cone.
 */
export interface VortexConfig {
  maxChargeSeconds: number
  /** Below this, a release cancels: no pull, and the cooldown is not spent. */
  minChargeSeconds: number
  minRadius: number
  maxRadius: number
  minPullSpeed: number
  maxPullSpeed: number
  minLiftSpeed: number
  maxLiftSpeed: number
  cooldownSeconds: number
}

/** How far a held charge has come, 0 to 1. */
export function vortexCharge(heldSeconds: number, c: VortexConfig): number {
  if (!(c.maxChargeSeconds > 0)) return 0
  return MathUtils.clamp(heldSeconds / c.maxChargeSeconds, 0, 1)
}

export function vortexRadius(charge: number, c: VortexConfig): number {
  return MathUtils.lerp(c.minRadius, c.maxRadius, MathUtils.clamp(charge, 0, 1))
}

/** Everyone caught, named so a caller cannot forget the radius. */
export function vortexTargets(
  origin: Vector3, enemies: readonly Enemy[], charge: number, c: VortexConfig,
): Enemy[] {
  const radius = vortexRadius(charge, c)
  return enemies.filter((enemy) => horizontalDistance(origin, enemy.position) <= radius)
}

/** Inward pull plus lift. */
export function vortexImpulse(
  origin: Vector3, target: Vector3, charge: number, c: VortexConfig,
): Vector3 {
  const t = MathUtils.clamp(charge, 0, 1)
  const inward = new Vector3(origin.x - target.x, 0, origin.z - target.z)
  // Standing on the caster leaves the direction undefined: lift, and do not divide.
  const direction = inward.lengthSq() < 1e-8 ? new Vector3() : inward.normalize()
  return direction
    .multiplyScalar(MathUtils.lerp(c.minPullSpeed, c.maxPullSpeed, t))
    .setY(MathUtils.lerp(c.minLiftSpeed, c.maxLiftSpeed, t))
}
```

- [ ] **Step 4: Add the config**

`CombatConfig` in `src/combat/encounter.ts` gains `vortex: VortexConfig` (import the type).
In `src/combat/config.ts`:

```ts
  /**
   * Vortex. A setup tool, so the cooldown is long next to the gust's 0.45s — you get
   * one gather per exchange, not a way to keep a group permanently airborne.
   */
  vortex: {
    maxChargeSeconds: 1.2,
    minChargeSeconds: 0.2,
    minRadius: 5,
    // A full charge reaches as far as a gust, so the two moves cover the same ground
    // by different rules rather than one outranging the other.
    maxRadius: 12,
    minPullSpeed: 10,
    maxPullSpeed: 18,
    // Under gravity 20: about 0.5s airborne at the minimum, 1.1s and roughly 3m of
    // apex at full charge. "Lifts them briefly" is the doc's wording.
    minLiftSpeed: 5,
    maxLiftSpeed: 11,
    cooldownSeconds: 3.5,
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/combat/vortex.test.ts
```

Expected: PASS, all eleven.

- [ ] **Step 6: Commit**

```bash
git add src/combat/vortex.ts src/combat/vortex.test.ts src/combat/config.ts src/combat/encounter.ts
git commit -m "Add the Vortex: a radial pull that lifts"
```

---

### Task 5: The fight resolves a Vortex

**Files:**
- Modify: `src/combat/encounter.ts`
- Modify: `src/core/types.ts` (`InputState`), `src/core/input.ts` (the `R` key)
- Modify: `src/main.ts` (pass the new input through)
- Test: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `vortexCharge`, `vortexTargets`, `vortexImpulse`, `VortexConfig` from Task 4; `hitEnemy` from `src/combat/enemy.ts`.
- Produces:
  - `Encounter` gains `vortexHeldSeconds: number` and `vortexCooldown: number`
  - `EncounterInput` gains `vortexHeld: boolean` and `vortexReleased: boolean`
  - `EncounterStep` gains `vortexFired: number | null` — the charge it fired at, for the effect
  - `canVortex(encounter: Encounter): boolean`
  - `InputState` gains `vortexHeld: boolean` and `vortexReleased: boolean`

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/encounter.test.ts`, using its existing step helper and the `DEPS` from
Task 3. Note the helper's defaults object needs `vortexHeld: false, vortexReleased: false`
added so existing cases keep compiling.

```ts
describe('a vortex', () => {
  /** Hold for `seconds`, then release, and return the resulting step. */
  const chargeAndRelease = (seconds: number, enemies: EnemySpawn[]) => {
    let encounter = startEncounter(enemies, DEFAULT_COMBAT_CONFIG)
    for (let t = 0; t < seconds; t += 1 / 60) {
      encounter = stepEncounter(
        encounter, { ...defaults, vortexHeld: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      ).encounter
    }
    return stepEncounter(
      encounter, { ...defaults, vortexReleased: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
  }

  it('accumulates charge while held', () => {
    let encounter = startEncounter([], DEFAULT_COMBAT_CONFIG)
    for (let t = 0; t < 0.5; t += 1 / 60) {
      encounter = stepEncounter(
        encounter, { ...defaults, vortexHeld: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      ).encounter
    }
    expect(encounter.vortexHeldSeconds).toBeGreaterThan(0.4)
  })

  it('lifts a caught enemy and spends the cooldown', () => {
    const step = chargeAndRelease(
      DEFAULT_COMBAT_CONFIG.vortex.maxChargeSeconds, [{ id: 'a', position: new Vector3(3, 0, 0) }],
    )
    const enemy = step.encounter.enemies[0]
    if (!enemy) throw new Error('expected an enemy')
    expect(enemy.verticalVelocity).toBeGreaterThan(0)
    expect(step.encounter.vortexCooldown).toBeCloseTo(DEFAULT_COMBAT_CONFIG.vortex.cooldownSeconds, 5)
    expect(step.vortexFired).not.toBeNull()
  })

  it('does no damage', () => {
    // "Setup, not damage" — the enemy must come out of a vortex at full health.
    const step = chargeAndRelease(
      DEFAULT_COMBAT_CONFIG.vortex.maxChargeSeconds, [{ id: 'a', position: new Vector3(3, 0, 0) }],
    )
    const enemy = step.encounter.enemies[0]
    if (!enemy) throw new Error('expected an enemy')
    expect(enemy.health.current).toBeCloseTo(DEFAULT_COMBAT_CONFIG.enemy.maxHealth, 5)
  })

  it('cancels for free below the minimum charge', () => {
    const step = chargeAndRelease(
      DEFAULT_COMBAT_CONFIG.vortex.minChargeSeconds / 2,
      [{ id: 'a', position: new Vector3(3, 0, 0) }],
    )
    const enemy = step.encounter.enemies[0]
    if (!enemy) throw new Error('expected an enemy')
    expect(enemy.verticalVelocity).toBe(0)
    expect(step.encounter.vortexCooldown).toBe(0)
    expect(step.vortexFired).toBeNull()
    expect(step.encounter.vortexHeldSeconds).toBe(0)
  })

  it('interrupts a wind-up', () => {
    // Derived, not assumed: step until the enemy is genuinely winding up first. An
    // earlier version of this test in this file used a fixture that never reached
    // wind-up, so it passed against a move that interrupted nothing.
    let encounter = startEncounter(
      [{ id: 'a', position: new Vector3(2, 0, 0) }], DEFAULT_COMBAT_CONFIG,
    )
    for (let t = 0; t < 1; t += 1 / 60) {
      encounter = stepEncounter(encounter, defaults, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS).encounter
      if (encounter.enemies[0]?.stance === 'wind-up') break
    }
    expect(encounter.enemies[0]?.stance).toBe('wind-up')

    for (let t = 0; t < DEFAULT_COMBAT_CONFIG.vortex.minChargeSeconds + 0.1; t += 1 / 60) {
      encounter = stepEncounter(
        encounter, { ...defaults, vortexHeld: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      ).encounter
    }
    const fired = stepEncounter(
      encounter, { ...defaults, vortexReleased: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
    expect(fired.encounter.enemies[0]?.stance).not.toBe('wind-up')
  })

  it('cannot charge while on cooldown', () => {
    const fired = chargeAndRelease(
      DEFAULT_COMBAT_CONFIG.vortex.maxChargeSeconds, [{ id: 'a', position: new Vector3(3, 0, 0) }],
    )
    const held = stepEncounter(
      fired.encounter, { ...defaults, vortexHeld: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
    )
    expect(held.encounter.vortexHeldSeconds).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/combat/encounter.test.ts
```

Expected: FAIL — `vortexHeldSeconds`, `vortexCooldown`, `vortexFired` and the input fields do
not exist.

- [ ] **Step 3: Implement in the encounter**

Add to `Encounter`, `EncounterInput` and `EncounterStep`:

```ts
export interface Encounter {
  // ...
  /** Seconds the player has held a charge, or 0. Not the 0-to-1 fraction. */
  vortexHeldSeconds: number
  vortexCooldown: number
}
```

The field is `vortexHeldSeconds` and not `vortexCharge` on purpose: `vortexCharge()` is the
function converting seconds into the fraction, and one name for two units — both `number` —
is a mix-up the compiler cannot catch.

```ts
export interface EncounterInput {
  // ...
  /** R held: a vortex is charging. */
  vortexHeld: boolean
  /** R released this frame. */
  vortexReleased: boolean
}

export interface EncounterStep {
  // ...
  /** The charge a vortex fired at, or null. For the effect that draws it. */
  vortexFired: number | null
}
```

`startEncounter` initialises both new encounter fields to 0. Add:

```ts
/** Whether a vortex can start charging: off cooldown only. */
export function canVortex(encounter: Encounter): boolean {
  return encounter.vortexCooldown <= 0
}
```

Inside `stepEncounter`, after the gust block and before the slam block, so a vortex gathers
before a wave scatters — and so both land before enemies are stepped, which is what makes them
interrupts rather than trades:

```ts
  let vortexCooldown = Math.max(0, encounter.vortexCooldown - dt)
  let vortexHeldSeconds = encounter.vortexHeldSeconds
  let vortexFired: number | null = null

  if (input.vortexHeld && vortexCooldown <= 0) {
    vortexHeldSeconds = Math.min(
      vortexHeldSeconds + dt, c.vortex.maxChargeSeconds,
    )
  }

  if (input.vortexReleased) {
    if (vortexHeldSeconds >= c.vortex.minChargeSeconds) {
      const charge = vortexCharge(vortexHeldSeconds, c.vortex)
      const caught = new Set(
        vortexTargets(input.playerPosition, enemies, charge, c.vortex).map((e) => e.id),
      )
      enemies = enemies.map((enemy) =>
        caught.has(enemy.id) && !isDowned(enemy.health)
          // Zero damage: the move is setup. hitEnemy still interrupts, which is
          // what a control move should do to a wind-up.
          ? hitEnemy(enemy, 0, vortexImpulse(
              input.playerPosition, enemy.position, charge, c.vortex,
            ))
          : enemy)
      vortexFired = charge
      vortexCooldown = c.vortex.cooldownSeconds
    }
    // Either way the charge is spent. A release below the minimum costs nothing,
    // so a mistaken tap is not punished with a 3.5 second cooldown.
    vortexHeldSeconds = 0
  }
```

Include `vortexHeldSeconds` and `vortexCooldown` in the returned encounter, and `vortexFired`
in the returned step.

- [ ] **Step 4: Add the input**

`InputState` in `src/core/types.ts`:

```ts
  /** R held: charging a vortex. */
  vortexHeld: boolean
  /** R, edge-triggered on key-up: release the vortex. */
  vortexReleased: boolean
```

In `src/core/input.ts`, add `vortexHeld: held.has('KeyR')` to `toInputState`, a
`vortexReleased` field on the class initialised `false`, `if (e.code === 'KeyR') this.vortexReleased = true`
in the `keyup` handler, and clear it in `sample()` alongside the other edges. Follow exactly
how `actionReleased` is already handled — it is the same shape of edge.

- [ ] **Step 5: Wire the game**

In `src/main.ts`, pass `vortexHeld: state.vortexHeld` and `vortexReleased: state.vortexReleased`
into the `stepEncounter` input.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts src/core/types.ts src/core/input.ts src/main.ts
git commit -m "Charge and fire a Vortex from the fight"
```

---

### Task 6: The Slipstream

**Files:**
- Create: `src/player/slipstream.ts`
- Modify: `src/core/config.ts` (add `DEFAULT_SLIPSTREAM_CONFIG`)
- Test: `src/player/slipstream.test.ts`

**Interfaces:**
- Produces:
  - `export interface SlipstreamConfig { speed, durationSeconds, invulnerableSeconds, cooldownSeconds: number }`
  - `export interface SlipstreamState { elapsed: number | null; cooldown: number }`
  - `idleSlipstream(): SlipstreamState`
  - `canSlipstream(state: SlipstreamState): boolean`
  - `isInvulnerable(state: SlipstreamState, c: SlipstreamConfig): boolean`
  - `stepSlipstream(state, pressed: boolean, heading: Vector3, dt: number, c: SlipstreamConfig): { state: SlipstreamState; impulse: Vector3 | null }`
  - `slipstreamHeading(lookDirection: Vector3, forward: number, strafe: number): Vector3`
  - `DEFAULT_SLIPSTREAM_CONFIG` in `src/core/config.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/player/slipstream.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  idleSlipstream, canSlipstream, isInvulnerable, stepSlipstream, slipstreamHeading,
} from './slipstream'
import { DEFAULT_SLIPSTREAM_CONFIG as S } from '../core/config'

const NORTH = new Vector3(0, 0, -1)
const fire = () => stepSlipstream(idleSlipstream(), true, NORTH, 1 / 60, S)

/** Advance an active slipstream by `seconds` with no further presses. */
function advance(state = fire().state, seconds = 0): typeof state {
  let current = state
  for (let t = 0; t < seconds; t += 1 / 60) {
    current = stepSlipstream(current, false, NORTH, 1 / 60, S).state
  }
  return current
}

describe('stepSlipstream', () => {
  it('fires when available, with an impulse along the heading', () => {
    const { impulse } = fire()
    expect(impulse).not.toBeNull()
    expect(impulse?.z).toBeCloseTo(-S.speed, 5)
  })

  it('is invulnerable the moment it fires', () => {
    expect(isInvulnerable(fire().state, S)).toBe(true)
  })

  it('stops being invulnerable while still dashing', () => {
    // The window is SHORTER than the dash, and that is what makes the timing tight:
    // you stay committed to a direction after the protection ends. A test that only
    // checked invulnerability at t=0 would pass against a move that is invulnerable
    // for its whole duration.
    const midway = advance(undefined, (S.invulnerableSeconds + S.durationSeconds) / 2)
    expect(midway.elapsed).not.toBeNull()
    expect(isInvulnerable(midway, S)).toBe(false)
  })

  it('ends after its duration', () => {
    expect(advance(undefined, S.durationSeconds + 0.05).elapsed).toBeNull()
  })

  it('cannot fire again while on cooldown', () => {
    const spent = advance(undefined, S.durationSeconds + 0.05)
    expect(spent.cooldown).toBeGreaterThan(0)
    expect(canSlipstream(spent)).toBe(false)
    expect(stepSlipstream(spent, true, NORTH, 1 / 60, S).impulse).toBeNull()
  })

  it('is available again once the cooldown expires', () => {
    expect(canSlipstream(advance(undefined, S.cooldownSeconds + 0.05))).toBe(true)
  })

  it('cannot fire twice inside one dash', () => {
    const active = fire().state
    expect(stepSlipstream(active, true, NORTH, 1 / 60, S).impulse).toBeNull()
  })

  it('flattens the heading, so looking up does not launch you', () => {
    const impulse = stepSlipstream(
      idleSlipstream(), true, new Vector3(0, 5, -1), 1 / 60, S,
    ).impulse
    expect(impulse?.y).toBe(0)
  })

  it('falls back to a fixed direction rather than producing NaN', () => {
    const impulse = stepSlipstream(
      idleSlipstream(), true, new Vector3(0, 1, 0), 1 / 60, S,
    ).impulse
    expect(Number.isFinite(impulse?.x)).toBe(true)
    expect(impulse?.length()).toBeCloseTo(S.speed, 5)
  })
})

describe('slipstreamHeading', () => {
  it('uses the look direction when no movement is held', () => {
    expect(slipstreamHeading(NORTH, 0, 0).z).toBeCloseTo(-1, 5)
  })

  it('dodges sideways when strafe is held', () => {
    // A dodge has to be able to go somewhere other than where you are looking.
    expect(slipstreamHeading(NORTH, 0, 1).x).toBeCloseTo(1, 5)
  })

  it('dodges backwards when back is held', () => {
    expect(slipstreamHeading(NORTH, -1, 0).z).toBeCloseTo(1, 5)
  })

  it('stays normalised on a diagonal', () => {
    expect(slipstreamHeading(NORTH, 1, 1).length()).toBeCloseTo(1, 5)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/player/slipstream.test.ts
```

Expected: FAIL — neither the module nor `DEFAULT_SLIPSTREAM_CONFIG` exists.

- [ ] **Step 3: Implement the module**

Create `src/player/slipstream.ts`:

```ts
import { Vector3 } from 'three'

/**
 * Slipstream: a directional dash with a brief invulnerability window.
 *
 * The design doc calls it "the dodge, upgraded", and files it under combat while the
 * blast dash in `dash.ts` sits under movement — they are different tools. The blast
 * dash is ground-only and chains three times; this works in both postures and is
 * limited by a single cooldown.
 *
 * The invulnerable window is deliberately shorter than the dash. That is what makes
 * the timing tight: the move keeps displacing you after the protection has ended, so
 * a mistimed dodge leaves you committed to a direction with nothing to show for it.
 */
export interface SlipstreamConfig {
  speed: number
  durationSeconds: number
  /** Measured from the start, and shorter than `durationSeconds`. */
  invulnerableSeconds: number
  cooldownSeconds: number
}

export interface SlipstreamState {
  /** Seconds since it fired, or null when not slipstreaming. */
  elapsed: number | null
  cooldown: number
}

export function idleSlipstream(): SlipstreamState {
  return { elapsed: null, cooldown: 0 }
}

/** Not already dashing, and off cooldown. */
export function canSlipstream(state: SlipstreamState): boolean {
  return state.elapsed === null && state.cooldown <= 0
}

export function isInvulnerable(state: SlipstreamState, c: SlipstreamConfig): boolean {
  return state.elapsed !== null && state.elapsed < c.invulnerableSeconds
}

/**
 * Where a dodge should go: the movement keys when they are held, and the camera
 * otherwise. The same rule `groundStep` applies to a standing dash, so a player who
 * has stopped to aim dodges where they are looking.
 */
export function slipstreamHeading(
  lookDirection: Vector3, forward: number, strafe: number,
): Vector3 {
  const flat = new Vector3(lookDirection.x, 0, lookDirection.z)
  const facing = flat.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : flat.normalize()
  if (Math.abs(forward) < 0.01 && Math.abs(strafe) < 0.01) return facing
  const right = new Vector3().crossVectors(facing, new Vector3(0, 1, 0)).normalize()
  const move = facing.clone().multiplyScalar(forward).addScaledVector(right, strafe)
  return move.lengthSq() < 1e-8 ? facing : move.normalize()
}

/**
 * Advance the dodge. The impulse is returned rather than applied, the same contract
 * `stepDash` uses, so movement code stays in charge of integration.
 */
export function stepSlipstream(
  state: SlipstreamState,
  pressed: boolean,
  heading: Vector3,
  dt: number,
  c: SlipstreamConfig,
): { state: SlipstreamState; impulse: Vector3 | null } {
  if (pressed && canSlipstream(state)) {
    const flat = new Vector3(heading.x, 0, heading.z)
    const direction = flat.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : flat.normalize()
    return {
      state: { elapsed: 0, cooldown: c.cooldownSeconds },
      impulse: direction.multiplyScalar(c.speed),
    }
  }

  const cooldown = Math.max(0, state.cooldown - dt)
  if (state.elapsed === null) return { state: { elapsed: null, cooldown }, impulse: null }

  const elapsed = state.elapsed + dt
  return {
    state: { elapsed: elapsed >= c.durationSeconds ? null : elapsed, cooldown },
    impulse: null,
  }
}
```

- [ ] **Step 4: Add the config**

In `src/core/config.ts`:

```ts
/**
 * Slipstream. The window is 0.11s inside an enemy telegraph of 0.55s
 * (`windUpSeconds`), so beating a strike takes real timing rather than a mash.
 */
export const DEFAULT_SLIPSTREAM_CONFIG: SlipstreamConfig = {
  // A shade faster than the blast dash's 26: this one is bought with a cooldown
  // rather than being the everyday traversal tool.
  speed: 30,
  durationSeconds: 0.2,
  invulnerableSeconds: 0.11,
  cooldownSeconds: 1.5,
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/player/slipstream.test.ts
```

Expected: PASS, all thirteen.

- [ ] **Step 6: Red-proof the window test**

"Stops being invulnerable while still dashing" is the test that pins the move's whole
character. Prove it can fail: temporarily change `isInvulnerable` to
`return state.elapsed !== null` — invulnerable for the entire dash.

```bash
npx vitest run src/player/slipstream.test.ts
```

Expected: FAIL on that test. Restore the line BY HAND, then re-run to confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add src/player/slipstream.ts src/player/slipstream.test.ts src/core/config.ts
git commit -m "Add the Slipstream: a dodge with a tight window"
```

---

### Task 7: Slipstream in the player controller

**Files:**
- Modify: `src/player/controller.ts`
- Modify: `src/core/types.ts` (`PlayerState`, `InputState`), `src/core/input.ts` (the `C` key)
- Modify: `src/main.ts` (pass the config in `deps`)
- Test: `src/player/controller.test.ts`

**Interfaces:**
- Consumes: `stepSlipstream`, `slipstreamHeading`, `idleSlipstream`, `SlipstreamConfig` from Task 6.
- Produces:
  - `PlayerState` gains `slipstreamElapsed: number | null` and `slipstreamCooldown: number`
  - `InputState` gains `slipstreamPressed: boolean`
  - `ControllerDeps` gains `slipstream: SlipstreamConfig`

- [ ] **Step 1: Write the failing tests**

Add to `src/player/controller.test.ts`. That file has `player()` and `input()` fixture helpers
and a `deps()` helper — extend all three (the fixtures need the two new player fields and the
new input field; `deps()` needs `slipstream: DEFAULT_SLIPSTREAM_CONFIG`).

```ts
describe('slipstream', () => {
  it('adds speed on the ground', () => {
    const standing = player()
    const dodged = controllerStep(
      standing, input({ slipstreamPressed: true }), 1 / 60, deps(flatGround),
    )
    expect(dodged.velocity.length()).toBeGreaterThan(DEFAULT_SLIPSTREAM_CONFIG.speed / 2)
    expect(dodged.slipstreamElapsed).not.toBeNull()
  })

  it('works in the glider too, unlike the blast dash', () => {
    // The reason it is a separate move: the dash is ground-only, and a dodge you
    // cannot use while gliding is no use against anything in the air.
    const flying = player({
      mode: 'glider', position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, 0, -20),
    })
    const dodged = controllerStep(
      flying, input({ slipstreamPressed: true }), 1 / 60, deps(voidWorld),
    )
    expect(dodged.slipstreamElapsed).not.toBeNull()
    expect(dodged.velocity.length()).toBeGreaterThan(flying.velocity.length())
  })

  it('respects the cooldown', () => {
    let s = controllerStep(player(), input({ slipstreamPressed: true }), 1 / 60, deps(flatGround))
    const firstSpeed = s.velocity.length()
    // Run past the dash's duration but not its cooldown.
    for (let t = 0; t < DEFAULT_SLIPSTREAM_CONFIG.durationSeconds + 0.1; t += 1 / 60) {
      s = controllerStep(s, input(), 1 / 60, deps(flatGround))
    }
    const before = s.velocity.length()
    const again = controllerStep(s, input({ slipstreamPressed: true }), 1 / 60, deps(flatGround))
    expect(again.velocity.length()).toBeLessThan(before + firstSpeed / 2)
  })

  it('clears on respawn', () => {
    // A NaN respawn mid-dodge must not carry an invulnerability window into the
    // fresh state, which would hand out free protection after a crash.
    const broken = player({ position: new Vector3(Number.NaN, 0, 0), slipstreamElapsed: 0.05 })
    expect(controllerStep(broken, input(), 1 / 60, deps(flatGround)).slipstreamElapsed).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/player/controller.test.ts
```

Expected: FAIL — the player fields, the input field and the deps entry do not exist.

- [ ] **Step 3: Add the state and input**

`PlayerState` in `src/core/types.ts`:

```ts
  /** Seconds since a slipstream fired, or null when not slipstreaming. */
  slipstreamElapsed: number | null
  /** Seconds of slipstream cooldown still owed. */
  slipstreamCooldown: number
```

`InputState`:

```ts
  /** C, edge-triggered: a slipstream dodge. */
  slipstreamPressed: boolean
```

In `src/core/input.ts`, add `slipstreamPressed` exactly the way `dashPressed` is handled — a
field on the class, set on `keydown` for `KeyC` when `!e.repeat`, read into `toInputState`, and
cleared in `sample()`.

Initialise `slipstreamElapsed: null, slipstreamCooldown: 0` everywhere a `PlayerState` is
constructed in `src/player/controller.ts` — there are two such places (the resting state and
`respawn`), and the respawn one is what makes the "clears on respawn" test pass.

- [ ] **Step 4: Run it in the controller**

`ControllerDeps` gains:

```ts
  slipstream: SlipstreamConfig
```

In `controllerStep`, after `next` has been computed by either branch and before it is returned,
add the dodge. It goes here rather than inside `groundStep` because the move works in both
postures, and `groundStep` only runs in one:

```ts
  // Applied after the posture branches, because a dodge is available in both and the
  // impulse is the same in each: a burst added to whatever velocity movement produced.
  const slip = stepSlipstream(
    { elapsed: next.slipstreamElapsed, cooldown: next.slipstreamCooldown },
    input.slipstreamPressed,
    slipstreamHeading(input.lookDirection, input.forward, input.strafe),
    dt,
    deps.slipstream,
  )
  next = {
    ...next,
    slipstreamElapsed: slip.state.elapsed,
    slipstreamCooldown: slip.state.cooldown,
    velocity: slip.impulse ? next.velocity.clone().add(slip.impulse) : next.velocity,
  }
```

Make sure this runs on every path that returns a stepped state, but **not** on the respawn
path — a respawn returns early, and its fresh state already has the fields cleared.

- [ ] **Step 5: Wire the game**

In `src/main.ts`, add `slipstream: DEFAULT_SLIPSTREAM_CONFIG` to the controller deps object
(import it from `./core/config`), and nothing else — the input already flows through `state`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
```

Expected: all green. Several fixture files will need the two new `PlayerState` fields added;
that is expected mechanical work, not a design decision.

- [ ] **Step 7: Commit**

```bash
git add src/player/controller.ts src/player/controller.test.ts src/core/types.ts src/core/input.ts src/main.ts
git commit -m "Fire a Slipstream from either posture"
```

---

### Task 8: Invulnerability, and Focus for a dodge

**Files:**
- Modify: `src/combat/encounter.ts`, `src/focus/focus.ts`, `src/focus/config.ts`
- Modify: `src/main.ts`
- Test: `src/combat/encounter.test.ts`, `src/focus/focus.test.ts`

**Interfaces:**
- Consumes: `isInvulnerable` from Task 6.
- Produces:
  - `EncounterInput` gains `playerInvulnerable: boolean`
  - `EncounterStep` gains `damageAvoided: boolean`
  - `FocusEvents` gains `damageAvoided: boolean`; `noFocusEvents()` includes it
  - `FocusConfig` gains `dodgeGain: number`

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/encounter.test.ts`. Its defaults object needs `playerInvulnerable: false`.

```ts
describe('invulnerability', () => {
  /** Step until the enemy's strike would land, returning every step. */
  const untilStrike = (invulnerable: boolean) => {
    let encounter = startEncounter(
      [{ id: 'a', position: new Vector3(1, 0, 0) }], DEFAULT_COMBAT_CONFIG,
    )
    const steps = []
    for (let t = 0; t < 3; t += 1 / 60) {
      const step = stepEncounter(
        encounter, { ...defaults, playerInvulnerable: invulnerable },
        1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      )
      encounter = step.encounter
      steps.push(step)
    }
    return { encounter, steps }
  }

  it('takes the hit when not invulnerable', () => {
    // The control for the test below: without it, "no damage" proves nothing.
    const { encounter } = untilStrike(false)
    expect(encounter.playerHealth.current).toBeLessThan(DEFAULT_COMBAT_CONFIG.player.maxHealth)
  })

  it('discards the damage when invulnerable', () => {
    const { encounter } = untilStrike(true)
    expect(encounter.playerHealth.current).toBeCloseTo(DEFAULT_COMBAT_CONFIG.player.maxHealth, 5)
  })

  it('reports the dodge, and does not report a hit', () => {
    const { steps } = untilStrike(true)
    expect(steps.some((s) => s.damageAvoided)).toBe(true)
    expect(steps.some((s) => s.playerHit)).toBe(false)
  })

  it('reports no dodge when there was no damage to avoid', () => {
    // The anti-farming rule. A flag meaning "invulnerable this frame" would let a
    // player build Focus by dodging an empty field, turning section 4.5's reward for
    // skill into a grind.
    let encounter = startEncounter([], DEFAULT_COMBAT_CONFIG)
    for (let t = 0; t < 1; t += 1 / 60) {
      const step = stepEncounter(
        encounter, { ...defaults, playerInvulnerable: true }, 1 / 60, DEFAULT_COMBAT_CONFIG, DEPS,
      )
      encounter = step.encounter
      expect(step.damageAvoided).toBe(false)
    }
  })

  it('still costs the attacker its wind-up', () => {
    // A dodge beats the attack; it does not erase it. The enemy commits and recovers.
    const { encounter } = untilStrike(true)
    expect(['recover', 'advance']).toContain(encounter.enemies[0]?.stance)
  })
})
```

Add to `src/focus/focus.test.ts` (reuse its existing config and event helpers):

```ts
describe('focus from a dodge', () => {
  it('grants for damage avoided', () => {
    const dodged = stepFocus(
      emptyFocus(C), { ratePerSecond: 0, events: { ...noFocusEvents(), damageAvoided: true }, frozen: false, reset: false },
      1 / 60, C,
    )
    expect(dodged.value).toBeGreaterThan(0)
  })

  it('grants nothing without the event', () => {
    const nothing = stepFocus(
      emptyFocus(C), { ratePerSecond: 0, events: noFocusEvents(), frozen: false, reset: false },
      1 / 60, C,
    )
    expect(nothing.value).toBe(0)
  })

  it('keeps a chain alive where taking the hit would break it', () => {
    // Section 4.5 builds Focus from unbroken chains, and a dodge is how a chain
    // survives an attack. Being hit resets chainTime; avoiding must not.
    const built = { value: 40, max: C.maxFocus, chainTime: 5 }
    const dodged = stepFocus(
      built, { ratePerSecond: 0, events: { ...noFocusEvents(), damageAvoided: true }, frozen: false, reset: false },
      1 / 60, C,
    )
    const hit = stepFocus(
      built, { ratePerSecond: 0, events: { ...noFocusEvents(), playerHit: true }, frozen: false, reset: false },
      1 / 60, C,
    )
    expect(dodged.chainTime).toBeGreaterThan(built.chainTime)
    expect(hit.chainTime).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/combat/encounter.test.ts src/focus/focus.test.ts
```

Expected: FAIL — `playerInvulnerable`, `damageAvoided` and `dodgeGain` do not exist.

- [ ] **Step 3: Implement the seam**

`EncounterInput` gains:

```ts
  /** The player is inside a slipstream's invulnerable window. */
  playerInvulnerable: boolean
```

`EncounterStep` gains:

```ts
  /**
   * Damage was incoming and was discarded. NOT "the player is invulnerable" — a flag
   * meaning that would let a player farm Focus by dodging nothing.
   */
  damageAvoided: boolean
```

Replace the damage application in `stepEncounter`:

```ts
  // Avoided only counts when something was actually coming.
  const avoided = input.playerInvulnerable && damageToPlayer > 0
  const applied = avoided ? 0 : damageToPlayer

  const hurt = applied > 0 ? applyDamage(encounter.playerHealth, applied) : encounter.playerHealth
  const playerHealth = stepHealth(hurt, dt, c.player)
```

and return `damageAvoided: avoided` with `playerHit: applied > 0`.

- [ ] **Step 4: Implement the Focus gain**

`FocusEvents` gains `damageAvoided: boolean`, `noFocusEvents()` returns it as `false`, and
`FocusConfig` gains:

```ts
  /** Focus for a dodge that beat an incoming hit. */
  dodgeGain: number
```

In `stepFocus`, add it to the event group that is already multiplied by the chain ramp, so a
dodge inside a long clean chain is worth more than a cold one — which is what section 4.5's
"unbroken chains" means:

```ts
  value += (events.gustConnects * c.gustConnectGain + events.downs * c.downGain
    + events.slamStrength * c.slamGainAtFullImpact
    + (events.damageAvoided ? c.dodgeGain : 0)) * ramp
```

In `src/focus/config.ts`:

```ts
  // Above gustConnectGain (6) and below downGain (14): avoiding a hit is worth more
  // than landing one and less than putting someone down.
  dodgeGain: 8,
```

- [ ] **Step 5: Wire the game**

In `src/main.ts`:
- import `isInvulnerable` from `./player/slipstream`
- pass `playerInvulnerable: isInvulnerable({ elapsed: player.slipstreamElapsed, cooldown: player.slipstreamCooldown }, DEFAULT_SLIPSTREAM_CONFIG)` into the `stepEncounter` input
- add `damageAvoided: fight.damageAvoided` to the Focus events object already assembled there

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
```

Expected: all green.

- [ ] **Step 7: Red-proof the anti-farming test**

Prove it can fail: temporarily change the seam to `const avoided = input.playerInvulnerable`.

```bash
npx vitest run src/combat/encounter.test.ts
```

Expected: FAIL on "reports no dodge when there was no damage to avoid". Restore BY HAND and
re-run.

- [ ] **Step 8: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts src/focus/focus.ts src/focus/focus.test.ts src/focus/config.ts src/main.ts
git commit -m "Dodge a hit, and earn Focus for it"
```

---

### Task 9: The Vortex is visible

**Files:**
- Create: `src/fx/vortex-ring.ts`, `src/fx/vortex-charge.ts`
- Test: `src/fx/vortex-ring.test.ts`, `src/fx/vortex-charge.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Effect` from `src/fx/effect.ts`; `vortexRadius` and `VortexConfig` from Task 4; `EncounterStep.vortexFired` from Task 5.
- Produces:
  - `createVortexRing(origin: Vector3, radius: number): Effect`
  - `export interface VortexChargeTell { object: Object3D; update(dt: number, heldSeconds: number, c: VortexConfig): void; dispose(): void }` and `createVortexChargeTell(): VortexChargeTell`

- [ ] **Step 1: Write the failing tests**

Create `src/fx/vortex-ring.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { createVortexRing } from './vortex-ring'
import type { Effect } from './effect'

const AT = new Vector3(3, 10, -4)

function mesh(effect: Effect): Mesh {
  if (!(effect.object instanceof Mesh)) throw new Error('expected a mesh')
  return effect.object
}

describe('createVortexRing', () => {
  it('starts at the radius it was given', () => {
    // The honesty rule this repo follows for the gust cone: the drawn size is the
    // size that was actually caught, so a pull outside the ring reads as a bug.
    expect(mesh(createVortexRing(AT, 9)).scale.x).toBeCloseTo(9, 3)
  })

  it('sweeps inward rather than outward', () => {
    // A vortex gathers. An expanding ring would read as a blast.
    const ring = createVortexRing(AT, 9)
    const start = mesh(ring).scale.x
    ring.advance(0.1)
    expect(mesh(ring).scale.x).toBeLessThan(start)
  })

  it('keeps a positive scale all the way in', () => {
    // A zero scale is a degenerate matrix.
    const ring = createVortexRing(AT, 9)
    ring.advance(10)
    expect(mesh(ring).scale.x).toBeGreaterThan(0)
  })

  it('runs and then finishes', () => {
    const ring = createVortexRing(AT, 9)
    expect(ring.advance(0.01)).toBe(true)
    expect(ring.advance(5)).toBe(false)
  })

  it('casts no shadow', () => {
    expect(mesh(createVortexRing(AT, 9)).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    expect(() => createVortexRing(AT, 9).dispose()).not.toThrow()
  })
})
```

Create `src/fx/vortex-charge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Mesh } from 'three'
import { createVortexChargeTell } from './vortex-charge'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const V = DEFAULT_COMBAT_CONFIG.vortex

function ring(tell: { object: { children: unknown[] } }): Mesh {
  const first = tell.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected a mesh')
  return first
}

describe('createVortexChargeTell', () => {
  it('is hidden when nothing is charging', () => {
    const tell = createVortexChargeTell()
    tell.update(1 / 60, 0, V)
    expect(tell.object.visible).toBe(false)
  })

  it('appears once a charge is being held', () => {
    const tell = createVortexChargeTell()
    tell.update(1 / 60, V.minChargeSeconds, V)
    expect(tell.object.visible).toBe(true)
  })

  it('shows the radius the release will actually cover', () => {
    // The charge has to be legible before it is spent, not after.
    const tell = createVortexChargeTell()
    tell.update(1 / 60, V.maxChargeSeconds, V)
    const full = ring(tell).scale.x
    tell.update(1 / 60, V.minChargeSeconds, V)
    expect(full).toBeGreaterThan(ring(tell).scale.x)
    expect(full).toBeCloseTo(V.maxRadius, 1)
  })

  it('disposes without throwing', () => {
    expect(() => createVortexChargeTell().dispose()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/fx/vortex-ring.test.ts src/fx/vortex-charge.test.ts
```

Expected: FAIL — neither module exists.

- [ ] **Step 3: Implement the release ring**

Create `src/fx/vortex-ring.ts`. Follow `src/fx/shockwave.ts` closely — it is the same shape of
object, a scaled unit ring, and this one differs only in sweeping inward:

```ts
import { DoubleSide, MathUtils, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three'
import type { Effect } from './effect'

/**
 * The air a Vortex gathers, drawn at the radius it actually caught.
 *
 * Sweeps inward, which is the visual contrast with the Pressure Wave's ring going out:
 * one gathers a group, the other scatters it. Drawn at the true `vortexRadius` for the
 * same reason the gust cone is drawn at its true hit volume — a pull that reaches
 * outside the visible ring reads as a bug.
 */
const LIFETIME = 0.45
const THICKNESS = 0.3
/** How far in the ring travels: not to nothing, so it stays legible as it closes. */
const END_FRACTION = 0.15
const HEIGHT = 0.6
const TINT = 0x9fd9ff
const OPACITY = 0.75

export function createVortexRing(origin: Vector3, radius: number): Effect {
  const geometry = new RingGeometry(1 - THICKNESS, 1, 48)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: OPACITY,
    // Drawn over the world, matching the other attack effects: a flat ring near the
    // ground is otherwise buried by any slope.
    depthTest: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.copy(origin)
  mesh.position.y += HEIGHT
  mesh.userData.excludeFromShadows = true

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    mesh.scale.setScalar(Math.max(MathUtils.lerp(radius, radius * END_FRACTION, t), 1e-4))
    material.opacity = OPACITY * (1 - t * t)
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

- [ ] **Step 4: Implement the charge tell**

Create `src/fx/vortex-charge.ts`. This one is persistent rather than one-shot, so it follows
`src/fx/avatar-aura.ts`'s shape instead of `Effect`:

```ts
import {
  DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, RingGeometry, type Object3D,
} from 'three'
import { vortexRadius, vortexCharge, type VortexConfig } from '../combat/vortex'

/**
 * The ring that shows what a held Vortex will catch.
 *
 * A charged move whose reach is invisible until it fires cannot be aimed, and this repo
 * treats a mechanic the player cannot see as a bug. Persistent rather than an `Effect`
 * because it lives as long as the button is held, which is not a one-shot.
 */
export interface VortexChargeTell {
  object: Object3D
  /** Call every frame with how long the charge has been held. */
  update(dt: number, heldSeconds: number, c: VortexConfig): void
  dispose(): void
}

const THICKNESS = 0.06
const HEIGHT = 0.5
const TINT = 0x9fd9ff
const PEAK_OPACITY = 0.55

export function createVortexChargeTell(): VortexChargeTell {
  const object = new Group()
  const geometry = new RingGeometry(1 - THICKNESS, 1, 64)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: PEAK_OPACITY, depthTest: false,
  })
  const ring = new Mesh(geometry, material)
  ring.rotation.x = -Math.PI / 2
  ring.userData.excludeFromShadows = true
  object.add(ring)
  object.position.y = HEIGHT
  object.visible = false

  return {
    object,
    update(_dt: number, heldSeconds: number, c: VortexConfig): void {
      object.visible = heldSeconds > 0
      if (!object.visible) return
      const charge = vortexCharge(heldSeconds, c)
      ring.scale.setScalar(Math.max(vortexRadius(charge, c), 1e-4))
      // Brightens as it fills, so the moment it is worth releasing is visible.
      material.opacity = PEAK_OPACITY * MathUtils.lerp(0.45, 1, charge)
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 5: Wire both into the game**

In `src/main.ts`:
- create one `createVortexChargeTell()` and add its `object` as a child of `avatar.object`, the
  way the Avatar State aura is attached
- call `chargeTell.update(dt, encounter.vortexHeldSeconds, fightConfig.vortex)` each frame
- after `stepEncounter`, when `fight.vortexFired !== null`, add a ring:

```ts
    if (fight.vortexFired !== null) {
      effects.add(createVortexRing(
        player.position, vortexRadius(fight.vortexFired, fightConfig.vortex),
      ))
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/fx/vortex-ring.ts src/fx/vortex-ring.test.ts src/fx/vortex-charge.ts src/fx/vortex-charge.test.ts src/main.ts
git commit -m "Draw the Vortex: a charge ring and an inward sweep"
```

---

### Task 10: The Slipstream is visible

**Files:**
- Create: `src/fx/slipstream-trail.ts`, `src/fx/guard-shell.ts`
- Test: `src/fx/slipstream-trail.test.ts`, `src/fx/guard-shell.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Effect` from `src/fx/effect.ts`; `SlipstreamConfig` from Task 6.
- Produces:
  - `createSlipstreamTrail(origin: Vector3, heading: Vector3, c: SlipstreamConfig): Effect`
  - `export interface GuardShell { object: Object3D; update(dt: number, active: boolean): void; dispose(): void }` and `createGuardShell(): GuardShell`

- [ ] **Step 1: Write the failing tests**

Create `src/fx/slipstream-trail.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { createSlipstreamTrail } from './slipstream-trail'
import { DEFAULT_SLIPSTREAM_CONFIG as S } from '../core/config'
import type { Effect } from './effect'

const AT = new Vector3(2, 8, -3)
const NORTH = new Vector3(0, 0, -1)

function mesh(effect: Effect): Mesh {
  if (!(effect.object instanceof Mesh)) throw new Error('expected a mesh')
  return effect.object
}

describe('createSlipstreamTrail', () => {
  it('is as long as the dash actually travels', () => {
    // Derived from config rather than a chosen number, so retuning the dash retunes
    // the streak with it.
    const trail = createSlipstreamTrail(AT, NORTH, S)
    expect(mesh(trail).scale.z).toBeCloseTo(S.speed * S.durationSeconds, 0)
  })

  it('does not alias the position it was handed', () => {
    const at = AT.clone()
    createSlipstreamTrail(at, NORTH, S)
    expect(at.toArray()).toEqual(AT.toArray())
  })

  it('fades out', () => {
    const trail = createSlipstreamTrail(AT, NORTH, S)
    const material = mesh(trail).material
    if (Array.isArray(material)) throw new Error('expected one material')
    const start = material.opacity
    trail.advance(0.1)
    expect(material.opacity).toBeLessThan(start)
  })

  it('runs and then finishes', () => {
    const trail = createSlipstreamTrail(AT, NORTH, S)
    expect(trail.advance(0.01)).toBe(true)
    expect(trail.advance(5)).toBe(false)
  })

  it('casts no shadow', () => {
    expect(mesh(createSlipstreamTrail(AT, NORTH, S)).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    expect(() => createSlipstreamTrail(AT, NORTH, S).dispose()).not.toThrow()
  })
})
```

Create `src/fx/guard-shell.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Mesh } from 'three'
import { createGuardShell } from './guard-shell'

function shell(guard: { object: { children: unknown[] } }): Mesh {
  const first = guard.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected a mesh')
  return first
}

function opacity(guard: { object: { children: unknown[] } }): number {
  const material = shell(guard).material
  if (Array.isArray(material)) throw new Error('expected one material')
  return material.opacity
}

describe('createGuardShell', () => {
  it('is invisible before anything happens', () => {
    const guard = createGuardShell()
    guard.update(1 / 60, false)
    expect(guard.object.visible).toBe(false)
  })

  it('appears while the window is open', () => {
    const guard = createGuardShell()
    guard.update(1 / 60, true)
    expect(guard.object.visible).toBe(true)
    expect(opacity(guard)).toBeGreaterThan(0)
  })

  it('goes away once the window closes', () => {
    // The window IS the mechanic, so a shell that outlived it would lie about when
    // the player was actually protected.
    const guard = createGuardShell()
    for (let t = 0; t < 0.1; t += 1 / 60) guard.update(1 / 60, true)
    for (let t = 0; t < 0.5; t += 1 / 60) guard.update(1 / 60, false)
    expect(guard.object.visible).toBe(false)
  })

  it('disposes without throwing', () => {
    expect(() => createGuardShell().dispose()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/fx/slipstream-trail.test.ts src/fx/guard-shell.test.ts
```

Expected: FAIL — neither module exists.

- [ ] **Step 3: Implement the trail**

Create `src/fx/slipstream-trail.ts`, following `src/fx/dash-trail.ts` — read it first; this is
the same idea with its own tint and a length taken from the slipstream's own config:

```ts
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import type { SlipstreamConfig } from '../player/slipstream'
import type { Effect } from './effect'

/**
 * The streak a Slipstream leaves.
 *
 * A cooler, sharper tint than the dash trail, because the two moves must not be
 * confused: one is traversal, the other is the dodge you bet a hit on.
 */
const LIFETIME = 0.26
const WIDTH = 0.5
const TALL = 1.5
const TINT = 0xc9f2ff
const OPACITY = 0.7

export function createSlipstreamTrail(
  origin: Vector3, heading: Vector3, c: SlipstreamConfig,
): Effect {
  // Length is what the dash actually covers, so the streak cannot claim ground the
  // move does not reach.
  const length = Math.max(c.speed * c.durationSeconds, 1e-4)
  const geometry = new BoxGeometry(WIDTH, TALL, 1)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, depthWrite: false, opacity: OPACITY, depthTest: false,
  })
  const mesh = new Mesh(geometry, material)
  // Copied before the offset, because the caller passes the player's live position.
  mesh.position.copy(origin)
  mesh.position.y += TALL / 2
  mesh.scale.z = length

  const flat = new Vector3(heading.x, 0, heading.z)
  if (flat.lengthSq() > 1e-8) {
    mesh.lookAt(mesh.position.clone().add(flat.normalize()))
  }
  mesh.userData.excludeFromShadows = true

  let age = 0

  return {
    object: mesh,
    advance(dt: number): boolean {
      age += dt
      material.opacity = OPACITY * Math.max(0, 1 - age / LIFETIME)
      return age < LIFETIME
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 4: Implement the guard shell**

Create `src/fx/guard-shell.ts`, following `src/fx/avatar-aura.ts`:

```ts
import {
  BackSide, Group, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, type Object3D,
} from 'three'

/**
 * The shell shown while a Slipstream's invulnerability window is open.
 *
 * The window is the entire mechanic, and it is 0.11 seconds long — so the tell has to
 * track it exactly. A shell that lingered would tell the player they were protected
 * when they were not, which is worse than no tell at all.
 */
export interface GuardShell {
  object: Object3D
  /** Call every frame with whether the window is open. */
  update(dt: number, active: boolean): void
  dispose(): void
}

const RADIUS = 1.15
/** Centred on the body, since the avatar's origin is at its feet. */
const CENTRE_Y = 0.95
const TINT = 0xd6f6ff
const PEAK_OPACITY = 0.4
/** Fast, because the window itself is brief. A slow fade would overstate it. */
const FADE_SECONDS = 0.08

export function createGuardShell(): GuardShell {
  const object = new Group()
  const geometry = new SphereGeometry(RADIUS, 20, 14)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, side: BackSide, depthWrite: false, opacity: 0,
  })
  const shell = new Mesh(geometry, material)
  shell.userData.excludeFromShadows = true
  object.add(shell)
  object.position.y = CENTRE_Y
  object.visible = false

  let shown = 0

  return {
    object,
    update(dt: number, active: boolean): void {
      const target = active ? 1 : 0
      const step = FADE_SECONDS > 0 ? dt / FADE_SECONDS : 1
      shown = active
        ? Math.min(target, shown + step)
        : Math.max(target, shown - step)
      material.opacity = PEAK_OPACITY * MathUtils.clamp(shown, 0, 1)
      object.visible = shown > 0.001
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 5: Wire both into the game**

In `src/main.ts`:
- create one `createGuardShell()` and add its `object` to `avatar.object`, like the aura
- each frame, `guard.update(dt, isInvulnerable({ elapsed: player.slipstreamElapsed, cooldown: player.slipstreamCooldown }, DEFAULT_SLIPSTREAM_CONFIG))`
- fire the trail on the frame a slipstream starts, detected the way the dash trail already
  detects a new dash — by comparing against the pre-step player:

```ts
    if (player.slipstreamElapsed !== null && beforeStep.slipstreamElapsed === null) {
      effects.add(createSlipstreamTrail(
        beforeStep.position, player.velocity, DEFAULT_SLIPSTREAM_CONFIG,
      ))
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
npx vite build
```

Expected: all green, build clean.

- [ ] **Step 7: Commit**

```bash
git add src/fx/slipstream-trail.ts src/fx/slipstream-trail.test.ts src/fx/guard-shell.ts src/fx/guard-shell.test.ts src/main.ts
git commit -m "Draw the Slipstream: a streak and the guard window"
```

---

### Task 11: Document both moves

**Files:**
- Modify: `src/ui/guide/actions.ts`, `README.md`, `docs/HANDOFF.md`
- Test: the existing guide drift test (`src/ui/guide/actions.test.ts` — find it and read what it asserts)

**Interfaces:**
- Consumes: `canSlipstream` from Task 6, `canVortex` from Task 5.

- [ ] **Step 1: Read the drift test first**

```bash
npx vitest run src/ui/guide
```

A test binds `ACTIONS`'s keys to the README's controls table in **both** directions, so adding
a key to one and not the other fails. Read it before editing either file so you know the exact
format it parses.

- [ ] **Step 2: Add both moves to the catalogue**

`ActionContext` gains two booleans, passed in rather than computed — the same reasoning the
existing `gustReady` carries, since both live on structs a UI module has no business knowing:

```ts
  /** A vortex is off cooldown. The caller asks `canVortex`. */
  vortexReady: boolean
  /** A slipstream is off cooldown and not already running. The caller asks `canSlipstream`. */
  slipstreamReady: boolean
```

Add to `ACTIONS`:

```ts
  {
    key: 'R', press: 'hold, then release', name: 'Vortex', mode: 'both',
    available: (ctx) => ctx.vortexReady,
    detail: 'Hold to gather a charge, release to pull everyone near you inward and lift '
      + 'them off their feet. It does no damage at all — a lifted soldier simply cannot '
      + 'act, which is the opening. Charging longer widens the reach and throws them higher. '
      + 'Releasing early cancels for free.',
  },
  {
    key: 'C', name: 'Slipstream', mode: 'both',
    available: (ctx) => ctx.slipstreamReady,
    detail: 'A dash that cannot be hit for the first instant of it. The window is shorter '
      + 'than the dash, so it beats an attack you can see coming rather than everything. '
      + 'Timed right it also builds Focus.',
  },
```

- [ ] **Step 3: Update the README controls table**

Add rows for `R` (Vortex) and `C` (Slipstream), spelling the keys exactly as the catalogue
does, in the same table the drift test reads.

- [ ] **Step 4: Wire the guide's context in `src/main.ts`**

Pass `vortexReady: canVortex(encounter)` and
`slipstreamReady: canSlipstream({ elapsed: player.slipstreamElapsed, cooldown: player.slipstreamCooldown })`
wherever the guide context is built.

- [ ] **Step 5: Run the suite**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit
```

Expected: all green, including the drift test.

- [ ] **Step 6: Verify both moves in the running game**

Tests cannot show whether a 0.11s window is dodgeable or a 1.2s charge feels worth holding.
Start the preview and play it.

The preview pane reports `document.visibilityState === 'hidden'`, so `requestAnimationFrame`
is suspended and the game will look frozen. Drive it with a synthetic clock — the technique is
documented under "The preview pane's animation loop" in `docs/HANDOFF.md`. Install the hook,
take one screenshot so the loop re-registers through it, then drive frames.

Confirm by eye and by measurement:

- Holding `R` shows a ring that grows, and releasing pulls nearby soldiers **inward** and up.
- A lifted soldier comes back down and lands, rather than hanging in the air.
- A lifted soldier does not strike while airborne, and does once it lands.
- Gusting a soldier no longer leaves it floating — this is the bug fix; measure its y before
  and several seconds after.
- `C` dashes with a visible shell, and the shell disappears well before the dash ends.
- A well-timed `C` into an incoming spear takes no damage and the Focus meter rises.

Record what you saw. If something is present but unreadable or unusable — a charge ring too
faint to aim with, a window too short to hit — say so rather than reporting the geometry as
correct. That exact failure has happened in this repo before, with the gust cone, where every
geometry test passed while nothing was visible on screen.

- [ ] **Step 7: Update the handoff**

Add both moves to `docs/HANDOFF.md` beside the other combat sections, and record the enemy
gravity fix explicitly — including that gust and Pressure Wave used to levitate soldiers
permanently, since that is a behaviour change a future reader will otherwise be surprised by.
Update the repo-state line's test and file counts. State plainly what was confirmed on screen
and what was not.

```bash
git add docs/HANDOFF.md README.md src/ui/guide/actions.ts src/main.ts
git commit -m "Document the Vortex and the Slipstream"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task. Enemy gravity, the ground snap, the float
regression, fall-out downing and the downed-body fall are Task 1; inert-while-airborne is
Task 2; the encounter plumbing is Task 3; the Vortex module and its config are Task 4; charge,
cancel-below-minimum, cooldown and the `R` key are Task 5; the Slipstream module, its heading
rule and its config are Task 6; the controller integration, `PlayerState` fields and the `C`
key are Task 7; the invulnerability seam, the anti-farming rule and the Focus gain are Task 8;
the four visuals are Tasks 9 and 10; the guide, README and handoff are Task 11. The spec's
"Out of scope" list needs no task.

**Placeholders.** None. Every code step carries its code, every test step its assertions, and
each of the four red-proofs names the exact line to change and the exact test that must fail.

**Type consistency.** Checked across tasks: `GroundHeightQuery`, `Enemy.verticalVelocity`,
`Enemy.grounded`, `EnemyConfig.gravity`, `stepEnemy(enemy, playerPosition, ground, worldFloorY, dt, c)`,
`EncounterDeps`, `stepEncounter(encounter, input, dt, c, deps)`, `VortexConfig`,
`vortexCharge`, `vortexRadius`, `vortexTargets`, `vortexImpulse`, `canVortex`,
`Encounter.vortexHeldSeconds`, `Encounter.vortexCooldown`, `EncounterInput.vortexHeld`,
`EncounterInput.vortexReleased`, `EncounterInput.playerInvulnerable`,
`EncounterStep.vortexFired`, `EncounterStep.damageAvoided`, `SlipstreamConfig`,
`SlipstreamState.elapsed`, `SlipstreamState.cooldown`, `idleSlipstream`, `canSlipstream`,
`isInvulnerable`, `stepSlipstream`, `slipstreamHeading`, `PlayerState.slipstreamElapsed`,
`PlayerState.slipstreamCooldown`, `InputState.slipstreamPressed`, `ControllerDeps.slipstream`,
`FocusEvents.damageAvoided`, `FocusConfig.dodgeGain`, `DEFAULT_SLIPSTREAM_CONFIG`,
`createVortexRing`, `createVortexChargeTell`, `createSlipstreamTrail`, `createGuardShell` —
each is spelled identically everywhere it appears.

**One deliberate ordering choice.** Task 1 leaves `src/combat/encounter.ts` non-compiling
until Task 3, because `stepEnemy`'s arity changes. The alternative — a temporary default
parameter — would be dead code by Task 3 and could silently keep a caller on a fake ground
query. Task 1's step 8 and Task 3's step 4 both say so, so no implementer mistakes it for a
mistake.

**Test counts are deliberately not predicted.** Two earlier plans in this repo stated expected
totals and got the arithmetic wrong, and an implementer nearly padded a test to match. Each
task says "all green" instead.
