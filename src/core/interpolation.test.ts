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

  it('returns current at every alpha after a reset, so a freeze holds still', () => {
    // What a hitstop leans on. main.ts stops recording while frozen but createStepper
    // keeps draining its accumulator, so alpha goes on sawtoothing across [0,1) against a
    // pinned previous/current pair — and without a reset the visual would oscillate across
    // the last live step's displacement for the whole freeze. Alpha-independence is the
    // property, not just the alpha-zero case above.
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(1, 2, 3))
    lerp.record(new Vector3(4, 8, 12))
    lerp.reset()
    for (const alpha of [0, 0.25, 0.5, 0.75, 0.999, 1]) {
      expect(lerp.sample(alpha, new Vector3()).toArray(), `alpha ${alpha}`)
        .toEqual([4, 8, 12])
    }
  })

  it('resets idempotently, so repeating it on every frozen frame changes nothing', () => {
    // main.ts calls reset() on every frozen frame rather than tracking the frame the
    // freeze began, on the grounds that repeating it is a no-op while nothing records.
    const lerp = createInterpolatedVector()
    lerp.record(new Vector3(1, 0, 0))
    lerp.record(new Vector3(5, 0, 0))
    lerp.reset()
    lerp.reset()
    lerp.reset()
    expect(lerp.sample(0.5, new Vector3()).x).toBe(5)
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
