import { describe, it, expect } from 'vitest'
import { Mesh, Vector3, type Material } from 'three'
import { createFireBurst } from './fire-burst'
import { burstShape, inFireBurst } from '../combat/fire'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const F = DEFAULT_COMBAT_CONFIG.fire
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

describe('createFireBurst', () => {
  it('draws the sector at the volume that actually bites', () => {
    // **The honesty check, and it is the whole point of the file.** The drawn footprint is compared
    // against `inFireBurst` — the same predicate `stepEncounter` resolves the move with — rather than
    // against the config values the effect was built from, so the two cannot agree by both being
    // wrong. It matters more for this move than for any other: the cone is very narrow, so a drawn
    // shape rotated or widened by a small error would still look entirely plausible while the hits
    // landed somewhere else.
    //
    // Half-metre steps rather than the metre steps the water reach uses, because at 30 degrees swept
    // a metre grid puts very few samples inside the cone at all — and a sweep whose inside population
    // is two points is not a check of the shape.
    const effect = createFireBurst(ORIGIN, NORTH, F)
    const group = effect.object
    group.updateMatrixWorld(true)
    const shape = burstShape(F)

    let inside = 0
    let outside = 0
    for (let x = -9; x <= 9; x += 0.5) {
      for (let z = -9; z <= 9; z += 0.5) {
        const target = new Vector3(x, 0, z)
        const bites = inFireBurst(ORIGIN, NORTH, target, F)
        // The same point expressed in the group's local frame, which is what the sector geometry is
        // authored in: local +Z along the heading.
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

  it('draws the fill at the true reach', () => {
    // The furthest vertex from the sector's apex, not the geometry's bounding sphere: a bounding
    // sphere is centred on the centroid rather than on the apex, so for a sector this narrow it
    // reports roughly half the reach — the mistake `water-reach.test.ts` records having made.
    const position = fillOf(createFireBurst(ORIGIN, NORTH, F)).geometry.getAttribute('position')
    let furthest = 0
    for (let i = 0; i < position.count; i++) {
      furthest = Math.max(furthest, Math.hypot(position.getX(i), position.getY(i)))
    }
    expect(furthest).toBeCloseTo(F.burst.range, 4)
  })

  it('travels its arc outward, unlike the grip\'s', () => {
    // The direction of travel is how the player reads the move without reading anything: a blast
    // leaves the caster where a grip's arc closes inward. Asserted as growth over time and against
    // the reach it ends at, because "it moved" alone would pass for an arc that shrank.
    const effect = createFireBurst(ORIGIN, NORTH, F)
    const start = arcOf(effect).scale.x
    effect.advance(0.08)
    const middle = arcOf(effect).scale.x
    expect(middle).toBeGreaterThan(start)
    effect.advance(0.08)
    expect(arcOf(effect).scale.x).toBeGreaterThan(middle)
    expect(arcOf(effect).scale.x).toBeLessThanOrEqual(F.burst.range + 1e-6)
  })

  it('starts its arc away from the caster rather than inside the avatar', () => {
    // An arc that began at the origin would spend its first frames as a dot inside the character's
    // own silhouette, which for the shortest-lived effect in the game is most of its life.
    expect(arcOf(createFireBurst(ORIGIN, NORTH, F)).scale.x).toBeGreaterThan(1)
  })

  it('never scales the arc to exactly zero', () => {
    // A zero scale collapses the matrix.
    const effect = createFireBurst(ORIGIN, NORTH, F)
    for (let i = 0; i < 40; i++) {
      effect.advance(0.005)
      expect(arcOf(effect).scale.x).toBeGreaterThan(0)
    }
  })

  it('is the shortest-lived cone in the game, and finishes', () => {
    // The lifetime is doing real work: at a fraction of the burst's own cooldown, the screen is clear
    // of fire for most of the wait, so the player never sees a flame while the move is refusing them.
    // Measured as the frame count each effect survives rather than by importing three constants.
    const lifetimeOf = (effect: { advance(dt: number): boolean }) => {
      let frames = 0
      while (effect.advance(1 / 60) && frames < 600) frames++
      return frames
    }
    const burst = lifetimeOf(createFireBurst(ORIGIN, NORTH, F))
    expect(burst).toBeGreaterThan(0)
    expect(burst / 60).toBeLessThan(F.burstCooldownSeconds / 4)
  })

  it('fades out', () => {
    const effect = createFireBurst(ORIGIN, NORTH, F)
    const start = opacityOf(fillOf(effect))
    expect(start).toBeGreaterThan(0)
    effect.advance(0.08)
    expect(opacityOf(fillOf(effect))).toBeLessThan(start)
    // Returns false once finished, which is the `Effect` contract the pool relies on to remove and
    // dispose it.
    expect(effect.advance(10)).toBe(false)
  })

  it('aims the group along the flattened heading', () => {
    // Flattened, because `inCone` tests a flattened heading — a cone tilted with a climbing glider
    // would misrepresent the hit volume. This is the one place fire's two effects differ on purpose:
    // the burst is a drawing of a flattened hit volume and the thrust is a drawing of a 3D vector.
    const climbing = createFireBurst(ORIGIN, new Vector3(0, 5, -1), F)
    const flat = createFireBurst(ORIGIN, new Vector3(0, 0, -1), F)
    expect(climbing.object.quaternion.angleTo(flat.object.quaternion)).toBeCloseTo(0, 6)
  })

  it('survives a heading with no horizontal component', () => {
    // Looking straight up or down leaves nothing to aim at. It must not produce a NaN quaternion,
    // which would silently stop the mesh drawing at all.
    const effect = createFireBurst(ORIGIN, new Vector3(0, 1, 0), F)
    for (const component of effect.object.quaternion.toArray()) {
      expect(Number.isFinite(component)).toBe(true)
    }
  })

  it('does not write the height offset into the caller\'s origin', () => {
    // The trap `createImpact` documents: the caller hands over a live position vector, and writing
    // into it would teleport the player upward.
    const origin = new Vector3(1, 2, 3)
    createFireBurst(origin, NORTH, F)
    expect(origin.toArray()).toEqual([1, 2, 3])
  })

  it('uses no ShaderMaterial and no PointsMaterial', () => {
    // Both traps, asserted structurally, and fire is the effect most likely to attract a shader. One
    // that duplicates the renderer's injected `..._pars_fragment` chunks fails to compile nearly
    // silently and the mesh simply does not draw, which reads as a tastefully transparent flame. And
    // `PointsMaterial` draws screen-facing squares, so embers approaching a world unit across read as
    // solid blocks at the range this move is thrown at.
    const effect = createFireBurst(ORIGIN, NORTH, F)
    for (const child of effect.object.children) {
      expect(child).toBeInstanceOf(Mesh)
      expect(((child as Mesh).material as Material).type).toBe('MeshBasicMaterial')
    }
  })
})
