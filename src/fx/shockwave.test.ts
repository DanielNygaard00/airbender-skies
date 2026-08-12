import { describe, it, expect, vi } from 'vitest'
import { Mesh, MeshBasicMaterial } from 'three'
import { createShockwave } from './shockwave'

function meshOf(wave: ReturnType<typeof createShockwave>): Mesh {
  const object = wave.object
  if (!(object instanceof Mesh)) throw new Error('expected a mesh')
  return object
}

function opacityOf(wave: ReturnType<typeof createShockwave>): number {
  const material = meshOf(wave).material
  if (!(material instanceof MeshBasicMaterial)) throw new Error('expected a basic material')
  return material.opacity
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
    const material = mesh.material
    if (!(material instanceof MeshBasicMaterial)) throw new Error('expected a basic material')
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose')
    const materialSpy = vi.spyOn(material, 'dispose')

    wave.dispose()

    expect(geometrySpy).toHaveBeenCalledTimes(1)
    expect(materialSpy).toHaveBeenCalledTimes(1)
  })
})
