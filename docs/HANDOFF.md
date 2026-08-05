# Handoff

Written 2026-07-31, updated 2026-08-04 for the enemy health bars, updated 2026-08-05
for the impact feel and encounter lifecycle work. This is a recap for whoever picks the
project up next, including a future session with no memory of the work below.

**Live:** https://danielnygaard00.github.io/airbender-skies/
**Repo state:** 1097 tests across 76 files,
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
connect, a slam connect, a down); never on a gust, because a 0.45s-cooldown move that hitches on
every use is nausea, not weight. `src/fx/config.ts` holds `DEFAULT_HITSTOP_CONFIG`:
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
not on a matching in-game number. **The five voices, the dash FOV kick, and the hurt flash were
not verified in the running game at all** — the in-game verification pass covered the freeze, the
shake, the staff spark, the patrol restore, and the accident-versus-down mechanism, and those
three were not among the items it checked.

**Every value in this cycle is a guess about feel, which no test can check** — same caveat this
document already carries for the movement and combat tuning below, extended to
`hitstop.*Seconds`, every `shake` amplitude and duration, `hurtFlash`'s decay rate,
`fovKickForDash`'s peak, `patrol.respawnRange`, and `accidentDownGain`. The deliverable is that
they are all visible and tunable in one place (`src/fx/config.ts`, `src/combat/config.ts`,
`src/focus/config.ts`), not that any of them are right.

## What has NOT been built

From the design document, in rough order of how much is missing:

- **The rest of §4 combat.** Air Wall, and the three borrowed elements (water, earth, fire)
  with their radial switch. Five of the six enemy types in the enemy contract. Aerial combat
  as a distinct posture. Air Wall is blocked rather than merely unbuilt: its function is
  deflecting projectiles at an angle to return fire, and nothing in the game shoots yet, so
  it needs archers first.
- **§4.5's elemental Focus sink.** Focus and the Avatar State exist, but the document
  also has Focus spend on elemental heavy moves, and those are unbuilt. Two of its listed
  build sources are also missing: redirected projectiles needs archers, and damage
  avoided at close range needs a near-miss test.
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
the world costs about half the bar exactly once. What has *not* been observed in play is
the wind-feature multiplier, and the boosted one-hit gust actually landing on a soldier.
Nobody has played any of it with a mouse in their hand.

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
3. **Add a second enemy type.** Archers pressure altitude, which is the axis the whole
   flight model is about, and they would make the existing hover and dodge meaningful.
4. **Then either** the terrain API change that unblocks wall-riding, **or** a second
   region from §3.3 to prove the world structure generalises.

Sections of the design doc are the natural unit of work. Each one is roughly a
spec-plan-implement cycle, and combat in full is several.
