import { Color, DoubleSide, FrontSide, Vector2 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  createEffectMaterial, effectFragmentSource, PARS_INCLUDE_MESSAGE, uniformDeclarations,
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

  it('leaves tone mapping on, which is what makes the injected declarations arrive', () => {
    expect(createEffectMaterial({ body: BODY, uniforms: {} }).toneMapped).toBe(true)
  })

  it('refuses a bad body at construction too', () => {
    expect(() => createEffectMaterial({
      body: '#include <tonemapping_pars_fragment>', uniforms: {},
    })).toThrow(PARS_INCLUDE_MESSAGE)
  })
})
