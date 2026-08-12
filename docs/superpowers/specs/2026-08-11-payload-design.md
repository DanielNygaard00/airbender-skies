# Payload — design decisions and numbers

Implements §2.4 of `docs/design/aang-playable-character.md`: "Aang can carry a companion or an
objective on the glider, and it visibly degrades flight: lower lift ceiling, sluggish roll,
faster Breath drain."

The pillar that decides every question below is that the weakness has to be legible and
physical rather than a number the player cannot feel. So each degradation is applied to a
quantity the player can already observe the effect of, and each number is anchored to a value
the game had before this work rather than invented.

## What was built

| Piece | Where |
| --- | --- |
| Payload record, placement, proximity rule, delivery rule, placeholder mesh | `src/world/payload.ts` |
| Carry interaction, degraded flight config, carry pose, respawn rule | `src/player/payload.ts` |
| The three tuning values and their invariants | `src/core/types.ts`, `src/core/config.ts` |
| Level definition and validation | `src/world/level.ts`, `src/world/levels/archipelago.ts` |
| Key binding (`G`, edge-triggered) | `src/core/input.ts`, `src/core/types.ts` |
| Wiring: meshes, reparenting, respawn paths, per-frame carry pose | `src/main.ts` |
| Guide row, chain note, breath note, README | `src/ui/guide/actions.ts`, `src/ui/guide/reference.ts`, `README.md` |

## Where the degradations are applied, and why not inside `flight.ts`

`loadedFlight(c)` in `src/player/payload.ts` returns a `FlightConfig` with four fields scaled,
and `main.ts` hands that config to `controllerStep` on the frames a payload is being carried.
The integrator and the steering are untouched.

This follows `boostedCombatConfig` in `src/focus/effects.ts`, which is how the Avatar State
already modifies a tuned config without the systems it modifies knowing about it. Threading a
`carrying` flag through `flightStep` and `steerToward` instead would put a branch in the two
most heavily tested functions in the codebase for a change that is arithmetic on their inputs.
The whole weakness is four multiplications in one place, and `payload.test.ts` asserts as a
single object comparison that it is exactly those four — so a fifth field degraded quietly
reddens.

Only the glider branch of `controllerStep` reads any of the four fields, so the loaded config
cannot leak into walking, jumping, or a landing.

## Lower lift ceiling → `payloadLiftFactor` 0.7

**There is no altitude term anywhere in this flight model, so there is no height the glider
cannot exceed, and "ceiling" cannot be read literally.** What limits height here is energy:
lift acts perpendicular to velocity and does no work, so gliding only trades height for speed,
and thrust is the only thing that adds energy. Nothing stops a climb except the breath it is
bought with.

So the quantity is `liftCoeff`. The model has no mass, which means weight can only be expressed
as lift taken away, and taking lift away lowers the reachable height in the two ways a player
experiences directly: every glide sinks faster, and thrust has to spend more of itself covering
that sink before any of it becomes altitude.

`stallSpeed` was the rejected alternative even though a heavier wing does stall sooner:
`stallFactor` and `stallSeverity` share that number, so raising it would move the HUD's warning
colour and the wing's shudder onto a different threshold from the one the player learned
unloaded — the same feature teaching two different stall speeds. The load reaches the stall
anyway through the sink rate.

Measured through the real `flightStep` (20 s unpowered glide launched at 25 m/s; climb held 30
degrees nose-up from a standing launch until the breath runs out):

| | empty | ×0.7 | ×0.5 |
| --- | --- | --- | --- |
| glide ratio | 6.09:1 | 4.40:1 | 3.13:1 |
| sink at 20 s | 3.85 m/s | 5.61 m/s | 8.10 m/s |
| peak of a full-bar climb | 442 m | 191 m | 76 m |

**The anchor is the level's own longest glide-only crossing.** `home` to `ring-east` drops 80 m
between the two summits over 276 m of ground to the near rim, so it demands 3.46:1, and the
archipelago's comment calls those ring islands "reachable by gliding alone". A factor of 0.5
does not clear that crossing at all; 0.7 clears it by 1.27 times, against the 1.76 times an
empty wing enjoys. Centre to centre rather than to the rim the requirement is 4.03:1 and the
loaded margin is 1.09 times, which is the figure for a player who insists on overflying the
middle of the island. That bound is what fixes the floor under this number: a lift factor tuned
purely for drama would close a route the level exists to teach.

## Sluggish roll → `payloadTurnFactor` 0.5

`weightShiftTurnRate`, and only that. `steering.ts` is explicit that the weight shift is what a
hang glider actually steers with and that `baseTurnRate` is deliberately smaller "so that
looking trims the turn rather than driving it". The roll input is therefore the weight shift.

`baseTurnRate` and `bankTurnRate` were both rejected: they govern how fast the nose chases the
mouse, so degrading them would read as the camera having gone laggy rather than as the glider
having gained weight. `bankTurnRate` in particular cannot command a heading on its own — it only
speeds a chase toward where the player is already looking — so scaling it too would count the
same input twice.

**The anchor is `scooterTurnFactor` 0.5.** The game already has exactly one tuned number for
"this posture costs you half your steering", and a loaded glider is the same bargain in the air.

Measured through `steerToward` with a full weight shift and the mouse held still, so the look
assist contributes nothing:

| airspeed | empty rate | loaded rate | empty radius | loaded radius |
| --- | --- | --- | --- | --- |
| 15 m/s | 1.70 rad/s | 0.85 rad/s | 8.8 m | 17.6 m |
| 25 m/s | 1.70 rad/s | 0.85 rad/s | 14.7 m | 29.4 m |
| 40 m/s | 1.70 rad/s | 0.85 rad/s | 23.5 m | 47.1 m |

Radius is the figure that matters, because circling a thermal is a radius problem. The column
under `climb-north` has a radius of 45: a loaded glider fits inside it at 25 m/s and does not at
40. So the payload asks the player to slow down inside lift, which is the one habit the empty
glider never forces.

## Faster breath drain → `payloadBreathMultiplier` 1.5

One multiplier over both `breathDrainPerSecond` and `hoverBreathPerSecond`, so their tuned
relationship to each other survives — `hoverBreathPerSecond` is deliberately about 1.7 times
thrust, and scaling only one would rewrite that as a side effect.

**Anchored twice.** It is exactly `1 + 5 × shrineBreathBonusFraction`, so five air shrines cover
what a payload costs: on paper the match is exact (150 breath at 27/s and 100 at 18/s are both
5.56 s). Measured through the real gate it lands 5.6% *ahead* of parity rather than level, 5.00 s
against 4.73 s, because `bendFloor` holds back a flat 15 units rather than a fraction of the bar
and a bigger bar loses proportionally less of itself to it. With 13 shrines in the archipelago
that makes the payload a real cost exploration can pay off rather than a permanent tax.

The second anchor is the upper bound, now enforced by `validateFlightConfig`: the multiplier may
not push loaded thrust past an unloaded hover (1.67 times). That is not a safety margin, it is a
claim the game makes out loud — the guide calls hovering "the most expensive thing you can do
with breath" — and a multiplier above the ratio would turn that sentence into a lie.

Loaded thrust from an uncollected bar lasts 0.67 of what it used to.

## The route

The bundle sits on the west side of the home plateau and belongs on `climb-north`, 120 above and
330 out.

`climb-north` is already the island the level introduces as the first target that "needs
sustained thrust, which introduces breath as a cost", so the payload's extra drain lands on
exactly the crossing built to teach that. What the payload removes is the room for error, and
the honest figures matter here because the tempting overstatement is that thrust alone cannot
make it. It can: budget the whole bar as a nose-up climb and then glide the 332 m across at the
loaded ratio and the sum closes with about 9 m to spare out of the 106 m of climb the leg needs,
where an empty wing closes it with roughly 280 m. Nine metres of *ideal-profile* margin is not a
route — every turn and every second not spent pointing at the climb comes out of it. The thermal
over home and the second one under `climb-north` are what put the room back, and both predate
this work, which turns the guide's existing advice ("thrust costs breath; a thermal does not")
from an optimisation into the way there.

`spire` was the rejected destination: higher, and it would dramatise the lift loss further, but
reaching it needs a dive and a zoom climb, and a zoom climb is precisely the manoeuvre the lift
factor damages most — the route would read as broken rather than heavy.

## Pick-up and drop: a key press, not a landing

`G`, edge-triggered, both directions, and both require standing on the ground.

A landing-triggered drop was the tempting answer and loses to the game's own transition layer.
§2.3 is explicit that "landing at high speed never hard-stops Aang", and `controller.ts`
implements it: `LANDING_RETENTION` keeps 0.85 of the horizontal speed through a touchdown, so a
skim landing between two hops is an ordinary move. Dropping the payload on it would leave the
cargo behind mid-chain without the player asking. The second half of the argument is thrash: an
automatic drop needs an automatic pick-up to match, and a proximity pick-up would re-lift the
bundle the instant it was set down, so it would need a "step away before you can lift it again"
flag purely to undo its own convenience.

Requiring ground for the pick-up is what keeps the payload out of the air entirely — no
snatching a bundle at 25 m/s — and requiring it for the drop is what keeps it out of the sky.
Together they are why nothing in this system ever has to simulate a falling payload.

`REACH_RADIUS` is 3, half the shrine's `COLLECT_RADIUS` of 6. That radius is generous because a
shrine is caught in passing at flight speed; a payload is only ever lifted on foot at
`walkSpeed` 7, where 3 units is still most of a second of walking either side of the spot.

## Respawns

**A carried payload returns to where the level placed it, on both respawn paths.** `recover()`
covers going down; a `willRespawn` check across the step covers falling past `worldFloorY` and a
state that was already non-finite.

Surviving the respawn is the bug this prevents: both paths move the player, so a payload that
stayed carried would be a free teleport — and on the fall path that is not a minor exploit,
since the fastest way to move cargo would be to jump off the edge of the world with it. Dropping
it where the player went down is the other failure: it is meaningless for a fall past the world
floor, where there is no ground to leave it on, and a bundle at the bottom of the void is an
objective removed from the level with no way to get it back. Home is the only answer that is the
same answer for both paths, keeps the route repeatable, and costs exactly what the mistake was
worth — the walk back.

Carrying lives as one `carriedId` in `main.ts` beside `shrines`, deliberately not on
`PlayerState`: state on the player is state `respawn()` would carry across a death silently, and
this is exactly the kind that must not. It is also deliberately not in the save — `save.ts`
keeps the two things a session accumulates, shrines and the breath ceiling, and where a bundle
is sitting is a route in progress rather than progress. A reload puts it back on the home
plateau, which is where a respawn puts it too.

One path is knowingly uncovered: a state that goes non-finite *inside* a step, which
`controllerStep`'s own trailing guard respawns from. Nothing outside that function can observe
it, and giving it a way to report it would mean changing what it returns, along with every
caller and test. It needs `flightStep` or `groundStep` to manufacture a NaN from finite inputs.
If it ever fires, the payload rides the respawn.

## The visible carry

The mesh is parented to `avatar.object`, alongside the glider, the aura, the charge tell and the
guard shell.

Not `modelRoot`: that inner wrapper absorbs the fitting scale (`fitToPlaceholder` measures
whatever model loads) and the charge-jump squash, so a payload there would be resized by
whichever model happened to load and would compress every time the player crouched. Not
`glider.object`: it lerps between the stowed pose (tilted 1.05 rad about Z, across the back) and
the deployed one and sweeps 150 degrees through a staff swing, so a payload hanging off it would
tumble sideways on every stow and be flung by every swing. `avatar.object` carries nothing but
position and facing, which is what a carried bundle should inherit.

Two poses, lerped by the glider's own `openness` so the bundle travels with the wing over the
same 0.3 s and needs no timer: held against the chest on foot, slung low and behind in flight.
Behind rather than under the belly because the follow camera sits 12 units back and 3.2 up along
the flight path, so a bundle under the rider would spend the whole flight hidden behind him.

The geometry is a placeholder standing in for a companion model, said plainly in its doc comment.
There is no companion asset and this work adds none: it is a wrapped bundle built from an
icosahedron and two straps, using the same `colored` helper and single-merged-mesh approach
`props.ts` uses. It is seated on y = 0 by measurement rather than by construction — a detail-0
icosahedron has no vertex at its south pole, so translating down by the radius left the bundle
floating 7 cm above the ground.

## HUD: nothing added, deliberately

Argued at length in `src/ui/hud.ts`, where a reader would go looking for it. In short: the state
is already on screen in world space every frame it is carried, its consequences are already
legible in the bars and readouts that exist, and this HUD's culture is to hide anything with
nothing to say (`showBreath`, `showHealth`, `showFocus`). The *why* is the guide's job — a
dimming `G` row plus two written notes. The accepted trade is that a player who never opens the
guide learns the degradation by feel with only the visible bundle to explain it; if that is too
subtle in play, the cheap answer is a one-shot line rather than a permanent element.

## Left unbuilt from §2.4

- **"Escort and rescue sections."** The section framing needs objectives, failure states and
  authored encounters, none of which exist yet. One payload with one destination is the mechanic
  the sections would be built out of.
- **A companion that behaves like one.** No asset, no animation, no reactions. §2.4 says "a
  companion *or* an objective", and this is the objective reading.
- **Any weight on the ground layer.** Carrying does not slow the run, the scooter or the dash.
  §2.4 scopes the degradation to flight ("it visibly degrades flight"), and the three named
  degradations are all flight quantities.
- **Save persistence for the payload.** Argued above.
