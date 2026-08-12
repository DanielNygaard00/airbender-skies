# Wall-riding — design notes

**Date:** 2026-08-11
**Authority:** `docs/design/aang-playable-character.md` §2.1

## What the design document asks for

Two sentences, both inside the Air Scooter, not beside it:

> Doubles speed, halves turn authority. **Can ride up vertical walls while speed holds.**

> Wall-riding drains the accumulator, so vertical shortcuts cost the speed you built to reach
> them. This gives corridors and courtyards a rhythm game underneath the platforming.

So wall-riding is not a move with a key. It is a property of the scooter, gated on speed, and
paid for out of the hidden accumulator that `src/player/scooter.ts` already builds. Everything
below follows from reading it that way rather than as a standalone verb.

## Shape of the move

A **redirect**, not a new source of speed. This is the third design pillar — "redirect, don't
absorb" — applied to terrain instead of to an attack. `resolveMovement` in
`src/world/collision.ts` already turns a fast approach to a cliff into a skim along it by
deleting the velocity that went into the surface. Wall-riding takes that same deleted
component and points it up the wall instead of throwing it away.

The rule a player learns from one attempt: **the squarer you hit the wall, the higher you go.**
A glancing approach still just skims, because a glancing approach has almost no velocity going
into the rock to redirect. Nothing else has to be taught.

The redirect fires **once**, on the frame the ride begins. Applying it every frame would make
holding forward into a wall a flight engine with the accumulator as its only limit rather than
as its price. Once riding, the climb is spent down by `wallRideClimbDecay` and never topped up.

### Entry

All of:

- the scooter is up (`scooterActive`);
- the accumulator has at least `wallRideMinCharge` in hand;
- a lateral probe from chest height finds a face within `snapDistance` whose `|normal.y|` is
  below `wallRideNormalY`;
- the closing speed on that face is at least `wallRideEntrySpeed`;
- no jump fired this frame.

### Exit

Any of the four the brief names, plus the jump:

| Exit | Mechanism | State left behind |
|---|---|---|
| The climb dies | `wallRideClimbDecay` spends it; ride ends at `wallRideHoldSpeed` | Airborne, still rising a little, gravity resumes |
| The accumulator empties | `charge > 0` is the sustain gate | Airborne with climb to spare, charge 0 |
| The wall ends | The probe finds nothing | Airborne, still climbing hard, arcs over the lip |
| The player releases | `Z` stows the scooter, which is what was climbing | Airborne with whatever climb was left |
| A jump | `jump.jumped` refuses the ride that frame | Airborne on the jump's own velocity |

Every one of them leaves the same state a jump or a walked-off ledge already leaves: airborne,
scooter stowed, accumulator gone. That is deliberate consistency with the existing rule rather
than a new special case, and the guide and README already described that rule.

## Numbers, and what each is anchored to

Every value lives in `GroundConfig`, with the rest of the scooter's, because the design
document files the move inside the Air Scooter row. A separate config would split one move's
tuning across two files.

| Value | Setting | Anchored to |
|---|---|---|
| `wallRideNormalY` | 0.25 | Half of `CollisionConfig.wallNormalY` 0.5. Chosen by measurement, not argument — see below. |
| `wallRideEntrySpeed` | 13 | `runSpeed`. A full flat-out sprint of *closing* speed. |
| `wallRideMinCharge` | 0.34 | `scooterTierDrop`. One tier — the accumulator's own unit of loss. |
| `wallRideChargeDrain` | 0.8 | `scooterChargeLoss`. A wall ride costs what a hard turn costs. |
| `wallRideRedirect` | 0.7 | `jumpSpeed / runSpeed` = 0.692, rounded. |
| `wallRideClimbDecay` | 6.7 | A third of `gravity` 20. |
| `wallRideHoldSpeed` | 0.9 | A tenth of `jumpSpeed` 9. |

Two of these encode design statements rather than merely borrowing a magnitude.

**`wallRideRedirect` at `jumpSpeed / runSpeed`** means a ride entered at the slowest legal
closing speed climbs at exactly the speed a jump leaves the ground with. So the *worst* wall
ride is worth one jump, and everything above it is profit. It is a literal 0.7 rather than a
runtime division, because deriving it would move the feel of every wall ride the next time
anyone retunes the jump; `wall-ride.test.ts` asserts the relationship instead, so a retune
reddens a test.

**`wallRideClimbDecay` at a third of gravity** binds the move's two limits together. The
minimum legal ride climbs at 9.1 m/s and decays to `wallRideHoldSpeed` in 1.22 s; a full
accumulator pays for 1.25 s. So neither limit is decorative: at the minimum they expire
together, and above it the accumulator is what runs out first — which is the ordering the
design document asks for, since the accumulator is meant to be the price.

Two more values are **derived rather than configured**, because they are geometry facts and
there is no reason to tune them apart from the ground probe they borrow:

- the lateral probe reach is `snapDistance` 1.2. Downward that means "ground this close is
  still underfoot"; laterally it means "a wall this close is still against you". It has to
  exceed `CollisionConfig.radius` 0.5, or the body would be held clear of a wall it could no
  longer feel; at 1.2 there is more than double the margin.
- the probe origin is `eyeProbeHeight / 2` = 1 m above the feet, chest height on a 1.8 m
  character. From the feet it would meet the fillet where wall meets floor, whose normal is a
  blend of the two and is rejected as often as not.

## The accumulator drain in practice

At `wallRideChargeDrain` 0.8, a full accumulator buys 1.25 s of wall. Building a full one at
`scooterChargeGain` 0.35 takes 2.86 s of clean line, so a ride gives back well under half the
line that bought it. Traced through the real mover on the real mesh, at the best wall on the
map (`spire`, the 6 m band):

```
approach 26 m/s, charge 1.000
f 0   climb 16.9 m/s   charge 0.987   airborne, riding
f12   +3.4 m           charge 0.827
f23   +6.2 m           charge 0.680   last riding frame
f24                    charge 0.680   wall ends, ride over, scooter still up
f25                    charge 0.000   scooter stows (ordinary airborne rule)
f70   +11.1 m          apex
f100  +8.3 m           grounded on the crown
```

One approach converts into **8.3 m of net altitude** and costs 0.32 of accumulator — and then
the ordinary airborne rule takes the remaining 0.68 when the scooter stows. So the move costs
the whole bank in practice, which is what "vertical shortcuts cost the speed you built to reach
them" should mean.

`stepScooter` is told when a ride is running and leaves the accumulator entirely alone on those
frames — not just the clean-line gain, but the hard-turn bleed and the clip tier drop as well.
Without that, two systems would write one number in the same frame with opposite signs and the
ride's documented cost would silently be its drain minus `scooterChargeGain`.

## What the shipped archipelago actually offers — the honest part

Very little. These islands are noise-displaced spheres squashed to 0.35 on top and stretched to
1.9 underneath, so the genuinely vertical rock is a ring near each island's equator, and most of
that ring hangs *below* the walkable crown where a rider standing on his feet cannot reach it.

Swept over all thirteen islands, from every grid position whose footing the ground snap would
actually seat a walker on, eight bearings each — 117,080 (position, bearing) pairs:

| Threshold | Contacts | Rate | Band p50 | Band p90 | Tallest |
|---|---|---|---|---|---|
| `wallRideNormalY` 0.25 | 290 | 0.25% | 0.25 m | 1.5 m | 6.00 m (`spire`) |
| `wallNormalY` 0.5 | 720 | 0.61% | 0.50 m | 1.5 m | 7.00 m |

Half the contacts run less than a metre before the face tilts out of vertical. The best wall on
the map is six metres, against a full accumulator that could pay for roughly 24 m of climb — so
on this level the **rock** is the binding limit, not the accumulator, and anyone retuning the
drain to make rides feel longer will be tuning the wrong number.

**This is a level-design gap, not an implementation one, and the fix is islands with real
cliffs.** It is recorded here and in `wall-ride-geometry.test.ts` rather than papered over by
loosening the threshold, because loosening was measured and does not help: doubling it to the
one collision already uses moves contact from 0.25% to 0.61% and the tallest band from 6.00 m to
7.00 m — nothing — in exchange for the move firing on 60-degree slopes the ground snap already
walks up, which would read as sticking to hillsides.

## Two-sided steepness

`isRidableWall` bounds `|normal.y|`, not `normal.y`. `isWall` in `collision.ts` asks
`normal.y < wallNormalY`, which every overhang on these islands satisfies — the stretched
undersides face outward and *downward*, so their `normal.y` is strongly negative. Riding up the
inside of an overhang cannot work: the climb carries the body away from the surface and the next
frame's probe finds nothing. Refusing at the gate is better than entering and being thrown off,
because the second reads as a stutter and costs accumulator on the way through. Measured on
`home`'s underside: over a hundred such faces, none accepted.

## The avatar

There is no wall-ride clip. `clip-map.ts` records that the shipped model has five — idle, walk,
run, fall (borrowing `Jump`), glide (composed) — so the pose is procedural over a borrowed clip.

- **Clip:** `run`, not `fall`. A ride is airborne by every other measure, and `fall` is the
  model's `Jump`: limbs out, knees up, exactly what a rider driving up a face is not doing.
  `run`'s legs are working, which is the honest read.
- **Lean:** a roll about the character's own forward axis, scaled by which side the wall is on
  — so a wall dead ahead gets no roll at all (the body wants to pitch into that one) and a wall
  being skimmed gets the full lean, continuously in between.
- **Cap:** `π/6`, a third of the quarter turn that would lay the body flat. A full quarter turn
  is what a purpose-made wall-run clip does; laying `run` flat would put the feet out sideways
  with nothing under them.
- **Smoothing:** in `main.ts`, `1 - exp(-16 * frameDt)`, stepped with real frame time alongside
  the camera shake. 16 puts the lean 94% in after `avatar.ts`'s 0.18 s clip cross-fade, so the
  roll lands with the pose it accompanies. `groundResponse` 7 was the other candidate and was
  rejected: at 7 the lean is still a fifth short half a second in, on a move whose median ride
  here is shorter than that.

## Deliberately not built

- **A key of its own, or a HUD readout.** The design document gives it neither. It is listed in
  the guide under `Z`, the key that summons the thing it is a property of, and as two combos in
  `reference.ts`.
- **A wall *jump*** — a kick that redirects off the wall in a chosen direction. Not in the
  design document. What is there for free is better: a ride is entered from the ground with the
  air jump untouched, so `Space` mid-ride is the ordinary double jump, and the double jump
  "gains more height the faster Aang is already moving upward". Kicking off while climbing hard
  therefore pays more than waiting for the apex, with no new mechanic. Both the behaviour and
  the ordering are tested.
- **Keeping the scooter over the lip.** Riding up onto a crown stows the scooter and loses the
  charge, because the ride ends mid-air and the ordinary airborne rule takes it a frame later.
  §2.3's "single unbroken line ... up a temple wall, and off the far side" would want it kept.
  It is not kept, because the existing rule — a jump, a fall off a ledge or stepping off stows
  it — is what the guide and README already promise, and quietly exempting one case would make
  that promise conditional. Worth revisiting as its own decision.
- **A material tell.** §3.4 asks that "wall-rideable stone reads differently from decorative
  stone at a glance". Nothing here paints anything: `island-paint.ts` keys colour off biome and
  noise, and there is no authored material distinction to key off. That is the same
  level-design gap as the missing cliffs, and it wants solving in the same pass.
- **Focus changes.** A ride keeps the scooter active, so `traversalRatePerSecond` already treats
  it as a clean line and pays at `scooterGainPerSecond` scaled by the charge — which tapers to
  nothing as the ride spends it. That fell out correctly and needed no new branch.

## Verification

Three test files carry the move, split by what kind of claim they make.
`wall-ride.test.ts` tests the rule against a clean synthetic face, because a rule is clearest
against a surface with no noise in it. `wall-ride-geometry.test.ts` tests the geometry against
the real thirteen islands, because how much ridable rock this level has is not something a fake
can answer, and it also drives `groundStep` end to end on the real mesh.
`ground-move.test.ts` tests the wiring — the order the three steppers run in, who writes the
accumulator, what an exit leaves behind.

Every non-trivial assertion was verified by mutation: the production code was broken
deliberately, the suite run, and the code restored. Thirty-two mutations were applied across
`wall-ride.ts`, `scooter.ts`, `ground-move.ts`, `avatar-anim.ts` and `config.ts` — each gate
removed in turn, each threshold loosened, the redirect applied every frame, the gravity
give-back dropped, the sustain probe re-aimed along travel, the lean's sign flipped, and every
one of the seven config values retuned. **All thirty-two reddened.** None survived, and none
reddened only a test that was asserting the mutation rather than the behaviour.

Two of those are worth naming, because they are where a weaker test would have passed:

- Flipping the lean's sign is *not* caught by "gives the two sides opposite signs" — negating
  both sides preserves their oppositeness. It is caught because the lean is checked through the
  transform `main.ts` actually applies (`Object3D`, `lookAt`, `rotateZ`) and the head is asserted
  to tip *toward* the wall in world space. That is why the test does not restate the arithmetic:
  the sign depends on three three.js conventions agreeing, and a test that recomputed them would
  confirm the derivation rather than the behaviour.
- Applying the redirect every frame is not caught by any single-frame test, since the entry frame
  is identical either way. It is caught by driving a rider who keeps pushing into the wall and
  requiring the climb to fall monotonically.

## Files

| File | Change |
|---|---|
| `src/player/wall-ride.ts` | New. `isRidableWall`, `stepWallRide`. Pure. |
| `src/player/scooter.ts` | `ScooterInput.wallRiding`: a wall counts as support, and the ride owns the accumulator. |
| `src/player/ground-move.ts` | Runs the ride last, after the velocity is settled; applies the drain. |
| `src/player/controller.ts` | Clears the normal on respawn and on deploy; guards it in `isFinitePlayer`. |
| `src/player/avatar-anim.ts` | `run` while riding; `wallRideLean`. |
| `src/core/types.ts` | `PlayerState.wallRideNormal`; seven `GroundConfig` values. |
| `src/core/config.ts` | The seven values with their justifications. |
| `src/main.ts` | Smoothed lean, rolled on after `lookAt`. |
| `src/ui/guide/actions.ts` | A `Wall ride` row under `Z`. |
| `src/ui/guide/reference.ts` | Two combos. |
| `README.md` | The `Z` row and the ground-movement paragraph. |
