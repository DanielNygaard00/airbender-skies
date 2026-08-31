import { describe, expect, it, vi } from 'vitest'
import { Group, Object3D } from 'three'
import { createEffectPool } from '../fx/effect-pool'
import type { Effect } from '../fx/effect'
import { runFixedClock } from './clock'

const STEP = 1 / 60

/**
 * A stand-in effect that never retires on its own and just counts how many times it was
 * advanced — the same fake shape `effect-pool.test.ts` uses, minus the lifetime, because the
 * thing under test here is how many times the clock calls `advance` at all, not what a real
 * effect does with `dt`.
 */
function immortal() {
  const object = new Object3D()
  let calls = 0
  const effect: Effect = {
    object,
    advance(): boolean {
      calls += 1
      return true
    },
    dispose(): void {},
  }
  return { effect, calls: () => calls }
}

describe('runFixedClock', () => {
  it('fires exactly once, on the same tick the old rAF loop fired on', () => {
    // gust and water-canyon/water all share fireAt 0.1; independently verified (see the
    // report) that elapsed first reaches 0.1 on the 7th increment of STEP (1/60), i.e. after
    // 6 completed advances. `invocationCallOrder` lets the test read the global call order of
    // both spies without needing to reconstruct `elapsed` itself.
    const fire = vi.fn()
    const advance = vi.fn()
    const advances = runFixedClock(0.1, 0.2, STEP, fire, advance)

    expect(fire).toHaveBeenCalledTimes(1)
    const fireOrder = fire.mock.invocationCallOrder[0]
    const advancesBeforeFire = advance.mock.invocationCallOrder.filter((o) => o < fireOrder!).length
    expect(advancesBeforeFire).toBe(6)
    expect(advances).toBe(13)
  })

  it('never fires for a scene with no effect, however long it runs', () => {
    const fire = vi.fn()
    const advance = vi.fn()
    runFixedClock(null, 5, STEP, fire, advance)
    expect(fire).not.toHaveBeenCalled()
    // Still advances the pool every tick, exactly as the old loop did with nothing in it.
    // 301, not the exact 300 `5 / STEP` implies, for the same float-drift reason `clock.ts`'s
    // own comment gives for `gust` needing one more than `Math.ceil` alone predicts.
    expect(advance).toHaveBeenCalledTimes(301)
  })

  it('advances a live effect the same number of times the old rAF loop did, for gust and water', () => {
    // Measured directly (see the report): the old loop, run one step per rAF callback,
    // advanced a freshly-fired effect 7 times before gust's freeze and 8 times before
    // water's. Wiring a real `createEffectPool` and an immortal fake effect through
    // `runFixedClock` reproduces that measurement without a fake browser.
    const cases: Array<{ fireAt: number; duration: number; expected: number }> = [
      { fireAt: 0.1, duration: 0.2, expected: 7 }, // gust
      { fireAt: 0.1, duration: 0.22, expected: 8 }, // water
    ]
    for (const { fireAt, duration, expected } of cases) {
      const scene = new Group()
      const pool = createEffectPool(scene)
      const fake = immortal()
      runFixedClock(fireAt, duration, STEP, () => pool.add(fake.effect), (dt) => pool.advance(dt))
      expect(fake.calls()).toBe(expected)
      expect(pool.size()).toBe(1) // still alive, not retired
    }
  })

  it('throws instead of hanging or silently truncating on a nonsense duration', () => {
    // Infinity keeps `elapsed < duration` true forever, so the loop can only ever stop by
    // hitting the iteration cap — exactly the case a bench must not paper over with a
    // plausible-looking short frame. The test returning at all (rather than timing out) is
    // most of the boundedness proof; the throw is the assertion that it did not then lie about
    // what happened.
    const fire = vi.fn()
    const advance = vi.fn()
    expect(() => runFixedClock(0, Infinity, STEP, fire, advance)).toThrow(/10000-step bound/)
    // Fired and advanced plenty before giving up — this is not a scene that never ran, it is
    // one that ran to the cap and still had `duration` left to go.
    expect(fire).toHaveBeenCalledTimes(1)
    expect(advance.mock.calls.length).toBeGreaterThan(9_000)
  })

  it('does not spin on other nonsense durations either', () => {
    for (const duration of [Number.NaN, -1, 0]) {
      const fire = vi.fn()
      const advance = vi.fn()
      const advances = runFixedClock(0, duration, STEP, fire, advance)
      expect(advances).toBe(0)
      expect(fire).not.toHaveBeenCalled()
    }
  })
})
