# Off-Screen Enemy Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw a chevron on a ring around the crosshair for every soldier that has engaged the player and is outside the frame, fading in as it leaves the view and flaring while it winds up to attack.

**Architecture:** One new pure module (`src/fx/off-screen.ts`) decides everything — whether a soldier earns a marker, and how strongly it draws — from an already-projected NDC point plus the soldier's own simulation state. One new DOM view (`src/ui/off-screen-view.ts`) draws it with the same rotate-a-tall-frame geometry the hit wedges use, so there is no trigonometry and no aspect-ratio correction. `src/main.ts` does the projection, because only it has the live camera. The combat model is not touched.

**Tech Stack:** TypeScript 7.0.2 (`noUncheckedIndexedAccess`, two-pass typecheck), three.js 0.185.1, Vitest 4.1.10 in the **node** environment (no DOM, no `AudioContext`, no `matchMedia`), Vite.

## Global Constraints

- Never commit to `main`. All work happens on the branch `off-screen-enemy-indicators`, which already exists and already holds the design doc.
- The design doc is `docs/superpowers/specs/2026-08-11-off-screen-enemy-indicators-design.md`. Where this plan and the spec disagree, stop and ask.
- Comments and documentation are written in **normal, full English prose**. Explain *why*, not *what*. This codebase's existing comments are the standard to match — read the file you are editing before adding to it.
- `OFF_SCREEN_RAMP = 0.25` exactly.
- The marker colour is `#e4614a` (the enemy health bar's fill). The winding colour is `#ff3b21`. The hit wedges' `#ff8f6b` must not be reused.
- Chevron frame height **104px**, chevron itself **20px** tall and **26px** wide, so the shape occupies 84–104px from the origin — outside the hit wedges' 54–74px.
- Rotation is `+bearing` (clockwise). A sign flip here points the player away from the threat and no test in this repo can catch it.
- Every overlay root keeps `pointer-events: none`.
- Nothing in this cycle reads `motionScales`. The indicator is deliberately outside reduce motion's scaling; say so in a comment where a reader would otherwise "fix" it.
- Run the **whole** suite (`npm test -- --run`) and **both** typecheck passes (`npm run typecheck`) before every commit, not just the new file's tests.
- Do not edit `src/combat/encounter.ts` or `src/combat/enemy.ts`. This cycle needs nothing new from them.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/fx/off-screen.ts` | **New, pure.** `OFF_SCREEN_RAMP`, `offScreenPresence`, `EnemyMarker`, `enemyMarker`. Every decision — targetable, in range, off screen, winding — lives here. |
| `src/fx/off-screen.test.ts` | **New.** Tests for both functions. |
| `src/ui/overlay-format.ts` | **New, pure.** `percent`, `radians`, `alpha` — the number-to-CSS formatters currently duplicated across the overlay views. |
| `src/ui/overlay-format.test.ts` | **New.** The first tests these three have ever had. |
| `src/ui/reticle-view.ts` | Modified: drops its private `percent` and imports the shared one. |
| `src/ui/hit-direction-view.ts` | Modified: drops its private `percent`, `radians`, `alpha` and imports the shared ones. |
| `src/ui/off-screen-view.ts` | **New.** The DOM half: style, element pool, `update`, `hide`, `dispose`. Untested — node has no DOM. |
| `src/main.ts` | Modified: creates the view, projects each drawn enemy position, builds the marker list, hides it while paused and through the down beat. |
| `src/ui/guide/reference.ts` | Modified: gains `SCREEN_MARKS`, a legend for both rings. |
| `src/ui/guide/panel.ts` | Modified: `GuideModel` gains `screenMarks`, and the panel renders it. |
| `docs/HANDOFF.md` | Modified: this cycle's section. |

---

### Task 1: The presence ramp

**Files:**
- Create: `src/fx/off-screen.ts`
- Test: `src/fx/off-screen.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const OFF_SCREEN_RAMP: number` (0.25) and
  `export function offScreenPresence(ndc: { x: number; y: number; z: number }): number`.
  Task 2 adds `enemyMarker` to the same file and calls this.

**Context you need.** Normalised device coordinates (NDC) are what `three.js`'s
`Vector3.project(camera)` produces: `x` and `y` run `-1` to `+1` across the visible frame, and `z`
runs `-1` to `+1` across the visible depth range. A point **behind** the camera comes back with `z`
outside that range and an `x`/`y` that is *mirrored* across the screen — a finite number that is
not a position. A camera with a non-finite `aspect` (a 0×0 canvas divides zero by zero) produces
`ndc.x` of `NaN` while `y` and `z` stay finite; that was watched happening in the previous cycle,
it is not hypothetical.

This function answers "how far off screen is this, as a 0-to-1 strength", so that the view can fade
a chevron in instead of popping it on as a soldier crosses the frame edge. Both of the cases above
mean "definitively off screen", so both return 1.

- [ ] **Step 1: Write the failing test**

Create `src/fx/off-screen.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { OFF_SCREEN_RAMP, offScreenPresence } from './off-screen'

/** Inside the visible depth range, so only the x/y position is under test. */
const IN_FRONT = 0.5

describe('offScreenPresence', () => {
  it('is zero for a point at the centre of the frame', () => {
    expect(offScreenPresence({ x: 0, y: 0, z: IN_FRONT })).toBe(0)
  })

  // Exactly on the edge, not approaching it. The boundary is where an off-by-one
  // comparison lives, and a soldier standing precisely at the frame edge must not
  // have a chevron drawn for it -- it is still visible.
  //
  // Every fixture in this file is asymmetric: x is never equal to y, and never equal
  // to -y either. That is not to catch an axis swap -- see the note on the swap
  // below, which is provably a no-op -- it is so that a one-axis implementation
  // cannot be masked by the other axis reading the same value.
  it('is zero for a point exactly on each of the four edges', () => {
    expect(offScreenPresence({ x: 1, y: -0.37, z: IN_FRONT })).toBe(0)
    expect(offScreenPresence({ x: -1, y: 0.42, z: IN_FRONT })).toBe(0)
    expect(offScreenPresence({ x: 0.31, y: 1, z: IN_FRONT })).toBe(0)
    expect(offScreenPresence({ x: -0.58, y: -1, z: IN_FRONT })).toBe(0)
  })

  // The four cases together are what pin the shape of the measurement. An
  // implementation that reads only x keeps the top and bottom cases at 0; one that
  // reads only y keeps left and right at 0; one that writes `ndc.x - 1` instead of
  // `Math.abs(ndc.x) - 1` keeps the left and bottom cases at 0. Each of those is a
  // real mutant and each reddens here.
  it('reaches half strength half a ramp past each edge', () => {
    const half = OFF_SCREEN_RAMP / 2
    expect(offScreenPresence({ x: 1 + half, y: 0.2, z: IN_FRONT })).toBeCloseTo(0.5)
    expect(offScreenPresence({ x: -1 - half, y: 0.63, z: IN_FRONT })).toBeCloseTo(0.5)
    expect(offScreenPresence({ x: -0.45, y: 1 + half, z: IN_FRONT })).toBeCloseTo(0.5)
    expect(offScreenPresence({ x: 0.28, y: -1 - half, z: IN_FRONT })).toBeCloseTo(0.5)
  })

  it('reaches full strength exactly one ramp past the edge', () => {
    expect(offScreenPresence({ x: 1 + OFF_SCREEN_RAMP, y: 0.13, z: IN_FRONT })).toBeCloseTo(1)
    expect(offScreenPresence({ x: -0.24, y: -1 - OFF_SCREEN_RAMP, z: IN_FRONT })).toBeCloseTo(1)
  })

  it('clamps at full strength well beyond the ramp', () => {
    // Without the clamp this would be 8, and the view writes it straight into an
    // opacity -- which CSS would clamp for us, so the wrongness would be invisible.
    expect(offScreenPresence({ x: 0.11, y: 1 + OFF_SCREEN_RAMP * 8, z: IN_FRONT })).toBe(1)
  })

  it('takes the larger overshoot when the point is past two edges at once', () => {
    // Off the right by a fifth of a ramp and off the top by three fifths. The larger
    // decides: the further out on any axis, the more definitely gone. Deliberately
    // unequal, so an implementation that took the smaller or averaged the two lands
    // on a different number rather than the same one by coincidence.
    const presence = offScreenPresence({
      x: 1 + OFF_SCREEN_RAMP * 0.2, y: 1 + OFF_SCREEN_RAMP * 0.6, z: IN_FRONT,
    })
    expect(presence).toBeCloseTo(0.6)
  })

  it('is full strength for a point behind the camera, however central its x and y', () => {
    // The case this whole feature exists for: a follow cam's blind spot is the space
    // directly behind the player, and `project` reports it with a mirrored x/y that
    // looks perfectly on-screen. Deciding from x and y alone would draw nothing for
    // the soldier standing right behind the player.
    expect(offScreenPresence({ x: 0.2, y: -0.4, z: 1.7 })).toBe(1)
  })

  it('is full strength for a point in front of the near plane', () => {
    expect(offScreenPresence({ x: -0.15, y: 0.36, z: -1.4 })).toBe(1)
  })

  it('is full strength for a projection with a non-finite component', () => {
    // A 0x0 canvas gives a camera a non-finite aspect, which projects to a NaN x
    // while y and z stay finite. Watched happening in the previous cycle.
    //
    // This is the one input where this module deliberately answers the opposite of
    // `reticleModel`, which reports `visible: false` for it. The reticle needs a
    // screen *position* and has none; a marker needs only a bearing, which comes
    // from world space and is unaffected. Asserted so that "making the two
    // consistent" has to argue with a test.
    expect(offScreenPresence({ x: NaN, y: 0.3, z: IN_FRONT })).toBe(1)
    expect(offScreenPresence({ x: 0.3, y: Infinity, z: IN_FRONT })).toBe(1)
    expect(offScreenPresence({ x: 0.3, y: 0.4, z: NaN })).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/fx/off-screen.test.ts`
Expected: FAIL — the module does not exist, so every test errors on the import.

- [ ] **Step 3: Write the implementation**

Create `src/fx/off-screen.ts`:

```ts
/**
 * How far past the frame edge, in normalised device coordinates, a soldier travels
 * before its chevron reaches full strength. A quarter of the half-width, so an eighth
 * of a screen width.
 *
 * Far enough that the chevron is only fully up once the soldier is definitively gone,
 * close enough that it arrives before the player wonders where they went. An argued
 * guess, not measured: nobody has played this.
 */
export const OFF_SCREEN_RAMP = 0.25

/**
 * How strongly to draw a marker for something at `ndc`: 0 while it is comfortably on
 * screen, ramping to 1 once it is definitively off it.
 *
 * A ramp read straight off the projection rather than a fade timer, and that is the
 * whole reason this function exists instead of a boolean. Soldiers cross the frame edge
 * constantly as the player turns, so a marker that switched on at the boundary would
 * blink through ordinary camera movement. The obvious fix is a per-soldier fade counter
 * stepped every frame; this needs no state at all, cannot drift out of sync with a
 * soldier that was removed from the fight, and is frame-rate independent without anyone
 * having to think about it.
 *
 * Two inputs mean "not on screen" rather than "somewhere off to one side", and both
 * return 1. A point behind the camera comes back from `Vector3.project` with `z` outside
 * [-1, 1] and an x/y mirrored across the screen — a finite number that is not a
 * position — and that is the population this feature mostly serves, since a follow cam's
 * blind spot is directly behind the player. A projection with a non-finite component is
 * the same story for a different reason: a camera whose `aspect` is not finite, which a
 * 0×0 canvas produces, gives a NaN `x` beside a perfectly finite `y` and `z`.
 *
 * `reticleModel` treats both of those as "hide", and this treating them as "show at full
 * strength" is deliberate rather than an inconsistency to tidy up. The reticle needs a
 * screen position and has none; a marker needs only a bearing, which comes from world
 * space and is unaffected by either.
 */
export function offScreenPresence(ndc: { x: number; y: number; z: number }): number {
  const placeable = Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Number.isFinite(ndc.z)
  if (!placeable || ndc.z < -1 || ndc.z > 1) return 1

  // The larger of the two axes' excesses: the further out on either, the more
  // definitely gone. Note for anyone writing tests against this — `Math.max` is
  // commutative, so swapping x and y here is a provable no-op and no test can catch
  // it. What tests can catch is reading only one axis, or dropping the absolute value
  // (which would report a point off the left or the bottom as fully on screen).
  const overshoot = Math.max(Math.abs(ndc.x) - 1, Math.abs(ndc.y) - 1)
  if (overshoot <= 0) return 0
  return Math.min(overshoot / OFF_SCREEN_RAMP, 1)
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test -- --run src/fx/off-screen.test.ts`
Expected: PASS, all tests.

Run: `npm run typecheck`
Expected: clean, both passes.

- [ ] **Step 5: Commit**

```bash
git add src/fx/off-screen.ts src/fx/off-screen.test.ts
git commit -m "Measure how far off screen a point is, as a strength rather than a flag"
```

---

### Task 2: Who earns a marker

**Files:**
- Modify: `src/fx/off-screen.ts` (append)
- Test: `src/fx/off-screen.test.ts` (append)

**Interfaces:**
- Consumes: `offScreenPresence` and `OFF_SCREEN_RAMP` from Task 1. From the existing codebase:
  `Enemy`, `EnemyConfig`, `Stance`, `isTargetable` and `spawnEnemy` from `../combat/enemy`;
  `DEFAULT_COMBAT_CONFIG` from `../combat/config`.
- Produces:
  ```ts
  export interface EnemyMarker { bearing: number; strength: number; winding: boolean }
  export function enemyMarker(
    enemy: Enemy,
    playerPosition: Vector3,
    ndc: { x: number; y: number; z: number },
    bearing: number,
    c: EnemyConfig,
  ): EnemyMarker | null
  ```
  Task 3's view consumes `EnemyMarker`; Task 4 calls `enemyMarker`.

**Context you need.**

`isTargetable(enemy)` already exists in `src/combat/enemy.ts` and means "on its feet, or pushing
back up onto them" — `!isDowned(enemy.health) || enemy.stance === 'rising'`. Call it; do not restate
the condition. It is the same predicate that decides what the gust cone will hit.

`Stance` is `'advance' | 'wind-up' | 'recover' | 'downed' | 'rising'`.

`EnemyConfig.aggroRange` is the soldier's notice range: **26** for a spear, **38** for an archer, in
`DEFAULT_COMBAT_CONFIG.enemies`. Read it from the config passed in — never write the number.

**The one thing in this task that needs care.** `stepEnemy` measures a spear's notice range
**horizontally** and an archer's in **3D**; that difference is what makes the archer the type that
pressures altitude. This function measures **3D for both**, and the difference is deliberate: a
spear standing 30 units below a hovering player is at horizontal distance 0, has noticed them, and
cannot reach them for as long as they stay up there. Marking it would hang a permanent ring of
chevrons around a player who is doing the correct thing. Measured in 3D this is **stricter than the
fight for a spear** and **identical to the fight for an archer**. The test below pins exactly that,
with real numbers, because it is the claim the whole decision rests on.

- [ ] **Step 1: Write the failing test**

Append to `src/fx/off-screen.test.ts`, and add these imports at the top of the file:

```ts
import { Vector3 } from 'three'
import { spawnEnemy, type Enemy, type Stance } from '../combat/enemy'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { OFF_SCREEN_RAMP, enemyMarker, offScreenPresence } from './off-screen'
```

(The `OFF_SCREEN_RAMP, offScreenPresence` import already exists from Task 1 — extend it rather than
adding a second import line from the same module.)

```ts
const SPEAR = DEFAULT_COMBAT_CONFIG.enemies.spear
const ARCHER = DEFAULT_COMBAT_CONFIG.enemies.archer

const PLAYER = new Vector3(0, 0, 0)
/** Well past the frame edge on x, so `offScreenPresence` is 1 and only the other rules vary. */
const OFF_FRAME = { x: 1.6, y: 0.12, z: 0.5 }
/** Comfortably inside the frame. */
const ON_FRAME = { x: 0.2, y: -0.34, z: 0.5 }

/**
 * A spear 20 units away on x — inside its aggroRange of 26 measured either way, so
 * fixtures built on it isolate whatever rule the test is actually about.
 */
function nearSpear(): Enemy {
  return spawnEnemy('spear-1', new Vector3(20, 0, 0), 'spear', SPEAR)
}

/** The same soldier with a stance and a health pool that agree with each other. */
function withStance(enemy: Enemy, stance: Stance): Enemy {
  const down = stance === 'downed' || stance === 'rising'
  return {
    ...enemy,
    stance,
    health: { ...enemy.health, current: down ? 0 : enemy.health.max },
  }
}

describe('enemyMarker', () => {
  it('marks an engaged soldier that is off the frame, passing the bearing through signed', () => {
    // Signed, and asserted at two signs. A marker that returned a magnitude would draw
    // every threat on the same side of the screen, which is worse than drawing none.
    expect(enemyMarker(nearSpear(), PLAYER, OFF_FRAME, 1.234, SPEAR))
      .toEqual({ bearing: 1.234, strength: 1, winding: false })
    expect(enemyMarker(nearSpear(), PLAYER, OFF_FRAME, -0.77, SPEAR))
      .toEqual({ bearing: -0.77, strength: 1, winding: false })
  })

  it('carries the ramp through as the strength rather than a flag', () => {
    const half = { x: 1 + OFF_SCREEN_RAMP / 2, y: -0.19, z: 0.5 }
    expect(enemyMarker(nearSpear(), PLAYER, half, 0, SPEAR)?.strength).toBeCloseTo(0.5)
  })

  it('does not mark a soldier that is on the frame', () => {
    expect(enemyMarker(nearSpear(), PLAYER, ON_FRAME, 0.5, SPEAR)).toBeNull()
  })

  it('does not mark a downed soldier, and does mark a rising one', () => {
    // Both halves matter. A body lying flat is not a threat; a soldier pushing back up
    // is targetable and is about to be one, and `isTargetable`'s second clause is the
    // half a single "downed gives null" test would leave unasserted.
    expect(enemyMarker(withStance(nearSpear(), 'downed'), PLAYER, OFF_FRAME, 0, SPEAR)).toBeNull()
    expect(enemyMarker(withStance(nearSpear(), 'rising'), PLAYER, OFF_FRAME, 0, SPEAR)).not.toBeNull()
  })

  it('measures a spear in 3D, not horizontally like the fight does', () => {
    // The claim the whole range rule rests on. A spear at the origin with the player
    // hovering 30 units overhead is at horizontal distance 0 -- inside any range -- and
    // at 3D distance 30, outside its aggroRange of 26. An implementation that copied
    // `stepEnemy`'s horizontal measurement returns a marker here, and a hovering player
    // gets a permanent ring of chevrons for infantry that cannot touch them.
    const spear = spawnEnemy('spear-1', new Vector3(0, 0, 0), 'spear', SPEAR)
    const hovering = new Vector3(0, 30, 0)
    expect(spear.position.distanceTo(hovering)).toBeGreaterThan(SPEAR.aggroRange)
    expect(enemyMarker(spear, hovering, OFF_FRAME, 0, SPEAR)).toBeNull()

    // The same soldier, the same distance, on the level: now inside its notice range
    // and marked. Both halves in one test, so the null above cannot be passing for the
    // wrong reason.
    const alongside = new Vector3(20, 0, 0)
    expect(spear.position.distanceTo(alongside)).toBeLessThan(SPEAR.aggroRange)
    expect(enemyMarker(spear, alongside, OFF_FRAME, 0, SPEAR)).not.toBeNull()
  })

  it('marks up to the notice range the config gives, and not past it', () => {
    // Positions built from `aggroRange` rather than written as 37 and 39, so retuning
    // the archer moves the test with it instead of reddening it. The direction is a
    // genuine 3D diagonal of length exactly 7 -- (2, 3, -6) -- so an implementation
    // that measured only one axis, or only the horizontal plane, lands somewhere else.
    const unit = new Vector3(2, 3, -6).divideScalar(7)
    const at = (distance: number) => spawnEnemy(
      'archer-1', unit.clone().multiplyScalar(distance), 'archer', ARCHER,
    )
    expect(enemyMarker(at(ARCHER.aggroRange - 1), PLAYER, OFF_FRAME, 0, ARCHER)).not.toBeNull()
    // Inclusive at the boundary, matching `stepEnemy`'s own `distance > c.aggroRange`
    // test for holding station.
    expect(enemyMarker(at(ARCHER.aggroRange), PLAYER, OFF_FRAME, 0, ARCHER)).not.toBeNull()
    expect(enemyMarker(at(ARCHER.aggroRange + 1), PLAYER, OFF_FRAME, 0, ARCHER)).toBeNull()
  })

  it('warns only in the wind-up, across every stance there is', () => {
    // A Record rather than an array of the five stances that exist today, and that is
    // the point of writing it this way: adding a sixth stance fails to compile until
    // someone decides whether it warns. `WIND_LEGEND` in src/ui/guide/reference.ts uses
    // the same device over `WindKind`, for the same reason.
    //
    // `null` means "no marker at all is expected", which is the honest entry for
    // `downed` -- there is no marker to read a `winding` off.
    const expected: Record<Stance, boolean | null> = {
      advance: false,
      'wind-up': true,
      recover: false,
      rising: false,
      downed: null,
    }
    for (const [stance, warns] of Object.entries(expected) as [Stance, boolean | null][]) {
      const marker = enemyMarker(withStance(nearSpear(), stance), PLAYER, OFF_FRAME, 0, SPEAR)
      if (warns === null) expect(marker, stance).toBeNull()
      else expect(marker?.winding, stance).toBe(warns)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/fx/off-screen.test.ts`
Expected: FAIL — `enemyMarker` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/fx/off-screen.ts`, and add the imports it needs at the top:

```ts
import type { Vector3 } from 'three'
import { isTargetable, type Enemy, type EnemyConfig } from '../combat/enemy'
```

```ts
/** One soldier's chevron: which way, how strongly, and whether it is about to strike. */
export interface EnemyMarker {
  /**
   * Screen bearing in radians: 0 dead ahead, positive clockwise on screen. Handed in
   * rather than computed, because it comes from `bearingFromCamera` — the same function
   * the hit wedges use, so the two overlays cannot disagree about which way is right.
   */
  bearing: number
  /** 0 at the frame edge, rising to 1 once the soldier is definitively off screen. */
  strength: number
  /** This soldier is in its wind-up: the release is coming. */
  winding: boolean
}

/**
 * A marker for this soldier, or null when it has not earned one.
 *
 * Three rules, all here rather than split between this and the caller, because
 * `src/main.ts` has no tests: whatever the caller decides is untested by construction.
 *
 * The distance is measured **in 3D, which is deliberately not how the fight measures a
 * spear's notice range.** `stepEnemy` measures melee horizontally — that is what makes an
 * archer the type that pressures altitude — so a spear standing 30 units below a hovering
 * player is at horizontal distance 0, has noticed them, and cannot reach them for as long
 * as they stay up there. Marking it would hang a permanent ring of chevrons around a
 * player who is doing the correct thing, which is the clutter `HIT_MARK_SECONDS` was
 * picked to avoid. Measured in 3D this is stricter than the fight for a spear and
 * identical to it for an archer, which already measures in 3D. `aggroRange` is read from
 * the config rather than written here, so retuning notice range moves the markers with it.
 *
 * `isTargetable` rather than a fresh health test, so there is one definition in the
 * codebase of a soldier worth aiming at — it is the same predicate the gust cone uses,
 * and it counts a rising soldier as live.
 */
export function enemyMarker(
  enemy: Enemy,
  playerPosition: Vector3,
  ndc: { x: number; y: number; z: number },
  bearing: number,
  c: EnemyConfig,
): EnemyMarker | null {
  if (!isTargetable(enemy)) return null
  if (enemy.position.distanceTo(playerPosition) > c.aggroRange) return null
  const strength = offScreenPresence(ndc)
  if (strength <= 0) return null
  return { bearing, strength, winding: enemy.stance === 'wind-up' }
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test -- --run src/fx/off-screen.test.ts`
Expected: PASS, all tests in the file including Task 1's.

Run: `npm test -- --run`
Expected: PASS, whole suite.

Run: `npm run typecheck`
Expected: clean, both passes.

- [ ] **Step 5: Commit**

```bash
git add src/fx/off-screen.ts src/fx/off-screen.test.ts
git commit -m "Decide which soldiers earn an off-screen chevron, and how brightly"
```

---

### Task 3: Shared formatters, and the chevron ring

**Files:**
- Create: `src/ui/overlay-format.ts`
- Test: `src/ui/overlay-format.test.ts`
- Modify: `src/ui/reticle-view.ts` (delete its private `percent`, import the shared one)
- Modify: `src/ui/hit-direction-view.ts` (delete its private `percent`, `radians`, `alpha`)
- Create: `src/ui/off-screen-view.ts`

**Interfaces:**
- Consumes: `EnemyMarker` from `../fx/off-screen` (Task 2).
- Produces:
  ```ts
  // src/ui/overlay-format.ts
  export function percent(fraction: number): string
  export function radians(angle: number): string
  export function alpha(value: number): string

  // src/ui/off-screen-view.ts
  export interface OffScreenOrigin { x: number; y: number }
  export function createOffScreen(parent: HTMLElement): {
    update(markers: readonly EnemyMarker[], origin: OffScreenOrigin): void
    hide(): void
    dispose(): void
  }
  ```
  Task 4 calls `createOffScreen`, `update` and `hide`.

**Why the formatters move first.** `percent` is currently written out **identically** in
`src/ui/reticle-view.ts:29` and `src/ui/hit-direction-view.ts:83`. This task needs it a third time,
plus `radians` and `alpha`, which `hit-direction-view.ts` holds privately. A third verbatim copy is
the kind of thing this project's review rubric treats as a defect, so they move to one module that
all three views import. They are pure string formatting, so they are also the only part of the
overlay layer that the node test environment **can** test — and today they have no tests at all.

Read the comment above the three functions in `src/ui/hit-direction-view.ts` before you move them;
it explains what they are for and it moves with them.

- [ ] **Step 1: Write the failing test**

Create `src/ui/overlay-format.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { alpha, percent, radians } from './overlay-format'

describe('percent', () => {
  it('writes a viewport fraction as a CSS percentage', () => {
    expect(percent(0.5)).toBe('50.000%')
    expect(percent(0)).toBe('0.000%')
    expect(percent(1)).toBe('100.000%')
  })

  it('rounds to a thousandth of a percent, which is a hundredth of a pixel', () => {
    expect(percent(1 / 3)).toBe('33.333%')
  })

  it('flattens a tiny float instead of writing it in exponent notation', () => {
    // The whole reason these three exist. A raw NDC-derived fraction is regularly
    // seventeen significant digits, and `${1.2e-16 * 100}%` is the string "1.2e-14%".
    // CSS does accept that -- checked in a browser rather than assumed -- so this is
    // about keeping full-precision floats out of the DOM on every rendered frame, not
    // about validity.
    expect(percent(1.2e-16)).toBe('0.000%')
  })
})

describe('radians', () => {
  it('writes an angle as CSS radians, signed', () => {
    expect(radians(0)).toBe('0.00000rad')
    expect(radians(Math.PI)).toBe('3.14159rad')
    // Negative: a bearing to the player's left. Dropping the sign here would mirror
    // every overlay that uses this, which is the one error in the ring that matters.
    expect(radians(-Math.PI / 2)).toBe('-1.57080rad')
  })

  it('flattens a tiny angle rather than writing an exponent', () => {
    expect(radians(2.4e-17)).toBe('0.00000rad')
  })
})

describe('alpha', () => {
  it('writes an opacity at a thousandth, which is under one 255th', () => {
    expect(alpha(1)).toBe('1.000')
    expect(alpha(0)).toBe('0.000')
    expect(alpha(1 / 3)).toBe('0.333')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/ui/overlay-format.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Create the shared module**

Create `src/ui/overlay-format.ts`:

```ts
/*
 * Number-to-CSS formatters for the overlay views.
 *
 * Every number those views write into a `style` goes through one of these three, which
 * round to below anything visible: a thousandth of a percent is a hundredth of a pixel,
 * 1e-5 radians is six ten-thousandths of a degree, and a thousandth of an opacity step is
 * under one 255th.
 *
 * The point is only to keep full-precision floats out of the DOM — each of these is
 * called once per rendered frame per element, and a raw `atan2` result or a raw
 * `life / HIT_MARK_SECONDS` is regularly seventeen significant digits. It is **not** a
 * correctness fix, in case the rounding suggests one: CSS numbers accept exponent
 * notation, checked in a browser rather than assumed (`rotate(2.4e-17rad)` parses and
 * reads back intact), so the unrounded values were never invalid.
 *
 * Shared rather than private to each view because `percent` was already written out
 * identically in two of them and this cycle needed a third copy. They are also the only
 * part of the overlay layer the node test environment can reach, the views themselves
 * having no DOM to build against, so moving them here is what gave them tests.
 */

export function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}%`
}

export function radians(angle: number): string {
  return `${angle.toFixed(5)}rad`
}

export function alpha(value: number): string {
  return value.toFixed(3)
}
```

- [ ] **Step 4: Point the two existing views at it**

In `src/ui/reticle-view.ts`: delete the private `percent` function and its comment block, and add
`import { percent } from './overlay-format'` beside the file's existing imports.

In `src/ui/hit-direction-view.ts`: delete the private `percent`, `radians` and `alpha` functions
**and the comment block above them** (it has moved into `overlay-format.ts`), and add
`import { alpha, percent, radians } from './overlay-format'`.

Change nothing else in either file. This is a move, not a rewrite: no call site changes, no
behaviour changes.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test -- --run`
Expected: PASS. Nothing should have changed behaviourally — if a test reddens here, the move was
not a pure move.

Run: `npm run typecheck`
Expected: clean, both passes.

- [ ] **Step 6: Commit the move**

```bash
git add src/ui/overlay-format.ts src/ui/overlay-format.test.ts src/ui/reticle-view.ts src/ui/hit-direction-view.ts
git commit -m "Give the overlay views one copy of their CSS number formatters, and tests for them"
```

- [ ] **Step 7: Write the chevron ring**

Create `src/ui/off-screen-view.ts`. Read `src/ui/hit-direction-view.ts` first — this file is built
the same way, and the geometry comment there records a browser measurement that this file relies on.

```ts
import { alpha, percent, radians } from './overlay-format'
import type { EnemyMarker } from '../fx/off-screen'

/**
 * The off-screen threat ring: one chevron per engaged soldier outside the frame, pointing
 * at where they are.
 *
 * Untested for the reason all three overlay views are — the test environment is node, so
 * there is no DOM to build against — and every decision it draws from is pure and tested
 * in `src/fx/off-screen.ts`.
 *
 * **Deliberately not scaled by any reduce-motion scalar**, exactly like the hit-direction
 * wedges, and for the same reason: it is information rather than motion. A chevron does
 * not shake, pulse, travel or grow. It fades in, tracks, and fades out. `motionScales`
 * zeroes `hurtFlash`, which is what makes screen-space information the thing that keeps a
 * fight playable in that mode — so scaling this would take away the help exactly where it
 * is needed most.
 */

/**
 * The enemy health bar's fill, and the same literal `src/combat/health-bar.ts` uses.
 *
 * Reused rather than picked: the player already reads this cooler red as "an enemy is the
 * subject", against the warm `#ff8f6b` the hit wedges and the player's own health bar
 * share. The two rings orbit the same point, so having them speak different halves of an
 * existing vocabulary is most of what makes them distinguishable. Copied rather than
 * imported, like the hit wedge's colour: a look, not a contract, and nothing breaks if the
 * two drift.
 */
const MARKER_COLOUR = '#e4614a'

/**
 * The same hue family pushed to full saturation, for a soldier in its wind-up.
 *
 * Same family so the chevron still reads as an enemy; hot enough to separate from both
 * `MARKER_COLOUR` and the hit wedges' `#ff8f6b` at a glance, since all three can be on
 * screen at once. Deliberately not the Focus gold, which means something else entirely.
 */
const WINDING_COLOUR = '#ff3b21'

/*
 * Geometry, and why it is a rotation rather than a sine and a cosine.
 *
 * Each chevron is a tall transparent frame whose *bottom centre* is pinned to the ring's
 * origin — `transform-origin: 50% 100%` — with the visible shape drawn at its far end.
 * Rotating that frame swings the chevron around the origin at a fixed radius, so there is
 * no trigonometry in this file and no aspect-ratio correction to get wrong: a rotation is
 * a rotation whatever shape the window is, where an `x = cos θ` / `y = sin θ` placement in
 * viewport percentages would stretch the ring into an ellipse on any window that is not
 * square.
 *
 * **The rotation is `+bearing`, clockwise.** `bearingFromCamera` returns 0 dead ahead and
 * positive when the source is to the camera's screen-right; CSS positive rotation is also
 * clockwise on screen. `src/ui/hit-direction-view.ts` records the browser measurement that
 * established this — three marks driven at bearings 0, +π/2 and -π/2 landed at (0, -64),
 * (+64, 0) and (-64, 0) — and it carries over unchanged here because the bearing comes from
 * the same function. A sign flip would point the player away from the threat, and no test
 * in this repo can catch it: if you change the geometry below, measure it again the same
 * way.
 *
 * The chevron sits 84–104 px out, clear of the hit wedges' 54–74 px by 10 px, so a full
 * ring of both does not overlap.
 *
 * A `clip-path` polygon rather than the CSS border triangle `hit-direction-view.ts` prefers,
 * and the departure is the point: these two rings orbit the same origin and must not be
 * mistaken for one another. A border triangle cannot be hollow without a second element,
 * and a hollow V beside a filled wedge is the cheapest difference a glance can resolve.
 * Apex up — the chevron points away from the player, at the soldier.
 */
const STYLE = `
.offscr { position: fixed; left: 0; top: 0; width: 0; height: 0;
  /* Never interactive, like every other overlay in this project: a click sink over the
     canvas would swallow the click that requests the pointer lock, which is how play
     resumes. */
  pointer-events: none; }
.offscr-mark { position: absolute; left: 0; bottom: 0; width: 26px; height: 104px;
  margin-left: -13px; transform-origin: 50% 100%; }
.offscr-chevron { position: absolute; top: 0; left: 0; width: 26px; height: 20px;
  background: ${MARKER_COLOUR};
  clip-path: polygon(50% 0%, 100% 100%, 82% 100%, 50% 26%, 18% 100%, 0% 100%);
  filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
.offscr-mark.winding .offscr-chevron { background: ${WINDING_COLOUR}; }
`

/**
 * Where the chevrons are drawn around, as viewport fractions from the top-left.
 *
 * Declared here rather than shared with `HitDirectionOrigin`: it is two structural fields
 * that a `ReticleModel` already satisfies, so a shared name would couple two views for no
 * benefit.
 */
export interface OffScreenOrigin {
  x: number
  y: number
}

export function createOffScreen(parent: HTMLElement) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'offscr'
  parent.append(root)

  /**
   * One element per concurrent chevron, grown on demand and never shrunk.
   *
   * The same pool `createHitDirection` uses and for the same reason: this runs once per
   * rendered frame, and reparsing markup at 120 Hz to draw a handful of shapes would be
   * the one piece of per-frame allocation in the whole overlay layer. It never shrinks
   * because the high-water mark is the size of the patrol, which is small, and a hidden
   * `div` costs nothing.
   */
  const marks: HTMLElement[] = []

  function markAt(index: number): HTMLElement {
    const existing = marks[index]
    if (existing) return existing
    const mark = document.createElement('div')
    mark.className = 'offscr-mark'
    mark.innerHTML = '<div class="offscr-chevron"></div>'
    root.append(mark)
    marks[index] = mark
    return mark
  }

  return {
    /**
     * Draw one chevron per marker, around `origin`.
     *
     * `origin` is the reticle's own position rather than screen centre, so the reticle and
     * both rings read as one instrument. The caller decides what to pass when the reticle
     * is hidden; this file has no opinion about it.
     */
    update(markers: readonly EnemyMarker[], origin: OffScreenOrigin): void {
      root.style.display = 'block'
      root.style.left = percent(origin.x)
      root.style.top = percent(origin.y)

      for (let i = 0; i < Math.max(marks.length, markers.length); i += 1) {
        const mark = markAt(i)
        const model = markers[i]
        if (!model) {
          // Hidden rather than removed, so the pool above stays valid.
          mark.style.display = 'none'
          continue
        }
        mark.style.display = 'block'
        // Radians directly: CSS takes them, and converting to degrees here would be a
        // second place the sign convention could be inverted by accident.
        mark.style.transform = `rotate(${radians(model.bearing)})`
        mark.style.opacity = alpha(model.strength)
        // A class rather than writing the colour, so the two tints stay in the stylesheet
        // together where a reader comparing them does not have to look in two places.
        mark.classList.toggle('winding', model.winding)
      }
    },
    /**
     * Take every chevron off screen.
     *
     * Called from the paused branch of `frame()` and from the down beat, neither of which
     * has a fresh origin or a fresh marker list — `syncVisuals` is what produces both.
     */
    hide(): void {
      root.style.display = 'none'
    },
    dispose(): void {
      root.remove()
      style.remove()
    },
  }
}
```

- [ ] **Step 8: Run the whole suite and the typecheck**

Run: `npm test -- --run`
Expected: PASS. This file has no tests of its own; the suite must stay green.

Run: `npm run typecheck`
Expected: clean, both passes. This is the only automated check on this file, so read it once more
against the constraints above before committing: `pointer-events: none`, `+bearing`, 84–104 px,
`#e4614a` / `#ff3b21`, no `motionScales`.

- [ ] **Step 9: Commit**

```bash
git add src/ui/off-screen-view.ts
git commit -m "Draw a ring of chevrons for the soldiers outside the frame"
```

---

### Task 4: Wire it into the game

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `enemyMarker` and `EnemyMarker` from `./fx/off-screen` (Task 2); `createOffScreen` from
  `./ui/off-screen-view` (Task 3); `bearingFromCamera` from `./fx/hit-direction` (already shipped).
- Produces: nothing. This is the last wiring task.

**Context you need.** `src/main.ts` has no tests — that is a standing property of this codebase, not
something this task fixes. Everything decidable was pushed into Task 2 for exactly that reason, and
what is left here is projection and plumbing. Verify it by reading and by typecheck.

Five edits, in file order.

- [ ] **Step 1: Add the imports**

Beside the existing overlay imports (`src/main.ts:64-67`):

```ts
import { createOffScreen } from './ui/off-screen-view'
import { enemyMarker, type EnemyMarker } from './fx/off-screen'
```

And extend the existing `./fx/hit-direction` import to bring in the bearing function:

```ts
import { bearingFromCamera, markFor, stepHitMarks, type HitMark } from './fx/hit-direction'
```

- [ ] **Step 2: Create the view, before the HUD**

Immediately after `const hitDirection = createHitDirection(document.body)` (around `src/main.ts:356`)
and **before** `const hud = createHud(document.body)`:

```ts
  const offScreen = createOffScreen(document.body)
```

The ordering is load-bearing and the comment block just above those lines explains why: none of the
overlays sets a `z-index`, so they stack in document order, and the HUD's full-screen `.hud-fade`
and `.hud-hurt` layers must paint over them.

- [ ] **Step 3: Add the per-frame scratch**

After `const aimPoint = new Vector3()` (around `src/main.ts:475`):

```ts
  /**
   * Scratch for a soldier's projected position, and for the camera's own heading.
   *
   * Reused for the same reason every other scratch in this block is: `syncVisuals` runs
   * once per rendered frame for the whole session, so allocating a Vector3 per soldier per
   * frame would be the only garbage the presentation layer produces.
   */
  const markerPoint = new Vector3()
  const cameraForward = new Vector3()
  /** Rebuilt in place each frame rather than reallocated, for the same reason. */
  const markers: EnemyMarker[] = []
```

- [ ] **Step 4: Build the markers in `syncVisuals`**

Insert this immediately after the `const aimOnScreen = ...` assignment (around `src/main.ts:1201`)
and **before** the `if (down)` block:

```ts
    // After `camera.updateProjectionMatrix()` above, for the same reason the reticle's
    // projection is: `Vector3.project` reads the projection matrix and the inverse world
    // matrix, and both changed in the block above.
    //
    // The camera's own world heading, not `lookDirection`. The hit wedges are handed
    // `lookDirection` because `markFor` is called from `update()`, where reading the
    // camera would pull render state into the simulation half of the frame — and the
    // drawn camera trails the look direction by a measured 17.78 degrees in a sustained
    // 180 degrees-per-second turn on foot. A frozen bearing can afford that error. A
    // bearing recomputed every frame cannot: it would slide the whole ring during every
    // flick and settle afterwards. Here, after `camera.lookAt`, the accurate value is
    // free. `getWorldDirection` calls `updateWorldMatrix` itself, so it does not depend on
    // the renderer having run.
    camera.getWorldDirection(cameraForward)
    markers.length = 0
    for (const enemy of encounter.enemies) {
      const view = enemyViews.get(enemy.id)
      if (!view) continue
      // The *drawn* position, which the enemy loop at the top of this function has already
      // set from each soldier's interpolator. The chevron points at the body the player
      // would see if they turned, so its direction has to come from where that body is
      // drawn rather than from a simulation position up to one step away from it.
      //
      // The distance and stance rules inside `enemyMarker` read the simulation's own
      // `enemy` instead, because those are what the fight decided. The same mix, for the
      // same reason, as the reticle's drawn origin and simulation heading above.
      markerPoint.copy(view.object.position).project(camera)
      const marker = enemyMarker(
        enemy,
        player.position,
        markerPoint,
        bearingFromCamera(cameraForward, sampledPosition, view.object.position),
        DEFAULT_COMBAT_CONFIG.enemies[enemy.kind],
      )
      if (marker) markers.push(marker)
    }
```

- [ ] **Step 5: Draw it, and hide it in both branches that hide the others**

In the `if (down)` block at the end of `syncVisuals` (around `src/main.ts:1216`), add the third
hide:

```ts
    if (down) {
      reticle.hide()
      hitDirection.hide()
      offScreen.hide()
      return
    }
    reticle.update(aim)
    hitDirection.update(hitMarks, aimOnScreen ? aim : SCREEN_CENTRE)
    offScreen.update(markers, aimOnScreen ? aim : SCREEN_CENTRE)
```

And in the paused branch of `frame()` (around `src/main.ts:1317`), beside the other two:

```ts
      reticle.hide()
      hitDirection.hide()
      offScreen.hide()
```

- [ ] **Step 6: Run the whole suite and the typecheck**

Run: `npm test -- --run`
Expected: PASS, unchanged count from Task 3.

Run: `npm run typecheck`
Expected: clean, both passes.

- [ ] **Step 7: Confirm the wiring is actually load-bearing**

`main.ts` has no tests, so demonstrate rather than assume. Temporarily delete the
`offScreen.update(...)` line, run `npm run typecheck`, and confirm it reports `markers` and
`offScreen` as unused — or, if it does not, record in your report that the wiring is invisible to
both the suite and the typecheck, which is what a reviewer needs to know. Restore the line before
committing (`git diff` must show it back).

- [ ] **Step 8: Commit**

```bash
git add src/main.ts
git commit -m "Point a chevron at every engaged soldier outside the frame"
```

---

### Task 5: The legend, and the handoff

**Files:**
- Modify: `src/ui/guide/reference.ts`
- Modify: `src/ui/guide/panel.ts`
- Test: `src/ui/guide/reference.test.ts`
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: `MeterNote` from `./reference` (already exists), `notesHtml` from `./panel` (already
  exists, generic over `{ name: string; detail: string }`).
- Produces: `export const SCREEN_MARKS: readonly MeterNote[]` and a `screenMarks` field on
  `GuideModel`.

**Why this task exists.** Task 4 puts a second ring of small shapes around the same point as the
first, and nothing on screen tells the player which is which. The hit wedges shipped without an
explanation; this is where that gap closes, because it is this cycle that creates the ambiguity.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/guide/reference.test.ts`:

```ts
import { SCREEN_MARKS } from './reference'

describe('SCREEN_MARKS', () => {
  it('explains both rings drawn around the crosshair', () => {
    // Two entries, because there are two rings and the whole purpose of this list is
    // telling them apart. A test on `length` alone would pass a list with two copies of
    // one entry, so the names are asserted too.
    expect(SCREEN_MARKS.map((mark) => mark.name)).toEqual(['Hit direction', 'Threats off screen'])
  })

  it('names each ring\'s colour, which is the only thing distinguishing them on screen', () => {
    // The shapes differ too, but colour is what a glance resolves first, and a legend
    // that described the behaviour without naming the colour would leave the player
    // matching prose to shapes.
    expect(SCREEN_MARKS[0]?.detail).toMatch(/orange/)
    expect(SCREEN_MARKS[1]?.detail).toMatch(/red/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/ui/guide/reference.test.ts`
Expected: FAIL — `SCREEN_MARKS` is not exported.

- [ ] **Step 3: Add the legend**

Append to `src/ui/guide/reference.ts`, after `METERS`:

```ts
/**
 * The two rings of shapes drawn around the crosshair.
 *
 * A list of its own rather than three more `METERS` entries: those are bars with values,
 * these are markers with directions, and the guide renders them under their own heading so
 * a player looking for "what is that shape" is not reading past the health bar to find it.
 *
 * They exist as written copy at all because there are two of them around one point. One
 * ring needed no legend; two similar rings do.
 */
export const SCREEN_MARKS: readonly MeterNote[] = [
  {
    name: 'Hit direction',
    detail: 'A solid orange wedge, close in around the crosshair, pointing at where an '
      + 'attack came from. It marks the direction at the moment it landed and then holds '
      + 'still while you turn, so once you have come round to face it you can ignore it. '
      + 'Fades out in about a second.',
  },
  {
    name: 'Threats off screen',
    detail: 'A hollow red chevron, further out, for each soldier that has noticed you and '
      + 'is outside the view. It fades in as they leave the frame and follows them while '
      + 'you turn, so it always points where they actually are. It flares to a hotter red '
      + 'while that soldier is winding up to attack — that is the moment to move.',
  },
]
```

- [ ] **Step 4: Render it in the guide**

In `src/ui/guide/panel.ts`, four small edits:

1. Extend the `./reference` import to include `SCREEN_MARKS`.
2. Add to `GuideModel`, after `meters`:

```ts
  /** The two rings around the crosshair. Separate from `meters`: markers, not bars. */
  screenMarks: readonly MeterNote[]
```

3. Add to the object `guideModelFor` returns, after `meters: METERS,`:

```ts
    screenMarks: SCREEN_MARKS,
```

4. In the panel's markup, immediately after the existing `${notesHtml('The meters', model.meters)}`
   line:

```ts
        ${notesHtml('Around the crosshair', model.screenMarks)}
```

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test -- --run`
Expected: PASS. If a `guideModelFor` test asserts the model's exact shape it will need the new
field; update the assertion, do not delete it.

Run: `npm run typecheck`
Expected: clean, both passes.

- [ ] **Step 6: Write the handoff section**

Append a section to `docs/HANDOFF.md`, matching the structure of the sections already there — read
the last one before writing. Cover:

- What shipped: the ramp, the marker rules, the ring, the guide legend, and the formatter move.
- **The three findings from the spec**, each in a sentence or two: why edge-clamping is the wrong
  shape here (a behind-camera projection is mirrored garbage, and that is the majority case);
  that the combat model needed no new reporting; and that this overlay uses the camera's own
  heading while the hit wedges use `lookDirection`, deliberately, with the 17.78-degree measurement
  and the reason not to unify them.
- **The numbers that are guesses:** `OFF_SCREEN_RAMP` 0.25, the 84–104 px radius, and
  `WINDING_COLOUR`.
- **The 3D-versus-horizontal decision** and the hovering-spear case it exists for.
- **The register entry this cycle nearly added:** the spec's first draft asked for asymmetric
  fixtures "so an axis swap is visible" in `offScreenPresence`, which is a test that cannot fail —
  the overshoot is a `Math.max` of the two axes and `Math.max` is commutative, so swapping them is
  a provable no-op. The fixtures stayed, for the mutants they do catch; the claim was corrected.
- Anything a reviewer raised that was recorded rather than fixed.

- [ ] **Step 7: Commit**

```bash
git add src/ui/guide/reference.ts src/ui/guide/panel.ts src/ui/guide/reference.test.ts docs/HANDOFF.md
git commit -m "Tell the player which ring is which, and write down what this cycle decided"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: the ramp and its behind-camera and
non-finite rules to Task 1; the three marker rules, the 3D distance decision and `winding` to Task
2; the view, the geometry, the colours, the clip-path and the formatter de-duplication to Task 3;
the projection, the camera-forward basis, the drawn-versus-simulation mix and both hide sites to
Task 4; the guide legend and `docs/HANDOFF.md` to Task 5. The spec's out-of-scope list needs no
task by construction — no cap, no distance encoding, no occlusion test, no vertical information, no
lock-on, no per-arrow markers — and nothing in the plan introduces any of them.

**Type consistency.** `EnemyMarker { bearing, strength, winding }` is defined in Task 2 and consumed
by the same names in Tasks 3 and 4. `offScreenPresence`, `enemyMarker`, `createOffScreen`,
`OffScreenOrigin`, `percent`, `radians`, `alpha` and `SCREEN_MARKS` are each defined once and
referenced by the same name everywhere after. `enemyMarker`'s five parameters appear in the same
order in its definition, its tests and its one call site.

**One thing a reviewer should check rather than take on trust.** Task 4 is the only task whose
deliverable no test touches, and Step 7 of it exists to measure that rather than assert it.
