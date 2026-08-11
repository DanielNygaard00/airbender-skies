# Aim And Hit Direction

## The problem

**Nothing shows where an attack will go.** The gust, both staff arcs, the Pressure Wave and the
Vortex are all aimed at `player.forward`, and there is no reticle anywhere in `src/ui/hud.ts`.
The archer gets an aim tell — `src/fx/aim-tell.ts` draws the sector it is about to fire into —
and the player gets nothing.

**Nothing shows where a hit came from.** `hud-hurt` is a full-screen red vignette with no
direction in it. Archers fire from up to 30 units and enemy health bars are world-space
billboards, so an arrow from behind gives the player a red flash and no information at all.

## Two findings that shape the design

**A fixed centre reticle would be wrong twice over.** The camera is a follow cam:
`desiredCameraPosition` places it behind and `GROUND_PROFILE.height` 2.6 above, and
`camera.lookAt(sampledPosition)` aims it at the *player*. So screen centre is the character's
body, not the aim point. And on foot `groundStep` sets `forward` to
`horizontalForward(input.lookDirection)` — deliberately flattened, so that a standing turn moves
the blast with the character — which means looking up 40 degrees still gusts horizontally. A dot
at screen centre would misreport both the offset and the pitch.

So the reticle is **projected**, not placed: take a point along the real `forward`, run
`Vector3.project(camera)`, and draw the reticle where that lands. This is honest in both
postures without a special case — on foot it sits on the horizon ahead, teaching the player that
aim is horizontal; in the glider `forward` is the steered 3D heading, and the same projection
follows it.

**Damage has no source to point at.** `src/combat/encounter.ts:359` accumulates
`damageToPlayer` as a scalar across every soldier, then adds `projectileDamage` at `:377`.
Nothing anywhere records *where* a hit came from, so the indicator needs new reporting before it
can point anywhere. That reporting is the larger half of this cycle.

## A third finding, from the cycle just shipped

Reduce-motion sets `motionScales().hurtFlash` to 0. A player with it on currently gets **no**
feedback that they were hit beyond the health bar moving.

So the hit-direction indicator is **deliberately not scaled by any motion scalar.** It is
information rather than motion, and under reduce-motion it becomes the only hit feedback there
is. Scaling it would take away the thing that makes that mode playable in a fight. The wedge
does not shake, pulse or move — it fades — so there is nothing vestibular in it to soften.

## The change

### Where a hit came from

`EncounterStep` gains:

```ts
/**
 * Where each hit on the player came from this frame, in world space, with its damage.
 *
 * A list rather than one aggregated direction: two spears and an arrow can land on the same
 * frame, and averaging their bearings would point at empty space between them.
 */
playerHitsThisFrame: PlayerHit[]

export interface PlayerHit {
  from: Vector3
  damage: number
}
```

A spear's `from` is the soldier's position; an arrow's is the projectile's position at the moment
it connects. Both are already in hand at the point the damage is counted — `stepEnemy` returns
its own `enemy`, and `stepProjectile` has the projectile — so this is reporting what is already
known, not computing anything new.

**Hits are reported even when the damage is avoided.** `encounter.ts:381` zeroes `applied` when
the player is invulnerable through a Slipstream, and `damageAvoided` already pays Focus for that.
The list reports what was *aimed* at the player, so a dodge still tells them where the attack
came from — which is the information that makes the next dodge possible. The `damage` field
carries what was aimed, and whether it landed is `applied`'s business, not the list's.

### Turning a source into a bearing

A new pure module, `src/fx/hit-direction.ts`:

```ts
/**
 * Where a hit sits relative to where the camera is looking, as a turn in radians:
 * 0 is dead ahead, positive is clockwise on screen, ±π is directly behind.
 */
export function bearingFromCamera(cameraForward: Vector3, playerPosition: Vector3, from: Vector3): number

export interface HitMark { bearing: number; life: number }

/** Advance every mark and drop the expired ones. */
export function stepHitMarks(marks: readonly HitMark[], dt: number, c: HitDirectionConfig): HitMark[]
```

Bearings are computed **horizontally**, from the camera's flattened forward against the flattened
vector from player to source. A hit from directly above or below has no horizontal bearing worth
drawing, and the guard is the same shape `inCone` already uses: below a small horizontal distance,
report dead ahead rather than normalising into a NaN.

The mark's `life` counts down from `HIT_MARK_SECONDS`. Its opacity is `life / HIT_MARK_SECONDS`,
so a wedge fades rather than blinking out.

`HIT_MARK_SECONDS` is **1.2**. Long enough to read and turn toward, short enough that a sustained
fight does not leave a permanent ring. An argued guess.

Marks are **not** re-aimed as the camera turns. A mark records the bearing at the moment of the
hit, so turning toward it leaves the wedge behind rather than dragging it around — which is what
makes turning toward it feel like it worked. This is a deliberate choice and the alternative
(storing the world direction and recomputing every frame) is the one that feels wrong, because
the wedge would follow the player's view and never resolve.

### The reticle

A new pure module, `src/ui/reticle.ts`:

```ts
export interface ReticleModel {
  visible: boolean
  /** Fractions of the viewport, 0 to 1 from the top-left. */
  x: number
  y: number
  /** A live target is inside the gust cone. */
  hot: boolean
}

export function reticleModel(
  aim: { x: number; y: number; z: number },   // already projected to NDC
  hot: boolean,
): ReticleModel
```

The projection itself lives in `main.ts`, because it needs the live camera — but the conversion
from normalised device coordinates to viewport fractions, and the decision to hide the reticle
when the aim point is behind the camera, are pure and tested here. `z > 1` means behind the near
plane's far side in NDC terms; the honest test is that a point behind the camera must not draw a
reticle on screen, which is the case a naive `(ndc.x + 1) / 2` gets wrong by drawing it mirrored.

`hot` reuses `anyLiveGustTarget`, which `main.ts` already computes every frame for the aim tell,
so it costs nothing. **The reticle has exactly one state change and no per-move variants.** Four
reticles for four moves is noise, and the gust cone effect already draws the cone's real
footprint when it fires.

### The DOM halves

`src/ui/reticle-view.ts` and `src/ui/hit-direction-view.ts`, both built the way `createHud` is —
a `STYLE` string appended to `document.head`, a root element, cached handles, `update(model)` and
`dispose()`. Both untested for the reason the others are: the node environment has no DOM.

Both hide while the game is paused. The guide and the pause card own the screen then, and a
reticle floating over a settings panel is noise.

## Out of scope

- **Off-screen enemy indicators.** A different feature: those track live positions continuously,
  where a hit mark is a fading record of one moment. Sharing an implementation would force one of
  them into the wrong shape.
- **A lock-on or soft target.** Named in the same analysis as this cycle and genuinely separate —
  it changes aiming rather than reporting it.
- **Damage numbers.** This game deliberately has no numeric damage anywhere in the HUD.
- **Reticle states per move.** Above.

## Testing

- `bearingFromCamera` at the four cardinal relationships — ahead, behind, left, right — asserted
  as **signed** values, not magnitudes. A test on `Math.abs` would pass an implementation that
  mirrored left and right, which is the single most likely error here and the one that makes the
  feature actively harmful.
- A hit from directly above the player: no NaN, and a defined bearing.
- `stepHitMarks` drops a mark exactly when its life reaches zero, keeps one with life remaining,
  and preserves order. Asserted against `HIT_MARK_SECONDS` and a real `dt`, with the boundary
  case at exactly zero.
- `reticleModel` converts NDC to viewport fractions with the y axis flipped — NDC `+1` is the top
  of the screen and CSS `0` is. Asserted with a point that is not on either axis, so a swapped or
  unflipped axis is visible.
- A point behind the camera yields `visible: false`.
- `playerHitsThisFrame` is populated for a spear strike, for an arrow, and **for both on the same
  frame**, with the two sources distinct. The same-frame case is the one that justifies a list.
- A Slipstream-avoided hit still appears in the list while `applied` is 0. This is the claim the
  design rests on and nothing else would catch it.

## What will not be verified

Whether either reads well. Both are screen-space feedback in a game nobody has played, and the
harness cannot hold a pointer lock, so the reticle cannot be watched tracking a turn or the wedge
watched fading. `HIT_MARK_SECONDS` 1.2 is the whole of this cycle's tuning surface and it is an
argued guess.
