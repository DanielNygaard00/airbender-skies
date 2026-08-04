# Staff melee combos

Written 2026-08-04.

§4.2's other half: the staff as a weapon, and the rule that holding it as one costs you the
sky.

## Why

§4.2 gives the staff a paragraph of its own:

> Short, snappy combos with wide horizontal arcs, built for hitting several enemies at once
> instead of one enemy hard. The staff also gates flight: **you cannot glide while swinging.**
> Committing to melee means committing to the ground layer, which is the game's central risk
> decision.

None of it exists. Every attack in the game today is bending — gust, Vortex, Pressure Wave —
and all three are usable in either posture, so nothing has ever asked the player to give up
the air. The staff is the one move that does, which makes the gate the point of the feature
rather than a restriction bolted onto it.

Two facts from the codebase shape everything below.

**The glider *is* the staff.** `src/player/glider.ts` stows it across the rider's back and
unfolds fan leaves from it on deploy. So "you cannot glide while swinging" is not an arbitrary
rule — you cannot open the wing while you are holding it as a weapon. The gate is physical,
and that is why it is cheap to justify to a player.

**There is no swing animation.** `src/player/clip-map.ts` maps five states — idle, walk, run,
fall, glide — and the model ships nothing else. A swing has no clip to play, so its tell has
to be built. The repo has done this before: `glide-pose.ts` composes a glide pose the model
does not ship, and `enemy-mesh.ts` cocks the spear procedurally to telegraph a wind-up.

## Decisions, all settled

**Left mouse button.** Conventional for melee, and the game already holds pointer lock. Input
currently reads keys and `mousemove` only, so this adds a `mousedown` edge.

**Three swings, with a wider finisher.** Two quick arcs, then a third that sweeps wider and
carries real knockback, so the combo has a shape and finishing it is worth the commitment.

**The gate blocks glider deploy while swinging and through a short recovery after.** Swinging
in mid-air is allowed, and that is the risk: commit on the way down and you cannot open the
wing until the staff is done with you.

**Staff hits build Focus, per enemy hit,** with their own gain — §4.5's first named source is
consecutive hits, and a wide arc landing on three soldiers is exactly that.

## Architecture

### `src/combat/cone.ts` (new) — one definition of a cone test

`inGust` in `src/combat/gust.ts` already answers "is this target inside a horizontal cone",
and a wide staff arc is the same question with a bigger angle and a shorter reach. Rather than
write that twice:

```ts
export interface ConeShape {
  range: number
  halfAngle: number
}

export function inCone(
  origin: Vector3, forward: Vector3, target: Vector3, c: ConeShape,
): boolean
```

The body moves verbatim from `inGust`, including both guards that matter: a target closer than
`1e-6` is rejected rather than normalised into a NaN, and a degenerate heading returns false
rather than dividing by zero.

`inGust` stays exported and becomes a one-line delegation. It is not dead weight: it names the
gust's own use of the shape, `GustConfig` satisfies `ConeShape` structurally so no conversion
is needed, and — the load-bearing reason — `src/fx/gust-cone.test.ts` imports `inGust` and
uses it as the independent mechanism it compares the drawn cone against. Removing it would
quietly delete that honesty check.

### `src/player/staff.ts` (new) — the combo

Player-side, like `dash.ts` and `slipstream.ts`, because a combo is a state machine over time
rather than a thing that happens to enemies:

```ts
export interface StaffConfig {
  maxChain: number
  /** How long one swing occupies the staff. */
  swingSeconds: number
  /** Grace after a swing during which another press continues the combo. */
  continueSeconds: number
  /** Commitment owed once the combo ends, however it ended. */
  recoverySeconds: number
}

export interface StaffState {
  /** Swings thrown in the current combo, 0 to maxChain. */
  chain: number
  /** Seconds into the active swing, or null between swings. */
  elapsed: number | null
  /** Seconds of commitment left after the combo ended. */
  recovery: number
}

export function idleStaff(): StaffState
export function isSwinging(s: StaffState): boolean
/** Swinging or still recovering: the staff is not available as a wing. */
export function staffBusy(s: StaffState): boolean
/**
 * Read the three flat fields off a player as a `StaffState`.
 *
 * Exists so the controller and the action guide do not each assemble the struct by hand —
 * two hand-written copies of the same three fields is how one of them ends up reading a
 * stale one.
 */
export function staffOf(player: {
  staffChain: number
  staffElapsed: number | null
  staffRecovery: number
}): StaffState
export function stepStaff(
  s: StaffState, pressed: boolean, dt: number, c: StaffConfig,
): { state: StaffState; started: StaffSwing | null }
```

```ts
/** The swing that just began. */
export interface StaffSwing {
  /** 1-based position in the combo. Drives the alternating sweep direction of the tell. */
  index: number
  /** The last swing of the chain: wider, heavier. */
  finisher: boolean
}
```

`started` is null on every frame except the one a swing begins — the same shape as `stepDash`'s
impulse and `detectSlam`'s result, so the module reports what happened and the caller decides
what it means. `staff.ts` never sees an enemy.

`finisher` is decided **here**, by the module that owns `maxChain`, and travels with the swing.
The arc module is therefore never handed a chain length it would have to interpret, and there
is one place that knows how long a combo is.

A press during recovery is ignored and does **not** extend it. Recovery is the price of the
combo, not a punishment for mashing.

The hit resolves on the frame a swing **starts**, not part-way through. The doc asks for
"short, snappy", and a wind-up would make the staff a slower gust rather than a different
thing. It also keeps the drawn arc and the resolved arc simultaneous, which is what lets one
test compare them.

State lives on `PlayerState` as three flat fields — `staffChain`, `staffElapsed`,
`staffRecovery` — beside `slipstreamElapsed` and `dashesUsed`, matching how the other moves
already sit there.

**Swinging is ground-mode only.** In the glider the staff is a wing; there is nothing to swing
with. §4.3 says the aerial kit narrows to gusts and single-hand redirects, so a press in
glider mode is ignored rather than queued.

### `src/combat/staff-arc.ts` (new) — the hit

```ts
export interface StaffArcConfig {
  opener: ConeShape
  finisher: ConeShape
  openerDamage: number
  finisherDamage: number
  openerKnockback: number
  finisherKnockback: number
}

/** The shape a swing sweeps. The finisher is the wider one. */
export function staffShape(finisher: boolean, c: StaffArcConfig): ConeShape
export function staffDamage(finisher: boolean, c: StaffArcConfig): number
export function staffTargets(
  origin: Vector3, forward: Vector3, finisher: boolean,
  enemies: readonly Enemy[], c: StaffArcConfig,
): Enemy[]
export function staffImpulse(
  origin: Vector3, target: Vector3, finisher: boolean, c: StaffArcConfig,
): Vector3
```

Every function here takes the `finisher` flag rather than a swing index, because this module
has no business knowing how long a combo is — `stepStaff` owns `maxChain` and labels the swing
on the way out. Handing an index here would mean two modules agreeing about the chain length,
which is exactly the kind of shared constant that drifts.

`staffImpulse` pushes outward from the player like `gustImpulse`, with no upward component:
the doc gives lift to air, and a staff sweep should slide a soldier sideways rather than pop
them into the air where they would go inert. That contrast with the Vortex is deliberate.

### `src/combat/encounter.ts` (changed)

`EncounterInput` gains `staffSwing: StaffSwing | null` — what the player's staff just started,
or null. The fight does not own the combo timing, exactly as it does not own the Pressure
Wave's detection: `slam: { strength } | null` is the precedent, and the staff follows it.

`EncounterStep` gains `staffHitThisFrame: string[]`, kept separate from `hitThisFrame` (gust
connects) and `slamHitThisFrame` for the same reason those two are separate: each feeds a
differently tuned Focus grant, and folding them together would pay the wrong rate.

Resolution order becomes gust, vortex, staff, wave, then enemies step. The staff sits with the
other interrupts and before enemies act, so a swing cancels a wind-up rather than trading with
it — `hitEnemy` already does that.

### The gate — `src/player/controller.ts` (changed)

The deploy branch gains one condition:

```ts
if (input.actionPressed && !state.grounded && !canAirJump(state, deps.ground)
    && !staffBusy(staffOf(state))) {
```

Nothing else is blocked. Jumping, dashing, gusting and dodging all stay available mid-combo —
the doc names gliding, and only gliding, as the thing melee costs.

### Focus — `src/focus/focus.ts` (changed)

`FocusEvents` gains `staffConnects: number`, and `FocusConfig` gains `staffConnectGain`. It
joins the existing event group that is multiplied by the chain ramp, so a combo inside a long
clean chain is worth more than a cold one.

### The tell

Two parts, because there is no clip to play.

**`src/fx/staff-arc-fx.ts` (new)** draws the swing at its **true** range and half-angle — the
same honesty rule the gust cone follows, and the reason a test can compare the drawn sector
against `inCone`. A ring sector, bright and brief: `LIFETIME` 0.16s, appearing at full opacity
and fading, `depthTest: false` like the other attack effects so a ground-level arc is not
buried by a slope. Named `staff-arc-fx.ts` rather than `staff-arc.ts` to avoid two modules a
letter apart from each other.

**`src/player/glider.ts` (changed)** gains a third argument on `update`:

```ts
update(dt: number, deployed: boolean, swing: number | null): void
```

`swing` is 0-to-1 progress through the active swing, or null. The module already computes the
stowed and deployed poses and rewrites the staff's transform every frame, so a sweep applied
from outside would simply be overwritten — this is the only place it can live. When `swing` is
non-null and the glider is stowed, the staff rotates through the arc; when it is null the
existing pose is unchanged. Deployed and swinging cannot coexist, because the gate prevents it.

### Config

`DEFAULT_STAFF_CONFIG` in `src/core/config.ts`:

```ts
{
  maxChain: 3,
  swingSeconds: 0.26,
  continueSeconds: 0.3,
  recoverySeconds: 0.4,
}
```

A full three-swing combo occupies the staff for roughly 0.8s of swinging plus 0.4s of
recovery, so committing costs over a second of no wing. That is the risk priced.

`staffArc` in `DEFAULT_COMBAT_CONFIG`:

```ts
{
  // Reach just past the spear's strikeRange of 3.2, so the staff can out-space infantry.
  opener: { range: 3.6, halfAngle: Math.PI / 2.2 },   // ~164 degrees swept
  finisher: { range: 4.2, halfAngle: Math.PI / 1.9 }, // ~190 degrees: nearly all round
  openerDamage: 0.7,
  finisherDamage: 1.2,
  // Low on the openers so the combo keeps its targets in reach; the finisher clears space.
  openerKnockback: 4,
  finisherKnockback: 18,
}
```

Against `enemy.maxHealth` of 1.5, two openers (1.4) leave a soldier one hit from down and the
finisher takes anyone still standing. A gust does 0.5 with 26 knockback, so the staff trades
the gust's reach and displacement for damage — which is the split §4.1 asks for, since Aang's
damage is supposed to be the lesser half of his kit.

`DEFAULT_FOCUS_CONFIG` gains `staffConnectGain: 3`, below the gust's 6, because a wide arc on
three soldiers pays three times where a gust cone pays once per enemy at far less risk.

## Testing

Red-proof everything: write the test, watch it fail for the stated reason, then implement.

The tests that carry weight:

- **The chain resets when the window lapses.** Swing once, wait past `continueSeconds`, and the
  next press is swing 1 again rather than swing 2.
- **The chain cannot exceed `maxChain`.** A fourth press during recovery does nothing.
- **The finisher is the wider, heavier swing** — asserted against config on all three of range,
  half-angle and damage, so a swap of two of them cannot pass.
- **The gate blocks deploy while swinging AND during recovery, then releases it.** Three
  assertions, because a gate that only covers the swing is the weaker design the spec rejected.
- **A swing hits several enemies at once** — three soldiers spread across the arc, all caught
  by one swing. This is the doc's stated purpose for the move.
- **The drawn arc matches the resolved one**: sample points and compare the fx sector against
  `inCone`, a different mechanism from the one the effect uses. This is the check that caught
  nothing for the gust cone until a human looked, so it is necessary but not sufficient — the
  in-game pass is what confirms it is visible.
- **`inGust` still agrees with itself after the extraction.** The existing gust tests and
  `gust-cone.test.ts` must pass untouched; if any assertion there needs editing, the extraction
  changed behaviour and is wrong.
- **A press in glider mode is ignored** rather than queued for landing.

## Out of scope

- **Air Wall.** Still blocked on projectiles; nothing shoots.
- **Borrowed elements and the radial switch**, and with them §4.5's elemental Focus sink and
  the Avatar State's "all elements at once".
- **A swing animation clip.** The procedural sweep plus the arc effect is the tell; authoring
  or sourcing a real attack clip is separate work.
- **Aerial staff use.** §4.3 narrows the glider kit to gusts and redirects deliberately.
- **Directional or charged swings.** The doc asks for short and snappy; aiming beyond where the
  player already faces is a different move.
- **New enemy types.** Five of §4.4's six remain unbuilt and this adds none.
