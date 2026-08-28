import { describe, it, expect, vi } from 'vitest'
import { Color, Mesh, ShaderMaterial } from 'three'
import { createShockwave } from './shockwave'

function meshOf(wave: ReturnType<typeof createShockwave>): Mesh {
  const object = wave.object
  if (!(object instanceof Mesh)) throw new Error('expected a mesh')
  return object
}

/** The ring's own shader material. */
function ringMaterialOf(wave: ReturnType<typeof createShockwave>): ShaderMaterial {
  const material = meshOf(wave).material
  if (!(material instanceof ShaderMaterial)) throw new Error('expected the ring to carry a shader material')
  return material
}

function opacityOf(wave: ReturnType<typeof createShockwave>): number {
  const value = ringMaterialOf(wave).uniforms.alpha?.value
  if (typeof value !== 'number') throw new Error('expected a numeric alpha uniform')
  return value
}

describe('createShockwave', () => {
  it('reports true while it is still running and false once finished', () => {
    const wave = createShockwave(10, 1)
    expect(wave.advance(0.1)).toBe(true)
    expect(wave.advance(5)).toBe(false)
  })

  it('grows toward the radius it was given', () => {
    const wave = createShockwave(10, 1)
    const start = meshOf(wave).scale.x
    wave.advance(0.2)
    const mid = meshOf(wave).scale.x
    wave.advance(5)
    const end = meshOf(wave).scale.x

    expect(start).toBeLessThan(mid)
    expect(mid).toBeLessThan(end)
    expect(end).toBeCloseTo(10, 1)
  })

  it('keeps a positive scale for a zero radius, which only a caller can hand it', () => {
    // `apply`'s `Math.max(..., 1e-4)` floor, which this effect's own interpolation never
    // reaches: it runs from START_FRACTION * radius up to radius, both positive for any
    // positive radius. The floor bounds the radius the caller passes in, and a zero scale is
    // a degenerate matrix. The same floor and the same gap exist in `vortex-ring.ts`, which
    // is where this pattern came from — both are pinned now.
    const wave = createShockwave(0, 1)
    expect(meshOf(wave).scale.x).toBeGreaterThan(0)
    wave.advance(5)
    expect(meshOf(wave).scale.x).toBeGreaterThan(0)
  })

  it('scales with the radius it was given', () => {
    // A big slam must read as a big ring, or the visual carries no information.
    const small = createShockwave(4, 1)
    const big = createShockwave(12, 1)
    small.advance(5)
    big.advance(5)
    expect(meshOf(big).scale.x).toBeGreaterThan(meshOf(small).scale.x * 2.5)
  })

  it('fades out as it expands', () => {
    const wave = createShockwave(10, 1)
    const start = opacityOf(wave)
    wave.advance(0.2)
    expect(opacityOf(wave)).toBeLessThan(start)
    wave.advance(5)
    expect(opacityOf(wave)).toBeCloseTo(0)
  })

  it('starts fainter for a weaker slam', () => {
    // Strength has to be visible, not just felt.
    expect(opacityOf(createShockwave(10, 0))).toBeLessThan(opacityOf(createShockwave(10, 1)))
  })

  it('sets initial opacity based on strength', () => {
    // Initial opacity must reflect strength computed at construction, not default to fully opaque.
    // A weak slam (strength=0) should have computed opacity (FAINTEST=0.25), distinguishing
    // from the material's default opacity (1.0), proving apply() runs before returning.
    expect(opacityOf(createShockwave(10, 0))).toBeCloseTo(0.25, 1)
  })

  it('lies flat on the ground rather than standing up facing the camera', () => {
    expect(meshOf(createShockwave(10, 1)).rotation.x).toBeCloseTo(-Math.PI / 2)
  })

  it('casts no shadow', () => {
    // A transparent effect ring throwing a hard shadow reads as a solid disc.
    expect(meshOf(createShockwave(10, 1)).userData.excludeFromShadows).toBe(true)
  })

  it('disposes both the geometry and the material', () => {
    // The sole guard on the leak this module exists to prevent. An empty dispose()
    // body — or a refactor that drops one of the two dispose() calls — must fail
    // this test; a bare "does not throw" would pass either way.
    const wave = createShockwave(10, 1)
    const mesh = meshOf(wave)
    const material = ringMaterialOf(wave)
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose')
    const materialSpy = vi.spyOn(material, 'dispose')

    wave.dispose()

    expect(geometrySpy).toHaveBeenCalledTimes(1)
    expect(materialSpy).toHaveBeenCalledTimes(1)
  })
})

describe('the ring reads as a moving front, not a static hoop', () => {
  it('carries a time uniform, so the grain moves rather than the ring fading as a flat gradient', () => {
    const material = ringMaterialOf(createShockwave(4, 1))
    expect(material.uniforms.time).toBeDefined()
  })

  it('advances that uniform as the effect advances', () => {
    // A time uniform nothing writes is a still gradient, which is the failure this test exists
    // to catch: it looks like a shader effect and animates nothing.
    const wave = createShockwave(4, 1)
    const material = ringMaterialOf(wave)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.1; t += 1 / 60) wave.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })

  it('keeps its default tint above the bloom threshold', () => {
    // post.ts sets luminanceThreshold 0.82, measured on new Color(hex).r/g/b — the linear
    // values bloom actually thresholds against, not hex-divided-by-255.
    const material = ringMaterialOf(createShockwave(4, 1))
    const tint = material.uniforms.tint?.value
    expect(tint).toBeInstanceOf(Color)
    if (tint instanceof Color) {
      const luminance = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b
      expect(luminance).toBeGreaterThan(0.82)
    }
  })

  it('peaks at full opacity for a full-strength slam, the value it shipped with', () => {
    // Gameplay says no opacity constant moves. A full-strength slam's peak was `1` before this
    // task (MathUtils.lerp(FAINTEST, 1, 1) === 1) and must still be `1` now that the peak drives
    // a shader uniform instead of `material.opacity` directly.
    expect(opacityOf(createShockwave(10, 1))).toBeCloseTo(1)
  })

  it('sharpens the leading edge and softens the trail', () => {
    // A ring of even brightness reads as a hoop. A front moving through air is bright where it
    // arrives and fading behind, which is also what distinguishes it from vortex-ring's closing
    // ring at a glance — the outward half of the shared vocabulary. RingGeometry's own UVs are
    // Cartesian, not polar (see vortex-ring.ts's doc comment for the full trap), so the radial
    // term crossing the ring's thickness has to be re-derived from a centred UV rather than
    // read straight off `vUv.y` — a bare `vUv.y` term would mirror across the ring's two poles
    // instead of crossing the annulus from inner edge to outer.
    const material = ringMaterialOf(createShockwave(4, 1))
    expect(material.fragmentShader).toContain('atan(')
    expect(material.fragmentShader).not.toContain('vUv.y')
  })

  it("still honours a caller's tint, because three callers mean three things", () => {
    const material = ringMaterialOf(createShockwave(4, 1, 0x4a3423))
    const tint = material.uniforms.tint?.value
    expect(tint).toBeInstanceOf(Color)
    if (tint instanceof Color) expect(tint.getHex()).toBe(0x4a3423)
  })
})
