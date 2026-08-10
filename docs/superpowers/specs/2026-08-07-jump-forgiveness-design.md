# Jump Forgiveness: Coyote Time And A Jump Buffer

## The problem

Two standard platformer affordances are absent, and their absence was measured rather than
assumed.

**Walking off a ledge with Space pressed produces no jump at all.** Not a weaker jump — none.
Measured: run to a ledge, press Space on the last grounded frame, release one frame later, and
the resulting vertical speed is `-0.667`, which is one frame of gravity and nothing else. The
air jump is not spent either. The press simply vanishes.

The mechanism is that the jump fires on *release*: `stepJump`'s grounded branch returns a
velocity only when `input.actionReleased && chargeTime > 0`. Its airborne branch discards
`chargeTime` outright and fires only on a *fresh* press. So a press that straddles the ledge
is charged on one side and thrown away on the other.

**A press just before landing is discarded.** Measured, with the air jump already spent and
the press released mid-air, at 1, 2, 3, 5 and 8 frames before touchdown — 17, 33, 50, 83 and
133 ms: no jump on landing in any of the five.

For scale, a double jump is worth **2.09 m** — a single jump peaks at 2.100 m and a jump
followed by an air jump at apex reaches 4.194 m. This is not a rounding error's worth of
height.

Worth recording because it bounds the scope: on flat ground, holds of 1, 2, 4 and 8 frames all
launch at exactly 9.000 m/s. The charge only bites past `chargeThresholdSeconds` 0.2, so short
taps are already uniform and need nothing.

## The change

### Config

`GroundConfig` gains two values:

```ts
coyoteSeconds: 0.1
jumpBufferSeconds: 0.1
```

Both are 6 fixed steps at 60 Hz, and both are argued guesses — the common platformer standard,
not a measurement of this game.

**No validator is added, deliberately.** There is no `validateGroundConfig`; only
`validateFlightConfig` and `validateCollisionConfig` exist, and both guard values whose bad
settings produce a broken game — a stall that never resolves, a wall that stops deflecting, a
`bendFloor` that could leave the glider unable to bend at all. These two are not like that. A
window of zero or below disables that one piece of forgiveness and leaves today's behaviour
exactly as it is, which is a safe degradation rather than a broken state. Inventing a
`GroundConfig` validator for two fields that cannot break anything would be scope this cycle
has not earned.

### State

`PlayerState` gains two fields, both seconds remaining:

```ts
/** Grace left to still jump as though grounded, after walking off an edge. */
coyoteTime: number
/** A jump press remembered across a landing. */
jumpBuffer: number
```

Two new state fields is a real cost, and the feel batch declined one for breath hysteresis on
exactly that ground: "a new state field carried through every respawn and serialisation path
is a real cost for a smaller improvement." The difference here is that no cheaper trick
exists. `bendFloor` worked because thrust could be gated on a *level*; forgiveness is by
definition memory of something that has already happened, so there is nothing to read off the
current frame. And the improvement is larger — up to 2.09 m of height that is currently
unrecoverable, on an input the player did make.

Four sites construct or reset a player and must zero both: `src/player/state.ts:41`,
`src/player/controller.ts:104` (`respawn`), `:132` (`safeRespawn`), and `:274` (the
in-`controllerStep` reset). Both also join `isFinitePlayer`'s number list at
`src/player/controller.ts:69`, which is the check that catches a NaN before it spreads.

### `coyoteTime` needs no edge detection

While grounded it is pinned at `c.coyoteSeconds`. While airborne it decays by `dt`. Any jump
zeroes it.

That is the whole rule, and it has three properties worth stating because each replaces
something an implementation might otherwise reach for:

- It is **armed automatically** on leaving the ground. No "did I leave the ground this frame"
  comparison is needed anywhere, because the last grounded frame already left the window full.
- A ground jump **cannot be followed by a second ground jump**, because the jump zeroes the
  window on the way out. Without that, every jump would be a double jump for its first 6
  frames.
- Landing **re-arms it** for free, since grounded pins it.

### Split responsibility, mirroring `airJumpsUsed`

`stepJump` runs at the top of `groundStep`, before the ground probe that computes the new
`grounded`. It therefore cannot know whether the player left the ground this frame. So:

- **`stepJump` consumes.** It reads `state.coyoteTime`, decides what the jump is, and reports
  when a press was dropped so a buffer can be set.
- **`groundStep` does the bookkeeping**, against the freshly computed `grounded`.

This is not a new pattern. `groundStep` already writes `airJumpsUsed: grounded ? 0 :
jump.airJumpsUsed` for the same reason — the authoritative `grounded` is only available after
the probe.

`JumpStep` gains two fields:

```ts
/** Seconds of buffered press to carry, or 0. */
jumpBuffer: number
/** Whether a jump fired this frame, so the caller can close the coyote window. */
jumped: boolean
```

`jumped` is returned rather than derived from `jumpVelocityY !== null` at the call site because
the two are the same fact and one of them should be the name. A caller that re-derived it would
be a second place to keep in step.

### `stepJump`'s airborne branch, in order

1. **Inside the coyote window** (`state.coyoteTime > 0`): track the charge exactly as the
   grounded branch does, and let a release fire `releaseSpeed(chargeTime, c)` — a real ground
   jump, at the ground jump's speed, spending no air jump.
2. **Otherwise, a fresh press with an air jump left**: the air jump, exactly as today.
3. **Otherwise, a fresh press with no air jump left**: set `jumpBuffer` to
   `c.jumpBufferSeconds` and fire nothing.

### `stepJump`'s grounded branch

Before anything else: if `state.jumpBuffer > 0`, fire `c.jumpSpeed` and clear the buffer.

**Uncharged, and that is consistent rather than arbitrary.** `src/player/jump.ts:60` already
refuses to start a charge from a key carried across a landing — "A hold is tracked only from a
fresh grounded press, so a key carried over from before a landing cannot start a charge." So
the held key was never going to charge anyway, and firing the tap immediately is what the
player asked for by pressing.

## What the chosen numbers can and cannot do

`chargeThresholdSeconds` is 0.2 — **twice** the 0.1 s coyote window. So the window cannot let a
charge *complete* in the air. What it carries is a charge **already accumulated on the
ground**: hold Space while walking, which moves at `chargeWalkFactor` 0.4, step off the edge,
release within 6 frames, and the charged jump that was earned on solid ground is the one that
fires.

A charge *started* at the ledge can never mature inside the window. That is a real limit of
these two numbers rather than a flaw in the mechanism, and it is pinned by a test rather than
left to be discovered in play.

## One edge deliberately accepted

Press fresh inside the coyote window, then release after the window has closed, and the release
falls through to the air-jump branch and spends the air jump. Closing that would need a third
state field recording "a coyote charge is live", and holding past 0.1 s off a ledge is not the
case this cycle exists to fix.

**Correction: the release does not spend the air jump, and the sentence above was wrong about
that from the start.** The air-jump branch fires on `input.actionPressed`, and a release is not
a press, so such a release falls through *every* branch: no jump, no air jump spent, nothing
buffered — which is the pre-cycle behaviour for that one input, exactly. Measured during
implementation and now pinned by `jump.test.ts`'s "a press inside the window released after it
closed is dropped", which asserts all three. So the accepted cost is the lost jump alone, and
the edge is cheaper than this section claimed. What survives is the decision itself: the edge
stays open, because closing it needs that third state field and holding past 0.1 s off a ledge
is not this cycle's case.

## Out of scope

- **Retuning `chargeThresholdSeconds`** so a charge could complete inside the coyote window.
  That changes how every charged jump on solid ground feels, to serve one edge case, and the
  existing value should be judged in play first.
- **Coyote time for the dash or the scooter.** `stepDash` and `stepScooter` both take
  `grounded` and both would need their own windows and their own tuning. The scooter in
  particular deactivates the instant the body leaves the ground, which is a deliberate rule,
  not an oversight.
- **Buffering anything other than the jump.** Gust, dash, Slipstream and the staff all fire on
  a press with no landing to wait for.
- **Making the air jump buffer-able.** With an air jump in hand a press still spends it
  mid-air, as today. The air jump is a resource the player chooses to spend, and silently
  converting it into a landing jump would take that choice away.

## Testing

Every case below fails on today's code and passes after. Each names the change that must break
it.

- **The discriminating case, the ground-charge carry.** Charge 0.5 s while grounded, walk off,
  release 3 frames later. Expected: `releaseSpeed(0.5 + 3/60)` — `9 + (20 - 9) × (0.55 / 1.5)`
  ≈ **13.03 m/s**. Today: gravity only. The implementation must measure and assert the real
  figure rather than restating this one; if it differs, the measurement wins and this line is
  wrong. Neutralised by making the coyote branch ignore `chargeTime`, which must redden.
- **The press that vanishes.** Press on the last grounded frame, release one frame later.
  Today `-0.667`; after, a real jump. Asserted against the jump speed, not merely "positive",
  because one frame of an air jump would also be positive.
- **All five buffer timings** — 1, 2, 3, 5 and 8 frames before landing, air jump already spent
  — each producing a jump on the landing frame. Asserted as a table so a fix that works at 1
  frame and not at 8 cannot pass.

  **Correction: four of the five, not all five, and this bullet asked for something the chosen
  numbers cannot do.** 8 frames at 60 Hz is 133 ms against a `jumpBufferSeconds` of 100 ms, so
  the eighth-frame press is outside the window by arithmetic. Measured after implementation: 1,
  2, 3, 4 and 5 frames before touchdown jump; 6, 7 and 8 do not. The last one in is the fifth
  and not the sixth because the countdown starts on the frame the press is made, so a press five
  frames out has been decayed six times before a grounded frame reads it. The measurement wins
  and this bullet was wrong; the table in `ground-move.test.ts` runs 1 through 8 so the boundary
  is asserted next to the inside of the window, and it keeps all five of the timings named here.
  Raising `jumpBufferSeconds` to about 0.15 would honour the eighth frame, which is a feel
  decision for whoever plays it rather than a defect to fix.

- **The window's extent, not only its existence.** Added during review: the coyote window closes
  six frames past the edge and no later, asserted as a jump at six and none at seven. Without it
  the whole suite passes at any non-zero `coyoteSeconds` — measured green at 0.05, 0.5 and 1.0,
  and a full second is unlimited free ground jumps off every surface.

- **A slam bounce must close the window.** Also added during review, and a regression this
  cycle's own first implementation shipped: `applyBounce` reads a grounded frame, where the
  window is pinned full, and sets `grounded: false`. Carrying the window across that let a tap
  in the next six frames override the bounce with a slower ground jump — 15.450 m/s becoming
  9.000, peak 5.839 m becoming 2.100 m, on §4.3's combo and with no timing coincidence needed.
  Asserted on the peak, because height is the symptom.
- **A press outside the buffer window is still discarded**, at a timing beyond
  `jumpBufferSeconds`. Without this the buffer could be unbounded and every test above would
  still pass.
- **Coyote does not grant a third jump.** Ground jump, air jump, then a third press: nothing.
  This is the assertion most likely to be got wrong, because it is the one the "pin it while
  grounded" rule protects, and the rule's whole subtlety is that the jump itself must zero the
  window.
- **A normal ground jump zeroes the window** rather than leaving it armed — checked directly on
  the returned state, since the previous case would also pass if the air jump happened to be
  the thing that ran out.
- **Landing re-arms the window**, so the forgiveness is not once per life.
- **The two windows are independent**: a zero `coyoteSeconds` leaves the buffer working and a
  zero `jumpBufferSeconds` leaves coyote working. This is what the "safe degradation" claim
  above rests on, so it is asserted rather than argued.

## What will not be verified

How any of it feels. The 0.1 s windows are the platformer standard, not a measurement of this
game, and this environment cannot hold a pointer lock, so nothing in this cycle will have been
played. The two windows and their interaction with `chargeThresholdSeconds` 0.2 are the values
most worth a human's hands.

---

## Addendum: the buffer collided with the glider deploy

**This section corrects the most serious omission in the design above.** The spec specified the
buffer's arming condition as "airborne, a fresh press, no air jump left" and never checked that
condition against the rest of the game's input handling. It is the same condition
`controllerStep` already uses to deploy the glider:

```ts
if (input.actionPressed && !state.grounded && !canAirJump(state, deps.ground)
    && !staffBusy(staffOf(state))) {
```

That gate runs *before* `groundStep`, so it consumes the press first. `Space` with no air jump
left is the game's intended way to open the wings — jump, jump, then deploy — which means the
press the buffer exists to catch is already spoken for.

Measured through `controllerStep`:

| state | press produces |
| --- | --- |
| airborne, air jump spent, staff idle | `mode: 'glider'`, `jumpBuffer` 0 |
| airborne, air jump spent, mid-swing | `mode: 'ground'`, `jumpBuffer` 0.0833 |
| airborne, air jump spent, `chain > 0` | `mode: 'ground'`, `jumpBuffer` 0.0833 |

So in production the buffer could only ever arm while a staff swing, combo chain or recovery
was live. The ordinary input the spec describes — press before landing — went ground jump, air
jump, glider deploy, and never buffered. The cycle's second feature was very nearly dead code,
and no test caught it because every buffer test called `groundStep` directly and so never met
the gate that runs above it.

### The fix: the deploy yields when you are about to land

The deploy gate gains one more condition — it does not fire when the player would reach the
ground before the buffer window expires. In that case the press falls through to `groundStep`,
arms the buffer, and fires the jump on landing.

The threshold needs **no new tuning value**, which is what makes it the right rule rather than
a second guess: the question "would I land before the buffer expires?" is asked with
`jumpBufferSeconds` itself. Predict the fall over that window from the current descent speed
and gravity, cast down that far, and if there is ground within it, this press is a landing jump
rather than a deploy.

```ts
/**
 * How far the player will fall in one buffer window, from this descent speed.
 *
 * The distance is the same integration the simulation runs, so the prediction and the fall
 * cannot disagree about where the ground is.
 */
export function fallWithinBufferWindow(velocityY: number, c: GroundConfig): number
```

Only while descending. A rising player is not about to land, and gating a deploy on the way up
would break the documented combo where a slam bounce is re-deployed at the top of its arc.

### What this changes about the deploy, and why it is an improvement rather than a cost

Opening the wings three frames before hitting the ground was already a poor outcome — the
deploy kick fires, the wings unfold, and the player lands and stows immediately. Making the
deploy yield near the ground means the move goes where it was aimed. The design document calls
the staff-versus-wing choice its central risk decision, and this does not touch that: the staff
still blocks the deploy, and the deploy still costs the air jump first.

What it does change is that a player pressing `Space` low over a ledge gets a jump rather than a
glide. That is a real behavioural change to a documented control and it is the thing most worth
judging in play.

### Testing

- The three-row table above, re-measured through `controllerStep`, with the staff-idle row now
  arming the buffer when the ground is close.
- A press at altitude still deploys — the same input, high up, must be unchanged, or the fix has
  simply broken the glider.
- A press while **rising** near the ground still deploys, so the slam-bounce re-deploy survives.
- The buffered jump fires on landing through the full `controllerStep` path, not only through
  `groundStep`. That is the gap that hid this defect: every existing buffer test bypasses the
  gate.
- The predicted fall distance matches the simulated fall over the same window, asserted against
  a real integration rather than against the formula restated.

### Measured after implementation

The table above holds, with the staff-idle row now reading `mode: 'ground'`, `jumpBuffer`
0.0833 when the ground is inside the window and still `mode: 'glider'`, `jumpBuffer` 0 at
altitude. Both are asserted through `controllerStep` in `controller.test.ts`.

**One thing the addendum did not say, and the fix depends on it.** The buffer's usable span is
five frames rather than the six `jumpBufferSeconds` nominally buys — the spec's earlier
correction established that — while the predicted distance is a full window's worth of fall.
Those two do not obviously meet, and if the prediction reached further than the buffer there
would be a band of heights where a press bought neither a glide nor a jump. It cannot happen,
because `groundStep` integrates semi-implicitly and so covers more ground per window than the
closed form predicts: measured at 10 m/s of descent, 1.1 m predicted against 1.11667 m
simulated, the difference being exactly half a frame of gravity times the window. So any ground
the gate reports as reachable is reached within six frames, which puts the press at most five
frames from touchdown — inside the buffer. `ground-move.test.ts` asserts the shortfall and its
sign across four descent speeds, and `controller.test.ts` walks the worst case (1.09 m, the far
edge of the reach) end to end: the press is yielded, and the jump comes out six frames later.
