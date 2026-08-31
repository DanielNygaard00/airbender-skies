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
 */
const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vLocal;
  void main() {
    vUv = uv;
    vLocal = position;
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

/** Matched against a body to catch the trap. The `_pars_` is the whole signal. */
const FORBIDDEN = '_pars_fragment'

export const PARS_INCLUDE_MESSAGE =
  'An effect fragment body must not include a ..._pars_fragment chunk: the renderer already ' +
  'injects those declarations, and including them again fails the compile with redefinition ' +
  'errors that throw nowhere visible, leaving the mesh undrawn. Remove the include; the builder ' +
  'appends tonemapping_fragment and colorspace_fragment itself.'

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
