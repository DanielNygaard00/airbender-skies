import { describe, it, expect } from 'vitest'
import { createStepper, FIXED_DT, MAX_STEPS_PER_FRAME } from './loop'

function spy() {
  const dts: number[] = []
  const alphas: number[] = []
  const frameDts: number[] = []
  return {
    dts,
    alphas,
    frameDts,
    renders: () => alphas.length,
    cb: {
      update: (dt: number) => dts.push(dt),
      render: (alpha: number, frameDt: number) => {
        alphas.push(alpha)
        frameDts.push(frameDt)
      },
    },
  }
}

describe('createStepper', () => {
  it('runs one step for exactly one frame of time', () => {
    const s = spy()
    expect(createStepper(s.cb).advance(FIXED_DT)).toBe(1)
    expect(s.dts).toEqual([FIXED_DT])
  })

  it('always steps by the fixed delta, never the real one', () => {
    const s = spy()
    createStepper(s.cb).advance(FIXED_DT * 2.5)
    expect(new Set(s.dts)).toEqual(new Set([FIXED_DT]))
  })

  it('runs no step when too little time has passed', () => {
    expect(createStepper(spy().cb).advance(FIXED_DT / 3)).toBe(0)
  })

  it('accumulates leftover time across frames', () => {
    const stepper = createStepper(spy().cb)
    stepper.advance(FIXED_DT * 0.6)
    expect(stepper.advance(FIXED_DT * 0.6)).toBe(1)
  })

  it('renders once per frame even with no simulation step', () => {
    const s = spy()
    createStepper(s.cb).advance(FIXED_DT / 4)
    expect(s.renders()).toBe(1)
  })

  it('renders once per frame when several steps run', () => {
    const s = spy()
    createStepper(s.cb).advance(FIXED_DT * 3)
    expect(s.renders()).toBe(1)
  })

  it('clamps a long stall instead of simulating minutes at once', () => {
    expect(createStepper(spy().cb).advance(30)).toBe(MAX_STEPS_PER_FRAME)
  })

  it('does not build up debt after a stall', () => {
    const stepper = createStepper(spy().cb)
    stepper.advance(30)
    expect(stepper.pendingTime()).toBeLessThan(FIXED_DT)
  })

  it('ignores a non-finite or negative delta but still renders', () => {
    const s = spy()
    const stepper = createStepper(s.cb)
    expect(stepper.advance(NaN)).toBe(0)
    expect(stepper.advance(-1)).toBe(0)
    expect(s.renders()).toBe(2)
  })

  it('reports the un-simulated fraction of a step as alpha', () => {
    const s = spy()
    createStepper(s.cb).advance(FIXED_DT * 1.5)
    expect(s.alphas[0]).toBeCloseTo(0.5, 6)
  })

  it('grows alpha across zero-step frames', () => {
    const s = spy()
    const stepper = createStepper(s.cb)
    stepper.advance(FIXED_DT * 0.25)
    stepper.advance(FIXED_DT * 0.25)
    expect(s.alphas[0]).toBeCloseTo(0.25, 6)
    expect(s.alphas[1]).toBeCloseTo(0.5, 6)
  })

  it('keeps alpha in [0, 1) even after a clamped stall', () => {
    const s = spy()
    createStepper(s.cb).advance(30)
    expect(s.alphas[0]).toBeGreaterThanOrEqual(0)
    expect(s.alphas[0]).toBeLessThan(1)
  })

  it('passes the real elapsed seconds through as frameDt', () => {
    const s = spy()
    createStepper(s.cb).advance(0.021)
    expect(s.frameDts[0]).toBeCloseTo(0.021, 6)
  })

  it('renders an invalid delta with a frameDt of zero and alpha unchanged', () => {
    const s = spy()
    const stepper = createStepper(s.cb)
    stepper.advance(FIXED_DT * 0.5)
    stepper.advance(NaN)
    expect(s.frameDts[1]).toBe(0)
    expect(s.alphas[1]).toBeCloseTo(s.alphas[0]!, 6)
  })
})
