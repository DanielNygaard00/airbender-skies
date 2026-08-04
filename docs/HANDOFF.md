# Handoff

Written 2026-07-31, updated 2026-08-04 for the enemy health bars. This is a recap
for whoever picks the project up next, including a future session with no memory of the
work below.

**Live:** https://danielnygaard00.github.io/airbender-skies/
**Repo state:** 942 tests across 67 files,
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

## What has NOT been built

From the design document, in rough order of how much is missing:

- **The rest of §4 combat.** Air Wall, staff melee combos, and the three borrowed elements
  (water, earth, fire) with their radial switch. Five of the six enemy types in the enemy
  contract. Aerial combat as a distinct posture. Air Wall is blocked rather than merely
  unbuilt: its function is deflecting projectiles at an angle to return fire, and nothing in
  the game shoots yet, so it needs archers first.
- **§4.5's elemental Focus sink.** Focus and the Avatar State exist, but the document
  also has Focus spend on elemental heavy moves, and those are unbuilt. Two of its listed
  build sources are also missing: redirected projectiles needs archers, and damage
  avoided at close range needs a near-miss test.
- **§4.6 non-lethality scoring.** Downing an enemy grants Focus, but nothing yet grants
  *more* for a non-lethal removal than for an environmental accident, because enemies
  have no fall physics — every down is already a gust. The distinction waits for enemies
  that can be blown off a ledge.
- **Story-locking the Avatar State.** §4.5 says it is story-locked early on; there is no
  act structure yet, so it is available from the start.
- **§3.3 region archetypes and §3.1 strata.** One archipelago exists; the six
  regions and the three-layer vertical structure do not.
- **§5 progression.** No acts, no unlock gating.
- **§2.4 payload.** No companions to carry.
- **Wall-riding** from §2.1. Blocked on a real limitation, not on effort: see below.

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
2. **Build §4.6's non-lethality scoring.** Downing an enemy already grants Focus, but
   nothing yet grants *more* for a non-lethal removal than for an environmental
   accident, because enemies have no fall physics — every down is already a gust.
   Pressure Wave's knockback is now strong enough to blow a soldier off a ledge, so the
   missing piece is giving enemies fall physics and paying that removal more than an
   in-place knockdown.
3. **Add a second enemy type.** Archers pressure altitude, which is the axis the whole
   flight model is about, and they would make the existing hover and dodge meaningful.
4. **Then either** the terrain API change that unblocks wall-riding, **or** a second
   region from §3.3 to prove the world structure generalises.

Sections of the design doc are the natural unit of work. Each one is roughly a
spec-plan-implement cycle, and combat in full is several.
