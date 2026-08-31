# The borrowed elements — design note

**Step B2 of the visual arc.** A merged 2026-08-14, C 2026-08-27, B1 2026-08-28. B2 finishes the
elements; B3 takes the shared feedback layer.

Written compressed at the owner's request: rulings and verified facts, no long arguments. Every
"verified" below was measured or read in the code, not inferred.

---

## 1. Verified facts this design rests on

**Geometry decides what a coordinate means.** B1 got this wrong three times by assuming. The map for
everything B2 touches, read from the modules:

| Geometry | Effects | What to use |
| --- | --- | --- |
| `sectorGeometry` (bounded wedge on `RingGeometry`) | water-reach, earth-reach, fire-burst | `vUv.x` along the arc — **but see the 90° caveat** |
| `BoxGeometry` | fire-thrust | `vLocal` (per-face UVs; B1 added the varying) |
| `OctahedronGeometry` | ice-shell | `vLocal` — no useful UV |
| `CylinderGeometry` | pillar-view | side-face `vUv` is genuinely (around, up), as `air-wall` uses |

**The 90° caveat, and the one config that breaks it.** `sectorTheta` centres every wedge on local
+Z with `thetaStart = -π/2 - halfAngle`, so `vUv.x` is monotone along the arc **iff halfAngle ≤ 90°**
— `cos` is monotone on `[-π, 0]` and both wedge edges sit inside it only under that bound. All of
B2's sectors qualify: grip `π/6` (30°), freeze `π/2.5` (72°), stone `π/9` (20°), fire burst `π/12`
(15°). **The staff finisher at `π/1.9` ≈ 94.7° does not** — B3 owns that effect and must not use
`vUv.x` for it.

**Three effects hand-copy the same polar preamble.** `vortex-ring`, `vortex-charge` and `shockwave`
each repeat `p = vUv*2-1; radius = length(p); angle = atan(p.y,p.x)/6.2832+0.5`. B2 adds more.

## 2. The rule changes, and this is the point of the step

B1's rule was "every bright element clears `post.ts`'s bloom `luminanceThreshold` of 0.82". It is
wrong in kind, not degree. **Contrast is a difference; 0.82 is a level.** No absolute threshold
separates a bright element from a *bright* ground, which is why B1's cyan effects read on the
canyon's rock and washed out on the home island's grass — measured on the bench for the gust and the
vortex, both times.

Corroborating measurement: the shockwave reads best on both terrains. It is the *thickest* bright
element (0.35 of radius against the gust arc's 0.16), not the brightest.

**The replacement rule: every bright element carries its own dark edge.** Concretely: one extra
`smoothstep` band immediately outside the bright core, multiplying alpha *up* there while the core
stays bright — a darker collar, not an added colour, so it costs no tint and no second draw. The
contrast is then inside the effect and independent of the ground. The fill keeps its existing job — stating the volume honestly,
quiet enough to see the world through.

**No tint moves.** B1 spent the red-channel headroom raising green five times; the four air tints now
differ only in red. Raising anything further makes the palette worse without fixing the problem.

**The rule is validated on one effect before the other seven.** `water-reach` goes first, is shot on
the grass scene and the canyon scene, and the result decides whether the rule ships. If the rim does
not separate on pale ground, one effect is wasted rather than eight.

## 3. What each effect gets

Existing geometry, reach and timing are untouched throughout — B2 changes how effects read, never
what they mean. Each keeps the semantic vocabulary `water-reach` documents: **outward travel means
pushing, inward means dragging, no travel means holding.**

| Effect | Element | After |
| --- | --- | --- |
| `water-reach` | water | grip's arc still travels inward, freeze's still snaps and holds; both gain the rim and a slow drift that reads as water rather than glass |
| `ice-shell` | water | per-facet brightness varied from `vLocal` and held — ice is still, so nothing travels, and an octahedron has no useful UV |
| `earth-reach` | earth | stone's arc gains grain and a hard rim; earth reads as mass, so its edge is the sharpest of the six |
| `pillar-view` | earth | brightness rises up the column as it raises, then holds |
| `fire-burst` | fire | the cone's bright core flickers along its length; the narrowest sector in the game stays narrow |
| `fire-thrust` | fire | streaks along `vLocal.z`, brightest at the nozzle end |
| `steam` (new) | reaction | rising, widening, dissipating column — replaces C's placeholder ring |
| `mud` (new) | reaction | low dark spatter that lands and stays — **the one effect exempt from the rim rule**, because wet earth has no bright element and nothing above the bloom threshold |

## 4. Where knowledge gets encoded

Not in a plan. In the modules that own it:

- **`effect-material.ts`**: a `POLAR_PREAMBLE` GLSL constant, and a documented table of which
  coordinate means what per geometry class.
- **`sector.ts`**: the monotonicity guarantee and the 90° bound beside `sectorTheta`, naming the
  staff finisher as the known violator so B3 cannot miss it.
- **Each effect**: its own measured numbers in its own comment, as B1 established.

## 5. Testing

Node-testable, therefore tested: the polar preamble's output; the rim band's literal bounds pinned
per effect, in the shape `shockwave.test.ts` established, so a reversal or retune fails; `time`
uniforms advancing; the sector monotonicity bound as an assertion over the shipped half-angles, so a
config edit past 90° fails a test rather than silently breaking an effect; the directory guard from
B1 still passing with eight more effects through the builder.

Verified by screenshot: whether the rim separates on pale *and* dark ground. Both scenes exist.

Verified only at the controls: whether any of it reads in motion, and whether the elements stay
distinguishable from each other once all six are painted.

## 6. Non-goals

No tint changes. No gameplay numbers. No particles — the recorded points hazard stands. No new
assets. No post-processing changes. Not the finisher cue, the mark pip, or the shared layer
(`guard-shell`, `avatar-aura`, `impact`, `staff-arc-fx`, `arrow`, `aim-tell`) — those are B3.

## 7. Risks

- **The rim hypothesis may be wrong.** It is grounded in the shockwave measurement, not in play. The
  one-effect gate is the mitigation.
- **The owner has not played B1.** B2's most important input is missing, and the rim rule is a
  hypothesis standing in for it. If the play-test contradicts it, B2's later effects revise cheaply
  because the rule lives in one place per effect.
- **Eight effects is a wide step.** Each is independent and separately shot, so the plan can stop
  after any of them with the branch coherent.
- **A fifth geometry surprise.** Four found so far, all by reading first. §1's table is the defence;
  anything not in it gets read before it gets specified.
