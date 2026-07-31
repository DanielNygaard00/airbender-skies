import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { groundStep, desiredVelocity, horizontalForward } from './ground-move'
import { DEFAULT_GROUND_CONFIG as G } from '../core/config'
import type { InputState, PlayerState, TerrainQuery } from '../core/types'

/** Flat ground at y=0 everywhere, so movement can be reasoned about exactly. */
const flatGround: TerrainQuery = {
  groundHeightAt: () => 0,
  raycastDown: (from, maxDistance) =>
    from.y >= 0 && from.y - maxDistance <= 0
      ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
      : null,
}
const voidWorld: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, actionPressed: false, actionHeld: false, actionReleased: false,
  ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', airJumpsUsed: 0, chargeTime: 0, ...over,
})

describe('horizontalForward', () => {
  it('strips the vertical component', () => {
    expect(horizontalForward(new Vector3(0, 0.9, -1)).y).toBe(0)
  })

  it('stays normalised', () => {
    expect(horizontalForward(new Vector3(0, 0.9, -1)).length()).toBeCloseTo(1, 6)
  })

  it('falls back to negative Z when looking straight down', () => {
    expect(horizontalForward(new Vector3(0, -1, 0)).toArray()).toEqual([0, 0, -1])
  })
})

describe('desiredVelocity', () => {
  it('is zero with no input', () => {
    expect(desiredVelocity(input(), G).length()).toBe(0)
  })

  it('moves along the look direction on W', () => {
    expect(desiredVelocity(input({ forward: 1 }), G).z).toBeCloseTo(-G.walkSpeed, 5)
  })

  it('moves right on D', () => {
    expect(desiredVelocity(input({ strafe: 1 }), G).x).toBeCloseTo(G.walkSpeed, 5)
  })

  it('is camera-relative, so yawing changes the world direction', () => {
    const v = desiredVelocity(input({ forward: 1, lookDirection: new Vector3(-1, 0, 0) }), G)
    expect(v.x).toBeCloseTo(-G.walkSpeed, 5)
  })

  it('sprinting is faster than walking', () => {
    expect(desiredVelocity(input({ forward: 1, sprint: true }), G).length())
      .toBeGreaterThan(desiredVelocity(input({ forward: 1 }), G).length())
  })

  it('diagonal movement is not faster than straight', () => {
    expect(desiredVelocity(input({ forward: 1, strafe: 1 }), G).length())
      .toBeCloseTo(G.walkSpeed, 5)
  })
})

describe('groundStep', () => {
  it('stays grounded standing still on flat ground', () => {
    const s = groundStep(player(), input(), 1 / 60, flatGround, G)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 6)
  })

  it('jumps when the action is pressed while grounded', () => {
    expect(groundStep(player(), input({ actionPressed: true }), 1 / 60, flatGround, G).velocity.y)
      .toBeGreaterThan(0)
  })

  it('cannot jump while airborne', () => {
    const airborne = player({ position: new Vector3(0, 50, 0), grounded: false })
    expect(groundStep(airborne, input({ actionPressed: true }), 1 / 60, voidWorld, G).velocity.y)
      .toBeLessThan(0)
  })

  it('falls when there is no ground below', () => {
    const s = groundStep(player({ grounded: false }), input(), 1 / 60, voidWorld, G)
    expect(s.grounded).toBe(false)
    expect(s.position.y).toBeLessThan(0)
  })

  it('records which island it is standing on', () => {
    expect(groundStep(player(), input(), 1 / 60, flatGround, G).lastGroundIslandId).toBe('flat')
  })

  it('does not mutate the state it is given', () => {
    const s = player()
    groundStep(s, input({ forward: 1 }), 1 / 60, flatGround, G)
    expect(s.position.toArray()).toEqual([0, 0, 0])
  })

  it('walking off an edge begins a fall', () => {
    const s = groundStep(player(), input({ forward: 1 }), 1 / 60, voidWorld, G)
    expect(s.grounded).toBe(false)
  })

  it('a jump rises then returns to the ground', () => {
    let s = groundStep(player(), input({ actionPressed: true }), 1 / 60, flatGround, G)
    expect(s.velocity.y).toBeGreaterThan(0)
    let peak = s.position.y
    for (let i = 0; i < 200; i++) {
      s = groundStep(s, input(), 1 / 60, flatGround, G)
      peak = Math.max(peak, s.position.y)
    }
    expect(peak).toBeGreaterThan(1)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 4)
  })

  it('a jump reaches its full ballistic apex with no early snap', () => {
    // Apex should be jumpSpeed^2 / (2*gravity) ≈ 2.0 m. The old snap-from-a-
    // distance behavior capped the visible arc roughly at apex - snapDistance.
    let s = groundStep(player(), input({ actionPressed: true }), 1 / 60, flatGround, G)
    let peak = 0
    for (let i = 0; i < 200; i++) {
      s = groundStep(s, input(), 1 / 60, flatGround, G)
      peak = Math.max(peak, s.position.y)
    }
    const expectedApex = (G.jumpSpeed * G.jumpSpeed) / (2 * G.gravity)
    expect(peak).toBeGreaterThan(expectedApex * 0.9)
    expect(s.grounded).toBe(true)
  })

  it('does not snap to the ground while descending mid-jump', () => {
    // Descending, 1.0 m above ground: inside the old 1.2 m snap distance.
    const midFall = player({
      position: new Vector3(0, 1.0, 0), grounded: false, velocity: new Vector3(0, -3, 0),
    })
    const s = groundStep(midFall, input(), 1 / 60, flatGround, G)
    expect(s.grounded).toBe(false)
    expect(s.position.y).toBeGreaterThan(0.5)
  })

  it('still snaps down small drops while walking', () => {
    // Walking (grounded) with ground 0.5 m below: slope-stick must survive.
    const step: TerrainQuery = {
      groundHeightAt: () => -0.5,
      raycastDown: (from, maxDistance) =>
        from.y >= -0.5 && from.y - maxDistance <= -0.5
          ? { point: new Vector3(from.x, -0.5, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
          : null,
    }
    const s = groundStep(player(), input({ forward: 1 }), 1 / 60, step, G)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(-0.5, 6)
  })

  it('an airborne body lands exactly on contact, not before', () => {
    // One frame at -20 m/s from 0.1 m up crosses the surface this frame.
    const aboutToLand = player({
      position: new Vector3(0, 0.1, 0), grounded: false, velocity: new Vector3(0, -20, 0),
    })
    const s = groundStep(aboutToLand, input(), 1 / 60, flatGround, G)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 6)
    expect(s.velocity.y).toBe(0)
  })
})
