import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { isWall, resolveMovement, type CollisionConfig } from './collision'
import type { TerrainQuery } from '../core/types'
import { DEFAULT_COLLISION_CONFIG, validateCollisionConfig } from '../core/config'

const C: CollisionConfig = { radius: 0.5, wallNormalY: 0.5 }

/** Nothing anywhere. */
const empty: TerrainQuery = { groundHeightAt: () => null, raycast: () => null }

/**
 * A vertical wall facing -X, at x = `at`. Any ray gets a hit on it, which is what makes
 * the geometry of a test readable: the caller controls the sweep, not the fake.
 */
const wallFacingMinusX = (at: number): TerrainQuery => ({
  groundHeightAt: () => null,
  raycast: (from, direction) => {
    if (direction.x <= 0) return null
    const travel = (at - from.x) / direction.x
    if (travel < 0) return null
    return {
      point: new Vector3(at, from.y + direction.y * travel, from.z + direction.z * travel),
      normal: new Vector3(-1, 0, 0),
      islandId: 'wall',
    }
  },
})

/** A gentle floor: steep enough to walk, so collision must leave it alone. */
const gentleFloor: TerrainQuery = {
  groundHeightAt: () => 0,
  raycast: (from) => ({
    point: new Vector3(from.x, 0, from.z),
    normal: new Vector3(0, 1, 0),
    islandId: 'floor',
  }),
}

describe('isWall', () => {
  it('calls a vertical surface a wall', () => {
    expect(isWall(new Vector3(-1, 0, 0), C)).toBe(true)
  })

  it('does not call level ground a wall', () => {
    // Ground belongs to the ground snap on foot and to the landing probe in the glider.
    // Two systems answering the same question is how they end up disagreeing.
    expect(isWall(new Vector3(0, 1, 0), C)).toBe(false)
  })

  it('puts the boundary at wallNormalY, not near it', () => {
    expect(isWall(new Vector3(0, 0.49, 0), C)).toBe(true)
    expect(isWall(new Vector3(0, 0.5, 0), C)).toBe(false)
  })
})

describe('resolveMovement with nothing in the way', () => {
  it('arrives at the destination it was given', () => {
    const to = new Vector3(10, 0, 0)
    const out = resolveMovement(new Vector3(), to, new Vector3(10, 0, 0), empty, C)
    expect(out.position.toArray()).toEqual(to.toArray())
    expect(out.velocity.toArray()).toEqual([10, 0, 0])
    expect(out.normal).toBeNull()
  })

  it('does not mutate the vectors it was handed', () => {
    const from = new Vector3()
    const to = new Vector3(10, 0, 0)
    const velocity = new Vector3(10, 0, 0)
    resolveMovement(from, to, velocity, wallFacingMinusX(5), C)
    expect(from.toArray()).toEqual([0, 0, 0])
    expect(to.toArray()).toEqual([10, 0, 0])
    expect(velocity.toArray()).toEqual([10, 0, 0])
  })

  it('treats a zero-length step as a no-op', () => {
    const at = new Vector3(3, 4, 5)
    const out = resolveMovement(at, at.clone(), new Vector3(), wallFacingMinusX(3), C)
    expect(out.position.toArray()).toEqual([3, 4, 5])
    expect(out.normal).toBeNull()
  })
})

describe('resolveMovement against a wall', () => {
  it('holds the body a radius clear of the surface', () => {
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 0), new Vector3(10, 0, 0), wallFacingMinusX(5), C,
    )
    expect(out.position.x).toBeCloseTo(4.5, 6)
  })

  it('removes the velocity going into the surface', () => {
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 0), new Vector3(10, 0, 0), wallFacingMinusX(5), C,
    )
    expect(out.velocity.x).toBeCloseTo(0, 6)
  })

  it('keeps the velocity running along the surface', () => {
    // The difference between deflecting and stopping, and the reason a fast approach to a
    // cliff skims along it rather than parking the player against it.
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 8), new Vector3(10, 0, 8), wallFacingMinusX(5), C,
    )
    expect(out.velocity.z).toBeCloseTo(8, 6)
  })

  it('reports the surface it deflected off', () => {
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 0), new Vector3(10, 0, 0), wallFacingMinusX(5), C,
    )
    expect(out.normal!.toArray()).toEqual([-1, 0, 0])
  })

  it('keeps sliding rather than stopping dead at the point of contact', () => {
    // A glancing blow spends most of its step along the wall. Stopping at contact would
    // make every brush with terrain a full stop, which is what the design document rules
    // out for landings and is no more welcome here.
    //
    // The threshold is the wall's own hit z, 5 (the ray from the origin along (6,0,6) meets
    // x = 5 at z = 5 too, since the direction is diagonal). Stopping dead at the contact
    // point, offset only by the radius in x, would leave z at exactly that value; sliding
    // carries it further. An earlier version of this assertion checked z > 0.5, which is
    // below both the "stopped dead" and the "slid" result and so could not tell them apart
    // — replacing the slide target with the contact point (Step 5's red-proof for this
    // behaviour) left this test green.
    const out = resolveMovement(
      new Vector3(), new Vector3(6, 0, 6), new Vector3(6, 0, 6), wallFacingMinusX(5), C,
    )
    expect(out.position.z).toBeGreaterThan(5)
  })

  it('leaves alone a velocity that is already moving away from the surface', () => {
    // The `into < 0` guard. `to` and `velocity` are independent arguments, so a caller can
    // sweep toward a wall while the velocity points away from it — which is what a player
    // standing against a wall and pushing off looks like. Removing the component
    // unconditionally would cancel the push.
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 0), new Vector3(-10, 0, 0), wallFacingMinusX(5), C,
    )
    expect(out.velocity.x).toBeCloseTo(-10, 6)
  })

  it('never speeds anything up', () => {
    // Finding 1 of the movement analysis was a move that injected energy for free, worth
    // 1.81x total energy over forty seconds. A deflection must only ever remove speed.
    for (const target of [
      new Vector3(10, 0, 0), new Vector3(10, 0, 8), new Vector3(10, -4, 2), new Vector3(6, 6, 6),
    ]) {
      const out = resolveMovement(new Vector3(), target, target.clone(), wallFacingMinusX(5), C)
      expect(out.velocity.length()).toBeLessThanOrEqual(target.length() + 1e-9)
    }
  })
})

describe('resolveMovement leaves ground alone', () => {
  it('ignores a surface flat enough to walk on', () => {
    const to = new Vector3(0, -1, 0)
    const out = resolveMovement(new Vector3(0, 1, 0), to, new Vector3(0, -20, 0), gentleFloor, C)
    expect(out.position.toArray()).toEqual(to.toArray())
    expect(out.velocity.toArray()).toEqual([0, -20, 0])
    expect(out.normal).toBeNull()
  })
})

describe('resolveMovement in a corner', () => {
  it('does not drive through the second wall while deflecting off the first', () => {
    // One pass deflects off the near wall and sends the player along it, straight through
    // the far one. This is the case the second pass exists for.
    const corner: TerrainQuery = {
      groundHeightAt: () => null,
      raycast: (from, direction) => {
        // The +X wall at x = 5, and the +Z wall at z = 5.
        const hits: { travel: number; point: Vector3; normal: Vector3 }[] = []
        if (direction.x > 1e-9) {
          const travel = (5 - from.x) / direction.x
          if (travel >= 0) {
            hits.push({
              travel,
              point: new Vector3(5, from.y, from.z + direction.z * travel),
              normal: new Vector3(-1, 0, 0),
            })
          }
        }
        if (direction.z > 1e-9) {
          const travel = (5 - from.z) / direction.z
          if (travel >= 0) {
            hits.push({
              travel,
              point: new Vector3(from.x + direction.x * travel, from.y, 5),
              normal: new Vector3(0, 0, -1),
            })
          }
        }
        hits.sort((a, b) => a.travel - b.travel)
        const first = hits[0]
        return first ? { point: first.point, normal: first.normal, islandId: 'corner' } : null
      },
    }
    const out = resolveMovement(
      new Vector3(), new Vector3(10, 0, 10), new Vector3(10, 0, 10), corner, C,
    )
    expect(out.position.x).toBeLessThanOrEqual(4.5 + 1e-6)
    expect(out.position.z).toBeLessThanOrEqual(4.5 + 1e-6)
  })
})

describe('the shipped collision config', () => {
  it('passes its own validator', () => {
    expect(() => validateCollisionConfig(DEFAULT_COLLISION_CONFIG)).not.toThrow()
  })

  it('rejects a threshold that would make level ground a wall', () => {
    expect(() => validateCollisionConfig({ radius: 0.5, wallNormalY: 1 })).toThrow(/wallNormalY/)
  })

  it('rejects a radius of zero', () => {
    expect(() => validateCollisionConfig({ radius: 0, wallNormalY: 0.5 })).toThrow(/radius/)
  })
})
