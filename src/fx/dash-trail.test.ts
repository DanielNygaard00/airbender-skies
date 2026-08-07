import { describe, it, expect } from 'vitest'
import { Mesh, Quaternion, Vector3 } from 'three'
import { createDashTrail, trailLength } from './dash-trail'
import { DEFAULT_GROUND_CONFIG, DEFAULT_COLLISION_CONFIG } from '../core/config'
import { groundStep } from '../player/ground-move'
import type { GroundConfig, InputState, PlayerState, TerrainQuery } from '../core/types'
import type { Effect } from './effect'

/** Flat ground at y=0 everywhere, so a driven dash has nothing else to react to. */
const flatGround: TerrainQuery = {
  groundHeightAt: () => 0,
  raycast: (from, direction, maxDistance) =>
    direction.y < -0.9 * direction.length() && from.y >= 0 && from.y - maxDistance <= 0
      ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
      : null,
}

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false,
  scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false,
  vortexHeld: false, vortexReleased: false, slipstreamPressed: false, staffPressed: false,
  ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', airJumpsUsed: 0, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, ...over,
})

/**
 * Horizontal distance a single dash actually covers: fired on the first frame from a
 * standstill on flat ground, with no movement keys held after, for 120 frames -- the same
 * shape the original 3.94 m measurement used.
 */
function dashDisplacement(): number {
  let s = player()
  const origin = s.position.clone()
  for (let frame = 0; frame < 120; frame++) {
    s = groundStep(
      s, input({ dashPressed: frame === 0 }), 1 / 60,
      flatGround, DEFAULT_GROUND_CONFIG, DEFAULT_COLLISION_CONFIG,
    )
  }
  return Math.hypot(s.position.x - origin.x, s.position.z - origin.z)
}

const ORIGIN = new Vector3(0, 5, 0)
const HEADING = new Vector3(0, 0, 1)

function streak(trail: Effect): Mesh {
  const first = trail.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected a streak mesh')
  return first
}

const lengthOf = (trail: Effect) => streak(trail).scale.z

function opacityOf(trail: Effect): number {
  const material = streak(trail).material
  if (Array.isArray(material)) throw new Error('expected a single material')
  return material.opacity
}

describe('createDashTrail', () => {
  it('marks the distance the dash actually covers', () => {
    // Asserted by responsiveness rather than by restating the product: doubling the dash
    // speed must lengthen the streak, which a hardcoded length would not do.
    const fast: GroundConfig = {
      ...DEFAULT_GROUND_CONFIG, dashSpeed: DEFAULT_GROUND_CONFIG.dashSpeed * 2,
    }
    const normal = lengthOf(createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG))
    const doubled = lengthOf(createDashTrail(ORIGIN, HEADING, 1, fast))
    expect(doubled).toBeGreaterThan(normal * 1.8)
  })

  it('lengthens when the ground response is softer, so the impulse takes longer to bleed off', () => {
    // Replaces a test that used to vary dashDurationSeconds, a config value the
    // simulation never read. groundResponse is the rate that actually governs how long
    // the impulse survives, so it is what the trail must react to instead.
    const softer: GroundConfig = {
      ...DEFAULT_GROUND_CONFIG, groundResponse: DEFAULT_GROUND_CONFIG.groundResponse / 2,
    }
    const normal = lengthOf(createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG))
    expect(lengthOf(createDashTrail(ORIGIN, HEADING, 1, softer)))
      .toBeGreaterThan(normal * 1.8)
  })

  it('makes the last dash of the chain louder than the first', () => {
    // The chain count is information the player has no other way to read, so the third
    // burst has to look different from the first. A margin, not a bare comparison.
    const first = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    const last = createDashTrail(
      ORIGIN, HEADING, DEFAULT_GROUND_CONFIG.maxDashChain, DEFAULT_GROUND_CONFIG,
    )
    expect(lengthOf(last)).toBeGreaterThan(lengthOf(first) * 1.2)
    expect(opacityOf(last)).toBeGreaterThan(opacityOf(first) * 1.2)
  })

  it('clamps a chain index outside the real range', () => {
    // Nothing should explode if a caller passes 0 or a number past the chain length.
    for (const chain of [0, -3, 99]) {
      const trail = createDashTrail(ORIGIN, HEADING, chain, DEFAULT_GROUND_CONFIG)
      expect(Number.isFinite(lengthOf(trail))).toBe(true)
      expect(lengthOf(trail)).toBeGreaterThan(0)
    }
  })

  it('never draws longer than the fullest chain, however large the index', () => {
    const last = lengthOf(createDashTrail(
      ORIGIN, HEADING, DEFAULT_GROUND_CONFIG.maxDashChain, DEFAULT_GROUND_CONFIG,
    ))
    expect(lengthOf(createDashTrail(ORIGIN, HEADING, 99, DEFAULT_GROUND_CONFIG)))
      .toBeCloseTo(last, 4)
  })

  it('points along the heading', () => {
    const trail = createDashTrail(ORIGIN, new Vector3(1, 0, 0), 1, DEFAULT_GROUND_CONFIG)
    trail.object.updateWorldMatrix(true, true)
    const rotation = new Quaternion()
    trail.object.getWorldQuaternion(rotation)
    // The streak is built along local +Z, so its world +Z must follow the heading.
    const along = new Vector3(0, 0, 1).applyQuaternion(rotation)
    expect(along.x).toBeCloseTo(1, 2)
    expect(Math.abs(along.z)).toBeLessThan(0.05)
  })

  it('runs and then finishes', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    expect(trail.advance(0.05)).toBe(true)
    expect(trail.advance(5)).toBe(false)
  })

  it('fades out', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    const start = opacityOf(trail)
    trail.advance(0.15)
    expect(opacityOf(trail)).toBeLessThan(start)
  })

  it('draws over the world rather than being buried by it', () => {
    // Same regression guard as the gust cone: a low slab near the ground is hidden by
    // terrain that slopes up away from the player, which made the effect invisible.
    const material = streak(createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)).material
    if (Array.isArray(material)) throw new Error('expected a single material')
    expect(material.depthTest).toBe(false)
  })

  it('casts no shadow', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    expect(streak(trail).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    const trail = createDashTrail(ORIGIN, HEADING, 1, DEFAULT_GROUND_CONFIG)
    expect(() => trail.dispose()).not.toThrow()
  })
})

describe('the dash trail is as long as the dash', () => {
  it('is sized from the rate the dash actually decays at', () => {
    expect(trailLength(DEFAULT_GROUND_CONFIG))
      .toBeCloseTo(DEFAULT_GROUND_CONFIG.dashSpeed / DEFAULT_GROUND_CONFIG.groundResponse, 6)
  })

  it('matches the ground a real dash covers, within a frame of travel', () => {
    // The assertion that would have caught the original defect: the trail was drawn
    // 5.72 m long for a dash that covers 3.94 m, because it was sized from
    // dashDurationSeconds -- a config value the simulation never read.
    const covered = dashDisplacement()
    // The 3.94 m figure from the brief, pinned so it cannot drift unnoticed the way
    // Task 1's turn-time comment did.
    expect(covered).toBeCloseTo(3.94, 2)
    expect(Math.abs(trailLength(DEFAULT_GROUND_CONFIG) - covered))
      .toBeLessThan(DEFAULT_GROUND_CONFIG.dashSpeed / 60)
  })
})
