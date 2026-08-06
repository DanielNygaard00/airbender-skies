# Enemy Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a downed spear soldier push back onto its feet on a ladder of diminishing recoveries, with a telegraphed rise the player can interrupt.

**Architecture:** All the state lives in `src/combat/enemy.ts`, which already owns the stance machine — `Stance` gains `'rising'`, `Enemy` gains a `downs` counter, and the downed branch of `stepEnemy` grows a timer. Health stays at zero through both `downed` and `rising`, which is what makes the interrupt fall out of `hitEnemy`'s existing behaviour with no new code. `encounter.ts` learns that a rising soldier is worth aiming at, `enemy-mesh.ts` draws the push-up, and `main.ts` pays Focus only for first downs.

**Tech Stack:** TypeScript, Three.js 0.185, Vite, Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-06-enemy-recovery-design.md`](../specs/2026-08-06-enemy-recovery-design.md)

## Global Constraints

- No new dependencies. `three` and `simplex-noise` are the only runtime deps.
- Tests are colocated: `src/combat/enemy.ts` is tested by `src/combat/enemy.test.ts`. There is no `tests/` directory.
- `npm test` (vitest run) and `npm run typecheck` must both pass at the end of every task.
- Tuning constants live in `src/combat/config.ts` inside `DEFAULT_COMBAT_CONFIG`. Do not inline magic numbers at call sites.
- `src/combat/health.ts` and `src/combat/health.test.ts` must not be modified.
- `src/combat/patrol.ts` must not be modified. The encounter-level restore is a separate, working feature; this plan only has to coexist with it.
- Comments explain *why*, not *what*. This codebase's comments argue for decisions; match that register and read the surrounding ones first.
- Never use `any`. `strict` is on.
- Test names are lowercase sentences describing behaviour (`it('rises after the countdown')`), not `it('should ...')`.
- Exact tuning values, to be used verbatim: `downedSeconds: 18`, `risingSeconds: 1.2`, `recoveryHealthFractions: [0.6, 0.3]`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/combat/enemy.ts` | modify | The `downs` counter, the `'rising'` stance, the ladder, and two new predicates. |
| `src/combat/enemy.test.ts` | modify | Every rule of the ladder. This is where the confidence lives. |
| `src/combat/config.ts` | modify | The three tuning values. |
| `src/combat/gust.test.ts` | modify | Fixture only — its `EnemyConfig` literal must compile. |
| `src/combat/patrol.test.ts` | modify | Fixture only — same. |
| `src/combat/encounter.ts` | modify | A rising soldier is targetable; first downs are reported separately. |
| `src/combat/encounter.test.ts` | modify | Fixture, plus targeting and Focus-list behaviour. |
| `src/combat/enemy-mesh.ts` | modify | Draws the push-up. |
| `src/combat/enemy-mesh.test.ts` | modify | Pose at both ends of the rise, and the colour guard. |
| `src/main.ts` | modify | Passes rise progress to the views; pays Focus on first downs only. |
| `docs/design/aang-playable-character.md` | modify | §4.6 records the ladder. |
| `README.md` | modify | Corrects a sentence that becomes false. |
| `docs/HANDOFF.md` | modify | An entry. |

---

### Task 1: The ladder

**Files:**
- Modify: `src/combat/enemy.ts`
- Modify: `src/combat/enemy.test.ts`
- Modify: `src/combat/config.ts`
- Modify: `src/combat/gust.test.ts` (fixture only)
- Modify: `src/combat/patrol.test.ts` (fixture only)
- Modify: `src/combat/encounter.test.ts` (fixture only — its behaviour tests come in Task 2)

**Interfaces:**
- Consumes: `isDowned`, `applyDamage`, `type Health` from `./health` (already imported).
- Produces, relied on by Tasks 2 and 3:
  - `Stance` gains `'rising'`
  - `Enemy` gains `downs: number`
  - `EnemyConfig` gains `downedSeconds: number`, `risingSeconds: number`, `recoveryHealthFractions: readonly number[]`
  - `isTargetable(enemy: Enemy): boolean`
  - `risingProgress(enemy: Enemy, c: EnemyConfig): number`
  - `nextRecoveryFraction(enemy: Enemy, c: EnemyConfig): number | null`

- [ ] **Step 1: Add the tuning values**

In `src/combat/config.ts`, inside `DEFAULT_COMBAT_CONFIG.enemy`, after `snapDistance: 1.2,`:

```ts
    /**
     * Long enough that clearing a patrol feels like progress, short enough that the
     * island does not go quiet while the player is still standing on it.
     */
    downedSeconds: 18,
    // Well above the strike's windUpSeconds of 0.55: getting up is a bigger commitment
    // than a spear thrust and should read as one.
    risingSeconds: 1.2,
    /**
     * Against maxHealth 1.5 and the gust's 0.5 damage, these are three gusts, then two,
     * then one — 1.5, then 0.9, then 0.45. The ladder is legible from playing it rather
     * than from reading this, and each rung costs less of the player's time than the last.
     */
    recoveryHealthFractions: [0.6, 0.3],
```

- [ ] **Step 2: Make the four test fixtures compile**

Three of these are mechanical; only `enemy.test.ts` gets behaviour tests later. Add the same three fields to each hand-written `EnemyConfig` literal so they match `DEFAULT_COMBAT_CONFIG.enemy` — a different value in a fixture reads as load-bearing when it is not.

In `src/combat/gust.test.ts` and `src/combat/patrol.test.ts`, add to the config literal:

```ts
  downedSeconds: 18, risingSeconds: 1.2, recoveryHealthFractions: [0.6, 0.3],
```

In `src/combat/encounter.test.ts`, add the same three lines to the `enemy:` block of `C`.

In `src/combat/enemy.test.ts`, add them to `C`. Note that this file's `C` uses `maxHealth: 3`, not 1.5 — leave that as it is, and write the Task 1 tests against `C.maxHealth` rather than a literal.

- [ ] **Step 3: Write the failing tests**

Add to `src/combat/enemy.test.ts`. The existing `settle` helper steps an enemy with the player far away; the tests below need a `downed` helper and a player position, so add these near the other helpers at the top:

```ts
/** Take an enemy to zero the way the fight does — through a hit. */
const down = (enemy: Enemy) => hitEnemy(enemy, enemy.health.max, new Vector3())
/** Total seconds for one full trip: flat on the ground, then the push-up. */
const FULL_RECOVERY = C.downedSeconds + C.risingSeconds
```

Then, as a new describe block at the end of the file:

```ts
describe('getting back up', () => {
  it('pushes up after the countdown', () => {
    const enemy = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    expect(enemy.stance).toBe('rising')
  })

  it('is still flat a moment before the countdown ends', () => {
    const enemy = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds - 0.5)
    expect(enemy.stance).toBe('downed')
  })

  it('restores the first rung of the ladder when the push-up finishes', () => {
    const enemy = settle(down(spawnEnemy('a', AT(0, 20), C)), FULL_RECOVERY + 0.1)
    expect(enemy.stance).toBe('advance')
    expect(enemy.health.current).toBeCloseTo(C.maxHealth * C.recoveryHealthFractions[0])
  })

  it('restores the second rung on the second recovery, so the ladder descends', () => {
    const first = settle(down(spawnEnemy('a', AT(0, 20), C)), FULL_RECOVERY + 0.1)
    const second = settle(down(first), FULL_RECOVERY + 0.1)
    expect(second.stance).toBe('advance')
    expect(second.health.current).toBeCloseTo(C.maxHealth * C.recoveryHealthFractions[1])
    expect(second.health.current).toBeLessThan(first.health.current)
  })

  it('stays down for good once the ladder is spent', () => {
    let enemy = down(spawnEnemy('a', AT(0, 20), C))
    for (const _ of C.recoveryHealthFractions) enemy = down(settle(enemy, FULL_RECOVERY + 0.1))
    // Several more countdowns' worth: a soldier past the last rung never rises again.
    expect(settle(enemy, FULL_RECOVERY * 3).stance).toBe('downed')
  })

  it('does not count down while still in the air', () => {
    // Downed mid-Vortex: the body has to land before it starts recovering.
    const lifted = { ...down(spawnEnemy('a', AT(0, 20), C)), position: AT(0, 20).setY(40) }
    const enemy = settle(lifted, 1)
    expect(enemy.stance).toBe('downed')
    expect(enemy.stanceTime).toBe(0)
  })

  it('deals no damage and does not close while pushing up', () => {
    // A rising soldier is inert. Player placed inside strikeRange to prove it.
    const onTop = AT(0, 20)
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    const step = stepEnemy(rising, onTop, flatGround, FLOOR, 1 / 60, C)
    expect(step.damageToPlayer).toBe(0)
    expect(step.enemy.position.x).toBeCloseTo(rising.position.x)
    expect(step.enemy.position.z).toBeCloseTo(rising.position.z)
  })

  it('faces the player from the moment it starts pushing up', () => {
    // Otherwise it comes up aimed wherever it fell and snaps round on its first
    // advance frame.
    const enemy = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    // `settle` puts the player at AT(0, 500), so the heading is +z.
    expect(enemy.facing.z).toBeGreaterThan(0.9)
  })

  it('goes straight back down when hit during the push-up', () => {
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.5)
    expect(rising.stance).toBe('rising')
    const interrupted = hitEnemy(rising, 0.1, new Vector3())
    expect(interrupted.stance).toBe('downed')
    expect(interrupted.stanceTime).toBe(0)
  })

  it('does not spend a rung on an interrupted push-up', () => {
    // The ruling: interrupting buys time, it does not substitute for damage. So the
    // next rise has to come back at the SAME rung, not the next one down.
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.5)
    const interrupted = hitEnemy(rising, 0.1, new Vector3())
    expect(interrupted.downs).toBe(1)
    const risenAgain = settle(interrupted, FULL_RECOVERY + 0.1)
    expect(risenAgain.health.current).toBeCloseTo(C.maxHealth * C.recoveryHealthFractions[0])
  })

  it('never rises once it has left the world', () => {
    const fallen = settle(spawnEnemy('a', AT(0, 20), C), 5, emptyAir)
    expect(isDowned(fallen.health)).toBe(true)
    expect(settle(fallen, FULL_RECOVERY * 2, emptyAir).stance).toBe('downed')
  })

  it('counts a down only on the crossing, not on every hit to a body', () => {
    const first = down(spawnEnemy('a', AT(0, 20), C))
    expect(first.downs).toBe(1)
    expect(hitEnemy(first, C.maxHealth, new Vector3()).downs).toBe(1)
  })

  it('takes strictly fewer gusts to put down at each rung, and one at the last', () => {
    // The feel claim from the spec, phrased so retuning the numbers cannot silently
    // invert the ladder. Uses the real config, not this file's fixture.
    const { enemy: E, gust } = DEFAULT_COMBAT_CONFIG
    const gustsToDown = (health: number) => Math.ceil(health / gust.damage)
    const rungs = [1, ...E.recoveryHealthFractions].map((f) => gustsToDown(E.maxHealth * f))
    for (let i = 1; i < rungs.length; i++) expect(rungs[i]).toBeLessThan(rungs[i - 1])
    expect(rungs[rungs.length - 1]).toBe(1)
  })
})

describe('isTargetable', () => {
  it('is true for a soldier on its feet', () => {
    expect(isTargetable(spawnEnemy('a', AT(0, 0), C))).toBe(true)
  })

  it('is false for a body on the ground', () => {
    expect(isTargetable(down(spawnEnemy('a', AT(0, 0), C)))).toBe(false)
  })

  it('is true for one pushing back up, which is what makes the interrupt reachable', () => {
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    expect(isTargetable(rising)).toBe(true)
  })
})

describe('risingProgress', () => {
  it('is nothing for a soldier that is not pushing up', () => {
    expect(risingProgress(spawnEnemy('a', AT(0, 0), C), C)).toBe(0)
  })

  it('runs from nothing to all of it across the push-up', () => {
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    expect(risingProgress(rising, C)).toBeLessThan(0.2)
    expect(risingProgress({ ...rising, stanceTime: C.risingSeconds }, C)).toBe(1)
  })

  it('clamps rather than overshooting the pose', () => {
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    expect(risingProgress({ ...rising, stanceTime: C.risingSeconds * 5 }, C)).toBe(1)
  })

  it('is nothing for a zero-length rise rather than a NaN', () => {
    // The value multiplies into a rotation, where a NaN corrupts the matrix instead of
    // merely looking wrong.
    const rising = settle(down(spawnEnemy('a', AT(0, 20), C)), C.downedSeconds + 0.1)
    expect(risingProgress(rising, { ...C, risingSeconds: 0 })).toBe(0)
  })
})
```

Add `DEFAULT_COMBAT_CONFIG` to the imports (`import { DEFAULT_COMBAT_CONFIG } from './config'`), and add `isTargetable`, `risingProgress` to the existing import from `./enemy`.

- [ ] **Step 4: Run the tests and watch them fail**

```bash
npm test -- src/combat/enemy.test.ts
```

Expected: FAIL — `isTargetable is not a function`, and the recovery tests failing because a downed enemy never leaves `'downed'`.

- [ ] **Step 5: Add the state**

In `src/combat/enemy.ts`, widen the stance union:

```ts
export type Stance = 'advance' | 'wind-up' | 'recover' | 'downed' | 'rising'
```

Add to `Enemy`, after `health`:

```ts
  /**
   * How many times this soldier has been taken to zero.
   *
   * Indexes the recovery ladder: each rise restores less than the last, and running off
   * the end of `recoveryHealthFractions` is what makes a down permanent. Counts crossings
   * only — knocking a rising soldier back down does not advance it, so descending the
   * ladder always costs real damage.
   */
  downs: number
```

Add to `EnemyConfig`, after `snapDistance`:

```ts
  /**
   * Seconds flat on the ground before pushing back up.
   *
   * Deliberately not named `recoverSeconds`: that one already exists and means the
   * vulnerable window after a strike. Two fields a syllable apart, both about recovering,
   * is how a caller reaches for the wrong one.
   */
  downedSeconds: number
  /** The push-up itself: long, visible, and a hit lands them straight back down. */
  risingSeconds: number
  /**
   * Health on each successive rise, as a fraction of max.
   *
   * The array's length is how many recoveries a soldier gets: run off the end and the
   * down is permanent, so the ladder's depth and its steps are one constant rather than
   * two that can disagree. An empty array is meaningful rather than broken — nobody ever
   * rises, which is exactly how this module behaved before recovery existed.
   */
  recoveryHealthFractions: readonly number[]
```

Add `downs: 0,` to the object `spawnEnemy` returns.

- [ ] **Step 6: Add the three functions**

Add `MathUtils` to the `three` import at the top of `src/combat/enemy.ts`, then add these beside the other exported helpers:

```ts
/**
 * How much health this soldier gets back on its next rise, or null when the ladder is
 * spent and the down is permanent.
 *
 * One place owns the index arithmetic, so the check that starts a rise and the restore
 * that ends it cannot disagree about which rung is next. Indexed at `downs - 1` because
 * `downs` counts crossings and the first crossing earns the first rung.
 */
export function nextRecoveryFraction(enemy: Enemy, c: EnemyConfig): number | null {
  return c.recoveryHealthFractions[enemy.downs - 1] ?? null
}

/** Worth aiming at: on its feet, or pushing back up onto them. */
export function isTargetable(enemy: Enemy): boolean {
  return !isDowned(enemy.health) || enemy.stance === 'rising'
}

/**
 * How far through pushing back up, 0 to 1. Zero when not rising.
 *
 * Fails closed on a non-positive `risingSeconds` rather than dividing by it: the result is
 * multiplied into a rotation, where a NaN corrupts the matrix instead of just looking wrong.
 */
export function risingProgress(enemy: Enemy, c: EnemyConfig): number {
  if (enemy.stance !== 'rising' || !(c.risingSeconds > 0)) return 0
  return MathUtils.clamp(enemy.stanceTime / c.risingSeconds, 0, 1)
}
```

- [ ] **Step 7: Count the crossing in `hitEnemy`**

In `hitEnemy`, add the counter. `wentDown` is read before the spread so it compares the new health against the old:

```ts
export function hitEnemy(enemy: Enemy, damage: number, impulse: Vector3): Enemy {
  const health = applyDamage(enemy.health, damage)
  // Crossings only. A hit on a body already at zero — which is what interrupting a rise
  // is — must not advance the ladder, or a tap at the right moment would substitute for
  // chipping through a whole health bar.
  const wentDown = isDowned(health) && !isDowned(enemy.health)
  return {
    ...enemy,
    health,
    downs: wentDown ? enemy.downs + 1 : enemy.downs,
```

Leave the rest of the function exactly as it is. The `stance: isDowned(health) ? 'downed' : 'recover'` line already sends a rising soldier back to `'downed'` with `stanceTime: 0`, which is the whole interrupt.

- [ ] **Step 8: Replace the downed branch in `stepEnemy`**

Replace this block:

```ts
  if (isDowned(enemy.health)) {
    // Down, not gone: the body stays in the world — but it still falls, and settles.
    return {
      enemy: { ...enemy, ...moved, stance: 'downed', stanceTime: enemy.stanceTime + dt },
      damageToPlayer: 0,
      fellOutOfWorld: false,
    }
  }
```

with:

```ts
  if (isDowned(enemy.health)) {
    // Frozen while airborne: a body still falling out of a Vortex is not recovering, and
    // without this it would land with the countdown already spent and rise on the spot.
    const stanceTime = moved.grounded ? enemy.stanceTime + dt : enemy.stanceTime
    const fraction = nextRecoveryFraction(enemy, c)

    if (enemy.stance === 'rising') {
      // The ladder cannot empty mid-rise — `downs` only moves on a crossing, and a rise
      // only starts with a rung available — but lying back down is the safe answer if it
      // ever did, because a rise that can never complete is a soldier stuck on one knee.
      if (fraction !== null && stanceTime >= c.risingSeconds) {
        return {
          enemy: {
            ...enemy, ...moved,
            health: { ...enemy.health, current: enemy.health.max * fraction, sinceHit: 0 },
            stance: 'advance',
            stanceTime: 0,
          },
          damageToPlayer: 0,
          fellOutOfWorld: false,
        }
      }
      if (fraction !== null) {
        // Still pushing up: inert, but targetable. A hit here goes through hitEnemy's
        // ordinary path and puts the soldier straight back down.
        return {
          enemy: { ...enemy, ...moved, stance: 'rising', stanceTime },
          damageToPlayer: 0,
          fellOutOfWorld: false,
        }
      }
    } else if (fraction !== null && moved.grounded && stanceTime >= c.downedSeconds) {
      return {
        enemy: {
          ...enemy, ...moved,
          stance: 'rising',
          stanceTime: 0,
          // Set at the start of the rise rather than the end: `facing` only updates in
          // the active branch below, so a soldier would otherwise push up aimed wherever
          // it fell and snap round on its first advance frame.
          facing: horizontalTo(moved.position, playerPosition),
        },
        damageToPlayer: 0,
        fellOutOfWorld: false,
      }
    }

    // Down, not gone: the body stays in the world — but it still falls, and settles.
    return {
      enemy: { ...enemy, ...moved, stance: 'downed', stanceTime },
      damageToPlayer: 0,
      fellOutOfWorld: false,
    }
  }
```

Also add `downs: enemy.downs + 1` to the object returned by the fell-out-of-world branch above it, beside its `health: applyDamage(...)` line, so the counter means the same thing however a soldier went down. Nothing reads it there — the parked branch returns before any of this — but a counter that is right in one place and wrong in another is a trap for the next reader.

- [ ] **Step 9: Run the tests and the typecheck**

```bash
npm test -- src/combat/enemy.test.ts && npm run typecheck
```

Expected: PASS, and no type errors — the typecheck is what proves all four fixture literals were updated.

- [ ] **Step 10: Run the whole suite**

```bash
npm test
```

Expected: everything green. `encounter.test.ts` still passes because nothing there reaches `downedSeconds` yet.

- [ ] **Step 11: Commit**

```bash
git add src/combat/enemy.ts src/combat/enemy.test.ts src/combat/config.ts src/combat/gust.test.ts src/combat/patrol.test.ts src/combat/encounter.test.ts
git commit -m "Give a downed soldier a ladder back onto its feet"
```

---

### Task 2: Targeting and Focus

**Files:**
- Modify: `src/combat/encounter.ts`
- Modify: `src/combat/encounter.test.ts`

**Interfaces:**
- Consumes: `isTargetable(enemy: Enemy): boolean` from Task 1; `Enemy.downs`; the `'rising'` stance.
- Produces, relied on by Task 3: `EncounterStep` gains `firstDownsThisFrame: string[]`.

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/encounter.test.ts`. Add `type Encounter` to the existing import from `./encounter`.

Two setup helpers, placed beside the existing `run`. They build the fight state directly rather than trying to gust a soldier to zero: a gust knocks its target roughly 6.7 m back per hit, so a second gust lands near the edge of the 12 m range and a third never connects at all. Constructing the state keeps these tests about the lists rather than about knockback tuning.

```ts
/** The single soldier of `near()`, already flat, having gone down `downs` times. */
function downedSoldier(downs: number): Encounter {
  const base = near()
  const enemy = base.enemies[0]!
  return {
    ...base,
    enemies: [{
      ...enemy,
      health: { ...enemy.health, current: 0 },
      stance: 'downed' as const,
      stanceTime: 0,
      downs,
    }],
  }
}

/** The same soldier, on its feet and one gust from going down again. */
function almostDown(downs: number): Encounter {
  const base = near()
  const enemy = base.enemies[0]!
  return {
    ...base,
    enemies: [{ ...enemy, health: { ...enemy.health, current: 0.1 }, downs }],
  }
}

const gustOnce = (from: Encounter) =>
  stepEncounter(from, { ...defaults, gustPressed: true }, 1 / 60, C, DEPS)
```

Then the tests:

```ts
describe('a soldier pushing back up', () => {
  /** Wait out the countdown on a downed soldier, leaving it mid-rise. */
  const rising = () => run(C.enemy.downedSeconds + 0.1, {}, downedSoldier(1)).encounter

  it('is on its way up once the countdown has run', () => {
    expect(rising().enemies[0]!.stance).toBe('rising')
  })

  it('can be hit, which is what makes the interrupt reachable', () => {
    // The regression isTargetable exists to prevent: every resolver used to skip anything
    // isDowned, and health is zero for the whole rise, so the gust would pass straight
    // through and the interrupt would be unreachable.
    expect(gustOnce(rising()).encounter.enemies[0]!.stance).toBe('downed')
  })

  it('is not reported as a down when it is knocked back over', () => {
    const step = gustOnce(rising())
    expect(step.downedThisFrame).toEqual([])
    expect(step.firstDownsThisFrame).toEqual([])
  })
})

describe('firstDownsThisFrame', () => {
  it('reports a soldier going down for the first time, alongside downedThisFrame', () => {
    const step = gustOnce(almostDown(0))
    expect(step.downedThisFrame).toEqual(['a'])
    expect(step.firstDownsThisFrame).toEqual(['a'])
  })

  it('drops a later down, so the ladder cannot be walked as a Focus engine', () => {
    // A soldier that has already been down once and has been chipped to zero again. The
    // burst should still fire; Focus should not pay twice.
    const step = gustOnce(almostDown(1))
    expect(step.downedThisFrame).toEqual(['a'])
    expect(step.firstDownsThisFrame).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npm test -- src/combat/encounter.test.ts
```

Expected: FAIL — `firstDownsThisFrame` is undefined, and the interrupt test fails because the gust skips the rising soldier.

- [ ] **Step 3: Make a rising soldier targetable**

Add `isTargetable` to the existing import from `./enemy` in `src/combat/encounter.ts`.

Replace every `!isDowned(enemy.health)` inside the four resolvers with `isTargetable(enemy)`. There are seven, at roughly lines 197, 200, 240, 266, 270, 287 and 291 — two each for gust, staff and wave (a filter and a map) and one for vortex. Search the file to confirm you have them all.

Do **not** touch the `isDowned` on line 181 (`wasDowned`) or line 323 (`downedThisFrame`). Those are about who was already down, not about who is worth hitting, and changing them would break the crossing diff.

- [ ] **Step 4: Report first downs separately**

In `src/combat/encounter.ts`, immediately after the `downedThisFrame` assignment and **before** the patrol restore, add:

```ts
  // Only the first crossing pays Focus, so a soldier cannot be walked up and down the
  // recovery ladder as a Focus engine. Kept apart from `downedThisFrame` rather than
  // replacing it, because every down is still worth its impact burst — the same split
  // hitThisFrame, slamHitThisFrame and staffHitThisFrame already make, for the same
  // reason: each feeds a differently tuned grant.
  const downedIds = new Set(downedThisFrame)
  const firstDownsThisFrame = enemies
    .filter((enemy) => downedIds.has(enemy.id) && enemy.downs === 1)
    .map((enemy) => enemy.id)
```

Add it to the `EncounterStep` interface, directly under `downedThisFrame`:

```ts
  /**
   * Of `downedThisFrame`, the soldiers going down for the first time.
   *
   * The Focus list. `downedThisFrame` is the feedback list and stays wider.
   */
  firstDownsThisFrame: string[]
```

And add `firstDownsThisFrame,` to the returned object.

- [ ] **Step 5: Run the tests and the typecheck**

```bash
npm test -- src/combat/encounter.test.ts && npm run typecheck
```

Expected: PASS. The typecheck will fail on `src/main.ts` if you have not yet added the field to the return object — it will not fail for `main.ts` not *reading* it, which Task 3 handles.

- [ ] **Step 6: Run the whole suite**

```bash
npm test
```

Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "Let a rising soldier be hit, and pay Focus for first downs only"
```

---

### Task 3: The tell and the wiring

**Files:**
- Modify: `src/combat/enemy-mesh.ts`
- Modify: `src/combat/enemy-mesh.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `risingProgress(enemy, c)` from Task 1; `firstDownsThisFrame` from Task 2.
- Produces: `EnemyView.sync(enemy: Enemy, cameraQuaternion: Quaternion, rising: number): void`.

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/enemy-mesh.test.ts`. Every existing `sync` call in this file needs a third argument — pass `0` to all of them, since none is about a rise. Then add:

```ts
describe('a soldier pushing back up', () => {
  const rising = (enemy: Enemy): Enemy => ({ ...downed(enemy), stance: 'rising' })

  it('lies flat at the start of the push-up', () => {
    const view = createEnemyView()
    view.sync(rising(enemyAt(0, 0)), CAMERA, 0)
    expect(rig(view).rotation.x).toBeCloseTo(Math.PI / 2)
  })

  it('stands upright by the end of it', () => {
    const view = createEnemyView()
    view.sync(rising(enemyAt(0, 0)), CAMERA, 1)
    expect(rig(view).rotation.x).toBeCloseTo(0)
  })

  it('is part way up in between', () => {
    const view = createEnemyView()
    view.sync(rising(enemyAt(0, 0)), CAMERA, 0.5)
    const half = rig(view).rotation.x
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(Math.PI / 2)
  })

  it('does not wear the wind-up colour', () => {
    // WINDUP is the dodge telegraph. Wearing it for a rise would teach the player to
    // dodge something that cannot hit them.
    const view = createEnemyView()
    view.sync({ ...enemyAt(0, 0), stance: 'wind-up' }, CAMERA, 0)
    const windUpColour = bodyColour(view)
    view.sync(rising(enemyAt(0, 0)), CAMERA, 0.5)
    expect(bodyColour(view)).not.toBe(windUpColour)
  })
})
```

`bodyColour` is a local helper beside the file's existing `rig` and `child` helpers. Add `Mesh` and `MeshLambertMaterial` to the `three` import:

```ts
function bodyColour(view: { object: Object3D }): number {
  const body = child(view, 'body')
  if (!(body instanceof Mesh)) throw new Error('expected the body to be a Mesh')
  return (body.material as MeshLambertMaterial).color.getHex()
}
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npm test -- src/combat/enemy-mesh.test.ts
```

Expected: FAIL — `Expected 2 arguments, but got 3`, then the rising rotation assertions failing because the downed branch flattens the body.

- [ ] **Step 3: Draw the push-up**

In `src/combat/enemy-mesh.ts`, widen the interface:

```ts
export interface EnemyView {
  object: Object3D
  /** `rising` is 0-to-1 progress through a push-up, from `risingProgress`. */
  sync(enemy: Enemy, cameraQuaternion: Quaternion, rising: number): void
}
```

Change the implementation's signature to match, then insert this branch **above** the `isDowned` branch — a rising soldier is still `isDowned`, so order decides which one wins:

```ts
      if (enemy.stance === 'rising') {
        // Flat at 0, upright at 1. The rotation carries the whole read: the colour stays
        // BODY, because WINDUP exists so the player can time a dodge, and wearing it here
        // would teach them to dodge something that cannot hit them.
        rig.rotation.set(
          (Math.PI / 2) * (1 - rising),
          Math.atan2(enemy.facing.x, enemy.facing.z),
          0,
        )
        bodyMaterial.color.setHex(BODY)
        spear.rotation.set(0, 0, 0)
        return
      }
```

- [ ] **Step 4: Wire it into `main.ts`**

Add `risingProgress` to the existing import from `./combat/enemy` — if `main.ts` has no import from that module yet, add `import { risingProgress } from './combat/enemy'` beside the other combat imports.

There are two `sync` call sites. Update both to:

```ts
      enemyViews.get(enemy.id)?.sync(
        enemy, camera.quaternion, risingProgress(enemy, DEFAULT_COMBAT_CONFIG.enemy),
      )
```

`DEFAULT_COMBAT_CONFIG.enemy` at both, including the one inside the player's down-beat settle block where `fightConfig` is out of scope. That is not a compromise: `boostedCombatConfig` only replaces `gust`, so `fightConfig.enemy` and `DEFAULT_COMBAT_CONFIG.enemy` are the same object either way, and one rule at both sites is easier to keep true than two.

Then change the Focus event mapping from `downs: fight.downedThisFrame.length` to:

```ts
      // firstDownsThisFrame, not downedThisFrame: the impact bursts below still fire for
      // every down, but only the first one a soldier suffers pays Focus.
      downs: fight.firstDownsThisFrame.length,
```

Leave the impact-burst loop reading `fight.downedThisFrame` — every down is still worth a burst.

- [ ] **Step 5: Typecheck and run the suite**

```bash
npm run typecheck && npm test
```

Expected: no type errors, everything green.

- [ ] **Step 6: Verify in the running game**

Start the dev server through the preview tooling (`preview_start` with the `airbender-skies-dev` config, never Bash). If the configured port is occupied the harness and vite can end up on different ports — check `preview_logs` for the URL vite actually printed and navigate there, rather than trusting the assigned one. Confirm the page is serving *this* checkout by checking that a rising soldier is possible at all before drawing conclusions.

Check all six:

1. Down a soldier, wait out the countdown, and watch it push up over a beat and rejoin the fight.
2. Hit one during the push-up — it goes straight back down and the countdown restarts.
3. Walk one down the full ladder: it comes back weaker each time and the third down sticks.
4. Focus jumps on a soldier's first down and not on later ones.
5. Blow one off the island — it never comes back.
6. Vortex one and down it in mid-air — the countdown does not start until the body lands.

If any fail, fix and re-verify before committing.

- [ ] **Step 7: Commit**

```bash
git add src/combat/enemy-mesh.ts src/combat/enemy-mesh.test.ts src/main.ts
git commit -m "Draw the push-up, and pay Focus only for a first down"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/design/aang-playable-character.md`
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: the behaviour built in Tasks 1–3.
- Produces: nothing.

- [ ] **Step 1: Correct the README**

`README.md`'s spear-patrol paragraph currently ends with a sentence that is now false — "enemies are downed, never killed, and a downed soldier stays lying where the air put them." Replace **only** that clause about staying down, keeping the rest of the sentence, so it reads:

```markdown
enemies are downed, never killed — but not for good. A soldier you put down will push
itself back onto its feet after a while, and rejoin weaker than it was. Hit one while it
is getting up and it goes straight back down, though that only buys you time: wearing a
soldier out for good still means taking its health to nothing, three times over.
```

- [ ] **Step 2: Record the ladder in the design document**

In `docs/design/aang-playable-character.md` §4.6, the first bullet begins "Every enemy has a **downed** state instead of a death state". Add a sub-bullet directly beneath it, indented two spaces to match the file's other nested lists:

```markdown
  - Downed is a condition, not a removal. A soldier gets back up after a spell on the
    ground, weaker each time, until a last down finally sticks. Standing over one as it
    rises and knocking it back down buys time but not progress — only damage moves a
    soldier down that ladder.
```

Keep it on one line per sentence-ish run like the surrounding bullets; do not hard-wrap it differently from its neighbours.

- [ ] **Step 3: Add a handoff entry**

In `docs/HANDOFF.md`, add at the end of the "What has been built" section, immediately before the `## What has NOT been built` heading:

```markdown
**Getting back up.** `src/combat/enemy.ts` gained a recovery ladder: a downed soldier waits
`downedSeconds`, pushes up over `risingSeconds`, and comes back on the next rung of
`recoveryHealthFractions` — 60% then 30% of max, which against a gust's damage is three
gusts to put down, then two, then one. Run off the end of the array and the down is
permanent. An empty array turns the whole feature off, which is the behaviour this module
had before.

Health stays at **zero** through both `downed` and `rising`, and that one choice is what
made the interrupt free: `hitEnemy` already ends with
`stance: isDowned(health) ? 'downed' : 'recover'`, so a hit during a rise puts the soldier
back down with the timer reset and no new code. It deliberately does *not* advance `downs` —
interrupting buys time, it does not substitute for damage. The cost was elsewhere: every
resolver in `encounter.ts` gated on `!isDowned`, which would have skipped a rising soldier
entirely, so all seven now ask `isTargetable`.

This sits beside `patrol.ts`'s restore rather than replacing it. That one is encounter-level
and needs the player to leave; this one is per-soldier and happens mid-fight. A restore
rebuilds the array with `spawnEnemy`, so it resets `downs` — a restored patrol is a fresh
patrol, which is what it already meant.

Focus pays `firstDownsThisFrame`, not `downedThisFrame`, so the ladder cannot be walked as a
Focus engine; the impact burst still fires on every down. Whether paying the *first* down
rather than the *last* is the right way round is an open question — §4.6 pays downs because
a non-lethal removal is the generous play, and the removal that sticks is the last one. It
is a one-line filter if it is revisited. Spec:
[`docs/superpowers/specs/2026-08-06-enemy-recovery-design.md`](superpowers/specs/2026-08-06-enemy-recovery-design.md).
```

- [ ] **Step 4: Check the diff is only these three files**

```bash
git diff --stat
```

Expected: three files, additions only apart from the one corrected README clause.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/design/aang-playable-character.md docs/HANDOFF.md
git commit -m "Document the recovery ladder"
```

---

## Out of scope

Carried from the spec, so nobody adds them here:

- Paying Focus on the last down instead of the first.
- Recovery for any enemy type other than spear infantry.
- A getting-up animation clip; the procedural rotation is the tell.
- Reinforcements, or changing `patrol.ts`'s restore.
- Enemies helping each other up.
- Retuning the Focus economy around longer fights.
