# Character model design

**Date:** 2026-07-31
**Status:** approved, ready for planning
**Branch:** `worktree-character-model`

## Problem

The player is a capsule with a cone for a nose. The animation plumbing to replace
it already exists, but nothing ever feeds it a model, so the placeholder is all
anyone ever sees.

## What already exists

Three pieces are in place and need no redesign:

- `src/core/assets.ts` exposes `loadGLTF(url)`, which resolves `null` on any
  failure so a missing asset degrades to the placeholder instead of blanking the
  screen.
- `src/player/avatar.ts` exposes `attachModel(gltf)`, which swaps the placeholder
  for a real scene, builds an `AnimationMixer`, and cross-fades between clips.
  It deliberately removes only the placeholder rather than calling
  `object.clear()`, because the glider is also parented under `avatar.object`.
- `src/player/avatar-anim.ts` maps player state to one of five animation names:
  `idle`, `walk`, `run`, `fall`, `glide`.

The gap is that **`attachModel` is never called**. There is no model file and no
load call. This design closes that gap.

## Chosen asset

"Animated Human" by Quaternius, distributed through Poly Pizza.

- Committed to `public/models/character.glb`, 698,560 bytes.
- Source: `https://static.poly.pizza/170235d2-cdeb-4cb2-a82f-4828585138fe.glb`
- Model page: `https://poly.pizza/m/c3Ibh9I3udk`
- Exported by FBX2glTF v0.9.7, 51 nodes.

Poly Pizza labels the model Creative Commons Attribution, while Quaternius's own
distribution pages state CC0. `ASSETS.md` requires CC0 or equivalently
permissive, so this design records the stricter of the two readings — CC-BY, with
explicit credit to Quaternius — rather than assuming the more convenient one.

### Clips the model actually ships

Read out of the committed file, not assumed:

| Clip name | Duration |
| --- | --- |
| `Human Armature\|Idle` | 10.000s |
| `Human Armature\|Walk` | 1.000s |
| `Human Armature\|Run` | 0.625s |
| `Human Armature\|Jump` | 1.000s |
| `Human Armature\|Death` | 3.500s |
| `Human Armature\|Punch` | 1.000s |
| `Human Armature\|Working` | 6.417s |
| `Human Armature\|ArmatureAction.002` | 0.625s |

Three consequences drive the design below.

**Clip names carry an armature prefix.** The current code does
`clip.name.toLowerCase()` and looks the result up as an `AnimationName`. That
produces `"human armature|idle"`, which matches nothing. Every lookup would fail
silently and the character would stand frozen in its bind pose. Names must be
split on `|` with the last segment taken before matching.

**There is no `fall` clip and no `glide` clip.** `Jump` is the only airborne
motion available. `fall` reuses it. `glide` reuses it as well, held on a single
frame so the character keeps a steady airborne shape while on the kite instead of
visibly looping a jump.

**Scale cannot be a constant chosen by inspection.** The `CharacterArmature` node
carries `scale: [100, 100, 100]`, and the raw vertex bounds span only 0.08 units.
Measured through the full node hierarchy the model is **5.2594 units tall**, so
reaching the 1.8m target needs a factor of **0.3422**. Any hand-picked constant
would have been wrong by roughly 3x, so scale is measured at load time instead.

## Target dimensions

The placeholder defines the contract. `CapsuleGeometry(0.4, 1.0)` is
`1.0 + 2 x 0.4 = 1.8` units tall, positioned at `y = 0.9`, so it spans `y = 0` to
`y = 1.8`: **1.8 units tall with its origin at the feet.** The model must match
both the height and the feet-at-origin convention, since `main.ts` assigns
`avatar.object.position` straight from the player position.

## Forward axis

Forward is **+Z**, not -Z. `main.ts` calls `avatar.object.lookAt(...)` on a plain
`Group`, and `Object3D.lookAt` aligns local +Z with its target; only `Camera` and
`Light` use -Z. A `MODEL_YAW` constant in `avatar.ts` absorbs any mismatch. It
starts at `0` and becomes `Math.PI` if visual checking shows the model facing
away from its direction of travel.

## Components

### New module: `src/player/clip-map.ts`

All name matching lives in a pure module, with no three.js dependency, so it is
testable the way `avatar-anim.ts` already is.

```ts
export type ClipPlan = { source: string; freeze: boolean }
export function planClips(clipNames: string[]): Map<AnimationName, ClipPlan>
```

Behaviour:

1. Reduce each incoming name to a key: take the substring after the last `|`,
   then lowercase it.
2. Match each of the five animation names against an alias list. `walk` accepts
   `walk` and `walking`; `run` accepts `run`, `running`, `jog`, and `sprint`;
   `fall` accepts `fall`, `falling`, and `jump`. Earlier aliases win, so a model
   shipping a real `fall` clip is preferred over its `jump`.
3. If no alias matches `glide`, fall back to whatever `fall` resolved to and set
   `freeze: true`. A model with a genuine `glide` clip gets `freeze: false`.
4. States with no match are absent from the map. `setAnimation` already no-ops on
   a missing clip, so this needs no special handling downstream.

The returned `source` is the original, unmodified clip name, so the caller can
look the clip up in the GLTF without re-deriving anything.

### Changes to `src/player/avatar.ts`

The public interface is unchanged: `object`, `attachModel`, `setAnimation`, and
`update` keep their current signatures. `main.ts`'s per-frame calls need no edit.

**`attachModel` wraps the model in its own group.** A new `modelRoot` group holds
`gltf.scene`, and all scaling and vertical offset is applied to `modelRoot`
rather than to `object`. This matters because the glider is a direct child of
`object`: scaling `object` would scale the glider too. Fitting proceeds as:

1. `const box = new Box3().setFromObject(gltf.scene)`
2. `const height = box.max.y - box.min.y`
3. If `height` is zero or not finite, skip scaling entirely — guarding against a
   division that would yield `Infinity` and make the model vanish.
4. Otherwise `modelRoot.scale.setScalar(1.8 / height)`.
5. `modelRoot.position.y = -box.min.y * scale`, seating the feet at `y = 0`. The
   measured `box.min.y` is `-0.006`, small but not zero, so this is a real
   correction rather than a no-op.
6. `modelRoot.rotation.y = MODEL_YAW`.

Clip storage becomes `Map<AnimationName, { clip: AnimationClip; freeze: boolean }>`,
built by passing `gltf.animations.map(c => c.name)` through `planClips` and
resolving each `source` back to its clip.

**`setAnimation` gains frozen-pose support.** Cross-fading is unchanged for
normal clips. A frozen entry sets `action.time = FREEZE_TIME` and
`action.timeScale = 0`, which holds the pose while leaving weight blending — and
therefore the cross-fade — working normally. Using `action.paused` instead would
risk interfering with weight interpolation, so `timeScale` is the mechanism.
Non-frozen clips reset `timeScale` to `1`, since actions are reused across calls.

`FREEZE_TIME` is 0.5s, the midpoint of the 1.000s `Jump` clip, which is its
airborne portion. The exact value is confirmed visually and adjusted if the pose
reads poorly.

### Changes to `src/main.ts`

Two lines, placed after the glider is parented:

```ts
const CHARACTER_URL = `${import.meta.env.BASE_URL}models/character.glb`
void loadGLTF(CHARACTER_URL).then((gltf) => { if (gltf) avatar.attachModel(gltf) })
```

The URL must go through `import.meta.env.BASE_URL`. `vite.config.ts` sets
`base: '/airbender-skies/'` for GitHub Pages, so a hardcoded `/models/...` path
would work in `npm run dev` and 404 on the deployed site — a failure that only
appears in production.

The load is deliberately fire-and-forget. The placeholder renders until the model
arrives, and because `loadGLTF` resolves `null` rather than rejecting, a missing
or corrupt file leaves the capsule in place and the game still boots.

### Changes to `ASSETS.md`

The placeholder row is replaced by a row for the real model: asset name, the
`public/models/character.glb` path, the Poly Pizza source URL, and CC-BY with
credit to Quaternius. The existing note about naming clips `idle`, `walk`, `run`,
`fall`, and `glide` is amended, since `planClips` now handles prefixed and
aliased names — exact naming is no longer a requirement for a model to work.

`public/` does not exist in the repository yet and is created by this work. It is
not covered by `.gitignore`, so the model commits normally.

## Testing

**`src/player/clip-map.test.ts`** (new) — pure, no three.js:

- The real eight-clip Quaternius list resolves all five animation names.
- `fall` resolves to `Human Armature|Jump`.
- `glide` resolves to `Human Armature|Jump` with `freeze: true`.
- The armature prefix is stripped, and matching is case-insensitive.
- A list containing a genuine `glide` clip yields `freeze: false`.
- A list containing both `fall` and `jump` prefers `fall`.
- An empty list yields an empty map rather than throwing.

**`src/player/avatar.test.ts`** (new — `attachModel` and `setAnimation` currently
have no coverage at all):

- A fake GLTF whose scene is 3.6 units tall is scaled to 1.8 units.
- After fitting, the model's lowest point sits at `y = 0`.
- A child added to `avatar.object` before `attachModel` is still present
  afterwards. This is the glider regression guard, and it protects a bug that was
  already fixed once in commit `a636ec3`.
- A degenerate model of zero height does not produce a non-finite scale.
- `setAnimation` on a name with no matching clip does not throw.
- `update(dt)` is safe before any model has attached.

## Verification

Beyond the unit tests, scale and facing are confirmed by running the dev server
and looking at the result: the character should stand roughly two-thirds the
height of the existing glider staff, and should face its direction of travel
rather than away from it. `MODEL_YAW` is flipped to `Math.PI` if it faces
backwards.

## Non-goals

- **No Blender work, and no Mixamo.** Those were considered and rejected as too
  costly for this pass. The consequence accepted here is that `glide` is a frozen
  jump pose rather than a real animation.
- **No charge-squash change.** The jump-system plan scales `avatar.object.scale.y`
  to squash the character while a jump charges. Once a model is attached, that
  would squash the glider too, because the glider is a sibling of `modelRoot`
  under `object`. The squash should target `modelRoot` instead. That belongs to
  the jump work, not here, and is recorded so it is not lost.
- **No second character.** The alias table makes swapping the GLB cheap, but only
  one model ships.

## Follow-up worth considering later

If `glide` proves unconvincing as a frozen jump, the smallest upgrade is a single
Mixamo "falling idle" clip retargeted onto this rig in Blender and merged into
the same GLB as a clip literally named `glide`. `planClips` already prefers a
real `glide` over the fallback, so that would need no code change at all.
