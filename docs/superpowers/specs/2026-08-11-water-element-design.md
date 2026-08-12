# Water, and the element radial

**Cycle:** the first borrowed element, plus the switching infrastructure earth and fire will extend.
**Authority:** `docs/design/aang-playable-character.md`, sections 4.2, 4.5, 4.6 and 5.
**Status:** implemented, typechecked, tested, mutation-verified. Unplayed — every tuning number in
here is an argued guess.

---

## 1. What this cycle is really for

Water is the visible half of the work. The load-bearing half is the contract in section 2 below,
because the reason water went first is that it forces the switching infrastructure into existence,
and earth and fire have to be additions to that infrastructure rather than rewrites of it.

The precedent this repo trusts is the archer: a second enemy kind was added to `src/combat/enemy.ts`
by widening one union and adding one config entry, with no new state machine and no branch in the
step function that says "if archer". The element system is built to be extended the same way.

---

## 2. The contract earth and fire plug into

**Read this section before writing a line of earth or fire.**

### 2.1 The elements share the two bending keys

`F` is the active element's **light verb**. `R` is its **heavy verb**, pressed and released.

| | Light (`F`) | Heavy (`R`) |
|---|---|---|
| Air | Gust | Vortex — charges while held |
| Water | Water Grip | Ice Lock — no charge, fires on release |
| Earth | *(raise / throw)* | *(wall, or the committed slam)* |
| Fire | *(burst)* | *(propulsion, or the committed lance)* |

This is the decision the whole design turns on, and the alternative was considered and rejected. One
key per move per element would make the radial decoration: if freeze had its own key you would never
switch, and section 4.2's own example sequence — "vortex a group, freeze the front rank, drop a
pillar under them" — would be three unrelated presses rather than a sequence. It is also the only
binding scheme that survives four elements: the game does not have six more free keys.

The consequence for earth and fire is that **you do not get new keys, and you should not want them.**
Each element gets one quick verb and one committed verb, and if a design needs a third, it needs a
different design.

### 2.2 Adding an element, step by step

1. **`src/elements/element.ts`** — add the name to the `Element` union and append it to
   `ELEMENT_ORDER`. Appending is all the radial geometry needs: `radialHighlight` divides the circle
   by `ELEMENT_ORDER.length`, so the wedges lay themselves out. **Do not reorder the existing
   entries** — see section 4.2.
2. The `Element` union then breaks the compile in three places, deliberately. Each is a
   `Record<Element, …>` with no fallback, so the element cannot ship undescribed:
   - `LOOKS` in `src/ui/element-radial.ts` — a label and a colour for the wedge and the badge.
   - `ELEMENT_LEGEND` in `src/ui/guide/reference.ts` — one line on what the element is *for*.
   - (Nothing else today. If you add a per-element lookup, use a `Record` and not a switch.)
3. **`src/combat/<element>.ts`** — a new module beside `water.ts` holding the two verbs' config type,
   their cone shapes, their target queries and their `can*` predicates. Follow `water.ts`: geometry
   queries filter by geometry *only*, and `stepEncounter` applies `isTargetable` itself.
4. **`src/combat/encounter.ts`** — add the config to `CombatConfig`, add any cooldown to `Encounter`,
   and add two blocks gated on `input.element === '<element>'`. Four rules, all of which cost real
   bugs when broken (section 6 records the two that actually bit):
   - Every cooldown decrements **every frame, whatever element is selected.** Otherwise switching
     away parks a cooldown and the player launders one move's recovery inside another element.
   - Each element's light verb gets **its own cooldown field.** A shared "light verb cooldown" lets
     an element switch convert the shorter cooldown into the longer one.
   - Gate both the **charge accumulator and the release** on the element. Gating only the
     accumulator leaves a one-frame hole where switching and releasing on the same frame fires two
     heavy moves.
   - Report costs as `focusSpent` / `breathSpent`; never hold a meter inside the fight.
5. **`src/ui/guide/actions.ts`** — two rows, `available: (ctx) => bending('<element>')(ctx) && …`,
   plus a readiness flag on `ActionContext` per verb, asked in `main.ts` through the element's own
   exported predicate. Never restate a rule in the panel.
6. **`src/fx/`** — effects following `water-reach.ts` and `ice-shell.ts`. See section 5 for the two
   rendering traps and why neither file goes near them.
7. **`src/main.ts`** — the wiring is already generic except for the per-element `if` in three places:
   the `aimHot` query, the aim tell's shape, and the light-verb cone effect. Each is a ternary today
   and will want to become a small lookup at the third element.
8. **`README.md`** — the controls table *and* the prose. `actions.test.ts` compares the table's keys
   against the catalogue in both directions and will fail until you do.

### 2.3 Invariants earth and fire must not break

- **Switching is free.** No cooldown, no charge, no animation lock, no refusal. `ElementState`
  carries exactly `active` and `aim`, and `element.test.ts` asserts those are its only two keys
  precisely so that adding a cooldown reddens a test rather than quietly landing.
- **`isTargetable` is the gate every resolver asks, and it is asked identically.** If a new
  condition should be targetable by some moves and not others, add a predicate beside `isHeld` —
  do not make one resolver's gate special. Water proved why: making `isTargetable` refuse a frozen
  soldier would have stopped the staff hitting one, which is backwards.
- **A refused move costs nothing.** No resource, no cooldown, no effect, no voice. A press the game
  declines must not be a press the player is charged for.
- **Effects fire on the attempt, not the connect** — but only after the fight has confirmed the move
  actually fired, since affordability is invisible to `main.ts`. That is what `gripFired` and
  `freezeFired` are for; earth and fire want the same pair.
- **Air is never gated.** It is the baseline; `isElementAvailable` may refuse borrowed elements when
  acts exist, but air is what the player always has.
- **Every move an element throws needs a `BendingSource` and an armour row.** Water did not have one
  when it shipped: `BendingSource` named only the four air moves, so `ArmourTable` had no row for a
  grip or a freeze, `deflects` could not be asked about either, and the heavy armoured soldier — the
  one type built around refusing a blow — had no defence against water at all. Nothing said whether
  that was intended, because there was nowhere to say it.

  That is closed. `BendingSource` now carries `'grip'` and `'freeze'`, and both water resolvers
  consult the table: the grip scales its impulse through `throughArmour` and skips a soldier whose
  row is a full deflect, and the freeze — which has no damage and no impulse to scale — skips on a
  full deflect and reports it. Earth and fire must do the same, and the `Record` is total, so
  forgetting is a compile error at every armour table rather than an `undefined` when a blow lands.

  **This matters most for earth**, which section 4.4 names as the heavy's designed answer alongside
  the environment. Earth arrives with the heavy's armour rows already waiting for it, and the row it
  is given is the whole of whether the design document's claim is true.

### 2.4 The two things water did *not* establish

**Focus.** Water spends it; air does not. Whether earth and fire also spend it is open, and it is a balance
question rather than a contract one. What the contract fixes is only the *mechanism*: `focusSpent` on
`EncounterStep`, applied unramped in `stepFocus`. If two elements both spend, they share one bar and
that needs pricing against each other as well as against the Avatar State.

**The heavy's rows for earth and fire.** The armour *mechanism* now covers any element (see 2.3),
but only water's two rows are filled in. What plate should do to a raised pillar or a fire burst is
undecided, and for earth it is not a detail: section 4.4 makes earth the answer to this type, so
whichever fractions earth is given are what make that sentence true or false.

---

## 3. Water: the decisions

### 3.1 Three verbs, two moves

Section 4.2 gives water "pull, hold, freeze". That is not three buttons — pull and hold are one
gesture and freeze is its escalation:

- **Water Grip** (`F`) yanks everyone in a narrow forward reach toward the caster and holds them
  briefly. No damage.
- **Ice Lock** (`R`) freezes a wider, shorter band where it stands. No pull, a much longer hold,
  costs Focus. No damage.

They are one kit rather than two moves because they write one field — `Enemy.heldSeconds`, through
`holdEnemy`, taking whichever hold is longer. Gripping a group drags it into one place; freezing it
locks that place down. Grip is the setup and freeze is the payoff, which is the relationship the
Vortex already has with the rest of the air kit.

**Neither does any damage, and neither has a damage parameter.** Water is the control element. The
defence `vortex.ts` gives for having no damage field applies with more force here: water has two
moves, and a config that could grow damage on one of them would make it a strictly better gust —
denial *and* chip damage for the same key.

### 3.2 What was deliberately not built

Section 4.2 also asks water to *extinguish fire hazards* and *turn pooled water into a hazard
surface*. **Neither is built, because neither has anything to act on.** There is no pooled water
anywhere in the archipelago and no fire hazards. Inventing either to justify the verb would be a
world-content cycle wearing a combat cycle's clothes, and the hazard surface in particular needs a
water plane, a "standing in it" query and a slip model — none of which is a combat change.

They are the right next cycle for water, and they should arrive together with the world content they
act on rather than ahead of it.

### 3.3 The waterfall source requirement: rejected, with the measurement

The question was whether water can only be drawn near a source, using the six waterfalls in
`src/world/waterfall.ts` — the only visible water the game has.

**The argument for it was real.** A source requirement makes the element positional, which suits a
game whose entire defence is positional, and it would give the waterfalls a mechanical job instead of
a decorative one. It is also the more faithful reading of waterbending.

**It lost on a measurement, not on taste.** The archipelago's only encounter is `HOME_PATROL`, on the
home island's +X/−Z side at radius 18 to 55. The home island's two waterfalls are at rim angles 2.1
and 4.4 radians — the −X/+Z and −X/−Z rims. Neither is anywhere near the fight. A source requirement
would therefore not make water positional; it would make water **unusable in the only place the game
has to use it**, which is not a tuning problem but a shipped element that never fires.

So water is always available. The decision lives in `isElementAvailable`'s doc comment, which is also
where the requirement should be added when it becomes real. The right time is the same cycle that
adds pooled water and the hazard surface, because those share the world query a source rule needs —
and building "is there water within reach" for a rule that only *restricts* the player, with no rule
that rewards standing near a source, is the wrong half to build first.

### 3.4 Act gating

Section 5 puts water in Act 2. There is no act structure, so **water is available from the start** —
exactly as the Avatar State is, which section 4.5 story-locks to the early game and which the game
hands over on the first frame. `isElementAvailable` is the single gate to change when acts arrive:
the guide's strike-through, the radial's dimming and the resolvers all ask it, and none restates it.

---

## 4. The radial

### 4.1 Owner decision: it does not slow or pause anything

**This is an owner ruling, recorded so that whoever builds earth and fire does not relitigate it.**

The element radial must not slow or pause the game. Switching stays free and the simulation keeps
running at full speed while the radial is open. No time dilation, no hitstop, no soft pause, no input
gating. Opening it costs nothing: no windup, no animation lock, no dropped movement or attack input,
and it must not release the pointer lock — the guide panel deliberately does release it, and this is
the one place in the game that must not copy it. If holding the radial open swallows a control frame,
that is a bug rather than a tradeoff.

Two consequences follow, and they are why the design looks the way it does.

### 4.2 Muscle memory, not reading

Legibility cannot be bought with slowed time, so it is bought with permanence. `ELEMENT_ORDER` is
fixed and is never reordered by recency: a flick direction means the same thing every session, so the
gesture becomes muscle memory and the widget stops being looked at. Air is the home slot, straight
up, because it is the least deliberate flick the wrist produces and the element you fall back to
should cost the least to reach.

Direct number binds — `1` air, `2` water, with `3` and `4` already wired and inert — are not a
convenience. With no slow-motion to read a menu in, they are the path most players will settle on,
and the radial is what teaches the layout they then use without it.

### 4.3 Mouse-look is not swallowed

The obvious implementation diverts pointer movement into the radial while its key is held. That is
forbidden by the ruling, so the radial is fed the *same* movement the camera is fed. A flick that
picks water also turns the view — about 3 degrees at the dead zone and under 8 for a committed pick,
at default sensitivity. That view nudge is the deliberate price of never taking the camera away.

The pointer offset is accumulated in raw pixels, unscaled by sensitivity: the dead zone is a wrist
movement, and a player who turned sensitivity down to aim has not asked for a radial that needs a
bigger flick.

### 4.4 Where it is drawn

Anchored at 50% / 68% of the viewport — horizontally centred, in the empty band between the crosshair
cluster and the HUD meters. The middle of the screen is already three concentric rings deep: the
reticle at 20 px, the hit-direction wedges at 54–74 px, the off-screen threat chevrons at 84–104 px.
A radial around the aim point would have to start outside all of them and would still bury the two
rings that say where the player is being hit from — at exactly the moment they are being hit from
somewhere, since the radial is for use mid-fight. It can afford to sit elsewhere because the pointer
input is *relative*: the highlight follows the flick direction wherever the widget is drawn.

The badge — the radial's collapsed state, and the HUD indication of the active element — sits in the
HUD's own bottom-left gutter above the meters, so the player knows what a keypress will do without
opening anything.

### 4.5 The dead zone

24 pixels. Below it the radial highlights nothing and a release keeps what was already selected, so a
player who opens it and changes their mind can close it by letting go. It matters more with two
elements than it will with four: with two, the sector boundary runs along the horizontal axis, so
every direction that is not straight up or down is within a hair of a boundary. A third element makes
the geometry natural rather than merely workable.

---

## 5. Presentation

`src/fx/water-reach.ts` draws the cone each move actually sweeps, and `src/fx/ice-shell.ts` draws the
ice on a held soldier **for exactly as long as the hold lasts** — the rule `guard-shell.ts` follows
for the Slipstream's invulnerability window, because a tell that outlives its mechanic says a soldier
is locked when it is already winding up.

How the elements read apart without being read: **direction of travel.** A gust's bright arc travels
outward; a grip's travels inward, because the move drags a soldier back; ice does not travel at all.
That reuses the inward-versus-outward contrast `vortex-ring.ts` already draws against the Pressure
Wave, deliberately, so the game has one visual vocabulary rather than two. The audio does the same
thing: the grip's filter sweeps *up* where the gust's sweeps down, which needs no new synthesis
primitive — only the two arguments to `burst` reversed.

**Both rendering traps were avoided by not going near them, and the tests assert it.** No
`ShaderMaterial` anywhere: one that includes the `..._pars_fragment` chunks the renderer already
injects fails to compile nearly silently, and the mesh then simply does not draw — which looks like a
correctly transparent effect with the world showing through, and so can read as success. That failure
mode is *especially* dangerous for the ice shell, whose whole job is to show the enemy through it. And
no `PointsMaterial`: points draw screen-facing squares, so a spray of droplets approaching a world
unit reads as a white block up close, and a water effect thrown at melee range is nearer the camera
than any mote cloud. `water-reach.test.ts` and `ice-shell.test.ts` both assert
`material.type === 'MeshBasicMaterial'`.

The Ice Lock is the loudest voice in the fight — above `hurt`, and the only thing that is. It is the
one move that spends Focus, and a third of the bar is a bigger commitment than any single hit either
side of the fight takes, so the mix has to say so. The element switch is the quietest voice in the
game, under half the softest thing in combat: switching is free and happens several times an
exchange, and a confirmation with any weight would make a free action feel like a move.

---

## 6. What the tests found

Three things, all of which were wrong in the production code or in a comment, and all of which were
found by an assertion rather than by reading.

**A one-frame hole that fired two heavy moves for one press.** The vortex release was left ungated on
the element, on the argument that a charge cannot survive into water because the accumulator is zeroed
every frame water is selected. That argument is wrong by exactly one frame: the `else` that zeroes it
is guarded on `!vortexReleased`, so on a frame where the player switches to water *and* lets go of
`R`, the charge built under air is still standing. A player who charged a vortex, pressed `2` and let
go on the same frame got a full-strength vortex *and* an Ice Lock, and paid Focus for the freeze.
Fixed by gating the release; pinned by two tests.

**A doc comment that described the opposite of the code.** `stepElements` claimed a direct number bind
wins over a radial release landing on the same frame. Statement order made the release win. The rule
in the comment is the better one — a named element is unambiguous where a release may be inside the
dead zone — so the code was fixed to match, and the precedence is now pinned.

**A config number that did not do what its comment said.** `gripHoldSeconds` was 1.2 against a spear's
full exchange of `windUpSeconds` 0.55 + `recoverSeconds` 0.7 = 1.25. A gripped spear was released a
hair *before* it would have finished the thrust the grip interrupted — a hold that cost the soldier
nothing. Now 1.4, and the test asserts against the sum rather than the literal, so a retune of either
enemy number moves the requirement with it.

Two further gaps were found by mutation testing rather than by a failing test, and both were tests
that could not fail:

- The downed-body test for the grip asserted only the report list and the stance, and **survived
  removing `isTargetable` from the resolver** — because `holdEnemy` refuses a downed soldier on its
  own, so the stance stayed correct. What the gate actually protects is the *pull*: without it, a
  corpse in the cone is yanked across the island. The test now asserts the knockback, with a live
  soldier as the positive control.
- Nothing tested that mouse-look survives while the radial is held, so **the forbidden
  implementation passed** — diverting movement away from the camera reddened nothing. Now tested
  against the identical movement with the radial closed, so the two are equal rather than merely both
  non-zero.

58 mutations were applied and all 58 redden a test. The script is disposable and lives in the
scratchpad, not in the repo; the list of what was mutated is in the cycle's final report.

---

## 7. The numbers, and what each is anchored to

Every value is in `DEFAULT_COMBAT_CONFIG.water`, with its argument on the field it belongs to in
`src/combat/water.ts`. None of it has been played.

| Value | | Anchored to |
|---|---|---|
| `grip.range` | 10 | Under the gust's 12: water is drawn and directed rather than swept. |
| `grip.halfAngle` | 30° | Half the gust's 60°. Given the gust's width it would be a strictly better gust — it denies where a gust shoves. |
| `freeze.range` | 8 | Shorter than the grip: freezing is stronger, so it works closer. |
| `freeze.halfAngle` | 72° | "The front rank" — a group at conversational distance. Wider than the grip and shorter, so neither is strictly better. |
| `verticalReach` | 3.0 | **One number for the whole element.** Second shortest of the six bands: above the staff's 2.0 (this is bending, not a stick), below the wave's 4.0, the gust's 5.0 and the Vortex's 8.0. The deciding argument: a control move that reaches high wins fights from a hover with no counterplay, because a frozen soldier cannot answer at all — so denial is paid for with proximity. A test pins that a player hovering just out of water's reach is still inside an archer's. |
| `pullSpeed` | 12 | Against `knockbackDamping` 2.6, drags 4.6 m — out of a spear's `strikeRange` 3.2 and into the staff finisher's 4.2. Under the Vortex's max pull of 18. |
| `gripHoldSeconds` | 1.4 | Past a spear's whole exchange, 1.25. See section 6. |
| `gripCooldownSeconds` | 1.1 | Above the gust's 0.45 (denial costs more than a shove), and deliberately *under* the hold — so one target can be chain-held at the cost of the entire light-verb budget, for no damage. Buys time, not progress, exactly as §4.6 describes standing over a rising soldier. |
| `gripBreathCost` | 12 | Well under the Slipstream's 28. The grip's real price is its cooldown; breath is a rate limit on mashing. |
| `freezeHoldSeconds` | 3.2 | More than twice the grip. Far under the downed timer's 18 (a lock, not a knockdown) and under the Avatar State's 8 (not most of a state for a third of the price). |
| `freezeFocusCost` | 35 | See below. |
| `freezeBreathCost` | 18 | Above the grip's, because it is the committed move. Low against the Focus price, because two meters gating one press is one more refusal to diagnose, and Focus is the gate meant to be felt. |

### 7.1 How the Focus spend was priced

Section 4.5 says Focus "spends on elemental heavy moves". This is the first such spend the game has,
and it is what makes Focus a resource rather than only a gauge. 35 of `maxFocus` 100, priced against
what a full bar is worth today:

- **Against a spear hit.** `damageDrain` is 30, so a freeze costs a shade *more* than getting hit.
  That is the comparison that decides the number: the player should feel a freeze in the meter the way
  they feel taking damage, or it is not a decision — and it has to be the worse of the two, so that
  freezing never reads as cheaper than being hit.
- **Against a knockdown.** `downGain` is 14, so a freeze costs what two and a half knockdowns pay.
- **Against traversal.** A clean glide fills 100 from empty in roughly 45 seconds unramped, so a
  freeze is about 16 seconds of clean flying.
- **Against the Avatar State.** The state arms only from a bar held at maximum for `armSeconds` 4, so
  any spend at all destroys the pip. At 35, one freeze from full leaves 65 and the state is a long way
  off; two are affordable and then the bar is empty. A test pins that refilling one freeze takes
  longer than `armSeconds` at the best gain rate in the game, so the climb back is real.

Two freezes from a full bar, and not three: the move is genuinely usable, and a full bar is not an
indefinite lockdown. Both bounds are asserted.

Deliberately **no cooldown on the freeze.** Focus is the price, and a hidden timer on top would refuse
the move for a reason the player cannot see — the HUD draws the Focus bar and does not draw a
cooldown.

---

## 8. The enemy side

`src/combat/enemy.ts` gained a hold, kept as small as it could be because a parallel branch is adding
enemy kinds to the same module:

- `'held'` on the `Stance` union.
- `heldSeconds: number` on `Enemy`, initialised to 0 in `spawnEnemy`.
- `holdEnemy(enemy, seconds)` — takes the longer of the hold running and the new one, refuses a downed
  soldier, resets `stanceTime` so the hold interrupts, and touches no physics.
- `isHeld(enemy)` — the separate predicate, so `isTargetable` did not have to change.
- A three-line preamble in `stepEnemy` that shadows the parameter with the hold decremented once.
  Every return in that function spreads `...enemy`, so decrementing at the top makes it impossible for
  one of the eight exits to forget the countdown — a per-branch decrement would eventually acquire a
  path that skips it, and it would present as a soldier frozen forever on one code path only.
- One inert branch, above the airborne branch so that freezing a Vortex-lifted target does not fall
  through, releasing into `'recover'` rather than `'advance'`.
- Two clauses in `hitEnemy`: preserve `'held'` through a hit, and clear `heldSeconds` on a down.

**Section 4.6 lists *frozen* explicitly among the legitimate downed conditions**, alongside disarmed
and buried to the waist, so a held soldier is on-theme non-lethality rather than an exception. A held
soldier still falls, still settles, and still goes down by leaving the world — all three tested,
because the hold must not make a soldier immune to the one removal that is not damage.

---

## 9. Across a respawn

`recover()` in `main.ts` deliberately does nothing about either, and the comment there says so:

- **A held soldier keeps its hold.** Section 6 says the fight "keeps whatever state he put it in", and
  a hold is fight state exactly as damage and stance are. Releasing the patrol on a respawn would hand
  the player a clean reset they were told they would not get, and freezing a rank and then going down
  on purpose would become a way to unfreeze it. In practice nothing survives the beat — the longest
  hold is 3.2 seconds against the down ramps — so this is a guard rather than a fix, the same standing
  the `hitMarks` clear has, and written down for the same reason.
- **The selected element survives, and Focus does not.** Focus is wiped because it was *earned* and
  section 6 names it as part of the cost. The element was not earned: it is a stance, like the
  direction the character is facing, which `recover()` also does not reset. Re-picking it after every
  knockdown would be busywork punishing nothing, and it would silently revert the badge behind the
  blackout.

---

## 10. Left open

- **Water's other two verbs**, with the world content they need. Section 3.2.
- **The source requirement**, when there is more than one encounter and pooled water. Section 3.3.
- **Act gating**, at `isElementAvailable`. Section 3.4.
- **A held-soldier visual on the rig itself.** The ice shell is placed once at the freeze point and
  does not follow the body, because the `Effect` contract has no hook for tracking a target and the
  alternative would put the fx layer inside `combat/enemy-mesh.ts`. The cost is bounded and known: a
  soldier frozen while still sliding from an earlier gust drifts out of its shell over roughly 0.4
  seconds. Freezing a stationary soldier drifts not at all.
- **The three per-element ternaries in `main.ts`** — the `aimHot` query, the aim tell's shape, and the
  light-verb cone effect. Fine for two elements, a small lookup at the third.
- **Whether earth and fire also spend Focus.** Section 2.4.
