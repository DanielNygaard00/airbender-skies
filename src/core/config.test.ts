import { describe, it, expect } from 'vitest'
import { DEFAULT_FLIGHT_CONFIG, validateFlightConfig } from './config'

describe('flight config', () => {
  it('accepts the default config', () => {
    expect(() => validateFlightConfig(DEFAULT_FLIGHT_CONFIG)).not.toThrow()
  })

  it('rejects non-positive gravity', () => {
    expect(() => validateFlightConfig({ ...DEFAULT_FLIGHT_CONFIG, gravity: 0 }))
      .toThrow(/gravity/)
  })

  it('rejects a stall speed above the cruise reference', () => {
    expect(() => validateFlightConfig({ ...DEFAULT_FLIGHT_CONFIG, stallSpeed: 100 }))
      .toThrow(/stallSpeed/)
  })

  it('defaults produce a roughly 6 to 1 glide ratio input pair', () => {
    // Guards against fat-fingering the two coefficients that set glide feel.
    const { liftCoeff, dragCoeff } = DEFAULT_FLIGHT_CONFIG
    expect(liftCoeff / dragCoeff).toBeGreaterThan(10)
    expect(liftCoeff / dragCoeff).toBeLessThan(25)
  })
})

describe('payload degradation invariants', () => {
  it('rejects a payload that hands the wing more lift or more steering', () => {
    // Above 1 these stop being a weakness and become a reward, which is the opposite of
    // what §2.4 asks the payload to be. Both are checked, because they are validated by one
    // condition and a condition that only read one of them would pass either mistake.
    expect(() => validateFlightConfig({ ...DEFAULT_FLIGHT_CONFIG, payloadLiftFactor: 1.2 }))
      .toThrow(/payload factors/)
    expect(() => validateFlightConfig({ ...DEFAULT_FLIGHT_CONFIG, payloadTurnFactor: 1 }))
      .toThrow(/payload factors/)
  })

  it('rejects a payload that makes breath cheaper', () => {
    expect(() => validateFlightConfig({
      ...DEFAULT_FLIGHT_CONFIG, payloadBreathMultiplier: 0.9,
    })).toThrow(/payloadBreathMultiplier/)
  })

  it('rejects a drain that pushes loaded thrust past an unloaded hover', () => {
    // The bound is a claim the game makes out loud rather than a safety margin: the guide
    // calls hovering the most expensive thing the player can do with breath. 1.8 times
    // thrust's 18 is 32.4, past the hover's 30, so this is the first multiplier that would
    // make that sentence false.
    expect(() => validateFlightConfig({
      ...DEFAULT_FLIGHT_CONFIG, payloadBreathMultiplier: 1.8,
    })).toThrow(/hovering has to stay the most expensive/)
  })

  it('ships a drain that stays inside that bound', () => {
    const c = DEFAULT_FLIGHT_CONFIG
    expect(c.payloadBreathMultiplier * c.breathDrainPerSecond)
      .toBeLessThanOrEqual(c.hoverBreathPerSecond)
  })

  it('anchors the drain to five shrines exactly', () => {
    // 1 + 5 × shrineBreathBonusFraction. Asserted against the two config values rather
    // than against 1.5, so retuning the shrine bonus reddens this rather than silently
    // breaking the claim in the guide and the README that five shrines cover a payload.
    const c = DEFAULT_FLIGHT_CONFIG
    expect(c.payloadBreathMultiplier).toBeCloseTo(1 + 5 * c.shrineBreathBonusFraction, 10)
  })
})

describe('hover cost invariant', () => {
  it('rejects a hover that is cheaper than thrust', () => {
    // If hovering were the cheaper option it would dominate thrust outright, and
    // the glider would have no reason to ever fly forward under power.
    expect(() => validateFlightConfig({
      ...DEFAULT_FLIGHT_CONFIG,
      hoverBreathPerSecond: DEFAULT_FLIGHT_CONFIG.breathDrainPerSecond - 1,
    })).toThrow(/hoverBreathPerSecond/)
  })

  it('accepts the shipped config', () => {
    expect(() => validateFlightConfig(DEFAULT_FLIGHT_CONFIG)).not.toThrow()
  })
})
