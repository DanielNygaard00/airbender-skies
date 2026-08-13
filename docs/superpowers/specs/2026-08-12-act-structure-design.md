# Act structure and progression gating — design note

**Written at integration, partly after the fact.** The cycle that built most of this was
interrupted twice and its reasoning was never written down outside the code. The model, the save
decision, the guide treatment and the Pressure Wave reading are all *inherited* — recovered here
from what `acts.ts`, `save.ts` and `panel.ts` actually say and argue. The call-site sweep, the
`acts.test.ts` file, the audit of the touched tests and this note were done at integration. Each
section says which it is, so a reader knows whose judgement they are overruling.

---

## 1. What this cycle is for

Everything in the game shipped unlocked. §5 is a table of what the player should have in each of
three acts, and until now nothing in the code expressed it. Water even left a seam for it on
purpose — `isElementAvailable` in `src/elements/element.ts`, which its own design note §3.4 names as
the place a gate belongs.

## 2. The model (inherited)

`src/progress/acts.ts`.

```ts
export type Act = 1 | 2 | 3
export type GatedMove = 'wall-ride' | 'dive-rebound' | 'avatar-state'
export type Ability = Element | GatedMove
export const UNLOCKED_IN: Record<Ability, Act>
export function isUnlocked(ability: Ability, act: Act): boolean
```

Two properties carry the design:

**`UNLOCKED_IN` is a total `Record` over `Ability`, and `Ability` includes `Element`.** So adding an
element to the union fails the compile until somebody decides its act. That is the same device
`ArmourTable` and `CombatConfig.enemies` use, and it is the mechanism that makes the promise to
earth and fire enforceable rather than aspirational.

**`isUnlocked` is an inequality, not an equality.** Acts are cumulative: Act 3 keeps everything Act
2 handed over. Written once, so `UNLOCKED_IN` is the only statement of the rule — an equality here
would hand water over in Act 2 and take it back in Act 3.

The table as it ships:

| Ability | Act | §5 row |
|---|---|---|
| `air` | 1 | "Airbending core, staff" — and never gated, per water's §2.3 invariant |
| `water` | 2 | "Water, Earth" |
| `wall-ride` | 2 | "Wall-riding" |
| `dive-rebound` | 3 | "dive-shockwave" — see §5 below |
| `avatar-state` | 3 | "Avatar State", which §4.5 independently calls story-locked |

### What earth and fire each need

**One line in `UNLOCKED_IN`:** `earth: 2,` and `fire: 3,` per §5's table. Nothing else — the gate
reads through `isElementAvailable`, which already routes every element through `isUnlocked`. The
compile will refuse to build until those lines exist, which is the point.

## 3. The advance trigger (inherited, with thresholds now tested)

**Shrine count.** `ACT_TWO_SHRINES` is 4 and `ACT_THREE_SHRINES` is 8, against the archipelago's
thirteen.

Shrines are the only progression signal the game has: they already exist, are already collected, and
already persist. §5's own Act 3 movement unlock is "Extended Breath", which *is* the shrine reward —
so the meter that advances the acts and the thing the last act grants are the same system. No story
system, dialogue or quest state was invented, because none exists.

`acts.test.ts` now pins that Act 3 takes **more than half the region's shrines**, asserted against
`ARCHIPELAGO.shrines.length` rather than a literal thirteen, so adding or removing a shrine surfaces
here rather than silently shifting the pacing.

A later story trigger can replace `actFromShrines` without touching `UNLOCKED_IN` or any call site.

## 4. The save decision, which is the best thing in this cycle (inherited)

**There is no `act` field in the save.** The act is *derived* from `collectedShrines`.

The reasoning in `save.ts` is worth restating because it answers a question I had posed as "what
does a hand-edited save claiming Act 3 do": with both fields, `{"act": 3, "collectedShrines": []}`
is a state the game must have a *policy* for — trust the act, trust the shrines, or take the lower —
and every policy is a rule that can be got wrong. Derived, that state cannot be expressed. One fact,
no policy, nothing to keep in step.

It also means act progress survives the down-and-respawn beat for free: `recover()` wipes transient
state, and the shrine list is not transient.

## 5. The Pressure Wave, which is the reading to check (inherited)

§5 puts "dive-shockwave" in Act 3, and the Pressure Wave is the heavy armoured soldier's only
*reliable* answer in the shipped kit — earth is the other and is itself Act 2. Gating the whole wave
to Act 3 would leave an unbeatable enemy in Acts 1 and 2.

**The resolution is that Act 3 does not gate the wave.** §4.2 lists the Pressure Wave under
"Airbending — always available", and §5's own Act 1 row grants "Airbending core", so the wave is an
Act 1 move by the document's own words. What Act 3 adds is `applyBounce` — the *rebound*, the second
half of §4.3's flagship aerial combo ("then bounce Aang back into the air"), which is separable from
the slam without inventing anything.

So `dive-rebound` is the gated ability and the wave is not. **This is the inherited judgement most
worth an owner's second look**, because it turns on reading "dive-shockwave" as the combo rather
than as the move. The alternative reading leaves Acts 1 and 2 with an enemy that cannot be put down,
which is a stronger argument against it than anything textual.

## 6. Locked versus unavailable (inherited)

`GuideRow` carries three fields where it used to carry one:

- **`available`** — usable this frame. False for a cooldown, the wrong posture, no breath, the wrong
  element.
- **`locked`** — not yet earned. The stronger statement.
- **`unlocksIn`** — which act hands it over, or `null` for an ungated row.

Two details matter. `available` is **forced false whenever `locked` is true**, so a caller reading
only that field can never offer a move the game would refuse — the two are not independent flags to
check in pairs. And because of that, the `available` predicates in `actions.ts` stay ignorant of acts
entirely: a locked row never evaluates a predicate that might read a system the player does not have.

The panel shows the act rather than the word "locked", on the argument recorded there: *"Act 3" tells
the player where it is and "locked" only tells them where it is not.*

## 7. Tuck and Flare: not separable, so not gated (established at integration)

§5's Act 2 movement row is "Wall-riding, Tuck/Flare". Wall-riding is gated. Tuck is not, and there is
no lock on it: it is a `Ctrl`-hold in the glider (`actions.ts`), a property of the baseline flight
model in `flight.ts` rather than a move with its own state. There is nothing to withhold that would
not amount to withholding part of the glider itself, which Act 1 grants.

Recorded rather than forced. Inventing a lock to satisfy a table row would be gating a feature into
existence.

## 8. What was done at integration, and what it found

The previous run died at "typecheck the production code to find every remaining call site". That
sweep turned out to be nearly complete: `stepAvatarState` had gained a sixth parameter `act`, and
`main.ts` — its only production caller — was already updated. What remained was test-side.

- **15 call sites** in `avatar-state.test.ts`, now passing `UNLOCKED_IN['avatar-state']` rather than
  a literal 3, so moving the Avatar State to another act moves the tests with it.
- **2 failures in `ground-move.test.ts`** where the slam-bounce fixture defaulted to Act 1 and the
  rebound correctly did nothing. Now built at `UNLOCKED_IN['dive-rebound']`. Worth noting that these
  two tests failing *was the gate working* — the first evidence in this cycle that it does.
- **2 fixtures in `panel.test.ts`** missing the new `act`, `locked` and `unlocksIn` fields.
- **`src/progress/acts.test.ts` did not exist.** The cycle's central module — the single statement of
  what the player has in hand — had no test at all. 12 tests now cover the table's totality and
  values, the cumulative rule, the two thresholds, monotonicity, corrupt counts, and that every act
  after the first hands over something so no act is a no-op.
- **The audit of the touched tests came back clean.** 23 test files were changed, 157 insertions
  against 66 deletions, and no file ended with fewer assertions than it started with — so the diff
  was mechanical rather than assertions weakened into vacuity to make them pass.

### Mutations run at integration

| Mutation | Result |
|---|---|
| `isUnlocked` as `===` rather than `>=` | 1 test red |
| Every ability unlocked in Act 1 | 2 tests red |
| Negative shrine count returns Act 3 | 1 test red |
| `ACT_THREE_SHRINES` lowered from 8 to 2 | 3 tests red |

**Every "locked" assertion in `acts.test.ts` is paired with an "unlocked in its own act" one**, over
the whole table at once rather than ability by ability. That pairing is the whole of whether these
tests mean anything: "the Avatar State is unavailable in Act 1" passes just as well for an Avatar
State that never works at all.

## 9. What is deliberately not built

- **§4.6's scripted lethality moments** need authored encounters that do not exist.
- **Region-to-act mapping.** There are two regions now and no act says anything about either. §3.1's
  regions connect in the world rather than through a menu, so this belongs with whatever cycle joins
  them.
- **Any story, dialogue or cutscene layer.** The trigger is a shrine count precisely so that none of
  that had to be invented.
- **Nobody has played it.** The thresholds of 4 and 8 are an argued guess about pacing, and pacing is
  the thing least likely to be right without hands on it.
