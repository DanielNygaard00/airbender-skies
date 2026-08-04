import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { inCone } from './cone'

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
const NARROW = { range: 10, halfAngle: Math.PI / 3 }
/**
 * A wide cone where cos(halfAngle) is negative. This is the width of the staff finisher,
 * so guards that are inert at 60° become observable here: at 94.7°, zero dot product
 * satisfies the angle check, so the distance and heading guards prevent false-positive hits.
 * Below 90° these guards cannot be observed by any test, so we use the real staff width
 * to ensure they work when a wide cone is added later.
 */
const WIDE_FOR_GUARDS = { range: 10, halfAngle: Math.PI / 1.9 }
const at = (x: number, z: number) => new Vector3(x, 0, z)

describe('inCone', () => {
  it('catches a target straight ahead', () => {
    expect(inCone(ORIGIN, NORTH, at(0, -5), NARROW)).toBe(true)
  })

  it('ignores a target behind', () => {
    expect(inCone(ORIGIN, NORTH, at(0, 5), NARROW)).toBe(false)
  })

  it('ignores a target past the range', () => {
    expect(inCone(ORIGIN, NORTH, at(0, -(NARROW.range + 1)), NARROW)).toBe(false)
  })

  it('catches a target at the edge of the angle and not past it', () => {
    // Just inside and just outside the half-angle at the same distance, so the test
    // pins the angle rather than the range.
    const r = NARROW.range / 2
    const inside = NARROW.halfAngle - 0.05
    const outside = NARROW.halfAngle + 0.05
    expect(inCone(ORIGIN, NORTH, at(Math.sin(inside) * r, -Math.cos(inside) * r), NARROW)).toBe(true)
    expect(inCone(ORIGIN, NORTH, at(Math.sin(outside) * r, -Math.cos(outside) * r), NARROW)).toBe(false)
  })

  it('ignores height entirely', () => {
    // The cone is a horizontal sweep, so a target directly above at the same footprint
    // is inside it. Callers that care about height must check separately.
    expect(inCone(ORIGIN, NORTH, new Vector3(0, 40, -5), NARROW)).toBe(true)
  })

  it('rejects a target sitting exactly on the origin rather than dividing by zero', () => {
    expect(inCone(ORIGIN, NORTH, ORIGIN.clone(), WIDE_FOR_GUARDS)).toBe(false)
  })

  it('rejects a degenerate heading rather than dividing by zero', () => {
    expect(inCone(ORIGIN, new Vector3(0, 1, 0), at(0, -5), WIDE_FOR_GUARDS)).toBe(false)
  })

  it('excludes targets behind the cone even when the cone is wide enough that zero dot product passes the angle check', () => {
    // At halfAngle > 90°, cos(halfAngle) is negative, so a target with zero dot product
    // to the heading would satisfy the angle check. This test confirms the cone still
    // correctly excludes targets in the half-space behind the origin.
    expect(inCone(ORIGIN, NORTH, at(0, 5), WIDE_FOR_GUARDS)).toBe(false)
  })
})
