import { describe, it, expect } from 'vitest'
import { Mesh, Vector3, type Material } from 'three'
import { createPillarView, PILLAR_MATERIAL_OPTIONS } from './pillar-view'
import { spawnPillar, type Pillar } from '../combat/earth'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const R = DEFAULT_COMBAT_CONFIG.earth
const AT = new Vector3(3, 12, -8)

const pillar = (over: Partial<Pillar> = {}): Pillar => ({
  ...spawnPillar('rock', AT, R), ...over,
})

const meshOf = (view: { object: unknown }): Mesh => {
  if (!(view.object instanceof Mesh)) throw new Error('expected the view to be a single mesh')
  return view.object
}

describe('createPillarView', () => {
  it('draws the rock at the size the record carries, not at the config', () => {
    // The record holds the shape it was raised with, so a retune cannot change a rock while it is
    // standing. A view that read the config would draw a different rock than the one blocking arrows.
    const wider = pillar({ radius: 3, height: 9 })
    const geometry = meshOf(createPillarView(wider)).geometry
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.max.y - box.min.y).toBeCloseTo(9, 5)
    // The widest point is the base, which is a shade over the collision radius; the narrowest is the
    // top, a shade under it. Both are asserted, because a taper the wrong way round would read as a
    // rock balanced on a point and neither bound alone would catch it.
    expect(box.max.x).toBeGreaterThan(3)
    expect(box.max.x).toBeLessThan(3 * 1.3)
  })

  it('seats the base on the ground the record names, not the mesh centre', () => {
    // A cylinder is authored centred on its own origin, so an untranslated one would sink half its
    // height into the island and stand half as tall as the mechanic claims.
    const geometry = meshOf(createPillarView(pillar())).geometry
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0, 5)
    expect(geometry.boundingBox!.max.y).toBeCloseTo(R.pillarHeight, 5)
  })

  it('rises out of the ground rather than growing, and finishes risen', () => {
    // Both halves. On the first frame the rock is sunk by its own height so nothing is visible above
    // the surface, and once the rise is over it sits exactly at the record's position — a view that
    // only ever did the first would leave a rock permanently underground.
    const view = createPillarView(pillar())
    const mesh = meshOf(view)
    expect(mesh.position.y).toBeCloseTo(AT.y - R.pillarHeight, 5)
    // Halfway through the rise it is partway out: strictly between the two, which is what makes this
    // a rise rather than a two-state pop.
    view.update(pillar({ secondsLeft: R.pillarSeconds - 1 / 12 }))
    expect(mesh.position.y).toBeGreaterThan(AT.y - R.pillarHeight)
    expect(mesh.position.y).toBeLessThan(AT.y)
    // Well past the rise, fully seated.
    view.update(pillar({ secondsLeft: R.pillarSeconds - 1 }))
    expect(mesh.position.y).toBeCloseTo(AT.y, 5)
  })

  it('sinks back as its life runs out, so cover ending is visible before it is gone', () => {
    // A rock that blinked out would give the player no warning at the moment they most need to be
    // moving already. Both halves again: mid-life it is fully up, and at the very end it is fully
    // down, so this cannot pass for a view that sinks the whole time.
    const view = createPillarView(pillar())
    const mesh = meshOf(view)
    view.update(pillar({ secondsLeft: R.pillarSeconds / 2 }))
    expect(mesh.position.y).toBeCloseTo(AT.y, 5)
    view.update(pillar({ secondsLeft: 1 / 60 }))
    expect(mesh.position.y).toBeLessThan(AT.y - R.pillarHeight / 2)
  })

  it('never claims more height than the mechanic is blocking with', () => {
    // The rule `ice-shell.ts` argues for, applied here: where a tell and a mechanic cannot be exactly
    // simultaneous, the tell must never claim more than the mechanic is doing. The fight blocks at
    // the rock's full height for the whole of `secondsLeft`, so the drawn rock must never stand
    // *higher* than the record's own position at any point in that window.
    const view = createPillarView(pillar())
    const mesh = meshOf(view)
    for (let left = R.pillarSeconds; left > 0; left -= 1 / 60) {
      view.update(pillar({ secondsLeft: left }))
      expect(mesh.position.y).toBeLessThanOrEqual(AT.y + 1e-9)
    }
  })

  it('keeps the horizontal position pinned to the record throughout', () => {
    const view = createPillarView(pillar())
    const mesh = meshOf(view)
    for (const left of [R.pillarSeconds, R.pillarSeconds / 2, 1 / 60]) {
      view.update(pillar({ secondsLeft: left }))
      expect(mesh.position.x).toBeCloseTo(AT.x, 6)
      expect(mesh.position.z).toBeCloseTo(AT.z, 6)
    }
  })

  it('does not mutate the record or its position', () => {
    const record = pillar()
    const before = record.position.toArray()
    const view = createPillarView(record)
    view.update(record)
    expect(record.position.toArray()).toEqual(before)
    expect(record.secondsLeft).toBe(R.pillarSeconds)
  })

  it('survives a zero-length or negative life without losing the mesh', () => {
    // The guard exists because the result places a mesh: a NaN there loses the object entirely rather
    // than merely looking wrong, which is the worst outcome for a thing that stops arrows.
    const view = createPillarView(pillar({ secondsLeft: 0 }))
    const mesh = meshOf(view)
    expect(Number.isFinite(mesh.position.y)).toBe(true)
    view.update(pillar({ secondsLeft: -5 }))
    expect(Number.isFinite(mesh.position.y)).toBe(true)
  })

  it('is lit and depth-tested, unlike every attack tell in this directory', () => {
    // A pillar is a solid object rather than a statement about a move, so it is occluded by the hill
    // in front of it exactly as a real rock is. Drawn over the world it would be the one object in
    // the game visible through terrain — actively misleading for a thing whose whole job is blocking
    // line of sight.
    //
    // `depthTest` is read off the exported options rather than off the built material, because
    // `Material`'s constructor backfills it to `true` and a test reading the material would pass with
    // the line deleted. The same trick `arrow.ts` uses.
    const material = meshOf(createPillarView(pillar())).material as Material
    expect(material.type).toBe('MeshLambertMaterial')
    expect(PILLAR_MATERIAL_OPTIONS.depthTest).toBe(true)
    // Opaque: cover the player can see through is cover they will misjudge.
    expect(material.transparent).toBe(false)
  })

  it('is not excluded from shadows, unlike the attack tells', () => {
    // The inverse of the assertion the reach effects carry. An object this size with no shadow does
    // not read as sitting on the ground it came out of.
    expect(meshOf(createPillarView(pillar())).userData.excludeFromShadows).toBeUndefined()
  })

  it('disposes its geometry and material', () => {
    // One view exists per standing pillar and they are created and destroyed throughout a fight, so a
    // missed release accumulates.
    const view = createPillarView(pillar())
    const mesh = meshOf(view)
    let disposals = 0
    mesh.geometry.dispose = () => { disposals++ }
    ;(mesh.material as Material).dispose = () => { disposals++ }
    view.dispose()
    expect(disposals).toBe(2)
  })
})
