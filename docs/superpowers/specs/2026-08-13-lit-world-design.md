# The lit world — design note

**Step A of a four-step arc.** The goal the owner set is that the game should feel like a real
production, and that the elemental attacks should look like the elements they are. That goal is
too large for one cycle, so section 1 records the decomposition and the order, and the rest of
this note designs only the first step. Steps B, C and D each get their own note when their turn
comes.

Nothing in this step changes what the game does. It changes what the game looks like while doing
it, and it builds the harness that every later visual cycle is verified against.

---

## 1. The arc, and why this order

Four sub-projects, ordered A → C → B → D:

| Step | Name | What it adds |
| --- | --- | --- |
| A | The lit world | Post-processing pipeline, sun-driven sky and atmosphere, quality tiers, the FX bench |
| C | Combos and swap flow | Chain state across elements, single-element strings, cross-element reactions, a swap that continues a string instead of resetting it |
| B | Elemental visual effects | Particles, shader-driven air, water volume, earth debris, fire heat — across the whole effect inventory |
| D | Explorability | Regions connected in the world at altitude, discovery verbs beyond shrines |

**Why B comes after C, even though B is the thing the owner asked for first.** Step C invents
effects that do not exist today. A cross-element reaction — water then fire, earth then air — is a
new visual by definition, and there is no way to author "the water effect" well without knowing
that it also has to turn into steam. Authoring water's visuals before the reaction inventory is
settled means authoring them twice. Doing C first costs a delay in gratification and saves a whole
pass of rework.

**Why A comes before everything.** Every effect authored in B is lit by, and composited through,
whatever pipeline exists at the time. Bloom in particular changes what an effect should look like
at source: an effect tuned to read brightly with no bloom is an effect that blows out once bloom
lands. So the pipeline is settled first, and A deliberately contains no new effects of its own —
its payoff comes from the world it already has, lit properly.

**Why D is last.** It is the only step that is mostly content rather than capability, and it is the
step whose cost scales with how good the game looks — new regions built before the visual language
is settled would be rebuilt when it is.

## 2. What "AAA" means here, since it cannot mean photorealism

This is a browser game rendering low-poly geometry through three.js, with exactly one licensed
character asset. Chasing realism is a fight it loses. The direction chosen instead is **stylised
geometry with rich light**: the silhouettes stay simple and everything is spent on lighting,
atmosphere and effects. The reference points are Sable, Journey and Breath of the Wild — games
whose look survives close inspection precisely because they never promised detail they did not
have.

Two alternatives were considered and rejected:

- **Cel shading toward the source material's own look.** Genuinely appealing, and it would make
  elemental effects read instantly. Rejected for this step because it rewrites every material in
  the game, and because flat ramped shading fights the tools that make the biggest difference
  cheaply: bloom, tone-mapped highlights and aerial perspective all depend on a continuous
  response to light. It stays available later as a material-level choice; nothing in this step
  forecloses it.
- **Semi-realistic physically-based rendering.** Highest ceiling, wrong project. It needs a texture
  budget the repository does not have, it costs the most frames per unit of look, and it would make
  the one CC0 character read as a placeholder in a way it currently does not.

The existing pipeline is already a decent foundation and this step is an extension of it rather
than a replacement: fixed-timestep simulation, render interpolation, ACES tone mapping, soft
shadows, distance fog and a sky dome are all in place.

## 3. The pipeline

### 3.1 The library

The composer comes from pmndrs `postprocessing` rather than three's own
`examples/jsm/postprocessing`. The reason is not maintenance fashion, it is pass count: the pmndrs
library merges independent effects into one fullscreen pass, where three's composer runs a separate
fullscreen pass per effect. Bloom, tone mapping and a colour grade as three passes versus one is
the difference between fitting the frame budget and not, on the integrated GPUs the low tier exists
for. The dependency is pinned against three 0.185.1 at install time; if no published version
supports that three release, the fallback is three's own composer with a reduced pass list, and
this note is amended rather than the version quietly floated.

### 3.2 The pass list

| Effect | Role |
| --- | --- |
| Bloom | The single biggest change. Sun, sky highlights and every bright effect gain a halo, which is what makes emissive things read as *light* rather than as bright paint. Mipmap blur, a luminance threshold high enough that the terrain does not glow, moderate intensity. |
| Tone mapping | ACES, **moved off the renderer and into the composer**. See the hazard below. |
| Colour grade | Brightness, contrast and saturation trim. A lookup-table grade was considered and deferred: it needs an authored asset, and the trim is what actually separates "raw WebGL" from "graded". |
| Antialiasing | SMAA in the composer, at every tier that runs the composer. |

**Deliberately not in the pass list:**

- **No vignette.** This is a ruling that came out of reading the code rather than a preference. The
  vignette channel is already occupied: `hud.ts` draws a DOM vignette that means *Avatar State is
  active*, scaled by the reduce-motion setting. A second, always-on vignette in the render pass
  would make the game's loudest state read as slightly more of something the player already sees
  all the time. Framing stays the HUD's job; the render pass stays about light.
- **No screen-space ambient occlusion**, and **no god rays**, in this step. Both are real
  candidates, both need a depth or occlusion setup that doubles the pipeline's complexity, and
  neither can be judged until bloom and the new sky are in. They are the obvious first additions
  once there is a bench to measure them on.

### 3.3 Two hazards that must be handled, not discovered

- **Double tone mapping.** `renderer.toneMapping` is currently `ACESFilmicToneMapping` with an
  exposure of 1.0. Once the composer applies ACES, the renderer's must go to `NoToneMapping` — with
  both on, the curve is applied twice and the whole world turns milky. The exposure compensation
  and the light intensities that were raised to match it move with the tone mapping, so the
  neutral-look target is the current image, not a brighter one.
- **Multisampling cannot be toggled at runtime.** The canvas is created with `antialias: true`, and
  `WebGLRenderer` takes that at construction — changing it means rebuilding the renderer, which
  would mean rebuilding every material and shadow map with it. Since quality is a live setting, the
  flag stays on for the life of the renderer. The consequence is deliberate and worth naming: the
  composited tiers pay for an MSAA buffer they do not use, and the low tier gets antialiasing in
  exchange. That trade is the right way round — the tier that cannot afford SMAA is the one that
  keeps its MSAA, and the tiers that waste the buffer are the ones with headroom to waste.

## 4. Quality tiers

`Quality = 'low' | 'medium' | 'high'`, exposed as a settings row and persisted. The tier table is a
`Record<Quality, QualityProfile>`, so a fourth tier fails to compile until every field is specified
— the same device `LOOKS` and `WIND_LEGEND` use to make an omission a type error instead of a
silent fallback.

What a tier controls: whether the composer runs at all, which effects are in it, the pixel-ratio
cap, and the shadow-map size. Starting values, to be retuned on the bench with the argument recorded
beside the profile:

| | High | Medium | Low |
| --- | --- | --- | --- |
| Composer | on | on | **off** |
| Bloom | on | on | — |
| Colour grade | on | on | — |
| SMAA | on | on | — (canvas MSAA) |
| Pixel-ratio cap | 2 | 1.5 | 1 |
| Shadow-map size | 4096 | 2048 | 1024 |

High is today's shadow map and pixel ratio, so high tier is the current image plus the composer, and
that is what makes "unchanged except for the passes" a checkable claim.

**The shadow-map step down is a known, measured loss, not a guess.** `renderer.ts` records that at
2048 the character's shadow renders the staff as a vague smear and that 4096 was chosen precisely to
sharpen it. So medium's shadows are worse in a way the owner has already looked at, which is the
right kind of degradation: legible, and about detail rather than correctness.

SMAA stays on at both composited tiers rather than being medium's first casualty. Aliasing is
visible on every edge in every frame; bloom's absence is visible only where something is bright.
When medium needs to give something up, bloom's resolution goes before antialiasing does.

**The low tier's bypass is the interesting case.** When the composer is off, tone mapping has to go
back onto the renderer, or the low tier ships an untone-mapped image — which does not look "lower
quality", it looks broken. So the tone-mapping owner is a function of the tier, and that is the one
piece of state the pipeline and the renderer share. It is written down here because it is exactly
the kind of coupling that gets rediscovered as a bug.

**Interaction with `reduceMotion`.** The existing setting scales shake, hurt flash, dash kick,
hitstop, vignette and speed-reactive field of view through `MotionScales`. Bloom is not motion and
is not scaled by it. What *is* scaled is any bloom **pulse** a later step adds, on the same grounds
as the existing entries: a steady glow is not a vestibular problem, a throbbing one is.

**Settings migration.** `quality` joins `Settings`, which means saved settings written before this
step lack the field. A missing field resolves to the default tier. The store already has to be
tolerant of partial data; this makes that tolerance explicit and tested rather than incidental.

## 5. Sun, sky and atmosphere

`sky.ts` and `sun.ts` are extended rather than replaced. The change is to derive the look from
**one** input — the sun's elevation — instead of from independently tuned constants:

- sky gradient, from zenith colour to horizon colour;
- horizon haze, which is what gives the stacked regions of §3.1 their sense of scale;
- fog colour, so distance reads as air rather than as a grey curtain;
- sun and hemisphere light colour and intensity.

The reason to bind them together is that they are physically one phenomenon, and a game where they
disagree looks wrong in a way players notice without being able to name. It also makes "what does
golden hour look like" a single number to try, which matters for a step whose whole verification
method is comparison screenshots.

**The elevation is an authored constant, not a clock.** This step introduces no day/night cycle. The
sun's direction is fixed for the life of a scene, and `sun.ts` already states why that matters: the
light moves with the player so the shadow map can follow him, while the *direction* — and therefore
the angle of every shadow in the world — must not. A moving sun would also destroy the one
verification method this arc has, since two bench shots would differ by the time of day rather than
by the code. What this step buys is that the constant is now *one* number with everything else
derived from it, so trying a different hour is a one-line experiment instead of a retune of six
values that can disagree.

Three constraints carry over unchanged and are not up for negotiation in this step: the sky dome
stays inside the camera's far plane, which `FOG_FAR` doubles as; fog stays cheap; and shadow angles
stay stable at runtime. Volumetric atmosphere is not in this step.

## 6. The FX bench

A route — `?bench=<id>` — that renders a fixed scene, from a fixed camera pose, on a fixed clock,
with a seeded random number generator and no player input, and fires one nominated effect.

**Why it exists.** Two facts about this project make it necessary rather than nice. First, every
one of the 2453 tests runs in node with no DOM, so nothing in the suite can see a pixel; the visual
half of this arc has no automated gate at all. Second,
`docs/deferred-findings.md` records that the game's feel has been signed off from tests and
screenshots rather than at the controls, and that the gust's first colour pass measured fine and
was invisible in play. A repeatable, identically-framed shot is the cheapest instrument that would
have caught that.

**What it is not.** Not a level, not a debug menu, and not a place gameplay lives. It resolves
exactly like `?region=` already does — a query parameter, an unknown id warning and falling back
rather than throwing, and the one function that knows about the browser staying in `main.ts`. A
mistyped parameter must not be the difference between a game and a blank page.

**What one bench entry specifies:** the camera pose, the ground and prop dressing, the sun
elevation, the effect to fire and when, and how long to run. Determinism is the whole point: two
shots of the same id, taken a week apart, differ only by what changed in the code.

## 7. Module boundaries

| Module | Responsibility | Testable in node |
| --- | --- | --- |
| `src/core/post.ts` | Builds and owns the composer; `render`, `setSize`, `setOptions`, `dispose` | Wiring only, against a fake renderer |
| `src/core/quality.ts` | Tier → profile. Pure | Fully |
| `src/core/renderer.ts` | Device concerns; tone-mapping owner when the composer is off | Partly, as today |
| `src/core/sky.ts`, `sun.ts` | Elevation → sky, haze, fog, light | The derivation, fully |
| `src/core/settings.ts` + store + guide row | The `quality` setting and its persistence | Fully |
| `src/bench/` | Bench registry and id resolution | Registry and resolution, fully |

**Data flow.** `main.ts` renders through `post.render` instead of `renderer.render`. The tier flows
from settings into three consumers: the composer's effect list, the renderer's pixel ratio and
shadow-map size, and the tone-mapping owner. Everything else in the game is untouched — no combat,
movement, world or HUD module changes behaviour in this step.

**Why `post.ts` is a seam rather than inline setup.** The composer is the one piece of this step
that cannot be tested for correctness, only for wiring. Putting it behind a four-method interface
means the untestable surface is four methods wide, the tier logic that decides *what* it contains
is pure and fully tested, and `main.ts` does not grow another block of setup it already has too
much of.

## 8. Verification

**Tested in node:**

- the tier table, swept exhaustively over `Quality`;
- settings round-trip, including a stored payload with no `quality` field resolving to the default
  rather than to `undefined`;
- bench id resolution: every registered id resolves, an unknown id falls back and warns, an empty
  parameter behaves as absent;
- the sun-to-sky derivation: colour moves monotonically with elevation, haze never exceeds fog,
  nothing returns a non-finite value at either extreme — the same non-finite discipline
  `src/fx/scale.ts` already enforces across the effect directory;
- composer wiring against a fake: the effect list matches the profile for each tier, `setSize`
  propagates, and `dispose` releases everything it created.

**Verified by screenshot:** the look. Bench shots per tier, before and against after, taken through
the browser preview.

**Verified at the controls:** by the owner, at the end of the step. Bloom on a moving camera, sky
in motion, and whether the low tier is a downgrade or a different game are all things a still frame
cannot answer.

## 9. Non-goals for this step

No material or texture rework. No camera retuning. No new elemental effects, particles or shaders.
No new art assets. No SSAO, god rays or volumetric fog. No cel shading. No region work. Each of
these is either a later step or a candidate that becomes cheap to evaluate *because* this step
lands the bench.

## 10. Risks

- **The dependency may not support three 0.185.1.** Handled by the fallback in §3.1, decided at
  install time rather than assumed.
- **Bloom over the DOM HUD is a non-issue and should be confirmed as one.** The HUD, radial,
  reticle and vignette are DOM overlays outside the WebGL canvas, so no pass can wash them out.
  Worth one screenshot to confirm rather than one assumption.
- **The neutral-look target could drift.** With tone mapping moving between two owners, "unchanged
  at high tier" is a claim to check on the bench, not to assert.
- **Effects tuned before bloom may now be too bright.** Expected, and out of scope to fix here:
  step B retunes the effect inventory against the pipeline. Anything egregious enough to look
  broken at high tier gets recorded for B rather than patched ad hoc in A.
