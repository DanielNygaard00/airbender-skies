import { describe, it, expect, beforeEach } from 'vitest'
import { advanceWeather, CLOUD_DRIFT, CLOUD_SPEED, WIND_CLOCK, WIND_DIRECTION } from './weather'

describe('advanceWeather', () => {
  beforeEach(() => {
    WIND_CLOCK.value = 0
    CLOUD_DRIFT.value.set(0, 0)
  })

  it('runs the shared wind clock forward', () => {
    advanceWeather(0.5)
    advanceWeather(0.25)
    expect(WIND_CLOCK.value).toBeCloseTo(0.75, 10)
  })

  it('wraps the wind clock rather than letting it grow, so float precision never decays', () => {
    for (let i = 0; i < 100000; i++) advanceWeather(1 / 60)
    expect(WIND_CLOCK.value).toBeGreaterThanOrEqual(0)
    expect(WIND_CLOCK.value).toBeLessThan(600)
  })

  it('carries the clouds downwind without ever jumping back', () => {
    // A wrapped drift would snap every cloud back to its start once a wrap; the drift must only
    // ever grow along the wind, straight through the point where the wind clock wraps.
    let previous = 0
    for (let i = 0; i < 40000; i++) {
      advanceWeather(1 / 60)
      const along = CLOUD_DRIFT.value.x * WIND_DIRECTION[0] + CLOUD_DRIFT.value.y * WIND_DIRECTION[1]
      expect(along).toBeGreaterThan(previous)
      previous = along
    }
    expect(previous).toBeCloseTo((40000 / 60) * CLOUD_SPEED, 6)
  })

  it('ignores a bad step rather than poisoning every tree and cloud with NaN', () => {
    advanceWeather(Number.NaN)
    advanceWeather(-1)
    advanceWeather(Number.POSITIVE_INFINITY)
    expect(WIND_CLOCK.value).toBe(0)
    expect(CLOUD_DRIFT.value.length()).toBe(0)
  })
})
