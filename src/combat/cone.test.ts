import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { inCone } from './cone'

const ORIGIN = new Vector3(0, 0, 0)
const NORTH = new Vector3(0, 0, -1)
const WIDE = { range: 10, halfAngle: Math.PI / 3 }
const at = (x: number, z: number) => new Vector3(x, 0, z)

describe('inCone', () => {
  it('catches a target straight ahead', () => {
    expect(inCone(ORIGIN, NORTH, at(0, -5), WIDE)).toBe(true)
  })

  it('ignores a target behind', () => {
    expect(inCone(ORIGIN, NORTH, at(0, 5), WIDE)).toBe(false)
  })

  it('ignores a target past the range', () => {
    expect(inCone(ORIGIN, NORTH, at(0, -(WIDE.range + 1)), WIDE)).toBe(false)
  })

  it('catches a target at the edge of the angle and not past it', () => {
    // Just inside and just outside the half-angle at the same distance, so the test
    // pins the angle rather than the range.
    const r = WIDE.range / 2
    const inside = WIDE.halfAngle - 0.05
    const outside = WIDE.halfAngle + 0.05
    expect(inCone(ORIGIN, NORTH, at(Math.sin(inside) * r, -Math.cos(inside) * r), WIDE)).toBe(true)
    expect(inCone(ORIGIN, NORTH, at(Math.sin(outside) * r, -Math.cos(outside) * r), WIDE)).toBe(false)
  })

  it('ignores height entirely', () => {
    // The cone is a horizontal sweep, so a target directly above at the same footprint
    // is inside it. Callers that care about height must check separately.
    expect(inCone(ORIGIN, NORTH, new Vector3(0, 40, -5), WIDE)).toBe(true)
  })

  it('rejects a target sitting exactly on the origin rather than dividing by zero', () => {
    expect(inCone(ORIGIN, NORTH, ORIGIN.clone(), WIDE)).toBe(false)
  })

  it('rejects a degenerate heading rather than dividing by zero', () => {
    expect(inCone(ORIGIN, new Vector3(0, 1, 0), at(0, -5), WIDE)).toBe(false)
  })
})
