import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { noShake, shakeOffset, slamShakeAmplitude, stepShake, triggerShake } from './shake'
import type { ShakeConfig } from './config'

const C: ShakeConfig = {
  slamMinAmplitude: 0.1,
  slamMaxAmplitude: 0.5,
  slamSeconds: 0.3,
  downAmplitude: 0.2,
  downSeconds: 0.2,
  hurtAmplitude: 0.4,
  hurtSeconds: 0.25,
}

const out = () => new Vector3()

/**
 * The largest offset magnitude seen across a whole shake, sampled every frame.
 *
 * Sampling rather than probing one moment, because the offset is a sine and a single
 * probe can land on a zero crossing. A test that reads 0.5 of the way through a
 * decaying oscillation is exactly the shape that shipped green-and-useless here
 * during the staff work.
 */
function peakOver(amplitude: number, seconds: number, from = 0, to = seconds): number {
  let state = triggerShake(noShake(), amplitude, seconds)
  const dt = 1 / 240
  let elapsed = 0
  let peak = 0
  const v = out()
  while (state.remaining > 0) {
    if (elapsed >= from && elapsed < to) {
      peak = Math.max(peak, shakeOffset(state, v).length())
    }
    state = stepShake(state, dt)
    elapsed += dt
  }
  return peak
}

describe('the kick', () => {
  it('is nothing before anything happens', () => {
    expect(shakeOffset(noShake(), out()).length()).toBe(0)
  })

  it('actually moves the camera, by a real fraction of the amplitude', () => {
    // A margin rather than `> 0`, which passes on a millionth of a unit.
    expect(peakOver(0.4, 0.25)).toBeGreaterThan(0.4 * 0.5)
  })

  it('never exceeds the amplitude it was given', () => {
    expect(peakOver(0.4, 0.25)).toBeLessThanOrEqual(0.4 + 1e-9)
  })

  it('decays: the second half is materially quieter than the first', () => {
    const early = peakOver(0.4, 0.25, 0, 0.125)
    const late = peakOver(0.4, 0.25, 0.125, 0.25)
    // Half, not merely smaller. A bare `>` would pass on a decay of nothing.
    expect(late).toBeLessThan(early * 0.6)
  })

  it('is exactly zero once spent, not merely small', () => {
    let state = triggerShake(noShake(), 0.4, 0.05)
    state = stepShake(state, 0.06)
    expect(state.remaining).toBe(0)
    expect(shakeOffset(state, out()).length()).toBe(0)
  })

  it('does not trace a straight line', () => {
    // Two axes at different frequencies. If both used one frequency the offset would
    // oscillate along a single diagonal, which reads as a slide rather than a shake.
    let state = triggerShake(noShake(), 0.4, 0.25)
    const ratios: number[] = []
    const v = out()
    for (let i = 0; i < 20; i++) {
      const o = shakeOffset(state, v)
      if (Math.abs(o.x) > 1e-6) ratios.push(o.y / o.x)
      state = stepShake(state, 1 / 240)
    }
    const spread = Math.max(...ratios) - Math.min(...ratios)
    expect(spread).toBeGreaterThan(0.5)
  })
})

describe('two events on one frame', () => {
  // Both orders, for the same reason hitstop's longest-wins is tested both ways.
  it('keeps the strongest, whichever arrived first', () => {
    const bigThenSmall = triggerShake(triggerShake(noShake(), 0.4, 0.2), 0.1, 0.2)
    const smallThenBig = triggerShake(triggerShake(noShake(), 0.1, 0.2), 0.4, 0.2)
    expect(bigThenSmall.amplitude).toBeCloseTo(0.4)
    expect(smallThenBig.amplitude).toBeCloseTo(0.4)
  })

  it('restarts the clock when the stronger one arrives', () => {
    const running = stepShake(triggerShake(noShake(), 0.1, 0.2), 0.15)
    expect(triggerShake(running, 0.4, 0.2).remaining).toBeCloseTo(0.2)
  })

  it('ignores a non-positive or non-finite request', () => {
    const idle = noShake()
    expect(triggerShake(idle, 0, 0.2).amplitude).toBe(0)
    expect(triggerShake(idle, 0.4, 0).amplitude).toBe(0)
    expect(triggerShake(idle, Number.NaN, 0.2).amplitude).toBe(0)
    expect(triggerShake(idle, 0.4, Number.POSITIVE_INFINITY).amplitude).toBe(0)
  })
})

describe('a slam scales with its own strength', () => {
  it('runs from the minimum to the maximum amplitude', () => {
    expect(slamShakeAmplitude(0, C)).toBeCloseTo(0.1)
    expect(slamShakeAmplitude(1, C)).toBeCloseTo(0.5)
    expect(slamShakeAmplitude(0.5, C)).toBeCloseTo(0.3)
  })

  it('clamps a strength outside the range', () => {
    expect(slamShakeAmplitude(-1, C)).toBeCloseTo(0.1)
    expect(slamShakeAmplitude(4, C)).toBeCloseTo(0.5)
  })
})
