import { Color, DoubleSide, ShaderMaterial, Vector2, type Side } from 'three'

/**
 * The one place in `src/fx/` that builds a `ShaderMaterial`.
 *
 * **Why this module exists, and it is a trap rather than a preference.** A `ShaderMaterial` whose
 * fragment includes the `..._pars_fragment` chunks the renderer already injects fails to compile
 * with redefinition errors — and that failure throws nowhere visible. The mesh simply does not
 * draw, which looks exactly like a correctly transparent effect with the world showing through, so
 * it reads as success. `src/core/sky.ts` records the same trap costing a missing sky, and
 * `src/fx/water-reach.ts` cites it as the reason not to reach for a shader at all.
 *
 * A comment saying "do not do this" is worth less than a function that will not do it. So the
 * builder assembles the fragment itself — appending the two trailing includes — and throws on a
 * body containing the forbidden form.
 *
 * **It throws where the source is written, not where the effect is spawned.** Callers keep their
 * shader body in a module constant and build their material template at module scope, so a bad
 * shader fails on page load in front of whoever is editing it. Validating per instance instead
 * would put a throw inside effect construction, which first runs when a player throws that move —
 * a crash mid-fight, in the one path that must never be what breaks a session.
 *
 * **What this is not.** Not a shader library, not an effect framework, not a material cache. It
 * builds one kind of thing correctly. `air-wall.ts` — the only shader the project had before this
 * module — is expressed through it, and if it could not be, the builder would be the thing that is
 * wrong.
 */
export type EffectUniformValue = number | Color | Vector2
export type EffectUniforms = Record<string, EffectUniformValue>

/**
 * The vertex shader every effect shares.
 *
 * One shader rather than a parameter, because every effect in this directory is a flat piece of
 * geometry textured by its own surface coordinate — a sector, a ring, an arc, a quad. Nothing here
 * displaces a vertex, so a per-effect vertex shader would be a knob with one setting.
 *
 * **`vUv` is a surface coordinate, not an axis — a box or cylinder's own UVs do not survive the
 * trip.** A `BoxGeometry` carries a full independent 0..1 UV square on each of its six faces, so
 * `vUv.x` means a different axis depending on which face a fragment belongs to: a body written
 * against it streaks along a shape's length on two faces and across it on the other four. This is
 * the same class of trap `RingGeometry`'s Cartesian-not-polar UVs are for a ring (see
 * `vortex-ring.ts`'s doc comment) — found the same way, by reading the geometry before trusting
 * the UV. `vLocal` sidesteps it for box- and cylinder-shaped effects: it carries the raw
 * object-space vertex position, which for a `BoxGeometry(w, h, 1)` runs the shape's own length as
 * `vLocal.z` from -0.5 to 0.5 regardless of which face a fragment is on. An effect built on
 * either geometry that wants "along its own axis" should read `vLocal`, not `vUv`.
 *
 * **`vViewNormal` is a view-space normal, added for `ice-shell.ts`'s silhouette rim** — the first
 * body in this directory to need one. `normalMatrix` is three's own built-in (the inverse-
 * transpose of the model-view matrix), available in every `ShaderMaterial` vertex shader without
 * being declared, so the assignment costs one line. It lives here rather than behind a second
 * vertex shader for the same reason `vLocal` sits next to `vUv` instead of in a per-shape file: an
 * unused varying costs nothing a profiler can find, whereas a second vertex shader would be a
 * second place for the `vUv`/`vLocal` contract to drift.
 */
const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vViewNormal;
  void main() {
    vUv = uv;
    vLocal = position;
    vViewNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * The three lines a ring- or wedge-shaped effect needs before it can talk about radius or angle.
 *
 * `vortex-ring.ts` and `vortex-charge.ts` each hand-copied these three lines exactly, which is
 * two chances to get the constant wrong and one place the next author will not look. `shockwave.ts`
 * hand-copied a near variant — same first two lines, but `float around = atan(p.y, p.x)` in raw
 * radians, because it never wraps with `fract` and so never needed the turn normalisation;
 * substituting this preamble there would change `around`'s scale, so it is not a drop-in for that
 * shape of body. Prepend it to a body instead: `body: POLAR_PREAMBLE + MY_BODY`.
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
 * | `sectorGeometry` (bounded wedge) | `WEDGE_PREAMBLE`'s `across`, not `vUv.x` and not this preamble's `angle`. `vUv.x` is only monotone along the arc while the half-angle stays at or under a quarter turn — see `sectorUvIsMonotone` in `sector.ts` — and `angle` wraps at `atan`'s branch cut, which a wedge wider than a quarter turn crosses. `radius` from this preamble is valid for a wedge too |
 * | `BoxGeometry` | `vLocal`; UVs are per face, so `vUv.x` means a different axis depending on which face a fragment is on |
 * | `OctahedronGeometry` | `vLocal`; UVs exist (`PolyhedronGeometry`'s `generateUVs` derives them from spherical azimuth/inclination) but carry pole and seam artefacts, so they are not useful here |
 * | `CylinderGeometry` | side-face `vUv` genuinely is (around, up), as `air-wall.ts` uses |
 * | `SphereGeometry` | `vUv` is (azimuth, polar); a shell wanting its own silhouette instead wants `vViewNormal`, as `ice-shell.ts` does |
 * | hand-built `BufferGeometry` | check what attributes it actually sets before trusting anything derived from them — `aim-tell.ts`'s `createChevronGeometry` sets only `position`, plus a `normal` derived by `computeVertexNormals()`. `vUv` reads as zero across the whole mesh, so a body written against it is uniformly flat and looks deliberate. `vViewNormal` exists too but is no better: a single flat triangle has one constant face normal, so it carries no per-fragment gradient either. `vLocal` is the only one of the three that means anything here |
 */
export const POLAR_PREAMBLE = /* glsl */ `
    vec2 p = vUv * 2.0 - 1.0;
    float radius = length(p);
    float angle = atan(p.y, p.x) / 6.2832 + 0.5;
`

/** Matched against a body to catch the trap. The `_pars_` is the whole signal. */
const FORBIDDEN = '_pars_fragment'

export const PARS_INCLUDE_MESSAGE =
  'An effect fragment body must not include a ..._pars_fragment chunk: the renderer already ' +
  'injects those declarations, and including them again fails the compile with redefinition ' +
  'errors that throw nowhere visible, leaving the mesh undrawn. Remove the include; the builder ' +
  'appends tonemapping_fragment and colorspace_fragment itself.'

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

/**
 * Matched against a body so a missing `halfAngle` is a throw rather than a mesh that never
 * draws. Unexported, like `FORBIDDEN` above: no caller outside this module needs to detect a
 * wedge body, only to write one.
 */
const WEDGE_MARKER = 'atan(p.x, -p.y) / halfAngle'

export const WEDGE_UNIFORM_MESSAGE =
  'A body using WEDGE_PREAMBLE must declare a `halfAngle` uniform: without it the shader fails '
  + 'to link and the mesh silently does not draw.'

function glslType(value: EffectUniformValue): 'float' | 'vec2' | 'vec3' {
  if (value instanceof Color) return 'vec3'
  if (value instanceof Vector2) return 'vec2'
  return 'float'
}

/**
 * The `uniform` lines for a set of values, typed from the values themselves.
 *
 * Sorted by name rather than left in insertion order, so two effects declaring the same uniforms
 * produce byte-identical source. three.js compiles and caches by source, and two spellings of one
 * shader would be two programs for no benefit.
 */
export function uniformDeclarations(uniforms: EffectUniforms): string {
  return Object.entries(uniforms)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `  uniform ${glslType(value)} ${name};`)
    .join('\n')
}

export function effectFragmentSource(body: string, uniforms: EffectUniforms): string {
  if (body.includes(FORBIDDEN)) throw new Error(PARS_INCLUDE_MESSAGE)
  return /* glsl */ `
${uniformDeclarations(uniforms)}
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vViewNormal;
  void main() {
${body}
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
}

export function createEffectMaterial(opts: {
  body: string
  uniforms: EffectUniforms
  side?: Side
  /**
   * Whether the effect is depth-tested against the world. Defaults to `true`, three's own default.
   *
   * An effect that overlays the world must not be occluded by it, and almost every effect in this
   * directory is a flat shape drawn a metre or less above the player's feet — which ground sloping
   * up away from them puts in front of, hiding the effect entirely. That is not hypothetical: it
   * is the defect that made the gust cone invisible in play with its shape and tint both correct
   * (see `depthTest` on the fill in `gust-cone.ts`), and it is why every flat `MeshBasicMaterial`
   * effect in this directory passes `depthTest: false` too. So the five flat shader effects pass
   * `false` here and pay for it with showing through a hill for the fifth of a second they live.
   *
   * The default is `true` rather than `false` because `air-wall.ts` is a deliberate exception and
   * a real one: its shape is a tall curved shell, not a flat sheet, and it extends as far below
   * the player's footing as above it — the depth test is exactly what keeps that underground half
   * hidden by the ground it is under. `air-wall.ts`'s own comment carries that argument in full.
   * Defaulting to `false` would make the one caller that wants depth-testing say so, which reads
   * as an oversight in the file where the reasoning lives.
   */
  depthTest?: boolean
}): ShaderMaterial {
  // The same failure mode as the `_pars_fragment` trap above, wearing a different costume: a
  // body that reads `halfAngle` without an owner also fails to link rather than throwing
  // anywhere visible, and the mesh silently does not draw. Construction time is the only place
  // a test can see either failure, since neither one raises inside the browser's own compile.
  if (opts.body.includes(WEDGE_MARKER) && !('halfAngle' in opts.uniforms)) {
    throw new Error(WEDGE_UNIFORM_MESSAGE)
  }
  const wrapped: Record<string, { value: EffectUniformValue }> = {}
  for (const [name, value] of Object.entries(opts.uniforms)) wrapped[name] = { value }
  return new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: effectFragmentSource(opts.body, opts.uniforms),
    uniforms: wrapped,
    // Every effect in this directory overlays the world: it must blend, and it must not occlude
    // what it is drawn over. `fog` is left off deliberately — an effect tinted toward the fog
    // colour at distance would fade exactly where a player most needs to see that a move landed.
    transparent: true,
    depthWrite: false,
    depthTest: opts.depthTest ?? true,
    side: opts.side ?? DoubleSide,
  })
}
