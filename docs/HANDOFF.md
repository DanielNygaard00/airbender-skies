# Handoff

Written 2026-07-31, at commit `1023a5f`. This is a recap for whoever picks the
project up next, including a future session with no memory of the work below.

**Live:** https://danielnygaard00.github.io/airbender-skies/
**Repo state:** `main` is in sync with `origin/main`. 601 tests across 43 files,
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

## What has NOT been built

From the design document, in rough order of how much is missing:

- **Most of §4 combat.** Vortex, Air Wall, Slipstream, Pressure Wave, staff melee
  combos, the three borrowed elements (water, earth, fire) and their radial switch,
  the Focus meter, and the Avatar State. Five of the six enemy types in the enemy
  contract. Aerial combat as a distinct posture.
- **§4.6 non-lethality scoring.** Enemies have a downed state, but nothing yet grants
  more Focus for non-lethal removals, because Focus does not exist.
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
feels), `groundResponse`, `dashSpeed`, the scooter accumulator rates, and every wind
strength. Treat them as a starting point.

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

**The preview pane's animation loop stalls.** Repeatedly during development the game
rendered but stopped advancing, making in-game verification unreliable. Static
screenshots are fine; anything needing sustained simulation is not. Isolated render
pages that draw one frame were the workaround.

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
2. **Finish the combat slice into something with a loop.** Focus (§4.5) is the
   keystone: it makes non-lethal play mechanically rewarded, which §4.6 needs, and it
   gates the Avatar State. Pressure Wave (§4.2) is the other high-value move because
   its damage scales with fall height, which pays the traversal layer off directly.
3. **Add a second enemy type.** Archers pressure altitude, which is the axis the whole
   flight model is about, and they would make the existing hover and dodge meaningful.
4. **Then either** the terrain API change that unblocks wall-riding, **or** a second
   region from §3.3 to prove the world structure generalises.

Sections of the design doc are the natural unit of work. Each one is roughly a
spec-plan-implement cycle, and combat in full is several.
