# Jump System: Double Jump, Charge Jump, and Snap-Back Fix

**Date:** 2026-07-31
**Status:** Approved

## Overview

Three changes to ground movement:

1. **Bug fix:** jumping while over an island teleports the character back to the
   ground mid-descent, because the ground snap fires from up to `snapDistance`
   (1.2 m) away whenever the character is falling.
2. **Double jump:** one extra jump while airborne.
3. **Charge jump:** holding Space while grounded charges a much higher jump,
   released on key-up.

The Space key keeps all jump and glider actions, resolved as an escalation
chain: jump → double jump → glider deploy.

## 1. Snap-back bug fix (`src/player/ground-move.ts`)

The snap logic in `groundStep` gets two regimes, keyed on `state.grounded`
(the previous frame's value):

- **Was grounded** (walking): unchanged — while descending, snap down to any
  surface within `snapDistance`. This preserves slope and edge stick.
- **Was airborne** (jumping or falling): no distance-based snap. The character
  lands only on contact: after position integration, if the raycast hit
  satisfies `position.y <= hit.point.y`, clamp `position.y` to the surface,
  zero `velocity.y`, and set `grounded = true`. Otherwise keep falling.

The downward raycast still runs every descending frame from the same probe, so
landing is exact and there is no tunneling; the contact check only gates the
clamp.

**Root cause reference:** normal jump apex is `jumpSpeed² / (2·gravity)` =
`9² / 40` ≈ 2.0 m, so the old 1.2 m snap consumed more than half the descent
and read as a teleport.

## 2. Input changes (`src/core/input.ts`, `src/core/types.ts`)

`InputState` gains two fields:

- `actionHeld: boolean` — Space is currently down (`held.has('Space')`).
- `actionReleased: boolean` — edge-triggered on Space key-up, cleared by
  `sample()`, mirroring `actionPressed`.

`actionPressed` is unchanged. The window `blur` handler clears held keys as it
does today and does **not** fire the release edge — the jump module treats
`actionHeld` going false without a release edge as a silent charge cancel, so
a focus loss can neither leave a charge stuck on nor launch a jump while the
window is unfocused.

OS key auto-repeat is ignored for the press edge: the `keydown` handler only
sets `actionPressed` when `e.repeat` is false. A repeated keydown from a held
key is not a fresh press — letting it through would reset an in-progress
charge roughly thirty times per second and could spend the air jump
uncommanded.

## 3. State and config (`src/core/types.ts`, `src/core/config.ts`)

`PlayerState` gains:

- `airJumpsUsed: number` — reset to 0 on any landing.
- `chargeTime: number` — seconds Space has been held while grounded;
  0 means not charging.

`GroundConfig` gains:

| Field | Default | Meaning |
| --- | --- | --- |
| `maxAirJumps` | 1 | Extra jumps available while airborne |
| `airJumpSpeed` | 9 | Vertical speed set by a double jump |
| `chargeThresholdSeconds` | 0.2 | Holds shorter than this are taps |
| `chargeMaxSeconds` | 1.5 | Hold time for a full charge |
| `chargedJumpSpeed` | 20 | Vertical speed at full charge (apex ≈ 10 m) |
| `chargeWalkFactor` | 0.4 | Movement speed multiplier while charging |

## 4. Jump module (`src/player/jump.ts`)

A new pure module in the repo's module-per-concern style:

```ts
stepJump(state, input, dt, c: GroundConfig):
  { chargeTime, airJumpsUsed, jumpVelocityY: number | null, walkFactor: number }
```

Rules:

- **Grounded + `actionPressed`:** begin hold tracking; `chargeTime`
  accumulates each frame while `actionHeld`.
- **Grounded + `actionReleased`:**
  - `chargeTime < chargeThresholdSeconds` → `jumpVelocityY = jumpSpeed`
    (a tap: normal jump).
  - otherwise → `jumpVelocityY` lerps from `jumpSpeed` to `chargedJumpSpeed`
    by `min(chargeTime, chargeMaxSeconds) / chargeMaxSeconds`.
- **Charging** is defined as `chargeTime >= chargeThresholdSeconds`. While
  charging, `walkFactor = chargeWalkFactor`, otherwise 1. Applied to the
  desired horizontal velocity in `groundStep`. Holds below the threshold move
  at full speed, so taps never stutter.
- **Charge cancels** (`chargeTime = 0`) if the character leaves the ground
  mid-charge (walking off an edge), or if `actionHeld` goes false without a
  release edge (window blur); a mid-air release then fires nothing.
- **Airborne + `actionPressed` + `airJumpsUsed < maxAirJumps`:**
  `jumpVelocityY = airJumpSpeed` and `airJumpsUsed` increments. The velocity is
  set, not added, so a double jump feels consistent even when falling fast.
- **Landing** by any path (ground contact, glider landing, respawn) resets
  `airJumpsUsed` and `chargeTime`.
- A charge never starts from a carried-over held key (for example, Space still
  held through a glider landing); it requires a fresh `actionPressed` while
  grounded.

`groundStep` drops its inline
`if (state.grounded && input.actionPressed) velocityY = c.jumpSpeed` and
consumes `stepJump`'s output instead. Note this moves the normal jump from
press-triggered to release-triggered, bounded by the 0.2 s tap threshold.

## 5. Controller routing (`src/player/controller.ts`)

In ground mode while airborne, an `actionPressed` resolves as:

1. `airJumpsUsed < maxAirJumps` → route into `groundStep`, which performs the
   double jump.
2. otherwise → deploy the glider (existing path).

This yields the Space escalation chain: jump → double jump → glide. Kite
landing and respawn both reset the jump fields.

## 6. Feedback

Minimal for now: the avatar crouches during charge — a vertical squash
proportional to `chargeTime / chargeMaxSeconds`, driven through the existing
`avatar-anim.ts` path. No HUD change; a charge bar can be added later if
wanted.

## 7. Testing

Vitest, colocated `.test.ts` files per repo convention:

- `jump.test.ts`: tap fires a normal jump; a held charge fires a scaled jump;
  full charge caps at `chargedJumpSpeed`; charge cancels on ground loss;
  double jump works once then is exhausted; fields reset on landing; a
  carried-over held key does not start a charge.
- `ground-move.test.ts` additions: regression test — a jump over an island
  completes its full arc with no snap during descent until contact; slope
  stick while walking is preserved.
- `controller.test.ts` additions: airborne press #1 performs a double jump and
  press #2 deploys the glider; glider landing resets `airJumpsUsed`.
- `input.test.ts` additions: `actionHeld` and `actionReleased` pass through
  `toInputState` correctly. (`InputTracker`'s DOM handlers are not unit-tested
  — vitest runs in the `node` environment; the blur invariant is instead
  covered by the jump module's silent-cancel test.)

## Out of scope

- HUD charge indicator.
- Any change to kite-mode flight physics.
- Rebinding the glider to a different key.
