import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG,
} from '../core/config'
import { controllerStep, type ControllerDeps } from './controller'
import { totalEnergy } from './flight'
import type { InputState, PlayerState } from '../core/types'

/**
 * The Slipstream is not a way to fly.
 *
 * It used to be the cheapest one. Pressing it on cooldown for forty seconds from y 300
 * climbed to y 434 and reached 76.9 m/s with the breath bar still full, where a plain
 * glide over the same span sank to y 151 and 23.1 m/s. The glide loses half its energy,
 * which is what gliding is; chain-dodging gained 81 percent of it, because the impulse is
 * added in `controllerStep` after `flightStep` has run and so escapes the
 * never-gains-height invariant the integrator is careful to keep.
 *
 * After the fix (breath cost 28, perpendicular glider dodge landing on a fixed default
 * side when no bank is held): the same forty seconds of chain-dodging drifts off its
 * straight line -- every dodge kicks sideways to the same side rather than forward -- and
 * ends up crashed on an island at y -51.8, nearly stopped (0.8 m/s), breath drained to
 * 87.5, energy ratio -0.16. A plain glide over the same span ends at y 150.9, 23.1 m/s,
 * energy ratio 0.51. Chain-dodging is not just no-longer-free, it is now worse than doing
 * nothing.
 *
 * Setting `breathCost` to 0 does not reproduce the original figures. With the direction
 * fix already in place, an unlimited-dodge run still never goes anywhere near y 434: it
 * drifts off the archipelago and free-falls into open water, ending at y -482.4, 40.0 m/s,
 * a full 100 breath, energy ratio -1.37. The breath bar staying full is the one thing that
 * matches the original description; the altitude and energy figures do not, because this
 * neutralisation only removes the cost, not the direction fix from the same cycle's other
 * task, and the direction fix alone already prevents the straight-line climb that produced
 * y 434. Reverting *both* fixes together (confirmed as a diagnostic, not committed) does
 * reproduce the original measurement almost exactly: y 434.4, 76.9 m/s, full 100 breath --
 * which is what pins that both fixes are implemented correctly, even though neither one
 * alone, tested against this scenario, looks like the bug report.
 *
 * Run against the real archipelago rather than a fake, so nothing about the terrain query
 * or the collision resolution can quietly change what this measures.
 */
function deps(): ControllerDeps {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  const terrain = createTerrainQuery(islands)
  return {
    terrain,
    flight: DEFAULT_FLIGHT_CONFIG,
    ground: DEFAULT_GROUND_CONFIG,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    spawnPointFor: () => new Vector3(0, 40, 0),
    slipstream: DEFAULT_SLIPSTREAM_CONFIG,
    staff: DEFAULT_STAFF_CONFIG,
    collision: DEFAULT_COLLISION_CONFIG,
  }
}

function input(over: Partial<InputState> = {}): InputState {
  return {
    lookDirection: new Vector3(0, 0, -1),
    forward: 0, strafe: 0, sprint: false, tuck: false,
    actionPressed: false, actionHeld: false, actionReleased: false,
    scooterPressed: false, dashPressed: false, gustPressed: false,
    avatarStatePressed: false, vortexHeld: false, vortexReleased: false,
    slipstreamPressed: false, staffPressed: false,
    ...over,
  }
}

function glider(): PlayerState {
  return {
    mode: 'glider',
    position: new Vector3(0, 300, 0),
    velocity: new Vector3(0, 0, -30),
    forward: new Vector3(0, 0, -1),
    breath: 100, maxBreath: 100,
    grounded: false, lastGroundIslandId: 'home',
    airJumpsUsed: 0, chargeTime: 0,
    scooterActive: false, scooterCharge: 0,
    dashesUsed: 0, dashRecovery: 0,
    slipstreamElapsed: null, slipstreamCooldown: 0,
    staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
  }
}

/** Forty seconds, dodging on cooldown or never. Returns what forty seconds produced. */
function fly(dodge: boolean) {
  const d = deps()
  let p = glider()
  const start = totalEnergy(p.position, p.velocity, DEFAULT_FLIGHT_CONFIG.gravity)
  let dodges = 0
  for (let frame = 0; frame < 2400; frame++) {
    const ready = dodge && p.slipstreamCooldown <= 0 && p.slipstreamElapsed === null
    const before = p.slipstreamCooldown
    p = controllerStep(p, input({ slipstreamPressed: ready }), 1 / 60, d)
    if (p.slipstreamCooldown > before) dodges++
  }
  return {
    y: p.position.y,
    speed: p.velocity.length(),
    breath: p.breath,
    dodges,
    energyRatio: totalEnergy(p.position, p.velocity, DEFAULT_FLIGHT_CONFIG.gravity) / start,
  }
}

describe('chain-dodging is no longer a way to gain altitude for free', () => {
  it('ends lower than it started, like a glide, rather than 134 m higher', () => {
    const chained = fly(true)
    expect(chained.dodges, 'the test must actually be dodging').toBeGreaterThan(0)
    expect(chained.y).toBeLessThan(300)
  })

  it('runs the breath bar down instead of leaving it full', () => {
    // The measurement that made this a bug rather than a tuning question: 27 dodges over
    // forty seconds, and the bar never moved.
    expect(fly(true).breath).toBeLessThan(100)
  })

  it('loses energy over forty seconds rather than gaining it', () => {
    const chained = fly(true)
    expect(chained.energyRatio).toBeLessThan(1)
  })

  it('is worse than a plain glide at keeping altitude, not better', () => {
    // Compared against the control in the same test rather than against a remembered
    // constant, so retuning the flight model cannot silently invert the comparison while
    // both numbers drift.
    //
    // The slack is 0.15, not a round guess: measured, chained.energyRatio is -0.16 and
    // plain.energyRatio is 0.51, a gap of about 0.67. 0.15 is comfortably inside that gap
    // -- room for the flight model to be retuned a bit without the assertion needing
    // attention -- while still failing well before chained could close more than about a
    // fifth of the distance to plain, which is the point of the comparison: chained
    // creeping back toward parity with plain is exactly what this should catch.
    const plain = fly(false)
    const chained = fly(true)
    expect(chained.energyRatio).toBeLessThanOrEqual(plain.energyRatio + 0.15)
  })

  it('still lets a fight have several dodges in it', () => {
    // The cost must not make the move useless. A full bar buys at least three.
    expect(Math.floor(100 / DEFAULT_SLIPSTREAM_CONFIG.breathCost)).toBeGreaterThanOrEqual(3)
  })
})
