import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG,
} from '../core/config'
import { controllerStep, willRespawn, type ControllerDeps } from './controller'
import { spawnPointFor } from './state'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import type { InputState, PlayerState } from '../core/types'

/**
 * Being netted in mid-air over open sky, and getting out of it.
 *
 * The net thrower's whole threat is that it takes the air layer away, and the obvious way to get
 * that wrong is to make it lethal: grounded over nothing, the player falls, and if the refusal
 * outlasts the fall then one connect from one soldier is an unrecoverable death. `config.ts` claims
 * the shipped two seconds costs "about a fifteenth of the air available over open sky". That is a
 * claim about the level, so it is measured against the level here rather than asserted there.
 *
 * **The player's out is the countdown expiring with air to spare, and there is no second
 * mechanism.** Nothing is shaken off, nothing is cancelled by input, and the air jump is not
 * refunded. Two seconds of ground-mode fall, then the wings open again. The one *skill* answer is
 * upstream of this file: a Slipstream's invulnerable window discards the net entirely, which
 * `encounter.test.ts` covers.
 *
 * Own file rather than an addition to `controller.test.ts` for the reason
 * `terrain-collision.test.ts` is its own file: this needs the real thirteen-island geometry to say
 * anything about how much air is actually under a player, and `controller.test.ts` runs against
 * flat fakes by design.
 */
function archipelagoTerrain() {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  return createTerrainQuery(islands)
}

/**
 * The shipped refusal, read off the netter's own release rather than written as a literal.
 *
 * The narrowing throw doubles as an assertion worth having: a netter whose attack had become
 * `melee` would be a netter that cannot throw a net, and this file's whole subject would have
 * quietly stopped existing.
 */
const TANGLE = (() => {
  const attack = DEFAULT_COMBAT_CONFIG.enemies.nets.attack
  if (attack.kind !== 'projectile') throw new Error('a net thrower has to be a ranged attacker')
  return attack.tangleSeconds
})()

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false,
  scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false,
  vortexHeld: false, vortexReleased: false, slipstreamPressed: false, staffPressed: false,
  airWallHeld: false,
  radialHeld: false, radialReleased: false, pointerDelta: { x: 0, y: 0 }, elementIndex: null,
  carryPressed: false,
  ...over,
})

/**
 * Gliding over the open sky between the home island and the southern ring, at the altitude the
 * islands themselves occupy.
 *
 * (200, 0, −200) is measured to be void: the home island's radius is 70 and nothing else reaches
 * out here, so `groundHeightAt` is null and there is the full drop to `worldFloorY` beneath. The
 * first test in this file pins that, because every claim below is about how much air is under this
 * point and a position that turned out to be over an island would make all of them vacuous.
 *
 * `airJumpsUsed` is 1 — the air jump already spent — which is the state a player who deployed out
 * of a jump is in, and the state that makes an action press a deploy rather than a jump.
 */
const OVER_OPEN_SKY = new Vector3(200, 0, -200)

const glidingOverTheVoid = (over: Partial<PlayerState> = {}): PlayerState => ({
  act: 1, mode: 'glider',
  position: OVER_OPEN_SKY.clone(),
  // A realistic cruise: fast, and sinking gently.
  velocity: new Vector3(0, -4, -34),
  forward: new Vector3(0, 0, -1),
  breath: DEFAULT_FLIGHT_CONFIG.baseMaxBreath,
  maxBreath: DEFAULT_FLIGHT_CONFIG.baseMaxBreath,
  grounded: false,
  lastGroundIslandId: 'home',
  airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps,
  chargeTime: 0, coyoteTime: 0, jumpBuffer: 0,
  scooterActive: false, scooterCharge: 0, wallRideNormal: null, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
  tangled: 0,
  ...over,
})

function makeDeps(): ControllerDeps {
  const terrain = archipelagoTerrain()
  return {
    terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    spawnPointFor: spawnPointFor(ARCHIPELAGO, terrain),
    slipstream: DEFAULT_SLIPSTREAM_CONFIG,
    staff: DEFAULT_STAFF_CONFIG,
    collision: DEFAULT_COLLISION_CONFIG,
  }
}

/**
 * Fly the player for `seconds`, pressing the action key whenever `press` says to.
 *
 * Reports the lowest point reached and whether a respawn was ever triggered, which together are
 * the whole question: did the player fall out of the world.
 */
function fly(
  from: PlayerState,
  seconds: number,
  press: (state: PlayerState, frame: number) => boolean,
  deps = makeDeps(),
) {
  let state = from
  let lowest = state.position.y
  let respawned = false
  let redeployedAt: number | null = null
  const frames = Math.round(seconds * 60)
  for (let frame = 0; frame < frames; frame++) {
    if (willRespawn(state, deps.worldFloorY)) respawned = true
    const wasGround = state.mode === 'ground'
    state = controllerStep(state, input({ actionPressed: press(state, frame) }), 1 / 60, deps)
    if (wasGround && state.mode === 'glider' && redeployedAt === null) redeployedAt = frame
    lowest = Math.min(lowest, state.position.y)
  }
  return { state, lowest, respawned, redeployedAt }
}

describe('the air actually available over open sky', () => {
  it('is void beneath the fixture, with the whole drop to the world floor under it', () => {
    // Every claim in this file is about how much air is under `OVER_OPEN_SKY`. If that point were
    // over an island the fall would end on terrain and nothing below would mean anything.
    const terrain = archipelagoTerrain()
    expect(terrain.groundHeightAt(OVER_OPEN_SKY.x, OVER_OPEN_SKY.z)).toBe(null)
    expect(terrain.raycast(OVER_OPEN_SKY, new Vector3(0, -1, 0), 4000)).toBe(null)
    // 600 m of it, from y 0 down to the floor at -600.
    expect(OVER_OPEN_SKY.y - ARCHIPELAGO.worldFloorY).toBe(600)
  })

  it('costs far less altitude to sit out the refusal than there is air to spend', () => {
    // The number `config.ts` claims, measured. A stowed player in ground mode falls under gravity
    // 20, so two seconds costs roughly 40 m of altitude plus whatever downward speed the glide
    // already carried -- against 600 m available. The fraction is what makes the mechanic a scare
    // rather than a death.
    const netted = glidingOverTheVoid({ tangled: TANGLE })
    // Never pressing, so this measures the refusal alone with no recovery mixed in.
    const { state } = fly(netted, TANGLE, () => false)
    const lost = OVER_OPEN_SKY.y - state.position.y
    expect(lost).toBeGreaterThan(40)
    // Recorded as a bracket rather than a single figure, because the glide's own -4 m/s of sink
    // contributes to it: measured at about 48 m.
    expect(lost).toBeLessThan(60)
    // The claim, as a ratio. A fifteenth of 600 is 40, and this is comfortably inside a tenth.
    expect(lost / (OVER_OPEN_SKY.y - ARCHIPELAGO.worldFloorY)).toBeLessThan(0.1)
  })
})

describe('a player netted in mid-air over open sky', () => {
  it('is dropped into the ground layer straight away', () => {
    const { state } = fly(glidingOverTheVoid({ tangled: TANGLE }), 1 / 30, () => false)
    expect(state.mode).toBe('ground')
    expect(state.grounded).toBe(false)
  })

  it('gets the wings back and stays out of the world floor', () => {
    // The out, played end to end over the real level for fifteen seconds -- about twice the 7.8 s
    // a free fall from y 0 to the floor would take, so a player who never recovered would
    // certainly have hit it inside the window.
    const { state, lowest, respawned, redeployedAt } = fly(
      glidingOverTheVoid({ tangled: TANGLE }),
      15,
      // Pressing on every frame, which is what a player does when the wings will not open. The
      // refused presses cost nothing: the deploy gate simply declines and the press falls through
      // to `groundStep`, where there is no ground to jump from and no air jump left to spend.
      () => true,
    )
    expect(respawned, 'the player fell out of the world after being netted').toBe(false)
    expect(state.mode).toBe('glider')
    expect(lowest).toBeGreaterThan(ARCHIPELAGO.worldFloorY)
    // And the wings opened at roughly the moment the refusal expired rather than at the end of the
    // window, so "recovered" is not "recovered eventually".
    expect(redeployedAt).not.toBe(null)
    expect(redeployedAt!).toBeLessThanOrEqual(Math.round(TANGLE * 60) + 2)
  })

  it('would have fallen out of the world if the wings had never reopened', () => {
    // **The positive control, and the whole file rests on it.** Without it, "did not fall out of
    // the world" passes for a fixture that was never falling: a player over solid ground, a
    // `worldFloorY` too low to reach, a window too short, or a `velocity` that happened to be
    // rising. Same position, same fifteen seconds, same terrain -- the only difference is that this
    // one never presses, so the wings never reopen. It hits the floor.
    const { respawned, lowest } = fly(glidingOverTheVoid({ tangled: TANGLE }), 15, () => false)
    expect(respawned, 'a player who never redeploys should reach the world floor').toBe(true)
    expect(lowest).toBeLessThan(ARCHIPELAGO.worldFloorY)
  })

  it('pulls out with altitude to spare, rather than merely surviving the window', () => {
    // "Above the floor after fifteen seconds" would also be satisfied by a glider still plunging
    // and about to hit it. This asks the stronger question: once the wings are back, is the player
    // flying? Measured as the sink rate over the last second of a twelve-second run -- a recovered
    // glider sinks at single digits, where an unrecovered fall is past 200 m/s by then.
    const deps = makeDeps()
    const { state } = fly(glidingOverTheVoid({ tangled: TANGLE }), 12, () => true, deps)
    expect(state.mode).toBe('glider')
    const before = state.position.y
    const { state: later } = fly(state, 1, () => false, deps)
    const sink = before - later.position.y
    expect(sink).toBeLessThan(DEFAULT_FLIGHT_CONFIG.stallSpeed)
  })

  it('leaves a netted player on foot able to walk, dodge and swing while grounded', () => {
    // The refusal is aimed at the air layer and nothing else. A net that also took away movement
    // would be a stun, which is not what section 4.4 asks for and would make the two seconds a
    // punishment rather than a change of posture.
    const deps = makeDeps()
    const terrain = deps.terrain
    const ground = terrain.groundHeightAt(0, 0)
    expect(ground).not.toBe(null)
    const onFoot: PlayerState = {
      ...glidingOverTheVoid({ tangled: TANGLE }),
      mode: 'ground',
      position: new Vector3(0, ground!, 0),
      velocity: new Vector3(),
      grounded: true,
      airJumpsUsed: 0,
    }
    const walked = controllerStep(onFoot, input({ forward: 1 }), 1 / 60, deps)
    expect(walked.velocity.length()).toBeGreaterThan(0)
    // And a dodge still fires, spending breath the way it always does.
    const dodged = controllerStep(onFoot, input({ slipstreamPressed: true }), 1 / 60, deps)
    expect(dodged.slipstreamElapsed).not.toBe(null)
  })
})
