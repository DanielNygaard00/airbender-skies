import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { stepJump, canAirJump, isCharging, airJumpSpeed } from './jump'
import { DEFAULT_GROUND_CONFIG as G } from '../core/config'
import type { InputState, PlayerState } from '../core/types'

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false, scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false, vortexHeld: false, vortexReleased: false, slipstreamPressed: false, staffPressed: false,
  ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', airJumpsUsed: 0, chargeTime: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
  ...over,
})
const DT = 1 / 60

/** Hold space for `seconds`, starting from a fresh press, then release. */
function holdAndRelease(seconds: number) {
  let s = player()
  let j = stepJump(s, input({ actionPressed: true, actionHeld: true }), DT, G)
  for (let t = DT; t < seconds; t += DT) {
    s = { ...s, chargeTime: j.chargeTime, airJumpsUsed: j.airJumpsUsed }
    j = stepJump(s, input({ actionHeld: true }), DT, G)
  }
  s = { ...s, chargeTime: j.chargeTime, airJumpsUsed: j.airJumpsUsed }
  return stepJump(s, input({ actionReleased: true }), DT, G)
}

describe('tap jump', () => {
  it('a quick tap fires a normal jump on release', () => {
    const j = holdAndRelease(2 * DT)
    expect(j.jumpVelocityY).toBe(G.jumpSpeed)
    expect(j.chargeTime).toBe(0)
  })

  it('press-and-release on the same frame still jumps', () => {
    const j = stepJump(
      player(), input({ actionPressed: true, actionReleased: true }), DT, G,
    )
    expect(j.jumpVelocityY).toBe(G.jumpSpeed)
  })

  it('holding below the threshold does not slow walking', () => {
    const j = stepJump(
      player({ chargeTime: G.chargeThresholdSeconds / 2 }), input({ actionHeld: true }), DT, G,
    )
    expect(j.walkFactor).toBe(1)
  })
})

describe('charged jump', () => {
  it('a full charge fires at chargedJumpSpeed', () => {
    const j = holdAndRelease(G.chargeMaxSeconds + 0.2)
    expect(j.jumpVelocityY).toBeCloseTo(G.chargedJumpSpeed, 5)
  })

  it('a partial charge lands between normal and full speed', () => {
    const j = holdAndRelease(G.chargeMaxSeconds / 2)
    expect(j.jumpVelocityY!).toBeGreaterThan(G.jumpSpeed)
    expect(j.jumpVelocityY!).toBeLessThan(G.chargedJumpSpeed)
  })

  it('slows walking while charging', () => {
    const j = stepJump(
      player({ chargeTime: G.chargeThresholdSeconds + 0.1 }), input({ actionHeld: true }), DT, G,
    )
    expect(j.walkFactor).toBe(G.chargeWalkFactor)
  })

  it('charging accumulates time while held', () => {
    const j = stepJump(player({ chargeTime: 0.5 }), input({ actionHeld: true }), DT, G)
    expect(j.chargeTime).toBeCloseTo(0.5 + DT, 6)
    expect(j.jumpVelocityY).toBeNull()
  })

  it('a held key without a fresh grounded press never starts a charge', () => {
    // E.g. space still held from before a glider landing: chargeTime is 0.
    const j = stepJump(player(), input({ actionHeld: true }), DT, G)
    expect(j.chargeTime).toBe(0)
    const release = stepJump(player(), input({ actionReleased: true }), DT, G)
    expect(release.jumpVelocityY).toBeNull()
  })

  it('cancels silently when the hold vanishes without a release edge', () => {
    // Window blur clears held keys without a key-up event.
    const j = stepJump(player({ chargeTime: 0.8 }), input(), DT, G)
    expect(j.chargeTime).toBe(0)
    expect(j.jumpVelocityY).toBeNull()
  })

  it('cancels when the ground is lost mid-charge', () => {
    const j = stepJump(
      player({ chargeTime: 0.8, grounded: false }), input({ actionHeld: true }), DT, G,
    )
    expect(j.chargeTime).toBe(0)
    expect(j.jumpVelocityY).toBeNull()
  })
})

describe('air jump', () => {
  it('an airborne press with jumps in reserve fires an air jump', () => {
    const j = stepJump(
      player({ grounded: false }), input({ actionPressed: true, actionHeld: true }), DT, G,
    )
    expect(j.jumpVelocityY).toBe(G.airJumpSpeed)
    expect(j.airJumpsUsed).toBe(1)
  })

  it('an exhausted air jump does not fire again', () => {
    const j = stepJump(
      player({ grounded: false, airJumpsUsed: G.maxAirJumps }),
      input({ actionPressed: true, actionHeld: true }), DT, G,
    )
    expect(j.jumpVelocityY).toBeNull()
    expect(j.airJumpsUsed).toBe(G.maxAirJumps)
  })

  it('canAirJump reflects the reserve and groundedness', () => {
    expect(canAirJump(player({ grounded: false }), G)).toBe(true)
    expect(canAirJump(player({ grounded: false, airJumpsUsed: G.maxAirJumps }), G)).toBe(false)
    expect(canAirJump(player(), G)).toBe(false)
  })
})

describe('isCharging', () => {
  it('is true only at or past the threshold', () => {
    expect(isCharging(0, G)).toBe(false)
    expect(isCharging(G.chargeThresholdSeconds, G)).toBe(true)
  })
})

describe('airJumpSpeed', () => {
  it('gains more height the faster the player is already rising', () => {
    // The second jump is a downward air push, so it bites hardest against air that
    // is already moving.
    const slow = airJumpSpeed(2, G)
    const fast = airJumpSpeed(12, G)
    expect(fast).toBeGreaterThan(slow)
  })

  it('gives the plain speed when falling, rather than a penalty', () => {
    // A recovery jump out of a fall must still be worth taking.
    expect(airJumpSpeed(-20, G)).toBe(G.airJumpSpeed)
  })

  it('never returns less than the plain air jump', () => {
    for (const vy of [-50, -1, 0, 1, 50]) {
      expect(airJumpSpeed(vy, G))
        .toBeGreaterThanOrEqual(G.airJumpSpeed)
    }
  })
})
