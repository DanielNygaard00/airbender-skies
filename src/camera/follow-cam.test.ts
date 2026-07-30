import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  profileFor, desiredCameraPosition, smoothTowards, pullInForTerrain,
  GROUND_PROFILE, KITE_PROFILE,
} from './follow-cam'
import type { TerrainQuery } from '../core/types'

const noGround: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }
const groundAt = (y: number): TerrainQuery => ({
  groundHeightAt: () => y,
  raycastDown: (from) => ({
    point: new Vector3(from.x, y, from.z), normal: new Vector3(0, 1, 0), islandId: 'g',
  }),
})

describe('profileFor', () => {
  it('uses the ground profile on foot', () => {
    expect(profileFor('ground')).toBe(GROUND_PROFILE)
  })

  it('uses the kite profile in flight', () => {
    expect(profileFor('kite')).toBe(KITE_PROFILE)
  })

  it('pulls further back in flight to sell speed', () => {
    expect(KITE_PROFILE.distance).toBeGreaterThan(GROUND_PROFILE.distance)
  })

  it('smooths tighter in flight, because the camera is the steering device', () => {
    expect(KITE_PROFILE.smoothing).toBeGreaterThan(GROUND_PROFILE.smoothing)
  })
})

describe('desiredCameraPosition', () => {
  const target = new Vector3(0, 0, 0)

  it('sits behind the look direction', () => {
    expect(desiredCameraPosition(target, new Vector3(0, 0, -1), GROUND_PROFILE).z)
      .toBeCloseTo(GROUND_PROFILE.distance, 5)
  })

  it('sits above the target', () => {
    expect(desiredCameraPosition(target, new Vector3(0, 0, -1), GROUND_PROFILE).y)
      .toBeCloseTo(GROUND_PROFILE.height, 5)
  })

  it('follows the look direction around', () => {
    expect(desiredCameraPosition(target, new Vector3(-1, 0, 0), GROUND_PROFILE).x)
      .toBeCloseTo(GROUND_PROFILE.distance, 5)
  })

  it('does not mutate the target it is given', () => {
    const t = new Vector3(1, 2, 3)
    desiredCameraPosition(t, new Vector3(0, 0, -1), GROUND_PROFILE)
    expect(t.toArray()).toEqual([1, 2, 3])
  })
})

describe('smoothTowards', () => {
  it('moves toward the desired position', () => {
    const out = smoothTowards(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 9, 1 / 60)
    expect(out.x).toBeGreaterThan(0)
    expect(out.x).toBeLessThan(10)
  })

  it('converges over many frames', () => {
    let c = new Vector3(0, 0, 0)
    const d = new Vector3(10, 0, 0)
    for (let i = 0; i < 200; i++) c = smoothTowards(c, d, 9, 1 / 60)
    expect(c.x).toBeCloseTo(10, 3)
  })

  it('is frame-rate independent to within a small tolerance', () => {
    let fast = new Vector3()
    let slow = new Vector3()
    const d = new Vector3(10, 0, 0)
    for (let i = 0; i < 120; i++) fast = smoothTowards(fast, d, 9, 1 / 120)
    for (let i = 0; i < 60; i++) slow = smoothTowards(slow, d, 9, 1 / 60)
    expect(Math.abs(fast.x - slow.x)).toBeLessThan(0.2)
  })

  it('never overshoots the target', () => {
    expect(smoothTowards(new Vector3(), new Vector3(10, 0, 0), 1000, 1).x)
      .toBeLessThanOrEqual(10)
  })
})

describe('pullInForTerrain', () => {
  const target = new Vector3(0, 20, 0)

  it('leaves the camera alone in open air', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, noGround).toArray()).toEqual(desired.toArray())
  })

  it('leaves the camera alone when well above terrain', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, groundAt(0)).toArray()).toEqual(desired.toArray())
  })

  it('lifts the camera above terrain it would clip into', () => {
    const desired = new Vector3(0, 1, 10)
    expect(pullInForTerrain(target, desired, groundAt(5)).y).toBeGreaterThan(desired.y)
  })

  it('never returns a non-finite position', () => {
    const out = pullInForTerrain(target, new Vector3(0, 19, 0), groundAt(19))
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
  })
})
