import { describe, it, expect } from 'vitest'
import { Box3, Color, Mesh, ShaderMaterial, Vector3 } from 'three'
import { createFireFlames } from './fire-flames'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { burstShape } from '../combat/fire'

const FIRE = DEFAULT_COMBAT_CONFIG.fire
const ORIGIN = new Vector3()
const FORWARD = new Vector3(0, 0, 1)

function meshOf(effect: { object: { children: unknown[] } }): Mesh {
  const mesh = effect.object.children.find((c): c is Mesh => c instanceof Mesh)
  if (!mesh) throw new Error('flame mesh missing')
  return mesh
}

function materialOf(effect: { object: { children: unknown[] } }): ShaderMaterial {
  const material = meshOf(effect).material
  if (Array.isArray(material) || !(material instanceof ShaderMaterial)) {
    throw new Error('expected a shader material')
  }
  return material
}

function run(effect: ReturnType<typeof createFireFlames>, seconds: number): boolean {
  let alive = true
  for (let t = 0; t < seconds; t += 1 / 120) alive = effect.advance(1 / 120)
  return alive
}

describe('createFireFlames', () => {
  it('stands the flames up rather than lying them on the ground', () => {
    const effect = createFireFlames(ORIGIN, FORWARD, FIRE)
    effect.advance(0.01)
    effect.object.updateMatrixWorld(true)
    const box = new Box3().setFromObject(effect.object)
    expect(box.max.y - box.min.y).toBeGreaterThan(2)
    effect.dispose()
  })

  it('burns hotter at the base than at the tips', () => {
    // The ramp is what makes it fire rather than orange light: real flame is hottest where it is
    // fed and coolest where it runs out.
    const material = materialOf(createFireFlames(ORIGIN, FORWARD, FIRE))
    const core = material.uniforms['tint']?.value as Color
    const ember = material.uniforms['ember']?.value as Color
    const luminance = (c: Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722
    expect(luminance(core)).toBeGreaterThan(luminance(ember))
  })

  it('does not share the warm-tan register earth and the old burst sit in', () => {
    // The finding this effect exists to answer: photographed on the bench, the fire burst and
    // the stone throw were the same shape, the same flatness and very nearly the same hue.
    const material = materialOf(createFireFlames(ORIGIN, FORWARD, FIRE))
    const ember = material.uniforms['ember']?.value as Color
    // Far more saturated and far redder than earth's 0xd9a066.
    const earth = new Color(0xd9a066)
    expect(ember.r - ember.b).toBeGreaterThan(earth.r - earth.b)
    expect(ember.g).toBeLessThan(earth.g)
  })

  it('runs outward along the cone, the opposite of the water s pull', () => {
    // The burst pushes away from the caster, which is the direction `fire-burst.ts`'s arc runs.
    const effect = createFireFlames(ORIGIN, FORWARD, FIRE)
    effect.advance(0.02)
    const early = meshOf(effect).scale.x
    run(effect, 0.2)
    expect(meshOf(effect).scale.x).toBeGreaterThan(early)
    effect.dispose()
  })

  it('starts out from the caster rather than inside their chest', () => {
    const effect = createFireFlames(ORIGIN, FORWARD, FIRE)
    effect.advance(0.001)
    expect(meshOf(effect).scale.x).toBeGreaterThan(1)
    effect.dispose()
  })

  it('never reaches past the burst s own range', () => {
    const effect = createFireFlames(ORIGIN, FORWARD, FIRE)
    run(effect, 0.33)
    expect(meshOf(effect).scale.x).toBeLessThanOrEqual(burstShape(FIRE).range + 1e-6)
    effect.dispose()
  })

  it('flares at once and burns down, rather than fading symmetrically', () => {
    const effect = createFireFlames(ORIGIN, FORWARD, FIRE)
    run(effect, 0.05)
    const peak = materialOf(effect).uniforms['alpha']?.value as number
    run(effect, 0.2)
    const late = materialOf(effect).uniforms['alpha']?.value as number
    expect(peak).toBeGreaterThan(0.5)
    expect(late).toBeLessThan(peak)
    expect(late).toBeGreaterThanOrEqual(0)
    effect.dispose()
  })

  it('flickers faster than anything else in the directory', () => {
    // Fire is the one element that must never look still, and the rate is the difference.
    const source = materialOf(createFireFlames(ORIGIN, FORWARD, FIRE)).fragmentShader
    expect(source).toMatch(/sin\(time \* 40\.0/)
  })

  it('carves fingers rather than a ceiling', () => {
    // Two families of tongues at different spacings, sliding opposite ways: one alone reads as
    // a comb.
    const source = materialOf(createFireFlames(ORIGIN, FORWARD, FIRE)).fragmentShader
    expect(source).toMatch(/vUv\.x \* 26\.0 \+ time \* 14\.0/)
    expect(source).toMatch(/vUv\.x \* 41\.0 - time \* 19\.0/)
  })

  it('outlives the flat tell it stands inside', () => {
    // `fire-burst.ts` lives 0.16s, which flashes a shape and is far too short to watch
    // something burn.
    const effect = createFireFlames(ORIGIN, FORWARD, FIRE)
    expect(run(effect, 0.2)).toBe(true)
    effect.dispose()
  })

  it('aims by yaw alone', () => {
    const steep = createFireFlames(ORIGIN, new Vector3(0, -0.95, 0.3).normalize(), FIRE)
    expect(steep.object.rotation.x).toBe(0)
    expect(steep.object.rotation.z).toBe(0)
    steep.dispose()
  })

  it('ends, and reports that it has', () => {
    const effect = createFireFlames(ORIGIN, FORWARD, FIRE)
    expect(run(effect, 0.3)).toBe(true)
    expect(run(effect, 0.1)).toBe(false)
    effect.dispose()
  })

  it('ignores a corrupted frame time', () => {
    const effect = createFireFlames(ORIGIN, FORWARD, FIRE)
    effect.advance(Number.NaN)
    effect.advance(-3)
    expect(Number.isFinite(meshOf(effect).scale.x)).toBe(true)
    effect.dispose()
  })
})
