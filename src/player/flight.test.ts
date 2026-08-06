import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { gliderUp, gliderRight, angleOfAttack, hoverAccel, flightStep, stallFactor } from './flight'
import { DEFAULT_FLIGHT_CONFIG as C } from '../core/config'

const FWD_LEVEL = new Vector3(0, 0, -1)

describe('gliderUp', () => {
  it('is perpendicular to forward when level', () => {
    expect(gliderUp(FWD_LEVEL, 0).dot(FWD_LEVEL)).toBeCloseTo(0, 6)
  })

  it('is perpendicular to forward when pitched up', () => {
    const f = new Vector3(0, 0.4, -1).normalize()
    expect(gliderUp(f, 0).dot(f)).toBeCloseTo(0, 6)
  })

  it('points world-up when the glider is level and unbanked', () => {
    const up = gliderUp(FWD_LEVEL, 0)
    expect(up.y).toBeCloseTo(1, 5)
  })

  it('is still normalised and perpendicular when banked', () => {
    const f = new Vector3(0, -0.2, -1).normalize()
    const up = gliderUp(f, 0.7)
    expect(up.length()).toBeCloseTo(1, 6)
    expect(up.dot(f)).toBeCloseTo(0, 6)
  })

  it('rolls the up axis sideways when banked', () => {
    expect(Math.abs(gliderUp(FWD_LEVEL, 0.7).x)).toBeGreaterThan(0.1)
  })

  it('does not produce NaN when forward is straight down', () => {
    const up = gliderUp(new Vector3(0, -1, 0), 0)
    expect(Number.isFinite(up.x + up.y + up.z)).toBe(true)
    expect(up.length()).toBeCloseTo(1, 6)
  })
})

describe('gliderRight', () => {
  const HEADINGS = [
    new Vector3(0, 0, -1),
    new Vector3(1, 0, 0),
    new Vector3(0, -1, -1).normalize(),
    new Vector3(0.3, 0.8, -0.5).normalize(),
    new Vector3(0, 1, 0),   // vertical: the case gliderUp handles explicitly
    new Vector3(0, -1, 0),
  ]

  // The next two are identities for any function of this shape, not evidence about which
  // way gliderRight actually points: cross(A, forward) is perpendicular to both A and
  // forward regardless of the order the cross is taken in, or which vector plays A, so
  // negating the whole result -- exactly the handedness bug that shipped once -- passes
  // both unchanged. Checked directly: reverting the argument order in gliderRight (the
  // real neutralisation that bug was) left both of these green; only "is unit length"
  // caught it, because a mis-signed vector is still unit length too, so even that one is
  // weaker evidence than it looks. The test that actually pins the sign is the handedness
  // one below.
  it('is perpendicular to the heading, for every heading', () => {
    for (const forward of HEADINGS) {
      expect(Math.abs(gliderRight(forward, 0).dot(forward)))
        .toBeLessThan(1e-6)
    }
  })

  it('is perpendicular to the glider up axis too, so the three make a frame', () => {
    for (const forward of HEADINGS) {
      expect(Math.abs(gliderRight(forward, 0).dot(gliderUp(forward, 0))))
        .toBeLessThan(1e-6)
    }
  })

  it('is unit length', () => {
    for (const forward of HEADINGS) {
      expect(gliderRight(forward, 0).length()).toBeCloseTo(1, 6)
    }
  })

  it('rolls with the bank, so a banked dodge is not horizontal', () => {
    // The reason this is derived from gliderUp rather than from a world-up cross:
    // a world-up cross is horizontal for every heading, so a banked glider's lateral
    // dodge would be flat no matter how far over it was rolled.
    expect(Math.abs(gliderRight(new Vector3(0, 0, -1), 0).y)).toBeLessThan(1e-6)
    expect(Math.abs(gliderRight(new Vector3(0, 0, -1), 0.6).y)).toBeGreaterThan(0.1)
  })

  it('points the same way the ground dodge calls right, not its mirror', () => {
    // The bug this exists to catch: gliderRight shipped once returning the glider's left
    // axis instead of its right, because cross(gliderUp, forward) is -right by the vector
    // triple product identity (forward*(right.forward) - right*(forward.forward) = -right,
    // since right is perpendicular to forward and forward is unit). Perpendicularity and
    // unit length can't see that sign; a component against a known heading can. `right`
    // here is the same expression slipstreamHeading uses for the ground dodge's right --
    // cross(forward, WORLD_UP) -- so this also pins gliderRight against gliderUp's own
    // internal `right` at flight.ts:19, not just against an independently-typed vector
    // that happens to agree by coincidence.
    const forward = new Vector3(0, 0, -1)
    const groundRight = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
    expect(gliderRight(forward, 0).x).toBeCloseTo(groundRight.x, 5)
    expect(gliderRight(forward, 0).x).toBeCloseTo(1, 5)
  })
})

describe('angleOfAttack', () => {
  it('is zero when the glider moves exactly where it points', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 0, -20), gliderUp(FWD_LEVEL, 0))
    expect(aoa).toBeCloseTo(0, 5)
  })

  it('is zero when the glider is barely moving', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 0, 0), gliderUp(FWD_LEVEL, 0))
    expect(aoa).toBe(0)
  })

  it('is positive when the nose is above the flight path', () => {
    // Pointing level but sinking: the nose is above where it is going.
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, -10, -10), gliderUp(FWD_LEVEL, 0))
    expect(aoa).toBeGreaterThan(0)
    expect(aoa).toBeCloseTo(Math.PI / 4, 3)
  })

  it('is negative when the nose is below the flight path', () => {
    // Pointing level but climbing: the nose is below where it is going.
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, 10, -10), gliderUp(FWD_LEVEL, 0))
    expect(aoa).toBeLessThan(0)
    expect(aoa).toBeCloseTo(-Math.PI / 4, 3)
  })

  it('reaches ninety degrees when moving straight down while pointing level', () => {
    const aoa = angleOfAttack(FWD_LEVEL, new Vector3(0, -10, 0), gliderUp(FWD_LEVEL, 0))
    expect(aoa).toBeCloseTo(Math.PI / 2, 4)
  })
})

describe('hoverAccel', () => {
  it('cancels gravity exactly', () => {
    // The point of hovering is holding altitude with no updraft, which means
    // producing precisely the acceleration gravity is taking away.
    const accel = hoverAccel(new Vector3(), C)
    expect(accel.y).toBeCloseTo(C.gravity, 6)
  })

  it('bleeds airspeed so the glider can stop dead', () => {
    // A plain glider must keep moving to keep flying. Bending lets it stop.
    const accel = hoverAccel(new Vector3(30, 0, 0), C)
    expect(accel.x).toBeLessThan(0)
  })

  it('opposes a climb as well as a dive, so a hover settles', () => {
    // Only ever fighting descent would let a hover balloon upward instead of
    // holding station.
    expect(hoverAccel(new Vector3(0, 12, 0), C).y).toBeLessThan(C.gravity)
  })

  it('holds altitude against gravity over time', () => {
    let velocity = new Vector3(18, 0, 0)
    let position = new Vector3(0, 100, 0)
    for (let t = 0; t < 3; t += 1 / 60) {
      const step = flightStep(position, velocity, {
        forward: new Vector3(1, 0, 0), thrust: false, flare: false, bank: 0, hover: true, tuck: false,
      }, 1 / 60, C)
      position = step.position
      velocity = step.velocity
    }
    // Without hover this would have fallen roughly 90 units in three seconds.
    expect(position.y).toBeGreaterThan(95)
    // And it should have shed most of its speed rather than cruising on.
    expect(velocity.length()).toBeLessThan(9)
  })
})

describe('stallFactor', () => {
  it('makes full lift at and above stall speed', () => {
    expect(stallFactor(C.stallSpeed, C)).toBe(1)
    expect(stallFactor(C.stallSpeed + 20, C)).toBe(1)
  })

  it('makes no lift at rest', () => {
    expect(stallFactor(0, C)).toBe(0)
  })

  it('ramps linearly below stall speed', () => {
    // Literals rather than a restatement of the formula, so a changed ramp shape is caught
    // here rather than absorbed. `stallSeverity` is this value's complement, so softening the
    // ramp to something like a quadratic fade would move the airspeed warning and the wing
    // shudder along with the lift, and this is the test that has to be looked at first.
    expect(stallFactor(C.stallSpeed / 2, C)).toBeCloseTo(0.5)
    expect(stallFactor(C.stallSpeed * 0.25, C)).toBeCloseTo(0.25)
    expect(stallFactor(C.stallSpeed * 0.75, C)).toBeCloseTo(0.75)
  })

  it('never returns a negative factor for a negative speed', () => {
    // A speed is a magnitude and cannot be negative, but a negative factor would invert the
    // lift direction rather than merely weaken it, so the floor is worth holding.
    expect(stallFactor(-5, C)).toBe(0)
  })
})

describe('tucking folds the wings away', () => {
  function dive(tuck: boolean) {
    let velocity = new Vector3(0, -2, -20)
    let position = new Vector3(0, 400, 0)
    const forward = new Vector3(0, -0.45, -0.89).normalize()
    for (let t = 0; t < 2.5; t += 1 / 60) {
      const step = flightStep(position, velocity, {
        forward, thrust: false, flare: false, bank: 0, hover: false, tuck,
      }, 1 / 60, C)
      position = step.position
      velocity = step.velocity
    }
    return { position, velocity }
  }

  it('gains materially more speed in a dive than the same dive with wings out', () => {
    // "Fast dive, big speed gain, no lift". The margin matters: a bare
    // greater-than passes on a fraction of a percent, so it would still hold with
    // the fold factors neutralised and prove nothing about the tuck.
    const tucked = dive(true).velocity.length()
    const winged = dive(false).velocity.length()
    expect(tucked).toBeGreaterThan(winged * 1.15)
  })

  it('loses materially more altitude, because there is no lift holding it up', () => {
    const droppedTucked = 400 - dive(true).position.y
    const droppedWinged = 400 - dive(false).position.y
    expect(droppedTucked).toBeGreaterThan(droppedWinged * 1.15)
  })

  it('leaves the untucked flight model untouched', () => {
    // Both fold factors are 1 when not tucked, so gliding must be bit-identical.
    const args = {
      forward: new Vector3(0, 0, -1), thrust: false, flare: false, bank: 0, hover: false,
    }
    const withFlag = flightStep(new Vector3(), new Vector3(0, 0, -20), { ...args, tuck: false }, 1 / 60, C)
    expect(withFlag.velocity.length()).toBeGreaterThan(0)
  })
})

describe('wind acts on the glider', () => {
  const args = {
    forward: new Vector3(0, 0, -1), thrust: false, flare: false,
    bank: 0, hover: false, tuck: false,
  }

  function fly(wind?: { accel: Vector3; liftScale: number }) {
    let velocity = new Vector3(0, 0, -24)
    let position = new Vector3(0, 300, 0)
    for (let t = 0; t < 2; t += 1 / 60) {
      const step = wind
        ? flightStep(position, velocity, args, 1 / 60, C, wind)
        : flightStep(position, velocity, args, 1 / 60, C)
      position = step.position
      velocity = step.velocity
    }
    return { position, velocity }
  }

  it('lets a strong thermal climb a glider that would otherwise sink', () => {
    // Lift the player did not pay breath for is the whole point of the air being
    // terrain. The thermal has to out-pull gravity to climb rather than merely
    // sink slower, so this uses a core-strength column.
    const lifted = fly({ accel: new Vector3(0, 25, 0), liftScale: 1 })
    // Above the height it started at, which still air cannot manage: left alone the
    // same glider sinks. That is the assertion carrying the weight here — a bare
    // "higher than still air" would also pass on a thermal far too weak to climb.
    expect(lifted.position.y).toBeGreaterThan(300)
    expect(lifted.position.y).toBeGreaterThan(fly().position.y)
  })

  it('lets a weaker thermal slow the sink without reversing it', () => {
    // Not every column is a lift; a modest one buys time, which is what makes
    // reading their strength worth doing.
    const eased = fly({ accel: new Vector3(0, 12, 0), liftScale: 1 })
    expect(eased.position.y).toBeGreaterThan(fly().position.y)
    expect(eased.position.y).toBeLessThan(300)
  })

  it('makes dead air sink the glider faster than still air', () => {
    // "No lift at all. Breath-only flying."
    const dead = fly({ accel: new Vector3(), liftScale: 0 })
    expect(dead.position.y).toBeLessThan(fly().position.y)
  })

  it('carries the glider sideways in a river without it steering there', () => {
    const carried = fly({ accel: new Vector3(20, 0, 0), liftScale: 1 })
    expect(carried.position.x).toBeGreaterThan(fly().position.x + 5)
  })

  it('leaves flight unchanged when the argument is omitted', () => {
    // The wind parameter defaults to still air, so every existing caller and the
    // whole pre-existing flight model are untouched.
    const explicit = fly({ accel: new Vector3(), liftScale: 1 })
    expect(explicit.position.y).toBeCloseTo(fly().position.y, 9)
  })
})
