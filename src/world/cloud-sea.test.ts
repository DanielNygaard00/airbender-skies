import { describe, it, expect } from 'vitest'
import { ShaderMaterial, Vector3 } from 'three'
import { CLOUD_SEA_CLEARANCE, createCloudSea } from './cloud-sea'
import { FOG_FAR } from '../core/renderer'
import { CLOUD_DRIFT } from '../core/weather'

describe('createCloudSea', () => {
  it('lies just above the world floor, so falling into it is falling out of the world', () => {
    const sea = createCloudSea(-600)
    expect(sea.mesh.position.y).toBe(-600 + CLOUD_SEA_CLEARANCE)
    expect(CLOUD_SEA_CLEARANCE).toBeGreaterThan(0)
  })

  it('reaches the far plane in every direction, where the fog closes over its edge', () => {
    const sea = createCloudSea(-600)
    sea.mesh.geometry.computeBoundingBox()
    const box = sea.mesh.geometry.boundingBox!
    expect(box.max.x).toBeGreaterThanOrEqual(FOG_FAR)
    expect(box.max.z).toBeGreaterThanOrEqual(FOG_FAR)
    // Flat: a horizontal deck.
    expect(box.max.y - box.min.y).toBeCloseTo(0, 6)
  })

  it('slides under the camera without changing height', () => {
    const sea = createCloudSea(-600)
    sea.update(new Vector3(120, 40, -300))
    expect(sea.mesh.position.toArray()).toEqual([120, -600 + CLOUD_SEA_CLEARANCE, -300])
  })

  it('drifts on the shared weather offset and fogs like the rest of the world', () => {
    const material = createCloudSea(-600).mesh.material as ShaderMaterial
    expect(material.uniforms['cloudDrift']).toBe(CLOUD_DRIFT)
    expect(material.fog).toBe(true)
    expect(material.vertexShader).toContain('<fog_vertex>')
    expect(material.fragmentShader).toContain('<fog_fragment>')
  })

  it('stays out of the shadow map and the occlusion pass', () => {
    const { mesh } = createCloudSea(-600)
    expect(mesh.userData.excludeFromShadows).toBe(true)
    expect(mesh.userData.cannotReceiveAO).toBe(true)
    expect(mesh.frustumCulled).toBe(false)
  })
})
