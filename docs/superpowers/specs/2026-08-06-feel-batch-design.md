# The Feel Batch

Four small, independent defects found by measuring the movement code. Each is self-contained;
none needs the others. They are one cycle because they are all cheap and all in the same layer.

## 1. The scooter's central trade does not exist

`stepScooter` computes `scooterTurnAuthority`, the doc's "doubles speed and halves steering",
and `groundStep` passes it into `desiredVelocity` where it scales the **strafe axis only**.
That does almost nothing. On foot the heading comes from `horizontalForward(input.lookDirection)`
— the camera — so turning is done by moving the mouse, and scaling one input axis before
`move.normalize()` merely rotates the desired vector slightly.

Measured: the time to complete a 90-degree turn with W held while the camera swings is
**0.45 s on foot, 0.45 s at scooter charge 0, and 0.45 s at charge 1.** Identical. The
scooter doubles speed and costs nothing.

What actually governs turning is `groundResponse` 7, the exponential rate at which velocity
chases the desired direction — and it never sees `authority`.

**The fix:** `authority` moves from `desiredVelocity` to `easeHorizontal`, scaling
`groundResponse`. It stops scaling the strafe axis entirely, so there is one mechanism rather
than two half-working ones.

```ts
export function easeHorizontal(
  current: Vector3, desired: Vector3, dt: number, c: GroundConfig, authority = 1,
): Vector3
```

with `blend = 1 - Math.exp(-c.groundResponse * authority * dt)`.

At `scooterTurnFactor` 0.5 that makes the effective response 3.5 at charge 0 and 1.75 at
charge 1 (after `scooterChargeTurnPenalty` 0.25), so the same 90-degree turn should take
roughly 0.9 s and 1.8 s. Those are predictions from the formula, not measurements; the
implementation must measure the real figures and record them.

The default of 1 keeps every on-foot call unchanged.

## 2. Shift means three things

`Shift` is `sprint` while held, fires `scooterPressed` on keydown, and is `hover` in the
glider. So the key that summons the scooter also, while still held, changes how fast it goes.

Measured, with identical scooter charge 0.26 and both genuinely riding: **cruise is 27.5 m/s
with Shift held and 14.8 m/s released.** Nearly double, from a key the player has no reason to
think is still doing anything.

The README already describes the tangle rather than hiding it: "Air scooter (tap to ride, tap
to step off) — or hold to sprint instead, which also raises the scooter's speed."

**The fix:** the scooter moves to its own key, **`Z`**. `Shift` keeps sprint on foot and hover
in the glider, which are the same idea in both postures — go harder — and stop being a toggle
as well. `Z` is chosen for being unbound, left-hand, and near the other movement modifiers.

Touches `src/core/input.ts` (the keydown that sets `scooterPressed`), the README's controls
table, and `src/ui/guide/actions.ts`, whose `key` field is compared against that table by a
drift test in both directions — so both must change together or the test fails, which is the
point of it.

Sprint is *not* gated while riding. Once the two keys are separate, holding Shift on a scooter
is a legible choice rather than a leftover.

## 3. Thrust stutters at empty breath

`canBend` is `breath > 0`, with no floor to re-engage at. At zero breath in the glider,
regeneration adds 0.2 in a frame, thrust then drains 0.3, and the bar oscillates around zero.

Measured over 600 frames of holding W at empty breath: **thrust engaged on 300 of them.** A
50% duty cycle at 30 Hz — not "out of breath", but a buzz.

**The fix:** a floor to re-engage at. `FlightConfig` gains `bendFloor`, and `canBend` takes
the config:

```ts
export function canBend(s: BreathState, c: FlightConfig): boolean
```

returning `s.breath >= c.bendFloor`.

**`bendFloor` is 15.** At `breathDrainPerSecond` 18 that buys 0.83 s of thrust, and at
`breathRegenPerSecond` 12 it takes 1.25 s to earn back. So an exhausted player gets a slow
legible pulse — most of a second of thrust, then a beat of nothing — instead of a per-frame
flicker. Hovering at 30/s gets 0.5 s, which is shorter but still a beat rather than a buzz.

This deliberately does not add a "was bending" field to `PlayerState` to get true hysteresis.
The floor alone converts the failure from a 30 Hz artifact into a rhythm, and a new state
field carried through every respawn and serialisation path is a real cost for a smaller
improvement.

`canBend` gains a parameter, so both call sites in `controllerStep` change. `validateFlightConfig`
must require `bendFloor > 0` and less than `baseMaxBreath`, or the glider could never bend.

## 4. The dash trail is drawn longer than the dash travels

`dash-trail.ts` sizes its streak as `dashSpeed × dashDurationSeconds` = 26 × 0.22 = **5.72 m**.
The dash actually covers **3.94 m**, measured from a standstill: it is an impulse added to
horizontal velocity and then bled off by `easeHorizontal`, whose time constant is
`1 / groundResponse` ≈ 0.14 s. `dashDurationSeconds` never touches the simulation, and
`dashDecay`, which would have used it, is exported and called from nowhere but its own tests.

**The fix:** size the trail from the constants the simulation actually obeys.

```ts
const covered = c.dashSpeed / c.groundResponse
```

which is 3.71 m — the analytic displacement of an impulse decaying exponentially at that rate,
and within a frame's travel of the measured 3.94.

Then delete `dashDurationSeconds` from `GroundConfig` and `types.ts`, and delete `dashDecay`
and its tests. Deleting them is the point: a config value that looks live and is not, plus an
exported function nobody calls, is an open invitation to reintroduce exactly this mismatch.

One other consumer: `src/main.ts` drives the dash FOV kick's decay rate from
`1 / DEFAULT_GROUND_CONFIG.dashDurationSeconds`. It becomes `DEFAULT_GROUND_CONFIG.groundResponse`,
which is the same quantity — the rate the dash actually decays at — expressed directly.

## Out of scope

- **The scooter's `clipped` tier drop.** Still hardcoded `false` in `groundStep`. Terrain
  collision now makes a wall detectable, so this is available, but it needs a clip report
  threaded from movement into scooter state and its own tuning.
- **Retuning `scooterTurnFactor` or `scooterChargeTurnPenalty`.** Fixing the mechanism will
  make the existing numbers *mean* something for the first time, and they should be judged in
  play before being changed.
- **True hysteresis on breath**, per section 3.

## Testing

Each section gets a test that fails before its fix and passes after — and for each, the change
that would break it must be named and confirmed to break it.

1. A 90-degree turn takes measurably longer at scooter charge 1 than on foot, and longer at
   charge 1 than at charge 0. Asserted as inequalities between measured times, not against
   literals. The existing `desiredVelocity` tests that pass an `authority` argument must be
   updated, since the parameter is gone — check whether any of them were the only coverage of
   something else.
2. Holding Shift no longer toggles the scooter, and `Z` does. The guide-panel drift test
   against the README covers the documentation side in both directions.
3. At empty breath, thrust engages on **zero** of 600 frames rather than 300; and a player at
   `bendFloor` can thrust. The 50/50 duty cycle is the discriminator — a test that only
   asserts "cannot bend at exactly 0" would pass today.
4. The trail's length equals `dashSpeed / groundResponse`, and a test that the real
   displacement of one dash is within a frame's travel of what the trail draws — which is the
   assertion that would have caught the original mismatch, and the only one here worth having.

Every number in this document is measured except `bendFloor` 15 and the key choice `Z`, both
of which are argued guesses. None of it has been played.
