# Vortex and Slipstream

Written 2026-08-04.

The two airbending moves from §4.2 that are still missing, plus the enemy gravity that
Vortex needs in order to work at all.

## Why

§4.2 lists five moves under "Airbending — always available". Three exist: Gust, Pressure
Wave, and (as a movement tool) the blast dash. Two do not:

- **Vortex** — "Charged. Pulls a group inward and lifts them briefly. Setup, not damage."
- **Slipstream** — "Directional dash with a brief invulnerability window on a tight timing.
  The dodge, upgraded."

Air Wall is the fourth gap and is deliberately excluded: its function is deflecting
projectiles at an angle to return fire, and nothing in the game shoots yet. Building it now
would produce a barrier that deflects nothing and cannot be demonstrated.

Slipstream also closes a hole in §4.5. Focus is specified to build from four things:
consecutive hits, clean traversal, redirected projectiles, and **damage avoided at close
range**. The first two exist. Redirected projectiles need archers. A dodge that beats an
incoming strike is exactly the fourth, so it is implemented here rather than invented later.

## The prerequisite: enemies have no gravity

This was measured on the running build, not inferred. Gusting a soldier raised it from
y = 11.504 to y = 13.896, and it was still at 13.896 twenty seconds later — identical to
three decimals at frames 180, 600 and 1200.

The cause: `main.ts` drops each enemy onto the ground once at spawn and never again, while
`stepEnemy` integrates `position.addScaledVector(knockback, dt)` — and `knockback` is a
`Vector3` whose y component `gustImpulse` and `waveImpulse` both set. Nothing applies gravity
and nothing re-snaps to the ground, so every upward impulse is permanent. **Gust and Pressure
Wave currently levitate the soldiers they hit.**

Vortex cannot be built honestly on top of that: "lifts them **briefly**" requires coming
down. So gravity is part of this work, and fixing it also fixes the existing bug.

Note that this changes shipped behaviour that was not complained about: knocked soldiers will
now land instead of hanging in the air. That is the correct behaviour and the reason for the
change, but it is a felt difference in how Gust and Pressure Wave read.

## Decisions, all settled

**Enemies get real gravity** rather than a timed suspension, because it makes Vortex's lift
real and repairs Gust and Pressure Wave at the same time.

**Slipstream is a separate move**, not invulnerability bolted onto the blast dash. The doc
files the blast dash under movement (§2.1) and Slipstream under combat (§4.2); the blast dash
is deliberately ground-only with a three-dash chain, and a dodge that cannot be used while
gliding would be useless against the aerial threats §4.3 describes.

**Both are free, limited by cooldowns.** §4.2 files them under "always available", and Gust
and Pressure Wave are both free today. §4.5 assigns Breath to flight and dash fuel, not to
attacks.

**A Slipstream that avoids a hit builds Focus**, implementing §4.5's fourth build source.

## Architecture

### Enemy gravity — `src/combat/enemy.ts` (changed)

`Enemy` gains one field, and `knockback` narrows in meaning:

```ts
export interface Enemy {
  // ...
  /** Decaying horizontal push from a gust, a slam or a vortex. Horizontal only. */
  knockback: Vector3
  /** Ballistic vertical speed. Gravity acts on this; a ground snap ends it. */
  verticalVelocity: number
  /** Set by the ground snap. The authority on "airborne", so no one infers it. */
  grounded: boolean
}
```

`grounded` is stored rather than derived because every consumer would otherwise reinvent the
test — comparing y against the ground with its own epsilon, and drifting from the snap that
actually decides it.

Splitting the two is the point. A decaying push and a ballistic arc are different physics:
damping a fall would make an enemy float down, and the current single-vector model is exactly
why the lift never resolves. `hitEnemy` keeps its `impulse: Vector3` signature and routes the
y component into `verticalVelocity` while the horizontal part goes to `knockback`, so callers
(`gustImpulse`, `waveImpulse`, and the new `vortexImpulse`) do not change shape.

`stepEnemy` needs the ground, which it cannot currently see. It takes a deliberately narrow
query rather than the whole `TerrainQuery`:

```ts
export interface GroundHeightQuery {
  groundHeightAt(x: number, z: number): number | null
}
```

`TerrainQuery` also carries `raycastDown`, which enemy stepping has no use for. A narrow
interface keeps the combat model from depending on the parts of terrain it does not need, and
makes a test fixture two lines instead of six.

Per frame, for a living enemy:

1. `verticalVelocity -= gravity * dt`, then apply it to `position.y`.
2. Apply the horizontal `knockback`, which decays as it already does.
3. Ask `groundHeightAt` for the ground under the new x/z. If the enemy is at or below it and
   descending, snap `position.y` to it and zero `verticalVelocity` — it is grounded again.
4. If there is no ground (`null`) and the enemy has fallen below `worldFloorY`, it is
   **downed**. §4.6 lists "blown off a ledge into water" as a down state, and without this
   rule adding gravity would make an enemy off the island fall forever.

**An airborne enemy is inert**: while `grounded` is false it does not advance, wind up, or
strike, and it deals no damage. This is what makes Vortex setup rather than damage — the
payoff for lifting a group is that the group stops acting. A wind-up in progress is dropped
when the enemy leaves the ground, consistent with `hitEnemy` already treating being hit as an
interruption.

Steps 1 to 4 apply to a **downed** enemy as well, even though its stance logic is skipped.
A body has to fall: `stepEnemy` returns early for the downed today, and leaving gravity out of
that branch would strand any corpse that was airborne when it went down — which is precisely
the bug being fixed here, in a second place. A downed enemy therefore falls, lands, and
settles where it was put.

`EnemyConfig` gains `gravity: 20`, matching the world's own gravity in
`DEFAULT_GROUND_CONFIG`, and `worldFloorY` is passed in alongside the ground query from
`main.ts`, which already owns that constant for the player.

### Vortex — `src/combat/vortex.ts` (new)

```ts
export interface VortexConfig {
  maxChargeSeconds: number
  /** Below this, a release cancels: no pull, no cooldown. */
  minChargeSeconds: number
  minRadius: number
  maxRadius: number
  minPullSpeed: number
  maxPullSpeed: number
  minLiftSpeed: number
  maxLiftSpeed: number
  cooldownSeconds: number
}

/** 0 to 1: how far a held charge has come. */
export function vortexCharge(heldSeconds: number, c: VortexConfig): number
export function vortexRadius(charge: number, c: VortexConfig): number
/** Radial, with no facing test: a vortex is a place, not a direction. */
export function vortexTargets(
  origin: Vector3, enemies: readonly Enemy[], charge: number, c: VortexConfig,
): Enemy[]
/** Inward pull plus lift. Zero damage — this move is setup. */
export function vortexImpulse(
  origin: Vector3, target: Vector3, charge: number, c: VortexConfig,
): Vector3
```

Radial and facing-free, like `waveTargets` — a vortex catches what is around the caster. The
pull points *inward*, the opposite sign to `gustImpulse`'s outward push, which is the whole
contrast between the two moves: Gust scatters a group, Vortex gathers one.

Damage is zero and there is no damage parameter to set, so the move cannot quietly become a
damage tool through config drift.

Charge and cooldown live on `Encounter` beside `gustCooldown`, because a fight already owns
the player's bending timers and `PlayerState` is deliberately kinematic:

```ts
export interface Encounter {
  // ...
  gustCooldown: number
  /** Seconds the player has been holding a charge, or 0. Not the 0-to-1 fraction. */
  vortexHeldSeconds: number
  vortexCooldown: number
}
```

The field is `vortexHeldSeconds`, not `vortexCharge`, because `vortexCharge()` is the function
that converts seconds into the 0-to-1 fraction. One name for two units invites passing the
wrong one, and both are numbers, so the compiler would not catch it.

`EncounterInput` gains `vortexHeld: boolean` and `vortexReleased: boolean`. Holding
accumulates charge only while off cooldown; releasing below `minChargeSeconds` cancels
without spending the cooldown, so a mistaken tap is not punished.

**No Focus grant from a catch.** §4.5 builds Focus from hits, and the gust or slam the player
follows up with already pays. A second source here would be one more number to tune for no
stated reason. The reward for a vortex is tactical: a lifted group cannot act.

### Slipstream — `src/player/slipstream.ts` (new)

```ts
export interface SlipstreamConfig {
  speed: number
  durationSeconds: number
  /** The invulnerable window, measured from the start. Shorter than the dash. */
  invulnerableSeconds: number
  cooldownSeconds: number
}

export interface SlipstreamState {
  /** Seconds elapsed since it fired, or null when not slipstreaming. */
  elapsed: number | null
  cooldown: number
}

export function canSlipstream(state: SlipstreamState): boolean
export function isInvulnerable(state: SlipstreamState, c: SlipstreamConfig): boolean
export function stepSlipstream(
  state: SlipstreamState, pressed: boolean, heading: Vector3, dt: number, c: SlipstreamConfig,
): { state: SlipstreamState; impulse: Vector3 | null }
```

It returns an impulse rather than applying one, the same contract `stepDash` uses, so movement
code stays in charge of integration. State goes on `PlayerState` as flat fields
(`slipstreamElapsed`, `slipstreamCooldown`) next to `dashesUsed` and `dashRecovery`, matching
how the dash already lives there.

Available in both postures. Direction comes from the movement input when there is any, and
from the flattened look direction otherwise — the rule `groundStep` already applies to a
standing dash, so a stationary player dodges where they are looking.

The invulnerable window is **shorter than the dash**. That is what makes the timing tight:
the move still displaces you after you are vulnerable again, so mistiming it leaves you
committed to a direction with no protection.

### The invulnerability seam

Player state and combat meet through the existing input struct rather than a new dependency:

- `EncounterInput` gains `playerInvulnerable: boolean`.
- When it holds, `damageToPlayer` is discarded before it reaches `applyDamage`.
- `EncounterStep` gains `damageAvoided: boolean`.

**`damageAvoided` is true only when damage was actually incoming and was discarded** — never
merely because the player is invulnerable. This matters: a flag meaning "invulnerable this
frame" would let a player farm Focus by dodging an empty field, turning §4.5's reward for
skill into a grind. A test pins exactly this.

The enemy's strike still resolves: it commits, spends its wind-up, and enters recovery. A
dodge costs the attacker its window rather than erasing the attack.

### Focus — `src/focus/focus.ts` (one addition)

`FocusEvents` gains `damageAvoided: boolean`, and `FocusConfig` gains `dodgeGain: number`. It
is granted through the same chain-ramp multiplier as the other event gains, so dodging inside
a long clean chain is worth more than dodging cold — which is what §4.5's "unbroken chains"
means.

Being hit still breaks the chain. A dodge is the thing that keeps it alive.

### `src/main.ts` (wiring)

- Input: `vortexHeld` / `vortexReleased` from `R`, `slipstreamPressed` from `C`.
- The slipstream step runs alongside the dash inside the player update, and its impulse is
  added to velocity the same way.
- `stepEncounter` receives `playerInvulnerable` from `isInvulnerable`, and the ground query
  and `worldFloorY` for enemy gravity.
- `damageAvoided` feeds the Focus events already assembled there.

## Config values

Added to `DEFAULT_COMBAT_CONFIG`:

```ts
enemy: { /* ... */ gravity: 20 },
vortex: {
  maxChargeSeconds: 1.2,
  minChargeSeconds: 0.2,
  minRadius: 5,
  maxRadius: 12,      // a full charge reaches as far as a gust
  minPullSpeed: 10,
  maxPullSpeed: 18,
  minLiftSpeed: 5,    // ~0.5s airborne under gravity 20
  maxLiftSpeed: 11,   // ~1.1s airborne, apex ~3m: "briefly"
  cooldownSeconds: 3.5,
},
```

`DEFAULT_SLIPSTREAM_CONFIG` in `src/core/config.ts`:

```ts
{
  speed: 30,               // a shade faster than the blast dash's 26
  durationSeconds: 0.2,
  invulnerableSeconds: 0.11,
  cooldownSeconds: 1.5,
}
```

The window is 0.11s inside an enemy telegraph of `windUpSeconds: 0.55`, so beating a strike
takes real timing rather than a reflex mash.

`DEFAULT_FOCUS_CONFIG` gains `dodgeGain: 8` — above `gustConnectGain` (6) and below
`downGain` (14). Avoiding a hit is worth more than landing one and less than putting someone
down.

## Visuals

This repo treats a mechanic the player cannot see as a bug, so both moves get effects through
the existing `src/fx/` pool and `Effect` contract:

- **Vortex charge**: a ring that tightens inward while held, showing the radius the release
  will cover — so the charge is legible before it is spent, not after.
- **Vortex release**: a ring sweeping inward at the true `vortexRadius`, matching the volume
  actually caught, the same honesty rule the gust cone follows.
- **Slipstream**: a streak along the dash, plus a shell on the player that is visible for
  exactly `invulnerableSeconds` — the window is the mechanic, so it has to be the thing shown.

All are depth-tested consistently with their neighbours in `src/fx/`, and carry
`excludeFromShadows`.

## Documentation

Both moves go into `src/ui/guide/actions.ts` with live availability from the real predicates
(`canSlipstream`, and a vortex-ready check off the encounter), and into the README's controls
table. A drift test already binds those two together in both directions, so a key added to one
and not the other fails the suite.

## Testing

Red-proof everything: write the test, confirm it fails for the stated reason, then implement.

The tests that carry the most weight, because each pins something that would otherwise pass
by coincidence:

- **The float regression.** Gust an enemy, step several seconds, assert its y returns to the
  ground height it started at. This is the test that proves the reported bug is fixed, and it
  fails today.
- **An airborne enemy deals no damage** even standing inside `strikeRange` — derived from
  config, not a hardcoded distance.
- **Vortex is radial**: an enemy directly behind the caster is caught. Facing must not matter.
- **Vortex pulls inward**: horizontal distance to the caster decreases. Contrast with a gust,
  where it increases — asserting the sign, not just that something moved.
- **A release below `minChargeSeconds` leaves the cooldown untouched**, so the cancel is free.
- **The invulnerable window is shorter than the dash**: a strike arriving after
  `invulnerableSeconds` but before `durationSeconds` ends still lands. A test that only checks
  "invulnerable at t=0" would pass against a move that is invulnerable throughout.
- **`damageAvoided` is false when no damage was incoming**, however long the player is
  invulnerable. This is the anti-farming rule.
- **A dodge keeps a Focus chain alive** where taking the hit would break it.
- Fall-out: an enemy pushed off the island and below `worldFloorY` is downed rather than
  falling forever.

## Out of scope

- **Air Wall.** Blocked on projectiles; see above.
- **Staff melee and the no-glide-while-swinging gate.** §4.2's other half, and its own build.
- **Borrowed elements, the radial switch, and Focus spending on elemental heavies.** The
  largest remaining piece, and the only one that finishes the Avatar State.
- **§4.3's aerial-posture narrowing** — the kit shrinking to gusts and redirects while
  gliding. It needs projectiles to mean anything.
- **New enemy types.** Five of the six in §4.4 are still unbuilt; this spec adds none.
- **Vortex lifting the player.** The doc gives the move enemies as its object; self-lift would
  be a traversal tool and a different design question.
