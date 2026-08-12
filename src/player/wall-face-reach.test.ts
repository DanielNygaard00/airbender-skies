import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, raycastDown, type IslandMesh } from '../world/terrain-query'
import { isWall } from '../world/collision'
import { controllerStep, type ControllerDeps } from './controller'
import { fallWithinBufferWindow } from './jump'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG,
  DEFAULT_SLIPSTREAM_CONFIG, DEFAULT_STAFF_CONFIG,
} from '../core/config'
import type { InputState, PlayerState, TerrainQuery } from '../core/types'

/**
 * How much of this archipelago the glider deploy's landing gate has to reject.
 *
 * `aboutToLand` asks the terrain whether a fall is about to end, and until this cycle it
 * treated any downward hit as an answer of yes. The faces that break that are not
 * overhangs — a `FrontSide` material culls those, so a downward ray never reaches one — but
 * ordinary upward-facing rock that is merely too steep to stand on. `resolveMovement` holds
 * the body `radius` clear of such a face instead of seating it, so the fall does not end
 * there: the press was yielded to a landing that never comes, and the player gets neither a
 * glide nor a jump.
 *
 * This file exists because that is a claim about geometry, and the only honest way to check
 * it is against the real islands. `controller.test.ts` covers the rule itself on synthetic
 * normals, which is where the boundary belongs; what cannot be faked is *how much* of the
 * archipelago is steep, and that is the number the filter is justified by. Building all
 * thirteen islands' geometry costs a few hundred milliseconds, so it lives in its own file
 * for the same reason `combat/patrol-placement.test.ts` does.
 */
const G = DEFAULT_GROUND_CONFIG
const COLLISION = DEFAULT_COLLISION_CONFIG
const DT = 1 / 60
/** Descent speed every sample falls at, and the reach it buys: 1.1 m. */
const DESCENT = -10
/** Grid resolution per island: 51 x 51 over its bounding square, clipped to the radius. */
const STEPS = 51
/** Where a sample starts, above the surface under it, so the ground is well inside the reach. */
const START_ABOVE = 0.5

function realTerrain(): TerrainQuery {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  return createTerrainQuery(islands)
}

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false,
  scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false,
  vortexHeld: false, vortexReleased: false, slipstreamPressed: false, staffPressed: false, carryPressed: false,
  ...over,
})

/** Airborne, descending, air jump spent, staff idle: the one state the deploy gate opens in. */
const falling = (position: Vector3, islandId: string): PlayerState => ({
  mode: 'ground', position, velocity: new Vector3(0, DESCENT, 0),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: false, lastGroundIslandId: islandId, airJumpsUsed: G.maxAirJumps, chargeTime: 0,
  coyoteTime: 0, jumpBuffer: 0, scooterActive: false, scooterCharge: 0,
  dashesUsed: 0, dashRecovery: 0, slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
})

const deps = (terrain: TerrainQuery): ControllerDeps => ({
  terrain,
  flight: DEFAULT_FLIGHT_CONFIG,
  ground: G,
  worldFloorY: ARCHIPELAGO.worldFloorY,
  spawnPointFor: () => new Vector3(0, 40, 0),
  slipstream: DEFAULT_SLIPSTREAM_CONFIG,
  staff: DEFAULT_STAFF_CONFIG,
  collision: DEFAULT_COLLISION_CONFIG,
})

interface Sample {
  islandId: string
  from: Vector3
  normalY: number
}

/** Every grid position on every island where a descending player has ground within reach. */
function sweep(terrain: TerrainQuery): Sample[] {
  const reach = fallWithinBufferWindow(DESCENT, G)
  const samples: Sample[] = []
  for (const def of ARCHIPELAGO.islands) {
    for (let i = 0; i < STEPS; i++) {
      for (let k = 0; k < STEPS; k++) {
        const dx = -def.radius + (2 * def.radius * i) / (STEPS - 1)
        const dz = -def.radius + (2 * def.radius * k) / (STEPS - 1)
        // Clipped to the island's own footprint, so a corner of the bounding square cannot
        // sample a different island through the gap — `beacon` sits directly above `spire`.
        if (dx * dx + dz * dz > def.radius * def.radius) continue
        const x = def.position.x + dx
        const z = def.position.z + dz
        const ground = terrain.groundHeightAt(x, z)
        if (ground === null) continue
        const from = new Vector3(x, ground + START_ABOVE, z)
        const hit = raycastDown(terrain, from, reach)
        if (hit === null) continue
        samples.push({ islandId: def.id, from, normalY: hit.normal.y })
      }
    }
  }
  return samples
}

describe('the deploy gate against the real archipelago', () => {
  const terrain = realTerrain()
  const samples = sweep(terrain)
  const walls = samples.filter((s) => isWall(new Vector3(0, s.normalY, 0), COLLISION))
  const onIsland = (id: string) => samples.filter((s) => s.islandId === id)
  const wallsOn = (id: string) => walls.filter((s) => s.islandId === id)

  it('has enough wall-normal ground under a falling player to matter', () => {
    // The figure that justifies the filter, and the reason the earlier deferral was wrong: it
    // reasoned about overhangs, which cannot be hit, and not about steep upward faces, which
    // are 3.37% of everything a descending player's ray finds here. Asserted as counts as well
    // as a rate, so a change to the island generator that halves the rim moves this rather
    // than quietly leaving the justification behind.
    expect(samples.length).toBe(23651)
    expect(walls.length).toBe(796)
    expect((100 * walls.length) / samples.length).toBeCloseTo(3.37, 2)
  })

  it('reaches faces that are effectively vertical, not merely brisk slopes', () => {
    // 0.0040 against a wallNormalY of 0.5: these are not borderline cases sitting either side of
    // a threshold, they are cliff. Pinned to the figure the helper's own comment in
    // `controller.ts` cites, and to five places rather than exactly, because the extreme of a
    // sample is the one statistic here that a trivial change to the grid could move.
    const shallowest = Math.min(...walls.map((s) => s.normalY))
    expect(shallowest).toBeCloseTo(0.004, 5)
    expect(shallowest).toBeGreaterThan(0)
  })

  it('is concentrated on the small high islands, needle worst of all', () => {
    // Why the defect would have been felt rather than merely present. `needle` is the island
    // the hover exists to teach, so it is landed on deliberately and repeatedly, and a sixth
    // of it is face the old gate would have yielded to.
    expect(wallsOn('needle').length).toBe(314)
    expect(onIsland('needle').length).toBe(1814)
    expect((100 * wallsOn('needle').length) / onIsland('needle').length).toBeCloseTo(17.31, 2)
    expect(wallsOn('spire').length).toBe(142)
    expect(wallsOn('home').length).toBe(34)
  })

  it('yielded at every one of them before the filter, so the filter is the whole fault', () => {
    // The unfiltered condition, evaluated directly: a hit within reach and nothing else asked
    // of it. It is true at all 796, which is what makes this a single missing test rather than
    // one cause among several -- and it is also the control for the test below, since a gate
    // that no longer yields there has to have had something to yield to.
    const reach = fallWithinBufferWindow(DESCENT, G)
    for (const s of walls) {
      expect(raycastDown(terrain, s.from, reach), `${s.islandId} ${s.from.toArray()}`)
        .not.toBeNull()
    }
  })

  it('now opens the wings there instead of losing the press', () => {
    // The behaviour, end to end: a press at each of the 796 goes to the glider, which is what
    // it did everywhere before this cycle and what a face nobody can land on deserves. Before
    // the filter the same press bought nothing at all -- no glide, and no jump either, because
    // the fall never ends on a face collision holds the body clear of.
    const d = deps(terrain)
    for (const s of walls) {
      const next = controllerStep(
        falling(s.from.clone(), s.islandId), input({ actionPressed: true }), DT, d,
      )
      expect(next.mode, `${s.islandId} ${s.from.toArray()}`).toBe('glider')
    }
  })

  it('leaves the flat ground alone, which is the gate doing its job', () => {
    // The other side of the filter. On the faces that are ground, the press must still be
    // yielded and buffered -- 22855 of the 23651 samples, so the fix cannot have worked by
    // switching the whole rule off.
    //
    // The count is asserted over all of them and the behaviour over every eighth, which is
    // 2857 positions spread across all thirteen islands. Stepping the controller at all 22855
    // costs six seconds against a suite that otherwise runs in four, and the claim here is a
    // population one: the stride is a sample of it, and the wall-face test above it is the one
    // that has to be exhaustive, because those are the positions the change touches.
    const d = deps(terrain)
    const flats = samples.filter((s) => !isWall(new Vector3(0, s.normalY, 0), COLLISION))
    expect(flats.length).toBe(22855)
    let checked = 0
    for (let i = 0; i < flats.length; i += 8) {
      const s = flats[i]!
      const next = controllerStep(
        falling(s.from.clone(), s.islandId), input({ actionPressed: true }), DT, d,
      )
      expect(next.mode, `${s.islandId} ${s.from.toArray()}`).toBe('ground')
      expect(next.jumpBuffer, `${s.islandId} ${s.from.toArray()}`).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBe(2857)
  })
})
