import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { groundStep, desiredVelocity, easeHorizontal, horizontalForward } from './ground-move'
import { scooterTurnAuthority } from './scooter'
import { DEFAULT_GROUND_CONFIG as G, DEFAULT_COLLISION_CONFIG as COLLISION } from '../core/config'
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

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false, scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false, vortexHeld: false, vortexReleased: false, slipstreamPressed: false, staffPressed: false,
  ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', airJumpsUsed: 0, chargeTime: 0, coyoteTime: 0, jumpBuffer: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, slipstreamElapsed: null, slipstreamCooldown: 0, staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, ...over,
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
