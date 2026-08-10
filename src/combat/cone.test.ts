import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { inCone } from './cone'

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
const NARROW = { range: 10, halfAngle: Math.PI / 3, verticalReach: 3 }
/**
 * A wide cone where cos(halfAngle) is negative. This is the width of the staff finisher,
 * so guards that are inert at 60° become observable here: at 94.7°, zero dot product
 * satisfies the angle check, so the distance and heading guards prevent false-positive hits.
 * Below 90° these guards cannot be observed by any test, so we use the real staff width
 * to ensure they work when a wide cone is added later.
 */
const WIDE_FOR_GUARDS = { range: 10, halfAngle: Math.PI / 1.9, verticalReach: 3 }
const at = (x: number, z: number) => new Vector3(x, 0, z)
const above = (x: number, y: number, z: number) => new Vector3(x, y, z)

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

  it('catches a target at the edge of the vertical reach and not past it', () => {
    // Both heights are derived from the shape rather than written as literals, so the
    // boundary these assertions measure moves with the value instead of drifting off it.
    const inside = NARROW.verticalReach
    const outside = NARROW.verticalReach + 0.01
    expect(inCone(ORIGIN, NORTH, above(0, inside, -5), NARROW)).toBe(true)
    expect(inCone(ORIGIN, NORTH, above(0, outside, -5), NARROW)).toBe(false)
  })

  it('reaches equally far below as above', () => {
    // A symmetric band, not a ceiling: the player fights from above as often as from below.
    expect(inCone(ORIGIN, NORTH, above(0, -NARROW.verticalReach, -5), NARROW)).toBe(true)
    expect(inCone(ORIGIN, NORTH, above(0, -(NARROW.verticalReach + 0.01), -5), NARROW)).toBe(false)
  })

  it('measures the band against the caster rather than against the world floor', () => {
    // The same vertical gap, both ends lifted 100 units. A test that only ever fires from
    // y = 0 would pass an implementation that compared target.y against zero.
    const high = new Vector3(0, 100, 0)
    expect(inCone(high, NORTH, above(0, 100 + NARROW.verticalReach, -5), NARROW)).toBe(true)
    expect(inCone(high, NORTH, at(0, -5), NARROW)).toBe(false)
  })

  it('requires the height band and the cone together, not either one', () => {
    // Level with the caster but behind them, and straight ahead but too far above. If the
    // two constraints were ORed rather than ANDed, both of these would be hits.
    expect(inCone(ORIGIN, NORTH, at(0, 5), NARROW)).toBe(false)
    expect(inCone(ORIGIN, NORTH, above(0, NARROW.verticalReach + 5, -5), NARROW)).toBe(false)
  })

  it('rejects a target sitting exactly on the origin rather than dividing by zero', () => {
    // Inside the height band trivially, so this exercises the distance guard and not the
    // new height test — the two reject different things and neither stands in for the other.
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
