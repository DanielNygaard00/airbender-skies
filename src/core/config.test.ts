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
