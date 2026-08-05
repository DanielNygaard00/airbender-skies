# Impact feel and encounter lifecycle

Written 2026-08-05.

Two pieces of work that belong in one cycle. The first gives every combat event a body — a
freeze, a shake, a spark, a sound. The second makes a fight repeatable and teaches the Focus
meter the difference between putting a soldier down and losing one over the edge.

## Why

Every attack in the game resolves correctly and almost none of them can be felt.

An audit of the running code found four specific holes:

**A staff connect draws no impact burst.** `main.ts` builds its impact list from
`hitThisFrame` and `slamHitThisFrame` only. `staffHitThisFrame` is passed to Focus and never
to the effect pool, so the newest attack in the game is the only one with no hit spark. A down
still sparks, through the separate `downedThisFrame` loop, which is what hid this.

**Being hit has no feedback at all.** `fight.playerHit` feeds Focus and nothing else. There is
no flash, no shake, no sound. On a character with five health, the player learns they were hit
by noticing a bar has moved.

**Nothing in the game has impact weight.** There is no screen shake, no hitstop, no FOV punch.
`fovForSpeed` reads glider airspeed and nothing else, so on foot the field of view is pinned at
70 degrees through a 26 m/s dash.

**There is no combat audio.** `src/fx/audio.ts` is wind, and it is the only sound in the
project. A gust, a swing, an impact and a hurt are all silent.

Separately, a fight is a one-shot budget. Three soldiers go down, `downed` is permanent, and
combat is over for the session — so every value above is untestable a second time without a
page reload. That is what makes the lifecycle work part of this cycle rather than a later one:
a feel pass that cannot be re-felt is not a feel pass.

And §4.6 is closer than the handoff claims.

> Every enemy has a **downed** state instead of a death state — disarmed, buried to the waist,
> frozen, blown off a ledge into water, tangled in their own equipment.
>
> Enemies removed non-lethally grant more Focus than enemies removed by environmental
> accident, so the generous play is also the strong play.

`docs/HANDOFF.md` records this as blocked on enemies having no fall physics, and says the
missing piece is "paying that removal *more* than an in-place knockdown". Both halves are
wrong now. Enemies got gravity in the Vortex work and `stepEnemy` already downs one that
passes `worldFloorY`. And the payment runs the other way: the doc lists "blown off a ledge
into water" as one of the *non-lethal* downs, so a fall into empty air is the environmental
accident, and it should pay **less** than a gust or a staff sweep. Correcting that handoff
line is part of this work.

## Decisions, all settled

**Hitstop freezes the whole simulation.** Not enemies-only. `update` returns early while
frozen, which is a real freeze rather than a second notion of frozen threaded through the
fight.

**Hitstop fires on heavy events only** — a staff finisher connect, a slam connect, a down.
Never on a gust: a move with a 0.45s cooldown that hitches on every use is nausea, not weight.

**Shake is a render-time offset.** It never enters the simulation and never enters the
camera's own smoothed state.

**Audio is procedural.** No asset files. `createWindAudio` already builds filtered noise from
nothing, and combat voices are built the same way, so nothing new has to be loaded, licensed
or served through `import.meta.env.BASE_URL`.

**A patrol restores when every soldier is down and the player is far away.** Not a
leave-then-return state machine, and not soldiers getting back up — a down has to keep reading
as a removal.

**An environmental accident pays roughly a third of a knockdown.** Not zero. The player did
remove the threat, and Pressure Wave throws 30 m/s of knockback, so a blast that happens to
land near an edge should not silently cost the whole reward.

## Architecture

The split is the same one this codebase already uses everywhere: the rule is a pure function
with a test, and the only untested code is the imperative shell that hands numbers to
three.js or WebAudio.

### `src/fx/hitstop.ts` (new) — the freeze

```ts
export interface HitstopConfig {
  finisherSeconds: number
  downSeconds: number
  /** A minimum-strength slam. Scales up to slamMaxSeconds at full impact. */
  slamMinSeconds: number
  slamMaxSeconds: number
}

export interface HitstopState { remaining: number }

export function noHitstop(): HitstopState
export function isFrozen(state: HitstopState): boolean
/** Longest wins. Two events in one frame must not stack into a stall. */
export function triggerHitstop(state: HitstopState, seconds: number): HitstopState
export function stepHitstop(state: HitstopState, dt: number): HitstopState
```

Longest-wins rather than additive is the whole reason this is a module and not two lines in
`main.ts`. A staff finisher that downs a soldier is two triggers on one frame, and a slam into
three soldiers is four. Summing them would turn a good hit into a visible stall, and the
difference between the two policies is invisible until it happens in play.

`stepHitstop` runs on a frame the rest of the simulation does not, so it cannot live inside
the early return it controls. In `main.ts` the order is: step the hitstop, and if still frozen,
return.

### The freeze point in `main.ts` — the one detail that must not be got wrong

`update` returns **before** `input.sample()`.

`src/core/input.ts` documents `sample()` as "Call exactly once per frame: reading clears the
action edge." A freeze that samples and then discards would eat any press made during it, so a
click landing inside a 60ms hitstop would simply not happen. Returning before the sample leaves
the edge pending in the tracker, and it fires on the first live frame instead. Nothing is lost
and nothing is queued twice.

Rendering is unaffected, because `render` is a separate callback on the stepper. The camera
keeps smoothing and the effect pool keeps drawing at its last state, so a freeze reads as a
hitch rather than a hang.

The accumulator needs no change. `createStepper` decrements it around every `update` call
regardless of what that call does, so an early-returning update cannot bank time and discharge
it on resume — which is the failure this design would otherwise have.

### `src/fx/shake.ts` (new) — the camera kick

```ts
export interface ShakeState {
  remaining: number
  duration: number
  amplitude: number
}

export function noShake(): ShakeState
export function triggerShake(state: ShakeState, amplitude: number, seconds: number): ShakeState
export function stepShake(state: ShakeState, dt: number): ShakeState
/** Offset to add to the camera this frame. Zero once the shake is spent. */
export function shakeOffset(state: ShakeState, out: Vector3): Vector3
```

The offset is trigonometric — a pair of sines at different frequencies against elapsed time,
scaled by amplitude times remaining-over-duration. Deliberately not `Math.random()`: a random
offset cannot be asserted about, and this repo has `src/core/rng.ts` precisely because
unrepeatable randomness has already been a problem here. A decaying sine is testable, and at
60Hz it is indistinguishable from noise.

Strongest wins on trigger, for the same reason hitstop's longest wins.

**Shake is stepped in `syncVisuals` with `frameDt`, and triggered from `update`.** This is the
one piece of state in the project that is written from both callbacks, and it is deliberate:
shake is a render-time offset, so stepping it with real frame time means it decays in
wall-clock seconds and keeps animating *through* a hitstop. A freeze with a shaking camera is
the impact; a freeze with a still camera followed by a shake is two separate events. Stepping
it in `update` instead would produce the latter, because `update` is exactly what the freeze
stops.

### Where shake is applied — `syncVisuals`

```ts
camera.position.copy(cameraPosition).add(shakeOffset(shake, shakeVec))
camera.lookAt(sampledPosition)
```

Two constraints, both load-bearing:

`cameraPosition` is the module-level smoothed state that `smoothTowards` reads and writes every
frame. The shake must be added to the camera's transform and **never** written back into
`cameraPosition`, or the exponential smoothing integrates the shake and the camera drifts away
from the player instead of vibrating around him.

`lookAt` keeps targeting the unshaken `sampledPosition`. Shaking the target as well would
rotate the view around the shake instead of translating it, which reads as the world tilting.

### `src/fx/impact-targets.ts` (new) — who gets a spark

```ts
export interface ImpactLists {
  hits: readonly string[]
  slamHits: readonly string[]
  staffHits: readonly string[]
  downed: readonly string[]
}

export interface ImpactTargets {
  hits: string[]
  downs: string[]
}

export function impactTargets(lists: ImpactLists): ImpactTargets
```

`downs` is the downed list. `hits` is the deduplicated union of the three hit lists **minus**
every id in `downs`.

The staff spark is a one-line fix in `main.ts` — add `staffHitThisFrame` to the union — and
`main.ts` has no tests, so the fix would be unguarded. Extracting the rule makes it testable
and captures the policy that currently lives as a loop and a comment: a down is the louder
statement, so an enemy in both lists gets a down burst and not a hit burst. That policy has
survived three attacks being added to it by hand; the fourth is a good moment to give it a
home.

### `src/fx/combat-audio.ts` (new) — the voices

An imperative WebAudio wrapper shaped exactly like `createWindAudio`: lazy `AudioContext`
built on first use, a `try`/`catch` that warns and continues silently, and a `dispose`.

```ts
export function createCombatAudio(): {
  start(): void
  gust(): void
  swing(finisher: boolean): void
  impact(): void
  down(): void
  hurt(): void
  dispose(): void
}
```

Five voices, all synthesised:

| Voice | Build |
|---|---|
| `gust` | Filtered noise burst, lowpass sweeping down. Air leaving. |
| `swing` | Shorter, brighter noise burst. The finisher is longer and lower. |
| `impact` | Sine dropping in pitch under a fast decay. A thud. |
| `down` | The thud, longer, with a noise tail. |
| `hurt` | Two detuned low sines, so it beats. Unpleasant on purpose. |

`start()` must be called from a user gesture or the browser blocks it, the same constraint
`createWindAudio` already documents and `main.ts` already satisfies for the wind.

The envelope and level maths goes in `src/fx/mapping.ts` beside the existing wind mappings and
is tested there. The graph wiring is untested, exactly as `audio.ts` is — there is no
`AudioContext` in the Vitest node environment, and mocking one would test the mock.

### `src/fx/mapping.ts` (changed) — the dash punch and audio levels

Gains `fovKickForDash(elapsed: number, duration: number): number`, returning a kick in degrees
that decays to zero across the dash. It is **additive** on top of `fovForSpeed`, so the two
compose and a dash on landing does not fight the speed FOV.

On foot the field of view is currently `fovForSpeed(0)`, a constant. That is why a 26 m/s dash
on the ground has no visual weight at all, and it is the cheapest fix in this cycle.

### `src/ui/hud.ts` (changed) — the hurt flash

`HudModel` gains `hurtFlash: number`, a 0-to-1 fraction, run through the existing `fraction`
guard so a non-finite value cannot reach the DOM. `hudModelFor` gains it as an optional
argument, defaulting to 0, so every existing call site and test fixture keeps working.

The overlay is a second element beside the existing `.hud-vignette`, red rather than gold, with
its opacity set from the fraction. No CSS transition on it: the decay is driven from the
simulation, and a transition would fight it.

The decay itself is a pure `stepFlash(value, dt, decayPerSecond)` in the same module, so the
HUD stays a renderer of a model and `main.ts` stays a wiring layer.

### `src/combat/enemy.ts` (changed) — reporting the fall

`EnemyStep` gains one field:

```ts
export interface EnemyStep {
  enemy: Enemy
  damageToPlayer: number
  /** True only on the frame this enemy went down by passing the world floor. */
  fellOutOfWorld: boolean
}
```

`stepEnemy` already has exactly the branch this needs. The below-floor-and-not-yet-downed
branch is the transition, and it reports `true`. Every other return — including the parked
branch for a body already down and already below the floor — reports `false`. That separation
already exists for an unrelated reason (a parked corpse must stop integrating physics), and it
is what stops this flag latching true forever.

### `src/combat/encounter.ts` (changed) — two lists, disjoint

`EncounterStep` gains `lostThisFrame: string[]`, and `downedThisFrame` **excludes** those ids.

This is the important part. `downedThisFrame` is computed by diffing the downed set across the
step, so an enemy that falls out of the world lands in it *and* in `lostThisFrame`. Left alone
it would grant `downGain` and `accidentDownGain` for one event. The codebase has already met
this exact overlap once — `main.ts` drops a connect for an enemy that also went down this frame
— so the pattern is established: compute both, then subtract.

`stepEncounter` also gains the respawn call, described next.

### `src/combat/patrol.ts` (new) — making a fight repeatable

```ts
export interface PatrolConfig {
  /** How far the player must be from every spawn point before a patrol restores. */
  respawnRange: number
}

/** Whether the patrol should be restored to full strength this frame. */
export function shouldRestorePatrol(
  enemies: readonly Enemy[],
  spawns: readonly EnemySpawn[],
  playerPosition: Vector3,
  c: PatrolConfig,
): boolean
```

True when every enemy is downed and the player is beyond `respawnRange` of every spawn point.

Restoring while the player is far away *is* leave-and-return, without a second piece of state
to get wrong. A two-phase machine — arm on leaving, fire on returning — buys nothing here and
adds a flag that can desynchronise from the enemy list.

`respawnRange` is 40, comfortably above `aggroRange`'s 26. That gap is the point: a soldier
must never appear already inside its own notice range, or the player turns around and is
instantly in a fight that spawned on top of them.

An empty spawn list returns false rather than restoring constantly, and a patrol with no
downed enemies returns false — the condition is "every enemy downed", which is vacuously true
for an empty enemy list and must not be.

**Who calls it, and when.** `EncounterDeps` gains `spawns: readonly EnemySpawn[]` and
`patrol: PatrolConfig`, which fits what that interface already is: what the fight needs from
the world, as opposed to what the player did this frame. `Encounter` itself stays ignorant of
its own spawn points — it is a running fight, not a level definition.

The restore happens at the **very end** of `stepEncounter`, after `downedThisFrame` and
`lostThisFrame` are computed. Order matters: `wasDowned` is diffed at the top of the function,
so replacing the enemy array before those lists are built would compare a fresh soldier against
a downed one and report phantom events. Restoring last means the next frame starts from three
healthy enemies and an empty `wasDowned`, which reports nothing.

**One wiring detail in `main.ts`, which is where this would otherwise become a bug.**
`enemyPositionLerps` is keyed by enemy id, and a restored soldier reuses its id. The
interpolator would therefore blend from wherever the body fell to the fresh spawn point,
sliding the view across the map — or up out of the void, for one that fell off the world. The
restore has to reset the interpolator for every restored id. Restoring only happens 40+ units
away so the streak is off-screen, but a lerp climbing out of a bottomless pit is exactly the
kind of thing that shows up later as an unexplained flicker.

### `src/focus/` (changed) — paying for the difference

`FocusConfig` gains `accidentDownGain: 5`, against the existing `downGain: 14`. `FocusEvents`
gains `accidents: number`, alongside the existing `downs`.

Roughly a third. A knockdown is the generous play and pays like it; losing a soldier over the
edge still pays, because the threat is gone and the player caused it, but it is clearly the
worse line. This is the first half of §4.6's scoring rule and the first time the Focus meter
has had an opinion about *how* an enemy was removed.

### Config

`DEFAULT_HITSTOP_CONFIG` and `DEFAULT_SHAKE_CONFIG` go in a new `src/fx/config.ts`.
`src/fx/mapping.ts` is pure functions over a handful of named constants, and dropping tuning
tables into it would blur what that module is for. `PatrolConfig`'s default goes in
`src/combat/config.ts` beside the rest of the fight's tuning, and `accidentDownGain` goes in
`src/focus/config.ts` beside `downGain`.

| Value | Setting | Reasoning |
|---|---|---|
| `hitstop.finisherSeconds` | 0.05 | Three frames at 60Hz. Enough to register, short enough not to read as a stutter. |
| `hitstop.downSeconds` | 0.07 | The loudest event in the fight gets the longest freeze. |
| `hitstop.slamMinSeconds` | 0.04 | A charged-hop slam is a small move and should feel like one. |
| `hitstop.slamMaxSeconds` | 0.09 | A full committed dive. The heaviest thing in the game. |
| `shake` slam | 0.15→0.35 units, 0.25s | Amplitude scales linearly with the slam's own 0-to-1 strength, the same parameter its damage and radius already read, so the dive that downs a soldier outright is also the one that moves the camera. |
| `shake` down | 0.18 units, 0.18s | Present but not disruptive; downs come in threes. |
| `shake` hurt | 0.22 units, 0.2s | Above a down: the player's own damage is the event they most need to notice. |
| `hurtFlash` decay | 4.0 per second | A quarter-second flash. Long enough to catch peripherally, short enough not to obscure the fight. |
| `fovKickForDash` peak | 6 degrees | Against a base of 70, and against `MAX_FOV_KICK`'s existing 14 for full glider speed — a dash should read as a burst, not as flight. |
| `patrol.respawnRange` | 40 | Above `aggroRange`'s 26 by enough that nothing spawns inside its own notice range. |
| `focus.accidentDownGain` | 5 | Roughly a third of `downGain`'s 14, and just below `dodgeGain`'s 8. |

Every one of these is an argued guess, and unlike most of this repo's guesses they are guesses
about *feel*, which no test can check. The deliverable of this cycle is that they are visible
and tunable in one place, not that they are right.

## Testing

Standard for this repo: derive expectations from data, comment the reasoning, and after writing
each test neutralise the feature in config and confirm the test goes red.

Four specific traps, each one a shape that has produced a green-but-decorative test here
before:

**Hitstop's longest-wins needs two triggers.** A single-trigger test passes under an additive
implementation and a longest-wins one identically. The test must trigger 0.05 then 0.03 on one
frame and assert 0.05, and separately trigger 0.03 then 0.05 and assert 0.05 — order-independence
is half the rule.

**The shake offset needs a margin, in both directions.** `expect(offset.length()).toBeGreaterThan(0)`
passes on a millionth of a unit, and this repo's handoff lists bare `>` comparisons as a
repeat offender. Assert a fraction of the amplitude while live, and assert exactly zero once
spent.

**`lostThisFrame` and `downedThisFrame` must be asserted disjoint.** A test that checks only
"a fallen enemy appears in `lostThisFrame`" passes while the double-pay bug is live. The test
walks an enemy off the floor and asserts the id is in one list and *not* the other.

**`accidentDownGain` must be asserted as a literal.** `expect(gain).toBe(c.accidentDownGain)`
passes for any value including `downGain` itself, which is the exact bug this field exists to
prevent.

One more, for the freeze: the input-edge claim is the kind of thing that is easy to assert
vacuously. The test drives two frames of frozen simulation with a press on the first and
asserts the press is still readable after — which fails if `sample()` is called during the
freeze, and cannot pass by accident.

### The fixture breakage, stated up front

Adding a field to a shared struct breaks every hand-built fixture for it, and the file list of
a plan in this repo has failed to predict that eight times. So, explicitly:

- `EnemyStep.fellOutOfWorld` breaks every fixture in `src/combat/enemy.test.ts` and every
  place `encounter.test.ts` builds an enemy step.
- `FocusEvents.accidents` breaks every fixture in `src/focus/focus.test.ts` and
  `src/focus/sources.test.ts`.
- `HudModel.hurtFlash` breaks every fixture in `src/ui/hud.test.ts`, and possibly
  `src/ui/guide/panel.test.ts` if it builds one.
- `EncounterStep.lostThisFrame` breaks any test asserting the whole step object rather than a
  field.

`HudModel.hurtFlash` is the one that can be made non-breaking, by giving `hudModelFor` an
optional argument. The other three cannot: they are outputs, and a fixture that builds one has
to build all of it.

## Out of scope

- **Aiming aids.** The reticle and the pre-fire cone preview are option B, the next cycle.
- **Archers and projectiles.** Option D, after that.
- **A second accident type.** Only the world floor exists today. Water, a crushing prop, or one
  soldier's blast downing another are all §4.6 material and none of them exist to be scored.
- **Non-lethality degradation.** §4.6's "a small number of scripted moments let the player break
  this" needs an act structure, which does not exist.
- **Hitstop on a gust.** Decided against, above.
- **Playtesting the values.** Named as the deliverable's own limitation rather than pretended
  away.
