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

There are six more `1e-4` scale floors across `src/fx/`. They are a house convention rather
than copies of one mistake, and not all are in the same position: `gust-cone.ts:91` scales by
`t * c.range`, so its floor is reached on the effect's own first frame. Worth a look if anyone
audits them as a group; not carried here as a finding.

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
