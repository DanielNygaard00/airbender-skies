# The borrowed elements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legibility rule that failed, prove the replacement on one effect, then paint water, earth and fire plus the two reaction shapes step C left as placeholders.

**Architecture:** A `POLAR_PREAMBLE` and a documented geometry table move B1's hard-won coordinate knowledge into `effect-material.ts` and `sector.ts`. Each effect then gains a **collar** — a dark band drawn immediately outside its bright core — so contrast lives inside the effect rather than depending on the ground. `water-reach` is a gate: it is shot on pale grass and dark rock before any other effect commits.

**Tech Stack:** TypeScript, three.js 0.185.1, Vitest (node environment, no DOM, no WebGL).

**Spec:** `docs/superpowers/specs/2026-08-28-borrowed-vfx-design.md`

## Global Constraints

- Tests run in the **node** environment: no DOM, no WebGL. three.js materials construct in node, so assembled `fragmentShader` strings and `uniforms` are assertable — that is how every task here is tested.
- `npm run typecheck` covers both tsconfigs and must pass; `npm test` must pass — 128 files / 2665 tests are green at the start of this plan; `npm run build` must keep emitting both `dist/index.html` and `dist/bench.html`.
- **No `any`.** `noUncheckedIndexedAccess` is on: restructure rather than assert.
- **`src/fx/effect-material.ts` is the only module in `src/fx/` allowed to call `new ShaderMaterial`**, and `effect-material.test.ts` enforces it by reading the directory. Adding an effect that hand-rolls one fails that test.
- **A fragment body must never include a `..._pars_fragment` chunk.** The builder throws on it; that refusal is why the module exists.
- **No gameplay number moves.** No lifetime, reach, radius, thickness, height, width or opacity constant. Newly `export`ing a constant for a test is allowed; changing its value is not.
- **No tint moves.** B1 spent the red-channel headroom raising green five times and the four air tints now differ only in red. The collar is what buys legibility here, not brightness.
- **The collar rule replaces B1's threshold rule.** Every bright element draws a darker band immediately outside its core, so the contrast is internal and ground-independent. B1's "clear 0.82 luminance" is retired — do not add new luminance assertions, and do not delete B1's existing ones (they still describe B1's effects truthfully).
- **`pillar-view` is out of scope** and must not be touched: it is opaque, lit, depth-tested world geometry, and the builder makes transparent unlit overlays.
- **Collar bounds live in the mesh's own radius range, not in 0..1** — every arc in this plan is a `sectorGeometry(halfAngle, 1 - ARC_THICKNESS, 1)` band, so `POLAR_PREAMBLE`'s `radius` spans `1 - ARC_THICKNESS`..1 and nothing below that inner edge exists to shade. Before writing a `smoothstep` against `radius`, read the effect's `ARC_THICKNESS` and place both bounds inside the band: water and earth run 0.84..1.0, fire 0.70..1.0. A bound below the inner edge saturates `core` and zeroes `collar`, which draws the old flat arc and passes every test that only pins literals.
- **Tuned constants are pinned in tests** — exact `toContain` on each literal `smoothstep` bound plus the `gl_FragColor` expression, in the shape `shockwave.test.ts:156-170` and both trail tests already use, with a comment saying what only a bench shot can answer.
- **Do not assert a mechanism you have not verified.** B1's one Critical finding was a comment claiming rotation while the implementer's own report doubted the UV mapping.
- Nothing may touch `src/focus/`, `src/combat/`, any cooldown, or `src/core/post.ts`.
- Commit messages: a sentence in the imperative, no `feat:`/`fix:` prefix. House comment style: explain WHY and name the rejected alternative.
- **You do not take screenshots.** The controller does the visual verification, because a subagent's screenshots are not visible to the person who needs to see them. Say so in your report.

---

## Task 1: The geometry vocabulary

**Files:**
- Modify: `src/fx/effect-material.ts` (add `POLAR_PREAMBLE` and the geometry table comment)
- Modify: `src/fx/sector.ts` (the monotonicity guarantee beside `sectorTheta`)
- Test: `src/fx/effect-material.test.ts`, `src/fx/sector.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `const POLAR_PREAMBLE: string` from `./effect-material`; `function sectorUvIsMonotone(halfAngle: number): boolean` from `./sector`.

**Why this is first.** B1 got a geometry assumption wrong three times, and a fourth was found by reading rather than shipping. This task writes that knowledge where the geometry lives, so B2's six remaining effects inherit it instead of rediscovering it.

- [ ] **Step 1: Write the failing tests**

Add to `src/fx/effect-material.test.ts`:

```ts
import { POLAR_PREAMBLE } from './effect-material'

describe('the polar preamble', () => {
  it('derives radius and angle from the recentred uv', () => {
    expect(POLAR_PREAMBLE).toContain('vec2 p = vUv * 2.0 - 1.0')
    expect(POLAR_PREAMBLE).toContain('float radius = length(p)')
    expect(POLAR_PREAMBLE).toContain('atan(p.y, p.x)')
  })

  it('normalises the angle to 0..1, so fract wraps continuously', () => {
    // vortex-ring's fix depended on this: an angle in radians makes fract's wrap land
    // somewhere other than the atan branch cut, which puts a visible seam in the band.
    expect(POLAR_PREAMBLE).toContain('6.2832')
  })

  it('is a body fragment, not a whole shader', () => {
    // It is prepended to a caller's body, so it must not open a main() or declare a varying
    // the builder already declares.
    expect(POLAR_PREAMBLE).not.toContain('void main')
    expect(POLAR_PREAMBLE).not.toContain('varying')
  })

  it('passes the builder\'s own refusal, so it can be prepended safely', () => {
    expect(() => effectFragmentSource(POLAR_PREAMBLE + 'gl_FragColor = vec4(0.0);', {}))
      .not.toThrow()
  })
})
```

Add to `src/fx/sector.test.ts`:

```ts
import { sectorUvIsMonotone } from './sector'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

describe('when a sector\'s uv.x runs monotonically along its arc', () => {
  it('holds at and below a quarter turn, and fails above it', () => {
    // sectorTheta centres every wedge on local +Z with thetaStart = -PI/2 - halfAngle. cos is
    // monotone on [-PI, 0], and both wedge edges sit inside that only while halfAngle <= PI/2.
    expect(sectorUvIsMonotone(Math.PI / 2)).toBe(true)
    expect(sectorUvIsMonotone(Math.PI / 2 + 0.01)).toBe(false)
    expect(sectorUvIsMonotone(Math.PI / 12)).toBe(true)
  })

  it('holds for every sector this step paints', () => {
    const c = DEFAULT_COMBAT_CONFIG
    for (const halfAngle of [
      c.water.grip.halfAngle, c.water.freeze.halfAngle,
      c.earth.stone.halfAngle, c.fire.burst.halfAngle,
    ]) expect(sectorUvIsMonotone(halfAngle)).toBe(true)
  })

  it('fails for the staff finisher, which is the one config in the game that breaks it', () => {
    // Math.PI / 1.9 is about 94.7 degrees. staff-arc-fx belongs to a later step; this test is
    // what stops that step from reaching for vUv.x along the arc and shipping a wrong gradient.
    expect(sectorUvIsMonotone(DEFAULT_COMBAT_CONFIG.staffArc.finisher.halfAngle)).toBe(false)
  })
})
```

Check the real config paths for the four half-angles before running — `water.grip`, `water.freeze`, `earth.stone`, `fire.burst` and `staffArc.finisher` are the shapes those tables use today; if a nesting differs, use the real one and say so in your report.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/fx/effect-material.test.ts src/fx/sector.test.ts`
Expected: FAIL — `POLAR_PREAMBLE` and `sectorUvIsMonotone` are not exported.

- [ ] **Step 3: Implement**

In `src/fx/effect-material.ts`, add beside the vertex shader:

```ts
/**
 * The three lines a ring- or wedge-shaped effect needs before it can talk about radius or angle.
 *
 * `vortex-ring.ts`, `vortex-charge.ts` and `shockwave.ts` each hand-copied these, which is three
 * chances to get the constant wrong and one place the next author will not look. Prepend it to a
 * body instead: `body: POLAR_PREAMBLE + MY_BODY`.
 *
 * **Why it is needed at all.** `RingGeometry`'s UVs are Cartesian — three computes
 * `uv = (position / radius + 1) / 2` — so `vUv.x` does not run around the circumference and
 * `vUv.y` does not cross the thickness. `p` recovers `position / outerRadius` exactly, which makes
 * `radius` the true normalised radius and `angle` a continuous 0..1 turn whose wrap coincides with
 * `atan`'s branch cut, so `fract` leaves no seam.
 *
 * **Which coordinate to reach for, by geometry.** This table is the knowledge three wrong shader
 * bodies bought:
 *
 * | Geometry | Use |
 * | --- | --- |
 * | `RingGeometry` (full ring) | this preamble; never bare `vUv` axes |
 * | `sectorGeometry` (bounded wedge) | `vUv.x` along the arc, but only while the half-angle stays at or under a quarter turn — see `sectorUvIsMonotone` in `sector.ts`. `radius` from this preamble is valid for a wedge too |
 * | `BoxGeometry` | `vLocal`; UVs are per face, so `vUv.x` means a different axis depending on which face a fragment is on |
 * | `OctahedronGeometry` | `vLocal`; there is no useful UV |
 * | `CylinderGeometry` | side-face `vUv` genuinely is (around, up), as `air-wall.ts` uses |
 * | `SphereGeometry` | `vUv` is (azimuth, polar) |
 */
export const POLAR_PREAMBLE = /* glsl */ `
    vec2 p = vUv * 2.0 - 1.0;
    float radius = length(p);
    float angle = atan(p.y, p.x) / 6.2832 + 0.5;
`
```

In `src/fx/sector.ts`, beside `sectorTheta`:

```ts
/**
 * Whether a wedge of this half-angle has a `vUv.x` that runs monotonically along its arc.
 *
 * `sectorTheta` centres every wedge on local +Z with `thetaStart = -PI/2 - halfAngle`, and
 * `RingGeometry`'s `uv.x` is `(position.x / outerRadius + 1) / 2` — so `uv.x` tracks `cos(theta)`.
 * `cos` is monotone on `[-PI, 0]`, and both wedge edges sit inside that window only while the
 * half-angle stays at or under a quarter turn. Past that the wedge folds back and two different
 * points on the arc share a `uv.x`, which makes any gradient written against it mirror.
 *
 * A predicate rather than a comment, because exactly one config in the game breaks the bound —
 * `staffArc.finisher`'s `Math.PI / 1.9`, about 94.7 degrees — and a comment would not fail a test
 * the day someone widens another arc past it.
 */
export function sectorUvIsMonotone(halfAngle: number): boolean {
  return halfAngle <= Math.PI / 2
}
```

- [ ] **Step 4: Run the tests, then the suite**

Run: `npx vitest run src/fx/effect-material.test.ts src/fx/sector.test.ts && npm test`
Expected: PASS. If `sector.test.ts` does not exist, create it.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/fx/effect-material.ts src/fx/effect-material.test.ts src/fx/sector.ts src/fx/sector.test.ts
git commit -m "Put the polar preamble and the wedge's monotonicity bound where their geometry lives"
```

---

## Task 2: The collar, proved on water

**Files:**
- Modify: `src/fx/water-reach.ts`
- Test: `src/fx/water-reach.test.ts`

**Interfaces:**
- Consumes: `createEffectMaterial`, `POLAR_PREAMBLE` from Task 1.
- Produces: the collar pattern every later task copies — `COLLAR_INNER`, `COLLAR_OUTER` constants and the `mix(tint * COLLAR_DARKNESS, tint, core)` shape.

**This task is a gate.** The controller shoots it on the `light`/grass scene and the `gust-canyon`/rock scene and decides whether the collar rule ships before Task 3 starts. If it does not separate on pale ground, one effect is wasted rather than seven. Report and stop; do not start another effect.

**What stays.** `LIFETIME` 0.3, `HEIGHT` 1, `FILL_OPACITY` 0.34, `ARC_OPACITY` 0.9, `ARC_THICKNESS` 0.16, `GRIP_TINT` `0x2fb8d8`, `FREEZE_TINT` `0xcfeeff`, `GRIP_END_FRACTION` 0.15, and the vocabulary: the grip's arc travels **inward** because it drags, the freeze's does not travel at all because nothing moves. The filled sector keeps its `MeshBasicMaterial` — it has nothing to animate.

- [ ] **Step 1: Write the failing tests**

Add to `src/fx/water-reach.test.ts`, using whatever helper that file already has for reaching the arc mesh:

```ts
describe('the arc carries its own collar', () => {
  it('draws a darker band outside the bright core', () => {
    // The rule B1's threshold rule failed to deliver: contrast is a difference, and an absolute
    // luminance cannot separate a bright element from a bright ground. A collar drawn dark works
    // over pale grass and dark rock alike, because the contrast is inside the effect.
    const material = arcMaterialOf(createWaterReach(ORIGIN, FORWARD, 'grip', C))
    expect(material.fragmentShader).toContain('smoothstep(0.90, 0.96, radius)')
    expect(material.fragmentShader).toContain('smoothstep(0.85, 0.90, radius)')
    expect(material.fragmentShader).toContain('mix(tint * 0.18, tint, core)')
  })

  it('derives radius from the preamble rather than a bare uv axis', () => {
    const material = arcMaterialOf(createWaterReach(ORIGIN, FORWARD, 'grip', C))
    expect(material.fragmentShader).toContain('float radius = length(p)')
    expect(material.fragmentShader).not.toContain('vUv.y')
  })

  it('advances time, so the drift is real rather than a still gradient', () => {
    const effect = createWaterReach(ORIGIN, FORWARD, 'grip', C)
    const material = arcMaterialOf(effect)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.1; t += 1 / 60) effect.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })

  it('leaves the freeze static, because nothing is being moved', () => {
    // water-reach.ts's own vocabulary: outward travel pushes, inward drags, no travel holds.
    const material = arcMaterialOf(createWaterReach(ORIGIN, FORWARD, 'freeze', C))
    expect(material.uniforms.travel?.value).toBe(0)
  })

  it('keeps the fill quiet and flat', () => {
    expect(fillMaterialOf(createWaterReach(ORIGIN, FORWARD, 'grip', C)).opacity)
      .toBeCloseTo(FILL_OPACITY, 5)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/fx/water-reach.test.ts`
Expected: FAIL — the arc's material is a `MeshBasicMaterial` with no `uniforms`.

- [ ] **Step 3: Implement**

```ts
/**
 * The arc's bright core and the dark collar just inside it.
 *
 * **Why a collar rather than a brighter tint.** B1's rule was that every bright element clears
 * `post.ts`'s 0.82 bloom threshold. It is wrong in kind: contrast is a difference and 0.82 is a
 * level, so no absolute brightness separates an effect from a *bright* ground — measured twice on
 * the bench, where B1's cyan read on the canyon's rock and washed out on the island's grass. The
 * collar draws a dark band instead, so the contrast is internal and the ground behind it stops
 * mattering. The rejected alternative was raising the tint again: B1 already spent the red-channel
 * headroom five times and its four air tints now differ only in red.
 *
 * `radius` comes from `POLAR_PREAMBLE` and is the true normalised radius even on a bounded wedge.
 *
 * **Why the bounds start at 0.85 and not at zero.** The arc is `sectorGeometry(halfAngle,
 * 1 - ARC_THICKNESS, 1)`, so its fragments only ever span radius 0.84..1.0 — the mesh is a thin
 * band, not a disc, and `POLAR_PREAMBLE`'s `radius` normalises by the *outer* radius. Bounds chosen
 * in a 0..1 space would all fall below the band's inner edge, leaving `core` saturated at 1 and
 * `collar` at 0 everywhere: a collar that compiles, draws nothing, and looks exactly like the
 * uniform arc it replaced. Every bound here is a fraction of the band's own 0.16 of radius — the
 * core ramps over the outer 6/16 and the collar fills the 5/16 just inside it, with the innermost
 * sliver left to fade so the band has a soft inner edge instead of a cut.
 *
 * `travel` is 0 for the freeze and 1 for the grip, which is how one body serves both verbs without
 * a second shader: multiplied into the drift term it makes the freeze's arc snap and hold.
 */
const ARC_BODY = /* glsl */ `
    float core = smoothstep(0.90, 0.96, radius);
    float collar = smoothstep(0.85, 0.90, radius) * (1.0 - core);
    float drift = 0.86 + 0.14 * sin(angle * 40.0 - time * travel * 5.0);
    vec3 colour = mix(tint * 0.18, tint, core);
    gl_FragColor = vec4(colour, alpha * max(core * drift, collar * 0.55));
`
```

Build it with `createEffectMaterial({ body: POLAR_PREAMBLE + ARC_BODY, uniforms: { tint: new Color(tintFor(move)), alpha: ARC_OPACITY, time: 0, travel: move === 'grip' ? 1 : 0 }, depthTest: false })`, and write `time` in the effect's existing update beside the scale and opacity work. Keep the inward scale animation exactly as it is — the collar changes what the band looks like, not where it goes.

- [ ] **Step 4: Run the tests and the suite**

Run: `npx vitest run src/fx/water-reach.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit and STOP**

```bash
git add src/fx/water-reach.ts src/fx/water-reach.test.ts
git commit -m "Give water's arc a dark collar, so its contrast stops depending on the ground"
```

Then **stop and report**. Say explicitly that the collar is unverified on screen and that the controller's two shots are the gate. Do not begin Task 3.

---

## Task 3: Ice

**Files:** Modify `src/fx/ice-shell.ts`; test `src/fx/ice-shell.test.ts`.

**Interfaces:** Consumes `createEffectMaterial` and the collar pattern from Task 2.

**Geometry:** `OctahedronGeometry` — **no useful UV**, so use `vLocal`. Do not use `POLAR_PREAMBLE` here; it is for ring and wedge shapes.

**What stays:** `CENTRE_Y` 0.95, `RADIUS` 1.3, `TINT` `0xcfeeff`, `PEAK_OPACITY` 0.42, `FORM_SECONDS` 0.12, `MELT_SECONDS` 0.25 — and **`side: BackSide`**, which the current `MeshBasicMaterial` sets and which `createEffectMaterial` will silently replace with its `DoubleSide` default unless the call passes it. Pass it. Rendering the near faces as well as the far ones doubles what every pixel of the shell is looking through, which is a visible change to the effect's density that nothing in this task asked for. `depthTest` is *not* passed: it defaults to `true`, and a closed shell around a soldier wants the depth test for the same reason `air-wall.ts` does — its lower half is below the soldier's footing and should stay hidden by the ground it is under.

**This effect does not register in `src/fx/collar-bounds.test.ts`.** That guard checks `smoothstep(_, _, radius)` bounds against a `RingGeometry`'s band. The shell has no band and no radius bound — its contrast is view-dependent, per below.

- [ ] **Step 1: Write the failing test**

```ts
describe('the shell reads as faceted ice', () => {
  it('varies brightness per facet from object space, since an octahedron has no useful uv', () => {
    const material = shellMaterialOf(createIceShell(ORIGIN))
    expect(material.fragmentShader).toContain('vLocal')
    expect(material.fragmentShader).not.toContain('vUv.x')
  })

  it('holds still, because ice does not travel', () => {
    // The vocabulary water-reach.ts documents: no travel means holding. A drifting shell would
    // say the freeze is doing something to the soldier, and it is not — it is keeping it still.
    const material = shellMaterialOf(createIceShell(ORIGIN))
    expect(material.uniforms.time).toBeUndefined()
  })

  it('puts its bright edge on the silhouette, where the surface turns away', () => {
    // The collar's actual claim is internal contrast at the effect's *boundary*. On a closed
    // shell the boundary is wherever the surface goes edge-on to the viewer, which is a
    // view-space fact and not an object-space one — so this reads the view normal, not vLocal.
    const material = shellMaterialOf(createIceShell(ORIGIN))
    expect(material.fragmentShader).toContain('vViewNormal')
    expect(material.fragmentShader).toContain('1.0 - abs(n.z)')
    expect(material.fragmentShader).toContain('mix(tint * 0.18, tint, core)')
  })

  it('keeps the shell BackSide, so it does not double its own density', () => {
    expect(shellMaterialOf(createIceShell(ORIGIN)).side).toBe(BackSide)
  })

  it('stays depth-tested, because its lower half is under the ground', () => {
    expect(shellMaterialOf(createIceShell(ORIGIN)).depthTest).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/fx/ice-shell.test.ts`
Expected: FAIL — no `uniforms` on a `MeshBasicMaterial`.

- [ ] **Step 3: Implement**

```ts
/**
 * Facet brightness from object space, and the bright rim that carries the collar's contrast.
 *
 * An `OctahedronGeometry` has no UV worth reading, so `vLocal` is the only *object-space*
 * coordinate available — and it is the right one for the faceting: how bright a facet is should
 * depend on where that facet is, not on a texture coordinate. `facet` quantises the object-space
 * direction into bands so adjacent faces differ, which is what makes it read as cut ice rather
 * than a smooth blob.
 *
 * **Why the contrast is view-dependent and not object-space.** Task 2's collar earns its keep by
 * putting a dark band immediately inside the effect's *visible boundary*, so the eye has an edge
 * to catch regardless of what is behind it. On a flat ground wedge the boundary is a radius, so a
 * band in object space is a band on screen. On a closed shell it is not: the boundary is wherever
 * the surface turns edge-on to the viewer, and that is a fact about the view, not about the mesh.
 * An earlier draft of this body darkened `length(vLocal.xz)` instead, which shades the shell's top
 * and bottom tips — from any side view that is its *middle*, leaving the silhouette uniformly
 * bright and the collar's whole argument unimplemented while the comment claimed a rim.
 *
 * So `grazing` is `1 - abs(n.z)` on the view-space normal: 0 where the surface faces the camera
 * squarely, 1 at the silhouette. `abs` because the shell is `BackSide` and its rendered normals
 * point away from the viewer. On a sphere of projected radius 1, the bounds below light the rim
 * from about 0.76 out to the edge, which at this shell's 1.3 units is a broad rim rather than a
 * hairline — chosen over a tighter band because a hairline on a 1.3-unit object at combat range
 * is one pixel of anti-aliasing.
 *
 * No `time` uniform, deliberately. Ice holds a soldier still; a drifting shell would claim motion
 * the move does not have.
 */
const SHELL_BODY = /* glsl */ `
    vec3 n = normalize(vViewNormal);
    float grazing = 1.0 - abs(n.z);
    float core = smoothstep(0.35, 0.75, grazing);
    float facet = 0.68 + 0.32 * fract(dot(normalize(vLocal), vec3(3.7, 2.3, 5.1)));
    vec3 colour = mix(tint * 0.18, tint, core);
    gl_FragColor = vec4(colour, alpha * max(core * facet, (1.0 - core) * 0.45));
`
```

**This task also adds one varying to `src/fx/effect-material.ts`'s vertex shader**, since no shader in the directory has needed a normal before:

```glsl
  varying vec3 vViewNormal;
  ...
    vViewNormal = normalMatrix * normal;
```

Keep `vUv` and `vLocal` exactly as they are. Extend the builder's own doc comment to say what the varying is for and why it lives in the shared vertex shader rather than in a second one: an unused varying costs nothing a profiler can find, whereas a second vertex shader would be a second place for the `vUv`/`vLocal` contract to drift. Add a `effect-material.test.ts` case pinning that all three varyings are declared and assigned. **Check whether any existing test pins the vertex shader's exact text** — if one does, update it rather than working around it, and say so in your report.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/fx/ice-shell.test.ts && npm test && npm run typecheck
git add src/fx/ice-shell.ts src/fx/ice-shell.test.ts
git commit -m "Cut the ice shell into facets from object space, and rim its silhouette"
```

---

## Task 4: Earth

**Files:** Modify `src/fx/earth-reach.ts`; test `src/fx/earth-reach.test.ts`.

**Geometry:** `sectorGeometry` at `stone.halfAngle` = `Math.PI / 9` (20°), well inside the monotone bound, so `vUv.x` along the arc is valid — and `radius` from `POLAR_PREAMBLE` is valid too.

**What stays:** `LIFETIME` 0.26, `HEIGHT` 1, `TINT` `0xd9a066`, `FILL_OPACITY` 0.34, `ARC_OPACITY` 0.9, `ARC_THICKNESS` 0.16, `ARC_START_FRACTION` 0.2.

- [ ] **Step 1: Write the failing test**

```ts
describe('the stone\'s arc reads as mass', () => {
  it('draws the hardest collar of the six, because earth is the heavy element', () => {
    // §4.2 makes earth "slow, committed, high payoff" and the only armour-breaker. A soft edge
    // would read as air, so earth's core ramps over 3/16 of the band where water's takes 6/16,
    // and its dark band is the thicker of the two: the collar plateau runs right up to the core.
    const material = arcMaterialOf(createEarthReach(ORIGIN, FORWARD, C))
    expect(material.fragmentShader).toContain('smoothstep(0.94, 0.97, radius)')
    expect(material.fragmentShader).toContain('smoothstep(0.85, 0.94, radius)')
    expect(material.fragmentShader).toContain('mix(tint * 0.18, tint, core)')
  })

  it('grains along the arc rather than drifting, because rock does not flow', () => {
    const material = arcMaterialOf(createEarthReach(ORIGIN, FORWARD, C))
    expect(material.fragmentShader).toContain('vUv.x')
  })

  it('advances time', () => {
    const effect = createEarthReach(ORIGIN, FORWARD, C)
    const material = arcMaterialOf(effect)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.1; t += 1 / 60) effect.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/fx/earth-reach.test.ts`
Expected: FAIL — no `uniforms`.

- [ ] **Step 3: Implement**

```ts
/**
 * A hard-edged core with a tight collar, and grain along the arc instead of drift.
 *
 * The collar's bounds are 0.08 apart against water's 0.16 — earth is §4.2's "slow, committed"
 * element and the only armour-breaker, and a soft edge reads as air. The grain uses `vUv.x`, which
 * is legitimate here because `stone.halfAngle` is `Math.PI / 9` and `sectorUvIsMonotone` holds
 * comfortably; `radius` still comes from the preamble.
 *
 * The grain does not scroll with `time` the way water's drift does. Rock thrown through the air is
 * a solid object moving, not a medium flowing, so the band's brightness is fixed to the geometry
 * and only its overall alpha rises and falls.
 */
const ARC_BODY = /* glsl */ `
    float core = smoothstep(0.94, 0.97, radius);
    float collar = smoothstep(0.85, 0.94, radius) * (1.0 - core);
    float grain = 0.78 + 0.22 * sin(vUv.x * 64.0);
    float pulse = 0.85 + 0.15 * sin(time * 22.0);
    vec3 colour = mix(tint * 0.18, tint, core);
    gl_FragColor = vec4(colour, alpha * pulse * max(core * grain, collar * 0.6));
`
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/fx/earth-reach.test.ts && npm test && npm run typecheck
git add src/fx/earth-reach.ts src/fx/earth-reach.test.ts
git commit -m "Harden the stone's edge and grain it along the arc, because rock does not flow"
```

---

## Task 5: Fire's burst

**Files:** Modify `src/fx/fire-burst.ts`; test `src/fx/fire-burst.test.ts`.

**Geometry:** `sectorGeometry` at `burst.halfAngle` = `Math.PI / 12` (15°) — the narrowest sector in the game, and that narrowness *is* how §4.2's "only element with real single-target damage" is implemented. **Do not widen it, and do not let any term make it read wider.**

**What stays:** `LIFETIME` 0.16, `HEIGHT` 1, `FILL_TINT` `0xff5a2d`, `ARC_TINT` `0xffd9a0`, `FILL_OPACITY` 0.34, `ARC_OPACITY` 0.95, `ARC_THICKNESS` 0.3, `ARC_START_FRACTION` 0.25.

- [ ] **Step 1: Write the failing test**

```ts
describe('the burst flickers without widening', () => {
  it('flickers along its length rather than across its width', () => {
    // The 15-degree half-angle is how "the only element with real single-target damage" is
    // implemented. A term varying across the arc's width would read as a wider cone.
    const material = arcMaterialOf(createFireBurst(ORIGIN, FORWARD, C))
    expect(material.fragmentShader).toContain('radius * 18.0')
    expect(material.fragmentShader).toContain('mix(tint * 0.18, tint, core)')
  })

  it('draws its collar', () => {
    const material = arcMaterialOf(createFireBurst(ORIGIN, FORWARD, C))
    expect(material.fragmentShader).toContain('smoothstep(0.82, 0.93, radius)')
    expect(material.fragmentShader).toContain('smoothstep(0.72, 0.82, radius)')
  })

  it('advances time', () => {
    const effect = createFireBurst(ORIGIN, FORWARD, C)
    const material = arcMaterialOf(effect)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.08; t += 1 / 60) effect.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/fx/fire-burst.test.ts`
Expected: FAIL — no `uniforms`.

- [ ] **Step 3: Implement**

```ts
/**
 * Flicker along the burst's length, and a collar that does not widen it.
 *
 * Every term here varies with `radius` — along the cone — and none with the angular coordinate.
 * That is deliberate: `burst.halfAngle` is `Math.PI / 12`, and §4.2's "only element with real
 * single-target damage" is implemented as that narrowness rather than as a rule. A brightness term
 * varying across the arc's width would read as a wider cone and undo it.
 *
 * `18.0` is a high frequency against the 0.16 s lifetime: fire flickers faster than water drifts,
 * and at this rate the band count reads as flame rather than as a moving stripe.
 */
const ARC_BODY = /* glsl */ `
    float core = smoothstep(0.82, 0.93, radius);
    float collar = smoothstep(0.72, 0.82, radius) * (1.0 - core);
    float flicker = 0.72 + 0.28 * sin(radius * 18.0 - time * 30.0);
    vec3 colour = mix(tint * 0.18, tint, core);
    gl_FragColor = vec4(colour, alpha * max(core * flicker, collar * 0.5));
`
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/fx/fire-burst.test.ts && npm test && npm run typecheck
git add src/fx/fire-burst.ts src/fx/fire-burst.test.ts
git commit -m "Flicker the burst along its length only, so the narrow cone stays narrow"
```

---

## Task 6: Fire's thrust

**Files:** Modify `src/fx/fire-thrust.ts`; test `src/fx/fire-thrust.test.ts`.

**Geometry:** `BoxGeometry` — **per-face UVs**, so use `vLocal`. `vLocal.z` runs -0.5..0.5 along the plume; normalise with `float along01 = vLocal.z + 0.5;` as both trails do. **Establish which end is the nozzle** by reading how the mesh is placed rather than assuming, and say in your report which you found.

**What stays:** `LIFETIME` 0.14, `PLUME_SECONDS` 0.12, `HEIGHT` 0.95, `WIDTH` 0.34, `THICKNESS` 0.34, `TINT` `0xffd9a0`, `PEAK_OPACITY` 0.85. Also: this effect is the fire thrust, and the owner's standing rule is that **fire may thrust in the air, never paid in Breath, never on the ground** — nothing visual here may imply otherwise, and nothing in this task touches that logic.

- [ ] **Step 1: Write the failing test**

```ts
describe('the plume streaks along its own axis', () => {
  it('reads object space, because a box\'s uvs are per face', () => {
    const material = plumeMaterialOf(createFireThrust(ORIGIN, FORWARD))
    expect(material.fragmentShader).toContain('vLocal.z + 0.5')
    expect(material.fragmentShader).not.toContain('vUv.x')
  })

  it('is brightest at the nozzle and collared away from it', () => {
    const material = plumeMaterialOf(createFireThrust(ORIGIN, FORWARD))
    expect(material.fragmentShader).toContain('smoothstep(0.55, 0.95, along01)')
    expect(material.fragmentShader).toContain('mix(tint * 0.18, tint, core)')
  })

  it('advances time', () => {
    const effect = createFireThrust(ORIGIN, FORWARD)
    const material = plumeMaterialOf(effect)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.08; t += 1 / 60) effect.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/fx/fire-thrust.test.ts`
Expected: FAIL — no `uniforms`.

- [ ] **Step 3: Implement**

```ts
/**
 * A plume brightest at the nozzle, fading and collared down its length.
 *
 * `vLocal.z` rather than `vUv`: a `BoxGeometry` carries a full 0..1 UV square on each of its six
 * faces, so `vUv.x` means a different axis depending on which face a fragment belongs to, and a
 * gradient written against it would streak along the plume on two faces and across it on four.
 * Object-space z is face-independent. Which end is the nozzle was read from the mesh's placement,
 * not assumed.
 */
const PLUME_BODY = /* glsl */ `
    float along01 = vLocal.z + 0.5;
    float core = smoothstep(0.55, 0.95, along01);
    float collar = smoothstep(0.20, 0.55, along01) * (1.0 - core);
    float lick = 0.7 + 0.3 * sin(along01 * 30.0 - time * 36.0);
    vec3 colour = mix(tint * 0.18, tint, core);
    gl_FragColor = vec4(colour, alpha * max(core * lick, collar * 0.5));
`
```

If the nozzle turns out to be at `along01` near 0, mirror the two `smoothstep` bands rather than negating the term, and pin the mirrored literals in the test.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/fx/fire-thrust.test.ts && npm test && npm run typecheck
git add src/fx/fire-thrust.ts src/fx/fire-thrust.test.ts
git commit -m "Streak the thrust along its own axis, brightest where it leaves the hand"
```

---

## Task 7: Steam

**Files:** Create `src/fx/steam.ts`, `src/fx/steam.test.ts`; modify `src/main.ts` (the reaction loop), `src/bench/effects.ts` (repoint `steam`), `src/fx/scale-wiring.test.ts` (a case for the new module).

**Interfaces:** Produces `function createSteam(at: Vector3): Effect`.

**Why it stops being a ring.** Step C wired `createShockwave` for both reactions and said so plainly — a ring was "the cheapest shape that says *something happened here* without pretending to be steam or mud". A later step gives the ring to the chain finisher, and one shape cannot mean Pressure Wave, vortex, finisher, steam and mud at once. Steam **rises**; mud **stays down**.

**The tint** is step C's own `0xffdfae`, argued there as "pale and warm: this is water flashing off against heat, and the burst's own orange-red would read as fire itself rather than as water leaving." Take it from there; do not invent one.

**`safeScale` is mandatory.** `src/fx/scale-wiring.test.ts` reads the directory and fails any module importing `./scale` without a case in its table, so add one — a NaN `dt` into `advance` is the pattern most existing cases use.

- [ ] **Step 1: Write the failing test**

```ts
describe('steam', () => {
  it('rises', () => {
    const effect = createSteam(new Vector3(0, 11.9, 0))
    const startY = effect.object.position.y
    for (let t = 0; t < 0.3; t += 1 / 60) effect.advance(1 / 60)
    expect(effect.object.position.y).toBeGreaterThan(startY)
  })

  it('widens as it rises, because steam dissipates rather than travelling', () => {
    const effect = createSteam(new Vector3())
    const startScale = effect.object.scale.x
    for (let t = 0; t < 0.3; t += 1 / 60) effect.advance(1 / 60)
    expect(effect.object.scale.x).toBeGreaterThan(startScale)
  })

  it('finishes, so the pool retires it', () => {
    const effect = createSteam(new Vector3())
    let alive = true
    for (let t = 0; t < 3 && alive; t += 1 / 60) alive = effect.advance(1 / 60)
    expect(alive).toBe(false)
  })

  it('fades from the top, so the column has no hard cut', () => {
    const material = columnMaterialOf(createSteam(new Vector3()))
    expect(material.fragmentShader).toContain('smoothstep(1.0, 0.45, vUv.y)')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/fx/steam.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

An `Effect` in the shape `src/fx/effect.ts` defines: owns its geometry and material, `advance` returns false when finished, `dispose` releases both. Use a `CylinderGeometry` open at both ends — its side-face `vUv` genuinely is (around, up), which is what a rising column wants — and `safeScale` for every scale.

```ts
const COLUMN_BODY = /* glsl */ `
    float up = smoothstep(1.0, 0.45, vUv.y);
    float wisp = 0.6 + 0.4 * sin(vUv.x * 18.0 + time * 3.0);
    gl_FragColor = vec4(tint, alpha * up * wisp);
`
```

Steam is vapour, so it has no collar: there is no bright core to rim, and the shape's own silhouette against the ground is what reads. Say that in the comment — it is a deliberate exception to a global constraint and a reader will otherwise think it was missed.

- [ ] **Step 4: Rewire**

In `src/main.ts`'s reaction loop, call `createSteam` for `reaction.kind === 'steam'`, leaving `mud` on its placeholder until Task 8. In `src/bench/effects.ts`, repoint `steam`. Add the `scale-wiring.test.ts` case.

- [ ] **Step 5: Run and commit**

```bash
npm test && npm run typecheck && npm run build
git add src/fx/steam.ts src/fx/steam.test.ts src/main.ts src/bench/effects.ts src/fx/scale-wiring.test.ts
git commit -m "Give steam a rising column, so it stops borrowing the ring's meaning"
```

---

## Task 8: Mud

**Files:** Create `src/fx/mud.ts`, `src/fx/mud.test.ts`; modify `src/main.ts`, `src/bench/effects.ts`, `src/fx/scale-wiring.test.ts`. Also delete `REACTION_LOOKS` from `src/main.ts` once both reactions own their tints.

**The tint** is step C's `0x4a3423`, argued there as "dark and brown … pushed well away from the sandstone `earth-reach.ts` already uses so the two effects do not read as the same material."

**Mud is the one effect exempt from the collar rule**, and the spec says so: wet earth has no bright element and nothing above the bloom threshold. Its legibility comes from being *darker* than everything around it. State that in the module comment.

- [ ] **Step 1: Write the failing test**

```ts
describe('mud', () => {
  it('stays on the ground, where wet earth belongs', () => {
    const effect = createMud(new Vector3(0, 11.9, 0))
    const startY = effect.object.position.y
    for (let t = 0; t < 0.4; t += 1 / 60) effect.advance(1 / 60)
    expect(effect.object.position.y).toBeCloseTo(startY, 5)
  })

  it('spreads and then holds, because a spatter lands rather than expanding forever', () => {
    const effect = createMud(new Vector3())
    for (let t = 0; t < 0.2; t += 1 / 60) effect.advance(1 / 60)
    const mid = effect.object.scale.x
    for (let t = 0; t < 0.2; t += 1 / 60) effect.advance(1 / 60)
    expect(effect.object.scale.x).toBeCloseTo(mid, 1)
  })

  it('finishes, so the pool retires it', () => {
    const effect = createMud(new Vector3())
    let alive = true
    for (let t = 0; t < 3 && alive; t += 1 / 60) alive = effect.advance(1 / 60)
    expect(alive).toBe(false)
  })

  it('carries no collar, because a dark effect needs no dark rim', () => {
    expect(columnMaterialOf(createMud(new Vector3())).fragmentShader)
      .not.toContain('mix(tint * 0.18, tint, core)')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/fx/mud.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

A flat disc close to the ground on a `RingGeometry` with inner radius 0 — so `POLAR_PREAMBLE` applies — spreading fast then holding while it fades.

```ts
const SPATTER_BODY = /* glsl */ `
    float blob = 0.55 + 0.45 * sin(angle * 7.0) * smoothstep(0.2, 1.0, radius);
    float edge = smoothstep(1.0, 0.75, radius);
    gl_FragColor = vec4(tint, alpha * edge * blob);
`
```

The `sin(angle * 7.0)` is what makes the rim uneven, so it reads as thrown mud rather than a painted circle — and `angle` comes from the preamble because a bare UV axis would mirror it.

- [ ] **Step 4: Rewire and clean up**

Repoint `mud` in `src/bench/effects.ts`, call `createMud` in `main.ts`'s reaction loop, add the `scale-wiring.test.ts` case, and delete `REACTION_LOOKS` — the `Record` it existed to force is now two module constants. Say that in the commit.

- [ ] **Step 5: Run and commit**

```bash
npm test && npm run typecheck && npm run build
git add src/fx/mud.ts src/fx/mud.test.ts src/main.ts src/bench/effects.ts src/fx/scale-wiring.test.ts
git commit -m "Spatter mud low and dark, and retire the placeholder tint table"
```

---

## Task 9: Report what is shootable, then hand over

**Files:** none, unless a defect is found.

- [ ] **Step 1: List the bench scenes for every effect this plan touched**

`water-reach`, `ice-shell`, `earth-reach`, `fire-burst`, `fire-thrust`, `steam`, `mud` — say which bench ids exist for each, and flag any that has none, because an effect with no scene is an effect whose silent compile failure ships. `src/bench/effects.ts`'s `Record` is total over `BenchEffectId`, so an unregistered effect is a compile error; a *scene* missing for a registered id is not.

- [ ] **Step 2: State what no test established, per effect**

One line each. The honest pattern: a `time` uniform that advances proves the shader animates, not that the animation reads; a pinned `smoothstep` bound proves the gradient was not reversed, not that it looks right.

- [ ] **Step 3: Hand the owner the play-test list**

- whether the collar delivers what B1's threshold rule did not — the same effect over pale grass and dark rock, which is the question this whole step turns on;
- whether the five elements stay distinguishable from each other now all are painted;
- whether earth reads as heavier than water, and fire as faster than both;
- whether steam and mud are distinguishable from each other and from the rings;
- whether anything looks worse on the **low** tier, where the composer is bypassed and nothing blooms.

---

## Self-review

**Spec coverage.** §1's geometry table and the 90° caveat → Task 1, with `sectorUvIsMonotone` as a predicate so a future widening fails a test. §1's duplicated preamble → Task 1's `POLAR_PREAMBLE`. §2's collar rule → Task 2, and every later effect copies its `mix(tint * 0.18, tint, core)` shape. §2's "no tint moves" and "validated on one effect" → a Global Constraint and Task 2's stop-and-report gate. §3's per-effect table → Tasks 2–8, each keeping the vocabulary. §3's mud exemption → Task 8, stated in its test and comment. §4's encode-where-it-lives → Task 1 puts the bound in `sector.ts` and the table in `effect-material.ts`. §5's testing → each task's own tests, with the pinning convention as a Global Constraint. §6's non-goals → nothing here touches tints, gameplay numbers, `pillar-view`, or the B3 effects. §7's risks → Task 2 is the gate the first risk asks for.

**Two gaps found and closed.** The spec's §3 table listed `pillar-view`; reading it showed it is opaque lit world geometry that the builder would break, so the spec was corrected before this plan was written and the effect is now a named non-goal. And Tasks 7 and 8 create new modules that import `safeScale`, which `scale-wiring.test.ts` fails unless they appear in its table — B1 hit exactly this and the plan now says so in both tasks.

**Placeholders.** None. Every code step carries its GLSL or its test. Where a task says to establish something rather than assume it — the fire thrust's nozzle end, the four config paths in Task 1 — it names what to read and requires the finding be reported.

**Type consistency.** `POLAR_PREAMBLE` and `sectorUvIsMonotone` are used with those names in Tasks 1–8. `createEffectMaterial`'s option object (`body`, `uniforms`, `side?`, `depthTest?`) matches every call. The collar's shape — `core`, `collar`, `mix(tint * 0.18, tint, core)` — is identical in Tasks 2–6 and deliberately absent in 7 and 8. `createSteam(at)` and `createMud(at)` match the `main.ts` and bench call sites.

**One risk carried deliberately.** Every collar bound in Tasks 3–6 is a guess anchored on Task 2's, and none can be judged until the shots. If Task 2's gate fails, Tasks 3–8 are all invalidated together — which is the point of gating rather than a flaw in it.
