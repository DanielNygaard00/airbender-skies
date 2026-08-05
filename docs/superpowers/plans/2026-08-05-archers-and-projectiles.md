# Archers and projectiles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second enemy type that shoots, so that altitude — the axis this whole game is built around — is finally contested.

**Architecture:** One state machine, not two. The spear's thrust and the archer's shot are the same four beats already in `stepEnemy`; the config says what a release produces, and the single divergent branch is that a projectile attacker measures reach in 3D rather than horizontally. Arrows are straight-line, owned by the `Encounter`, and their damage joins the same total the spears already feed — so a Slipstream dodges an arrow with no new code.

**Tech Stack:** TypeScript 7, three.js 0.185.1, Vitest 4 (node environment), Vite 8.

Spec: [`docs/superpowers/specs/2026-08-05-archers-and-projectiles-design.md`](../specs/2026-08-05-archers-and-projectiles-design.md)

## Global Constraints

- **Branch is `archers-projectiles`. Never commit to `main`** — pushing `main` triggers the GitHub Pages deploy.
- **Typecheck is two passes:** `npm run typecheck` runs `tsconfig.json` then `tsconfig.test.json`. Run it after every task.
- **`noUncheckedIndexedAccess` is on.** Indexed access is `T | undefined` — this matters more than usual here, because `CombatConfig.enemies` becomes a `Record<EnemyKind, EnemyConfig>` and indexing it returns `EnemyConfig | undefined` unless the key type is exact.
- **Red-proof every test.** After writing a test, neutralise the feature and confirm it goes red. If it stays green the test is decorative. Across the last two cycles this repo's own plans shipped five defects that only implementers' arithmetic caught — do not assume a fixture produces the state it claims.
- **Verify fixture arithmetic before trusting it.** At `speed` 34 and `dt` 1/60 an arrow moves 0.567 units a frame, so a target 5 units away is 9 frames out, not one. Three fixtures in the last two cycles asserted events that never occurred.
- **Assert intended literals, never the config the code reads.** `expect(damage).toBe(c.attack.damage)` passes for any value.
- **No bare `>` for "materially bigger" claims.** Assert a margin.
- **`facing` stays horizontal.** `Enemy.facing` drives the rig's yaw through `Math.atan2(facing.x, facing.z)` in `enemy-mesh.ts`, which reads only x and z. Making it 3D to match a shot direction would change nothing visible while breaking the invariant every mesh test rests on. The aim is 3D; the facing is not.
- **Struct widening — the verified blast radius.** `strikeDamage` → `attack` breaks every `EnemyConfig` literal. Grepped, five sites: `src/combat/config.ts:29`, `src/combat/enemy.test.ts:12`, `src/combat/encounter.test.ts:15`, `src/combat/patrol.test.ts:13`, `src/combat/gust.test.ts:13`. Plus the definition at `enemy.ts:66` and its single use at `enemy.ts:266`. **Re-grep rather than trusting this list** — a file list in this project's plans has been wrong nine times, most recently missing 12 of 15 `glider.update` call sites.
- **Run one test file with** `npx vitest run src/path/to/file.test.ts`. Everything: `npm test`. The branch starts at **1158 tests across 79 files**.
- **Prose in code, comments, commits and docs is normal English.** Explain *why*; mark regression guards as such.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/combat/enemy.ts` (mod) | `EnemyKind`, `EnemyAttack`, `Enemy.kind`, `EnemyStep.firedProjectile`, and the 3D-reach branch. |
| `src/combat/projectile.ts` (new) | An arrow: spawn it, step it, decide when it is gone. |
| `src/combat/config.ts` (mod) | Per-kind enemy configs, the archer's numbers, the projectile config, and a mixed `HOME_PATROL`. |
| `src/combat/encounter.ts` (mod) | Owns the projectile list; picks each enemy's config by kind; steps arrows before spawning new ones. |
| `src/combat/enemy-mesh.ts` (mod) | `createEnemyView(kind)` — an archer holds a bow. |
| `src/fx/arrow.ts` (new) | The arrow you can see. Persistent, one per projectile. |
| `src/fx/combat-audio.ts` (mod) | A `bowRelease` voice — the release is the telegraph. |
| `src/fx/mapping.ts` (mod) | Its level, where the mix is testable. |
| `src/main.ts` (mod) | Wiring, and per-projectile views keyed by id. |
| `docs/HANDOFF.md` (mod) | New sections and honest caveats. |

---

### Task 1: The attack becomes a description, and reach learns about height

**Files:**
- Modify: `src/combat/enemy.ts`
- Modify: `src/combat/config.ts:29`, `src/combat/enemy.test.ts:12`, `src/combat/encounter.test.ts:15`, `src/combat/patrol.test.ts:13`, `src/combat/gust.test.ts:13`
- Test: `src/combat/enemy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EnemyKind = 'spear' | 'archer'`, `EnemyAttack = { kind: 'melee'; damage: number } | { kind: 'projectile'; damage: number; speed: number }`, `EnemyConfig.attack: EnemyAttack` (replacing `strikeDamage`), `Enemy.kind: EnemyKind`, `spawnEnemy(id: string, position: Vector3, kind: EnemyKind, c: EnemyConfig): Enemy`, `EnemyStep.firedProjectile: { origin: Vector3; direction: Vector3 } | null`.

This task keeps `CombatConfig.enemy` singular and every spawn a `'spear'`. Task 3 introduces the archer. So after this task the game behaves **exactly** as before — that is the point, and the pre-existing tests are the proof.

- [ ] **Step 1: Write the failing test**

Add to `src/combat/enemy.test.ts`. Read the top of that file first and use its real fixture names; the snippet below assumes a helper that spawns at a position and a local config `C`.

```ts
describe('a melee attack reaches horizontally, as it always has', () => {
  it('thrusts at a player just in reach', () => {
    // The existing behaviour, restated so the refactor cannot quietly change it.
    const near = { ...enemy(), position: new Vector3(0, 0, 0), stance: 'wind-up' as const, stanceTime: 999 }
    const step = stepEnemy(near, new Vector3(0, 0, -2), flatGround, FLOOR, 1 / 60, C)
    expect(step.damageToPlayer).toBeGreaterThan(0)
    expect(step.firedProjectile).toBe(null)
  })

  it('still thrusts at a player almost directly overhead', () => {
    // A spear's reach is horizontal and must stay so: 2 units away, 20 units up is a
    // hit today, and this refactor must not turn it into a miss.
    const near = { ...enemy(), position: new Vector3(0, 0, 0), stance: 'wind-up' as const, stanceTime: 999 }
    const step = stepEnemy(near, new Vector3(0, 20, -2), flatGround, FLOOR, 1 / 60, C)
    expect(step.damageToPlayer).toBeGreaterThan(0)
  })
})

describe('a projectile attack reaches in three dimensions', () => {
  // A deliberately distinct strikeRange from anything shipped, so an assertion that
  // accidentally read the real config instead of this one would be visible.
  const ARCHER: EnemyConfig = {
    ...C,
    strikeRange: 30,
    aggroRange: 60,
    attack: { kind: 'projectile', damage: 0.4, speed: 20 },
  }

  it('fires at a player inside its range', () => {
    const archer = { ...enemy(), kind: 'archer' as const, position: new Vector3(0, 0, 0), stance: 'wind-up' as const, stanceTime: 999 }
    const step = stepEnemy(archer, new Vector3(0, 0, -10), flatGround, FLOOR, 1 / 60, ARCHER)
    expect(step.firedProjectile).not.toBe(null)
    // The arrow carries the damage, not this frame.
    expect(step.damageToPlayer).toBe(0)
  })

  it('does NOT fire at a player overhead beyond its range', () => {
    // The whole point of the type. Horizontal distance here is 0, so under the old
    // horizontal-only measurement this would be inside ANY range and the archer would
    // be inescapable by climbing. True distance is 40, outside the 30 above.
    const archer = { ...enemy(), kind: 'archer' as const, position: new Vector3(0, 0, 0), stance: 'wind-up' as const, stanceTime: 999 }
    const step = stepEnemy(archer, new Vector3(0, 40, 0), flatGround, FLOOR, 1 / 60, ARCHER)
    expect(step.firedProjectile).toBe(null)
  })

  it('does fire at a player overhead inside its range', () => {
    // The other half: height is not a magic shield, only distance is.
    const archer = { ...enemy(), kind: 'archer' as const, position: new Vector3(0, 0, 0), stance: 'wind-up' as const, stanceTime: 999 }
    const step = stepEnemy(archer, new Vector3(0, 20, 0), flatGround, FLOOR, 1 / 60, ARCHER)
    expect(step.firedProjectile).not.toBe(null)
  })

  it('aims in 3D, so a shot at a hovering player climbs', () => {
    const archer = { ...enemy(), kind: 'archer' as const, position: new Vector3(0, 0, 0), stance: 'wind-up' as const, stanceTime: 999 }
    const step = stepEnemy(archer, new Vector3(0, 20, -10), flatGround, FLOOR, 1 / 60, ARCHER)
    const shot = step.firedProjectile
    if (!shot) throw new Error('the archer should have fired')
    // A flattened direction would have y exactly 0, which is the bug this catches.
    expect(shot.direction.y).toBeGreaterThan(0.5)
    expect(shot.direction.length()).toBeCloseTo(1, 5)
  })

  it('leaves facing horizontal even when aiming up', () => {
    // facing drives the rig's yaw via atan2(x, z) and must stay a horizontal heading.
    const archer = { ...enemy(), kind: 'archer' as const, position: new Vector3(0, 0, 0), stance: 'wind-up' as const, stanceTime: 999 }
    const step = stepEnemy(archer, new Vector3(0, 40, -10), flatGround, FLOOR, 1 / 60, ARCHER)
    expect(step.enemy.facing.y).toBe(0)
  })

  it('notices in three dimensions too', () => {
    // aggroRange must be 3D for the same reason strikeRange is: a player hovering
    // overhead is at horizontal distance 0 and would otherwise always be noticed,
    // however high. 60 is this fixture's aggroRange, so 80 up is outside it and the
    // archer should hold station rather than close.
    const archer = { ...enemy(), kind: 'archer' as const, position: new Vector3(5, 0, 5), stance: 'advance' as const }
    const step = stepEnemy(archer, new Vector3(5, 80, 5), flatGround, FLOOR, 1 / 60, ARCHER)
    expect(step.enemy.position.x).toBeCloseTo(5)
    expect(step.enemy.position.z).toBeCloseTo(5)
  })
})
```

Map the fixture names onto whatever `enemy.test.ts` really uses. `stance: 'wind-up'` with a large `stanceTime` is how you reach the release branch in one step — verify that against the file's own `C.windUpSeconds` rather than assuming 999 clears it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/enemy.test.ts`
Expected: FAIL — `attack` is not a property of `EnemyConfig`, `kind` is not on `Enemy`, `firedProjectile` is not on `EnemyStep`.

- [ ] **Step 3: Add the types**

In `src/combat/enemy.ts`, above `EnemyConfig`:

```ts
/**
 * Which soldier this is.
 *
 * Identity, not behaviour — the behaviour lives in `EnemyAttack` below. Kept separate
 * because the view layer and the per-kind config lookup both need to know *which* type
 * they are looking at, and two types could one day share an attack shape.
 */
export type EnemyKind = 'spear' | 'archer'

/**
 * What a release produces.
 *
 * The spear's thrust and the archer's shot are the same four beats — advance, wind up,
 * release, recover — so there is one state machine and this says what the release does.
 * A discriminated union of whole enemies would be the right answer if the design
 * document's six types diverged sharply, but four of them do not exist yet.
 */
export type EnemyAttack =
  | { kind: 'melee'; damage: number }
  | { kind: 'projectile'; damage: number; speed: number }
```

Replace `strikeDamage: number` in `EnemyConfig` with:

```ts
  /**
   * What this soldier's release does. Damage lives here rather than beside it, so a
   * projectile's damage is not split between the enemy and the arrow it fires.
   */
  attack: EnemyAttack
```

Add to `Enemy`:

```ts
  /** Which soldier this is. The caller uses it to pick the right config. */
  kind: EnemyKind
```

Add to `EnemyStep`:

```ts
  /**
   * A shot loosed this frame, or null.
   *
   * Reported rather than resolved for the same reason `damageToPlayer` is: this function
   * advances one enemy and knows nothing about the projectile list or the player's
   * health. Carries only origin and direction — speed and damage come from the config
   * the caller already holds, so nothing is decided twice.
   */
  firedProjectile: { origin: Vector3; direction: Vector3 } | null
```

- [ ] **Step 4: Take a kind at spawn**

```ts
export function spawnEnemy(
  id: string, position: Vector3, kind: EnemyKind, c: EnemyConfig,
): Enemy {
```

and add `kind,` to the returned object. Update the two calls in `src/combat/encounter.ts` (in `startEncounter` and in the patrol restore) to pass `'spear'` for now — Task 3 makes them read the spawn's kind.

- [ ] **Step 5: Add `firedProjectile: null` to the other returns**

`stepEnemy` has five returns. Four of them — parked, below-floor, already-downed, airborne-and-inert — report `firedProjectile: null`. The fifth is the main one, below.

- [ ] **Step 6: Branch the reach and the release**

Replace the block currently at `enemy.ts:243-273`:

```ts
  const toPlayer = horizontalTo(moved.position, playerPosition)
  // A spear cannot reach up and an arrow can, so the two measure differently. This is
  // the only place the two types genuinely diverge, and it is the whole reason an archer
  // pressures altitude: measured horizontally, a player hovering directly overhead sits
  // at distance 0 and would be inside any range, so climbing would stop being an escape.
  const ranged = c.attack.kind === 'projectile'
  const distance = ranged
    ? moved.position.distanceTo(playerPosition)
    : horizontalDistance(moved.position, playerPosition)
  const stanceTime = enemy.stanceTime + dt
  let damageToPlayer = 0
  let firedProjectile: EnemyStep['firedProjectile'] = null
  let stance: Stance = enemy.stance
  let position = moved.position
  let time = stanceTime

  if (enemy.stance === 'advance') {
    if (distance > c.aggroRange) {
      // Out of notice range: hold station rather than trailing the player home.
      position = moved.position
    } else if (distance <= c.strikeRange) {
      stance = 'wind-up'
      time = 0
    } else {
      // Closes only horizontally, whichever type it is: infantry does not chase into the
      // sky, and an archer does not need to — it shoots upward instead.
      position = moved.position.clone().addScaledVector(toPlayer, c.moveSpeed * dt)
    }
  } else if (enemy.stance === 'wind-up') {
    if (stanceTime >= c.windUpSeconds) {
      // The release lands only if the player is still in reach — which is what makes the
      // telegraph a real dodge window rather than decoration.
      if (distance <= c.strikeRange) {
        if (c.attack.kind === 'melee') {
          damageToPlayer = c.attack.damage
        } else {
          // Aimed in 3D, unlike `facing` below: the arrow has to climb to a hovering
          // player. Shot from the soldier's chest rather than its feet, since the
          // position is at ground level.
          const origin = moved.position.clone().setY(moved.position.y + SHOT_HEIGHT)
          firedProjectile = { origin, direction: playerPosition.clone().sub(origin).normalize() }
        }
      }
      stance = 'recover'
      time = 0
    }
  } else if (stanceTime >= c.recoverSeconds) {
    stance = 'advance'
    time = 0
  }

  return {
    enemy: {
      ...enemy, ...moved, position, facing: toPlayer, stance, stanceTime: time,
    },
    damageToPlayer,
    firedProjectile,
    fellOutOfWorld: false,
  }
```

with, beside the module's other constants:

```ts
/** Chest height, so an arrow leaves the archer rather than the ground it stands on. */
const SHOT_HEIGHT = 1.1
```

`facing` remains `toPlayer`, which `horizontalTo` already flattens — that is deliberate and there is a test for it.

- [ ] **Step 7: Fix the five config fixtures**

Each currently has `strikeDamage: 1`. Replace with `attack: { kind: 'melee', damage: 1 }`:

`src/combat/config.ts:29`, `src/combat/enemy.test.ts:12`, `src/combat/encounter.test.ts:15`, `src/combat/patrol.test.ts:13`, `src/combat/gust.test.ts:13`.

Then `grep -rn 'strikeDamage' src` and confirm the only remaining hits are ones you intended. Also `grep -rn 'spawnEnemy(' src` and fix every call for the new argument — including in tests, where `patrol.test.ts` builds enemies from it.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. **Every pre-existing test must pass unchanged** — this task is a refactor plus an unused code path, so a changed assertion anywhere is a real finding. Stop and report rather than adjusting one.

- [ ] **Step 9: Red-proof the 3D reach**

Change `const ranged = c.attack.kind === 'projectile'` to `const ranged = false`.

Run: `npx vitest run src/combat/enemy.test.ts`
Expected: FAIL on "does NOT fire at a player overhead beyond its range" and "notices in three dimensions too". The melee tests must stay GREEN — if they go red, the horizontal path has been broken. Revert and confirm PASS.

- [ ] **Step 10: Typecheck and commit**

```bash
npm run typecheck
git add src/combat/enemy.ts src/combat/enemy.test.ts src/combat/config.ts src/combat/encounter.ts src/combat/encounter.test.ts src/combat/patrol.test.ts src/combat/gust.test.ts
git commit -m "Describe an enemy's attack, and let a ranged one measure reach in three dimensions"
```

---

### Task 2: The arrow

**Files:**
- Create: `src/combat/projectile.ts`
- Test: `src/combat/projectile.test.ts`

**Interfaces:**
- Consumes: `GroundHeightQuery` from `src/combat/enemy.ts`.
- Produces: `Projectile { id, position, velocity, damage, age }`, `ProjectileConfig { hitRadius, maxSeconds }`, `ProjectileStep { projectile: Projectile | null; damageToPlayer: number }`, `spawnProjectile(id, origin, direction, damage, speed): Projectile`, `stepProjectile(p, playerPosition, ground, dt, c): ProjectileStep`.

- [ ] **Step 1: Write the failing test**

`src/combat/projectile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  spawnProjectile, stepProjectile, type ProjectileConfig,
} from './projectile'

// Deliberately unlike anything shipped, so an assertion reading the real config instead
// of this one would be visible.
const C: ProjectileConfig = { hitRadius: 1, maxSeconds: 2 }

const flatGround = { groundHeightAt: () => 0 }
const noGround = { groundHeightAt: () => null }
const NORTH = new Vector3(0, 0, -1)
const DT = 1 / 60

/** An arrow at the origin heading north at 20 units a second. */
const arrow = () => spawnProjectile('a1', new Vector3(0, 5, 0), NORTH, 0.4, 20)

describe('flight', () => {
  it('carries the damage and speed it was given', () => {
    const p = arrow()
    // Literals, not the arguments echoed back.
    expect(p.damage).toBeCloseTo(0.4)
    expect(p.velocity.length()).toBeCloseTo(20)
    expect(p.age).toBe(0)
  })

  it('normalises a direction that was not already unit length', () => {
    const p = spawnProjectile('a1', new Vector3(), new Vector3(0, 0, -7), 1, 20)
    expect(p.velocity.length()).toBeCloseTo(20)
  })

  it('travels in a straight line at constant speed', () => {
    // No gravity: a straight line is easier to read as a threat and needs no leading.
    let p = arrow()
    for (let i = 0; i < 30; i++) {
      const step = stepProjectile(p, new Vector3(500, 500, 500), noGround, DT, C)
      if (!step.projectile) throw new Error('the arrow should still be flying')
      p = step.projectile
    }
    // 30 frames at 20 units/sec is 10 units. Derived, not guessed.
    expect(p.position.z).toBeCloseTo(-10, 2)
    expect(p.position.y).toBeCloseTo(5, 5)
    expect(p.velocity.length()).toBeCloseTo(20)
  })
})

describe('ending', () => {
  it('hits a player it reaches, and reports the damage once', () => {
    // 2 units ahead at 20 units/sec is 6 frames out. Verified: 20/60 = 0.333 a frame.
    let p = arrow()
    let hits = 0
    let total = 0
    for (let i = 0; i < 20; i++) {
      const step = stepProjectile(p, new Vector3(0, 5, -2), noGround, DT, C)
      total += step.damageToPlayer
      if (step.damageToPlayer > 0) hits++
      if (!step.projectile) break
      p = step.projectile
    }
    expect(hits).toBe(1)
    expect(total).toBeCloseTo(0.4)
  })

  it('is gone on the frame it hits', () => {
    let p = arrow()
    for (let i = 0; i < 20; i++) {
      const step = stepProjectile(p, new Vector3(0, 5, -2), noGround, DT, C)
      if (step.damageToPlayer > 0) {
        expect(step.projectile).toBe(null)
        return
      }
      if (!step.projectile) throw new Error('gone without hitting')
      p = step.projectile
    }
    throw new Error('never hit')
  })

  it('misses a player outside the hit radius', () => {
    // 3 units to the side, against a hitRadius of 1.
    let p = arrow()
    let total = 0
    for (let i = 0; i < 40; i++) {
      const step = stepProjectile(p, new Vector3(3, 5, -2), noGround, DT, C)
      total += step.damageToPlayer
      if (!step.projectile) break
      p = step.projectile
    }
    expect(total).toBe(0)
  })

  it('ends at terrain height', () => {
    // Fired downward from y 5 onto ground at 0.
    let p = spawnProjectile('a1', new Vector3(0, 5, 0), new Vector3(0, -1, 0), 0.4, 20)
    let alive = 0
    for (let i = 0; i < 60; i++) {
      const step = stepProjectile(p, new Vector3(500, 500, 500), flatGround, DT, C)
      if (!step.projectile) break
      p = step.projectile
      alive++
    }
    // 5 units down at 20 units/sec is 15 frames. It must end near there, not fly on.
    expect(alive).toBeGreaterThan(10)
    expect(alive).toBeLessThan(20)
  })

  it('flies on where there is no ground at all', () => {
    // Over the void between islands, groundHeightAt returns null.
    let p = spawnProjectile('a1', new Vector3(0, 5, 0), new Vector3(0, -1, 0), 0.4, 20)
    for (let i = 0; i < 60; i++) {
      const step = stepProjectile(p, new Vector3(500, 500, 500), noGround, DT, C)
      if (!step.projectile) throw new Error('ended over the void, with no ground to end on')
      p = step.projectile
    }
    expect(p.position.y).toBeLessThan(-10)
  })

  it('expires after its lifetime rather than flying forever', () => {
    let p = arrow()
    let frames = 0
    for (let i = 0; i < 1000; i++) {
      const step = stepProjectile(p, new Vector3(500, 500, 500), noGround, DT, C)
      frames++
      if (!step.projectile) break
      p = step.projectile
    }
    // maxSeconds 2 at 60 frames a second. A literal, not C.maxSeconds * 60.
    expect(frames).toBeGreaterThan(115)
    expect(frames).toBeLessThan(125)
  })

  it('hits a player standing on the ground rather than being swallowed by it', () => {
    // The case that distinguishes the two end conditions. An arrow arriving at a player
    // who is standing at ground level: testing the ground first reports nothing, testing
    // the player first reports the hit. A player in mid-air cannot tell them apart.
    let p = spawnProjectile('a1', new Vector3(0, 0.2, 0), NORTH, 0.4, 20)
    let total = 0
    for (let i = 0; i < 30; i++) {
      const step = stepProjectile(p, new Vector3(0, 0.2, -2), flatGround, DT, C)
      total += step.damageToPlayer
      if (!step.projectile) break
      p = step.projectile
    }
    expect(total).toBeCloseTo(0.4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/projectile.test.ts`
Expected: FAIL — cannot resolve `./projectile`.

- [ ] **Step 3: Write the module**

`src/combat/projectile.ts`:

```ts
import { Vector3 } from 'three'
import type { GroundHeightQuery } from './enemy'

/**
 * An arrow in flight.
 *
 * Straight-line, with no gravity. A falling arrow would need an archer that leads a
 * moving target, and a straight one is easier both to read as a threat and to test.
 * Drop is a later config addition if it feels flat, not a redesign.
 */
export interface Projectile {
  id: string
  position: Vector3
  velocity: Vector3
  damage: number
  /** Seconds alive, so a stray arrow cannot outlive the encounter that fired it. */
  age: number
}

export interface ProjectileConfig {
  /** How close to the player's centre counts as a hit. */
  hitRadius: number
  maxSeconds: number
}

export interface ProjectileStep {
  /** null once it is gone: it hit, it reached the ground, or it expired. */
  projectile: Projectile | null
  damageToPlayer: number
}

export function spawnProjectile(
  id: string, origin: Vector3, direction: Vector3, damage: number, speed: number,
): Projectile {
  // Normalised here rather than trusting the caller, so a direction built from a
  // subtraction cannot silently become a speed multiplier.
  const heading = direction.clone()
  if (heading.lengthSq() > 1e-8) heading.normalize()
  return {
    id,
    position: origin.clone(),
    velocity: heading.multiplyScalar(speed),
    damage,
    age: 0,
  }
}

/**
 * Advance one arrow.
 *
 * Three ways to end, and the order matters: the player is tested **before** the ground,
 * so an arrow arriving at a player standing at ground level is not swallowed by the
 * terrain test on the same frame.
 */
export function stepProjectile(
  p: Projectile,
  playerPosition: Vector3,
  ground: GroundHeightQuery,
  dt: number,
  c: ProjectileConfig,
): ProjectileStep {
  const position = p.position.clone().addScaledVector(p.velocity, dt)
  const age = p.age + dt

  if (position.distanceTo(playerPosition) <= c.hitRadius) {
    return { projectile: null, damageToPlayer: p.damage }
  }

  // A null height is the void between islands, where there is nothing to stop an arrow.
  const height = ground.groundHeightAt(position.x, position.z)
  if (height !== null && position.y <= height) return { projectile: null, damageToPlayer: 0 }

  if (age >= c.maxSeconds) return { projectile: null, damageToPlayer: 0 }

  return { projectile: { ...p, position, age }, damageToPlayer: 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/combat/projectile.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-proof the hit-before-ground order**

Move the ground check above the player check.

Run: `npx vitest run src/combat/projectile.test.ts`
Expected: FAIL on "hits a player standing on the ground rather than being swallowed by it". If any *other* test also fails, say which — that would mean a second test depends on the order and the coverage is less targeted than intended. Revert and confirm PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/combat/projectile.ts src/combat/projectile.test.ts
git commit -m "Add the arrow: straight flight, and three ways to stop"
```

---

### Task 3: Two kinds of soldier, and the archer's numbers

**Files:**
- Modify: `src/combat/config.ts`, `src/combat/encounter.ts`
- Test: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `EnemyKind`, `EnemyAttack`, `spawnEnemy(id, position, kind, c)` from Task 1; `ProjectileConfig` from Task 2.
- Produces: `CombatConfig.enemies: Record<EnemyKind, EnemyConfig>` (replacing `enemy`), `CombatConfig.projectile: ProjectileConfig`, `EnemySpawn.kind: EnemyKind`, `DEFAULT_PATROL_CONFIG` unchanged, and a `HOME_PATROL` of three spears plus two archers.

- [ ] **Step 1: Write the failing test**

Add to `src/combat/encounter.test.ts`. That file's `C` is a local `CombatConfig` and its `DEPS` carries an empty `spawns` list — read both before editing.

```ts
describe('a mixed patrol', () => {
  const MIXED: EnemySpawn[] = [
    { id: 'spear-1', position: new Vector3(0, 0, -2), kind: 'spear' },
    { id: 'archer-1', position: new Vector3(0, 0, -20), kind: 'archer' },
  ]

  it('spawns each soldier as its own kind', () => {
    const encounter = startEncounter(MIXED, C)
    expect(encounter.enemies.map((e) => e.kind)).toEqual(['spear', 'archer'])
  })

  it('gives each kind its own health', () => {
    // The two configs differ, so this catches both being built from one of them.
    const encounter = startEncounter(MIXED, C)
    const [spear, archer] = encounter.enemies
    if (!spear || !archer) throw new Error('fixture')
    expect(spear.health.max).toBeCloseTo(C.enemies.spear.maxHealth)
    expect(archer.health.max).toBeCloseTo(C.enemies.archer.maxHealth)
    // And a margin, so a config where the two happen to match would not pass vacuously.
    expect(archer.health.max).toBeLessThan(spear.health.max * 0.95)
  })

  it('restores each soldier as its own kind', () => {
    // The restore builds fresh enemies from the spawn list, so it has to read the kind
    // there too rather than defaulting everything to a spear.
    const withPatrol = { ...DEPS, spawns: MIXED, patrol: { respawnRange: 40 } }
    let encounter = startEncounter(MIXED, C)
    encounter = {
      ...encounter,
      enemies: encounter.enemies.map((e) => ({ ...e, health: { ...e.health, current: 0 } })),
    }
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const step = stepEncounter(encounter, away, 1 / 60, C, withPatrol)
    expect(step.restoredThisFrame.length).toBe(2)
    expect(step.encounter.enemies.map((e) => e.kind)).toEqual(['spear', 'archer'])
  })
})
```

Update the file's existing `C` to the new shape — `enemies: { spear: {...}, archer: {...} }` and a `projectile` block — and its `EnemySpawn` literals to carry `kind: 'spear'`. Give the archer fixture values distinct from the shipped ones.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — `enemies` is not a property of `CombatConfig`, `kind` is not a property of `EnemySpawn`.

- [ ] **Step 3: Widen the config and the spawn**

In `src/combat/encounter.ts`:

```ts
export interface CombatConfig {
  player: HealthConfig
  /**
   * One config per kind of soldier, rather than one config full stop.
   *
   * A Record keyed by `EnemyKind` rather than an array, so a missing kind is a
   * typecheck error at the point the config is written rather than an undefined at the
   * point a soldier spawns.
   */
  enemies: Record<EnemyKind, EnemyConfig>
  projectile: ProjectileConfig
  gust: GustConfig
  pressureWave: PressureWaveConfig
  vortex: VortexConfig
  staffArc: StaffArcConfig
}

export interface EnemySpawn {
  id: string
  position: Vector3
  kind: EnemyKind
}
```

Import `EnemyKind` from `./enemy` and `ProjectileConfig` from `./projectile`.

- [ ] **Step 4: Pick each soldier's config by kind**

In `startEncounter`:

```ts
    enemies: spawns.map((spawn) => spawnEnemy(
      spawn.id, spawn.position, spawn.kind, c.enemies[spawn.kind],
    )),
```

In the patrol restore at the end of `stepEncounter`, the same. And in the enemy-stepping loop, replace `c.enemy`:

```ts
    const step = stepEnemy(
      enemy, input.playerPosition, deps.ground, deps.worldFloorY, dt, c.enemies[enemy.kind],
    )
```

`Record<EnemyKind, EnemyConfig>` indexed by an `EnemyKind` is `EnemyConfig`, not `EnemyConfig | undefined`, so `noUncheckedIndexedAccess` is satisfied without a guard. Confirm that with the typecheck rather than assuming it.

- [ ] **Step 5: Write the shipped config**

In `src/combat/config.ts`, restructure `DEFAULT_COMBAT_CONFIG`'s `enemy` block into `enemies` with both kinds, and add `projectile`:

```ts
  enemies: {
    spear: {
      maxHealth: 1.5,
      outOfCombatSeconds: 6,
      // Enemies do not heal. Chipping one down over a long fight has to stay viable.
      regenPerSecond: 0,
      // Slower than a walk, so distance is always a real defence.
      moveSpeed: 4.2,
      strikeRange: 3.2,
      // Notices at 26 units: enough to be a threat on approach, short enough that
      // leaving the island leaves the fight behind.
      aggroRange: 26,
      windUpSeconds: 0.55,
      recoverSeconds: 0.7,
      attack: { kind: 'melee', damage: 1 },
      knockbackDamping: 2.6,
      gravity: 20,
      snapDistance: 1.2,
    },
    /**
     * The archer. Section 4.4 gives it altitude to pressure, and its numbers are the
     * inverse of the spear's: fragile, slower on its feet, and dangerous from far away.
     *
     * Both its ranges are measured in 3D by `stepEnemy`, which is what makes climbing
     * stop being a win condition. Before this type existed, getting above the spear's
     * 26 units ended any fight.
     */
    archer: {
      // Under the spear's 1.5: ranged and fragile. A staff opener at 0.7 plus anything
      // finishes one.
      maxHealth: 1.2,
      outOfCombatSeconds: 6,
      regenPerSecond: 0,
      // Slower than the spear's 4.2. It wants distance, not contact.
      moveSpeed: 3.4,
      // Its firing range, below aggroRange so it closes before shooting rather than
      // opening fire the instant it notices.
      strikeRange: 40,
      // Nearly double the spear's 26, and in 3D.
      aggroRange: 48,
      // Longer than the spear's 0.55: a draw is slower than a thrust, and this window
      // is the dodge.
      windUpSeconds: 0.8,
      // Longer than the spear's 0.7. The gap between shots is the opening to close.
      recoverSeconds: 1.1,
      // Same damage as a spear thrust. 34 units/sec crosses its 40-unit range in about
      // 1.2 seconds: fast enough to threaten, slow enough to see coming.
      attack: { kind: 'projectile', damage: 1, speed: 34 },
      knockbackDamping: 2.6,
      gravity: 20,
      snapDistance: 1.2,
    },
  },
  /**
   * Arrows. `hitRadius` is roughly half the character's 1.8 height — generous enough not
   * to feel arbitrary, tight enough that moving works. `maxSeconds` is well past the
   * archer's own range at 34 units/sec, so it is a backstop rather than a mechanic.
   */
  projectile: { hitRadius: 0.9, maxSeconds: 4 },
```

And give `HOME_PATROL` its kinds, with the archers set back:

```ts
/**
 * Where the first fight lives: on the home island, near the spawn.
 *
 * Three spears and two archers, with the archers further back, so the group has a shape
 * rather than being a blob. Section 4.4 builds encounters as combinations of types, and
 * this is the intended bind: close the distance and the spears punish you, hold back or
 * climb and the archers do.
 */
export const HOME_PATROL: EnemySpawn[] = [
  { id: 'spear-1', position: new Vector3(26, 0, -18), kind: 'spear' },
  { id: 'spear-2', position: new Vector3(34, 0, -8), kind: 'spear' },
  { id: 'spear-3', position: new Vector3(20, 0, -4), kind: 'spear' },
  { id: 'archer-1', position: new Vector3(40, 0, -24), kind: 'archer' },
  { id: 'archer-2', position: new Vector3(16, 0, -30), kind: 'archer' },
]
```

- [ ] **Step 6: Fix the remaining fixtures**

`grep -rn 'CombatConfig\|EnemySpawn' src --include='*.test.ts'` and update every literal. `patrol.test.ts` builds `EnemySpawn`s and an `EnemyConfig`; `gust.test.ts` builds an `EnemyConfig`. Then `grep -rn 'c\.enemy\b\|\.enemy\.' src` to confirm no reader of the old singular field survives.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, with every pre-existing test still passing. A changed assertion is a real finding — stop and report.

- [ ] **Step 8: Red-proof the per-kind lookup**

Change the enemy-stepping loop to `c.enemies.spear` regardless of kind.

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL on "gives each kind its own health" or the restore test. Revert and confirm PASS.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck
git add src/combat/config.ts src/combat/encounter.ts src/combat/encounter.test.ts src/combat/patrol.test.ts src/combat/gust.test.ts
git commit -m "Give each kind of soldier its own config, and put archers in the home patrol"
```

---

### Task 4: The fight owns the arrows

**Files:**
- Modify: `src/combat/encounter.ts`
- Test: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `spawnProjectile`, `stepProjectile`, `Projectile` from Task 2; `EnemyStep.firedProjectile` from Task 1.
- Produces: `Encounter.projectiles: Projectile[]`, `Encounter.nextProjectileId: number`, `EncounterStep.firedThisFrame: string[]` (projectile ids, not archer ids).

- [ ] **Step 1: Write the failing test**

Add to `src/combat/encounter.test.ts`:

```ts
describe('arrows in the fight', () => {
  const ARCHER_ONLY: EnemySpawn[] = [
    { id: 'archer-1', position: new Vector3(0, 0, -10), kind: 'archer' },
  ]
  const deps = { ...DEPS, spawns: [], patrol: { respawnRange: 40 } }

  /** Run until the archer looses its first arrow, or give up. */
  function untilFired(seconds = 6) {
    let encounter = startEncounter(ARCHER_ONLY, C)
    const frames = Math.round(seconds * 60)
    for (let i = 0; i < frames; i++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, deps)
      encounter = step.encounter
      if (step.firedThisFrame.length > 0) return { encounter, step, frame: i }
    }
    throw new Error('the archer never fired')
  }

  it('starts with no arrows', () => {
    expect(startEncounter(ARCHER_ONLY, C).projectiles).toEqual([])
  })

  it('reports a shot and puts an arrow in the air', () => {
    const { encounter, step } = untilFired()
    expect(step.firedThisFrame.length).toBe(1)
    expect(encounter.projectiles.length).toBe(1)
    // The reported id is the projectile's, not the archer's.
    expect(step.firedThisFrame[0]).toBe(encounter.projectiles[0]?.id)
    expect(step.firedThisFrame[0]).not.toBe('archer-1')
  })

  it('gives every arrow a distinct id', () => {
    let { encounter } = untilFired()
    const ids = new Set(encounter.projectiles.map((p) => p.id))
    for (let i = 0; i < 600; i++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, deps)
      encounter = step.encounter
      for (const id of step.firedThisFrame) {
        expect(ids.has(id), `id ${id} was reused`).toBe(false)
        ids.add(id)
      }
    }
    // Several shots over ten seconds, given the archer's cycle.
    expect(ids.size).toBeGreaterThan(2)
  })

  it('does not advance an arrow on the frame it is fired', () => {
    // Stepping before spawning, so a new arrow does not appear already metres out.
    const { encounter } = untilFired()
    const arrow = encounter.projectiles[0]
    if (!arrow) throw new Error('no arrow')
    expect(arrow.age).toBe(0)
  })

  it('eventually hurts a player standing in front of it', () => {
    let encounter = startEncounter(ARCHER_ONLY, C)
    let hit = false
    for (let i = 0; i < 900; i++) {
      const step = stepEncounter(encounter, defaults, 1 / 60, C, deps)
      encounter = step.encounter
      if (step.playerHit) { hit = true; break }
    }
    expect(hit).toBe(true)
  })

  it('lets a slipstream dodge an arrow, and pays Focus for it', () => {
    // Free leverage: arrow damage joins the same total the spears feed, so the existing
    // invulnerability and the existing damageAvoided flag both apply with no new code.
    let encounter = startEncounter(ARCHER_ONLY, C)
    let avoided = false
    let everHit = false
    for (let i = 0; i < 900; i++) {
      const step = stepEncounter(
        encounter, { ...defaults, playerInvulnerable: true }, 1 / 60, C, deps,
      )
      encounter = step.encounter
      if (step.damageAvoided) avoided = true
      if (step.playerHit) everHit = true
    }
    expect(avoided).toBe(true)
    expect(everHit).toBe(false)
  })

  it('clears the arrows when the patrol restores', () => {
    // An arrow loosed by a fight that is over must not strike a player who walks back to
    // a fresh patrol.
    const withPatrol = { ...DEPS, spawns: ARCHER_ONLY, patrol: { respawnRange: 40 } }
    const { encounter } = untilFired()
    const downed = {
      ...encounter,
      enemies: encounter.enemies.map((e) => ({ ...e, health: { ...e.health, current: 0 } })),
    }
    expect(downed.projectiles.length).toBeGreaterThan(0)
    const away = { ...defaults, playerPosition: new Vector3(0, 0, -500) }
    const step = stepEncounter(downed, away, 1 / 60, C, withPatrol)
    expect(step.restoredThisFrame.length).toBe(1)
    expect(step.encounter.projectiles).toEqual([])
  })
})
```

`defaults` puts the player at the origin; the archer sits 10 units away, inside the fixture archer's range. **Verify that** against the `C` you wrote in Task 3 before trusting `untilFired` — if the fixture archer's `strikeRange` is under 10 it will never fire and every test here will throw.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — `projectiles` is not a property of `Encounter`, `firedThisFrame` is not on `EncounterStep`.

- [ ] **Step 3: Widen `Encounter` and `EncounterStep`**

```ts
export interface Encounter {
  enemies: Enemy[]
  /** Arrows in flight. Owned by the fight, like the enemies that loosed them. */
  projectiles: Projectile[]
  /**
   * The next arrow's id.
   *
   * A counter rather than `Math.random()`, so ids are unique and deterministic — the
   * effects layer keys a view off them, and this project's tests cannot tolerate
   * unrepeatable values.
   */
  nextProjectileId: number
  playerHealth: Health
  gustCooldown: number
  vortexHeldSeconds: number
  vortexCooldown: number
}
```

Add `projectiles: [], nextProjectileId: 0` to `startEncounter`'s return, and to `EncounterStep`:

```ts
  /** Projectile ids loosed this frame, so a bow release can be made audible. */
  firedThisFrame: string[]
```

- [ ] **Step 4: Step the arrows, then spawn the new ones**

Immediately **before** the enemy-stepping loop:

```ts
  // Stepped before the enemy loop spawns this frame's shots, so a new arrow does not
  // advance on the frame it is fired and appear already metres from the bow. The
  // ordering comment at the top of this function applies here too: this order is
  // load-bearing, not incidental.
  let projectiles: Projectile[] = []
  let projectileDamage = 0
  for (const arrow of encounter.projectiles) {
    const step = stepProjectile(arrow, input.playerPosition, deps.ground, dt, c.projectile)
    projectileDamage += step.damageToPlayer
    if (step.projectile) projectiles.push(step.projectile)
  }
```

Then in the enemy loop, collect the shots — declare `firedThisFrame` and `nextProjectileId` beside `lostThisFrame`:

```ts
  const firedThisFrame: string[] = []
  let nextProjectileId = encounter.nextProjectileId
  enemies = enemies.map((enemy) => {
    const config = c.enemies[enemy.kind]
    const step = stepEnemy(
      enemy, input.playerPosition, deps.ground, deps.worldFloorY, dt, config,
    )
    damageToPlayer += step.damageToPlayer
    if (step.fellOutOfWorld) lostThisFrame.push(step.enemy.id)
    if (step.firedProjectile && config.attack.kind === 'projectile') {
      const id = `arrow-${nextProjectileId++}`
      projectiles.push(spawnProjectile(
        id,
        step.firedProjectile.origin,
        step.firedProjectile.direction,
        config.attack.damage,
        config.attack.speed,
      ))
      firedThisFrame.push(id)
    }
    return step.enemy
  })
```

The `config.attack.kind === 'projectile'` test is not redundant defensiveness — it is what narrows the union so `speed` is readable.

Fold the arrow damage into the existing total, immediately after the loop:

```ts
  // Into the same total the spears feed, which is what makes a Slipstream dodge an arrow
  // and `damageAvoided` grant Focus for it without a line of new code.
  damageToPlayer += projectileDamage
```

- [ ] **Step 5: Clear the arrows on a restore**

In the restore block:

```ts
  if (shouldRestorePatrol(enemies, deps.spawns, input.playerPosition, deps.patrol)) {
    enemies = deps.spawns.map((spawn) => spawnEnemy(
      spawn.id, spawn.position, spawn.kind, c.enemies[spawn.kind],
    ))
    restoredThisFrame = enemies.map((enemy) => enemy.id)
    // The arrows belonged to a fight that is over. Left alone, one loosed before the
    // reset could strike a player who has walked back to a fresh patrol.
    projectiles = []
  }
```

Add `projectiles, nextProjectileId` to the returned `encounter`, and `firedThisFrame` to the returned step.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. Every pre-existing test must still pass.

- [ ] **Step 7: Red-proof two things**

One at a time, reverting between each:

1. Move the arrow-stepping loop to *after* the enemy loop. Expected: FAIL on "does not advance an arrow on the frame it is fired".
2. Delete `projectiles = []` from the restore block. Expected: FAIL on "clears the arrows when the patrol restores".

Run after each: `npx vitest run src/combat/encounter.test.ts`. Revert both and confirm PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "Let the fight carry arrows, and pay for them from the same damage total"
```

---

### Task 5: An archer holds a bow

**Files:**
- Modify: `src/combat/enemy-mesh.ts`
- Test: `src/combat/enemy-mesh.test.ts`

**Interfaces:**
- Consumes: `EnemyKind` from Task 1.
- Produces: `createEnemyView(kind: EnemyKind): EnemyView`.

- [ ] **Step 1: Write the failing test**

Add to `src/combat/enemy-mesh.test.ts`, using its existing fixture helpers:

```ts
describe('the two kinds look different', () => {
  it('gives a spear soldier a spear and no bow', () => {
    // The pre-existing node name, which other tests in this file already find. It must
    // survive unchanged.
    const view = createEnemyView('spear')
    expect(view.object.getObjectByName('spear')).toBeTruthy()
    expect(view.object.getObjectByName('bow')).toBeFalsy()
  })

  it('gives an archer a bow and no spear', () => {
    const view = createEnemyView('archer')
    expect(view.object.getObjectByName('bow')).toBeTruthy()
    expect(view.object.getObjectByName('spear')).toBeFalsy()
  })

  it('telegraphs an archer's draw the same way a spear's thrust is telegraphed', () => {
    // The wind-up recolour is the existing tell and it must work for both, since it is
    // what the player's whole dodge window depends on seeing.
    const view = createEnemyView('archer')
    const body = view.object.getObjectByName('body') as Mesh
    const material = body.material as MeshLambertMaterial
    view.sync(enemyAt('advance'), new Quaternion())
    const calm = material.color.getHex()
    view.sync(enemyAt('wind-up'), new Quaternion())
    const drawing = material.color.getHex()
    expect(drawing).not.toBe(calm)
  })

  it('moves the bow on a draw', () => {
    const view = createEnemyView('archer')
    const bow = view.object.getObjectByName('bow') as Object3D
    view.sync(enemyAt('advance'), new Quaternion())
    const calm = bow.rotation.x
    view.sync(enemyAt('wind-up'), new Quaternion())
    // A real margin, not merely different: the draw has to be visible.
    expect(Math.abs(bow.rotation.x - calm)).toBeGreaterThan(0.3)
  })
})
```

Build `enemyAt(stance)` from the file's existing helpers. Every pre-existing `createEnemyView()` call in this file and in `src/main.ts` now needs an argument — `grep -rn 'createEnemyView' src` and pass `'spear'` in the tests. `main.ts` is Task 8's job.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/enemy-mesh.test.ts`
Expected: FAIL — `createEnemyView` takes no arguments.

- [ ] **Step 3: Parameterise the view**

In `src/combat/enemy-mesh.ts`:

```ts
const BOW = 0x5a4632
```

```ts
export function createEnemyView(kind: EnemyKind): EnemyView {
```

Replace the unconditional spear with a per-kind prop, keeping the spear's geometry, position and name exactly as they are:

```ts
  // The held prop is the only visible difference between the kinds. The spear keeps its
  // geometry, position and name unchanged, because other tests in this file find it by
  // name and the silhouette is what tells the player which threat they are looking at.
  const prop = kind === 'spear'
    ? new Mesh(new ConeGeometry(0.09, 1.9, 6), new MeshLambertMaterial({ color: SPEAR }))
    : new Mesh(new TorusGeometry(0.42, 0.05, 6, 12, Math.PI * 1.2), new MeshLambertMaterial({ color: BOW }))
  prop.name = kind === 'spear' ? 'spear' : 'bow'
  prop.position.set(0.32, 1.1, 0)
  rig.add(prop)
```

Import `TorusGeometry` from `three` and `EnemyKind` from `./enemy`. A partial torus reads as a bow at this scale, and it is one primitive.

In `sync`, replace the two `spear.rotation.set(...)` calls with `prop.rotation.set(...)`. The downed branch keeps `prop.rotation.set(0, 0, 0)`. The wind-up line becomes:

```ts
      // A spear cocks back to thrust; a bow rotates as it is drawn. Different amounts,
      // because the two motions read differently at distance.
      prop.rotation.set(winding ? (kind === 'spear' ? -1.1 : -0.6) : 0, 0, 0)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/combat/enemy-mesh.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Red-proof the draw**

Change the wind-up rotation to `0` for both kinds.

Run: `npx vitest run src/combat/enemy-mesh.test.ts`
Expected: FAIL on "moves the bow on a draw", and on whichever pre-existing test covers the spear's cock-back. Revert and confirm PASS.

- [ ] **Step 6: Typecheck and commit**

The app typecheck will fail on `src/main.ts`'s `createEnemyView()` call until Task 8. Verify the test pass only, and confirm that is the sole app-pass error:

```bash
npx tsc --noEmit -p tsconfig.test.json
npm test
git add src/combat/enemy-mesh.ts src/combat/enemy-mesh.test.ts
git commit -m "Put a bow in an archer's hands and draw it on the telegraph"
```

---

### Task 6: The arrow you can see

**Files:**
- Create: `src/fx/arrow.ts`
- Test: `src/fx/arrow.test.ts`

**Interfaces:**
- Consumes: `Projectile` from Task 2.
- Produces: `ArrowView { object: Object3D; update(p: Projectile): void; dispose(): void }`, `createArrowView(): ArrowView`.

An unseen thing that damages you is the exact defect this project has now fixed twice — the gust cone buried by terrain, and the staff connect with no spark. An arrow is the most dangerous invisible object the game could have.

- [ ] **Step 1: Write the failing test**

`src/fx/arrow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createArrowView } from './arrow'
import { spawnProjectile } from '../combat/projectile'

const arrow = (position: Vector3, direction: Vector3) =>
  spawnProjectile('a1', position, direction, 1, 34)

describe('the arrow view', () => {
  it('sits where the arrow is', () => {
    const view = createArrowView()
    view.update(arrow(new Vector3(3, 7, -11), new Vector3(0, 0, -1)))
    expect(view.object.position.toArray()).toEqual([3, 7, -11])
    view.dispose()
  })

  it('points along the flight', () => {
    const view = createArrowView()
    view.update(arrow(new Vector3(), new Vector3(1, 0, 0)))
    view.object.updateMatrixWorld(true)
    // Forward is +Z in this project: Object3D.lookAt aligns local +Z, and only Camera
    // and Light use -Z.
    const forward = new Vector3(0, 0, 1).applyQuaternion(view.object.quaternion)
    expect(forward.x).toBeCloseTo(1, 3)
    expect(forward.y).toBeCloseTo(0, 3)
    view.dispose()
  })

  it('points upward for a shot at a hovering player', () => {
    const view = createArrowView()
    view.update(arrow(new Vector3(), new Vector3(0, 1, -1).normalize()))
    const forward = new Vector3(0, 0, 1).applyQuaternion(view.object.quaternion)
    // The climb is the whole point of an archer, so the drawn arrow has to show it.
    expect(forward.y).toBeGreaterThan(0.5)
    view.dispose()
  })

  it('is depth-tested, so an arrow behind a hill stays hidden', () => {
    // A deliberate difference from the attack tells in this directory, which draw over
    // the world. An arrow the player cannot see is a threat; an arrow visible through
    // terrain is information they should not have. Same reasoning as the health bars.
    const view = createArrowView()
    const mesh = view.object.getObjectByName('arrow-shaft') as { material: { depthTest: boolean } }
    expect(mesh.material.depthTest).toBe(true)
    view.dispose()
  })

  it('survives a zero velocity without producing NaN', () => {
    const view = createArrowView()
    const still = { ...arrow(new Vector3(1, 2, 3), new Vector3(0, 0, -1)), velocity: new Vector3() }
    view.update(still)
    expect(Number.isFinite(view.object.quaternion.w)).toBe(true)
    expect(view.object.position.x).toBeCloseTo(1)
    view.dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/arrow.test.ts`
Expected: FAIL — cannot resolve `./arrow`.

- [ ] **Step 3: Write the module**

`src/fx/arrow.ts`:

```ts
import {
  CylinderGeometry, Group, Mesh, MeshLambertMaterial, Vector3, type Object3D,
} from 'three'
import type { Projectile } from '../combat/projectile'

const LENGTH = 0.9
const RADIUS = 0.035
const TINT = 0x4a3c2a

/**
 * One arrow, drawn.
 *
 * Persistent rather than a one-shot `Effect` because it lives as long as its flight,
 * which is the same reason `createVortexChargeTell` is shaped this way.
 *
 * An unseen thing that damages the player is the specific defect this project has fixed
 * twice — a gust cone buried by terrain, and a staff connect with no spark. An arrow is
 * the most dangerous invisible object the game could have.
 */
export interface ArrowView {
  object: Object3D
  update(projectile: Projectile): void
  dispose(): void
}

export function createArrowView(): ArrowView {
  const object = new Group()

  // The cylinder's axis is local Y, so lay it along local Z to point along the flight.
  const geometry = new CylinderGeometry(RADIUS, RADIUS, LENGTH, 5)
  const material = new MeshLambertMaterial({
    color: TINT,
    // Depth-tested, unlike the attack tells in this directory. An arrow visible through
    // a hill is information the player should not have — the same reasoning already
    // recorded for the enemy health bars.
    depthTest: true,
  })
  const shaft = new Mesh(geometry, material)
  shaft.name = 'arrow-shaft'
  shaft.rotation.x = Math.PI / 2
  object.add(shaft)

  // Reused rather than allocated: one of these exists per arrow in flight.
  const target = new Vector3()

  return {
    object,

    update(projectile: Projectile): void {
      object.position.copy(projectile.position)
      // A zero velocity has no direction to face, so the last orientation is kept rather
      // than a degenerate lookAt being attempted.
      if (projectile.velocity.lengthSq() > 1e-8) {
        target.copy(projectile.position).add(projectile.velocity)
        object.lookAt(target)
      }
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/fx/arrow.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-proof the aiming**

Delete the `object.lookAt(target)` line.

Run: `npx vitest run src/fx/arrow.test.ts`
Expected: FAIL on "points along the flight" and "points upward for a shot at a hovering player". Revert and confirm PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/fx/arrow.ts src/fx/arrow.test.ts
git commit -m "Draw the arrow, depth-tested so a hill still hides it"
```

---

### Task 7: The release is the telegraph

**Files:**
- Modify: `src/fx/mapping.ts`, `src/fx/combat-audio.ts`
- Test: `src/fx/mapping.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `COMBAT_LEVELS.bowRelease`, and `bowRelease()` on `createCombatAudio()`'s return.

The player being hit is already audible through `hurt()`. The addition worth making is the shot being loosed — that release *is* the telegraph, and an archer behind the player is otherwise silent until damage lands.

- [ ] **Step 1: Write the failing test**

Add to `src/fx/mapping.test.ts`:

```ts
describe('the bow release', () => {
  it('is audible', () => {
    expect(COMBAT_LEVELS.bowRelease).toBeGreaterThan(0.05)
  })

  it('does not clip', () => {
    expect(COMBAT_LEVELS.bowRelease).toBeLessThanOrEqual(0.5)
  })

  it('is quieter than the player being hurt', () => {
    // A hit taken stays the loudest thing in the fight; an enemy's telegraph is a
    // warning, not an alarm. A margin, not a bare comparison.
    expect(COMBAT_LEVELS.bowRelease).toBeLessThan(COMBAT_LEVELS.hurt * 0.85)
  })

  it('is loud enough to notice from behind', () => {
    // It is the only warning an archer out of shot gives, so it must not be the
    // quietest thing in the mix either.
    expect(COMBAT_LEVELS.bowRelease).toBeGreaterThan(COMBAT_LEVELS.swing)
  })
})
```

The existing `keeps every voice audible and none of them clipping` test iterates `Object.entries(COMBAT_LEVELS)`, so it will cover the new voice automatically — check that it does rather than assuming.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fx/mapping.test.ts`
Expected: FAIL — `bowRelease` is not a property of `COMBAT_LEVELS`.

- [ ] **Step 3: Add the level**

In `src/fx/mapping.ts`, add to `COMBAT_LEVELS`:

```ts
  /** An archer loosing. Louder than a staff swing, since it is a warning; below hurt. */
  bowRelease: 0.24,
```

- [ ] **Step 4: Add the voice**

In `src/fx/combat-audio.ts`, add to the returned object, beside the others:

```ts
    /** A short bright snap, higher and shorter than a staff swing: a string releasing. */
    bowRelease(): void {
      burst(COMBAT_LEVELS.bowRelease, 0.1, 4200, 900)
    },
```

Add `bowRelease(): void` to the return type if the module annotates one — check whether it does; `createCombatAudio` returns an inferred object literal, in which case nothing to change.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/fx/mapping.test.ts`
Expected: PASS.

- [ ] **Step 6: Red-proof**

Set `bowRelease` to `0.5`.

Run: `npx vitest run src/fx/mapping.test.ts`
Expected: FAIL on "is quieter than the player being hurt". Revert and confirm PASS.

- [ ] **Step 7: Typecheck, build and commit**

```bash
npm run typecheck
npm run build
git add src/fx/mapping.ts src/fx/mapping.test.ts src/fx/combat-audio.ts
git commit -m "Give an archer's release a sound, since it is the only warning it gives"
```

---

### Task 8: Wire it into the game

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: nothing. The wiring layer, untested by design, so it holds no rules.

- [ ] **Step 1: Pass the kind when creating enemy views**

`src/main.ts:170` builds `enemyViews` from `encounter.enemies` with `createEnemyView()`. It now needs the kind:

```ts
    const view = createEnemyView(enemy.kind)
```

This is what makes the app typecheck pass again after Task 5.

- [ ] **Step 2: Add per-arrow views**

Beside `enemyViews`:

```ts
  /**
   * One view per arrow in flight, created on first sight and disposed when the arrow is
   * gone. Keyed by projectile id, the same way enemyViews is keyed by enemy id.
   */
  const arrowViews = new Map<string, ArrowView>()
```

Import `createArrowView` and the `ArrowView` type from `./fx/arrow`.

- [ ] **Step 3: Sync them each frame**

In `update`, after `encounter = fight.encounter` and beside where enemy views are synced:

```ts
    // Read straight from the simulation rather than through an interpolator. Arrows are
    // fast and short-lived, an interpolator would have to be created and disposed per
    // arrow, and the render-interpolation work exists to smooth a camera-followed
    // character rather than every moving object.
    for (const arrow of encounter.projectiles) {
      let view = arrowViews.get(arrow.id)
      if (!view) {
        view = createArrowView()
        arrowViews.set(arrow.id, view)
        scene.add(view.object)
      }
      view.update(arrow)
    }
    // Anything with no arrow left has hit, landed or expired.
    const live = new Set(encounter.projectiles.map((arrow) => arrow.id))
    for (const [id, view] of arrowViews) {
      if (live.has(id)) continue
      scene.remove(view.object)
      view.dispose()
      arrowViews.delete(id)
    }
```

- [ ] **Step 4: Make the release audible**

Beside the other `combatAudio` calls:

```ts
    for (let i = 0; i < fight.firedThisFrame.length; i++) combatAudio.bowRelease()
```

One per arrow, so a volley of two reads as two.

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
git commit -m "Wire archers, arrows and their views into the game"
```

---

### Task 9: Verify it in the running game

**Files:** none — this task produces measurements, not code.

Use the synthetic-clock technique in `docs/HANDOFF.md`: patch `window.requestAnimationFrame` to capture the callback, take one screenshot so the loop re-registers, then drive frames manually. Start the dev server with the preview tool and the config in `.claude/launch.json`; never through a shell. Do not edit source files during this pass — Vite HMR wipes the harness.

Four traps recorded from the last two in-game passes, each of which cost real time:

- Vite full-reloads several times in the first seconds of a fresh `npm run dev` while it pre-bundles `three` and friends. Wait for the `[vite] connected` pairs to stop growing before installing hooks.
- `WebGLRenderer.prototype.render` cannot be patched — this build assigns `render` as an own property. Capture `scene` and `camera` by patching `Object3D.prototype.updateMatrixWorld` and `PerspectiveCamera.prototype.updateProjectionMatrix` instead.
- **`THREE` is not on `window`.** Get the app's own module instance by importing the exact pre-bundled URL from `read_network_requests` — the `?v=` hash changes per dev-server start.
- Turning the glider needs continuous per-frame yaw deltas; a held bank does not turn it.

Measure each of these, with a control where one exists, and **verify by a different mechanism than the one that produced the behaviour**:

- [ ] **Step 1: Climbing is no longer a win condition**

The headline claim. Deploy, climb well above the spears' 26 units, and confirm arrows still arrive — then climb past the archer's 48 and confirm they stop. The control that matters: the same two altitudes, measured, with the arrow count at each.

- [ ] **Step 2: An archer aims up**

Hover above an archer and read a loosed arrow's velocity. Its y component must be positive and substantial, not near zero — a flattened aim is the specific bug the 3D branch exists to prevent.

- [ ] **Step 3: A spear's reach is unchanged, and is still measured horizontally**

The regression that matters most — but note the correction below, because this step was originally worded backwards.

"A spear cannot reach up" was sloppy shorthand for "a spear's reach is not measured in 3D". Measuring horizontally means height is **ignored**, not that height protects you. So a spear standing 2 units from a player who is 20 units overhead *does* hit them, and Task 1 has a test asserting exactly that, because it is the pre-existing behaviour this cycle must not change.

What to verify, in both directions:

- Stand 2 units from a spear soldier and 20 units up. It **should** damage you — height is ignored. That matches `enemy.test.ts`'s "still thrusts at a player almost directly overhead".
- Stand 10 units away at ground level, outside its 3.2 reach. It should **not** damage you, and should close the distance instead.

Together those pin that the melee path still measures horizontal distance and nothing else. A version of this step that expected height to protect the player would report a failure against correct code.

- [ ] **Step 4: Arrows are visible, and hidden by terrain**

Confirm an arrow in flight has a view in the scene, then put a hill between yourself and an archer and confirm the arrow is occluded rather than drawn over it.

- [ ] **Step 5: A Slipstream dodges an arrow**

Time a `C` against an incoming arrow and read the Focus gain, against a control of taking the hit. This is §4.2's "beats an attack you can see coming" doing what it was tuned for.

- [ ] **Step 6: Arrow views do not leak**

Drive a few thousand frames of a live fight and confirm the number of arrow views in the scene stays bounded rather than growing. A leak here would be invisible in tests and fatal over a long session.

- [ ] **Step 7: Record the results**

Numbers, not adjectives. State plainly anything you could not establish — a caveat is worth more than a guess, and a failure found here is the most valuable thing this task can produce.

---

### Task 10: Documentation

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Add the new sections**

In the handoff's existing voice — it explains why rather than what, names traps that cost real time, and prefers numbers to adjectives. Cover:

- **The framing, which is the point of the cycle:** before this, climbing was a win condition. Infantry notices at 26 units, closes only horizontally, and `stepEnemy` says outright that it does not chase into the sky, so getting above it ended any fight — which undercut the Slipstream's dodge window, the hover, and the staff's no-glider gate all at once.
- One state machine with the attack as a description, and why not a discriminated union.
- **The one divergent branch:** a projectile attacker measures both notice and commit in 3D. Say why — measured horizontally, a player hovering directly overhead is at distance 0 and inside any range.
- **The trap:** `facing` stays horizontal because `enemy-mesh.ts` reads it through `atan2(x, z)`. The aim is 3D; the facing is not. Two things that point the same way on flat ground.
- Arrows: straight-line, owned by the `Encounter`, ids from a counter rather than `Math.random()`.
- **The ordering constraint:** arrows step before new ones spawn, or an arrow appears already metres out.
- **The restore clears the projectiles**, and why.
- The free leverage: arrow damage joins the same total the spears feed, so a Slipstream dodges an arrow and `damageAvoided` pays Focus with no new code.
- `createEnemyView(kind)`, and that the spear's node name and geometry are unchanged because other tests find it by name.
- The arrow view is `depthTest: true`, deliberately unlike the attack tells in `src/fx/`.

- [ ] **Step 2: Update what is no longer blocked**

The "What has NOT been built" section lists Air Wall as blocked because nothing shoots. Something shoots now. Rewrite that entry: Air Wall and §4.5's redirected-projectile Focus source are now unblocked and are the natural next cycle. Also note that four of §4.4's six types remain, and that this cycle makes them additions rather than rewrites.

- [ ] **Step 3: Add the honest caveats**

At minimum: every value here is an unplayed guess, and unlike most of this project's guesses they are about *pressure* rather than feel, so an hour of play will move them a long way — the archer's `aggroRange` of 48 most of all, since it is the number that decides whether climbing still wins. Plus whatever Task 9 could not establish.

- [ ] **Step 4: Update the repo state line and the spec list**

Run `npm test` and copy the real counts. Do not predict them. Add this cycle's spec path to wherever the handoff lists specs.

- [ ] **Step 5: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "Document archers, arrows, and the axis they finally contest"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: `EnemyAttack`/`EnemyKind`/3D reach → 1; `projectile.ts` → 2; per-kind config, the archer's numbers and the mixed patrol → 3; the fight owning arrows, `firedThisFrame` and the restore clearing them → 4; `createEnemyView(kind)` → 5; `fx/arrow.ts` → 6; the `bowRelease` voice → 7; wiring → 8; in-game verification → 9; docs → 10. The spec's out-of-scope items — Air Wall, the redirect Focus source, glider kit narrowing, arrow drop, terrain raycasting — correctly have no task.

**Type consistency.** `EnemyKind`, `EnemyAttack`, `EnemyConfig.attack`, `Enemy.kind`, `spawnEnemy(id, position, kind, c)`, `EnemyStep.firedProjectile`, `Projectile`, `ProjectileConfig.{hitRadius,maxSeconds}`, `ProjectileStep.{projectile,damageToPlayer}`, `spawnProjectile(id, origin, direction, damage, speed)`, `stepProjectile(p, playerPosition, ground, dt, c)`, `CombatConfig.enemies`, `CombatConfig.projectile`, `EnemySpawn.kind`, `Encounter.{projectiles,nextProjectileId}`, `EncounterStep.firedThisFrame`, `createEnemyView(kind)`, `ArrowView`, `createArrowView()`, `COMBAT_LEVELS.bowRelease` — each defined once and used under the same name after. The node names `spear`, `bow`, `body` and `arrow-shaft` match between the tests that find them and the implementations that set them.

**Ordering.** Task 3 needs Task 1's types and Task 2's `ProjectileConfig`. Task 4 needs Task 3's per-kind lookup, since it edits the same loop. Task 8 needs all of 1–7. Task 5 deliberately leaves the app typecheck failing on `main.ts`'s `createEnemyView()` call until Task 8, and says so in its own commit step.

**Known risks.** Two. Task 1 replaces a field on a struct with five literal sites plus two `spawnEnemy` call sites, and this project's plans have had a wrong file list nine times — hence the instruction to re-grep rather than trust the list. And Task 4's `untilFired` helper depends on the fixture archer's `strikeRange` exceeding the 10 units between the archer and the origin; if Task 3's fixture is written with a smaller range, every test in that block throws rather than failing informatively, which the task calls out explicitly.
