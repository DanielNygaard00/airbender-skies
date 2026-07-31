import { describe, it, expect } from 'vitest'
import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from 'three'
import { createSkyDome, SKY_RADIUS, SKY_HORIZON, SKY_ZENITH } from './sky'
import { FOG_FAR } from './renderer'

function materialOf(dome: Mesh): ShaderMaterial {
  const material = dome.material
  if (Array.isArray(material)) throw new Error('expected a single material')
  return material as ShaderMaterial
}

describe('createSkyDome', () => {
  it('builds a sphere the camera sits inside', () => {
    const dome = createSkyDome()
    expect(dome.geometry).toBeInstanceOf(SphereGeometry)
    // Rendered from the inside, so only the back faces are visible.
    expect(materialOf(dome).side).toBe(BackSide)
  })

  it('stays inside the camera far plane', () => {
    // A dome beyond the far plane is clipped away, leaving the background bare.
    expect(SKY_RADIUS).toBeLessThan(FOG_FAR)
  })

  it('reaches beyond the whole archipelago', () => {
    // The islands span roughly 800 units, so the player must never approach it.
    expect(SKY_RADIUS).toBeGreaterThan(1000)
  })

  it('opts out of fog', () => {
    // Fog would tint the dome towards the fog colour and flatten its gradient.
    expect(materialOf(createSkyDome()).fog).toBe(false)
  })

  it('draws behind everything without writing depth', () => {
    const dome = createSkyDome()
    expect(dome.renderOrder).toBeLessThan(0)
    expect(materialOf(dome).depthWrite).toBe(false)
  })

  it('skips frustum culling, since it encloses the camera', () => {
    expect(createSkyDome().frustumCulled).toBe(false)
  })

  it('applies tone mapping and the output colour transform', () => {
    // Without these the dome keeps its raw linear colour while the terrain around
    // it is tone mapped, so the horizon stops matching the fog it fades into.
    const shader = materialOf(createSkyDome()).fragmentShader
    expect(shader).toContain('<tonemapping_fragment>')
    expect(shader).toContain('<colorspace_fragment>')
  })

  it('does not redeclare the chunks three already injects', () => {
    // REGRESSION: including the `_pars_` chunks alongside them fails the compile
    // with "redefinition" errors for every tone-mapping function. The dome then
    // silently does not draw at all, and scene.background shows through, which
    // looks like a working flat sky rather than a broken shader.
    const shader = materialOf(createSkyDome()).fragmentShader
    expect(shader).not.toContain('tonemapping_pars_fragment')
    expect(shader).not.toContain('colorspace_pars_fragment')
  })

  it('is paler at the horizon than overhead', () => {
    // The gradient is the whole point: a flat sky gives the player nothing to read
    // altitude against.
    const brightness = (hex: number) =>
      ((hex >> 16) & 0xff) + ((hex >> 8) & 0xff) + (hex & 0xff)
    expect(brightness(SKY_HORIZON)).toBeGreaterThan(brightness(SKY_ZENITH))
  })
})
