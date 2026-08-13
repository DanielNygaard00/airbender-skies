# Earth, the armour-breaker and the only cover

**Cycle:** the second borrowed element, extending the switching contract water established.
**Authority:** `docs/design/aang-playable-character.md`, sections 4.2, 4.4, 4.6 and 5, plus the
contract in `docs/superpowers/specs/2026-08-11-water-element-design.md` section 2.
**Status:** implemented, typechecked, tested, mutation-verified. Unplayed — every tuning number in
here is an argued guess.

---

## 1. What this cycle had to prove

Water's cycle existed to force the switching infrastructure into being. This one exists to show
that the infrastructure works: earth had to be an *addition* to it rather than a rewrite of it.

It was. The recipe in the water note's section 2.2 was followed step by step and nothing in it
turned out to be wrong. Two things are worth reporting back to it:

- **The `Element` union broke the compile in exactly the two places it promised**, `LOOKS` in
  `src/ui/element-radial.ts` and `ELEMENT_LEGEND` in `src/ui/guide/reference.ts`, and nowhere else.
  The `Record` discipline did its job.
- **The recipe missed one consequence of appending to `ELEMENT_ORDER`**, and it is a real cost
  rather than a detail. See section 6.

The other half of what this cycle had to prove is that section 4.4's sentence about the heavy
armoured soldier is true. That is section 4 below, and it is the part of this document to read if
you read only one.

---

## 2. The two verbs

| | Light (`F`) | Heavy (`R`) |
|---|---|---|
| Air | Gust | Vortex — charges while held |
| Water | Water Grip | Ice Lock — no charge, fires on release |
| **Earth** | **Stone Throw** | **Stone Pillar** — no charge, fires on release |
| Fire | *(burst)* | *(propulsion, or the committed lance)* |

Section 4.2 gives earth three words: *raise, throw, wall*. They map two-and-one:

- **Stone Throw** is *throw*. It is the light verb because it is the repeatable one, and it has to
  be the repeatable one: breaking armour is a job you do four times to one soldier, and a job you
  do four times cannot live on the key that costs Focus.
- **Stone Pillar** is *raise* and *wall* together. They are the same act — rock leaving the ground
  where you aimed — and they differ only in what the player wanted out of it. A wall is a pillar
  you stood behind; a raise is a pillar you put under someone. Both are built: the pillar stops
  projectiles, and anyone standing on the spot it comes up through is shoved off their feet and
  interrupted, which is section 4.2's "drop a pillar under them" arriving as a mechanic.

Splitting *raise* from *wall* would have needed a third binding, and the water note's section 2.1
is explicit that there is no third binding to have. One object with two uses is the design that
fits the contract, and it happens to be the better design anyway: the player learns one thing.

### 2.1 Why the pillar is a cylinder and not a slab

A wide thin slab is the more literal reading of "wall" and would be better cover. It was rejected
for a reason that is a design argument rather than a geometry one: **a slab has to be aimed, and
the Air Wall is already the barrier you aim.** That move's whole identity is that the angle you
hold it at decides where the arrow goes. A second aimed barrier would be competing with it on its
own ground while being worse at it.

A cylinder is orientation-free. It stops whatever crosses it from whichever bearing, so the skill
it asks for is *positional* — stand behind it — rather than rotational. That is the axis section
4.1 says every defensive option in this game should live on, and it keeps the two barriers
genuinely different tools rather than two versions of one.

It is also the design document's own word: section 4.2's worked example is "drop a pillar under
them".

---

## 3. Earth is additive, not deformation

This is the insight that unblocked the element, and it is worth stating plainly because the
obvious reading of "earthbending" is terrain deformation and terrain deformation is impossible
here.

`createTerrainQuery` closes over a fixed list of island meshes built once by `buildWorld`, and
`props.ts` states outright that decorative geometry must never be fed into it. Nothing can change
an island's shape after it is generated, and nothing can join the set of things that are asked
about.

**A raised pillar does not need any of that.** It is a new collidable object, owned by the fight,
living in `Encounter.pillars` beside the arrows — a thing this fight put into the world with a
lifetime of its own that both sides can meet. That is the same standing a projectile has, and the
projectile system already proves the shape works.

The cost of this reading is section 5.

---

## 4. Breaking plate: the arithmetic

Section 4.4 says the heavy armoured soldier is "immune to gusts, must be broken with earth or the
environment". Before this cycle the environment carried the whole load. The claim is now true, and
here is what makes it true rather than asserted.

**The heavy's two earth armour rows:**

```
stone:  { damage: 1,   knockback: 0.6 }
pillar: { damage: 1,   knockback: 0.5 }
```

`stone.damage` is **1**: plate does not reduce a thrown rock at all. That is deliberate and it is
the row the design document's sentence stands on. The `wave` row is also 1 — the Pressure Wave
being the other answer the document names — and it would be incoherent for one of the two named
answers to be resisted and the other not. Any fraction below 1 makes "the only *reliable*
armour-breaker" less reliable than the move it is supposed to sit beside.

Both knockback fractions are reductions rather than removals, because displacement is the currency
this type exists to defend. The contrast with the `gust` row's 0 is the argument: a gust is air
pushed at a body and plate is proof against it, where a thrown rock has mass and a rising pillar
is *the ground moving*, which is the same reason the wave gets everything.

### 4.1 How many stones

`stoneDamage` is 1.1 and comes through in full. The heavy has `maxHealth` 4 and
`recoveryHealthFractions` `[0.6, 0.3]`, so its ladder rungs are 4.0, 2.4 and 1.2:

| Rung | Health | Stones |
|---|---|---|
| First | 4.0 | **4** |
| Second | 2.4 | **3** |
| Third | 1.2 | **2** |
| **Whole ladder** | 7.6 | **9** |

Nine presses for a permanent down, spread over about 16 seconds by the 1.8-second cooldown.
`encounter.test.ts` measures the first rung through the actual fight rather than computing it,
and `earth.test.ts` derives the whole table from the shipped config so a retune of the damage, the
armour row, the health or the ladder moves the expectation with it.

### 4.2 Against the two routes that already existed

**The staff.** A full three-swing combo is opener + opener + finisher = 2.6, times the staff's
armour row of 0.35 = **0.91**. Against the whole 7.6-health ladder that is 8.4 combos, or about
**twenty-five swings**, every one of them thrown from inside the reach of a 2-damage swing.

> A correction to `config.ts` while I was here: its heavy comment said "roughly eight combos per
> rung". Eight is the figure for the **whole ladder**, not per rung — per rung it is 4.4, then 2.6,
> then 1.3. The number was right and the label was wrong, and since this cycle's arithmetic is set
> against it, the comment is now fixed. Reported rather than quietly changed because a comment
> claiming a difficulty is exactly the kind a reader trusts instead of checking.

**The Pressure Wave.** A full-strength slam does 2.2, so the ladder is 2 + 2 + 1 = **five dives**.

So earth is **not the fastest** answer — a perfect dive is fewer presses. It is the *reliable* one,
and the distinction is the whole of what the word is doing in the design document: a full-strength
slam needs 30-plus metres a second of descent and therefore real altitude to spend first, and the
staff needs you to stand in front of the thing. Nine presses from twelve units away with nothing
set up beforehand is the trade. Both existing routes are deliberately kept.

### 4.3 Nothing deflects a stone

`earth.test.ts` asserts across every shipped enemy kind that no armour turns a stone away
completely (`damage === 0 && knockback === 0`, which is what `deflects` reports and what makes a
resolver skip a soldier entirely). If one ever did, section 4.4's sentence would have an exception
nobody had written down. The branch that would handle it exists and is tested at a config that
ships nowhere, so blocking the armour-breaker against some future kind is a config edit with
working code behind it — the same standing water's `freeze` row has.

---

## 5. Hard cover: what it is, and what it honestly is not

### 5.1 It stops projectiles, which is the claim that matters

`pillarBlocks` tests a **swept segment** against a vertical cylinder, clipped to the pillar's
height, and `stepProjectile` asks it **first**, ahead of the player, the enemies, the ground and
the expiry. Both halves are load-bearing:

- **Swept, not a position test.** At the archer's shipped speed of 34 an arrow covers 0.57 units a
  frame against a pillar 2.4 across, so a position test would hold today — and it would hold by
  luck, and stop holding the day either number moved.
- **Before the player.** A step long enough to cross the rock *and* arrive at the player has to end
  at the rock: it is between them, and cover that lost a race with the frame rate would fail
  exactly when the player was closest to it.

The height is sampled where the step **enters** the footprint rather than at its closest approach
or its exit. That distinction is invisible on a descending shot and real on a climbing one — an
arrow loosed from below that clips the near face low down and would emerge above the cap is stopped,
because it met the rock. Mutation testing found that the first version of the test could not tell
the three rules apart; see section 8.

Cover works **in both directions and for both sides**. A returned arrow the player's own Air Wall
just sent back is stopped by a rock in its way exactly as an incoming one is. Cover that only
obstructed the enemy would be a wall the player could shoot through, which is a promise no physical
object makes. A net stopped by a pillar also grounds nobody: the payload dies with the shot, which
matters because otherwise the pillar would be useless against the one enemy built to ground the
player.

### 5.2 It does not stop anybody walking, and that is a world limitation

**Stated plainly rather than left to be discovered.** A spear soldier walks straight through a
pillar to reach the player. Two separate mechanisms would have to exist for it not to, and neither
does:

- **Enemies have no horizontal collision of any kind.** `stepEnemy` asks the world for
  `groundHeightAt` and nothing else — its parameter type is `GroundHeightQuery`, deliberately
  narrower than `TerrainQuery`. A soldier already walks through every boulder and temple pillar in
  the archipelago. Teaching one to walk round a rock means giving the enemy model a collider it has
  never had, which is a world-and-enemy cycle rather than a combat one.
- **The player's collision is a raycast against a closed mesh set.** `resolveMovement` casts
  through `TerrainQuery`, which is built once from the island meshes. A pillar *could* be pushed
  into it through a composed query — the interface is small enough — and the reason it was not is
  what that would drag in. The same cast answers the ground snap, so a standable pillar top would
  begin reporting a surface whose `islandId` is not an island, and `lastGroundIslandId` — the
  respawn anchor — is read straight off those hits. That is a respawn bug waiting behind a nice
  feature.

There is also a design argument that makes the limitation easier to live with than it sounds, and
it is the reason I did not reach for a half-measure. **Blocking only the player's movement would
have been worse than blocking nobody's**: it is the player's own cover, so the only body it would
obstruct is the one that raised it. Cover that gets in its own user's way and nobody else's is a
net negative.

What "hard cover" therefore means in this game is: *the only thing that stops what is shot at you*.
The game's ranged threats are the archer and the net thrower, and those are precisely the enemies
section 4.2 says cover is for. The melee types are what the whole movement kit already answers.

The fix, when it comes, is a world cycle that gives enemies a collider — and that same cycle is
what the earthbender duelist of section 4.4 needs, so they belong together.

### 5.3 How good the cover actually is, measured

An arrow is aimed at `playerPosition`, so a pillar covers the player exactly while it sits within
its own radius of the line from the archer to them. If the player steps sideways by `x`, the
pillar's offset from that new line is about `x · (D − raiseDistance) / D` for an archer at distance
`D`.

At `pillarRadius` 1.2 and `raiseDistance` 6, against the archer at its 30-unit firing range, that
gives the player about **±1.5 m of lateral freedom** before the cover stops covering. That is
deliberately tight. Section 4.1 makes every defensive option positional, and cover you can wander
away from is cover you never have to think about.

### 5.4 Lifetime, count, and what survives what

**`pillarSeconds` is 6.0.** A permanent pillar is a level editor and a one-second pillar is not
cover, so the number is set against the thing it shelters from: an archer's cycle is
`windUpSeconds` 0.8 + `recoverSeconds` 1.1 = 1.9 s, so one press buys **three shots' worth**. Far
under the enemy `downedSeconds` of 18, so cover can never become the thing you wait behind while
the patrol gets up; far over the Air Wall's `maxSeconds` of 0.9, because these are opposite tools.

**`maxPillars` is 2**, and the third press **retires the oldest rather than being refused.** Two
because one pillar covers one bearing and the shipped patrol has three things that shoot, so the
player answers two and has to choose which — three would let them build a box, and section 4.4 says
the intended answer is almost always movement. Eviction rather than refusal because a refusal the
player cannot see is the worst kind: every other refusal in the game is legible, and "you already
have two" has nothing on screen to say so *except the two rocks*. Since those rocks are on screen,
replacing the older one is a rule the player reads directly off the world.

**Nothing shortens a pillar's life but its own clock.** Not the patrol restore, which discards the
arrows beside it. Not the player's own down beat. The thematic argument is section 6's rule that
the fight "keeps whatever state he put it in", and a pillar is more clearly the player's own mark on
the world than a hold on a soldier is. **The argument that actually decided it is mechanical:** the
view layer has no way to be told an object died early. `Effect` has no kill hook, and the pillar's
mesh is disposed when its record disappears — so a fight that deleted a pillar early would leave
either a rock drawn where nothing blocks arrows, or a rock vanishing while it still does. That is
the exact failure `ice-shell.ts` exists to avoid, said about a longer-lived object. One clock, no
exceptions, is what makes the drawn rock and the blocking rock the same rock.

The two beats differ in whether this is observable:

- **A patrol restore** cannot outlive a pillar: it requires the player past `respawnRange` 52, and
  no ground speed in the game covers that in six seconds. So this is a guard rather than a rule
  anyone will see working, with the same standing the `hitMarks` clear has — written down because
  the relationship between two constants in two files is not something anyone retuning either
  would think to check.
- **The player's own respawn** *is* observable. `DEFAULT_DOWN_CONFIG`'s ramps are 0.6 + 0.9 = 1.5
  seconds against a six-second pillar, so a player who goes down behind their own cover comes back
  up behind it. That is the right answer and it is the one case where this rule is visible.

Pillars are also aged **every frame whatever element is selected**, exactly as the three cooldowns
are, for the same reason: cover whose clock only ran while earth was in hand would last as long as
you did not use the rest of your kit, which is not a cost.

---

## 6. What appending to `ELEMENT_ORDER` cost

The water note says appending is all the radial geometry needs, and that is true of the *geometry*.
It is not the whole story, and this is the one place the recipe should be extended.

With two elements the sectors were half-circles and **water sat straight down**. With three they
are 120 degrees each, so water is now **down and to the right** and earth is **down and to the
left**. Water's flick changed once, in exchange for never changing again. The alternative was
reordering to keep water where it was, which would have moved air — the one slot that must never
move, since it is the home slot and the least deliberate flick the wrist produces.

Straight down is now a sector *boundary* rather than any element's own direction. It resolves
deterministically (to earth, because `Math.round` breaks the half upward) and it is not
*meaningful*, which is what the dead zone is for.

**Five places described the old layout in prose and all five had to be corrected in the same
change:** `ELEMENT_LEGEND.water`, the guide's `Element radial` row, the README's `V` row, the
README's element paragraph, and `reference.test.ts`'s own direction assertion. Four tests went red
correctly, which is those tests doing their job.

Two things were added so that fire cannot repeat this quietly:

- `element.test.ts` now pins `ELEMENT_ORDER`'s exact contents as a literal — almost nothing in this
  repo is pinned to a literal, and the reason is in section 8: every other test derives its
  expectations from the array, so *reordering* it left the whole file green.
- `reference.test.ts` now ties each element's prose direction to the **slot index it actually
  occupies**, so a reorder breaks the index assertion and a reword breaks the phrase assertion.
  Checking the words alone cannot fail for a reordered array: both sentences stay untouched and
  both become wrong.

One further thing the legend had to lose: air's line claimed to be "the only element with a damage
move in it at all". Earth made that false.

---

## 7. The numbers, and what each is anchored to

Every value is in `DEFAULT_COMBAT_CONFIG.earth`, with its argument on the field it belongs to in
`src/combat/earth.ts`. None of it has been played.

| Value | | Anchored to |
|---|---|---|
| `stone.range` | 12 | **Equal to the gust's 12** and to a full-charge Vortex, so no light verb out-ranges another. What differs between the three is width, price and payload, never reach. |
| `stone.halfAngle` | 20° | The narrowest cone in the game — 40° swept against the gust's 120 and the grip's 60. A rock is one object thrown at one body, and a wide earth cone would be a gust that also broke armour. |
| `stoneVerticalReach` | 4.0 | Middle of the seven bands, with the wave and the Air Wall. Above water's 3.0 (a thrown mass is not a rope held at arm's length), below the gust's 5.0 (a gust fills a volume). The deciding argument is water's own: a damage move that reaches high wins from a hover with no counterplay. A test pins that a player hovering just past this band is still inside an archer's 3D reach. |
| `stoneDamage` | 1.1 | **Under the staff finisher's 1.2**, narrowly and deliberately: the safe move must never pay better than the dangerous one. Over twice the gust's 0.5. Under a spear's 1.5 health, so even the slowest attack needs a follow-up. |
| `stoneKnockback` | 10 | Well under the gust's 26 and the finisher's 18 — displacement is air's currency. At `knockbackDamping` 2.6 it travels 3.8 m against a gust's 10, so it cannot walk a soldier to a rim; environmental removals pay less Focus by design and a cheap repeatable move that produced them would make the stingy line the easy one. |
| `stoneCooldownSeconds` | 1.8 | **This is what "slow, committed" costs.** Four times the gust's 0.45 and well past the grip's 1.1 — the longest cooldown on any light verb. See below on why not a wind-up. |
| `stoneBreathCost` | 16 | Above the grip's 12 (this is the move that does damage), under the Slipstream's 28 (nothing offensive should crowd the dodge out of the bar). |
| `raiseDistance` | 6 | Past every melee reach in the game, the heavy's 3.6 being the longest, so cover lands *between* the player and what is closing rather than behind it. |
| `raiseVerticalReach` | 3.0 | How far the ground may be from the player's own feet. A jump's clearance, not a glide's: hard cover manufactured from a hover would answer the archer with no counterplay. Equal to water's whole-element band by coincidence rather than by rule — it bounds where the *ground* may be, not where a target may be, which is why earth has two vertical numbers where water has one. |
| `pillarRadius` | 1.2 | Gives ±1.5 m of lateral freedom against the shipped archer; see section 5.3. Also visibly chunkier than the decorative temple pillars' 0.7–0.8 shafts, so bent rock does not read as architecture. |
| `pillarHeight` | 4.5 | Over the character's 1.8 and over a standing jump, so it is a thing to stand behind. Every arrow is loosed from `SHOT_HEIGHT` 1.1 and aimed at the player's feet, so on flat ground a shot always descends and the margin is for an archer on higher ground. |
| `pillarSeconds` | 6.0 | Three of the archer's 1.9-second cycles. Under `downedSeconds` 18, over the Air Wall's 0.9 by a wide margin. Section 5.4. |
| `maxPillars` | 2 | Two of the patrol's three shooters. Section 5.4. |
| `raiseShoveSpeed` | 6 | Enough to put a body outside the rock's own footprint and no more; a large shove here would be a gust that cost Focus. |
| `raiseLiftSpeed` | 4 | Under the Vortex's *minimum* lift of 5. At gravity 20 that is 0.4 s off the ground — enough to cancel a wind-up through `stepEnemy`'s airborne branch, nowhere near enough to juggle. Gathering and lifting a group is air's payoff. |
| `raiseFocusCost` | 30 | See 7.2. |
| `raiseBreathCost` | 18 | **Exactly the Ice Lock's, and equal on purpose.** Breath is not where either heavy verb is priced; the differentiation belongs in Focus and in what they do, not twice over in a second meter. Asserted against `freezeBreathCost` rather than the literal. |

### 7.1 Why a cooldown and not a wind-up

Earth's identity is commitment, and a wind-up is the more faithful expression of it. It was
rejected on a measurement rather than on taste: **no player move in this game has one.** The Vortex
charges, but charging is the *heavy* key's gesture and it produces a stronger move for longer
holds, which is the opposite of a commitment you cannot back out of. Adding a wind-up to the light
key would have meant a new piece of player state, a new refusal for `main.ts` to draw, and a tell
for a window during which the player is neither attacking nor able to stop — in exchange for a feel
this cooldown already delivers from the other side of the press.

### 7.2 How the Focus spend was priced

The water note left open whether earth also spends Focus. **It does.** The alternative is worse: an
earth heavy verb priced only in breath would be hard cover on a fast-refilling meter, which is a
permanent answer to the archer for a price the player stops noticing. Focus is the one earned meter
in the game, and cover is exactly the kind of thing that should cost something earned.

**30, anchored to `damageDrain`, which is 30: a pillar costs precisely what taking a spear hit
costs.** That comparison is what decides the number, because it makes the trade legible without a
tutorial — the cover is priced at exactly the hit it is bought to prevent, so a pillar that stops
one arrow has broken even and one that stops three is a win.

Priced against water's 35 explicitly, since they share one bar and one Avatar State pip:

- **A freeze takes a whole rank out of the fight for 3.2 seconds** and is the strongest single
  effect the player can produce. A pillar does nothing to anybody — it changes the shape of the
  ground. The stronger effect keeps the higher price.
- **Against a full bar of 100:** three pillars, or two freezes, or **one of each with 35 left
  over**. That last line is the interesting one and it is deliberately affordable, because section
  4.2's own worked example chains water into earth, and a pricing that could not pay for the
  document's example sequence would be a pricing that contradicted the document.
- **Not four pillars from a full bar.** Both bounds are asserted, because either alone is
  satisfiable by a wrong number.
- **Against the Avatar State:** the state arms only from a bar held at maximum for `armSeconds` 4,
  so any spend at all destroys the pip. Adding a second Focus sink does not soften that trade.

One measurement that **corrected an assertion rather than the other way round.** The water cycle
pins that refilling one freeze takes longer than `armSeconds` at the best gain rate in the game.
The same test written for the pillar *fails*: at 30 against a best rate of 7.92 a second (clean
glide, doubled for riding a wind feature, times the maximum chain ramp) the pillar comes back in
about **3.8 seconds against the arming window's 4**, where the freeze needs about 4.4. So the
pillar sits on the other side of that particular line. The test now asserts what is actually true —
that the cheaper move is cheaper to recover from, which is what pricing it below the freeze *means*,
and that at a plain glide rate the climb back is several times the arming window.

### 7.3 The stone spends no Focus, and earns none

**Spends none:** section 4.5 gives Focus to "elemental heavy moves", and keeping light verbs free of
it is the clean rule.

**Earns none either, and that is a decision.** The stone does real damage, so the instinct is to pay
it per connect the way `hitThisFrame` pays a gust. It is deliberately not paid, because earth's
heavy verb spends 30: a light verb earning 5 or 6 a connect would let earth **fund its own cover** —
six stones and the pillar is paid for. That prices the pair twice and is the exact mistake the water
note names when it explains why neither water move pays. Earth is still paid for what it achieves:
`firstDownsThisFrame` pays for putting a soldier down, and putting a *heavy* down is the thing earth
exists to do.

`stoneHitThisFrame` therefore exists for feedback only, disjoint from the Focus lists — the same
standing `redirectHitsThisFrame` has, and it is threaded into `impactTargets` so a rock landing
still produces a burst.

---

## 8. What the tests found

Fifty mutations were applied and **all fifty redden a test**. Four survived the first pass, and each
was a real gap rather than a redundant mutation. They are the interesting part of this section.

**A geometry test that could not tell three rules apart.** `pillarBlocks` samples the height where
a step *enters* the footprint. Replacing the near root of the quadratic with the far one — sampling
the exit instead — left every assertion green, because on a *descending* path both crossings sit
under the pillar's top and either rule blocks. A climbing shot separates them, and there is now a
test for one: an arrow loosed from below that clips the near face low down and would emerge above
the cap.

**A symmetric sweep that could not catch a missing `isTargetable`.** The agreement test between
`anyLiveStoneThrowTarget` and its list form put the live soldier at `(x, z)` and a corpse at
`(−x, z)`. The cone is symmetric about its axis, so the corpse was inside it exactly when the live
soldier was, and the two forms agreed however wrong either was — removing `isTargetable` from the
predicate passed. The corpse is now parked permanently inside the cone, so every arrangement where
the live soldier is out of reach is a case where a predicate counting bodies answers true against an
empty list. **This is the same class of defect the water cycle's downed-body mutation found**, in a
different disguise: a fixture arranged so the wrong answer and the right one coincide.

**Nothing was holding the one-frame cooldown rule.** The stone's branch is gated on
`canStone(encounter, …)` — the pre-step value, which is what the action guide reads — rather than on
the copy `stepEncounter` has already decremented. Swapping one for the other left the suite green,
and the bug it produces is the one the water note lists among its four: a move that fires a frame
before the panel admits it can. There is now a test that presses on exactly the frame where the
cooldown is positive but smaller than a step, and asserts the refusal, then asserts the fire on the
frame after.

**Reordering `ELEMENT_ORDER` broke nothing.** Every test in `element.test.ts` derived its
expectations from the array itself, so `['air', 'earth', 'water']` passed the whole file while
silently reassigning two flick directions and making four descriptions in the guide and the README
wrong. Two assertions were added; see section 6.

Three further things were found by an assertion during development rather than by mutation, and all
three were the *test* being wrong rather than the code:

- Two lift assertions forgot that `stepEnemy` integrates gravity **after** the impulse lands, so the
  value a step returns is already a frame old. The comparison is now written as the arithmetic
  (`raiseLiftSpeed − gravity / 60`) rather than as a literal, which is also what keeps the armour
  ratio honest: the same frame of gravity is subtracted from both soldiers, so the *ratio* of what
  comes back is not the armour fraction. It reads 0.45 against a row of 0.5 — the kind of near-miss
  that invites someone to "fix" the config.
- A block-position assertion had its sign backwards. The arrow in that fixture flies toward +Z, so
  it meets the *more negative* face. It is now measured as a distance from the axis and bounded on
  both sides, so the dust lands within one frame's travel of the rock rather than merely on the
  right side of it.
- An effect-geometry width measurement used authored +Y where `sectorTheta` centres the span on
  −π/2, and reported π for every sector.

The mutation script is disposable and lives in the scratchpad rather than the repo. Its list is in
the cycle's final report.

---

## 9. Presentation

`src/fx/earth-reach.ts` draws the cone the stone actually sweeps, following `gust-cone.ts` and
`water-reach.ts` exactly: a filled sector at the true reach with a brighter arc travelling through
it, `MeshBasicMaterial` only, `depthTest: false` so terrain cannot bury it.

**The arc travels outward, which puts earth on the same side of the vocabulary as air**, and that
is worth saying out loud because the instinct is to give every element a distinct tell. A gust and a
thrown rock both send something away from the player, so they share a direction; what separates
them is width and colour. Water is the odd one — a grip travels inward because the soldier is about
to. Inventing a third direction for earth would have made the vocabulary arbitrary rather than
descriptive.

### 9.1 The pillar is a persistent view, not a pooled effect

`src/fx/pillar-view.ts` follows `arrow.ts` rather than the `Effect` contract, and this is a
correctness decision rather than a stylistic one. **`createEffectPool` caps at 24 live effects and
evicts oldest first**, so a six-second pillar is by a wide margin the oldest thing in the pool and
would be the first thing a busy exchange threw away. The rock would vanish while it was still
stopping arrows, which is the worst failure this object can have: invisible cover is cover the
player walks out from behind.

So it is drawn the way the arrows and the soldiers are — one view per record, keyed by id, created
on first sight, disposed when the record is gone. The fight's own `secondsLeft` is then the single
authority on how long the rock exists, in the mechanic and on screen at once.

It is also the one thing in `src/fx/` that is **lit and depth-tested**. Everything else there is an
attack tell, deliberately painted over the world so terrain cannot bury it. A pillar is not a tell;
it is a solid object the player judges distances against and stands behind, so it is occluded by
the hill in front of it exactly as a real rock is. Drawn over the world it would be the one object
in the game visible through terrain, which for a thing whose whole job is blocking line of sight
would be actively misleading. It casts a shadow, unlike every tell, for the related reason.

The rock rises out of the ground over 1/6 s and sinks back over the same, `ice-shell.ts`'s
forming/melting `Math.min` applied to a position instead of an opacity. **The mechanic leads the
visual at both ends, which is the safe direction:** the fight blocks for exactly `secondsLeft`, and
the rock spends the first and last sixth of a second partway out, so for a handful of frames the
cover is very slightly better than it looks and never once worse. Blocking only once the rock had
finished rising would be cover that fails on the frame the player raised it *for*. The sink matters
independently of looks: a rock that blinked out would give no warning that cover was ending, which
is the moment the player most needs to be moving already.

### 9.2 The mix

Two voices, and both had to fit under the invariant that `hurt` at 0.47 stays the loudest thing in
the fight by a 1.1 margin — a ceiling of 0.427, enforced by a test that derives `hurt`'s rivals from
the whole record.

- **`stone` at 0.26**, equal to `finisher` and tied to it by a test rather than by sharing the
  literal. They are the two committed damage presses in the kit — one at melee range with a staff,
  one at twelve units with a rock — and the mix has no business ranking them when the design
  deliberately does not. Above the gust's 0.22 and the grip's 0.2 because it is the light verb with
  mass and damage; **below `impact`'s 0.3**, so the throw is quieter than the blow it produces and a
  player who hears a throw with no impact knows they missed. It is the only light verb built from a
  `thud` rather than a pure `burst`: the three moves on one key are told apart by material rather
  than by level, which is the principle `clang` follows against `impact`.
- **`pillar` at 0.4**, just under the Ice Lock's 0.42. The two heavy verbs sit adjacent at the top of
  the player's own voices in the order of what they cost — 35 against 30 — because that is the one
  ranking between them the player can verify by watching the meter. Deliberately *not* built like
  the freeze, which is the obvious template: a freeze is a crack with a detuned beat chosen to be
  unpleasant, and a pillar is reassuring, because the player pressed it to be safer. Two moves that
  cost nearly the same should not sound the same; what they cost is on the meter and what they *do*
  is what the ear is for.
- **`pillarBlock` at 0.09**, the second-quietest voice in the game after the element switch. It fires
  as often as the archers shoot, so any weight would make it one of the most-heard sounds in the
  game. It exists at all because an arrow that vanishes silently is indistinguishable from an arrow
  that was never fired — the argument `deflectedThisFrame` makes on the enemy side. Cover the player
  cannot hear working is cover they will not learn to stand behind.

### 9.3 The colour, which was found by looking

The badge and wedge colour is `#d9a066`, the sandstone the reach is drawn in. Warm and light rather
than a realistic rock grey, because a grey-brown effect over grey-brown ground is one nobody sees —
the hazard `gust-cone.ts` records its first pale-blue pass disappearing into. Not gold, which is
reserved for "charged" and "this will land". And kept on the brown side of warm rather than reaching
toward flame, because fire is next and will want red and orange.

**The pillar's own tint took two wrong attempts and a browser to settle, and this is the one defect
in this cycle that no test could have caught.** The reach is an unlit `MeshBasicMaterial` painted at
exactly its tint; the pillar is a `MeshLambertMaterial` the light multiplies, so the same hex is two
different colours and the lit one is always darker. Built at `0xe0ae78` — a value that reads as
sandstone written down — the rock rendered a muddy chocolate brown against the pale green, close
enough to `props.ts`'s `TRUNK_BROWN` of `0x6b4f35` that a raised pillar looked like a tree stump,
which is precisely the "visibly not architecture" property it was supposed to have. Desaturating
instead, to `0xd9c9a3`, went the other way into a grey-khaki that drifted toward the terrain green.
It ships at `0xf2b877`, brighter and still warm, which separates from the green, the sky and the
trees at once.

Looking also confirmed the two things about the rise that only a still frame can show: a half-risen
pillar reads as rock coming up *through* the surface rather than growing, and the reach cone draws
over the rock rather than behind it — correct, since `depthTest: false` is the convention every
attack tell in `src/fx/` follows so terrain cannot bury it, and a pillar is the first solid object a
tell has had to overlap.

---

## 10. The three per-element ternaries in `main.ts`

The water note left these open and predicted the fix: "Fine for two elements, a small lookup at the
third." Earth is the third, and `LIGHT_VERB_PREVIEWS` is now a `Record<Element, …>` folding in two
of the three — the `aimHot` query and the aim tell's shape, which are asked in one place. A Record
rather than a switch, so fire fails to compile there rather than silently inheriting air's preview:
the failure mode of a fallback is a reticle promising a gust's 120-degree reach for a move that
does not have it.

The third — the light verb's fired cone effect — deliberately stays where it is, because it is drawn
from the fight's own report (`stoneFired`, `gripFired`) rather than from a pre-step guess. Only the
gust is drawn from the press, and only because it has no affordability condition this file can see.

Only the air entry passes `enemies`, and the asymmetry is deliberate. A heavy's armour turns a gust
away entirely, so that tell stays cold on the heavy and warm on the spear beside it — the armour's
first and cheapest lesson. Water has nothing to say there, and **earth has nothing to say because
nothing deflects a stone at all**: a preview that went cold on an armoured target would teach the
exact opposite of the truth about the one move that breaks armour.

---

## 11. Left open

- **Enemies walking round a pillar**, which needs an enemy collider. Section 5.2. The same cycle
  the earthbender duelist needs.
- **A standable pillar top**, which is the other half of that: it needs the ground snap to be able
  to report a non-island surface without corrupting `lastGroundIslandId`.
- **The earthbender duelist** of section 4.4. Removing the player's cover is expressible today —
  it is a pillar record to delete. Removing landing spots is terrain deformation and is not.
- **Act gating**, at `isElementAvailable`. Water and earth are in the same act, so whatever gates
  one gates the other.
- **Whether fire also spends Focus.** There are now two sinks priced against each other at 35 and
  30, and a third would have to be priced against both — a full bar buys three of the cheapest
  today, and a fourth sink is the point at which "any spend destroys the Avatar State pip" starts
  to mean the state is never reached.
- **The last per-element ternary in `main.ts`.** Section 10.
- **Whether the stone should pay Focus on connect.** Section 7.3 argues no, on the double-pricing
  rule. It is the first thing to revisit if earth turns out to feel unrewarding to land.
