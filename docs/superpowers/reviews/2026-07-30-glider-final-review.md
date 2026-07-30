# Glider staff — final whole-branch review

**Date:** 2026-07-30
**Branch:** `feature/glider-staff` → `main`
**Scope at review:** 6 commits, 6 files, +433/−13. 331 tests, typecheck clean, build succeeding.
**Verdict:** merge after fixing one defect. Fixed; re-reviewed; merged.

This is a condensed record. The full reasoning lived in the branch's coordination workspace, which
is deleted once merged; what is kept here is the defect, the fix, and the lesson — because the
lesson generalises well beyond this feature.

## The defect: an inverted fore-aft sign

Three per-task reviews, a discarded prototype, and thirteen headless geometry assertions all passed
over it.

For a plain `Object3D`, Three.js `lookAt` aligns local **+Z** with the target direction. Only
`Camera` and `Light` use −Z. Verified empirically against the installed three r185:

```
Object3D.lookAt(+X):  local +Z -> (1.000, 0.000, 0.000)
Camera.lookAt(+X):    local -Z -> (1.000, 0.000, -0.000)
child at local z=+0.5, parent facing +X -> world x +0.500
```

`src/main.ts` calls `avatar.object.lookAt(...)` on a plain `Group`, so avatar-local **+Z is the
character's front**. The glider's constants were written assuming the opposite, with three
consequences measured against the real assembly:

| | measured | consequence |
| --- | --- | --- |
| Stowed | world z `0.046 … 0.554` | staff entirely on the **chest**, mid-section **inside** the capsule mesh (offset 0.30 against a 0.40 capsule radius) |
| Stowed | `min.y = −0.059` | lower tip **6 cm through the terrain** while walking, since the avatar origin is the feet |
| Deployed | world z `−1.441 … −0.252` | wing entirely **behind** the rider, contradicting the spec's silhouette |

The staff being embedded in the body is why a browser screenshot still showed "a staff slung across
the avatar" — the ends poked clear, so it looked plausible.

A second, pre-existing defect surfaced with it: the placeholder avatar's direction cone sat at
`z = −0.45`, so it had pointed **backwards** since it was written. The glider plan had cited that
cone as evidence that −Z was forward. The plan inferred from a bug.

## The lesson: extents are invariant to sign

The plan carried a pre-validation table produced by prototyping the geometry and measuring it —
span, height, depth, and the top of the wing. Every one of those is an **extent** or a **maximum**.
Not one is a **signed position**.

So the prototype measured the right quantities and could not have caught the error. Neither could
any of the thirteen geometry tests, for the same reason. Prototyping was not the weak link;
choosing sign-invariant measurements was.

The generalisation, worth applying to any transform expressed in a parent frame:

> If the parent frame's forward axis is not written down somewhere, assert **signed positions**, not
> extents. A bounding box's width cannot tell you which way anything faces.

The three assertions added by the fix are the correct class, and each fails against the pre-fix
constants:

```ts
expect(span(createGlider()).box.max.z).toBeLessThan(0)          // stowed: behind the chest
expect(span(createGlider()).box.min.y).toBeGreaterThanOrEqual(0) // not through the floor
expect(span(deployed).box.min.z).toBeGreaterThan(0)             // deployed: ahead of the rider
```

## Also found

- **`attachModel` silently destroyed the glider.** It called `object.clear()`, removing every child
  of `avatar.object` — including the glider, which `main.ts` parents there. `main.ts` would keep
  calling `glider.update()` on an orphan forever, with nothing thrown and nothing logged. The spec's
  known limitation described a wrong parent; the real behaviour was a silent disappearance. Latent
  (nothing calls `attachModel` yet), fixed defensively by tracking the placeholder and removing only
  that.
- **A structural test resting on an accident.** The shared-pivot regression guard filtered fan roots
  on `children.length > 0`, which works only because a `Mesh` has no children and a `Group` does.
  Tightened to `=== PANELS_PER_SIDE`, which asserts the invariant.
- **A 180° yaw snap near vertical**, pre-existing in the avatar: `lookAt` with the default `up = +Y`
  is ill-conditioned when the facing vector is vertical, and `steerToward`'s geodesic between two
  85°-pitched vectors of opposing yaw passes through straight up. Rare, and not this branch's bug —
  but a 2.4 m wing makes the resulting snap far louder than a symmetric capsule did.

## Parked

`DEPLOYED_POSITION.z` ended at `1.1` rather than the `0.4` a simple sign flip would give, because
the fan sweeps in **one** direction (0 → `FAN_SPREAD`), so its mass is offset from the pivot and
`0.4` still left part of the wing behind the rider. The assertion demanding the wing be *entirely*
ahead was stricter than the spec's "slightly ahead", and satisfying it pushed the wing further
forward than intended.

The underlying shape question is open: Aang's glider is roughly symmetric fore-aft about the staff,
and a symmetric sweep (`±FAN_SPREAD / 2`) would centre the wing on the pivot and likely look better.
That changes tested fan geometry, so it was deferred rather than folded into a fix wave.

## Declined, with reasons

- Eight identical three-vertex `BufferGeometry` instances instead of one shared. Allocated once at
  startup, never per frame; materials are shared so draw-call batching is unaffected.
- Two low-discriminating-power tests (`constructs without throwing`, `produces finite geometry when
  stowed`). Subsumed by the mid-animation fuzz check, but free and they document intent.

## Still owed to a human

The interactive choreography in a foregrounded browser — pointer lock was refused in automation and
the tab stayed hidden, so `requestAnimationFrame` never advanced. Specifically worth checking
**where** the staff sits, not merely that it appears and moves: that distinction is exactly the gap
the sign error slipped through.
