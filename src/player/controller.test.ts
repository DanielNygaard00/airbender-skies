import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { controllerStep, respawn, staffStep, type ControllerDeps } from './controller'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG,
} from '../core/config'
import { fallWithinBufferWindow } from './jump'
import { isSwinging, staffBusy, staffOf } from './staff'
import { stillAir } from '../world/wind'
import type { InputState, PlayerState, TerrainQuery } from '../core/types'

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
 * Flat ground at y=0 that reports the surface normal it is given, so a test can ask what the
 * deploy gate does about steepness without needing a real island's rim.
 *
 * The normal is built as `(0, normalY, sqrt(1 - normalY^2))` and deliberately left
 * un-normalised: that expression is already unit to within a float ulp, and running
 * `normalize()` over it would perturb `normal.y` off the exact value the test is about --
 * 0.5, the `wallNormalY` threshold itself, comes back as 0.5000000000000001.
 */
const groundTiltedBy = (normalY: number): TerrainQuery => ({
  groundHeightAt: () => 0,
  raycast: (from, direction, maxDistance) =>
    direction.y < -0.9 * direction.length() && from.y >= 0 && from.y - maxDistance <= 0
      ? {
        point: new Vector3(from.x, 0, from.z),
        normal: new Vector3(0, normalY, Math.sqrt(1 - normalY * normalY)),
        islandId: 'tilted',
      }
      : null,
})

/**
 * Flat ground at y=0 with a vertical wall facing -X at x = 20. The wall answers only
 * non-downward casts, so the landing probe still sees ground and the collision sweep
 * still sees the wall.
 */
const groundAndWall: TerrainQuery = {
  groundHeightAt: () => 0,
  raycast: (from, direction, maxDistance) => {
    if (direction.y < -0.9 * direction.length()) {
      return from.y >= 0 && from.y - maxDistance <= 0
        ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
        : null
    }
    if (direction.x <= 1e-9) return null
    const travel = (20 - from.x) / direction.x
    if (travel < 0) return null
    // `travel` above is a parametric multiple of the (unnormalised) direction vector, not
    // a real distance. `maxDistance`, per the real raycast contract in terrain-query.ts, is
    // a real Euclidean distance measured along the normalised direction -- resolveMovement
    // calls in here with an unnormalised delta, so comparing the raw parametric value
    // against maxDistance directly only happens to work while that delta is unit length.
    // Scaling by the direction's length converts it to a real distance first.
    if (travel * direction.length() > maxDistance) return null
    return {
      point: new Vector3(20, from.y + direction.y * travel, from.z + direction.z * travel),
      normal: new Vector3(-1, 0, 0),
      islandId: 'wall',
    }
  },
}

const deps = (
  terrain: TerrainQuery,
  spawnPointFor?: (id: string | null) => Vector3,
): ControllerDeps => ({
  terrain,
  flight: DEFAULT_FLIGHT_CONFIG,
  ground: DEFAULT_GROUND_CONFIG,
  worldFloorY: -600,
  spawnPointFor:
    spawnPointFor ?? ((id) => (id === 'flat' ? new Vector3(0, 0, 0) : new Vector3(1, 1, 1))),
  slipstream: DEFAULT_SLIPSTREAM_CONFIG,
  staff: DEFAULT_STAFF_CONFIG,
  collision: DEFAULT_COLLISION_CONFIG,
})

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false, scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false, vortexHeld: false, vortexReleased: false, slipstreamPressed: false, staffPressed: false, airWallHeld: false,
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
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, tangled: 0, ...over,
})

describe('mode switching', () => {
  it('pressing action while grounded jumps rather than deploying', () => {
    const s = controllerStep(player(), input({ actionPressed: true, actionReleased: true }), 1 / 60, deps(flatGround))
    expect(s.mode).toBe('ground')
    expect(s.velocity.y).toBeGreaterThan(0)
  })

  it('pressing action mid-fall with the air jump spent deploys the glider', () => {
    const falling = player({
      position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, -12, 0), airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    })
    expect(controllerStep(falling, input({ actionPressed: true }), 1 / 60, deps(voidWorld)).mode)
      .toBe('glider')
  })

  it('deploying points the glider where the player is looking', () => {
    const falling = player({
      position: new Vector3(0, 200, 0), grounded: false,
      airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    })
    const s = controllerStep(
      falling, input({ actionPressed: true, lookDirection: new Vector3(1, 0, 0) }),
      1 / 60, deps(voidWorld),
    )
    expect(s.forward.x).toBeCloseTo(1, 5)
  })

  it('deploying the glider drops a buffered jump press', () => {
    // The buffer's countdown lives in groundStep, which does not run in glider mode, so a
    // buffer carried across the deploy is frozen for the whole glide -- see the next test,
    // which pins the freeze. Carried, it stops being 0.1 s of memory and becomes 0.1 s of
    // ground-mode time spread over an unbounded stretch of wall clock: stow the glider, touch
    // down within a few frames, and a press from before a minute-long glide fires a jump.
    const falling = player({
      position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3(0, -12, 0),
      airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
      jumpBuffer: DEFAULT_GROUND_CONFIG.jumpBufferSeconds,
    })
    const s = controllerStep(falling, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
    expect(s.mode).toBe('glider')
    expect(s.jumpBuffer).toBe(0)
  })

  it('deploying the glider drops the coyote window too, even with no air jump to spend', () => {
    // At the shipped tuning this cannot be reached, and that was the old argument for leaving
    // the window alone here: deploying requires the air jump to be spent, and spending it
    // zeroes the window. The argument holds at maxAirJumps 1 and fails at 0, where canAirJump
    // is never satisfied and the gate opens to a player who has simply walked off a ledge. So
    // this test runs at 0 -- the natural "off" value for the field, which is supposed to
    // degrade safely rather than open a hole. Asserting it at the default would be vacuous,
    // which is exactly why the invariant went unguarded.
    const noAirJumps = { ...DEFAULT_GROUND_CONFIG, maxAirJumps: 0 }
    const D = { ...deps(voidWorld), ground: noAirJumps }
    // Walked off a ledge with Space pressed: airborne, window full, one frame of charge live.
    const offTheLedge = player({
      position: new Vector3(0, 500, 0), grounded: false,
      coyoteTime: noAirJumps.coyoteSeconds, chargeTime: 1 / 60,
    })

    const deployed = controllerStep(offTheLedge, input({ actionPressed: true }), 1 / 60, D)
    expect(deployed.mode).toBe('glider')
    expect(deployed.coyoteTime).toBe(0)

    // And the symptom end to end, since the freeze makes the window outlive any glide: two
    // seconds of gliding, stow, release. Measured before the fix, at this config: 9.000 m/s
    // with the air jump untouched -- a ground jump two seconds after the edge.
    let s = deployed
    for (let f = 0; f < 120; f++) s = controllerStep(s, input(), 1 / 60, D)
    const stowed = controllerStep(s, input({ actionPressed: true }), 1 / 60, D)
    expect(stowed.mode).toBe('ground')
    expect(stowed.grounded).toBe(false)
    const released = controllerStep(stowed, input({ actionReleased: true }), 1 / 60, D)
    expect(released.velocity.y).not.toBe(DEFAULT_GROUND_CONFIG.jumpSpeed)
    expect(released.velocity.y).toBeLessThan(0)
    expect(released.airJumpsUsed).toBe(0)
  })

  it('does not advance a buffered press while gliding, which is why the deploy drops it', () => {
    // The mechanism behind the test above, asserted rather than argued: nothing in the glider
    // branch touches either forgiveness counter, so whatever enters glider mode stays exactly
    // as it was for as long as the glide lasts. That is what makes clearing the buffer at the
    // entrance the fix rather than clearing it at the stow -- and the two seconds below would
    // have been eight frames of it, had anything been counting.
    const gliding = player({
      mode: 'glider', position: new Vector3(0, 300, 0), grounded: false,
      velocity: new Vector3(0, 0, -20), jumpBuffer: 0.07, coyoteTime: 0.03,
    })
    let s = gliding
    for (let f = 0; f < 120; f++) s = controllerStep(s, input(), 1 / 60, deps(voidWorld))
    expect(s.mode).toBe('glider')
    expect(s.jumpBuffer).toBe(0.07)
    expect(s.coyoteTime).toBe(0.03)
  })

  it('pressing action in the air while flying stows the glider', () => {
    const flying = player({
      mode: 'glider', position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, 0, -20),
    })
    expect(controllerStep(flying, input({ actionPressed: true }), 1 / 60, deps(voidWorld)).mode)
      .toBe('ground')
  })

  describe('the space escalation chain', () => {
    it('the first airborne press double jumps instead of deploying', () => {
      const falling = player({
        position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3(0, -12, 0),
      })
      const s = controllerStep(falling, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
      expect(s.mode).toBe('ground')
      expect(s.velocity.y).toBe(DEFAULT_GROUND_CONFIG.airJumpSpeed)
      expect(s.airJumpsUsed).toBe(1)
    })

    it('the second airborne press deploys the glider', () => {
      const falling = player({
        position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3(0, -12, 0),
      })
      const afterDouble = controllerStep(
        falling, input({ actionPressed: true }), 1 / 60, deps(voidWorld),
      )
      const s = controllerStep(afterDouble, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
      expect(s.mode).toBe('glider')
    })
  })
})

describe('the glider deploy yields to a landing', () => {
  const G = DEFAULT_GROUND_CONFIG

  /**
   * Airborne with the air jump spent, descending at 10 m/s, half a metre above flat ground.
   *
   * Half a metre against a reach of 1.1 m at this speed (`ground-move.test.ts` pins the
   * figure), so the ground is comfortably inside the window rather than at its edge -- the
   * edge gets its own test below.
   */
  const nearGround = (over: Partial<PlayerState> = {}) => player({
    position: new Vector3(0, 0.5, 0), grounded: false, velocity: new Vector3(0, -10, 0),
    airJumpsUsed: G.maxAirJumps, ...over,
  })

  /** Mid-swing: the staff is out, so nothing here can open the wings anyway. */
  const midSwing = { staffChain: 1, staffElapsed: 0.05, staffRecovery: 0, staffSinceSwing: 0 }
  /** Between swings with the combo alive -- `staffBusy`'s `chain > 0` case. */
  const chained = { staffChain: 1, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0.02 }

  it('arms the buffer where it used to open the wings, whatever the staff is doing', () => {
    // The addendum's measured table, re-measured through controllerStep with the ground close.
    // Before the fix the first row read `mode: 'glider'`, `jumpBuffer` 0 at any altitude: the
    // deploy gate's preconditions were the buffer's arming branch minus `staffBusy`, and the
    // gate runs first, so the ordinary press the buffer exists to catch went to the wings and
    // the buffer could only ever arm behind a live swing, chain or recovery -- rows two and
    // three, which is why they were already what they are.
    const rows: Array<readonly [string, Partial<PlayerState>]> = [
      ['staff idle', {}],
      ['mid-swing', midSwing],
      ['chain > 0', chained],
    ]
    for (const [label, staff] of rows) {
      const s = controllerStep(
        nearGround(staff), input({ actionPressed: true }), 1 / 60, deps(flatGround),
      )
      expect(s.mode, label).toBe('ground')
      expect(s.jumpBuffer, label).toBe(0.08333333333333334)
      // Not merely "did not deploy": the press has to have been spent on the buffer rather
      // than dropped, and no air jump may be conjured out of it.
      expect(s.airJumpsUsed, label).toBe(G.maxAirJumps)
      expect(s.velocity.y, label).toBeLessThan(0)
    }
  })

  it('still deploys at altitude, where nothing is about to be landed on', () => {
    // Without this the fix could have simply broken the glider and the rest of this describe
    // would read as a success. Flat ground exists here, 200 m below -- so this asserts the
    // gate consulted the terrain and found nothing in reach, not that terrain was absent.
    const s = controllerStep(
      player({
        position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3(0, -10, 0),
        airJumpsUsed: G.maxAirJumps,
      }),
      input({ actionPressed: true }), 1 / 60, deps(flatGround),
    )
    expect(s.mode).toBe('glider')
    expect(s.jumpBuffer).toBe(0)
  })

  it('still deploys while rising near the ground, so the slam-bounce re-deploy survives', () => {
    // The bounce's own measured launch speed, 15.450 m/s out of a 34.333 m/s slam
    // (`ground-move.test.ts`'s slam table), a hand's width off the deck. A reach computed from
    // an unsigned speed would suppress this, and §4.3's dive -> wave -> re-deploy would be
    // gone.
    //
    // The fixture is not the state a real bounce leaves, and the comment here used to say it
    // was: `applyBounce` sets `airJumpsUsed: 0`, so the first press out of a bounce spends the
    // air jump rather than reaching this gate at all -- asserted below on the same rising
    // state, at the 18.270 m/s `ground-move.test.ts`'s slam table also pins. Spending the
    // reserve in the fixture is what puts the press in front of the gate, which is the only
    // thing this test is about: that the reach is signed. The combo's second press, after the
    // air jump, is the one that really does arrive here.
    const rising = { position: new Vector3(0, 0.1, 0), grounded: false,
      velocity: new Vector3(0, 15.449999999999985, 0) }
    const s = controllerStep(
      player({ ...rising, airJumpsUsed: G.maxAirJumps }),
      input({ actionPressed: true }), 1 / 60, deps(flatGround),
    )
    expect(s.mode).toBe('glider')

    const withReserve = controllerStep(
      player(rising), input({ actionPressed: true }), 1 / 60, deps(flatGround),
    )
    expect(withReserve.mode).toBe('ground')
    expect(withReserve.velocity.y).toBe(18.26999999999999)
  })

  describe('and only to ground it could actually land on', () => {
    /**
     * The gate's terrain question, asked across the threshold that decides what counts as
     * ground anywhere else in the game: `isWall`'s `wallNormalY`, 0.5.
     *
     * Steeper than that and the fall does not end there -- `resolveMovement` holds the body
     * `radius` clear of the face and it skims on down -- so yielding the press to it buys
     * neither a glide nor a jump. `wall-face-reach.test.ts` measures how much of the real
     * archipelago is such a face (3.37% of what a descending player's ray finds, and 17.31% of
     * `needle`); this pins the rule itself, where the boundary can be placed exactly.
     */
    const wallish = [0.05, 0.3, 0.49]
    const groundish = [0.5, 0.51, 0.9]

    it('treats a face steeper than the wall threshold exactly as it treats open air', () => {
      // The control is the same press over `voidWorld`, rather than a restatement of what the
      // deploy does: whatever open air produces, a wall face has to produce too.
      const openAir = controllerStep(
        nearGround(), input({ actionPressed: true }), 1 / 60, deps(voidWorld),
      )
      expect(openAir.mode).toBe('glider')
      expect(openAir.jumpBuffer).toBe(0)
      for (const normalY of wallish) {
        const s = controllerStep(
          nearGround(), input({ actionPressed: true }), 1 / 60, deps(groundTiltedBy(normalY)),
        )
        expect(s.mode, `normal.y ${normalY}`).toBe(openAir.mode)
        expect(s.jumpBuffer, `normal.y ${normalY}`).toBe(openAir.jumpBuffer)
      }
    })

    it('still yields to a face at or above it, and the jump still arrives', () => {
      // 0.5 is in this list on purpose: `isWall` is a strict `<`, so the threshold's own value
      // is ground, and a filter written with `<=` would fail here and nowhere else.
      for (const normalY of groundish) {
        const terrain = groundTiltedBy(normalY)
        const pressed = controllerStep(
          nearGround(), input({ actionPressed: true }), 1 / 60, deps(terrain),
        )
        expect(pressed.mode, `normal.y ${normalY}`).toBe('ground')
        expect(pressed.jumpBuffer, `normal.y ${normalY}`).toBe(0.08333333333333334)

        let s = pressed
        let launchSpeed = Number.NaN
        for (let f = 1; f < 20 && Number.isNaN(launchSpeed); f++) {
          s = controllerStep(s, input(), 1 / 60, deps(terrain))
          if (s.velocity.y > 0) launchSpeed = s.velocity.y
        }
        expect(launchSpeed, `normal.y ${normalY}`).toBe(G.jumpSpeed)
      }
    })
  })

  it('turns the yielded press into a jump on landing, through the whole controller', () => {
    // The gap that hid the defect for the whole cycle: every other buffer test calls
    // groundStep directly and so never meets the deploy gate above it. This one presses once,
    // mid-fall, and then holds nothing at all until the jump comes out.
    let s = nearGround()
    let sawGlider = false
    let jumped = -1
    let launchSpeed = Number.NaN
    for (let f = 0; f < 20; f++) {
      s = controllerStep(s, input({ actionPressed: f === 0 }), 1 / 60, deps(flatGround))
      if (s.mode !== 'ground') sawGlider = true
      if (jumped < 0 && s.velocity.y > 0) {
        jumped = f
        launchSpeed = s.velocity.y
      }
    }
    expect(sawGlider).toBe(false)
    // Touchdown is on frame 2 from half a metre at this speed, and the buffer is honoured on
    // the frame after it: `stepJump` runs before the ground probe, so touchdown's own frame
    // still reads an airborne state.
    expect(jumped).toBe(3)
    // The jump speed exactly, not merely upward: an air jump would also be upward, and the
    // buffered press must fire the uncharged ground jump.
    expect(launchSpeed).toBe(G.jumpSpeed)
  })

  it('yields at the far edge of its own reach, and the buffer still gets there', () => {
    // The reason `fallWithinBufferWindow` being *short* of the real fall matters. The buffer's
    // usable span is five frames rather than the six the window nominally buys, while the reach
    // is a full window's worth of fall -- so the longest fall the gate ever yields to is where
    // the two are closest, and it has to still work. It does because the simulated fall covers
    // more ground than the prediction: the predicted reach is crossed in six frames, which puts
    // the press at most five frames early. A prediction that erred the other way would open a
    // band of heights where the press bought neither a glide nor a jump.
    //
    // The far edge is `fallWithinBufferWindow(-10, G)` itself, not a round number just inside
    // it: 1.09 m stopped a centimetre short of the boundary and left the last centimetre of the
    // reach -- the only part where the margin is actually thin -- unasserted. Measured, 1.1 m
    // exactly still jumps, and on the same frame 1.09 m does: the last centimetre of the reach
    // is inside the same frame's worth of fall, so it costs the buffer nothing.
    const edge = fallWithinBufferWindow(-10, G)
    expect(edge).toBe(1.1)
    for (const [height, expected] of [[1.09, 6], [edge, 6]] as const) {
      let s = nearGround({ position: new Vector3(0, height, 0) })
      let jumped = -1
      let launchSpeed = Number.NaN
      for (let f = 0; f < 20; f++) {
        s = controllerStep(s, input({ actionPressed: f === 0 }), 1 / 60, deps(flatGround))
        expect(s.mode, `${height} m, frame ${f}`).toBe('ground')
        if (jumped < 0 && s.velocity.y > 0) {
          jumped = f
          launchSpeed = s.velocity.y
        }
      }
      expect(jumped, `${height} m`).toBe(expected)
      expect(launchSpeed, `${height} m`).toBe(G.jumpSpeed)
    }
  })

  it('does not reach past the fall the buffer can survive, which is the whole margin', () => {
    // The far edge from the other side, and the assertion that guards the dead band. The gate
    // may reach no further than a fall covers in one window, 1.1166666666666667 m at this speed
    // (`ground-move.test.ts` pins that simulated figure) -- because a press yielded beyond it
    // lands after the buffer has expired and buys neither a glide nor a jump. The margin
    // between the shipped reach and that limit is 1.5%: 1.1 against 1.1166666666666667. So this
    // row is what reddens a reach given slack, and the row above is what reddens a reach given
    // less; between them the boundary is pinned from both sides.
    const oneWindowOfFall = 1.1166666666666667
    expect(oneWindowOfFall / fallWithinBufferWindow(-10, G)).toBeCloseTo(1.01515, 5)
    const s = controllerStep(
      nearGround({ position: new Vector3(0, oneWindowOfFall, 0) }),
      input({ actionPressed: true }), 1 / 60, deps(flatGround),
    )
    expect(s.mode).toBe('glider')
  })
})

describe('flying', () => {
  const flying = (over: Partial<PlayerState> = {}) => player({
    mode: 'glider', position: new Vector3(0, 300, 0), grounded: false,
    velocity: new Vector3(0, 0, -24), ...over,
  })

  it('gliding costs no breath', () => {
    expect(controllerStep(flying(), input(), 1 / 60, deps(voidWorld)).breath).toBe(100)
  })

  it('thrusting spends breath', () => {
    expect(controllerStep(flying(), input({ forward: 1 }), 1 / 60, deps(voidWorld)).breath)
      .toBeLessThan(100)
  })

  it('cannot thrust with an empty meter', () => {
    const empty = flying({ breath: 0 })
    const thrust = controllerStep(empty, input({ forward: 1 }), 1 / 60, deps(voidWorld))
    const glide = controllerStep(empty, input(), 1 / 60, deps(voidWorld))
    expect(thrust.velocity.length()).toBeCloseTo(glide.velocity.length(), 5)
  })

  it('steers the glider toward the look direction over time', () => {
    let s = flying()
    const look = new Vector3(1, 0, 0)
    for (let i = 0; i < 120; i++) {
      s = controllerStep(s, input({ lookDirection: look }), 1 / 60, deps(voidWorld))
    }
    expect(s.forward.angleTo(look)).toBeLessThan(flying().forward.angleTo(look))
  })

  it('does not mutate the state it is given', () => {
    const s = flying()
    controllerStep(s, input({ forward: 1 }), 1 / 60, deps(voidWorld))
    expect(s.position.toArray()).toEqual([0, 300, 0])
    expect(s.breath).toBe(100)
  })
})

describe('landing', () => {
  it('a slow touchdown lands cleanly and skims out of it', () => {
    // Changed deliberately: this used to assert the landing stopped dead. The
    // character design doc is explicit that landing never hard-stops — he rolls,
    // skims or scoots out of it — and a dead stop was the one place the ground
    // layer threw away all the momentum the player had built.
    const slow = player({
      mode: 'glider', position: new Vector3(0, 1, 0), grounded: false,
      velocity: new Vector3(0, -2, -4),
    })
    const s = controllerStep(slow, input(), 1 / 60, deps(flatGround))
    expect(s.mode).toBe('ground')
    expect(s.grounded).toBe(true)
    // Vertical motion is absorbed, horizontal motion carries through.
    expect(s.velocity.y).toBe(0)
    expect(Math.abs(s.velocity.z)).toBeGreaterThan(0)
    expect(Math.abs(s.velocity.z)).toBeLessThan(4)
  })

  it('a fast touchdown keeps some momentum as a stagger', () => {
    const fast = player({
      mode: 'glider', position: new Vector3(0, 1, 0), grounded: false,
      velocity: new Vector3(0, -5, -50),
    })
    const s = controllerStep(fast, input(), 1 / 60, deps(flatGround))
    expect(s.mode).toBe('ground')
    expect(s.velocity.length()).toBeGreaterThan(0)
  })

  it('records the island landed on', () => {
    const slow = player({
      mode: 'glider', position: new Vector3(0, 1, 0), grounded: false,
      velocity: new Vector3(0, -2, 0), lastGroundIslandId: null,
    })
    expect(controllerStep(slow, input(), 1 / 60, deps(flatGround)).lastGroundIslandId).toBe('flat')
  })
})

describe('safety nets', () => {
  it('respawns after falling past the world floor', () => {
    const lost = player({ mode: 'glider', position: new Vector3(0, -900, 0), grounded: false })
    const s = controllerStep(lost, input(), 1 / 60, deps(voidWorld))
    expect(s.mode).toBe('ground')
    expect(s.position.toArray()).toEqual([0, 0, 0])
  })

  it('respawns at the last island stood on', () => {
    const lost = player({ position: new Vector3(0, -900, 0), lastGroundIslandId: 'elsewhere' })
    expect(controllerStep(lost, input(), 1 / 60, deps(voidWorld)).position.toArray())
      .toEqual([1, 1, 1])
  })

  it('respawns rather than propagating non-finite state', () => {
    const broken = player({ position: new Vector3(NaN, 10, 0) })
    expect(Number.isFinite(controllerStep(broken, input(), 1 / 60, deps(voidWorld)).position.x))
      .toBe(true)
  })

  it('respawns on a non-finite forgiveness counter, like every other tracked field', () => {
    // Both counters are fed by `dt` arithmetic, so both can carry a NaN, and `isFinitePlayer`
    // is what stops one spreading. Nothing pinned their membership of that list: dropping them
    // from it left the whole suite green, because a NaN counter changes no other field's value.
    // Asserted on the respawn, which is the observable consequence -- a respawned player is
    // grounded at the spawn point with both counters cleared.
    for (const field of ['coyoteTime', 'jumpBuffer'] as const) {
      const broken = player({ [field]: Number.NaN, position: new Vector3(5, 5, 5) })
      const s = controllerStep(broken, input(), 1 / 60, deps(voidWorld))
      expect(Number.isFinite(s[field]), field).toBe(true)
      expect(s[field], field).toBe(0)
      expect(s.position.toArray(), field).toEqual([0, 0, 0])
      expect(s.grounded, field).toBe(true)
    }
  })

  it('restores breath on respawn', () => {
    expect(respawn(player({ breath: 3 }), deps(voidWorld)).breath).toBe(100)
  })

  it('regenerates breath while standing on the ground', () => {
    expect(controllerStep(player({ breath: 50 }), input(), 1 / 60, deps(flatGround)).breath)
      .toBeGreaterThan(50)
  })

  it('a NaN maxBreath on the incoming state produces a finite result', () => {
    const broken = player({ maxBreath: NaN })
    const s = controllerStep(broken, input(), 1 / 60, deps(voidWorld))
    expect(Number.isFinite(s.breath)).toBe(true)
    expect(Number.isFinite(s.maxBreath)).toBe(true)
    expect(s.maxBreath).toBeGreaterThan(0)
    expect(s.breath).toBeGreaterThan(0)
  })

  it('a spawnPointFor that returns a non-finite position still yields a finite result', () => {
    const brokenSpawn = deps(voidWorld, () => new Vector3(NaN, NaN, NaN))
    const lost = player({ position: new Vector3(0, -900, 0) })
    const s = controllerStep(lost, input(), 1 / 60, brokenSpawn)
    expect(Number.isFinite(s.position.x)).toBe(true)
    expect(Number.isFinite(s.position.y)).toBe(true)
    expect(Number.isFinite(s.position.z)).toBe(true)
    expect(Number.isFinite(s.velocity.length())).toBe(true)
    expect(Number.isFinite(s.breath)).toBe(true)
    expect(Number.isFinite(s.maxBreath)).toBe(true)
  })

  it('a broken spawnPointFor never lets non-finite state escape across repeated frames', () => {
    const brokenSpawn = deps(voidWorld, () => new Vector3(NaN, NaN, NaN))
    let s = player({ position: new Vector3(0, -900, 0) })
    for (let i = 0; i < 10; i++) {
      s = controllerStep(s, input(), 1 / 60, brokenSpawn)
      expect(Number.isFinite(s.position.x)).toBe(true)
      expect(Number.isFinite(s.position.y)).toBe(true)
      expect(Number.isFinite(s.position.z)).toBe(true)
      expect(Number.isFinite(s.velocity.x)).toBe(true)
      expect(Number.isFinite(s.breath)).toBe(true)
      expect(Number.isFinite(s.maxBreath)).toBe(true)
    }
  })

  it('respawn sanitises a NaN maxBreath', () => {
    const s = respawn(player({ maxBreath: NaN }), deps(voidWorld))
    expect(Number.isFinite(s.breath)).toBe(true)
    expect(Number.isFinite(s.maxBreath)).toBe(true)
    expect(s.maxBreath).toBe(DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
    expect(s.breath).toBe(DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
  })

  it('respawn falls back to baseMaxBreath for a non-positive maxBreath', () => {
    const zero = respawn(player({ maxBreath: 0 }), deps(voidWorld))
    const negative = respawn(player({ maxBreath: -5 }), deps(voidWorld))
    expect(zero.maxBreath).toBe(DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
    expect(negative.maxBreath).toBe(DEFAULT_FLIGHT_CONFIG.baseMaxBreath)
  })
})

describe('jump field resets', () => {
  it('respawn clears air jumps and charge', () => {
    const s = respawn(player({ airJumpsUsed: 1, chargeTime: 0.8 }), deps(voidWorld))
    expect(s.airJumpsUsed).toBe(0)
    expect(s.chargeTime).toBe(0)
  })

  it('landing the glider clears air jumps and charge', () => {
    const slow = player({
      mode: 'glider', position: new Vector3(0, 1, 0), grounded: false,
      velocity: new Vector3(0, -2, 0), airJumpsUsed: 1, chargeTime: 0.8,
    })
    const s = controllerStep(slow, input(), 1 / 60, deps(flatGround))
    expect(s.grounded).toBe(true)
    expect(s.airJumpsUsed).toBe(0)
    expect(s.chargeTime).toBe(0)
  })
})

describe('deploying the glider adds a kick', () => {
  it('gains upward speed rather than only preserving momentum', () => {
    // The wings snapping open should reward a well-timed deploy, per the design's
    // transition layer: transitions carry no cost and this one adds energy.
    const falling = player({
      grounded: false, airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
      position: new Vector3(0, 200, 0), velocity: new Vector3(10, -4, 0),
    })

    const deployed = controllerStep(falling, input({ actionPressed: true }), 1 / 60, deps(voidWorld))

    expect(deployed.mode).toBe('glider')
    // Strictly faster upward than it arrived. Comparing against
    // "-4 + deployKick" alone would be a tautology: with a kick of zero the
    // expectation collapses to the incoming velocity and the test passes.
    expect(deployed.velocity.y).toBeGreaterThan(falling.velocity.y)
    expect(deployed.velocity.y).toBeCloseTo(-4 + DEFAULT_FLIGHT_CONFIG.deployKick, 5)
  })

  it('keeps horizontal momentum through the transition', () => {
    const falling = player({
      grounded: false, airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
      position: new Vector3(0, 200, 0), velocity: new Vector3(10, -4, -6),
    })

    const deployed = controllerStep(falling, input({ actionPressed: true }), 1 / 60, deps(voidWorld))

    expect(deployed.velocity.x).toBeCloseTo(10, 5)
    expect(deployed.velocity.z).toBeCloseTo(-6, 5)
  })
})

describe('the controller flies through the level\'s wind', () => {
  const gliding = () => player({
    mode: 'glider', grounded: false, position: new Vector3(0, 300, 0),
    velocity: new Vector3(0, 0, -24), forward: new Vector3(0, 0, -1),
  })

  it('applies a thermal it is sitting in', () => {
    const still = { ...deps(voidWorld) }
    const lifting = {
      ...deps(voidWorld),
      windAt: () => ({ accel: new Vector3(0, 25, 0), liftScale: 1 }),
    }

    const plain = controllerStep(gliding(), input(), 1 / 60, still)
    const lifted = controllerStep(gliding(), input(), 1 / 60, lifting)

    expect(lifted.velocity.y).toBeGreaterThan(plain.velocity.y)
  })

  it('flies as if in still air when the level defines no wind', () => {
    // windAt is optional, so a level without wind must behave exactly as before.
    const before = controllerStep(gliding(), input(), 1 / 60, deps(voidWorld))
    const explicit = controllerStep(gliding(), input(), 1 / 60, {
      ...deps(voidWorld), windAt: () => ({ accel: new Vector3(), liftScale: 1 }),
    })
    expect(before.velocity.y).toBeCloseTo(explicit.velocity.y, 9)
  })
})

describe('the ground branch feels the air too', () => {
  it('feeds the air to a falling player on foot, not only to the glider', () => {
    // groundStep's wind parameter defaults to still air, so the danger is that the wiring
    // is simply absent and every test still passes. This is the test of the wiring.
    const windy = { ...deps(voidWorld), windAt: () => ({ accel: new Vector3(0, 500, 0), liftScale: 1 }) }
    const calm = deps(voidWorld)
    const start = player({ position: new Vector3(0, 200, 0), grounded: false, velocity: new Vector3() })
    let lifted = start
    let falling = start
    for (let frame = 0; frame < 60; frame++) {
      lifted = controllerStep(lifted, input(), 1 / 60, windy)
      falling = controllerStep(falling, input(), 1 / 60, calm)
    }
    expect(lifted.position.y).toBeGreaterThan(falling.position.y)
  })

  it('asks the air about the direction the character faces', () => {
    // A ridge lifts anyone moving along its face and a river carries anyone moving with it,
    // so the heading is part of the question. This asserts the argument reaches the sampler
    // rather than that some heading was passed.
    const seen: Vector3[] = []
    const spying = {
      ...deps(voidWorld),
      windAt: (_p: Vector3, forward: Vector3) => { seen.push(forward.clone()); return stillAir() },
    }
    const facing = new Vector3(1, 0, 0)
    controllerStep(
      player({ position: new Vector3(0, 200, 0), grounded: false, forward: facing }),
      input(), 1 / 60, spying,
    )
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]!.x).toBeCloseTo(1, 6)
  })

  it('leaves a glide exactly as it was', () => {
    // "Do not touch the glider" is an intention, and intentions need tests. A glide with a
    // sampler present must land where it did before this cycle -- including the *ordering*
    // of the sample relative to steerToward, which is the actual thing "do not touch"
    // protects: the glider samples wind with its steered heading, after steerToward has run,
    // so ridge lift responds to trimming.
    //
    // The first version of this test used `windAt: () => stillAir()` with lookDirection
    // equal to forward, and it could not have caught that ordering moving: a constant
    // sampler ignores the heading argument outright, and steerToward was a no-op because
    // there was nothing to steer toward -- sampling before or after it produced the exact
    // same pin either way. This fixture is heading-sensitive, the way a real ridge is (lift
    // scales with alignment to the ridge's axis), and the glide is trimmed -- lookDirection
    // differs from forward, so steerToward actually turns the nose over the run -- so the
    // two orderings diverge and the pin can tell them apart.
    const RIDGE_AXIS = new Vector3(1, 0, 0)
    const ridgeStrength = 15
    const ridgeSampler = (_p: Vector3, forward: Vector3) => {
      const flat = new Vector3(forward.x, 0, forward.z)
      if (flat.lengthSq() > 1e-8) flat.normalize()
      const along = Math.abs(flat.dot(RIDGE_AXIS))
      return { accel: new Vector3(0, ridgeStrength * along, 0), liftScale: 1 }
    }
    const windy = { ...deps(flatGround), windAt: ridgeSampler }
    let g = player({
      mode: 'glider', position: new Vector3(0, 300, 0), velocity: new Vector3(0, 0, -30),
      forward: new Vector3(0, 0, -1), grounded: false,
    })
    // Trimmed: lookDirection points off to the side of forward, so steerToward spends the
    // whole run turning the nose toward it rather than holding a heading that is already met.
    const look = new Vector3(1, 0, -1).normalize()
    for (let frame = 0; frame < 120; frame++) {
      g = controllerStep(g, input({ lookDirection: look }), 1 / 60, windy)
    }
    // Measured against this exact code, stable across repeated runs (deterministic
    // simulation, no RNG involved), and asserted so a later change to the glider's wind
    // sampling -- including moving it ahead of steerToward -- cannot pass unnoticed. Moving
    // the sample before steerToward (using state.forward in place of the steered `forward`)
    // was checked against this test and reddened it: see the task-1 report for the figures.
    expect(g.position.y).toBeCloseTo(299.7147, 4)
    expect(g.position.z).toBeCloseTo(-44.7840, 4)
  })
})

describe('slipstream', () => {
  it('adds speed on the ground', () => {
    const standing = player()
    const dodged = controllerStep(
      standing, input({ slipstreamPressed: true }), 1 / 60, deps(flatGround),
    )
    expect(dodged.velocity.length()).toBeGreaterThan(DEFAULT_SLIPSTREAM_CONFIG.speed / 2)
    expect(dodged.slipstreamElapsed).not.toBeNull()
  })

  it('works in the glider too, unlike the blast dash', () => {
    // The reason it is a separate move: the dash is ground-only, and a dodge you
    // cannot use while gliding is no use against anything in the air.
    const flying = player({
      mode: 'glider', position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, 0, -20),
    })
    const dodged = controllerStep(
      flying, input({ slipstreamPressed: true }), 1 / 60, deps(voidWorld),
    )
    expect(dodged.slipstreamElapsed).not.toBeNull()
    expect(dodged.velocity.length()).toBeGreaterThan(flying.velocity.length())
  })

  it('lets the flight model absorb a sideways glider dodge', () => {
    // A glider dodge is deliberately perpendicular to the heading, so every one of them
    // adds pure cross-flow velocity that flightStep's speed-squared drag has to eat. The
    // property worth guarding is that the sideways burst decays rather than persisting or
    // amplifying — measured as the component of velocity across the heading, so a normal
    // gliding dive (which legitimately gains speed) cannot mask it.
    const across = (state: PlayerState): number => {
      const heading = new Vector3(state.forward.x, 0, state.forward.z).normalize()
      const flat = new Vector3(state.velocity.x, 0, state.velocity.z)
      return flat.clone().sub(heading.multiplyScalar(flat.dot(heading))).length()
    }

    let s = player({
      mode: 'glider', position: new Vector3(0, 400, 0), grounded: false,
      velocity: new Vector3(0, 0, -20),
    })
    s = controllerStep(s, input({ slipstreamPressed: true, strafe: 1 }), 1 / 60, deps(voidWorld))
    const burst = across(s)
    expect(burst).toBeGreaterThan(DEFAULT_SLIPSTREAM_CONFIG.speed / 2)

    for (let t = 0; t < 2; t += 1 / 60) {
      s = controllerStep(s, input(), 1 / 60, deps(voidWorld))
    }
    expect(Number.isFinite(s.velocity.length())).toBe(true)
    expect(across(s)).toBeLessThan(burst / 2)
  })

  it('respects the cooldown', () => {
    let s = controllerStep(player(), input({ slipstreamPressed: true }), 1 / 60, deps(flatGround))
    const firstSpeed = s.velocity.length()
    // Run past the dash's duration but not its cooldown.
    for (let t = 0; t < DEFAULT_SLIPSTREAM_CONFIG.durationSeconds + 0.1; t += 1 / 60) {
      s = controllerStep(s, input(), 1 / 60, deps(flatGround))
    }
    const before = s.velocity.length()
    const again = controllerStep(s, input({ slipstreamPressed: true }), 1 / 60, deps(flatGround))
    expect(again.velocity.length()).toBeLessThan(before + firstSpeed / 2)
  })

  it('clears on respawn', () => {
    // A NaN respawn mid-dodge must not carry an invulnerability window into the
    // fresh state, which would hand out free protection after a crash.
    const broken = player({ position: new Vector3(Number.NaN, 0, 0), slipstreamElapsed: 0.05 })
    expect(controllerStep(broken, input(), 1 / 60, deps(flatGround)).slipstreamElapsed).toBeNull()
  })

  it('deducts breath on a successful dodge', () => {
    const full = player({ breath: 100 })
    const dodged = controllerStep(
      full, input({ slipstreamPressed: true }), 1 / 60, deps(flatGround),
    )
    expect(dodged.breath).toBe(100 - DEFAULT_SLIPSTREAM_CONFIG.breathCost)
  })

  it('will not fire without enough breath', () => {
    // Margin of 1 rather than a hair under the cost: ground regen adds a little breath
    // back before the dodge is evaluated this same frame, and a too-thin margin would
    // let that regen alone carry the player over the line.
    const winded = player({ breath: DEFAULT_SLIPSTREAM_CONFIG.breathCost - 1 })
    const dodged = controllerStep(
      winded, input({ slipstreamPressed: true }), 1 / 60, deps(flatGround),
    )
    expect(dodged.slipstreamElapsed).toBeNull()
  })

  it('cannot drive breath below zero', () => {
    // stepSlipstream only ever spends breathCost, and canSlipstream already refuses to
    // fire below that, so the deduction should never need the clamp — this pins the
    // floor at the exact boundary in case that stops being true.
    const atCost = player({ breath: DEFAULT_SLIPSTREAM_CONFIG.breathCost })
    const dodged = controllerStep(
      atCost, input({ slipstreamPressed: true }), 1 / 60, deps(flatGround),
    )
    expect(dodged.breath).toBeGreaterThanOrEqual(0)
  })
})

describe('the staff', () => {
  const swinging = () => controllerStep(
    player(), input({ staffPressed: true }), 1 / 60, deps(flatGround),
  )

  it('starts a swing on a press', () => {
    expect(staffBusy(staffOf(swinging()))).toBe(true)
  })

  it('does not start a swing on the frame it deploys, so the staff cannot freeze mid-glide', () => {
    // Fix-round 1 finding: staffPressed and actionPressed landing on the same frame,
    // with the staff free, used to start a swing gated on the mode BEFORE this frame's
    // branches (still 'ground' during the deploy branch) even though the state coming
    // out of it is 'glider'. That swing then froze at elapsed: 0 for the whole flight —
    // nothing steps the staff while airborne — so staffBusy stayed true long after
    // landing, blocking an unrelated later deploy for no reason the player could see.
    const falling = player({
      position: new Vector3(0, 200, 0), grounded: false,
      airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    })
    const s = controllerStep(
      falling, input({ staffPressed: true, actionPressed: true }), 1 / 60, deps(voidWorld),
    )
    expect(s.mode).toBe('glider')
    expect(isSwinging(staffOf(s))).toBe(false)
    expect(staffBusy(staffOf(s))).toBe(false)
  })

  it('reports the swing it started, so the fight can resolve it', () => {
    // staffStep is the interface answer to Task 5's open question: controllerStep's
    // return type stays a plain PlayerState (main.ts needs no new plumbing there), and
    // this sits beside it the way detectSlam does, called with the same pre-step state,
    // input, dt and config so it can never disagree with what controllerStep just did.
    const swing = staffStep(player(), input({ staffPressed: true }), 1 / 60, DEFAULT_STAFF_CONFIG)
    expect(swing?.index).toBe(1)
  })

  it('does not swing in the glider, where the staff is a wing', () => {
    const flying = player({
      mode: 'glider', position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, 0, -20),
    })
    const pressed = controllerStep(flying, input({ staffPressed: true }), 1 / 60, deps(voidWorld))
    expect(staffBusy(staffOf(pressed))).toBe(false)
    expect(staffStep(flying, input({ staffPressed: true }), 1 / 60, DEFAULT_STAFF_CONFIG)).toBeNull()
  })

  it('blocks a glider deploy while swinging', () => {
    // The design document's central risk decision: commit to melee and the wing is not
    // available until the staff is done with you.
    const falling = player({
      position: new Vector3(0, 200, 0), grounded: false,
      airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    })
    const mid = controllerStep(falling, input({ staffPressed: true }), 1 / 60, deps(voidWorld))
    expect(staffBusy(staffOf(mid))).toBe(true)
    const deployed = controllerStep(mid, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
    expect(deployed.mode).toBe('ground')
  })

  it('still blocks a deploy during recovery, after the swinging has stopped', () => {
    // A gate that only covers the swing itself would make the commitment nearly free.
    let s = player({
      position: new Vector3(0, 400, 0), grounded: false,
      airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    })
    s = controllerStep(s, input({ staffPressed: true }), 1 / 60, deps(voidWorld))
    for (let i = 0; i < DEFAULT_STAFF_CONFIG.maxChain - 1; i++) {
      for (let t = 0; t < DEFAULT_STAFF_CONFIG.swingSeconds; t += 1 / 60) {
        s = controllerStep(s, input(), 1 / 60, deps(voidWorld))
      }
      s = controllerStep(s, input({ staffPressed: true }), 1 / 60, deps(voidWorld))
    }
    for (let t = 0; t < DEFAULT_STAFF_CONFIG.swingSeconds + 0.02; t += 1 / 60) {
      s = controllerStep(s, input(), 1 / 60, deps(voidWorld))
    }
    expect(isSwinging(staffOf(s))).toBe(false)
    expect(staffBusy(staffOf(s))).toBe(true)
    const blocked = controllerStep(s, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
    expect(blocked.mode).toBe('ground')
  })

  it('allows the deploy once the staff is free again', () => {
    // The control for the two tests above: without it they only prove deploy never works.
    let s = player({
      position: new Vector3(0, 400, 0), grounded: false,
      airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    })
    s = controllerStep(s, input({ staffPressed: true }), 1 / 60, deps(voidWorld))
    for (let t = 0; t < 3; t += 1 / 60) s = controllerStep(s, input(), 1 / 60, deps(voidWorld))
    expect(staffBusy(staffOf(s))).toBe(false)
    const deployed = controllerStep(s, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
    expect(deployed.mode).toBe('glider')
  })

  it('clears on respawn', () => {
    const broken = player({ position: new Vector3(Number.NaN, 0, 0), staffElapsed: 0.1 })
    const back = controllerStep(broken, input(), 1 / 60, deps(flatGround))
    expect(staffBusy(staffOf(back))).toBe(false)
  })
})

describe('the glider does not pass through terrain', () => {
  it('stops at a wall instead of crossing it', () => {
    let state = player({
      mode: 'glider', position: new Vector3(0, 100, 0),
      velocity: new Vector3(60, 0, 0), forward: new Vector3(1, 0, 0), grounded: false,
    })
    for (let frame = 0; frame < 120; frame++) {
      state = controllerStep(
        state, input({ lookDirection: new Vector3(1, 0, 0) }), 1 / 60, deps(groundAndWall),
      )
    }
    expect(state.position.x).toBeLessThan(20)
  })

  it('loses the speed going into the wall rather than keeping it', () => {
    let state = player({
      mode: 'glider', position: new Vector3(19, 100, 0),
      velocity: new Vector3(60, 0, 0), forward: new Vector3(1, 0, 0), grounded: false,
    })
    state = controllerStep(
      state, input({ lookDirection: new Vector3(1, 0, 0) }), 1 / 60, deps(groundAndWall),
    )
    expect(state.velocity.x).toBeLessThanOrEqual(0)
  })

  it('is untouched when nothing is in the way', () => {
    // The change has to be confined to walls, or every flight measurement in this suite
    // is now measuring something else.
    const start = player({
      mode: 'glider', position: new Vector3(0, 100, 0),
      velocity: new Vector3(0, 0, -30), forward: new Vector3(0, 0, -1), grounded: false,
    })
    let withWall = start
    let without = start
    for (let frame = 0; frame < 60; frame++) {
      const i = input({ lookDirection: new Vector3(0, 0, -1) })
      withWall = controllerStep(withWall, i, 1 / 60, deps(groundAndWall))
      without = controllerStep(without, i, 1 / 60, deps(flatGround))
    }
    expect(withWall.position.toArray()).toEqual(without.position.toArray())
  })
})

describe('an exhausted glider does not buzz', () => {
  /** Frames out of 600 on which thrust actually engaged, holding W from empty. */
  const engagedFrames = () => {
    let p = player({
      mode: 'glider', breath: 0, grounded: false,
      position: new Vector3(0, 300, 0), velocity: new Vector3(0, 0, -30),
    })
    let engaged = 0
    for (let frame = 0; frame < 600; frame++) {
      const before = p.breath
      p = controllerStep(p, input({ forward: 1 }), 1 / 60, deps(flatGround))
      // Breath failing to rise means the drain ran, which means thrust engaged.
      if (p.breath <= before) engaged++
    }
    return engaged
  }

  it('cuts the duty cycle rather than only moving where it oscillates', () => {
    // Measured before the fix: 300 of 600 frames, a 50 percent duty cycle at 30 Hz.
    // A test asserting only "cannot bend at exactly 0" passes today and catches nothing.
    //
    // The floor does not reach zero engaged frames: `canBend` is a plain threshold with
    // no memory of "was already bending" (deliberately -- see breath.ts), so once breath
    // is back up at the floor it still ping-pongs across it, one drained frame at a time.
    // What the floor buys is a 1.25 s delay before the first re-engagement (regenerating
    // from 0 up to bendFloor 15 at 12/s) and a lower duty cycle once it starts (measured
    // at 210 of 600 here, against 300 of 600 with no floor) -- slower and less frequent,
    // not silent. Eliminating the chatter entirely would need true hysteresis and a
    // "was bending" field on PlayerState, which is deliberately out of scope; see the
    // task report for why 210 is accepted as the real fix rather than chasing 0.
    //
    // This exact number is a tripwire for that follow-up, not just a record: it would
    // redden if the floor were removed (back to 300) and it would redden just the same if
    // someone later added hysteresis without updating this assertion (down to 0).
    expect(engagedFrames()).toBe(210)
  })
})

describe('a net that has the wings shut', () => {
  const TANGLE = 2

  /** Airborne with the air jump already spent, so an action press is a deploy and nothing else. */
  const falling = (over: Partial<PlayerState> = {}) => player({
    position: new Vector3(0, 200, 0),
    grounded: false,
    velocity: new Vector3(0, -12, 0),
    airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
    ...over,
  })

  it('refuses the deploy while the countdown is running', () => {
    const s = controllerStep(
      falling({ tangled: TANGLE }), input({ actionPressed: true }), 1 / 60, deps(voidWorld),
    )
    expect(s.mode).toBe('ground')
  })

  it('allows the identical press with nothing owed', () => {
    // The positive control, and it is what makes the assertion above a statement about the net
    // rather than about the fixture: the same state, the same press, the same world, differing
    // only in `tangled`. Without it, a `falling()` that had drifted out of the deploy gate's
    // preconditions -- an unspent air jump, ground within the buffer window, a busy staff --
    // would produce `mode: 'ground'` for four other reasons and read as the refusal working.
    const s = controllerStep(
      falling({ tangled: 0 }), input({ actionPressed: true }), 1 / 60, deps(voidWorld),
    )
    expect(s.mode).toBe('glider')
  })

  it('folds a glider already in the air, without being asked', () => {
    // A net that only refused the *next* deploy would do nothing at all to a player who is
    // already flying, which is the population the type exists to threaten.
    const gliding = player({
      mode: 'glider', position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, -6, -40), tangled: TANGLE,
    })
    const s = controllerStep(gliding, input(), 1 / 60, deps(voidWorld))
    expect(s.mode).toBe('ground')
    expect(s.grounded).toBe(false)
  })

  it('leaves the same glider flying with nothing owed', () => {
    // The control for the forced stow. `actionPressed` is false in both, so a stow branch wired
    // to the wrong condition entirely would show here.
    const gliding = player({
      mode: 'glider', position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, -6, -40), tangled: 0,
    })
    expect(controllerStep(gliding, input(), 1 / 60, deps(voidWorld)).mode).toBe('glider')
  })

  it('keeps the horizontal momentum through the forced fold', () => {
    // Section 2.3 is explicit that stowing keeps horizontal momentum, and it is also what makes
    // being netted survivable: the player arrives in ground mode already travelling, rather than
    // starting a two-second dead drop from a standstill. Asserted on the horizontal components
    // only, since gravity is entitled to the vertical one.
    const gliding = player({
      mode: 'glider', position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(9, -6, -40), tangled: TANGLE,
    })
    const s = controllerStep(gliding, input(), 1 / 60, deps(voidWorld))
    expect(s.velocity.x).toBeCloseTo(9, 6)
    expect(s.velocity.z).toBeCloseTo(-40, 6)
  })

  it('counts the refusal down in the glider posture as well as on foot', () => {
    // The countdown lives after both posture branches for this reason. It cannot currently be
    // reached in glider mode -- the gate refuses the deploy and the branch above folds the wing
    // -- but a timer that only runs in one posture is a timer that stops working after an
    // unrelated edit, and the failure would be a player permanently unable to fly.
    const gliding = player({
      mode: 'glider', position: new Vector3(0, 200, 0), grounded: false,
      velocity: new Vector3(0, -6, -40), tangled: TANGLE,
    })
    const s = controllerStep(gliding, input(), 1 / 60, deps(voidWorld))
    expect(s.tangled).toBeCloseTo(TANGLE - 1 / 60, 8)
  })

  it('counts down on foot too', () => {
    const s = controllerStep(player({ tangled: TANGLE }), input(), 1 / 60, deps(flatGround))
    expect(s.tangled).toBeCloseTo(TANGLE - 1 / 60, 8)
  })

  it('hands the wings back the frame after the countdown expires, and not before', () => {
    // The player's whole out, asserted as a boundary rather than as an eventual outcome. Both
    // sides are pinned: still refused on the last owed frame, and allowed on the first free one.
    // Only the second half would pass for a refusal that never happened.
    let s = falling({ tangled: TANGLE })
    let deployedWhileOwed = false
    let frames = 0
    // Step with no press until the countdown is spent, watching that a press would still be
    // refused on every one of those frames.
    while (s.tangled > 0 && frames < 600) {
      const pressing = controllerStep(s, input({ actionPressed: true }), 1 / 60, deps(voidWorld))
      if (pressing.mode === 'glider') deployedWhileOwed = true
      s = controllerStep(s, input(), 1 / 60, deps(voidWorld))
      frames++
    }
    expect(deployedWhileOwed, 'the glider opened while a net was still holding it').toBe(false)
    // About two seconds of frames, so the refusal really did last its stated time rather than
    // ending on frame one.
    expect(frames).toBeGreaterThanOrEqual(120)
    expect(frames).toBeLessThanOrEqual(121)
    // And now it opens.
    expect(controllerStep(s, input({ actionPressed: true }), 1 / 60, deps(voidWorld)).mode)
      .toBe('glider')
  })

  it('is cleared by a respawn rather than carried into the next life', () => {
    // The down beat already costs the walk back and the whole Focus meter. Arriving at the spawn
    // point still unable to open the wings would be a punishment carried over from a life that
    // has ended, and the same argument the staff combo and the dash chain are cleared under.
    expect(respawn(player({ tangled: TANGLE }), deps(flatGround)).tangled).toBe(0)
  })

  it('respawns a player whose countdown has gone non-finite rather than flying on', () => {
    // `isFinitePlayer` watches the field, and this is why. A NaN fails `isTangled`'s `> 0` test,
    // so a corrupt countdown would silently *free* the wings forever rather than lock them --
    // invisible in play, and exactly the class of failure this codebase guards by respawning.
    const s = controllerStep(
      player({ tangled: Number.NaN, position: new Vector3(5, 9, 5) }),
      input(), 1 / 60, deps(flatGround),
    )
    expect(s.tangled).toBe(0)
    // Actually respawned, not merely repaired in place: the spawn point for 'flat' is the origin.
    expect(s.position.toArray()).toEqual([0, 0, 0])
  })
})
