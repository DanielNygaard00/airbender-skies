# Wind On Foot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the air act on the whole character rather than only on the wing, so a thermal lifts a falling body and a downdraft catches a jump.

**Architecture:** `groundStep` takes a `WindSample` defaulting to `stillAir()` and applies its acceleration while airborne. `controllerStep` samples the air with `state.forward` for that branch. The glider branch is untouched, keeping its own sample with its own steered heading.

**Tech Stack:** TypeScript 7.0.2, three.js 0.185.1, Vitest 4.1.10 (node environment).

## Global Constraints

- Run `npm run typecheck` after every code change: two passes, `tsconfig.json` then `tsconfig.test.json`.
- `noUncheckedIndexedAccess` is on.
- Config is injected, never imported, by modules under `src/player/`. Test files may import it.
- Pure functions never mutate arguments.
- **Do not modify the glider branch of `controllerStep`.** It samples wind after `steerToward` and that ordering is what makes ridge lift respond to trimming.
- Comments explain *why*, in full English sentences, at this codebase's high density.
- Commit messages and documentation are normal full English prose.
- Never commit to `main`. Work stays on the current branch, `wind-on-foot`.

### On numbers and assertions — read this before writing any test

The three previous cycles on this repo produced two distinct failure shapes, and both are traps here.

**Eight assertions that could not fail**, each asserting a *relationship* both the correct and the broken implementation satisfy: `Math.abs(y) > 0.1` (either sign passes), `cross(a,b)·b == 0` (an identity), `position.y > worldFloorY` (a respawn puts it back above ground), `z > 0.5` where both outcomes were 5 and 6.76.

**Three wrong measured numbers**, each written into a comment that no assertion covered — scooter turn times off by 0.12 s, a claim that a riding dash travels further "by less than a frame's travel" that was out by 10× and 25×, and a claim that two decay rates were "the same quantity" when one was linear and the other exponential.

So, for every test: name the change it would catch, make that change, run it, confirm it fails, restore. And **every number you write into a comment must also be asserted** — `toBeCloseTo` at a sensible precision — so it cannot drift from the code. Paste the raw command output into your report, not just the conclusion; that is what surfaced the last wrong figure.

---

### Task 1: The air acts on a falling body

**Files:**
- Modify: `src/player/ground-move.ts` (`groundStep` gains `wind`)
- Modify: `src/player/controller.ts` (sample the air for the ground branch)
- Test: `src/player/ground-move.test.ts`, `src/player/controller.test.ts`

**Interfaces:**
- Consumes: `WindSample` and `stillAir` from `src/world/wind.ts` — `{ accel: Vector3; liftScale: number }`, and `stillAir()` returns a zero accel with `liftScale` 1.
- Produces: `groundStep(state, input, dt, terrain, c, collision, wind?)` — a seventh parameter, `wind: WindSample`, defaulting to `stillAir()`.

**Why this is a defect.** `src/world/wind.ts` says the air is terrain, "something the player reads and routes through, the way they read a ledge". `controllerStep` calls `deps.windAt` inside the glider branch only, so `groundStep` never sees it. Measured: a falling player in a fabricated 500 m/s² updraft — twenty-five times gravity — goes from y 200 to y 189.8 in one second, identical to still air.

- [ ] **Step 1: Write the failing tests**

In `src/player/ground-move.test.ts`. Read the file for its `input()`, `player()`, `flatGround`, `voidWorld` and `COLLISION` helpers and follow them. Import `stillAir` from `'../world/wind'`.

```ts
describe('the air acts on a body that is off the ground', () => {
  const UPDRAFT = { accel: new Vector3(0, 500, 0), liftScale: 1 }
  const RIVER = { accel: new Vector3(120, 0, 0), liftScale: 1 }

  /** One second of falling from y 200 over the void, with and without the air. */
  const fallTo = (wind: WindSample) => {
    let s = player({ position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3() })
    for (let frame = 0; frame < 60; frame++) {
      s = groundStep(s, input(), 1 / 60, voidWorld, G, COLLISION, wind)
    }
    return s.position
  }

  it('lifts a falling player in an updraft', () => {
    // Measured before this change: still air and a 500 m/s^2 updraft both put the player
    // at y 189.8 after a second -- indistinguishable, because groundStep never saw the
    // air at all. Compared against the still-air control rather than against a bound,
    // so the assertion cannot be satisfied by the broken behaviour.
    expect(fallTo(UPDRAFT).y).toBeGreaterThan(fallTo(stillAir()).y)
  })

  it('carries a falling player along a river', () => {
    expect(fallTo(RIVER).x).toBeGreaterThan(fallTo(stillAir()).x)
  })

  it('leaves a grounded player braced against it', () => {
    // The airborne limit. A player standing on rock is braced, and pushing them would also
    // fight the ground snap, which owns vertical placement for a grounded body.
    const grounded = () => {
      let s = player({ position: new Vector3(0, 0, 0), grounded: true })
      for (let frame = 0; frame < 60; frame++) {
        s = groundStep(s, input(), 1 / 60, flatGround, G, COLLISION, UPDRAFT)
      }
      return s.position
    }
    expect(grounded().y).toBeCloseTo(0, 6)
  })

  it('ignores liftScale, because a body without a wing has no lift to scale', () => {
    // Dead air is defined as a volume where a wing stops working, not one where gravity
    // changes. So it must do nothing at all on foot.
    const dead = { accel: new Vector3(), liftScale: 0 }
    expect(fallTo(dead).toArray()).toEqual(fallTo(stillAir()).toArray())
  })

  it('defaults to still air when no sample is given', () => {
    let withDefault = player({ position: new Vector3(0, 200, 0), grounded: false })
    let explicit = player({ position: new Vector3(0, 200, 0), grounded: false })
    for (let frame = 0; frame < 60; frame++) {
      withDefault = groundStep(withDefault, input(), 1 / 60, voidWorld, G, COLLISION)
      explicit = groundStep(explicit, input(), 1 / 60, voidWorld, G, COLLISION, stillAir())
    }
    expect(withDefault.position.toArray()).toEqual(explicit.position.toArray())
  })
})
```

Record the two `fallTo` altitudes — still air and updraft — in the describe block's comment, and **assert them** with `toBeCloseTo`, so the numbers cannot drift. Measure them; do not predict them.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/player/ground-move.test.ts`
Expected: FAIL — `groundStep` takes six parameters, and once it takes seven the updraft and river tests still fail because nothing applies the sample.

- [ ] **Step 3: Apply the air while airborne**

In `src/player/ground-move.ts`, add the parameter and apply it where the vertical velocity is settled, at what is currently line 109:

```ts
  const velocityY = jump.jumpVelocityY !== null
    ? jump.jumpVelocityY
    : state.velocity.y - c.gravity * dt
```

becomes, with the air folded in:

```ts
  // Gravity, then the air. Applied only while airborne: a player standing on rock is
  // braced against a thermal, and pushing a grounded body would fight the ground snap,
  // which owns vertical placement down there. Same division of labour terrain collision
  // already keeps -- one system owns the surface and the others leave it alone.
  //
  // wind.liftScale is deliberately ignored. It multiplies a wing's own lift, and a body
  // without a wing has none to scale, so dead air does nothing on foot. That is correct:
  // dead air is a volume where a wing stops working, not one where gravity changes.
  const airborne = !state.grounded
  const velocityY = jump.jumpVelocityY !== null
    ? jump.jumpVelocityY
    : state.velocity.y - c.gravity * dt + (airborne ? wind.accel.y * dt : 0)
```

and the horizontal component, where `horizontal` is already built:

```ts
  if (airborne) {
    horizontal.x += wind.accel.x * dt
    horizontal.z += wind.accel.z * dt
  }
```

Place that after the dash impulse is added and before `easeHorizontal`'s result is used to build `velocity` — read the surrounding code and put it where it composes rather than following this instruction blindly. Say in your report where you put it and why.

Note that a jump frame overrides `velocityY` entirely, so the air does not add to the instant of a jump — only to the flight after it. That is deliberate and worth a sentence: a jump's height is the jump's, and the air acts on the arc.

- [ ] **Step 4: Run and record the figures**

Run: `npx vitest run src/player/ground-move.test.ts --reporter=verbose`
Expected: PASS. Log the two altitudes, write them into the comment, assert them, remove the log.

- [ ] **Step 5: Sample the air for the ground branch**

In `src/player/controller.ts`, the ground branch currently calls:

```ts
      next = groundStep(state, input, dt, deps.terrain, deps.ground, deps.collision)
```

It becomes:

```ts
      // Sampled with state.forward, which on foot is the flattened camera direction --
      // where the character faces. Ridge lift and rivers ask which way the sampler points,
      // so a falling player who turns to look along a river gets carried by it. The glider
      // asks the same question with its steered heading, after steerToward has run; that
      // sample stays where it is, because moving it would change which heading the glider
      // asks with and its flight is the most heavily tested behaviour here.
      const groundWind = deps.windAt ? deps.windAt(state.position, state.forward) : stillAir()
      next = groundStep(state, input, dt, deps.terrain, deps.ground, deps.collision, groundWind)
```

`stillAir` needs importing into `controller.ts` if it is not already there — check, because the glider branch already uses it.

- [ ] **Step 6: Test that the controller threads it**

In `src/player/controller.test.ts`. This is the test that covers the default parameter's risk — that production forgets to pass the real sample — and it is the one that must exist:

```ts
it('feeds the air to a falling player on foot, not only to the glider', () => {
  // groundStep's wind parameter defaults to still air, so the danger is that the wiring
  // is simply absent and every test still passes. This is the test of the wiring.
  const windy = { ...deps(voidWorld), windAt: () => ({ accel: new Vector3(0, 500, 0), liftScale: 1 }) }
  const calm = deps(voidWorld)
  const start = player({ position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3() })
  let lifted = start
  let falling = start
  for (let frame = 0; frame < 60; frame++) {
    lifted = controllerStep(lifted, input(), 1 / 60, windy)
    falling = controllerStep(falling, input(), 1 / 60, calm)
  }
  expect(lifted.position.y).toBeGreaterThan(falling.position.y)
})

it('asks the air about the direction the character faces', () => {
  // A ridge lifts anyone moving along its face and a river carries anyone moving with it,
  // so the heading is part of the question. This asserts the argument reaches the sampler
  // rather than that some heading was passed.
  const seen: Vector3[] = []
  const spying = {
    ...deps(voidWorld),
    windAt: (_p: Vector3, forward: Vector3) => { seen.push(forward.clone()); return stillAir() },
  }
  const facing = new Vector3(1, 0, 0)
  controllerStep(
    player({ position: new Vector3(0, 200, 0), grounded: false, forward: facing }),
    input(), 1 / 60, spying,
  )
  expect(seen.length).toBeGreaterThan(0)
  expect(seen[0]!.x).toBeCloseTo(1, 6)
})
```

- [ ] **Step 7: Pin that the glider is unchanged**

```ts
it('leaves a glide exactly as it was', () => {
  // "Do not touch the glider" is an intention, and intentions need tests. A glide with a
  // sampler present must land where it did before this cycle.
  const windy = { ...deps(flatGround), windAt: () => stillAir() }
  let g = player({
    mode: 'glider', position: new Vector3(0, 300, 0), velocity: new Vector3(0, 0, -30),
    forward: new Vector3(0, 0, -1), grounded: false,
  })
  for (let frame = 0; frame < 120; frame++) {
    g = controllerStep(g, input({ lookDirection: new Vector3(0, 0, -1) }), 1 / 60, windy)
  }
  // Measure this once against the committed code and assert the figures, so a later change
  // to the glider's wind sampling cannot pass unnoticed.
  expect(g.position.y).toBeCloseTo(/* measured */, 4)
  expect(g.position.z).toBeCloseTo(/* measured */, 4)
})
```

Fill both figures from a real run. If either is unstable across runs, say so and drop this test rather than loosening it until it passes — an unstable pin is worse than none.

- [ ] **Step 8: Red-proof**

Three neutralisations, restoring between them.

1. Drop the `airborne ?` guard so the air applies to a grounded body. Expected red: "leaves a grounded player braced against it".
2. Revert `controllerStep`'s ground branch to the six-argument call. Expected red: both controller wiring tests. **This is the important one** — if they stay green the wiring is untested and the default parameter is a hole.
3. Apply `wind.liftScale` to the vertical velocity. Expected red: "ignores liftScale".

- [ ] **Step 9: Run everything and commit**

Run: `npm run typecheck && npm test`

```bash
git add -A
git commit -F - <<'EOF'
Let the air act on the whole character, not only on the wing

src/world/wind.ts opens by saying wind is level geometry rather than
weather -- "the air is terrain: lift is something the player reads and
routes through, the way they read a ledge". It was terrain for the glider
alone. controllerStep called windAt inside the glider branch and nowhere
else, so groundStep never saw the air: a falling player in a fabricated
500 m/s^2 updraft, twenty-five times gravity, went from y 200 to y 189.8
in a second. Identical to still air.

Now a thermal lifts a falling body and a downdraft catches a jump. Three
limits are deliberate. The air applies only while airborne, because a
player standing on rock is braced against it and pushing a grounded body
would fight the ground snap that owns vertical placement down there --
the same division of labour terrain collision already keeps. Only
wind.accel is used and never wind.liftScale, because that multiplies a
wing's own lift and a body without a wing has none, so dead air correctly
does nothing on foot. And a jump frame still sets its vertical speed
outright, so a jump's height is the jump's and the air acts on the arc.

The ground branch samples with state.forward, the flattened camera
direction, because ridge lift and rivers ask which way the sampler points.
The glider's own sample is untouched: it runs after steerToward, which is
what makes ridge lift respond to trimming, and its flight is the most
heavily tested behaviour here.

The wind parameter defaults to still air, so the real hazard is wiring
that is simply absent while every test still passes. Two tests cover the
wiring itself, and a third pins that a glide lands exactly where it did.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Documentation

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Read the handoff and match its voice**

It records reasoning and measurements for whoever picks this up next. It has a testing-discipline section built over three cycles; read it before extending.

- [ ] **Step 2: Write the section**

Cover:

- The measurement: y 200 to 189.8 in a 500 m/s² updraft, identical to still air, because `windAt` was called in one branch.
- What changed, and the three deliberate limits with their reasons — airborne only, `accel` only, and a jump frame keeping its own vertical speed.
- Why the ground branch samples with `state.forward` and why the glider's sample was left exactly where it is.
- The figures Task 1 measured and pinned.
- **A consequence worth flagging for play:** a thermal now gives the `climb-north` / `spire` / `beacon` progression a second route, since a player can ride one up on foot before deploying. Whether that is a shortcut worth closing is a tuning question for play, and this cycle deliberately does not pre-empt it.
- What is out of scope and why: arrows (drift interacts with the archer's ranges, tuned two cycles ago against still air — a balance change wearing a physics change's clothes) and enemies (ground-snapped, so wind does nothing until knockback puts them airborne, at which point it needs care not to drift soldiers off island rims and cheapen section 4.6's scoring).
- That none of it has been played, because the browser harness cannot hold pointer lock.

- [ ] **Step 3: Commit**

```bash
git add docs/HANDOFF.md
git commit -F - <<'EOF'
Record the wind-on-foot cycle in the handoff

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Self-Review

**Spec coverage.** The parameter, the airborne limit, the `liftScale` exclusion and the `state.forward` heading are all Task 1. Every test the spec lists has a home, including the two wiring tests and the glider pin. The spec's three out-of-scope items go into Task 2's handoff so they are recorded rather than forgotten.

**Placeholders.** Two, both deliberate and both instructions to measure rather than deferrals: the two `fallTo` altitudes in Step 1 and the two glider figures in Step 7. Step 7 also says what to do if the pin proves unstable — drop it, do not loosen it.

**Type consistency.** `groundStep`'s seventh parameter is `wind: WindSample` in the interfaces block, the implementation and every call. `WindSample` is `{ accel: Vector3; liftScale: number }` throughout, and `stillAir()` is the default in the signature and the control in four tests. `deps.windAt`'s signature — `(position: Vector3, forward: Vector3) => WindSample` — matches both the existing glider call and the new ground call.

**One risk this review cannot settle.** Step 7's glider pin asserts absolute positions after 120 frames of integration. If the flight model is retuned later, that test fails for a reason that is not a defect. That is the cost of pinning it, and the alternative — asserting nothing about the glider — is what would let an accidental change to its wind sampling through. Flagged so a future reader knows the failure is expected on a deliberate retune.
