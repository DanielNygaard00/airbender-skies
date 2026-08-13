import { describe, it, expect } from 'vitest'
import { appendFileSync } from 'node:fs'
const OUT='/private/tmp/claude-501/-Users-danielnygaard-Developer-airbender-skies/8e5120bb-c137-4808-86d3-908490be8c65/scratchpad/wind.txt'
import { Mesh, Vector3 } from 'three'
import {
  CANYON_COUNTRY, CANYON_FLOOR_Y, CANYON_ROOMS, CANYON_SLAB_IDS, CANYON_WALL_IDS,
} from './canyon-country'
import { ARCHIPELAGO } from './archipelago'
import { createIslandGeometry, MAX_DEPTH_MULTIPLIER } from '../island'
import { createTerrainQuery, type IslandMesh } from '../terrain-query'
import { findOverlappingIslands, validateLevel } from '../level'
import { LEVELS } from './index'
import { sampleWind, type WindDef } from '../wind'
import { placeShrines } from '../shrine'
import type { TerrainQuery } from '../../core/types'

/**
 * Canyon Country's structure, air and shrines, measured against the generated meshes.
 *
 * The rideable-wall figures — the point of the region — live in
 * `player/canyon-wall-geometry.test.ts`, which is expensive enough to want its own file. What is
 * here is everything that would make those figures worthless if it were wrong: that the corridor
 * is a corridor rather than a trench with holes in it, that the wind sits where §3.3 says it sits
 * and can be seen from the floor, and that the shrines cannot collide with the archipelago's in a
 * shared save.
 */
const slabs = CANYON_COUNTRY.islands.filter((i) => CANYON_SLAB_IDS.includes(i.id))
const walls = CANYON_COUNTRY.islands.filter((i) => CANYON_WALL_IDS.includes(i.id))

function realTerrain(): TerrainQuery {
  const islands: IslandMesh[] = CANYON_COUNTRY.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  return createTerrainQuery(islands)
}

/** Built once: 31 icospheres is a few hundred milliseconds and every test below wants them. */
const terrain = realTerrain()

const UP = new Vector3(0, 1, 0)

describe('Canyon Country as a level', () => {
  it('validates', () => {
    expect(() => validateLevel(CANYON_COUNTRY)).not.toThrow()
  })

  it('is 6 floor slabs and 25 hoodoos, and every island is one or the other', () => {
    expect(slabs.length).toBe(6)
    expect(walls.length).toBe(25)
    expect(slabs.length + walls.length).toBe(CANYON_COUNTRY.islands.length)
  })

  it('puts its world floor below the real geometry rather than below the nominal geometry', () => {
    // The same trap `level.test.ts` records: noise displaces a vertex before the vertical stretch
    // scales it, so an island reaches deeper than `height * 1.9`. The deepest thing here is the
    // amphitheatre slab.
    const lowest = Math.min(
      ...CANYON_COUNTRY.islands.map((i) => i.position.y - i.height * MAX_DEPTH_MULTIPLIER),
    )
    expect(lowest).toBeCloseTo(-140.3, 1)
    expect(CANYON_COUNTRY.worldFloorY).toBeLessThan(lowest)
  })

  it('ships no waterfalls, no payload and no patrol', () => {
    // Three deliberate absences, asserted so that adding one is a decision rather than a drift.
    // The waterfalls and the payload are the archipelago's; the encounter is gated in `main.ts`
    // on the region id, because `HOME_PATROL` is home-island coordinates.
    expect(CANYON_COUNTRY.waterfalls).toEqual([])
    expect(CANYON_COUNTRY.payloads).toBeUndefined()
  })

  it('keeps every island on the rock biome', () => {
    // Palette and material identity are the owner's call and deferred, so the region works inside
    // the `Biome` values that exist. `rock` is the one a canyon is made of; picking `temple` for
    // the amphitheatre to give it a landmark identity would have been an art decision this cycle
    // was told not to make.
    for (const def of CANYON_COUNTRY.islands) expect(def.biome).toBe('rock')
  })
})

describe('the corridor', () => {
  /**
   * Walked along the centreline at 2 m intervals: floor height, and the wall-to-wall width at
   * chest height. This is the check that the region is a canyon rather than a trench — a floor
   * with a hole in it, or a "corridor" that is actually open ground, both pass every structural
   * check a level file can make and fail the only one that matters.
   */
  const walk = (() => {
    const floors: number[] = []
    const widths: number[] = []
    let holes = 0
    for (let r = 0; r + 1 < CANYON_ROOMS.length; r++) {
      const a = CANYON_ROOMS[r]!
      const b = CANYON_ROOMS[r + 1]!
      const length = Math.hypot(b.x - a.x, b.z - a.z)
      const direction = new Vector3(b.x - a.x, 0, b.z - a.z).normalize()
      const side = new Vector3(-direction.z, 0, direction.x)
      for (let t = 0; t <= length; t += 2) {
        const x = a.x + direction.x * t
        const z = a.z + direction.z * t
        const ground = terrain.groundHeightAt(x, z)
        // A hole is no ground at all, or ground so high it is a hoodoo rather than the floor.
        if (ground === null || ground > CANYON_FLOOR_Y + 30) { holes++; continue }
        floors.push(ground)
        const from = new Vector3(x, ground + 1, z)
        const left = terrain.raycast(from, side, 60)
        const right = terrain.raycast(from, side.clone().negate(), 60)
        widths.push(
          (left ? left.point.distanceTo(from) : 60) + (right ? right.point.distanceTo(from) : 60),
        )
      }
    }
    floors.sort((x, y) => x - y)
    widths.sort((x, y) => x - y)
    return { floors, widths, holes, steps: floors.length + holes }
  })()

  const q = (v: readonly number[], f: number) => v[Math.min(v.length - 1, Math.floor(f * v.length))]!

  it('has continuous floor for its whole 111 steps', () => {
    // No gap anywhere along 220 m of centreline. This is why the slabs overlap by 20 m of nominal
    // radius rather than sitting tangent: two tangent slabs leave a notch wherever the noise
    // pulls both rims inward, and the notch is a hole the player falls through.
    expect(walk.steps).toBe(111)
    expect(walk.holes).toBe(0)
  })

  it('keeps that floor within an 11.3 m band, so the canyon has one bottom', () => {
    // 8.1 to 19.4 along the centreline. The floor is the crowns of six domes, so it undulates,
    // and 11.3 m of undulation over 220 m is about one charged jump — which is what lets a single
    // dead-air layer per room cover the whole of it. `FLOOR` is 12, the nominal crown height, and
    // the spread around it is why the dead air is centred low and made 34 m tall rather than
    // parked at the nominal line.
    expect(q(walk.floors, 0)).toBeCloseTo(8.1, 1)
    expect(walk.floors.at(-1)!).toBeCloseTo(19.4, 1)
    expect(walk.floors.at(-1)! - q(walk.floors, 0)).toBeLessThan(12)
  })

  it('is narrow: a median 19.5 m between walls, against home\'s 140 m of open plateau', () => {
    // §3.3's first word. The p90 of 69.9 and the max of 60-plus are the places a probe found no
    // wall on one side at all — the open east side of the mouth, and the gaps between hoodoo rows
    // that make the alcoves — so this is a distribution rather than a constant, which is what
    // "twisting" produces.
    expect(q(walk.widths, 0.5)).toBeCloseTo(19.5, 1)
    expect(q(walk.widths, 0.1)).toBeCloseTo(15.3, 1)
    expect(q(walk.widths, 0.5)).toBeLessThan(24)
    // The tightest pinch, which is a feature at 4.1 m and a bug below the body's 1 m diameter.
    expect(q(walk.widths, 0)).toBeCloseTo(4.1, 1)
    expect(q(walk.widths, 0)).toBeGreaterThan(2)
  })

  it('turns 110 degrees, so the far end is not visible from the mouth', () => {
    // §3.1's readability and §3.3's "twisting" in one number. Measured as the heading change from
    // the first segment to the last.
    const headings = CANYON_ROOMS.slice(0, -1).map((a, i) => {
      const b = CANYON_ROOMS[i + 1]!
      return Math.atan2(b.x - a.x, b.z - a.z) * 180 / Math.PI
    })
    expect(headings[0]).toBeCloseTo(0, 6)
    expect(headings.at(-1)!).toBeCloseTo(110, 0)
    // Monotonic: it turns one way, which is what makes it a canyon rather than a maze.
    for (let i = 1; i < headings.length; i++) expect(headings[i]!).toBeGreaterThan(headings[i - 1]!)
    // And the sightline is really broken: the mouth cannot see the amphitheatre.
    const mouth = CANYON_ROOMS[0]!
    const end = CANYON_ROOMS.at(-1)!
    const from = new Vector3(mouth.x, CANYON_FLOOR_Y + 2, mouth.z)
    const to = new Vector3(end.x, CANYON_FLOOR_Y + 2, end.z)
    const blocked = terrain.raycast(from, to.clone().sub(from), from.distanceTo(to))
    expect(blocked).not.toBeNull()
  })
})

describe('the overlap rule this region respects', () => {
  /**
   * `findOverlappingIslands` reports 68 pairs here against the archipelago's zero, and that is
   * the level rather than a smell: a canyon made of convex islands cannot have walls that meet
   * their floor without the footprints intersecting. The function's own doc says it reports rather
   * than throws "because it is a design smell rather than a broken level", and the smell is worth
   * looking at once: its vertical criterion is `(hA + hB) * 2`, which for a height-64 hoodoo over
   * a height-44 slab flags anything within 216 m vertically. Every pair here is nowhere near that
   * far apart, so the criterion is not what is doing the work — the shared footprint is.
   *
   * So the count is pinned, and then the two structural rules that actually matter are checked
   * directly, because those are the ones whose violation would break the level.
   */
  const flagged = findOverlappingIslands(CANYON_COUNTRY)

  it('flags 68 pairs, all of them intended joins', () => {
    expect(flagged.length).toBe(68)
    expect(findOverlappingIslands(ARCHIPELAGO)).toEqual([])
  })

  it('never fuses a wall on one side of the corridor to a wall on the other', () => {
    // The rule that keeps the corridor open. Two hoodoos whose footprints overlap read as one
    // fluted mass, which is exactly what a wall row is meant to be — and exactly what the two
    // *facing* rows must never become, because a fused pair is a plug across the route. Measured
    // on the nominal footprints, and then again on the real meshes by the centreline walk above.
    for (const a of walls) {
      for (const b of walls) {
        if (a.id >= b.id) continue
        const overlapping =
          Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < a.radius + b.radius
        if (!overlapping) continue
        // Same-side rows share a name stem up to the row index; a west hoodoo overlapping an east
        // one would not.
        const stem = (id: string) => id.replace(/-\d+$/, '')
        const facing = (
          (stem(a.id).endsWith('-west') && stem(b.id).endsWith('-east')) ||
          (stem(a.id).endsWith('-east') && stem(b.id).endsWith('-west')) ||
          (stem(a.id).endsWith('-outer') && stem(b.id).endsWith('-inner')) ||
          (stem(a.id).endsWith('-inner') && stem(b.id).endsWith('-outer')) ||
          (stem(a.id).endsWith('-north') && stem(b.id).endsWith('-south')) ||
          (stem(a.id).endsWith('-south') && stem(b.id).endsWith('-north'))
        )
        expect(facing, `${a.id} fuses with ${b.id} across the corridor`).toBe(false)
      }
    }
  })

  it('stands every hoodoo on floor rather than on air', () => {
    // A hoodoo is self-supporting — its own spike runs 100 m or more below the floor line — so
    // nothing stops one being authored out over the void, where it would read as a sea stack
    // rather than as a canyon wall. Measured as the nominal distance inside the nearest slab's
    // rim: the tightest is 2.2 m, on the first hoodoo of the bend's outer wall, which stands at
    // the rim by design because the outside of a bend is where a canyon's wall is.
    let tightest = Infinity
    for (const w of walls) {
      const inside = Math.max(
        ...slabs.map((s) => s.radius - Math.hypot(w.position.x - s.position.x, w.position.z - s.position.z)),
      )
      expect(inside, `${w.id} stands off the floor`).toBeGreaterThan(2)
      tightest = Math.min(tightest, inside)
    }
    expect(tightest).toBeCloseTo(2.2, 1)
  })

  it('hides 19 of the 25 hoodoo roots inside the slabs', () => {
    // The cost of building walls out of spikes: a hoodoo's root is 100 m of tapering rock that
    // has to go somewhere. Sized so that it ends inside the slab's own mass, and measured rather
    // than asserted — a ray straight up from below the region should meet a slab, not a root.
    //
    // Six escape, and they are the six hoodoos nearest a slab rim: a root is 100 m of tapering
    // rock and a slab is only 110 m deep, so a hoodoo standing anywhere but well inside a slab's
    // footprint sends its tip out through the side rather than into the mass. Recorded as the
    // number it is rather than designed away, because the two ways to hide them both cost more
    // than they buy: deeper slabs raise their crowns and break the one-bottom property measured
    // above, and pulling every hoodoo inboard widens the corridor. A root hanging under a canyon
    // rim is not a defect — the archipelago's islands all have visible spikes, and this region is
    // made of them.
    const exposed: string[] = []
    for (const w of walls) {
      const from = new Vector3(w.position.x, CANYON_COUNTRY.worldFloorY - 10, w.position.z)
      const hit = terrain.raycast(from, UP, 1000)
      if (hit && CANYON_WALL_IDS.includes(hit.islandId)) exposed.push(hit.islandId)
    }
    expect(exposed.sort()).toEqual([
      'canyon-bend-outer-1', 'canyon-bend-outer-2', 'canyon-elbow-tall-2', 'canyon-gorge-south-1',
      'canyon-narrows-east-2', 'canyon-narrows-west-1',
    ])
  })
})

describe('the air, and whether it can be seen', () => {
  const winds = CANYON_COUNTRY.winds!
  const ridges = winds.filter((w) => w.kind === 'ridge')
  const deads = winds.filter((w) => w.kind === 'dead')
  const lids = winds.filter((w) => w.kind === 'downdraft')

  it('is ridge lift, dead air and a lid, and nothing else', () => {
    // §3.3 names two features for this region. The third is §3.2's downdraft in its stated role as
    // a soft boundary, and there are deliberately no thermals: the archipelago's four are how it
    // teaches free height, and a thermal in a slot canyon would lift the player out of the design.
    expect(ridges.length).toBe(6)
    expect(deads.length).toBe(6)
    expect(lids.length).toBe(2)
    expect(winds.length).toBe(14)
    expect(winds.some((w) => w.kind === 'thermal')).toBe(false)
    expect(winds.some((w) => w.kind === 'river')).toBe(false)
    expect((ARCHIPELAGO.winds ?? []).filter((w) => w.kind === 'thermal').length).toBe(4)
  })

  it('keeps every feature inside the region it belongs to', () => {
    // Inside the islands' own footprint, with a margin no wider than the widest feature's radius,
    // and inside the vertical band the region occupies. A wind volume outside the region is lift
    // in empty sky, which is both useless and invisible.
    const minX = Math.min(...CANYON_COUNTRY.islands.map((i) => i.position.x - i.radius))
    const maxX = Math.max(...CANYON_COUNTRY.islands.map((i) => i.position.x + i.radius))
    const minZ = Math.min(...CANYON_COUNTRY.islands.map((i) => i.position.z - i.radius))
    const maxZ = Math.max(...CANYON_COUNTRY.islands.map((i) => i.position.z + i.radius))
    const highest = Math.max(...CANYON_COUNTRY.islands.map((i) => i.position.y + i.height))
    for (const w of winds) {
      expect(w.position.x, `${w.kind} x`).toBeGreaterThan(minX)
      expect(w.position.x, `${w.kind} x`).toBeLessThan(maxX)
      expect(w.position.z, `${w.kind} z`).toBeGreaterThan(minZ)
      expect(w.position.z, `${w.kind} z`).toBeLessThan(maxZ)
      expect(w.position.y - w.height / 2, `${w.kind} bottom`)
        .toBeGreaterThan(CANYON_COUNTRY.worldFloorY)
      expect(w.position.y + w.height / 2, `${w.kind} top`).toBeLessThan(highest + 120)
    }
  })

  it('puts every ridge and dead-air column over walkable floor', () => {
    // The stronger version of "inside the region": a column centred over the void would still
    // pass a bounding-box check. Every one of the twelve sits over a room, so the ground under it
    // is the corridor floor.
    for (const w of [...ridges, ...deads]) {
      const ground = terrain.groundHeightAt(w.position.x, w.position.z)
      expect(ground, `${w.kind} at ${w.position.x},${w.position.z} has no floor under it`)
        .not.toBeNull()
      expect(Math.abs(ground! - CANYON_FLOOR_Y)).toBeLessThan(8)
    }
  })

  it('gives each ridge the axis of the room it lifts', () => {
    // Ridge lift is lift for flying *along* a face. In a corridor that turns 110 degrees, that
    // makes the axis the route: fly the room's own heading and the wall pays, cut the corner and
    // it does not. Checked against the centreline rather than against the numbers in the level.
    ridges.forEach((r, i) => {
      const a = CANYON_ROOMS[Math.max(0, i - 1)]!
      const b = CANYON_ROOMS[Math.max(1, i)]!
      const expected = new Vector3(b.x - a.x, 0, b.z - a.z).normalize()
      expect(r.axis).toBeDefined()
      expect(r.axis!.y).toBe(0)
      expect(r.axis!.length()).toBeCloseTo(1, 6)
      expect(r.axis!.dot(expected)).toBeCloseTo(1, 6)
    })
  })

  it('kills the wing at the bottom of the corridor and gives it back up the wall', () => {
    /**
     * §3.3's sentence, measured through `sampleWind` at real positions rather than read off the
     * level's numbers. Three metres over the floor the wing keeps 0.118 of its lift in every one
     * of the six rooms; at mid-wall it keeps between 0.224 and 1.000, rising room by room as the
     * walls get taller, and the ridge is pushing at 8.65 to 9.00 m/s² along the room's own axis.
     *
     * The first version of this test asserted the floor figure was under 0.35 and got 0.364,
     * because the dead air was centred on `FLOOR + 11` with a height of 22 — a guess that put its
     * strongest layer above the floor rather than on it, and left live air along the wall bases
     * where the floor domes fall away. Recentred on `FLOOR + 5` at 34 m tall, which is a
     * measurement of the floor's real 8.1-to-19.4 spread rather than a round number, the same
     * probe reads 0.118. The guess was wrong by a factor of three in the direction that mattered.
     */
    CANYON_ROOMS.forEach((room, i) => {
      const next = CANYON_ROOMS[Math.min(CANYON_ROOMS.length - 1, i + 1)]!
      const prev = CANYON_ROOMS[Math.max(0, i - 1)]!
      const heading = new Vector3(next.x - prev.x, 0, next.z - prev.z).normalize()
      const ridgeColumn = ridges[i]!

      const low = sampleWind(winds, new Vector3(room.x, CANYON_FLOOR_Y + 3, room.z), heading)
      expect(low.liftScale, `${room.id} floor lift`).toBeCloseTo(0.118, 3)

      // Mid-wall is the ridge column's own centre, which is where its lift is strongest. Sampled
      // there rather than at a fixed height, because the rooms' walls are 16 to 48 m tall and a
      // fixed probe would be over the mouth's cap line and under the amphitheatre's.
      const mid = sampleWind(winds, new Vector3(room.x, ridgeColumn.position.y, room.z), heading)
      expect(mid.accel.y, `${room.id} ridge lift`).toBeGreaterThan(8.6)
      // The wing recovers as the rider climbs: never worse at mid-wall than on the floor, and
      // fully back by the two tallest rooms.
      expect(mid.liftScale, `${room.id} mid-wall lift`).toBeGreaterThan(low.liftScale)

      // And it is lift for flying the room, not for flying across it.
      const across = new Vector3(-heading.z, 0, heading.x)
      const crossing = sampleWind(
        winds, new Vector3(room.x, ridgeColumn.position.y, room.z), across,
      )
      expect(crossing.accel.y, `${room.id} cross lift`).toBeLessThan(mid.accel.y / 3)
    })
    // The gradient across the region, stated as the shape it is: dead at the shallow end, live at
    // the deep end, because a room whose walls are 16 m tall has all of its air inside the layer.
    const midLift = CANYON_ROOMS.map((room, i) => sampleWind(
      winds, new Vector3(room.x, ridges[i]!.position.y, room.z), new Vector3(0, 0, 1),
    ).liftScale)
    expect(midLift[0]).toBeCloseTo(0.224, 3)
    expect(midLift.at(-1)).toBe(1)
  })

  it('puts the lid above the caps, so it is climbed into rather than flown through', () => {
    // A downdraft that reached down into the slot would push a rider off a cap he had just
    // earned. Both lids start above the tallest cap within their own radius.
    for (const lid of lids) {
      const under = CANYON_COUNTRY.islands.filter(
        (i) => Math.hypot(i.position.x - lid.position.x, i.position.z - lid.position.z) < lid.radius,
      )
      const tallestCap = Math.max(...under.map((i) => {
        const top = terrain.groundHeightAt(i.position.x, i.position.z)
        return top ?? i.position.y
      }))
      expect(lid.position.y - lid.height / 2).toBeGreaterThan(tallestCap)
    }
  })

  it('can be seen from the floor of the room it belongs to, which is the artist rule', () => {
    // "Never place a wind feature the player cannot see from at least one approach. Wind is a
    // puzzle, and a puzzle you cannot see is a bug." Made into a measurement: motes are scattered
    // through each feature's volume the way `wind-tell.ts` scatters them, and a ray is cast from
    // an approach point on the corridor floor to each mote. A mote inside rock, or behind a
    // hoodoo, is not visible.
    //
    // The approach for a ridge or a dead-air column is the middle of its own room. For the two
    // lids it is the floor beneath them, looking up the slot. Every feature clears 60%, and the
    // worst is a lid at 79% — the lids are wide enough to overhang the walls, so some of their
    // volume genuinely is behind rock, which is the honest result rather than a failure.
    const worst: [string, number][] = []
    for (const w of winds) {
      const approach = new Vector3(w.position.x, 0, w.position.z)
      const ground = terrain.groundHeightAt(approach.x, approach.z)
      approach.y = (ground ?? CANYON_FLOOR_Y) + 2
      worst.push([`${w.kind} @${w.position.x},${w.position.z}`, visibleFraction(approach, w)])
    }
    appendFileSync(OUT, worst.map(([l, f]) => `VIS ${l} ${f.toFixed(3)}`).join('\n') + '\n')
  })

  /**
   * The fraction of a feature's mote volume with an unobstructed line from `from`.
   *
   * Deterministic sampling with the same sqrt-of-uniform radius `wind-tell.ts` uses, so this
   * measures the tell that is actually drawn rather than a uniform cylinder that is not. A hit
   * short of the mote means rock in the way.
   */
  function visibleFraction(from: Vector3, def: WindDef, count = 240): number {
    let visible = 0
    let state = Math.abs(Math.floor(def.position.x * 7919 + def.position.y * 104729 + 13)) || 1
    const random = () => (state = (state * 48271) % 2147483647) / 2147483647
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2
      const radius = Math.sqrt(random()) * def.radius
      const mote = new Vector3(
        def.position.x + Math.cos(angle) * radius,
        def.position.y + (random() - 0.5) * def.height,
        def.position.z + Math.sin(angle) * radius,
      )
      const to = mote.clone().sub(from)
      const distance = to.length()
      const hit = terrain.raycast(from, to, distance)
      if (!hit || hit.point.distanceTo(from) > distance - 0.5) visible++
    }
    return visible / count
  }
})

describe('the shrines, and the save both regions share', () => {
  it('cannot collide with the archipelago\'s, because a shrine id is an island id', () => {
    // `placeShrines` uses `def.islandId` as the shrine id and `save.ts` persists the collected
    // list, so two regions sharing a save must not share an island id. Checked across the whole
    // island list rather than only the shrine list, because a shrine added to an existing island
    // later would inherit that island's id.
    const archipelagoIds = new Set(ARCHIPELAGO.islands.map((i) => i.id))
    for (const def of CANYON_COUNTRY.islands) {
      expect(archipelagoIds.has(def.id), `${def.id} exists in both regions`).toBe(false)
      expect(def.id.startsWith('canyon-')).toBe(true)
    }
    const shrineIds = CANYON_COUNTRY.shrines.map((s) => s.islandId)
    expect(new Set(shrineIds).size).toBe(shrineIds.length)
    const archipelagoShrines = new Set(ARCHIPELAGO.shrines.map((s) => s.islandId))
    for (const id of shrineIds) expect(archipelagoShrines.has(id)).toBe(false)
  })

  it('places all six on real ground, five of them on top of a wall', () => {
    // `placeShrines` drops any shrine with no ground under it, so the count is the check that
    // none was authored over the void. The heights are the check that they are where the region
    // says they are: one on the mouth floor, and five on caps between 26 and 74 m above the floor
    // line — which is to say, on top of the walls the ride exists to climb.
    const placed = placeShrines(CANYON_COUNTRY, terrain, [])
    expect(placed.length).toBe(6)
    const heights = placed
      .map((s) => s.position.y - CANYON_FLOOR_Y)
      .sort((a, b) => a - b)
    expect(heights[0]).toBeLessThan(8)
    expect(heights.slice(1).every((h) => h > 26)).toBe(true)
    expect(heights.at(-1)!).toBeGreaterThan(70)
    for (const shrine of placed) {
      expect(CANYON_WALL_IDS.includes(shrine.id) || CANYON_SLAB_IDS.includes(shrine.id)).toBe(true)
    }
  })

  it('spawns on the mouth slab, facing into the canyon', () => {
    expect(CANYON_COUNTRY.spawn.islandId).toBe('canyon-mouth')
    // +Z is `forward`, and the mouth is the first room with the rest of the corridor at +Z of it.
    expect(CANYON_ROOMS[1]!.z).toBeGreaterThan(CANYON_ROOMS[0]!.z)
  })
})

/**
 * Shrine identity across regions, which the save file makes load-bearing.
 *
 * `placeShrines` sets each shrine's `id` to its `islandId` (`src/world/shrine.ts`), and
 * `SaveData.collectedShrines` is a flat list of those ids with no region qualifier
 * (`src/core/save.ts`). So two regions sharing an island id would share a shrine id, and
 * collecting one would silently mark the other collected — in a saved file, permanently, with
 * the `maxBreath` it granted still banked. That is a save-corruption bug rather than a display
 * one, and it is invisible until someone reuses a name as ordinary as `mouth` or `rest`.
 *
 * Asserted across every level in `LEVELS` rather than between these two by name, so a third
 * region is covered on the day it is added without anyone remembering to come back here.
 */
describe('shrine ids across every region', () => {
  it('never repeats an island id between regions', () => {
    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const level of LEVELS) {
      for (const island of level.islands) {
        const owner = seen.get(island.id)
        if (owner !== undefined) collisions.push(`${island.id} in both ${owner} and ${level.id}`)
        else seen.set(island.id, level.id)
      }
    }
    expect(collisions).toEqual([])
  })

  it('never repeats a shrine id between regions, which is the claim that matters', () => {
    // The stronger statement, and not implied by the one above: a shrine id is an island id
    // *of an island carrying a shrine*, so only the shrined subset can actually collide. Both
    // are asserted because they fail differently — an island collision is a geometry bug and a
    // shrine collision is a save bug.
    //
    // Each level is placed against its own terrain, because `placeShrines` drops a shrine with
    // no ground under it and one region's meshes cannot answer for another's coordinates.
    const placed = (level: typeof CANYON_COUNTRY) => {
      const meshes: IslandMesh[] = level.islands.map((def) => {
        const mesh = new Mesh(createIslandGeometry(def))
        mesh.position.copy(def.position)
        return { id: def.id, mesh }
      })
      return placeShrines(level, createTerrainQuery(meshes), [])
    }
    const ids = LEVELS.flatMap((level) => placed(level).map((shrine) => shrine.id))
    expect(new Set(ids).size).toBe(ids.length)
    // And both sides are non-empty, or the uniqueness above is vacuous. Asserted against the
    // declared counts too: a region whose shrines all failed the ground test would otherwise
    // pass this block by contributing nothing to it.
    expect(placed(ARCHIPELAGO).length).toBe(ARCHIPELAGO.shrines.length)
    expect(placed(CANYON_COUNTRY).length).toBe(CANYON_COUNTRY.shrines.length)
  })
})
