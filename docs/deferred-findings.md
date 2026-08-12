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

None of these is a known player-visible bug. They are mostly assertions that cannot fail and
comments in the wrong place — the same classes the register at the end of `HANDOFF.md` tracks.

**Fixed since this file was written:** the unreachable `s.chain < c.maxChain` term in
`stepStaff`'s `free` gate. It is kept rather than deleted, on the same grounds `staffBusy`
keeps its redundant `isSwinging`, and it now has a test that constructs the out-of-band state
it bounds — so it is a documented invariant rather than a term that looks dead. Deleting it
reddens `'refuses a press on a full chain with nothing owed'` with a fourth swing in a
three-swing combo.

**On checking these.** The first version of this file carried the glider dodge's axes as an
open design question. It was not open — it had been fixed two cycles earlier, and the check
that missed it was a grep for the *old* function's name, which is still called on the ground
branch of the function that replaced it. Grepping for the symbol a finding names says where
that symbol is used; it does not say what the code decides. Read the function that owns the
decision.

## Assertions that cannot fail, or barely can

- **`src/fx/vortex-ring.ts:39`** clamps the scale with `Math.max(..., 1e-4)`, and
  `'keeps a positive scale all the way in'` does not exercise it: `END_FRACTION` 0.15 times a
  `minRadius` of 5 is never zero, so the test passes with the guard deleted. Inherited from
  `shockwave.ts`, so fixing one should fix both.
- **`src/combat/staff-arc.test.ts:36`**, `'outreaches a spear'`, asserts a config invariant
  (3.6 > 3.2) rather than any behaviour of `staffShape` — it would pass with that function's
  ternary inverted, since both ranges exceed `strikeRange`. The sibling opener-versus-finisher
  assertion is what actually covers the shape.
- **The staff mash test** compares two states for equality, but `pressed` cannot matter on
  either branch during recovery, so both sides run identical code. It does pin "a press resets
  recovery to max" and gives no signal on the decay rate — a scaled-`dt` bug would leave both
  sides equally wrong.
- **The arrow's `depthTest` test** catches a flip to `false` but cannot tell an explicit `true`
  from three.js's own default of `true`. The same ceiling an earlier health-bar spec recorded.
- **The combat-audio no-clip assertions** use `toBeLessThanOrEqual(0.5)`, so a voice sitting
  exactly on the ceiling counts as compliant and only a value strictly above it fails. That is
  the convention across every voice in the file. One of the two no-clip tests also duplicates
  the iterating test's identical check on the same value.

## Comments in the wrong place, and one impossible fixture

- **`src/player/cone.ts`** — the explanation that its guards are unobservable below 90 degrees
  lives on a test constant rather than beside the guards themselves, so a reader editing only
  `cone.ts` could remove one as dead code. A reviewer suggested an explicit early return would
  read as intentional at any width; the current form is a lower-risk stopgap.
- **`src/ui/guide/actions.test.ts`** has a fixture with `staffElapsed` set and `staffChain` 0 —
  a state the staff state machine cannot reach. A gate-hole fix was written to be defensive
  about it rather than to correct the fixture, which is defensible and leaves the fixture
  describing something impossible.

## Two watch items

- **`drawnContains`** compares `relative <= thetaLength` with no epsilon, so a config angle
  landing a sample exactly on the boundary could be flaky. Not observed.
- **The corpse-displacement test** is only moderately robust to a knockback retune.
  Displacement per hit is capped at `knockback / 60`, one integration frame between swings, so
  roughly doubling knockback could push the body past the opener's 3.6 m reach and turn the
  test back into a false pass. Worth re-reading if the knockback numbers move.

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
