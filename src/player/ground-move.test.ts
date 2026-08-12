import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { groundStep, desiredVelocity, easeHorizontal, horizontalForward } from './ground-move'
import { fallWithinBufferWindow } from './jump'
import { scooterTurnAuthority } from './scooter'
import { detectSlam, applyBounce } from './slam'
import { DEFAULT_GROUND_CONFIG as G, DEFAULT_COLLISION_CONFIG as COLLISION } from '../core/config'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { stillAir, type WindSample } from '../world/wind'
import type { InputState, PlayerState, TerrainQuery } from '../core/types'

/** Flat ground at y=0 everywhere, so movement can be reasoned about exactly. */
const flatGround: TerrainQuery = {
  groundHeightAt: () => 0,
  // Only answers downward casts. A fake that ignored `direction` would answer a
  // horizontal collision sweep with a hit on the ground below, so a movement test in a
  // flat fake world would start deflecting off phantom walls. The threshold is scaled by
  // the direction's length, not compared against the unit vector: `raycast` accepts an
  // unnormalised direction, and a fake that only recognised the unit down vector would
  // answer `null` to a mostly-downward sweep the real one answers.
  raycast: (from, direction, maxDistance) =>
    direction.y < -0.9 * direction.length() && from.y >= 0 && from.y - maxDistance <= 0
      ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
      : null,
}
const voidWorld: TerrainQuery = { groundHeightAt: () => null, raycast: () => null }

/**
 * Flat ground at y=0 with a vertical wall facing -X at x = 5. Downward casts see the
 * ground, everything else sees the wall.
 */
const groundAndWall: TerrainQuery = {
  groundHeightAt: () => 0,
  raycast: (from, direction, maxDistance) => {
    // Scaled by the direction's length, same reasoning as flatGround and step above:
    // `raycast` accepts an unnormalised direction, and a fake that only recognised the
    // unit down vector would answer `null` to a mostly-downward sweep the real one answers.
    if (direction.y < -0.9 * direction.length()) {
      return from.y >= 0 && from.y - maxDistance <= 0
        ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
        : null
    }
    if (direction.x <= 1e-9) return null
    const travel = (5 - from.x) / direction.x
    if (travel < 0) return null
    // `travel` above is a parametric multiple of the (unnormalised) direction vector, not
    // a real distance. `maxDistance`, per the real raycast contract in terrain-query.ts, is
    // a real Euclidean distance measured along the normalised direction -- resolveMovement
    // calls in here with an unnormalised delta, so comparing the raw parametric value
    // against maxDistance directly would silently miss the wall for exactly the approach
    // speeds this test uses. Scaling by the direction's length converts it to a real
    // distance first.
    if (travel * direction.length() > maxDistance) return null
    return {
      point: new Vector3(5, from.y + direction.y * travel, from.z + direction.z * travel),
      normal: new Vector3(-1, 0, 0),
      islandId: 'wall',
    }
  },
}

/**
 * Flat ground at y=0 for x < 0 and open void from x=0 on, so a walker heading +X steps off
 * a ledge at the origin. Only answers downward casts, with the threshold scaled by the
 * direction's length, for exactly the reasons flatGround's comment gives above:
 * `resolveMovement` calls in with a raw delta rather than a unit vector.
 */
const ledge: TerrainQuery = {
  groundHeightAt: (x) => (x < 0 ? 0 : null),
  raycast: (from, direction, maxDistance) =>
    direction.y < -0.9 * direction.length()
      && from.x < 0 && from.y >= 0 && from.y - maxDistance <= 0
      ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'ledge' }
      : null,
}

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false, scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false, vortexHeld: false, vortexReleased: false, slipstreamPressed: false, staffPressed: false, airWallHeld: false,
  ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', airJumpsUsed: 0, chargeTime: 0, coyoteTime: 0, jumpBuffer: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, slipstreamElapsed: null, slipstreamCooldown: 0, staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, tangled: 0, ...over,
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
    const s = groundStep(player(), input(), 1 / 60, flatGround, G, COLLISION)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 6)
  })

  it('jumps on release of a quick tap', () => {
    const tapped = groundStep(
      player(), input({ actionPressed: true, actionReleased: true }), 1 / 60, flatGround, G, COLLISION,
    )
    expect(tapped.velocity.y).toBe(G.jumpSpeed)
  })

  it('cannot jump while airborne once air jumps are spent', () => {
    const airborne = player({
      position: new Vector3(0, 50, 0), grounded: false, airJumpsUsed: G.maxAirJumps,
    })
    expect(groundStep(airborne, input({ actionPressed: true }), 1 / 60, voidWorld, G, COLLISION).velocity.y)
      .toBeLessThan(0)
  })

  it('falls when there is no ground below', () => {
    const s = groundStep(player({ grounded: false }), input(), 1 / 60, voidWorld, G, COLLISION)
    expect(s.grounded).toBe(false)
    expect(s.position.y).toBeLessThan(0)
  })

  it('records which island it is standing on', () => {
    expect(groundStep(player(), input(), 1 / 60, flatGround, G, COLLISION).lastGroundIslandId).toBe('flat')
  })

  it('does not mutate the state it is given', () => {
    const s = player()
    groundStep(s, input({ forward: 1 }), 1 / 60, flatGround, G, COLLISION)
    expect(s.position.toArray()).toEqual([0, 0, 0])
  })

  it('walking off an edge begins a fall', () => {
    const s = groundStep(player(), input({ forward: 1 }), 1 / 60, voidWorld, G, COLLISION)
    expect(s.grounded).toBe(false)
  })

  it('aims where the player is looking', () => {
    const s = groundStep(
      player(), input({ forward: 1, lookDirection: new Vector3(1, 0, 0) }), 1 / 60, flatGround, G, COLLISION,
    )
    expect(s.forward.x).toBeCloseTo(1, 5)
  })

  it('aims while standing still, because that is when a gust is thrown', () => {
    // The gust's cone is tested against player.forward, so a player who turns on the spot
    // and blasts must blast where they turned to. Velocity cannot supply this: it is zero
    // at exactly the moment the aim matters most.
    const s = groundStep(player(), input({ lookDirection: new Vector3(-1, 0, 0) }), 1 / 60, flatGround, G, COLLISION)
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
      input({ lookDirection: new Vector3(0, 1, -1).normalize() }), 1 / 60, flatGround, G, COLLISION,
    )
    expect(s.forward.y).toBe(0)
  })

  it('a jump rises then returns to the ground', () => {
    let s = groundStep(
      player(), input({ actionPressed: true, actionReleased: true }), 1 / 60, flatGround, G, COLLISION,
    )
    expect(s.velocity.y).toBeGreaterThan(0)
    let peak = s.position.y
    for (let i = 0; i < 200; i++) {
      s = groundStep(s, input(), 1 / 60, flatGround, G, COLLISION)
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
      player(), input({ actionPressed: true, actionReleased: true }), 1 / 60, flatGround, G, COLLISION,
    )
    let peak = 0
    for (let i = 0; i < 200; i++) {
      s = groundStep(s, input(), 1 / 60, flatGround, G, COLLISION)
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
    const s = groundStep(falling, input({ actionPressed: true }), 1 / 60, voidWorld, G, COLLISION)
    expect(s.velocity.y).toBe(G.airJumpSpeed)
    expect(s.airJumpsUsed).toBe(1)
  })

  it('a charged release jumps higher than a tap', () => {
    const charged = player({ chargeTime: G.chargeMaxSeconds })
    const s = groundStep(charged, input({ actionReleased: true }), 1 / 60, flatGround, G, COLLISION)
    expect(s.velocity.y).toBeGreaterThan(G.jumpSpeed)
  })

  it('walking is slowed while charging', () => {
    // Measured after the ease settles rather than on the first frame: ground speed
    // now chases the stick instead of snapping to it, so a single frame only ever
    // shows a fraction of the target.
    const settle = (over: Partial<InputState>, state = player()) => {
      let s = state
      for (let t = 0; t < 1.5; t += 1 / 60) {
        s = groundStep(s, input({ forward: 1, ...over }), 1 / 60, flatGround, G, COLLISION)
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
    const s = groundStep(aboutToLand, input(), 1 / 60, flatGround, G, COLLISION)
    expect(s.grounded).toBe(true)
    expect(s.airJumpsUsed).toBe(0)
  })

  it('does not snap to the ground while descending mid-jump', () => {
    // Descending, 1.0 m above ground: inside the old 1.2 m snap distance.
    const midFall = player({
      position: new Vector3(0, 1.0, 0), grounded: false, velocity: new Vector3(0, -3, 0),
    })
    const s = groundStep(midFall, input(), 1 / 60, flatGround, G, COLLISION)
    expect(s.grounded).toBe(false)
    expect(s.position.y).toBeGreaterThan(0.5)
  })

  it('still snaps down small drops while walking', () => {
    // Walking (grounded) with ground 0.5 m below: slope-stick must survive.
    const step: TerrainQuery = {
      groundHeightAt: () => -0.5,
      // Only answers downward casts, same reasoning as flatGround above, including the
      // length-scaled threshold for an unnormalised direction.
      raycast: (from, direction, maxDistance) =>
        direction.y < -0.9 * direction.length() && from.y >= -0.5 && from.y - maxDistance <= -0.5
          ? { point: new Vector3(from.x, -0.5, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
          : null,
    }
    const s = groundStep(player(), input({ forward: 1 }), 1 / 60, step, G, COLLISION)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(-0.5, 6)
  })

  it('an airborne body lands exactly on contact, not before', () => {
    // One frame at -20 m/s from 0.1 m up crosses the surface this frame.
    const aboutToLand = player({
      position: new Vector3(0, 0.1, 0), grounded: false, velocity: new Vector3(0, -20, 0),
    })
    const s = groundStep(aboutToLand, input(), 1 / 60, flatGround, G, COLLISION)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 6)
    expect(s.velocity.y).toBe(0)
  })
})

const DT = 1 / 60

describe('coyote time at a ledge', () => {
  // Measured, not derived: from 1.85 m back the charge-held walk below reaches the edge at
  // x=0 on frame 30, so the charge is exactly 0.5 s earned on solid rock by the time the
  // ground runs out -- which is the scenario the discriminating case needs. The distance is
  // not simply walkSpeed x chargeWalkFactor x 0.5: the walk starts at rest, eases up, and is
  // not slowed at all until chargeThresholdSeconds 0.2 has passed. The 0.05 m either side is
  // the tolerance, and the neighbouring distances are asserted rather than only claimed --
  // see 'the ledge distance is the frame-30 one' below.
  const LEDGE_DISTANCE = 1.85
  const walker = (from = LEDGE_DISTANCE) => player({ position: new Vector3(-from, 0, 0) })
  const east = (over: Partial<InputState> = {}) =>
    input({ forward: 1, lookDirection: new Vector3(1, 0, 0), ...over })

  /**
   * Walk east off the ledge, then act.
   *
   * Two passes over the same walk: the first finds the frame that leaves the ground, the
   * second replays it with the press and release scheduled against that frame. The schedule
   * cannot move the frame it is measured from -- a press below `chargeThresholdSeconds`
   * leaves `walkFactor` at 1, and everything scheduled after the edge is airborne.
   */
  const offTheLedge = (
    frameInput: (f: number, leaving: number) => InputState,
    c = G,
    lastFrame = (leaving: number) => leaving + 1,
    from = LEDGE_DISTANCE,
  ) => {
    let s = walker(from)
    let leaving = -1
    for (let f = 0; leaving < 0 && f < 600; f++) {
      s = groundStep(s, frameInput(f, Infinity), DT, ledge, c, COLLISION)
      if (!s.grounded) leaving = f
    }
    s = walker(from)
    let chargeAtRelease = 0
    for (let f = 0; f <= lastFrame(leaving); f++) {
      if (f === lastFrame(leaving)) chargeAtRelease = s.chargeTime
      s = groundStep(s, frameInput(f, leaving), DT, ledge, c, COLLISION)
    }
    return { state: s, leaving, chargeAtRelease }
  }

  /** Hold Space from a fresh press on frame 0, release `after` frames past the edge. */
  const heldOffLedge = (after: number, c = G, from = LEDGE_DISTANCE) =>
    offTheLedge(
      (f, leaving) => f === leaving + after
        ? east({ actionReleased: true })
        : east({ actionPressed: f === 0, actionHeld: true }),
      c,
      (leaving) => leaving + after,
      from,
    )

  /** Press on the last grounded frame, release `after` frames later, already airborne. */
  const pressedAtTheEdge = (after = 1, c = G) =>
    offTheLedge(
      (f, leaving) => f === leaving
        ? east({ actionPressed: true, actionHeld: true })
        : f === leaving + after ? east({ actionReleased: true })
        : f > leaving ? east({ actionHeld: true }) : east(),
      c,
      (leaving) => leaving + after,
    )

  /**
   * Press `delay` frames *after* the edge, already airborne, and release `hold` frames later.
   *
   * The distinction from `pressedAtTheEdge` above is the whole point: that one presses on the
   * last grounded frame, so the grounded branch sees the press and only the release reaches the
   * coyote branch. This one puts the press itself inside the window, which is the case the
   * feature is named for and the one nothing covered.
   */
  const pressedAfterTheEdge = (delay: number, hold = 1, c = G) =>
    offTheLedge(
      (f, leaving) => f === leaving + delay
        ? east({ actionPressed: true, actionHeld: true })
        : f === leaving + delay + hold ? east({ actionReleased: true })
        : f > leaving + delay ? east({ actionHeld: true }) : east(),
      c,
      (leaving) => leaving + delay + hold,
    )

  it('the ledge distance is the frame-30 one, with a frame of tolerance either side', () => {
    // The fixture comment's numbers, asserted rather than left as prose. If the mover's
    // easing or the charge threshold ever moves, the discriminating case below stops being
    // "0.5 s of charge earned on the ground" and this is what says so.
    const leavingFrom = (from: number) =>
      heldOffLedge(3, G, from).leaving
    expect(leavingFrom(1.8)).toBe(29)
    expect(leavingFrom(LEDGE_DISTANCE)).toBe(30)
    expect(leavingFrom(1.9)).toBe(31)
  })

  it('carries a charge earned on the ground off the ledge', () => {
    // The discriminating case. A tap would fire jumpSpeed 9 and an air jump 9 too, so only
    // a charged speed proves the charge itself survived the edge rather than being restarted
    // or discarded. Before this feature the same input produced gravity and nothing else.
    //
    // Measured against this exact code rather than predicted: 13.0333 m/s, off a walk that
    // leaves the ground on frame 30 with 0.55 s of charge at the release -- 0.5 s earned
    // while grounded plus the three airborne frames, which is releaseSpeed's
    // 9 + (20 - 9) x (0.55 / 1.5). The design doc's arithmetic agreed for once; the frame
    // count and the charge are asserted alongside the speed so a future change that reaches
    // the same speed by a different route cannot pass quietly.
    const r = heldOffLedge(3)
    expect(r.leaving).toBe(30)
    expect(r.chargeAtRelease).toBe(0.55)
    // The exact double, not a tolerance: this is a measurement, and a tolerance wide enough
    // to be comfortable is also wide enough to hide the difference between two tunings.
    expect(r.state.velocity.y).toBe(13.033333333333333)
    expect(r.state.airJumpsUsed).toBe(0)
  })

  it('a press on the last grounded frame still jumps one frame past the edge', () => {
    // config.ts records the pre-forgiveness measurement of exactly this input: -0.667 m/s,
    // one frame of gravity and nothing else, with the air jump not even spent. This is that
    // measurement inverted, at the same one-frame timing, so the comment cannot drift from
    // the behaviour. Asserted against jumpSpeed and airJumpsUsed together: airJumpSpeed is
    // also 9 at this tuning, so the speed alone would not tell the two apart.
    const r = pressedAtTheEdge()
    expect(r.state.velocity.y).toBe(G.jumpSpeed)
    expect(r.state.airJumpsUsed).toBe(0)
  })

  it('a press made after the edge is still a ground jump, with the air jump untouched', () => {
    // The case the coyote window exists for, walked through the real mover rather than asserted
    // on `stepJump` alone: the player is already off the ledge when they press, with the air
    // jump still in hand, and what comes out has to be the ground jump. Reordering `stepJump` so
    // the air-jump branch is consulted before the coyote branch left every one of the 1439 tests
    // green, because both jumps launch at 9 m/s at this tuning and only `airJumpsUsed` tells
    // them apart.
    //
    // A press inside the window fires nothing on its own -- it charges, like any grounded press,
    // and the release is what launches -- so both frames are asserted. Five is the last delay
    // whose release still lands inside the window; the sixth's release is the accepted edge.
    for (let delay = 1; delay <= 6; delay++) {
      const atPress = pressedAfterTheEdge(delay, 0)
      expect(atPress.state.velocity.y, `press ${delay} frames past the edge`).toBeLessThan(0)
      expect(atPress.state.airJumpsUsed, `press ${delay} frames past the edge`).toBe(0)
      expect(atPress.state.chargeTime, `press ${delay} frames past the edge`).toBe(DT)

      if (delay > 5) continue
      const released = pressedAfterTheEdge(delay)
      expect(released.state.velocity.y, `release ${delay + 1} frames past`).toBe(G.jumpSpeed)
      expect(released.state.airJumpsUsed, `release ${delay + 1} frames past`).toBe(0)
      expect(released.state.coyoteTime, `release ${delay + 1} frames past`).toBe(0)
    }
  })

  it('closes six frames past the edge and no later', () => {
    // The window's *extent*, not just its existence. Without this every test in the file
    // passes at any coyoteSeconds above zero: measured, the suite as it stood before this test
    // was green at 0.05, 0.5 and even 1.0 seconds, and a full second is effectively unlimited
    // free ground jumps off every surface.
    //
    // Six frames past the edge, which is the nominal 0.1 s / (1/60) even though the frame that
    // leaves the ground already spends one decay of its own. The two cancel: the sixth decay
    // leaves the same positive floating-point residue the buffer table's fifth row rests on,
    // so the sixth frame past the edge is still inside and the seventh is the first out.
    //
    // Released as a tap either way: seven frames of hold is 0.1167 s, still short of
    // chargeThresholdSeconds 0.2, so the speed is jumpSpeed exactly and not a partial charge.
    const inside = pressedAtTheEdge(6)
    expect(inside.state.velocity.y).toBe(G.jumpSpeed)
    expect(inside.state.airJumpsUsed).toBe(0)

    const outside = pressedAtTheEdge(7)
    expect(outside.state.velocity.y).toBeLessThan(0)
    // Not merely "no ground jump": the release must fall through every branch rather than
    // being answered by the air jump, which would also fail the assertion above but for the
    // wrong reason.
    expect(outside.state.airJumpsUsed).toBe(0)
  })

  it('a normal ground jump zeroes the window on the frame it fires', () => {
    // The rule the third-jump case rests on, checked directly rather than through its
    // consequence: that case would also pass if the air jump were what had run out.
    //
    // Starts from a state that has actually stood on the ground for a frame, and asserts the
    // full window first. Jumping straight out of the bare fixture, whose coyoteTime is 0,
    // makes this assertion vacuous -- and measurably so: with the zeroing dropped from
    // groundStep the whole suite stayed green until this test began from a standing frame.
    const standing = groundStep(player(), input(), DT, flatGround, G, COLLISION)
    expect(standing.coyoteTime).toBe(G.coyoteSeconds)
    const s = groundStep(
      standing, input({ actionPressed: true, actionReleased: true }), DT, flatGround, G, COLLISION,
    )
    expect(s.velocity.y).toBe(G.jumpSpeed)
    expect(s.coyoteTime).toBe(0)
  })

  it('does not grant a third jump', () => {
    // Ground jump, air jump, then a third press. Asserted on the speed being negative
    // rather than merely unequal to jumpSpeed: a third jump of any kind arrests the fall,
    // and that is the observable the player would feel.
    //
    // The window starts full, because that is what standing on the ground leaves it at -- see
    // the pinning assertion in the test above. Starting from the fixture's zero would be the
    // one starting state in which this bug cannot appear.
    const tap = input({ actionPressed: true, actionReleased: true })
    let s = groundStep(player({ coyoteTime: G.coyoteSeconds }), tap, DT, voidWorld, G, COLLISION)
    expect(s.velocity.y).toBe(G.jumpSpeed)
    s = groundStep(s, tap, DT, voidWorld, G, COLLISION)
    // The second jump must be the air jump, spending the reserve. If the window were still
    // open it would be a second *ground* jump instead, at the same speed but free -- which is
    // what leaves a third one in hand.
    expect(s.airJumpsUsed).toBe(1)
    for (let f = 0; f < 60; f++) s = groundStep(s, input(), DT, voidWorld, G, COLLISION)
    const third = groundStep(s, tap, DT, voidWorld, G, COLLISION)
    expect(third.velocity.y).toBeLessThan(0)
  })

  it('landing re-arms the window, so forgiveness is not once per life', () => {
    const standing = groundStep(player(), input(), DT, flatGround, G, COLLISION)
    let s = groundStep(
      standing, input({ actionPressed: true, actionReleased: true }), DT, flatGround, G, COLLISION,
    )
    expect(s.coyoteTime).toBe(0)
    for (let f = 0; f < 200; f++) s = groundStep(s, input(), DT, flatGround, G, COLLISION)
    expect(s.grounded).toBe(true)
    expect(s.coyoteTime).toBe(G.coyoteSeconds)
  })

  it('still works with the buffer window switched off', () => {
    // Half of the independence claim the "no validator" decision rests on: a zero window
    // disables its own piece of forgiveness and nothing else.
    const r = heldOffLedge(3, { ...G, jumpBufferSeconds: 0 })
    expect(r.state.velocity.y).toBe(13.033333333333333)
  })
})

describe('the jump buffer across a landing', () => {
  /**
   * Fall onto flat ground with the air jump already spent, pressing Space `framesEarly`
   * frames before touchdown and releasing it the frame after. Returns the vertical speed on
   * the frame after touchdown, which is the earliest a buffered press can be honoured:
   * `stepJump` runs before the ground probe, so touchdown's own frame still sees an
   * airborne state.
   *
   * Two passes, as at the ledge above: the first finds the touchdown frame, the second
   * replays the identical fall with the press scheduled against it. Nothing fires in the
   * air here, so the press cannot move the touchdown it is measured from.
   */
  const buffered = (framesEarly: number, c = G) => {
    const start = () => player({
      position: new Vector3(0, 3, 0), grounded: false, velocity: new Vector3(0, -10, 0),
      airJumpsUsed: c.maxAirJumps, coyoteTime: 0,
    })
    let s = start()
    let touchdown = -1
    for (let f = 0; touchdown < 0 && f < 600; f++) {
      s = groundStep(s, input(), DT, flatGround, c, COLLISION)
      if (s.grounded) touchdown = f
    }
    s = start()
    for (let f = 0; f <= touchdown + 1; f++) {
      const press = f === touchdown - framesEarly
      s = groundStep(s, input({
        actionPressed: press,
        actionHeld: press,
        actionReleased: f === touchdown - framesEarly + 1,
      }), DT, flatGround, c, COLLISION)
    }
    return s.velocity.y
  }

  it('honours a press made shortly before touchdown, up to the window and no further', () => {
    // A table rather than one timing, so a fix that works at 1 frame and not at 8 cannot
    // pass, and so the edge of the window is pinned next to the inside of it.
    //
    // config.ts records 1, 2, 3, 5 and 8 frames before touchdown as all producing nothing on
    // landing before this feature existed. Four of those five now jump. The eighth-frame case
    // does not, and cannot: 8 frames is 133 ms against a jumpBufferSeconds of 100 ms, so it
    // is outside the window by arithmetic rather than by defect. The design doc expected all
    // five to jump, which is the doc being wrong -- these are measurements, and 6, 7 and 8 are
    // included precisely so the boundary is asserted rather than assumed.
    //
    // Why 5 is the last one in and not 6: the countdown starts on the frame the press is made,
    // so a press 5 frames before touchdown has been decayed 6 times by the time a grounded
    // frame reads it, and six decays of 1/60 leave a positive residue rather than 0 --
    // floating-point, which is genuinely what carries the fifth frame over the line. Asserted
    // below rather than claimed here, in the arithmetic the decay itself performs.
    let residue = G.jumpBufferSeconds
    for (let d = 0; d < 6; d++) residue = Math.max(0, residue - DT)
    expect(residue).toBeGreaterThan(0)
    expect(residue).toBeLessThan(1e-16)
    // And the seventh decay is what actually closes it, rather than the sixth landing on zero.
    expect(Math.max(0, residue - DT)).toBe(0)
    const rows: Array<readonly [number, number]> = [
      [1, G.jumpSpeed], [2, G.jumpSpeed], [3, G.jumpSpeed], [4, G.jumpSpeed], [5, G.jumpSpeed],
      [6, 0], [7, 0], [8, 0],
    ]
    for (const [frames, speed] of rows) {
      expect(buffered(frames), `${frames} frames before touchdown`).toBe(speed)
    }
  })

  it('discards a press made well before the window', () => {
    // 12 frames is 0.2 s, twice jumpBufferSeconds. Without this the buffer could be
    // unbounded and every timing above would still pass. Zero rather than "not jumpSpeed":
    // a body that landed and did not jump is snapped, its vertical speed cleared.
    expect(buffered(12)).toBe(0)
  })

  it('still works with the coyote window switched off', () => {
    // The other half of the independence claim.
    expect(buffered(2, { ...G, coyoteSeconds: 0 })).toBe(G.jumpSpeed)
  })
})

describe('fallWithinBufferWindow', () => {
  /**
   * Fall for one buffer window in the void and report how far the body actually moved.
   *
   * A real integration rather than the formula written out a second time: the whole point of
   * the predicate is that it agrees with what `groundStep` does, and a test that recomputed
   * the closed form and compared it to itself would agree no matter how either changed.
   */
  const simulatedFall = (velocityY: number, c = G) => {
    const frames = Math.round(c.jumpBufferSeconds / DT)
    expect(frames).toBe(6)
    let s = player({
      position: new Vector3(0, 100, 0), grounded: false,
      velocity: new Vector3(0, velocityY, 0), airJumpsUsed: c.maxAirJumps,
    })
    const from = s.position.y
    for (let f = 0; f < frames; f++) s = groundStep(s, input(), DT, voidWorld, c, COLLISION)
    return from - s.position.y
  }

  it('predicts a real fall, slightly short of it, over every descent speed', () => {
    // Slightly short and never over, which is the property the deploy gate depends on: ground
    // the gate reports as reachable inside the window really is reached inside it, so a press
    // the deploy yields to always finds a landing while the buffer is still live rather than
    // falling into a gap between the two rules.
    //
    // The shortfall is exactly half a frame of gravity times the window -- `groundStep`
    // integrates semi-implicitly, adding each frame's whole gravity increment before it
    // moves, and the closed form assumes gravity acts smoothly across the frame instead.
    // Asserted as that expression rather than as a number, because the identity is the reason
    // the sign of the error is stable across speeds rather than a coincidence at one of them.
    const halfStep = 0.5 * G.gravity * DT * G.jumpBufferSeconds
    expect(halfStep).toBeCloseTo(0.016666666666666666, 15)
    for (const velocityY of [-5, -10, -20, -40]) {
      const predicted = fallWithinBufferWindow(velocityY, G)
      const simulated = simulatedFall(velocityY)
      expect(simulated - predicted, `${velocityY} m/s`).toBeCloseTo(halfStep, 12)
      expect(predicted, `${velocityY} m/s`).toBeLessThan(simulated)
      // And close enough to be the same answer about where the ground is.
      expect(predicted / simulated, `${velocityY} m/s`).toBeGreaterThan(0.97)
    }
    // The worst of the four, since the shortfall is fixed and so weighs most against the
    // shortest fall: 2.7% at 5 m/s of descent, which is 3 cm.
    expect(fallWithinBufferWindow(-5, G) / simulatedFall(-5)).toBeCloseTo(0.973, 3)
    expect(simulatedFall(-5) - fallWithinBufferWindow(-5, G)).toBeCloseTo(0.0167, 4)
  })

  it('measures the shipped window at ten metres a second', () => {
    // The one absolute figure, so a config change to gravity or the window has to be
    // acknowledged here rather than passing silently through the ratios above.
    expect(fallWithinBufferWindow(-10, G)).toBe(1.1)
    expect(simulatedFall(-10)).toBeCloseTo(1.1166666666666667, 12)
  })

  it('reports no reach while rising, so a bounce can still open its wings', () => {
    expect(fallWithinBufferWindow(15.45, G)).toBe(0)
    expect(fallWithinBufferWindow(0, G)).toBe(0)
  })

  it('reports no reach with the buffer switched off, so the deploy is left as it was', () => {
    // The safe-degradation claim, extended to this rule: zeroing jumpBufferSeconds disables
    // the buffer, and the deploy stops yielding to it in the same stroke.
    expect(fallWithinBufferWindow(-10, { ...G, jumpBufferSeconds: 0 })).toBe(0)
  })
})

describe('a slam bounce out of the coyote window', () => {
  const PW = DEFAULT_COMBAT_CONFIG.pressureWave

  /** Dive onto flat ground with the commit key held, then bounce out of the slam. */
  const bounce = () => {
    let s = player({
      position: new Vector3(0, 30, 0), grounded: false, airJumpsUsed: G.maxAirJumps,
    })
    let before = s
    for (let f = 0; f < 600; f++) {
      before = s
      s = groundStep(s, input({ tuck: true }), DT, flatGround, G, COLLISION)
      if (s.grounded) break
    }
    const slam = detectSlam(before, s, true, false, PW)
    expect(slam).not.toBeNull()
    return { landed: s, slam: slam!, bounced: applyBounce(s, slam!, PW) }
  }

  /** Fly the bounce out to its peak, optionally tapping Space on frame `tapAt`. */
  const flyOut = (tapAt: number | null) => {
    let s = bounce().bounced
    let peak = s.position.y
    let speedAfterTap = NaN
    let airJumpsUsed = 0
    for (let f = 0; f < 400; f++) {
      const tap = f === tapAt
      s = groundStep(
        s, tap ? input({ actionPressed: true, actionReleased: true }) : input(),
        DT, flatGround, G, COLLISION,
      )
      if (tap) {
        speedAfterTap = s.velocity.y
        airJumpsUsed = s.airJumpsUsed
      }
      peak = Math.max(peak, s.position.y)
      if (f > 0 && s.grounded) break
    }
    return { peak, speedAfterTap, airJumpsUsed }
  }

  it('reads a full window off the landing frame, which is why the bounce has to clear it', () => {
    // The setup for everything below, and the reason this is a regression rather than a
    // curiosity: a slam is detected on a grounded frame, and groundStep pins the window full
    // on every grounded frame. So the state applyBounce is handed always has an open window,
    // with no timing coincidence required.
    const b = bounce()
    expect(b.landed.coyoteTime).toBe(G.coyoteSeconds)
    expect(b.slam.impactSpeed).toBe(34.3333333333333)
    expect(b.bounced.velocity.y).toBe(15.449999999999985)
    expect(b.bounced.grounded).toBe(false)
    expect(b.bounced.coyoteTime).toBe(0)
  })

  it('bounces to its own peak, and a tap out of it buys height rather than losing it', () => {
    // The visible symptom, pinned as height rather than velocity. Measured with the window
    // carried into the bounce: a tap on any of the six frames after it fired a *ground* jump
    // that overrode the bounce, 15.450 m/s becoming 9.000, and the peak falling from 5.839 m
    // to 2.100 m -- worse than pressing nothing at all, and worse than the 18.270 m/s air jump
    // the same tap bought before this cycle existed. On the combo the design doc calls §4.3's,
    // with no coincidence needed.
    //
    // Exact doubles rather than rounded tolerances, for the reason given at the carry above: a
    // tolerance comfortable enough to write is also wide enough to hide a tuning change. The
    // peaks are heights above the surface, which is y=0 in this fake -- worth saying because
    // the same measurement taken on the real archipelago reads about 8.7 m larger, that being
    // the island's own ground height in absolute world y.
    const untapped = flyOut(null)
    expect(untapped.peak).toBe(5.839444444444426)

    const immediate = flyOut(0)
    expect(immediate.speedAfterTap).toBe(18.26999999999999)
    expect(immediate.airJumpsUsed).toBe(1)
    expect(immediate.peak).toBe(8.497499999999983)

    // The whole span across the old window's edge, because the shape of the bug was a cliff:
    // frames 0-6 lost height and frame 7, where the window closed, did not. A monotone series
    // that never dips below the untapped bounce is the same claim without a magic frame in it.
    let previous = 0
    for (let f = 0; f <= 8; f++) {
      const { peak } = flyOut(f)
      expect(peak, `tap at frame ${f}`).toBeGreaterThan(untapped.peak)
      expect(peak, `tap at frame ${f}`).toBeGreaterThan(previous)
      previous = peak
    }
  })
})

describe('the air scooter on the ground', () => {
  const settle = (over: Partial<InputState>, seconds = 2, from = player()) => {
    let s = from
    for (let t = 0; t < seconds; t += 1 / 60) {
      s = groundStep(s, input({ forward: 1, ...over }), 1 / 60, flatGround, G, COLLISION)
    }
    return s
  }

  /** Toggle the scooter on exactly once, then hold a line. */
  const mount = () =>
    groundStep(player(), input({ forward: 1, scooterPressed: true }), 1 / 60, flatGround, G, COLLISION)

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

describe('the scooter trades turning for speed', () => {
  /** Seconds for velocity to come within 0.05 rad of a 90-degree change of desired heading. */
  const turnTime = (authority: number) => {
    const north = input({ forward: 1, sprint: true, lookDirection: new Vector3(0, 0, -1) })
    const east = input({ forward: 1, sprint: true, lookDirection: new Vector3(1, 0, 0) })
    let v = desiredVelocity(north, G)
    const target = desiredVelocity(east, G)
    for (let frame = 0; frame < 1200; frame++) {
      if (v.angleTo(target) < 0.05) return frame / 60
      v = easeHorizontal(v, target, 1 / 60, G, authority)
    }
    return Infinity
  }

  // Measured by running this exact helper against this exact code, after moving authority
  // from the strafe axis to the easing rate (step 4 of the task-1 brief): 0.45 s on foot
  // (authority 1, unchanged), 0.8833 s at charge 0 (rounded from 53/60 s exactly; authority
  // 0.5, i.e. scooterTurnFactor with no charge spent), and 1.75 s at charge 1 (exact;
  // authority 0.25, i.e. scooterTurnFactor 0.5 minus scooterChargeTurnPenalty 0.25). The
  // spec's back-of-envelope guess of roughly 0.9 s and 1.8 s was close.
  it('turns slower on a scooter than on foot', () => {
    // The measurement that made this a defect: before the fix these were 0.45, 0.45 and
    // 0.45 -- identical -- because authority scaled the strafe axis, which the camera-
    // relative heading barely uses, instead of the easing rate that actually turns you.
    expect(turnTime(scooterTurnAuthority(0, G))).toBeGreaterThan(turnTime(1) * 1.5)
    // The exact figure from the comment above, pinned so it cannot drift from the code
    // unnoticed the way it did the first time this was measured: the comment originally
    // read 0.767 s here, wrong by a full frame count, and it took a reviewer plus an
    // independent run to catch it.
    expect(turnTime(scooterTurnAuthority(0, G))).toBeCloseTo(53 / 60, 3)
  })

  it('turns slower still as the accumulator fills', () => {
    expect(turnTime(scooterTurnAuthority(1, G)))
      .toBeGreaterThan(turnTime(scooterTurnAuthority(0, G)))
    // Same self-enforcement as above: the comment claimed 1.633 s originally, also wrong.
    expect(turnTime(scooterTurnAuthority(1, G))).toBeCloseTo(7 / 4, 3)
  })

  it('leaves an on-foot turn exactly as it was', () => {
    // authority defaults to 1, so nothing off a scooter changes. If this moves, the fix
    // has leaked into ordinary running.
    expect(turnTime(1)).toBeCloseTo(0.45, 2)
  })
})

describe('the air blast dash', () => {
  it('bursts the character along its heading', () => {
    const still = player()
    const dashed = groundStep(still, input({ dashPressed: true }), 1 / 60, flatGround, G, COLLISION)
    expect(Math.hypot(dashed.velocity.x, dashed.velocity.z)).toBeGreaterThan(G.runSpeed)
  })

  it('stops chaining after three and then recovers', () => {
    let s = player()
    let bursts = 0
    for (let i = 0; i < 6; i++) {
      const before = Math.hypot(s.velocity.x, s.velocity.z)
      s = groundStep(s, input({ dashPressed: true }), 1 / 60, flatGround, G, COLLISION)
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
    const first = groundStep(player(), input({ forward: 1 }), 1 / 60, flatGround, G, COLLISION)
    expect(Math.hypot(first.velocity.x, first.velocity.z)).toBeLessThan(G.walkSpeed * 0.5)
  })

  it('slides on stops instead of halting dead', () => {
    let s = player()
    for (let t = 0; t < 2; t += 1 / 60) {
      s = groundStep(s, input({ forward: 1 }), 1 / 60, flatGround, G, COLLISION)
    }
    const released = groundStep(s, input({ forward: 0 }), 1 / 60, flatGround, G, COLLISION)
    expect(Math.hypot(released.velocity.x, released.velocity.z)).toBeGreaterThan(0)
  })
})

describe('the air acts on a body that is off the ground', () => {
  const UPDRAFT = { accel: new Vector3(0, 500, 0), liftScale: 1 }
  const RIVER = { accel: new Vector3(120, 0, 0), liftScale: 1 }
  /** Both an updraft and a river at once, so bracing has to hold on both axes at once. */
  const GALE = { accel: new Vector3(120, 500, 0), liftScale: 1 }

  /** One second of falling from y 200 over the void, with and without the air. */
  const fallTo = (wind: WindSample) => {
    let s = player({ position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3() })
    for (let frame = 0; frame < 60; frame++) {
      s = groundStep(s, input(), 1 / 60, voidWorld, G, COLLISION, wind)
    }
    return s.position
  }

  it('lifts a falling player in an updraft', () => {
    // Measured before this change: still air and a 500 m/s^2 updraft both put the player
    // at y 189.8 after a second -- indistinguishable, because groundStep never saw the
    // air at all. Compared against the still-air control rather than against a bound,
    // so the assertion cannot be satisfied by the broken behaviour.
    //
    // Measured after this change, against this exact code: still air lands at y
    // 189.8333 (unchanged), and the 500 m/s^2 updraft carries the player up to y 444
    // instead of down. Both are pinned so neither figure can drift unnoticed.
    expect(fallTo(stillAir()).y).toBeCloseTo(189.8333, 4)
    expect(fallTo(UPDRAFT).y).toBeCloseTo(444, 4)
    expect(fallTo(UPDRAFT).y).toBeGreaterThan(fallTo(stillAir()).y)
  })

  it('carries a falling player along a river', () => {
    // Measured against this exact code: a second of falling through a 120 m/s^2
    // horizontal river carries the player to x 15.7183, against x 0 in still air.
    expect(fallTo(stillAir()).x).toBeCloseTo(0, 4)
    expect(fallTo(RIVER).x).toBeCloseTo(15.7183, 4)
    expect(fallTo(RIVER).x).toBeGreaterThan(fallTo(stillAir()).x)
  })

  it('leaves a grounded player braced against it', () => {
    // The airborne limit. A player standing on rock is braced, and pushing them would also
    // fight the ground snap, which owns vertical placement for a grounded body.
    //
    // Uses GALE rather than the vertical-only UPDRAFT: UPDRAFT's horizontal accel is zero,
    // so a guard that dropped only the horizontal half of the airborne check (leaving the
    // vertical half intact) would still pass an x-only wind test -- and it would still leave
    // a grounded player sliding sideways through a level's river with no key held. Asserting
    // both axes against a wind that has both components is what actually exercises that.
    const grounded = () => {
      let s = player({ position: new Vector3(0, 0, 0), grounded: true })
      for (let frame = 0; frame < 60; frame++) {
        s = groundStep(s, input(), 1 / 60, flatGround, G, COLLISION, GALE)
      }
      return s.position
    }
    expect(grounded().x).toBeCloseTo(0, 6)
    expect(grounded().y).toBeCloseTo(0, 6)
  })

  it('does not let dead air zero out the whole vertical velocity, only a wing\'s own lift', () => {
    // Dead air is defined as a volume where a wing stops working, not one where gravity
    // changes. So it must do nothing at all on foot.
    //
    // Scope note: this catches liftScale being applied to the whole settled velocityY (as it
    // would be if someone copied the glider's pattern of scaling its lift term wholesale).
    // It does NOT catch liftScale multiplying only the wind's own contribution
    // (`wind.accel.y * dt * wind.liftScale`) while leaving gravity's term alone, because
    // `dead.accel` is the zero vector here and 0 times any liftScale is still 0. See the
    // task-1 report for the neutralisation that exposed this gap.
    const dead = { accel: new Vector3(), liftScale: 0 }
    expect(fallTo(dead).toArray()).toEqual(fallTo(stillAir()).toArray())
  })

  it('defaults to still air when no sample is given', () => {
    let withDefault = player({ position: new Vector3(0, 200, 0), grounded: false })
    let explicit = player({ position: new Vector3(0, 200, 0), grounded: false })
    for (let frame = 0; frame < 60; frame++) {
      withDefault = groundStep(withDefault, input(), 1 / 60, voidWorld, G, COLLISION)
      explicit = groundStep(explicit, input(), 1 / 60, voidWorld, G, COLLISION, stillAir())
    }
    expect(withDefault.position.toArray()).toEqual(explicit.position.toArray())
  })
})

describe('walking into a wall', () => {
  it('does not pass through it', () => {
    let s = player()
    for (let frame = 0; frame < 300; frame++) {
      s = groundStep(
        s, input({ forward: 1, lookDirection: new Vector3(1, 0, 0), sprint: true }),
        1 / 60, groundAndWall, G, COLLISION,
      )
    }
    expect(s.position.x).toBeLessThan(5)
  })

  it('still slides along it rather than sticking', () => {
    // Running into a corner-ward wall at 45 degrees should carry on down the wall.
    let s = player()
    for (let frame = 0; frame < 120; frame++) {
      s = groundStep(
        s, input({ forward: 1, lookDirection: new Vector3(1, 0, 1).normalize(), sprint: true }),
        1 / 60, groundAndWall, G, COLLISION,
      )
    }
    expect(s.position.x).toBeLessThan(5)
    expect(s.position.z).toBeGreaterThan(5)
  })

  it('stays grounded while sliding along it', () => {
    // The deflection must not fight the ground snap. It adjusts only y, and only for a
    // player already grounded or descending onto a surface, so the two compose -- but
    // that is an argument, and this is the test of it. `grounded` and `y` alone hold on
    // open flat ground too, with no wall involved at all, so a mere `position.x < 5` here
    // would only duplicate the non-penetration check the first test already makes. What
    // this test is actually about is *contact*: walking straight into the wall settles the
    // body exactly at `5 - COLLISION.radius` (measured: by frame 30 of 120, and it holds
    // there, velocity zeroed, for the rest of the run) -- which is the one value a walker
    // that never reached the wall could not produce.
    let s = player()
    for (let frame = 0; frame < 120; frame++) {
      s = groundStep(
        s, input({ forward: 1, lookDirection: new Vector3(1, 0, 0), sprint: true }),
        1 / 60, groundAndWall, G, COLLISION,
      )
    }
    expect(s.position.x).toBeCloseTo(5 - COLLISION.radius, 6)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 6)
  })

  it('leaves a walker with no wall near them exactly where they were', () => {
    let withWall = player()
    let without = player()
    for (let frame = 0; frame < 60; frame++) {
      const i = input({ forward: 1, lookDirection: new Vector3(-1, 0, 0), sprint: true })
      withWall = groundStep(withWall, i, 1 / 60, groundAndWall, G, COLLISION)
      without = groundStep(without, i, 1 / 60, flatGround, G, COLLISION)
    }
    expect(withWall.position.toArray()).toEqual(without.position.toArray())
  })
})
