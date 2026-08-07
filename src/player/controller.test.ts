import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { controllerStep, respawn, staffStep, type ControllerDeps } from './controller'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG,
} from '../core/config'
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
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false, scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false, vortexHeld: false, vortexReleased: false, slipstreamPressed: false, staffPressed: false,
  ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', airJumpsUsed: 0, chargeTime: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, ...over,
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
    // sampler present must land where it did before this cycle.
    const windy = { ...deps(flatGround), windAt: () => stillAir() }
    let g = player({
      mode: 'glider', position: new Vector3(0, 300, 0), velocity: new Vector3(0, 0, -30),
      forward: new Vector3(0, 0, -1), grounded: false,
    })
    for (let frame = 0; frame < 120; frame++) {
      g = controllerStep(g, input({ lookDirection: new Vector3(0, 0, -1) }), 1 / 60, windy)
    }
    // Measured against this exact code, stable across repeated runs (deterministic
    // simulation, no RNG involved), and asserted so a later change to the glider's wind
    // sampling cannot pass unnoticed.
    expect(g.position.y).toBeCloseTo(295.6804, 4)
    expect(g.position.z).toBeCloseTo(-54.2603, 4)
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
