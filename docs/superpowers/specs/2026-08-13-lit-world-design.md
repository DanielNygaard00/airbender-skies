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

**Corrected after implementation: the merge is not "one pass over everything", and it cannot be.**
`EffectPass` re-orders the effects handed to a single pass — `setEffects` sorts them by attribute
bitmask, descending. `SMAAEffect` declares `CONVOLUTION | DEPTH`, which is 3; bloom,
brightness/contrast, hue/saturation and tone mapping all declare `NONE`, which is 0. So an
`EffectPass` given the whole list runs antialiasing *first*, which is the ordering §3.2 forbids,
and it does it silently while the call site still reads in the intended order. Antialiasing
therefore ships as its own `EffectPass`, added after the merged one. What survives of the argument
above is the part that mattered: the three colour effects are one fullscreen shader rather than
three passes, so the pipeline is two passes and not four. Bloom-before-grade is safe inside the
merge because equal attributes leave the sort stable.

### 3.2 The pass list

| Effect | Role |
| --- | --- |
| Bloom | The single biggest change. Sun, sky highlights and every bright effect gain a halo, which is what makes emissive things read as *light* rather than as bright paint. Mipmap blur, a luminance threshold high enough that the terrain does not glow, moderate intensity. |
| Tone mapping | ACES, **moved off the renderer and into the composer**. See the hazard below. |
| Colour grade | Brightness, contrast and saturation trim. A lookup-table grade was considered and deferred: it needs an authored asset, and the trim is what actually separates "raw WebGL" from "graded". |
| Antialiasing | SMAA in the composer, at every tier that runs the composer. Ships as a **second `EffectPass` of its own, added after the merged colour pass** — see §3.1 for why it cannot be merged with them and still run last. |

**Order.** Bloom and the grade work on scene colour, tone mapping brings that range down to the
display, and SMAA runs last because it reads the composited image: smoothing before the grade means
grading the smoothed edges back into hard ones. `postEffects` in `src/core/post.ts` states that
order and `postPasses` is what enforces it, by keeping antialiasing out of the merged pass. Running
SMAA last also puts it on a tone-mapped, display-referred image, which is what its default
`EdgeDetectionMode.COLOR` threshold of 0.1 is calibrated for — inside the merged pass it was
reading raw linear radiance.

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
  flag stays on for the life of the renderer. That is what antialiases the low tier, which bypasses
  the composer and so has no SMAA.

  **Corrected after implementation: the "deliberate trade" this bullet used to describe was a
  defect.** The reasoning was that the composited tiers pay for an MSAA buffer they do not use while
  the low tier gets antialiasing in exchange, and that this is the right way round. The second half
  is wrong. Once `RenderPass` draws the world into a composer render target, the canvas's
  multisample buffer is *bypassed*, not merely wasted — and `EffectComposer`'s `multisampling`
  option defaults to `0`, so the composited tiers were rasterising the world with no hardware
  antialiasing at all, leaving SMAA as a substitute for MSAA rather than a supplement. That is a
  concrete mechanism by which high tier could be **more** aliased than the build this step replaces,
  which is exactly the claim §4 rests on. The composer now asks for `multisampling: 4` (WebGL 2,
  which `hasWebGL` already prefers), as one value for both composited tiers rather than a
  `QualityProfile` field: frame cost could not be measured on the development machine — the browser
  harness only runs its render loop while its pane is frontmost — so a per-tier split would be a
  guess presented as a measurement.

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

A fixed scene, from a fixed camera pose, on a fixed clock, with a seeded random number generator
and no player input, that fires one nominated effect.

**Corrected: not a route inside `main.ts`.** This section originally specified `?bench=<id>`,
resolved the way `?region=` is resolved, inside the game's own entry point. What was built instead
is a **separate HTML entry point** — `bench.html?scene=<id>` — with its own registry in
`src/bench/scenes.ts` and its own entry script in `src/bench/main.ts`. The reason is `main.ts`
itself: at the time of writing it is 2,301 lines, and every render path through it runs through the
player, the HUD, the pause state and the input tracker. A `?bench=` branch inside that file would
have had to choose between two bad options — reuse that machinery, in which case the shot is not
deterministic because the player and the soldiers are live, or add a second render path through the
largest file in the project. A sibling entry point shares only the modules that decide how things
look (`createRenderer`, `createPost`, `profileFor`, the world builder, the effect pool) and touches
no gameplay code at all, which is what the determinism this section asks for actually requires.

The registry ships three scenes: `light` (no effect, the shot that says whether the pipeline
changed the world's look), `golden-hour` (the same pose at a low sun elevation, proving the
elevation parameter is actually wired to the sky), and `gust` (the one effect on the bench so far,
chosen because it is the effect that measured correctly in every test and was still invisible in
play — see §11). The bench runs on a fixed step of `1/60` rather than real frame time, so a fast
machine and a slow one photograph the identical point in an effect's life, and it reads a `quality`
query parameter so a shot can be taken at any tier without touching the registry.

**Why it exists.** Two facts about this project make it necessary rather than nice. First, every
one of the 2453 tests runs in node with no DOM, so nothing in the suite can see a pixel; the visual
half of this arc has no automated gate at all. Second,
`docs/deferred-findings.md` records that the game's feel has been signed off from tests and
screenshots rather than at the controls, and that the gust's first colour pass measured fine and
was invisible in play. A repeatable, identically-framed shot is the cheapest instrument that would
have caught that — and, per §11, one that went on to catch something worse than a colour miss.

**What it is not.** Not a level, not a debug menu, and not a place gameplay lives. **Corrected:**
it does not resolve through `main.ts`'s `?region=` machinery as this section originally said —
it has its own resolver, `resolveBench` in `src/bench/scenes.ts`, which follows the same
*behaviour* `?region=` established (a query parameter, an unknown id warning and falling back
rather than throwing) from `src/bench/main.ts`, the one function that knows about the browser on
the bench's side. A mistyped parameter must not be the difference between a scene and a blank page.

**What one bench entry specifies:** the camera pose, the ground and prop dressing, the sun
elevation, the effect to fire and when, and how long to run. Determinism is the whole point: two
shots of the same id, taken a week apart, differ only by what changed in the code.

## 7. Module boundaries

| Module | Responsibility | Testable in node |
| --- | --- | --- |
| `src/core/post.ts` | Builds and owns the composer; `render`, `setSize`, `setProfile`, `dispose` | **No**, apart from the pure pass list and pass split it exports |
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
that cannot be tested at all in this project. Putting it behind a four-method interface means the
untestable surface is four methods wide, the decisions it acts on — which effects a tier gets, and
which of them may share a pass — are pure functions that are fully tested, and `main.ts` does not
grow another block of setup it already has too much of.

**Corrected after implementation: there is no fake renderer, and "wiring only, against a fake
renderer" was never built.** The table above claimed it and `post.ts`'s own doc comment said the
opposite from the day it landed. The environment is the reason: the suite runs in node with no DOM
and no GL context, so a fake would have to stand in for `WebGLRenderer` deeply enough to satisfy
`EffectComposer`'s constructor — which reads `getContext().getContextAttributes()`, `getSize()`,
`getDrawingBufferSize()` and `outputColorSpace`, and allocates render targets — and a test written
against that fake would be asserting what the fake was told to return. `setSize` and `dispose` have
no coverage as a result, and that is a stated gap rather than a promise. What is tested instead is
everything that decides *what* the composer contains: the pass list and the pass split, swept over
every tier.

## 8. Verification

**Tested in node:**

- the tier table, swept exhaustively over `Quality`;
- settings round-trip, including a stored payload with no `quality` field resolving to the default
  rather than to `undefined`;
- bench id resolution: every registered id resolves, an unknown id falls back and warns, an empty
  parameter behaves as absent;
- the sun-to-sky derivation: it reproduces the shipped palette exactly at the shipped elevation,
  sunlight brightens and cools as the sun climbs, the fog colour equals the horizon band at every
  elevation, the horizon stays lighter than the zenith, an elevation outside 0–90 clamps, and
  nothing returns a non-finite value at any extreme — the same non-finite discipline
  `src/fx/scale.ts` already enforces across the effect directory. There is no haze field on
  `Daylight`, so the "haze never exceeds fog" test this note used to promise tests nothing that
  exists; the horizon band is what plays that role and it is covered by the two constraints above;
- the pass list and the pass split, swept over every tier: the list contains exactly what the
  profile turned on, tone mapping is present whenever the composer runs, bloom precedes the grade,
  and antialiasing is grouped into a pass of its own after the merged colour pass. **Not** the
  composer itself — see §7 for why there is no fake renderer and what is uncovered as a result
  (`setSize` and `dispose` have no tests).

**Verified by screenshot:** the look. Bench shots per tier, before and against after, taken through
the browser preview. Telling high from medium this way depends on shadows being in the frame at all,
since `shadowMapSize` is their most visible difference — and the bench shipped without calling
`enableShadows`, so for a while no bench shot had a shadow in it. `src/bench/main.ts` now makes that
call; nothing in `src/world/` sets the flags itself.

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
  install time rather than assumed. **Resolved: the fallback was never needed.**
  `postprocessing@6.39.4`, the version installed, declares its `three` peer dependency as
  `>= 0.168.0 < 0.186.0`, and three 0.185.1 — the version this project pins — sits inside that
  range with room to spare. The reduced-pass-list fallback in §3.1 stays written down as the
  documented behaviour for the day the range no longer includes whatever three version is current,
  but that day did not arrive in this step.
- **Bloom over the DOM HUD is a non-issue and should be confirmed as one.** The HUD, radial,
  reticle and vignette are DOM overlays outside the WebGL canvas, so no pass can wash them out.
  Worth one screenshot to confirm rather than one assumption.
- **The neutral-look target could drift.** With tone mapping moving between two owners, "unchanged
  at high tier" is a claim to check on the bench, not to assert.
- **Effects tuned before bloom may now be too bright.** Expected, and out of scope to fix here:
  step B retunes the effect inventory against the pipeline. Anything egregious enough to look
  broken at high tier gets recorded for B rather than patched ad hoc in A.

## 11. What building this step actually cost

Everything above is what was planned or, where corrected, what shipped. This section is neither —
it is what the nine implementation tasks found out along the way, kept here because step B starts
from it rather than from §10's predictions.

**The composer was sized in the wrong units, and it took two symptoms to find.** `createPost`
originally sized the composer from `renderer.domElement.width` and `renderer.domElement.height`.
Those are the canvas's drawing-buffer attributes — device pixels, already multiplied by the pixel
ratio — and `EffectComposer.setSize` takes CSS pixels. The library detail that makes the unit matter
is not obvious from the outside: `setSize` compares its arguments against `renderer.getSize()`, which
is in CSS pixels, and calls `renderer.setSize()` if they differ, then derives its own render-target
sizes from `renderer.getDrawingBufferSize()`, which is in device pixels. So the composer accepts
CSS-pixel arguments and does the device-pixel conversion itself, and a caller feeding it device
pixels on any retina display makes the two disagree — at which point the composer resizes the
*renderer* to the device-pixel figure and, with `updateStyle` left at its default of `true`, rewrites
the canvas's CSS size with it.

The same root cause showed up as two unrelated-looking symptoms. In the game it was a startup
flicker: the first several frames rendered ungraded, indistinguishable from the low tier, before the
image snapped to graded. On the bench it was a black screen with
`GL_INVALID_FRAMEBUFFER_OPERATION: Attachment has zero size` on every draw call, because the bench
has no other content to show through the broken composer. Both symptoms went away when the units
were corrected — `createPost` now sizes from `renderer.getSize()`, the same unit the resize hook
passes to `Post.setSize` — and when the bench was subscribed to `onResize` the way `main.ts` already
was. Verified afterwards: two screenshots taken immediately after load are now identical and already
graded, where before the fix the first was ungraded and the second graded.

**An earlier version of this section explained it as a genuine `0x0`, and that explanation does not
hold.** It claimed `window.innerWidth` reads `0` at that moment because the page has not laid out
yet. If that were so, `renderer.getSize()` would return `0` as well and the fix would have changed
nothing — the fix changed the *units*, not the timing. So the route from a too-large size to a driver
complaint about a *zero*-size attachment is unexplained, and is recorded here as unexplained rather
than papered over. What is established is the unit mismatch and that correcting it removed both
symptoms.

That mattered beyond the wording, because the false diagnosis came with a false remedy: the comment
concluded that a subsequent real `resize` event corrects a bad construction-time size. A player who
never touches the window never generates one, so if the hazard had been real the composer would have
stayed wrong for the life of the page. `Post.render` now compares its own render-target size against
`renderer.getDrawingBufferSize()` once per frame and re-sizes when they disagree — device pixels
rather than CSS pixels, because that is the invariant the composer actually maintains and it also
catches a pixel-ratio change, which moves the drawing buffer without moving `getSize()`. The resize
subscription stays as the cheap path. Its limit is stated in the code rather than hidden: it cannot
invent a size the renderer does not have, so a genuinely `0x0` renderer stays `0x0` until the next
`resize()` fixes both together — but nothing is renderable in that state anyway.

**Three code reviews approved that defect.** The composer's construction-time sizing landed in one
review, was rendered through in a second, and survived a first-round diff review of the bench
itself, all clean. It is invisible in a diff, because a diff shows that a size is being passed, not
that the size is `0` at the moment it is read; and it is invisible to a test suite that runs in
node with no DOM, because nothing in that suite can construct a real `WebGLRenderer` and ask it what
`getSize()` currently returns. It was found on the bench's first real use, by looking at the
rendered frame rather than at the code — which is the concrete argument for the bench existing at
all, not an abstract one.

**Three defects that all had the same shape: the code said one thing and the library did another.**
The whole-branch review found them together, and step B should read them as a set rather than three
unrelated fixes, because the pattern is what generalises.

- **The pass order was inverted.** `postEffects` listed SMAA last, the comment above it explained
  why last is the only correct place, and `EffectPass` re-sorted the list by attribute bitmask so
  SMAA ran first. Corrected in §3.1 and §3.2; SMAA now has its own pass.
- **The composited tiers had no hardware multisampling.** `EffectComposer`'s `multisampling`
  defaults to `0`, and the canvas's own MSAA buffer is bypassed the moment rendering goes through a
  render target. Corrected in §3.3.
- **The bench had no shadows.** `enableShadows` is what sets the flags and only `main.ts` called it.
  Corrected in §8.

The common thread is that each one was a *default* or a *sort* inside a dependency, invisible in the
diff and unreachable from a suite with no GL context, and in each case a comment asserting the
intended behaviour was mistaken for a guarantee of it. Two of the three were then pinned by making
the guarantee a pure function with a test — the pass split — or by naming the default explicitly.
The third, multisampling, is still a single unmeasured number, because frame cost cannot be measured
on this machine.

**A bench scene whose clock outlives its effect holds a picture of nothing.** The `gust` scene
originally fired at 0.2s and froze at 0.6s, against a `LIFETIME` of 0.22s on the gust cone itself —
so by the time the bench stopped advancing, the effect had already finished and been disposed, and
every screenshot of the scene showed an empty island. The rule this forced — that a scene's frozen
frame must land while its effect is still alive — now lives as the doc comment on the `fireAt`
field in `src/bench/scenes.ts`, next to the data it constrains, rather than only in this note.

**The home island's surface at the origin is at y ≈ 11.87**, measured with a `groundHeightAt(0, 0)`
probe against the built world, not read off the HUD. The HUD shows "14 m" at spawn, and that number
includes `SPAWN_CLEARANCE` — a 2-unit clearance the player stands on top of, defined in
`src/player/state.ts` — which is not part of the ground itself. This is worth writing down because
the original bench camera pose was built against the HUD's 14, which put it underground: a target
near y = 14 sits inside terrain whose real surface is almost 2 units lower.

**The one effect-appearance finding so far, and it is for step B.** At high tier, the gust cone's
pale cyan filled sector reads *subtly* against the pale green grass of the home island. This is the
same hazard `gust-cone.ts`'s own `FILL_OPACITY` comment already records from the effect's first
colour pass: a pale blue at low opacity measured correctly in every test and was invisible in play,
which is why the fill's opacity was raised to 0.34 and its tint cooled toward cyan — a pale effect
over pale terrain is one nobody sees, regardless of how correct its shape and timing are. Bloom did
not fix this on its own, because the fill's brightness sits below the bloom threshold that keeps
the terrain itself from glowing. Step B should treat the cone's legibility over light terrain as an
open question to re-examine once its effects sit behind the full pipeline, not as a solved problem
because the tint survived to this step unchanged.

**No other effect has been examined yet.** The gust is the only effect with a bench scene, so
everything else in the effect inventory — fire, water, earth, and the rest of air — is unaudited
against bloom, the colour grade and SMAA. An empty finding list for those effects is the absence of
a look, not evidence that they look right.
