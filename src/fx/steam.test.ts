import { describe, it, expect, vi } from 'vitest'
import {
  Color, CylinderGeometry, Mesh, ShaderMaterial, Vector3,
} from 'three'
import { createSteam } from './steam'

/** Steam is a single `Mesh`, not a `Group` — there is no second layer to reach past. */
function meshOf(effect: ReturnType<typeof createSteam>): Mesh {
  const { object } = effect
  if (!(object instanceof Mesh)) throw new Error('expected the column to be a Mesh')
  return object
}

/** The column's own shader material. */
function columnMaterialOf(effect: ReturnType<typeof createSteam>): ShaderMaterial {
  const { material } = meshOf(effect)
  if (!(material instanceof ShaderMaterial)) throw new Error('expected the column to carry a shader material')
  return material
}

describe('steam', () => {
  it('rises', () => {
    const effect = createSteam(new Vector3(0, 11.9, 0))
    const startY = effect.object.position.y
    for (let t = 0; t < 0.3; t += 1 / 60) effect.advance(1 / 60)
    expect(effect.object.position.y).toBeGreaterThan(startY)
  })

  it('widens as it rises, because steam dissipates rather than travelling', () => {
    const effect = createSteam(new Vector3())
    const startScale = effect.object.scale.x
    for (let t = 0; t < 0.3; t += 1 / 60) effect.advance(1 / 60)
    expect(effect.object.scale.x).toBeGreaterThan(startScale)
  })

  it('finishes, so the pool retires it', () => {
    const effect = createSteam(new Vector3())
    let alive = true
    for (let t = 0; t < 3 && alive; t += 1 / 60) alive = effect.advance(1 / 60)
    expect(alive).toBe(false)
  })

  it('fades from the top, so the column has no hard cut', () => {
    const material = columnMaterialOf(createSteam(new Vector3()))
    expect(material.fragmentShader).toContain('smoothstep(1.0, 0.45, vUv.y)')
  })

  it('wisps a whole number of turns, so the column has no seam', () => {
    // vUv.x wraps all the way around the cylinder. A frequency that is not a whole number of
    // cycles leaves a stationary vertical seam down one side, which on a rotationally symmetric
    // shape is the first thing the eye finds.
    const material = columnMaterialOf(createSteam(new Vector3()))
    expect(material.fragmentShader).toContain('vUv.x * 6.2832 * 3.0')
  })
})

describe("steam's own tuning, pinned so a retune is a visible edit", () => {
  it("takes its tint from main.ts's own former REACTION_LOOKS entry, pale and warm rather than fiery", () => {
    // `0xffdfae`, argued in `main.ts` as water flashing off against heat — the burst's own
    // orange-red would read as fire itself rather than as water leaving. This module owns the
    // live copy; `main.ts`'s `REACTION_LOOKS` itself is gone as of Task 8, once `mud.ts` got its
    // own tint the same way and neither reaction needed the shared table any more.
    const material = columnMaterialOf(createSteam(new Vector3()))
    expect(material.uniforms.tint?.value).toEqual(new Color(0xffdfae))
  })

  it('starts a third of the old ring\'s radius and finishes past it', () => {
    // `REACTION_RING_RADIUS` is 1.4 and private to `main.ts`, so cited by value rather than
    // imported, the same way `bench/effects.ts` cites it.
    const effect = createSteam(new Vector3())
    expect(meshOf(effect).scale.x).toBeCloseTo(0.4, 5)
    effect.advance(10)
    expect(meshOf(effect).scale.x).toBeCloseTo(1.3, 5)
  })

  it('holds a fixed height rather than growing one, since the rise is the object\'s own translation', () => {
    const effect = createSteam(new Vector3())
    const startHeight = meshOf(effect).scale.y
    effect.advance(0.2)
    expect(meshOf(effect).scale.y).toBeCloseTo(startHeight, 5)
  })

  it('drifts upward by a fixed distance over its life', () => {
    const start = new Vector3(2, 5, -1)
    const effect = createSteam(start)
    effect.advance(10)
    expect(meshOf(effect).position.y).toBeCloseTo(start.y + 1.6, 5)
  })

  it('never drifts sideways, only up and wider', () => {
    const start = new Vector3(2, 5, -1)
    const effect = createSteam(start)
    effect.advance(0.5)
    expect(meshOf(effect).position.x).toBeCloseTo(start.x, 6)
    expect(meshOf(effect).position.z).toBeCloseTo(start.z, 6)
  })

  it('does not mutate the position it is given', () => {
    // The trap `createImpact` documents: the caller hands over a live position vector, and
    // writing into it would move whatever the caller still thinks that vector is.
    const at = new Vector3(1, 2, 3)
    const effect = createSteam(at)
    effect.advance(0.5)
    expect(at.toArray()).toEqual([1, 2, 3])
  })

  it('is short-lived, so a second Steam on the same soldier never finds one still hanging', () => {
    let frames = 0
    const effect = createSteam(new Vector3())
    while (effect.advance(1 / 60) && frames < 600) frames++
    expect(frames / 60).toBeCloseTo(1.1, 1)
  })

  it('peaks well under fully opaque', () => {
    const material = columnMaterialOf(createSteam(new Vector3()))
    expect(material.uniforms.alpha?.value).toBeCloseTo(0.5, 5)
  })

  it('fades to nothing by the time it finishes', () => {
    const effect = createSteam(new Vector3())
    const material = columnMaterialOf(effect)
    effect.advance(10)
    expect(material.uniforms.alpha?.value).toBeCloseTo(0, 5)
  })

  it('is built from an open cylinder, not a capped one', () => {
    const { geometry } = meshOf(createSteam(new Vector3()))
    if (!(geometry instanceof CylinderGeometry)) throw new Error('expected a CylinderGeometry')
    expect(geometry.parameters.openEnded).toBe(true)
  })

  it('cuts the tube into eighteen radial segments', () => {
    // Pinned per the brief's own rule — every tuned constant gets a test, so a later retune of
    // the segment count is a visible edit rather than a silent one, the same as the radii and
    // the lifetime above.
    const { geometry } = meshOf(createSteam(new Vector3()))
    if (!(geometry instanceof CylinderGeometry)) throw new Error('expected a CylinderGeometry')
    expect(geometry.parameters.radialSegments).toBe(18)
  })

  it('casts no shadow', () => {
    expect(meshOf(createSteam(new Vector3())).userData.excludeFromShadows).toBe(true)
  })

  it('advances the time uniform, so the wisp actually moves', () => {
    const effect = createSteam(new Vector3())
    const material = columnMaterialOf(effect)
    const before = material.uniforms.time?.value
    effect.advance(0.2)
    expect(material.uniforms.time?.value).not.toBe(before)
  })

  it('disposes both the geometry and the material', () => {
    const effect = createSteam(new Vector3())
    const mesh = meshOf(effect)
    const material = columnMaterialOf(effect)
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose')
    const materialSpy = vi.spyOn(material, 'dispose')

    effect.dispose()

    expect(geometrySpy).toHaveBeenCalledTimes(1)
    expect(materialSpy).toHaveBeenCalledTimes(1)
  })
})
