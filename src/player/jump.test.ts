import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { stepJump, canAirJump, isCharging, airJumpSpeed, type JumpStep } from './jump'
import { DEFAULT_GROUND_CONFIG as G } from '../core/config'
import type { InputState, PlayerState } from '../core/types'

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false, scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false, vortexHeld: false, vortexReleased: false, slipstreamPressed: false, staffPressed: false,
  // The element radial's four fields. Air is the resting selection, the radial is closed,
  // and no pointer movement: none of this reaches movement code, which is the point —
  // `stepElements` is the only consumer, and it is not on the movement path.
  radialHeld: false, radialReleased: false, pointerDelta: { x: 0, y: 0 }, elementIndex: null,
  ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', airJumpsUsed: 0, chargeTime: 0, coyoteTime: 0, jumpBuffer: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, slipstreamElapsed: null, slipstreamCooldown: 0,
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

describe('coyote time', () => {
  /**
   * The ledge sequence, at exactly the timing the pre-forgiveness measurement used: press
   * on the last grounded frame, then release one frame later, already airborne. Before
   * this feature that produced no jump at all -- one frame of gravity and nothing else.
   */
  const ledgeRelease = (over: Partial<PlayerState> = {}) => {
    const pressed = stepJump(player(), input({ actionPressed: true, actionHeld: true }), DT, G)
    return stepJump(
      player({
        grounded: false, chargeTime: pressed.chargeTime, coyoteTime: G.coyoteSeconds, ...over,
      }),
      input({ actionReleased: true }), DT, G,
    )
  }

  it('a press on the last grounded frame fires a ground jump one frame later', () => {
    // Broken by removing the coyote branch, which is what shipped before this cycle.
    // Asserted against jumpSpeed exactly and against airJumpsUsed together: at this
    // tuning airJumpSpeed is also 9, so the speed alone cannot tell a coyote jump from
    // an air jump, and the air jump must not be what paid for this.
    const j = ledgeRelease()
    expect(j.jumpVelocityY).toBe(G.jumpSpeed)
    expect(j.airJumpsUsed).toBe(0)
    expect(j.jumped).toBe(true)
  })

  it('carries a charge earned on the ground into the window', () => {
    // chargeThresholdSeconds 0.2 is twice the window, so a charge cannot *complete* in
    // the air -- but one already earned on solid ground is the one that fires.
    const j = ledgeRelease({ chargeTime: G.chargeMaxSeconds })
    expect(j.jumpVelocityY).toBeCloseTo(G.chargedJumpSpeed, 5)
    expect(j.airJumpsUsed).toBe(0)
  })

  it('a press outside the window spends the air jump instead', () => {
    // Outside the window the airborne branch is exactly what it always was.
    const j = stepJump(
      player({ grounded: false, coyoteTime: 0 }),
      input({ actionPressed: true, actionHeld: true }), DT, G,
    )
    expect(j.airJumpsUsed).toBe(1)
    expect(j.jumped).toBe(true)
  })

  it('a press outside the window with no air jump left waits for a landing', () => {
    const j = stepJump(
      player({ grounded: false, coyoteTime: 0, airJumpsUsed: G.maxAirJumps }),
      input({ actionPressed: true, actionHeld: true }), DT, G,
    )
    expect(j.jumpVelocityY).toBeNull()
    expect(j.jumped).toBe(false)
    expect(j.jumpBuffer).toBe(G.jumpBufferSeconds)
  })

  it('a press inside the window released after it closed is dropped', () => {
    // The edge this cycle deliberately accepts. Closing it would need a third state field
    // recording "a coyote charge is live", and holding past the window off a ledge is not
    // what this cycle exists to fix. Note the cost is only the lost jump: the release is
    // not a fresh press, so the air jump is not spent and nothing is buffered either.
    const j = stepJump(
      player({ grounded: false, coyoteTime: 0, chargeTime: 0.3 }),
      input({ actionReleased: true }), DT, G,
    )
    expect(j.jumpVelocityY).toBeNull()
    expect(j.jumped).toBe(false)
    expect(j.airJumpsUsed).toBe(0)
    expect(j.jumpBuffer).toBe(0)
  })

  it('a press made after the edge is a ground press, not the air jump', () => {
    // The window's headline case, and it was untested until this pass. Every other coyote test
    // here presses on the last *grounded* frame and only the release lands inside the window,
    // so the coyote branch never saw a press at all -- and reordering `stepJump` so the air-jump
    // branch is consulted first left all 1439 tests green. It hides behind the tuning:
    // `jumpSpeed` and `airJumpSpeed` are both 9, so the two outcomes are indistinguishable by
    // velocity, and `airJumpsUsed` is the only thing that separates them.
    //
    // The press itself must fire nothing: inside the window a press is a ground press, which
    // charges and waits for the release. The air jump is still in hand throughout, which is
    // what makes the case discriminating -- with the reserve spent there would be no air jump
    // for a wrong branch order to reach for.
    // Decayed one frame at a time rather than as `coyoteSeconds - k * DT`, because that is what
    // `groundStep` does and the two do not agree at the far end: six single subtractions leave
    // 2.08e-17, the residue the sixth frame's forgiveness rests on, while the multiplication
    // lands on exactly 0 and closes the window a frame early.
    const decayed = (frames: number) => {
      let t = G.coyoteSeconds
      for (let f = 0; f < frames; f++) t = Math.max(0, t - DT)
      return t
    }
    expect(decayed(6)).toBe(2.0816681711721685e-17)
    expect(G.coyoteSeconds - 6 * DT).toBe(0)
    for (let k = 1; k <= 6; k++) {
      const label = `${k} frames past the edge`
      const inWindow = player({ grounded: false, coyoteTime: decayed(k) })
      const press = stepJump(inWindow, input({ actionPressed: true, actionHeld: true }), DT, G)
      expect(press.jumpVelocityY, label).toBeNull()
      expect(press.jumped, label).toBe(false)
      expect(press.airJumpsUsed, label).toBe(0)
      expect(press.chargeTime, label).toBe(DT)
      // The sixth frame is the last one inside the window, so its release lands outside and is
      // the accepted edge two tests down rather than a jump. Five is the last that jumps.
      if (k > 5) continue
      const release = stepJump(
        player({
          grounded: false, coyoteTime: decayed(k + 1), chargeTime: press.chargeTime,
        }),
        input({ actionReleased: true }), DT, G,
      )
      expect(release.jumpVelocityY, label).toBe(G.jumpSpeed)
      expect(release.airJumpsUsed, label).toBe(0)
    }
  })

  it('carries the buffer forward untouched when nothing fires', () => {
    // groundStep owns the decay, so every non-firing return has to hand the buffer back
    // unchanged or the countdown would restart every frame.
    const j = stepJump(player({ grounded: false, jumpBuffer: 0.07 }), input(), DT, G)
    expect(j.jumpBuffer).toBe(0.07)
  })
})

describe('the jump buffer', () => {
  it('fires on a grounded frame with no press in the input at all', () => {
    // The buffer is the whole trigger here: the press happened frames ago, in the air.
    const j = stepJump(player({ jumpBuffer: G.jumpBufferSeconds }), input(), DT, G)
    expect(j.jumpVelocityY).toBe(G.jumpSpeed)
    expect(j.jumpBuffer).toBe(0)
    expect(j.chargeTime).toBe(0)
    expect(j.jumped).toBe(true)
  })

  it('fires uncharged even when the key is still held', () => {
    // Consistent with the rule two branches down: a key carried across a landing cannot
    // start a charge either, so there is no charge for the buffered jump to spend.
    const j = stepJump(
      player({ jumpBuffer: G.jumpBufferSeconds }), input({ actionHeld: true }), DT, G,
    )
    expect(j.jumpVelocityY).toBe(G.jumpSpeed)
    expect(j.jumpBuffer).toBe(0)
  })

  it('costs no air jump', () => {
    // Started from a spent reserve rather than from the fixture's zero, and that is the whole
    // test: `airJumpsUsed: 0` was both the fixture default and the expected value, so the
    // assertion held whether this branch carried the reserve forward or overwrote it -- setting
    // the branch to `airJumpsUsed: 0` left the suite green. A spent reserve is also the only
    // state a buffer can be armed from, since arming requires the air jump to be gone.
    const j = stepJump(
      player({ jumpBuffer: G.jumpBufferSeconds, airJumpsUsed: G.maxAirJumps }), input(), DT, G,
    )
    expect(j.airJumpsUsed).toBe(G.maxAirJumps)
    expect(j.jumpVelocityY).toBe(G.jumpSpeed)
  })
})

describe('jumped', () => {
  it('is true exactly when a velocity is returned', () => {
    // The two are the same fact, and groundStep reads only `jumped`. If they can
    // disagree, the coyote window closes on frames it should not and stays open on
    // frames it should close.
    const cases: Array<[string, JumpStep]> = [
      ['a grounded tap', stepJump(
        player(), input({ actionPressed: true, actionReleased: true }), DT, G,
      )],
      ['a grounded frame doing nothing', stepJump(player(), input(), DT, G)],
      ['a coyote release', stepJump(
        player({ grounded: false, coyoteTime: G.coyoteSeconds, chargeTime: DT }),
        input({ actionReleased: true }), DT, G,
      )],
      ['an air jump', stepJump(
        player({ grounded: false, coyoteTime: 0 }),
        input({ actionPressed: true, actionHeld: true }), DT, G,
      )],
      ['a press with nothing left', stepJump(
        player({ grounded: false, coyoteTime: 0, airJumpsUsed: G.maxAirJumps }),
        input({ actionPressed: true, actionHeld: true }), DT, G,
      )],
      ['a buffered landing', stepJump(
        player({ jumpBuffer: G.jumpBufferSeconds }), input(), DT, G,
      )],
      ['a plain airborne frame', stepJump(
        player({ grounded: false, coyoteTime: 0 }), input(), DT, G,
      )],
    ]
    for (const [name, j] of cases) {
      expect(j.jumped, name).toBe(j.jumpVelocityY !== null)
    }
    // At least one of each, so the loop cannot pass by every case being false.
    expect(cases.filter(([, j]) => j.jumped).length).toBe(4)
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
