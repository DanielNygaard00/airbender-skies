# Render interpolation

Written 2026-08-04.

Interpolate the visible positions of gameplay entities between fixed simulation steps, so
movement renders smoothly on displays whose refresh rate does not match the 60 Hz
simulation rate.

## Why

The simulation advances in fixed `FIXED_DT` steps (`src/core/loop.ts`) so the flight model
behaves identically at every refresh rate — that stays. But the renderer draws whatever the
last step produced. On a 120 Hz or 144 Hz display, several rendered frames show identical
positions and then jump, which reads as judder even though the simulation is perfectly
regular. The same mismatch appears on a 60 Hz display whenever a frame is dropped.

The accumulator already knows how far into the next step the current frame sits
(`pendingTime()`), so the renderer can draw entities at `previous + (current − previous) ×
alpha` instead of snapping to the last step. The simulation is untouched; this is a
rendering feature only.

## Scope

Gameplay entities only: the player avatar, the camera, and enemy soldiers. Cosmetic
animations — effect particles, waterfalls, spinning shrine markers, wind tells, the
character's skeletal animation — keep advancing inside the fixed step at 60 Hz. Their
motion is drift and spin rather than fast travel, so step-rate updates are not visible the
way a gliding player snapping between positions is. They can migrate piecemeal later if it
ever shows.

## Architecture

### `src/core/loop.ts` (changed)

The render callback gains two arguments:

```ts
export interface LoopCallbacks {
  update(dt: number): void
  render(alpha: number, frameDt: number): void
}
```

`alpha` is `accumulator / fixedDt` after stepping — the fraction of a simulation step that
has elapsed but not yet been simulated, always in `[0, 1)`. `frameDt` is the real elapsed
seconds fed to `advance`, which the camera's render-phase smoothing needs. The
invalid-elapsed early return passes the current alpha and a `frameDt` of `0`. The stepping
logic itself does not change.

### `src/core/interpolation.ts` (new)

A small, fully unit-tested module owning the snapshot-and-lerp arithmetic so `main.ts`
stays glue:

```ts
export interface InterpolatedVector {
  /** Roll current into previous and store the new current. */
  record(current: Vector3): void
  /** Write previous.lerp(current, alpha) into out. Snaps when the step jumped. */
  sample(alpha: number, out: Vector3): Vector3
  /** Forget the previous value, so the next sample returns current unblended. */
  reset(): void
}

export function createInterpolatedVector(snapDistance?: number): InterpolatedVector
```

**The snap rule.** If previous and current are farther apart than `snapDistance`
(default 20 m), `sample` returns current with no blending. A respawn or any future
teleport moves the player across the map in one step, and interpolating through it would
streak the avatar across the sky for a frame. 20 m per step is 1200 m/s of travel —
far beyond anything the flight model produces, including the air blast dash — so no
legitimate movement can trip it.

**First sample.** Before the first `record`, or after `reset`, `sample` returns the
current value unblended rather than lerping from a stale or zero previous.

### `src/main.ts` (restructured)

`update(dt)` keeps everything it has today except the avatar placement, camera, and the
enemy-view position. At the end of the step it records into the interpolators: player
position, player forward, and each enemy's position (keyed by enemy id, entries created on
first sight).

A new `syncVisuals(alpha, frameDt)` runs once per rendered frame, wired as the stepper's
render callback together with the draw call:

- The avatar object is placed at the interpolated player position and faced along the
  interpolated forward (same `lookAt` guard against a zero-length forward as today).
- Enemy views `sync` exactly as today — pose, tint, health bar all read the current enemy
  state — and then the view object's position is overwritten with the interpolated one.
  Pose changes at step rate are imperceptible; travel is what judders.
- The camera runs here now: `desiredCameraPosition` from the interpolated player position
  and the last-sampled look direction, `pullInForTerrain`, then `smoothTowards` with the
  real `frameDt`. `smoothTowards` is already exponential-decay smoothing
  (`1 − exp(−k·dt)`), so moving it from fixed steps to frames changes nothing at 60 Hz and
  simply produces more intermediate samples above it. FOV keeps reading the current
  velocity magnitude — a scalar that changes smoothly anyway.

`followSun` (the shadow frustum) stays in `update`; a shadow map recentred at 60 Hz is
imperceptible. The guide-open branch in `frame` keeps rendering the last state directly
and is untouched.

The look direction used by the camera is whatever the last `input.sample()` returned,
held in a variable `update` refreshes. Mouse input therefore still enters at step rate;
the render-phase smoothing eases toward it, which is enough for this pass.

## What could go wrong

- **A visual placed in the wrong phase.** Anything written in `update` after
  `syncVisuals` has run for the frame would be overwritten or lag a frame. The split
  keeps a hard rule: `update` writes simulation state and records snapshots; only
  `syncVisuals` touches the avatar object's transform, the camera, and enemy-view
  positions.
- **Enemies appearing or going away.** Interpolator entries are created on first sight
  (first sample returns current, no blend from a stale origin) and the map is keyed by
  enemy id, so a future encounter reset cannot blend across two different soldiers'
  positions.
- **Zero steps in a frame.** On a 144 Hz display many frames run zero simulation steps;
  alpha still advances because the accumulator grew, and `sample` blends further toward
  current. This is the normal case, not an edge case.

## Testing

- `loop.test.ts`, extended: render receives `alpha = accumulator / fixedDt` across
  zero-step, one-step, and multi-step frames; alpha stays in `[0, 1)`; `frameDt` passes
  through; the invalid-elapsed path renders with `frameDt` 0.
- `interpolation.test.ts`, new: lerp arithmetic at alpha 0, 0.5, and 1-epsilon; `record`
  rolls current into previous; the snap rule fires beyond `snapDistance` and not below
  it; first sample and post-`reset` sample return current unblended.
- The existing suite and both typecheck configs must stay green. The simulation is
  untouched, so no test churn is expected outside `loop.test.ts`.
- Runtime check on a 60 Hz display: the game must look and play identically to before —
  that is the pass criterion. The smoothness gain itself only shows above 60 Hz, so it is
  proven by the unit tests rather than by eye.
