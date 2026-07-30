import { describe, it, expect } from 'vitest'
import {
  speedIntensity, fovForSpeed, windVolumeForSpeed, windPitchForSpeed, trailOpacityForSpeed,
  BASE_FOV, MAX_FOV_KICK, FX_SPEED_REFERENCE, TRAIL_SPEED_THRESHOLD,
} from './mapping'

describe('speedIntensity', () => {
  it('is zero at rest', () => { expect(speedIntensity(0)).toBe(0) })
  it('is one at the reference speed', () => { expect(speedIntensity(FX_SPEED_REFERENCE)).toBe(1) })
  it('clamps above the reference', () => { expect(speedIntensity(500)).toBe(1) })
  it('clamps below zero', () => { expect(speedIntensity(-10)).toBe(0) })
})

describe('fovForSpeed', () => {
  it('is the base field of view at rest', () => { expect(fovForSpeed(0)).toBe(BASE_FOV) })

  it('kicks out at full speed', () => {
    expect(fovForSpeed(FX_SPEED_REFERENCE)).toBe(BASE_FOV + MAX_FOV_KICK)
  })

  it('increases monotonically', () => {
    expect(fovForSpeed(40)).toBeGreaterThan(fovForSpeed(20))
  })

  it('stays within a sane range', () => {
    expect(fovForSpeed(1000)).toBeLessThanOrEqual(BASE_FOV + MAX_FOV_KICK)
  })
})

describe('windVolumeForSpeed', () => {
  it('is silent at rest', () => { expect(windVolumeForSpeed(0)).toBe(0) })

  it('is full at the reference speed', () => {
    expect(windVolumeForSpeed(FX_SPEED_REFERENCE)).toBe(1)
  })

  it('ramps in slowly rather than linearly', () => {
    expect(windVolumeForSpeed(FX_SPEED_REFERENCE / 2)).toBeLessThan(0.5)
  })

  it('never exceeds one', () => { expect(windVolumeForSpeed(1000)).toBe(1) })
})

describe('windPitchForSpeed', () => {
  it('rises with speed', () => {
    expect(windPitchForSpeed(50)).toBeGreaterThan(windPitchForSpeed(5))
  })

  it('stays positive at rest so playback never stops', () => {
    expect(windPitchForSpeed(0)).toBeGreaterThan(0)
  })
})

describe('trailOpacityForSpeed', () => {
  it('shows nothing below the threshold', () => {
    expect(trailOpacityForSpeed(TRAIL_SPEED_THRESHOLD - 1)).toBe(0)
  })

  it('fades in above the threshold', () => {
    expect(trailOpacityForSpeed(TRAIL_SPEED_THRESHOLD + 5)).toBeGreaterThan(0)
  })

  it('is fully opaque at the reference speed', () => {
    expect(trailOpacityForSpeed(FX_SPEED_REFERENCE)).toBe(1)
  })

  it('never exceeds one', () => { expect(trailOpacityForSpeed(1000)).toBe(1) })
})
