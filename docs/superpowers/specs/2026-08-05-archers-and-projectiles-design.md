# Archers and projectiles

Written 2026-08-05.

The second enemy type, and the first thing in this game that travels through the air with intent.

## Why

§4.4 gives every enemy type one axis of Aang's movement to pressure. One type exists:

> | Spear infantry | Ground spacing. Punishes standing still. |
> | Archers / fire ranged | **Altitude. Makes hovering expensive.** |

Altitude is the axis this entire game is about. The flight model, the Breath meter, the hover, the
thermals and ridge lift — all of it exists to make height a resource, and nothing currently
contests it. Measured consequence, from the code as it stands: infantry has `aggroRange: 26`,
closes only horizontally, and `stepEnemy` is explicit that "it is infantry, it does not chase
into the sky". So **climbing is a win condition.** Get above 26 units and the fight is over.

That single fact undermines three systems that already exist and are already tested:

- **The Slipstream's invulnerable window** is 0.11s inside a 0.55s telegraph, tuned to beat "an
  attack you can see coming". The only attack in the game is a spear thrust from a soldier
  slower than a walk.
- **The hover** is the most expensive thing Breath can buy, and nothing makes holding station
  worth paying for.
- **The staff's no-glider gate** is the design document's "central risk decision". It costs
  nothing today, because on the ground against slow infantry there is no reason to want the
  wing.

Archers fix all three by existing. They also unblock two things recorded as blocked in
`docs/HANDOFF.md`: Air Wall, whose function is deflecting projectiles, and §4.5's
redirected-projectile Focus source. Both are the *next* cycle, not this one.

## The blocker this cycle actually clears

The combat model has no notion of an enemy kind. There is no `kind` field on `Enemy`,
`EnemyConfig` is a single struct, `createEnemyView()` takes no arguments and hardcodes a spear,
and `stepEnemy` *is* the spear AI. `c.enemy` is threaded through four places in `encounter.ts`.

So "add archers" is really "teach the fight that types exist". That is the load-bearing part of
this cycle, and it is what makes the remaining four types in §4.4 additions rather than
rewrites.

## Decisions, all settled

**One state machine, and the config says what a release produces.** Not a discriminated union
with per-kind step functions. The spear's thrust and the archer's shot are the same four beats —
advance, wind up, release, recover — already implemented in `stepEnemy`. They differ in reach and
in what the release *does*. A union would be the right answer if the six types diverged sharply,
but four of them do not exist yet, so it would be a large refactor of the combat core built on a
guess.

**Arrows travel in straight lines.** No gravity. Easier to read as a threat, easier to test, and
it removes any need for an archer to lead a moving target. Drop is a later config addition if it
feels flat, not a redesign.

**Arrows collide with the player and with terrain height.** The `groundHeightAt` query
`stepEnemy` already takes is enough. Not a full terrain raycast — `TerrainQuery` exposes only
`groundHeightAt` and `raycastDown`, so lateral raycasting is the API change wall-riding has been
blocked on for two cycles and it would swallow this one. Not player-only either: an arrow
sliding through a hillside is the same class of defect as the gust cone being buried by slopes,
which this project has already fixed once.

**Archers mix into the home patrol.** §4.4: "Encounters are built as *combinations* of these."
Mixing creates the bind immediately — close the distance and the spears punish you, hold back or
climb and the archers do. A separate archer-only island teaches each type alone and never
produces the combination.

**No Air Wall, and no narrowing of the glider kit.** D2 and D3. Air Wall is the tempting one,
since it is the reason projectiles are interesting, but it doubles this cycle and it wants
archers played first — there is no way to know what deflection should feel like before anything
shoots.

## Architecture

The same split as everywhere else here: the rule is a pure function with a test, and the only
untested code is the imperative shell handing numbers to three.js.

### `src/combat/enemy.ts` (changed) — the attack becomes a description

```ts
export type EnemyKind = 'spear' | 'archer'

export type EnemyAttack =
  | { kind: 'melee'; damage: number }
  | { kind: 'projectile'; damage: number; speed: number }
```

`EnemyConfig`'s `strikeDamage: number` is **replaced** by `attack: EnemyAttack`, so damage lives
in one place per attack rather than being split between the enemy and the arrow it fires.
`Enemy` gains `kind: EnemyKind`, so the caller can pick the right config.

`EnemyStep` gains one field:

```ts
/**
 * A shot loosed this frame, or null. The fight turns this into a live projectile.
 *
 * Reported rather than resolved here for the same reason `damageToPlayer` is: `stepEnemy`
 * advances one enemy and knows nothing about the projectile list, the player's health, or
 * what else happened this frame.
 */
firedProjectile: { origin: Vector3; direction: Vector3 } | null
```

The existing release branch — currently `if (distance <= c.strikeRange) damageToPlayer =
c.strikeDamage` at `enemy.ts:266` — becomes: a melee attack deals its damage if the player is
still in reach, and a projectile attack reports a shot. `damageToPlayer` stays 0 for an archer;
the arrow does the damage later, which is the whole point.

**The one genuinely divergent branch: how reach is measured.**

`stepEnemy` uses `horizontalDistance` for both noticing and committing, because infantry "does
not chase into the sky". An archer measured that way would read a player hovering 40 units
directly overhead as at distance zero — permanently in range, and unable to be escaped by
climbing, which is backwards.

So a **projectile attacker measures both its notice and its commit in 3D**. That difference *is*
the type. A spear cannot reach up; an arrow can. Without it, archers do not pressure altitude at
all and the cycle delivers nothing.

The shot's `direction` is likewise the full 3D vector to the player, not flattened.

**`facing` stays horizontal, and must not be made 3D.** `Enemy.facing` drives the rig's yaw in
`enemy-mesh.ts` via `Math.atan2(facing.x, facing.z)`, which reads only x and z. Making it a 3D
vector to match the shot direction would silently change nothing about the mesh while breaking
the invariant every existing test relies on. The archer's *aim* is 3D; its *facing* is the
horizontal heading, exactly as the spear's is. Two different things that happen to point the
same way on flat ground.

**`firedProjectile` carries only origin and direction.** Speed and damage come from the config
the fight already has in hand — putting them on the report would mean `stepEnemy` deciding them
twice over, once here and once in the config it was passed.

### `src/combat/projectile.ts` (new) — the thing that flies

```ts
export interface Projectile {
  id: string
  position: Vector3
  velocity: Vector3
  damage: number
  /** Seconds alive, so a stray arrow cannot outlive the encounter. */
  age: number
}

export interface ProjectileConfig {
  /** How close to the player's centre counts as a hit. */
  hitRadius: number
  maxSeconds: number
}

export interface ProjectileStep {
  /** null once it is gone — it hit, reached the ground, or expired. */
  projectile: Projectile | null
  damageToPlayer: number
}

export function spawnProjectile(
  id: string, origin: Vector3, direction: Vector3, damage: number, speed: number,
): Projectile

export function stepProjectile(
  p: Projectile, playerPosition: Vector3, ground: GroundHeightQuery, dt: number,
  c: ProjectileConfig,
): ProjectileStep
```

Three ways to end, and the order matters: the player hit is tested **before** the ground, so an
arrow that would strike a player standing at ground level is not swallowed by the terrain test on
the same frame.

`GroundHeightQuery` is reused from `enemy.ts` — the same deliberately narrow interface, and for
the same reason: a projectile has no use for `raycastDown`.

### `src/combat/encounter.ts` (changed) — the fight owns the arrows

`Encounter` gains:

```ts
projectiles: Projectile[]
/** A counter, so ids are deterministic and unique without Math.random(). */
nextProjectileId: number
```

`CombatConfig.enemy: EnemyConfig` becomes `enemies: Record<EnemyKind, EnemyConfig>`, and
`CombatConfig` gains `projectile: ProjectileConfig`. `EnemySpawn` gains `kind: EnemyKind`.

`stepEncounter` does three new things, all inside the existing enemy loop or beside it: it picks
each enemy's config by kind, it collects `firedProjectile` into new projectiles, and it steps the
existing projectiles and sums their damage into the **same** `damageToPlayer` total the spears
already feed.

That last point is free leverage worth stating plainly. Player damage already routes through
`playerInvulnerable`, so **a Slipstream dodges an arrow with no new code**, and `damageAvoided`
already grants Focus. §4.2's "beats an attack you can see coming" finally has something to beat.

`EncounterStep` gains `firedThisFrame: string[]` — the **projectile** ids loosed this frame, not
the archers' ids, so the effects layer can make a bow release audible without re-deriving it.

**Ordering constraint.** Arrows must be stepped *before* new ones are spawned, or an arrow fires
and advances on the same frame, appearing already a few metres out. The gust/vortex/staff/wave
ordering comment at the top of `stepEncounter` already establishes that this function's order is
load-bearing; this joins it.

**Interaction with the patrol restore.** The restore at the end of `stepEncounter` replaces the
enemy array when everyone is down and the player is far away. Arrows in flight at that moment
belong to a fight that is over, and the player is by definition beyond `respawnRange` 40 — so
the restore also clears `projectiles`. Leaving them would let an arrow loosed before the reset
strike a player who has walked back to a fresh patrol.

### `src/combat/enemy-mesh.ts` (changed) — an archer holds a bow

`createEnemyView(kind: EnemyKind)`. An archer gets a bow rather than a spear; the existing
wind-up recolour already telegraphs a draw, so no new tell mechanism is needed.

`enemy-mesh.test.ts` finds nodes by the name `spear`, so **the spear path must stay
byte-compatible** — the archer's prop is a new node named `bow`, and the spear keeps its name
and geometry.

### `src/fx/arrow.ts` (new) — the arrow you can see

A persistent per-projectile view, the `VortexChargeTell` shape rather than the one-shot `Effect`
shape, because an arrow lives as long as its flight: `{ object, update(projectile), dispose() }`.

An unseen thing that damages you is the specific defect this project has now fixed twice — the
gust cone buried by terrain, and the staff connect with no spark. An arrow is the most
dangerous invisible object the game could have.

Drawn with `depthTest: true`, unlike the attack tells in `src/fx/`: an arrow behind a hill is
information the player should not have, which is the same reasoning already recorded for enemy
health bars.

### `src/fx/combat-audio.ts` (changed) — the release is the telegraph

One new voice, `bowRelease()`. The player being hit is already audible through `hurt()`, so the
addition worth making is the sound of the shot being loosed — that release *is* the telegraph,
and an archer behind the player is otherwise silent until damage lands.

Its level goes in `mapping.ts`'s `COMBAT_LEVELS` with the others, which is where the mix is
testable.

### `src/main.ts` (changed) — wiring

Per-projectile views keyed by id in a `Map`, created on first sight and disposed when the
projectile is gone, mirroring how `enemyViews` and `enemyPositionLerps` already work. `bowRelease()`
fires for each id in `firedThisFrame`.

Projectile views read the simulation position directly rather than being interpolated. Arrows
are fast and short-lived, an interpolator would need creating and disposing per arrow, and the
render-interpolation work exists to smooth a *camera-followed* character rather than every
moving object.

### Config

| Value | Setting | Reasoning |
|---|---|---|
| archer `maxHealth` | 1.2 | Under the spear's 1.5. Ranged, fragile, and a single staff opener at 0.7 plus anything finishes one. |
| archer `moveSpeed` | 3.4 | Slower than the spear's 4.2. It wants distance, not contact. |
| archer `aggroRange` | 48 | Nearly double the spear's 26, measured in 3D. Climbing out of a spear fight now puts you inside an archer's. |
| archer `strikeRange` | 40 | Its firing range. Below `aggroRange` so it closes before shooting rather than opening fire the instant it notices. |
| archer `windUpSeconds` | 0.8 | Longer than the spear's 0.55: a draw is slower than a thrust, and it is the dodge window. |
| archer `recoverSeconds` | 1.1 | Longer than the spear's 0.7. The gap between shots is the opening to close distance or break line. |
| archer attack | `{ projectile, damage: 1, speed: 34 }` | Same damage as a spear thrust. 34 units/sec crosses its 40-unit range in about 1.2s — fast enough to threaten, slow enough to see. |
| `projectile.hitRadius` | 0.9 | Roughly half the character's 1.8 height. Generous enough not to feel arbitrary, tight enough that moving works. |
| `projectile.maxSeconds` | 4 | Past its own range at 34 units/sec, so lifetime is a backstop rather than a mechanic. |
| `HOME_PATROL` | 3 spears + 2 archers | The archers sit further back than the spears, so the group has a shape rather than a blob. |

Every one of these is an argued guess. Unlike most of this project's guesses they are guesses
about *pressure* rather than feel, which means an hour of play will move them a long way.

## Testing

Standard for this repo: derive expectations from data, comment the reasoning, and after writing
each test neutralise the feature and confirm it goes red.

Specific traps for this work:

**The 3D-versus-horizontal reach difference needs a test that could only pass one way.** The
fixture is a player directly overhead: horizontal distance 0, true distance 40. An archer whose
test config has a `strikeRange` of 30 must **not** fire at them — under the old horizontal
measurement it would, because horizontal distance 0 is inside any range. And a spear with
`strikeRange` 3.2 must still thrust at a player 2 units away and 20 units up, because that is
the existing horizontal-only behaviour and this cycle must not change it. Both directions, or
the test proves nothing.

Note the 30 there is a **test** value, deliberately distinct from the shipped 40 in the config
table below — asserting against the same number the code reads is the first of the four failure
shapes `docs/HANDOFF.md` names.

**A projectile fixture must actually reach what it claims to reach.** Three fixtures in the last
two cycles asserted events that never occurred — a brink 0.1 m above a floor needing 18 frames
to cross, a void floor needing 19, and a two-spawn patrol where `every` and `some` were
indistinguishable. Do the arithmetic: at `speed` 34 and `dt` 1/60, an arrow moves 0.567 units a
frame, so a target 5 units away is 9 frames out, not one.

**The hit-before-ground order needs the case that distinguishes them.** A player standing at
ground level with an arrow arriving at their feet: player-first reports damage, ground-first
reports nothing. A test with the player in mid-air cannot tell the two apart.

**The restore must clear the projectiles, and a test must fail if it does not.** Fire an arrow,
down every enemy, move beyond `respawnRange`, step once, and assert `projectiles` is empty.

**Do not assert an arrow's damage against `c.attack.damage`.** That passes for any value. Use a
literal, and give the test config a value distinct from the shipped one.

### Struct widening — checked, not assumed

`strikeDamage` → `attack` breaks every `EnemyConfig` literal. Verified by grep, five sites:

- `src/combat/config.ts:29`
- `src/combat/enemy.test.ts:12`
- `src/combat/encounter.test.ts:15`
- `src/combat/patrol.test.ts:13`
- `src/combat/gust.test.ts:13`

Plus the definition at `enemy.ts:66` and its single use at `enemy.ts:266`.

`Enemy.kind` breaks any hand-built `Enemy` literal; `spawnEnemy` covers most fixtures but not
all. `EnemySpawn.kind` breaks the spawn arrays in `patrol.test.ts` and `encounter.test.ts`.
`CombatConfig.enemy` → `enemies` breaks every `CombatConfig` literal. `EncounterStep` and
`Encounter` widenings are outputs and break nothing.

The plan will list these by line, and the implementer will be told to re-grep rather than trust
the list — a file list of mine has been wrong nine times across the last two cycles, most
recently missing 12 of 15 `glider.update` call sites.

## Out of scope

- **Air Wall.** D2, and the reason projectiles are worth having. Deliberately deferred so it can
  be designed against archers that have been played.
- **§4.5's redirected-projectile Focus source.** Needs Air Wall.
- **Narrowing the kit in the glider (§4.3).** D3.
- **Arrow drop under gravity.** Straight lines first; drop is a config addition later.
- **Terrain raycasting.** Still the blocker for wall-riding, still its own piece of work.
- **The remaining four enemy types.** This cycle makes them additions rather than rewrites,
  which is most of its value.
- **Playtesting the values.** Named as this cycle's own limitation rather than pretended away.
