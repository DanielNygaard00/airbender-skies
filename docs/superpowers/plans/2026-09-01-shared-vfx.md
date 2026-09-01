# Step B3 — the shared layer, the mark, and the finisher

Implementation plan for `docs/superpowers/specs/2026-09-01-shared-vfx-design.md`.
Branch `feature/shared-vfx`, forked from `main` at `81a475b`.

## Architecture

Five modules in `src/fx/` still construct a flat `MeshBasicMaterial`: the two character shells,
the impact burst, the staff swing and the aim tell. They move onto `createEffectMaterial`, the
only place in the directory allowed to call `new ShaderMaterial`. `arrow.ts` and
`pillar-view.ts` are excluded — both are opaque, lit and depth-tested on purpose, and the
builder would strip all three properties.

Two simulation signals nothing draws get consumers. `Enemy.mark` is drawn as a pip in
`src/combat/enemy-mesh.ts`, which already receives the whole `Enemy` every frame and already
receives the camera quaternion for the health bar's billboard. `finisherThisFrame` gets a
flourish at the player.

The collar — a band of contrast drawn immediately **inside** an effect's visible boundary, so
the eye has an edge to catch regardless of what is behind it — carries over from B2 where it
survived its gate on pale grass, on dark rock, and at the low tier where nothing blooms. The
two shells take `ice-shell.ts`'s view-space rim unchanged in kind. The staff arc takes a rim at
its radius edge. The impact burst needs something else: its three kinds are supposed to differ
"in kind, not just in size", and three sizes of the same smooth sphere is exactly the thing its
own comment says they must not be.

Task 1 adds the wedge vocabulary, which the staff arc cannot be written without. Task 2 is a
hard gate on the impact burst, for the reason the collar was gated in B2: "differ in kind" has
no single testable claim behind it, so one kind ships and stops until the controller has shot
all three together.

## Global Constraints

- Tests run in the **node** environment. No DOM, no WebGL. three.js materials construct in
  node, so an assembled `fragmentShader` string and a material's `uniforms`, `side` and
  `depthTest` are all assertable — and no shader here will ever be compiled by a GPU in a test.
- `npm run typecheck` covers both tsconfigs and must pass. `npm test` must pass — **132 files /
  2751 tests** are green at the start of this plan. `npm run build` must keep emitting both
  `dist/index.html` and `dist/bench.html`.
- **No `any`.** `noUncheckedIndexedAccess` is on: restructure rather than assert.
- **`src/fx/effect-material.ts` is the only module in `src/fx/` allowed to call
  `new ShaderMaterial`**, enforced by a directory-scanning test in `effect-material.test.ts`.
- **The silent-shader trap:** a body containing a `..._pars_fragment` include fails to compile
  with redefinition errors that throw nowhere visible — the mesh simply does not draw, which
  looks like a correctly transparent effect. `createEffectMaterial` refuses such a body.
- **Read a coordinate's real range before writing a gradient against it.** Five assumptions in
  this arc have been wrong. On any geometry whose fragments do not span a coordinate's full
  authored range, measure first: a bound outside the range saturates silently and still passes
  every test that only pins literals.
- **Any `sin` around a closed loop must be a whole number of turns.** `vUv.x` around a cylinder
  and `angle` from `POLAR_PREAMBLE` both wrap; a frequency that is not periodic leaves a
  stationary seam. Caught twice in B2. Write `6.2832 * n`, never a bare radian count.
- **Tuned constants are pinned in tests** — exact `toContain` on each literal `smoothstep`
  bound plus the `gl_FragColor` expression, with a comment saying what only a bench shot can
  answer.
- **No tint moves and no gameplay number moves.** Every radius, lifetime, opacity, half-angle,
  range and cooldown in the touched modules stays. Adding a *new* field to a look table is not
  a move; changing an existing one is.
- **Nothing in the simulation.** `src/focus/`, cooldowns, `src/core/post.ts` and the fight logic
  in `src/combat/` are untouched. `src/combat/enemy-mesh.ts` is the single exception and it is a
  view module — it imports nothing from the fight beyond types.
- **Every module this plan paints gets a bench scene in the same task.** B2's final task
  discovered four painted effects with no `BenchEffectId` at all and had to add them; that
  discovery does not get repeated at the end.
- Commit messages are a sentence in the imperative. No `feat:`/`fix:` prefixes.
- House comment style: comments explain WHY and name the rejected alternative.

---

## Task 1: The wedge vocabulary

**Files:** Modify `src/fx/effect-material.ts`, `src/fx/effect-material.test.ts`.

**Interfaces:** Produces `WEDGE_PREAMBLE`, consumed by Tasks 5 and 6.

**Why this exists.** B2's `sectorUvIsMonotone` says `vUv.x` runs monotonically along a bounded
wedge only while the half-angle stays at or under a quarter turn, and pins
`staffArc.finisher.halfAngle` (`Math.PI / 1.9`, about 94.7°) as the one shipped config that
fails it. **That predicate understates the problem: `POLAR_PREAMBLE`'s `angle` fails on the
same wedge too, for an independent reason.** `sectorTheta` puts that wedge's start edge at
−184.7°, outside the two-argument arctangent's (−π, π] range, so its fragments come back in two disjoint clusters.
Measured over the real geometry:

| Wedge | half-angle | `angle` range | largest gap in the sorted values |
| --- | --- | --- | --- |
| `gust` | 60.0° | 0.0833 .. 0.4167 | 0.0069 — contiguous |
| `staffArc.opener` | 81.8° | 0.0227 .. 0.4773 | 0.0095 — contiguous |
| `staffArc.finisher` | 94.7° | 0.0088 .. 0.9978 | **0.4737 — two clusters** |

A term written against `angle` on the finisher would seam straight down the middle of the swing
and run its gradient backwards on one side. `vUv.x` saturates to the full 0.0000 .. 1.0000
there, against the 60° gust's 0.0670 .. 0.9330.

`atan(p.x, -p.y)` measures the signed offset from the wedge's own centre — every wedge is
centred on local +Z, which is authored −Y — and returns exactly −halfAngle .. +halfAngle,
continuously, on all three including the 94.7° one.

- [ ] **Step 1: Write the failing tests**

Add to `src/fx/effect-material.test.ts`:

```ts
describe('WEDGE_PREAMBLE', () => {
  it('measures across the wedge from its own centre, not from the authored axis', () => {
    // GLSL has no `atan2`; the two-argument form is `atan(y, x)`, which is how
    // POLAR_PREAMBLE spells its own call. So the centred coordinate is `atan(p.x, -p.y)`:
    // numerator p.x, denominator -p.y.
    expect(WEDGE_PREAMBLE).toContain('atan(p.x, -p.y)')
    // Not atan(p.y, p.x): that is POLAR_PREAMBLE's coordinate, and on a wedge whose start
    // edge passes -180 degrees it returns two disjoint clusters rather than a run.
    expect(WEDGE_PREAMBLE).not.toContain('atan(p.y, p.x)')
  })

  it('normalises across to -1..1 against a halfAngle uniform', () => {
    expect(WEDGE_PREAMBLE).toContain('float across = atan(p.x, -p.y) / halfAngle;')
  })

  it('still gives radius, since a wedge has one', () => {
    expect(WEDGE_PREAMBLE).toContain('float radius = length(p);')
  })

  it('assembles into a legal body when halfAngle is supplied', () => {
    expect(() => effectFragmentSource(WEDGE_PREAMBLE + 'gl_FragColor = vec4(tint, alpha * across);'))
      .not.toThrow()
  })
})

describe('a wedge body without its halfAngle uniform', () => {
  it('is refused, because the shader would fail to compile where nothing can see it', () => {
    // The silent-shader trap in a new costume: a body referencing an undeclared uniform does
    // not throw, it fails to link, and the mesh then simply does not draw.
    expect(() => createEffectMaterial({
      body: WEDGE_PREAMBLE + 'gl_FragColor = vec4(tint, alpha * across);',
      uniforms: { tint: new Color(0xffffff), alpha: 1 },
    })).toThrow(WEDGE_UNIFORM_MESSAGE)
  })

  it('is accepted once halfAngle is there', () => {
    expect(() => createEffectMaterial({
      body: WEDGE_PREAMBLE + 'gl_FragColor = vec4(tint, alpha * across);',
      uniforms: { tint: new Color(0xffffff), alpha: 1, halfAngle: Math.PI / 3 },
    })).not.toThrow()
  })
})
```

Run: `npx vitest run src/fx/effect-material.test.ts`
Expected: FAIL — `WEDGE_PREAMBLE` and `WEDGE_UNIFORM_MESSAGE` do not exist.

- [ ] **Step 2: Implement**

```ts
/**
 * The coordinates a bounded wedge needs: how far out, and how far across from its own centre.
 *
 * **Why not `POLAR_PREAMBLE` here.** That preamble's `angle` is measured from the authored +X
 * axis and wraps at `atan`'s branch cut. `sectorTheta` centres every wedge on local +Z by
 * setting `thetaStart = -PI/2 - halfAngle`, so a wedge wider than a quarter turn has a start
 * edge past -180 degrees — outside the two-argument arctangent's range — and its fragments come back split into two
 * clusters at opposite ends of 0..1. Measured on the real geometry, `staffArc.finisher` at 94.7
 * degrees spans 0.0088..0.9978 with a 0.4737 gap in the middle, against the 60-degree gust's
 * contiguous 0.0833..0.4167. A gradient written against `angle` there seams down the middle of
 * the swing and reverses on one side of it. `vUv.x` is no better: it saturates to the full
 * 0.0000..1.0000 on that wedge, which is `sectorUvIsMonotone`'s bound failing in practice.
 *
 * `atan(p.x, -p.y)` measures from authored -Y, which *is* the wedge's centre, so it returns
 * -halfAngle..+halfAngle continuously for any half-angle short of a half turn. Dividing by the
 * `halfAngle` uniform makes `across` run -1 at one edge to +1 at the other whatever the wedge's
 * width, so a body's bounds mean the same thing on a 20-degree cone and a 95-degree sweep.
 *
 * The rejected alternative was keeping `sectorUvIsMonotone` as the guard and simply refusing to
 * write angular terms on wide wedges. That leaves the staff finisher — the widest sweep in the
 * game and the one that most wants a gradient along its arc — permanently unpaintable, to
 * protect a coordinate that was never the right one.
 */
export const WEDGE_PREAMBLE = /* glsl */ `
    vec2 p = vUv * 2.0 - 1.0;
    float radius = length(p);
    float across = atan(p.x, -p.y) / halfAngle;
`

/** Matched against a body so a missing `halfAngle` is a throw rather than a mesh that never draws. */
export const WEDGE_MARKER = 'atan(p.x, -p.y) / halfAngle'

export const WEDGE_UNIFORM_MESSAGE =
  'A body using WEDGE_PREAMBLE must declare a `halfAngle` uniform: without it the shader fails '
  + 'to link and the mesh silently does not draw.'
```

In `createEffectMaterial`, beside the existing `_pars_fragment` refusal, add: if the body
contains `WEDGE_MARKER` and `opts.uniforms` has no `halfAngle` key, throw
`WEDGE_UNIFORM_MESSAGE`. Say in a comment that this is the same failure mode as the
`_pars_fragment` trap wearing a different costume — a link error that surfaces as a correctly
transparent effect — and that catching it at construction is the only place a test can see it.

**The spelling is `atan`, not `atan2`, and it is already settled.** GLSL has no `atan2`; the
two-argument form is `atan(y, x)`, and `POLAR_PREAMBLE` in this same file already spells its own
call `atan(p.y, p.x)`. Since the argument order is (y, x), the centred coordinate is
`atan(p.x, -p.y)` — numerator `p.x`, denominator `-p.y`. Everything above uses that spelling.
Confirm it against `POLAR_PREAMBLE` once before you start, so a typo here does not become five
bodies that fail to link.

- [ ] **Step 3: Update the geometry table**

`effect-material.ts`'s table is the branch's central piece of encoded knowledge. Three rows
change and one is added:

- the `sectorGeometry` row should now recommend `WEDGE_PREAMBLE`'s `across` rather than
  `vUv.x`, and record both reasons `vUv.x` and `angle` fail — the monotonicity bound and the
  branch cut — pointing at `sectorUvIsMonotone` for the first;
- the `SphereGeometry` row stops being forward-looking: Task 4 gives it two callers. Say `vUv`
  is (azimuth, polar) and that a shell wanting its silhouette wants `vViewNormal` instead, as
  `ice-shell.ts` does;
- **add a row for hand-built `BufferGeometry`**: `aim-tell.ts`'s `createChevronGeometry` sets
  only a `position` attribute, so `vUv` reads as zero across the whole mesh and only `vLocal`
  means anything. A body written against `vUv` there is uniformly flat and looks deliberate.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/fx/effect-material.test.ts && npm test && npm run typecheck
git add src/fx/effect-material.ts src/fx/effect-material.test.ts
git commit -m "Give a bounded wedge a coordinate measured from its own centre"
```

---

## Task 2: The impact burst — one kind, then stop

**Files:** Modify `src/fx/impact.ts`, `src/fx/impact.test.ts`, `src/bench/scenes.ts`,
`src/bench/effects.ts`, and the bench tests.

**This task is a gate.** `impact.ts`'s comment insists its three kinds "are deliberately
different in kind, not just in size", and today they are one smooth expanding sphere at three
sizes and tints. "Differ in kind" has no single testable claim behind it, so it is gated the way
the collar was: paint **only the deflect**, give all three kinds a bench scene, then **stop and
report**. The controller shoots the three together and decides whether the difference reads
before the other two commit. Do not start Task 3.

**Why the deflect first.** It is the kind with the sharpest stated claim — "a spark off metal
instead of a puff of air" — and the one whose failure mode is named: it "must not read as a
weaker version of a connect". If a painted deflect beside two unpainted puffs does not read as a
different material, no amount of tuning the other two will save the idea.

**What stays.** Every field in `SHAPES`: `hit` `{ radius: 1.1, lifetime: 0.18, opacity: 0.55,
tint: 0xdff1ff }`, `down` `{ 2.3, 0.45, 0.4, 0xfff3d8 }`, `deflect` `{ 0.7, 0.12, 0.7,
0xbcc4d2 }`. `HEIGHT` 0.9, `START_FRACTION` 0.25. The geometry stays `SphereGeometry(1, 18, 12)`
scaled at runtime, and `side: DoubleSide` stays.

**The mechanism.** One body serving all three kinds, differing by uniforms read from `SHAPES`,
rather than three bodies. `SHAPES` is already the single source of per-kind truth and
`impact-targets.test.ts` compares fields off `impactShape` rather than literals — keeping one
table keeps that. Add three fields to `Shape`:

- `rim`: how wide the bright silhouette band is. Narrow reads as a hard shell, wide as a soft
  billow.
- `fill`: how much of the interior is drawn at all. Near zero reads as an outline; higher reads
  as a volume.
- `shards`: the angular frequency of the surface break-up, in whole turns. Zero is smooth.

Only `deflect`'s three are tuned in this task. Give `hit` and `down` values that reproduce
today's look as closely as one body can — smooth, moderate fill, moderate rim — and say in a
comment that Task 3 tunes them and that these are a holding position, not a design.

**`impact-targets.test.ts` must keep passing.** It asserts `deflect.radius < hit.radius`,
`deflect.lifetime < hit.lifetime`, `deflect.opacity > hit.opacity`, and that the three tints
are distinct. Adding fields cannot break those, but run it and confirm rather than assuming.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the deflect reads as a spark off metal', () => {
  it('breaks its surface into shards where the other two are smooth', () => {
    // impact.ts's own words: the deflect "must not read as a weaker version of a connect".
    // A different size and tint says weaker; a different surface says different material.
    expect(impactShape('deflect').shards).toBeGreaterThan(0)
    expect(impactShape('hit').shards).toBe(0)
    expect(impactShape('down').shards).toBe(0)
  })

  it('wears the hardest rim of the three, because a spark has an edge and a puff does not', () => {
    expect(impactShape('deflect').rim).toBeLessThan(impactShape('hit').rim)
    expect(impactShape('deflect').rim).toBeLessThan(impactShape('down').rim)
  })

  it('shards a whole number of turns, so the surface has no seam', () => {
    // `across`-style wrap: an angular frequency that is not periodic leaves a stationary
    // discontinuity down one meridian. Caught twice in B2.
    const material = burstMaterialOf(createImpact(ORIGIN, 'deflect'))
    expect(material.fragmentShader).toContain('6.2832')
  })

  it('finds its silhouette from the view, not from object space', () => {
    // A sphere's visible boundary is where it turns edge-on to the camera, which is a fact
    // about the view. ice-shell.ts carries this argument in full.
    const material = burstMaterialOf(createImpact(ORIGIN, 'deflect'))
    expect(material.fragmentShader).toContain('vViewNormal')
  })

  it('keeps every shipped number', () => {
    expect(impactShape('deflect').radius).toBeCloseTo(0.7, 5)
    expect(impactShape('deflect').lifetime).toBeCloseTo(0.12, 5)
    expect(impactShape('deflect').opacity).toBeCloseTo(0.7, 5)
    expect(impactShape('deflect').tint).toBe(0xbcc4d2)
  })

  it('advances time, so the shards are not a still pattern', () => {
    const effect = createImpact(ORIGIN, 'deflect')
    const material = burstMaterialOf(effect)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.06; t += 1 / 60) effect.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })
})
```

Run: `npx vitest run src/fx/impact.test.ts`
Expected: FAIL — `Shape` has no `shards`, and the arc's material is a `MeshBasicMaterial` with
no `uniforms`.

- [ ] **Step 2: Implement**

```ts
/**
 * One surface for all three kinds, differing by what `SHAPES` says rather than by three bodies.
 *
 * **Why the silhouette comes from the view.** A sphere's visible boundary is wherever its
 * surface turns edge-on to the camera, which is a fact about the view and not about the mesh —
 * `ice-shell.ts`'s `SHELL_BODY` carries that argument in full and this is the same measurement.
 * `facing` is 1 where the surface points at the camera and 0 at the silhouette, so `rim`'s
 * bound decides how wide the bright edge band is: a narrow band reads as a hard shell, a wide
 * one as a soft billow. That single number is most of what separates a spark from a cloud.
 *
 * **Why `shards` is in whole turns.** It is an angular frequency around the sphere, so a value
 * that is not periodic leaves a stationary discontinuity down one meridian — the bug B2 caught
 * twice, on a cylinder's `vUv.x` and on a disc's `angle`. Multiplying by a turn first makes the
 * literal mean lobes rather than radians, and makes it wrap cleanly.
 *
 * `fill` is what stops a smooth kind from being an outline: it is the floor the interior is
 * drawn at once `edge` has fallen away. `deflect` runs it low, so what is left is a broken
 * shell rather than a ball.
 */
const BURST_BODY = /* glsl */ `
    vec3 n = normalize(vViewNormal);
    float facing = abs(n.z);
    float edge = smoothstep(1.0 - rim, 1.0 - rim * 0.35, 1.0 - facing);
    float lumps = shards > 0.0
      ? 0.55 + 0.45 * sin(atan(vLocal.x, vLocal.z) * 6.2832 * shards + time * 40.0)
      : 1.0;
    gl_FragColor = vec4(tint, alpha * max(edge * lumps, fill * (1.0 - edge)));
`
```

Build it with `createEffectMaterial({ body: BURST_BODY, uniforms: { tint: new Color(shape.tint),
alpha: shape.opacity, time: 0, rim: shape.rim, fill: shape.fill, shards: shape.shards } })`.
Leave `side` to the builder's `DoubleSide` default, which matches what the old material set.
**Do not pass `depthTest`** — a burst around a soldier is a closed shape whose far half is
behind them, and `air-wall.ts` and `ice-shell.ts` both keep the depth test for that reason.
Confirm the old material's `depthTest` was the default `true` before relying on this; if it
passed `false`, preserve `false` and say so.

Write `time` into the effect's existing `apply()` beside the scale and opacity work.

**Two things to reason about rather than transcribe.** `1.0 - facing` is used so `rim` reads as
"width of the bright band at the silhouette" and grows the band as it grows — check the sense
holds at `facing` 0 and 1 before shipping, and if it inverts, fix it and say so. And `shards > 0.0`
in a `?:` is a branch on a uniform, which is legal but reads oddly in GLSL; if a `mix` on a
`step` is cleaner, use it, keep the whole expression pinned in a test, and explain the choice.

- [ ] **Step 3: Bench scenes for all three kinds**

Add `'impact-hit'`, `'impact-down'`, `'impact-deflect'` to `BenchEffectId`, register all three
in `BENCH_EFFECTS` (`createImpact` takes `(position, kind)`, so `forward` goes unused — the
file has entries that do this and comment on why), and add three scenes over
`ARCHIPELAGO_ID`.

**Use one pose for all three**, and say in the comment that the poses are shared precisely so
the only thing differing between the shots is the burst — the argument the `water` scene already
makes, which should be pointed at rather than repeated. The bursts are 0.7 to 2.3 units across
against the `gust` scene's 12-metre framing, so **the `gust` pose is too wide**: choose a closer
one, and remember that `src/bench/main.ts` hands the scene's *target* to the effect as its
origin while `createImpact` then adds `HEIGHT` 0.9 on top — the trap the `ice-shell` scene fell
into in B2. Target bare ground at **11.9** and account for the lift in the camera, not the
target.

Land each frozen frame mid-life. Lifetimes are 0.18, 0.45 and 0.12; the bench freezes
`duration - fireAt` seconds in, and `src/bench/effects.test.ts` derives the exact age through
`runFixedClock` — satisfy it, and report the tightest margin.

- [ ] **Step 4: Run, commit, and STOP**

```bash
npx vitest run src/fx/impact.test.ts src/fx/impact-targets.test.ts && npm test && npm run typecheck && npm run build
git add src/fx/impact.ts src/fx/impact.test.ts src/bench/
git commit -m "Break the deflect's surface into shards, so it stops reading as a smaller connect"
```

Then **stop and report**. State that the deflect's surface is unverified on screen, that `hit`
and `down` are on holding values, and that the controller's three shots are the gate. Do not
begin Task 3.

---

## Task 3: The other two impact surfaces

**Files:** Modify `src/fx/impact.ts`, `src/fx/impact.test.ts`.

**Blocked on Task 2's gate.** The controller will hand over what the three shots showed. Tune
`hit` and `down`'s `rim`, `fill` and `shards` to the design their comments already state — the
connect "quick and tight", the down "broad and slow" — and replace the holding-position comment
from Task 2 with the real argument for each number.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the three kinds differ in surface, not only in size', () => {
  it('gives the down the softest, widest rim, because it is a billow', () => {
    expect(impactShape('down').rim).toBeGreaterThan(impactShape('hit').rim)
  })

  it('gives the down the most interior, because it is a volume and the hit is an outline', () => {
    expect(impactShape('down').fill).toBeGreaterThan(impactShape('hit').fill)
  })

  it('keeps every shipped number for both kinds', () => {
    expect(impactShape('hit').radius).toBeCloseTo(1.1, 5)
    expect(impactShape('hit').lifetime).toBeCloseTo(0.18, 5)
    expect(impactShape('hit').opacity).toBeCloseTo(0.55, 5)
    expect(impactShape('hit').tint).toBe(0xdff1ff)
    expect(impactShape('down').radius).toBeCloseTo(2.3, 5)
    expect(impactShape('down').lifetime).toBeCloseTo(0.45, 5)
    expect(impactShape('down').opacity).toBeCloseTo(0.4, 5)
    expect(impactShape('down').tint).toBe(0xfff3d8)
  })
})
```

The three shipped `rim`/`fill`/`shards` triples are pinned by exact `toBeCloseTo` alongside
these relational assertions, so a retune is a visible edit. `impact-targets.test.ts`'s existing
comparisons must still pass.

- [ ] **Step 2: Run and commit**

```bash
npx vitest run src/fx/impact.test.ts src/fx/impact-targets.test.ts && npm test && npm run typecheck
git add src/fx/impact.ts src/fx/impact.test.ts
git commit -m "Tune the connect to an outline and the down to a billow"
```

---

## Task 4: The two character shells

**Files:** Modify `src/fx/guard-shell.ts`, `src/fx/avatar-aura.ts` and both test files;
`src/bench/scenes.ts`, `src/bench/effects.ts`, bench tests.

**Geometry:** both are `SphereGeometry(RADIUS, 20, 14)` with `side: BackSide`. **The radius is
baked into the geometry, not applied as a scale** — 1.15 for the guard shell, 1.35 for the aura
— so `vLocal` has length RADIUS rather than 1 and `normalize(vLocal)` is required if object
space is read at all. `vViewNormal` is scale-independent and is what the silhouette wants
anyway.

**What stays.** Guard shell: `RADIUS` 1.15, `CENTRE_Y` 0.95, `TINT` `0xd6f6ff`, `PEAK_OPACITY`
0.4, `FADE_IN_SECONDS` 0.02, `FADE_OUT_SECONDS` 0.03. Aura: `RADIUS` 1.35, `HEIGHT` 1,
`PEAK_OPACITY` 0.3, `FADE_IN_SECONDS` 0.15, `FADE_OUT_SECONDS` 0.4, `TINT` `0xfff3c4`. **Both
keep `side: BackSide`**, which `createEffectMaterial` will otherwise replace with its
`DoubleSide` default — the aura's own comment says inside-out is what makes it read "as air
around the character rather than a bubble drawn over them". Both keep their `update(dt, active)`
shape; neither is an `Effect`, and neither should become one. Both keep skipping themselves
entirely when invisible, and both keep `excludeFromShadows`.

**`depthTest` is not passed** — it defaults to `true`, which is what the old materials had, and
a shell around the character wants it for the reason `air-wall.ts` records: the half below the
character's footing should stay hidden by the ground.

- [ ] **Step 1: Write the failing tests**

For each of the two files, in its own test:

```ts
describe('the shell reads as a surface rather than a wash', () => {
  it('brightens toward its silhouette, where the surface turns away', () => {
    // ice-shell.ts's argument, unchanged: on a closed shell the visible boundary is a fact
    // about the view, so a band in object space is not a band on screen.
    const material = shellMaterialOf(createGuardShell())
    expect(material.fragmentShader).toContain('vViewNormal')
    expect(material.fragmentShader).toContain('1.0 - abs(n.z)')
  })

  it('stays BackSide, so it still reads as air around the character', () => {
    expect(shellMaterialOf(createGuardShell()).side).toBe(BackSide)
  })

  it('stays depth-tested, so its lower half is hidden by the ground', () => {
    expect(shellMaterialOf(createGuardShell()).depthTest).toBe(true)
  })

  it('drives alpha from the fade, not from a time uniform', () => {
    // The window is the entire mechanic and it is 0.11s long. A shell with its own clock
    // could outlive the protection it advertises; this one cannot, because `update` is the
    // only thing that writes its opacity.
    const shell = createGuardShell()
    const material = shellMaterialOf(shell)
    shell.update(1 / 60, true)
    const lit = material.uniforms.alpha?.value
    shell.update(1 / 60, false)
    shell.update(1 / 60, false)
    expect(material.uniforms.alpha?.value).toBeLessThan(lit as number)
  })

  it('costs nothing while invisible', () => {
    const shell = createGuardShell()
    shell.update(1 / 60, false)
    expect(shell.object.visible).toBe(false)
  })
})
```

The aura's version asserts the same five things against `createAvatarAura()`, with its own
fade-out being the slow one.

- [ ] **Step 2: Implement**

```ts
/**
 * A bright silhouette and a dim interior, so the shell reads as a surface and not a wash.
 *
 * A flat `MeshBasicMaterial` at one opacity draws the whole projected disc at the same value,
 * which over a character reads as a tinted smear with no shape to it. What tells the eye this is
 * a *shell* is its edge — and on a closed surface the edge is wherever the surface turns
 * edge-on to the camera, which is a fact about the view rather than about the mesh.
 * `ice-shell.ts`'s `SHELL_BODY` carries that argument in full; this is the third object in the
 * directory to use it and the reasoning is not restated.
 *
 * `abs` because the shell is `BackSide`: its rendered normals point away from the viewer, so the
 * raw view-space z is negative over the whole visible half.
 *
 * No `time` uniform, deliberately, and the reason is the mechanic rather than taste: the window
 * this advertises is 0.11 seconds long, and `update` writing `alpha` is the only thing that
 * moves this material. A shell with a clock of its own could keep animating past the protection
 * it stands for, which is the one failure this tell must not have.
 */
const SHELL_BODY = /* glsl */ `
    vec3 n = normalize(vViewNormal);
    float grazing = 1.0 - abs(n.z);
    float core = smoothstep(0.30, 0.70, grazing);
    gl_FragColor = vec4(mix(tint * 0.35, tint, core), alpha * max(core, 0.30));
`
```

Both files take the same body. Whether it should literally be duplicated or shared is the
implementer's call to make and to argue: two 60-line modules with an identical five-line body is
a real duplication, and a shared constant is a real coupling between the Slipstream's guard and
the Avatar State. **Pick one, and say in the comment which and why.** If shared, it belongs
beside the other shared shader text rather than in either module.

`mix(tint * 0.35, tint, core)` rather than B2's `mix(tint * 0.18, tint, core)`: these are pale
tints at low peak opacity over a character, and 0.18 of `0xfff3c4` is close to black. **Verify
that** — compute both and say the numbers in your report — and if 0.18 is in fact fine, use it
for consistency with the five collar carriers and say so.

- [ ] **Step 3: Bench scenes**

Both are held states with `update(dt, active)` rather than `Effect`s, so they need wrapping the
way `benchAirWall` and `benchVortexCharge` already wrap held states — read those two, follow
their shape, and hold each shell up well past its fade-in before the frozen frame.

Neither shell has anything to sit around in the bench, since the player does not exist there.
Say that in the scene comments: the shot shows the shell's own shape against the world, and
whether it reads *around a character* is a thing only play can answer.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/fx/guard-shell.test.ts src/fx/avatar-aura.test.ts && npm test && npm run typecheck && npm run build
git add src/fx/guard-shell.ts src/fx/guard-shell.test.ts src/fx/avatar-aura.ts src/fx/avatar-aura.test.ts src/bench/
git commit -m "Give the two character shells an edge, so they stop reading as a tinted smear"
```

---

## Task 5: The staff swing

**Files:** Modify `src/fx/staff-arc-fx.ts`, `src/fx/staff-arc-fx.test.ts`, `src/bench/scenes.ts`,
`src/bench/effects.ts`, bench tests.

**Geometry:** `sectorGeometry(shape.halfAngle, 0, 1)` — a **disc** sector, inner radius 0, so
`radius` from a preamble genuinely spans 0..1. This is the first wedge in this arc that is not a
thin annulus, so its bounds are the first that can sit where a reader would guess.

**Consumes Task 1's `WEDGE_PREAMBLE`**, and must: `staffArc.finisher.halfAngle` is 94.7°, where
both `vUv.x` and `POLAR_PREAMBLE`'s `angle` break. Pass `halfAngle: shape.halfAngle` as a
uniform — the builder will throw without it.

**What stays.** `LIFETIME` 0.16, `HEIGHT` 1, `FILL_OPACITY` 0.55, `TINT` `0xffa64d`,
`depthTest: false`, `side: DoubleSide`, the `SECTOR_FLAT_ROTATION_X` rotation, the
`safeScale(shape.range)` scale, and the `lookAt` on the flattened heading.

**`createStaffArc`'s signature does not change, and it does not learn whether it is a finisher.**
The design note floated giving the swing a finisher paint flag; that is dropped deliberately.
The file's own comment says it "draws whatever shape it is handed and has no business knowing
which swing produced it", and the finisher's shape *already* differs — 94.7° against the
opener's 81.8°, at a different range — so a finisher swing already looks different without the
flag. The landing gets its own cue in Task 8, which is the signal that actually has no consumer.
Two cues for one fact, one of them derived from a flag the file argued against carrying, is
worse than one cue in the right place. **Say this in the commit message**, so the dropped idea
is a decision on the record rather than an omission.

- [ ] **Step 1: Write the failing test**

```ts
describe('the swing reads along its own sweep', () => {
  it('measures across the wedge from its centre, so the finisher does not seam', () => {
    // staffArc.finisher is 94.7 degrees, and sectorTheta puts its start edge at -184.7 —
    // outside atan's range. POLAR_PREAMBLE's angle returns two clusters there; vUv.x
    // saturates. WEDGE_PREAMBLE's `across` is the only coordinate that runs.
    const material = fillMaterialOf(createStaffArc(ORIGIN, NORTH, FINISHER_SHAPE))
    expect(material.fragmentShader).toContain('across')
    expect(material.fragmentShader).not.toContain('vUv.x')
    expect(material.fragmentShader).not.toContain('atan(p.y, p.x)')
  })

  it('carries the half-angle it was built for, so `across` normalises', () => {
    const material = fillMaterialOf(createStaffArc(ORIGIN, NORTH, FINISHER_SHAPE))
    expect(material.uniforms.halfAngle?.value).toBeCloseTo(FINISHER_SHAPE.halfAngle, 6)
  })

  it('rims its leading edge, where a swing is felt', () => {
    const material = fillMaterialOf(createStaffArc(ORIGIN, NORTH, OPENER_SHAPE))
    expect(material.fragmentShader).toContain('smoothstep(0.62, 0.88, radius)')
    expect(material.fragmentShader).toContain('mix(tint * 0.18, tint, core)')
  })

  it('is brightest at the middle of the sweep and thinnest at its edges', () => {
    // A swing lands with its middle. A term flat across `across` would read as a shape being
    // displayed rather than a blow being struck.
    const material = fillMaterialOf(createStaffArc(ORIGIN, NORTH, OPENER_SHAPE))
    expect(material.fragmentShader).toContain('1.0 - across * across')
  })

  it('keeps the drawn shape identical to the shape it was handed', () => {
    // The honesty argument this file exists on: the drawn arc and the hit arc cannot diverge.
    // staff-arc-fx.test.ts's containment check against inCone remains the authority.
    const fill = fillMeshOf(createStaffArc(ORIGIN, NORTH, FINISHER_SHAPE))
    expect(fill.scale.x).toBeCloseTo(FINISHER_SHAPE.range, 5)
  })

  it('advances time', () => {
    const effect = createStaffArc(ORIGIN, NORTH, OPENER_SHAPE)
    const material = fillMaterialOf(effect)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.08; t += 1 / 60) effect.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })
})
```

Take `OPENER_SHAPE` and `FINISHER_SHAPE` from `staffShape(false, …)` and `staffShape(true, …)`
against the shipped config rather than writing half-angles by hand, so the test moves with the
game.

- [ ] **Step 2: Implement**

```ts
/**
 * Bright at the leading edge, bright down the middle of the sweep, thin at both ends.
 *
 * `across` comes from `WEDGE_PREAMBLE` rather than from `vUv.x` or `POLAR_PREAMBLE`'s `angle`,
 * and on this effect that is not a preference. `staffArc.finisher.halfAngle` is `Math.PI / 1.9`,
 * about 94.7 degrees, and `sectorTheta` puts that wedge's start edge at -184.7 — outside
 * `atan`'s range. Measured on the real geometry, `angle` returns 0.0088..0.9978 with a 0.4737
 * gap in the middle: two clusters, not a run, so a gradient written against it seams down the
 * centre of the swing and reverses on one side. `vUv.x` saturates to the full 0..1 there, which
 * is `sectorUvIsMonotone`'s bound failing in practice. `across` runs -1 to +1 across any wedge.
 *
 * `sweep` is `1.0 - across * across`: 1 down the centre line, 0 at both edges. A staff lands
 * with the middle of its arc, and a fill that is flat across the wedge reads as a shape being
 * displayed rather than a blow being struck. Squared rather than `abs`, so the falloff is
 * gentle near the centre and steep at the rim — which is where the swing stops mattering.
 *
 * The collar is at the leading edge, and unlike every arc in B2 this is a *disc* sector, so
 * `radius` really does span 0..1 and these bounds mean what they look like. The outer 12 per
 * cent is left to fall away so the reach has a soft end rather than a cut edge.
 */
const FILL_BODY = /* glsl */ `
    float core = smoothstep(0.62, 0.88, radius);
    float collar = smoothstep(0.34, 0.62, radius) * (1.0 - core);
    float sweep = 1.0 - across * across;
    float shimmer = 0.88 + 0.12 * sin(radius * 26.0 - time * 90.0);
    gl_FragColor = vec4(mix(tint * 0.18, tint, core), alpha * sweep * max(core * shimmer, collar * 0.5));
`
```

Build with `createEffectMaterial({ body: WEDGE_PREAMBLE + FILL_BODY, uniforms: { tint: new
Color(TINT), alpha: FILL_OPACITY, time: 0, halfAngle: shape.halfAngle }, depthTest: false })`.
Write `time` in the existing `apply()`.

**Check the two frequencies and record what each buys**, the way `fire-thrust.ts` does. `radius
* 26.0` across a full 0..1 is about 4.14 cycles along the reach; `time * 90.0` over `LIFETIME`
0.16 is about 2.29 cycles — over one, so this one genuinely flickers rather than travels, which
is right for a strike. Verify both numbers and correct the comment if either is wrong.

**Register in `src/fx/collar-bounds.test.ts`.** This is a `RingGeometry` carrying a
`core`/`collar` pair against `radius`, which is exactly that suite's membership rule. Its band is
0..1, not 0.84..1.0 — the guard derives the inner edge from the mesh, so it will read 0. Prove
it bites: break a bound above 1.0, watch it fail, restore it.

- [ ] **Step 3: Bench scenes**

Two scenes, `staff-opener` and `staff-finisher`, over `ARCHIPELAGO_ID`, **sharing one pose** so
the only difference between the shots is the swing — the wider wedge is the thing worth seeing.
The `gust` pose frames a 12-metre ground wedge and the staff's range is smaller; check the real
`staffArc` ranges and choose a pose that frames the finisher's reach, then use it for both.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/fx/staff-arc-fx.test.ts src/fx/collar-bounds.test.ts && npm test && npm run typecheck && npm run build
git add src/fx/staff-arc-fx.ts src/fx/staff-arc-fx.test.ts src/fx/collar-bounds.test.ts src/bench/
git commit -m "Paint the staff swing along its sweep, and drop the finisher paint flag

createStaffArc keeps its signature and still does not learn which swing produced
the shape it was handed, which is the honesty argument the file exists on. A
finisher already looks different because its shape is different — 94.7 degrees
against the opener's 81.8, at a different range — so the flag would have bought a
second cue for a fact that already has one. The landing gets its own cue instead,
where the signal genuinely has no consumer."
```

---

## Task 6: The aim tell

**Files:** Modify `src/fx/aim-tell.ts`, `src/fx/aim-tell.test.ts`, `src/bench/scenes.ts`,
`src/bench/effects.ts`, bench tests.

**This is the one task where doing less is the correct answer.** The tell is on screen
continuously while the player holds a direction, and the thing it must never do is compete with
the effect it predicts. `previewOpacity` is 0.14. **Nothing here pulses, travels, flickers or
carries a `time` uniform**, and there is a test asserting that.

**Two materials, two different geometries, and one of them is a trap.**

- The chevron: `createChevronGeometry` builds a `BufferGeometry` and sets **only a `position`
  attribute**. There is no `uv`, so `vUv` reads as zero across the whole mesh and a body written
  against it is uniformly flat — and looks deliberate. Only `vLocal` means anything. Task 1 adds
  a geometry-table row for this; confirm the attribute list yourself before relying on it.
- The preview: `sectorGeometry(halfAngle, 0, 1)`, a disc sector, **rebuilt when `halfAngle`
  changes** because a `RingGeometry` cannot change its theta after construction. The material
  survives the rebuild, but if the preview's body uses `WEDGE_PREAMBLE` then its `halfAngle`
  uniform must be rewritten on the same branch that rebuilds the geometry — otherwise the tell
  normalises against a stale angle and the shape silently disagrees with itself. **This is the
  one real hazard in the task.** Write a test that drives `update` with two different
  `ConeShape`s and asserts the uniform followed.

**What stays.** `HEIGHT` 0.08, `TINT` `0x7fe4ff`, `MARKER_OPACITY` 0.5, the whole
`AimTellConfig` (`markerDistance` 3, `markerSize` 0.55, `previewOpacity` 0.14, `dimmedFactor`
0.4), `depthTest: false` on both, `side: DoubleSide` on both, the flattened `lookAt`, the
conditional geometry rebuild, and `preview.visible = targeted`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the tell stays quiet', () => {
  it('has no clock, because a tell that animates competes with the move it predicts', () => {
    const tell = createAimTell()
    expect(markerMaterialOf(tell).uniforms.time).toBeUndefined()
    expect(previewMaterialOf(tell).uniforms.time).toBeUndefined()
  })

  it('reads the chevron from object space, because that geometry has no uvs at all', () => {
    // createChevronGeometry sets only `position`. A body against vUv there is uniformly flat
    // and looks intentional, which is the worst kind of wrong.
    const material = markerMaterialOf(createAimTell())
    expect(material.fragmentShader).toContain('vLocal')
    expect(material.fragmentShader).not.toContain('vUv.x')
  })

  it('rebuilds the preview uniform with the preview geometry', () => {
    // A RingGeometry cannot change theta, so a changed half-angle rebuilds it. If the
    // halfAngle uniform does not follow, `across` normalises against a stale angle and the
    // tell disagrees with its own shape.
    const tell = createAimTell()
    const material = previewMaterialOf(tell)
    tell.update(ORIGIN, NORTH, true, true, { range: 12, halfAngle: Math.PI / 3, verticalReach: 3 })
    expect(material.uniforms.halfAngle?.value).toBeCloseTo(Math.PI / 3, 6)
    tell.update(ORIGIN, NORTH, true, true, { range: 10, halfAngle: Math.PI / 6, verticalReach: 3 })
    expect(material.uniforms.halfAngle?.value).toBeCloseTo(Math.PI / 6, 6)
  })

  it('still dims on cooldown by the configured factor and nothing else', () => {
    const c = DEFAULT_AIM_TELL_CONFIG
    const tell = createAimTell(c)
    const material = previewMaterialOf(tell)
    tell.update(ORIGIN, NORTH, true, true, SHAPE)
    const ready = material.uniforms.alpha?.value as number
    tell.update(ORIGIN, NORTH, true, false, SHAPE)
    expect(material.uniforms.alpha?.value).toBeCloseTo(ready * c.dimmedFactor, 5)
  })

  it('edges the preview so its reach is legible, without filling it in', () => {
    const material = previewMaterialOf(createAimTell())
    expect(material.fragmentShader).toContain('smoothstep(0.70, 0.96, radius)')
  })
})
```

- [ ] **Step 2: Implement**

Two small bodies.

```ts
/**
 * The chevron, shaded from object space because its geometry has no texture coordinates.
 *
 * `createChevronGeometry` sets a `position` attribute and nothing else, so `vUv` is zero across
 * every fragment and a gradient written against it renders as a flat fill that looks like a
 * choice. `vLocal.z` runs from the tail to the point, which is the one axis a direction marker
 * has any business varying along: brightest at the point, so the chevron reads as pointing
 * rather than as a triangle.
 *
 * No clock. A tell that animates is a tell competing with the move it predicts.
 */
const MARKER_BODY = /* glsl */ `
    float toPoint = smoothstep(-0.4, 1.0, vLocal.z / max(size, 1e-4));
    gl_FragColor = vec4(tint, alpha * (0.45 + 0.55 * toPoint));
`
```

`size` is `c.markerSize`, passed as a uniform, because `createChevronGeometry` bakes the size
into the vertex positions — so `vLocal.z` spans `-size * 0.4` to `+size`, not −1 to 1. **Verify
that against `createChevronGeometry` and normalise correctly**; the `-0.4`/`1.0` bounds above
assume `vLocal.z / size`. If the arithmetic differs, use the truth and say so.

```ts
/**
 * The preview, edged rather than filled.
 *
 * A flat 0.14-opacity sector says "somewhere around here". The reach is the fact the player
 * needs, so the edge carries the value and the interior stays nearly empty — which also keeps
 * the tell from competing with the gust that follows it into the same space. No collar: this is
 * not an effect claiming to be an event, and a dark band inside a 0.14 fill would be invisible.
 *
 * `across` from `WEDGE_PREAMBLE` is deliberately unused. Both previewable cones — the gust's 60
 * degrees and the Water Grip's 30 — are inside `sectorUvIsMonotone`'s bound, so `vUv.x` would
 * have worked here; the preamble is used anyway so this file and `staff-arc-fx.ts` reach for the
 * same coordinate, and so a future move with a wider cone cannot quietly break it.
 */
const PREVIEW_BODY = /* glsl */ `
    float rim = smoothstep(0.70, 0.96, radius);
    float far = smoothstep(1.0, 0.96, radius);
    gl_FragColor = vec4(tint, alpha * max(rim * far, 0.18));
`
```

Both materials get their opacity through an `alpha` uniform written where the old code wrote
`material.opacity`. The preview's `halfAngle` uniform is written **on the same branch that
rebuilds the geometry**, and also on first construction.

- [ ] **Step 3: Bench scene**

One scene, `aim-tell`. It is a held state with a five-argument `update`, so it needs a wrapper
like `benchAirWall`'s — hold it `targeted` and `ready` so both meshes are drawn, and pass the
gust's own `ConeShape` so the previewed cone is one the game actually previews.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/fx/aim-tell.test.ts && npm test && npm run typecheck && npm run build
git add src/fx/aim-tell.ts src/fx/aim-tell.test.ts src/bench/
git commit -m "Edge the aim preview and point the chevron, without giving either a clock"
```

---

## Task 7: The mark pip

**Files:** Modify `src/combat/enemy-mesh.ts` and its test. Create nothing.

**Why this is not in `src/fx/`.** The pip is part of a soldier's view, it lives and dies with
one, and `EnemyView.sync(enemy, cameraQuaternion, rising)` already receives both the whole
`Enemy` — so `enemy.mark` is already in scope — and the camera quaternion, because the health
bar already billboards. Nothing needs plumbing. A module in `src/fx/` would need the mark
pushed to it every frame from `main.ts`, which is a new path for a signal that already arrives.

**`src/combat/enemy-mesh.ts` is the one file under `src/combat/` this plan touches**, and it is
a view: it imports types and draws. No gameplay number moves, and nothing in the simulation is
read that `sync` is not already handed.

**What the pip has to say.** `Enemy.mark` is `{ element, secondsLeft } | null`. The reaction
table cares only about `element` — water on a fire-marked soldier makes steam, water on an
earth-marked one makes mud — so the pip's job is to say *which element*, legibly, at fight
distance and at the shallow camera angle this game plays at. `aim-tell.ts` already argues that
case for a chevron over a bar or a dot; the same reasoning applies, and hue alone is the weakest
possible channel for it.

**Constraints.**
- **It must cost nothing when `mark` is null**, the way `avatar-aura` and `guard-shell` skip
  themselves entirely when invisible. Four soldiers each carrying a per-frame billboard is a
  cost no effect in this game has had, since every effect so far is one-shot or one-per-player.
- **`secondsLeft` should be visible in some form**, because a mark about to expire and a fresh
  one are different tactical facts — but the pip must not become a second health bar.
- **It billboards from the `cameraQuaternion` `sync` already receives**, the same way the health
  bar does. Read how that is done and follow it rather than inventing a second convention.
- Element tints: take them from wherever the game already states them rather than inventing
  four. If no such table exists, say so in the report and put the new one somewhere a later
  reader will find it.
- `excludeFromShadows` on the mesh, like every other view object here.

- [ ] **Step 1: Write the failing test**

```ts
describe('the mark pip', () => {
  it('is hidden on an unmarked soldier, and costs nothing', () => {
    const view = createEnemyView('spear', C)
    view.sync({ ...enemy, mark: null }, IDENTITY, 0)
    expect(pipOf(view).visible).toBe(false)
  })

  it('appears when a mark is written, and says which element', () => {
    const view = createEnemyView('spear', C)
    view.sync({ ...enemy, mark: { element: 'fire', secondsLeft: 2.5 } }, IDENTITY, 0)
    const pip = pipOf(view)
    expect(pip.visible).toBe(true)
    const fire = colourOf(pip)
    view.sync({ ...enemy, mark: { element: 'earth', secondsLeft: 2.5 } }, IDENTITY, 0)
    expect(colourOf(pip)).not.toBe(fire)
  })

  it('shows a mark running out, because a fresh mark and a dying one are different facts', () => {
    const view = createEnemyView('spear', C)
    view.sync({ ...enemy, mark: { element: 'fire', secondsLeft: 2.5 } }, IDENTITY, 0)
    const fresh = fadeOf(pipOf(view))
    view.sync({ ...enemy, mark: { element: 'fire', secondsLeft: 0.2 } }, IDENTITY, 0)
    expect(fadeOf(pipOf(view))).toBeLessThan(fresh)
  })

  it('faces the camera, like the health bar above it', () => {
    const view = createEnemyView('spear', C)
    view.sync({ ...enemy, mark: { element: 'water', secondsLeft: 1 } }, TURNED, 0)
    expect(pipOf(view).quaternion.x).toBeCloseTo(TURNED.x, 5)
  })

  it('is hidden on a downed soldier, because a mark on something that cannot act says nothing', () => {
    // markEnemy already refuses a downed body for this reason. The view should agree.
    const view = createEnemyView('spear', C)
    view.sync({ ...downedEnemy, mark: { element: 'fire', secondsLeft: 2.5 } }, IDENTITY, 0)
    expect(pipOf(view).visible).toBe(false)
  })
})
```

The last case is a claim about intent as much as code: `markEnemy` refuses to write a mark on a
downed body, so a stale mark surviving a knockdown should not be drawn. **Check whether the
simulation clears `mark` on a down before writing that test** — if it does, the case is
belt-and-braces and should say so; if it does not, the view is the only thing standing between
the player and a pip on a body.

- [ ] **Step 2: Implement, run and commit**

```bash
npx vitest run src/combat/enemy-mesh.test.ts && npm test && npm run typecheck && npm run build
git add src/combat/enemy-mesh.ts src/combat/enemy-mesh.test.ts
git commit -m "Draw the elemental mark, so the reaction system stops being invisible"
```

**No bench scene.** The bench has no soldiers — `src/bench/main.ts`'s own comment says the
player, the enemies and the input tracker do not exist there. Say so in the report and list the
pip under what the bench cannot answer.

---

## Task 8: The finisher flourish

**Files:** Create `src/fx/finisher.ts`, `src/fx/finisher.test.ts`; modify `src/main.ts`,
`src/bench/effects.ts`, `src/fx/scale-wiring.test.ts`, and `src/bench/scenes.ts`.

**Interfaces:** Produces `export function createFinisherFlare(at: Vector3): Effect`.

**The signal.** `finisherThisFrame` is a **boolean**, not a list of soldiers, and
`stepEncounter` raises it only on a frame where a finisher actually behaved like one — the `land`
helper raises it, and the freeze deliberately routes through `advanceChain` instead so that a
frame where a freeze completed a string does not. That comment's words: "a flourish drawn over
it would be feedback for nothing." Two separate comments in `encounter.ts` say this signal
exists for a later step to draw a flourish from. This is that step, and consuming it is the
point of the task.

Being frame-level rather than per-enemy settles where it draws: **at the player**, once. The
finisher is the player's act, and the fact worth telling them is that the string completed and
went through armour it would otherwise have bounced off.

**It must not be a ring.** B2's whole argument for giving steam and mud their own shapes was
that one shape cannot mean Pressure Wave, vortex, finisher, steam and mud at once, and the ring
already means the first two. `src/bench/effects.ts` still routes the `finisher` bench id through
`ringAt` to `createShockwave` as a placeholder — **repoint it**, and that placeholder's
disappearance is the last of the borrowing this arc set out to undo.

**The shape.** A fast upward flare at the player's feet: a `CylinderGeometry` frustum, narrow at
the bottom and wide at the top, open-ended, drawn in the staff's own warm `0xffa64d`. Vertical,
warm and fast at the player is unlike anything else in the vocabulary — the ring is flat and at
an enemy, steam is pale and slow and at an enemy, the staff arc is flat and wide, and no element
is vertical at the player. Reusing the staff's tint is deliberate and moves no tint: it ties the
flourish to the weapon that earned it.

`CylinderGeometry`'s side-face `vUv` is genuinely (around, up) — a verified row in the geometry
table, and what `air-wall.ts` and `steam.ts` both use.

**Timings and dimensions are yours to choose**, argued in comments and pinned in tests the way
`steam.ts` and `mud.ts` did theirs. Keep it short: this is a punctuation mark on a landing, not
a state. It must be over well before the player can act again.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the finisher flare', () => {
  it('rises and widens, because a flourish opens upward', () => {
    const effect = createFinisherFlare(new Vector3(0, 11.9, 0))
    const startScale = effect.object.scale.x
    for (let t = 0; t < 0.1; t += 1 / 60) effect.advance(1 / 60)
    expect(effect.object.scale.x).toBeGreaterThan(startScale)
  })

  it('finishes fast, so it cannot outlast the swing that earned it', () => {
    const effect = createFinisherFlare(new Vector3())
    let alive = true
    let n = 0
    for (; n < 60 && alive; n++) alive = effect.advance(1 / 60)
    expect(alive).toBe(false)
    expect(n / 60).toBeLessThan(0.35)
  })

  it('brightens toward its top, where the flare opens', () => {
    const material = flareMaterialOf(createFinisherFlare(new Vector3()))
    expect(material.fragmentShader).toContain('vUv.y')
  })

  it('flutes a whole number of turns, so the cone has no seam', () => {
    // vUv.x wraps around the cylinder. A frequency that is not periodic leaves a stationary
    // vertical seam down one side, which on a rotationally symmetric shape is the first
    // artifact the eye finds. Caught twice in B2.
    const material = flareMaterialOf(createFinisherFlare(new Vector3()))
    expect(material.fragmentShader).toContain('6.2832')
  })

  it('wears the staff\'s tint, because the staff is what earned it', () => {
    expect(colourOf(flareMaterialOf(createFinisherFlare(new Vector3())))).toBe(0xffa64d)
  })

  it('is not a ring', () => {
    // The one shape this cue may not borrow: the ring already means Pressure Wave and vortex.
    const mesh = flareMeshOf(createFinisherFlare(new Vector3()))
    expect(mesh.geometry).not.toBeInstanceOf(RingGeometry)
  })
})
```

- [ ] **Step 2: Implement**

An `Effect` in `src/fx/effect.ts`'s shape: owns its geometry and material, `advance` returns
false when finished, `dispose` releases both. `safeScale` for every scale — and therefore a
case in `src/fx/scale-wiring.test.ts`, which reads the directory and fails any module importing
`./scale` without one. Follow `steam.ts`'s case: drive a NaN `dt` through `advance`, not a
direct scale write.

The body should brighten toward the top with a fluting around the cone. It carries a collar or
it does not — decide and argue it. The case for one: this is a bright warm object over a bright
world and the collar is what B2 proved separates. The case against: a flare's whole point is
that it is a flash, and a dark band inside a 0.2-second flash is a band nobody sees. **Whichever
you choose, say why in the module comment**, and if you skip it, say explicitly that it is a
third deliberate exemption after steam and mud, so a reader does not think it was missed.

- [ ] **Step 3: Wire it up**

- In `src/main.ts`, find where `fight.finisherThisFrame` becomes available and add the flare at
  the player's position. Read what the neighbouring per-frame effect spawns do about position —
  the reaction loop's comment about firing at a pre-restore position exists for a reason — and
  follow the local convention. **One flare per frame, not one per soldier**: the signal is a
  boolean.
- Repoint `finisher` in `src/bench/effects.ts` from `ringAt` to `createFinisherFlare`.
- `src/bench/scenes.ts` has a `finisher` scene already, built for the ring placeholder. Its
  pose and timing were chosen for a ring at `PLACEHOLDER_RADIUS`; retune them for the flare and
  update the comment, including the block comment about which ids are still placeholders —
  after this task, **none are**.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/fx/finisher.test.ts src/fx/scale-wiring.test.ts && npm test && npm run typecheck && npm run build
git add src/fx/finisher.ts src/fx/finisher.test.ts src/main.ts src/bench/ src/fx/scale-wiring.test.ts
git commit -m "Flare the completed string at the player, and retire the last ring placeholder"
```

---

## Task 9: Report what is shootable, then hand over

**Files:** none, unless a defect is found.

- [ ] **Step 1: Audit the bench against every module this plan touched**

`impact` (three kinds), `guard-shell`, `avatar-aura`, `staff-arc-fx` (two shapes), `aim-tell`,
`finisher` — name the bench id and scene for each, and flag any with none. B2's final task found
four painted effects with no `BenchEffectId` at all; this plan puts a scene in each task
specifically so this audit finds nothing. If it finds something, that is a task that did not
finish.

Also confirm: `src/bench/effects.ts`'s `Record` is total over `BenchEffectId`, so an
unregistered id is a compile error — but a *scene* missing for a registered id is not, and that
is the gap to look for.

- [ ] **Step 2: State what no test established, per module**

One line each. The honest pattern from B2: a `time` uniform that advances proves the shader
animates, not that the animation reads; a pinned `smoothstep` bound proves a gradient was not
reversed, not that it looks right; `collar-bounds.test.ts` proves a bound lies inside the
geometry it shades, not that the collar separates. Add the ones specific to this step — nothing
tested says the deflect reads as metal rather than as a smaller puff, that the mark pip is
findable in a four-soldier fight, or that the flare lands on the same beat as the hit.

- [ ] **Step 3: Hand the owner the play-test list**

- whether the three impact kinds read as three materials at combat speed, which is the claim
  Task 2's gate could only answer at one frozen instant;
- whether the mark pip is findable in a fight with four soldiers, and whether it survives being
  behind one of them;
- whether the finisher flare reads as *the string completing* rather than as another element;
- whether the aim tell is quieter than the gust it predicts, which is the one place in this step
  where being less interesting is the requirement;
- whether the two character shells read as shells around a character, which the bench cannot
  show because it has no character;
- whether anything looks worse on the **low** tier, where the composer is bypassed and nothing
  blooms. Only water's collar has ever been checked there.

---

## Self-review

**Spec coverage.** §1's inventory → the task list, with `arrow.ts` and `pillar-view.ts` excluded
as named non-goals. §2's branch-cut finding → Task 1, with the measured table carried into the
code comment and a construction-time throw so a missing `halfAngle` cannot fail silently. §3's
three-way split → Tasks 2–6: the shells take the ice shell's rim, the staff arc takes a rim at
its radius edge, the burst takes a per-kind surface, the tell takes restraint. §3's gating
argument → Task 2 stops and reports. §4's two signals → Tasks 7 and 8. §5's non-goals → the
Global Constraints. §6's "a scene in every task" → each task's Step 3. §7's risks → Task 2 is
the gate the first asks for; Task 7 carries the null-cost constraint the second asks for; Task 6
is written as restraint the third asks for.

**One spec correction, made here rather than left standing.** §4 proposed that a finisher get
*two* cues — a differently painted swing from `swing.finisher`, and a flourish on landing. Task 5
drops the first. `staff-arc-fx.ts`'s comment says it "draws whatever shape it is handed and has
no business knowing which swing produced it", the finisher's shape already differs (94.7° against
81.8°, at a different range), and a second cue derived from a flag the file argued against
carrying is worse than one cue in the place the signal actually has no consumer. The commit
message records the decision.

**One trap defused before dispatch rather than left in the brief.** The first draft of Task 1
pinned `atan2(p.x, -p.y)` in its tests while a note underneath told the implementer to use
`atan` — a brief contradicting itself, on the one expression five bodies inherit, where the
failure mode is a link error that surfaces as a mesh that does not draw. GLSL has no `atan2`,
and `POLAR_PREAMBLE` already spells its own call `atan(p.y, p.x)`. The plan now says `atan`
everywhere.

**Placeholders.** None. Every code step carries its GLSL or its test. Where a task says to
establish something rather than assume it — the chevron's attribute list, the shells' `0.18`
versus `0.35` darkness, the old impact material's `depthTest`, whether the simulation clears
`mark` on a down — it names what to read and requires the finding be reported.

**Type consistency.** `WEDGE_PREAMBLE` and its `halfAngle` uniform are used with those names in
Tasks 1, 5 and 6. `createEffectMaterial`'s option object (`body`, `uniforms`, `side?`,
`depthTest?`) matches every call. `Shape` gains `rim`, `fill` and `shards` in Task 2 and Task 3
only tunes them. `createFinisherFlare(at)` matches its `main.ts` and bench call sites.
`EnemyView.sync`'s signature does not change.

**Two risks carried deliberately.** The impact burst's three surfaces are three guesses, gated
on one — same shape as B2's collar gate, and if the gate fails, Task 3 is what changes rather
than the whole plan. And the shells' shared body is a real duplication-versus-coupling choice
that this plan deliberately leaves to the implementer to make and argue, because both answers
are defensible and the reasoning matters more than the outcome.
