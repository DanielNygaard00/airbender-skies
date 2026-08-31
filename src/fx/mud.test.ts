import { describe, it, expect, vi } from 'vitest'
import {
  Color, Mesh, RingGeometry, ShaderMaterial, Vector3,
} from 'three'
import { createMud } from './mud'

/** Mud is a single `Mesh`, not a `Group` — there is no second layer to reach past. */
function meshOf(effect: ReturnType<typeof createMud>): Mesh {
  const { object } = effect
  if (!(object instanceof Mesh)) throw new Error('expected the disc to be a Mesh')
  return object
}

/** The disc's own shader material. */
function discMaterialOf(effect: ReturnType<typeof createMud>): ShaderMaterial {
  const { material } = meshOf(effect)
  if (!(material instanceof ShaderMaterial)) throw new Error('expected the disc to carry a shader material')
  return material
}

describe('mud', () => {
  it('stays on the ground, where wet earth belongs', () => {
    const effect = createMud(new Vector3(0, 11.9, 0))
    const startY = effect.object.position.y
    for (let t = 0; t < 0.4; t += 1 / 60) effect.advance(1 / 60)
    expect(effect.object.position.y).toBeCloseTo(startY, 5)
  })

  it('spreads and then holds, because a spatter lands rather than expanding forever', () => {
    const effect = createMud(new Vector3())
    for (let t = 0; t < 0.2; t += 1 / 60) effect.advance(1 / 60)
    const mid = effect.object.scale.x
    for (let t = 0; t < 0.2; t += 1 / 60) effect.advance(1 / 60)
    expect(effect.object.scale.x).toBeCloseTo(mid, 1)
  })

  it('finishes, so the pool retires it', () => {
    const effect = createMud(new Vector3())
    let alive = true
    for (let t = 0; t < 3 && alive; t += 1 / 60) alive = effect.advance(1 / 60)
    expect(alive).toBe(false)
  })

  it('carries no collar, because a dark effect needs no dark rim', () => {
    expect(discMaterialOf(createMud(new Vector3())).fragmentShader)
      .not.toContain('mix(tint * 0.18, tint, core)')
  })

  it('spatters a whole number of lobes, so the disc has no radial seam', () => {
    // `angle` is a normalised turn, so a bare `7.0` would be seven radians across the whole
    // circumference: 1.11 cycles, and a hard discontinuity where the wrap fails to meet itself.
    expect(discMaterialOf(createMud(new Vector3())).fragmentShader)
      .toContain('angle * 6.2832 * 7.0')
  })
})

describe("mud's own tuning, pinned so a retune is a visible edit", () => {
  it("takes its tint from main.ts's own REACTION_LOOKS entry, dark and brown rather than pale", () => {
    // `0x4a3423`, argued in `main.ts` as earth compacted wet around a soldier's feet, pushed away
    // from the sandstone `earth-reach.ts` already uses. This module now owns the live copy;
    // `REACTION_LOOKS` itself is gone, since both reactions now carry their own tint.
    const material = discMaterialOf(createMud(new Vector3()))
    expect(material.uniforms.tint?.value).toEqual(new Color(0x4a3423))
  })

  it('starts under a third of the held radius and finishes under the old ring\'s footprint', () => {
    const effect = createMud(new Vector3())
    expect(meshOf(effect).scale.x).toBeCloseTo(0.3, 5)
    effect.advance(10)
    expect(meshOf(effect).scale.x).toBeCloseTo(1.2, 5)
  })

  it('spreads within a tenth of a second, well inside the first test frame\'s window', () => {
    const effect = createMud(new Vector3())
    effect.advance(0.1)
    expect(meshOf(effect).scale.x).toBeCloseTo(1.2, 5)
  })

  it('never drifts, only spreads — position is fixed at the point of impact', () => {
    const start = new Vector3(2, 5, -1)
    const effect = createMud(start)
    effect.advance(0.5)
    expect(meshOf(effect).position.x).toBeCloseTo(start.x, 6)
    expect(meshOf(effect).position.y).toBeCloseTo(start.y, 6)
    expect(meshOf(effect).position.z).toBeCloseTo(start.z, 6)
  })

  it('does not mutate the position it is given', () => {
    // The trap `createImpact` documents: the caller hands over a live position vector, and
    // writing into it would move whatever the caller still thinks that vector is.
    const at = new Vector3(1, 2, 3)
    const effect = createMud(at)
    effect.advance(0.5)
    expect(at.toArray()).toEqual([1, 2, 3])
  })

  it('is short-lived, well under the mud hold it reports', () => {
    let frames = 0
    const effect = createMud(new Vector3())
    while (effect.advance(1 / 60) && frames < 600) frames++
    expect(frames / 60).toBeCloseTo(0.8, 1)
  })

  it('peaks well under fully opaque', () => {
    const material = discMaterialOf(createMud(new Vector3()))
    expect(material.uniforms.alpha?.value).toBeCloseTo(0.8, 5)
  })

  it('fades to nothing by the time it finishes', () => {
    const effect = createMud(new Vector3())
    const material = discMaterialOf(effect)
    effect.advance(10)
    expect(material.uniforms.alpha?.value).toBeCloseTo(0, 5)
  })

  it('is built from a RingGeometry with inner radius 0, so POLAR_PREAMBLE applies to a full disc', () => {
    const { geometry } = meshOf(createMud(new Vector3()))
    if (!(geometry instanceof RingGeometry)) throw new Error('expected a RingGeometry')
    expect(geometry.parameters.innerRadius).toBe(0)
    expect(geometry.parameters.outerRadius).toBe(1)
  })

  it('cuts the ring into forty-eight segments, the same as shockwave.ts and vortex-ring.ts', () => {
    const { geometry } = meshOf(createMud(new Vector3()))
    if (!(geometry instanceof RingGeometry)) throw new Error('expected a RingGeometry')
    expect(geometry.parameters.thetaSegments).toBe(48)
  })

  it('lies flat on the ground plane', () => {
    expect(meshOf(createMud(new Vector3())).rotation.x).toBeCloseTo(-Math.PI / 2, 10)
  })

  it('is not depth-tested, so sloping ground cannot bury it', () => {
    const material = discMaterialOf(createMud(new Vector3()))
    expect(material.depthTest).toBe(false)
  })

  it('casts no shadow', () => {
    expect(meshOf(createMud(new Vector3())).userData.excludeFromShadows).toBe(true)
  })

  it('disposes both the geometry and the material', () => {
    const effect = createMud(new Vector3())
    const mesh = meshOf(effect)
    const material = discMaterialOf(effect)
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose')
    const materialSpy = vi.spyOn(material, 'dispose')

    effect.dispose()

    expect(geometrySpy).toHaveBeenCalledTimes(1)
    expect(materialSpy).toHaveBeenCalledTimes(1)
  })
})
