# The Dodge Costs Breath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge the Slipstream breath so chain-dodging stops being free infinite speed, and send the glider's dodge perpendicular to the flight path in three dimensions instead of straight forward along the ground plane.

**Architecture:** `stepSlipstream` gains the available breath as an argument and reports what it spent, keeping the "return it, don't apply it" contract it already has for the impulse. `flight.ts` gains `gliderRight`, the third axis of the frame `gliderUp` already builds, and the glider's dodge heading becomes ±that axis. `stepSlipstream` stops flattening its impulse.

**Tech Stack:** TypeScript 7.0.2, three.js 0.185.1, Vitest 4.1.10 (node environment).

## Global Constraints

- Run `npm run typecheck` after every code change: two passes, `tsconfig.json` then `tsconfig.test.json`.
- `noUncheckedIndexedAccess` is on. Any array index yields `T | undefined`.
- Pure functions: never mutate arguments. Clone before writing to any `Vector3` a caller owns.
- Config is injected, never imported, by modules under `src/player/`. Test files may import it.
- `breathCost` is exactly **28**. The dodge's other numbers do not change: `speed` 30, `durationSeconds` 0.2, `invulnerableSeconds` 0.11, `cooldownSeconds` 1.5.
- Comments explain *why*, in full English sentences, at this codebase's high density.
- Commit messages, comments and documentation are normal full English prose.
- Never commit to `main`. Work stays on the current branch, `dodge-costs-breath`.

### On writing falsifiable tests — read this before writing any test

The previous cycle on this branch shipped **six** assertions that could not fail: they were green whether or not the feature worked. Every one was caught by someone running a neutralisation rather than trusting the reasoning. The two shapes to avoid:

- **Asserting a side effect that holds either way.** One test asserted `position.y > worldFloorY` to prove a player does not fall through an island — but the controller respawns a fallen player and hands back a position above ground, so it stayed green through exactly the bug it named.
- **A threshold so loose both outcomes satisfy it.** One asserted `z > 0.5` to distinguish "slid along the wall" (z ≈ 6.76) from "stopped dead" (z = 5).

So for **every** test in this plan: before moving on, name the change it would catch, then make that change, run the test, and confirm it fails. Restore afterwards. If it stays green, **the test is wrong, not the claim** — fix the test and report that you did.

---

### Task 1: A dodge spends breath

**Files:**
- Modify: `src/player/slipstream.ts` (`SlipstreamConfig`, `canSlipstream`, `stepSlipstream`)
- Modify: `src/core/config.ts` (`DEFAULT_SLIPSTREAM_CONFIG`)
- Modify: `src/player/controller.ts` (deduct what was spent)
- Modify: `src/main.ts:253` (the readiness indicator now needs breath)
- Modify: `src/ui/guide/actions.ts:141-147` (the Slipstream's detail text)
- Test: `src/player/slipstream.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `SlipstreamConfig.breathCost: number`
  - `canSlipstream(state: SlipstreamState, breath: number, c: SlipstreamConfig): boolean`
  - `stepSlipstream(state, pressed, heading, breath, dt, c): { state: SlipstreamState; impulse: Vector3 | null; breathSpent: number }`

- [ ] **Step 1: Write the failing tests**

Read `src/player/slipstream.test.ts` first — it has a `fire()` helper and an `advance()` helper that every existing test uses, and both need the new argument. Update them, then add:

```ts
describe('a dodge costs breath', () => {
  it('does not fire when there is less breath than it costs', () => {
    const out = stepSlipstream(idleSlipstream(), true, NORTH, S.breathCost - 0.01, 1 / 60, S)
    expect(out.impulse).toBeNull()
  })

  it('does not spend the cooldown on a press it could not afford', () => {
    // The press has to be a no-op, not a wasted dodge. Spending the cooldown would
    // punish a player twice for being out of breath.
    const out = stepSlipstream(idleSlipstream(), true, NORTH, 0, 1 / 60, S)
    expect(out.state.cooldown).toBe(0)
    expect(out.state.elapsed).toBeNull()
  })

  it('fires at exactly its cost', () => {
    expect(stepSlipstream(idleSlipstream(), true, NORTH, S.breathCost, 1 / 60, S).impulse)
      .not.toBeNull()
  })

  it('reports exactly what it spent', () => {
    expect(stepSlipstream(idleSlipstream(), true, NORTH, 100, 1 / 60, S).breathSpent)
      .toBe(S.breathCost)
  })

  it('spends nothing on a frame with no dodge', () => {
    expect(stepSlipstream(idleSlipstream(), false, NORTH, 100, 1 / 60, S).breathSpent).toBe(0)
  })

  it('spends nothing on a press it could not afford', () => {
    expect(stepSlipstream(idleSlipstream(), true, NORTH, 0, 1 / 60, S).breathSpent).toBe(0)
  })

  it('costs more than thrust would to gain the same speed', () => {
    // The whole point of the number. Thrust buys thrustAccel per breathDrainPerSecond;
    // a dodge buys speed/cooldownSeconds per breathCost/cooldownSeconds. If the dodge
    // ever became the cheaper way to accelerate, chain-dodging would be optimal again.
    const thrustRatio = DEFAULT_FLIGHT_CONFIG.thrustAccel / DEFAULT_FLIGHT_CONFIG.breathDrainPerSecond
    const dodgeRatio = S.speed / S.breathCost
    expect(dodgeRatio).toBeLessThan(thrustRatio)
  })
})

describe('canSlipstream', () => {
  it('is false with too little breath even when off cooldown', () => {
    expect(canSlipstream(idleSlipstream(), S.breathCost - 0.01, S)).toBe(false)
  })

  it('is true with enough breath and no cooldown', () => {
    expect(canSlipstream(idleSlipstream(), S.breathCost, S)).toBe(true)
  })
})
```

`S` is the existing alias for `DEFAULT_SLIPSTREAM_CONFIG` in that file; `DEFAULT_FLIGHT_CONFIG` needs importing for the ratio test.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/player/slipstream.test.ts`
Expected: FAIL — `breathCost` is not on the config and the signatures take five arguments.

- [ ] **Step 3: Implement it**

In `src/player/slipstream.ts`, add to `SlipstreamConfig`:

```ts
  /**
   * Breath a dodge spends, deducted the frame it fires.
   *
   * Chosen against thrust, because the two are alternatives for gaining speed and the
   * dodge has to be the worse of them. Thrust buys `thrustAccel` 22 for
   * `breathDrainPerSecond` 18, a ratio of 1.22; a dodge buys `speed` 30 over
   * `cooldownSeconds` 1.5 for this cost over the same 1.5, a ratio of `speed / breathCost`.
   * They break even at 25. Above that, thrust is the efficient way to go faster and the
   * dodge is what you spend when you need the invulnerability — which is the ordering the
   * move is supposed to have, and a test pins it.
   */
  breathCost: number
```

Then the two functions:

```ts
/** Not already dashing, off cooldown, and able to pay for it. */
export function canSlipstream(
  state: SlipstreamState, breath: number, c: SlipstreamConfig,
): boolean {
  return state.elapsed === null && state.cooldown <= 0 && breath >= c.breathCost
}
```

In `stepSlipstream`, take `breath: number` between `heading` and `dt`, gate the firing branch on the new `canSlipstream`, and return `breathSpent`:

```ts
  if (pressed && canSlipstream(state, breath, c)) {
    const direction = heading.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : heading.clone().normalize()
    return {
      state: { elapsed: 0, cooldown: c.cooldownSeconds },
      impulse: direction.multiplyScalar(c.speed),
      breathSpent: c.breathCost,
    }
  }
```

Both non-firing returns get `breathSpent: 0`.

Note the direction line drops the flatten that was there. Task 2 depends on that, and the reason belongs there — for now, replace `new Vector3(heading.x, 0, heading.z)` with the un-flattened form above and leave explaining it to Task 2. The ground dodge is unaffected because `slipstreamHeading` already returns a horizontal vector.

In `src/core/config.ts`, add `breathCost: 28` to `DEFAULT_SLIPSTREAM_CONFIG`, and extend that block's existing docblock with one sentence on what 28 buys: three dodges from a full bar, and — because breath regenerates at 12/s airborne but 30/s grounded via `breathRegenGroundedMultiplier` — a cost repaid in 0.93 s on foot against 2.33 s in the glider, so the same rule leaves the ground dodge freely available and makes the glider's a decision.

- [ ] **Step 4: Deduct it in the controller**

In `src/player/controller.ts`, the slipstream block near the end already adds the impulse to `next.velocity`. Pass `next.breath` in, and subtract what came back:

```ts
  const slip = stepSlipstream(
    { elapsed: next.slipstreamElapsed, cooldown: next.slipstreamCooldown },
    input.slipstreamPressed,
    dodgeHeading(next.mode, next.forward, input.lookDirection, input.forward, input.strafe),
    // Read after the posture branches, so this is the breath the branch settled: the
    // glider's drain from thrust or hover, or the ground branch's regeneration. A
    // pre-step value would let a player spend breath the same frame they ran out of it.
    next.breath,
    dt,
    deps.slipstream,
  )
  next = {
    ...next,
    slipstreamElapsed: slip.state.elapsed,
    slipstreamCooldown: slip.state.cooldown,
    velocity: slip.impulse ? next.velocity.clone().add(slip.impulse) : next.velocity,
    // Clamped at 0 so a rounding error can never drive the bar negative, which would
    // read as a permanently unusable dodge.
    breath: Math.max(0, next.breath - slip.breathSpent),
  }
```

- [ ] **Step 5: Update the readiness indicator**

`src/main.ts:253` calls `canSlipstream` for the guide panel's availability dot. It now needs the breath and the config:

```ts
      slipstreamReady: canSlipstream(
        { elapsed: player.slipstreamElapsed, cooldown: player.slipstreamCooldown },
        player.breath,
        DEFAULT_SLIPSTREAM_CONFIG,
      ),
```

This is a free improvement rather than an obligation: the dot now goes dark when the dodge is unaffordable, not only when it is on cooldown. Check `DEFAULT_SLIPSTREAM_CONFIG` is already imported in that file before adding an import.

- [ ] **Step 6: Update the guide text**

`src/ui/guide/actions.ts:141-147` describes the Slipstream. Its existing sentence "in the glider, bank left or right to dodge sideways, since thrust and flare are not directions" is already correct and Task 2 makes the code match it — leave that alone. Add the cost: that it spends breath, and that this is why it cannot be chained forever.

There is a drift test comparing action keys against the README's controls table. Check whether `README.md` describes the Slipstream's cost anywhere, and if it does, update it to match.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test`
Expected: clean and green. Existing tests in `slipstream.test.ts` needed their helpers updated; any other failure is a call site that was missed.

- [ ] **Step 8: Red-proof each test**

Four neutralisations, each with the test it must redden. Restore between them.

1. Drop `&& breath >= c.breathCost` from `canSlipstream`. Expected red: "does not fire when there is less breath than it costs", "is false with too little breath even when off cooldown".
2. Return `breathSpent: 0` from the firing branch. Expected red: "reports exactly what it spent".
3. Set `breathCost` to 24 in the test's own config object — not the shipped one. Expected red: "costs more than thrust would to gain the same speed".
4. Remove the `Math.max(0, ...)` clamp in the controller and set `breathCost` above `baseMaxBreath`. Expected red: nothing in this suite, because no test covers the clamp. **That is a gap — add a controller test that a dodge cannot drive breath below zero**, then re-run this neutralisation and confirm it reddens.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Charge the Slipstream breath, so chaining it stops being free speed

The dodge added 30 m/s for nothing. Measured over 40 seconds against the
shipped config, pressing it on cooldown climbed from y 300 to y 434 and
reached 76.9 m/s with a full breath bar, where a plain glide sank to 151
and 23.1. The glide loses half its energy, which is what gliding is;
chain-dodging gained 81% of it.

flight.ts guards this carefully and the guard was bypassed rather than
broken: its lift fallback insists on staying perpendicular to velocity
because "a component along the flight path would do work and inject
energy, breaking the invariant that gliding never gains height." That
invariant holds inside flightStep. The dodge impulse is added one call
up, after the integrator has run.

28 is set against thrust, because they are alternatives for gaining speed
and the dodge must be the worse one. Thrust buys 22 m/s^2 for 18 breath a
second; a dodge buys an average 20 m/s^2 for breathCost over the same 1.5
seconds. They break even at 25, so 28 sits just past it and a test pins
the ordering rather than the number.

The gate is hard: below the cost, the press does nothing and the cooldown
is not spent. Being caught unable to dodge is the point -- it gives
spending breath on thrust a defensive cost.

One rule, and the postures differ for free. Breath regenerates at 12/s
airborne and 30/s on the ground, so the same 28 is repaid in 0.93s on
foot -- inside the dodge's own 1.5s cooldown, leaving the ground dodge as
available as it was -- and in 2.33s in the glider, which is longer than
the cooldown, so chaining runs the bar down. That difference comes from a
multiplier that already existed rather than from a special case.

The guide panel's availability dot now darkens when the dodge is
unaffordable, not only when it is on cooldown.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The glider dodge goes perpendicular, in three dimensions

**Files:**
- Modify: `src/player/flight.ts` (add `gliderRight`)
- Modify: `src/player/slipstream.ts` (`dodgeHeading`'s glider branch; the flatten comment)
- Test: `src/player/flight.test.ts`, `src/player/slipstream.test.ts`

**Interfaces:**
- Consumes: `stepSlipstream`'s un-flattened impulse from Task 1.
- Produces: `gliderRight(forward: Vector3, bank: number): Vector3`, exported from `src/player/flight.ts`.

**Why this is a defect and not a preference.** Two measurements. `dodgeHeading('glider', new Vector3(0,0,-1), …, 0, 0)` produces an impulse of `[0, 0, -30]` — straight forward, for the input a player who is not holding A or D generates, which is the common case. And dodging while diving along `(0,-1,-1)` produces an impulse whose `y` is exactly 0. The guide panel already tells players to "bank left or right to dodge sideways"; the code did not do that.

- [ ] **Step 1: Write the failing tests for `gliderRight`**

In `src/player/flight.test.ts`. Read the file for how it already tests `gliderUp` and follow it.

```ts
describe('gliderRight', () => {
  const HEADINGS = [
    new Vector3(0, 0, -1),
    new Vector3(1, 0, 0),
    new Vector3(0, -1, -1).normalize(),
    new Vector3(0.3, 0.8, -0.5).normalize(),
    new Vector3(0, 1, 0),   // vertical: the case gliderUp handles explicitly
    new Vector3(0, -1, 0),
  ]

  it('is perpendicular to the heading, for every heading', () => {
    for (const forward of HEADINGS) {
      expect(Math.abs(gliderRight(forward, 0).dot(forward)))
        .toBeLessThan(1e-6)
    }
  })

  it('is perpendicular to the glider up axis too, so the three make a frame', () => {
    for (const forward of HEADINGS) {
      expect(Math.abs(gliderRight(forward, 0).dot(gliderUp(forward, 0))))
        .toBeLessThan(1e-6)
    }
  })

  it('is unit length', () => {
    for (const forward of HEADINGS) {
      expect(gliderRight(forward, 0).length()).toBeCloseTo(1, 6)
    }
  })

  it('rolls with the bank, so a banked dodge is not horizontal', () => {
    // The reason this is derived from gliderUp rather than from a world-up cross:
    // a world-up cross is horizontal for every heading, so a banked glider's lateral
    // dodge would be flat no matter how far over it was rolled.
    expect(Math.abs(gliderRight(new Vector3(0, 0, -1), 0).y)).toBeLessThan(1e-6)
    expect(Math.abs(gliderRight(new Vector3(0, 0, -1), 0.6).y)).toBeGreaterThan(0.1)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/player/flight.test.ts`
Expected: FAIL — `gliderRight` is not exported.

- [ ] **Step 3: Implement `gliderRight`**

In `src/player/flight.ts`, directly after `gliderUp`:

```ts
/**
 * The glider's right axis: the third leg of the frame `gliderUp` builds.
 *
 * Derived from `gliderUp` rather than recomputed from a world-up cross, and the
 * difference matters. `cross(forward, WORLD_UP)` is horizontal for every heading, so a
 * dodge along it would be flat however far the glider was rolled. Rolling the up axis
 * and taking the cross against forward carries the bank through, and it inherits
 * `gliderUp`'s handling of a vertical heading rather than needing its own.
 */
export function gliderRight(forward: Vector3, bank: number): Vector3 {
  return new Vector3().crossVectors(gliderUp(forward, bank), forward).normalize()
}
```

- [ ] **Step 4: Run and confirm the tests pass**

Run: `npx vitest run src/player/flight.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the glider dodge's direction**

In `src/player/slipstream.test.ts`:

```ts
describe('a glider dodge goes across the flight path, not along it', () => {
  it('is perpendicular to the heading when no bank is held', () => {
    // The defect: this used to fall back to the flattened heading, so the most common
    // press -- nobody holds A or D continuously -- was a 30 m/s forward boost with
    // invulnerability attached.
    const forward = new Vector3(0, 0, -1)
    const heading = dodgeHeading('glider', forward, new Vector3(0, 0, -1), 0, 0)
    expect(Math.abs(heading.dot(forward))).toBeLessThan(1e-6)
  })

  it('keeps a vertical component when dodging out of a dive', () => {
    // It used to be flattened, so a dodge in a dive was a shove across the ground plane
    // rather than across the flight path.
    const diving = new Vector3(0, -1, -1).normalize()
    const out = stepSlipstream(
      idleSlipstream(), true, dodgeHeading('glider', diving, NORTH, 0, 1), 100, 1 / 60, S,
    )
    expect(Math.abs(out.impulse!.y)).toBeGreaterThan(0.1)
  })

  it('takes its side from the bank axis', () => {
    const forward = new Vector3(0, 0, -1)
    const left = dodgeHeading('glider', forward, NORTH, 0, -1)
    const right = dodgeHeading('glider', forward, NORTH, 0, 1)
    expect(left.dot(right)).toBeLessThan(-0.9)
  })

  it('leaves the ground dodge horizontal and camera-relative', () => {
    // The ground rule is unchanged, including that it can go backwards. Asserted here
    // because Task 1 removed the flatten from stepSlipstream, and this is what proves
    // that removal did not leak into the posture that wants flat.
    const back = dodgeHeading('ground', NORTH, new Vector3(0, 0.7, -0.7).normalize(), -1, 0)
    expect(back.y).toBe(0)
    expect(back.z).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 6: Run and confirm failure**

Run: `npx vitest run src/player/slipstream.test.ts`
Expected: FAIL on the first three — the glider branch still returns the flattened heading.

- [ ] **Step 7: Rewrite the glider branch of `dodgeHeading`**

In `src/player/slipstream.ts`, replace the glider branch and its comment. Import `gliderRight` from `./flight`.

```ts
  // In the glider the movement keys mean something else: W is airbending thrust and S is
  // a flare. Reading them as translation made holding S dodge *backwards* for an input
  // that only meant "raise the nose", and since W is the normal flying state it turned
  // almost every glider dodge into a forward one.
  //
  // So a glider dodge is lateral, along the glider's own right axis, with the bank axis
  // choosing the side and a default side when nothing is held. Perpendicular to the
  // flight path by construction, for any heading, because `gliderRight` is an axis of a
  // frame built on `forward` -- which is what beats something coming straight at you, and
  // is what the guide panel has told players the move does all along. It rolls with the
  // bank, so a banked glider's dodge is not horizontal.
  //
  // A default side rather than a fallback to the heading: falling back to forward made
  // the no-bank press -- the common one -- a free 30 m/s boost.
  if (mode === 'glider') {
    const right = gliderRight(gliderForward, 0)
    return strafeAxis < 0 ? right.negate() : right
  }
  return slipstreamHeading(lookDirection, forwardAxis, strafeAxis)
```

`bank` is passed as 0 rather than the strafe axis, deliberately: the strafe axis is choosing which *side* to dodge to here, and also feeding it in as roll would make a right-hand dodge tilt differently from a left-hand one for no reason a player could read. The bank the glider is actually flying at is not available to `dodgeHeading` — it is derived inside `flightStep` from `input.strafe * 0.6` — and threading it through is a change worth making on purpose rather than as a side effect of this one. Note it in your report.

- [ ] **Step 8: Run and confirm the tests pass**

Run: `npx vitest run src/player/slipstream.test.ts src/player/flight.test.ts`
Expected: PASS.

- [ ] **Step 9: Explain the un-flatten**

Task 1 removed the flatten from `stepSlipstream` without saying why. Add the reason there now, next to the normalisation: the impulse follows the heading in all three axes because a glider dodge is perpendicular to the flight path and can have a vertical component; the ground dodge is unaffected because `slipstreamHeading` returns a horizontal vector already.

- [ ] **Step 10: Red-proof**

Three neutralisations, restoring between them.

1. Change `gliderRight` to `cross(forward, WORLD_UP)`. Expected red: "rolls with the bank, so a banked dodge is not horizontal".
2. Return `slipstreamHeading(gliderForward, 0, strafeAxis)` from the glider branch, the old behaviour. Expected red: "is perpendicular to the heading when no bank is held" and "keeps a vertical component when dodging out of a dive".
3. Restore the flatten in `stepSlipstream`. Expected red: "keeps a vertical component when dodging out of a dive".

- [ ] **Step 11: Run everything and commit**

Run: `npm run typecheck && npm test`

```bash
git add -A
git commit -F - <<'EOF'
Send the glider's dodge across the flight path instead of along it

Two measurements. A glider dodge with no bank held produced an impulse of
[0, 0, -30] -- straight forward, for the input a player who is not
holding A or D generates, which is most of them most of the time. So the
commonest press was a 30 m/s boost with invulnerability attached rather
than a dodge. And a dodge while diving along (0,-1,-1) produced an
impulse whose y was exactly 0, a shove across the ground plane rather
than across the flight path.

The guide panel has told players since it was written that in the glider
you "bank left or right to dodge sideways, since thrust and flare are not
directions". The documentation was right and the code did not do it.

gliderRight is the third leg of the frame gliderUp already builds, and is
derived from it rather than from a world-up cross for a reason:
cross(forward, WORLD_UP) is horizontal for every heading, so a dodge
along it would stay flat however far the glider was rolled. Deriving it
also inherits gliderUp's handling of a vertical heading instead of
needing its own.

stepSlipstream no longer flattens its impulse, which is what lets the
vertical component through. The ground dodge is untouched, because
slipstreamHeading already returns a horizontal vector -- and a test pins
that, since the un-flatten is exactly the kind of change that leaks into
the posture that wanted flat.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Prove the hole is closed

**Files:**
- Create: `src/player/dodge-energy.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: nothing code depends on.

This is the test the cycle exists for. The unit tests prove a dodge costs breath and points sideways; this proves the exploit is gone, by running the real controller for forty seconds exactly as the original measurement did.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG,
} from '../core/config'
import { controllerStep, type ControllerDeps } from './controller'
import { totalEnergy } from './flight'
import type { InputState, PlayerState } from '../core/types'

/**
 * The Slipstream is not a way to fly.
 *
 * It used to be the cheapest one. Pressing it on cooldown for forty seconds from y 300
 * climbed to y 434 and reached 76.9 m/s with the breath bar still full, where a plain
 * glide over the same span sank to y 151 and 23.1 m/s. The glide loses half its energy,
 * which is what gliding is; chain-dodging gained 81 percent of it, because the impulse is
 * added in `controllerStep` after `flightStep` has run and so escapes the
 * never-gains-height invariant the integrator is careful to keep.
 *
 * Run against the real archipelago rather than a fake, so nothing about the terrain query
 * or the collision resolution can quietly change what this measures.
 */
function deps(): ControllerDeps {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  const terrain = createTerrainQuery(islands)
  return {
    terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    spawnPointFor: () => new Vector3(0, 40, 0),
    slipstream: DEFAULT_SLIPSTREAM_CONFIG,
    staff: DEFAULT_STAFF_CONFIG,
    collision: DEFAULT_COLLISION_CONFIG,
  }
}

function input(over: Partial<InputState> = {}): InputState {
  return {
    lookDirection: new Vector3(0, 0, -1),
    forward: 0, strafe: 0, sprint: false, tuck: false,
    actionPressed: false, actionHeld: false, actionReleased: false,
    scooterPressed: false, dashPressed: false, gustPressed: false,
    avatarStatePressed: false, vortexHeld: false, vortexReleased: false,
    slipstreamPressed: false, staffPressed: false,
    ...over,
  }
}

function glider(): PlayerState {
  return {
    mode: 'glider',
    position: new Vector3(0, 300, 0),
    velocity: new Vector3(0, 0, -30),
    forward: new Vector3(0, 0, -1),
    breath: 100, maxBreath: 100,
    grounded: false, lastGroundIslandId: 'home',
    airJumpsUsed: 0, chargeTime: 0,
    scooterActive: false, scooterCharge: 0,
    dashesUsed: 0, dashRecovery: 0,
    slipstreamElapsed: null, slipstreamCooldown: 0,
    staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
  }
}

/** Forty seconds, dodging on cooldown or never. Returns what forty seconds produced. */
function fly(dodge: boolean) {
  const d = deps()
  let p = glider()
  const start = totalEnergy(p.position, p.velocity, DEFAULT_FLIGHT_CONFIG.gravity)
  let dodges = 0
  for (let frame = 0; frame < 2400; frame++) {
    const ready = dodge && p.slipstreamCooldown <= 0 && p.slipstreamElapsed === null
    const before = p.slipstreamCooldown
    p = controllerStep(p, input({ slipstreamPressed: ready }), 1 / 60, d)
    if (p.slipstreamCooldown > before) dodges++
  }
  return {
    y: p.position.y,
    speed: p.velocity.length(),
    breath: p.breath,
    dodges,
    energyRatio: totalEnergy(p.position, p.velocity, DEFAULT_FLIGHT_CONFIG.gravity) / start,
  }
}

describe('chain-dodging is no longer a way to gain altitude for free', () => {
  it('ends lower than it started, like a glide, rather than 134 m higher', () => {
    const chained = fly(true)
    expect(chained.dodges, 'the test must actually be dodging').toBeGreaterThan(0)
    expect(chained.y).toBeLessThan(300)
  })

  it('runs the breath bar down instead of leaving it full', () => {
    // The measurement that made this a bug rather than a tuning question: 27 dodges over
    // forty seconds, and the bar never moved.
    expect(fly(true).breath).toBeLessThan(100)
  })

  it('loses energy over forty seconds rather than gaining it', () => {
    const chained = fly(true)
    expect(chained.energyRatio).toBeLessThan(1)
  })

  it('is worse than a plain glide at keeping altitude, not better', () => {
    // Compared against the control in the same test rather than against a remembered
    // constant, so retuning the flight model cannot silently invert the comparison while
    // both numbers drift.
    const plain = fly(false)
    const chained = fly(true)
    expect(chained.energyRatio).toBeLessThanOrEqual(plain.energyRatio + 0.35)
  })

  it('still lets a fight have several dodges in it', () => {
    // The cost must not make the move useless. A full bar buys at least three.
    expect(Math.floor(100 / DEFAULT_SLIPSTREAM_CONFIG.breathCost)).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run it and record the real numbers**

Run: `npx vitest run src/player/dodge-energy.test.ts --reporter=verbose`

Add a `console.log` of both result objects while you develop, read the actual figures, and **put them in the file's docblock** as the after-measurement beside the before. Then remove the log. If any assertion fails, the numbers are telling you something — report what they say rather than adjusting the bound to fit.

The fourth assertion's `+ 0.35` slack is a guess on my part. Replace it with a bound derived from the numbers you actually measure, and say in your report what you chose and why.

- [ ] **Step 3: Red-proof**

Set `breathCost` to 0 in `DEFAULT_SLIPSTREAM_CONFIG`. Expected red: all four of the first assertions, reproducing something close to the original y 434 / 76.9 m/s / full bar. Confirm it does, restore, and put the observed neutralised figures in your report — they are the proof this test measures the exploit and not something adjacent to it.

- [ ] **Step 4: Commit**

```bash
git add src/player/dodge-energy.test.ts
git commit -F - <<'EOF'
Pin that chain-dodging cannot climb for free

The regression test this cycle exists for. It runs the real controller
over the real archipelago for forty seconds, dodging on cooldown, and
asserts the flight ends lower than it started with breath spent -- the
opposite of the measurement that opened the cycle, where the same forty
seconds climbed from y 300 to y 434 and reached 76.9 m/s with a full bar.

The plain glide runs in the same test as a control, and the comparison is
between the two measured numbers rather than against remembered
constants, so retuning the flight model cannot silently invert it while
both figures drift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Read the handoff**

Read `docs/HANDOFF.md` in full and match its structure and voice. It records reasoning and measurements for whoever picks the project up next, not a changelog. Note that the previous cycle added a testing-discipline section; this cycle's numbers belong wherever that convention puts them.

- [ ] **Step 2: Write the section**

Cover:

- The before-and-after table: plain glide 151 m / 23.1 m/s / ×0.51 energy against chain-dodging's original 434 m / 76.9 m/s / full breath / ×1.81, and the figures Task 3 measured after the change.
- Why it was a bug and not a tuning question: `flightStep` keeps a never-gains-height invariant and documents it in its lift fallback; the dodge is added one call up, in `controllerStep`, and escapes it.
- `breathCost` 28 and how it was chosen — the break-even against thrust at 25, and that a test pins the ordering rather than the number, so retuning thrust cannot silently make the dodge optimal again.
- The hard gate, and that being caught unable to dodge is deliberate.
- That one rule produces different behaviour per posture for free, via `breathRegenGroundedMultiplier`: 0.93 s to repay on foot against 2.33 s in the glider.
- `gliderRight`, and why it is derived from `gliderUp` rather than from a world-up cross.
- That the guide panel already described the intended glider dodge correctly and the code did not match it — worth recording as a case where the documentation was the reliable artifact.
- What is *not* fixed: a single dodge still adds 30 m/s and is not energy-neutral; the bank the glider is actually flying at is not available to `dodgeHeading`, so a dodge rolls with the strafe axis only through `gliderRight(forward, 0)` — currently no roll at all — and threading the real bank through is an available next step.

- [ ] **Step 3: Commit**

```bash
git add docs/HANDOFF.md
git commit -F - <<'EOF'
Record the dodge-costs-breath cycle in the handoff

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Self-Review

**Spec coverage.** The breath cost, its number and its reasoning are Task 1, including the hard gate and the readiness indicator the spec did not mention but which `main.ts` forces. The 3D perpendicular direction and `gliderRight` are Task 2, along with the un-flatten the spec requires. Every test the spec's Testing section lists has a home: the cost tests and `canSlipstream` in Task 1, `gliderRight` and the direction tests in Task 2, the forty-second regression in Task 3. The spec's three out-of-scope items go into Task 4's handoff so they are recorded rather than forgotten.

**Placeholders.** None. Two places deliberately hand a decision to the implementer with instructions to report it: Task 3's `+ 0.35` slack, which I flag as my guess and ask to be replaced with a measured bound, and Task 2's note that the real bank is not threaded through. Both are honest unknowns, not deferred work.

**Type consistency.** `canSlipstream(state, breath, c)` and `stepSlipstream(state, pressed, heading, breath, dt, c)` have the same argument order in the spec, Task 1's implementation, Task 1's tests, the controller call and the `main.ts` readiness call. `breathSpent` is named identically in the return type, the implementation and the controller. `gliderRight(forward, bank)` matches `gliderUp(forward, bank)`'s shape, is exported from the same file, and is called with `(gliderForward, 0)` in Task 2 — which is consistent, and flagged there as a deliberate choice rather than an oversight.

**One risk this review cannot settle.** Task 1's step 8 predicts that neutralisation 4 reddens nothing, and tells the implementer to add the missing controller test rather than accept the gap. That is the right instruction, but it means Task 1 ships a test the plan did not write. Expect it in the diff.
