# Handoff

Written 2026-07-31, updated 2026-08-04 for the enemy health bars, updated 2026-08-05
for the impact feel and encounter lifecycle work, and again 2026-08-05 for the aim tell and
stall readability work, and again 2026-08-06 for archers and projectiles, and again
2026-08-06 for terrain collision, and again 2026-08-06 for the Slipstream breath cost, and
again 2026-08-07 for the feel batch, and again 2026-08-07 for wind on foot, and again
2026-08-10 for jump forgiveness, and again 2026-08-10 for vertical reach, and again 2026-08-10
for settings and accessibility. This is a recap
for whoever picks the project up next, including a future session with no memory of the work
below.

**Live:** https://danielnygaard00.github.io/airbender-skies/
**Repo state:** 1604 tests across 96 files,
`npm run typecheck` clean (it runs two passes now — see "Typecheck is two passes"),
`npm run build` clean. Pushing `main` triggers the GitHub Pages deploy in
`.github/workflows/deploy.yml`.

## What this game is

A third-person browser game in three.js: fly an Air Nomad glider staff around an
archipelago of floating islands. The design target is the character from the show —
momentum-driven traversal, airbending as the engine, non-lethal combat.

The design document driving the work is committed at
[`docs/design/aang-playable-character.md`](design/aang-playable-character.md). It
covers movement, world, and combat as systems. Read it before adding features; most
open work is a section of it that has not been built yet.

## What has been built

Ordered roughly by how load-bearing it is.

**Character and animation.** A rigged Quaternius GLB at
`public/models/character.glb`, auto-fitted to the placeholder's 1.8 units with its
feet at the origin. `src/player/clip-map.ts` maps the model's own clip names onto the
game's five animation states, tolerating the armature-name prefix that exporters add.
`src/player/glide-pose.ts` composes a glide pose the model does not ship, by taking
the arms from one clip and the legs from another and laying the result flat and
parallel to the wing.

**Flight.** `src/player/flight.ts` is a soaring model: the glider trades altitude for
speed and sinks if left alone. Airbending is the engine — thrust is the only way to
gain net altitude and it spends Breath, hover holds station and spends Breath faster,
and a tuck folds the wings for a fast dive. Steering is weight shift
(`src/player/steering.ts`) with the mouse as trim.

**Ground movement.** `src/player/ground-move.ts` eases toward the requested velocity
rather than assigning it, so the run leans into turns and slides on stops. The air
scooter (`src/player/scooter.ts`) is a toggle that doubles speed, halves steering, and
carries a hidden accumulator that rewards a clean line. The blast dash
(`src/player/dash.ts`) chains three times before a recovery and only fires from the
ground. Jumps are in `src/player/jump.ts`, including a second jump that gains more
height the faster the player is already rising, and the two forgiveness windows written
up at the end of this section.

**Wind as terrain.** `src/world/wind.ts` models five kinds — thermal, ridge lift,
wind river, downdraft, dead air — each a shape in the world with a rule. Placed per
level in `src/world/levels/archipelago.ts`. `src/world/wind-tell.ts` gives each one a
visible mote cloud, because the design doc's rule is that a wind feature the player
cannot see is a bug.

**World.** Thirteen islands, noise-shaped with zoned vertex colours and scattered
props. Eight teach the flight model in sequence; five smaller ones teach the hover by
being too small to land on at cruise speed.

**Atmosphere.** A gradient sky dome (`src/core/sky.ts`), ACES tone mapping, and sun
shadows from a frustum that follows the player (`src/core/sun.ts`).

**Combat, first slice only.** `src/combat/` has health that downs rather than kills,
one enemy type (spear infantry that pressures ground spacing), and Gust — high
knockback, almost no damage. `src/combat/encounter.ts` owns a fight and is wired into
the game with a patrol, a gust key, and health on the HUD.

**Focus and the Avatar State.** `src/focus/` holds the second of the design document's
three meters: it builds from clean traversal and combat chains, drains on damage, and
encodes "unbroken chains" as a ramp on the gain rate rather than a separate combo
counter. Holding it at maximum arms the Avatar State, which the player fires with `E`
for eight seconds of free breath, a one-hit gust, and every wind feature in the
archipelago surging. The state's effects are pure transforms of existing config and
samples (`src/focus/effects.ts`), so the flight, combat and wind models contain no
mention of it. Spec at
[`docs/superpowers/specs/2026-08-03-focus-meter-design.md`](superpowers/specs/2026-08-03-focus-meter-design.md).

**Pressure Wave.** `src/combat/pressure-wave.ts` is the blast — radial, with no facing
test at all — and `src/player/slam.ts` detects a committed landing by comparing the
player either side of `controllerStep`, so no movement code knows combat exists. Damage,
radius, knockback and the Focus grant all scale with downward impact speed, and a full
dive downs a spear soldier outright. The slam bounces the player back up under the
impact's own velocity — a 45 m/s dive returns about 20 m/s, roughly 10 m of climb — with
the air jump available again because landing already zeroed it, so §4.3's flagship
combo is dive (Ctrl), slam (hold Ctrl through the landing), then two taps of Space on the
way back up: one for the double jump, one to deploy. Four beats, only two of them on
Space. Spec at
[`docs/superpowers/specs/2026-08-03-pressure-wave-design.md`](superpowers/specs/2026-08-03-pressure-wave-design.md).

**The action guide.** `H` opens a paused panel listing every action, grouped by stance,
with each one dimmed and struck through when it is unavailable right now —
`src/ui/guide/`. Availability calls the game's own predicates (`canDash`, `canAirJump`,
`isArmed`) rather than restating them, and a test binds the catalogue to the README's
controls table in both directions so the two cannot drift. It also carries the combo
list, an explanation of the three HUD meters, and a legend for the five wind clouds.
Spec at
[`docs/superpowers/specs/2026-08-03-action-guide-design.md`](superpowers/specs/2026-08-03-action-guide-design.md).

**Combat visuals.** `src/fx/` holds the effects layer: a shared `Effect` contract and an
`EffectPool` that owns add, advance, cull and dispose for every one-shot effect, plus a
gust cone drawn at the move's true 12-unit, 120-degree **horizontal footprint**, a dash
streak whose
length and brightness read the chain index, impact bursts that distinguish a connect from
a down, and an Avatar State aura on the character. Every trigger reads a signal the game
already produced, so no movement or combat code changed. The cone's **horizontal** honesty
is tested by sampling points and comparing the drawn sector against `inGust` — a different
mechanism from the one the code uses.

That sentence used to read "the move's *true* hit volume", and the vertical-reach cycle
made it false: the gust now hits a slab 5 units above and below the player, and the drawn
sector has no thickness at all. The cross-check against `inGust` samples only points level
with the caster, so it cannot see the difference. Both the description and the test's name
are now scoped to the horizontal footprint. See "A known cosmetic mismatch" under "Vertical
reach" below for all five affected effects. Spec at
[`docs/superpowers/specs/2026-08-03-combat-visuals-design.md`](superpowers/specs/2026-08-03-combat-visuals-design.md).

**The gust cone is confirmed visible.** This entry previously warned that nobody had seen
it; it has now been seen both by a human on the live build and in the preview pane. Two
defects were found and fixed to get there: terrain occlusion (a flat sector near the ground
is buried by slopes, fixed by drawing the attack effects over the world with
`depthTest: false`, proven both ways in-game) and low contrast (pale blue at 0.16 opacity
is invisible against pale green terrain, raised to 0.34 and cooled toward cyan).

**Seeing the cone immediately exposed a combat bug that the tests could not.** On foot the
gust fired in a fixed world direction — the spawn heading, or whatever heading the glider
last landed on — regardless of where the player was facing. The cause was that
`PlayerState.forward` was a glider-only field: `groundStep` explicitly carried the old
value forward and never recomputed it, while `desiredVelocity` steered from
`horizontalForward(input.lookDirection)` instead. Since `inGust` aims the *hit test* with
`player.forward` too, the blast itself was wrong, not just its drawing — the cone was
honestly picturing a broken gust, which is the payoff of having drawn the move's true
horizontal footprint rather than a tidy puff. On foot `forward` now follows the flattened look direction, and
the character model faces `forward` in both modes rather than facing its direction of
travel on foot: travel is zero at exactly the moment a player stops to aim, so a standing
turn used to move the blast and not the character.

**Enemy health bars.** `src/combat/health-bar.ts` is a small billboarded bar — a dark track
and a coloured fill — that takes a `Health` and a camera rotation and knows nothing about
enemies. `createEnemyView` composes one per soldier. It appears only once an enemy has been
damaged, hides when the enemy is downed, and is depth-tested so terrain hides it, which is a
deliberate difference from `src/fx/`: an attack effect drawn over a hill shows the player
something they did, while a health bar drawn over a hill shows them an enemy they cannot see.
Spec at
[`docs/superpowers/specs/2026-08-04-enemy-health-bars-design.md`](superpowers/specs/2026-08-04-enemy-health-bars-design.md).

Two things in that module are load-bearing and easy to undo by accident. The fill's geometry
is translated so its origin is its **left edge**, because a quad scaled about its centre
drains from both ends at once and `scale.x` is identical either way — `health-bar.test.ts`
compares the fill's and track's bounding-box edges rather than the scale value, which is the
only way to tell the two apart. And `enemy-mesh.ts` now has an inner **`rig`** Group: the
root carries position, the rig carries the soldier's facing and downed rotation, and the bar
hangs off the *unrotated* root. `HealthBar.update` copies the camera rotation into a **local**
quaternion, so a bar parented to the rotating rig would come out at the soldier's heading
times the camera's and would never face the camera. That bug passes a test that checks
`bar.object.quaternion`, because the local value is exactly right; the test checks
`getWorldQuaternion` instead.

Confirmed in the running game, not just in tests: a bar stays hidden at full health, appears
at 0.667 on the first gust, drains to 0.333 on the second, and hides again when the third
gust puts the soldier down, and it holds 0 radians off-camera through a hard camera swing
while the soldier itself is rotated. The one claim resting on unit tests alone is that
terrain occludes a bar — `depthTest: true` is set explicitly on both materials, and a test
catches a flip to `false`, but it would not catch the explicit setting being deleted outright,
because `true` is also the three.js default. Terrain occlusion itself has not been seen
behind a hill.

**Vortex and Slipstream.** The two remaining always-available airbending moves from §4.2.
`src/combat/vortex.ts` is a charged, radial, facing-free gather: hold `R` to build a charge,
release to pull everyone within the radius inward and lift them. It deals **no damage and has
no damage parameter**, so it cannot become a damage tool through config drift — its value is
that an airborne enemy is inert. Charge widens the radius from 5 to 12 and raises the lift
from about 0.5s of airtime to about 1.1s. Releasing under 0.2s cancels free, spending no
cooldown. `src/player/slipstream.ts` is the dodge: `C`, 30 units/sec over 0.2s, invulnerable
for the first **0.11s only**. The window being shorter than the dash is the design — it beats
an attack you saw coming, and mistiming it leaves you committed to a direction with no
protection. A dodge that actually avoids a hit grants Focus, which implements §4.5's fourth
build source, "damage avoided at close range" — specified since the beginning and never built.

The dodge's direction is posture-aware, and `dodgeHeading` in `src/player/slipstream.ts` is
the single place that decides it — both the controller and the streak effect call it, so the
drawn direction cannot drift from the resolved one. On foot the movement keys mean walk and
strafe, so the dodge is camera-relative and can go anywhere. In the glider they do not: `W` is
airbending thrust and `S` is a flare, and reading them as translation made holding `S` dodge
*backwards* for an input that only ever meant "raise the nose", while `W` — the normal flying
state — would have turned nearly every glider dodge into a forward one. So only the bank axis
steers a glider dodge, perpendicular to the heading, which is the direction that beats
something coming straight at you. Measured in flight at 41 m/s: banking right dodges 91.6°
off the heading, and a flare now dodges 0° off it instead of reversing.
Spec at
[`docs/superpowers/specs/2026-08-04-vortex-slipstream-design.md`](superpowers/specs/2026-08-04-vortex-slipstream-design.md).

**Enemies now have gravity, and that fixed a shipped bug.** Before this work, `main.ts`
dropped each enemy onto the ground once at spawn and never again, while `stepEnemy` integrated
the y component of `knockback` — which `gustImpulse` and `waveImpulse` both set. So every gust
and every Pressure Wave *permanently levitated* the soldiers it hit. Measured on the running
build: a gusted soldier rose from y 11.504 to 13.896 and was still at 13.896 twenty seconds
later, identical to three decimals. `Enemy` now carries a ballistic `verticalVelocity` and a
stored `grounded` flag; `knockback` is horizontal-only and a test pins `knockback.y` at zero so
the contract is enforced rather than merely documented. `stepEnemy` takes a deliberately narrow
`GroundHeightQuery` (`groundHeightAt` only) rather than the whole `TerrainQuery`. An enemy
below `worldFloorY` is downed, per §4.6's list of ways an enemy goes down, and is then
**parked** — an earlier version only downed it, which did not stop it falling, so a corpse in
empty air accelerated without bound (measured at 36km down and still gaining 1.2km/s a minute
in). Nothing can see it again, so it stops rather than running the physics forever.

Two things in here are easy to break by accident. **A lifted enemy must be inert** — no
advancing, no wind-up, no strike while `grounded` is false — because that inertness *is* what
Vortex buys; the move has no damage at all. And **the guard shell must not outlive the
invulnerability window**: an earlier version faded over 0.08s against a 0.11s window, so it
kept glowing at 58% opacity two frames after protection had ended, telling the player they
were safe when they were not. The fade is now 0.02s in and 0.03s out, and a test pins the tail
below `invulnerableSeconds / 3`.

Confirmed in the running game, not just in tests: a gusted soldier now rises and settles back
(11.458 → 12.183 → 11.461, stable at frames 300 and 900); the charge ring grows 5.49 → 7.82 →
12 and hides on release; a released Vortex pulls the nearby soldier inward 3.15 → 2.59 and
lifts it to an apex of 14.19 from 11.81, after which it lands and settles; while airborne it
produced **0** wind-ups across 60 frames against a control of **46** while grounded, and it
resumed attacking after landing; and the Slipstream shell holds full opacity for two frames,
drops to 0.178 at frame 6, and is gone by frame 8 — roughly 0.117s, matching the 0.11s window
plus a two-frame fade.

Two honest caveats. The **charge ring is thin** at full radius — a 0.06-of-radius band seen at
a shallow camera angle — so it is legible but faint, and is the first thing to tune if aiming a
Vortex feels vague. And enemy health bars now billboard against a **one-frame-stale camera
rotation**: the render-interpolation work moved the camera update into the per-frame
`syncVisuals`, while enemy `sync` still runs in the fixed step. Visually negligible, but it is
no longer the same-frame guarantee the health-bar spec documented.

**The staff.** §4.2's other half. Left mouse swings up to three wide horizontal arcs: the two
openers reach 3.6 and sweep 164°, the finisher reaches 4.2 and sweeps 189.5° — the front
hemisphere plus about 4.7° past each flank, so it does **not** reach an enemy directly behind.
Press again inside the window to continue the combo; let it lapse and the chain restarts. The
combo is player-side in `src/player/staff.ts`, which owns `maxChain` and labels each swing with
a `finisher` flag on the way out; `src/combat/staff-arc.ts` resolves the hit and never learns
how long a combo is. `staffImpulse` deliberately has **no** vertical component — lift is what
air does, and a lifted enemy is inert, which is the Vortex's payoff; a staff sweep slides a
soldier sideways instead. Spec at
[`docs/superpowers/specs/2026-08-04-staff-melee-design.md`](superpowers/specs/2026-08-04-staff-melee-design.md).

**The gate is the feature, and it is physical.** While the staff is busy you cannot deploy the
glider, because the glider *is* the staff — `src/player/glider.ts` stows it across the rider's
back and unfolds fan leaves from it. You cannot open the wing while holding it as a weapon.
Only gliding is blocked; jumping, dashing, gusting and dodging stay available mid-combo.

Three things here are easy to break and were each found the hard way:

- **`staffBusy` must hold continuously.** It was originally `isSwinging || recovery > 0`, and
  since recovery is only owed once the combo *ends*, the staff reported itself free during the
  continue window. Measured in the running game, the gate went blocked → **open** → blocked →
  free: you could glide out 0.3s after a swing for free, and were only punished if you
  dithered. Every test passed, because they checked "blocked while swinging" and "blocked
  during recovery" separately and never the gap between. There is now a test that walks the
  whole commitment and asserts no gap.
- **The swing must not start on a frame that deploys.** The merge was gated on the mode
  *before* the step, so pressing swing and deploy together started a swing on a glider-mode
  state — and since the staff only advances on the ground, it froze at elapsed 0 for the whole
  flight, keeping `staffBusy` true and delaying a later deploy after landing. Gated on the
  post-branch mode now.
- **There is no attack animation.** The model ships idle, walk, run, fall and glide, so the
  tell is built: an arc effect drawn at the swing's true horizontal reach and half-angle
  (`src/fx/staff-arc-fx.ts`) plus
  a procedural sweep composed inside `glider.ts`'s own `apply()`, which rewrites the staff
  transform every frame and would overwrite anything set from outside. "The swing's true
  reach" was accurate when written and is not any more: the vertical-reach cycle gave both
  arcs a 2-unit band above and below the player, and the drawn arc is a flat sector, so it
  under-draws the swing's height by 4 units. See "A known cosmetic mismatch" under "Vertical
  reach".

Confirmed in the running game, not only in tests: a click swings and the staff visibly rotates,
alternating direction per swing; the drawn arc measures 3.6 at 163.6° for the openers and 4.2
at 189.5° for the finisher, matching what the fight resolved with; letting the window lapse
restarts the chain as an opener; and the gate now blocks a deploy at 3, 20 and 40 frames after a
swing and allows it at 80. Not yet checked by a human with a mouse: whether a 0.26s swing feels
snappy and whether a second of no wing is a fair price.

**Impact feel: the freeze and the shake.** Every attack in the game resolved correctly and
almost none of them could be felt — no hitstop, no camera kick, no hit spark on the newest
attack, no feedback at all for being hit. `src/fx/hitstop.ts` is the freeze: `triggerHitstop`
is **longest-wins, never additive**, because a real hit fires several triggers on one frame — a
finisher that downs a soldier is two, a slam into three soldiers is four — and summing them
would turn a good hit into a visible stall. It fires on heavy events only (a staff finisher
connect, *any* slam, a down); never on a gust, because a 0.45s-cooldown move that hitches on
every use is nausea, not weight. A slam deliberately needs no connect — its impact is with the
ground, so it lands whether or not a soldier was standing in the blast, which is the same reason
the shockwave ring and the slam's Focus grant both fire unconditionally.
`src/fx/config.ts` holds `DEFAULT_HITSTOP_CONFIG`:
`finisherSeconds: 0.05`, `downSeconds: 0.07`, `slamMinSeconds: 0.04` to `slamMaxSeconds: 0.09`
scaling with the slam's own impact strength.

The load-bearing detail is in `main.ts`: **`update` steps the hitstop and, while frozen, returns
before `input.sample()`.** `src/core/input.ts` documents `sample()` as clearing the action edge
on read, so sampling and then discarding the frame would silently eat any press made during the
freeze — a click landing inside a 60ms hitstop would just not happen. Returning first leaves the
edge pending, and it fires on the first live frame instead. Also worth recording so nobody
"fixes" it: `createStepper` in `src/core/loop.ts` decrements its accumulator around every
`update` call regardless of what that call does, so an early-returning `update` cannot bank time
and discharge it on resume — the freeze does not need to account for the stepper at all.

The early return does need to account for the *interpolators*, though, and this was missed the
first time. Returning early skips the `record()` calls at the end of `update`, but the stepper
goes on draining its accumulator, so `alpha` keeps sawtoothing across `[0,1)` while each
`InterpolatedVector`'s previous/current pair stays pinned to the last live step —
`sample(alpha)` then blends back and forth across that step's displacement for the whole freeze.
On a full-strength slam the last recorded step spans about 0.75 m vertically, and
`camera.lookAt(sampledPosition)` rotates with it on top of the deliberate shake, which is
exactly why it read as *extra shake* rather than as a bug. `update` now calls
`InterpolatedVector.reset()` on the player position lerp, the player forward lerp and every
enemy position lerp before returning, on every frozen frame — `reset` is idempotent while
nothing records, so repeating it is cheaper than carrying a second piece of freeze state that
can fall out of step with `hitstop`. Note that the in-game measurement below ("bit-identical
for 4 consecutive frames") could not have caught this: its synthetic-clock harness advances a
fixed delta per frame, which holds `alpha` constant.

**A hitstop is invisible below roughly 20 FPS**, and that is inherent rather than fixable. The
freeze is measured in simulation time, and `createStepper` runs up to `MAX_STEPS_PER_FRAME` (5)
simulation steps inside a single rendered frame — so a lag frame consumes 5 × 16.7ms = 83ms of
simulation, swallowing a whole 70ms `downSeconds` freeze between two rendered images. The player
sees no pause at all. Any simulation-time freeze has this property; the alternative is a
wall-clock freeze that would stop *rendering* too, which is worse. It degrades gracefully — the
shake, the hurt flash and the audio all still fire — so it is documented, not worked around.

`src/fx/shake.ts` is the camera kick: a decaying pair of sines at different frequencies rather
than `Math.random()`, so it can be asserted about rather than merely eyeballed. Two rules in it
are easy to undo by accident. The offset is added to `camera.position` in `syncVisuals` and is
**never** written back into `cameraPosition`, the module-level smoothed follow state — write it
back and the exponential smoothing integrates the shake, and the camera drifts away from the
player instead of vibrating around him. And `lookAt` keeps targeting the unshaken
`sampledPosition`; shaking the look target too would rotate the view around the shake instead of
translating it, which reads as the world tilting rather than the camera being hit. It is stepped
in `syncVisuals` with `frameDt`, not in `update`, specifically so it keeps animating *through* a
freeze — a freeze with a shaking camera is the impact; a still freeze followed by a shake is two
separate events, because `update` is exactly what the freeze stops.

A plan defect caught during implementation, worth recording as a trap in its own right:
`shakeOffset`'s two axes each swing at `sin × amplitude`, and the vector the pair forms can reach
`amplitude × √2` when both peak together — which failed the amplitude-bound test the design
called for, because that bound is on the vector's length, not on each axis alone. Both axes are
now divided by `√2` (`Math.SQRT2` in the source) so "amplitude" genuinely means the camera's
maximum displacement, not a per-axis figure that overshoots it diagonally.

A known cosmetic edge, left alone deliberately: **opening the guide panel mid-shake leaves
`camera.position` frozen up to 0.35 units off-centre** for as long as the panel is up. The guide
branch of `frame()` renders directly and never calls `syncVisuals`, which is where `stepShake`
advances — so the shake stops decaying with a non-zero offset still added to the camera, and the
view sits slightly askew behind the panel until the panel closes and the decay resumes. 0.35 is
`slamMaxAmplitude`, the worst case. Not worth stepping the shake from the guide branch, which
would mean either duplicating the offset application or running `syncVisuals` for a paused
world; it self-corrects on close.

Confirmed in the running game, not just in tests: landing a gust that downed a weakened soldier
froze `avatar.position` bit-identically for **4 consecutive driven frames** (0.0667s, matching
`downSeconds: 0.07` almost exactly) while `W` was held the whole time, and a `Space` keydown
dispatched mid-freeze was not dropped — it fired the instant the freeze ended, producing a real
jump arc starting on the very frame movement resumed. Over the same event, `camera.position`
moved non-monotonically (up/down/up/down) for the freeze's duration and about six frames after,
then settled into clean camera-follow; the smoothed follow state's resting offset from the
player was compared before this event (`horizontal radius 6.978`) and after it, once the player
had landed and gone still again (`7.005`) — within 0.4% of each other, which is the check that
the shake did not leak into `cameraPosition` and permanently shift the camera.

**The hurt flash.** `HudModel` gains `hurtFlash: number` and `src/ui/hud.ts` draws a `.hud-hurt`
overlay, red rather than the existing gold `.hud-vignette`. It deliberately has **no CSS
transition**, unlike `.hud-vignette` right next to it (`transition: opacity .35s`), because the
decay is driven from the simulation via `stepPulse` in `src/fx/pulse.ts` — a CSS transition would
fight that decay and smear the flash past its own timer instead of cutting cleanly with it.
`stepPulse` is the same function the dash FOV kick decays through, one fewer near-duplicate timer
than the original design sketched.

**The staff spark, and the bug it fixes.** `src/fx/impact-targets.ts` now owns the union of the
fight's four connect lists (gust, slam, staff, downed) and the rule that a down overrides a
connect for the same enemy — an enemy in both lists gets a down burst, not a hit burst. Before
this module existed, `main.ts` built that union from the gust and slam lists only, so
`staffHitThisFrame` fed Focus and nothing else: **the staff was the only attack in the game with
no hit spark**, on top of being the newest one. This stayed hidden because a staff swing that
downed a soldier still sparked, through the separate `downedThisFrame` loop, which is what made a
staff *connect* that didn't down look like it was working.

**The dash FOV kick.** `fovKickForDash` in `src/fx/mapping.ts` adds up to 6 degrees, additive on
top of `fovForSpeed`, decaying to zero across the dash. On foot the field of view was pinned at
`fovForSpeed(0)` — a constant — so a 26 m/s ground dash had no visual weight at all; 6 degrees is
deliberately well under `MAX_FOV_KICK`'s existing 14 for full glider speed, so a dash reads as a
burst rather than as flight.

**Five synthesised voices.** `src/fx/combat-audio.ts` gives the fight sound for the first time —
gust, swing, impact, down, hurt — all procedural, no asset files, built the same shape as the
existing `src/fx/audio.ts` (lazy `AudioContext`, a `try`/`catch` that warns and continues
silently, a `dispose()`). It is untested for the same reason `audio.ts` is: there is no
`AudioContext` in the Vitest node environment, and mocking one would only test the mock. The
relative mix — how loud each voice sits against the others — lives in `mapping.ts`'s
`COMBAT_LEVELS`, which is pure data and is the part of this feature that can actually be wrong
without anyone noticing until they listen.

**The patrol respawn.** `src/combat/patrol.ts` is what makes a fight repeatable instead of a
one-shot budget: before this, three soldiers going down ended combat for the session, and every
value in the feel pass above became untestable a second time without a page reload.
`shouldRestorePatrol` restores when every soldier is down and the player is beyond
`respawnRange` (40) of every spawn point. Restoring while the player is far away *is*
leave-and-return, with no second piece of state to desynchronise from the enemy list — no
arm-on-leaving, fire-on-returning machine. The 40-against-`aggroRange`-26 gap is the point: a
fresh soldier must never appear already inside its own notice range, or the player turns around
into a fight that spawned on top of them.

Two traps here cost real time. The restore call in `stepEncounter` runs at the very **end** of
the function, after `downedThisFrame` and `lostThisFrame` are computed, because `wasDowned` is
diffed at the *top* of `stepEncounter` — restoring earlier would compare a fresh, healthy soldier
against the downed one it replaced and report a phantom hit for the frame. And `main.ts` must
delete `enemyPositionLerps` for every restored id, because ids are reused: without that, a stale
interpolator would blend the view from wherever the old body fell to the fresh spawn point,
sliding across the map — including climbing up out of the void for a soldier that fell out of the
world.

Two more traps, both found by review after the feature was already green, both about the restore
being the one thing in the frame that replaces the enemy array. First, `main.ts` must read
`fight.enemiesBeforeRestore` — not `encounter.enemies` — when it needs a position for anything
in this frame's event lists. Every one of those lists is computed *before* the restore (it has
to be, per the ordering trap above), so on a frame that both reports a down and restores the
patrol, `encounter.enemies` holds fresh soldiers at their spawn points and no longer knows where
the body fell. It is reachable: soldiers chase inside `aggroRange` 26, so kiting the last one 45+
units out with the other two already down downs it *and* satisfies the restore condition on the
same frame — and the down spark was drawn back on the patrol ground while the freeze, the shake
and the thud fired around a player 45 units away. Second, the spawn array handed to
`startEncounter` and the one handed to `deps.spawns` must be **the same array**. They were not:
the initial three were dropped onto the terrain and the deps got raw `HOME_PATROL`, whose entries
all carry `y: 0`, so a *restored* soldier spawned about 30 m inside the home island (an icosphere
at the origin — ground at `(26, -18)` is roughly 30 m up) for `fall()` to snap out on its first
step. That was invisible only by luck, since a 30 m correction exceeds the interpolator's snap
distance and the view collapses instead of sliding; over lower terrain it would have slid visibly
up out of the ground. `main.ts` now builds one `patrolSpawns` const and passes it to both.

A test-coverage trap worth recording on its own: the restore-ordering guard above could not be
caught by any test running at production tuning, because `respawnRange` (40) exceeds every
weapon's reach, so a restore and a landing attack can never coincide in a real config. There is
now a regression-guard test in `src/combat/encounter.test.ts` using a deliberately small
test-local `respawnRange` of 5 against the gust's range of 12, specifically so the two *can*
coincide. **Do not "fix" that fixture back to 40** — it would silently disarm the guard it exists
to run. The test's own comment says so.

Confirmed in the running game, not just in tests: downed all three home-patrol soldiers, moved
43-63 units away (comfortably past `respawnRange`'s 40, on two independent trials), and read the
restored enemies' exact positions off the live scene graph — `(26, 10.87, -18)`, `(34, 10.19,
-8)`, `(20, 11.50, -4)`, an exact x/z match to `HOME_PATROL`'s spawn coordinates with y dropped
onto real terrain height (not the authored `y: 0`), while the actual fallen bodies had been
scattered elsewhere entirely (e.g. `(9.11, -8.93)`, `(15.83, -15.63)`, `(11.15, 3.42)`) moments
before. Reproduced twice with identical results.

**Section 4.6's first half.** `EnemyStep` gains `fellOutOfWorld`, true only on the transition
frame an enemy passes `worldFloorY` while still alive — every other return, including the parked
branch for a body already down and below the floor, reports `false`, so the flag never latches.
`EncounterStep` gains `lostThisFrame`, and `downedThisFrame` **excludes** every id in it — without
that subtraction, an enemy that falls out of the world would land in both lists and be paid twice
for one removal. `FocusEvents` gains `accidents`, paid at `accidentDownGain: 5` in
`src/focus/config.ts`, against the existing `downGain: 14` for an in-place knockdown — roughly a
third, "just below `dodgeGain`'s 8" per the spec's own reasoning. This is the first time the
Focus meter has had an opinion about *how* an enemy was removed, and it is the first half of
§4.6's non-lethality scoring; see "What has NOT been built" above for the half that is still
open. Spec at
[`docs/superpowers/specs/2026-08-05-impact-feel-and-encounter-lifecycle-design.md`](superpowers/specs/2026-08-05-impact-feel-and-encounter-lifecycle-design.md).

Confirmed in the running game, not just in tests: weakened a soldier to 0.5hp and read the HUD's
own rendered `.hud-focus-fill` `scaleX` (not the internal `Focus.value`) across the exact driven
frame a gust both connected with and downed it — `scaleX` moved `0.00904 → 0.26507`, a Focus
delta of **+25.6** in one frame, matching `gustConnectGain (6) + downGain (14) = 20` scaled by an
active chain-ramp multiplier (`chainRampMax: 1.8`; 20 × 1.28 ≈ 25.6). Separately, an aggro-chased
soldier was led over a real island edge under its own AI with zero damage dealt to it, and its
health-bar stayed a normal positive value for the entire ~13-16 second fall before flipping to
the downed sentinel at the exact frame its `y` crossed `worldFloorY` — confirming the mechanism
fires only while the enemy is genuinely still alive at the crossing. Reproduced three times.

Two honest caveats on this pair, and they should not be softened. **The accident's Focus gain has
no clean measured per-event delta to set against the +25.6 above.** The mechanism was confirmed
in play exactly as described, but the fall itself takes on the order of 800-950 driven frames to
cross the world floor, and batch-driving in chunks large enough to be practical always overshot
the exact transition frame — so every "before/after" read spans several seconds of ordinary idle
drain and traversal gain, which swamps a 5-point signal. One such window showed a raw delta of
+36.9 for what was actually two simultaneous accidents plus unrelated traversal gain; another
showed a net delta of 0 because the gain drained back out before it could be read. The magnitude
claim rests on the unit test and the `downGain: 14` / `accidentDownGain: 5` constants themselves,
not on a matching in-game number.

That same fall length is a real design problem, not only a measurement one: **the accident's
Focus arrives roughly 8 seconds after the act that earned it.** `accidentDownGain` is paid on the
frame the enemy crosses `worldFloorY`, which is `-600` in `ARCHIPELAGO`, and under gravity 20 a
fall from island height takes `√(2 × 600 / 20)` ≈ 7.7 seconds to get there. §4.6's *magnitude*
rule is satisfied — an accident pays less than a knockdown — but its feedback is disconnected
from the player's action: by the time the meter moves, the gust that walked a soldier off a cliff
is eight seconds and several other events in the past, so the player has no way to learn which
one paid. This is also the real reason the in-game pass could not isolate the delta above. Worth
revisiting alongside the other half of §4.6: paying at the moment the enemy leaves the ground
unsupported, rather than at the floor crossing, would connect the grant to the act — at the cost
of paying for falls that a lucky updraft rescues. **The five voices, the dash FOV kick, and the hurt flash were
not verified in the running game at all** — the in-game verification pass covered the freeze, the
shake, the staff spark, the patrol restore, and the accident-versus-down mechanism, and those
three were not among the items it checked.

**Every value in this cycle is a guess about feel, which no test can check** — same caveat this
document already carries for the movement and combat tuning below, extended to
`hitstop.*Seconds`, every `shake` amplitude and duration, `hurtFlash`'s decay rate,
`fovKickForDash`'s peak, `patrol.respawnRange`, and `accidentDownGain`. The deliverable is that
each of them is named in a module a test can import, and none of them is buried in `main.ts`:
`src/fx/config.ts` (the hitstop table, the shake table, `HURT_FLASH_DECAY_PER_SECOND`),
`src/fx/mapping.ts` (`MAX_DASH_FOV_KICK`, and `COMBAT_LEVELS` for the audio mix),
`src/combat/config.ts` (`DEFAULT_PATROL_CONFIG`) and `src/focus/config.ts`
(`accidentDownGain`). Not that any of them are right.

`HURT_FLASH_DECAY_PER_SECOND` in particular started life as a `const` in `main.ts` and was moved
here for exactly this reason. This section used to say the dash kick's own decay rate should
stay derived in `main.ts`, as `1 / DEFAULT_GROUND_CONFIG.dashDurationSeconds`, rather than
named as a tuning value — `dashDurationSeconds` has since been deleted (the feel batch, below,
found the simulation never actually read it), and the kick now reads a named
`DASH_KICK_DECAY_PER_SECOND` from `src/fx/config.ts` instead, deliberately keeping its own
0.22 s lifetime rather than chasing the dash's real and differently-shaped decay. See "The dash
trail was drawn for a dash that doesn't happen" below for why deriving one from the other would
have been wrong a second way.

**The aim tell.** `src/fx/aim-tell.ts` gives the gust a preview instead of leaving its reach to
be learned by throwing it at people. A ground chevron sits `markerDistance` (3 units) along
`player.forward`, and a 12-unit, 120-degree sector matching the gust's true **horizontal**
footprint lights up — dimmed to 40% while the
gust is on cooldown, invisible otherwise — the instant a live soldier is inside it. Both are
parented to the scene, not to the avatar: the avatar's rotation is driven off the
*interpolated* heading so it renders smoothly between simulation steps, and a tell for a hit
volume has to read the value the hit itself reads, `player.forward`, or it can point somewhere
the gust does not go.

This entry said "a true 12-unit, 120-degree sector" before the vertical-reach cycle, and that
now understates the volume: the tell is flat and the gust is a slab, so the preview shows
none of the 10 units of height the move has. `aim-tell.test.ts`'s cross-check flattens every
probe to the caster's own level, so it never binds `verticalReach` either, and it has been
renamed to say so. See "A known cosmetic mismatch" under "Vertical reach". Spec at
[`docs/superpowers/specs/2026-08-05-aiming-and-stall-readability-design.md`](superpowers/specs/2026-08-05-aiming-and-stall-readability-design.md).

**`src/fx/sector.ts`** now owns the one true theta convention for a horizontal cone —
`gust-cone.ts` and the aim preview both need to lay a `RingGeometry` flat and centre it on
local +Z, and a second copy of the `-PI/2 - halfAngle` offset would drift out of step
silently, because a rotated cone still looks like a cone. `gust-cone.test.ts`'s containment
check against `inGust` remains the independent authority on whether the convention is right at
all; `sector.test.ts` derives the flattening mapping itself from the rotation rather than
importing the constant it is checking, so it cannot pass by construction.

**`liveGustTargets`**, in `src/combat/gust.ts`, is `gustTargets` filtered to enemies that are
not downed, and it has to be a separate function rather than a flag on the existing one:
`gustTargets` deliberately includes downed enemies, because `stepEncounter` needs that to
resolve a gust clipping a corpse without double-counting a kill, and the aim preview needs the
opposite — a preview lit for a body already on the ground promises a hit the gust cannot
deliver.

**`stallSeverity`**, in `src/player/stall.ts`, is 0 while flying and ramps to 1 at rest,
mirroring the `stallFactor` that `flightStep` already computes so the tell cannot disagree
with the physics it describes. The trap it exists to close: airspeed is shown in both
postures, and a walk (7 m/s) is already under the glider's stall speed (8). An ungated
severity would read the stall colour while the player strolled around an island on foot. The
gate — `state.mode !== 'glider'` returns 0 — lives in `stall.ts` itself rather than in the
HUD, because the wing shudder needs the identical value and a gate duplicated at two call
sites is a gate that can disagree with itself.

**The wing shudder** composes inside `glider.ts`'s own `apply()`, for the same reason the
staff sweep does: that function rewrites every wing and staff transform from `openness` every
frame, and anything set from outside it is overwritten on the next one. The trap: its gate is
`openness > 1e-3` — the *opposite* of the staff sweep's `openness < 1e-3` in the same
function. The two conditions read easy to swap by accident, and swapping them has a real
consequence: the sweep applies while the glider is stowed, because that is when the staff is a
weapon; the shudder applies while it is open, because a stowed walking stick has no wing to
flutter. `SHUDDER_AMPLITUDE` (0.09 rad) and `SHUDDER_FREQUENCY` (34 rad/s, ≈5.4 Hz) are plain
trig on accumulated time, not `Math.random()`, for the reason `src/fx/shake.ts` already
established: a random shudder cannot be asserted about.

Confirmed in the running game, not just in tests, four of the five things this cycle claimed.
Turning on the spot through five deltas including one crossing 180°, the marker's derived
heading matched `player.forward` to within 1e-3 every time, and a gust fired dead-ahead at a
soldier 3.16 m out knocked it back along exactly the pre-hit direction to the soldier — facing
and resolved hit agree, the same relationship whose failure once shipped the glider-only
`forward` bug recorded earlier in this document. The preview appeared only once a
walked-toward soldier crossed inside 12 units (13.11 → 11.38 across one 0.25 s sample), and —
the control that actually matters — it dropped from visible to hidden 3-4 frames after a
soldier it was still centred on was downed, at a distance of 2-5 units, nowhere near leaving
the cone: `liveGustTargets` is doing real work, not decoration. `preview.scale.x` read exactly
`12` the frame before firing, and the fired cone's own baked `outerRadius` also read exactly
`12` — not merely close. And the stall shudder was confirmed absent on foot at 40+ m/s of fall
speed (a harder stress case than the brief asked for), present only in `glider` mode,
oscillating at ≈5.46 Hz against the code's own claimed 5.41, with two pivots exactly mirrored
(`p4 = -p0` on every sample) and a third pivot in the opposite phase, confirming the
alternation is real rather than two coincidental wobbles.

**The fifth claim was wrong, and the wrongness was caught by the verification pass doing its
job.** The spec, the plan, and three source comments all asserted that the Avatar State widens
the gust's cone, and used that to justify `aim-tell.ts` reading `fightConfig.gust` instead of a
hard-coded default. Task 8's own Step 5 asked, on the strength of that claim, to confirm the
preview's radius grows while the state is active — and it does not, because nothing does.
`boostedCombatConfig` (`src/focus/effects.ts`) rebuilds the gust's `damage`, `knockback` and
`cooldownSeconds` only; `range` and `halfAngle` pass through the spread (`...c.gust`)
unchanged, and `AvatarStateConfig` has no field that could widen either one. This was proven
live, not just read from source: with the Avatar State demonstrably active — the same shot
one-shot a soldier, which only happens at the tripled damage — `preview.scale.x` and the fired
cone's `outerRadius` both still read exactly `12`. The lesson worth keeping: a plan step that
asks you to *measure* a claim is not a plan step that has *verified* the claim is even true.
Nobody had checked this one against the code that supposedly implemented it until the in-game
pass tried to reproduce it and found nothing to reproduce. Reading `fightConfig.gust` is still
right and stays — the preview must draw whatever range it is handed rather than a value
compiled into this module, which holds regardless of whether anything currently varies that
range — but every comment that justified it by appeal to the Avatar State has been corrected
to say so honestly instead of repeating the claim.

**Whether the Avatar State should widen the gust is now an open design question, not a bug.**
§4.5 calls the state "short, loud," and a wider sweep would fit that description at least as
well as the damage and knockback multipliers already there do. Nothing currently asks for it
and nothing here builds it — flagging it for whoever next touches `AvatarStateConfig` or the
design document's §4.5.

Two honest caveats on this pair. First, items 1 through 4 above were all measured on foot or in
`ground` mode; glider-mode aiming was only exercised incidentally, while getting into position
for item 5's Focus-building flight, and `forward` behaves differently there — it eases toward
the look direction via `steerToward` rather than snapping instantly, which is what made the
ground-mode turn-follow measurement exact and cheap in the first place. The marker and preview
read the same `player.forward` field regardless of posture, so there is no reason to expect a
difference, but the specific numbers above were not re-measured mid-bank in the air. Second,
§2.2 of the design document asks for control softening alongside the shudder on a stall —
"control softens, the wings shudder" — and this cycle deliberately built only the second half.
Softening turn authority changes the flight model itself, and `baseTurnRate` and
`weightShiftTurnRate` are already flagged elsewhere in this document as two of the most
suspect unplayed values in the project. Readability was this cycle's job; how a stall should
*feel* is a decision to make with a mouse in hand, not from this cycle's spec.

**Every value in this cycle is a guess about feel, which no test can check** — the same caveat
this document already carries for the movement, combat and impact-feel tuning above, extended
to `src/fx/config.ts`'s `DEFAULT_AIM_TELL_CONFIG` (`markerDistance`, `markerSize`,
`previewOpacity`, `dimmedFactor`) and `src/player/glider.ts`'s `SHUDDER_AMPLITUDE` and
`SHUDDER_FREQUENCY`. The deliverable is that each is named in a module a test can import, not
that any of them is right.

**Going down.** `src/player/down.ts` is the system `health.ts` was waiting for when it said
standing a downed combatant back up is "a decision for a system above this one". Health at
zero freezes the simulation for 1.5 seconds, fades to black, and stands the player back up at
`lastGroundIslandId` at full health with Focus wiped — reusing `safeRespawn`, the same path
falling out of the world already takes. The fight is left exactly as it was — enemies keep
their damage, positions and stances, so the patrol may well still be aggroed on the walk back
in. Respawning is a free heal and attrition-by-dying is technically viable; that was accepted
rather than overlooked, because closing it means resetting an encounter and nothing else in
this codebase resets.

The beat is a pure timer with no scene in it, so all of its behaviour is in
`down.test.ts` — including the non-finite guard, which fails *open*. A clamped timer would
leave the player in a permanently frozen world with no input, and that is the only way this
feature can break badly. The `main.ts` wiring has no test, as usual for that file; it was
verified in the running game.

There is no collapse animation — the model still ships only idle, walk, run, fall and glide,
so the sink is driven through the squash channel that jump charging uses. A real clip is
the obvious follow-up. Spec:
[`docs/superpowers/specs/2026-08-05-player-down-design.md`](superpowers/specs/2026-08-05-player-down-design.md).

**Getting back up.** `src/combat/enemy.ts` gained a recovery ladder: a downed soldier waits
`downedSeconds`, pushes up over `risingSeconds`, and comes back on the next rung of
`recoveryHealthFractions` — 60% then 30% of max, which against a gust's damage is three
gusts to put down, then two, then one. Run off the end of the array and the down is
permanent. An empty array turns the whole feature off, which is the behaviour this module
had before.

Health stays at **zero** through both `downed` and `rising`, and that one choice is what
made the interrupt free: `hitEnemy` already ends with
`stance: isDowned(health) ? 'downed' : 'recover'`, so a hit during a rise puts the soldier
back down with the timer reset and no new code. It deliberately does *not* advance `downs` —
interrupting buys time, it does not substitute for damage. The cost was elsewhere: every
resolver in `encounter.ts` gated on `!isDowned`, which would have skipped a rising soldier
entirely, so all seven now ask `isTargetable`.

This sits beside `patrol.ts`'s restore rather than replacing it. That one is encounter-level
and needs the player to leave; this one is per-soldier and happens mid-fight. A restore
rebuilds the array with `spawnEnemy`, so it resets `downs` — a restored patrol is a fresh
patrol, which is what it already meant.

Focus pays `firstDownsThisFrame`, not `downedThisFrame`, so the ladder cannot be walked as a
Focus engine; the impact burst still fires on every down. Whether paying the *first* down
rather than the *last* is the right way round is an open question — §4.6 pays downs because
a non-lethal removal is the generous play, and the removal that sticks is the last one. It
is a one-line filter if it is revisited. Spec:
[`docs/superpowers/specs/2026-08-06-enemy-recovery-design.md`](superpowers/specs/2026-08-06-enemy-recovery-design.md).

The ladder is per-kind config, so the archer carries it too — the same `downedSeconds: 18`,
`risingSeconds: 1.2` and `[0.6, 0.3]` fractions as the spear, applied to its own smaller
`maxHealth`. Nothing in the recovery logic is kind-specific; giving the archer a different
countdown would be a tuning decision, and there is no argument for one yet.

**Archers, and the axis that was missing.** Before this cycle, climbing was a win condition.
Spear infantry notices at 26 units and closes only horizontally, and `stepEnemy` says outright
that it does not chase into the sky, so getting above one ended any fight it was in. That single
fact quietly undercut three systems that already existed and were already tested: the
Slipstream's 0.11s dodge window had nothing to beat but a slow spear thrust, the hover was the
single most expensive thing Breath could buy with nothing that needed buying it for, and the
staff's no-glider gate — the design document's own "central risk decision" — cost nothing at
all, because on the ground against slow infantry there was never a reason to want the wing.
Archers fix all three by existing, which is worth stating before any implementation detail below.

`src/combat/enemy.ts` gains `EnemyKind` (`'spear' | 'archer'` — identity: which view and which
config lookup apply) and `EnemyAttack` (`{ kind: 'melee'; damage }` or `{ kind: 'projectile';
damage; speed }` — a description of what a release produces). Both soldiers run the same
four-beat state machine — advance, wind up, release, recover — and `EnemyAttack` describes the
release rather than forking the machine, because the design document's enemy contract lists six
types and only two exist yet. A discriminated union of whole enemies would be the right call if
the types diverged sharply; today it would be a large refactor of the combat core built on a
guess about four types that are not written.

**The one branch that genuinely diverges: a projectile attacker measures both notice and commit
in 3D.** `stepEnemy` picks `moved.position.distanceTo(playerPosition)` for `c.attack.kind ===
'projectile'` and `horizontalDistance(...)` otherwise, and uses that one `distance` for both
`aggroRange` and `strikeRange`. Measured horizontally, a player hovering directly overhead sits
at distance 0 and is inside any range at all — climbing would stop being an escape from an
archer too, and the whole type would deliver nothing. This is the only place the two kinds'
logic actually forks; everything else runs through the same function unmodified.

**The trap: `Enemy.facing` stays horizontal, because `enemy-mesh.ts` reads it through
`Math.atan2(facing.x, facing.z)`.** The aim is genuinely 3D — `firedProjectile.direction` is
`playerPosition.clone().sub(origin).normalize()`, with a real y component — but `facing`, which
only ever feeds that one `atan2` call to pose the model's yaw, is still `horizontalTo(...)`, flat
by construction. On level ground the two point the same way and nothing looks wrong; they are
not the same value, and must not be conflated, or a future change to how the model is posed will
silently assume an aim it does not have.

**A second trap, and the one most likely to mislead a future reader: "a spear cannot reach up"
is wrong.** Horizontal reach means height is **ignored**, not protective — a spear 2 units away
*does* hit a player 20 units overhead, and `enemy.test.ts`'s "still thrusts at a player almost
directly overhead" asserts exactly that as behaviour this cycle preserved, not broke. This
cycle's own plan got that backwards: an early draft of the in-game verification step asked to
confirm a spear 2 units away and 20 units up does *not* damage the player, which contradicts that
same test and was caught only because the in-game pass declined to report a failure against code
it had just re-read and found correct. The plan was corrected (commit `0075332`) to check both
directions — height ignored at 2 units, out of reach at 10 — instead of the wrong one. Recording
the correction here, since it is exactly the sort of thing a future reader, working from instinct
rather than the test, would "fix" into a bug.

**Closed, and it took two more cycles.** This entry warned that the shorthand was wrong while
leaving it in place at the top of `stepEnemy`'s own comment — where the sentences *after* it
already described the mechanism correctly, so the comment contradicted itself and a reader had no
way to tell which half to trust. It was then copied into the off-screen-indicator cycle's design,
where it became the stated justification for a rule that left the player taking undirected damage
from a spear standing underneath them (see "Off-screen enemy indicators"). Both the source comment
and the archers spec now say that horizontal reach *ignores* height rather than being stopped by
it, and both name the test that pins it.

And the sharpest part of it: the correct explanation was written down **at the time**, in the
archers plan's own verification step — "'A spear cannot reach up' was sloppy shorthand for 'a
spear's reach is not measured in 3D'. Measuring horizontally means height is **ignored**, not that
height protects you." That sentence has been sitting in
`docs/superpowers/plans/2026-08-05-archers-and-projectiles.md` since the cycle that introduced the
problem. It was correct, it was specific, and it never reached the one place a future reader would
actually look. So the lesson is not about spears: a correction that lives only in a plan or a
handoff, while the wrong sentence stays in the source, is a correction that will be re-broken —
the code is what the next cycle reads, and the next cycle copied the wrong version into a design
document and built a rule on it.

**Arrows.** `src/combat/projectile.ts`'s `Projectile` is straight-line with no gravity — a
falling arrow needs an archer that leads a moving target, which is a later config addition if
the flat flight ever feels wrong, not a redesign. `Encounter` (`src/combat/encounter.ts`) owns
`projectiles: Projectile[]` and `nextProjectileId`, a counter rather than `Math.random()`, for
the same reason the rest of this codebase's ids are counters: the effects layer keys a view off
them, and this project's tests cannot tolerate an unrepeatable value.

**The ordering constraint: arrows step before new ones spawn.** `stepEncounter` advances
`encounter.projectiles` before the enemy loop that fires this frame's new ones, and the comment
at the top of the function calls this out as load-bearing, not incidental: get it backwards and
an arrow advances on the very frame it is fired, appearing already a metre or two from the bow.

**The restore clears the projectiles.** The same branch in `stepEncounter` that respawns the
enemy array on `shouldRestorePatrol` also resets `projectiles` to `[]`, because an arrow loosed
by a fight that is now over would otherwise still be live when the player walks back into a
fresh patrol — striking someone who was never shot at by anything currently on the map.

**The respawn-range invariant broke against the archer, and got fixed at the archer's number,
not the respawn range's.** `respawnRange` must clear every enemy kind's `aggroRange` by a real
margin, or a restored soldier can appear already inside its own notice range and the player
turns around into a fight that spawned on top of them. The archer's `aggroRange` of 48 shipped
against the earlier `respawnRange` of 40 with nothing objecting — an 8-unit violation — because
the regression test for this exact invariant checked only `enemies.spear.aggroRange`, a literal
left behind when `CombatConfig.enemy` became a per-kind `Record`. `DEFAULT_PATROL_CONFIG.respawnRange`
went to 66, clearing the archer's then-48 by the same 1.3 margin the test enforces (48 × 1.3 = 62.4).
The fixed point is the archer's `aggroRange`, not `respawnRange`: it is what makes climbing stop
being a win condition, this cycle's whole point, so it does not move for hygiene reasons, and the
hygiene value moves around it instead.

**And then the archer moved on its own terms, so `respawnRange` followed it down.** Bringing the
archer's reach down at both ends — `strikeRange` 40 → 30, `aggroRange` 48 → 38 — left
`respawnRange` at 66 clearing a floor of 38 × 1.3 = 49.4 by 17 units, far more separation than the
rule asks for and a longer walk to a restore than anything justified. It is now **52**: the same
slack over 49.4 that 66 had over 62.4. The order of authority is unchanged — the archer's number
is the design one and this one tracks it — but the direction reversed, so the cost recorded here
previously (a restore needing the player 66 units out instead of 40) has largely gone away.
Deliberately not pinned to the bare floor of 50: this value has already needed fixing once for
being pinned to a number the archer then outgrew.

**The violation was confirmed by playing it out, not only by comparing the two constants.** The
config-invariant test in `patrol.test.ts` asserts a relationship between numbers, which leaves
open whether the gap was ever reachable in a real frame. Two blocks in `encounter.test.ts` close
that. `the shipped patrol restores out of every soldier's notice range` sweeps the ground plane on
a one-unit grid, and for every position where `stepEncounter` actually restores the home patrol it
requires no restored soldier to be inside its own `aggroRange`, measured in 3D the way `stepEnemy`
measures a ranged soldier's. At the old `respawnRange` of 40 that sweep reports 1907 offending
positions, all of them `archer-2`; at 66 it reported none, and at today's 52 it still reports none.
The sweep replaces a hand-picked position on purpose — a single coordinate is pinned to today's
`HOME_PATROL` layout and would quietly stop testing anything if the spawns or the ranges were
retuned. Both guards were re-checked against the current numbers by dropping `respawnRange` to 30,
below the archer's 38: the sweep and the `patrol.test.ts` margin assertion both go red, so neither
is passing vacuously at the smaller ranges.

`a restore that lands inside an archer's notice range` is the other half: it holds a test-local
`respawnRange` below the fixture archer's `aggroRange`, in the same spirit as the two
`respawnRange: 5` fixtures already in that file, so the failure mode stays observable no matter
where the shipped values end up. What it shows is narrower than "the archer fires on the restore
frame", and the narrowness is not a defence. Nothing can fire on that frame: fresh soldiers are
built *after* the enemy-stepping loop, so they do not act at all on the frame they appear, and a
release needs a completed wind-up from inside `strikeRange`, which `respawnRange` sitting above
`strikeRange` rules out regardless. What the restored archer does instead is notice immediately and
spend the wind-up walking in — with the shipped numbers at the old 40, an arrow was in the air about
1.5 seconds after a restore the player triggered by walking away. Deferred, not avoided.

**The free leverage: arrow damage joins the same `damageToPlayer` total the spears feed.**
`stepEncounter` adds the frame's `projectileDamage` into `damageToPlayer` before computing
`avoided = input.playerInvulnerable && damageToPlayer > 0`, so a Slipstream dodges an arrow
exactly as it dodges a spear thrust, and `damageAvoided` grants Focus for it with no
arrow-specific code anywhere.

**`createEnemyView(kind)`** (`src/combat/enemy-mesh.ts`) builds either soldier off the same rig.
The spear's node name, geometry, position and rotation amounts are all unchanged from before this
cycle, because other tests in the file find it by name (`'spear'`) rather than by index, and
changing any of those would silently break a lookup elsewhere. The bow is a `TorusGeometry` arc
rather than a cone, named `'bow'`, and rotates less on a wind-up than the spear does — a draw
reads differently from a cock-back at distance.

**`src/fx/arrow.ts` uses `depthTest: true`, deliberately unlike every attack tell in `src/fx/`.**
A gust cone and a staff arc are drawn with `depthTest: false` because they show the player
something they did; an arrow visible through a hill would show the player something they should
not be able to see — the same reasoning already recorded for the enemy health bars.

**The `bowRelease` voice** (`src/fx/combat-audio.ts`, `COMBAT_LEVELS.bowRelease: 0.24`) fires on
the shot, not the impact. The release is the telegraph — an archer's wind-up is what makes the
attack dodgeable at all, and a sound on release gives the player a cue independent of whether
they happen to be looking at the soldier right then. An archer standing behind the player is
otherwise completely silent until the arrow lands. Spec at
[`docs/superpowers/specs/2026-08-05-archers-and-projectiles-design.md`](superpowers/specs/2026-08-05-archers-and-projectiles-design.md).

Confirmed in the running game, not just in tests, three of six items an in-game pass checked.
Climbing above a spear's old 26-unit ceiling no longer ends a fight: at 30.85 units above a live
archer (3D distance 36.7, inside its 40-unit strike range) the player was still taking hits,
health having already dropped from 1.0 to 0.2, and only past the archer's own 48-unit
`aggroRange` did new arrows stop spawning and health begin to regenerate. An archer genuinely
aims up: an in-flight arrow's own view position, sampled on two consecutive frames and
differenced independently of the simulation's `Projectile.velocity` field, gave a velocity of
`(-16.24, +2.62, +29.74)` — magnitude 33.99 against a configured speed of 34 — with a positive,
substantial y component rather than the near-zero one a flattened aim would produce. And arrow
views do not leak: over 7,500 driven frames (125 simulated seconds) of continuous archer fire,
the live count of `arrow-shaft` meshes in the scene never exceeded 1.

Three more confirmed only in part. A spear at 10 units is confirmed out of reach in play —
closing at 4.09 m/s against a configured 4.2, no damage until the gap crossed under the 3.2
`strikeRange` — but the 2-units-and-20-up case above (height ignored, not protective) was never
reached in play; holding a fixed small horizontal offset near a specific soldier while also
holding 40 units of altitude was not achieved in the time available, and that half rests on the
unit test alone. Arrow views exist with `depthTest: true`, read directly off a live in-flight
object rather than from source — but occlusion behind an actual hill was never seen, the same
caveat the health bars still carry. And a Slipstream protected the player's health against a
matched control — 1.0 held through a shot whose undodged twin cost 0.2 — but the accompanying
Focus grant read 0 where roughly 0.08 of the bar was expected. The code path was then read
directly and is correct: `encounter.ts` folds arrow damage into `damageToPlayer` before computing
`avoided`, and the chain runs on into `dodgeGain` exactly as it does for a spear; a unit test
asserts the flag. This is recorded as a claim verified by test and by reading, but not observed
in play — not a defect. +8 against a 100-point meter is 0.08 of the bar, easily masked by idle
drain or a stale HUD read on the one attempt this pass had time for.

Every tuning value in this cycle is an unplayed guess, same as the rest of this document's
tuning — but unlike most of this project's guesses, these are about *pressure* rather than feel,
so an hour of play will move them a long way. The archer's `aggroRange` most of all: it is the
number that decides whether climbing still wins.

**First tuning pass, and the coupling it exposed.** The archer shipped at `aggroRange` 48 with
`strikeRange` 40 and came down to **38 and 30**. The two have to move together: the 8-unit gap
between them is the closing band, about 2.4 seconds of walking at `moveSpeed` 3.4, and it is the
only warning the player gets before the first arrow. Dropping `aggroRange` alone squeezes that —
at 44 it is four units, at 42 it is two, and at 40 the archer fires the instant it notices, which
makes `config.ts`'s own comment false. So the floor on `aggroRange` alone is higher than it looks.

Measured by walking the player from the spawn straight at the patrol's centroid at `walkSpeed`,
before and after:

| | 48 / 40 | 38 / 30 |
|---|---|---|
| first arrow | t = 2.65 s, 18.6 units walked | t = 4.10 s, 28.7 units |
| first hit | t = 3.48 s | t = 3.85 s |
| health after 15 s | 2.73 / 5 | 3.89 / 5 |
| escape climb | 48 units above an archer | 38 units |

The interesting line is the third row read against the second. Before, the opening blow was an
*arrow* — loosed at 2.65 s with roughly 0.8 seconds of flight, landing at 3.48 s. After, arrows
start too late for that, so the first hit at 3.85 s is a **spear**. The first punch changed hands
from the back rank to the front, which is the shape §4.4 asks for: close the distance and the
spears punish you, hold back or climb and the archers do. That reordering is a better argument for
these values than the health figure is.

Still unplayed. If 38 / 30 turns out too soft, the next step down was measured as 42 / 34, which
keeps the same band.

**Two known problems, both measured rather than reasoned about, and both since fixed.** Neither
was a defect in the code that implemented it, which is why each was recorded rather than patched
on sight: the first was a tuning decision that belonged to whoever plays the game, the second a
design question about how a soldier should behave in a case the rule did not really cover. Each
was answered deliberately, and each answer is pinned by a test that failed first.

**`HOME_PATROL` used to open fire at spawn. It has been moved, and a test now pins it.**

Measured against the real terrain rather than a flat test plane: the player spawns at
`(0, 13.87, 0)`, and after each patrol position is dropped onto the ground, `archer-2` stood at
`(16, 9.86, -30)` — a 3D distance of 34.24, inside its own 40-unit `strikeRange`. So it did not
close first; it wound up on frame one and loosed at t = 0.82 s. First hit at t = 1.80 s, and a
player who loaded the game and touched nothing was at zero health by t = 5.63 s. The same run
with the archers removed gave a first hit at t = 4.67 s, so this was never new — `spear-3` at
20.53 units against a 26-unit notice range had been advancing on the spawn since long before
archers existed — but archers cut time-to-first-hit by a factor of 2.6 and made it obvious.

The patrol now sits further out: spears at radius 34 to 36, archers at radius 55, all on the
−Z side. Every soldier is outside its **own** notice range of the spawn point with at least 5
units of margin, so nothing engages a motionless player, and the first arrow now waits until the
player has walked roughly 15 units toward the group.

**The patrol is still findable from the spawn, and that was checked rather than assumed.** Moving
soldiers outward risks hiding them behind the island's own crest, which rises from about 7.9 units
at the centre to roughly 10.7 at radius 30 before falling away — so this needed measuring in the
running game. Standing at the spawn without touching anything, two of the three spears are inside
the camera frustum at 39.3 and 41.5 units with no mesh between the camera and them; the third is
off-frame to the right, at normalised device x of 1.384. Both archers project on screen but are
occluded, one behind another soldier's body and one behind terrain, which is what being the back
rank should look like. The soldiers land at a vertical pixel of 254 to 265 in a 720-tall canvas
against a horizon probe at 181, so they read as figures standing on the ground below the skyline
rather than as specks on it.

A warning for anyone repeating that check: at this distance a 1.8-unit soldier is a handful of
pixels and reads as scenery. A first pass over the same screenshot concluded the patrol was hidden,
which was wrong — the frustum test and the occlusion raycast are the mechanisms to trust here, and
a screenshot alone is not one. The camera's drawing buffer is also 2560×1440 against a 1280×720 CSS
size, so projected pixel coordinates need scaling before they can be compared against a captured
image at all.

`patrol-placement.test.ts` is the guard, and it needs the real island geometry rather than a
fixture: a soldier's distance from the spawn depends on the terrain height under both, so the
property cannot be read off the coordinates alone. It also pins that the archers stay behind the
spears, that nobody sits close enough to the rim for ordinary knockback to delete them, and that
somewhere on the home island is still beyond `respawnRange` of every spawn point — because
pushing the patrol outward pushes that requirement outward too.

Two things this deliberately did **not** change. `strikeRange` and `aggroRange` keep their
values; the placement moved instead, because the archer's 48-unit notice range is what makes
climbing stop being a win condition and is the last number that should be traded away. And
`config.ts`'s claim that `strikeRange` sits below `aggroRange` "so it closes before shooting
rather than opening fire the instant it notices" is now true of the patrol as well as of the two
numbers — it was the mismatch between those two readings that hid the problem in the first place.

**An archer directly beneath a hovering player used to twitch in place. It now holds station.**

At 45 units straight up it is inside `aggroRange` (48) and outside `strikeRange` (40), so it takes
the closing branch — where `horizontalTo` found a zero horizontal delta and fell back to
`(0, 0, -1)`. The outcome was already right: it never fires, which is the whole point of the type.
The motion was not. It did *not* march away in a fixed direction: it stepped 0.057 units (one frame
of `moveSpeed`) due −Z, at which point the horizontal delta was no longer zero and pointed back at
the player, so the next frame stepped it back to the origin. It oscillated between those two points
forever, `facing` reversing a full 180° every frame with it — at 60 fps a soldier spinning on the
spot rather than a soldier walking. Total ground ever covered: 0.057 units.

Holding station is not merely the cheapest of the three options that were on the table — the others
being a committed retreat heading, or a minimum stand-off band — it is the only one that is
geometrically right. While the player is straight up, *every* horizontal step lengthens the 3D
distance that is keeping the shot out of range, so the archer is already standing on the best
square available to it. A retreat heading would have looked more deliberate while making the
archer's position strictly worse. The genuinely interesting answer, moving to higher ground to
close the vertical gap instead, needs pathfinding and terrain sampling; it is a feature, and it is
not this.

Two changes carry it, both in `stepEnemy`. `horizontalTo` now returns `Vector3 | null` and reports
the absence of a heading instead of inventing one — a fabricated direction is indistinguishable
from a real one to every caller, which is precisely how a soldier came to walk along it and
manufacture the delta that had been missing. `facing` falls back to the heading already held, since
a soldier looking straight up has no yaw it ought to prefer. And the closing step is now capped at
the horizontal distance actually left to cover, because holding station on an *exact* zero does not
cover the neighbourhood around it: a player hovering 0.03 units off vertical is less than one
frame's step away, so the archer overshot their horizontal position and oscillated around it — the
same twitch, reachable by anyone using a real control stick rather than exact coordinates. The cap
only ever binds inside the last fraction of a step, and only for a ranged soldier: closing at all
requires the horizontal gap to exceed `strikeRange`, which for a spear is many times one frame's
walk, so melee behaviour is untouched.

Five tests in `enemy.test.ts` pin it, three of which failed first — the archer stays put over 120
frames, keeps one heading, and converges on a nearly-overhead player without crossing to the far
side. The other two were already green and are there to stay that way: it still never fires at a
player out of range, and it still closes at full `moveSpeed` on a player genuinely off to one side,
so the cap cannot quietly turn into an archer that never advances.

**Terrain collision, and the general cast it needed.** Before this cycle `TerrainQuery`
could only answer one question — what is directly below this point — through
`groundHeightAt` and `raycastDown`, and three systems were missing behaviour as a direct
result: the player passed through solid rock in both postures, the camera arm could not
shorten through a wall between it and the player, and the air scooter's tier drop was
unreachable because nothing could report a clip. One primitive fixes the first two; the
third is still open (see below).

`raycast(from, direction, maxDistance)` now replaces `raycastDown` on the `TerrainQuery`
interface, and `raycastDown` becomes a free helper built over it in
`src/world/terrain-query.ts`, unchanged in behaviour. Making the new method optional on
the interface — so existing fakes could keep implementing only `raycastDown` — was
considered and rejected: collision would then silently do nothing wherever a test double
happened to omit it, which is the same class of silent narrowing that once let
`patrol.test.ts` quietly shrink its own coverage. One capability, one implementation,
required of everything that claims to be a `TerrainQuery`.

`src/world/collision.ts`'s `resolveMovement` is pure functions over `Vector3` and a
`TerrainQuery` — no scene access, the same contract `flight.ts` and `enemy.ts` already
keep. It sweeps from the current position toward the destination and, on a hit, removes
the velocity component going into the surface while keeping the rest, so a fast approach
to a cliff skims along it rather than stopping dead. Only surfaces steeper than
`wallNormalY` (0.5 — about 60 degrees off horizontal) count as a wall at all; anything
flatter is ignored outright, deliberately, because ground already has two owners —
`groundStep`'s snap, which climbs slopes and small drops, and the glider's landing
probe — and a third opinion about where the ground is would eventually disagree with
them. The body is held `radius` (0.5) off whatever it hits. Resolution runs two passes:
one deflects off the near face of an inside corner and drives the body straight through
the far face, and the second pass catches that; a third pass changes nothing measurable
and costs a raycast every frame for it. The last pass does not slide toward the
recomputed destination the way the first one does — it simply stops at the wall, because
a slide destination on the final pass has nothing left to verify it isn't itself inside
more geometry.

The glider branch of `controllerStep` and `ground-move.ts`'s `groundStep` both resolve
through it, in opposite positions in their own pipelines for the same underlying reason:
`flightStep` produces a destination, collision resolves the path to it, and only then
does the landing probe run against the resolved position, so a player can't land on the
far side of a wall they should have hit; on foot, collision resolves after the position
integrates from velocity and before the ground snap, so the snap — which only ever
touches `y` — composes with a horizontal deflection instead of racing it.

**Measured before and after, on the real archipelago.** Before: a glider flown at the
`needle` island at 50 m/s entered at x 210 and left at x 112, clean through a rock
centred at x 150 with radius 12, still in glider mode. A sideways ray cast from the same
start point hit at 48.8 m, so the geometry was solid the whole time and nothing had ever
asked. After, the crossing is the permanent integration guard in
`terrain-collision.test.ts`, and neutralising `resolveMovement` inside that test
reproduces x 112.27 — independent confirmation, run after the fact, that the guard
actually exercises the crossing it claims to and that the original measurement was real.

**The camera arm shortens instead of lifting.** `pullInForTerrain` used to lift the
camera whenever terrain shared its column, unable to tell a wall between the camera and
the player from a roof over both. It now casts from the player toward the desired camera
position and, on a hit nearer than the arm's own length, places the camera at the hit
point pulled back along the ray by a small skin (`CAMERA_SKIN`, 0.3), floored at
`minDistance` — which **replaces** the lift rather than joining it, since keeping both
would leave two opinions about where the camera belongs. The skin exists because
`minDistance` alone was not enough: an earlier version of this cast placed the camera
exactly on the hit surface, which puts that surface at distance zero from the camera,
behind the near clip plane, and the player sees straight through it — the exact failure
this cast was written to fix. Four existing tests that asserted the lift (a `.y`
increase) were deliberately deleted and replaced with tests of the goal — the arm's
shortened *distance* — rather than of the mechanism that used to produce it. That is an
intended behaviour change, not a regression, and is recorded as such here so it doesn't
read as one to a future `git log` skim.

**A claim in the spec, the plan, and one commit message overstated what was found, and
it is worth knowing which one.** All three said, in effect, that walking into a hillside
was currently a death: that inside a mesh the ground snap's downward ray meets back
faces, a `FrontSide` material culls them, and the player falls through the island
interior and past the world floor into a respawn. Commit `2170495`'s own message says
outright, "Walking into a hillside was a death." That mechanism is real — a downward ray
cast from inside the `needle` and `home` meshes does return `null`, confirming back-face
culling swallows the interior — but the walking route to it does not exist on this
geometry: 83 inward runs, covering all thirteen islands from eight bearings each, 400
frames at sprint with collision disabled, produced zero respawns. The ground snap climbs
everything this noise generates, regardless of steepness or speed. What was not tried is
arriving inside a mesh by a jump, a dash, a charged-jump landing, or a glide impact, so
the honestly supportable claim is "no route found by ordinary walking," not
"unreachable." It is a **latent hazard, not an observed failure**, and the spec's "The
problem" section has been corrected to say that plainly. `2170495`'s commit message is
left as written, not rewritten to match — this document's own convention is to state
what was wrong and why rather than erase it, and a commit message is history rather than
documentation — so take that one line with the correction above rather than at face value
if you go looking.

**The frame cost.** `resolveMovement`, run against the real thirteen-island geometry,
costs 14.13 µs per call, beside the ground snap's own pre-existing `raycastDown` at
14.78 µs per call — so collision roughly doubles a per-step terrain-query cost the game
already paid every frame, and the addition comes to about 0.085% of a 60 Hz frame's
16.7 ms budget. Frame rate is a non-issue here.

**What the in-game verification did and did not establish, said plainly so it isn't
overread.** It confirmed the game loads and renders with the branch checked out, the
simulation genuinely advances (airspeed fell from 10 to 3 m/s across driven frames, HUD
bars appeared and moved), and the console holds no errors. It did **not** establish the
three interactive behaviours this cycle exists to fix — walking into rising ground,
flying into an island's side, or the camera pulling in against a rock face — because the
browser harness never obtains real OS focus on the tab, so pointer lock errors every
time it's requested (confirmed directly: a `pointerlockerror` listener fired on every
attempt), and `requestAnimationFrame` is throttled to zero in the backgrounded tab except
for the handful of frames a screenshot call forces to paint. Mouse-look was unavailable
for the entire session as a result, so the glider could not be reliably aimed at an
island or even confirmed to deploy. Those three behaviours are instead covered by the
real-geometry integration tests in `terrain-collision.test.ts` and `follow-cam.test.ts` —
which is weaker evidence than a human actually playing it, and should be read as such.
The game was not played to confirm this cycle's behaviour; the tests were.

**What is still not handled.** Enemies and arrows have no lateral collision — they move
horizontally and are ground-snapped every step, so passing through a wall was never
observable in play, which is why this was cut from scope rather than missed. A player who
starts a step already inside geometry stays stuck, because the outward ray meets the same
culled back faces that make the interior invisible from below; reachable only by
spawning inside a rock, which no level currently does. In a gap narrower than twice the
body radius (1 unit), the resolved position can land inside the far wall — inherent to
placing the body by a fixed radius offset with no depenetration pass to catch it, and the
brief always described this as a known limitation rather than a bug to fix here. And the
air scooter's `clipped` flag is still hardcoded `false`, at `ground-move.ts:76` — that was
the case before this cycle for lack of any way to detect a wall at all; now that
`resolveMovement` returns a real hit normal on contact, wiring that into the scooter's
tier drop is a genuinely available next step rather than a blocked one.

Two minors, deferred rather than fixed, worth a line each because a future reader may hit
them. `pullInForTerrain`'s `kept = Math.max(minDistance, distance)` has no upper clamp to
the arm's own length, so an arm shorter than `minDistance` would push the camera *past*
its target instead of pulling it in — unreachable today because both call sites build the
desired position from a camera profile's distance (7 and 12) against a `minDistance` of
2, comfortably above either. And `resolveMovement`'s remaining-travel figure, used to size
the second pass's sweep, measures the Euclidean distance from the first pass's stopping
point to the origin rather than distance travelled along the original sweep direction,
which overestimates by roughly 24% on a glancing hit — harmless today because the second
pass re-sweeps regardless, but it sets that pass's budget more generously than the
geometry actually calls for.

**The Slipstream dodge cost nothing, and now it does.** Nothing else in the game gives speed
for free — thrust costs 18 breath a second, hovering costs 30 — but the dodge added 30 m/s on a
1.5 s cooldown with no cost and no gate. Measured over forty seconds from y 300 at 30 m/s: a
plain glide ends at y 151, 23.1 m/s, breath full, total energy at ×0.51 of where it started,
which is what a glide is supposed to do. Chain-dodging on cooldown against the old code ended at
y 434, 76.9 m/s, breath still **full**, energy at ×1.81 — a 134-metre climb with the resource
meant to gate flight left completely untouched, a perpetual-motion machine. `flight.ts`'s lift
fallback carries a comment insisting a lift direction stay perpendicular to velocity, because a
component along the flight path "would do work and inject energy, breaking the invariant that
gliding never gains height" — that invariant holds inside `flightStep` and was broken one call
up, in `controllerStep`, where the dodge impulse is added after the integrator has already run.

**Two changes closed it.** `SlipstreamConfig` gains `breathCost`; `canSlipstream` refuses to fire
below it, and firing deducts it. And the glider's dodge now goes along the glider's own right
axis, banked by the glider's real bank, instead of falling back to a flattened forward heading —
`gliderRight`, a new export beside `gliderUp` in `flight.ts`, gives `dodgeHeading` a genuine
lateral axis in three dimensions rather than a flattened one.

**`breathCost` is 28, chosen against thrust.** Thrust buys `thrustAccel` 22 m/s² for
`breathDrainPerSecond` 18 — a ratio of 1.22 (m/s²) per (breath/s). A dodge buys 30 m/s over its
own 1.5 s cooldown for `breathCost` spent over that same 1.5 s, a ratio of `30 / breathCost`. The
two break even at a cost of 25; 28 sits just past it, so thrust stays the efficient way to gain
speed and the dodge is what gets spent for the invulnerability, not for the altitude. The test
that pins this ordering reads the ratio against the live thrust config rather than against the
literal 1.22 or 1.07, specifically so a later retune of thrust's own numbers cannot silently flip
the ordering and make chain-dodging optimal again without reddening anything.

**The gate is hard, and being caught unable to dodge is deliberate.** Below 28 breath the press
does nothing at all — not even the cooldown is spent — so spending breath on thrust becomes a
decision with a defensive cost, which is the tension the resource exists for.

**One rule, and the two postures differ for free.** The cost applies in both, but breath
regenerates at 12/s in the air against 30/s on the ground, because
`breathRegenGroundedMultiplier` is 2.5. On foot the 28 is repaid in 0.93 s, comfortably inside
the dodge's own 1.5 s cooldown, so the ground dodge stays as freely available as it was before.
In the glider the same 28 takes 2.33 s to earn back — longer than the cooldown — so chaining it
in the air runs the bar down. Neither posture needed a special case; the difference falls out of
a multiplier that already existed for an unrelated reason.

**After the fix, a single dodge still climbs, but the climb cannot outrun gravity, and that
bound is structural rather than a lucky choice of test input.** A banked dodge's vertical kick is
about 17 m/s. Gravity removes 30 m/s over the dodge's own 1.5 s cooldown — and the breath cost
stretches the *sustainable* interval between dodges to 2.33 s, over which gravity removes 46.7
m/s. The kick cannot outrun that gap regardless of how a player times it. Sweeping eight dodge
patterns over forty seconds from y 300 at 30 m/s, measuring only while still in the glider:

| pattern | peak y | end y | breath |
|---|---|---|---|
| no strafe | 300.0 | −524.4 | 19.8 |
| strafe held either side | 337.4 | −211.5 | 19.8 |
| strafe only on the dodge frame | 301.4 | −284.0 | 19.8 |
| alternating every dodge | 332.3 | −136.0 | 19.8 |
| alternating every second | 317.8 | −243.8 | 19.8 |
| half strafe held | 316.8 | −369.1 | 19.8 |

Twenty dodges landed in the forty seconds, down from twenty-seven when the cost was
neutralised. The best case across the sweep is a **+37 m transient** — the only pattern that
rises above the y 300 start at all, and only briefly — and every pattern ends far below where it
started, with the breath bar run down to 19.8 across the board. The old exploit's shape — climb,
and keep the bar full — has not reopened in any of the patterns tried.

**Three things in this cycle were my own errors, and are recorded honestly rather than folded
quietly into the fixes above.**

First, `breathCost`'s ordering against thrust is pinned by a test that reads the live thrust
config rather than the literal 1.22/1.07 numbers, precisely because those numbers are cheap to
get wrong twice — once when they're chosen, and again whenever thrust itself is retuned.

Second, the design spec was self-contradictory about the glider dodge's direction. It called for
`gliderRight(forward, 0)` and separately asserted that a dodge thrown in a dive keeps a vertical
component. Those cannot both hold: by the identity `cross(cross(a,b),c) = b(a·c) − a(b·c)`, a
bank-0 call to `gliderRight` reduces to `cross(forward, WORLD_UP)`, which is horizontal for
*every* heading, dive included. The spec
([`docs/superpowers/specs/2026-08-06-dodge-costs-breath-design.md`](superpowers/specs/2026-08-06-dodge-costs-breath-design.md))
has been corrected: `dodgeHeading` now takes the glider's actual bank as a sixth parameter and
threads it straight through to `gliderRight`, so a level dodge — even in a dive — stays flat, and
a banked one tilts.

Third, `gliderRight` initially returned the glider's *left*, not its right. Same identity again:
`cross(gliderUp(forward, bank), forward)` is `-right` by the vector triple product, where
`gliderUp` derives its own internal `right` as `cross(forward, WORLD_UP)` — the same expression
the ground dodge already used. Player-facing, that meant `D` dodged world-right on foot and
world-left in the glider, the same key producing opposite results depending on posture alone. It
survived a full review because every existing test asserted perpendicularity and a side-flip
between the two strafe directions, and neither property can distinguish a vector from its own
negation. The fix (`src/player/flight.ts:47`, swapping the cross order to
`crossVectors(forward, gliderUp(forward, bank))`) added a test that checks an actual direction
against the ground dodge's own right — that is the transferable lesson, not the specific sign.

**Fixing that sign reversed a ruling made one round earlier.** With the buggy sign, a banked
dodge measurably descended on both sides (`(0.825, -0.565, 0)` left, `(-0.825, -0.565, 0)`
right), and that was ruled *intended* — dodging toward the inside of your own bank descending is
physically legible, and letting the side pick a climb instead would hand back exactly the kind of
free altitude this cycle exists to close. Negating the whole vector to fix the handedness flips
every component, not just the one that exposed the bug, so the same coupling now climbs on both
sides instead. The eight-pattern sweep above is what was run afterward to check whether that
reversal reopens the exploit it had previously been ruled safe against. It does not.

**The guide panel already described the dodge correctly; the code didn't match it until this
cycle.** `src/ui/guide/actions.ts` has told players, since before this cycle started, "in the
glider, bank left or right to dodge sideways, since thrust and flare are not directions" — the
lateral, bank-driven dodge this cycle actually built. The code it was describing instead
flattened to a forward heading whenever no strafe was held. Worth recording as a case where the
documentation was the reliable artifact and the implementation was the one that needed to catch
up.

**What is not fixed.** A single dodge still adds 30 m/s and is not energy-neutral; the breath
cost bounds the *repeated* exploit, not the one-shot kick. The `0.6` bank literal — how strongly
strafe becomes roll — now appears three times (`controller.ts` twice, `main.ts` once), and the
three have to move together; none is a shared constant, each site carries a comment saying so.
And the in-game feel of all of this is unverified: the browser harness cannot hold pointer lock,
so no part of this cycle — the breath drain, the gate, the tilt, the sweep above — has been
played with a mouse in hand. Every number above comes from the synthetic-controller harness the
terrain collision and Focus work already used, not from a human.

**The feel batch: four independent, measured defects in systems that already shipped.**
Each of the four was a mismatch between what a mechanism claimed to do and what it actually
did, found by measuring rather than by reading the code and trusting it — none needed a
design decision, and none of the four fixes touched a value that was merely a guess about
feel.

**1. The air scooter's turn trade did not exist.** `scooterTurnAuthority`
(`src/player/scooter.ts`) is the design document's "doubles speed and halves steering," and
`groundStep` fed it into `desiredVelocity`, where it scaled the strafe axis only. On foot the
heading comes from the camera, not from strafe, so what actually governs a turn is
`groundResponse` inside `easeHorizontal` — and that function never saw `authority` at all. A
90-degree turn measured **0.45 s on foot, 0.45 s at charge 0, and 0.45 s at charge 1** —
identical; the scooter doubled your speed and cost nothing. `authority` now scales
`easeHorizontal`'s response rate directly and no longer touches the axis inside
`desiredVelocity`, so there is one mechanism instead of two half-working ones. After:
**0.45 s on foot (unchanged), 0.8833 s at charge 0** (53/60 exactly, `authority` 0.5 — plain
`scooterTurnFactor` with no charge spent) **and 1.75 s at charge 1** (exact; `authority`
0.25, `scooterTurnFactor` minus `scooterChargeTurnPenalty`). Both figures are pinned by
`toBeCloseTo` assertions in `ground-move.test.ts`, not left sitting in a comment — see the
process note under "Testing discipline" below for why that distinction turned out to matter.

**2. `Shift` meant three things, and the tangle had a measurable cost.** It was sprint while
held, the scooter toggle on keydown, and hover in the glider — so the same key that summoned
the scooter also changed its speed for as long as it stayed down. Measured at identical
charge 0.26, both genuinely riding: **27.5 m/s with `Shift` held against 14.8 m/s released.**
The scooter now lives on `Z`; `Shift` keeps sprint and hover, which are the same idea in both
postures. The README already described the scooter and sprint as two separate keys before
the code did — the documentation was the honest artifact and the code was the problem, and
that is the second time in three cycles this exact pattern has shown up (the Slipstream
dodge's guide text, recorded earlier in this document, was the first). Worth naming as a
pattern rather than a coincidence: twice now, this codebase's own prose has been a more
reliable description of the intended design than the mechanism that was supposed to
implement it.

**3. Thrust buzzed at empty breath, and the fix reduces the buzz rather than removing it.**
`canBend` was `breath > 0` with no floor, so thrust engaged on **300 of 600 frames** — a 50%
duty cycle at 30 Hz — as breath oscillated across zero. `bendFloor` at 15 brings that to
**210 of 600**, a 40% duty cycle. That is a real improvement, but not the improvement
originally claimed: `canBend` is re-evaluated every frame against the floor, so it gates AT
15 rather than at 0 and still ping-pongs — just around a higher number. The original claim,
that the floor would buy "a beat of thrust, then a beat of nothing," was wrong, and is now
corrected in three places: `src/core/types.ts`'s `bendFloor` doc comment, the comment above
`canBend` in `src/player/breath.ts`, and `breath.test.ts`. The floor is kept anyway,
re-justified on what it actually does rather than on what it was hoped to do: thrust now
needs a real reserve of breath in hand rather than a merely non-zero bar, so an empty bar is
a genuine interruption regardless of the buzz. **True elimination needs a "was bending" flag
on `PlayerState`** — hysteresis, not a threshold — and that is the larger improvement and the
available next step; `breath.test.ts`'s `toBe(210)` is left in place as a tripwire for it, so
building the flag will turn this assertion red on purpose rather than let it keep passing
with a meaning that has quietly changed underneath it.

**4. The dash trail was drawn for a dash that doesn't happen.** It was sized
`dashSpeed × dashDurationSeconds` — a config value the simulation never actually read —
drawing **5.72 m** for a dash that measures **3.94 m** on foot. `trailLength`
(`src/fx/dash-trail.ts`) is now `dashSpeed / groundResponse`, which is what `easeHorizontal`
actually integrates to as it bleeds the dash's impulse off exponentially, and it draws
**3.714 m**. Marginal displacement is pinned by test at three authorities: on foot
**3.935161 m**, scooter charge 0 **8.093587 m**, charge 1 **14.619641 m** — the scooter
spread is the interesting part. Authority scales `groundResponse` directly, so it scales the
decay *time constant* the same way, and a riding dash travels roughly twice as far at charge
0 and four times as far at charge 1 as the trail drawn for it. The trail is deliberately not
resized for either case: it is sized for the common, on-foot case, and scaling it live would
mean threading the rider's charge down into an effect that currently only takes the static
config. `dashDurationSeconds` and the never-called `dashDecay` are both deleted from
`GroundConfig`.

**The FOV kick's decay rate needed correcting alongside finding 4, for a subtler reason than
"the config value it read is gone."** The dash's camera-FOV kick decays through `stepPulse`,
and until this cycle its rate was read directly off
`1 / DEFAULT_GROUND_CONFIG.dashDurationSeconds` — the same value finding 4 deleted. It is now
a named `DASH_KICK_DECAY_PER_SECOND = 1 / 0.22` in `src/fx/config.ts`, deliberately keeping
the kick's old 0.22 s lifetime rather than tracking the dash's real decay: the kick is a
cosmetic camera flourish with no obligation to match the dash's own curve. Reading
`groundResponse` directly, which an earlier draft of this fix proposed as "the same quantity
expressed directly," would have been wrong in a different way — `stepPulse` decays linearly
while the dash decays exponentially, so that substitution would have shortened the kick's
lifetime by 35% and ended it while 37% of the dash's real burst was still under way.

**A cross-cycle interaction worth recording, because it is benign and easy to assume
otherwise.** `main` already carries terrain collision and the Slipstream's 28-breath dodge
cost. The breath bands are now: below 15, neither bend nor dodge; 15 to 27.99, thrust and
hover but no dodge; 28 and up, both. `bendFloor` *narrows* a "can bend, cannot dodge" band
that already existed — from (0, 28) to [15, 28) — rather than creating it. The genuinely new
interaction: a dodge fired between 28 and 42.99 breath now lands below the floor, killing
thrust and hover for up to 1.25 s where before they would have buzzed at half duty. No
soft-lock results — a breathless glider still generates lift on its own.

**What is still not done, carried forward rather than fixed here.** The scooter's `clipped`
tier drop is still hardcoded `false` at `ground-move.ts:85`; terrain collision has since made
a wall genuinely detectable, via `resolveMovement`'s hit normal, so wiring it in is now
available rather than blocked. `scooterTurnFactor` (0.5) and `scooterChargeTurnPenalty`
(0.25) can finally be judged in play instead of retuned blind, now that they drive a
mechanism that actually turns the player. The breath hysteresis above. And none of this
cycle has been played — the browser harness still cannot hold pointer lock, so every number
in this section comes from the synthetic-controller test harness, not from a human with a
mouse.

**Wind on foot.** `src/world/wind.ts` opens by saying the air is level geometry rather than
weather — "the air is terrain: lift is something the player reads and routes through, the
way they read a ledge" — but that was only true for the glider. `controllerStep` sampled
`deps.windAt` in the glider branch alone, so a body on foot fell exactly as it would through
still air no matter what a level had placed underneath it. Measured before this cycle: a
player falling from y 200 for one second inside a fabricated 500 m/s² updraft landed at
y 189.833333 — identical, to six decimals, to the still-air control. After the fix, the same
fixture lands at y 444.000000.

`groundStep` (`src/player/ground-move.ts`) gained a seventh parameter, `wind: WindSample`,
defaulting to `stillAir()`, and folds its acceleration into an airborne body's velocity, both
horizontal and vertical. `controllerStep`'s ground branch (`src/player/controller.ts`) now
samples `deps.windAt` and passes the result through; the glider branch's own sample, and
everything else in that half of the file, is untouched.

Three deliberate limits, each with its own reason. The air only ever acts while airborne — a
grounded body is braced, and pushing it while grounded would put wind in a tug-of-war with the
ground snap, which is the sole owner of vertical placement down there. Only `wind.accel` is
ever read, never `wind.liftScale` — that field scales a wing's own lift, so dead air correctly
does nothing to a body on foot: dead air is a volume where a wing stops working, not one where
gravity itself changes, and there is no wing here to stop working. And a jump frame still sets
its own vertical speed outright, ahead of wind being added, so a jump's height stays the
jump's and the air only acts on the arc that follows it.

The ground branch samples with `state.forward`, the flattened camera direction — ridge lift
and rivers both need to know which way the sampler points, the same reason the glider branch
has always taken a heading argument. The glider's own sample was left exactly where it already
was, after `steerToward` runs, because that ordering is what lets a bank in mid-turn change how
much a ridge lifts. Moving it earlier looks harmless — same function, same two arguments — and
is exactly the substitution the ninth unfalsifiable assertion (see "Testing discipline" below)
turned out to hinge on.

Measured figures, reproduced independently and used here rather than invented. A river of
120 m/s² drifts a falling body to x 15.718324 in one second. Horizontal wind saturates rather
than accelerating without bound: it lands in `state.velocity`, and `easeHorizontal` blends
whatever is sitting there back toward a desired velocity of zero on every following frame, so
the push settles at a plateau of `accel / groundResponse` — measured 18.16 m/s for the
120 m/s² river. Vertical wind has no such counterpart, since gravity's own term never decays,
so it integrates unopposed instead — the actual reason a sustained updraft keeps climbing while
a sustained river settles toward a fixed drift speed rather than growing with a longer fall.
The glider's own behaviour is pinned unchanged at y 299.714708 / z −44.783956, under a
heading-sensitive sampler and a trimmed glide — see "Testing discipline" for why the pin needed
replacing before that number meant anything at all.

**Islands have no collidable underside, so a sustained upward force can push a body through
one — the more important of two defects this cycle records rather than fixes.** An upward ray
cast from beneath `home` or `climb-north` returns `null`; `resolveMovement` ignores
ground-facing normals by design, and the ground snap only ever runs when `velocity.y <= 0`, so
a rising body meets no opposition at all. Measured: a constant +40 m/s² from y 380 sails
straight through the spire's surface at y 564.13 and out to y 875. The threshold is sustained
net upward acceleration of roughly twice gravity. Shipped levels do not reach it — the
strongest real sample anywhere in the level data is 23.4 against a gravity of 20, and only at
the spire thermal's own core, and every run from beneath an island using the real level sampler
fell to the world floor instead of climbing through. Horizontal wind is safe at any magnitude
tried (50000 m/s² still stopped 3.6 m short of the needle's centre) and downward wind is safe
too (−308 m/s impacts were still caught by the snap). This is a pre-existing gap in the
collision layer — the glider's own thrust could already reach it — and wind on foot is merely
the first mechanism able to sustain a climb long enough to matter, since a body with no wing
has no other way to generate lift of its own.

**`WindDef.strength` means two different things depending on `kind`, and nothing validates
which one a level author meant.** A thermal's `strength: 13` cancels about 65% of gravity; a
river's `strength: 26` buys about 3.7 m/s of terminal horizontal drift. The same numeric range
reads as "noticeably weakens gravity" for one kind and "a gentle push" for the other, with no
shared unit or scale between them — a level-authoring hazard worth naming, not fixing here.

**A consequence worth flagging for play, not a bug.** A thermal now gives the `climb-north` /
`spire` / `beacon` progression a second route: a player can ride one up on foot and reach the
same place a glider deployment used to be required for. Whether that is a shortcut worth
closing is a tuning question for whoever next plays the game with a mouse in hand, and this
cycle deliberately does not pre-empt it.

**Out of scope, and why.** Arrows: `Projectile` drift would interact with the archer's
`aggroRange` and `strikeRange`, both tuned against still air two cycles ago — moving them now
would be a balance change wearing a physics change's clothes. Enemies: they are ground-snapped,
so wind does nothing to one until knockback puts it airborne, at which point it would need care
not to drift a soldier off an island rim and cheapen §4.6's accident-versus-knockdown scoring.

None of this cycle has been played. The browser harness still cannot hold pointer lock, so
every figure above comes from the synthetic-controller test harness described under
"Repo-specific traps," not from a human with a mouse.

**Pause whenever the mouse is not captured, plus a click-to-play card over the first
frame.** Before this cycle the game had three separate holes. Escape released the pointer
lock but the simulation kept running underneath it, so the look direction froze mid-turn
while the patrol kept closing. Backgrounding the tab did the same — nothing told the loop
the player had looked away. And the very first frame simulated immediately, with no cue
telling a new player to click the canvas before anything happened, so a falling spawn was
already falling before the pointer lock had ever been requested.

`src/core/pause.ts` is the fix's pure core: `pauseReason(i)` takes three booleans
(`pointerLocked`, `documentHidden`, `guideOpen`) and returns which one is holding the game,
or `null` exactly when it should run — there is deliberately no separate `isPlaying`
predicate, since an earlier draft had one and nothing but a test kept the two from
drifting apart. Pointer lock is now the signal for whether the game runs at all: losing it
is what Escape does, and `main.ts` tracks `pointerLocked` off `pointerlockchange` rather
than off any of its own state. `documentHidden` is tracked as a fully separate input,
off `visibilitychange`, rather than being folded into `pointerLocked` — hiding a tab very
probably drops the lock too, which would make the second input redundant, but that could
not be verified in this harness (see below), and keeping it separate gives the right
answer either way. `src/ui/pause-overlay.ts` renders the card `pauseOverlayModel` describes
— "Airbender Skies" / "Click to play" before the lock has ever been held, "Paused" / "Click
to resume" after — and `main.ts`'s `frame()` drives audio from the play/pause transition
edge, calling `suspend()`/`resume()` on both `createWindAudio()` and `createCombatAudio()`
only when the state actually flips, not on every paused frame.

**Four claims stayed unverified, plainly, because this harness cannot hold a pointer
lock** — `requestPointerLock` errors immediately since the harness never receives OS
focus, and pointer lock is this cycle's whole subject:

1. That pressing Escape actually brings the card up in a real browser.
2. That clicking the canvas actually takes the card down and resumes the game.
3. That Chrome's post-Escape re-lock cooldown behaves the way the design assumes.
4. That suspending both audio contexts actually silences a backgrounded tab.

What *was* verified in the dev server: the card sits in the DOM with the correct
first-play copy and `pointer-events: none` (so it never steals the click the canvas needs
to request the lock). Whether the game actually held at frame zero needs a word of care —
see the correction directly below, added during this cycle's review — because the first
attempt at that check overstated what it had shown.

**A correction to the paragraph above, and the front-door frame bug that prompted it.**
The pause hold was first "confirmed" by driving 300 synthetic frames under the preview
pane's genuine `document.hidden === true` and observing that the HUD's altitude readout
never left its pre-first-update empty string. That observation is real, but empty-then-
still-empty is exactly what a *broken* pause would also produce if the drive script never
actually invoked `frame()`, or if `frame()` threw before reaching `renderer.render`, or for
any of several other reasons unrelated to `pauseReason` doing its job — nothing in that run
distinguished "the pause held" from "nothing ran." Writing it up as confirmation was the
same mistake this document elsewhere warns against: an observation that was consistent with
the claim got read as proof of it.

The review that caught this also caught a second, more serious bug the first check's own
blind spot was hiding: `syncVisuals()` and `hud.update()` are only ever reached from inside
the *playing* branch of `frame()` (via `stepper.advance`'s render callback and `update()`
respectively), and on a fresh load the game starts paused. Before a fix landed, the front
door's actual first paint was the camera and avatar sitting at `createRenderer`'s default
transform — inside the home island's volume, since the island is centred on the world
origin — with all four HUD meter fills stuck at their unset CSS `width: 100%` and blank
altitude/airspeed text, because `hud.update()` had never run once to overwrite them. The
"HUD stayed empty" observation above was consistent with the pause holding correctly *and*
with this bug, and could not tell the two apart. `main.ts` now primes the presentation
layer once — recording the enemy interpolators, calling `followSun`, `syncVisuals` and
`hud.update()` a single time — before the loop starts, so the very first paint shows the
real spawn rather than an uninitialised scene.

The two halves of that claim rest on different kinds of evidence, and conflating them is
the same overstatement the paragraph above exists to correct, so they are kept apart here.
**The HUD half was measured**, by screenshot (a screenshot forces one paint even in a
hidden tab): before the fix, the four meter bars were solid and full and altitude/airspeed
were blank; after it, all four bars were correctly invisible (full stats hide their own
bars by design) and the readout showed a real `14 m` / `0 m/s`. **The camera half was
reasoned, not measured**: `syncVisuals` is the only writer of `cameraPosition`, and it is
unreachable from the paused branch, so the priming call is by construction the transform
the first paint uses. No coordinate readout backs that up — `camera.position` is not
exposed to the console — so it is a closed static argument about who writes what, and
should be read as one.

**A third part of that same first paint was still wrong after this fix, and the
whole-branch review at the end of the cycle caught it.** The animation mixer was never
primed either, and the priming block could not have primed it: `avatar.setAnimation()` and
`avatar.update()` are reachable only from the playing branch, and the `character.glb`
promise cannot settle until after `start()`'s synchronous body — the priming block
included — has finished. So no clip was ever selected and the mixer never advanced while
the card was up. `avatar.poseNow()` now runs inside the loader's own `then` callback, the
one place that can both see the loaded model and reach it before the player clicks; it
exists as its own method because `setAnimation` starts its action at weight 0 and needs a
tick of the mixer to land the pose (see its comment in `src/player/avatar.ts` for why the
tick is exactly the fade length, and for what else that tick does).

**What the card actually showed was measured afterwards, and it was not the rest pose this
paragraph first claimed.** That claim rested on reading a pair of before-and-after
screenshots, and both halves of the reading were wrong. `attachModel` composes the glide
clip *before* it creates the mixer, and `pitchOnto` in `src/player/glide-pose.ts` writes the
composed quaternions straight into the live bones and never restores them — arms sampled
from `Punch` at 5%, legs from `Walk` at 60%. `sampleBones` in that same file already carries
the warning that it poses the model as a side effect and that callers must not measure it
afterwards expecting the bind pose; nothing was heeding it. So what the front door showed
was `buildGlideClip`'s leftover composed glide sample: arms raised to head height on a
character standing on the ground. World bone positions over the real
`public/models/character.glb`, in the GLB's own units:

| stage | LeftHand | RightHand | max key-joint move vs rest |
| --- | --- | --- | --- |
| loader output (GLB rest pose) | `0.863, 2.494, 0.821` | `-1.091, 2.501, -0.554` | — |
| after `attachModel`, no clip, no tick | `0.751, 4.547, 0.429` | `-0.130, 4.127, 1.195` | 2.57 |
| after `poseNow('idle')` | `0.875, 2.458, 0.782` | `-1.064, 2.462, -0.574` | 0.058 |

The head sits at y ≈ 4.43 in that middle row, so both hands really are up at head height
there. The fix is still a real improvement — 2.60 units of travel for the right hand, and a
standing idle beats arms-raised-while-standing — but the honest description is that it lands
the character within 0.06 units of the rest pose rather than rescuing it from one. The part
of the finding worth keeping is the side effect itself: `attachModel` returns with the model
posed, which is a live trap for anything that reads bones after it, and `attachModel`,
`poseNow` and the call site in `main.ts` now all say so.

**And the clip it poses is `idle`, not a fall.** `createPlayerState` returns `mode: 'ground'`,
`grounded: true` and zero velocity, so `animationFor(player)` returns `'idle'` — the correct
clip for a standing spawn. The code was never wrong here; only the prose was, which
described the second screenshot as "a real airborne pose". That reading came from taking the
`14 m` altitude readout as evidence of being airborne, and it is not: `14` is the island's
ground height plus `SPAWN_CLEARANCE` of 2, measured from sea level, and says nothing about
the `grounded` flag.

Worth noting for the register above: this was a *regression* introduced by making the game
pause at frame zero, not a pre-existing bug. Before this cycle the unposed frame existed
too, but `update()` ran immediately, so it lasted one frame instead of as long as the player
left the card up.

With that fixed, the pause-hold claim was re-established properly: forcing this file's own
`pointerlockchange` and `visibilitychange` listeners to report `pointerLocked: true` and
`documentHidden: false` (via `Object.defineProperty` on `document.hidden` and
`pointerLockElement`, then dispatching the two events — a labelled exercise of this file's
own listeners, not a claim about a real pointer lock grant) and driving the loop showed
altitude actually falling, 14 m to 12 m over the first 15-30 driven frames as the spawn
settled onto the ground, with airspeed rising then dropping back to 0. That is the control
the first pass lacked: proof the instrument can see motion when the game is genuinely
playing, which is what makes "altitude never left 14 m" mean something when read back under
a real, unforced `documentHidden === true`. Both directions were checked with the same
hook-and-drive technique so the comparison is apples to apples.

**Jump forgiveness: coyote time off a ledge, and a jump buffer across a landing.** Two
standard platformer affordances were absent, and their absence was measured rather than
assumed. Walking off a ledge with Space pressed on the last grounded frame and released one
frame later produced a vertical speed of **-0.667 m/s** — one frame of gravity and nothing
else. Not a weaker jump: no jump, and the air jump was not spent either, so the press simply
vanished. The cause was that the jump fires on *release* while the airborne branch discarded
`chargeTime` outright and fired only on a fresh press, so a press straddling an edge was
charged on one side and thrown away on the other. Separately, with the air jump already spent
and the press released mid-air, a press at 1, 2, 3, 5 or 8 frames before touchdown produced
nothing on landing in all five cases. For scale, the height at stake is **2.09 m**: a single
jump peaks at 2.100 m and a jump followed by an air jump at apex reaches 4.194 m.

`coyoteTime` is **one rule and no edge detection**: pinned at `coyoteSeconds` while grounded,
decaying by `dt` while airborne, zeroed by any jump. It needs no "did I leave the ground this
frame" comparison, because the last grounded frame already left the window full. The zeroing
is the subtle part — without it every ground jump would be a double jump for the next six
frames, and a test starting from a standing frame is what pins it (starting from the bare
`player()` fixture, whose `coyoteTime` is 0, the whole suite stayed green with the zeroing
removed; that was found by making the change, not by reading the assertion).

Both counters are written in `groundStep`, not `stepJump`, because `stepJump` runs before the
ground probe and cannot know the authoritative `grounded` — the same split the function
already used for `airJumpsUsed`. `JumpStep` gained `jumped` for that: `groundStep` needs to
know a jump fired, and re-deriving it from `jumpVelocityY !== null` at the call site would be
a second place to keep in step.

**`chargeThresholdSeconds` is 0.2, twice the 0.1 s coyote window**, so the window cannot let a
charge *complete* in the air. What it carries is a charge already earned on the ground: hold
Space while walking, step off, release within the window, and the charged jump earned on solid
rock is the one that fires. Measured, and it is the discriminating case in
`ground-move.test.ts`: a walk that reaches the edge on frame 30 with 0.5 s of charge, released
3 frames past the edge, fires at **13.0333 m/s** against a plain jump's 9. A charge *started*
at the ledge can never mature inside the window; that is a real limit of these two numbers
rather than a flaw in the mechanism, and it is pinned by a test rather than left to be found
in play.

**The buffer reaches 5 frames, not the 8 the spec expected.** `jumpBufferSeconds` 0.1 is six
frames at 60 Hz and the countdown starts on the frame the press is made, so 1, 2, 3, 4 and 5
frames before touchdown now jump on the frame after landing, and 6, 7 and 8 still do not. The
design doc asked for all five of its measured timings including 8 frames, which is 133 ms
against a 100 ms window — arithmetically impossible without raising the window, so the doc is
wrong rather than the code. The whole table 1-8 is asserted so the boundary is pinned next to
the inside of it. Two cautions on that boundary: the fifth frame survives only by
floating-point residue (six subtractions of 1/60 from 0.1 leave 2.1e-17 rather than 0), and
because `stepJump` runs before the ground probe, a buffered press is honoured on the frame
*after* touchdown rather than on touchdown itself. If the window is ever retuned for feel,
`jumpBufferSeconds` around 0.15 would make the doc's 8-frame case work and would move the
boundary off the knife edge.

**One edge is deliberately accepted, and it is milder than the spec claimed.** Press fresh
inside the coyote window, then release after the window has closed: the jump is lost. The
spec expected that release to fall through to the air-jump branch and spend the air jump, but
measured, it does not — the air-jump branch fires only on a fresh press, and a release is not
one, so nothing at all happens and the air jump stays in hand. Closing the edge properly would
need a third state field recording "a coyote charge is live", and holding past 0.1 s off a
ledge is not what this cycle existed to fix.

No validator was added for the two config values, deliberately: a window of zero or below
disables that one piece of forgiveness and leaves the old behaviour exactly as it was, which
is a safe degradation rather than a broken state. Since that is an argument about an absence,
it is asserted instead — a zero `coyoteSeconds` leaves the buffer working and a zero
`jumpBufferSeconds` leaves coyote working, both as tests. Separately, both windows are pinned
for *extent* and not only existence: the coyote window closes six frames past the edge and no
later, and the buffer's table runs 1 to 8 frames. Without the first of those the suite passed at
`coyoteSeconds` 0.05, 0.5 and 1.0 alike, and a full second is effectively unlimited free ground
jumps off any surface.

**The trap this cycle found the hard way: every spread of a `PlayerState` that flips `grounded`
or `mode` is a place a forgiveness counter can escape.** There are eight such spreads — the two
respawns, the glider deploy, the stow, the glider's per-frame step, the glider's landing, the
slam bounce, and `groundStep`'s own return. Three could leak a counter, and two of those needed a
line adding.

`applyBounce` in `src/player/slam.ts` reads a *grounded* frame — where the coyote window is
pinned full — and returns `grounded: false`, so it carried a complete window into the air on
every Pressure Wave slam. A tap on any of the next six frames then fired a free ground jump that
*replaced* the bounce: measured, a 34.333 m/s slam bounces at 15.450 m/s and peaks 5.839 m above
the surface, and the tap turned that into 9.000 m/s and a 2.100 m peak — worse than pressing
nothing, and worse than the 18.270 m/s air jump the same tap bought before this cycle existed. It
now clears `coyoteTime`, and `ground-move.test.ts` asserts the peak rather than the velocity,
because height is what the player sees. It deliberately does *not* clear `jumpBuffer`: unlike the
window, the buffer is not pinned by being grounded, so `grounded: false` hands it back to the
normal countdown rather than freezing it.

The glider deploy in `src/player/controller.ts` is the second, and it needed both counters
dropped. Nothing in glider mode advances either, so anything carried across the deploy stops
being 0.1 s of memory and becomes 0.1 s of *ground-mode* time spread over an unbounded glide —
stow the glider, touch down a few frames later, and a press or an edge from before a minute-long
glide is still live. Zeroed at the deploy rather than at the stow because the deploy is the only
entrance to glider mode. The window's line was initially left out on the argument that the gate
cannot see an open window, since deploying requires the air jump to be spent and spending it
zeroes the window; that argument is true at `maxAirJumps` 1 and false at 0, where `canAirJump` is
never satisfied and the gate opens to someone who has just walked off a ledge. Measured at that
config: the window survived the deploy, 120 glide frames and the stow, and a release then fired a
9.000 m/s ground jump with the air jump untouched. A test pins it there, because an assertion at
the shipped tuning would be vacuous — which is precisely how the hole stayed open.

The third leakable spread, the glider's own landing, already zeroed both. `groundStep`'s return is
not a leak in this sense: it is where the counters are computed.

**The buffer was very nearly dead code, and the deploy gate is why.** The spec specified the
buffer's arming condition as "airborne, a fresh press, no air jump left" and never checked it
against the rest of the game's input handling. That is the *same* condition `controllerStep`
already used to open the glider, minus `staffBusy` — and the deploy gate runs before
`groundStep`, so it consumed the press first. `Space` with no air jump left is the documented way
to open the wings: jump, jump, deploy. Measured through `controllerStep` before the fix: airborne
with the air jump spent and the staff idle gave `mode: 'glider'` and `jumpBuffer` 0 whether the
ground was 200 m away or half a metre. In production the buffer could therefore only ever arm
while a staff swing, a combo chain or a recovery was live. No test caught it because every buffer
test called `groundStep` directly and so never met the gate above it — the same blind spot the
register below keeps finding, in a new place.

**The fix: a fourth condition on the deploy gate, and the deploy yields to a landing.** The gate
now reads `input.actionPressed && !state.grounded && !canAirJump(...) && !staffBusy(...) &&
!aboutToLand(state, deps)`. `aboutToLand` asks whether the player would reach the ground before a
buffered press expires; if so the press falls through to `groundStep`, arms the buffer, and
becomes a jump on the landing. Opening the wings three frames before touchdown was already a poor
outcome — unfold, kick, land, stow — so the move now goes where it was aimed. What genuinely
changes is that a press low over a ledge buys a jump rather than a glide, and that is a real
behavioural change to a documented control.

**The threshold needs no new tuning value, which is what makes it the right rule rather than a
second guess.** `fallWithinBufferWindow(velocityY, c)` predicts the fall over one
`jumpBufferSeconds` from the current descent speed, so the window that decides how long a press
is remembered is the same window that decides how close is too close to open the wings. It
returns 0 while rising — a rising player is not about to land, and gating the deploy on the way
up would break §4.3's slam-bounce re-deploy at the top of its arc — and a `jumpBufferSeconds` of
0 gives a reach of 0, which leaves the deploy exactly as it was and keeps the "safe degradation,
so no validator" claim true for the field that has none.

**The correctness margin, which is thin and worth understanding before touching any of it.** The
reach is the *closed-form* six-frame distance, while the buffer survives exactly six decays. Those
two do not obviously meet, and if the reach were the longer of them there would be a band of
heights where a press bought neither a glide nor a jump — strictly worse than the defect being
fixed. It works because `groundStep` integrates semi-implicitly, applying each frame's whole
gravity increment before it moves, so the simulated fall covers *more* ground per window than the
closed form predicts. The surplus is exactly `½ × gravity × dt × jumpBufferSeconds` =
**0.016667 m**, independent of descent speed: at 10 m/s, 1.1 m predicted against 1.1166667 m
simulated. **In frames the margin is zero** — the predicted reach is crossed in six frames and no
fewer, which is what puts the press inside the buffer rather than one frame past it.

Two edits that look like improvements and open a dead band. Both were measured by making them:

- **Replacing the closed form with a frame-by-frame replay that runs seven times instead of six.**
  A `t += dt` loop is the natural way to write "the fall over one window" and it is off by one.
  `jumpBufferSeconds / dt` is exactly 6, but six accumulated additions of `1/60` land on
  0.09999999999999999, so a `while (t < c.jumpBufferSeconds)` loop takes a seventh step — the same
  floating-point residue the buffer's own fifth frame survives on, read the other way round. At
  −10 m/s that reports 1.3222 m of
  reach against a buffer that can only honour 1.1167 m, and the measured dead band is **0.2050 m
  wide** (heights 1.1170 m to 1.3220 m yield the press and then produce no jump). A closed form
  with `t` accumulated seven times rather than a replay gives a reach of 1.3028 m and a 0.1855 m
  band. Either way it is a fifth of a metre of heights where `Space` does nothing.
- **Any slack added to the reach, of roughly 1.6% or more.** The whole margin is 1.5%
  (1.1166667 / 1.1 = 1.01515), so there is nothing to spend. Measured: multiplying the reach by
  1.016 opens a 0.0005 m band, and by 1.02 a 0.0050 m one; 1.0152 does not open one. A "round it
  up to be safe" instinct is exactly backwards here — safety is on the short side.

`controller.test.ts` pins the reach from both ends for that reason: 1.09 m and 1.1 m (the reach
itself) both yield and both jump on frame 6, and a height of 1.1166667 m — one window's worth of
simulated fall — must *not* yield. The first reddens a reach given less, the second a reach given
more.

**And the gate has to ask whether the hit is ground, not merely whether there is one.** The first
implementation of `aboutToLand` treated any downward hit as a landing. That was deferred as minor
on the argument that the only faces a downward ray could wrongly answer with are downward-facing
overhangs, which front-side culling makes unhittable. True, and beside the point: the faces that
actually occur are upward-facing and simply too steep to stand on — the rims and flanks of every
island — and a downward ray finds those perfectly well. `resolveMovement` holds the body `radius`
clear of a face steeper than `wallNormalY` rather than seating it, so the fall does not end there.
The player skims the face, the buffer expires, and the press bought nothing: no glide, because the
gate suppressed it, and no jump, because no landing ever came.

Measured over the real archipelago, one sample per position of a 51 × 51 grid on each of the
thirteen islands, half a metre above the surface, descending at 10 m/s with the air jump spent:

| | before the filter | after |
| --- | --- | --- |
| downward hits on faces `isWall` rejects | 796 of 23651, **3.37%** | unchanged — it is geometry |
| shallowest such `normal.y` | 0.0040, effectively vertical | unchanged |
| `home` positions that yielded with no jump following | 1.86% | **0** |
| `spire` | 7.26% | **0** |
| `needle` | **17.03%** | **0** |
| `beacon` | 1.59% | **0** |

Every one of those failures sat on a wall-normal face and none anywhere else, so the missing
filter was the whole of the fault rather than one contributor to it. The fix is one clause —
`hit !== null && !isWall(hit.normal, deps.collision)` — and it needs no new tuning value either,
because `wallNormalY` is already the threshold collision uses for exactly this question. Nothing
in the 1439-test suite pinned either behaviour, which is why `wall-face-reach.test.ts` now exists:
it builds the real islands and asserts the table above, alongside synthetic-normal tests in
`controller.test.ts` that place the boundary exactly (0.05, 0.30, 0.49 behave as open air; 0.50 —
`isWall` is a strict `<` — 0.51 and 0.90 yield and jump).

**None of it was played.** The 0.1 s windows are the platformer standard rather than a
measurement of this game, this environment cannot hold a pointer lock, and the two windows and
their interaction with `chargeThresholdSeconds` 0.2 are the values most worth a human's hands.

**Vertical reach: the player's four attacks stop ignoring height.** Every one of the player's
offensive moves measured its reach horizontally and nothing else, so the reach was not a cone or
a disc at all but an infinite vertical column with a cone-shaped or circular cross-section.
`inCone` in `src/combat/cone.ts` dropped `y` before it did anything else and its own doc said
"Horizontal: height is ignored entirely"; both radial moves measured with `horizontalDistance`.
Measured before the change: an enemy 8 m ahead and **2000 m below** the player was inside a
gust, and one 3 m ahead and 50 m below was inside a staff opener. Height above worked the same
way — 60 m up was in.

**What made that a correctness defect rather than a tuning question is that it inverted the
archer cycle's whole point.** Every enemy's ranges were already measured in 3D by `stepEnemy`;
`config.ts` says of the archer's `aggroRange` that measuring in 3D "is the whole point of the
type: before archers existed, getting above the spear's 26 ended any fight." The archer exists
to make altitude cost something. But a player hovering above a soldier could gust and swing at
it while the soldier's own 3D range could not reach back, so altitude cost the player nothing
offensively — the exact asymmetry the archer was added to remove, reintroduced from the other
side.

The fix is one field and one test. `ConeShape` gained `verticalReach`, a half-extent measured
from the caster's own height, and `inCone` tests it first — cheapest rejection, and before any
direction is computed. The two radial moves are not cones and do not share `ConeShape`, so
`PressureWaveConfig` and `VortexConfig` each gained their own field and each ANDs the band onto
its existing radius test. **The cone stays flat, deliberately:** `groundStep` sets `forward` to
`horizontalForward(input.lookDirection)` precisely so a standing turn moves the blast with the
character, so a flat sector is what the player's aim already means, and tilting it would need a
second aim vector that neither `src/fx/gust-cone.ts` nor `src/fx/aim-tell.ts` is built for.

**The five extents, and the shape of the set rather than the values.** Staff opener and finisher
2.0, gust 5.0, Pressure Wave 4.0, Vortex 8.0. What is argued is the *ordering*: the
ground-hugging shockwave is the flattest relative to its own reach because the fiction is
something travelling out across a surface, the lifting column is the tallest because a target it
cannot reach is a target it cannot lift, and the staff is the shortest in absolute terms because
it is an arm holding a physical implement, bounded by the character's own 1.8 height with margin
for a soldier on a low rise. The two staff arcs share their value on purpose — the finisher
sweeps wider and shoves harder, not taller — and `staff-arc.test.ts` asserts them equal to each
other rather than to a literal. If play says one is wrong, that story is what should be
re-argued, not the number in isolation. **None of the five has been played**; the harness cannot
hold a pointer lock.

**The tests that matter are the real-geometry ones, not the exploit regression.** Asserting that
a target 2000 m below is now out of reach passes for any implementation that clamped height at
all, including one clamped far too tightly, so it is present as a guard and is not the
discriminating test. Over-tightening is the risk the change actually carries. So
`src/combat/reach-geometry.test.ts` fires all four moves — seven cases, since both radial moves
appear at their weakest and fullest — from every stance on real archipelago ground against the
real `HOME_PATROL` placements, and compares each move against **its own horizontal footprint**,
obtained by re-running the same target function with `verticalReach` set to `Infinity`. That
reference is exactly the pre-cycle behaviour, so every result reads as "what did the band take
away", and it cannot drift from the shipped horizontal reach the way a hand-written expectation
would.

The result, stated as narrowly as the measurement supports: **for all seven cases against all
five soldiers, there is still a bearing from which the furthest connecting stance on real
ground is the same distance it was before the band existed.** That is a claim about the maximum
over bearings and nothing more. An earlier version of this entry said "no move lost a metre of
standoff against any soldier", which the same measurement refutes — see the per-target losses
two paragraphs down. The three spears, which stand at radius 34.06 to 36.06 where
the home island is still a plateau, do lose nothing at all — the worst height difference any
move's footprint can reach around one of them is 2.593 m, and the narrowest band is the staff's
2.0, whose worst is 1.337 m inside the opener's arc and 1.548 m inside the finisher's. Every
stance the bands drop belongs to one of the two archers on the rim at radius 55, where the
walkable ground ends at 62.86 on `archer-1`'s own bearing and 65.12 on `archer-2`'s.

**What the bands actually cost, per target.** Keeping the furthest bearing is compatible with
losing most of the ground a move can be thrown from, and against the two rim archers that is
what happened. Against `archer-2`, a gust keeps 4332 of the 6172 stances its footprint holds —
**29.8% of them gone** — and a full slam keeps 3506 of 5297, **33.8% gone**; the staff finisher
keeps 79.9% and the opener 84.1%. Against `archer-1`, the gentler rim, the staff finisher and
the full slam both keep 92.4%. On the walk-in bearing specifically the losses are large in
metres as well: a gust connects against `archer-2` only from 5.35 m of its nominal 12, so
**6.6 m of standoff is gone**, and a staff finisher from 2.35 m of 4.2. All of those figures
are pinned two-sided in `reach-geometry.test.ts`.

**And a structural limit in the headline test worth knowing before trusting it.** Its reference
is the move's own footprint measured with `verticalReach` set to `Infinity` — the loosest band
that exists. Loosening a shipped band can therefore only move the banded result *towards* the
reference, so the equality it asserts holds a fortiori and the test is **structurally incapable
of catching an over-loosened extent**, however far it is loosened. Everything in that file that
does catch loosening is an incidental two-sided pin on a measured figure. This is recorded in
the file at the definition of its `FLAT` constant.

`archer-2` is the extreme, and it is worth knowing about before touching any of these numbers.
It stands on a low shelf beneath an overhanging lip — measured, the lip's top at y 5.8679 and
the surface 1.8076 m below it at y 4.0604 are both real `home` geometry — with a 47.8-degree
face beyond it that gains 2.891 m over its first 3 m of run before flattening to 10 degrees,
3.487 m over a full 4 m. An earlier version of this entry said "a 48-degree slope climbing about
6 m over the next 4 m of run"; the 48 degrees was right and the 6 m was not, and nothing
asserted either at the time. Walking straight out from the spawn at it descends that face, which
is why the walk-in standoffs above collapse; full reach against it survives from other bearings,
so the cost is a bearing rather than the move. Crowd behaviour
holds too — every stance on the island from which a gust's or a full vortex's footprint holds
two or more soldiers still catches all of them (124 and 365 stances), and the full slam has
exactly one stance where it does not: `(18, −41)`, which is 11.00 m from both `spear-3` and
`archer-2` — exactly a full slam's radius on each side, which is why it is unique — standing
5.981 m above `archer-2`.

**The Vortex's 8.0 is the loosest of the five, not the best-measured, and this entry used to say
the opposite.** It is unaffected on every bearing at both charges: nothing within its full 12 m
radius differs from a soldier's own footing by more than 6.661 m against a band of 8.0. That is
a good result for the fight and a bad one for pinning the number — having no stance to lose is
precisely why no real-geometry test objects to the band growing. Mutation-measured, `vortex.
verticalReach` at **6.7** leaves the whole suite green and at **11.9** leaves the whole suite
green; the value is free anywhere in a window over 5.3 m wide. What actually holds it is a
bracket, not a measurement: above the 6.661 m the terrain requires (`reach-geometry.test.ts`)
and below `maxRadius` 12 (`vortex.test.ts`'s "taller than any other move but still wider than it
is tall"). An earlier version of this entry called 8.0 "the one extent with measured headroom
rather than an argued guess", which inverts the truth — it is the extent with the *least* upper
constraint of the five. Recorded rather than retuned, because generous is the safe direction for
a lift move: a band too short to hold a target the move has just launched would fight its own
effect.

**The Pressure Wave's 4.0 is the one number the measurement argues with, and it was left alone.**
An aimed landing is real ground within `minRadius` of a soldier — the radius even the weakest
qualifying slam covers, so a player who dives at a soldier and lands inside it has aimed well.
The measured worst gap over all five soldiers is **4.2275 m**, on `archer-2`, 4.00 m out on the
slope above its shelf: **0.2275 m outside the shipped 4.0**, which is 5.69% of the band. So the
design's hoped-for "the worst case is comfortably inside 4.0" is false, and false by more than
the 3.5% first recorded. The medians are 0.045 to 0.578 m and the
other four soldiers are covered completely; 4.0 covers 99.28% of the disc around the
worst-placed one at the 0.05 m grid the test walks, so the shortfall is 0.72% of the disc, and
the worst miss is 0.2275 m rather than the "under 0.15 m" first recorded.

**Those figures are corrections, and the correction is worth reading before trusting any grid
measurement in this repo.** The first version of the measurement sampled the disc at 0.25 m and
reported a worst gap of 4.1404 m. That is not the terrain's worst gap; it is the worst of 797
samples. Re-measured, the figure does not settle until roughly 0.05 m:

| grid | worst gap | excess over 4.0 | coverage of the disc |
| --- | --- | --- | --- |
| 0.25 m | 4.1404 | 0.1404 | 99.3726% |
| 0.1 m | 4.2100 | 0.2100 | 99.2637% |
| 0.05 m | 4.2267 | 0.2267 | 99.2829% |
| 0.02 m | 4.2249 | 0.2249 | 99.2995% |
| 0.01 m | 4.2275 | 0.2275 | 99.2977% |

Two things went wrong, and both are ordinary enough to happen again. The first is that a
coarse grid biases a maximum *downward* every time, so a one-sided "the worst is under X"
reading is always the optimistic one. The second is worse: the coverage figure was pinned
two-sided at `> 0.993` and `< 0.994`, and the converged coverage is 0.99298 — **below its own
lower bound**. That assertion was green only because the grid stayed at 0.25 m, and it would
have gone red the first time anyone refined the sampling for an unrelated reason. The
"every miss is under 0.15 m" claim was carried by an assertion with 0.0096 m of headroom at
0.25 m sampling, and the real worst miss exceeds 0.15 m by 52%. The test now walks the disc at
0.05 m, pins the terrain claims at bounds that hold at every grid from 0.1 m down to 0.01 m,
asserts the converged 4.2275 m by probing the single point that carries it rather than by
sweeping onto it, and labels the one remaining sampling-specific pin as a fact about the
sampling rather than about the island.

**Both constraints on that number are now pinned, and they have crossed.** `minRadius` is also
4, so `verticalReach` already exactly equals it and the weakest slam is exactly as tall as it is
wide — the sphere the value's own comment says the move must not become, produced by that
comment's own number. `pressure-wave.test.ts` asserts `verticalReach <= minRadius` at equality
with zero slack, so the constraint reddens the instant the number grows; and
`reach-geometry.test.ts` pins the 4.2275 m measurement and the coverage, so it reddens if
the number moves in either direction. There is no value satisfying both: covering the whole disc
needs at least 4.2275, which makes the weakest slam more than 5% taller than it is wide.

**The owner's decision, re-taken against the corrected figures: leave all five extents where
they are, and specifically leave `pressureWave.verticalReach` at 4.0.** The larger shortfall
does not change the decision, and one thing the re-measurement established makes the case
stronger rather than weaker. All **144 of the 144** failing samples on the 0.05 m grid sit in
the **outermost 0.204 m** of the disc — every one at 3.796 m or further from the soldier, none
anywhere in the interior — inside a single bearing wedge from **−64.7° to −30.1°**, and every
one of them stands on ground with air beneath it: a second `home` surface lies below each,
never less than 34.2 m down. So the failing region is not a thin ring around the whole disc but
one face of one overhang, and a player who lands there has landed on a lip above the soldier
rather than beside it — which is, arguably, a miss. Against that: 4.0 is already the ceiling its
own flatness argument allows, and growing it to 4.2275 buys 0.72% of one soldier's aimed-landing
disc at the cost of the "flatter than the weakest slam is wide" property outright. The
alternative still on the table if play disagrees is to widen `minRadius` to about 5 and raise
`verticalReach` to 4.23, which repairs the argument rather than abandoning it but touches a
value outside this cycle's five. Nothing has been played, so this is a decision recorded for
whoever plays it, not a settled one.

**Airborne targets are untested for all four moves, and the vortex makes that a real gap.**
`reach-geometry.test.ts` snaps every soldier to `groundHeightAt`, so the entire real-geometry
battery measures grounded targets — and three of the four moves launch their targets. Under
gravity 20, `vortex.maxLiftSpeed` 11 gives a full-charge lift apex of 11² / 40 = **3.025 m**,
which is above the staff's `verticalReach` of 2.0. The vortex is the only move where that
matters, because it pulls inward while it lifts: the horizontal distance to the caster shrinks,
so the vertical band is the only thing that can put the target out of a follow-up's reach. A
gust's knockback of 26 and a full slam's 30, against `knockbackDamping` 2.6, carry a target 10 m
and 11.5 m outward respectively — well past the staff's 4.2 — so those two leave horizontal
range first. Measured: above roughly **66% charge** the target leaves staff reach, and at full
charge it is unreachable by the staff for **0.640 s of its 1.10 s flight, 58% of its airtime**.
Avatar State's boosted gust does the same by a different route: at ×1.5 knockback its lift apex
is 2.377 m, also past the staff's 2.0, and it needs one keypress rather than a charge.

This may well be correct by design — this document already says the vortex's payoff is that an
airborne enemy is inert, and that lift is the vortex's job and not the staff's — so it is
recorded as a thing to watch in the play pass rather than as a defect. The arithmetic is now
pinned in `vortex.test.ts` so the numbers cannot drift silently, but nothing exercises the
actual mid-air hit test for any move.

**A known cosmetic mismatch, named here rather than hidden — and it is all five attack visuals,
not just the gust.** Every attack effect in `src/fx/` is a flat shape, while every hit volume is
now a slab, so each one **under-draws its move's height by `2 × verticalReach`**:

| effect | move | height not drawn |
| --- | --- | --- |
| `src/fx/gust-cone.ts` | gust | 10 m |
| `src/fx/aim-tell.ts` (the gust's preview sector) | gust | 10 m |
| `src/fx/staff-arc-fx.ts` | both staff arcs | 4 m |
| `src/fx/shockwave.ts` | Pressure Wave | 8 m |
| `src/fx/vortex-ring.ts` | Vortex | 16 m |

The spec and an earlier version of this entry named only `gust-cone.ts` and `aim-tell.ts`, which
under-disclosed it: the ring effects are flat `RingGeometry` rotated onto the horizontal plane
(`shockwave.ts` and `vortex-ring.ts`) and the staff arc is a flat sector, exactly like the cone.
The Vortex is the worst of the five in absolute terms, at 16 m of invisible extent.

Three of the cross-check tests pass anyway, and it is worth being precise about why: they
compare the drawn shape against the hit test using probes that are all level with the caster, so
`verticalReach` never participates. All three now say so in their names —
`gust-cone.test.ts`'s "draws exactly the footprint the gust hits, and deliberately says nothing
about its height", `aim-tell.test.ts`'s "covers the horizontal footprint the hit test covers,
and deliberately says nothing about its height", and `staff-arc-fx.test.ts`'s "agrees with
inCone about the horizontal footprint of the sweep, and says nothing about its height". **A green
run in any of them is not evidence that a hit volume is flat.** This is deliberately unfixed:
giving the effects real thickness is a visuals change and the visuals phase has not started.

The other two items in that same analysis — no crosshair and no hit-direction indicator — have
since been built; see "Aim and hit direction" below. Neither of them addresses the height
mismatch above, and the reticle in particular is worth not confusing with it: it is a single
point along the heading, so it reports a direction and says nothing about the slab the gust
actually sweeps.

## Settings and accessibility

**There were no settings at all before this cycle, and `prefers-reduced-motion` was read
nowhere in the codebase.** `MOUSE_SENSITIVITY = 0.0022` was a module constant in
`src/core/input.ts` with no way to change it, there was no inverted vertical look, no volume
control and no mute, and camera shake, hitstop, the full-screen red hurt flash, the Avatar
State's gold vignette and the dash's FOV kick all fired unconditionally. There are now five
settings — sensitivity, invert Y, volume, mute, reduce motion — in a section at the bottom of
the guide panel.

**The model is `src/core/settings.ts`, pure and tested.** `readSettings` is tolerant field by
field rather than as a whole object, so junk in one field falls back to that field's default and
leaves the others alone; a whole-object fallback would let one bad number reset every
preference. Sensitivity is a **multiplier** on the old 0.0022 rather than a replacement for it,
so sensitivity 1 reproduces the shipped feel exactly and a player who never opens the panel is
unaffected. Range 0.25 to 4, clamped in the model, and `settingsRows` takes the slider bounds
from the same two exported constants so the panel cannot offer a value the model would clamp
away.

**Mute does not zero the volume, and that is load-bearing.** `effectiveVolume(s)` returns 0
when `s.muted` and `s.volume` otherwise, and nothing ever writes 0 into `volume` on mute — so
unmuting restores exactly the level the player had set instead of a default. `main.ts`'s
`applySettings` is the only place in the game that reads both fields together, and the volume
slider deliberately draws `settings.volume` rather than the effective value, so a muted panel
still shows what unmuting will restore.

**The six motion scalars are deliberately not uniform, and three of them soften rather than
vanish.** `motionScales` returns `shake` 0, `hurtFlash` 0 and `dashKick` 0 under reduce motion,
because camera shake and a FOV punch are the vestibular triggers proper and a full-screen red
pulse is closer to photosensitivity — none of the three carries information the player cannot
get elsewhere. `hitstop` softens to 0.4, `vignette` to 0.35 and `speedFov` to 0.35 instead, for
the same reason in three forms: the freeze is the main signal that a heavy hit landed, and a
freeze is itself the absence of motion, so zeroing it costs legibility without buying comfort;
the gold rim is how the player knows the Avatar State is running; and a widening field of view is
how fast flight reads as fast. A single scalar applied to all six would be simpler and wrong — it
would either delete the three signals or leave the three triggers running.

**`speedFov` is the sixth, and the final review of that cycle found it rather than the spec.**
`fovForSpeed` widens the camera continuously with airspeed — 7° at 27.5 m/s and the full 14° at
the 55 m/s reference, for as long as fast flight lasts — which makes it the largest and by far the
most sustained motion effect in the game. The cycle had zeroed `dashKick` on the stated reasoning
that a FOV punch is the other strong vestibular trigger, and then left this, the bigger instance
of exactly that effect, unmentioned in the spec, the plan and the task report. It is softened
rather than zeroed because it is a speed-*readability* cue, and 0.35 leaves a 4.9° swing — under
the 6° dash punch the same cycle judged too strong as a transient, which is the argument for the
number and is asserted as such in `src/core/settings.test.ts`. The scale reaches `fovForSpeed` as
a second argument so that it multiplies the kick and never `BASE_FOV`: scaling the whole angle
would narrow the camera to nothing at 0 instead of calming it.

They are applied in `src/main.ts`, each at the point the effect reaches the screen rather than
where it is triggered. `shake` multiplies the vector `shakeOffset` writes, in `syncVisuals`;
`hurtFlash` and `dashKick` multiply their `stepPulse` values at the `hud.update` and
`camera.fov` calls (scaling the pulse instead would shorten each effect rather than dim it,
since `stepPulse` decays at a fixed rate per second); `hitstop` is scaled inside a local
`freeze()` helper that all three trigger sites go through, so there is one place the scale can
be missing from rather than three. `speedFov` is passed into `fovForSpeed`, at the single
`camera.fov` assignment. The vignette is the odd one out: it is a CSS opacity owned by
`src/ui/hud.ts`, so `main.ts` writes `--vignette-scale` on the root element and the rule reads
`opacity: var(--vignette-scale, 1)`. Threading it through `HudModel` instead would have meant a
fourth trailing optional number on `hudModelFor`, which that file's own comment warns is the
shape where a caller silently swaps two arguments.

That `var(..., 1)` fallback is a convenience for a standalone HUD and a trap for a typo: a
misspelling on either side falls through to a full-strength gold rim, so reduce motion would
quietly stop softening the vignette with nothing red and nothing visibly wrong. The property name
is therefore a single exported constant, `VIGNETTE_SCALE_PROPERTY` in `src/ui/hud.ts`, which
`main.ts` imports and the stylesheet interpolates. `setProperty` takes any string so this is not a
type error waiting to happen, but there is now one spelling rather than two — **do not inline the
name back into either side.** `src/ui/hud.test.ts` asserts the rule still reads the property.

**Preferences are stored under their own key, not in `SaveData`.**
`airbender-skies:settings:v1` in `src/core/settings-store.ts`, reusing `StorageLike` and the
same never-throws pattern `loadSave` already uses. Progress and preferences have different
lifetimes: a player who clears their shrines should not lose their sensitivity, and `SaveData`
is versioned on its own schedule.

**Opening the guide releases the pointer lock, and that single call is what the whole panel
depends on.** While the canvas holds the lock there is no visible cursor, so no mouse-driven
control is possible at all — that is what would otherwise have forced a keyboard-only settings
panel. `api.open()` in `src/ui/guide/panel.ts` therefore calls `document.exitPointerLock()`. It
composes with the pause cycle rather than fighting it: `pauseReason` orders its causes `guide`,
`hidden`, `unlocked`, so with the guide open the reason stays `'guide'`, `pauseOverlayModel`
returns an invisible card, and the player does not get a "Click to resume" card stacked on the
panel they just opened. `src/core/pause.test.ts` already enumerates all eight input
combinations, so that ordering is asserted; what no test asserts is that this call is what
depends on it, which is why the call carries a long comment. **Do not delete it.**

Closing the guide leaves the player unlocked, which drops them into exactly the click-to-resume
flow Escape already uses. That changed what `H` does, and the `H` and `Escape` rows in
`src/ui/guide/actions.ts` plus the README's control table were corrected for it: H used to hand
a player straight back into play, and there is no longer any case where it does.

**Only the settings rows take pointer events.** The panel keeps `pointer-events: none`
everywhere else, and the reason is unchanged — a full-screen click sink over the canvas would
swallow the click that requests the lock, which is how play resumes. The rows are the one
exception and they are safe *because* the lock is deliberately released while the guide is open:
there is no lock left for a swallowed click to cost, and the game is paused. That reasoning does
not generalise to the panel root, so do not relax it there. One consequence needed handling:
because the panel's empty space still passes clicks through to the canvas, `InputTracker` would
request the lock again and take the cursor away from the one panel that needs it — so
`main.ts`'s `pointerlockchange` handler releases the lock again whenever it is acquired while
the guide is open.

**What could not be verified, and it is this cycle's central interaction.** The pointer-lock
release cannot be exercised in this environment at all. The harness never receives OS focus:
`document.hasFocus()` is false and `canvas.requestPointerLock()` rejects with
`WrongDocumentError: The root document of this element is not valid for pointer lock.` There is
therefore never a lock to release, and — because `pauseReason` requires `pointerLocked` — the
game cannot be made to run either, so none of the five in-code motion scalars could be watched
taking effect in play. What *was* verified in a browser is recorded in
`.superpowers/sdd/2026-08-07-settings-and-accessibility/task-3-report.md`, and it is worth reading
in its own words rather than through this summary: the section renders, the rows carry the loaded
values, `getComputedStyle` reports `pointer-events: auto` on a row and `none` on the panel root,
trusted clicks changed and persisted the reduce-motion checkbox and both slider tracks — **invert
Y was never clicked at all, and no drag was ever exercised as a drag**, only single clicks on a
track, which fire the same `input` event a drag repeats — muting leaves the stored volume
untouched, and a written setting survives a reload. The vignette's custom property was watched
reaching the element's computed opacity, with the `is-on` class added by hand and the CSS
transition disabled inline, because that tab never paints and the transition would otherwise never
advance off its starting 0. Whether any of it *feels* right is unverified as well — nobody has
played this. Sensitivity 1 as the centre of a 0.25–4 range assumes the base 0.0022 is a sensible
default, which no human has judged, and the 0.4 and the two 0.35 softening factors are argued
guesses.

**The keyboard path to the panel, which that cycle nearly shipped broken.** `InputTracker` used to
call `preventDefault()` on *every* Space keydown from its window-bound listener. `preventDefault`
cancels a checkbox's activation behaviour whatever element the listener is on and whatever phase it
runs in, Enter does not activate a checkbox, and there is no form here to submit — so Space was the
only path to the panel's three toggle rows and it was being eaten. A keyboard-only player could
reach neither invert Y, nor mute, nor **the reduce-motion switch itself**, in the cycle whose
deliverable is an accessibility panel. It survived the cycle because it is pre-existing behaviour
in `input.ts` and was judged out of scope, and because `prefers-reduced-motion` seeding the default
happens to mitigate it — coincidentally, not by design. The final review rejected that. The Space
claim is now gated on the event target through `shouldClaimSpace`, exported from
`src/core/input.ts` and tested in both directions: a focused form control keeps Space, and
everything else — `null`, `window`, the canvas — still gives it to the jump, because an unclaimed
Space with nothing focused scrolls the page under the player.

What works now, and it was checked by reading the code rather than by driving a keyboard, since
this harness delivers no real key events to the page at all (measured: a capturing `window`
`keydown` listener recorded zero events across three synthetic key presses): `H` opens the guide,
Tab traverses the rows, Space toggles the three checkboxes, Arrow / Home / End / PageUp / PageDown
reach a focused slider (`panel.ts`'s keydown handler yields to a focused `range` input rather than
scrolling the panel — and only to a `range`, so those keys still scroll while a checkbox has
focus), and `H` or Escape closes. The panel sets no `outline: none` anywhere, so the browser's own
focus rings are intact.

What remains open: **there is no focus treatment of the panel's own**, only the default UA ring on
a dark translucent backdrop, which is a legibility question nobody has looked at. Nothing labels
the rows for a screen reader beyond the `<label>` wrapping each control — no `aria-describedby`, no
grouping role on the section, and no announcement when a setting changes. And none of the keyboard
path above has been exercised by an actual key press in an actual browser, here or anywhere.

## Aim and hit direction

**Two gaps motivated this cycle, and they were both about the fight being unreadable rather than
unfair.** Nothing showed where an attack would go: the gust, both staff arcs, the Pressure Wave
and the Vortex are all aimed at `player.forward`, and there was no crosshair anywhere in
`src/ui/hud.ts` — while the archer got an aim tell of its own in `src/fx/aim-tell.ts`, so the
enemy telegraphed and the player did not. And nothing showed where a hit came from: `hud-hurt` is
a full-screen red vignette with no direction in it, and archers fire from up to 30 units, so an
arrow from behind gave the player a red flash and no information at all.

**The reticle is projected, not centred, and it would be wrong twice over if it were centred.**
The camera is a follow cam: `desiredCameraPosition` puts it behind the player and 2.6 above, and
`camera.lookAt(sampledPosition)` aims it at the *player* — so screen centre is the character's
body, not the aim point. And on foot `groundStep` sets `forward` to
`horizontalForward(input.lookDirection)`, deliberately flattened so a standing turn moves the
blast with the character, which means looking up 40 degrees still gusts horizontally. A dot at
screen centre would misreport both the offset and the pitch. So `main.ts` takes a point along the
real `forward`, runs `Vector3.project(camera)`, and draws the reticle where that lands. This is
honest in both postures with no special case: on foot it sits on the horizon ahead, teaching that
aim is horizontal, and in the glider `forward` is the steered 3D heading and the same projection
follows it.

The distance along `forward` is `DEFAULT_COMBAT_CONFIG.gust.range`, read from the config rather
than written as a number. It is the whole tuning surface of the projection — a point a metre or
two out projects almost onto the character and barely moves on a turn, a point on the horizon
moves freely but stops saying anything about reach — and the gust is the longest-reaching aimed
move, so its range is the honest outer edge of "where an attack will go".

**The projection must run after `camera.updateProjectionMatrix()`, and nothing tests that.**
`Vector3.project` multiplies by the camera's projection matrix and its inverse world matrix, and
the tail of `syncVisuals` changes all of them: it writes `camera.position`, calls `camera.lookAt`,
reassigns `camera.fov` and only then updates the projection matrix. Run any earlier, the reticle
would be computed against the previous frame's matrices and sit one frame behind the view — which
still looks entirely plausible in motion. `src/main.ts` has no tests, so the ordering is held by a
comment at the call site and by this paragraph.

**Hits are reported before the avoided check, on purpose.** `stepEncounter` fills
`playerHitsThisFrame` where the damage is counted, which is upstream of the point where
`playerInvulnerable` zeroes what is applied. So a Slipstream that discards the damage still
produces a mark, on a frame where `playerHit` is false and the hurt flash, the shake and the hurt
voice all correctly stay silent. The list reports what was *aimed* at the player; a dodge should
still say where the attack came from, because that is the information the next dodge is made of.
Filtering the list down to what actually landed reads as the more obvious rule and is the wrong
one. `encounter.test.ts` pins it, including a spear and an arrow landing on the same frame with
distinct sources — which is the case that justifies a list rather than one averaged direction,
since averaging two bearings points at the empty space between them.

**Marks are not re-aimed as the camera turns, and that is the point rather than a shortcut.**
`stepHitMarks` ages `life` and never touches `bearing`, so a mark records the direction the hit
came from at the moment it landed. Recomputing it every frame against the current heading is the
instinct and it is the wrong one: the wedge would follow the player's view and never resolve,
where fixing it means turning toward it leaves it behind — which is what makes turning toward it
feel like it worked.

**The indicator is deliberately outside reduce motion's scaling, and this is the decision most
likely to look like an oversight later.** Every other effect in `syncVisuals` is scaled at the
point it reaches the screen — `motion.shake` on the shake offset, `motion.dashKick` and
`motion.speedFov` on the field of view — and this one is not scaled at all. Do not make it
consistent with them. `motionScales` zeroes `hurtFlash`, so with reduce motion on this indicator
is the player's only feedback that they were hit beyond the health bar moving; scaling it would
take away the thing that makes that mode playable in a fight. And there is nothing to soften even
in principle: a wedge does not shake, pulse, travel or grow, it sits still and fades, so it is
information rather than motion. The reasoning is repeated at the call site in `main.ts` and in
`src/ui/hit-direction-view.ts`, because a comment in one file would not be where a reader
"fixing" the inconsistency was looking.

**The sign convention on the bearing is the one error that would make the feature worse than
nothing.** `bearingFromCamera` returns 0 dead ahead and positive when the source is to the
camera's screen-right, ±π directly behind, and `hit-direction.test.ts` asserts the *signed*
values rather than magnitudes — a test on `Math.abs` would pass an implementation that mirrored
left and right, and a mirrored indicator sends the player turning away from whatever hit them.
The bearing is also pinned as *relative* to the camera rather than to the world, against a camera
looking along world `+X` and by the invariance of the answer under yawing the camera and the
source together. Both were added after the fact: every original fixture looked along world `-Z`,
which is also three.js's default heading, so an implementation that ignored the camera forward
altogether passed the file — see the register's eighteenth entry.
CSS positive rotation is also clockwise, so `hit-direction-view.ts` rotates each wedge from the
top by `+bearing`. That is invisible in code review, so it was measured in a browser instead:
driving the view module with three marks and reading each wedge's `getBoundingClientRect` centre
against an origin at (0, 0) gave (0, −64) for bearing 0, (+64, 0) for `+π/2` and (−64, 0) for
`−π/2`. If the geometry in that file changes, measure it again the same way.

**Three smaller things worth knowing.** Both view roots are appended to `document.body` *before*
`createHud`, and the order still matters: none of the overlays sets a `z-index`, so they stack in
document order, and the HUD's own full-screen `.hud-fade` and `.hud-hurt` layers paint over
whatever precedes them, which keeps both overlays under the pause card and the guide panel. It is
no longer the only thing standing between the player and a gold reticle over a black screen,
though — `syncVisuals` hides both views outright while `down` is set. It has to, for a reason
independent of layering: `update()` returns early through the whole down beat, so `aimHot` holds
whatever it was on the frame the player went down and the aim point comes from a heading the
player cannot change until the beat ends. Drawing either of them there is drawing a stale claim,
and the layering is now a second line of defence rather than the mechanism.

`reticleModel` reports `visible: false` for a model whose fractions are not finite, as well as
for one outside the depth range. A camera whose `aspect` is not finite yields an `ndc.x` of NaN
while `y` and `z` stay finite, so a depth-only check comes back `visible: true` with only half a
position, and an invalid CSS `left` is dropped rather than clamped — the reticle would slide
vertically at whatever horizontal position it last had. Watched happening in the preview pane,
whose canvas is 0×0 at load. The check lives in `reticle.ts` rather than in the view, and
deliberately: it is a correctness rule, the view cannot be tested in node, and `reticle.test.ts`
now pins it per component, including against a real `PerspectiveCamera` built on a `0 / 0` aspect
so the NaN is three.js's own output rather than a hand-written stand-in.

`recover()` clears `hitMarks`. Every mark records a hit on the life that just ended, measured
against a camera heading and a player position that the respawn discards, so none of them points
at anything afterwards. As the two constants are tuned today the beat outlasts the marks and
nothing survives the blackout in practice, which makes this a guard rather than a fix — but
"`DEFAULT_DOWN_CONFIG`'s ramps are longer than `HIT_MARK_SECONDS`" is a coupling across two files
that nobody retuning either one would think to check, and the failure on the day it stops holding
is a ring of wedges at the respawn point pointing back at where the player died.

**An inaccuracy in the arrow case, stated rather than left to be discovered.** An arrow's reported
`from` is the projectile's position *entering* the frame it connects on, not the impact point,
because `stepProjectile` discards the connecting position. The gap is `speed × dt` — about 0.57
units at the shipped archer's speed of 34 and 60 Hz. It stretches distance rather than rotating
the bearing, since the pre-step position lies almost directly behind the impact point along the
arrow's own approach vector, so for an indicator that reports a direction and not a distance it
barely matters. It is still a real inaccuracy and not a rounding artefact.

**A second inaccuracy, in the bearing itself, and it is bigger.** `markFor` is handed the
player's `lookDirection` as the camera forward rather than the camera's own orientation. That
substitution is exact for the camera's *desired* position — the follow cam's offset is
`-lookDirection * distance` plus a purely vertical lift, so flattened the direction from camera
back to player is the look direction exactly, and `follow-cam.test.ts` now pins that against both
profiles and steeply pitched headings. It is the only test that reddens if the follow cam ever
gains a shoulder offset or an orbit, which would otherwise rotate every wedge by a constant with
nothing else in the game looking wrong.

What the substitution does not account for is `smoothTowards`. The drawn camera trails its desired
position, so mid-turn it is still catching up to `lookDirection`. Measured over a sustained turn
at 180 degrees a second: **17.78 degrees on foot and 9.68 in the glider**, rising to 32.00 and
18.57 at 360 degrees a second. A mark freezes its bearing at the instant it lands, so a hit taken
mid-flick keeps that error for its whole 1.2 seconds. Both figures are asserted in
`follow-cam.test.ts`, and the first-order estimate a reader would reach for — turn rate over the
smoothing constant, 20.0 degrees on foot — is wrong, because the smoothing acts on the camera's
position around a circle rather than on the angle. Reading the camera's own world direction at the
push site instead would trade this lag for a one-frame-stale orientation, which is the smaller
error; it was not done, because it puts render state inside the simulation half of the frame and
nobody has seen how large the error feels with a hand on a mouse. **This is the first thing to
re-examine if wedges read as pointing slightly wrong during fast turns.**

**What was verified, and by what means.** Both view modules are untested, for the reason
`createHud`, `createPauseOverlay` and `createGuide` are: the test environment is node. Everything
a test could catch lives in `src/ui/reticle.ts` and `src/fx/hit-direction.ts`, which are pure and
covered. In a browser, both roots were confirmed present in the intended document order with
`pointer-events: none` computed on each; the reticle's `left`/`top` were confirmed as plausible
percentages with the y axis flipped; a point behind the camera was confirmed not to draw; the
element pool was confirmed to hide surplus wedges rather than drop them; and synthetic
`PlayerHit`s driven through the real `markFor` → view chain produced wedges at the measured screen
angles above, with opacity tracking `life / HIT_MARK_SECONDS` and every mark dropped once its life
ran out. Driving the real loop with the synthetic clock confirmed that both roots are
`display: none` on a paused frame.

**What is unestablished, and must not be inferred from any of that.** Whether the reticle tracks a
turn, whether it sits where an attack actually lands, and whether a wedge reads as a direction
during a fight — all three need pointer lock, which this environment cannot hold
(`requestPointerLock` fails with `WrongDocumentError`, and `pauseReason` requires `pointerLocked`,
so the game cannot be made to run at all). The projection was never watched against a live camera;
the ordering claim above rests on reading `syncVisuals`. `HIT_MARK_SECONDS` 1.2, the 54–74 px
radius, the wedge's size and the reticle's 20 px ring are all argued guesses that nobody has
played with.

## Off-screen enemy indicators

**The hit-direction cycle covered the moment after an attack lands; this one covers the moment
before, when something engaged with the player is simply not in view.** `src/fx/off-screen.ts` is
the pure half: `offScreenPresence` reads a soldier's NDC projection and ramps from 0 at the frame
edge to 1 at `OFF_SCREEN_RAMP` past it, and `enemyMarker` decides who earns a chevron at all —
targetable, off screen, and either within the fight's own `aggroRange` measured in 3D or, for a
melee soldier, within its `strikeRange` measured horizontally. `src/ui/off-screen-
view.ts` draws one hollow red chevron per marker on a ring outside the existing hit wedges, rotated
by the same signed bearing convention those wedges already use, brightening for a soldier that is
winding up to strike. `src/ui/guide/reference.ts` gains `SCREEN_MARKS`, a two-entry legend read
through the panel's existing generic `notesHtml`, so the guide now says in plain words which ring
is which. And `percent`, `radians` and `alpha` moved to a shared `src/ui/overlay-format.ts`. Only `percent`
was actually duplicated — written out identically in `reticle-view.ts` and `hit-direction-view.ts`
before this cycle, and about to be copied a third time — which is the duplication this project's own
review rubric treats as a defect. `radians` and `alpha` existed once each, privately in
`hit-direction-view.ts`, and moved alongside it because a third view needed them and because the
node test environment can reach a shared module while it cannot reach either view.

**Three findings from the spec shaped the design before any code was written.** Edge-clamping —
projecting the target and clamping the result to an inset rectangle, the genre-standard approach —
is the wrong shape here, because a projection behind the camera is mirrored garbage, and the space
directly behind the player is the majority of what this feature exists to cover; an edge-clamped
implementation would be projection-driven for the minority just past the frame edge and
bearing-driven for the majority behind the camera, with a discontinuity where a target crosses
between the two. One rule instead: bearing, through the same `bearingFromCamera` the hit wedges
already use. Second, the combat model needed no new reporting at all — everything this feature
needs was already available inside `syncVisuals`: `encounter.enemies` for stance and health, each
view's interpolated position for where the body is drawn, and a camera already positioned and
oriented for the frame. `src/combat/encounter.ts` and `src/combat/enemy.ts` are untouched by this
cycle. Third, this overlay reads the camera's own heading via `camera.getWorldDirection()`, while
the hit wedges deliberately keep reading `input.lookDirection`, and the two are not the same thing:
the drawn camera trails `lookDirection` by a measured 17.78 degrees during a sustained 180-degree-
per-second turn on foot. A frozen hit mark can absorb that lag — it is a record of a past moment
either way — but a marker recomputed every frame cannot, because the lag would show up as the whole
ring sliding during a turn and settling afterward. The two overlays are on different bases on
purpose, and unifying them by moving hit marks onto the camera basis would be the wrong fix: `markFor`
is called from `update()`, and reading the camera there would move render state into the simulation
half of the frame.

**What that divergence looks like to a player, which the paragraph above states only as a
justification.** A player hit *while flicking* sees two marks for the same soldier, up to about 17.8
degrees apart: roughly 20 px of arc at the wedges' 54–74 px radius and 30 px at the chevrons' 84–104
px. And the two do not behave the same way afterwards — the chevron converges on the truth as the
camera catches up, because it is recomputed every frame, while the wedge froze its bearing at the
instant the hit landed and stays wrong for its whole 1.2 seconds. So a player who turns to face the
chevron finds the wedge still pointing slightly off it. This is the shape of the artefact to look for
when someone finally plays this with a mouse in hand, and it is the concrete version of the thing
the "17.78 degrees" figure has so far only been used to argue about.

**The 3D-versus-horizontal decision exists for the hovering spear, and the first version of it got
the hovering spear backwards.** `stepEnemy` measures a spear's notice range horizontally — that is
what makes an archer, which measures in 3D, the type that pressures altitude at all — so a spear 20
units out and 300 units below a hovering player is still inside its horizontal `aggroRange` of 26
and has noticed them. Marking every such soldier would hang a permanent ring of chevrons around a
player who has climbed out of the fight, the same clutter `HIT_MARK_SECONDS` was tuned to avoid on
the other overlay. So `enemyMarker`'s primary test is 3D distance against `aggroRange`, which is
stricter than the fight for a spear and identical to the fight for an archer.

**What that alone got wrong is the same trap this document already records against `stepEnemy`: a
horizontal reach means height is *ignored*, not protective.** A melee soldier measures
`strikeRange` horizontally too, so a spear at horizontal distance 0 is inside its 3.2 reach at
*any* altitude — it winds up, and it hits. `enemy.test.ts`'s "still thrusts at a player almost
directly overhead" pins exactly that, and measured against the real config a spear at the origin
deals 3 damage over 200 frames (3.3 s) to a 5-health player hovering at (0, 30, 0). Shipped with
only the 3D clause, this feature stayed silent about the one soldier that was actually damaging
that player, while the hit wedge that did appear pointed dead ahead — `bearingFromCamera`'s
`sourceDistance < 1e-6` guard returns 0 for a near-vertical offset. So the range rule now has a
second clause: a melee soldier also earns a marker within `strikeRange` measured horizontally,
gated on `c.attack.kind === 'melee'` so an archer, which measures both notice and commit in 3D and
cannot shoot a target the first clause rejected, is unaffected. The anti-clutter property survives
— a spear 10 units out and 30 units below is outside both clauses and earns nothing — and both
ranges are read from the config rather than written as literals, so retuning either moves the
markers with it.

**That same divergence caught the guide legend's first draft saying something the code does not
check.** `SCREEN_MARKS`'s "Threats off screen" entry originally read "for each soldier that has
noticed you", and "has noticed you" is the fight's own horizontal notice test for a spear, not the
3D one `enemyMarker` actually gates on — a spear that has genuinely noticed the player by the
fight's own definition (advancing, horizontally in range) but sits far below and off to one side of
a hovering player earns no chevron, so a player reading that sentence literally could conclude "no
chevron" means "nothing has noticed me", which is false in exactly that case. The direction of the
mismatch is safe *now that the melee reach clause exists* — the remaining omitted case is a soldier
outside both its 3D notice range and its horizontal strike reach, which cannot land a hit from where
it stands, and which earns a chevron the moment it closes into reach, since `stepEnemy` walks a
noticing spear in horizontally and the melee clause admits it as soon as it arrives — but the words
still claimed a gate the code does not run. The copy now says "close enough to be a threat"
instead, which is what `enemyMarker` actually gates on. This is the only place a future reader
learns that the player-facing sentence and the code's rule are deliberately not phrased the same
way.

**The register entry this cycle nearly added.** The spec's first draft asked for asymmetric
fixtures "so an axis swap is visible" in `offScreenPresence` — a test that cannot fail, because the
overshoot the function reports is a `Math.max` of the two axes' excesses, and `Math.max` is
commutative: swapping which axis is `x` and which is `y` is a provable no-op, and no fixture, however
asymmetric, can make that swap observable. The fixtures stayed, because they do catch real mutants —
reading only one axis, or dropping the absolute value — and the claim attached to them was corrected
to say exactly what they catch and what they cannot, rather than deleting a test that pulls its
weight for the wrong stated reason. This did not become a register entry below because it was caught
before anything shipped; it is recorded here as the same shape the register exists to guard against.

**The delivery path in `main.ts` is, once again, invisible to every check this repository can run,
and that was measured rather than assumed.** Deleting the feature's single `offScreen.update(...)`
call leaves the whole suite — 1600 tests when this was measured, during the wiring task — and both
typecheck passes completely green. `noUnusedLocals` is
off in this project, and the `offScreen` instance stays "used" through its two `hide()` calls
regardless of whether `update()` is ever reached. This is not a defect introduced by this cycle; it
is the same standing property of `main.ts` that earlier cycles in this document have already
recorded, confirmed again here because a change to the wiring is exactly the kind of thing that
property would hide.

**A plan defect, caught by the compiler rather than a reviewer.** The plan named the new per-frame
array `markers`, which collides with a pre-existing and unrelated `const markers = new
Map<string, Mesh>()` for shrine markers, still in scope at both insertion points in `main.ts`. Using
the plan's literal name produced a `TS2451` redeclaration error. The new local is `enemyMarkers`;
the shrine map is untouched.

**One comment was checked against the installed library rather than taken on faith, and the half of
it that was inferred rather than measured turned out to be wrong.** A comment asserts that
`camera.getWorldDirection()` needs no renderer pass first because it calls `updateWorldMatrix`
itself. Checked against the installed three.js 0.185.1 rather than recalled from memory: that holds,
and it holds further than the comment states, because `Camera` overrides `updateWorldMatrix` to
refresh `matrixWorldInverse` as well — so there is no staleness in the *marker* projection, which
runs after that call.

**What did not follow, and was written down as if it did, is that "the same reasoning covers the
pre-existing reticle projection".** It did not. `camera.updateProjectionMatrix()` rebuilds only
`projectionMatrix`; `Vector3.project` also reads `matrixWorldInverse`, which is otherwise refreshed
by `renderer.render` — and that runs *after* `syncVisuals`. So the reticle, projected before the
`getWorldDirection` call, was reading the previous frame's inverse world matrix while the chevrons,
projected after it, read this frame's. The two projections disagreed by a frame, which put the
ring's origin one frame behind the ring's contents. Proved by running the exact sequence against the
installed library: the same target point gives two different NDC results, with `getWorldDirection`
as the only intervening statement. Fixed by hoisting that call above the reticle's projection, which
also retires a pre-existing one-frame reticle lag that predates this cycle. **The call is now doing
double duty and must not be moved back down**; the comment beside it says so.

**Three things a reviewer raised that this document records rather than fixes.**

*The duplicated finiteness test.* The expression
`Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)` is now written out verbatim in both
`src/fx/off-screen.ts` and `src/ui/reticle.ts`. A second copy of one boolean, not yet a third.
Left as a judgment call for whoever next touches either file, rather than extracted on the strength
of two occurrences.

*`enemyMarker`'s range gate fails **closed** on a non-finite world position, which is stricter than
it looks.* There is no finiteness check on a world position anywhere in `off-screen.ts` — only on
the NDC — so the behaviour falls out of the comparisons. A NaN in `x` or `z` poisons both
`distanceTo` and `horizontalDistance`, and since `NaN <= x` is false, both clauses of the two-clause
range rule are false and the soldier is rejected. The single `if (distance > c.aggroRange) return
null` this replaced failed *open* on the same input; restructuring the gate into two
admit-comparisons flipped that direction, which is worth writing down because it is the opposite of
what a reader checking NaN behaviour would expect. The consequence: a soldier whose horizontal
position goes corrupt silently disappears from the ring rather than drawing wrongly. And it is that
gate, not any finiteness test, which closes the only route to a NaN bearing — `bearingFromCamera`
reads `x` and `z`, `radians` would render its NaN as `"NaNrad"`, and CSS drops the invalid transform
and leaves a full-opacity chevron at rotation zero. Anything that loosens the gate reopens that
route.

A NaN confined to `y` alone still admits a melee soldier inside its horizontal reach, and that is
the clause working rather than a hole: the clause and the bearing both read only `x` and `z`, so the
chevron points correctly on the data that is still good, while `offScreenPresence` returns 1 from
the all-NaN projection — its deliberate answer for a projection it cannot place. An archer is
rejected, its notice clause being the 3D one. All of this was derived by running the cases rather
than reasoned about: NaN `x` → null, NaN `z` → null, NaN `y` with a spear underfoot → a marker at
bearing 0 and strength 1, NaN `y` with the same spear 10 units out → null, NaN `y` with an archer →
null. No reachable path to a NaN enemy position was found, so **no guard was added**;
`enemyMarker`'s doc comment carries the same derivation.

*The melee clause admits the population where the bearing can be degenerate.* Not a defect, but it
follows from the clause and nothing else says so: a soldier within `strikeRange` horizontally is
exactly a soldier that may have almost no horizontal offset, which is where `bearingFromCamera`'s
`sourceDistance < 1e-6` guard returns 0. A spear directly underfoot therefore gets a chevron
pointing dead ahead. That is unavoidable rather than wrong — a soldier with no horizontal offset has
no horizontal direction to report — and in that case the chevron reports presence rather than
direction, which is still more than the player had before. At the 2 units of `enemy.test.ts`'s
overhead-thrust case the bearing is real.

*The ring can be clipped by the viewport.* The ring's origin is the reticle position whenever the
aim point is inside `[0, 1]` on both axes — inclusive — and the chevrons orbit 84–104 px out from
it. So in the glider a steep pitch can put the aim point near the top edge of the window with the
upper chevrons cut off, and the marker for a soldier behind and above the player is exactly the one
that goes missing. This is pre-existing for the hit wedges at 54–74 px and 30 px worse for the
chevrons. Not fixed: the obvious remedies (insetting the origin, or shrinking the radius when the
origin is near an edge) both move the ring away from the reticle it is meant to read as part of,
which is a trade nobody can judge without having played it.

**The wind-up flare was gated by the fade-in, which made the alarm quietest where it mattered
most.** The view wrote `strength` straight into the mark's `opacity` and the winding tint onto its
child, so a soldier that had only just crossed the frame edge flared at roughly 10% opacity — while
the guide promises the player that the flare "is the moment to move", and the moment a wind-up
starts just off the edge is the most actionable one there is, since the player is one small turn
from seeing it. Two independent channels were being multiplied: `strength` answers "how far off
screen", `winding` answers "how urgent", and only the first is a distance readout that ought to
fade. A winding mark now gets an opacity floor, `WINDING_OPACITY_FLOOR` 0.6, so presence fades and
urgency does not.

**What is a guess, and what cannot be exercised here at all.** `OFF_SCREEN_RAMP` 0.25, the 84–104 px
radius the chevrons orbit at, `WINDING_OPACITY_FLOOR` 0.6 and `WINDING_COLOUR`'s hotter red are all
argued guesses; nobody has played any of this. And this cycle's entire subject is a screen-space overlay that only exists while
the player is turning with something off screen — the harness cannot hold a pointer lock, so none of
it can be watched here at all, the same limitation this document has recorded against the reticle and
the hit wedges above.

## What has NOT been built

From the design document, in rough order of how much is missing:

- **The rest of §4 combat.** The three borrowed elements (water, earth, fire) with their
  radial switch. Four of the six enemy types in the enemy contract — spear and archer now
  exist, and this cycle makes each remaining type an addition to a working pattern rather
  than a rewrite of it, which is most of its value beyond the fight itself. Aerial combat
  as a distinct posture.

  *(This bullet previously listed Air Wall here too and called it blocked, because its
  function is deflecting a projectile at an angle to return fire and nothing in the game
  shot yet. Something shoots now. Air Wall is unblocked and is a natural next cycle.)*
- **§4.5's elemental Focus sink.** Focus and the Avatar State exist, but the document
  also has Focus spend on elemental heavy moves, and those are unbuilt. One of its listed
  build sources, damage avoided at close range, still needs a near-miss test.

  *(This bullet previously said the other missing build source, redirected projectiles,
  needed archers. Archers exist now; what redirected projectiles actually needs is Air
  Wall's deflection, which is unblocked for the same reason the bullet above is — both are
  the natural next cycle.)*
- **§4.6's second half.** Non-lethality scoring now pays a knockdown more than an
  environmental accident (see "Section 4.6's first half" above), but the rest of the
  section is still open: a small number of scripted moments that let the player break
  non-lethality on purpose, with Focus generation degrading for the rest of the
  encounter as the cost. That needs an act structure this game does not have yet, and
  only one accident type — the world floor — exists to be scored in the first place;
  water, a crushing prop, or one soldier's blast downing another are all still
  unbuilt.

  *(This bullet previously said enemies have no fall physics and that every down is
  already a gust. That was wrong even before this cycle started reading it: enemies
  gained gravity in the Vortex/Slipstream work, and `stepEnemy` already downs one that
  passes `worldFloorY`. Recorded here per this document's own convention — state what
  was wrong and why, not just the fix.)*
- **Story-locking the Avatar State.** §4.5 says it is story-locked early on; there is no
  act structure yet, so it is available from the start.
- **§3.3 region archetypes and §3.1 strata.** One archipelago exists; the six
  regions and the three-layer vertical structure do not.
- **§5 progression.** No acts, no unlock gating.
- **§2.4 payload.** No companions to carry.
- **Wall-riding** from §2.1. Previously blocked on a real limitation — see below — that
  the terrain collision cycle removed. `TerrainQuery` can now cast a lateral ray and
  collision now reports the normal it hit, both of which wall-riding needs; nothing has
  used either for that move yet.
- **The rest of the settings panel.** Five settings exist (see "Settings and accessibility"),
  and four things were deliberately left out of that cycle rather than forgotten. Key
  rebinding is a real feature with its own storage shape, conflict detection and display
  problems — and `InputTracker` reads `event.code`, so the physical WASD positions already
  work on AZERTY and Dvorak, which is the part that matters most. Gamepad support is
  genuinely separate work. A FOV slider and quality settings are real gaps, but neither is
  accessibility, and quality settings want a performance pass first to have numbers to aim
  at. Separate music and SFX sliders make no sense while there is no music.

  *(A fifth item belongs on this list and was missing from it: the accessibility of the
  accessibility panel. The keyboard path is operable — see the end of "Settings and
  accessibility" for what was fixed and how it was established — but there is still no focus
  treatment of the panel's own, no ARIA anywhere in the codebase beyond the implicit labelling
  each row's `<label>` gives its control, nothing announced when a setting changes, and no
  screen reader or real key press has ever touched any of it. That is the honest state, not a
  deliberate exclusion.)*
- **Standing the player back up.** A hole inherited from an earlier cycle and never part of
  any cycle's work since. (This bullet used to open "a pre-existing hole this cycle's
  playtesting exposed", which has travelled unchanged through several cycles and now reads as
  a claim that somebody played the game here. Nobody has. It was found by reading
  `stepHealth`, not by playing.) Once the player's own health reaches 0, it stays at 0
  for the rest of the session. `stepHealth` in `src/combat/health.ts` deliberately never
  regenerates off the floor, with a comment deferring the decision to "a system above
  this one" — and no such system exists in `main.ts`. `respawn` and `safeRespawn` in
  `src/player/controller.ts` already handle the fall-out-of-world case and are probably
  what to reuse for it.

## Blockers and constraints worth knowing before you start

**Wall-riding no longer needs a terrain API change — that part shipped.** This used to
say `TerrainQuery` exposed only `groundHeightAt` and `raycastDown`, both straight down,
so there was no way to detect a wall to ride at all. The terrain collision cycle gave
`TerrainQuery` a general `raycast(from, direction, maxDistance)` and built
`src/world/collision.ts` on top of it, so a lateral cast against island geometry and a
hit normal to ride along are both available now. What's still missing is the move
itself — reading that normal into a riding state, with its own tuning for how long a
ride lasts and what breaks it — which nothing in `src/player/` does yet.

**Nothing in the movement or combat systems has been playtested.** Every tuning value
is a considered guess, verified by unit tests and isolated renders but never by a
human playing the game. The most suspect are `hoverDamping`, `weightShiftTurnRate`,
`baseTurnRate` (dropped from 2.2 to 0.9, which materially changed how the mouse
feels), `groundResponse`, `dashSpeed`, the scooter accumulator rates, `scooterTurnFactor`
and `scooterChargeTurnPenalty` (newly worth judging in play now that the feel batch made
them drive a mechanism that actually turns the player, rather than one that measured
identically at every charge), every wind strength, every value in `src/focus/config.ts`, the
pressureWave block in `src/combat/config.ts`, and every lifetime, opacity and tint in
`src/fx/`. Treat them as a starting point. Of that last block, the damage cliff — where the
slam starts downing a soldier in one hit, around 30.6 m/s of descent — is the value most
worth feeling out by hand.

Focus is the one exception, and only partly. Its build-arm-trigger-end cycle was
exercised in the running game (see the visibility note below): a clean glide fills the
bar in about 28 seconds, the arming pip appears at maximum, `E` engages free breath and
the vignette on the trigger frame, the state runs its eight seconds, and falling out of
the world costs about half the bar exactly once. The boosted one-hit gust has since landed
on a soldier in the running game too, via the aiming-and-stall-readability cycle's
verification pass: with the Avatar State active, a single gust downed a spear soldier
outright, matching `0.5 × gustDamageMultiplier(3) = 1.5` against its full health. What has
*still* not been observed in play is the wind-feature multiplier. Nobody has played any of
it with a mouse in their hand — every observation of the Avatar State to date, including
this one, comes from the synthetic-clock harness described under "Repo-specific traps"
below, not from a human playing.

**Combat has never had a hit landed by hand.** The patrol, the gust knockback and the
downed state are unit-tested. Nobody has played it.

## Repo-specific traps

Each of these cost real time to find. They are all still live.

**Asset URLs must go through `import.meta.env.BASE_URL`.** `vite.config.ts` sets
`base: '/airbender-skies/'` for GitHub Pages. A hardcoded `/models/foo.glb` resolves
fine under `npm run dev` and 404s only on the deployed site.

**Forward is `+Z`, not `-Z`.** `main.ts` calls `avatar.object.lookAt(...)` on a plain
`Group`, and `Object3D.lookAt` aligns local `+Z`. Only `Camera` and `Light` use `-Z`.

**Never scale `avatar.object`.** The glider is a direct child of it, so scaling the
root scales the glider too. The model lives in a `modelRoot` wrapper inside
`avatar.ts` that absorbs all fitting and squash transforms.

**A `ShaderMaterial` must not include the `..._pars_fragment` chunks.** The renderer
already injects those declarations. Including them too fails the compile with a wall
of redefinition errors, and the failure is nearly silent — the mesh simply does not
draw and whatever is behind it shows through, which can look like success. Include
only the applying chunks (`<tonemapping_fragment>`, `<colorspace_fragment>`).

**`PointsMaterial` draws screen-facing squares.** Anything approaching a couple of
world units reads as a white block as soon as the camera gets near it. Wind motes are
0.45–0.75 for that reason.

**`groundHeightAt` returns the topmost surface, and single islands have real overhangs.**
`config.ts` already warns that the spire is stacked over the `+X+Z` quadrant past radius 56, so
a probe there answers with a surface hundreds of units up. The subtler case is that one island's
own noise-perturbed dome overhangs itself: on `home`, 2.4 m inward from `archer-2` at
`(17.182, −49.638)` there are two `home` surfaces 1.81 m apart, and the height query answers with
the lip rather than the shelf under it. That is faithful to the game — `groundStep` snaps the
player to the same topmost surface — but it means a real-geometry measurement can jump by nearly
two metres between adjacent sample points, and reading such a discontinuity as a bug wastes time.
`reach-geometry.test.ts` asserts that pair of surfaces so it is a recorded fact rather than a
surprise. Cast a second ray from just under a hit to find out whether you are on a lip.

**Typecheck is two passes.** `npm run typecheck` runs `tsconfig.json` and
`tsconfig.test.json`. App code deliberately cannot see Node globals; only tests can.
`noUncheckedIndexedAccess` is on, so indexed access is `T | undefined`.

**The preview pane's animation loop "stalls" because the tab is hidden.** This was
previously recorded here as a mysterious stall. It is not mysterious: the preview pane
reports `document.visibilityState === 'hidden'`, and browsers suspend
`requestAnimationFrame` in hidden tabs. The game is fine; it simply is not being asked
to draw. Taking a screenshot forces a single frame, which is why values appear to
advance one step at a time and then freeze.

The workaround that actually enables sustained in-game verification is to drive the
game's own loop with a synthetic clock. Capture the callback the loop hands to
`requestAnimationFrame`, then call it yourself with a stepped timestamp:

```js
window.__cb = null
window.requestAnimationFrame = (cb) => { window.__cb = cb; return 1 }
// take one screenshot so the pending real frame fires and registers through the hook
let t = performance.now()
const drive = (frames) => { for (let i = 0; i < frames; i++) { const cb = window.__cb; window.__cb = null; t += 1000 / 60; cb(t) } }
```

Dispatch `KeyboardEvent`s on `window` for input. This runs thousands of frames in a
moment and is how the Focus cycle above was verified. Reload the page afterwards to
discard the patch. Two things to watch: `const` declarations persist between evaluations
in one page context, so name-collision errors mean the page has *not* reloaded; and
reading the DOM immediately after a reload gives you the pre-first-frame markup, whose
meter fills all read as full because their `width: 100%` has not yet been overwritten by
a `scaleX` transform.

## Testing discipline this codebase expects

The suite is large and the comments carry the reasoning, so match the local style:
explain *why* in the comment, mark regression guards as such, and derive expectations
from data rather than restating literals.

Five specific test failure modes bit repeatedly here. Every one produced a green suite
that proved nothing:

1. **Asserting against the same config the code reads.** `expect(bursts).toBe(G.maxDashChain)`
   passes for any chain length. Assert the intended literal instead.
2. **Tautologies.** `expect(velocity.y).toBeCloseTo(incoming + deployKick)` passes when
   the kick is zero, because both sides collapse together.
3. **Bare `>` comparisons.** These pass on a fraction of a percent. If the claim is
   "materially faster", assert a margin.
4. **Assertions that hold either way.** A height assertion for "the placeholder was
   removed" passed whether or not it was removed, because the replacement is the same
   height.
5. **A fixture default that already equals the expectation.** `expect(j.airJumpsUsed).toBe(0)`
   started from a fixture whose `airJumpsUsed` is 0, so it passed whether the code carried the
   value forward or overwrote it with a literal 0. This one is not about the assertion's form at
   all — the expected value is correct and the comparison is exact. The starting state is what
   makes it unfalsifiable. Start from a value the right implementation must preserve and the
   wrong one must destroy.

The habit that caught all of them: after writing a test, **neutralise the feature in
config and confirm the test goes red.** If it stays green, the test is decorative.

And the broader lesson from this session: a check written by the same reasoning that
produced the claim will happily confirm it. Verify with a different method than the one
that made the assertion — measure geometry instead of reading a screenshot, read the
committed file instead of trusting a console log, grep case-insensitively instead of
trusting your own earlier grep.

**The terrain collision cycle found five more assertions with exactly this failure mode,
all in one plan.** The shape repeated twice: asserting a mechanism's side effect instead
of its goal, or picking a threshold loose enough that both outcomes cleared it. A
zero-direction guard and a direction-normalisation step each had a red-proof that passed
whether the guard or the normalisation was there or not. A "keeps sliding rather than
stopping dead" test asserted `z > 0.5`, which cannot tell a slid result (~6.76) from a
stopped-dead one (exactly 5) — both clear that bar. A "stays grounded while sliding along
it" test checked only `grounded` and `position.y`, neither of which a wall touches, so it
passed on open ground with no wall involved at all. The worst was a
walker-into-a-hillside integration test asserting `position.y > worldFloorY` to prove the
player doesn't fall through an island — except `controllerStep` respawns a player who
falls that far and hands back a position above ground on the very same call, so the
assertion stays green through exactly the bug it was written to name. Every one of the
five was first spotted by someone actually reading the committed test and asking what it
could and couldn't distinguish, not by trusting the plan's own justification for why it
would work — and every fix was then confirmed by running the neutralisation and watching
the suite actually redden, rather than by re-reading the new assertion and judging it
plausible.

**The dodge-costs-breath cycle's review turned up a seventh assertion of that exact shape.**
`slipstream.test.ts`'s `'in the glider, banking dodges sideways rather than along the heading'`
passed against both the fixed code and the pre-fix buggy branch, because for the heading it
exercised, the old flattened fallback and the corrected `gliderRight(forward, 0)` happen to
return the identical `(0, 0, 1)` — dot zero and unit length against that heading, both true
either way. Same failure as the terrain collision cycle's five above it: a relationship that
both the correct and the broken implementation satisfy. The fix, as always, was reading what the
test could actually distinguish rather than trusting that a green run meant the claim was true.

**The feel batch produced a new failure shape, sitting beside the eight unfalsifiable
assertions the previous two cycles recorded above rather than adding a ninth: three
quantitative claims were asserted from reasoning instead of measured, and each reached
committed code as an unasserted comment before being caught.** The scooter's turn times were
first recorded as 0.767 s and 1.633 s — both wrong; the real, measured figures are 0.8833 s
(53/60 exactly) and 1.75 s (exact). The wrong numbers survived a review round because nothing
asserted them: they were prose in a comment above code whose actual behaviour nobody had
re-derived. Separately, a comment claimed a riding dash travels further than the trail drawn
for it "by less than a frame's worth of movement" — the real gap is 10x and 25x over that
budget at the scooter's two charge levels, because authority scales `groundResponse`, the
*rate*, not the impulse, and the reasoning behind the comment had scaled the wrong one. And a
third comment called the FOV kick's new decay rate "the same quantity expressed directly" as
the dash's own decay — it is not: `stepPulse` decays linearly while the dash decays
exponentially, so the same-looking substitution would have shortened the kick's lifetime by
35%. None of the three were disguised tautologies of the kind this section is usually about;
the common thread is that a number reached by reasoning was handed onward as fact without
ever being checked against the thing it described. The countermeasure now in the code: every
measured figure in this cycle carries an assertion, not a comment — the two pinned turn times
in `ground-move.test.ts`, and the three pinned displacements in `dash-trail.test.ts`. A wrong
number in a comment can survive indefinitely; a wrong number in an assertion fails the very
next run.

**Wind on foot produced the ninth assertion that could not fail across four cycles — and it
was the one guarding the constraint this project had made mandatory: leave the glider's own
wind sample exactly where it is.** The glider pin's original fixture made `steerToward` a
no-op twice over — the sampler was constant in both of its arguments, and `lookDirection`
already equalled `forward`, so there was no heading left to turn toward. A reviewer proved the
gap by committing the forbidden change itself — moving the glider's wind sample from after
`steerToward` to before it — and watching the entire suite, pin included, stay green. The
replacement fixture uses a heading-sensitive sampler and a trimmed glide, and it reddens the
same violation with roughly an 18× margin.

The transferable lesson: **a test that pins behaviour is only as good as the fixture's ability
to distinguish the two implementations it is meant to tell apart.** All eight assertions
recorded above this one were a relationship or a value that both the correct and the broken
version satisfied; this one shows that the fixture, not the assertion's shape, can be what
makes that true. The countermeasure is the one this section has been circling all along, stated
plainly here for the first time: red-proof a pin by *making the forbidden change* and watching
the suite react, not by reasoning about whether the fixture would catch it.

**The pause and front-door cycle added three more — the tenth, eleventh and twelfth — all
three in `src/core/pause.test.ts`, the only new test file it produced.** Every one was a
point in a small, fully enumerable parameter space that no assertion actually pinned, and
every one was found by making the mutation and watching the suite, not by reading the
assertions and judging them adequate.

| The gap | The mutation that survived | What caught it in the end |
| --- | --- | --- |
| `pauseOverlayModel('guide', false)` was never called anywhere in the file | suppressing the card for the guide only when `everStarted` — `reason === 'guide' && everStarted` in place of `reason === 'guide'` | a table over all 8 `(reason, everStarted)` points, added during the task-1 review round |
| `pauseReason` had no exact-reason assertion at `pointerLocked: true, documentHidden: true, guideOpen: false` | returning `'unlocked'` instead of `'hidden'` on the branch where the lock is still held | `'reports the reason this table names for every combination'`, which pins all eight combinations as one object comparison |
| `OverlayModel.hint` was unasserted at all four points where the card is invisible | `HIDDEN.hint = 'H — guide'`, i.e. a non-empty hint on the invisible path | the same 8-point table, extended from three fields to all four and compared as whole objects |

Two things generalise from them. First, the register below is now unanimous: **twenty-one for
twenty-one, the gap was found by making the forbidden change, and none of the twenty-one by
reading the assertion and reasoning about what it covered.** That is no longer a lesson from one
cycle; it is the only method that has ever worked here. (The count read "fifteen for fifteen"
until the aim-and-hit-direction cycle added four; the count read "nineteen for nineteen" until
the off-screen enemy indicators cycle added two, both recorded at the end of this section.)

Second, and new: **a test's name can be what hides the gap.** The eleventh sat behind
`'names a reason for every combination with any pausing cause'`, which sounds exactly like
the test that pins the reasons and in fact pinned only that each reason was non-null — and
a reviewer scanning the file for "is the precedence covered?" would read that name and stop
looking. It was also non-discriminating in its own right: it and the null-point test above it
both pinned the same single no-cause combination, so no mutation could redden one without the
other. It has been replaced by the exhaustive expected-reason table, whose name says what it
does. When a test's name overstates its assertions, the name is a defect, not a nicety.

**The correction pass that closed this cycle added nothing to the count, then twelve, and that
is the point: its findings were the feel batch's shape, not this register's.** Three claims
about the front-door frame reached committed prose without ever being measured — that the
unposed character stood in the GLB's rest pose (it stood in `buildGlideClip`'s leftover
composed sample, arms at head height), that the pose it landed in was airborne (it is `idle`,
and correctly so), and that `poseNow`'s single tick lands the pose "whole" at the clip's start
(it lands the clip at t = FADE_SECONDS, at one float ulp short of full weight). All three came
from reading a screenshot and from reasoning about what the mixer *ought* to do; all three
were corrected by measuring bone positions over the real GLB and by reading three's own
`AnimationAction._update`. The register's own standing advice named the method that found
them: verify with something other than the reasoning that produced the claim.

The fourth finding is the one that belongs to the rule the feel batch left behind. `poseNow`'s
whole reason for existing — that it leaves the action at effectively full weight where
`setAnimation` plus `avatar.update(0)` leaves it at 0 — was asserted nowhere, and the report
that shipped it argued a test was impossible because it would only exercise a mock. That was
false on the file's own evidence: `avatar.test.ts` already ran a real `AnimationMixer` over a
fake GLTF, and already parsed `public/models/character.glb` in node to assert measured knee
angles. `'createAvatar poseNow'` now pins the claim, red-proofed the mandatory way by ticking
`0` instead of `FADE_SECONDS` and watching both of its tests fail. **"A test here would only
test a mock" is a claim about the harness, and this file's harness is the thing to check
before making it.**

**Jump forgiveness produced the thirteenth and fourteenth, one during implementation and one
found by the final review's mutation run.** Both are in the table below, and the fourteenth is the
new shape recorded as item 5 of the list above — the first entry in this register whose defect is
the fixture's *starting value* rather than the assertion's form or the fixture's ability to
distinguish two implementations.

| The gap | The mutation that survived | What caught it in the end |
| --- | --- | --- |
| Every test that could catch a third jump started from a fixture whose `coyoteTime` is 0, the one state in which the bug cannot appear | dropping the `jump.jumped ? 0 :` guard from `groundStep`'s `coyoteTime`, so a ground jump leaves the window open and every jump is a double jump for six frames | `'does not grant a third jump'` and `'a normal ground jump zeroes the window on the frame it fires'`, both rewritten to start from a state that has actually stood on the ground for a frame, the second asserting the full window before the jump |
| `jump.test.ts`'s `'costs no air jump'` asserted `toBe(0)` from a fixture whose `airJumpsUsed` is 0 | setting the jump-buffer branch to `airJumpsUsed: 0` instead of carrying `state.airJumpsUsed` forward | the same test, started from `airJumpsUsed: G.maxAirJumps` — the only state a buffer can be armed in, since arming requires the reserve to be spent |

The second one is a test defect only: `groundStep` resets `airJumpsUsed` on any grounded frame, so
in production the branch cannot be caught doing it. That is worth saying rather than glossing,
because it is the reason the mutation is harmless and the reason it survived — nothing downstream
of the branch depends on the value it got wrong.

**The same review run found something else that is not this register's shape and deserves its own
name: a case that was never written at all.** Making the air-jump branch win over the coyote
branch — a plain reordering of `stepJump`'s airborne branches — left all 1439 tests green. Not
because an assertion was weak, but because every shipped coyote test pressed on the last
*grounded* frame, so the coyote branch only ever saw the release. A press made one to six frames
*after* the edge with an air jump still in hand — the actual coyote case, the thing the feature is
named for — was exercised nowhere. It hid behind the tuning: `jumpSpeed` and `airJumpSpeed` are
both 9, so the two outcomes are identical in velocity and only `airJumpsUsed` separates them. Two
tests now cover it, a `stepJump` unit and a multi-frame `groundStep` run off a real ledge, and both
redden under the reordering. The lesson is not about assertions: **when a feature's headline case
and its edge cases are tested by the same fixture shape, check that the headline case is one of
them.** Every coyote test in the file looked like a different timing of the same input, and none
of them was the input the window exists for.

**The vertical-reach cycle produced the fifteenth, and it is the register's first arithmetic
error rather than a weak assertion or a blind fixture.** `pressure-wave.test.ts`'s
`'measures reach as a disc rather than a sphere, so the radius does not shrink with height'` did
not measure that at all: it admitted a sphere. A reviewer substituted a pure 3D-distance filter
for `waveTargets` and the test stayed green.

| The gap | The mutation that survived | What caught it in the end |
| --- | --- | --- |
| The disc-not-sphere probe sat *inside* a sphere of the same radius, so it could not tell a disc from a sphere | replacing `waveTargets`' horizontal-distance-plus-band test with a single 3D distance test | the same test, with the discriminating property `hypot(out, verticalReach) > radius` asserted rather than worked out in a comment, and the offset derived from the fixture's own radius |

The arithmetic is worth spelling out, because the mistake is easy and invisible. The probe was
placed at a horizontal offset of 11 with a vertical offset of `verticalReach` 4, against the
*fixture's* `maxRadius` of 12. `hypot(11, 4)` is 11.7047, which is inside 12 — so a 3D-distance
implementation accepts the point and the assertion holds either way. Discriminating at a height
of 4 needs a horizontal offset above `sqrt(12² − 4²)` = 11.3137. The 11 came from the *shipped*
`maxRadius` of 11 while the fixture the test actually ran used 12: a literal borrowed from one
config and evaluated against another, inside a comment that nothing checked. Two lessons, one old
and one new. The old one is that a number reasoned out in a comment is a number nobody has
verified — the same failure the feel batch recorded. The new one is that **a geometric claim
resting on a relationship between three numbers should assert that relationship, not the
conclusion drawn from it**; the fix asserts `hypot(out, verticalReach) > radius` as a
precondition of the test's own body, so an offset that stops discriminating fails loudly instead
of quietly passing.

The fifteenth is also a second example of the naming lesson above: its name said "disc rather
than a sphere", and it was the one test in the file that could not tell those two apart.

**The same cycle surfaced a rule collision that reached the spec but never this register, and it
belongs here rather than in the table because it is a defect in advice rather than in a test.** A
plan for the vertical-extent boundary tests said to place each boundary probe "at a height
derived from the shape rather than a literal, so the boundary moves with the value". That
instruction is self-defeating: a probe derived from the value under test *rises with it*, so
raising the extent moves the probe too and the assertion survives the very change it exists to
catch. Three of the five neutralisations would have passed.

What makes it worth recording is that it is a head-on collision between two rules this project
already holds and states plainly in this same section: **"derive expectations from data rather
than restating literals"** and **"neutralise the config and watch it redden."** For almost every
test the two agree. For a *boundary* test they point in opposite directions, and the derived form
is the non-discriminating one — the boundary *is* the value, so deriving the probe from the value
turns the test into a tautology about the shape rather than a claim about the number. The
resolution used here: keep the derived probe as the shape assertion, and add a separate
**relative** claim about the shipped number that a neutralisation must break — the staff's band
against its own horizontal reach, the vortex's band against the gust's and against its own
`maxRadius`, the wave's against its own `minRadius`. Those are what actually redden.

The general form, for the next boundary test anyone writes: **a probe derived from the value
under test proves the shape and can never pin the value. Pinning the value needs a second
assertion relating it to something that does not move with it.**

Worth recording alongside the ninth: the wind-on-foot cycle had four of my own quantitative
or causal claims corrected by measurement rather than caught by the person who made them — the "ramps in over
the response time" claim about where the horizontal wind term was placed, the scooter-authority
justification for that same placement, the `liftScale` neutralisation's literal-but-vacuous
reading, and the glider fixture above. Each was caught by someone re-deriving the number rather
than trusting the reasoning that produced it.

**The aim-and-hit-direction cycle added four: the sixteenth and seventeenth during its own
review, and the eighteenth and nineteenth in the fix wave that closed it.** All four were found
by making the mutation and watching the suite, which is what keeps the count unanimous.

| The gap | The mutation that survived | What caught it in the end |
| --- | --- | --- |
| `reticle.test.ts`'s NDC fixture was `(0.5, 0.5)` — off both axes as the plan required, but with `x === y` | swapping the two axes while keeping the y flip: `x: (ndc.y + 1) / 2, y: (1 - ndc.x) / 2`, which maps that fixture to itself | the same test with the fixture at `(0.5, -0.25)`, so the swap and the missing flip each produce a different pair of fractions |
| No test in `hit-direction.test.ts` used a source with **both** a vertical and a horizontal offset, so "computed horizontally" was never exercised as a claim | a signed-3D bearing — the real 3D angle with a horizontal sign patched in — which is 76.37° where the flattened answer is 45.00° at a source of `(5, 20, -5)` | `'drops the vertical component entirely, agreeing with the purely-horizontal answer'`, which asserts the elevated and level sources give the same bearing |
| Every fixture in `hit-direction.test.ts` used a camera forward of world `-Z`, which is also three.js's default camera heading | ignoring the `cameraForward` parameter outright and hardcoding `(0, 0, -1)` — in both `bearingFromCamera` and, separately, in `markFor` | two tests: one absolute, against a camera looking along world `+X`; one invariance, that yawing the camera and the source together leaves the bearing alone. Plus a `markFor` case with a non-default forward, since its own test compared it against `bearingFromCamera` called with the same fixture |
| `bearingFromCamera`'s camera-forward degeneracy guard asserted only that the result was finite, while the source-distance guard beside it asserted the value | returning `Math.PI` — dead *behind* — from the guard the module documents as returning dead ahead | the same test, renamed to say what it pins and asserting `toBeCloseTo(0)` |

**The sixteenth is a shape this register had not recorded, and it is the most uncomfortable one
in the list: a fixture that satisfies the letter of a test-design instruction while defeating its
purpose.** The plan asked, in as many words, that "a swapped **or** unflipped axis is visible",
and specified a point off both axes to make it so. `(0.5, 0.5)` is genuinely off both axes. It is
also invisible to the swap, because the swap composed with the flip maps that particular point to
itself — so the instruction was satisfied and its purpose was not, and a reviewer checking the
plan against the fixture would tick it off. The countermeasure is not a better instruction: it is
that **an instruction about what a fixture must distinguish is satisfied by running the mutation,
never by inspecting the fixture against the wording.** The wording cannot enumerate the
coincidences.

The eighteenth generalises further than the other three, and it is worth stating on its own:
**when a parameter's every fixture equals the value a caller would default to, no test in the
file can tell whether the parameter is read at all.** World `-Z` is both the natural constant to
write in a test and three.js's own camera heading, so all eight tests in `bearingFromCamera`'s
own describe block — one of which builds a real `PerspectiveCamera` specifically to check the
basis convention against something other than a hand-picked axis, and so looks along `-Z` too —
agreed with an implementation that discarded the argument, as did `markFor`'s single test. In
production `main.ts` passes `lookDirection`, which is world `-Z` only at yaw 0, so
that mutant would have rotated every wedge by the player's own yaw and produced a world-relative
indicator where the entire feature is screen-relative: the same class of harm as the mirrored
left and right the signed assertions were written to prevent, arriving through the one axis
nobody had varied.

The nineteenth is a test defect rather than a live one — `input.ts` clamps pitch to 85 degrees,
whose horizontal magnitude is 0.0872 against the guard's 1e-6 threshold, so nothing in the game
reaches that branch. It is in the register because of how it hid: its sibling guard, four lines
above it in the same function, *was* pinned to a value, and the pair read as covered.

**The off-screen enemy indicators cycle added the twentieth and twenty-first, and both are new
shapes: an assertion made unfalsifiable by something other than a weak claim or a symmetric
fixture.** This register exists because this exact failure mode has shipped repeatedly, and both
entries below are a different mechanism from all nineteen before them.

**The twentieth: unfalsifiable by saturating arithmetic.** A test used
`{ x: 0.3, y: Infinity, z: 0.5 }` to prove `offScreenPresence` checks `ndc.y` for finiteness. It
cannot. `Math.abs(Infinity) - 1` is `Infinity`, which wins the `Math.max`, and
`Math.min(Infinity / 0.25, 1)` is `1` — exactly what the guard would have returned. Deleting the
`Number.isFinite(ndc.y)` clause left every test in the file green. The equivalent `NaN` fixture
*does* catch it, because `NaN` poisons the same expressions to `NaN`. Same expression, same
intent, opposite observability, decided entirely by which non-finite value the fixture picked.
Fixed by adding a `y: NaN` assertion and keeping the `Infinity` one with a comment saying plainly
that it pins a value rather than covering the guard. Verified by mutation: dropping the clause
reddens the `NaN` line with "expected NaN to be 1", and does not redden the `Infinity` line.

**The twenty-first: unfalsifiable by a language guarantee.** Two tests asserted that `percent` and
`radians` "flatten a tiny float instead of writing it in exponent notation". But
`Number.prototype.toFixed` never emits exponential notation below 1e21 — that is JavaScript's
promise, not the code's. Any implementation satisfying the sibling assertions in the same block
satisfies these for free. The one mutant that might have rescued them, `toPrecision(5)`, renders
100 as `"100.00"` and is already caught by `percent(1)`. So the test verified the runtime rather
than the helper. Fixed by asserting both the hazard and the behaviour, with the comment naming
which half can fail.

**A false string, inside the comment documenting that very hazard.** It claimed
`${1.2e-16 * 100}%` is `"1.2e-14%"`. It is `"1.2000000000000001e-14%"`.

## Suggested next steps

In the order I would take them:

1. **Play it.** Nothing here has been played. An hour with the live build will find
   more than the next feature will add, and will tell you which of the tuning values
   above are wrong. **The five vertical extents are the most recent and the most in need
   of hands** — try to gust a soldier from a ledge, and try to staff `archer-2` on its
   shelf. All five are staying as shipped; the owner's decision is recorded under "Vertical
   reach" above, taken against re-measured figures, and the thing it is waiting on is a
   person who has played it rather than another measurement. Note that both sides of the
   `pressureWave.verticalReach` crossing are pinned by tests, so whichever way it goes
   something reddens and has to be argued rather than nudged. Two specific things to feel
   for: whether a slam that lands on the lip above `archer-2` failing to reach it reads as a
   miss or as a bug, and whether a target lifted by a full-charge vortex being out of the
   staff's band for 58% of its airtime reads as the vortex doing its job or as the staff
   feeling broken.

   **The reticle and the hit-direction indicator are the other thing that needs hands, and
   they need them more completely than most.** Neither has ever been seen in a running game:
   pointer lock cannot be held here, so the reticle has never been watched tracking a turn or
   checked against where a gust actually lands, and a wedge has never been watched fading
   while a fight was going on. Four things to feel for. Whether the reticle sits where the
   attack goes — if it reads as sitting short or long, the distance to change is
   `AIM_DISTANCE` in `main.ts`, currently the gust's range. Whether it is legible against
   bright sky and pale grass, since it is a small pale dot and nothing has judged the
   contrast. Whether `HIT_MARK_SECONDS` 1.2 is long enough to turn toward and short enough
   that three archers do not leave a permanent ring. And whether the wedges at a 54–74 px
   radius crowd the reticle they are drawn around. All four are argued guesses.

   A fifth thing is cheaper to check and is a claim rather than a guess: go down in a fight
   and confirm nothing from either overlay survives the beat. Both views are hidden for the
   whole of it and `recover()` clears the marks, but that is read from the code — the down
   beat has never been watched with these two overlays on screen.
2. **Playtest the pause and front-door cycle specifically.** This is the one piece of
   "play it" that cannot be satisfied by any amount of testing in this environment,
   because the harness cannot hold a pointer lock. On a real click, confirm: Escape
   brings the "Paused" card up and stops the simulation; clicking the canvas again takes
   it down and resumes cleanly, with no banked input firing on the way back in; Chrome's
   post-Escape re-lock cooldown does not leave the game stuck showing "Click to resume"
   for a click that silently failed to re-lock; and switching away to another tab and
   back leaves both the wind and combat audio actually silent while backgrounded, not
   just paused visually.
3. **§4.6's non-lethality scoring is built now.** A knockdown pays `downGain: 14`; a
   soldier lost to a fall over the world floor pays `accidentDownGain: 5`, about a
   third. This item previously said the missing piece was giving enemies fall physics
   and "paying that removal more than an in-place knockdown" — both halves were wrong.
   Enemies already had fall physics from the Vortex/Slipstream work, and the design
   document lists a ledge fall among the *non-lethal* downs, so it is the accident that
   should pay less, not more, which is the opposite of what this line said. What is
   still open from §4.6: the scripted moments that let a player break non-lethality on
   purpose (needs an act structure that does not exist yet), and every accident type
   besides the world floor — water, a crushing prop, one soldier's blast downing
   another are all still unbuilt.
4. **Archers are built now.** They pressure altitude, which is the axis the whole flight
   model is about — see "Archers, and the axis that was missing" above for what changed
   and what is still just an unplayed guess. What they unblock is Air Wall and §4.5's
   redirected-projectile Focus source; both are natural candidates for whichever cycle
   comes after playing this one.
5. **Then either** the terrain API change that unblocks wall-riding, **or** a second
   region from §3.3 to prove the world structure generalises.

Sections of the design doc are the natural unit of work. Each one is roughly a
spec-plan-implement cycle, and combat in full is several.

## Shadows: the deprecation warning, and the soft-shadow attempt behind it

`src/core/renderer.ts` asked for `PCFSoftShadowMap` until three.js 0.185 deprecated it. From
that release on, the library logged a warning to the console and silently substituted the
harder `PCFShadowMap` — so the game rendered those shadows while the comment above the line
claimed soft ones. Nobody had opened the console. The line now names `PCFShadowMap`
explicitly, which is both the honest description and the end of the warning.

**The obvious next step was tried and it does not work here.** VSM is the surviving soft
option, and every value below was measured on the home island at the spawn view rather than
argued:

| `shadow.normalBias` | result |
| --- | --- |
| 0, 0.05, 0.1 | every slope banded with its own shadow, in wide concentric stripes |
| 0.2 | acne gone; shadows visibly washed out |
| 0.6 | acne gone; the character's shadow a faint featureless smudge |

There is no window between the two failures. Below roughly 0.2 the terrain shadows itself;
at and above it VSM's variance test bleeds enough light that the character's shadow — the one
shadow a player actually looks at — stops reading as a body carrying a staff. Tightening the
shadow camera from `1..640` to `100..510` to buy depth precision was tried in the same pass,
changed nothing measurable, and was reverted rather than left in as a risk to high casters.
VSM would also cost two separable blur passes over a 2048-square map every frame.

The premise was weaker than the warning made it sound, too: at 2048 texels over a 90-unit
`SHADOW_EXTENT`, from the distance the follow cam watches, PCF's tree and character shadows
already read as soft-edged **and** keep their silhouettes. The deprecation was a real defect in
what the file *claimed* and close to a non-issue in what the player saw.

If softer shadows are wanted later, the untried levers are a 4096 map (smaller texels, four
times the memory) or a smaller `SHADOW_EXTENT` (the same map over less ground, so shadows only
near the player). Not another pass at VSM. The attempt is preserved in commit `4c29901` on the
way to this one, so the configuration is recoverable without redoing the tuning.

**Two of the wrong turns are worth keeping**, because both were confident comments written
before anything was looked at. The first VSM commit stated that VSM needs no bias, on the
reasoning that it does not perform PCF's depth comparison and therefore cannot produce PCF's
acne; the first screenshot showed the whole island striped. Then, when contact shadows looked
detached from the character's feet, that was diagnosed as peter-panning from too much bias —
until the A/B against PCF showed the *same* offset, because the sun sits high and to the side
and the offset is simply geometric. Neither error was reachable by reading the code, and both
would have shipped as authoritative prose.
