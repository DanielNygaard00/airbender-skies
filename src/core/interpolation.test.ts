import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createInterpolatedVector, DEFAULT_SNAP_DISTANCE } from './interpolation'

describe('createInterpolatedVector', () => {
  it('samples midway between two recorded values', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(0, 0, 0))
    lerp.record(new Vector3(2, 4, 6))
    expect(lerp.sample(0.5, new Vector3()).toArray()).toEqual([1, 2, 3])
  })

  it('returns the previous value at alpha zero', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(1, 1, 1))
    lerp.record(new Vector3(2, 2, 2))
    expect(lerp.sample(0, new Vector3()).toArray()).toEqual([1, 1, 1])
  })

  it('returns the sole recorded value at any alpha before a second record', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(3, 2, 1))
    expect(lerp.sample(0.75, new Vector3()).toArray()).toEqual([3, 2, 1])
  })

  it('rolls current into previous on each record', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(1, 0, 0))
    lerp.record(new Vector3(2, 0, 0))
    lerp.record(new Vector3(3, 0, 0))
    expect(lerp.sample(0, new Vector3()).x).toBe(2)
  })

  it('snaps to current when a step jumps farther than the snap distance', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(0, 0, 0))
    lerp.record(new Vector3(0, 0, DEFAULT_SNAP_DISTANCE + 5))
    expect(lerp.sample(0.25, new Vector3()).z).toBe(DEFAULT_SNAP_DISTANCE + 5)
  })

  it('still blends just below the snap distance', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(0, 0, 0))
    lerp.record(new Vector3(0, 0, DEFAULT_SNAP_DISTANCE - 1))
    expect(lerp.sample(0.5, new Vector3()).z).toBeCloseTo((DEFAULT_SNAP_DISTANCE - 1) / 2, 6)
  })

  it('honours a custom snap distance', () => {
    const lerp = createInterpolatedVector(2)
    lerp.record(new Vector3(0, 0, 0))
    lerp.record(new Vector3(0, 0, 3))
    expect(lerp.sample(0.5, new Vector3()).z).toBe(3)
  })

  it('forgets the previous value on reset', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(1, 0, 0))
    lerp.record(new Vector3(5, 0, 0))
    lerp.reset()
    expect(lerp.sample(0, new Vector3()).x).toBe(5)
  })

  it('writes into and returns the out vector', () => {
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(1, 2, 3))
    const out = new Vector3()
    expect(lerp.sample(0.5, out)).toBe(out)
    expect(out.toArray()).toEqual([1, 2, 3])
  })

  it('does not hold a reference to the recorded vector', () => {
    const lerp = createInterpolatedVector()
    const value = new Vector3(1, 1, 1)
    lerp.record(value)
    value.set(9, 9, 9)
    expect(lerp.sample(1, new Vector3()).toArray()).toEqual([1, 1, 1])
  })
})
