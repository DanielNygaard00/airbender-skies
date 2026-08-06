import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG,
} from '../core/config'
import { spawnPointFor } from './state'
import { controllerStep, type ControllerDeps } from './controller'
import type { InputState, PlayerState } from '../core/types'

/**
 * The player against the real islands.
 *
 * This is the one property of collision that cannot be read off a fake: whether the
 * archipelago's actual geometry is solid to a sweep. It was not. Measured before this
 * cycle, a glider flown at the `needle` island at 50 m/s entered at x 210 and left at
 * x 112, straight through a rock centred at x 150 with a radius of 12, still in glider
 * mode. A sideways ray from the same start point hit at 48.8 m, so the geometry was
 * solid all along and nothing had asked.
 *
 * Building all thirteen islands' geometry costs a couple of hundred milliseconds, which
 * is why this lives in its own file rather than being folded into a faster suite.
 */
function archipelagoTerrain() {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  return createTerrainQuery(islands)
}

function deps(terrain: ReturnType<typeof archipelagoTerrain>): ControllerDeps {
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

function island(id: string) {
  const found = ARCHIPELAGO.islands.find((i) => i.id === id)
  if (!found) throw new Error(`no island named ${id}`)
  return found
}

describe('a glider cannot fly through an island', () => {
  it('does not come out the far side of the needle', () => {
    const terrain = archipelagoTerrain()
    const needle = island('needle')
    let state: PlayerState = {
      mode: 'glider',
      // 60 out on +X at the needle's own centre height, flying straight at it.
      position: new Vector3(needle.position.x + 60, needle.position.y, needle.position.z),
      velocity: new Vector3(-50, 0, 0),
      forward: new Vector3(-1, 0, 0),
      breath: 100, maxBreath: 100,
      grounded: false, lastGroundIslandId: 'home',
      airJumpsUsed: 0, chargeTime: 0,
      scooterActive: false, scooterCharge: 0,
      dashesUsed: 0, dashRecovery: 0,
      slipstreamElapsed: null, slipstreamCooldown: 0,
      staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
    }
    for (let frame = 0; frame < 150; frame++) {
      state = controllerStep(
        state, input({ lookDirection: new Vector3(-1, 0, 0) }), 1 / 60, deps(terrain),
      )
    }
    // The far side is x < centre - radius. Before this cycle the player reached x 112,
    // which is 26 units past it.
    expect(state.position.x).toBeGreaterThan(needle.position.x - needle.radius)
  })
})
