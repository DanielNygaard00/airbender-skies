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
import { controllerStep, willRespawn, type ControllerDeps } from './controller'
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
    slipstreamPressed: false, staffPressed: false, airWallHeld: false,
  // The element radial's four fields. Air is the resting selection, the radial is closed,
  // and no pointer movement: none of this reaches movement code, which is the point —
  // `stepElements` is the only consumer, and it is not on the movement path.
  radialHeld: false, radialReleased: false, pointerDelta: { x: 0, y: 0 }, elementIndex: null,
  carryPressed: false,
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
      act: 1,
      mode: 'glider',
      // 60 out on +X at the needle's own centre height, flying straight at it.
      position: new Vector3(needle.position.x + 60, needle.position.y, needle.position.z),
      velocity: new Vector3(-50, 0, 0),
      forward: new Vector3(-1, 0, 0),
      breath: 100, maxBreath: 100,
      grounded: false, lastGroundIslandId: 'home',
      airJumpsUsed: 0, chargeTime: 0,
      coyoteTime: 0, jumpBuffer: 0,
      scooterActive: false, scooterCharge: 0, wallRideNormal: null,
      dashesUsed: 0, dashRecovery: 0,
      slipstreamElapsed: null, slipstreamCooldown: 0,
      staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
      tangled: 0,
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

describe('a walker cannot walk through an island', () => {
  it('is deflected by a genuine wall on the spire flank rather than passing through it', () => {
    const terrain = archipelagoTerrain()
    const spire = island('spire')
    // Walking straight in along the spire's own centre line (dz 0) turns out to be a walk
    // over a walkable, noise-perturbed dome the whole way across -- the crown is gentle
    // enough there that nothing steeper than wallNormalY is ever met, so a test along that
    // line would prove nothing (see the task brief). Probing downward at points along
    // z = spire.position.z + 8 instead finds a genuine wall: at 16 to 17 units out the
    // surface normal's y component measures roughly 0.41, steeper than wallNormalY's 0.5,
    // and the height drops smoothly into it rather than jumping -- a real slope, not an
    // overhang whose top a walker would just fall off the edge of. Measured directly
    // against the geometry, not assumed.
    const offsetZ = spire.position.z + 8
    const startX = spire.position.x + 20
    const ground = terrain.groundHeightAt(startX, offsetZ)
    expect(ground, 'the walk should start on real ground').not.toBe(null)

    // The spire's real underside, not a nominal position.y - height: the geometry is
    // noise-perturbed and squashed asymmetrically top-to-bottom (TOP_FLATTEN vs
    // BOTTOM_STRETCH in island.ts), so the actual lowest vertex has to be measured off the
    // built mesh rather than assumed from the level definition's radius/height.
    const spireMesh = new Mesh(createIslandGeometry(spire))
    spireMesh.geometry.computeBoundingBox()
    const underside = spire.position.y + spireMesh.geometry.boundingBox!.min.y

    let state: PlayerState = {
      act: 1,
      mode: 'ground',
      position: new Vector3(startX, ground!, offsetZ),
      velocity: new Vector3(),
      forward: new Vector3(-1, 0, 0),
      breath: 100, maxBreath: 100,
      grounded: true, lastGroundIslandId: 'spire',
      airJumpsUsed: 0, chargeTime: 0,
      coyoteTime: 0, jumpBuffer: 0,
      scooterActive: false, scooterCharge: 0, wallRideNormal: null,
      dashesUsed: 0, dashRecovery: 0,
      slipstreamElapsed: null, slipstreamCooldown: 0,
      staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
      tangled: 0,
    }
    // Honest accounting of what these two checks inside the loop actually establish,
    // because a future reader who only sees "about to respawn" and "belt and suspenders"
    // below will reasonably conclude both are load-bearing against real geometry. They are
    // not, currently, and that is worth recording here rather than only in the task report:
    //
    // - The sideways-drift assertion after the first `walk(40)` below is the one that
    //   actually fails if the deflection stops working -- confirmed by neutralising
    //   `resolveMovement` in `groundStep`, which reddens exactly that assertion
    //   (`expected 0 to be greater than 1`) and nothing else in this test.
    // - `willRespawn` and the underside bound, checked on every frame here, are correct
    //   regression protection for the failure this task exists to fix -- a downward ray
    //   that starts inside a mesh meets only back faces and reports no ground at all. That
    //   mechanism is real: measured directly, a downward ray cast from a point inside the
    //   `needle` and `home` meshes returns `null`, i.e. back-face culling does swallow the
    //   interior exactly as described. But no walking route to it has been found on this
    //   geometry: 83 inward runs across all thirteen archipelago islands, from eight
    //   bearings each, at sprint with collision disabled, produced zero respawns -- the
    //   ground snap's unconditional "accept any downward hit while already grounded" climbs
    //   every slope this noise generates regardless of steepness, so a bounded-speed walker
    //   never gets deep enough inside a mesh for the back faces to matter. These two
    //   assertions are here because the mechanism is real and cheap to guard against, not
    //   because this test has been observed to catch it.
    const walk = (frames: number) => {
      for (let frame = 0; frame < frames; frame++) {
        // Checked before each step, not after: `controllerStep` calls `willRespawn` at
        // its own top and, if it is true, hands back `respawn()`'s output -- a position
        // above ground. The exact failure this task exists to fix (falling through the
        // island interior and past the world floor into a respawn) would leave
        // `state.position.y` looking perfectly healthy one line later, so asserting on
        // position after the fact can never catch it. `willRespawn` is exported from
        // controller.ts for precisely this reason -- see its docblock.
        expect(willRespawn(state, ARCHIPELAGO.worldFloorY), `frame ${frame}: about to respawn`)
          .toBe(false)
        // Belt and suspenders against the same failure: sinking into the mesh interior
        // before a respawn would even trigger.
        expect(state.position.y, `frame ${frame}: sank below the island's underside`)
          .toBeGreaterThan(underside)
        state = controllerStep(
          state,
          input({ forward: 1, sprint: true, lookDirection: new Vector3(-1, 0, 0) }),
          1 / 60,
          deps(terrain),
        )
      }
    }

    // Approach the wall dead straight along z. 40 frames covers reaching it at run speed
    // with room either side; the wall's own normal has a z component, so a real deflection
    // shows up as sideways drift off that straight line -- the same signature the
    // ground-move unit test checks for a fake wall, now against real archipelago geometry.
    // Measured directly against this implementation: 1.71 m of drift after 40 frames. The
    // threshold below is set well under that measurement -- comfortably above the 0 drift
    // a dead-straight, uncollided walk would show -- rather than at an arbitrary round
    // number disconnected from what was actually observed.
    walk(40)
    expect(Math.abs(state.position.z - offsetZ), 'a real wall should have deflected the walk sideways')
      .toBeGreaterThan(1)

    // Keep walking under the same per-frame guards above.
    walk(260)
    expect(willRespawn(state, ARCHIPELAGO.worldFloorY)).toBe(false)
    expect(state.position.y).toBeGreaterThan(underside)
  })
})
