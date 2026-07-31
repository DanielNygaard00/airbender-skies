# Character Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the capsule-and-cone placeholder with the Quaternius "Animated Human" GLB, driven by the animation state machine that already exists.

**Architecture:** Clip-name matching moves into a new pure module (`clip-map.ts`) so it can be tested without three.js. `avatar.ts` keeps its existing public interface — `object`, `attachModel`, `setAnimation`, `update` — and changes only internally: the loaded model is wrapped in a `modelRoot` group that absorbs scaling and vertical offset, and `setAnimation` gains a frozen-pose mode for states the model has no clip for. `main.ts` gains two lines that kick off the load.

**Tech Stack:** TypeScript, three.js 0.185.1 (`GLTFLoader`, `AnimationMixer`, `Box3`), Vite 8 (`base: '/airbender-skies/'`), Vitest 4 with `environment: 'node'`.

**Spec:** `docs/superpowers/specs/2026-07-31-character-model-design.md`

## Global Constraints

- Work on branch `worktree-character-model`, in the worktree at `.claude/worktrees/character-model`. Do not touch `main` or `worktree-jump-system`.
- The model file is already committed at `public/models/character.glb` (698,560 bytes). Do not re-download it.
- `avatar.ts`'s public interface must not change. `main.ts`'s existing calls at lines 119-124 (`avatar.object.position`, `avatar.object.lookAt`, `avatar.setAnimation`, `avatar.update`) must keep working untouched.
- Never scale `avatar.object` itself. The glider is a direct child of it, so scaling `object` resizes the glider. All scaling goes on the model wrapper.
- Asset URLs must be built with `import.meta.env.BASE_URL`. `vite.config.ts` sets `base: '/airbender-skies/'`, so a hardcoded absolute path works in dev and 404s on the deployed GitHub Pages site.
- Forward is **+Z**. `main.ts` calls `avatar.object.lookAt(...)` on a plain `Group`, and `Object3D.lookAt` aligns local +Z. Only `Camera` and `Light` use -Z.
- Target character height is **1.8** units with the feet at `y = 0`, matching `CapsuleGeometry(0.4, 1.0)` positioned at `y = 0.9`.
- The model's real measurements, already verified: **5.2594 units tall**, `bbox.min.y = -0.006`, armature node scale `[100, 100, 100]`. Its `Jump` clip is **1.000s** long.
- Tests live beside their source as `*.test.ts` and run under `environment: 'node'`.
- Run `npm test` and `npm run typecheck` before every commit.

---

### Task 1: Clip-name mapping module

The model's clips are named `Human Armature|Idle`, not `Idle`. The current code lowercases the whole name and looks it up directly, which matches nothing — every clip fails silently and the character freezes in bind pose. This task builds the pure mapping that fixes it. No three.js involved, so it is fast to test.

**Files:**
- Create: `src/player/clip-map.ts`
- Test: `src/player/clip-map.test.ts`

**Interfaces:**
- Consumes: `AnimationName` from `src/player/avatar-anim.ts` (`'idle' | 'walk' | 'run' | 'fall' | 'glide'`).
- Produces: `export type ClipPlan = { source: string; freeze: boolean }` and `export function planClips(clipNames: string[]): Map<AnimationName, ClipPlan>`. Task 2 calls `planClips` and reads `.source` and `.freeze`.

- [ ] **Step 1: Write the failing test**

Create `src/player/clip-map.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planClips } from './clip-map'

/** The clip names the committed character.glb actually ships. */
const QUATERNIUS = [
  'Human Armature|ArmatureAction.002',
  'Human Armature|Death',
  'Human Armature|Idle',
  'Human Armature|Jump',
  'Human Armature|Punch',
  'Human Armature|Run',
  'Human Armature|Walk',
  'Human Armature|Working',
]

describe('planClips', () => {
  it('resolves every animation state for the real model', () => {
    const plan = planClips(QUATERNIUS)
    expect([...plan.keys()].sort()).toEqual(['fall', 'glide', 'idle', 'run', 'walk'])
  })

  it('strips the armature prefix when matching', () => {
    // REGRESSION: lowercasing the whole name yields "human armature|idle", which
    // matches no animation state, so every clip lookup fails silently.
    expect(planClips(QUATERNIUS).get('idle')?.source).toBe('Human Armature|Idle')
  })

  it('substitutes the jump clip for falling', () => {
    expect(planClips(QUATERNIUS).get('fall')?.source).toBe('Human Armature|Jump')
  })

  it('borrows the fall clip for gliding and freezes it', () => {
    expect(planClips(QUATERNIUS).get('glide')).toEqual({
      source: 'Human Armature|Jump',
      freeze: true,
    })
  })

  it('does not freeze clips the model really has', () => {
    expect(planClips(QUATERNIUS).get('idle')?.freeze).toBe(false)
  })

  it('prefers a real glide clip over the frozen substitute', () => {
    const plan = planClips(['Idle', 'Walk', 'Run', 'Jump', 'Glide'])
    expect(plan.get('glide')).toEqual({ source: 'Glide', freeze: false })
  })

  it('prefers a real fall clip over a jump', () => {
    expect(planClips(['Falling', 'Jump']).get('fall')?.source).toBe('Falling')
  })

  it('matches regardless of case', () => {
    expect(planClips(['IDLE']).get('idle')?.source).toBe('IDLE')
  })

  it('accepts sprint as a run clip', () => {
    expect(planClips(['Sprint']).get('run')?.source).toBe('Sprint')
  })

  it('omits states the model cannot cover', () => {
    const plan = planClips(['Idle'])
    expect(plan.has('walk')).toBe(false)
    // With no fall clip there is nothing to borrow, so glide stays absent too.
    expect(plan.has('glide')).toBe(false)
  })

  it('returns an empty plan for a model with no clips', () => {
    expect(planClips([]).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/player/clip-map.test.ts`
Expected: FAIL — cannot resolve `./clip-map`.

- [ ] **Step 3: Write the implementation**

Create `src/player/clip-map.ts`:

```ts
import type { AnimationName } from './avatar-anim'

/** Which of the model's clips plays for a state, and whether it holds one frame. */
export type ClipPlan = { source: string; freeze: boolean }

/**
 * Exporters prefix each clip with the armature that owns it, so a Quaternius
 * model arrives with "Human Armature|Idle". Only the final segment names the
 * action, so matching has to look there.
 */
function keyOf(clipName: string): string {
  const segments = clipName.split('|')
  return segments[segments.length - 1].trim().toLowerCase()
}

/**
 * Names a model might use for each state, best first. Stock packs rarely use the
 * words this game does, and almost never ship a glider pose.
 */
const ALIASES: Record<AnimationName, readonly string[]> = {
  idle: ['idle'],
  walk: ['walk', 'walking'],
  run: ['run', 'running', 'jog', 'sprint'],
  fall: ['fall', 'falling', 'jump'],
  glide: ['glide', 'gliding', 'fly', 'flying'],
}

export function planClips(clipNames: string[]): Map<AnimationName, ClipPlan> {
  const byKey = new Map<string, string>()
  for (const name of clipNames) {
    // First occurrence wins, so a duplicated key resolves the same way every run.
    const key = keyOf(name)
    if (!byKey.has(key)) byKey.set(key, name)
  }

  const plan = new Map<AnimationName, ClipPlan>()
  for (const state of Object.keys(ALIASES) as AnimationName[]) {
    for (const alias of ALIASES[state]) {
      const source = byKey.get(alias)
      if (source) {
        plan.set(state, { source, freeze: false })
        break
      }
    }
  }

  // No glider clip exists in stock packs. Holding a single airborne frame reads
  // as a deliberate pose, where looping a jump reads as the wrong clip stuck on.
  const fall = plan.get('fall')
  if (!plan.has('glide') && fall) {
    plan.set('glide', { source: fall.source, freeze: true })
  }

  return plan
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/player/clip-map.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/player/clip-map.ts src/player/clip-map.test.ts
git commit -m "Map a model's own clip names onto the game's animation states"
```

---

### Task 2: Fit the loaded model to the placeholder

`attachModel` currently parents `gltf.scene` straight onto `avatar.object` at whatever size the artist exported. This model is 5.2594 units tall, so it would tower nearly three times over the world. This task adds the wrapper group and the measured fit.

**Files:**
- Modify: `src/player/avatar.ts`
- Test: `src/player/avatar.test.ts` (create — `attachModel` has no coverage today)

**Interfaces:**
- Consumes: `planClips` and `ClipPlan` from Task 1.
- Produces: no interface change. `attachModel(gltf: GLTF): void` keeps its signature. Internally `clips` becomes `Map<AnimationName, { clip: AnimationClip; freeze: boolean }>`, which Task 3 reads.

- [ ] **Step 1: Write the failing test**

Create `src/player/avatar.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  Box3, Group, Mesh, Object3D, BoxGeometry, AnimationClip, VectorKeyframeTrack,
} from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { createAvatar } from './avatar'

/**
 * A stand-in for a loaded model. `height` is the mesh's own height and `liftFeet`
 * lifts it off the origin, mimicking a real export whose lowest vertex is not
 * exactly zero — the committed model sits at -0.006.
 */
function fakeGltf(
  clipNames: string[],
  { height = 3.6, liftFeet = 0 } = {},
): GLTF {
  const scene = new Group()
  const mesh = new Mesh(new BoxGeometry(0.5, height, 0.5))
  mesh.name = 'Body'
  mesh.position.y = height / 2 + liftFeet
  scene.add(mesh)

  const animations = clipNames.map((name) =>
    new AnimationClip(name, 1, [
      new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 0, 1, 0]),
    ]),
  )

  return { scene, animations } as unknown as GLTF
}

function spanOf(object: Object3D) {
  object.updateMatrixWorld(true)
  const box = new Box3().setFromObject(object)
  return { min: box.min.clone(), height: box.max.y - box.min.y }
}

describe('createAvatar placeholder', () => {
  it('starts at the placeholder capsule height', () => {
    // CapsuleGeometry(0.4, 1.0) at y = 0.9 spans 0 to 1.8.
    expect(spanOf(createAvatar().object).height).toBeCloseTo(1.8, 1)
  })

  it('survives setAnimation before any model has loaded', () => {
    expect(() => createAvatar().setAnimation('walk')).not.toThrow()
  })

  it('survives update before any model has loaded', () => {
    expect(() => createAvatar().update(1 / 60)).not.toThrow()
  })
})

describe('createAvatar attachModel', () => {
  it('scales an oversized model down to the placeholder height', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594 }))
    expect(spanOf(avatar.object).height).toBeCloseTo(1.8, 3)
  })

  it('scales an undersized model up to the placeholder height', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 0.4 }))
    expect(spanOf(avatar.object).height).toBeCloseTo(1.8, 3)
  })

  it('seats the feet at the origin', () => {
    // The real export's lowest vertex is at -0.006, not 0, so the offset has to
    // be applied rather than assumed away.
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594, liftFeet: 0.5 }))
    expect(spanOf(avatar.object).min.y).toBeCloseTo(0, 5)
  })

  it('keeps the glider when a model replaces the placeholder', () => {
    // REGRESSION: object.clear() would drop the glider too. main.ts parents the
    // glider under avatar.object, and commit a636ec3 already fixed this once.
    const avatar = createAvatar()
    const glider = new Object3D()
    glider.name = 'glider'
    avatar.object.add(glider)

    avatar.attachModel(fakeGltf(['Idle']))

    expect(avatar.object.children).toContain(glider)
  })

  it('leaves the glider unscaled while resizing the character', () => {
    // The fit must land on the model wrapper. Scaling avatar.object would shrink
    // the glider by the same factor.
    const avatar = createAvatar()
    const glider = new Object3D()
    avatar.object.add(glider)

    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594 }))

    expect(avatar.object.scale.y).toBe(1)
    glider.updateMatrixWorld(true)
    expect(glider.matrixWorld.elements[5]).toBe(1)
  })

  it('removes the placeholder capsule', () => {
    // Assert structure, not measured height: a fitted model is also 1.8 tall, so
    // a height assertion passes whether or not the placeholder was removed.
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594 }))

    expect(avatar.object.children).toHaveLength(1)
    avatar.object.traverse((child) => {
      if (child instanceof Mesh) {
        expect(child.geometry).not.toBeInstanceOf(CapsuleGeometry)
      }
    })
  })

  it('refuses to divide by a degenerate model height', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 0 }))
    // A zero-height model must not produce an Infinity scale and vanish.
    expect(Number.isFinite(spanOf(avatar.object).height)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/player/avatar.test.ts`
Expected: FAIL. The scaling tests report a height near 5.26 instead of 1.8, and the feet test reports a non-zero `min.y`.

- [ ] **Step 3: Add the fit and the wrapper**

In `src/player/avatar.ts`, extend the three.js import to add `Box3`, and import from Task 1:

```ts
import {
  Object3D, Group, Mesh, CapsuleGeometry, ConeGeometry, Box3,
  MeshLambertMaterial, AnimationMixer, type AnimationClip,
} from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { AnimationName } from './avatar-anim'
import { planClips } from './clip-map'
```

Add constants below `FADE_SECONDS`:

```ts
/** Matches the placeholder capsule: CapsuleGeometry(0.4, 1.0) is 1.8 tall. */
const TARGET_HEIGHT = 1.8

/**
 * Yaw correction for a model that does not face its direction of travel.
 * Forward here is +Z, because main.ts calls avatar.object.lookAt(...) on a plain
 * Group and Object3D.lookAt aligns local +Z. Set to Math.PI for a -Z model.
 */
const MODEL_YAW = 0
```

Add the fit helper above `createAvatar`:

```ts
/**
 * Size a loaded model to the placeholder and seat its feet at y = 0.
 *
 * Model authors pick their own units, and the numbers are not guessable: this
 * character exports 5.2594 units tall, with a scale of 100 on its armature node
 * and raw vertex bounds spanning only 0.08. So the height is measured through
 * the built scene graph rather than assumed, which also means a replacement
 * model needs no retuning. The transform lands on the wrapper, never on the
 * avatar root, because the glider is a child of that root.
 */
function fitToPlaceholder(wrapper: Object3D, model: Object3D): void {
  const box = new Box3().setFromObject(model)
  const height = box.max.y - box.min.y
  if (!Number.isFinite(height) || height <= 0) return

  const scale = TARGET_HEIGHT / height
  wrapper.scale.setScalar(scale)
  wrapper.position.y = -box.min.y * scale
}
```

Change the `clips` declaration inside `createAvatar`:

```ts
  let mixer: AnimationMixer | null = null
  let clips = new Map<AnimationName, { clip: AnimationClip; freeze: boolean }>()
  let current: AnimationName | null = null
```

Replace the body of `attachModel`:

```ts
    /** Swap the placeholder for a real model once it has loaded. */
    attachModel(gltf: GLTF): void {
      // Remove only the placeholder we added, not every child: main.ts also parents
      // the glider under this object, and object.clear() would delete it too,
      // silently orphaning it from the scene graph.
      object.remove(placeholder)

      // The model gets its own wrapper so scaling it cannot touch the glider.
      const modelRoot = new Group()
      modelRoot.add(gltf.scene)
      fitToPlaceholder(modelRoot, gltf.scene)
      modelRoot.rotation.y = MODEL_YAW
      object.add(modelRoot)

      mixer = new AnimationMixer(gltf.scene)
      const byName = new Map(gltf.animations.map((clip) => [clip.name, clip]))
      clips = new Map()
      for (const [state, plan] of planClips(gltf.animations.map((c) => c.name))) {
        const clip = byName.get(plan.source)
        if (clip) clips.set(state, { clip, freeze: plan.freeze })
      }
      current = null
    },
```

`setAnimation` will not compile yet — `clips.get(name)` now yields an object rather than a clip. Fix it minimally for now, so this task's tests can run; Task 3 gives it the frozen-pose behaviour:

```ts
      const entry = clips.get(name)
      if (!mixer || !entry) {
        // No model or no matching clip: the placeholder simply does not animate.
        current = name
        return
      }
      const next = mixer.clipAction(entry.clip)
      if (current) {
        const previous = clips.get(current)
        if (previous) mixer.clipAction(previous.clip).fadeOut(FADE_SECONDS)
      }
      next.reset().fadeIn(FADE_SECONDS).play()
      current = name
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/player/avatar.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, typecheck clean. Nothing else consumes `clips`, so no other file should break.

- [ ] **Step 6: Commit**

```bash
git add src/player/avatar.ts src/player/avatar.test.ts
git commit -m "Fit a loaded character model to the placeholder's height and footing"
```

---

### Task 3: Hold a frozen pose for gliding

The model has no glide clip, so `planClips` hands back the jump clip with `freeze: true`. Playing that on a loop would look like the wrong animation is stuck on. This task holds it on a single frame instead.

The subtlety worth understanding before writing code: `fall` and `glide` resolve to the *same* clip, and `mixer.clipAction(clip)` returns the *same* action object for a given clip. So gliding and falling share one action, and whatever `glide` does to it, `fall` inherits. Leaving `timeScale` at `0` on the way out would freeze falling too.

**Files:**
- Modify: `src/player/avatar.ts`
- Test: `src/player/avatar.test.ts`

**Interfaces:**
- Consumes: the `{ clip, freeze }` entries built in Task 2.
- Produces: no interface change.

- [ ] **Step 1: Write the failing test**

Append to `src/player/avatar.test.ts`. The fixture's clip animates `Body.position` from `(0,0,0)` to `(0,1,0)` over one second, so sampling that mesh reveals whether time is advancing. Samples are taken after the cross-fade has finished, since a ramping weight also changes the value.

```ts
describe('createAvatar frozen poses', () => {
  const REAL_CLIPS = [
    'Human Armature|Idle',
    'Human Armature|Walk',
    'Human Armature|Run',
    'Human Armature|Jump',
  ]

  /**
   * Run the mixer past the cross-fade, then report the animated value.
   *
   * The frame count must not advance the action by a whole multiple of the
   * clip's duration. The fixture's clips are exactly 1.000s long, so 60 frames
   * of 1/60 would land every sample back on the same phase, making a looping
   * action indistinguishable from a frozen one. 25 frames advances 5/12 of a
   * cycle, so consecutive samples sit at distinct phases (0.417, 0.833, 0.250)
   * while the first call still clears the 0.18s cross-fade.
   */
  function settle(avatar: ReturnType<typeof createAvatar>): number {
    for (let i = 0; i < 25; i++) avatar.update(1 / 60)
    const body = avatar.object.getObjectByName('Body')
    if (!body) throw new Error('fixture mesh missing')
    return body.position.y
  }

  it('stops advancing time while gliding', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(REAL_CLIPS))
    avatar.setAnimation('glide')

    const first = settle(avatar)
    const second = settle(avatar)

    expect(second).toBeCloseTo(first, 6)
  })

  it('keeps advancing time while falling', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(REAL_CLIPS))
    avatar.setAnimation('fall')

    const samples = [settle(avatar), settle(avatar), settle(avatar)]

    expect(new Set(samples.map((v) => v.toFixed(4))).size).toBeGreaterThan(1)
  })

  it('resumes falling after a glide released the shared clip', () => {
    // REGRESSION: fall and glide borrow the same jump clip, so they share one
    // AnimationAction. Freezing it for glide without restoring timeScale leaves
    // falling frozen too.
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(REAL_CLIPS))

    avatar.setAnimation('glide')
    settle(avatar)
    avatar.setAnimation('fall')

    const samples = [settle(avatar), settle(avatar), settle(avatar)]

    expect(new Set(samples.map((v) => v.toFixed(4))).size).toBeGreaterThan(1)
  })

  it('does not freeze an ordinary clip', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(REAL_CLIPS))
    avatar.setAnimation('walk')

    const samples = [settle(avatar), settle(avatar), settle(avatar)]

    expect(new Set(samples.map((v) => v.toFixed(4))).size).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify the freeze test fails**

Run: `npm test -- src/player/avatar.test.ts`
Expected: FAIL on "stops advancing time while gliding" — the borrowed jump clip keeps playing, so the two samples differ. The other three tests in this block should already pass.

- [ ] **Step 3: Implement the frozen pose**

Add a constant next to `MODEL_YAW` in `src/player/avatar.ts`:

```ts
/**
 * Where in a borrowed clip a frozen pose sits. The jump clip is 1.000s long, so
 * halfway through is its airborne portion rather than the crouch or the landing.
 */
const FREEZE_TIME = 0.5
```

Replace the tail of `setAnimation`:

```ts
      next.reset().fadeIn(FADE_SECONDS).play()
      // A frozen state has no clip of its own — it holds one frame of a borrowed
      // one. timeScale = 0 stops playback while leaving the fade's weight
      // blending to run, where `paused` would stall that too. Restoring 1 is not
      // optional: fall and glide share the jump clip, and therefore share one
      // action, so a glide that left timeScale at 0 would freeze falling as well.
      next.timeScale = entry.freeze ? 0 : 1
      if (entry.freeze) next.time = FREEZE_TIME
      current = name
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/player/avatar.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, clean.

- [ ] **Step 6: Commit**

```bash
git add src/player/avatar.ts src/player/avatar.test.ts
git commit -m "Hold a single airborne frame while gliding"
```

---

### Task 4: Load the model and document the asset

Everything so far is unreachable: nothing calls `attachModel`. This task wires the load, records the licence, and confirms the result on screen.

**Files:**
- Modify: `src/main.ts` (import block, and after the glider is parented at line 80)
- Modify: `ASSETS.md`

**Interfaces:**
- Consumes: `loadGLTF` from `src/core/assets.ts`, `avatar.attachModel` from Task 2.
- Produces: nothing further depends on this.

- [ ] **Step 1: Add the load call**

In `src/main.ts`, add to the imports:

```ts
import { loadGLTF } from './core/assets'
```

Directly after the existing glider parenting:

```ts
  const glider = createGlider()
  // A child of the avatar, so it inherits the character's position and facing.
  avatar.object.add(glider.object)

  // BASE_URL, not a bare absolute path: vite.config.ts sets base to
  // '/airbender-skies/' for GitHub Pages, so "/models/..." would resolve in dev
  // and 404 only on the deployed site. Fire-and-forget on purpose — loadGLTF
  // resolves null instead of rejecting, so a missing file leaves the placeholder
  // standing and the game still starts.
  void loadGLTF(`${import.meta.env.BASE_URL}models/character.glb`).then((gltf) => {
    if (gltf) avatar.attachModel(gltf)
  })
```

- [ ] **Step 2: Typecheck and run the suite**

Run: `npm test && npm run typecheck`
Expected: all pass. `import.meta.env` is typed by Vite's client types; if typecheck complains that `env` does not exist on `ImportMeta`, add `/// <reference types="vite/client" />` at the top of `src/main.ts` rather than casting.

- [ ] **Step 3: Update ASSETS.md**

Replace the placeholder row in the table:

```markdown
| Asset | Path | Source | License |
| --- | --- | --- | --- |
| Animated Human character | `public/models/character.glb` | https://poly.pizza/m/c3Ibh9I3udk | CC-BY — Quaternius |
```

Replace the closing note about clip names:

```markdown
Clip names do not have to match the game's animation states. `src/player/clip-map.ts`
strips the armature prefix that exporters add — this model ships
`Human Armature|Idle` — and matches common synonyms, so `Sprint` counts as a run
and `Jump` stands in for a fall. A model with no glide clip borrows its fall clip
and holds a single frame. Adding a clip literally named `glide` overrides that
automatically.

Poly Pizza lists this model as Creative Commons Attribution while Quaternius's own
pages state CC0. The stricter reading is recorded here, so credit Quaternius when
distributing a build.
```

- [ ] **Step 4: Verify on screen**

Start the dev server and look at the character. Use the launch configuration named `airbender-skies-dev` (port 5173) rather than a bare shell command.

Check three things:
1. **It loaded.** No "Failed to load" warning in the browser console. A 404 here means the `BASE_URL` path is wrong.
2. **Scale.** The character stands roughly two-thirds the height of the glider staff, not towering over the islands or lost in the terrain.
3. **Facing.** Walk forward. The character faces its direction of travel. If it moonwalks, change `MODEL_YAW` in `src/player/avatar.ts` from `0` to `Math.PI` and reload.

Then deploy the kite with `Space` and confirm the glide pose holds a steady airborne shape rather than looping a jump. If the frozen frame reads badly — mid-crouch, or limbs folded — adjust `FREEZE_TIME` within the clip's 0 to 1.000s range and reload.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts ASSETS.md
git commit -m "Load the character model at startup and record its licence"
```

- [ ] **Step 6: Commit any tuning the visual check produced**

Only if step 4 changed `MODEL_YAW` or `FREEZE_TIME`:

```bash
git add src/player/avatar.ts
git commit -m "Correct the character's facing and glide pose from visual checking"
```

---

## Notes for the reviewer

- **Not in scope, but adjacent.** The jump-system plan squashes the character by scaling `avatar.object.scale.y`. Once a model is attached, that squashes the glider too, since the glider and the model wrapper are siblings under `object`. The fix belongs to that work: squash the wrapper, not the root. If both branches land, check this.
- **No Blender, no Mixamo.** Both were considered and rejected as too costly for this pass. The accepted cost is that `glide` is a held jump frame rather than real motion. The smallest upgrade later is a Mixamo "falling idle" retargeted onto this rig and merged into the same GLB under the name `glide` — `planClips` already prefers a real clip, so that needs no code change.
