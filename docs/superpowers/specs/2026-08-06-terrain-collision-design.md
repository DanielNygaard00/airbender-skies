# Terrain Collision and a General Raycast

## The problem

`TerrainQuery` can only answer one question: what is directly below this point? Its two
methods, `groundHeightAt` and `raycastDown`, both cast straight down. Nothing in the game
can ask whether something is in the way sideways, and three separate systems are missing
behaviour as a direct result.

**The player passes through solid rock.** Measured against the real archipelago geometry: a
glider flying at 50 m/s straight at the `needle` island — radius 12, height 30 — enters at
x 210 and leaves at x 112, still in glider mode, having crossed clean through a rock centred
at x 150. A sideways ray from the same start point would have hit at 48.8 m, so the geometry
is solid; nothing was asked. On foot the failure is worse than cosmetic: inside a mesh, the
ground snap's downward ray meets back faces, a `FrontSide` material culls them, no hit is
returned, and the player falls through the island interior, past the world floor, into a
respawn.

**The camera arm does not shorten.** `pullInForTerrain` lifts the camera when terrain shares
its column, and [follow-cam.ts](../../../src/camera/follow-cam.ts) says outright why the
approximation exists: "The arm still does not shorten when it would pass through a terrain
wall, which is what the spec asks for. Doing that needs a general segment cast
(`TerrainQuery.raycast(from, direction, maxDistance)`), which does not exist yet."

**The air scooter's tier drop is unreachable.** `stepScooter` takes a `clipped` flag, and
`scooterTierDrop` is the design document's stated core of the accumulator — clip a wall and
lose a tier, rather than bleeding a trickle. `groundStep` hardcodes `clipped: false`, because
there is no way to know a wall was clipped.

One primitive unblocks all three. This spec covers the primitive and the first two consumers.
The scooter's tier drop follows in a later cycle, once something can report a clip.

## Scope

In scope: the `raycast` primitive, a collision module, wall deflection for the player in both
postures, and arm shortening for the camera.

Out of scope, deliberately:

- **Enemies and arrows.** Enemies move horizontally and are ground-snapped every step, so
  passing through a wall is not currently observable in play; arrows already stop at ground
  height. Adding lateral collision for them is a separate decision about whether cover
  exists as a combat mechanic.
- **The scooter's tier drop.** It needs a clip report threaded from movement into the scooter
  state, which is its own change with its own tuning.
- **Unsticking a player already inside geometry.** Deflection prevents entering. A player
  who begins a step inside a mesh stays stuck, because the outward ray meets culled back
  faces. Reachable only by spawning inside a rock, which no level does.

## The primitive

`TerrainQuery` gains one method and loses one:

```ts
export interface TerrainQuery {
  groundHeightAt(x: number, z: number): number | null
  raycast(from: Vector3, direction: Vector3, maxDistance: number): TerrainHit | null
}
```

`raycastDown` moves off the interface and becomes a free helper exported from
`world/terrain-query.ts`:

```ts
export function raycastDown(
  terrain: TerrainQuery, from: Vector3, maxDistance: number,
): TerrainHit | null
```

One capability with one implementation, rather than two methods where the second is a special
case of the first. The alternative — keeping `raycastDown` on the interface and adding
`raycast` beside it — was rejected because every future fake would owe two methods forever.
Making `raycast` optional was rejected outright: collision would silently do nothing wherever
a fake omitted it, which is the same class of silent narrowing that let `patrol.test.ts`
shrink its own scope a cycle ago.

`TerrainHit` is unchanged. Callers that need a distance derive it with
`from.distanceTo(hit.point)`, so no fixture that constructs a hit has to change.

Implementation requirements for `createTerrainQuery`:

- Reuse the existing shared `Raycaster`. This runs every frame in two systems now.
- Normalise the direction into a module-level scratch vector rather than allocating:
  three.js documents `Raycaster.direction` as required to be normalized. Measured against
  0.185.1: `Mesh.js`'s intersection check compares `maxDistance` against a real Euclidean
  distance from the ray origin, not a raw ray parameter, so direction length doesn't rescale
  it there. The bounding-sphere prefilter one level up is not scale-invariant — it walks
  along the direction vector by that vector's own length — but it errs permissive, so it has
  never been observed to reject a hit the distance check would have accepted. Normalise
  anyway: depending on either of those is depending on unmeasured internals, not a contract,
  and a future three.js upgrade is free to start requiring unit length again.
- Return `null` for a zero-length direction rather than casting with a degenerate ray.

## Collision

A new module, `src/world/collision.ts`. Pure functions over `Vector3` and a `TerrainQuery`;
no scene access, no mutation of arguments — the same contract `flight.ts` and `enemy.ts` keep.

```ts
export interface CollisionConfig {
  /** How far from a surface the body is held. */
  radius: number
  /**
   * Surfaces flatter than this are ground, not wall: their `normal.y` is at or above it.
   * Ground is owned by the ground snap on foot and by the landing probe in the glider.
   */
  wallNormalY: number
}

export interface CollisionResult {
  position: Vector3
  velocity: Vector3
  /** The surface deflected off, or null when nothing was in the way. */
  normal: Vector3 | null
}

export function isWall(normal: Vector3, c: CollisionConfig): boolean

export function resolveMovement(
  from: Vector3,
  to: Vector3,
  velocity: Vector3,
  terrain: TerrainQuery,
  c: CollisionConfig,
): CollisionResult
```

`resolveMovement` sweeps a ray from `from` toward `to` with length `|to - from| + radius`, so
a surface is detected before the body reaches it rather than after. On a hit that `isWall`
accepts:

- the position becomes `hit.point + normal × radius`
- the into-surface velocity component is removed: `velocity -= normal × (velocity · normal)`,
  applied only when `velocity · normal < 0`, so a surface being moved away from is left alone

Two passes. One pass leaves a player in an inside corner deflected off the first face and
driven through the second; the second pass catches it. A third adds nothing measurable and
costs a raycast every frame.

A hit that `isWall` rejects is ignored entirely, in both postures. This is the single rule
that keeps collision from fighting the two systems that already handle ground: `groundStep`'s
snap, which pulls a walker onto slopes and small drops, and the glider's 2.5 m landing probe.
Deliberately the same rule for both postures rather than one each — a glider that skimmed
along gentle ground instead of landing on it would be a second, competing answer to a
question `controllerStep` already answers.

Deflection can only ever remove speed. Given finding 1 of the movement analysis — the
Slipstream injecting free energy outside `flightStep`, worth ×1.81 total energy over 40
seconds — that property is worth asserting rather than assuming.

### Tuning

| Value | Setting | Reasoning |
|---|---|---|
| `radius` | 0.5 | Against the character's 1.8 height, which `projectile.hitRadius` already takes as its reference. Large enough that the camera does not see through the body into rock, small enough to fit the gate islands' 60 m gap without feeling wide. |
| `wallNormalY` | 0.5 | A surface past 60 degrees from horizontal. Below that, the ground snap can already climb it: it probes from `eyeProbeHeight` 2 above the feet and accepts anything within `snapDistance` 1.2 of the ray. |

Both are argued guesses. Neither has been played.

## Where it applies

| File | Change |
|---|---|
| `src/core/types.ts` | `raycast` replaces `raycastDown` on `TerrainQuery` |
| `src/world/terrain-query.ts` | implement `raycast`; export the `raycastDown` helper |
| `src/world/collision.ts` | new |
| `src/core/config.ts` | `DEFAULT_COLLISION_CONFIG` and its validator |
| `src/player/controller.ts` | the glider branch resolves collision, then probes for landing |
| `src/player/ground-move.ts` | resolve before the ground snap |
| `src/camera/follow-cam.ts` | `pullInForTerrain` shortens the arm |
| `src/world/props.ts` | one call site moves to the helper |
| `src/combat/enemy.ts` | a comment naming `raycastDown` as a method of the interface |

Ordering inside the glider branch matters and is not arbitrary. `flightStep` produces a
destination; collision resolves the path to it; only then does the landing probe run, against
the resolved position. Resolving after the landing check would let a player land on the far
side of a wall they should have hit.

On foot, collision resolves after the position is integrated from velocity and before the
ground snap, for the same reason in reverse: the snap adjusts only `y`, and only for a player
who was already grounded or is descending onto a surface, so it composes with a horizontal
deflection instead of competing with it.

### The camera

`pullInForTerrain` currently lifts the camera out of terrain that shares its column, and
cannot tell whether that terrain is between the camera and the player or merely overhead.
With a real cast it asks the question directly: cast from the player toward the desired camera
position, and if something is hit nearer than the arm's length, put the camera at the hit
point pulled back along the ray by `minDistance`.

This **replaces** the height lift rather than joining it. The lift was an approximation
standing in for exactly this cast, and keeping both would leave two opinions about where the
camera goes. Its existing tests move from asserting a lift to asserting a shortened arm; that
is an intended behaviour change, not a regression, and the spec records it as such so a
reviewer does not read it as one.

## Migrating the fakes

Sixteen fake `TerrainQuery` values across seven test files implement `raycastDown`. Nine of
them return `null` unconditionally and become `raycast: () => null`.

The rest model a ground plane. Every one of those migrates to the same shape:

```ts
raycast: (from, direction, maxDistance) =>
  direction.y < -0.9 ? /* the existing downward logic */ : null,
```

The direction guard is required, not cosmetic. A fake that ignored direction would answer a
horizontal collision sweep with a hit on the ground below, so a movement test in a flat fake
world would start deflecting off phantom walls. Returning `null` for anything but a downward
cast keeps those tests testing movement, which is what they are for.

## Testing

`src/world/collision.test.ts`, against fakes:

- no hit in range leaves position and velocity untouched, and reports `normal: null`
- a head-on wall holds the body `radius` off the surface, removes the into-surface velocity,
  and leaves the tangential component intact
- a glancing hit keeps most of the speed — the point of deflecting rather than stopping
- an inside corner resolves against both faces; asserted by checking the second face is not
  penetrated, which is what a single pass would fail
- a surface flatter than `wallNormalY` is ignored, position and velocity unchanged
- a zero-length step is a no-op
- speed never increases, for any hit geometry

`src/world/terrain-query.test.ts`: lateral casts hit; a zero-length or non-finite direction
returns `null`; `maxDistance` is honoured in world units on either side of a known hit
distance, with an unnormalised direction to prove that length doesn't skew it; the
`raycastDown` helper keeps every behaviour the method had.

Integration, against real archipelago geometry — the analysis measurements inverted into
permanent guards:

- a glider flown at the `needle` at 50 m/s does not come out the far side
- a walker driven into the `spire` flank does not pass through it
- a player who never touches a wall reaches the same place they do today, so the change is
  provably confined to walls

`src/camera/follow-cam.test.ts`: the arm shortens when a wall stands between camera and
player; the camera still trails at full `distance` in the open; `minDistance` is respected.

The full existing suite stays green, with the follow-cam lift tests as the single intended
exception. `patrol-placement.test.ts` matters most here: it runs the real fight over real
island geometry, so it will notice if collision perturbs soldier movement.
