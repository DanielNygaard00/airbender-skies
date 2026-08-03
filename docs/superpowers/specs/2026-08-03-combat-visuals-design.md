# Combat Visuals

**Date:** 2026-08-03
**Status:** Approved

## Overview

The game's attacks are largely invisible. Gust — the primary combat move, a twelve-unit
cone that shoves enemies 26 m/s and interrupts a strike — draws nothing at all; you infer
it only from bodies flying backwards. The air blast dash draws nothing. A gust connecting
draws nothing, and an enemy going down is readable only from the body lying flat. The
Avatar State has a screen vignette but nothing on the character.

Pressure Wave is the exception: it has a ring, and that ring is the pattern the rest of
this work follows.

Four decisions shape the design:

1. **The gust shows its true hit volume.** Twelve units of radius and a 120° span is a
   large wedge, and the honest visual is a large one. A tighter stylised puff would look
   better in isolation and teach the wrong spacing — a hit landing outside the visible
   puff reads as a bug. This is the standard the action guide set: do not lie about the
   rules.
2. **`main.ts`'s hand-rolled cull loop becomes a shared pool.** One bespoke
   reverse-iterating loop already exists for shockwaves; five of them is how a leak
   ships. The pool also makes the lifecycle logic unit-testable, which the inline loop
   is not.
3. **Effects are fire-and-forget except the aura.** Three of the four self-terminate and
   belong in the pool. The Avatar State aura lasts as long as the state does, so it takes
   the shape the glider already uses instead.
4. **Every trigger comes from data that already exists.** No movement or combat code
   changes; this is a read-only layer over signals the game already produces.

## 1. The effect contract (`src/fx/effect.ts`)

`shockwave.ts` already has exactly the right interface; it is simply unnamed. Extract it:

```ts
export interface Effect {
  object: Object3D
  /** Advance. Returns false once finished, so the caller can remove and dispose it. */
  advance(dt: number): boolean
  /** Release geometry and material. One effect is created per event, so this matters. */
  dispose(): void
}
```

`src/fx/shockwave.ts` keeps its `Shockwave` export as an alias of `Effect` so existing
imports keep working, and `createShockwave` is re-typed to return `Effect`. No behaviour
changes there.

## 2. The pool (`src/fx/effect-pool.ts`)

```ts
export interface EffectPool {
  /** Add and parent to the scene. Evicts the oldest if the cap is reached. */
  add(effect: Effect): void
  /** Advance every live effect, removing and disposing the finished ones. */
  advance(dt: number): void
  /** Live count. For the cap, and for tests. */
  size(): number
  /** Remove and dispose everything. */
  dispose(): void
}

export function createEffectPool(scene: Object3D, maxLive?: number): EffectPool
```

`maxLive` defaults to 24. On overflow `add` evicts the **oldest** effect, not the newest —
the oldest is the most faded, so dropping it is the least visible choice, and dropping the
newest would make a burst of hits show nothing at all.

`advance` iterates backwards so the splice cannot skip an entry, and calls
`scene.remove(effect.object)` then `effect.dispose()` for each finished effect.

**Why this is the valuable part.** It takes any `Object3D` as its scene and any `Effect`,
so tests can pass a bare `Group` and fake effects and assert what the inline loop never
could: that a finished effect leaves the scene, that `dispose` is called exactly once and
never twice, that the cap holds, and that nothing survives `dispose`.

## 3. The gust cone (`src/fx/gust-cone.ts`)

```ts
export function createGustCone(
  origin: Vector3,
  forward: Vector3,
  c: GustConfig,
): Effect
```

Two coplanar meshes, both horizontal, both centred on `origin` and raised 1.0 world unit
above it — the player's origin is at their feet, and a sector drawn at ground level would
be hidden by the terrain it sits on:

- A **filled sector** at the true `c.range` radius spanning `2 * c.halfAngle`, at low
  opacity. This is the honest statement of what the move covers.
- A brighter **leading arc** — a thin annulus of the same angular span — whose radius
  travels from near zero to `c.range` over the lifetime. This is what makes it read as a
  pulse of air moving out through the volume rather than a wedge blinking on.

Both are built from `RingGeometry`, whose `thetaStart` and `thetaLength` parameters give
the sector directly: `thetaLength = 2 * c.halfAngle`, with `thetaStart` placing the span so
it centres on the heading. The group is rotated flat and yawed to `forward`'s horizontal
heading — horizontal because `inGust` tests horizontal distance against a flattened
heading, so a vertically-tilted visual would misrepresent it.

**Do not derive the orientation by reasoning about it.** `RingGeometry` is authored in the
XY plane and `theta` runs anticlockwise from +X, so laying it flat and matching a `+Z`
forward involves a rotation and an offset that are easy to get subtly wrong and hard to
see. The containment test in §9 is what establishes the orientation is right; treat a
failure there as the orientation being wrong rather than the test being wrong.

Lifetime 0.22 s, matching the gust's own cadence closely enough that a chain of gusts
reads as a chain rather than a smear.

## 4. The dash trail (`src/fx/dash-trail.ts`)

```ts
/** `chain` is which dash of the chain this is, 1-based. */
export function createDashTrail(
  origin: Vector3,
  heading: Vector3,
  chain: number,
  c: GroundConfig,
): Effect
```

A stretched translucent streak along `heading`, starting at `origin`. Length derives from
`c.dashSpeed * c.dashDurationSeconds` — the distance the dash actually covers — so the
streak marks the ground the burst crossed.

Brightness and length scale with `chain`, so the third dash is the loudest. That is not
decoration: the chain count is information the player currently has no way to read, and
the recovery that follows the third dash is otherwise a mystery.

Lifetime 0.3 s.

## 5. Impacts (`src/fx/impact.ts`)

```ts
export type ImpactKind = 'hit' | 'down'

export function createImpact(position: Vector3, kind: ImpactKind): Effect
```

A `SphereGeometry` shell, scaled up from small to its full radius while its opacity falls
to zero, positioned at the enemy's own position raised 0.9 units so it lands on the body
rather than at its feet. `hit` is quick and tight. `down` is larger, slower, and paler —
pale rather than red on purpose, because the design document's non-lethality is meant to be
encoded by the systems rather than mentioned, and a red splash would say the opposite of
what the downed state means.

Lifetimes 0.18 s and 0.45 s.

## 6. The Avatar State aura (`src/fx/avatar-aura.ts`)

Not an `Effect` — it does not self-terminate.

```ts
export interface AvatarAura {
  object: Object3D
  /** Fades in while active, out while not. Call every frame. */
  update(dt: number, active: boolean): void
  dispose(): void
}

export function createAvatarAura(): AvatarAura
```

A translucent shell around the character that fades in over ~0.15 s and out over ~0.4 s,
so the state's end reads as a wind-down rather than a cut. It is added as a child of
`avatar.object`, alongside the glider, so it inherits position and facing for free.

**It must be a child of `avatar.object`, not of the model.** `HANDOFF.md` records that the
glider is a direct child of `avatar.object` and that scaling that root scales the glider
with it — the model lives in an inner `modelRoot` that absorbs fitting and squash. The
aura sits at the same level as the glider for the same reason.

## 7. Wiring (`src/main.ts`)

Every trigger reads a signal the game already produces. No file outside `src/fx/` and
`src/main.ts` changes.

- **The pool replaces the shockwave loop.** `const effects = createEffectPool(scene)`;
  `effects.add(ring)` where the slam currently pushes; `effects.advance(dt)` where the
  cull loop currently runs. The `shockwaves` array and its loop are deleted.
- **Gust:** `state.gustPressed && canGust(encounter)`, evaluated against the pre-step
  encounter so it agrees with what `stepEncounter` will do on the same frame. Cone at
  `player.position` along `player.forward`.
- **Dash:** `player.dashesUsed` increasing across `controllerStep` — the same
  compare-either-side trick slam detection uses, which is why no movement code needs to
  report anything. `chain` is the new value; the heading is the horizontal velocity.
- **Impacts:** one `'hit'` per id in `fight.hitThisFrame` and `fight.slamHitThisFrame`,
  one `'down'` per id in `fight.downedThisFrame`, positioned from the matching enemy.
  A downed enemy gets a `'down'` and not also a `'hit'`, because `downedThisFrame` and the
  connect lists are computed from different moments and an enemy that goes down this frame
  appears in both — the down is the louder statement and the one to keep.
- **Aura:** created once beside the glider, `aura.update(dt, avatarActive)` each frame.

## 8. Traps this must avoid

Both are recorded in `HANDOFF.md` and both have already cost this project time:

- **No `PointsMaterial`.** Its screen-facing squares read as white blocks as soon as the
  camera gets near them, which is why wind motes are capped at 0.45–0.75 world units.
  Every effect here is a mesh.
- **Every effect sets `userData.excludeFromShadows`.** `enableShadows` in `src/core/sun.ts`
  honours the flag, and a translucent effect casting a hard shadow reads as a solid object.

## 9. Testing

Vitest, colocated, `node` environment. Meshes are inspected through their objects rather
than rendered, as `shockwave.test.ts` and `wind-tell.test.ts` already do.

`effect-pool.test.ts` — the most valuable file here, using fake effects:

- A finished effect is removed from the scene and disposed.
- `dispose` is called exactly once for a finished effect, never twice on a later advance.
- A live effect is neither removed nor disposed.
- Several effects finishing on the same frame are all removed — the guard against a
  splice skipping an entry.
- At the cap, `add` evicts the oldest and disposes it, and `size()` never exceeds
  `maxLive`.
- The evicted one is the oldest, not the newest.
- `dispose()` empties the scene and disposes everything still live.

`gust-cone.test.ts`:

- **The drawn cone agrees with the hit test.** Sample a spread of points around the
  origin, and for each compare `inGust(origin, forward, point, c)` against a geometric
  containment check derived from the mesh's own `thetaStart`, `thetaLength` and radius.
  Every point must get the same answer from both. This verifies the "what you see is what
  you hit" promise by a different mechanism than the code uses, rather than asserting the
  geometry parameters equal the config the code reads — which is the project's own
  forbidden test pattern.
- The cone lies flat rather than standing up facing the camera.
- The leading arc's radius grows across `advance` and ends at the full range.
- `advance` returns true then false; `dispose` does not throw.
- `excludeFromShadows` is set.

`dash-trail.test.ts`:

- Length reflects `dashSpeed * dashDurationSeconds` rather than a hardcoded number,
  asserted by changing the config and seeing the length change.
- The third dash of a chain is materially longer or brighter than the first — asserted
  with a margin, not a bare comparison.
- Terminates, disposes, `excludeFromShadows` set.

`impact.test.ts`:

- A `'down'` is materially larger and longer-lived than a `'hit'`, with a margin.
- Both terminate and dispose.
- `excludeFromShadows` set on both.

`avatar-aura.test.ts`:

- Opacity rises while active and falls while not.
- It never goes negative or above its ceiling under a large `dt`.
- Starts invisible, so it does not flash on the first frame before the state begins.
- `excludeFromShadows` set.

`shockwave.test.ts` keeps passing unchanged — the `Effect` extraction is a type-level
change only.

## 10. Documentation

`docs/HANDOFF.md` gains a line under what is built. No README change: these are effects on
existing actions, not new controls.

## Out of scope

- **No visual for airbending thrust or hover.** They are movement, not attacks, and they
  run continuously — a persistent jet needs a different treatment from a one-shot burst.
- **No enemy strike visual.** The spear already lifts on the wind-up telegraph, which is
  the part the dodge window depends on.
- **No object pooling for reuse.** Effects are created per event and disposed, matching
  `createShockwave`. If allocation churn shows up in a profile, pooling is the follow-up —
  it is not worth the complexity on speculation.
- **No screen shake, no hit-stop, no damage numbers.** Each is its own design question.
- **No sound for any of these.** `src/fx/audio.ts` currently owns one procedural wind
  voice; per-attack audio is a separate piece of work.
