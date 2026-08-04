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
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false, scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false, vortexHeld: false, vortexReleased: false, slipstreamPressed: false,
  ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', airJumpsUsed: 0, chargeTime: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, slipstreamElapsed: null, slipstreamCooldown: 0, ...over,
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

  it('jumps on release of a quick tap', () => {
    const tapped = groundStep(
      player(), input({ actionPressed: true, actionReleased: true }), 1 / 60, flatGround, G,
    )
    expect(tapped.velocity.y).toBe(G.jumpSpeed)
  })

  it('cannot jump while airborne once air jumps are spent', () => {
    const airborne = player({
      position: new Vector3(0, 50, 0), grounded: false, airJumpsUsed: G.maxAirJumps,
    })
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

  it('aims where the player is looking', () => {
    const s = groundStep(
      player(), input({ forward: 1, lookDirection: new Vector3(1, 0, 0) }), 1 / 60, flatGround, G,
    )
    expect(s.forward.x).toBeCloseTo(1, 5)
  })

  it('aims while standing still, because that is when a gust is thrown', () => {
    // The gust's cone is tested against player.forward, so a player who turns on the spot
    // and blasts must blast where they turned to. Velocity cannot supply this: it is zero
    // at exactly the moment the aim matters most.
    const s = groundStep(player(), input({ lookDirection: new Vector3(-1, 0, 0) }), 1 / 60, flatGround, G)
    expect(s.velocity.lengthSq()).toBeLessThan(1e-8)
    expect(s.forward.x).toBeCloseTo(-1, 5)
  })

  it('does not tilt the aim when the player looks up', () => {
    // inGust flattens the heading before testing it, so a tilted forward would draw and
    // resolve a cone that disagrees with the flat one the fight actually uses.
    // Started tilted on purpose: with a level starting forward this assertion holds whether
    // or not the aim is recomputed, which would make it prove nothing.
    const s = groundStep(
      player({ forward: new Vector3(0, 0.5, -1).normalize() }),
      input({ lookDirection: new Vector3(0, 1, -1).normalize() }), 1 / 60, flatGround, G,
    )
    expect(s.forward.y).toBe(0)
  })

  it('a jump rises then returns to the ground', () => {
    let s = groundStep(
      player(), input({ actionPressed: true, actionReleased: true }), 1 / 60, flatGround, G,
    )
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
    let s = groundStep(
      player(), input({ actionPressed: true, actionReleased: true }), 1 / 60, flatGround, G,
    )
    let peak = 0
    for (let i = 0; i < 200; i++) {
      s = groundStep(s, input(), 1 / 60, flatGround, G)
      peak = Math.max(peak, s.position.y)
    }
    const expectedApex = (G.jumpSpeed * G.jumpSpeed) / (2 * G.gravity)
    expect(peak).toBeGreaterThan(expectedApex * 0.9)
    expect(s.grounded).toBe(true)
  })

  it('an airborne press with reserve fires a double jump', () => {
    const falling = player({
      position: new Vector3(0, 50, 0), grounded: false, velocity: new Vector3(0, -10, 0),
    })
    const s = groundStep(falling, input({ actionPressed: true }), 1 / 60, voidWorld, G)
    expect(s.velocity.y).toBe(G.airJumpSpeed)
    expect(s.airJumpsUsed).toBe(1)
  })

  it('a charged release jumps higher than a tap', () => {
    const charged = player({ chargeTime: G.chargeMaxSeconds })
    const s = groundStep(charged, input({ actionReleased: true }), 1 / 60, flatGround, G)
    expect(s.velocity.y).toBeGreaterThan(G.jumpSpeed)
  })

  it('walking is slowed while charging', () => {
    // Measured after the ease settles rather than on the first frame: ground speed
    // now chases the stick instead of snapping to it, so a single frame only ever
    // shows a fraction of the target.
    const settle = (over: Partial<InputState>, state = player()) => {
      let s = state
      for (let t = 0; t < 1.5; t += 1 / 60) {
        s = groundStep(s, input({ forward: 1, ...over }), 1 / 60, flatGround, G)
      }
      return Math.hypot(s.velocity.x, s.velocity.z)
    }

    const charging = settle(
      { actionHeld: true }, player({ chargeTime: G.chargeThresholdSeconds + 0.1 }),
    )
    expect(charging).toBeLessThan(settle({}))
    expect(charging).toBeCloseTo(G.walkSpeed * G.chargeWalkFactor, 1)
  })

  it('landing resets the air jump reserve', () => {
    const aboutToLand = player({
      position: new Vector3(0, 0.05, 0), grounded: false,
      velocity: new Vector3(0, -10, 0), airJumpsUsed: 1,
    })
    const s = groundStep(aboutToLand, input(), 1 / 60, flatGround, G)
    expect(s.grounded).toBe(true)
    expect(s.airJumpsUsed).toBe(0)
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

describe('the air scooter on the ground', () => {
  const settle = (over: Partial<InputState>, seconds = 2, from = player()) => {
    let s = from
    for (let t = 0; t < seconds; t += 1 / 60) {
      s = groundStep(s, input({ forward: 1, ...over }), 1 / 60, flatGround, G)
    }
    return s
  }

  /** Toggle the scooter on exactly once, then hold a line. */
  const mount = () =>
    groundStep(player(), input({ forward: 1, scooterPressed: true }), 1 / 60, flatGround, G)

  it('rides substantially faster than running once toggled on', () => {
    // A bare greater-than passed here even with both speed factors neutralised,
    // because easing leaves the two runs differing by a hair. The scooter is meant
    // to double speed, so the margin is the assertion.
    const running = settle({ sprint: true })
    const riding = settle({ sprint: true }, 2, mount())
    const ran = Math.hypot(running.velocity.x, running.velocity.z)
    const rode = Math.hypot(riding.velocity.x, riding.velocity.z)
    expect(rode).toBeGreaterThan(ran * 1.8)
  })

  it('stays on after the key is released, because it is a toggle', () => {
    // Pressing every frame would flip it on and off continuously.
    expect(settle({}, 1, mount()).scooterActive).toBe(true)
  })

  it('builds its accumulator on a clean line', () => {
    const later = settle({}, 3, mount())
    expect(later.scooterCharge).toBeGreaterThan(0)
    expect(later.scooterActive).toBe(true)
  })

  it('bleeds the accumulator while carving hard', () => {
    const clean = settle({}, 3, mount())
    const carving = settle({ strafe: 1 }, 2, clean)
    expect(carving.scooterCharge).toBeLessThan(clean.scooterCharge)
  })
})

describe('the air blast dash', () => {
  it('bursts the character along its heading', () => {
    const still = player()
    const dashed = groundStep(still, input({ dashPressed: true }), 1 / 60, flatGround, G)
    expect(Math.hypot(dashed.velocity.x, dashed.velocity.z)).toBeGreaterThan(G.runSpeed)
  })

  it('stops chaining after three and then recovers', () => {
    let s = player()
    let bursts = 0
    for (let i = 0; i < 6; i++) {
      const before = Math.hypot(s.velocity.x, s.velocity.z)
      s = groundStep(s, input({ dashPressed: true }), 1 / 60, flatGround, G)
      if (Math.hypot(s.velocity.x, s.velocity.z) > before + G.dashSpeed / 2) bursts++
    }
    // The literal three, not G.maxDashChain: comparing against the config the code
    // reads is a tautology that passes for any chain length.
    expect(bursts).toBe(3)
    expect(bursts).toBeLessThan(6)
  })
})

describe('the air-assisted run', () => {
  it('accelerates softly rather than snapping to speed', () => {
    const first = groundStep(player(), input({ forward: 1 }), 1 / 60, flatGround, G)
    expect(Math.hypot(first.velocity.x, first.velocity.z)).toBeLessThan(G.walkSpeed * 0.5)
  })

  it('slides on stops instead of halting dead', () => {
    let s = player()
    for (let t = 0; t < 2; t += 1 / 60) {
      s = groundStep(s, input({ forward: 1 }), 1 / 60, flatGround, G)
    }
    const released = groundStep(s, input({ forward: 0 }), 1 / 60, flatGround, G)
    expect(Math.hypot(released.velocity.x, released.velocity.z)).toBeGreaterThan(0)
  })
})
