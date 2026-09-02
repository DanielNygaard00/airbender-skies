import { describe, it, expect, vi } from 'vitest'
import {
  CylinderGeometry, Mesh, RingGeometry, ShaderMaterial, Vector3,
} from 'three'
import { createFinisherFlare } from './finisher'

/** The flare is a single `Mesh`, not a `Group` — there is no second layer to reach past. */
function flareMeshOf(effect: ReturnType<typeof createFinisherFlare>): Mesh {
  const { object } = effect
  if (!(object instanceof Mesh)) throw new Error('expected the flare to be a Mesh')
  return object
}

/** The flare's own shader material. */
function flareMaterialOf(effect: ReturnType<typeof createFinisherFlare>): ShaderMaterial {
  const { material } = flareMeshOf(effect)
  if (!(material instanceof ShaderMaterial)) throw new Error('expected the flare to carry a shader material')
  return material
}

/** The tint uniform, as a plain hex number rather than a `Color` instance to compare against. */
function colourOf(material: ShaderMaterial): number {
  const { tint } = material.uniforms
  if (!tint || typeof tint.value?.getHex !== 'function') throw new Error('expected a tint uniform carrying a Color')
  return tint.value.getHex()
}

describe('the finisher flare', () => {
  it('rises and widens, because a flourish opens upward', () => {
    const effect = createFinisherFlare(new Vector3(0, 11.9, 0))
    const startScale = effect.object.scale.x
    for (let t = 0; t < 0.1; t += 1 / 60) effect.advance(1 / 60)
    expect(effect.object.scale.x).toBeGreaterThan(startScale)
  })

  it('finishes fast, so it cannot outlast the swing that earned it', () => {
    const effect = createFinisherFlare(new Vector3())
    let alive = true
    let n = 0
    for (; n < 60 && alive; n++) alive = effect.advance(1 / 60)
    expect(alive).toBe(false)
    expect(n / 60).toBeLessThan(0.35)
  })

  it('brightens toward its top, where the flare opens', () => {
    const material = flareMaterialOf(createFinisherFlare(new Vector3()))
    expect(material.fragmentShader).toContain('vUv.y')
  })

  it('flutes a whole number of turns, so the cone has no seam', () => {
    // vUv.x wraps around the cylinder. A frequency that is not periodic leaves a stationary
    // vertical seam down one side, which on a rotationally symmetric shape is the first
    // artifact the eye finds. Caught twice in B2.
    const material = flareMaterialOf(createFinisherFlare(new Vector3()))
    expect(material.fragmentShader).toContain('6.2832')
  })

  it('wears the staff\'s tint, because the staff is what earned it', () => {
    expect(colourOf(flareMaterialOf(createFinisherFlare(new Vector3())))).toBe(0xffa64d)
  })

  it('is not a ring', () => {
    // The one shape this cue may not borrow: the ring already means Pressure Wave and vortex.
    const mesh = flareMeshOf(createFinisherFlare(new Vector3()))
    expect(mesh.geometry).not.toBeInstanceOf(RingGeometry)
  })
})

describe("the finisher flare's own tuning, pinned so a retune is a visible edit", () => {
  it('starts a tenth of its full radius', () => {
    // TOP_RADIUS is 0.9, START_SIZE a tenth of it — argued in `finisher.ts`'s own comment.
    const effect = createFinisherFlare(new Vector3())
    expect(flareMeshOf(effect).scale.x).toBeCloseTo(0.09, 5)
  })

  it('reaches its full radius by the time it finishes', () => {
    const effect = createFinisherFlare(new Vector3())
    effect.advance(10)
    expect(flareMeshOf(effect).scale.x).toBeCloseTo(0.9, 5)
  })

  it('grows its height in step with its radius, keeping one fixed aspect ratio', () => {
    const effect = createFinisherFlare(new Vector3())
    const mesh = flareMeshOf(effect)
    const ratioAtStart = mesh.scale.y / mesh.scale.x
    effect.advance(0.05)
    const ratioMidway = mesh.scale.y / mesh.scale.x
    expect(ratioMidway).toBeCloseTo(ratioAtStart, 5)
  })

  it('never drifts from the point it was launched from', () => {
    const start = new Vector3(2, 5, -1)
    const effect = createFinisherFlare(start)
    effect.advance(0.1)
    const { position } = flareMeshOf(effect)
    expect(position.toArray()).toEqual(start.toArray())
  })

  it('does not mutate the position it is given', () => {
    const at = new Vector3(1, 2, 3)
    const effect = createFinisherFlare(at)
    effect.advance(0.1)
    expect(at.toArray()).toEqual([1, 2, 3])
  })

  it('peaks at 0.9, the arc opacity earth-reach, gust-cone and water-reach already share', () => {
    const material = flareMaterialOf(createFinisherFlare(new Vector3()))
    expect(material.uniforms.alpha?.value).toBeCloseTo(0.9, 5)
  })

  it('fades to nothing by the time it finishes', () => {
    const effect = createFinisherFlare(new Vector3())
    const material = flareMaterialOf(effect)
    effect.advance(10)
    expect(material.uniforms.alpha?.value).toBeCloseTo(0, 5)
  })

  it('is built from an open cylinder, not a capped one', () => {
    const { geometry } = flareMeshOf(createFinisherFlare(new Vector3()))
    if (!(geometry instanceof CylinderGeometry)) throw new Error('expected a CylinderGeometry')
    expect(geometry.parameters.openEnded).toBe(true)
  })

  it('cuts the frustum into eighteen radial segments', () => {
    const { geometry } = flareMeshOf(createFinisherFlare(new Vector3()))
    if (!(geometry instanceof CylinderGeometry)) throw new Error('expected a CylinderGeometry')
    expect(geometry.parameters.radialSegments).toBe(18)
  })

  it('casts no shadow', () => {
    expect(flareMeshOf(createFinisherFlare(new Vector3())).userData.excludeFromShadows).toBe(true)
  })

  it('advances the time uniform, so the fluting actually moves', () => {
    const effect = createFinisherFlare(new Vector3())
    const material = flareMaterialOf(effect)
    const before = material.uniforms.time?.value
    effect.advance(0.05)
    expect(material.uniforms.time?.value).not.toBe(before)
  })

  it('disposes both the geometry and the material', () => {
    const effect = createFinisherFlare(new Vector3())
    const mesh = flareMeshOf(effect)
    const material = flareMaterialOf(effect)
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose')
    const materialSpy = vi.spyOn(material, 'dispose')

    effect.dispose()

    expect(geometrySpy).toHaveBeenCalledTimes(1)
    expect(materialSpy).toHaveBeenCalledTimes(1)
  })
})
