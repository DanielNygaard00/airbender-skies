import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  profileFor, desiredCameraPosition, smoothTowards, pullInForTerrain,
  GROUND_PROFILE, GLIDER_PROFILE,
} from './follow-cam'
import type { TerrainQuery } from '../core/types'

const noGround: TerrainQuery = { groundHeightAt: () => null, raycast: () => null }

/**
 * A surface `distance` along whatever ray it is given, facing back down it. Written
 * against the ray rather than as world geometry, because what this function cares about
 * is only how far away the first surface along the arm is.
 */
const surfaceAt = (distance: number): TerrainQuery => ({
  groundHeightAt: () => 0,
  raycast: (from, direction, maxDistance) => {
    if (distance > maxDistance) return null
    const unit = direction.clone().normalize()
    return {
      point: from.clone().addScaledVector(unit, distance),
      normal: unit.clone().negate(),
      islandId: 'surface',
    }
  },
})

describe('profileFor', () => {
  it('uses the ground profile on foot', () => {
    expect(profileFor('ground')).toBe(GROUND_PROFILE)
  })

  it('uses the glider profile in flight', () => {
    expect(profileFor('glider')).toBe(GLIDER_PROFILE)
  })

  it('pulls further back in flight to sell speed', () => {
    expect(GLIDER_PROFILE.distance).toBeGreaterThan(GROUND_PROFILE.distance)
  })

  it('smooths tighter in flight, because the camera is the steering device', () => {
    expect(GLIDER_PROFILE.smoothing).toBeGreaterThan(GROUND_PROFILE.smoothing)
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
    expect(Math.abs(fast.x - slow.x)).toBeLessThan(0.01)
  })

  it('never overshoots the target', () => {
    expect(smoothTowards(new Vector3(), new Vector3(10, 0, 0), 1000, 1).x)
      .toBeLessThanOrEqual(10)
  })

  it('does not mutate the current vector', () => {
    const c = new Vector3(0, 0, 0)
    smoothTowards(c, new Vector3(10, 0, 0), 9, 1 / 60)
    expect(c.toArray()).toEqual([0, 0, 0])
  })

  it('does not mutate the desired vector', () => {
    const d = new Vector3(10, 0, 0)
    smoothTowards(new Vector3(0, 0, 0), d, 9, 1 / 60)
    expect(d.toArray()).toEqual([10, 0, 0])
  })
})

describe('pullInForTerrain', () => {
  const target = new Vector3(0, 20, 0)

  it('leaves the camera where it wants to be when nothing is in the way', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, noGround).toArray()).toEqual(desired.toArray())
  })

  it('shortens the arm to the surface between camera and player', () => {
    // The behaviour the old height-lift stood in for. A wall 4 m along a 10 m arm should
    // put the camera at 4 m, not lift it over the wall and leave the player behind it.
    const desired = new Vector3(0, 20, 10)
    const out = pullInForTerrain(target, desired, surfaceAt(4))
    expect(target.distanceTo(out)).toBeLessThan(4.01)
    expect(target.distanceTo(out)).toBeGreaterThan(2)
  })

  it('keeps the arm pointing where it was, only nearer', () => {
    const desired = new Vector3(0, 20, 10)
    const out = pullInForTerrain(target, desired, surfaceAt(4))
    expect(out.x).toBeCloseTo(0, 6)
    expect(out.y).toBeCloseTo(20, 6)
    expect(out.z).toBeGreaterThan(0)
  })

  it('stops strictly short of the surface, never on it', () => {
    // Placing the camera exactly on the hit point puts that surface at distance zero from
    // the camera, behind the near clip plane, which is the see-through-the-wall failure
    // this whole function exists to fix. `CAMERA_SKIN` is what pulls it back off the
    // surface; without it `target.distanceTo(out)` would equal the hit distance exactly.
    const desired = new Vector3(0, 20, 10)
    const hitDistance = 4
    const out = pullInForTerrain(target, desired, surfaceAt(hitDistance))
    expect(target.distanceTo(out)).toBeLessThan(hitDistance)
  })

  it('never comes closer than minDistance, even against a surface nearer than that', () => {
    // Deliberate: a camera jammed into the character's head is worse than a camera
    // briefly clipping a wall.
    const out = pullInForTerrain(target, new Vector3(0, 20, 10), surfaceAt(0.5))
    expect(target.distanceTo(out)).toBeGreaterThanOrEqual(2)
  })

  it('ignores a surface further away than the arm is long', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, surfaceAt(40)).toArray()).toEqual(desired.toArray())
  })

  it('handles a desired position sitting on the player', () => {
    const out = pullInForTerrain(target, target.clone(), surfaceAt(1))
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
  })

  it('never returns a non-finite position', () => {
    const out = pullInForTerrain(target, new Vector3(0, 19, 0), surfaceAt(1))
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true)
  })

  it('does not return a reference-identical copy on early return', () => {
    const desired = new Vector3(0, 20, 10)
    expect(pullInForTerrain(target, desired, noGround)).not.toBe(desired)
  })

  it('does not mutate the target vector', () => {
    const t = new Vector3(0, 20, 0)
    const orig = t.toArray()
    pullInForTerrain(t, new Vector3(0, 20, 10), surfaceAt(4))
    expect(t.toArray()).toEqual(orig)
  })

  it('does not mutate the desired vector', () => {
    const d = new Vector3(0, 20, 10)
    const orig = d.toArray()
    pullInForTerrain(target, d, surfaceAt(4))
    expect(d.toArray()).toEqual(orig)
  })
})
