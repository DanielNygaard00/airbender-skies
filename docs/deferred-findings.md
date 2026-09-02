# Deferred findings

Written 2026-08-12, when the last three subagent-driven-development ledgers were deleted.

Every SDD cycle's task reviews produce findings, and the Minor ones are recorded in that
cycle's ledger under `.superpowers/sdd/<plan>/progress.md` rather than fixed on the spot. That
directory is git-ignored scratch, so those findings lived nowhere durable — deleting the
workspace of a finished plan discarded them silently. This file is where they go instead.

The list below came from the ledgers of three finished plans: staff melee (2026-08-04), vortex
and slipstream (2026-08-04), and archers and projectiles (2026-08-05). Each item was checked
against the code on 2026-08-12 before being carried over; eight were already fixed by later
cycles and are listed at the end so nobody re-investigates them.

Every finding carried here has now been dealt with. What remains below is the one item that was
never a defect — that nothing in this project has been played — plus a note on the `1e-4` floors
worth reading if anyone audits them as a group. The classes these findings fell into are the ones
the register at the end of `HANDOFF.md` tracks: assertions that cannot fail, guards that look
dead, and comments in the wrong place.

**Fixed since this file was written**, most by the same move — keep the guard, pin it with a
test that reaches it:

- The unreachable `s.chain < c.maxChain` term in `stepStaff`'s `free` gate, kept on the same
  grounds `staffBusy` keeps its redundant `isSwinging`. Deleting it now reddens `'refuses a
  press on a full chain with nothing owed'` with a fourth swing in a three-swing combo.
- The `Math.max(..., 1e-4)` scale floors in `vortex-ring.ts` and `shockwave.ts`, neither of
  which its own interpolation can reach — they bound the radius a caller passes, so both are
  pinned with a zero-radius test. `vortex-ring`'s old `'keeps a positive scale all the way in'`
  was worse than unexercised: with the floor in place, greater-than-zero holds for every input,
  so it could not fail either way. It has been replaced by a test that bounds the closing scale
  from both sides, which catches an `END_FRACTION` of 0.
- The `inCone` guards in `src/combat/cone.ts` (misfiled in this document's first version under
  `src/player/`) now carry the observability explanation beside the guards themselves — below a
  90° half-angle a zero dot product fails the angle check on its own, so only the staff
  finisher's width makes them load-bearing — instead of leaving it on `WIDE_FOR_GUARDS` in the
  test file, where a reader editing only `cone.ts` would never meet it.
- The impossible fixture in `actions.test.ts` (`staffElapsed` set, `staffChain` 0). Checking it
  found the reason it existed: it was the only test in the suite that reddened if `isSwinging`
  was deleted from `staffBusy`, because every reachable mid-swing state has `chain >= 1`. The
  fixture is now reachable (`staffChain: 1`), and the pin moved to `staff.test.ts` as a declared
  out-of-band test — `'reports busy mid-swing even when chain has desynced, which only a caller
  can hand it'` — which was mutation-verified as the sole failure with `isSwinging` deleted.
- Both `drawnContains` helpers (`staff-arc-fx.test.ts` and `gust-cone.test.ts`, which share the
  hazard) now tolerate an ulp at the sector edge: `+ 1e-9` radians, resolving the tie toward
  inclusion to match the hit tests' own `>=`, and ten orders of magnitude below the ~20° error
  the agreement assertions exist to catch — a 0.4-radian epsilon reddens them.
- The corpse-fling watch item in `'does not hit a downed enemy'` is now a precondition: before
  the probe swing, the corpse must still lie inside the opener's arc, measured with the same
  origin and forward `stepEncounter` hands `staffTargets`. A `finisherKnockback` raised 5×
  reddens the precondition with its own message; the `isDowned` guard disabled reddens the final
  assertion while the precondition stays green — the test now isolates the guard.
- The staff mash test, `'does not extend recovery when mashed'`. A mutation survey run before
  touching it settled what was actually uncovered: recovery decaying at double, half or zero rate
  was already killed by sibling tests, so for coarse errors the complaint was overstated. But
  every sibling signal is binary (busy or not busy) sampled at coarse offsets, and a decay 10 per
  cent **too fast** survived the entire file. The test now also asserts the absolute value —
  `start.recovery - frames * dt`, derived from where recovery actually stands rather than from
  `recoverySeconds` — stopping halfway through the debt so the clamp at zero cannot flatter it.
  That kills the 10-per-cent mutant. Prior coverage was asymmetric: 10 per cent too slow was
  already caught.
- The arrow's `depthTest` test, which had already been fixed by hoisting
  `SHAFT_MATERIAL_OPTIONS` out of `arrow.ts` so a deleted key reads `undefined` instead of
  three.js's backfilled default. What was left was the other half of that split: the options
  object pinned the *intent*, and nothing pinned that the shaft mesh is *built* from it. Closed
  by a test that iterates the options against the built material, so a key added later is covered
  automatically. Note the reason that loop alone is not sufficient, because it is unintuitive:
  every option currently on the object agrees with three.js's own default, so a mutant that
  bypasses the object entirely produces a byte-identical material and the loop stays green. The
  test therefore also sets a probe option that disagrees with the default (`alphaTest`, guarded
  by an assertion that it is unset and removed again in a `finally`), which reaches the mesh only
  if the mesh is built from the object. That probe mutates a module-level export inside a test,
  which is unusual enough to flag: it is contained because Vitest runs each file in its own
  worker and tests within a file in sequence.
- The combat-audio ceiling. The duplicate-test half had already been fixed, and
  `mapping.test.ts` carries a comment recording it. The remaining half was real, and checking it
  turned up an inconsistency the finding had not: the voice loop allowed a level of exactly 0.5
  through `toBeLessThanOrEqual`, while `'stays under the clipping ceiling at every count'` treats
  the identical threshold strictly, as does the loop's own audibility bound on the same line. The
  loop is now strict too. Demonstrated rather than argued: `hurt` set to exactly 0.5 left all 42
  tests in the file green beforehand, and afterwards reddens only the loop — `hurt` at 0.5 still
  satisfies the loudest-voice margin, so the loop is the sole detector, which also proves nothing
  else in the file relied on a voice reaching the ceiling. The loudest voice is `hurt` at 0.47.
  A shared `CLIPPING_CEILING` constant was considered and rejected: it would read like the
  self-comparison the volley test's comment exists to warn against, and sit one careless edit
  from becoming vacuous.
- `'outreaches a spear'` in `staff-arc.test.ts`, which compared one arc against one kind.
  Replaced by two tests iterating every melee kind in the config Record, plus one that pins the
  filter so an empty list cannot pass silently. This one was not only inert: it had gone stale.
  The heavy arrived after it was written with a `strikeRange` of 3.6, exactly the opener's range,
  so the spacing the test's name promised is not there against a heavy. The numbers are unchanged
  and the parity is now written down in the config and in `HANDOFF.md`'s list of things to feel
  for, because retuning it is a design decision.

The other six `1e-4` scale floors in `src/fx/` have since been audited as a group, and the
non-finite hole the audit recorded has since been closed too. Both are written up under "The scale
floors" in `HANDOFF.md`. In short: all six were unpinned, deleting any of them reddened nothing,
they fell into three classes rather than being six copies of one thing, and the convention turned
out to cover only about half the sites it belonged to. All thirteen now go through `safeScale` in
`src/fx/scale.ts`, with a table in `scale-wiring.test.ts` that reads the directory and fails if a
new one is missing.

**On checking these, which turned out to be the main lesson of the exercise.** Several items were
already fixed at the moment they were carried into this file, and were only found to be so when
someone opened the code: the glider dodge's axes, the arrow's `depthTest` complaint, the duplicate
audio tests, and — in substance if not in form — the missing coverage of the frame after a dodge.
A ledger entry is a snapshot of a cycle that kept moving after it was written, so a carried
finding is a hypothesis about the code, not a description of it.

The first version of this file got that wrong in the most instructive way: it carried the glider
dodge's axes as an open design question when the fix had landed two cycles earlier. The check
that missed it was a grep for the *old* function's name, which is still called on the ground
branch of the function that replaced it — the grep hit was real and the conclusion was backwards.
Grepping for the symbol a finding names tells you where that symbol appears; it does not tell you
what the code decides. Read the function that owns the decision.

Twice more the same discipline paid the other way: reading the code turned up things the findings
had not — the heavy's `strikeRange` matching the staff opener exactly, and the audio loop's `<=`
disagreeing with the strict form used on the identical threshold ten lines away.

## Never verified at the controls

The staff's feel was signed off from tests and screenshots only: whether a 0.26 s swing is
snappy, whether about a second without the wing is a fair price, and whether the arc reads as
wide on screen. This is one instance of the general gap `HANDOFF.md` records — the harness
refuses pointer lock, so nothing in this project has been played.

## Already fixed, checked on 2026-08-12

Listed so they are not investigated again:

- **A glider dodge read the wrong two axes**, so holding S — a flare — dodged backwards, and
  W, the normal flying state, turned almost every glider dodge into a forward one. Fixed by
  `afcc06d`, "Steer a glider dodge by bank, not by thrust and flare", and `0d87e37`, which
  pinned the banked dodge's sign. `dodgeHeading` in `src/player/slipstream.ts:81` now branches
  on posture: a glider dodge goes along `gliderRight`, perpendicular to the flight path by
  construction, with the bank axis choosing the side. The old `slipstreamHeading(look, forward,
  strafe)` call survives as the *ground* branch on line 133, which is what made this look
  unfixed from a grep. The fix also closed a free-altitude exploit: chain-dodging used to climb
  from y 300 to y 434 with a full breath bar, and `dodge-energy.test.ts` measures the corrected
  behaviour over forty seconds against a plain glide.
- **No test covered the frame after a glider dodge.** `dodge-energy.test.ts` now runs
  `controllerStep` for forty seconds through the real archipelago across about twenty dodges,
  so the frames after each one are exercised, and a drag spike that failed to self-correct
  would move the altitude and speed figures it asserts. There is still no assertion aimed
  specifically at the lift-and-drag response on the frame after a dodge; the aggregate is what
  covers it.
- A downed enemy below `worldFloorY` fell forever. `src/combat/enemy.ts:519` now arrests it.
- The vortex charge gate read a locally decremented cooldown while `canVortex` read the stored
  field, so the two disagreed for one frame. `src/combat/encounter.ts:588` now gates on
  `canVortex`, with a test.
- No readiness test covered the Vortex and Slipstream guide rows, so `ctx.gustReady`
  copy-pasted onto the wrong row would have passed. `actions.test.ts:224` names exactly that
  bug and pins it.
- No test asserted that a downed archer's bow rotation resets. `enemy-mesh.test.ts:428`,
  `'lowers a downed bow'`, does.
- A fixture comment in `encounter.test.ts` claiming the projectile config was unexercised by
  that file went stale and has since been removed.
- `hitEnemy` leaving `grounded` stale for a frame and the invulnerable window running up to one
  frame long are both intentional in a frame-stepped simulation, and documented as such.

---

# Carried over from the visual design arc, 2026-09-01

Four steps merged between 2026-08-13 and 2026-09-01: the lit world (A), elemental combos (C),
and three steps of effect painting (B1 air, B2 the borrowed effects, B3 the shared layer). B1's
findings were carried over at the time. **B2's and B3's ledgers were lost** — they lived in
`.superpowers/sdd/<plan>/progress.md` inside git-ignored worktrees that were removed after
merging, which is the exact failure the top of this file was written to prevent. What follows was
reconstructed from the session that produced them. The lesson is the one already recorded here:
carry a cycle's Minor findings into this file *before* deleting its workspace, not after.

## Still open

- **`src/fx/finisher.ts` states three numbers that are false, and one is in a test name.** Its
  `PEAK_OPACITY` comment credits `staff-arc-fx.ts` with "its own arc opacity — 0.9"; that file's
  only opacity is `FILL_OPACITY = 0.55`, and 0.9 is not the brightest in the directory either
  (`fire-burst.ts`'s `ARC_OPACITY` is 0.95). `finisher.test.ts`'s "peaks at the staff arc's own
  opacity" repeats it. Separately, the comment calls `gust-cone.ts`'s 0.22 lifetime "the fastest
  full beat already shipped" and itself "shorter than every other timed effect in this directory";
  `fire-thrust.ts` is 0.14 and `fire-burst.ts` and `staff-arc-fx.ts` are both 0.16. The values are
  defensible; their stated derivations are invented. Comment-and-test-name edit, no retune. This
  was reviewed as Needs-fixes and merged anyway as a deliberate call.
- **The no-collar exemption count is inconsistent across three files.** `mud.ts` calls itself "the
  second and last such exemption", `finisher.ts` calls itself "the third and last", and
  `aim-tell.ts` declines a collar without registering at all — though unlike the others it has a
  radius coordinate available, so it is a body that could have carried one and chose not to. No
  single task owned all three files. The fix is to delete the ordinal claims rather than renumber
  them: a count every new body must update in every other file will break again.
- **Nothing clears an enemy's elemental mark when it is knocked down.** `hitEnemy` spreads `mark`
  through untouched, and `markAndReact` clears it only when the downing blow is itself the
  reaction that fired. So a soldier downed and later restored still carries whatever mark was on
  it, ageing out on `stepEnemy`'s own clock, and the reaction table will read it. B3's mark pip
  masks this in the view with an `isDowned` check, which makes that check load-bearing rather
  than belt-and-braces. **Whether the simulation should clear it is a gameplay decision, not a
  view one.**
- **`EnemyView` has no `dispose` method at all**, so `createHealthBar`'s own `dispose` already
  goes uncalled and B3's mark pip geometry and material join it. Pre-existing; widening that
  interface was outside the visual arc's scope.

## Two frequencies that predate the criterion they are judged by

B2's fire tasks established a rule, recorded in `fire-thrust.ts`'s `PLUME_BODY` comment: whether a
temporal term reads as a flicker or as travel turns on the *spatial* richness of the body it
modulates, not on its raw cycle count. Sub-one-cycle motion on a single band never completes even
one rise and fall; the same arithmetic on a rich multi-band pattern slides that pattern
legibly. Two bodies written before the rule existed do not satisfy it:

- `earth-reach.ts`'s `pulse`, `sin(time * 22.0)` over a 0.26 s lifetime — about 0.91 of one cycle,
  on a term with no spatial structure at all, since it multiplies overall alpha.
- `water-reach.ts`'s grip drift — about 0.24 cycles of travel against roughly 1.06 spatial cycles
  across the 60-degree wedge.

Both amplitudes are small (±0.15 and ±0.14) and both photographed acceptably, so the numbers were
documented rather than moved. A retune is a tuning decision for a play-test.

## Shader edge cases that are inert but real

- `impact.ts`'s `atan(n.y, n.x)` is formally undefined where the view-space normal points straight
  at the camera — the dead centre of every burst, every frame. Every major GPU returns a finite
  value there rather than a NaN, so no artefact is expected.
- `mud.ts` is the first `POLAR_PREAMBLE` caller with a radius-0 disc, so the first to evaluate
  `atan(p.y, p.x)` at the origin, which GLSL also leaves undefined. One centre fragment on a
  48-triangle fan.
- `finisher.ts` interpolates its flicker rate into the shader source as `time * ${FLICKER_RATE}.0`,
  which is a new idiom here — `steam.ts` hard-codes its own. It is correct only while the constant
  is an integer: `8.5` would emit `8.5.0`, which fails to link, and the mesh would then silently
  not draw, which is exactly the failure `effect-material.ts` exists to make loud.
- `steam.ts` and `fire-thrust.ts` can both write a NaN into `position.y` from a NaN `dt`, which is
  outside `safeScale`'s remit — `scale-wiring.test.ts` drives that NaN but only inspects scale. A
  NaN translation collapses a matrix as thoroughly as a NaN scale.

## What the tests structurally cannot establish

- **No shader in this project has ever been compiled by a GPU under test.** The suite runs in
  node, so bodies are asserted as strings. A body that assembles and passes every assertion can
  still fail to link, and the failure mode is a mesh that does not draw — indistinguishable from a
  correctly transparent effect.
- Substring assertions against an assembled `fragmentShader` cannot tell live GLSL from the same
  text sitting in a dead comment. Inherent to the above, and true of every shader test here.
- Two assertions pass for weaker reasons than their names claim: `staff-arc-fx.test.ts`'s
  "measures across the wedge" is satisfied by `WEDGE_PREAMBLE` alone, since the preamble itself
  contains the substring `across`; and `aim-tell.ts`'s construction-time agreement between
  `sectorGeometry(1, 0, 1)` and `halfAngle: 1` is load-bearing but pinned nowhere — the test only
  proves the uniform follows two later `update` calls.
- `MARK_COLOUR` in `enemy-mesh.ts` is the fifth copy of the four element hex literals and the
  first with no test pinning it. Nothing fails if `element-radial.ts`'s `LOOKS` moves a colour.
- The collar's literals are per-effect rather than shared, deliberately, because each mesh is a
  different thickness. `collar-bounds.test.ts` guards the risk that creates for the ring cases by
  reading each mesh's real geometry, but it cannot cover the shell or box bodies, which have no
  radius band.

## The bench, and three ways it has misled

The FX bench is the instrument the whole arc was verified with, and it produced a false negative
three separate times. Each is now argued in a scene comment, but the class is worth stating
plainly: **a bench proves an effect drew something; it does not prove the frame could have shown
it.**

1. It drove its simulation from `requestAnimationFrame`, which never fires in a hidden browser
   pane, so every screenshot taken that way showed the region, the light and no effect —
   indistinguishable from a shader that compiled and drew nothing. Fixed by running the
   simulation to completion synchronously before the first render, with identical frame counts.
2. `src/bench/main.ts` hands a scene's camera *target* to the effect as its origin, so an effect
   that lifts itself above that origin sits above the aim point. The ice-shell scene cropped its
   own subject this way.
3. A flat horizontal shape seen from a shallow angle foreshortens to a sliver. Two staff scenes
   photographed completely empty at 9.8 degrees above the horizon; the fix was the `gust` scene's
   26.6-degree look-down, scaled to the subject. An off-axis margin calculation does not catch
   this — it answers whether the shape fits the frame, not whether the frame can see a flat shape.

The bench is also now a still camera only: with the simulation run to completion before the first
render, every scene shows its final frame and an effect can no longer be watched playing.

## Still the oldest item in this file

Nothing in this project has been played. Four merged steps of visual work now rest on frozen bench
frames and argued reasoning. The collar survived a gate on pale grass, on dark rock, and at the low
tier where the composer is bypassed, which is real evidence — but every judgement about motion,
about whether five elements stay distinguishable now all are painted, about whether the mark pip is
findable in a four-soldier fight, and about whether the finisher flare lands on the beat the hit
does, is still standing on arithmetic against a lifetime rather than on anyone's eye.

Pointer lock is refused in the harness these steps were built in — `requestPointerLock` returns
`WrongDocumentError: The root document of this element is not valid for pointer lock` — and the
simulation stays paused without it. So the play-test is not something the build process can close.
It needs the owner and a real browser.

## What the `at` sweep answered, 2026-09-01

`bench.html?scene=<id>&at=<seconds>` freezes any scene at a chosen age in its effect's life
rather than at the one moment its scene table hard-codes. Three things fell out of it and the
tier sweep on the first afternoon it existed.

- **The grip's inward travel is real, and this is the first time it has been seen.**
  `water-reach.ts` documents its arc as travelling inward "because it drags", and nothing had
  ever confirmed it — the scene froze at one age. At `at=0.04` the bright arc sits at the
  sector's outer edge near full reach; at `at=0.25` it has moved to roughly a third of the
  reach. Two screenshots for a claim that had been carried on argument since B2.
- **The deflect's readable moment is early, confirmed by sweep rather than by inference.** At
  `at=0.01` it is small, tight and densely spoked; by `at=0.06` it has expanded and the spokes
  have stretched and faded. Gate round two moved its scene earlier on reasoning; the sweep shows
  the reasoning was right.
- **Earth and fire's burst share a warm-tan register and are the pair most at risk of reading
  alike** — clearest at the low tier, on pale grass, where nothing blooms. Ranked by how well
  they separate there: water's cyan `0x2fb8d8` best by a distance, being the only cool tint in
  the set; earth's sandstone `0xd9a066` clearly; fire's burst `0xffd9a0` visibly but in earth's
  register; fire's thrust, on the same `0xffd9a0`, faintest of everything. **Tints were an
  explicit non-goal of B1, B2 and B3, so nothing was moved** — this is a design decision for the
  owner, now with evidence behind it rather than a suspicion.

Worth recording about the instrument itself: both timing bugs the arc hit — the deflect frozen
44% through a 0.12 s life where its own fade had taken it to 56%, and two staff scenes frozen at
half-faded — would have been obvious in a five-shot sweep. Each was instead found by eye, one at
a time, and each cost a fix round. The sweep does not answer whether an effect *feels* right,
which is real-time perception and still needs a person. It does answer whether the animation
progresses legibly and whether the moment a scene chose is the moment worth photographing, and
those were the questions being deferred to a play-test that had not happened.
