import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { daylightFor, SUN_ELEVATION_DEGREES } from './daylight'
import { SKY_HORIZON, SKY_ZENITH } from './sky'

const luminance = (hex: number): number => {
  const c = new Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

describe('daylight', () => {
  it('reproduces today\'s sky exactly at the sun\'s current elevation', () => {
    // The load-bearing test of this whole step. "The high tier is today's game plus the
    // passes" is only true if the derivation returns the palette the game already ships at
    // the elevation the sun already has.
    const now = daylightFor(SUN_ELEVATION_DEGREES)
    expect(now.skyZenith).toBe(SKY_ZENITH)
    expect(now.skyHorizon).toBe(SKY_HORIZON)
    expect(now.fogColour).toBe(SKY_HORIZON)
    expect(now.sunColour).toBe(0xfff2d8)
    expect(now.sunIntensity).toBeCloseTo(1.8, 5)
    expect(now.hemiSky).toBe(SKY_HORIZON)
    expect(now.hemiGround).toBe(0x4a5a3a)
    expect(now.hemiIntensity).toBeCloseTo(1.5, 5)
  })

  it('keeps fog on the horizon band at every elevation', () => {
    // The invariant renderer.ts already depends on: distant islands dissolve into the
    // horizon rather than into a mismatched grey. It must survive the sun moving.
    for (let e = 0; e <= 90; e += 5) {
      const d = daylightFor(e)
      expect(d.fogColour).toBe(d.skyHorizon)
    }
  })

  it('brightens as the sun climbs', () => {
    let previous = -Infinity
    for (let e = 0; e <= 90; e += 5) {
      const intensity = daylightFor(e).sunIntensity
      expect(intensity).toBeGreaterThanOrEqual(previous)
      previous = intensity
    }
  })

  it('cools the sunlight as it climbs', () => {
    // Warm at the horizon, neutral overhead — the one thing a viewer reads as time of day.
    // Measured as the red-minus-blue gap, which is what "warm" means numerically.
    const gap = (e: number) => { const c = new Color(daylightFor(e).sunColour); return c.r - c.b }
    expect(gap(0)).toBeGreaterThan(gap(45))
    expect(gap(45)).toBeGreaterThan(gap(90))
  })

  it('keeps the horizon band lighter than the zenith', () => {
    // The reason the dome exists: without this the player has nothing to read height
    // against. It must hold at every elevation, not just the shipped one.
    for (let e = 0; e <= 90; e += 5) {
      const d = daylightFor(e)
      expect(luminance(d.skyHorizon)).toBeGreaterThan(luminance(d.skyZenith))
    }
  })

  it('clamps an elevation outside the sky', () => {
    expect(daylightFor(-30)).toEqual(daylightFor(0))
    expect(daylightFor(200)).toEqual(daylightFor(90))
  })

  it('returns finite numbers for every field at every elevation', () => {
    // The non-finite discipline src/fx/scale.ts enforces across the effect directory. A NaN
    // elevation reaching a light intensity is a black screen with no error.
    for (const e of [-1e9, -30, 0, 12.5, SUN_ELEVATION_DEGREES, 90, 1e9, NaN]) {
      for (const value of Object.values(daylightFor(e))) {
        expect(Number.isFinite(value)).toBe(true)
      }
    }
  })
})
