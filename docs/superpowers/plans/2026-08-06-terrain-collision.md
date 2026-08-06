# Terrain Collision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `TerrainQuery` a general raycast, then use it to stop the player passing through solid rock in both postures and to shorten the camera arm through walls.

**Architecture:** One primitive replaces the downward-only one: `raycast(from, direction, maxDistance)` on the interface, with `raycastDown` demoted to a free helper. A new pure module, `src/world/collision.ts`, sweeps that ray along a step and deflects the position and velocity off any surface steep enough to count as a wall. Two consumers call it — the glider branch of `controllerStep` and `groundStep` — and the camera casts the same ray along its own arm.

**Tech Stack:** TypeScript 7.0.2, three.js 0.185.1, Vitest 4.1.10 (node environment), Vite 8.

## Global Constraints

- Run `npm run typecheck` after every code change: it is two passes, `tsconfig.json` then `tsconfig.test.json`, and the second is what catches broken test fixtures.
- `noUncheckedIndexedAccess` is on. Any array index yields `T | undefined`; use `!` only where the index is provably in range, and prefer `.find()` with an explicit throw in tests.
- All new modules are pure: they never mutate their arguments. Clone before writing to any `Vector3` a caller owns. `flight.ts` and `enemy.ts` are the pattern to follow.
- Config is always injected, never imported, by modules under `src/player/`, `src/camera/` and `src/world/`. None of them import `DEFAULT_*` from `src/core/config.ts`, and this plan must not be the first.
- Body radius is `0.5`; the wall threshold is `wallNormalY: 0.5`. Use these exact values.
- Two collision passes. The constant is `PASSES = 2`.
- Comments explain *why*, in full English sentences, matching the density of the file being edited. This codebase's comments record the reasoning and the defect that motivated the code; terse comments are a style mismatch here.
- **Red-proof every test.** After writing a test and before moving on, neutralise the behaviour it covers (comment out the line, invert the condition) and confirm the test actually fails. A test that passes against a neutralised feature is a broken test, and this project has shipped several. Restore the code afterwards.
- Never commit to `main`. Work stays on the current branch.
- Commit messages, code comments, and documentation are written in normal full English prose.

---

### Task 1: One cast, and every caller moved onto it

**Files:**
- Modify: `src/core/types.ts:84-87` (the `TerrainQuery` interface)
- Modify: `src/world/terrain-query.ts` (implement `raycast`, export the `raycastDown` helper)
- Modify: `src/player/controller.ts:240`, `src/player/ground-move.ts:111`, `src/world/props.ts:50` (call sites)
- Modify: `src/combat/enemy.ts:38` (a comment that names `raycastDown` as an interface method)
- Modify: `src/world/terrain-query.test.ts` (call sites plus new tests)
- Modify: `src/camera/follow-cam.test.ts:9,12`, `src/player/controller.test.ts:12,17`, `src/player/ground-move.test.ts:10,15,231`, `src/player/state.test.ts:23`, `src/world/props.test.ts:20,29`, `src/world/shrine.test.ts:10,14`, `src/world/waterfall.test.ts:19,23,96,112` (sixteen fakes)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `TerrainQuery.raycast(from: Vector3, direction: Vector3, maxDistance: number): TerrainHit | null`
  - `raycastDown(terrain: TerrainQuery, from: Vector3, maxDistance: number): TerrainHit | null`, exported from `src/world/terrain-query.ts`
  - `TerrainHit` is unchanged: `{ point: Vector3; normal: Vector3; islandId: string }`

This is a mechanical, wide task with a narrow behavioural core. The repo does not typecheck part-way through, which is why the interface change and the migration are one task rather than two.

- [ ] **Step 1: Write the failing tests for the new primitive**

Add to `src/world/terrain-query.test.ts`. Read the top of that file first for the existing island fixtures and follow them.

```ts
describe('raycast', () => {
  it('finds a surface sideways, not only below', () => {
    // The whole point of the method. A downward-only query cannot answer this, which is
    // why the player used to fly through solid rock.
    const query = createTerrainQuery([originIsland()])
    const hit = query.raycast(new Vector3(-200, 0, 0), new Vector3(1, 0, 0), 1000)
    expect(hit).not.toBeNull()
    expect(hit!.point.x).toBeLessThan(0)
  })

  it('honours maxDistance in world units on either side of the real hit', () => {
    // originIsland's surface along this ray sits ~153.45 world units out from `from`
    // (measured; noise-perturbed, not the nominal radius of 40). 200 comfortably clears
    // that; 100 comfortably falls short of it. The direction is left unnormalised (length
    // 10) to show that maxDistance stays in world units regardless of direction length.
    const query = createTerrainQuery([originIsland()])
    const from = new Vector3(-200, 0, 0)
    const direction = new Vector3(10, 0, 0)
    expect(query.raycast(from, direction, 200)).not.toBeNull()
    expect(query.raycast(from, direction, 100)).toBeNull()
  })

  it('returns null for a zero-length direction rather than casting a degenerate ray', () => {
    const query = createTerrainQuery([originIsland()])
    expect(query.raycast(new Vector3(0, 300, 0), new Vector3(), 1000)).toBeNull()
  })

  it('returns null for a non-finite direction', () => {
    const query = createTerrainQuery([originIsland()])
    expect(query.raycast(new Vector3(0, 300, 0), new Vector3(NaN, 0, 0), 1000)).toBeNull()
  })
})

describe('the raycastDown helper', () => {
  it('casts straight down through any TerrainQuery', () => {
    const query = createTerrainQuery([originIsland()])
    expect(raycastDown(query, new Vector3(0, 300, 0), 1000)!.islandId).toBe('origin')
  })

  it('honours maxDistance the way the old method did', () => {
    const query = createTerrainQuery([originIsland()])
    expect(raycastDown(query, new Vector3(0, 300, 0), 5)).toBeNull()
  })
})
```

`originIsland()` stands for whatever fixture the existing tests in that file already build for the island at the origin — reuse it rather than adding a second one. If the existing tests build it inline, extract it to a helper as part of this step and leave the existing tests reading from the helper.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/world/terrain-query.test.ts`
Expected: FAIL — `query.raycast is not a function`, and `raycastDown` is not exported.

- [ ] **Step 3: Change the interface**

In `src/core/types.ts`, replace the `TerrainQuery` interface:

```ts
/**
 * The single channel through which the game asks about terrain.
 *
 * One general cast rather than a downward special case. It was downward-only for a long
 * time, and three systems were missing behaviour because of it: the player passed through
 * solid rock in both postures, the camera arm could not shorten through a wall, and the
 * air scooter's tier drop was unreachable because nothing could report a clip.
 */
export interface TerrainQuery {
  groundHeightAt(x: number, z: number): number | null
  /**
   * The first surface along a ray, or null. `direction` need not be normalised;
   * `maxDistance` is always in world units.
   */
  raycast(from: Vector3, direction: Vector3, maxDistance: number): TerrainHit | null
}
```

- [ ] **Step 4: Implement it**

In `src/world/terrain-query.ts`, replace the `raycastDown` inner function and the returned object:

```ts
const DOWN = new Vector3(0, -1, 0)
/** Reused so the hot path allocates nothing to normalise a direction. */
const SCRATCH_DIRECTION = new Vector3()
```

```ts
  function raycast(from: Vector3, direction: Vector3, maxDistance: number): TerrainHit | null {
    const lengthSq = direction.lengthSq()
    // Written as the negated form so a NaN direction falls out here rather than being
    // normalised into a NaN ray that silently reports no hit from anywhere.
    if (!(lengthSq > 1e-12)) return null
    // three.js documents Raycaster.direction as required to be normalized. What's actually
    // measured, against this version (0.185.1): Mesh.js's checkIntersection compares `far`
    // against raycaster.ray.origin.distanceTo(hitPoint), a real Euclidean distance, so
    // direction length does not rescale `far` there. The bounding-sphere prefilter one level
    // up (Mesh.js's early-return before checkIntersection runs) is not scale-invariant --
    // it projects onto the direction vector and walks along it by that same vector's
    // length, so an unnormalised direction shifts where it looks -- but it errs permissive,
    // so it has never been observed to reject a hit `far` would have accepted. We normalise
    // rather than depend on either of those unmeasured-in-general internals surviving a
    // three.js upgrade.
    SCRATCH_DIRECTION.copy(direction).divideScalar(Math.sqrt(lengthSq))
    raycaster.set(from, SCRATCH_DIRECTION)
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
    raycast,
    groundHeightAt(x: number, z: number): number | null {
      const hit = raycast(new Vector3(x, probeHeight, z), DOWN, probeHeight * 2 + PROBE_MARGIN)
      return hit ? hit.point.y : null
    },
  }
```

`raycaster.set` copies the direction into its own ray, so reusing the scratch vector across calls is safe.

Then add the helper, at module level:

```ts
/**
 * A downward cast, which is what most callers want.
 *
 * A free function rather than a second interface method: `raycastDown` is a special case
 * of `raycast`, and putting both on the interface would make every fake owe two methods
 * where one would do.
 */
export function raycastDown(
  terrain: TerrainQuery, from: Vector3, maxDistance: number,
): TerrainHit | null {
  return terrain.raycast(from, DOWN, maxDistance)
}
```

The probe-height loop at the top of `createTerrainQuery` is unchanged.

- [ ] **Step 5: Move the three production call sites**

`src/player/controller.ts:240` — import `raycastDown` from `'../world/terrain-query'`:

```ts
    const hit = raycastDown(deps.terrain, next.position, LANDING_PROBE)
```

`src/player/ground-move.ts:111` — import `raycastDown` from `'../world/terrain-query'`:

```ts
      const hit = raycastDown(terrain, probe, c.eyeProbeHeight + c.snapDistance)
```

`src/world/props.ts:50` — import `raycastDown` from `'./terrain-query'`:

```ts
    const hit = raycastDown(terrain, new Vector3(x, probeY, z), def.height * 3 + 100)
```

Then fix the comment at `src/combat/enemy.ts:38`, which currently reads that `TerrainQuery` "also carries `raycastDown`". It carries `raycast`. Keep the point the sentence is making — that stepping an enemy has no use for it.

- [ ] **Step 6: Migrate the sixteen fakes**

Nine return null unconditionally. Each becomes `raycast: () => null`:

- `src/camera/follow-cam.test.ts:9` (`noGround`)
- `src/player/controller.test.ts:17` (`voidWorld`)
- `src/player/ground-move.test.ts:15` (`voidWorld`)
- `src/player/state.test.ts:23` (inside `terrain(groundY)`)
- `src/world/props.test.ts:29` (`voidTerrain`)
- `src/world/shrine.test.ts:14` (`empty`)
- `src/world/waterfall.test.ts:23` (`empty`), `:96` (inside `outerMissesInnerHits`), `:112` (`noGroundAnywhere`)

The other seven model a ground plane. Every one takes the same shape — a direction guard, then the logic it already had:

```ts
  // Only answers downward casts. A fake that ignored `direction` would answer a
  // horizontal collision sweep with a hit on the ground below, so a movement test in a
  // flat fake world would start deflecting off phantom walls.
  raycast: (from, direction, maxDistance) =>
    direction.y < -0.9 && from.y >= 0 && from.y - maxDistance <= 0
      ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
      : null,
```

That exact body fits `src/player/controller.test.ts:12` and `src/player/ground-move.test.ts:10`. The remaining five keep their own surface heights, normals and island ids, and gain only the `direction.y < -0.9 &&` guard:

- `src/camera/follow-cam.test.ts:12` — `groundAt(y)`, which ignores `maxDistance` and returns a hit at `(from.x, y, from.z)`
- `src/player/ground-move.test.ts:231` — the `step` fake, surface at `-0.5`
- `src/world/props.test.ts:20` — `flat(normalY)`, surface at `5`, configurable normal
- `src/world/shrine.test.ts:10` — surface at `10`, island id `'x'`
- `src/world/waterfall.test.ts:19` — `solid`, surface at `25`, island id `'home'`

For the fakes that ignore `maxDistance` today, keep ignoring it; only add the direction guard.

Finally, in `src/world/terrain-query.test.ts`, the eight existing `query.raycastDown(...)` call sites become `raycastDown(query, ...)`, and the file imports the helper.

- [ ] **Step 7: Typecheck and run the whole suite**

Run: `npm run typecheck && npm test`
Expected: both passes clean, every test green. This task changes no behaviour, so a red test here is a migration mistake, not a design question.

- [ ] **Step 8: Red-proof the new tests**

The zero-length and non-finite direction tests cannot be red-proofed by disabling the guard: a zero-length or non-finite direction normalises to NaN via `divideScalar`'s `1/0` or `1/NaN`, and three.js already fails every downstream triangle-intersection comparison against a NaN ray, so both tests still pass with the guard deleted. Leave the guard in place — it makes the contract explicit rather than depending on a NaN ray staying harmless — but don't spend time trying to make these two go red; they are contract tests, not proof the guard is load-bearing.

The `maxDistance` test is the one to red-proof, and it takes a different neutralisation: widen the `far` clamp, e.g. change `raycaster.far = maxDistance` to `raycaster.far = maxDistance * 10`, and confirm `honours maxDistance in world units on either side of the real hit` fails (the far-short-of-the-hit assertion starts finding a hit it shouldn't). Restore it. Dropping the `divideScalar` normalisation will *not* red-proof this test: this version of three.js (0.185.1) compares `far` against a real Euclidean distance in `Mesh.js`'s `checkIntersection`, not a raw ray parameter, so direction length doesn't affect the outcome either way — confirmed by measurement, not assumption, after the original version of this step claimed otherwise and turned out to be wrong.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Give TerrainQuery one general cast instead of a downward special case

TerrainQuery could only answer what was directly below a point. Three
systems were missing behaviour as a direct result: the player passed
through solid rock in both postures, the camera arm could not shorten
through a wall, and the air scooter's tier drop was unreachable because
nothing could report a clip.

raycast replaces raycastDown on the interface, and raycastDown becomes a
free helper over it. One capability with one implementation, rather than
two methods where the second is a special case of the first. Making the
new method optional was considered and rejected: collision would then
silently do nothing wherever a fake omitted it, which is the same class
of silent narrowing that let patrol.test.ts shrink its own scope.

The direction is normalised into a module-level scratch vector because
three.js documents it as required, even though this version tolerates an
unnormalised one for a Mesh target -- that's an undocumented tolerance
of 0.185.1, not a contract, and not worth depending on.

Every fake that models a ground plane now answers only downward casts.
Without that guard a fake would answer a horizontal sweep with a hit on
the ground below, and movement tests in flat fake worlds would deflect
off phantom walls.

No behaviour changes here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The collision module

**Files:**
- Create: `src/world/collision.ts`
- Create: `src/world/collision.test.ts`
- Modify: `src/core/config.ts` (add `DEFAULT_COLLISION_CONFIG` and a validator)

**Interfaces:**
- Consumes: `TerrainQuery.raycast` and the `TerrainHit` shape from Task 1.
- Produces:
  - `CollisionConfig { radius: number; wallNormalY: number }`
  - `CollisionResult { position: Vector3; velocity: Vector3; normal: Vector3 | null }`
  - `isWall(normal: Vector3, c: CollisionConfig): boolean`
  - `resolveMovement(from: Vector3, to: Vector3, velocity: Vector3, terrain: TerrainQuery, c: CollisionConfig): CollisionResult`
  - `DEFAULT_COLLISION_CONFIG: CollisionConfig` and `validateCollisionConfig(c: CollisionConfig): void`, both from `src/core/config.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/world/collision.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { isWall, resolveMovement, type CollisionConfig } from './collision'
import type { TerrainQuery } from '../core/types'

const C: CollisionConfig = { radius: 0.5, wallNormalY: 0.5 }

/** Nothing anywhere. */
const empty: TerrainQuery = { groundHeightAt: () => null, raycast: () => null }

/**
 * A vertical wall facing -X, at x = `at`. Any ray gets a hit on it, which is what makes
 * the geometry of a test readable: the caller controls the sweep, not the fake.
 */
const wallFacingMinusX = (at: number): TerrainQuery => ({
  groundHeightAt: () => null,
  raycast: (from, direction) => {
    if (direction.x <= 0) return null
    const travel = (at - from.x) / direction.x
    if (travel < 0) return null
    return {
      point: new Vector3(at, from.y + direction.y * travel, from.z + direction.z * travel),
      normal: new Vector3(-1, 0, 0),
      islandId: 'wall',
    }
  },
})

/** A gentle floor: steep enough to walk, so collision must leave it alone. */
const gentleFloor: TerrainQuery = {
  groundHeightAt: () => 0,
  raycast: (from) => ({
    point: new Vector3(from.x, 0, from.z),
    normal: new Vector3(0, 1, 0),
    islandId: 'floor',
  }),
}

describe('isWall', () => {
  it('calls a vertical surface a wall', () => {
    expect(isWall(new Vector3(-1, 0, 0), C)).toBe(true)
  })

  it('does not call level ground a wall', () => {
    // Ground belongs to the ground snap on foot and to the landing probe in the glider.
    // Two systems answering the same question is how they end up disagreeing.
    expect(isWall(new Vector3(0, 1, 0), C)).toBe(false)
  })

  it('puts the boundary at wallNormalY, not near it', () => {
    expect(isWall(new Vector3(0, 0.49, 0), C)).toBe(true)
    expect(isWall(new Vector3(0, 0.5, 0), C)).toBe(false)
  })
})

describe('resolveMovement with nothing in the way', () => {
  it('arrives at the destination it was given', () => {
    const to = new Vector3(10, 0, 0)
    const out = resolveMovement(new Vector3(), to, new Vector3(10, 0, 0), empty, C)
    expect(out.position.toArray()).toEqual(to.toArray())
    expect(out.velocity.toArray()).toEqual([10, 0, 0])
    expect(out.normal).toBeNull()
  })

  it('does not mutate the vectors it was handed', () => {
    const from = new Vector3()
    const to = new Vector3(10, 0, 0)
    const velocity = new Vector3(10, 0, 0)
    resolveMovement(from, to, velocity, wallFacingMinusX(5), C)
    expect(from.toArray()).toEqual([0, 0, 0])
    expect(to.toArray()).toEqual([10, 0, 0])
    expect(velocity.toArray()).toEqual([10, 0, 0])
  })

  it('treats a zero-length step as a no-op', () => {
    const at = new Vector3(3, 4, 5)
    const out = resolveMovement(at, at.clone(), new Vector3(), wallFacingMinusX(3), C)
    expect(out.position.toArray()).toEqual([3, 4, 5])
    expect(out.normal).toBeNull()
  })
})

describe('resolveMovement against a wall', () => {
  it('holds the body a radius clear of the surface', () => {
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 0), new Vector3(10, 0, 0), wallFacingMinusX(5), C,
    )
    expect(out.position.x).toBeCloseTo(4.5, 6)
  })

  it('removes the velocity going into the surface', () => {
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 0), new Vector3(10, 0, 0), wallFacingMinusX(5), C,
    )
    expect(out.velocity.x).toBeCloseTo(0, 6)
  })

  it('keeps the velocity running along the surface', () => {
    // The difference between deflecting and stopping, and the reason a fast approach to a
    // cliff skims along it rather than parking the player against it.
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 8), new Vector3(10, 0, 8), wallFacingMinusX(5), C,
    )
    expect(out.velocity.z).toBeCloseTo(8, 6)
  })

  it('reports the surface it deflected off', () => {
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 0), new Vector3(10, 0, 0), wallFacingMinusX(5), C,
    )
    expect(out.normal!.toArray()).toEqual([-1, 0, 0])
  })

  it('keeps sliding rather than stopping dead at the point of contact', () => {
    // A glancing blow spends most of its step along the wall. Stopping at contact would
    // make every brush with terrain a full stop, which is what the design document rules
    // out for landings and is no more welcome here.
    const out = resolveMovement(
      new Vector3(), new Vector3(6, 0, 6), new Vector3(6, 0, 6), wallFacingMinusX(5), C,
    )
    expect(out.position.z).toBeGreaterThan(0.5)
  })

  it('leaves alone a velocity that is already moving away from the surface', () => {
    // The `into < 0` guard. `to` and `velocity` are independent arguments, so a caller can
    // sweep toward a wall while the velocity points away from it — which is what a player
    // standing against a wall and pushing off looks like. Removing the component
    // unconditionally would cancel the push.
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 0), new Vector3(-10, 0, 0), wallFacingMinusX(5), C,
    )
    expect(out.velocity.x).toBeCloseTo(-10, 6)
  })

  it('never speeds anything up', () => {
    // Finding 1 of the movement analysis was a move that injected energy for free, worth
    // 1.81x total energy over forty seconds. A deflection must only ever remove speed.
    for (const target of [
      new Vector3(10, 0, 0), new Vector3(10, 0, 8), new Vector3(10, -4, 2), new Vector3(6, 6, 6),
    ]) {
      const out = resolveMovement(new Vector3(), target, target.clone(), wallFacingMinusX(5), C)
      expect(out.velocity.length()).toBeLessThanOrEqual(target.length() + 1e-9)
    }
  })
})

describe('resolveMovement leaves ground alone', () => {
  it('ignores a surface flat enough to walk on', () => {
    const to = new Vector3(0, -1, 0)
    const out = resolveMovement(new Vector3(0, 1, 0), to, new Vector3(0, -20, 0), gentleFloor, C)
    expect(out.position.toArray()).toEqual(to.toArray())
    expect(out.velocity.toArray()).toEqual([0, -20, 0])
    expect(out.normal).toBeNull()
  })
})

describe('resolveMovement in a corner', () => {
  it('does not drive through the second wall while deflecting off the first', () => {
    // One pass deflects off the near wall and sends the player along it, straight through
    // the far one. This is the case the second pass exists for.
    const corner: TerrainQuery = {
      groundHeightAt: () => null,
      raycast: (from, direction) => {
        // The +X wall at x = 5, and the +Z wall at z = 5.
        const hits: { travel: number; point: Vector3; normal: Vector3 }[] = []
        if (direction.x > 1e-9) {
          const travel = (5 - from.x) / direction.x
          if (travel >= 0) {
            hits.push({
              travel,
              point: new Vector3(5, from.y, from.z + direction.z * travel),
              normal: new Vector3(-1, 0, 0),
            })
          }
        }
        if (direction.z > 1e-9) {
          const travel = (5 - from.z) / direction.z
          if (travel >= 0) {
            hits.push({
              travel,
              point: new Vector3(from.x + direction.x * travel, from.y, 5),
              normal: new Vector3(0, 0, -1),
            })
          }
        }
        hits.sort((a, b) => a.travel - b.travel)
        const first = hits[0]
        return first ? { point: first.point, normal: first.normal, islandId: 'corner' } : null
      },
    }
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 10), new Vector3(10, 0, 10), corner, C,
    )
    expect(out.position.x).toBeLessThanOrEqual(4.5 + 1e-6)
    expect(out.position.z).toBeLessThanOrEqual(4.5 + 1e-6)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/world/collision.test.ts`
Expected: FAIL — cannot resolve `./collision`.

- [ ] **Step 3: Write the module**

Create `src/world/collision.ts`:

```ts
import { Vector3 } from 'three'
import type { TerrainQuery } from '../core/types'

/**
 * Stopping the player passing through solid rock.
 *
 * Before this existed, `TerrainQuery` could only cast downward, so nothing ever asked
 * whether something was in the way sideways. Measured against the real archipelago: a
 * glider flown at the `needle` island at 50 m/s entered at x 210 and left at x 112,
 * straight through a rock centred at x 150. On foot it was worse — inside a mesh the
 * ground snap's downward ray meets back faces, a FrontSide material culls them, and the
 * player falls through the island interior and past the world floor into a respawn.
 *
 * The response is a deflection rather than a stop. The design document is explicit that
 * landing at speed never hard-stops the character, and a wall is no more welcome to. The
 * velocity going into the surface is removed and the rest is kept, so a fast approach to
 * a cliff skims along it.
 */
export interface CollisionConfig {
  /** How far from a surface the body is held. */
  radius: number
  /**
   * Surfaces at or above this `normal.y` are ground, not wall, and are ignored here.
   *
   * This is the one rule that keeps collision from fighting the two systems that already
   * own ground: `groundStep`'s snap, which pulls a walker onto slopes and small drops, and
   * the glider's landing probe. Deliberately the same threshold in both postures — a
   * glider that skimmed along gentle ground instead of landing on it would be a second,
   * competing answer to a question `controllerStep` already answers.
   */
  wallNormalY: number
}

export interface CollisionResult {
  position: Vector3
  velocity: Vector3
  /** The surface deflected off, or null when nothing was in the way. */
  normal: Vector3 | null
}

/** Steeper than the threshold is a wall. Flatter is ground, and ground is not ours. */
export function isWall(normal: Vector3, c: CollisionConfig): boolean {
  return normal.y < c.wallNormalY
}

/**
 * Two passes. One pass deflects off the near face of an inside corner and sends the
 * player along it, straight through the far face; the second catches that. A third
 * changes nothing measurable and costs a raycast every frame.
 */
const PASSES = 2

/**
 * Resolve one step of movement against terrain. Pure: never mutates its arguments.
 *
 * The sweep runs `radius` past the destination, so a surface is found before the body
 * reaches it rather than after.
 */
export function resolveMovement(
  from: Vector3,
  to: Vector3,
  velocity: Vector3,
  terrain: TerrainQuery,
  c: CollisionConfig,
): CollisionResult {
  let origin = from.clone()
  let target = to.clone()
  const resolved = velocity.clone()
  let normal: Vector3 | null = null

  for (let pass = 0; pass < PASSES; pass++) {
    const delta = new Vector3().subVectors(target, origin)
    const travel = delta.length()
    if (!(travel > 1e-8)) break

    const hit = terrain.raycast(origin, delta, travel + c.radius)
    if (!hit || !isWall(hit.normal, c)) break

    normal = hit.normal.clone()
    const stopped = hit.point.clone().addScaledVector(hit.normal, c.radius)
    const into = resolved.dot(hit.normal)
    // Only when moving into the surface. A player already travelling away from a wall
    // they are standing against must not be pushed off it.
    if (into < 0) resolved.addScaledVector(hit.normal, -into)

    // The last pass has nothing after it to verify a slide, so it stops at the wall
    // instead of sliding to a destination that could itself be inside geometry.
    if (pass === PASSES - 1) {
      target = stopped
      break
    }

    const remaining = Math.max(0, travel - stopped.distanceTo(origin))
    origin = stopped
    target = resolved.lengthSq() > 1e-12
      ? stopped.clone().addScaledVector(resolved.clone().normalize(), remaining)
      : stopped.clone()
  }

  return { position: target, velocity: resolved, normal }
}
```

Note `terrain.raycast(origin, delta, ...)` passes the unnormalised delta on purpose: Task 1's implementation normalises internally and keeps `maxDistance` in world units, so normalising here would be a second, redundant square root every frame.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/world/collision.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Red-proof each behaviour**

Four separate neutralisations. Confirm the named test goes red for each, and restore between them.

1. Change `isWall` to `return true`. Expected red: "ignores a surface flat enough to walk on".
2. Change `PASSES` to `1`. Expected red: "does not drive through the second wall while deflecting off the first". **If this test still passes with one pass, the corner fixture is not exercising the case and the test is worthless — fix the fixture, not the assertion.**
3. Remove `if (into < 0)` so the component is always removed. Expected red: "leaves alone a velocity that is already moving away from the surface".
4. Replace the slide target with `stopped.clone()`. Expected red: "keeps sliding rather than stopping dead at the point of contact".

- [ ] **Step 6: Add the default config and its validator**

In `src/core/config.ts`, after the ground config block:

```ts
import type { CollisionConfig } from '../world/collision'

/**
 * Terrain collision.
 *
 * A body radius of 0.5 against the character's 1.8 height — the same reference
 * `projectile.hitRadius` takes. Wide enough that the camera does not see through the body
 * into rock, narrow enough to fit the gate islands' 60 m gap without feeling wide.
 *
 * `wallNormalY` of 0.5 is a surface past 60 degrees from horizontal. Below that the ground
 * snap can already climb it: it probes from `eyeProbeHeight` 2 above the feet and accepts
 * anything within `snapDistance` 1.2 of the ray.
 *
 * Both are argued guesses. Neither has been played.
 */
export const DEFAULT_COLLISION_CONFIG: CollisionConfig = {
  radius: 0.5,
  wallNormalY: 0.5,
}

export function validateCollisionConfig(c: CollisionConfig): void {
  if (!(c.radius > 0)) {
    throw new Error(`CollisionConfig.radius must be > 0, got ${c.radius}`)
  }
  if (!(c.wallNormalY > 0) || !(c.wallNormalY < 1)) {
    throw new Error(
      'CollisionConfig.wallNormalY must sit strictly between 0 and 1: at 0 nothing is a ' +
      'wall and at 1 level ground is one, and either way collision stops being about ' +
      `walls (got ${c.wallNormalY})`,
    )
  }
}
```

Then find where `validateFlightConfig` is called in `src/main.ts` and call `validateCollisionConfig(DEFAULT_COLLISION_CONFIG)` alongside it, so a bad value fails at startup rather than mid-flight.

- [ ] **Step 7: Test the validator**

Append to `src/world/collision.test.ts`. The import goes at the top of the file with the others, not beside the block below; a test file may import the shipped config even though modules under `src/world/` may not.

```ts
import { DEFAULT_COLLISION_CONFIG, validateCollisionConfig } from '../core/config'

describe('the shipped collision config', () => {
  it('passes its own validator', () => {
    expect(() => validateCollisionConfig(DEFAULT_COLLISION_CONFIG)).not.toThrow()
  })

  it('rejects a threshold that would make level ground a wall', () => {
    expect(() => validateCollisionConfig({ radius: 0.5, wallNormalY: 1 })).toThrow(/wallNormalY/)
  })

  it('rejects a radius of zero', () => {
    expect(() => validateCollisionConfig({ radius: 0, wallNormalY: 0.5 })).toThrow(/radius/)
  })
})
```

- [ ] **Step 8: Typecheck and run everything**

Run: `npm run typecheck && npm test`
Expected: clean, all green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Add a collision module that deflects movement off walls

Pure functions over a TerrainQuery, with no consumers yet: the glider and
the ground layer follow in their own commits, so a reviewer can judge the
resolution rule on its own.

The response is a deflection rather than a stop. The design document is
explicit that landing at speed never hard-stops the character, and a wall
is no more welcome to. The velocity going into the surface is removed and
the rest is kept, so a fast approach to a cliff skims along it.

Only surfaces steeper than wallNormalY deflect, and deliberately the same
threshold in both postures. Ground already has two owners -- the ground
snap on foot and the landing probe in the glider -- and a third opinion
about where the surface is would eventually disagree with them.

Two passes, because one deflects off the near face of an inside corner and
sends the player through the far face. The last pass stops at the wall
rather than sliding, since it has nothing after it to verify that the
slide destination is not itself inside geometry.

A deflection can only ever remove speed, and that is asserted rather than
assumed: the movement analysis found a move injecting energy for free,
worth 1.81x total energy over forty seconds.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The glider stops passing through rock

**Files:**
- Modify: `src/player/controller.ts` (`ControllerDeps` gains `collision`; the glider branch resolves before the landing probe)
- Modify: `src/player/controller.test.ts` (the `deps` helper, plus new tests)
- Create: `src/player/terrain-collision.test.ts` (real archipelago geometry)
- Modify: `src/main.ts` (pass `collision` into the deps object)

**Interfaces:**
- Consumes: `resolveMovement`, `CollisionConfig` from `src/world/collision.ts`; `DEFAULT_COLLISION_CONFIG` from `src/core/config.ts`.
- Produces: `ControllerDeps.collision: CollisionConfig`.

- [ ] **Step 1: Write the failing unit test**

In `src/player/controller.test.ts`, add a wall fake beside the existing `flatGround` and `voidWorld`:

```ts
/**
 * Flat ground at y=0 with a vertical wall facing -X at x = 20. The wall answers only
 * non-downward casts, so the landing probe still sees ground and the collision sweep
 * still sees the wall.
 */
const groundAndWall: TerrainQuery = {
  groundHeightAt: () => 0,
  raycast: (from, direction, maxDistance) => {
    if (direction.y < -0.9) {
      return from.y >= 0 && from.y - maxDistance <= 0
        ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
        : null
    }
    if (direction.x <= 1e-9) return null
    const travel = (20 - from.x) / direction.x
    if (travel < 0 || travel > maxDistance) return null
    return {
      point: new Vector3(20, from.y + direction.y * travel, from.z + direction.z * travel),
      normal: new Vector3(-1, 0, 0),
      islandId: 'wall',
    }
  },
}
```

Then the tests. Read the file's existing `player()`-style helper for building a `PlayerState` and follow it:

```ts
describe('the glider does not pass through terrain', () => {
  it('stops at a wall instead of crossing it', () => {
    let state = player({
      mode: 'glider', position: new Vector3(0, 100, 0),
      velocity: new Vector3(60, 0, 0), forward: new Vector3(1, 0, 0), grounded: false,
    })
    for (let frame = 0; frame < 120; frame++) {
      state = controllerStep(
        state, input({ lookDirection: new Vector3(1, 0, 0) }), 1 / 60, deps(groundAndWall),
      )
    }
    expect(state.position.x).toBeLessThan(20)
  })

  it('loses the speed going into the wall rather than keeping it', () => {
    let state = player({
      mode: 'glider', position: new Vector3(19, 100, 0),
      velocity: new Vector3(60, 0, 0), forward: new Vector3(1, 0, 0), grounded: false,
    })
    state = controllerStep(
      state, input({ lookDirection: new Vector3(1, 0, 0) }), 1 / 60, deps(groundAndWall),
    )
    expect(state.velocity.x).toBeLessThanOrEqual(0)
  })

  it('is untouched when nothing is in the way', () => {
    // The change has to be confined to walls, or every flight measurement in this suite
    // is now measuring something else.
    const start = player({
      mode: 'glider', position: new Vector3(0, 100, 0),
      velocity: new Vector3(0, 0, -30), forward: new Vector3(0, 0, -1), grounded: false,
    })
    let withWall = start
    let without = start
    for (let frame = 0; frame < 60; frame++) {
      const i = input({ lookDirection: new Vector3(0, 0, -1) })
      withWall = controllerStep(withWall, i, 1 / 60, deps(groundAndWall))
      without = controllerStep(without, i, 1 / 60, deps(flatGround))
    }
    expect(withWall.position.toArray()).toEqual(without.position.toArray())
  })
})
```

The `deps` helper at `src/player/controller.test.ts:19` gains `collision: DEFAULT_COLLISION_CONFIG`, imported from `'../core/config'`.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/player/controller.test.ts`
Expected: FAIL — `collision` is not a property of `ControllerDeps`, and the first two tests fail on the crossing.

- [ ] **Step 3: Wire the glider branch**

In `src/player/controller.ts`, add to `ControllerDeps`:

```ts
  /** How the body is held off terrain. Injected like every other config here. */
  collision: CollisionConfig
```

In the glider branch, `flightStep` currently produces `moved` and the result is written straight into `next`. Resolve between the two:

The `flightStep` call itself does not change. It currently reads:

```ts
    const moved = flightStep(state.position, state.velocity, {
      forward,
      thrust: thrusting,
      flare: input.forward < 0,
      bank: input.strafe * 0.6,
      hover: hovering, tuck: input.tuck,
    }, dt, deps.flight, wind)
```

Insert the resolution after it, and read `cleared` instead of `moved` when building `next`:

```ts
    // Between the integrator and the landing probe, and the order is not arbitrary.
    // flightStep produces a destination; this resolves the path to it; only then does the
    // landing probe run, against the resolved position. Resolving after the landing check
    // would let a player land on the far side of a wall they should have hit.
    const cleared = resolveMovement(
      state.position, moved.position, moved.velocity, deps.terrain, deps.collision,
    )

    const effort = thrusting ? 'thrust' : hovering ? 'hover' : 'idle'
    const breath = stepBreath(state, effort, false, dt, deps.flight)

    next = {
      ...state, forward,
      position: cleared.position, velocity: cleared.velocity,
      breath: breath.breath, grounded: false,
    }
```

The landing probe below is unchanged; it already reads `next.position`.

- [ ] **Step 4: Run and confirm the tests pass**

Run: `npx vitest run src/player/controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the game**

In `src/main.ts`, find where the `ControllerDeps` object is built and add `collision: DEFAULT_COLLISION_CONFIG`. Import it from `'./core/config'` alongside the other defaults already imported there.

- [ ] **Step 6: Write the real-geometry integration test**

Create `src/player/terrain-collision.test.ts`. This mirrors `src/combat/patrol-placement.test.ts` — read that file first for the island-building helper and the reason it lives in its own file.

```ts
import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG,
} from '../core/config'
import { spawnPointFor } from './state'
import { controllerStep, type ControllerDeps } from './controller'
import type { InputState, PlayerState } from '../core/types'

/**
 * The player against the real islands.
 *
 * This is the one property of collision that cannot be read off a fake: whether the
 * archipelago's actual geometry is solid to a sweep. It was not. Measured before this
 * cycle, a glider flown at the `needle` island at 50 m/s entered at x 210 and left at
 * x 112, straight through a rock centred at x 150 with a radius of 12, still in glider
 * mode. A sideways ray from the same start point hit at 48.8 m, so the geometry was
 * solid all along and nothing had asked.
 *
 * Building all thirteen islands' geometry costs a couple of hundred milliseconds, which
 * is why this lives in its own file rather than being folded into a faster suite.
 */
function archipelagoTerrain() {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  return createTerrainQuery(islands)
}

function deps(terrain: ReturnType<typeof archipelagoTerrain>): ControllerDeps {
  return {
    terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    spawnPointFor: spawnPointFor(ARCHIPELAGO, terrain),
    slipstream: DEFAULT_SLIPSTREAM_CONFIG,
    staff: DEFAULT_STAFF_CONFIG,
    collision: DEFAULT_COLLISION_CONFIG,
  }
}

function input(over: Partial<InputState> = {}): InputState {
  return {
    lookDirection: new Vector3(0, 0, -1),
    forward: 0, strafe: 0, sprint: false, tuck: false,
    actionPressed: false, actionHeld: false, actionReleased: false,
    scooterPressed: false, dashPressed: false, gustPressed: false,
    avatarStatePressed: false, vortexHeld: false, vortexReleased: false,
    slipstreamPressed: false, staffPressed: false,
    ...over,
  }
}

function island(id: string) {
  const found = ARCHIPELAGO.islands.find((i) => i.id === id)
  if (!found) throw new Error(`no island named ${id}`)
  return found
}

describe('a glider cannot fly through an island', () => {
  it('does not come out the far side of the needle', () => {
    const terrain = archipelagoTerrain()
    const needle = island('needle')
    let state: PlayerState = {
      mode: 'glider',
      // 60 out on +X at the needle's own centre height, flying straight at it.
      position: new Vector3(needle.position.x + 60, needle.position.y, needle.position.z),
      velocity: new Vector3(-50, 0, 0),
      forward: new Vector3(-1, 0, 0),
      breath: 100, maxBreath: 100,
      grounded: false, lastGroundIslandId: 'home',
      airJumpsUsed: 0, chargeTime: 0,
      scooterActive: false, scooterCharge: 0,
      dashesUsed: 0, dashRecovery: 0,
      slipstreamElapsed: null, slipstreamCooldown: 0,
      staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
    }
    for (let frame = 0; frame < 150; frame++) {
      state = controllerStep(
        state, input({ lookDirection: new Vector3(-1, 0, 0) }), 1 / 60, deps(terrain),
      )
    }
    // The far side is x < centre - radius. Before this cycle the player reached x 112,
    // which is 26 units past it.
    expect(state.position.x).toBeGreaterThan(needle.position.x - needle.radius)
  })
})
```

Match the `PlayerState` field list to what `src/core/types.ts` actually declares; if `staffElapsed` is `number | null` there, `null` is right, and if it is `number`, use `0`.

- [ ] **Step 7: Run the integration test**

Run: `npx vitest run src/player/terrain-collision.test.ts`
Expected: PASS.

- [ ] **Step 8: Red-proof it**

Comment out the `resolveMovement` call in the glider branch and return `moved` directly. Expected red: the needle test, and both wall tests in `controller.test.ts`. Restore.

- [ ] **Step 9: Typecheck and run everything**

Run: `npm run typecheck && npm test`
Expected: clean and green. Pay attention to `src/combat/patrol-placement.test.ts`, which runs the real fight over real geometry and is the suite most likely to notice an unintended perturbation.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Stop the glider flying through solid rock

Measured against the real archipelago before this change: a glider flown
at the needle island at 50 m/s entered at x 210 and left at x 112, clean
through a rock centred at x 150 with a radius of 12, still in glider
mode. A sideways ray from the same start point hit at 48.8 m, so the
geometry was solid all along and nothing had ever asked.

The resolution sits between the integrator and the landing probe, and
that order is load-bearing: flightStep produces a destination, collision
resolves the path to it, and only then does the landing probe run against
the resolved position. Resolving afterwards would let a player land on
the far side of a wall they should have hit.

The needle measurement is now a permanent guard, in its own file next to
patrol-placement.test.ts for the same reason -- it builds all thirteen
islands' geometry, which no faster suite should pay for.

A test also pins that a glide with no wall anywhere near it lands in
exactly the same place it did before, because a change to the flight path
in open air would invalidate every other flight measurement in the suite.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: On foot stops passing through rock

**Files:**
- Modify: `src/player/ground-move.ts` (`groundStep` gains a `collision` parameter; resolve before the snap)
- Modify: `src/player/controller.ts:187` (the one production call site)
- Modify: `src/player/ground-move.test.ts` (28 call sites gain the argument, plus new tests)
- Modify: `src/player/terrain-collision.test.ts` (append the walker test)

**Interfaces:**
- Consumes: `resolveMovement`, `CollisionConfig`; `ControllerDeps.collision` from Task 3.
- Produces: `groundStep(state, input, dt, terrain, c, collision)` — a sixth required parameter, `collision: CollisionConfig`.

A required parameter rather than one defaulting to `DEFAULT_COLLISION_CONFIG`, because no module under `src/player/` imports the shipped config: every config in this codebase is injected, and a default here would be the first exception.

- [ ] **Step 1: Write the failing tests**

In `src/player/ground-move.test.ts`, add a wall fake and the tests:

```ts
/**
 * Flat ground at y=0 with a vertical wall facing -X at x = 5. Downward casts see the
 * ground, everything else sees the wall.
 */
const groundAndWall: TerrainQuery = {
  groundHeightAt: () => 0,
  raycast: (from, direction, maxDistance) => {
    if (direction.y < -0.9) {
      return from.y >= 0 && from.y - maxDistance <= 0
        ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
        : null
    }
    if (direction.x <= 1e-9) return null
    const travel = (5 - from.x) / direction.x
    if (travel < 0 || travel > maxDistance) return null
    return {
      point: new Vector3(5, from.y + direction.y * travel, from.z + direction.z * travel),
      normal: new Vector3(-1, 0, 0),
      islandId: 'wall',
    }
  },
}

describe('walking into a wall', () => {
  it('does not pass through it', () => {
    let s = player()
    for (let frame = 0; frame < 300; frame++) {
      s = groundStep(
        s, input({ forward: 1, lookDirection: new Vector3(1, 0, 0), sprint: true }),
        1 / 60, groundAndWall, G, COLLISION,
      )
    }
    expect(s.position.x).toBeLessThan(5)
  })

  it('still slides along it rather than sticking', () => {
    // Running into a corner-ward wall at 45 degrees should carry on down the wall.
    let s = player()
    for (let frame = 0; frame < 120; frame++) {
      s = groundStep(
        s, input({ forward: 1, lookDirection: new Vector3(1, 0, 1).normalize(), sprint: true }),
        1 / 60, groundAndWall, G, COLLISION,
      )
    }
    expect(s.position.x).toBeLessThan(5)
    expect(s.position.z).toBeGreaterThan(5)
  })

  it('stays grounded while sliding along it', () => {
    // The deflection must not fight the ground snap. It adjusts only y, and only for a
    // player already grounded or descending onto a surface, so the two compose -- but
    // that is an argument, and this is the test of it.
    let s = player()
    for (let frame = 0; frame < 120; frame++) {
      s = groundStep(
        s, input({ forward: 1, lookDirection: new Vector3(1, 0, 0), sprint: true }),
        1 / 60, groundAndWall, G, COLLISION,
      )
    }
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 6)
  })

  it('leaves a walker with no wall near them exactly where they were', () => {
    let withWall = player()
    let without = player()
    for (let frame = 0; frame < 60; frame++) {
      const i = input({ forward: 1, lookDirection: new Vector3(-1, 0, 0), sprint: true })
      withWall = groundStep(withWall, i, 1 / 60, groundAndWall, G, COLLISION)
      without = groundStep(without, i, 1 / 60, flatGround, G, COLLISION)
    }
    expect(withWall.position.toArray()).toEqual(without.position.toArray())
  })
})
```

Add near the top of the file, beside `const G = DEFAULT_GROUND_CONFIG`:

```ts
import { DEFAULT_COLLISION_CONFIG as COLLISION } from '../core/config'
```

If the existing import of `DEFAULT_GROUND_CONFIG as G` is already there, extend it rather than adding a second import statement from the same module.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/player/ground-move.test.ts`
Expected: FAIL — `groundStep` takes five parameters.

- [ ] **Step 3: Add the parameter and resolve before the snap**

In `src/player/ground-move.ts`, extend the signature and resolve immediately after the position is integrated:

```ts
export function groundStep(
  state: PlayerState,
  input: InputState,
  dt: number,
  terrain: TerrainQuery,
  c: GroundConfig,
  collision: CollisionConfig,
): PlayerState {
```

Replace the two lines that integrate position with:

```ts
  const velocity = new Vector3(horizontal.x, velocityY, horizontal.z)
  const target = state.position.clone().addScaledVector(velocity, dt)
  // Before the ground snap, not after. The snap adjusts only y, and only for a player who
  // was already grounded or is descending onto a surface, so a horizontal deflection
  // composes with it instead of competing. Resolving after the snap would leave a walker
  // deflected off a wall without being re-seated on the ground under them.
  const cleared = resolveMovement(state.position, target, velocity, terrain, collision)
  const position = cleared.position
  velocity.copy(cleared.velocity)
```

The snap block below reads `position` and `velocity` and is unchanged. Note that `velocity` must stay the same object the snap mutates, which is why this copies into it rather than rebinding.

- [ ] **Step 4: Update every call site**

`src/player/controller.ts:187`:

```ts
      next = groundStep(state, input, dt, deps.terrain, deps.ground, deps.collision)
```

Then the 28 call sites in `src/player/ground-move.test.ts`. They are mechanical and fall into a few patterns; `sed` is the safe way to avoid missing one:

```bash
cd /Users/danielnygaard/Developer/airbender-skies
sed -i '' \
  -e 's/, flatGround, G)/, flatGround, G, COLLISION)/g' \
  -e 's/, voidWorld, G)/, voidWorld, G, COLLISION)/g' \
  -e 's/, step, G)/, step, G, COLLISION)/g' \
  src/player/ground-move.test.ts
grep -n 'groundStep(' src/player/ground-move.test.ts | grep -v COLLISION
```

That last `grep` must print nothing. If it prints a line, there is a call-site pattern the `sed` missed — fix it by hand and re-run the grep. Do not assume the three patterns above are exhaustive; the grep is the check.

- [ ] **Step 5: Run and confirm the tests pass**

Run: `npx vitest run src/player/ground-move.test.ts`
Expected: PASS, including every pre-existing test. A pre-existing test failing here means the deflection is reaching ground it should be ignoring — check `isWall` is being consulted, not bypassed.

- [ ] **Step 6: Append the walker to the integration test**

In `src/player/terrain-collision.test.ts`:

```ts
describe('a walker cannot walk through an island', () => {
  it('does not cross the spire flank', () => {
    const terrain = archipelagoTerrain()
    const spire = island('spire')
    // On the spire's own ground, 20 out from its centre, walking inward. Its radius is 26
    // and its height 44, so the flank at this range is far steeper than wallNormalY.
    const startX = spire.position.x + 20
    const ground = terrain.groundHeightAt(startX, spire.position.z)
    expect(ground, 'the walk should start on real ground').not.toBe(null)

    let state: PlayerState = {
      mode: 'ground',
      position: new Vector3(startX, ground!, spire.position.z),
      velocity: new Vector3(),
      forward: new Vector3(-1, 0, 0),
      breath: 100, maxBreath: 100,
      grounded: true, lastGroundIslandId: 'spire',
      airJumpsUsed: 0, chargeTime: 0,
      scooterActive: false, scooterCharge: 0,
      dashesUsed: 0, dashRecovery: 0,
      slipstreamElapsed: null, slipstreamCooldown: 0,
      staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
    }
    for (let frame = 0; frame < 300; frame++) {
      state = controllerStep(
        state,
        input({ forward: 1, sprint: true, lookDirection: new Vector3(-1, 0, 0) }),
        1 / 60,
        deps(terrain),
      )
    }
    // Not through to the far side, and not fallen out of the world either.
    expect(state.position.x).toBeGreaterThan(spire.position.x - spire.radius)
    expect(state.position.y).toBeGreaterThan(ARCHIPELAGO.worldFloorY)
  })
})
```

If the spire's crown turns out to be walkable all the way across at this range — the geometry is noisy, and a walk inward across a dome is a legitimate thing to be able to do — then this test is measuring nothing. In that case pick the approach that actually meets a steep face: walk *outward* from the centre and assert the walker does not leave the island's radius, or start below the crown on the flank. Say which you chose and why in the report.

- [ ] **Step 7: Red-proof**

Comment out the `resolveMovement` call in `groundStep` and use `target` directly. Expected red: all four wall tests in `ground-move.test.ts` and the spire test. Restore.

- [ ] **Step 8: Typecheck and run everything**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Stop a walker walking through solid rock

The failure on foot was worse than the glider's. Inside a mesh, the
ground snap's downward ray meets back faces, a FrontSide material culls
them, no hit comes back, and the player falls through the island interior
and past the world floor into a respawn. Walking into a hillside was a
death.

The resolution runs before the ground snap. The snap adjusts only y, and
only for a player who was already grounded or is descending onto a
surface, so a horizontal deflection composes with it rather than
competing -- and a test pins that a walker sliding along a wall stays
grounded, because that composition is an argument and arguments need
tests.

groundStep takes the collision config as a sixth required parameter
rather than defaulting it. No module under src/player/ imports the
shipped config; every config here is injected, and a default would have
been the first exception.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The camera arm shortens

**Files:**
- Modify: `src/camera/follow-cam.ts` (`pullInForTerrain`)
- Modify: `src/camera/follow-cam.test.ts` (replace the lift tests with shortening tests)

**Interfaces:**
- Consumes: `TerrainQuery.raycast` from Task 1.
- Produces: `pullInForTerrain(target, desired, terrain, minDistance = 2): Vector3` — the same signature, new behaviour.

This task **replaces** the height-lift approximation rather than adding to it. [follow-cam.ts:52-55](../../../src/camera/follow-cam.ts) says the lift exists only because this cast did not, and keeping both would leave two opinions about where the camera goes. The existing lift tests are rewritten. That is an intended behaviour change and the commit message says so, so a later reader does not mistake it for a regression.

Note that `pullInForTerrain` does **not** consult `isWall`. The camera should be pushed out of any geometry — a ceiling and the ground included — which is the opposite of the movement rule, where ground has other owners.

- [ ] **Step 1: Write the failing tests**

In `src/camera/follow-cam.test.ts`, replace the `groundAt` fake and every test that asserts a lift. The fakes become:

```ts
const noGround: TerrainQuery = { groundHeightAt: () => null, raycast: () => null }

/**
 * A surface `distance` along whatever ray it is given, facing back down it. Written
 * against the ray rather than as world geometry, because what this function cares about
 * is only how far away the first surface along the arm is.
 */
const surfaceAt = (distance: number): TerrainQuery => ({
  groundHeightAt: () => 0,
  raycast: (from, direction, maxDistance) => {
    if (distance > maxDistance) return null
    const unit = direction.clone().normalize()
    return {
      point: from.clone().addScaledVector(unit, distance),
      normal: unit.clone().negate(),
      islandId: 'surface',
    }
  },
})
```

And the tests:

```ts
describe('pullInForTerrain', () => {
  const target = new Vector3(0, 20, 0)

  it('leaves the camera where it wants to be when nothing is in the way', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, noGround).toArray()).toEqual(desired.toArray())
  })

  it('shortens the arm to the surface between camera and player', () => {
    // The behaviour the old height-lift stood in for. A wall 4 m along a 10 m arm should
    // put the camera at 4 m, not lift it over the wall and leave the player behind it.
    const desired = new Vector3(0, 20, 10)
    const out = pullInForTerrain(target, desired, surfaceAt(4))
    expect(target.distanceTo(out)).toBeLessThan(4.01)
    expect(target.distanceTo(out)).toBeGreaterThan(2)
  })

  it('keeps the arm pointing where it was, only nearer', () => {
    const desired = new Vector3(0, 20, 10)
    const out = pullInForTerrain(target, desired, surfaceAt(4))
    expect(out.x).toBeCloseTo(0, 6)
    expect(out.y).toBeCloseTo(20, 6)
    expect(out.z).toBeGreaterThan(0)
  })

  it('never comes closer than minDistance, even against a surface nearer than that', () => {
    // Deliberate: a camera jammed into the character's head is worse than a camera
    // briefly clipping a wall.
    const out = pullInForTerrain(target, new Vector3(0, 20, 10), surfaceAt(0.5))
    expect(target.distanceTo(out)).toBeGreaterThanOrEqual(2)
  })

  it('ignores a surface further away than the arm is long', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, surfaceAt(40)).toArray()).toEqual(desired.toArray())
  })

  it('handles a desired position sitting on the player', () => {
    const out = pullInForTerrain(target, target.clone(), surfaceAt(1))
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
  })

  it('never returns a non-finite position', () => {
    const out = pullInForTerrain(target, new Vector3(0, 19, 0), surfaceAt(1))
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
  })

  it('does not return a reference-identical copy on early return', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, noGround)).not.toBe(desired)
  })

  it('does not mutate the target vector', () => {
    const t = new Vector3(0, 20, 0)
    const orig = t.toArray()
    pullInForTerrain(t, new Vector3(0, 20, 10), surfaceAt(4))
    expect(t.toArray()).toEqual(orig)
  })

  it('does not mutate the desired vector', () => {
    const d = new Vector3(0, 20, 10)
    const orig = d.toArray()
    pullInForTerrain(target, d, surfaceAt(4))
    expect(d.toArray()).toEqual(orig)
  })
})
```

Delete these now-obsolete tests, which asserted the mechanism rather than the goal: "lifts the camera above terrain it would clip into", "handles the zero-length case when lifted camera lands on player", "leaves the camera alone when the player is below the terrain in that column", and "still lifts when the player is above the terrain and the camera is not". The last of those is worth reading before deleting: it exists because `groundHeightAt` cannot tell a wall from a roof, which is exactly the ambiguity a segment cast removes.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/camera/follow-cam.test.ts`
Expected: FAIL — the shortening tests fail, because the current implementation lifts instead.

- [ ] **Step 3: Rewrite the function**

In `src/camera/follow-cam.ts`, replace `pullInForTerrain` entirely:

```ts
/**
 * Pull the camera in when terrain stands between it and the player.
 *
 * This used to lift the camera out of any column that contained terrain, because
 * `groundHeightAt` reports the highest surface in a column and cannot say whether that
 * surface is between the camera and the player or merely overhead. That ambiguity is gone:
 * `TerrainQuery.raycast` answers the question directly, so the arm shortens to the first
 * surface along it.
 *
 * No wall test here, unlike movement. The camera should be pushed out of any geometry, a
 * ceiling and the ground included — where movement leaves ground to the ground snap and
 * the landing probe, the camera has no other owner.
 *
 * `minDistance` wins over the surface when the surface is nearer than it. Deliberate: a
 * camera jammed into the character's head is worse than a camera briefly clipping a wall.
 */
export function pullInForTerrain(
  target: Vector3, desired: Vector3, terrain: TerrainQuery, minDistance = 2,
): Vector3 {
  const arm = new Vector3().subVectors(desired, target)
  const length = arm.length()
  // The camera is already on the player. There is no arm to shorten and no direction to
  // shorten it along.
  if (!(length > 1e-6)) return desired.clone()

  const hit = terrain.raycast(target, arm, length)
  if (!hit) return desired.clone()

  const kept = Math.max(minDistance, target.distanceTo(hit.point))
  return target.clone().addScaledVector(arm.divideScalar(length), kept)
}
```

`arm` is a local built by `subVectors`, so dividing it in place normalises without touching either argument.

- [ ] **Step 4: Run and confirm the tests pass**

Run: `npx vitest run src/camera/follow-cam.test.ts`
Expected: PASS.

- [ ] **Step 5: Red-proof**

Change `const kept = Math.max(minDistance, ...)` to `const kept = length` and confirm the shortening test fails. Restore. Then change the `raycast` call's `length` argument to `Infinity` and confirm "ignores a surface further away than the arm is long" fails. Restore.

- [ ] **Step 6: Check whether groundHeightAt is still used here**

`pullInForTerrain` no longer calls `groundHeightAt`. Check whether `src/camera/follow-cam.ts` uses it anywhere else; if not, the import list may need trimming. Do not remove `groundHeightAt` from the `TerrainQuery` interface — `props.ts`, `shrine.ts`, `waterfall.ts` and `state.ts` all rely on it.

- [ ] **Step 7: Typecheck and run everything**

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Shorten the camera arm through a wall instead of lifting over it

follow-cam.ts has said for several cycles that the height lift was an
approximation standing in for a segment cast that did not exist: "The arm
still does not shorten when it would pass through a terrain wall, which
is what the spec asks for." It exists now, so the arm shortens.

This replaces the lift rather than joining it. Keeping both would leave
two opinions about where the camera goes, and the lift only ever existed
because groundHeightAt cannot tell a wall from a roof -- it reports the
highest surface in a column and nothing about whether that surface is
between the camera and the player. A segment cast removes the ambiguity
the lift was working around.

Four tests that asserted the lift are gone, replaced by tests of the goal
rather than the mechanism. That is an intended behaviour change, recorded
here so a later reader does not read the deletions as a regression.

Deliberately no wall test in this path. Movement leaves ground to the
ground snap and the landing probe, so it ignores anything flat; the
camera has no other owner and should be pushed out of any geometry,
ceilings and ground included.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Verify it in the running game

**Files:** none. This task produces a report, not a diff — unless it finds something, in which case fix it and say so.

**Interfaces:**
- Consumes: everything above.
- Produces: a written verification report at the path the dispatch gives you.

Unit tests prove the deflection resolves. They cannot prove the game is playable with it, and three of this project's past cycles found a real defect at exactly this step.

- [ ] **Step 1: Start the dev server and open the game**

Use the preview tooling, not a bare `npm run dev`. `.claude/launch.json` should already have an entry; read it and use `preview_start` with its name. Take a screenshot to confirm the game rendered.

- [ ] **Step 2: Walk into a hillside**

Click to lock the pointer, then walk toward rising ground on the home island. Confirm the walker stops or slides rather than passing through, and that they do not fall through the island. Watch the console for errors throughout.

Report what you observe, including if it is "nothing obvious happened, the crown is walkable everywhere I tried".

- [ ] **Step 3: Fly into an island**

Jump, deploy the glider with the action key mid-fall, and fly into the side of an island. The `spire` at (60, 420, 60) and the `needle` at (150, 240, -160) are the steep ones; a lower and easier target is `perch-east` at (170, -20, 20). Confirm the glider does not cross through.

- [ ] **Step 4: Check the camera against a wall**

Stand with a rock face behind the character and confirm the camera pulls in rather than letting the view enter the rock or lifting over it. Take a screenshot.

- [ ] **Step 5: Check nothing ordinary broke**

Run a normal loop for a minute: walk, jump, charge-jump, deploy, glide, thrust, land, scooter, dash, gust an enemy. Confirm the frame rate holds — collision adds up to two raycasts per simulation step, and if it is expensive this is where it shows. Read `read_console_messages` for errors and warnings.

- [ ] **Step 6: Write the report**

Cover, for each step: what you did, what you saw, and whether you consider it verified or unestablished. Be explicit about anything you could not check. A verification report that claims more than was observed is worse than one that admits a gap — a previous cycle in this project reported a hidden patrol from a screenshot in which the soldiers were a few pixels wide.

---

### Task 7: Documentation

**Files:**
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: the outcome of every task above, including Task 6's report.
- Produces: nothing code depends on.

- [ ] **Step 1: Read the handoff**

Read `docs/HANDOFF.md` in full, and match its structure, tone and level of detail. It is written for whoever picks this project up next and it records reasoning and measurements, not a changelog.

- [ ] **Step 2: Write the section**

Cover:

- `TerrainQuery` now has one general cast; `raycastDown` is a free helper. Say why: an optional method would let collision silently no-op wherever a fake omitted it.
- What collision does and does not do: deflects off surfaces steeper than `wallNormalY`, ignores ground because the ground snap and landing probe own it, two passes for corners, the last pass stops rather than sliding.
- The measurements, before and after: the needle crossing at x 210 → 112, and the sideways ray hitting at 48.8 m.
- The camera change, and that four lift tests were deliberately replaced.
- What is still not handled: enemies and arrows have no lateral collision; a player who starts inside geometry stays stuck, because an outward ray meets culled back faces; the scooter's `clipped` flag is still hardcoded `false`, and now that a wall can be detected, wiring the tier drop is a genuinely available next step.
- Whatever Task 6 established or failed to establish, in its own words.

- [ ] **Step 3: Commit**

```bash
git add docs/HANDOFF.md
git commit -F - <<'EOF'
Record the terrain collision cycle in the handoff

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Self-Review

**Spec coverage.** The primitive is Task 1, including the `raycastDown` demotion, the normalisation requirement, the zero-direction guard and the shared `Raycaster`. The collision module, its two config values and their reasoning are Task 2. The glider consumer is Task 3, on-foot is Task 4, the camera is Task 5, with the intended-behaviour-change note carried in both the plan and its commit message. Fake migration is Step 6 of Task 1, with the direction guard the spec requires. Every test the spec's Testing section lists has a home: collision unit tests in Task 2, `terrain-query` tests in Task 1, both real-geometry integration tests in Tasks 3 and 4, camera tests in Task 5. The spec's three out-of-scope items are restated in Task 7's documentation so they are recorded rather than forgotten.

**Placeholders.** None. Every code step carries the code. Task 4 step 6 and Task 6 step 2 each describe a case where the implementer may find the situation different from what the plan assumes, and both say what to do and to report which way it went — that is a genuine unknown about noisy island geometry, not a deferred decision.

**Type consistency.** `CollisionConfig`, `CollisionResult`, `isWall` and `resolveMovement` keep the same signatures from Task 2 through Tasks 3, 4 and 5. `ControllerDeps.collision` is introduced in Task 3 and consumed in Task 4 via `deps.collision`. `groundStep`'s sixth parameter is named `collision` in the signature and passed as `COLLISION` in the tests and `deps.collision` in production, which is consistent. `raycast(from, direction, maxDistance)` has the same parameter order in the interface, the implementation and all sixteen fakes. `TerrainHit` is never changed, so no fixture that builds one needs touching beyond the method rename.

One risk this review will not resolve: Task 4's spire walk may find walkable ground rather than a steep face, and Task 6 may find the frame cost of two raycasts per step matters. Both are flagged in place with instructions to report rather than to guess.
