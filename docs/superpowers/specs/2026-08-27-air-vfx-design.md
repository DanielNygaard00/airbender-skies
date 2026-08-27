# The air pass — design note

**Step B1 of the visual arc.** The arc is A (the lit world, merged 2026-08-14) → C (elemental
combos, merged 2026-08-27) → **B** (this) → D (explorability). B was always the step that would
make the attacks look like the elements they are; what this note settles is that B is two plans,
and this one is the first.

The owner's original ask was that the attacks "really look like air or water". Reading the effect
directory changed what that means, twice — once about the state of the code, once about the
technique. Section 1 records both, because both narrowed the design more than the goal did.

---

## 1. What the code says, including two things it says about itself

**The elements are uniformly flat, not half-painted.** `src/fx/` holds eighteen effect modules and
exactly one of them builds a custom shader: `air-wall.ts`. The only particles in the project are
`world/wind-tell.ts`'s motes. Water, earth and fire are the same flat `MeshBasicMaterial` geometry
as air — sectors, rings, arcs and cylinders. The step-A note's claim that the effects are flat
geometry was right; a first pass at this note assumed the newer element work had already moved on,
and it has not.

**The project has argued against per-effect shaders, and its reason is a trap.** From
`water-reach.ts`, and `sky.ts` says the same thing from the other side:

> a `ShaderMaterial` that includes the `..._pars_fragment` chunks the renderer already injects
> fails to compile almost silently, and the mesh then simply does not draw — which looks like a
> correctly transparent effect with the world showing through, so it can read as success

That is the worst failure mode available to a step whose verification is screenshots: an effect
that does not draw looks exactly like an effect that draws correctly and is transparent. It is also
not hypothetical — `sky.ts` records it "silently leaves the sky undrawn, showing `scene.background`
instead", found the hard way.

**Points have their own recorded hazard.** They draw screen-facing squares, so a droplet
approaching a world unit across reads as a white block up close. `wind-tell.ts` caps its motes at
0.45–0.75 for exactly that, and `water-reach.ts` declined points on the grounds that a combat
effect at melee range is nearer the camera than any mote cloud.

**There is already a vocabulary, and it is semantic rather than material.** A gust's bright arc
travels *outward* because the move pushes; a grip's travels *inward* because it drags; a freeze's
does not travel at all because nothing is being moved. `water-reach.ts` states that this reuses
`vortex-ring.ts`'s outward-versus-inward contrast "deliberately so the vocabulary is one vocabulary
and not two."

So the naive version of this step — add particles and shaders until it looks expensive — would
fight all three. What follows keeps the vocabulary, treats the two hazards as requirements rather
than warnings, and spends its effort where the character's identity is.

## 2. Scope: B is two plans

Re-authoring eighteen modules is not one spec.

**B1, this note.** The enabling capability, then air. Concretely: one shared way to build effect
materials that makes the silent-compile trap structurally impossible; a bench scene per effect so a
non-drawing effect is caught by a screenshot rather than shipped; air's kit re-authored through it —
the gust cone, the vortex ring and its charge, the Pressure Wave's shockwave, and the dash and
slipstream trails. Plus the three gaps step C left, which belong here rather than in B2 because
they are all air-adjacent or already half-built.

**B2, later.** Water, earth and fire through the same capability, once air has proven it.

**Air first, and not because it is worst.** Air is the always-available element and the character's
identity: §2 makes airbending locomotion the baseline movement layer, and §4.2 makes the airbending
core the kit that is never taken away. Every other element is borrowed and situational. The gust is
also the most-thrown effect in the game and the one with a recorded legibility failure, so it is
where a unit of effort buys the most.

## 3. The capability: one place that builds an effect material

A new module, `src/fx/effect-material.ts`, is the only place in `src/fx/` allowed to construct a
`ShaderMaterial`. It exposes a small builder that takes a fragment body and the uniforms it wants,
and assembles the full shader itself — appending the two trailing includes (`tonemapping_fragment`,
`colorspace_fragment`) and **refusing** a body that contains a `..._pars_fragment` include.

**Refusing, not documenting.** The trap is that the mistake reads as success, so a comment saying
"do not do this" is worth less than a function that will not do it. The builder throws on a
`_pars_fragment` include in the body, and a node test asserts that it throws — which is the whole
reason this module exists, and the one part of it a test can reach.

**It throws where the source is written, not where the effect is spawned.** Shader sources are
module constants, so validation runs when the module defining them is loaded — a bad shader fails
on page load, loudly, in front of whoever is editing it. Validating per instance instead would put
a throw inside effect construction, which happens the first time a move is thrown: a crash
mid-fight, in the one code path that must never be the thing that breaks a session.

**What it does not do.** It is not a shader library, an effect framework, or a material cache. It
builds one kind of thing correctly. `air-wall.ts` is migrated onto it as the proof that it can
express the one shader the project already has, and if it cannot, the builder is wrong rather than
`air-wall` — that migration is the acceptance test for the design.

**Why a shader at all, given §1's argument against them.** Because the thing air needs is the one
thing flat geometry cannot do: air is visible only as *distortion and motion*, and the readable
signal is a gradient that moves across a surface rather than a surface that fades. A sector whose
opacity animates uniformly is a shape blinking; a sector whose brightness sweeps along its own
radius is air moving through a volume. That is a per-fragment property. The project's argument was
never that shaders are wrong — it was that the cost of introducing one *per effect* is out of
proportion to the benefit. Introducing one *once*, behind a builder that makes the failure mode
impossible, is the version of that argument this step accepts.

## 4. The legibility rule, which is a rule and not a number

`gust-cone.ts` records that its first tint, a pale blue at 0.16, "measured fine and was invisible in
play", and was raised to 0.34 and cooled toward cyan. Step A's bench then showed the *current* 0.34
still reads faintly over the home island's pale green grass, and that bloom does not rescue it:
`post.ts` sets `luminanceThreshold` to 0.82 and the fill sits well under it.

So the rule, applying to every effect this step touches and every one B2 touches after it:

**An effect must carry at least one element above the bloom threshold, and must not rely on its
fill for legibility.** The fill states the volume the move affects — it is honest about reach and
must stay quiet enough not to hide the world. The *reading* is carried by a bright, thin, moving
element: an arc, an edge, a streak. That element is what bloom bites on, which is what makes the
pipeline step A built actually pay for itself here, and it is why brightening the fill is the wrong
fix — a louder fill hides terrain and still sits under the threshold.

This also gives the pale-over-pale problem a general answer rather than a per-effect nudge: the
bright element is bright in absolute terms, so it separates from pale terrain and dark terrain
alike, while the fill's job never depended on contrast in the first place.

## 5. What air gets

Six effects, each keeping its current geometry, reach and timing — this step changes how they read,
not what they mean. Their existing constants are the baseline and any change to a reach or a
lifetime is out of scope, because those numbers encode gameplay the tests pin.

| Effect | Now | After |
| --- | --- | --- |
| `gust-cone` | Filled sector at 0.34 plus a brighter arc travelling outward | Same sector and arc; the arc becomes a bright moving gradient broken up along its length, so it reads as a pulse of air rather than a ring sliding outward |
| `vortex-ring` | Ring closing inward at 0.75 | Same closing ring; brightness concentrates into moving streaks around its circumference, so the inward pull reads as rotation rather than a shrinking hoop |
| `vortex-charge` | Thin static ring at 0.55 | The same ring, gaining rotation and a brightening leading edge as the charge fills, so a held vortex reads as winding up |
| `shockwave` | Expanding ring, fading | Same expansion; the leading edge sharpens and brightens while the trail softens, so it reads as a front moving through air |
| `dash-trail` | Fading quads behind the player | Same trail; streaks along the direction of travel rather than fading uniformly |
| `slipstream-trail` | Fading quads, taller | The same, plus a brighter leading edge to mark the invulnerable window's start |

**The technique is procedural, in the fragment, with no new asset.** Where the table says "broken
up" or "streaks", the means is a cheap scrolling hash in the fragment body — a couple of lines of
arithmetic over the surface coordinate and a time uniform. No texture is loaded and none is
authored: `ASSETS.md` requires a licence entry per file, and a noise texture would be a licence
question in exchange for something four lines of arithmetic already give. It is also what keeps the
whole step inside the builder, since a texture would need a loader and a lifetime.

**Every one of these is the same move with the same numbers.** That constraint is deliberate: C's
review measured that the fight's balance is sensitive to reach and displacement, and a visual step
that quietly retuned a range would be indistinguishable from a balance change.

## 6. The three gaps step C left

These are in B1 because C explicitly deferred them here, and because two of them are the difference
between a system the player can learn and one that feels random.

**Steam and Mud draw placeholder rings.** C wired one `createShockwave` per reaction, tinted per
kind, and said so plainly: a ring is "the cheapest shape that says *something happened here*
without pretending to be steam or mud". They get real effects now — steam rising and dissipating,
mud as a low dark spatter — through the same builder and under the same legibility rule.

**The finisher has no cue at all.** `finisherThisFrame` is reported by `stepEncounter` and read by
nobody; C's review flagged that two comments described a flourish that does not exist. It gets one.
The cue must also solve a specific problem C's fix created: a finisher gust on a heavy now draws a
*deflect* spark while the soldier visibly flies, because the same list feeds Focus and the impact
effects. The finisher's own cue is what makes that frame legible — the clang is true (the armour did
stop the damage) and the displacement is also true, so the frame needs to say both.

**The finisher's cue is a ring, and that fixes what the three cues each own.** A ring is already the
vocabulary's word for a front moving outward through air — `shockwave.ts` is the Pressure Wave and
`vortex-ring.ts` inverts it to mean the opposite. A finisher is maximal outward push, so a sharp
bright ring snapping out from the contact point in the *element's* own tint is the reading, and it
sits on top of whatever spark the impact layer drew rather than replacing it: the clang says the
armour held, the ring says the soldier moved anyway.

That allocation is only coherent if the reactions stop being rings, which is the other half of this
decision. **Steam rises and mud spatters low; neither is a ring.** C shipped rings for both because a
ring was the cheapest shape available, and keeping them would put three different meanings —
Pressure Wave, vortex, finisher — plus two reactions into one shape. So: steam is an upward, widening,
dissipating column; mud is a low, dark, outward spatter that stays on the ground. Distinct
silhouettes, and the ring is left to mean displacement.

**The mark is invisible.** C deferred the health-bar pip here. It arrives: a small element-coloured
pip on the soldier's own health bar. The consequence of not having it is precise and was named by
C's reviewer — any air blow silently erases a water mark, so an idle gust between a grip and a burst
cancels Steam with no feedback whatsoever, which is the likeliest source of "reactions feel random".

## 7. Verification, and why the bench is load-bearing here

Step A built the FX bench for exactly this step. It renders a fixed camera pose on a fixed clock
with a seeded world, so two screenshots differ only by what changed in the code. Today it has one
effect scene (`gust`) and its registry is a typed `BenchEffectId`.

**Every effect this step touches gets a bench scene**, which is what turns the silent-compile trap
from a hazard into a caught bug: an effect that does not draw shows an empty frame in a shot framed
to contain it. The registry being a typed union means adding an effect without a scene is a
compile-time choice rather than an oversight.

Node-testable, and therefore tested:

- the builder refuses a `_pars_fragment` include, and produces a fragment source ending in the two
  required includes;
- the builder's uniform plumbing: what goes in comes out addressable, and a missing uniform is a
  type error rather than a silent black;
- the bench registry: every `BenchEffectId` resolves to a scene, and every scene's effect id is one
  the entry point can spawn — the second half is what stops a scene existing for an effect nothing
  fires;
- geometry and parameter helpers, as today: `sectorGeometry`, `safeScale` and the non-finite
  discipline `src/fx/scale.ts` already enforces across the directory apply unchanged to anything new;
- the reaction and finisher cue *models* — which cue fires for which reported event — kept pure and
  away from the drawing, the way `impact-targets.ts` already separates "who should spark" from the
  spark;
- the mark pip's *model*: which element's colour a given soldier's pip should show, and that an
  unmarked soldier has none. The pip itself is drawn into `health-bar.ts`'s three.js sprite and is
  therefore untestable here — the split is what keeps the untestable part down to a position and a
  colour, and it is the same split step C used when it put `radialModel` in a pure module and left
  the badge's DOM to `element-radial.ts`.

Verified by screenshot: whether each effect draws at all, and whether the bright element clears the
bloom threshold against both pale and dark terrain. The bench gains a scene over the canyon's rock
for the dark-terrain half of that comparison.

Verified only at the controls: whether any of it reads in motion. That is the owner's, and §9 lists
what to look for.

## 8. Non-goals

No water, earth or fire re-authoring — that is B2. No new reach, damage, lifetime or cooldown; no
combat behaviour of any kind. No particle systems: the recorded points hazard stands, and nothing in
air's kit needs a spray that a moving gradient cannot express. No shader library beyond the one
builder. No post-processing changes — step A's pass list is settled and B1 works inside it. No new
assets. No SSAO, god rays or volumetric fog.

## 9. Risks

- **The builder could be the wrong abstraction, and the migration is how we find out.** If
  `air-wall.ts` cannot be expressed through it without contortion, the builder is wrong. That
  migration happens early in the plan for that reason, not late.
- **A moving gradient may not read at gust speed.** The gust's whole life is 0.22s. If a sweep is
  invisible at that duration, the honest answer is a brighter, simpler arc rather than a longer
  lifetime — the lifetime is gameplay.
- **Bloom is now load-bearing for legibility, and bloom is off on the low tier.** Step A's low tier
  bypasses the composer entirely, so an effect that reads only because it blooms will read worse
  there. The bright element must be legible unbloomed; bloom is what makes it *good*, not what makes
  it visible.
- **Six effects plus three cues is a wide plan.** The mitigation is that each effect is independent
  and separately shot on the bench, so the plan can stop after any of them with the branch coherent.
- **Nobody has played any of this.** Pointer lock is refused in this environment, so every claim
  about motion in this note is an argument, not an observation.
