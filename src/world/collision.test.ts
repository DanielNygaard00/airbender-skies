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

/**
 * A wall tilted just past vertical -- `normal.y` sits under `wallNormalY` by a hair, the
 * way a steep flank like the spire's does, rather than the dead-vertical face
 * `wallFacingMinusX` models. Answers only the first cast it is given and returns null
 * after that, on purpose: this exists to pin what a single deflection does to vertical
 * velocity (Minor 1), not to exercise multi-pass sliding, which the corner tests above
 * already cover, and a second geometrically-consistent cast off a tilted, non-axis-aligned
 * plane would add real complexity for no more coverage.
 */
const slantedWallOnce = (planePoint: Vector3, normal: Vector3): TerrainQuery => {
  let answered = false
  return {
    groundHeightAt: () => null,
    raycast: (from, direction) => {
      if (answered) return null
      const denom = normal.dot(direction)
      if (denom >= 0) return null
      const travel = normal.dot(planePoint.clone().sub(from)) / denom
      if (travel < 0) return null
      answered = true
      return {
        point: from.clone().addScaledVector(direction, travel),
        normal: normal.clone(),
        islandId: 'slant',
      }
    },
  }
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
})

describe('resolveMovement against a wall', () => {
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

  it('sizes the second pass by remaining arc length along the original sweep, not a rescaled one', () => {
    // Minor 2 of the review: `stopped.distanceTo(origin)` at line 93 is the only thing
    // pinning that figure anywhere in the suite. A reviewer swapped it for `travel * 5` — a
    // fivefold overshoot of the remaining budget — and every test still passed, because
    // nothing checked the number itself, only that z ended up somewhere past 5.
    //
    // The same glancing sweep as the test above, measured exactly rather than assumed: the
    // full diagonal is sqrt(72) = 8.485281374238571 long. The first pass stops at (4.5, 0,
    // 5), which is sqrt(4.5^2 + 5^2) = 6.726812023536855 from the origin — leaving
    // 1.7584693507017164 of the original 8.485281... still to spend along the deflected
    // (now purely +z) direction, landing the second pass at z = 5 + 1.7584693507017164 =
    // 6.758469350701716. That arc-length identity — first leg plus second leg equals the
    // original sweep — is what the formula is actually for; pinning the final position is
    // the falsifiable stand-in for checking it.
    const out = resolveMovement(
      new Vector3(), new Vector3(6, 0, 6), new Vector3(6, 0, 6), wallFacingMinusX(5), C,
    )
    expect(out.position.x).toBeCloseTo(4.5, 9)
    expect(out.position.z).toBeCloseTo(6.758469350701716, 9)
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

  it('injects an upward velocity component off a slanted wall, even from purely horizontal input', () => {
    // Minor 1 of the review, measured on the spire flank over 300 sprint frames: shipped
    // peak vy +3.903 with 102 ungrounded frames, against vy 0 and 97 ungrounded frames with
    // walls disabled. The mechanism: removing the into-surface component of a velocity adds
    // back along +normal, and a wall's normal.y can be anywhere up to (but not including)
    // wallNormalY, so that addition can carry a positive y component the input never had.
    // This then trips groundStep's `velocity.y <= 0` gate on the ground snap, which is the
    // behaviour Minor 1 flags as real, new, and worth pinning rather than assuming.
    const normal = new Vector3(-1, 0.49, 0).normalize()
    const wall = slantedWallOnce(new Vector3(5, 0, 0), normal)
    const velocity = new Vector3(10, 0, 0)
    const out = resolveMovement(new Vector3(), new Vector3(10, 0, 0), velocity, wall, C)
    expect(out.velocity.y).toBeGreaterThan(0)
    expect(out.velocity.y).toBeCloseTo(3.9513, 3)
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
    // With only one pass, the sweep stops dead at whichever wall it meets first -- here the
    // x-wall, arbitrarily, since both hits tie in this symmetric corner -- and never even
    // asks about the second: `PASSES - 1` is 0, so pass 0 is already the last pass, and the
    // last pass always stops at contact rather than sliding past it. That leaves z at
    // exactly 5, the z-wall's own surface, with none of the radius clearance the x-wall got.
    // Not "slides along the first wall and through the second" -- this implementation never
    // slides on its last pass -- but still a real penetration of the second wall's
    // clearance, which is the case the second pass exists to catch.
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
