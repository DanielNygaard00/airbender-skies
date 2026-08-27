# Elemental combos — design note

**Step C of the visual arc.** The arc is A (the lit world, landed 2026-08-14) → C (this note) → B
(elemental visual effects) → D (explorability). C comes before B because a cross-element reaction
is a new visual by definition, and authoring water's effects before knowing that water also has to
become steam means authoring them twice.

The owner's ask for this step was combinations with a single element and across several, plus
weapon swapping in the shape Ghost of Yotei uses. What follows is two small systems that together
deliver that, and a deliberate refusal to add a third.

---

## 1. What the code already decided, and must keep

Three rulings already in the codebase constrain this design more than the design document does.
Every one of them was found by reading the modules rather than the docs.

**`focus.ts` already spent the word "chain".** §4.5 has Focus build "from unbroken chains", and
`focus.ts` encodes that as *a ramp on the gain rate*, explicitly "rather than as a separate combo
counter". Its `chainTime` breaks on damage and on a crash, not on a missed press. So a combo
counter that also fed Focus would be a second chain concept competing for one meter, and the
module that owns the meter has already argued against it. **Consequence: combos pay in mechanics,
never in Focus.** `focus.ts` and its config are untouched by this step.

**`enemy.ts` already set the shape of a status.** Gripped and frozen share one `heldSeconds` field,
specifically so that the two "cannot disagree about whether a soldier can act". A bag of
per-element statuses would fight that instinct directly. **Consequence: one new field on the enemy,
not a set.**

**`encounter.ts` keeps the five cooldowns independent and never shares them**, because a shared
timer "would let switching element launder one move's cooldown into the gust's 0.45". A combo
reward that shortened a cooldown would reintroduce exactly the exploit that reasoning exists to
prevent. **Consequence: the chain changes what a move does when it lands. It never changes when a
move may be pressed.**

A fourth constraint comes from the owner rather than the code: fire may thrust in the air, never
paid in Breath, and never on the ground. No reaction in this step grants thrust of any kind.

## 2. The two systems, and why they are two

| | Rewards | Lives on | Payoff |
| --- | --- | --- | --- |
| **The chain** | sequencing *length* | the player | the top link lands as a finisher |
| **Marks** | sequencing *variety* | each enemy | a reaction fires |

They are separate because they answer different questions and would be worse fused. A single
mechanism that both counted presses and tracked what each soldier was last hit by would be a
player-side counter pretending to be a per-target status — and for a crowd-control fighter the
interesting unit is "that soldier is wet", not "I have pressed four things". Keeping them apart is
also what lets a string built on one soldier pay off on a different one.

## 3. The chain

A new module, `src/combat/chain.ts`, holding a small state machine:

```
links: number          // landed links in the current string, 0..maxLinks
sinceLink: number      // seconds since the last link landed
```

**Only a landing advances it.** A gust that connects with nobody does not count, on the same
grounds `focus.ts` pays `gustConnectGain` on connect: a chain built by pressing keys at empty air
would make the finisher free, and the finisher is meant to be the reward for pressure actually
applied. Staff swings that connect advance it too, so a staff string can end in a bending finisher.

**A swap never resets it.** This is the whole Ghost of Yotei property and it is one rule rather than
a feature: `element.ts` already ruled that switching is free, instant, uncooled and interrupts
nothing, so mixing air → water → earth inside one string is already physically possible; the chain
simply declines to punish it. Nothing else in this step is needed to make swapping feel like Yotei's
does, because the swap was already instant — what was missing was a reason to do it mid-string.

**The window is its own value, not the staff's.** `DEFAULT_STAFF_CONFIG.continueSeconds` is 0.3s,
tuned for repeated presses of one key. Switching element costs a radial flick or a number key
*plus* a press, so a 0.3s window would make mixed strings impossible and quietly turn the chain
into a staff-only mechanic. The seed value is **0.9s**, to be retuned once played.

**`maxLinks` is 3**, matching `DEFAULT_STAFF_CONFIG.maxChain`. Not for symmetry's sake: three is
the number of landings the staff already proved a player will commit to before the risk of standing
still outweighs the payoff. An earlier draft added that a four-link string "would run past the 0.9s
window on most pairings anyway", which is not true and rests on the same misreading corrected
below: the window is per-gap, not per-string, so a fourth link needs only a fourth gap under 0.9s.

**The staff advances the chain but writes no mark.** It is not an element, so it has no pairing to
look up and nothing to leave behind — `ReactionKind` is indexed by `Element`, and giving the staff a
row would mean inventing a fifth element for a weapon the design document deliberately keeps
separate from bending. A staff string ending in a bending finisher is the intended use.

That window meets the real cooldowns, and the first version of this section got the meeting
backwards. The cooldowns, for reference:

| move | cooldown |
| --- | --- |
| gust | 0.45s |
| water grip | 1.1s |
| fire burst | 1.2s |
| stone throw | 1.8s |
| vortex | 3.5s |

**The window is measured from each landing, not across the string.** `landChain` resets `sinceLink`
on every landing, so what a string needs is a *gap* under 0.9s between consecutive landings — not a
total under 0.9s, and not a cooldown under half of it. That distinction is what the original claim
got wrong. For the grip, the burst, the stone and the vortex the conclusion survives on its own
terms, because each of those cooldowns is *longer* than the whole window and a second landing is
simply not available in time. For the gust it does not: 0.45s is exactly half of 0.9 rather than
under it, so three gusts thrown on cooldown are two 0.45s gaps, which is a complete string.

**And the staff, left out of that table entirely, is the source most able to self-chain.** At
`swingSeconds` 0.26 an ordinary three-swing combo spans 0.52s, comfortably inside one window, so
one combo is a finished string every time. The verb that needs no element switch and writes no mark
turns out to be the cheapest route to the chain's reward — which is a real design question for the
play-test, not a bug.

**What actually gates a single-verb string is displacement.** Each landing's own knockback and lift
put its target outside the next press's `range` and `verticalReach` for the next half-second, and
that, rather than any cooldown, is why the gust cannot chain into itself. Variety is still the
quicker route to a finisher without a line of code rewarding it directly, and the conclusion of the
original paragraph survives — but the mechanism doing the teaching is the knockback column, so a
retune has to be read against `range` and `verticalReach` rather than against the cooldown table.

### 3.1 What the shipped numbers do, measured

Everything above was argued from the config. The figures here were **measured**, by driving
`stepEncounter` frame by frame on `DEFAULT_COMBAT_CONFIG` and reading the step's own reports — not
predicted, and not played. They are what corrected the three claims above.

- **Eight seconds of unbroken gust pressure on a lone spear: zero finishers.** Three gusts land in
  those eight seconds. The first throws the soldier past the gust's own `range` of 12 — it ends the
  run 20 units out — and the rest of the time it is walking back in. Displacement, not the 0.45s
  cooldown, is what stops the gust chaining into itself.
- **One ordinary three-swing staff combo: exactly one finisher, every combo.** Three landings in
  0.52s, no element switch, no mark written.
- **The worked example this note used to offer does not land.** "Gust into grip into burst is three
  landings inside about a second" — the gust and the grip land, and the burst misses. The gust
  throws a spear to 7.1 units by 0.17s after the press and 8.6 by 0.45s, against the burst's `range`
  of 7. It only connects if all three presses fall inside about 0.08s of each other, which is not an
  input a player produces. **This is the displacement gate acting on a mixed string too**, which is
  the part the original claim missed.
- **Two sequences that do work.** `grip → burst → stone` on a heavy: all three land, the stone is
  the finisher, and the burst also steams the soldier the grip left wet. `staff, staff, gust` on a
  heavy standing beside a spear: the spear is what makes the gust's third landing possible, and the
  finisher displaces the heavy that a plain gust cannot touch.
- **Reactions are rarer than the table suggests.** Ten seconds of grip and stone pressed on
  cooldown — the ideal Mud loop, nothing wasted — fires **one** Mud on a spear and three on a heavy.
  The spear is knocked down by the stone that muds it; the heavy is not, and the difference is
  `armour.stone`'s knockback of 0.6.

The through-line: **finishers and reactions are harder to reach than this note assumed**, and
outside the staff the reason is always the same one — the game's own knockback moves the target out
of the next press's reach. §9's risk list is corrected to match.

**What the finisher does: its knockback ignores armour.** One rule for all four elements, no
per-element table. §4.4 gives the heavy armoured soldier "knockback economy" to pressure and makes
it immune to gusts — `armour.gust` is `{ damage: 0, knockback: 0 }` — and §4.4 says it "must be
broken with earth or the environment". The finisher adds a third answer that is earned by
sequencing rather than granted by an element, and it pays in *displacement*, which is the currency
this character actually fights in: a soldier moved is a soldier off a ledge, out of a spacing, or
into another soldier.

**The finisher pays no extra damage, deliberately.** §4.1 says Aang "is not a damage-per-second
character, and the systems are tuned so that trying to play him as one fails". A damage multiplier
on a three-link string is precisely the DPS ladder that sentence forbids.

**`StaffState` is left alone.** The first sketch of this design generalised it in place; reading it
showed why that is wrong. `StaffState` governs the staff's own timing — `swingSeconds`,
`recoverySeconds`, and the `staffBusy` gate that enforces §4.2's no-glide-while-swinging rule.
Those concerns are the staff's, not the kit's, and folding a kit-wide counter into the module that
gates gliding would entangle two things that change for different reasons. The chain is additive
and `staff.ts` keeps its own chain.

## 4. Marks and reactions

One new field on `Enemy`, following `heldSeconds`'s precedent:

```
mark: { element: Element; secondsLeft: number } | null
```

Any bending verb that connects writes the mark for the element that threw it. When a verb of a
*different* element lands on a marked soldier, the pairing is looked up and the reaction — if the
pairing has one — resolves immediately, and the mark is consumed.

**Reactions resolve at once and leave no state behind.** They are expressed only in effects the
game already has: damage, knockback, and `heldSeconds`. Nothing lingers, which is what keeps this
step small; a reaction that needed its own timer would need its own field, and the one-field ruling
above is what stops the enemy struct from becoming a status bag.

**The table is exhaustive by type.** `Record<Element, Record<Element, ReactionKind>>` — sixteen
cells, every one decided, with `'none'` an argued choice rather than a gap. This is the device
`LOOKS` in `element-radial.ts`, `WIND_LEGEND` in `src/ui/guide/reference.ts` and the per-kind
`armour` tables already use: a fifth element fails to compile until every pairing with it has been
ruled on. (`wind.ts` defines `WindKind`, the union the legend is keyed by, and not the legend —
three comments in the codebase named the wrong file and have been corrected.)

### 4.1 The table

Rows are the mark already on the soldier; columns are the element of the verb now landing.

| mark ↓ / verb → | air | water | earth | fire |
| --- | --- | --- | --- | --- |
| **air** | none | none | none | none |
| **water** | none | none | **Mud** | **Steam** |
| **earth** | none | none | none | none |
| **fire** | none | none | none | none |

**The diagonal is `none` by rule.** Repetition is what the chain rewards; letting the mark pay for
it too would price one press twice. Stated once here rather than four times in the table.

**Steam — water then fire.** Armour-ignoring **damage**. A wet soldier hit by fire is scalded
through its plate, and §4.4's own escape clause for the heavy is "earth or the environment" — steam
is the environment. This is the reaction that moves an armoured soldier down the recovery ladder,
which nothing else in the kit does quickly: `armour.burst` is `{ damage: 0.5, knockback: 0 }` and
`armour.gust` is zero on both axes.

**Mud — water then earth.** Extra **`heldSeconds`**, under a ceiling. Wet ground worked by
earthbending is the oldest trick in the source material, and holding is the answer to §4.4's
spacing pressure from spear infantry and to the netter, whose whole job is to ground the player.

**The ceiling is not optional, and finding out why changed this reaction's design.** `config.ts`
sets `gripCooldownSeconds` to 1.1 deliberately just under `gripHoldSeconds` of 1.4, so that one
target *can* be chain-held "at the cost of the entire light-verb budget" — `water.test.ts` pins that
inequality. Mud adding hold on top would buy a longer lockdown while leaving the light verb free
for a different element, which is a cheaper permanent hold than the one the config argues for. So:
**no combination of grip, freeze and Mud may hold a soldier longer than `freezeHoldSeconds`, 3.2s.**
The freeze is the move that pays 35 Focus for precisely that privilege — the one Focus sink §4.5
asks for — and a free path to a longer hold would make that sink pointless. Mud tops the clock up
toward the ceiling and never past it.

**Magnitudes are expressed against numbers the game already has**, so nothing here invents a
figure that has to be defended on its own. Steam's damage is the fire burst's own `burstDamage` of
1.0, applied without the armour multiplier — so Steam is "a burst the plate cannot stop" rather than
a new damage tier. Mud's hold is the water grip's own hold duration, added to whatever is already
on the clock. Both live in `config.ts` beside the moves they borrow from, with the borrowing stated.

**Every payoff is a different verb, and that is the constraint that kept the list short.** The
finisher displaces, Steam damages, Mud holds. A third reaction that also damaged or also held would
make the table longer without making the fight richer, and would give two mechanisms the same job —
the redundancy this project's review culture reliably catches.

### 4.2 Two reactions I designed and rejected, recorded so they are not re-proposed blind

**Dust — earth then air.** Raised dust blown into an archer's face; it would answer §4.4's altitude
axis. Rejected for this step because its natural effect is blinding, and nothing in the game has a
notion of a soldier whose aim is spoiled. Inventing per-enemy aim state for one reaction is the
status bag arriving through the back door. It becomes cheap the day an enemy has a perception state
for another reason.

**Backdraft — air then fire.** A gust fanning a burst into a wide cone. Thematically the best of
the lot, and rejected on identity grounds: §4.2 makes fire "the only element with real
single-target damage", and `config.ts` implements that as *geometry* — a 30° half-angle against
water's 60 and the gust's 120. A reaction that widens the cone dissolves the one property that
makes fire fire. If it ever lands, it should widen something other than the burst.

## 5. Feedback, and what B inherits

C ships the minimum legibility needed to play it, and no more. Three concrete pieces, each reusing
something that exists:

- **The mark** was to be a pip on the soldier's own health bar (`src/combat/health-bar.ts`), tinted
  with that element's colour from `LOOKS`. **Deferred to step B while writing the plan**, and the
  reason is worth keeping: `health-bar.ts` builds a three.js sprite, so a pip there is untestable
  effect work whose value is entirely a matter of taste in play — exactly the kind of judgement
  step B exists to make with the whole inventory in front of it. C ships without it, and the
  play-test asks whether the badge alone was enough to predict a reaction.
- **The chain** is a link count beside the element badge, which is already the widget that says
  what F and R will do — so "what I am holding" and "how far along I am" read in one glance.
- **A reaction** reuses `src/fx/shockwave.ts`'s expanding ring, tinted per reaction. Placeholder by
  intent: a ring is the cheapest shape that says *something happened here* without pretending to be
  steam or mud.

This is deliberate under-delivery. Step B's whole job is the effect inventory, and the reason C
runs first is that B cannot paint an inventory it does not know. What B inherits from this note is
the complete list: four elements' verbs, plus Steam and Mud, plus a finisher that reads as
displacement. §11 of the lit-world note already carries B's first finding — the gust cone's pale
cyan reads faintly over pale grass, and bloom does not rescue it because the fill sits under the
threshold.

## 6. Module boundaries

| Module | Responsibility | Testable in node |
| --- | --- | --- |
| `src/combat/chain.ts` (new) | The chain state machine and its finisher predicate. Pure | Fully |
| `src/combat/reactions.ts` (new) | The pairing table and the resolution of one reaction. Pure | Fully |
| `src/combat/enemy.ts` | Gains the `mark` field and its expiry, beside `heldSeconds` | Fully, as today |
| `src/combat/encounter.ts` | Writes marks on connect, advances the chain, applies finishers and reactions | Fully, as today |
| `src/combat/config.ts` | The chain window, `maxLinks`, and the reaction magnitudes | — |
| HUD | Shows the chain and the mark | No — no DOM in tests |

**Why two new modules rather than one.** The chain is player-side and knows nothing about enemies;
the reaction table is target-side and knows nothing about time. They share no state and would only
share a file. `encounter.ts` is the one place that sees both, which is already its job — it is the
module that owns "what did this press do to whom".

**Data flow.** `stepEncounter` resolves a verb as it does today. On a connect it (1) advances the
chain, (2) reads the target's mark and resolves any reaction, (3) writes the new mark. Order
matters and is fixed by one argument: the reaction must read the *old* mark, or every pairing would
resolve against the element that just landed and no cross-element reaction could ever fire.

## 7. Testing

Node-testable, and therefore tested:

- the chain: a landing advances it, a miss does not, the window expires it, a swap does not reset
  it, `maxLinks` caps it, and the finisher predicate is true only at the cap;
- the reaction table swept exhaustively over `Element × Element`, including that the diagonal is
  `none` and that every non-`none` cell names a reaction the resolver implements;
- reaction resolution: Steam's damage ignores the armour multiplier for the target kind, Mud
  extends `heldSeconds` without shortening it, and a reaction consumes the mark;
- mark lifecycle: written on connect, expires on its own clock, and a hit landing on a marked
  soldier does not refill the mark it just consumed — the same hazard `heldSeconds`'s comment
  records about a hit refilling the ice;
- the anti-laundering invariant, stated as a test rather than a comment: **no chain state or
  reaction shortens any of the five cooldowns.** A test that advances a full chain and then asserts
  every cooldown is unchanged is what stops a future contributor from paying the finisher out of
  the cooldown budget;
- the Focus invariant, the same way: **a finisher adds nobody to the connect list that feeds the
  meter.** §1's "combos pay in mechanics, never in Focus" is otherwise one line of bookkeeping away
  from being false — a finisher on an armoured soldier displaces it and is still reported as a
  deflect, so the meter never sees it;
- the hold ceiling driven through `stepEncounter` on the shipped config, and the config-level
  equality that keeps it pinned to the freeze — see §9;
- the fire ruling: no reaction path produces player thrust.

Not testable here, and therefore left to the play-test: whether a 0.9s window feels generous or
sloppy, whether a finisher reads as a finisher without B's visuals, and whether Steam and Mud are
worth switching for.

## 8. Non-goals

No new keys or bindings. No Focus changes. No new visual effects beyond placeholder reuse. No
per-element finisher table. No lingering reaction state. No changes to `staff.ts`, to the five
cooldowns, or to any `armour` table. No third and fourth reaction — §4.2 records the two candidates
and why they wait.

## 9. Risks

- **The finisher's armour bypass could trivialise the heavy.** It is displacement only, and it
  costs three landings inside a 0.9s window while the heavy is hitting back. This risk was written
  the wrong way round: it named `maxLinks` as the lever to reach for before the magnitude, on the
  assumption that finishers would prove too easy. §3.1 measured the opposite — of the two verbs
  quick enough to build a string alone, the gust reaches no finisher at all under eight seconds of
  unbroken pressure, and the staff reaches one per combo. So the likely lever is
  **`windowSeconds` upward**, and `maxLinks` downward is
  the lever to reach for only if the play-test contradicts the measurement. The magnitude still
  comes last, because the finisher pays in displacement and a displacement it cannot deliver is
  not a magnitude problem.
- **Two reactions may feel thin for "combinations".** The table is the deliverable as much as the
  cells are: a third reaction is a one-cell change plus a resolver branch once an enemy has the
  state Dust needs.
- **The mark is invisible until B.** A reaction the player cannot predict reads as randomness. The
  placeholder tint in §5 is the mitigation, and the play-test is where it is judged.
- **Mud's ceiling is the load-bearing guard in this note.** If it is implemented as a plain
  addition, water plus earth becomes a lockdown loop that costs less than the freeze it outclasses.
  The test that matters is the one that drives grip, freeze and Mud together and asserts the total
  never exceeds 3.2s. That test now exists — "never holds a soldier past the freeze, however the
  three are stacked", in `encounter.test.ts`, on `DEFAULT_COMBAT_CONFIG` rather than on a fixture,
  because the fixture's `freezeHoldSeconds` differs from the shipped one and a test that ran on it
  would have watched two unrelated numbers. It is backed by a config-level assertion in
  `reactions.test.ts` that `holdCeilingSeconds` *equals* `freezeHoldSeconds`, so the two cannot
  drift apart in a later retune without a test going red.
- **The window may not survive contact with the radial.** If flicking the radial mid-string eats
  more than 0.9s of real time, mixed strings will feel impossible even though the code allows them.
  Measured at the controls, not here.
