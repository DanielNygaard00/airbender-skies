import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUALITY, isQuality, profileFor, QUALITIES, QUALITY_PROFILES, toneMappingOwner, Quality,
} from './quality'

describe('quality tiers', () => {
  it('lists every tier the profile table defines, and no others', () => {
    // Guards the sweep below: a fourth tier added to the Record but not to QUALITIES
    // would leave every test in this file silently not covering it.
    const qualitiesSet = new Set(QUALITIES)
    const profilesSet = new Set(Object.keys(QUALITY_PROFILES))
    expect(qualitiesSet).toEqual(profilesSet)
  })

  it('gives every tier a finite, positive pixel-ratio cap and a power-of-two shadow map', () => {
    for (const q of QUALITIES) {
      const p = profileFor(q)
      expect(Number.isFinite(p.pixelRatioCap)).toBe(true)
      expect(p.pixelRatioCap).toBeGreaterThan(0)
      expect(Number.isInteger(Math.log2(p.shadowMapSize))).toBe(true)
    }
  })

  it('never grows more expensive as the tier drops', () => {
    const order: readonly Quality[] = ['low', 'medium', 'high']
    for (let i = 1; i < order.length; i++) {
      const lower = profileFor(order[i - 1]!)
      const higher = profileFor(order[i]!)
      expect(lower.pixelRatioCap).toBeLessThanOrEqual(higher.pixelRatioCap)
      expect(lower.shadowMapSize).toBeLessThanOrEqual(higher.shadowMapSize)
    }
  })

  it('asks for no effects on a tier with no composer', () => {
    for (const q of QUALITIES) {
      const p = profileFor(q)
      if (p.composer) continue
      expect(p.bloom).toBe(false)
      expect(p.grade).toBe(false)
      expect(p.smaa).toBe(false)
    }
  })

  it('keeps antialiasing on at every composited tier', () => {
    // The ruling from the spec: aliasing shows on every edge of every frame, bloom only
    // where something is bright, so SMAA is not medium's first casualty.
    for (const q of QUALITIES) {
      const p = profileFor(q)
      if (p.composer) expect(p.smaa).toBe(true)
    }
  })

  it('leaves the high tier at the current shadow map and pixel ratio', () => {
    // The "unchanged except for the passes" claim, pinned. renderer.ts sets a pixel-ratio
    // cap of 2 and sun.ts a 4096 shadow map today, both after measurement.
    expect(profileFor('high').shadowMapSize).toBe(4096)
    expect(profileFor('high').pixelRatioCap).toBe(2)
  })

  it('hands tone mapping to exactly one owner per tier', () => {
    for (const q of QUALITIES) {
      const p = profileFor(q)
      expect(toneMappingOwner(p)).toBe(p.composer ? 'composer' : 'renderer')
    }
  })

  it('defaults to a tier that exists', () => {
    expect(QUALITIES).toContain(DEFAULT_QUALITY)
  })

  it('recognises only real tiers', () => {
    for (const q of QUALITIES) expect(isQuality(q)).toBe(true)
    for (const bad of ['ultra', '', 'HIGH', 0, null, undefined, {}]) {
      expect(isQuality(bad)).toBe(false)
    }
  })
})
