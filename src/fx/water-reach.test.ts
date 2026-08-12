import { describe, it, expect } from 'vitest'
import { Mesh, Vector3, type Material } from 'three'
import { createWaterReach } from './water-reach'
import { freezeShape, gripShape, inIceLock, inWaterGrip } from '../combat/water'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const W = DEFAULT_COMBAT_CONFIG.water
const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)

/** The filled sector, which is the mesh that carries the true reach. */
function fillOf(effect: { object: { children: unknown[] } }): Mesh {
  const fill = effect.object.children[0]
  if (!(fill instanceof Mesh)) throw new Error('expected the fill to be the first child')
  return fill
}

function arcOf(effect: { object: { children: unknown[] } }): Mesh {
  const arc = effect.object.children[1]
  if (!(arc instanceof Mesh)) throw new Error('expected the arc to be the second child')
  return arc
}

const opacityOf = (mesh: Mesh): number => (mesh.material as Material & { opacity: number }).opacity

describe('createWaterReach', () => {
  it('draws the sector at the volume that actually bites', () => {
    // **The honesty check, and it is the whole point of the file.** The drawn footprint is compared
    // against `inWaterGrip` — the same predicate `stepEncounter` resolves the move with — rather
    // than against the config values the effect was built from, so the two cannot agree by both
    // being wrong. A hit landing outside the visible shape teaches the wrong spacing and reads as
    // a bug.
    //
    // Sampled in world space and transformed into the group's local frame, then compared against
    // the sector's own radius and half angle.
    const effect = createWaterReach(ORIGIN, NORTH, 'grip', W)
    const group = effect.object
    group.updateMatrixWorld(true)
    const shape = gripShape(W)

    let inside = 0
    let outside = 0
    for (let x = -14; x <= 14; x += 1) {
      for (let z = -14; z <= 14; z += 1) {
        const target = new Vector3(x, 0, z)
        const bites = inWaterGrip(ORIGIN, NORTH, target, W)
        // The same point expressed in the group's local frame, which is what the sector geometry
        // is authored in: local +Z along the heading.
        const local = group.worldToLocal(target.clone())
        const radius = Math.hypot(local.x, local.z)
        const drawn = radius <= shape.range + 1e-6
          && radius > 1e-6
          && Math.atan2(Math.abs(local.x), local.z) <= shape.halfAngle + 1e-6
        expect(drawn, `(${x}, ${z})`).toBe(bites)
        if (bites) inside++
        else outside++
      }
    }
    // Both populations are non-empty, so the sweep is not passing by finding nothing either way.
    expect(inside).toBeGreaterThan(0)
    expect(outside).toBeGreaterThan(0)
  })

  it('draws the freeze wider and shorter than the grip, matching its own cone', () => {
    // Held to the two shapes rather than to two literals, so a retune moves the drawing with the
    // hit volume. `scale` is 1 on the fill because its geometry is built at the true radius.
    const grip = createWaterReach(ORIGIN, NORTH, 'grip', W)
    const freeze = createWaterReach(ORIGIN, NORTH, 'freeze', W)
    // The furthest vertex from the sector's apex, not the geometry's bounding sphere. A bounding
    // sphere is centred on the shape's centroid rather than on the apex, so for a narrow sector it
    // reports roughly half the reach — measured at 6.20 against the grip's true 10, which is what
    // sent this assertion red on the first attempt.
    const reachOf = (effect: ReturnType<typeof createWaterReach>): number => {
      const position = fillOf(effect).geometry.getAttribute('position')
      let furthest = 0
      for (let i = 0; i < position.count; i++) {
        furthest = Math.max(furthest, Math.hypot(position.getX(i), position.getY(i)))
      }
      return furthest
    }
    expect(reachOf(grip)).toBeCloseTo(gripShape(W).range, 4)
    expect(reachOf(freeze)).toBeCloseTo(freezeShape(W).range, 4)
    expect(reachOf(freeze)).toBeLessThan(reachOf(grip))
  })

  it('draws the freeze covering everything its own predicate catches', () => {
    // The same honesty check for the second move, since the two build different geometry and only
    // one of them being right is a live possibility.
    const effect = createWaterReach(ORIGIN, NORTH, 'freeze', W)
    effect.object.updateMatrixWorld(true)
    const shape = freezeShape(W)
    let inside = 0
    for (let x = -12; x <= 12; x += 1) {
      for (let z = -12; z <= 12; z += 1) {
        const target = new Vector3(x, 0, z)
        const bites = inIceLock(ORIGIN, NORTH, target, W)
        const local = effect.object.worldToLocal(target.clone())
        const radius = Math.hypot(local.x, local.z)
        const drawn = radius <= shape.range + 1e-6
          && radius > 1e-6
          && Math.atan2(Math.abs(local.x), local.z) <= shape.halfAngle + 1e-6
        expect(drawn, `(${x}, ${z})`).toBe(bites)
        if (bites) inside++
      }
    }
    expect(inside).toBeGreaterThan(0)
  })

  it('closes the grip\'s arc inward and holds the freeze\'s still', () => {
    // The direction of travel is how the player tells the two elements apart without reading
    // anything: a gust's arc goes out, a grip's comes in, and ice does not move. Asserted as the
    // arc's scale over time, and in both directions — "the grip closes" alone would pass for an
    // implementation where both moves closed.
    const grip = createWaterReach(ORIGIN, NORTH, 'grip', W)
    const gripStart = arcOf(grip).scale.x
    grip.advance(0.15)
    expect(arcOf(grip).scale.x).toBeLessThan(gripStart)

    const freeze = createWaterReach(ORIGIN, NORTH, 'freeze', W)
    const freezeStart = arcOf(freeze).scale.x
    freeze.advance(0.15)
    expect(arcOf(freeze).scale.x).toBeCloseTo(freezeStart, 4)
  })

  it('never scales the arc to exactly zero', () => {
    // A zero scale collapses the matrix. The grip's arc closes toward a fraction of the reach
    // rather than to nothing anyway, which is also what keeps it legible as it closes.
    const effect = createWaterReach(ORIGIN, NORTH, 'grip', W)
    for (let i = 0; i < 40; i++) {
      effect.advance(0.01)
      expect(arcOf(effect).scale.x).toBeGreaterThan(0)
    }
  })

  it('fades out and finishes', () => {
    const effect = createWaterReach(ORIGIN, NORTH, 'grip', W)
    const start = opacityOf(fillOf(effect))
    expect(start).toBeGreaterThan(0)
    effect.advance(0.15)
    expect(opacityOf(fillOf(effect))).toBeLessThan(start)
    // Returns false once finished, which is the `Effect` contract the pool relies on to remove and
    // dispose it. Without this the pool would carry it until the cap evicted it.
    expect(effect.advance(10)).toBe(false)
  })

  it('aims the group along the flattened heading', () => {
    // Flattened, because `inCone` tests a flattened heading — a cone tilted with a climbing glider
    // would misrepresent the hit volume. A steeply climbing forward has to produce the same
    // orientation as its horizontal projection.
    const climbing = createWaterReach(ORIGIN, new Vector3(0, 5, -1), 'grip', W)
    const flat = createWaterReach(ORIGIN, new Vector3(0, 0, -1), 'grip', W)
    expect(climbing.object.quaternion.angleTo(flat.object.quaternion)).toBeCloseTo(0, 6)
  })

  it('survives a heading with no horizontal component', () => {
    // Looking straight up or down leaves nothing to aim at. It must not produce a NaN quaternion,
    // which would silently stop the mesh drawing at all.
    const effect = createWaterReach(ORIGIN, new Vector3(0, 1, 0), 'grip', W)
    for (const component of effect.object.quaternion.toArray()) {
      expect(Number.isFinite(component)).toBe(true)
    }
  })

  it('does not write the height offset into the caller\'s origin', () => {
    // The trap `createImpact` documents: the caller hands over a live position vector, and writing
    // into it would teleport the player upward.
    const origin = new Vector3(1, 2, 3)
    createWaterReach(origin, NORTH, 'grip', W)
    expect(origin.toArray()).toEqual([1, 2, 3])
  })

  it('uses no ShaderMaterial and no PointsMaterial', () => {
    // Both traps, asserted structurally. A `ShaderMaterial` that duplicates the renderer's injected
    // `..._pars_fragment` chunks fails to compile nearly silently and the mesh simply does not
    // draw, which looks like a correctly transparent effect. And `PointsMaterial` draws
    // screen-facing squares, so anything approaching a world unit reads as a white block up close —
    // which a melee-range water effect certainly would.
    for (const move of ['grip', 'freeze'] as const) {
      const effect = createWaterReach(ORIGIN, NORTH, move, W)
      for (const child of effect.object.children) {
        expect(child).toBeInstanceOf(Mesh)
        const material = (child as Mesh).material as Material
        expect(material.type).toBe('MeshBasicMaterial')
      }
    }
  })
})
