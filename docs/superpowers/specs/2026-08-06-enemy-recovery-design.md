# Getting back up

Written 2026-08-06.

The other half of going down. Yesterday's spec gave the player a way off the floor and
listed enemies recovering from their own downed state as out of scope — "the same missing
system, on the other side of the fight, and a much larger question." This is that question.

## Why

Three spear soldiers hold the home island. Down one and it is out of the fight for as long
as the fight lasts — there is no way back onto its feet short of clearing the whole patrol
and walking away.

`src/combat/patrol.ts` already handles the *encounter* scale: once every soldier is down and
the player is beyond `respawnRange: 40`, the patrol is replaced with a fresh one. Leaving and
coming back works. What is missing is anything at the scale of a single exchange. A fight
with three soldiers is really three separate fights against one soldier each, resolved in
sequence and never revisited, and nothing about downing one costs the player anything later.
There is no pressure to finish, no cost to ignoring a body, and no reason to keep moving once
the last one is flat.

That is also not quite what §4.6 asks for. It says every enemy has a **downed** state instead
of a death state, which is a statement about not killing people — not a statement that a
winded soldier is out of the war. A soldier who gets back up is the more honest reading, and
it makes the space stay dangerous while the player is still standing in it.

Four frictions shaped the design, and each is answered below rather than waved at.

**Downs pay Focus.** `downedThisFrame` grants `downGain: 14` on every crossing into downed.
Recovery makes that farmable — the mirror image of the attrition-by-dying hole the player
spec accepted. Answered in "Focus".

**Enemies deliberately do not heal.** `regenPerSecond: 0`, with the comment "Enemies do not
heal. Chipping one down over a long fight has to stay viable." Standing one back up at full
health contradicts it outright. Answered by the ladder, which makes chipping the *mechanism*
of progress rather than a casualty of it.

**§4.6's flavour is mostly permanent** — "disarmed, buried to the waist, frozen, blown off a
ledge into water, tangled in their own equipment." A soldier who is merely winded gets up; a
soldier at the bottom of the ladder does not. The ladder is what reconciles the two.

**Bodies below the world floor are parked** and must never stand up. There is no ground
under them. Answered for free by the existing parked branch and the grounded gate.

## Decisions, all settled

**Recovery is a ladder, not a switch.** Each rise returns less health than the last, and
when the rungs run out the down is permanent. The fight stays alive for a long time but a
determined player can still clear it.

**The rise is telegraphed and interruptible.** A soldier pushes up over a visible beat, and
a hit landed during it puts them straight back down. This is the language the fight already
speaks — the wind-up is the game's whole readability device — and it makes standing over a
body a real tactic with a real cost, because the rest of the patrol is hitting you while you
do it.

**Interrupting a rise does not burn a recovery.** It resets the countdown and nothing else.
Descending the ladder requires taking a soldier's health to zero again, so the rungs stay
tied to real damage and a tap at the right moment cannot substitute for chipping through
sixty percent of a health bar. The interrupt buys time, which is what positional defence
should buy.

**Only the first down pays Focus.** A soldier cannot be walked up and down the ladder as a
Focus engine. Noted for the record: paying the *first* rather than the *last* is arguably
backwards against §4.6, which pays downs because a non-lethal removal is the generous play,
and the removal that sticks is the last one. The alternative is the same one-line filter and
was offered; first-down-only is the chosen behaviour.

**A downed soldier does not recover while airborne.** A body still falling out of a Vortex
waits until it lands.

## Architecture

### `src/combat/enemy.ts` (changed) — the state

`Stance` gains one value and `Enemy` gains one field:

```ts
export type Stance = 'advance' | 'wind-up' | 'recover' | 'downed' | 'rising'
```

```ts
  /** How many times this soldier has been taken to zero. Drives the ladder. */
  downs: number
```

`spawnEnemy` initialises `downs: 0`.

`EnemyConfig` gains three:

```ts
  /**
   * Seconds flat on the ground before pushing back up.
   *
   * Deliberately not named `recoverSeconds` — that one already exists and means the
   * vulnerable window after a strike. Two fields a syllable apart, both about recovering,
   * is how a caller reaches for the wrong one.
   */
  downedSeconds: number
  /** The push-up itself: long, visible, and a hit lands them straight back down. */
  risingSeconds: number
  /**
   * Health on each successive rise, as a fraction of max.
   *
   * The array's length is how many recoveries a soldier gets: run off the end and the
   * down is permanent. Depth and steps are one constant rather than two that can disagree.
   */
  recoveryHealthFractions: readonly number[]
```

### The rules

**Health is not restored until the rise completes.** Through both `downed` and `rising`,
health stays at zero and `isDowned` stays true. `rising` is a sub-state of being on the
floor, not a new kind of alive. That single choice is what makes everything below cheap.

`stepEnemy`'s downed branch becomes three cases, in order:

1. **Not grounded** → stay down, timer frozen.
2. **Ladder exhausted** (`downs > recoveryHealthFractions.length`) → stay down permanently.
   This is the behaviour the module always had, now reached by running out of rungs.
3. **`stanceTime >= downedSeconds`** → `stance: 'rising'`, `stanceTime: 0`, and `facing` set
   to `horizontalTo(position, playerPosition)`.

A rising enemy is inert: no movement, no `damageToPlayer`. At `risingSeconds` it restores
`maxHealth * recoveryHealthFractions[downs - 1]`, takes `stance: 'advance'`, and rejoins.

`facing` is set when the rise **begins** rather than when it ends. It only updates in the
active branch, so a soldier would otherwise push up aimed wherever they fell and snap round
on their first advance frame. One `horizontalTo` call at the transition and they come up
already looking at the player.

**The interrupt needs no new code.** `hitEnemy` already ends with:

```ts
    stance: isDowned(health) ? 'downed' : 'recover',
    stanceTime: 0,
```

Health is zero through the rise, so `applyDamage` leaves it zero, `isDowned` stays true, the
stance snaps back to `'downed'` and the timer resets. `downs` is untouched, so the ladder
does not move. The knockback `hitEnemy` also applies is a bonus rather than a problem: an
interrupted soldier is visibly shoved as they go back down.

`downs` increments in exactly one place, on the crossing:
`isDowned(health) && !isDowned(enemy.health)`. The fell-out-of-world branch in `stepEnemy`
increments it too, for consistency — though nothing reads it there, because the parked
branch returns before any recovery logic runs.

**Blown off a ledge stays permanent with no special case.** The parked-below-floor branch
returns first, and a body in open air has no ground for the grounded gate to find.

### `src/combat/enemy.ts` (changed) — two predicates

```ts
/** Worth aiming at: on its feet, or pushing back up onto them. */
export function isTargetable(enemy: Enemy): boolean

/** How far through pushing back up, 0 to 1. Zero when not rising. */
export function risingProgress(enemy: Enemy, c: EnemyConfig): number
```

`isTargetable` is `!isDowned(enemy.health) || enemy.stance === 'rising'`.

`risingProgress` returns 0 for a non-positive `risingSeconds` rather than dividing by it,
the same way `fadeOpacity` guards its own ramp. The value is multiplied into a rotation,
where a NaN corrupts the matrix instead of merely looking wrong.

An **empty** `recoveryHealthFractions` is a meaningful config, not a broken one: `downs: 1`
is already past the end of the ladder, so no soldier ever rises and the module behaves
exactly as it does today. That makes the whole feature switchable from one constant.

### Test fixtures (changed)

`EnemyConfig` gains three required fields, so every hand-written literal of it stops
compiling. There are four, and all need the new values: `src/combat/enemy.test.ts`,
`src/combat/encounter.test.ts`, `src/combat/gust.test.ts` and `src/combat/patrol.test.ts`.
Only the first two exercise the new behaviour; the other two just need to compile, and
should take the same values as `DEFAULT_COMBAT_CONFIG.enemy` so a reader is not left
wondering whether a different number there is load-bearing.

### `src/combat/encounter.ts` (changed)

**Targeting.** All four resolvers — gust, vortex, staff and wave — gate on
`!isDowned(enemy.health)`, across seven call sites. Health is zero through the rise, so
every one of them would skip a rising enemy and the interrupt would be unreachable. All
seven become `isTargetable(enemy)`.

A rising enemy caught by a gust therefore also counts as a connect and pays
`gustConnectGain`. That is correct — it is a real hit on a real target — and it is not a
farm, because each interrupt resets a countdown measured in tens of seconds.

**Focus.** `downedThisFrame` currently does double duty: it drives the `'down'` impact burst
in `main.ts` and the `downGain` Focus grant. Those now want different answers, so
`EncounterStep` gains a second list:

```ts
  /** Downed this frame. Drives feedback — every down is worth a burst. */
  downedThisFrame: string[]
  /** Of those, the ones going down for the first time. Only these pay Focus, so a soldier
   *  cannot be walked up and down the ladder as a Focus engine. */
  firstDownsThisFrame: string[]
```

`firstDownsThisFrame` is `downedThisFrame` filtered to `downs === 1`. This is the same split
`hitThisFrame`, `slamHitThisFrame` and `staffHitThisFrame` already make, for the reason that
file already states: each feeds a differently tuned grant, and folding them together pays
the wrong rate.

The interrupt needs no guard here. `wasDowned` is built from the pre-step enemies and a
rising soldier is already in it at health zero, so knocking one back down never registers as
a crossing at all.

### `src/combat/enemy-mesh.ts` (changed)

A rising branch goes **ahead** of the downed one, since a rising soldier is still
`isDowned`. The body rotates from flat back to upright across the beat:

```ts
rig.rotation.set((Math.PI / 2) * (1 - rising), yaw, 0)
```

`sync` gains a third parameter carrying that 0-to-1 progress, the same way `glider.update`
takes its swing progress — the view stays dumb and the arithmetic stays testable in
`risingProgress`. `main.ts` passes it at both `sync` call sites: the normal path, and the
settle block inside the player's own down beat.

**The body colour stays `BODY` during a rise.** `WINDUP` is described in that file as "warm
and bright, so a telegraph is the most visible thing on screen", and it exists so the player
can time a dodge. Reusing it for a rise would teach them to dodge something that cannot hit
them. The rotation is unambiguous on its own.

The health bar stays hidden through the rise — there is no health to report until it
completes — which `health-bar.ts`'s existing "shown once damaged, hidden when downed" rule
already produces with no change.

### `src/combat/config.ts` (changed)

```ts
    downedSeconds: 18,
    risingSeconds: 1.2,
    recoveryHealthFractions: [0.6, 0.3],
```

Against `maxHealth: 1.5` and the gust's `damage: 0.5`, those fractions produce **three
gusts, then two, then one** — 1.5, then 0.9, then 0.45. The ladder is legible from playing
it rather than from reading the config, and each rung costs less of the player's time than
the last.

`risingSeconds: 1.2` sits well above the strike's `windUpSeconds: 0.55`. Getting up is a
bigger commitment than a spear thrust and should read as one.

`downedSeconds: 18` is long enough that clearing a patrol feels like progress and short
enough that the island does not go quiet. Like every other tuning constant in this repo, an
argued guess that has not been played.

## How this sits beside the patrol restore

`shouldRestorePatrol` and this feature work at different scales and neither replaces the
other. The restore is encounter-level and requires the player to leave: every soldier down,
and the player beyond `respawnRange: 40` from every spawn. Recovery is per-soldier and
happens while the player is standing in the fight. Four consequences worth stating:

**The restore condition becomes rarer, and better for it.** "Every soldier is downed" now
means downing all three inside one `downedSeconds` window rather than accumulating downs at
leisure. Clearing a patrol becomes a thing the player does on purpose.

**A rising soldier counts as downed for the restore**, because health is zero through the
rise. That is harmless: the restore also requires the player to be more than 40 metres from
every spawn, which is far outside the fight, and a soldier mid-rise at that distance is not
something anyone is looking at.

**A restore resets the ladder, correctly.** It rebuilds the array with `spawnEnemy`, so
`downs` returns to 0 along with everything else. A restored patrol is a fresh patrol, which
is exactly what that feature already means. No change needed.

**The restore wins comfortably for a player who disengages.** `DEFAULT_GROUND_CONFIG.runSpeed`
is 13 and `respawnRange` is 40, so clearing the range from all three spawns costs roughly 4
seconds at a run — against an 18-second `downedSeconds`, the restore gets there first by a
wide margin. A player who downs all three and leaves gets the pre-existing fresh patrol and
never sees a recovery. Recovery is the behaviour that shapes a fight the player *stays* in;
the ladder's pressure is on the player who keeps fighting, not the one who leaves. This was
argued backwards during design — an earlier draft of this section claimed the opposite, and
`downedSeconds: 18` was tuned partly on that inverted claim — so that number deserves a
second look once the feature has actually been played.

## Edge cases

**Downed mid-air by a Vortex.** The grounded gate freezes the timer, so the body lands
before it starts counting. No extra branch: `fall()` already reports `grounded`.

**Interrupted on the last frame of a rise.** `hitEnemy` resolves before `stepEnemy` in
`stepEncounter`'s documented order, so a hit that lands on the frame the rise would complete
puts the soldier down rather than racing the restoration.

**The player's own down beat.** `stepEncounter` does not run while the beat is frozen, so
recovery timers hold and resume with everything else. Nothing to do.

**A soldier rising as the player respawns.** Nothing special. The patrol is deliberately not
reset when the player recovers, which the player spec settled, and a rising soldier is part
of that state like any other.

## Testing

Red-proof everything: write the test, watch it fail for the stated reason, then implement.

**`src/combat/enemy.test.ts`:**

- rises after `downedSeconds`; the timer does **not** advance while airborne
- a rising soldier is inert — no `damageToPlayer`, no movement toward the player
- the rise restores `maxHealth * recoveryHealthFractions[downs - 1]`, and the second
  recovery restores the *second* fraction, so the ladder is asserted descending rather than
  merely non-zero
- once the ladder is exhausted it never rises again, stepped for several multiples of
  `downedSeconds`
- **a hit during the rise returns it to downed, resets the timer, and leaves `downs`
  unchanged** — then it rises again and comes back at the *same* fraction. Both halves are
  required: either one alone passes against a wrong implementation.
- an enemy below the world floor never rises
- `downs` increments on the crossing only, not on further hits to a body already down
- `risingProgress`: 0 when not rising, 0 at the start, 1 at the end, clamped
- `isTargetable`: true standing, false downed, true rising
- **one invariant test, phrased to survive retuning:** each rung of the ladder takes strictly
  fewer gusts than the one before, and the last takes exactly one. That pins the feel claim
  without freezing the numbers.

**`src/combat/encounter.test.ts`:**

- a rising enemy can be hit by a gust. This is the regression `isTargetable` exists to
  prevent, and without it the interrupt is silently unreachable.
- a first down appears in both lists; a second real down appears in `downedThisFrame` but
  not `firstDownsThisFrame`; an interrupt appears in neither

**`src/combat/enemy-mesh.test.ts`:**

- flat at progress 0, upright at 1, partway between in between
- the colour is never `WINDUP` during a rise, guarding that decision from being casually
  undone

**`main.ts` is not unit-tested**, as ever for that file. The events mapping
(`events.downs = fight.firstDownsThisFrame.length`) and the two `sync` call sites are
verified in the running game:

1. Down a soldier, wait out the countdown, watch them push up and rejoin.
2. Hit one during the rise — straight back down, countdown restarts.
3. Walk one down the full ladder; the third down sticks.
4. Focus jumps on the first down and not on later ones.
5. Blow one off the island; it never comes back.
6. Vortex one down mid-air; the countdown waits for the landing.

## Documentation

- **`README.md`** currently says "a downed soldier stays lying where the air put them."
  That becomes false and must be **corrected**, not supplemented.
- **§4.6 of `docs/design/aang-playable-character.md`** records that downs are temporary on a
  ladder, and that the last one sticks.
- **`docs/HANDOFF.md`** gains an entry.

## Out of scope

- **Paying Focus on the last down instead of the first.** Offered and declined; the filter
  is one line if it is revisited.
- **Recovery for any enemy type other than spear infantry.** Five of §4.4's six do not exist.
- **A getting-up animation clip.** The model ships idle, walk, run, fall and glide; the
  procedural rotation is the tell, exactly as the downed pose already is.
- **Reinforcements, or respawning a patrol that has been fully cleared.** A different
  feature — this one is about the soldiers already in the world.
- **Enemies helping each other up.** Tempting and thematic, and a much larger behaviour.
- **Retuning the Focus economy around longer fights.** The grants are unchanged; whether a
  fight that now runs three times as long pays too much Focus is a question for a session
  with a mouse in hand.
