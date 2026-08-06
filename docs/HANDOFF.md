# Handoff

Written 2026-07-31, updated 2026-08-04 for the enemy health bars, updated 2026-08-05
for the impact feel and encounter lifecycle work, and again 2026-08-05 for the aim tell and
stall readability work, and again 2026-08-06 for archers and projectiles. This is a recap
for whoever picks the project up next, including a future session with no memory of the
work below.

**Live:** https://danielnygaard00.github.io/airbender-skies/
**Repo state:** 1200 tests across 81 files,
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
height the faster the player is already rising.

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
gust cone drawn at the move's *true* 12-unit, 120-degree hit volume, a dash streak whose
length and brightness read the chain index, impact bursts that distinguish a connect from
a down, and an Avatar State aura on the character. Every trigger reads a signal the game
already produced, so no movement or combat code changed. The cone's honesty is tested by
sampling points and comparing the drawn sector against `inGust` — a different mechanism
from the one the code uses. Spec at
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
honestly picturing a broken gust, which is the payoff of having drawn the true hit volume
rather than a tidy puff. On foot `forward` now follows the flattened look direction, and
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
  tell is built: an arc effect drawn at the swing's true reach (`src/fx/staff-arc-fx.ts`) plus
  a procedural sweep composed inside `glider.ts`'s own `apply()`, which rewrites the staff
  transform every frame and would overwrite anything set from outside.

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
here for exactly this reason. The only derived value left in `main.ts` is the dash kick's decay
rate, `1 / DEFAULT_GROUND_CONFIG.dashDurationSeconds`, which is not a tuning value at all — it
falls out of the dash's real duration, and that is where it should stay.

**The aim tell.** `src/fx/aim-tell.ts` gives the gust a preview instead of leaving its reach to
be learned by throwing it at people. A ground chevron sits `markerDistance` (3 units) along
`player.forward`, and a true 12-unit, 120-degree sector lights up — dimmed to 40% while the
gust is on cooldown, invisible otherwise — the instant a live soldier is inside it. Both are
parented to the scene, not to the avatar: the avatar's rotation is driven off the
*interpolated* heading so it renders smoothly between simulation steps, and a tell for a hit
volume has to read the value the hit itself reads, `player.forward`, or it can point somewhere
the gust does not go. Spec at
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
is now 66, clearing the archer's 48 by the same 1.3 margin the test enforces (48 × 1.3 = 62.4).
The fixed point is the archer's `aggroRange`, not `respawnRange`: 48 is what makes climbing stop
being a win condition, this cycle's whole point, so it does not move, and the hygiene value moves
around it instead. The cost is real — a patrol restore now needs the player 66 units from every
spawn point instead of 40, a longer walk, so respawns are rarer than they were.

**The violation was confirmed by playing it out, not only by comparing the two constants.** The
config-invariant test in `patrol.test.ts` asserts a relationship between numbers, which leaves
open whether the gap was ever reachable in a real frame. Two blocks in `encounter.test.ts` close
that. `the shipped patrol restores out of every soldier's notice range` sweeps the ground plane on
a one-unit grid, and for every position where `stepEncounter` actually restores the home patrol it
requires no restored soldier to be inside its own `aggroRange`, measured in 3D the way `stepEnemy`
measures a ranged soldier's. At the old `respawnRange` of 40 that sweep reports 1907 offending
positions, all of them `archer-2`; at 66 it reports none. The sweep replaces a hand-picked position
on purpose — a single coordinate is pinned to today's `HOME_PATROL` layout and would quietly stop
testing anything if the spawns or the ranges were retuned.

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
so an hour of play will move them a long way. The archer's `aggroRange` of 48 most of all: it is
the number that decides whether climbing still wins.

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
- **Wall-riding** from §2.1. Blocked on a real limitation, not on effort: see below.
- **Standing the player back up.** A pre-existing hole this cycle's playtesting exposed,
  not part of this cycle's work: once the player's own health reaches 0, it stays at 0
  for the rest of the session. `stepHealth` in `src/combat/health.ts` deliberately never
  regenerates off the floor, with a comment deferring the decision to "a system above
  this one" — and no such system exists in `main.ts`. `respawn` and `safeRespawn` in
  `src/player/controller.ts` already handle the fall-out-of-world case and are probably
  what to reuse for it.

## Blockers and constraints worth knowing before you start

**Wall-riding needs a terrain API change.** `TerrainQuery` in `src/core/types.ts`
exposes only `groundHeightAt` and `raycastDown`. There is no horizontal raycast, so
there is no way to detect a wall to ride. Adding one means lateral raycasting against
island geometry, which is its own piece of work.

**Nothing in the movement or combat systems has been playtested.** Every tuning value
is a considered guess, verified by unit tests and isolated renders but never by a
human playing the game. The most suspect are `hoverDamping`, `weightShiftTurnRate`,
`baseTurnRate` (dropped from 2.2 to 0.9, which materially changed how the mouse
feels), `groundResponse`, `dashSpeed`, the scooter accumulator rates, every wind
strength, every value in `src/focus/config.ts`, the pressureWave block in
`src/combat/config.ts`, and every lifetime, opacity and tint in `src/fx/`. Treat them as a starting point. Of that last block, the
damage cliff — where the slam starts downing a soldier in one hit, around 30.6 m/s of
descent — is the value most worth feeling out by hand.

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

Four specific test failure modes bit repeatedly here. Every one produced a green suite
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

The habit that caught all of them: after writing a test, **neutralise the feature in
config and confirm the test goes red.** If it stays green, the test is decorative.

And the broader lesson from this session: a check written by the same reasoning that
produced the claim will happily confirm it. Verify with a different method than the one
that made the assertion — measure geometry instead of reading a screenshot, read the
committed file instead of trusting a console log, grep case-insensitively instead of
trusting your own earlier grep.

## Suggested next steps

In the order I would take them:

1. **Play it.** Nothing here has been played. An hour with the live build will find
   more than the next feature will add, and will tell you which of the tuning values
   above are wrong.
2. **§4.6's non-lethality scoring is built now.** A knockdown pays `downGain: 14`; a
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
3. **Archers are built now.** They pressure altitude, which is the axis the whole flight
   model is about — see "Archers, and the axis that was missing" above for what changed
   and what is still just an unplayed guess. What they unblock is Air Wall and §4.5's
   redirected-projectile Focus source; both are natural candidates for whichever cycle
   comes after playing this one.
4. **Then either** the terrain API change that unblocks wall-riding, **or** a second
   region from §3.3 to prove the world structure generalises.

Sections of the design doc are the natural unit of work. Each one is roughly a
spec-plan-implement cycle, and combat in full is several.
