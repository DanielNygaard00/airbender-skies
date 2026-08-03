# Handoff

Written 2026-07-31, updated 2026-08-03 for Focus and the Avatar State. This is a recap
for whoever picks the project up next, including a future session with no memory of the
work below.

**Live:** https://danielnygaard00.github.io/airbender-skies/
**Repo state:** 674 tests across 47 files,
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

## What has NOT been built

From the design document, in rough order of how much is missing:

- **Most of §4 combat.** Vortex, Air Wall, Slipstream, staff melee
  combos, and the three borrowed elements (water, earth, fire) with their radial switch.
  Five of the six enemy types in the enemy contract. Aerial combat as a distinct posture.
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
strength, every value in `src/focus/config.ts`, and the pressureWave block in
`src/combat/config.ts`. Treat them as a starting point. Of that last block, the
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
