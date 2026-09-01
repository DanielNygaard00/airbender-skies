import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Color, DoubleSide, FrontSide, Vector2 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  createEffectMaterial, effectFragmentSource, PARS_INCLUDE_MESSAGE, POLAR_PREAMBLE,
  uniformDeclarations, WEDGE_PREAMBLE, WEDGE_UNIFORM_MESSAGE,
} from './effect-material'

const BODY = 'gl_FragColor = vec4(tint, alpha);'

describe('uniform declarations', () => {
  it('types each uniform from its value', () => {
    const declared = uniformDeclarations({ alpha: 0.5, tint: new Color(0x112233), sweep: new Vector2() })
    expect(declared).toContain('uniform float alpha;')
    expect(declared).toContain('uniform vec3 tint;')
    expect(declared).toContain('uniform vec2 sweep;')
  })

  it('orders them stably, so a rebuilt source is byte-identical', () => {
    // Object key order is insertion order, and two effects that declare the same uniforms in a
    // different order would otherwise produce two different shader sources — which three.js
    // compiles and caches separately, for no benefit.
    const a = uniformDeclarations({ tint: new Color(), alpha: 1 })
    const b = uniformDeclarations({ alpha: 1, tint: new Color() })
    expect(a).toBe(b)
  })

  it('declares nothing for no uniforms', () => {
    expect(uniformDeclarations({}).trim()).toBe('')
  })
})

describe('the fragment source', () => {
  it('ends with tone mapping then the colour transform, in that order', () => {
    // Order matters: tone mapping maps the range down, the colour transform encodes it for the
    // display. Reversed, the encode happens before the map and the effect reads washed out.
    const source = effectFragmentSource(BODY, { alpha: 1, tint: new Color() })
    const tone = source.indexOf('#include <tonemapping_fragment>')
    const colour = source.indexOf('#include <colorspace_fragment>')
    expect(tone).toBeGreaterThan(-1)
    expect(colour).toBeGreaterThan(tone)
  })

  it('declares the uv varying exactly once', () => {
    const source = effectFragmentSource(BODY, {})
    expect(source.match(/varying vec2 vUv;/g)).toHaveLength(1)
  })

  it('declares the local-position varying exactly once', () => {
    // A box or cylinder's UVs are per-face (or per-cap), not a single coordinate running along
    // the shape's own axis — see the module comment. vLocal carries object-space position
    // instead, and this pins that the builder declares it exactly once, the same guard the
    // vUv assertion above already gives that varying.
    const source = effectFragmentSource(BODY, {})
    expect(source.match(/varying vec3 vLocal;/g)).toHaveLength(1)
  })

  it('declares the view-space normal varying exactly once', () => {
    // Added for ice-shell.ts's silhouette rim, the first body in this directory to need a
    // normal. It must be declared in the fragment shader too, matching vUv and vLocal above:
    // GLSL requires a varying used in the fragment stage to be declared there with the same
    // name and type as the vertex stage, or the compile fails the same silent way the
    // `..._pars_fragment` trap does.
    const source = effectFragmentSource(BODY, {})
    expect(source.match(/varying vec3 vViewNormal;/g)).toHaveLength(1)
  })

  it('carries the body verbatim', () => {
    expect(effectFragmentSource(BODY, {})).toContain(BODY)
  })

  it('refuses a body that includes a pars_fragment chunk', () => {
    // The whole reason this module exists. The renderer already injects those declarations, and
    // including them again fails the compile with redefinition errors that throw nowhere
    // visible — the mesh simply does not draw, which looks like a correctly transparent effect.
    expect(() => effectFragmentSource(
      '#include <tonemapping_pars_fragment>\n' + BODY, {},
    )).toThrow(PARS_INCLUDE_MESSAGE)
  })

  it('refuses any pars_fragment chunk, not just the tone-mapping one', () => {
    expect(() => effectFragmentSource('#include <colorspace_pars_fragment>', {})).toThrow()
    expect(() => effectFragmentSource('#include <fog_pars_fragment>', {})).toThrow()
  })

  it('allows the trailing includes it adds itself to appear in a body', () => {
    // A body may legitimately mention `tonemapping_fragment` in a comment; only the `_pars_`
    // form is the trap, and a substring check for the wrong thing would ban the right thing.
    expect(() => effectFragmentSource('// see tonemapping_fragment\n' + BODY, {})).not.toThrow()
  })
})

describe('the material', () => {
  it('wraps each uniform value in three\'s uniform shape', () => {
    const tint = new Color(0x445566)
    const material = createEffectMaterial({ body: BODY, uniforms: { tint, alpha: 0.25 } })
    expect(material.uniforms.tint?.value).toBe(tint)
    expect(material.uniforms.alpha?.value).toBe(0.25)
  })

  it('is transparent and writes no depth, because every effect overlays the world', () => {
    const material = createEffectMaterial({ body: BODY, uniforms: {} })
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
  })

  it('defaults to double-sided and takes an override', () => {
    expect(createEffectMaterial({ body: BODY, uniforms: {} }).side).toBe(DoubleSide)
    expect(createEffectMaterial({ body: BODY, uniforms: {}, side: FrontSide }).side).toBe(FrontSide)
  })

  it('depth-tests by default and takes an override', () => {
    // The default is three's own `true`, which `air-wall.ts` is the one caller to want: its shell
    // extends as far below the player's footing as above it, and the depth test is what keeps
    // that underground half hidden. The other five shader effects are flat shapes drawn just
    // above the ground, which any upward slope puts in front of — the defect that made the gust
    // cone invisible in play — so they pass `false`. Pinned in both directions because a default
    // flipped to `false` would silently give `air-wall` its underground half back, and a
    // dropped-through option would silently bury the other five.
    expect(createEffectMaterial({ body: BODY, uniforms: {} }).depthTest).toBe(true)
    expect(createEffectMaterial({ body: BODY, uniforms: {}, depthTest: false }).depthTest)
      .toBe(false)
  })

  it('declares and assigns all three varyings in the shared vertex shader', () => {
    // No test previously pinned the vertex shader's exact text, since every effect before ice
    // read vUv or vLocal only. This pins the full contract now that a third varying exists,
    // so a future addition or a typo in the assignment shows up here rather than only as a
    // shell that silently fails to compile.
    const material = createEffectMaterial({ body: BODY, uniforms: {} })
    expect(material.vertexShader).toContain('varying vec2 vUv;')
    expect(material.vertexShader).toContain('varying vec3 vLocal;')
    expect(material.vertexShader).toContain('varying vec3 vViewNormal;')
    expect(material.vertexShader).toContain('vUv = uv;')
    expect(material.vertexShader).toContain('vLocal = position;')
    expect(material.vertexShader).toContain('vViewNormal = normalMatrix * normal;')
  })

  it('leaves tone mapping on, which is what makes the injected declarations arrive', () => {
    expect(createEffectMaterial({ body: BODY, uniforms: {} }).toneMapped).toBe(true)
  })

  it('refuses a bad body at construction too', () => {
    expect(() => createEffectMaterial({
      body: '#include <tonemapping_pars_fragment>', uniforms: {},
    })).toThrow(PARS_INCLUDE_MESSAGE)
  })
})

describe('the directory-wide guard', () => {
  it('is the only module in src/fx that constructs a ShaderMaterial', () => {
    // The throw inside this module only protects code that goes THROUGH this module. The failure
    // scenario is concrete and dated: step B2 re-authors twelve more effects, one of them
    // hand-rolls its own `new ShaderMaterial` with a `..._pars_fragment` include in the body, the
    // compile fails with redefinition errors that throw nowhere visible, the mesh draws nothing —
    // which looks exactly like a correctly transparent effect — and every test in this suite
    // stays green because the builder was never called. This reads the directory instead of a
    // hand-kept list, so a new file is covered the moment it exists, the same reason
    // `scale-wiring.test.ts` reads the listing for its `safeScale` table.
    //
    // A new effect that genuinely needs a material this builder cannot build should extend the
    // builder and fail here until it does — that is the point, not an obstacle to route around.
    const directory = fileURLToPath(new URL('.', import.meta.url))
    const constructors = readdirSync(directory)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => readFileSync(join(directory, file), 'utf8').includes('new ShaderMaterial'))
      .sort()

    expect(constructors).toEqual(['effect-material.ts'])
  })
})

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
    // effectFragmentSource's uniforms parameter is required, not defaulted (see the same
    // pattern in the polar preamble's own "passes the builder's own refusal" test above).
    // halfAngle itself must actually be declared here: this test asserts the body is legal,
    // and an under-declared wedge body is exactly the silent-link-failure shape this whole
    // task exists to catch, which the sibling describe block below covers directly.
    expect(() => effectFragmentSource(
      WEDGE_PREAMBLE + 'gl_FragColor = vec4(tint, alpha * across);',
      { halfAngle: Math.PI / 3 },
    )).not.toThrow()
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
