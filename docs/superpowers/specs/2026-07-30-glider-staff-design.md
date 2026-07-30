# Glider Staff — Design

**Date:** 2026-07-30
**Status:** Accepted
**Repository:** `DanielNygaard00/airbender-skies`
**Follows:** [the first version's design](2026-07-30-airbender-skies-design.md)

## Summary

Give the player a visible glider: a closed staff carried across the character's back that fans
open into a wing overhead when the kite is deployed, and folds away when it is stowed.

Today kite mode is invisible. Pressing Space changes the physics, the camera profile and the
animation the character requests, but nothing appears in the player's hands — they fly a capsule.
This adds the object that makes flight read as airbending rather than as falling sideways.

## Goals

1. Deploying and stowing the kite are visible events with a motion, not state changes.
2. The stowed state has presence, so the glider reads as equipment the character carries.
3. The flight model is not touched.

## Non-goals

Rolling the wing with bank input. Deforming the fabric with airspeed. Attaching to a rigged
character's hand. A separate stow animation distinct from playing the deploy in reverse. Any
change to physics, tuning constants, or the existing test baselines.

## The silhouette

Aang's staff-glider: a closed wooden staff that fans open into a ribbed, bat-like wing held
above and slightly ahead of the rider, who hangs below it.

This was chosen over three alternatives. A delta hang-glider wing is simpler geometry and matches
the rigid-wing lift model most honestly, but reads as sport equipment rather than as an
airbender's tool. A paraglider canopy is closest to the Zelda control scheme the game's steering
was modelled on and inflates beautifully, but it hangs far above the character and fights the
close third-person camera. Back-mounted wings keep the silhouette tightest, but leave nothing to
carry when stowed, so the folded state would be invisible — and the folded state is half of what
this feature is for.

## Architecture

### A new module, and why the avatar is left alone

The glider lives in a new `src/player/glider.ts`. It is not added to `src/player/avatar.ts`,
which owns the character model, the `AnimationMixer`, and the placeholder-to-real-model swap.
Those are a different concern, and that module already carries the delicate `attachModel` path.

`src/main.ts` parents the glider under the avatar:

```ts
const glider = createGlider()
avatar.object.add(glider.object)
```

so it inherits the character's position and facing for free, and is updated alongside the avatar
in the existing frame sequence:

```ts
glider.update(dt, player.mode === 'kite')
```

### One value drives the whole motion

A single `openness` float — 0 stowed, 1 deployed — eased over roughly 0.3 seconds. It
simultaneously interpolates two things:

- **The staff transform**, from lying diagonally across the character's back to held horizontally
  overhead and slightly forward. Two constant transforms, linearly interpolated.
- **The panel fan**, four thin triangular panels per side, eight in total. At `openness` 0 each
  panel is rotated flat against the staff; at 1 they spread to their fanned angles.

Driving both from one number is what makes it read as a single motion: the staff swings up as the
wing blooms, rather than two animations happening near each other. It also means stowing is
simply the same interpolation running toward 0, so no separate close animation is needed.

The panels rotate rather than the geometry being rebuilt, so nothing is allocated per frame.

### Geometry

Procedurally built, no assets — consistent with the project's CC0-only rule and with the
precedent set by the waterfall texture, which is generated from the seeded PRNG for the same
reason.

| Part | Geometry | Colour |
| --- | --- | --- |
| Staff | thin cylinder | `0x6b4a2f`, warm wood |
| Panels | flat triangles | `0xe0913f`, orange-tan fabric |
| Ribs | slim boxes on each panel's leading edge | `0x5a3c26`, darker than the staff |

The fabric colour echoes the existing direction cone (`0xd9863f`) so the character and the glider
read as one palette, and lands in Air Nomad territory.

### Load-bearing interface

Two pure functions carry all the logic worth testing:

```ts
/** Eased, frame-rate independent, clamped to [0, 1]. Reverses cleanly mid-open. */
function advanceOpenness(
  current: number, deployed: boolean, dt: number, seconds: number,
): number

/** Fan geometry: where panel `index` of `count` sits at this openness. Radians. */
function panelAngle(
  index: number, count: number, openness: number, spread: number,
): number
```

`createGlider()` returns `{ object: Object3D; update(dt: number, deployed: boolean): void }`. The
Three.js assembly around those two functions is thin, and is verified by eye rather than by unit
test — the same deliberate split already used for the HUD, the input adapter, the avatar's mixer
half, and the waterfall meshes, all of which touch DOM or GPU state that vitest's `node`
environment does not provide.

## What is explicitly not touched

`flightStep`, `steerToward`, `controllerStep`, `groundStep`, `DEFAULT_FLIGHT_CONFIG` and
`DEFAULT_GROUND_CONFIG` are all unchanged. Two Critical defects in the flight model were fixed
immediately before this work — a camera that pinned itself to island roofs and a kite that glided
backwards out of a vertical fall — and the flight tests encode measured behaviour that a human
tuning pass has not yet re-baselined. Purely visual work has no business disturbing any of that.

The consequence is a detail the design accepts knowingly: for the ~0.3 seconds the wing is
opening, lift is already at full strength. At 60 frames a second, against a wing that is mostly
behind the camera, this is not observable. Making lift ramp with the fan was considered and
rejected precisely because it would have required redoing the tuning lap.

## Error handling

There is very little to go wrong: no assets, no IO, no external state. `advanceOpenness` clamps
its result to `[0, 1]` so a large or non-finite `dt` cannot drive the fan past its limits or into
NaN, which would otherwise propagate into panel rotations and corrupt the mesh transforms.

## Testing

`advanceOpenness` and `panelAngle` are pure and unit-tested: that openness rises toward 1 when
deployed and falls toward 0 when not, stays in range across a long run, is frame-rate independent
to a tight tolerance, reverses correctly when the deploy is interrupted mid-open, and that panel
angles are monotonic across the fan, collapse to a single angle at openness 0, and never produce
non-finite values.

The assembled meshes are verified by eye: staff on the back while walking, fanning overhead on
deploy, folding away on stow, and no console errors.

## Known limitations, accepted

1. **Re-parenting will be needed for a rigged character.** The glider hangs off the avatar root,
   which is right for the placeholder capsule and wrong for a skeleton — a real model wants it
   parented to a hand or spine bone. `avatar.ts`'s `attachModel` does not currently know the
   glider exists.
2. **The wing does not roll with bank input.** The physics banks the kite by
   `input.strafe * 0.6`, and matching that visually would need input plumbed through to the
   glider. Deferred: it is not required to answer "opens and closes", and it is a small follow-up.
