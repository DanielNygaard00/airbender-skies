import { describe, it, expect } from 'vitest'
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

  it('is visible from the first frame', () => {
    // A ring that starts transparent and fades would never be seen at all.
    expect(opacityOf(createShockwave(10, 1))).toBeGreaterThan(0)
  })

  it('lies flat on the ground rather than standing up facing the camera', () => {
    expect(meshOf(createShockwave(10, 1)).rotation.x).toBeCloseTo(-Math.PI / 2)
  })

  it('casts no shadow', () => {
    // A transparent effect ring throwing a hard shadow reads as a solid disc.
    expect(meshOf(createShockwave(10, 1)).userData.excludeFromShadows).toBe(true)
  })

  it('can be disposed without throwing', () => {
    const wave = createShockwave(10, 1)
    expect(() => wave.dispose()).not.toThrow()
  })
})
