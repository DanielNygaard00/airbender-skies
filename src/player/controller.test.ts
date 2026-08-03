import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { controllerStep, respawn, type ControllerDeps } from './controller'
import { DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG } from '../core/config'
import type { InputState, PlayerState, TerrainQuery } from '../core/types'

const flatGround: TerrainQuery = {
  groundHeightAt: () => 0,
  raycastDown: (from, maxDistance) =>
    from.y >= 0 && from.y - maxDistance <= 0
      ? { point: new Vector3(from.x, 0, from.z), normal: new Vector3(0, 1, 0), islandId: 'flat' }
      : null,
}
const voidWorld: TerrainQuery = { groundHeightAt: () => null, raycastDown: () => null }

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
})

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false, scooterPressed: false, dashPressed: false, gustPressed: false,
  ...over,
})
const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(0, 0, 0), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: 'flat', airJumpsUsed: 0, chargeTime: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, ...over,
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
