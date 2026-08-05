# Aiming and stall readability

Written 2026-08-05.

Two things the player currently has to guess: where a gust will go, and why the glider just
stopped flying.

## Why

**The gust cannot be aimed.** It sweeps a 12-unit, 120-degree cone along `player.forward`,
and the only drawing of that cone appears *after* the move fires and lives for 0.22 seconds.
There is no reticle, no target indication, and no way to learn the reach except by throwing
gusts at soldiers and watching which ones stagger.

This is not a hypothetical cost. On foot, `player.forward` was a glider-only field that
`groundStep` carried forward untouched, so the gust fired in whatever direction the player
had last been facing in the air — a shipped combat bug that unit tests could not see and that
was found within minutes of the cone becoming visible at all. The lesson recorded in
`docs/HANDOFF.md` is that drawing the true hit volume is what exposed it. The same reasoning
applies before the shot, not only after it: an attack whose aim is invisible until it resolves
is an attack that cannot be learned.

**A stall has no tell.** `src/player/flight.ts` fades lift below `FlightConfig.stallSpeed`
of 8 via `stallFactor`, so a slow glider sinks. Nothing says so. There is no shudder, no
warning, and turn authority is unchanged, so the player's whole experience of a stall is
altitude draining for no visible reason.

§2.2 of the design document promises otherwise:

> **Stall and recovery.** Climb too steeply and Aang stalls: control softens, the wings
> shudder, and he drops until airspeed returns. Stalling is survivable and readable, not a
> death.

Readable is the half that is missing, and this project already holds itself to that standard
elsewhere: `src/world/wind-tell.ts` exists because the rule is that a wind feature the player
cannot see is a bug. A stall is a wind feature the player is inside.

## Decisions, all settled

**The cone preview appears when a live soldier is inside it,** and not otherwise. It becomes a
"you can hit this now" signal rather than decoration, and the screen stays quiet while
exploring — the same rule the HUD meters already follow, showing only once they have something
to say. While the gust is on cooldown the preview dims rather than vanishing, so it does not
blink off and on every 0.45 seconds.

**Aim is shown in the world, not on the screen.** A screen-centre reticle would be correct on
foot, where `player.forward` *is* the flattened look direction, and a lie in the glider, where
`forward` is the wing's heading and the mouse only trims it. A ground marker along
`player.forward` reads the same field `inGust` tests, so it is honest in both postures and
there is only one idiom to learn.

**The stall tell is a tell only.** No control softening. §2.2 asks for both, but softening
turn authority changes the flight model, and `baseTurnRate` and `weightShiftTurnRate` are
already the two most suspect unplayed values in the project per `docs/HANDOFF.md`. Readability
is this cycle's job; how a stall should *feel* is a decision to make with a mouse in hand.

**No per-enemy target highlight.** With the cone appearing exactly when a live soldier is
inside it, the cone is the highlight. A third channel would be redundant, and body colour is
already spoken for: `enemy-mesh.ts` recolours a soldier during a wind-up and that telegraph is
deliberately the loudest thing on screen. Skipping it also avoids widening `EnemyView.sync`.

## Architecture

Same split as everywhere else in this codebase: the rule is a pure function with a test, and
the only untested code is the imperative shell handing numbers to three.js.

### `src/fx/sector.ts` (new) — one definition of a flat cone sector

`src/fx/gust-cone.ts` builds its sector like this:

```ts
const thetaLength = 2 * c.halfAngle
const thetaStart = -Math.PI / 2 - c.halfAngle
```

with a comment explaining that after the `rotation.x = -Math.PI / 2` that lays the mesh flat,
local `+Z` corresponds to pre-rotation `-Y`, i.e. theta `-PI/2` — and naming
`gust-cone.test.ts` as the authority if the two ever disagree.

The preview needs exactly that sector. Copying those two lines is how the copies drift, and
the offset is subtle enough that a drift would be a silent aiming error rather than an obvious
one. So:

```ts
export const SECTOR_SEGMENTS = 48

/**
 * Theta for a cone sector centred on local +Z after the mesh is laid flat.
 *
 * Exported separately from the geometry because this is the part that can be wrong, and a
 * number is testable where a BufferGeometry is awkward.
 */
export function sectorTheta(halfAngle: number): { thetaStart: number; thetaLength: number }

/** A RingGeometry for the sector. innerRadius 0 gives a filled wedge. */
export function sectorGeometry(
  halfAngle: number, innerRadius: number, outerRadius: number,
): RingGeometry

/** The rotation that lays a sector flat, so no caller has to remember the sign. */
export const SECTOR_FLAT_ROTATION_X = -Math.PI / 2
```

`gust-cone.ts` is refactored to call these. Its existing containment test — which samples
points and compares the drawn sector against `inGust`, a different mechanism from the one the
code uses — stays exactly as it is and remains the cross-check on the whole arrangement. The
new unit tests on `sectorTheta` are additional, not a replacement: a test that only checked
`sectorTheta` against its own formula would be one of this repo's tautologies.

`sectorGeometry` takes a `halfAngle` rather than a `ConeShape` so the staff arc — which also
draws a sector, at a different range — can adopt it later without either module learning about
the other's config type.

### `src/combat/gust.ts` (changed) — a live-target query

```ts
/** Everyone a gust would catch who is still standing. */
export function liveGustTargets(
  origin: Vector3, forward: Vector3, enemies: readonly Enemy[], c: GustConfig,
): Enemy[]
```

`gustTargets` deliberately does not filter downed enemies — `stepEncounter` applies that filter
itself, because "connected" has to mean a live soldier took it rather than a body being blown
around the island. The preview needs the same distinction, and "is a live enemy inside the
cone" is a rule, so it belongs beside the query it wraps rather than as a `.filter()` in
`main.ts`, which has no tests.

Named `liveGustTargets` rather than given a boolean flag, because a flag at the call site reads
as `gustTargets(o, f, e, c, true)` and says nothing.

### `src/fx/aim-tell.ts` (new) — where a gust goes

Persistent, not an `Effect`. It lives as long as the player does, which is not a one-shot. The
shape is `VortexChargeTell`'s, which exists for the same reason and says so:

```ts
export interface AimTell {
  object: Object3D
  /**
   * Call every frame. `targeted` is whether a live soldier is inside the cone, and `ready`
   * whether the gust is off cooldown.
   */
  update(
    position: Vector3, forward: Vector3, targeted: boolean, ready: boolean, c: GustConfig,
  ): void
  dispose(): void
}

export function createAimTell(): AimTell
```

Two children:

- **The marker** — a small flat chevron on the ground a fixed distance along the heading,
  always visible. A chevron rather than a bar or a dot because it carries a direction on its
  own, so it still reads at a shallow camera angle where a bar would foreshorten into a line
  and a dot would say nothing. This is the part that answers "which way am I pointing", and it
  is cheap enough to leave on.
- **The cone preview** — the sector from `sector.ts` at the gust's true `range` and
  `halfAngle`, `visible` only while `targeted`, at a low opacity that drops further while
  `!ready`.

**Aimed from `player.forward`, and parented to the scene rather than to `avatar.object`.**
Parenting to the avatar would inherit the facing for free, but `avatar.object` is rotated in
`syncVisuals` from the *interpolated* `sampledForward`, while `inGust` tests the simulation's
`player.forward`. A tell for a hit volume must read the value the hit reads, with nothing in
between. This is a deliberate difference from the enemy health bars, which do billboard
against an interpolated camera and are documented as such.

Opacity is below `gust-cone.ts`'s `FILL_OPACITY` of 0.34: a persistent indicator that is as
loud as the fired effect would swamp it, and the fired cone is the louder statement.
`depthTest: false` and `excludeFromShadows`, matching every other attack tell in `src/fx/`.

### `src/player/stall.ts` (new) — how badly the wing has stopped working

```ts
/**
 * 0 when the wing is flying, ramping to 1 at rest. Zero on foot, whatever the speed.
 *
 * Takes the whole state rather than a bare speed so the posture gate lives here, in a tested
 * module, rather than at the two call sites that need it.
 */
export function stallSeverity(state: PlayerState, c: FlightConfig): number
```

The value is `1 - stallFactor`, where `stallFactor` is exactly what `flightStep` computes:
`speed < c.stallSpeed ? speed / c.stallSpeed : 1`. So severity is `1 - speed / stallSpeed`
below stall speed and `0` at or above it, clamped, and `0` in any posture but `glider`. Being
the arithmetic mirror of the integrator's own factor is the point — the tell cannot say
"stalling" while the flight model is still making full lift, which a second differently-shaped
opinion about the threshold would eventually do.

Its own module rather than an export from `flight.ts`, because `flight.ts` is the integrator and
this is a presentation query over the same threshold. Nothing in the flight model imports it.

### `src/ui/hud.ts` (changed) — the airspeed reddens

`HudModel` gains `stall: number`, and `hudModelFor` takes it as a fifth optional argument
defaulting to 0, run through the existing `fraction` guard — the same shape `hurtFlash` took last
cycle, and for the same reason: `hud.ts` has no business importing a `FlightConfig`. The airspeed
readout interpolates toward a warning colour as the value rises.

**The one trap here, and why the gate is in `stall.ts` rather than in the HUD.**
`formatAirspeed` shows `velocity.length()` in *both* postures, and on foot that is 7 to 13 —
well under `stallSpeed`'s 8 at an ordinary walk. A severity computed from speed alone would
paint the airspeed red while the player strolls around the island.

The gate could live in `hudModelFor`, which does have the `PlayerState`. It does not, because
the glider's wing shudder needs the same number and would then either duplicate the gate or
take an ungated one. One rule, one home: `stallSeverity` takes the state, applies the posture
gate itself, and both consumers receive a value that is already correct. There must be a test
that walking on the ground at a stall-speed pace reports zero.

### `src/player/glider.ts` (changed) — the wings shudder

`update(dt, deployed, swing, stall)` — a fourth required argument, matching how `swing` was
added.

The shudder composes **inside** `glider.ts`'s own `apply()`, for the reason the staff sweep had
to: that function rewrites the wing and staff transforms every frame from `openness`, and
anything set from outside is overwritten on the next frame. It is a small oscillation on the
panel angles, scaled by severity.

**Its gate is the opposite of the sweep's, and the two must not be confused.** The staff sweep
applies while the glider is *stowed* — `openness` below `1e-3` — because that is when the staff
is a weapon. The shudder applies while the glider is *open*, so the condition is `openness`
above that threshold. A stowed walking stick must not vibrate because the player happens to be
walking slowly.

Deterministic, from an accumulated time, not `Math.random()` — for the same reason
`src/fx/shake.ts` is trigonometric: a random shudder cannot be asserted about.

### `src/main.ts` (changed) — wiring

`createAimTell()` added to the scene, updated each frame with `player.position`,
`player.forward`, `liveGustTargets(...).length > 0`, `canGust(encounter)` and `fightConfig.gust`
— the boosted config, so the preview and the fired cone read one source and cannot diverge if
a future Avatar State change ever touches the gust's range or half angle. (Today it does not:
`boostedCombatConfig` only scales the gust's damage, knockback and cooldown — range and half
angle pass through unchanged, so the preview and the cone are both drawn at the base 12-unit,
60-degree volume whether or not the state is active.) `stallSeverity` feeds both `hudModelFor`
and `glider.update`.

### Config

| Value | Setting | Reasoning |
|---|---|---|
| `aimTell` marker distance | 3 units along the heading | Ahead of the avatar's own footprint, well inside the gust's 12, so it reads as "pointing" rather than as a range indicator. |
| `aimTell` preview opacity | 0.14 | Under half of `gust-cone.ts`'s 0.34 fill: present, and quieter than the move it previews. |
| `aimTell` dimmed factor | 0.4 | Applied while the gust is on cooldown. Visible enough to keep the shape stable, dim enough to read as unavailable. |
| Shudder amplitude | 0.09 radians at full severity | Roughly an eighth of `FAN_SPREAD`'s 78 degrees per panel — a flutter, not a flap. |
| Shudder frequency | 34 radians/second | About 5.4 cycles a second: fast enough to read as a shudder rather than a wobble. |
| Airspeed warning colour | `#ff8f6b` | Already the health bar's warm tint in `hud.ts`, so the HUD does not gain a new colour vocabulary. |

Every one of these is a guess about feel, and none of it has been played. As with the last
cycle, the deliverable is that they are named and tunable in one place.

## Testing

Standard for this repo: derive expectations from data, comment the reasoning, and after
writing each test neutralise the feature and confirm the test goes red.

Specific traps for this work:

**`sectorTheta` must not be tested against its own formula.** Restating `-PI/2 - halfAngle` in
the test proves nothing. Test the property that matters instead: that the sector's angular
span, once laid flat, is centred on `+Z` — by sampling directions and comparing membership
against `inCone`, which is a different mechanism. `gust-cone.test.ts` already does exactly this
for the fired cone and is the model to follow.

**The stall tell needs a walking control.** A test that only checks "slow glider reports
stall" passes while the airspeed is also red on foot. The test asserts both: gliding below
stall speed reports severity, and walking at the same speed reports zero.

**`stallSeverity` must agree with the flight model at the boundary.** Assert severity is
exactly 0 at `stallSpeed` and above it, not merely small — an off-by-epsilon here means the
warning flickers at cruise.

**The preview's visibility needs both directions and a downed case.** Visible with a live
soldier inside; hidden with the same soldier downed; hidden with a live soldier outside the
cone. The downed case is the one that distinguishes `liveGustTargets` from `gustTargets`, and
without it the new query is untested.

**A bare `>` will not do for the dim.** Assert the dimmed opacity is a real fraction of the
ready opacity, with a margin.

### Struct widening

Checked rather than assumed, as the last cycle's plan learned to do:

- `HudModel.stall` is an output. No test builds a `HudModel` literal — `hud.test.ts` calls
  `hudModelFor` throughout — so widening it breaks nothing, and `hudModelFor` takes the new
  input from `PlayerState`, which it already has.
- `glider.update`'s fourth argument is required, so **every existing call breaks — four calls
  across three files**: `src/main.ts:423`, `src/player/glider-mesh.test.ts:17` and `:147`, and
  `src/player/avatar.test.ts:389`. The last of those was missed on a first pass and found only
  by grepping for callers while planning, which is why the plan enumerates them by line rather
  than by file. Requiring the argument is deliberate — an optional one would let a future
  caller silently lose the tell — and it is the same trade the `swing` argument made.
- `liveGustTargets` and everything in `sector.ts` and `stall.ts` are additive.

## Out of scope

- **Control softening on a stall.** §2.2 asks for it; decided against above.
- **A staff arc preview.** `sector.ts` is shaped so this is a later one-liner, but the staff is
  a 3.6-unit reach on a 0.26-second swing and does not have the gust's aiming problem.
- **A Vortex preview.** Already exists — `createVortexChargeTell`.
- **A per-enemy highlight.** Cut, with reasoning above.
- **Archers and projectiles.** Option D, the next cycle.
- **Playtesting these values.** Named as this cycle's own limitation rather than pretended
  away.
