import { describe, it, expect, beforeAll } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { CANYON_COUNTRY, CANYON_FLOOR_Y, CANYON_SLAB_IDS } from '../world/levels/canyon-country'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import type { Level } from '../world/level'
import { groundStep } from './ground-move'
import { DEFAULT_COLLISION_CONFIG, DEFAULT_GROUND_CONFIG } from '../core/config'
import type { GroundConfig, InputState, PlayerState, TerrainQuery } from '../core/types'

/**
 * What Canyon Country offers a wall ride, measured against what the archipelago offers.
 *
 * `wall-ride-geometry.test.ts` is the measurement this region exists to answer: swept over the
 * shipped archipelago, 290 of 117,080 (position, bearing) pairs — 0.25% — put a near-vertical
 * face within lateral reach of a rider standing on footing he could actually be standing on, the
 * median ridable band is 0.25 m, the p90 is 1.5 m, and the tallest wall on the whole map is
 * 6.00 m on `spire`. That file's own conclusion was that "this level was not built for it, and
 * the fix is islands with real cliffs rather than a looser threshold".
 *
 * **The sweep here is that file's methodology, parametrised by level.** It is a copy rather than
 * a shared import because the original belongs to the archipelago and is pinned to it, and a
 * refactor that moved it would put the pinned figures one indirection away from the file that
 * argues for them. The copy's fidelity is not assumed either: the first test below re-derives all
 * four archipelago figures with this file's code, so a divergence in grid, in footing rule, in
 * probe height or in band walk reddens here before any canyon number is read.
 *
 * **Convergence, before anything is pinned.** `reach-geometry.test.ts` records what happens when
 * a figure is pinned to an unconverged grid, so both knobs were swept first, on both regions:
 *
 * | grid (steps/island) | archipelago | canyon |
 * |---|---|---|
 * | 41 (the pinned grid) | 0.25%, p50 0.25, p90 1.50, max 6.00 | 2.26%, p50 4.00, p90 45.00, max 64.25 |
 * | 61 | 0.23%, p50 0.25, p90 1.75, max 6.25 | 2.07%, p50 6.00, p90 46.25, max 64.75 |
 * | 81 | 0.24%, p50 0.25, p90 1.50, max 6.25 | 2.09%, p50 6.75, p90 46.75, max 65.00 |
 * | 101 | 0.25%, p50 0.25, p90 1.25, max 6.25 | not run: 81 steps already costs 84 s |
 *
 * (The canyon's 61 and 81 rows were measured before `canyon-elbow-mid` was added, so their
 * contact rates belong to a 30-island region and the 41 row to a 31-island one. The point they
 * make — that the figures do not move with the grid — is unaffected.)
 *
 * Refining `BAND_STEP` from 0.25 m to 0.125 and 0.0625 moves the archipelago's tallest band from
 * 6.00 to 6.00 to 6.06 and the canyon's from 64.25 to 64.38 to 64.38. So both regions are
 * converged to within one band step at the pinned resolution, the ratios between them are
 * robust, and the one honest caveat is recorded rather than buried: at 41 steps the archipelago's
 * published 6.00 m is one band step below its own converged 6.25 m.
 *
 * Building 31 canyon islands and 13 archipelago ones and walking bands up to 65 m long is
 * inherently expensive — see the timeout note on `beforeAll`.
 */
const G = DEFAULT_GROUND_CONFIG
const DT = 1 / 60
/** Grid resolution per island: 41 x 41 over its bounding square, clipped to the radius. */
const STEPS = 41
/** Bearings probed from each position. Eight is every 45 degrees. */
const BEARINGS = 8
/** How far up a band is walked, per step, when measuring its height. */
const BAND_STEP = 0.25
const DOWN = new Vector3(0, -1, 0)

function realTerrain(level: Level): TerrainQuery {
  const islands: IslandMesh[] = level.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  return createTerrainQuery(islands)
}

/**
 * How tall the ridable band is above a contact, following the wall upward.
 *
 * Walked with the same chest-height origin and `snapDistance` reach the ride itself probes with,
 * so the number is the move's and not an idealisation of it. 400 steps is 100 m, which is more
 * than the tallest wall either region has.
 */
function bandHeight(
  terrain: TerrainQuery, from: Vector3, normal: Vector3, threshold: number,
): number {
  const into = new Vector3(-normal.x, 0, -normal.z)
  if (into.lengthSq() < 1e-8) return 0
  into.normalize()
  const probe = from.clone()
  let height = 0
  for (let i = 1; i <= 400; i++) {
    probe.y = from.y + i * BAND_STEP
    const hit = terrain.raycast(probe, into, G.snapDistance)
    if (!hit || Math.abs(hit.normal.y) >= threshold) break
    height = i * BAND_STEP
  }
  return height
}

interface Contact {
  /** The island whose grid this position came from, and whose surface the feet are on. */
  standing: string
  /** The island the wall belongs to. Not the same thing here: canyon walls are their own islands. */
  wall: string
  /** Where the rider's feet are. */
  foot: Vector3
  /** The wall's outward normal. */
  normal: Vector3
  /** How far the band runs above the contact, in metres. */
  band: number
}

interface Sweep {
  /** (position, bearing) pairs tried. */
  samples: number
  contacts: Contact[]
  /** Sorted band heights, so quantiles cost nothing. */
  bands: number[]
}

/**
 * Every place in a level where a rider on his feet has a wall within lateral reach.
 *
 * Two filters make this a measurement of the move rather than of the mesh. Positions are
 * restricted to footing the ground snap would actually seat a walker on — anything steeper than
 * `CollisionConfig.wallNormalY` is not somewhere a scooter can be — and the probe is the ride's
 * own: chest height, `snapDistance` of reach. `samples` counts only positions that pass the
 * footing test, which is what makes the percentage a statement about places a player can be.
 */
function sweep(terrain: TerrainQuery, level: Level, threshold: number): Sweep {
  let samples = 0
  const contacts: Contact[] = []
  for (const def of level.islands) {
    for (let i = 0; i < STEPS; i++) {
      for (let k = 0; k < STEPS; k++) {
        const dx = -def.radius + (2 * def.radius * i) / (STEPS - 1)
        const dz = -def.radius + (2 * def.radius * k) / (STEPS - 1)
        // Clipped to the island's own footprint, so a corner of the bounding square cannot
        // sample a different island through the gap.
        if (dx * dx + dz * dz > def.radius * def.radius) continue
        const x = def.position.x + dx
        const z = def.position.z + dz
        const ground = terrain.groundHeightAt(x, z)
        if (ground === null) continue
        // Standable footing only. `groundHeightAt` reports the topmost surface whatever its
        // angle, and in this region that matters more than in the archipelago: a hoodoo widens
        // as it rises, so the floor within its own footprint answers with the flank overhead.
        // Counting a wall as reachable from a position no rider can stand on would inflate the
        // whole file, so the footing is checked before the wall is.
        const under = terrain.raycast(new Vector3(x, ground + 2, z), DOWN, 4)
        if (!under || under.normal.y < DEFAULT_COLLISION_CONFIG.wallNormalY) continue

        const foot = new Vector3(x, ground, z)
        const from = new Vector3(x, ground + G.eyeProbeHeight / 2, z)
        for (let b = 0; b < BEARINGS; b++) {
          const angle = (2 * Math.PI * b) / BEARINGS
          const aim = new Vector3(Math.cos(angle), 0, Math.sin(angle))
          samples++
          const hit = terrain.raycast(from, aim, G.snapDistance)
          if (!hit || Math.abs(hit.normal.y) >= threshold) continue
          contacts.push({
            standing: def.id, wall: hit.islandId, foot, normal: hit.normal.clone(),
            band: bandHeight(terrain, from, hit.normal, threshold),
          })
        }
      }
    }
  }
  return { samples, contacts, bands: contacts.map((c) => c.band).sort((a, b) => a - b) }
}

const quantile = (bands: readonly number[], f: number): number =>
  bands[Math.min(bands.length - 1, Math.floor(f * bands.length))]!

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

/** A rider on a charged scooter, standing at `foot`, already moving at `velocity`. */
const riding = (foot: Vector3, velocity: Vector3, islandId: string): PlayerState => ({
  mode: 'ground', position: foot.clone(), velocity: velocity.clone(),
  forward: velocity.clone().setY(0).normalize(),
  breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: islandId, airJumpsUsed: 0, chargeTime: 0,
  coyoteTime: G.coyoteSeconds, jumpBuffer: 0,
  scooterActive: true, scooterCharge: 1, wallRideNormal: null,
  dashesUsed: 0, dashRecovery: 0, slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, tangled: 0,
})

/**
 * Drive a rider into a wall and report what happened, frame by frame.
 *
 * `state.velocity` is set to the approach rather than accelerated into it, for the reason
 * `wall-ride-geometry.test.ts` gives: the entry gate is about closing speed, and a rider who has
 * to spend a second building it would have walked into the wall first.
 */
function chargeAtWall(
  terrain: TerrainQuery, contact: Contact, frames: number, speed: number,
  c: GroundConfig = G,
): PlayerState[] {
  const into = new Vector3(-contact.normal.x, 0, -contact.normal.z).normalize()
  let state = riding(contact.foot, into.clone().multiplyScalar(speed), contact.standing)
  const held = input({ forward: 1, sprint: true, lookDirection: into.clone() })
  const trace: PlayerState[] = []
  for (let f = 0; f < frames; f++) {
    state = groundStep(state, held, DT, terrain, c, DEFAULT_COLLISION_CONFIG)
    trace.push(state)
  }
  return trace
}

/** How high one ride from `contact` gets above the footing it started on. */
function climbFrom(terrain: TerrainQuery, contact: Contact, speed = 26): number {
  const trace = chargeAtWall(terrain, contact, 200, speed)
  const apex = trace.reduce((m, s) => Math.max(m, s.position.y), -Infinity)
  return apex - contact.foot.y
}

let archipelago: Sweep
let canyon: Sweep
let canyonTerrain: TerrainQuery

/**
 * Both sweeps, once, with a generous explicit timeout rather than the 5-second default.
 *
 * Measured in isolation on this machine: 2.2 s for the archipelago and 22 s for the canyon, and
 * the canyon's cost is inherent rather than sloppy. It is 31 islands against 13, and the band
 * walk is the dominant term precisely because the walls are tall — 4,960 contacts whose bands
 * average tens of metres is over a million raycasts, where the archipelago's 290 stubs are a few
 * hundred. Coarsening the grid or capping the band walk to fit a tighter limit would understate
 * exactly the number this file exists to report, which is the mistake `reach-geometry.test.ts`
 * documents having made once already.
 *
 * 240 seconds, for the reason that file gives for its 30: the point of the number is to stop
 * being a tripwire on machine speed, and a limit set just above today's measurement is the same
 * tripwire one wall later. Verified at 34 s wall-clock with four full suites running
 * concurrently, so the margin here is about seven times the worst contention measured.
 */
beforeAll(() => {
  archipelago = sweep(realTerrain(ARCHIPELAGO), ARCHIPELAGO, G.wallRideNormalY)
  canyonTerrain = realTerrain(CANYON_COUNTRY)
  canyon = sweep(canyonTerrain, CANYON_COUNTRY, G.wallRideNormalY)
}, 240000)

describe('the sweep reproduces the archipelago it is being compared against', () => {
  it('re-derives all four published figures with this file\'s own copy of the methodology', () => {
    // The guard that makes every canyon number below a comparison rather than a claim. These are
    // `wall-ride-geometry.test.ts`'s pins, recomputed here: if this file's grid, footing rule,
    // probe height or band walk drifted from that file's, these would move and this test would
    // fail before the canyon's figures were read.
    expect(archipelago.samples).toBe(117080)
    expect(archipelago.contacts.length).toBe(290)
    expect((100 * archipelago.contacts.length) / archipelago.samples).toBeCloseTo(0.25, 2)
    expect(quantile(archipelago.bands, 0.5)).toBeCloseTo(0.25, 6)
    expect(quantile(archipelago.bands, 0.9)).toBeCloseTo(1.5, 6)
    const tallest = archipelago.contacts.reduce((a, c) => (c.band > a.band ? c : a))
    expect(tallest.band).toBeCloseTo(6, 6)
    expect(tallest.standing).toBe('spire')
  })
})

describe('what Canyon Country offers a wall ride', () => {
  it('puts a ridable face within reach nine times as often', () => {
    // The headline. 4,960 of 219,176 pairs, against the archipelago's 290 of 117,080: 2.26%
    // against 0.25%. Both figures are the same sweep at the same resolution, and the region is
    // only 31 islands against 13, so the ratio is about the shape of the rock rather than about
    // there being more of it.
    expect(canyon.samples).toBe(219176)
    expect(canyon.contacts.length).toBe(4960)
    const pct = (100 * canyon.contacts.length) / canyon.samples
    expect(pct).toBeCloseTo(2.26, 2)
    const archipelagoPct = (100 * archipelago.contacts.length) / archipelago.samples
    expect(pct / archipelagoPct).toBeGreaterThan(9)
  })

  it('and what it reaches is a shortcut rather than a stub', () => {
    // The distribution, which matters more than the peak: the archipelago's median contact runs
    // 0.25 m before the face tilts out of vertical and its p90 is 1.5 m, so the typical wall
    // there is something to bounce off. Here the median is 4.00 m and the p90 is 45.00 m.
    //
    // The median is dragged down by contacts taken while standing on a hoodoo cap, where the
    // only rock in reach is the lip the rider is standing on — those are real positions and are
    // not filtered out. Restricted to positions at corridor level, the median is 32.50 m; the
    // floor-standing subset is pinned in its own test below.
    expect(quantile(canyon.bands, 0.5)).toBeCloseTo(4, 6)
    expect(quantile(canyon.bands, 0.9)).toBeCloseTo(45, 6)
    // Exactly 16 and 30 times the archipelago's, which is worth stating as the ratio rather than
    // as a bound: both regions quantise bands to `BAND_STEP`, so these are whole multiples.
    expect(quantile(canyon.bands, 0.5) / quantile(archipelago.bands, 0.5)).toBeCloseTo(16, 6)
    expect(quantile(canyon.bands, 0.9) / quantile(archipelago.bands, 0.9)).toBeCloseTo(30, 6)
  })

  it('tops out at sixty-four metres against the archipelago\'s six', () => {
    // The tallest continuous near-vertical run a rider can start from, on the second of the
    // elbow's tall hoodoos. 64.25 m against 6.00 m: ten and a half times, and it is 47 m past
    // what one accumulator can pay for, which is the ordering this region was built to invert.
    // On the archipelago the rock ran out first; here the move does.
    const tallest = canyon.contacts.reduce((a, c) => (c.band > a.band ? c : a))
    expect(tallest.band).toBeCloseTo(64.25, 6)
    expect(tallest.wall).toBe('canyon-elbow-tall-2')
    const archipelagoTallest = archipelago.contacts.reduce((a, c) => (c.band > a.band ? c : a))
    expect(tallest.band).toBeGreaterThan(10 * archipelagoTallest.band)
  })

  it('gives the corridor floor itself real wall, which is where the region is played', () => {
    // The figure that describes the game rather than the mesh, and it needs both filters. A
    // position sampled from a slab's grid does not mean feet on the floor: `groundHeightAt` is
    // the topmost surface, so a slab position under a hoodoo answers with that hoodoo's cap.
    // All 820 slab-grid contacts have a median band of 16.00 m; the 538 of them whose feet are
    // actually below the floor line plus 8 have a median of 27.25 m and a p90 of 47.00 m. Every
    // one of those is a rider walking the canyon with ridable wall within arm's reach.
    const onFloor = canyon.contacts.filter(
      (c) => CANYON_SLAB_IDS.includes(c.standing) && c.foot.y < CANYON_FLOOR_Y + 8,
    )
    const bands = onFloor.map((c) => c.band).sort((a, b) => a - b)
    expect(onFloor.length).toBe(538)
    expect(quantile(bands, 0.5)).toBeCloseTo(27.25, 6)
    expect(quantile(bands, 0.9)).toBeCloseTo(47, 6)
    // A hundred times the archipelago's median, standing where the region is meant to be walked.
    expect(quantile(bands, 0.5)).toBeGreaterThan(100 * quantile(archipelago.bands, 0.5))
  })

  it('finds ridable rock on all but one island, so no wall is decoration', () => {
    // 30 of 31. The exception is the `canyon-narrows` slab, whose own rim is the one piece of
    // floor with hoodoos on both sides of it and no exposed edge of its own left over — its
    // walls belong to the hoodoos standing on it. Every one of the 25 hoodoos presents rock a
    // rider can reach, which is the check that no wall in the level is scenery.
    const touched = new Set(canyon.contacts.map((c) => c.wall))
    expect(touched.size).toBe(30)
    expect(touched.has('canyon-narrows')).toBe(false)
    for (const def of CANYON_COUNTRY.islands) {
      if (CANYON_SLAB_IDS.includes(def.id)) continue
      expect(touched.has(def.id), `no ridable rock on ${def.id}`).toBe(true)
    }
  })
})

describe('riding real canyon rock', () => {
  /** The tallest band in the region, on `canyon-elbow-tall-2`. */
  const best = () => canyon.contacts.reduce((a, c) => (c.band > a.band ? c : a))

  it('leaves the ground climbing on the first frame', () => {
    // End to end through the real mover on the real mesh, which is the only way to know that the
    // probe, the steepness gate, the entry speed and the redirect all agree with geometry that
    // was built for them rather than in spite of them.
    const [first] = chargeAtWall(canyonTerrain, best(), 1, 26)
    expect(first!.wallRideNormal).not.toBeNull()
    expect(first!.grounded).toBe(false)
    expect(first!.velocity.y).toBeGreaterThan(G.jumpSpeed)
  })

  it('and the accumulator ends the ride, not the rock', () => {
    // The inversion, stated as the thing it is. On the archipelago's best wall the rider ran out
    // of rock after 24 frames and 6.4 m and arced over the lip; here he rides 76 frames — the
    // 1.27 s a full accumulator pays for — and lets go with 40 m of wall still above him.
    const trace = chargeAtWall(canyonTerrain, best(), 200, 26)
    const rideFrames = trace.filter((s) => s.wallRideNormal !== null).length
    expect(rideFrames).toBe(76)
    const apex = trace.reduce((m, s) => Math.max(m, s.position.y), -Infinity)
    const climb = apex - best().foot.y
    expect(climb).toBeGreaterThan(20)
    // Still short of the top by a wide margin, which is what "too tall for one line" means.
    expect(climb).toBeLessThan(best().band - 30)
    // And the ride is over: charge spent, scooter stowed.
    expect(trace.at(-1)!.wallRideNormal).toBeNull()
    expect(trace.at(-1)!.scooterCharge).toBe(0)
  })

  it('climbs a median 19 m from the corridor floor, which is most of the way out of the dead air', () => {
    // The region's central route, measured rather than asserted: the dead air spans 8 to 30, and
    // one ride from the floor is what buys the height to leave it and reach the ridge lift.
    //
    // One ride per distinct wall, taken from the tallest floor-level contact on that wall, at
    // 26 m/s. Thirty walls, a median climb of 19.15 m, a best of 28.26 m and a worst of 6.29 m
    // where a neighbouring hoodoo cuts the ride short. Asserted as a band rather than as the
    // median to the centimetre, because the exact figure depends on where `resolveMovement` puts
    // a body against a noisy face, and the claim being made is about the region's scale.
    const byWall = new Map<string, Contact>()
    for (const c of canyon.contacts) {
      if (!CANYON_SLAB_IDS.includes(c.standing) || c.foot.y >= CANYON_FLOOR_Y + 8) continue
      const prev = byWall.get(c.wall)
      if (!prev || c.band > prev.band) byWall.set(c.wall, c)
    }
    expect(byWall.size).toBe(30)
    const climbs = [...byWall.values()].map((c) => climbFrom(canyonTerrain, c)).sort((a, b) => a - b)
    const median = climbs[Math.floor(climbs.length / 2)]!
    expect(median).toBeGreaterThan(17)
    expect(median).toBeLessThan(22)
    expect(climbs.at(-1)!).toBeGreaterThan(26)
    // Two thirds of the walls in the region lift a rider clear of the dead-air layer's 22 m.
    const outOfDeadAir = climbs.filter((c) => c > 16).length
    expect(outOfDeadAir).toBeGreaterThan(20)
  }, 60000)

  it('refuses the same wall to a rider who is too slow', () => {
    // The other side of the entry gate on canyon rock: below `wallRideEntrySpeed` of closing
    // speed the same approach is an ordinary collision.
    const trace = chargeAtWall(canyonTerrain, best(), 6, 4)
    for (const s of trace) expect(s.wallRideNormal).toBeNull()
  })
})
