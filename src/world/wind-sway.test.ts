import { describe, it, expect } from 'vitest'
import { ConeGeometry, MeshDepthMaterial, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three'
import { applyWindSway, createSwayDepthMaterial, withSway } from './wind-sway'
import { WIND_CLOCK } from '../core/weather'
import { createSurface } from '../core/surface'

/** Run a patched material's onBeforeCompile against a minimal stand-in shader. */
function patched(material: MeshStandardMaterial | MeshDepthMaterial) {
  const shader = {
    uniforms: {},
    vertexShader: 'void main() {\n#include <begin_vertex>\n}',
    fragmentShader: '',
  } as unknown as WebGLProgramParametersWithUniforms
  material.onBeforeCompile(shader, undefined as never)
  return shader
}

describe('withSway', () => {
  it('plants the base and gives the crown tip the full weight, rising toward the top', () => {
    const cone = new ConeGeometry(1, 4, 6)
    cone.translate(0, 2, 0)
    withSway(cone, 4)
    const sway = cone.attributes['sway']!
    const position = cone.attributes.position!
    for (let i = 0; i < sway.count; i++) {
      const y = position.getY(i)
      if (Math.abs(y) < 1e-6) expect(sway.getX(i)).toBe(0)
      if (Math.abs(y - 4) < 1e-6) expect(sway.getX(i)).toBeCloseTo(1, 6)
      // Square of height: half way up carries a quarter of the motion, like a bending cantilever.
      expect(sway.getX(i)).toBeCloseTo((y / 4) ** 2, 6)
    }
  })

  it('gives a part that must never move a weight of zero everywhere', () => {
    const rock = withSway(new ConeGeometry(1, 2, 5), 0)
    expect(Array.from(rock.attributes['sway']!.array).every((w) => w === 0)).toBe(true)
  })
})

describe('applyWindSway', () => {
  it('bends the vertex after begin_vertex, driven by the one shared clock', () => {
    const shader = patched(applyWindSway(new MeshStandardMaterial()))
    expect(shader.vertexShader).toContain('attribute float sway')
    expect(shader.vertexShader).toContain('#include <begin_vertex>')
    expect(shader.vertexShader).toContain('transformed.x +=')
    // The same object, not a copy: one assignment a frame must reach every island's material.
    expect(shader.uniforms['windClock']).toBe(WIND_CLOCK)
  })

  it('gives the patched program its own cache key', () => {
    // Without one three reuses the unpatched program of the same material type and nothing sways.
    expect(applyWindSway(new MeshStandardMaterial()).customProgramCacheKey()).toBe('wind-sway')
  })

  it('keeps the cloud shadows a surface already has, rather than replacing them', () => {
    const shader = {
      uniforms: {},
      vertexShader: 'void main() {\n#include <begin_vertex>\n}',
      fragmentShader: 'void main() {\n#include <lights_fragment_begin>\n}',
    } as unknown as WebGLProgramParametersWithUniforms
    const material = applyWindSway(createSurface('foliage'))
    material.onBeforeCompile(shader, undefined as never)
    expect(shader.uniforms['windClock']).toBe(WIND_CLOCK)
    expect(shader.uniforms['cloudDrift']).toBeDefined()
    expect(shader.fragmentShader).toContain('cloudShade')
    expect(material.customProgramCacheKey()).toBe('cloud-shadow|wind-sway')
  })

  it('patches the shadow depth material the same way, so the shadow sways with the tree', () => {
    const depth = createSwayDepthMaterial()
    expect(depth).toBeInstanceOf(MeshDepthMaterial)
    expect(patched(depth).uniforms['windClock']).toBe(WIND_CLOCK)
  })
})
