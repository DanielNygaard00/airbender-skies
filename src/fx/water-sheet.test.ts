import { describe, it, expect } from 'vitest'
import { Box3, Mesh, ShaderMaterial, Vector3 } from 'three'
import { createWaterSheet } from './water-sheet'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { gripShape } from '../combat/water'

const WATER = DEFAULT_COMBAT_CONFIG.water
const ORIGIN = new Vector3()
const FORWARD = new Vector3(0, 0, 1)

function sheetOf(effect: { object: { children: unknown[] } }): Mesh {
  const mesh = effect.object.children.find((c): c is Mesh => c instanceof Mesh)
  if (!mesh) throw new Error('sheet mesh missing')
  return mesh
}

function materialOf(effect: { object: { children: unknown[] } }): ShaderMaterial {
  const material = sheetOf(effect).material
  if (Array.isArray(material) || !(material instanceof ShaderMaterial)) {
    throw new Error('expected a shader material')
  }
  return material
}

function run(effect: ReturnType<typeof createWaterSheet>, seconds: number): boolean {
  let alive = true
  for (let t = 0; t < seconds; t += 1 / 120) alive = effect.advance(1 / 120)
  return alive
}

describe('createWaterSheet', () => {
  it('stands the water up rather than lying it on the ground', () => {
    // The whole reason this exists beside `water-reach.ts`: every cue that says liquid rather
    // than coloured light lives in the third dimension, and a flat sector has none of them.
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    effect.advance(0.01)
    effect.object.updateMatrixWorld(true)
    const box = new Box3().setFromObject(effect.object)
    expect(box.max.y - box.min.y).toBeGreaterThan(2)
    effect.dispose()
  })

  it('stands taller than the soldiers it is dragging', () => {
    // A wave shorter than what it picks up does not read as a wave. Soldiers are 1.7 tall.
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    effect.advance(0.01)
    effect.object.updateMatrixWorld(true)
    expect(new Box3().setFromObject(effect.object).max.y).toBeGreaterThan(1.7)
    effect.dispose()
  })

  it('sits its foot at the caster s feet, not buried half underground', () => {
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    effect.advance(0.01)
    effect.object.updateMatrixWorld(true)
    expect(new Box3().setFromObject(effect.object).min.y).toBeCloseTo(0, 1)
    effect.dispose()
  })

  it('closes on the caster, which is the move', () => {
    // The grip is a pull. `water-reach.ts` runs its bright arc inward for this reason and this
    // is the same journey with a body attached; a curtain that grew would be a different move.
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    effect.advance(0.02)
    const early = sheetOf(effect).scale.x
    run(effect, 0.2)
    expect(sheetOf(effect).scale.x).toBeLessThan(early)
    effect.dispose()
  })

  it('keeps its height while it closes, rather than draining away', () => {
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    effect.advance(0.02)
    const height = sheetOf(effect).scale.y
    run(effect, 0.2)
    expect(sheetOf(effect).scale.y).toBeCloseTo(height, 6)
    effect.dispose()
  })

  it('starts at the reach the grip actually has', () => {
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    effect.advance(0.001)
    expect(sheetOf(effect).scale.x).toBeCloseTo(gripShape(WATER).range, 0)
    effect.dispose()
  })

  it('surges in and drains out rather than blinking', () => {
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    effect.advance(0.001)
    const first = materialOf(effect).uniforms['alpha']?.value as number
    run(effect, 0.08)
    const peak = materialOf(effect).uniforms['alpha']?.value as number
    run(effect, 0.18)
    const late = materialOf(effect).uniforms['alpha']?.value as number
    expect(peak).toBeGreaterThan(first)
    expect(late).toBeLessThan(peak)
    effect.dispose()
  })

  it('advances its own clock, so the crest and the flow move', () => {
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    run(effect, 0.1)
    expect(materialOf(effect).uniforms['time']?.value as number).toBeGreaterThan(0.05)
    effect.dispose()
  })

  it('is depth-tested, unlike the flat tells', () => {
    // A standing shell has an underside, and the terrain is what should hide it.
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    expect(materialOf(effect).depthTest).toBe(true)
    effect.dispose()
  })

  it('softens every edge, so the wedge does not read as a cut panel', () => {
    // An open cylinder ends in two dead-straight verticals. With the crest broken and the face
    // flowing they were the only straight lines left, and the eye went to them first.
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    const source = materialOf(effect).fragmentShader
    // Both ends of the arc and the foot, asserted against the assembled shader rather than
    // against a copy of the numbers: this is the one part of the effect no geometry test sees.
    expect(source).toMatch(/smoothstep\(0\.0, 0\.1, vUv\.x\)/)
    expect(source).toMatch(/smoothstep\(1\.0, 0\.9, vUv\.x\)/)
    expect(source).toMatch(/smoothstep\(0\.0, 0\.2, up\)/)
    effect.dispose()
  })

  it('aims by yaw alone, so a caster looking down does not tip the water over', () => {
    const steep = createWaterSheet(ORIGIN, new Vector3(0, -0.95, 0.3).normalize(), WATER)
    expect(steep.object.rotation.x).toBe(0)
    expect(steep.object.rotation.z).toBe(0)
    steep.dispose()
  })

  it('survives a degenerate heading', () => {
    const effect = createWaterSheet(ORIGIN, new Vector3(0, 1, 0), WATER)
    expect(Number.isFinite(effect.object.rotation.y)).toBe(true)
    effect.dispose()
  })

  it('ends, and reports that it has', () => {
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    expect(run(effect, 0.25)).toBe(true)
    expect(run(effect, 0.1)).toBe(false)
    effect.dispose()
  })

  it('ignores a corrupted frame time', () => {
    const effect = createWaterSheet(ORIGIN, FORWARD, WATER)
    effect.advance(Number.NaN)
    effect.advance(-3)
    expect(Number.isFinite(sheetOf(effect).scale.x)).toBe(true)
    effect.dispose()
  })
})
