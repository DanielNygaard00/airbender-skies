import { describe, it, expect } from 'vitest'
import { daylightFor, SUN_ELEVATION_DEGREES } from './daylight'
import { environmentIntensityFor, ENVIRONMENT_PER_FILL } from './environment'

describe('environmentIntensityFor', () => {
  it('scales with the daylight fill, so the hour still sets how bright the shade is', () => {
    const sunset = environmentIntensityFor(daylightFor(0))
    const shipped = environmentIntensityFor(daylightFor(SUN_ELEVATION_DEGREES))
    const noon = environmentIntensityFor(daylightFor(90))
    expect(sunset).toBeLessThan(shipped)
    expect(shipped).toBeLessThan(noon)
  })

  it('is the shipped fill times one factor, not a second independent number', () => {
    const light = daylightFor(SUN_ELEVATION_DEGREES)
    expect(environmentIntensityFor(light)).toBeCloseTo(light.hemiIntensity * ENVIRONMENT_PER_FILL, 10)
  })
})
