# Pressure Wave

**Date:** 2026-08-03
**Status:** Approved
**Implements:** Pressure Wave from §4.2 of `docs/design/aang-playable-character.md`, and
the dive-shockwave half of §4.3

## Overview

Pressure Wave is a ground slam out of a fall whose strength scales with the impact. It
is the design document's "direct payoff for the traversal layer": the better the dive,
the harder the landing hits, so height earned in the flight model converts into combat
value instead of being merely a way to get somewhere.

It is also the first move in the game with real damage. That does not make Aang a
damage-per-second character, which §4.1 rules out, because the price is a total
commitment to the ground layer at a known moment — the player gives up the air to get it.

Four decisions shape the design:

1. **It is free, and it grants Focus.** §4.2 lists Pressure Wave under "Airbending —
   always available", and §4.5 spends Focus on *elemental* heavy moves. So a Focus cost
   would contradict the document. Instead a landed slam pays Focus scaled by the impact,
   which connects the two systems in the other direction: traversal feeds the meter, and
   the flagship combo builds toward the Avatar State.
2. **Ctrl commits.** Ctrl already folds the wings into a dive. Holding it through the
   impact turns that dive into a slam, so §4.3's dive → wave → re-deploy is one
   continuous gesture on one key. Landing without Ctrl is an ordinary landing, so the
   slam is always a choice.
3. **Strength comes from downward impact speed, not from a tracked apex height.** For a
   fall the two are equivalent — `v = √(2gh)`, so damage still "scales with fall height"
   — but impact speed needs no new field on `PlayerState`, and it separates a committed
   dive from a fast level glide that happens to clip the ground.
4. **Detection compares the player either side of `controllerStep`.** No movement code
   changes. Movement stays ignorant of combat, which is the boundary
   `src/combat/encounter.ts` explicitly asks for.

## 1. The blast (`src/combat/pressure-wave.ts`)

A new pure module beside `gust.ts`, following its shape: small functions, each named so
a caller cannot forget the geometry test.

```ts
export interface PressureWaveConfig {
  /** Downward speed at impact below which a landing is just a landing. */
  minImpactSpeed: number
  /** Downward speed at which the slam is at full strength. */
  fullImpactSpeed: number
  /** Blast radius at minimum and full strength. */
  minRadius: number
  maxRadius: number
  /** Damage at minimum and full strength. */
  minDamage: number
  maxDamage: number
  /** Outward knockback at full strength. */
  knockback: number
  /** Upward bounce as a fraction of the impact speed. */
  bounceFactor: number
  /** Focus granted by a full-strength slam. */
  focusAtFullImpact: number
}

/** 0 at the minimum impact, 1 at full. Clamped. */
export function slamStrength(impactSpeed: number, c: PressureWaveConfig): number

export function waveRadius(strength: number, c: PressureWaveConfig): number
export function waveDamage(strength: number, c: PressureWaveConfig): number

/** Everyone caught in one slam. Named so callers cannot forget the radius test. */
export function waveTargets(
  origin: Vector3,
  enemies: readonly Enemy[],
  strength: number,
  c: PressureWaveConfig,
): Enemy[]

/** The push a slam puts on a target: outward and up. */
export function waveImpulse(
  origin: Vector3,
  target: Vector3,
  strength: number,
  c: PressureWaveConfig,
): Vector3
```

`slamStrength` returns `clamp((impactSpeed - minImpactSpeed) / (fullImpactSpeed - minImpactSpeed), 0, 1)`.
Note that a strength of 0 is a *legitimate minimum slam*, not the absence of one —
whether a slam happened at all is `src/player/slam.ts`'s decision, not this module's.

`waveTargets` tests horizontal distance against `waveRadius(strength, c)`, reusing
`horizontalDistance` from `enemy.ts`. Radial rather than a cone, because a slam goes out
in every direction — this is the one bending move in the kit with no facing.

`waveImpulse` is outward from the origin with an upward component, like `gustImpulse`,
scaled by strength. The upward part is what makes it read as air lifting bodies rather
than as a shove, and it is what can blow someone off a ledge.

## 2. Detection and the bounce (`src/player/slam.ts`)

```ts
export interface Slam {
  /** Downward speed at the moment of contact, m/s. */
  impactSpeed: number
  /** 0 to 1. */
  strength: number
}

export function detectSlam(
  before: PlayerState,
  after: PlayerState,
  tuckHeld: boolean,
  respawned: boolean,
  c: PressureWaveConfig,
): Slam | null

export function applyBounce(
  player: PlayerState,
  slam: Slam,
  c: PressureWaveConfig,
): PlayerState
```

`detectSlam` returns a slam only when all of these hold:

- `!before.grounded && after.grounded` — contact happened on this frame. This covers a
  glider landing too, because `controllerStep` sets `mode: 'ground'` and
  `grounded: true` together on touchdown.
- `tuckHeld` — the player committed.
- `!respawned` — **the guard that matters.** Respawning after falling out of the world
  also sets `grounded` true, and the fall velocity is enormous, so without this a death
  plunge would read as the biggest slam in the game. `main.ts` already computes this
  flag for Focus; it is passed in rather than recomputed.
- `-before.velocity.y >= c.minImpactSpeed` — read from **`before`**, because landing
  zeroes the vertical velocity, so `after` no longer knows how hard the contact was.

`applyBounce` returns the player with `velocity.y` set to
`slam.impactSpeed * c.bounceFactor`, `grounded: false`, and `airJumpsUsed: 0`.

Setting `grounded: false` while standing on the surface is safe: `ground-move.ts` snaps
only when the player was already grounded or is descending onto the surface, and a
bouncing player is neither. `airJumpsUsed: 0` is redundant here — both landing paths
already zero it before `applyBounce` runs — and it does not make the re-deploy any more
reachable: `controllerStep`'s deploy branch requires the air jump to already be *spent*,
so an available air jump is what the *next* press consumes, not what deploys the
glider. What actually keeps the combo alive is `grounded: false`, which leaves the
player airborne in `mode: 'ground'` for the eventual double jump and, on the press after
that, the deploy. Playtesting (Task 6) confirmed this: re-deploying after the bounce
takes two presses of Space, not one — the first spends the air jump, the second
deploys — so the flagship combo is dive, slam, double jump, deploy.

## 3. The visual (`src/fx/shockwave.ts`)

An invisible slam is the same mistake as an invisible wind feature, which this repo
treats as a bug.

```ts
export interface Shockwave {
  object: Object3D
  /** Advance the ring. Returns false once it has finished and can be removed. */
  advance(dt: number): boolean
}

export function createShockwave(radius: number, strength: number): Shockwave
```

A flat `RingGeometry` laid horizontal, `MeshBasicMaterial` with `transparent: true`,
expanding from a small fraction of the final radius to the full radius over about 0.4 s
while its opacity falls to zero. `strength` scales the starting opacity, so a weak slam
is a faint ring and a full one is bright — the visual carries the same information the
damage does. `userData.excludeFromShadows` is set, since a
transparent effect ring has no business casting one, and `enableShadows` in
`src/core/sun.ts` honours that flag.

`main.ts` keeps a small array of live shockwaves, advances them each frame, and disposes
geometry and material when `advance` returns false. Disposal matters — these are created
per slam, and an undisposed ring per landing is a leak over a long session.

## 4. Focus (`src/focus/focus.ts`, `src/focus/config.ts`)

`FocusEvents` gains one field:

```ts
/** Strength of a Pressure Wave landed this frame, 0 to 1. Zero when there was none. */
slamStrength: number
```

`FocusConfig` gains `slamGainAtFullImpact: number`. The gain joins the existing event
gains and is scaled by the chain ramp with them:

```ts
value += (events.gustConnects * c.gustConnectGain
  + events.downs * c.downGain
  + events.slamStrength * c.slamGainAtFullImpact) * ramp
```

`noFocusEvents()` gains `slamStrength: 0`.

Enemies downed *by* the wave need no special handling: `downedThisFrame` is computed by
diffing the downed set across the frame, so they already pay `downGain`.

## 5. The fight (`src/combat/encounter.ts`)

`EncounterInput` gains one field:

```ts
/** A Pressure Wave landed at the player's feet this frame, or null. */
slam: { strength: number } | null
```

`CombatConfig` gains `pressureWave: PressureWaveConfig`.

`stepEncounter` resolves the wave in the same place and for the same reason as the gust —
**before the enemies act**, so a slam interrupts a wind-up rather than trading with it.
A frame can contain both a gust and a slam; the gust resolves first, then the wave, then
the enemies. This ordering is arbitrary between the two but must be deterministic, and
the wave going second means it sees the gust's knockback already applied.

Already-downed enemies are excluded from the wave's damage and from its reported
connects, exactly as they are for the gust: the wave should not pay the player for
bouncing a body that is already on the floor.

The wave's connects are reported in a new `slamHitThisFrame: string[]` rather than folded
into `hitThisFrame`. Keeping them apart matters: `hitThisFrame` feeds
`gustConnects * gustConnectGain`, so folding wave hits in would pay the player twice for
one slam — once per enemy caught and once for `slamStrength`.

## 6. Tuning (`src/combat/config.ts`)

```ts
pressureWave: {
  minImpactSpeed: 12,
  fullImpactSpeed: 45,
  minRadius: 4,
  maxRadius: 11,
  minDamage: 0.6,
  maxDamage: 2.2,
  knockback: 30,
  bounceFactor: 0.45,
  focusAtFullImpact: 18,
}
```

| Value | Reasoning |
| --- | --- |
| `minImpactSpeed` 12 | Below a normal jump's landing speed would make every hop a slam. A jump from `jumpSpeed` 9 lands at about 9 m/s, so 12 requires a real fall. A *charged* jump (`chargedJumpSpeed` 20) does land hard enough, at strength 0.24 — a deliberate consequence, not an oversight: charge, hop, slam is a legitimate small ground combo. |
| `fullImpactSpeed` 45 | Reachable by a tucked dive but not by falling off a ledge, so full strength is earned. |
| `minRadius` 4 / `maxRadius` 11 | The minimum catches whoever is on top of you; the maximum is close to the gust's 12 range, so a full slam is a crowd move. |
| `minDamage` 0.6 | Above a gust's 0.5 but well below a soldier's 1.5 health: a weak slam is a gust with no aim. |
| `maxDamage` 2.2 | Past 1.5, so a committed dive downs a soldier outright. This is the payoff. |
| `knockback` 30 | Slightly above the gust's 26, and radial, so it clears space in every direction. |
| `bounceFactor` 0.45 | A 45 m/s dive returns about 20 m/s, roughly 10 m of climb — enough to re-deploy the glider without a second jump. |
| `focusAtFullImpact` 18 | A shade more than a down (14), because the slam is harder to execute. |

Every value here is an argued guess. None of it has been played.

## 7. Wiring (`src/main.ts`)

The frame order, with the new lines in place:

1. `input.sample()`.
2. `crashed = fellOutOfWorld(player, worldFloorY)` — unchanged, still before the step.
3. `stepAvatarState(...)` — unchanged.
4. `const before = player`, then `controllerStep`, then `refillBreath` when the Avatar
   State is active.
5. `const slam = detectSlam(before, player, state.tuck, crashed, ...)`.
6. `if (slam) player = applyBounce(player, slam, ...)`, and push a
   `createShockwave(waveRadius(slam.strength, ...), slam.strength)` at the player's
   feet.
7. `stepEncounter(..., { ..., slam })`.
8. Focus events gain `slamStrength: slam?.strength ?? 0`.
9. Advance and cull the live shockwaves.

Note the bounce is applied to `player` *after* the slam is detected from `before`, and
the encounter is given the slam in the same frame, so the wave lands at the point of
contact rather than a frame later where the bounce has already moved the player.

## 8. Testing

Vitest, colocated `.test.ts` files. The suite must avoid the four failure modes in
`docs/HANDOFF.md`, and every test is to be verified by neutralising the relevant config
value or branch and confirming it goes red.

`pressure-wave.test.ts`:

- `slamStrength` is 0 at `minImpactSpeed`, 1 at `fullImpactSpeed`, 0.5 halfway, and
  clamps beyond both ends.
- `waveRadius` and `waveDamage` interpolate to hand-computed literals.
- A full-strength slam's damage exceeds a spear soldier's full health, and a minimum one
  does not — asserted against `DEFAULT_COMBAT_CONFIG.enemy.maxHealth`, which is the
  claim, not the input.
- `waveTargets` catches an enemy inside the radius and misses one outside it; a
  minimum-strength slam catches strictly fewer than a full one at the same spread.
- `waveTargets` ignores facing — an enemy directly behind the player is caught. This is
  the regression guard against someone reusing the gust's cone test.
- `waveImpulse` points outward, carries an upward component, and grows with strength.

`slam.test.ts`:

- A committed landing above the floor produces a slam; the strength matches
  `slamStrength` for that impact speed.
- Landing without Ctrl produces none.
- Landing below `minImpactSpeed` produces none.
- A frame with no contact produces none, whether airborne throughout or grounded
  throughout.
- **A respawn produces none**, even at enormous fall speed — the regression guard for the
  death-plunge case.
- The impact speed is read from `before`, proven by a fixture whose `after.velocity.y` is
  zero while `before.velocity.y` is a fast descent.
- A rising player is not a slam, even with Ctrl held.
- `applyBounce` sets an upward velocity proportional to the impact, clears `grounded`,
  and resets `airJumpsUsed`; it leaves the horizontal velocity alone.

`focus.test.ts` additions: a slam pays `slamStrength * slamGainAtFullImpact`, scaled by
the ramp; a zero `slamStrength` pays nothing.

`encounter.test.ts` additions: a slam damages an enemy in radius and not one outside it;
a full-strength slam downs a soldier in one hit and is reported in `downedThisFrame`; the
wave's connects appear in `slamHitThisFrame` and **not** in `hitThisFrame`; a null slam
changes nothing.

`shockwave.test.ts`: `advance` reports true while running and false once finished; the
ring grows toward the radius it was given and its opacity falls; `excludeFromShadows` is
set.

## 9. Documentation

- `README.md`: the controls table gains Ctrl's ground-layer meaning, and a paragraph on
  the slam and the dive → wave → re-deploy combo.
- `docs/HANDOFF.md`: move Pressure Wave out of "not built", and add
  `src/combat/config.ts`'s `pressureWave` block to the untested-tuning list.

## Out of scope

- **The Avatar State does not boost the wave.** Its multiplier is a gust multiplier, and
  a second one is tuning better invented with a controller in hand.
- **The wave does not hurt the player**, and hard landings still cost no health, so
  slamming is not a way to avoid damage that does not exist.
- **No auto-deploy on the bounce.** The re-deploy is the player's own Space press; the
  timing is the skill.
- **No apex-height tracking on `PlayerState`.** Impact speed is the measure.
- **The rest of §4.2** — Vortex, Air Wall, Slipstream, staff melee — and the three
  borrowed elements.
