export const FIXED_DT = 1 / 60
/** Never simulate more than this in one frame, or a stall cascades into a freeze. */
export const MAX_STEPS_PER_FRAME = 5

export interface LoopCallbacks {
  update(dt: number): void
  render(): void
}

/**
 * Fixed-step accumulator. Simulation always advances in FIXED_DT increments so
 * the flight model behaves identically regardless of display refresh rate.
 */
export function createStepper(callbacks: LoopCallbacks, fixedDt = FIXED_DT) {
  let accumulator = 0
  return {
    /** Feed real elapsed seconds. Returns how many simulation steps ran. */
    advance(elapsed: number): number {
      if (!Number.isFinite(elapsed) || elapsed <= 0) {
        callbacks.render()
        return 0
      }
      // Clamping here is what stops a backgrounded tab from discharging
      // thousands of steps the moment it regains focus.
      accumulator += Math.min(elapsed, fixedDt * MAX_STEPS_PER_FRAME)
      let steps = 0
      while (accumulator >= fixedDt && steps < MAX_STEPS_PER_FRAME) {
        callbacks.update(fixedDt)
        accumulator -= fixedDt
        steps++
      }
      callbacks.render()
      return steps
    },
    pendingTime: () => accumulator,
  }
}
