import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import { isRidableWall } from './wall-ride'
import { groundStep } from './ground-move'
import {
  DEFAULT_COLLISION_CONFIG, DEFAULT_GROUND_CONFIG,
} from '../core/config'
import type { GroundConfig, InputState, PlayerState, TerrainQuery } from '../core/types'

/**
 * How much wall this archipelago actually has, and how much of it a scooter can ride.
 *
 * The rule is tested against a clean synthetic face in `wall-ride.test.ts`, which is where a
 * rule belongs. What a fake cannot answer is whether the shipped level has anything to use it
 * on, and the honest answer is: very little. These islands are noise-displaced spheres
 * squashed to 0.35 on top and stretched to 1.9 underneath, so the genuinely vertical rock is
 * a ring near each island's equator — and most of that ring hangs below the walkable crown,
 * where a rider standing on his feet cannot reach it.
 *
 * Every figure quoted in `wallRideNormalY`'s comment in `core/config.ts` is measured here, on
 * both sides of the threshold decision, so that comment cannot drift away from the geometry
 * it claims to be justified by. Building all thirteen islands costs a few hundred
 * milliseconds, so this lives in its own file for the same reason `wall-face-reach.test.ts`
 * and `combat/patrol-placement.test.ts` do.
 */
const G = DEFAULT_GROUND_CONFIG
const DT = 1 / 60
/** Grid resolution per island: 41 x 41 over its bounding square, clipped to the radius. */
const STEPS = 41
/** Bearings probed from each position. Eight is every 45 degrees. */
const BEARINGS = 8
/** How far up a band is walked, per step, when measuring its height. */
const BAND_STEP = 0.25

function realTerrain(): TerrainQuery {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  return createTerrainQuery(islands)
}

const DOWN = new Vector3(0, -1, 0)

/**
 * How tall the ridable band is above a contact, following the wall upward.
 *
 * This is the honest measure of what a ride buys: not how tall the cliff is, but how far it
 * stays inside `threshold` of vertical, because the frame the face tilts out of that is the
 * frame the ride lets go. Walked with the same chest-height origin and `snapDistance` reach
 * the ride itself probes with, so the number is the move's and not an idealisation of it.
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
  islandId: string
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
}

/**
 * Every place on the archipelago where a rider on his feet has a wall within lateral reach.
 *
 * Two filters make this a measurement of the move rather than of the mesh. Positions are
 * restricted to footing the ground snap would actually seat a walker on — anything steeper
 * than `CollisionConfig.wallNormalY` is not somewhere a scooter can be — and the probe is the
 * ride's own: chest height, `snapDistance` of reach.
 */
function sweep(terrain: TerrainQuery, threshold: number): Sweep {
  let samples = 0
  const contacts: Contact[] = []
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
        // Standable footing only. `groundHeightAt` reports the topmost surface whatever its
        // angle, and a good deal of the topmost surface near an island's rim is cliff — see
        // `wall-face-reach.test.ts`, which measures that at 3.37% of downward hits. Counting
        // a wall reachable from a position no rider can stand on would inflate this whole
        // file, so the footing is checked before the wall is.
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
            islandId: def.id,
            foot,
            normal: hit.normal.clone(),
            band: bandHeight(terrain, from, hit.normal, threshold),
          })
        }
      }
    }
  }
  return { samples, contacts }
}

const input = (over: Partial<InputState> = {}): InputState => ({
  lookDirection: new Vector3(0, 0, -1), forward: 0, strafe: 0,
  sprint: false, tuck: false, actionPressed: false, actionHeld: false, actionReleased: false,
  scooterPressed: false, dashPressed: false, gustPressed: false, avatarStatePressed: false,
  vortexHeld: false, vortexReleased: false, slipstreamPressed: false, staffPressed: false,
  airWallHeld: false,
  radialHeld: false, radialReleased: false, pointerDelta: { x: 0, y: 0 }, elementIndex: null,
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
 * Drive a rider into a wall and report what happened.
 *
 * `state.velocity` is set to the approach rather than accelerated into it, because the entry
 * gate is about closing speed and a rider who has to spend a second building it would have
 * walked into the wall first. The stick is held the same way, so `easeHorizontal` sustains the
 * approach instead of bleeding it off.
 */
function chargeAtWall(
  terrain: TerrainQuery, contact: Contact, frames: number, speed: number, c: GroundConfig = G,
) {
  const into = new Vector3(-contact.normal.x, 0, -contact.normal.z).normalize()
  const approach = into.clone().multiplyScalar(speed)
  let state = riding(contact.foot, approach, contact.islandId)
  const held = input({ forward: 1, sprint: true, lookDirection: into.clone() })
  const trace: PlayerState[] = []
  for (let f = 0; f < frames; f++) {
    state = groundStep(state, held, DT, terrain, c, DEFAULT_COLLISION_CONFIG)
    trace.push(state)
  }
  return trace
}

describe('what the real archipelago offers a wall ride', () => {
  const terrain = realTerrain()
  const ridable = sweep(terrain, G.wallRideNormalY)
  const looser = sweep(terrain, DEFAULT_COLLISION_CONFIG.wallNormalY)

  const bands = ridable.contacts.map((c) => c.band).sort((a, b) => a - b)
  const quantile = (f: number) => bands[Math.min(bands.length - 1, Math.floor(f * bands.length))]!

  it('has very little wall a rider can actually reach, and that is a level-design gap', () => {
    // The headline finding, recorded rather than hidden. 290 of 117080 (position, bearing)
    // pairs — a quarter of one percent — put a near-vertical face within lateral reach of a
    // rider standing on footing he could actually be standing on. The move is implemented
    // correctly; this level was not built for it, and the fix is islands with real cliffs
    // rather than a looser threshold, which the test below shows does not help.
    expect(ridable.samples).toBe(117080)
    expect(ridable.contacts.length).toBe(290)
    expect((100 * ridable.contacts.length) / ridable.samples).toBeCloseTo(0.25, 2)
  })

  it('and most of what it has is a stub rather than a shortcut', () => {
    // Half the contacts run less than a metre before the face tilts out of vertical, which is
    // less than a single frame of climb at the slowest legal ride. The p90 is 1.5 m. So the
    // typical wall here is something to bounce off, and the ones worth riding are rare.
    expect(quantile(0.5)).toBeCloseTo(0.25, 6)
    expect(quantile(0.9)).toBeCloseTo(1.5, 6)
  })

  it('tops out at six metres, on the spire', () => {
    // The best wall on the map. Six metres against a full accumulator that can pay for 24 m of
    // climb, so the accumulator is nowhere near the binding limit on this archipelago — the
    // rock is. Worth knowing before anyone retunes the drain to make rides feel longer.
    const tallest = ridable.contacts.reduce((a, c) => (c.band > a.band ? c : a))
    expect(tallest.band).toBeCloseTo(6, 6)
    expect(tallest.islandId).toBe('spire')
  })

  it('is barely improved by loosening the threshold, which is why 0.25 stands', () => {
    // The measurement `wallRideNormalY` was actually chosen by, rather than the geometric
    // argument that would have been easy to write instead. Doubling the threshold to the one
    // collision already uses moves contact from 0.25% to 0.61% and the tallest band from
    // 6.00 m to 7.00 m — nothing, in exchange for the move firing on 60-degree slopes the
    // ground snap already walks up, which would read as sticking to hillsides.
    expect(looser.contacts.length).toBe(720)
    expect((100 * looser.contacts.length) / looser.samples).toBeCloseTo(0.61, 2)
    const tallest = looser.contacts.reduce((a, c) => (c.band > a.band ? c : a))
    expect(tallest.band).toBeCloseTo(7, 6)
    // And it is a superset, not a different set: every face the strict threshold accepts, the
    // loose one accepts too. A threshold that traded some walls for others would be a
    // different decision from the one the comment describes.
    expect(looser.contacts.length).toBeGreaterThan(ridable.contacts.length)
  })

  it('finds ridable rock on almost every island, so this is not one bad mesh', () => {
    const islands = new Set(ridable.contacts.map((c) => c.islandId))
    expect(islands.size).toBe(13)
  })
})

describe('riding the real rock', () => {
  const terrain = realTerrain()
  const contacts = sweep(terrain, G.wallRideNormalY).contacts
  /** The tallest band on the map: six metres on the spire. */
  const best = contacts.reduce((a, c) => (c.band > a.band ? c : a))

  it('a charged rider driven into the spire wall leaves the ground climbing', () => {
    // End to end through the real mover on the real mesh, which is the only way to know the
    // probe, the steepness gate, the entry speed and the redirect all agree with geometry that
    // was not built to suit them.
    const [first] = chargeAtWall(terrain, best, 1, 26)
    expect(first!.wallRideNormal).not.toBeNull()
    expect(first!.grounded).toBe(false)
    expect(first!.velocity.y).toBeGreaterThan(G.jumpSpeed)
  })

  it('and puts the rider down on the crown, metres above where he started', () => {
    // The payoff, measured all the way to the landing rather than mid-arc. Traced frame by
    // frame at this position: the ride runs 24 frames and 6.4 m — the wall's whole 6 m band —
    // lets go still climbing at 14 m/s, arcs over the lip, and touches down 8.26 m above the
    // footing it started on. That is the "vertical shortcut" the design document is describing,
    // and it comes out of one approach at 26 m/s with no jump spent.
    //
    // Asserted as a floor rather than as 8.26, because the exact apex depends on where
    // `resolveMovement` puts the body against a noisy face. The floor is chosen to mean
    // something: it is the wall's own height, so a rider cannot clear it by merely being
    // deflected up the face, and it is three times the 2.03 m a plain `jumpSpeed` jump reaches
    // under `gravity` — though still short of the charged jump's 10 m, which is the ordering a
    // move that costs an accumulator rather than a second of crouching ought to have.
    const trace = chargeAtWall(terrain, best, 120, 26)
    const last = trace.at(-1)!
    expect(last.grounded).toBe(true)
    expect(last.position.y - best.foot.y).toBeGreaterThan(6)
  })

  it('spends the accumulator doing it, which is the whole economy of the move', () => {
    const trace = chargeAtWall(terrain, best, 90, 26)
    // Started at 1. The drain is what ends the ride on a wall tall enough to outlast it, and
    // on this one the wall runs out first — so what this asserts is that riding cost real
    // accumulator, not that it cost all of it.
    expect(trace.at(-1)!.scooterCharge).toBeLessThan(1)
    const riding = trace.filter((s) => s.wallRideNormal !== null)
    expect(riding.length).toBeGreaterThan(1)
    // Monotonically down for every frame of the ride: nothing here builds charge back while
    // the wall is being spent, which is what `ScooterInput.wallRiding` exists to guarantee.
    for (let i = 1; i < riding.length; i++) {
      expect(riding[i]!.scooterCharge).toBeLessThan(riding[i - 1]!.scooterCharge)
    }
  })

  it('keeps the scooter up over the wall, though the rider is not grounded', () => {
    const trace = chargeAtWall(terrain, best, 90, 26)
    const riding = trace.filter((s) => s.wallRideNormal !== null)
    for (const s of riding) {
      expect(s.grounded).toBe(false)
      expect(s.scooterActive).toBe(true)
    }
  })

  it('stows the scooter once the ride is over and the rider is in the air', () => {
    // The exit leaves a sane state, and it is the same state a jump or a walked-off ledge
    // leaves: airborne, no scooter, no accumulator. One frame of lag is structural — see
    // `ScooterInput.wallRiding` — so the check is that it settles, not that it settles
    // instantly.
    const trace = chargeAtWall(terrain, best, 120, 26)
    const last = trace.at(-1)!
    expect(last.wallRideNormal).toBeNull()
    expect(last.scooterActive).toBe(false)
    expect(last.scooterCharge).toBe(0)
  })

  it('refuses the same wall to a rider who is too slow', () => {
    // The other side of the entry gate, on real rock rather than on a synthetic plane: below
    // `wallRideEntrySpeed` of closing speed the same approach is an ordinary collision, and
    // `resolveMovement` skims the rider along the face instead.
    const trace = chargeAtWall(terrain, best, 6, 4)
    for (const s of trace) expect(s.wallRideNormal).toBeNull()
  })

  it('refuses the same wall to a rider with no scooter', () => {
    const into = new Vector3(-best.normal.x, 0, -best.normal.z).normalize()
    let state: PlayerState = {
      ...riding(best.foot, into.clone().multiplyScalar(26), best.islandId),
      scooterActive: false, scooterCharge: 0,
    }
    const held = input({ forward: 1, sprint: true, lookDirection: into.clone() })
    for (let f = 0; f < 6; f++) {
      state = groundStep(state, held, DT, terrain, G, DEFAULT_COLLISION_CONFIG)
      expect(state.wallRideNormal).toBeNull()
    }
  })
})

describe('the steepness gate against the shipped meshes', () => {
  const terrain = realTerrain()

  it('rejects the stretched undersides, which a one-sided threshold would accept', () => {
    // Why `isRidableWall` bounds the tilt in both directions. Below the equator these islands
    // overhang, so a lateral probe there meets faces whose `normal.y` is strongly negative —
    // every one of which passes `normal.y < wallRideNormalY` and none of which can be ridden.
    // Measured rather than assumed: this walks the underside of `home` and counts them.
    const def = ARCHIPELAGO.islands.find((i) => i.id === 'home')!
    let overhangs = 0
    let accepted = 0
    for (let b = 0; b < 48; b++) {
      const angle = (2 * Math.PI * b) / 48
      const dir = new Vector3(Math.cos(angle), 0, Math.sin(angle))
      for (let y = -def.height * 0.5; y < -def.height * 0.1; y += 1) {
        const from = def.position.clone().addScaledVector(dir, def.radius * 2.2)
        from.y = def.position.y + y
        const hit = terrain.raycast(from, dir.clone().negate(), def.radius * 3)
        if (!hit || hit.normal.y >= 0) continue
        // Downward-facing, and steep enough that a one-sided test would call it a wall.
        if (hit.normal.y < -G.wallRideNormalY) {
          overhangs++
          if (isRidableWall(hit.normal, G)) accepted++
        }
      }
    }
    expect(overhangs).toBeGreaterThan(100)
    expect(accepted).toBe(0)
  })
})
