# Air Wall — Design

**Source:** `docs/design/aang-playable-character.md` §4.2, §4.3, §4.5.

> Air Wall — Hold. A short-lived barrier that *deflects* projectiles rather than eating them.
> Angle it and you return fire.

§4.3 adds that it works from the glider — "a well-angled Air Wall or Slipstream can send a fire
blast into the archer who fired it" — and §4.5 lists **redirected projectiles** as a Focus
source. That source had nothing feeding it before this work; it does now.

---

## What the move is

The third defensive tool in the kit, and deliberately the narrowest of the three. The Slipstream
beats anything for 0.11 seconds and moves you 30 m/s. A Vortex takes a whole group off its feet.
The Air Wall beats only projectiles, only from the facing it is angled at, and it converts them
into damage instead of merely surviving them. Pillar 3 is "Redirect, don't absorb"; this is the
only move in the game that literally does it.

Hold `G` and a barrier stands in front of the player for up to 0.9 seconds. An arrow that meets
it is reflected about the wall's normal — same speed, same damage, same arrow — and from that
moment it can hurt soldiers and can no longer hurt the player.

`G` was chosen because it is free and it sits next to the gust on `F`: the two moves that throw
air are neighbours under the same finger. Every other candidate was already taken (mouse, WASD,
Z, Shift, Q, F, E, R, C, Ctrl, Space, H, Escape).

---

## The decision that shaped everything else

**The wall's reach is a flat band. The wall's normal is not.**

Reach follows the house convention exactly: `AirWallConfig` satisfies `ConeShape`, so `inAirWall`
delegates to `inCone` and the barrier bites inside a horizontal wedge with a separate vertical
extent, like the gust and the staff arcs. The *normal*, though, is the player's full
three-dimensional aim, and that is forced rather than chosen.

A mirror preserves whatever part of a velocity lies in its own plane. Every arrow in this game is
aimed at `playerPosition`, which is the player's feet, so an arrow arriving on foot is a few
centimetres off the ground by the time it gets there — measured, an archer 30 units away firing
from `SHOT_HEIGHT` 1.1 puts its arrow at y ≈ 0.15 when it crosses a wall held at `range` 4.
Reflect that about a *horizontal* normal and the arrow keeps its downward rate: it buries itself
in the ground about `range` units past the wall, every single time, whatever the distance to the
shooter. A wall whose normal could only ever be horizontal has no long return in it at all.

`player.forward` is flattened by construction on foot and is the glider's flight path in the air,
so neither posture can point it up or down at will. The wall therefore reads the **look
direction**, in both postures, threaded through the fight as `EncounterInput.playerAim`. That is
one rule across both stances, and it is deliberately *not* what the gust does — the gust reads
the nose in the glider. The gust has no elevation to get right; this move's whole control is the
elevation, and requiring a pilot to fly at an arrow to deflect it would leave the mouse (which
the design document says trims) doing nothing for the one move where it matters.

So: the yaw describes the wedge, the pitch describes the mirror, and both come from one vector so
neither can drift. The drawn panel splits the same way — the group carries the yaw, the panel mesh
carries the pitch.

### What the mirror actually delivers, measured

A perfect mirror **does** return an arrow exactly to the bow it left; `air-wall.test.ts` proves it
against the archer's own shot in both postures. But the return travels the whole way back, so the
aiming tolerance is `hitRadius` 0.9 spread over that distance — about two degrees of returned
heading at 26 units, and half that on the normal, since a mirror doubles the error. A test pins
the miss at two degrees off. **Threading an archer at maximum range is a fine shot, not a
reliable one**, and the guide entry and the README both say so in as many words.

What the move reliably does instead is convert incoming fire into damage on whatever stands close
in front of the wall — usually the spear soldier closing on you. That is §4.1's "his damage
largely comes from the environment and from enemies hitting each other" arriving literally, and it
is the cheapest damage in the game because the player threw nothing.

In the glider the geometry is much kinder, which is presumably why §4.3 is written about the
glider: an arrow that climbed 25 units to reach you is returned descending at the same rate, so
the return has real distance in it before the ground takes it.

A homing or snapping return was considered and rejected. "Angle it" is the design document's own
verb, and an angle you do not have to get right is not an angle.

---

## The numbers

Six values, and the striking thing about them is that half are set by the **archer** rather than
by the rest of the kit. A barrier is defined by what it has to stop.

| Field | Value | Anchored to |
|---|---|---|
| `range` | 4.0 | Interception depth against an arrow's per-frame step: at the archer's `attack.speed` 34 an arrow covers 0.57 units a frame at 60 Hz and 1.7 at 20 Hz, so 4 is seven frames of coverage at the target rate and still two at a rate nobody should play at. Also the fiction: a barrier held at the staff's length (arcs at 3.6 and 4.2), nothing like the gust's 12. |
| `halfAngle` | π/4 — 90° spanned | Below the gust's π/3 (120° spanned) because a wall is a facing, not a crowd sweep: as wide as a gust and holding it would cover everything in front, so "angle it" would stop being a decision. The *floor* comes from the glider — `baseTurnRate` 0.9 rad/s over an arrow's 0.88 s flight is 0.79 rad ≈ 45°, so a narrower wall could not be aimed at a shot already loosed. |
| `verticalReach` | 4.0 | Set equal to `range`, which none of the other four moves do. The archer measures its ranges in 3D and will shoot a player hovering 25 units up from 16 out; on that line the arrow is 6 units below the player while still 4 away horizontally. Equal means an approach at 45° or shallower spends the wedge's whole depth inside the barrier. Pinned as `verticalReach >= range`, not as a literal. |
| `maxSeconds` | 0.9 | The arrow: 30 units of firing range at speed 34 is 0.88 s of flight, so a wall raised on the release is still up when a maximum-range shot lands, and one raised earlier is not. Makes the move an answer to the archer's `windUpSeconds` 0.8 telegraph rather than something to hold pre-emptively. |
| `cooldownSeconds` | 2.4 | Runs from the raise, like the Slipstream's, so it is the whole cycle — and it is *composed*: 0.9 up plus 1.5 down, where 1.5 is exactly `SlipstreamConfig.cooldownSeconds`. The gap between walls is the gap between dodges, so neither defensive tool is the cheap answer to the other's downtime. |
| `breathCost` | 20 | Under the Slipstream's 28: the dodge is the general answer and doubles as traversal, the wall is the specific one and moves you nowhere, so the specific tool is the cheaper tool. Above `FlightConfig.bendFloor` 15, so an exhausted player cannot raise one on fumes — which also makes `canAirWall`'s breath clause strictly stronger than `canBend`. |
| `FocusConfig.redirectGain` | 10 | Above `dodgeGain` 8 (a redirect avoids the hit *and* returns it) and below `downGain` 14 (it is setup; an arrow that downs a soldier pays `downGain` on top). Note it *replaces* rather than stacks with the dodge gain: a redirected arrow never reaches the player, so `damageAvoided` does not fire for it. |

Two consequences worth having in hand before playing it, both pinned by tests:

- The wall is available 37% of the time, against two archers who between them put an arrow up
  about every 0.95 s. **Most arrows still have to be answered with movement**, which is the point
  — a cooldown short enough to wall every shot would delete the altitude pressure §4.4 gives the
  archer to apply.
- Every one of these is an argued guess. None of it has been played.

---

## Where a returned arrow connects: a flat band, again, and again forced

`stepProjectile` now decides where on a soldier a deflected arrow lands, and the answer is
`hitRadius` across the ground with the soldier's own height as a separate vertical extent. Not
tidiness — a single sphere of radius `hitRadius` cannot catch both shots the wall produces, and
both were measured:

- Centred on the soldier's **feet**, it misses a perfectly mirrored long return by **0.2**. A
  mirror sends the arrow home along the line it arrived on, so it comes back to the *bow* at
  `SHOT_HEIGHT` 1.1, against a `hitRadius` of 0.9.
- Centred on the **bow**, it misses the close-in conversion by **0.1**. Arrows are aimed at the
  player's feet, so a return near ground level passes a soldier six units away at about y 0.07.

There is no single centre that covers both, and both are shots the move exists for. The band's
upper edge is `2 * hitRadius`, which invents no number: `hitRadius` is already documented as
roughly half the character's 1.8 height, so doubling it is the whole body expressed through the
constant that already models half of it.

---

## Smaller decisions, and the alternatives rejected

- **`Projectile.deflected` flips which side of the fight an arrow is dangerous to.** A fresh arrow
  cannot hurt soldiers, because nothing in the design makes archers a hazard to their own line and
  the shipped `HOME_PATROL` fires both archers straight over three spear soldiers — a patrol of
  five would down itself while the player walked away. A deflected arrow cannot hurt the player,
  because "deflects rather than eating them" promises the threat is converted; a mirror keeps a
  grazing arrow near the player, and a live one would let a badly angled wall kill you with your
  own defence, which reads as a bug however correct the physics is.
- **One deflection per arrow.** Without the guard, a wall held while the aim sweeps catches its
  own return on the way out and rallies it. A barrier, not a paddle.
- **Only incoming arrows.** `approach < 0` on the normal. Without it a wall flips an arrow back
  into the player on the frame after it saved them.
- **The wall's orientation is re-derived every frame, not stored.** Fixing it at the raise would
  make a "hold" into a tap you have to pre-aim, and it would add a stored heading the drawn panel
  could drift out of step with. Holding and sweeping onto the bearing is what makes the glider
  turn-rate argument for `halfAngle` mean anything.
- **A returned arrow lands with a zero impulse.** No new knockback number: an arrow is a thin
  shaft where the gust's 26 is a mass of moving air, and the stagger comes free because `hitEnemy`
  cancels a wind-up whatever the impulse — the same reason the Vortex can pass zero damage and
  still interrupt.
- **`airWallBreathSpent` is reported, not applied.** The contract `stepSlipstream` already has: a
  fight has no business writing to the player's meters.
- **`Encounter.airWall` is a nested struct**, unlike the Slipstream's two flattened fields on
  `PlayerState`. That flattening exists because a dozen movement tests build `PlayerState`
  fixtures by hand; nothing builds an `Encounter` by hand, so the module that owns the rule owns
  the struct.
- **Focus is paid at the redirect, not at the landing.** The redirect is the skilled act — angling
  a barrier onto a bearing inside an arrow's flight time. A grant that waited for the landing
  would pay nothing for a well-walled arrow with open ground behind it.
  `redirectHitsThisFrame` therefore feeds a burst and no Focus at all, the same split
  `slamHitThisFrame` and `staffHitThisFrame` already make.

---

## Ordering inside `stepEncounter`

`stepEncounter` advances projectiles *before* the enemy pass spawns new ones. Two more orderings
were added inside that, and both are load-bearing rather than incidental:

1. The barrier is stepped **immediately before** the arrow loop, so a wall raised this frame can
   catch an arrow already inside the wedge on the frame the player reacted rather than one frame
   later.
2. Each arrow is offered to the barrier **before it advances**. At speed 34 an arrow covers 0.57
   units a frame, so testing a post-step position asks whether the arrow is in front of the wall
   having already crossed it — and, more sharply, the player-hit test runs on the post-step
   position, so deflecting afterwards means the damage is already reported.

A returned arrow's hit on a soldier also lands here, ahead of the enemy pass, for the reason the
gust, the staff and the wave all land ahead of it: `hitEnemy` interrupts a wind-up, and an
interrupt applied after the soldier has acted is not one.

The function's own ordering comment was rewritten to say all of this rather than left describing
the old two-step order.

---

## The visual

`src/fx/air-wall.ts` draws a curved shell at the wedge's outer radius, spanning `halfAngle` and
the whole `2 × verticalReach` band, with a `ShaderMaterial` running drifting vertical streaks up
it. Persistent rather than an `Effect`, like `createGuardShell` — it tracks a held state — and it
tracks it exactly, because a barrier still drawn after it stopped deflecting tells the player they
are covered when they are not.

Three things there are worth knowing:

- **The `_pars_fragment` trap.** The renderer injects the tone-mapping and colour-space
  declarations itself for a `ShaderMaterial` whose `toneMapped` is on. Including
  `..._pars_fragment` as well fails the compile with redefinition errors and the only symptom is a
  mesh that never draws. Only `<tonemapping_fragment>` and `<colorspace_fragment>` appear, and a
  test greps the shader source for `_pars_fragment` because this codebase has paid for that
  mistake once already, with the sky.
- **The theta convention differs from `sector.ts` and that is correct.** `RingGeometry` is
  authored in XY and measures theta from +X, which is why every flat sector in the game carries a
  `-PI/2`. `CylinderGeometry` places vertices at `x = r·sin θ`, `z = r·cos θ`, so θ 0 is already
  local +Z — the axis `lookAt` aligns — and the span is centred on zero. `air-wall.test.ts` holds
  the drawn shell against `inAirWall` for six headings, with a vacuity guard that a quarter-turn
  rotation fails.
- **`depthTest` is left on**, the one departure from every other tell in `src/fx/`. They all
  disable it because a flat shape near the feet is buried by terrain sloping up away from the
  player. This shape stands `verticalReach` tall, so nothing buries it — and depth-testing earns
  something: the band is centred on the player's footing and so extends 4 units *below* it, and
  the depth test is what hides that half inside the ground. In the air there is nothing to occlude
  it and the whole band shows, which is honest.

The shell is drawn at the wedge's face and the 4 units of depth inward of it are deliberately not
drawn: that depth is interception tolerance so a dropped frame cannot let a shot tunnel through,
not a mechanic. The same trade `gust-cone.ts` makes in the other axis, where it draws the
footprint and leaves the slab's height undrawn.

---

## Deliberately not built

- **A combat-audio voice.** Every other move in the fight has one, and adding a wall voice means
  touching `combat-audio.ts` and `mapping.ts` with a level nobody has heard. Left for the pass
  that can listen to it.
- **A vertical wall — one that can be held overhead.** `inCone` needs a horizontal separation to
  take a bearing from, so an arrow rising vertically into a hovering player is out of the wedge
  entirely, and the wall cannot be held above your head. Recorded rather than fixed: every aimed
  reach in this game is flat, and making this one alone spherical is a larger change than the case
  is worth. A test pins the limitation with a control beside it so it stays a known shape rather
  than becoming a mystery.
- **Deflecting anything other than arrows.** §4.2 says "projectiles", and arrows are the only
  projectile in the game. A spear thrust is resolved as instantaneous damage in `stepEnemy` and
  goes straight through a wall, which is correct — §4.1's "every defensive option is *positional*"
  means the melee answer stays movement.
- **Fire blasts specifically.** §4.3 names a fire blast; the borrowed elements are Act 2 and 3
  content and no enemy fires one yet. Nothing here is arrow-specific, so a future fire projectile
  reflects on the same code.
- **An Avatar State boost.** `boostedCombatConfig` does not touch `airWall`. Every consumer reads
  the boosted config anyway, so a future boost that did reach it would flow through the tells and
  the fight together, but no case has been made for one.
- **A reticle or aim-tell hook.** The panel itself is the tell, and it is a large one; a second
  indicator for the same volume would be noise. The `aim-tell` preview stays the gust's.
