import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { kiteUp, angleOfAttack } from './flight'

const FWD_LEVEL = new Vector3(0, 0, -1)

describe('kiteUp', () => {
  it('is perpendicular to forward when level', () => {
    expect(kiteUp(FWD_LEVEL, 0).dot(FWD_LEVEL)).toBeCloseTo(0, 6)
  })

  it('is perpendicular to forward when pitched up', () => {
    const f = new Vector3(0, 0.4, -1).normalize()
    expect(kiteUp(f, 0).dot(f)).toBeCloseTo(0, 6)
  })

  it('points world-up when the kite is level and unbanked', () => {
    const up = kiteUp(FWD_LEVEL, 0)
    expect(up.y).toBeCloseTo(1, 5)
  })

  it('is still normalised and perpendicular when banked', () => {
    const f = new Vector3(0, -0.2, -1).normalize()
    const up = kiteUp(f, 0.7)
    expect(up.length()).toBeCloseTo(1, 6)
    expect(up.dot(f)).toBeCloseTo(0, 6)
  })

  it('rolls the up axis sideways when banked', () => {
    expect(Math.abs(kiteUp(FWD_LEVEL, 0.7).x)).toBeGreaterThan(0.1)
  })

  it('does not produce NaN when forward is straight down', () => {
    const up = kiteUp(new Vector3(0, -1, 0), 0)
    expect(Number.isFinite(up.x + up.y + up.z)).toBe(true)
    expect(up.length()).toBeCloseTo(1, 6)
  })
})

describe('angleOfAttack', () => {
  it('is zero when the kite moves exactly where it points', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 0, -20), kiteUp(FWD_LEVEL, 0))
    expect(aoa).toBeCloseTo(0, 5)
  })

  it('is zero when the kite is barely moving', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 0, 0), kiteUp(FWD_LEVEL, 0))
    expect(aoa).toBe(0)
  })

  it('is positive when the nose is above the flight path', () => {
    // Pointing level but sinking: the nose is above where it is going.
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, -10, -10), kiteUp(FWD_LEVEL, 0))
    expect(aoa).toBeGreaterThan(0)
    expect(aoa).toBeCloseTo(Math.PI / 4, 3)
  })

  it('is negative when the nose is below the flight path', () => {
    // Pointing level but climbing: the nose is below where it is going.
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 10, -10), kiteUp(FWD_LEVEL, 0))
    expect(aoa).toBeLessThan(0)
    expect(aoa).toBeCloseTo(-Math.PI / 4, 3)
  })

  it('reaches ninety degrees when moving straight down while pointing level', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, -10, 0), kiteUp(FWD_LEVEL, 0))
    expect(aoa).toBeCloseTo(Math.PI / 2, 4)
  })
})
