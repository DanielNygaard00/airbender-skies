# Heavy armoured infantry and net throwers — design note

**Date:** 2026-08-11
**Authority:** `docs/design/aang-playable-character.md`, sections 4.4 and 4.6.
**Scope:** two new `EnemyKind`s, the two pattern widenings they needed, their feedback, and their
placement in the home patrol.

Section 4.4 is an explicit contract: every enemy exists to pressure a specific axis of Aang's
movement. Two of its rows had no implementation:

| Enemy type | Pressures |
|---|---|
| Heavy armored | Knockback economy. Immune to gusts, must be broken with earth or the environment. |
| Nets and chains | Flight itself. Grounds Aang, forcing a fight in his weaker posture. |

Both are now built. Neither needed a new state machine, which is the argument for adding them as
kinds rather than as something larger: a heavy soldier advances, winds up and swings exactly like a
spear, and a net thrower has the archer's four beats. What is new about each lives in data.

## Two pattern widenings, and why each is where it is

The spear and the archer had already established the shape: one `EnemyConfig` per kind in a Record
keyed by `EnemyKind`, one shared `stepEnemy` state machine, and an `EnemyAttack` union saying what
a release produces. Each new type needed exactly one thing that shape could not express.

### Armour, as a per-source pair of fractions

`EnemyConfig` gains `armour: Record<BendingSource, { damage: number; knockback: number }>`, where
`BendingSource` is `'gust' | 'vortex' | 'wave' | 'staff'`.

The alternative was a `kind === 'heavy'` test inside the gust resolver, and it was rejected because
"immune to gusts" is a statement about one enemy type rather than about the gust. Written as a
branch, the next armoured type is a second branch in the same place, and the resolver for one of
the player's four moves ends up knowing the roster. Written as config, the fight does not know
armour exists: `resolveBlow` looks the table up, and the three unarmoured kinds take `UNARMOURED`,
which is all ones.

Two numbers rather than one, because damage and displacement are separate currencies here and the
heavy is the type that proves it. Section 4.4's phrase is *knockback economy*, which only means
something if a move can be allowed to hurt without moving, or to move without hurting.

The armour is applied by `throughArmour` in `enemy.ts`, *outside* `hitEnemy` rather than inside it.
`hitEnemy` means "take this blow, whatever it turned out to be" — it advances the recovery ladder
off the damage figure it is handed, so it has to be handed the final number. Folding armour into it
would have given it a fourth parameter that twenty existing call sites do not pass, and a defaulted
fourth parameter is precisely how a resolver ends up silently ignoring armour.

**A related consolidation came with it, and it was not optional.** `stepEncounter` had four
near-identical `enemies.map` blocks, one per move, each asking `isTargetable` for itself. They had
already drifted once — three read their connect list before the hits landed and the vortex reported
nothing at all — and armour gave each of them a second thing to get right. They are now one
`resolveBlow`, with `damage` and `impulse` as per-target callbacks so the vortex's charge and the
staff's swing index stay in the caller's closure. The brief's requirement that `isTargetable` stay
uniform across resolvers is now true by construction rather than by four people remembering.

### A payload on the projectile, not a third union arm

`EnemyAttack`'s `projectile` arm gains a required `tangleSeconds: number`, and `Projectile` carries
it through flight.

A third `net` arm was the obvious move and it is the wrong one. A net *is* a projectile in every way
the model cares about: loosed at the end of a wind-up, flying in a straight line, measured in 3D,
ending on the player or on the ground. Only the arrival differs, so the payload is what gains a
field. A `net` arm would have forced `stepEnemy`'s `ranged` test, `stepEncounter`'s spawn branch and
`off-screen.ts`'s melee gate each to grow a second case for a type that behaves identically in all
three.

Required rather than optional, on both `EnemyAttack` and `spawnProjectile`. A default of 0 would
compile at the one production call site that matters and make every net in the game inert with
nothing anywhere to notice.

## Heavy armoured infantry

```
maxHealth 4          outOfCombatSeconds 6   regenPerSecond 0
moveSpeed 2.6        strikeRange 3.6        aggroRange 20
windUpSeconds 0.95   recoverSeconds 1.3     attack melee, damage 2
knockbackDamping 2.6 gravity 20             snapDistance 1.2
downedSeconds 18     risingSeconds 1.8      recoveryHealthFractions [0.6, 0.3]
armour  gust   0 damage / 0 knockback
        vortex 1 damage / 0.45 knockback
        wave   1 damage / 1 knockback
        staff  0.35 damage / 0.3 knockback
```

What each number is anchored to:

- **maxHealth 4** — anchored to the Pressure Wave, not chosen in the abstract. A full slam does
  2.2, so two committed dives put one down, and the ladder asks for two more and then one: five
  real dives for a permanent down. Two and a bit times the spear's 1.5.
- **moveSpeed 2.6** — the slowest thing in the game, under the spear's 4.2 and the archer's 3.4.
  Armour is heavy, and walking away from this one always works. That is the point of a wall.
- **strikeRange 3.6** — a little past the spear's 3.2: a longer, heavier weapon swung with both
  arms. Still under the staff opener's 3.6 reach, so the player can trade at the edge.
- **aggroRange 20** — the *shortest* notice range in the game, deliberately below the spear's 26. A
  leash is a promise to pursue and at 2.6 m/s this one cannot keep it; noticing at 26 would mean a
  heavy trudging after a player for twenty seconds and never arriving, which reads as a broken
  enemy rather than a slow one. Short enough that it holds a piece of ground instead of chasing.
- **windUpSeconds 0.95** — nearly double the spear's 0.55. At 2 damage the dodge has to be
  genuinely available, so this is the most generous melee telegraph in the game.
- **recoverSeconds 1.3** — nearly double the spear's 0.7. The punish window is where the staff
  route lives.
- **attack damage 2** — twice a spear thrust, so two connects and a bit take the player's whole
  5-point bar. The trade for being unable to chase: standing next to one is the mistake.
- **risingSeconds 1.8** — half again the spear's 1.2. More to lift, and the extra window is worth
  having on the enemy the player most wants to hit again before it is up.
- **recoveryHealthFractions [0.6, 0.3]** — the shared ladder, unchanged. Against maxHealth 4 the
  rungs are 4, then 2.4, then 1.2, which is the same "three, then two, then one" curve the spear's
  numbers produce, in the currency this type is paid in.

### The armour rows, each argued

- **gust 0 / 0.** Section 4.4's word is "immune", so it is zero rather than a large reduction. A
  gust is a sweep of moving air and a soldier in plate with its weight behind a shield does not move
  and does not care. `deflects` reports the pairing so the feedback layer can say something.
- **wave 1 / 1.** A Pressure Wave is a shock travelling through the ground rather than air pushed at
  a body, and it is the move section 4.2 ties to the traversal layer. So the heavy is the enemy that
  only *earned* knockback moves, which is what makes this a knockback economy rather than a
  knockback immunity — and it is the only reason the type is beatable in the current kit at all.
- **vortex 1 / 0.45.** Reduced, not removed. Full charge gives 18 pull and 11 lift, so 8.1 and 4.95
  get through: about half a second off the ground (inert, per `stepEnemy`'s airborne branch) and
  roughly three metres of drift toward the player. Enough to drag a heavy toward a rim from a hover
  beyond it, nowhere near enough to juggle one. **Zeroing it was the first draft and it made the
  type unbeatable**, because the vortex is the only move that can move a body the player is not
  standing next to. `damage` is 1 and moot — the vortex carries no damage by design, and writing 0
  would have made `deflects` report every vortex on every soldier as turned away.
- **staff 0.35 / 0.3.** A wooden staff against plate. An opener does 0.245 and a finisher 0.42, so a
  full three-swing combo is 0.91 against 4 health and grinding one down takes roughly eight combos
  per rung. Deliberately bad rather than absent, so a player with no altitude left to spend is not
  stuck.

### Is it actually beatable, and by which route

**Yes, by two routes, both tested rather than asserted.**

1. **The environment, which is the intended answer.** A full-strength Pressure Wave thrown from
   between a heavy and the island's rim puts it over the edge; it falls past `worldFloorY` and is
   downed with `fellOutOfWorld` set. `heavy-environment.test.ts` plays this at the real home island:
   the shove available is `maxKnockback / knockbackDamping = 30 / 2.6 ≈ 11.5 m`, the walkable ground
   on the 300-degree bearing stops at radius 58.5, and a heavy at radius 50 needs 8.5 m of that
   11.5. Both controls are in the file — the same slam 20 units further inboard leaves it standing,
   and twenty seconds of gusting from the same stance does not move it while the same gusts *do* put
   an unarmoured spear over the same edge.
2. **Repeated slams, which is slow but real.** `encounter.test.ts` walks one all the way off the
   recovery ladder with full slams alone, following the body between dives — a full slam shoves its
   target about 11.5 m against the wave's own 11 m radius, so a player has to walk to it, which is
   what a player diving on a heavy does anyway.

The staff is a third route and is deliberately the wrong one. The gust is not a route at all.

## Net throwers

```
maxHealth 1          outOfCombatSeconds 6   regenPerSecond 0
moveSpeed 3.8        strikeRange 22         aggroRange 30
windUpSeconds 1.0    recoverSeconds 1.6
attack projectile, damage 0.5, speed 22, tangleSeconds 2
knockbackDamping 2.6 gravity 20             snapDistance 1.2
downedSeconds 18     risingSeconds 1.2      recoveryHealthFractions [0.6, 0.3]
armour  UNARMOURED
```

Every figure is bought from the archer's, in the direction that makes a net readable rather than
oppressive. Being grounded is the worst thing in the game that is not damage, so each number leans
toward "the player could have seen that coming".

- **maxHealth 1** — the most fragile of the four, under the archer's 1.2. Its job is done the instant
  one net lands, so it has no business also being durable, and the long recovery below rewards a
  player who reads the gap and closes.
- **moveSpeed 3.8** — between the archer's 3.4 and the spear's 4.2. It wants to stay in throwing
  range of a player trying to leave it, which needs more than the archer's walk.
- **strikeRange 22** — the load-bearing number of the type, and a third under the archer's 30. A net
  is heavy and thrown by hand, and it has to be escapable by *moving up*: at 22 a climbing player is
  out of a netter's reach long before an archer's, so the two ranged types pressure altitude in
  opposite directions — the archer punishes hovering low, the netter punishes flying close.
- **aggroRange 30** — eight above `strikeRange`, the same closing band the archer uses and for the
  same reason: a patrol member must not open fire the instant it notices. At 3.8 m/s that band is
  about 2.1 seconds of walking, and that is the warning the player gets. Comfortably below the
  archer's 38, which is what kept `respawnRange` where it was.
- **windUpSeconds 1.0** — the longest telegraph in the game, past the archer's 0.8. An arrow costs a
  fifth of the player's health; a net costs the entire air layer for two seconds.
- **recoverSeconds 1.6** — the longest recovery too, past the archer's 1.1. A thrown net has to be
  gathered back up, and that gap is the answer to a netter: close during it rather than trading at
  range.
- **attack speed 22** — well under the arrow's 34. A net is heavy and it tumbles; crossing the full
  22-unit throwing range takes a whole second, which is a real chance to leave the lane after the
  net is already in the air.
- **attack damage 0.5** — one gust's worth. The cost of a net is the two seconds on the ground, and
  stacking real damage on top would let one connect decide a fight. Not *zero* only because a
  mechanic that costs no health would land silently: the hurt flash, the direction wedge and the
  Focus drain all key off damage.
- **tangleSeconds 2** — measured against the fall rather than chosen for feel. See below.
- **Measured in 3D**, like the archer, and by its own argument rather than by inheritance: section
  4.4 gives it *flight itself* to pressure, so a netter that could not reach a player in the air
  would be pressuring nothing. The only target worth grounding is one that is off the ground.

### The player side of a net

`PlayerState` gains `tangled: number` — seconds of glider refusal still owed. A number rather than a
boolean, so the countdown *is* the state and there is no second field to disagree with it. The
arithmetic lives in `src/player/tangle.ts`: `applyTangle` (take the larger of what is owed and what
just landed), `stepTangle` (one frame off, clamped at zero), `isTangled` (`> 0`).

The refusal is merged, never summed. Two nets a frame apart cost one refusal, and so do two landing
on the same frame — `stepEncounter` takes the maximum across the frame and `applyTangle` covers the
frames either side. A volley of three netters would otherwise stack into six seconds on the ground,
which is long enough over open sky to be a death sentence and is not what any single one of them
threatened. The consequence is deliberate: a second net on an already-grounded player is wasted,
which keeps the answer to a group of netters "spend two seconds walking" rather than "never go near
them".

**The glider gate was extended, not duplicated.** `controller.ts`'s deploy condition already said
"not right now" in four voices — the air jump is unspent, the staff is busy, the ground is close,
the player is down — so `!isTangled(state)` is a fifth voice in the same chorus. A parallel refusal
above that `if` would have had to restate all four and the two copies would drift. The forced stow
reuses the existing stow branch (`input.actionPressed || isTangled(state)`) rather than writing a
second answer to what folding the wing does to momentum, which section 2.3 is explicit about: the
horizontal momentum is preserved, and that is what turns a two-second refusal into a glide-out
rather than a two-second dead drop from a standstill.

`isFinitePlayer` watches the field. A NaN fails `isTangled`'s `> 0` test, so a corrupt countdown
would silently *free* the wings forever rather than lock them — invisible in play, which is exactly
the class of failure this codebase guards by respawning. `respawn` clears it, for the same reason
the staff combo and the dash chain are cleared: the down beat already costs the walk back and the
whole Focus meter, and arriving at the spawn point still unable to fly is a punishment carried over
from a life that has ended.

### The out, when a net grounds you over open sky

**The refusal expiring with air to spare, and there is no second mechanism.** Nothing is shaken off,
nothing is cancelled by input, and the air jump is not refunded. Two seconds of ground-mode fall,
then the wings open again.

The number is measured, not asserted. `net-recovery.test.ts` runs the real controller over the real
thirteen-island level from a point verified to be void: two seconds of falling from a cruise costs
about 48 m of altitude (40 m from gravity plus the glide's own sink), against the 600 m between the
island band and `worldFloorY` — under a tenth of the air available. The file plays the whole thing
for fifteen seconds, about twice what a free fall to the floor would take, and asserts the player
ends in glider mode above the floor and sinking at single digits rather than plunging. **Its
positive control is the assertion the file rests on:** the identical fixture that never presses
`Space` does hit the floor and respawn, so "did not fall out of the world" is not passing for a
fixture that was never falling.

There is also a *skill* answer, upstream: a Slipstream's invulnerable window discards a net whole,
damage and refusal alike. That gate reads `input.playerInvulnerable` directly rather than the
`damageAvoided` flag, and the difference is load-bearing — `damageAvoided` requires
`damageToPlayer > 0`, so a net retuned to zero damage would have slipped straight through a dodge, a
coupling between the netter's damage figure and whether its net is dodgeable sitting in a different
file from either.

## Feedback

Both types needed the player to be able to read them, and a mechanic with no feedback is a bug
report.

**The heavy's gust immunity has three tells, in the order the player meets them.**

1. **A cold body colour.** The heavy is the one kind not wearing the shared leather tint, because
   its armour is a *rule* rather than a weapon — the player has to be able to tell which soldier the
   gust will not touch before throwing one. The tint holds through the downed and rising poses too.
2. **The aim marker staying dark.** `liveGustTargets` and `anyLiveGustTarget` now take the per-kind
   Record and exclude anyone whose armour deflects the gust. This is the same argument that already
   kept the preview dark for a body: a preview that warms on a heavy promises something the move
   cannot deliver. It is the best of the three tells because it costs the player nothing to learn
   from — the reticle and the cone stay cold on a heavy and warm on the spear beside it.
3. **A clang and a spark if they throw it anyway.** `EncounterStep.deflectedThisFrame` reports the
   soldiers whose armour turned a whole blow away. It pays no Focus (nothing happened to the
   soldier, and paying would make plate a Focus battery) and it drives a third `ImpactKind`,
   `'deflect'`: smaller than a connect (0.7 against 1.1), shorter (0.12 against 0.18), brighter at
   its peak, and cold grey where the other two are warm. The one thing it must not do is read as a
   *weaker* connect, which would teach the player the gust is working badly rather than not working.
   `COMBAT_LEVELS.clang` is deliberately **equal** to `impact` for the same reason — quiet reads as
   "barely hit" — with the whole difference carried by timbre: a short high snap against a low thud.

`impactTargets` gained a third tier, and the precedence is down beats hit beats deflect. The
cross-move case is real: a gust and a staff finisher can land on one heavy on one frame, the gust
bouncing while the staff bites. Something did happen to that soldier, so drawing a "nothing
happened" spark over the connect would contradict it.

**The net has an aim tell and a state tell.**

- **The throw lane.** A flat wedge on the ground running out along the netter's `facing` at its real
  `strikeRange`, visible only during the wind-up, in the net's own cool tint. The shared wind-up
  recolour says a soldier is about to do something; it cannot say it is about to do it *to you*, and
  that is the one thing worth knowing before a net lands. A wedge rather than a line because a line
  foreshortens into a point at the shallow angle this game plays at, and it widens away from the
  thrower, which is also honest about how a thrown net behaves. It hangs off the view's root rather
  than the rig, because the rig takes a quarter turn about X when its owner falls over and that
  would stand a flat ground shape on its end — the mirror image of why the health bar is parented
  where it is.
- **The HUD badge.** `HudModel.tangled`, shown as a small cool-grey "Wings tangled" label above the
  readouts. A boolean rather than the remaining seconds, and that is a deliberate refusal to draw a
  countdown: a shrinking bar invites the player to stare at the HUD and wait, which is the opposite
  of what the two seconds are for. What they need to know is "not yet", and the badge disappearing
  is "now".

## Placement, and the invariant that did not move

`HOME_PATROL` is now seven soldiers in four ranks: one heavy at radius 30, three spears at 34–36,
one net thrower at 48, two archers at 55. Every posture the player might retreat into is covered by
something further back, and the one move that would open a gap in all of it — a gust — does nothing
to the soldier holding the front.

**One encounter site rather than two.** Both new lessons are *comparative* (the gust works on these
and not that one; climbing escapes the archer and closing escapes the netter), and a lesson taught
by contrast needs the thing it contrasts with standing next to it. A second site would also have
needed a second `patrolSpawns`, a second `PatrolConfig` and a second restore rule in `main.ts`, none
of which exists, for a fight the player would meet later and learn less from.

**Two positions moved during the work, both for measured reasons, and both are recorded in
`config.ts`:**

- The netter first went to (30, −34), where the ground inside a 12 m gust footprint varies by
  5.741 m against the gust's 5.0 vertical band. That made it a third place on the island where the
  fight quietly stops reaching, and it broke `reach-geometry.test.ts`'s property that every stance
  the bands take away is on the two rim archers — that test doing exactly its job. At (42, −24) the
  same figure is 1.535 m, under even the staff's 2.0 band, so no move loses a stance around it.
- The heavy first went to (22, −18), directly inboard of `spear-1` on the same bearing and 5.66 m
  from it. That broke the patrol's "a shape rather than a blob" property — at 11.31 m between the
  closest pair, neither staff arc nor either radial move at its weakest can hold two soldiers at
  once — and it put the hardest melee attacker in the game inside its own reach of the first spear a
  new player closes on. There is no slot on the spear line's own bearings that fixes it: the heavy's
  20-unit notice range needs about 26 m of separation from the spawn to stay asleep at load, and a
  position 11.3 m inboard of a spear at radius 34 lands at radius 23 and wakes on the first step. It
  holds a flank instead, at (4, −30): 1.705 m of ground variation inside a 12 m footprint, 30.51 m
  from the spawn in 3D, 14.0 m from its nearest neighbour.

**`DEFAULT_PATROL_CONFIG.respawnRange` did not move, and that is a measurement rather than an
oversight.** The heavy notices at 20 and the netter at 30, both under the archer's 38, so the archer
is still the widest and still the value this one tracks: `38 × 1.3 = 49.4` is the floor
`patrol.test.ts` enforces and 52 clears it. The slack that a previous cycle deliberately left here
for "the next few units of retuning" is exactly what paid for two new kinds without a change.

Re-verified by mutation, in both directions:

- Netter `aggroRange` 30 → 45: `patrol.test.ts`'s margin guard reddens (`expected 52 to be greater
  than 58.5`) and so does the placement margin (`nets-1 has too little margin`). Restored.
- Heavy `aggroRange` 20 → 42: the same margin guard reddens, plus both spawn-distance guards
  (`heavy-1 is 30.51 from the spawn, inside its notice range of 42`). Restored.
- `respawnRange` 52 → 95: the *ceiling* guard reddens — `patrol-placement.test.ts`'s requirement
  that somewhere on the home island lies beyond `respawnRange` of every spawn point, which the far
  rim clears by 91.24 units today. Restored.

## Every mutation run against the new behaviour

Each one was applied to production code, the relevant suites run, the failure confirmed, and the
code restored.

| Mutation | Result |
|---|---|
| `deflects` always returns false | 6 tests red, including the mid-wind-up stance test and the 200-second gust grind. Notably **not** the bare "no health lost" / "no knockback" assertions, because `throughArmour` still zeroes the blow — which is exactly why those two have a spear beside them and a stance assertion next to them. |
| `throughArmour` ignores the knockback fraction | 3 red, including the lift-specific case and the vortex comparison |
| `throughArmour` ignores the damage fraction | 2 red |
| Heavy `armour.gust` → 1 / 1 | 2 red: the shipped-config assertion, and the real-geometry "a gust cannot put it off the edge" |
| Heavy `armour.wave` → 0.5 knockback | 2 red, including the environment route at real geometry |
| Tangle gated on `avoided` instead of `playerInvulnerable` | 1 red: the zero-damage-net dodge case, which is the whole reason the gate is written that way |
| Tangle summed instead of merged | 1 red: two nets on one frame |
| A net in flight reports its payload every frame | 1 red: the net that lands on terrain |
| Tangle reported at the throw instead of on arrival | 1 red: no refusal before the net arrives |
| `stepTangle` never decrements | 7 red across three files, including the real-geometry recovery |
| Deploy gate stops asking `isTangled` | 2 red: the refusal, and the expiry boundary |
| Forced stow condition drops `isTangled` | 5 red, including the real-geometry positive control |
| Netter `aggroRange` 30 → 45 | 2 red (respawn margin, placement margin) |
| Heavy `aggroRange` 20 → 42 | 3 red (respawn margin, both spawn-distance guards) |
| `respawnRange` 52 → 95 | 1 red (the restore-spot ceiling) |

Two traps this repo has hit before were specifically designed against:

- **A "nothing happened" assertion needs a positive control.** Every heavy assertion has an
  unarmoured soldier in the same cone, on the same frame, from the same call. The `deflects`-always-
  false mutation demonstrated why: it left the health and knockback assertions green, and only the
  stance assertion and the spear control caught it.
- **Knockback physics runs regardless of stance, so a body can escape a cone by being shoved out of
  range.** Two places bit: the ladder-grinding test had to follow the body between dives, because a
  full slam shoves 11.5 m against the wave's 11 m radius and a fixed player position lands exactly
  one slam and then reports the heavy as unbeatable for a reason that has nothing to do with armour;
  and the heavy assertions read `knockback` and `verticalVelocity` rather than `position`, so a
  single frame of damping cannot mask an impulse that was applied.

One further false pass was caught during the work and is worth recording: the first draft of
`heavy-environment.test.ts` spawned soldiers at the authored `y: 0` rather than dropping them onto
the terrain the way `main.ts` does. The home island's surface out at radius 50 is about 8 m up
against the wave's 4 m vertical band, so every slam in the file missed — and three of its six tests
passed anyway, for entirely the wrong reason.

## What was deliberately not built

- **Earthbending.** Section 4.4 names earth as the heavy's other answer and section 4.2 calls it
  "the only reliable armor-breaker". It does not exist in this game and adding an element was far
  outside this task. The environment carries the whole load, and the note above says so where the
  numbers are.
- **Chains, as distinct from nets.** Section 4.4's row is "Nets and chains". A chain is a different
  verb — a tether that pulls rather than a projectile that grounds — and it would need a persistent
  link between two bodies, which is a new thing in the model rather than a payload on an existing
  one. Only the net half is built, and the kind is named `nets` accordingly.
- **A guide entry for the enemy roster.** `src/ui/guide/reference.ts` has no enemy section at all
  today, and adding one is a new panel rather than a new row. The README carries the prose instead.
- **The remaining two rows of section 4.4** — earthbender duelists and airship gunners — untouched.
- **A second encounter site**, argued above.

## Files a parallel branch is likely to also touch

`src/main.ts`, `src/combat/config.ts`, `src/combat/encounter.ts`, `src/combat/enemy.ts`,
`src/core/types.ts`, `src/player/controller.ts`, `src/player/state.ts`, `README.md`. The changes to
each are enumerated in the task report.
