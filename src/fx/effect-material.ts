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
 */
const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
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
  depthWrite?: boolean
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
    depthWrite: opts.depthWrite ?? false,
    side: opts.side ?? DoubleSide,
  })
}
