# Enemy health bars

Written 2026-08-04.

A small bar above each enemy's head showing how much health it has left.

## Why

The fight already tells the player almost everything except how a fight is going.
`createEnemyView` makes a soldier's *intent* legible — the body flushes warm and the spear
cocks back on a wind-up, and a downed body lies flat — but nothing says whether the soldier
the player has been gusting is one hit from going down or barely scratched. For a
crowd-control fighter that is the decision the player most needs help with: given four
soldiers closing, which one is worth a Pressure Wave.

Enemy health already exists and is already reduced by every attack. `Enemy.health` is a
`Health` with `current` and `max`, so nothing about the combat model needs to change. This
is a rendering feature only.

## What it is

A bar of two quads above the head, part of the enemy's own `Object3D`, rotated each frame
to face the camera.

Four decisions, all settled:

**In-world billboard, not a DOM overlay.** The bar is a child of the enemy's Group, so it
inherits the enemy's position for free, scales with distance the way everything else in the
world does, and needs no screen-space projection, no per-enemy element to create and
destroy, and no clipping at the screen edges. It also puts the bar in the module that
already owns how a soldier looks.

**Visible only once damaged.** Hidden at full health. This matches the player's own health
bar, which `hudModelFor` hides while health is full, and it keeps the screen quiet while
the player is exploring rather than fighting.

**Hidden when downed.** A body lying flat is already the statement that it is out of the
fight. An empty bar hovering over a prone soldier adds nothing and would leave a permanent
marker over the site of every past fight.

**Depth-tested, so terrain hides it.** A bar is visible exactly when its owner is. This is
deliberately *not* what the attack effects in `src/fx/` do — those set `depthTest: false` so
a flat ground effect is not buried by a slope — and the difference matters: an attack effect
drawn over a hill shows the player something they did, while a health bar drawn over a hill
shows them an enemy they cannot see.

## Architecture

### `src/combat/health-bar.ts` (new)

```ts
export interface HealthBar {
  object: Object3D
  update(health: Health, cameraQuaternion: Quaternion): void
  dispose(): void
}

export function createHealthBar(): HealthBar
```

The bar owns its geometry and materials, so `dispose` is part of the contract for the same
reason it is on `Effect` in `src/fx/effect.ts`: one is created per enemy, and a missed
release accumulates.

`update` does three things and nothing else: set visibility from the health, set the fill's
horizontal scale from the fraction, and copy the camera's rotation onto the group.

Visibility is a separate exported predicate, so it can be tested without three.js and
without an enemy:

```ts
export function healthBarVisible(h: Health): boolean {
  return !isDowned(h) && h.current < h.max
}
```

It calls `isDowned` rather than restating `current <= 0`. Restating a rule is how a second
copy of it drifts from the first — the action guide takes the same care, and where it cannot
import a predicate its comment names where the original lives.

### `src/combat/health.ts` (one addition)

```ts
export function healthFraction(h: Health): number
```

Returns 0 to 1, clamped, and returns 0 rather than `NaN` for a non-finite or zero `max`.
That choice is defensive rather than visible: a health with `max <= 0` also has
`current < max` false, so `healthBarVisible` hides the bar and the fraction never reaches
the screen. It matters only because a `NaN` reaching `scale.x` would corrupt the transform
rather than merely look wrong. Note that `hudModelFor` returns 1 for the same case, since
there a missing health pool means "nothing to report" rather than "empty". It belongs here
because it is a property of `Health`, not of a bar. `hudModelFor` computes the
same quantity inline from a `{ current, max }` pair rather than a `Health`; that is left
alone, because widening it to accept both shapes to save four lines would be a worse trade
than the small duplication.

### Geometry

Two `PlaneGeometry` quads in a `Group`:

- **Track**: `0x1b1f24` at opacity 0.55, the full width of the bar. Dark and semi-transparent
  so it reads as a recess against both pale terrain and open sky.
- **Fill**: `0xe4614a`, drawn 0.001 in front of the track so the two do not z-fight. A cooler
  red than the player's own health bar, which runs `#ff8f6b` to `#ffd0a8`, so a glance never
  confuses an enemy's health with the player's.

The fill's geometry is **translated so its origin is its left edge**, and `update` sets
`scale.x` to the fraction. A quad scaled about its centre shrinks toward the middle from
both sides, which looks like a bar that empties from both ends at once. This is the most
likely mistake in the whole feature, so a test pins the fill's left edge against the
track's left edge at half health rather than only checking the scale value.

Both meshes are `MeshBasicMaterial` — a health bar should not take lighting — and both carry
`userData.excludeFromShadows`, matching how the effects in `src/fx/` opt out of the shadow
pass. `depthTest` is left at its default `true`.

Numbers: width 0.9, height 0.11, at y = 2.0. The body capsule has radius 0.35 and length
1.0 centred at y = 0.85, so its top is at 1.7; 2.0 clears the head without floating free of
it.

### Billboarding

`object.quaternion.copy(cameraQuaternion)` — the full camera rotation, not yaw only, so the
bar faces a camera that is also pitched down at the player. Yaw-only billboarding would
leave the bar leaning away from a camera looking down from above.

### `src/combat/enemy-mesh.ts` (changed)

`createEnemyView` composes one `HealthBar`, adds it to its Group, and drives it from `sync`.
The signature gains the camera rotation:

```ts
sync(enemy: Enemy, cameraQuaternion: Quaternion): void
```

Required rather than optional. An optional camera would let a caller silently produce bars
that never turn to face anything, which is exactly the kind of defect that passes every
test and is obvious on screen.

The downed branch of `sync` returns early today. The bar's own visibility rule already
handles being downed, so the bar is updated *before* that early return rather than being
special-cased inside it — one rule, in one place.

### `src/main.ts` (one line)

The existing call at `src/main.ts:323` becomes:

```ts
for (const enemy of encounter.enemies) enemyViews.get(enemy.id)?.sync(enemy, camera.quaternion)
```

This already runs after the camera is positioned and aimed at `src/main.ts:293`, so the
rotation is the current frame's, not the previous frame's.

## Testing

`src/combat/health-bar.test.ts`:

- `healthBarVisible` is false at full health, true once damaged, false when downed — the
  downed case with a damaged health value, so it cannot pass by way of the damage check.
- The fill's `scale.x` equals the fraction.
- A non-finite, negative, or above-max `current` produces a scale within 0 to 1.
- **The fill grows from the left**: at half health the fill's world bounding box shares its
  minimum x with the track's, and its maximum x is less than the track's.
- The group's quaternion equals the camera quaternion it was handed.
- `depthTest` is true on both materials — a regression guard, because every neighbouring
  effect module sets it false.
- Both meshes carry `excludeFromShadows`.
- `dispose` does not throw.

`src/combat/enemy-mesh.test.ts` (new file — `enemy-mesh.ts` has no tests today):

- The view's object has a health bar among its children.
- A downed enemy's bar is not visible, and a damaged living enemy's is.
- `sync` still does what it did before: position copied, rotation from facing, the wind-up
  colour and the cocked spear, the flat rotation when downed. These are characterisation
  tests for behaviour that currently has none, written while the file is being changed.

Every test above is red-proofed: written, then confirmed to fail with the feature
neutralised, before being counted as passing.

## Out of scope

- **A colour shift at low health.** Genuinely useful information — a soldier one hit from
  going down is the one to slam — but it is a separate decision, and the plain bar should be
  seen first.
- **Numbers, names, or stance text above the head.** The body colour already carries stance.
- **Bars on anything other than enemies.** The player has a HUD.
- **Distance fading or a visibility range.** Worth revisiting once there are crowds; with
  the current encounter size it would be tuning against a situation that does not exist yet.
