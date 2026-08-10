import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import { DEFAULT_COMBAT_CONFIG, HOME_PATROL } from './config'
import { spawnEnemy, type Enemy } from './enemy'
import { waveRadius, waveTargets } from './pressure-wave'
import { vortexRadius, vortexTargets } from './vortex'
import { gustTargets } from './gust'
import { staffTargets } from './staff-arc'

/**
 * The four moves' vertical extents, fired at the real patrol on the real island.
 *
 * The boundary tests in `cone.test.ts`, `gust.test.ts`, `pressure-wave.test.ts` and
 * `vortex.test.ts` prove the height band exists. They cannot prove it is the right size,
 * because they all fire from a fixture origin at a fixture target. Asserting that a soldier
 * 2000 m below is out of reach passes for any band that clamps at all, including one clamped
 * far too tightly.
 *
 * Over-tightening is the risk this change actually carries: a fight that used to work quietly
 * stopping working, with no test to say so. So this file measures the other direction — every
 * soldier that ought to be hittable still is — against `HOME_PATROL` standing on the ground
 * `groundHeightAt` actually reports.
 *
 * **The reference is the move's own horizontal footprint**, obtained by running the same
 * target function with `verticalReach` set to `Infinity`. That is precisely the pre-cycle
 * behaviour, so every comparison below reads as "what did adding the band take away". It
 * beats a hand-written expectation because it cannot drift from the shipped horizontal reach.
 *
 * Own file rather than an addition to `encounter.test.ts` for the reason
 * `patrol-placement.test.ts` and `player/terrain-collision.test.ts` are also their own files:
 * building all thirteen islands' geometry costs a couple of hundred milliseconds, and
 * `encounter.test.ts` is a fast fixture suite whose enemies stand on level fake ground by
 * design. The terrain fixture here follows `patrol-placement.test.ts` rather than inventing a
 * second way to build one.
 */

/** No band at all: the move's horizontal footprint, which is what it hit before this cycle. */
const FLAT = Number.POSITIVE_INFINITY

const C = DEFAULT_COMBAT_CONFIG

/**
 * A move, parameterised on the band so the same call can be asked both questions.
 *
 * The two radial moves' reach grows with fall speed and charge, so each appears twice: at
 * the weakest qualifying input and at full. The weakest matters more than it looks — that is
 * where `pressureWave.verticalReach` sits exactly on `minRadius`.
 */
interface Move {
  name: string
  /** Horizontal reach at this strength. */
  reach: number
  band: number
  catch: (origin: Vector3, forward: Vector3, enemies: readonly Enemy[], band: number) => Enemy[]
}

const MOVES: Move[] = [
  {
    name: 'staff opener',
    reach: C.staffArc.opener.range,
    band: C.staffArc.opener.verticalReach,
    catch: (o, f, e, band) => staffTargets(o, f, false, e, {
      ...C.staffArc, opener: { ...C.staffArc.opener, verticalReach: band },
    }),
  },
  {
    name: 'staff finisher',
    reach: C.staffArc.finisher.range,
    band: C.staffArc.finisher.verticalReach,
    catch: (o, f, e, band) => staffTargets(o, f, true, e, {
      ...C.staffArc, finisher: { ...C.staffArc.finisher, verticalReach: band },
    }),
  },
  {
    name: 'gust',
    reach: C.gust.range,
    band: C.gust.verticalReach,
    catch: (o, f, e, band) => gustTargets(o, f, e, { ...C.gust, verticalReach: band }),
  },
  {
    name: 'vortex, least charge',
    reach: vortexRadius(0, C.vortex),
    band: C.vortex.verticalReach,
    catch: (o, _f, e, band) => vortexTargets(o, e, 0, { ...C.vortex, verticalReach: band }),
  },
  {
    name: 'vortex, full charge',
    reach: vortexRadius(1, C.vortex),
    band: C.vortex.verticalReach,
    catch: (o, _f, e, band) => vortexTargets(o, e, 1, { ...C.vortex, verticalReach: band }),
  },
  {
    name: 'wave, weakest slam',
    reach: waveRadius(0, C.pressureWave),
    band: C.pressureWave.verticalReach,
    catch: (o, _f, e, band) => waveTargets(o, e, 0, { ...C.pressureWave, verticalReach: band }),
  },
  {
    name: 'wave, full slam',
    reach: waveRadius(1, C.pressureWave),
    band: C.pressureWave.verticalReach,
    catch: (o, _f, e, band) => waveTargets(o, e, 1, { ...C.pressureWave, verticalReach: band }),
  },
]

/**
 * Terrain, patrol and a ground-height memo, built once for the file.
 *
 * The memo is the reason the sweeps below are affordable: the stance grids for the
 * seven move strengths overlap heavily, and every `groundHeightAt` is a raycast against
 * thirteen meshes.
 */
function fixture() {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  const terrain = createTerrainQuery(islands)

  const cache = new Map<string, number | null>()
  const ground = (x: number, z: number): number | null => {
    const key = `${x.toFixed(3)},${z.toFixed(3)}`
    const seen = cache.get(key)
    if (seen !== undefined) return seen
    const height = terrain.groundHeightAt(x, z)
    cache.set(key, height)
    return height
  }

  const patrol: Enemy[] = HOME_PATROL.map((spawn) => {
    const height = ground(spawn.position.x, spawn.position.z)
    if (height === null) throw new Error(`${spawn.id} has no ground beneath it`)
    const enemy = spawnEnemy(spawn.id, spawn.position, spawn.kind, C.enemies[spawn.kind])
    // Where the first ground snap in `stepEnemy` leaves it: position.y is the surface, not
    // a body centre, and the player's position.y is the surface too, so `|dy|` below is a
    // straight difference of two terrain heights.
    enemy.position.y = height
    return enemy
  })

  return { terrain, ground, patrol }
}

let shared: ReturnType<typeof fixture> | null = null
function shared_() {
  shared ??= fixture()
  return shared
}

/** The grid the stance sweeps walk. Fine enough to land within 0.25 m of any rim. */
const STEP = 0.25

interface Sweep {
  move: string
  soldier: string
  /** Stances whose horizontal footprint holds the soldier — the pre-cycle behaviour. */
  inFootprint: number
  /** Of those, the ones the shipped band still catches. */
  stillHit: number
  /** Furthest stance in the footprint, and the furthest that still connects. */
  furthestFlat: number
  furthestBanded: number
  /** `|dy|` extremes over the footprint, and over just the stances the band dropped. */
  worstGapInFootprint: number
  leastGapDropped: number
  worstGapDropped: number
}

/**
 * Every stance on real ground inside a move's horizontal footprint of one soldier.
 *
 * Facing is straight at the soldier, which is what a player aiming at it would do — the
 * cone moves would otherwise be measuring the player's aim rather than the height band.
 */
function sweep(move: Move, target: Enemy): Sweep {
  const { ground } = shared_()
  const row: Sweep = {
    move: move.name, soldier: target.id,
    inFootprint: 0, stillHit: 0,
    furthestFlat: 0, furthestBanded: 0,
    worstGapInFootprint: 0, leastGapDropped: Infinity, worstGapDropped: 0,
  }
  for (let dx = -move.reach; dx <= move.reach; dx += STEP) {
    for (let dz = -move.reach; dz <= move.reach; dz += STEP) {
      const distance = Math.hypot(dx, dz)
      // The degenerate-origin case belongs to `cone.test.ts`; here it would only measure
      // the distance guard.
      if (distance > move.reach || distance < 1e-6) continue
      const x = target.position.x + dx
      const z = target.position.z + dz
      const height = ground(x, z)
      // Null is the void past the island rim. A player cannot stand there.
      if (height === null) continue
      const origin = new Vector3(x, height, z)
      const forward = new Vector3(-dx, 0, -dz).normalize()
      if (move.catch(origin, forward, [target], FLAT).length === 0) continue

      row.inFootprint++
      row.furthestFlat = Math.max(row.furthestFlat, distance)
      const gap = Math.abs(target.position.y - height)
      row.worstGapInFootprint = Math.max(row.worstGapInFootprint, gap)
      if (move.catch(origin, forward, [target], move.band).length > 0) {
        row.stillHit++
        row.furthestBanded = Math.max(row.furthestBanded, distance)
      } else {
        row.leastGapDropped = Math.min(row.leastGapDropped, gap)
        row.worstGapDropped = Math.max(row.worstGapDropped, gap)
      }
    }
  }
  return row
}

let sweptCache: Sweep[] | null = null
function swept(): Sweep[] {
  if (sweptCache) return sweptCache
  const { patrol } = shared_()
  const rows: Sweep[] = []
  for (const move of MOVES) for (const soldier of patrol) rows.push(sweep(move, soldier))
  sweptCache = rows
  // Logged before anything is asserted, because every number asserted below was read off
  // this table first and the table is the evidence for the ones in the comments.
  console.log('\n=== stances on real ground inside each move\'s horizontal footprint ===')
  for (const r of rows) {
    console.log(
      `${r.move.padEnd(21)} ${r.soldier.padEnd(9)}`
      + ` footprint=${String(r.inFootprint).padStart(5)}`
      + ` stillHit=${String(r.stillHit).padStart(5)}`
      + ` (${((100 * r.stillHit) / r.inFootprint).toFixed(1)}%)`
      + ` furthest flat=${r.furthestFlat.toFixed(2)} banded=${r.furthestBanded.toFixed(2)}`
      + ` worst|dy|=${r.worstGapInFootprint.toFixed(3)}`
      + ` dropped|dy| ${r.leastGapDropped === Infinity ? 'none' : `${r.leastGapDropped.toFixed(3)}..${r.worstGapDropped.toFixed(3)}`}`,
    )
  }
  return rows
}

function rowsFor(move: string): Sweep[] {
  const found = swept().filter((r) => r.move === move)
  if (found.length === 0) throw new Error(`no sweep for ${move}`)
  return found
}

describe('the vertical extents against the real archipelago', () => {
  it('takes nothing off any move\'s reach against any soldier', () => {
    // The discriminating claim, and the one that would catch a band tightened until a fight
    // stopped working: for every move at every strength against every soldier, the furthest
    // stance on real ground that connects is the same stance it was before the band existed.
    // No move lost a metre of standoff against anyone in the patrol.
    //
    // Asserted as an equality between two measurements rather than against the config's
    // ranges, so it stays true if a horizontal reach is retuned.
    for (const r of swept()) {
      expect(
        r.furthestBanded,
        `${r.move} lost standoff against ${r.soldier}: `
        + `${r.furthestFlat.toFixed(2)} without the band, ${r.furthestBanded.toFixed(2)} with it`,
      ).toBe(r.furthestFlat)
      // And the footprint is not empty, so the equality above is not vacuous.
      expect(r.inFootprint, `${r.move} has no stance at all against ${r.soldier}`)
        .toBeGreaterThan(0)
    }
  })

  it('costs the three spears nothing, because they stand on the flat', () => {
    // The spears are the fight the player meets first, at radius 34 to 36 where the home
    // island is still a plateau. The worst height difference any move's own footprint can
    // reach around one of them is 2.593 m — spear-2, inside a 12 m gust or vortex — and the
    // narrowest band is the staff's 2.0, which only has to hold across its own 3.6 m arc
    // where the worst is 1.337. So every stance that could hit a spear before still can.
    //
    // This is where over-tightening would show up first as a felt regression, so it is
    // asserted as an exact "nothing lost" rather than as a coverage floor.
    const spears = swept().filter((r) => r.soldier.startsWith('spear'))
    expect(spears.length).toBe(3 * MOVES.length)
    for (const r of spears) {
      expect(r.stillHit, `${r.move} dropped stances against ${r.soldier}`).toBe(r.inFootprint)
    }
    // The two figures the paragraph above cites, pinned rather than narrated.
    const worstAroundASpear = Math.max(...spears.map((r) => r.worstGapInFootprint))
    expect(worstAroundASpear).toBeGreaterThan(2.5)
    expect(worstAroundASpear).toBeLessThan(2.6)
    const worstInStaffReach = Math.max(
      ...spears.filter((r) => r.move.startsWith('staff')).map((r) => r.worstGapInFootprint),
    )
    expect(worstInStaffReach).toBeLessThan(C.staffArc.opener.verticalReach)
  })

  it('confines every dropped stance to the two archers on the rim', () => {
    // Everything the bands take away is on the two archers, which is where the home island
    // stops being a plateau: they sit at radius 55 against a rim near 65. `archer-2` is the
    // extreme — it stands on a low shelf under an overhanging lip, with a second surface
    // 1.81 m below the lip's top and a 48-degree slope climbing about 6 m over the next 4 m
    // of run. That is the "soldier on a low ledge or partway up a shallow slope" the gust's
    // comment names, inverted: the soldier is the one below.
    //
    // Recorded as a property rather than a tolerance, because it is what makes the coverage
    // shortfalls readable: they are one piece of terrain, not a systematic shortage.
    for (const r of swept()) {
      if (r.stillHit === r.inFootprint) continue
      expect(r.soldier, `${r.move} dropped stances against ${r.soldier}, not an archer`)
        .toMatch(/^archer-/)
    }
    // The shelf and lip the paragraph cites, measured off the geometry rather than assumed.
    const { terrain } = shared_()
    const lip = terrain.raycast(new Vector3(17.182, 900, -49.638), new Vector3(0, -1, 0), 4000)
    expect(lip, 'the lip above archer-2 should be real ground').not.toBe(null)
    const below = terrain.raycast(
      new Vector3(17.182, lip!.point.y - 0.01, -49.638), new Vector3(0, -1, 0), 4000,
    )
    expect(below, 'the lip should overhang a second surface').not.toBe(null)
    expect(lip!.point.y - below!.point.y).toBeGreaterThan(1.8)
    expect(lip!.point.y - below!.point.y).toBeLessThan(1.82)
    // Home island geometry, not another island's underside reported by the topmost-surface
    // probe — the trap `config.ts` warns about in the +X+Z quadrant.
    expect(lip!.islandId).toBe('home')
  })

  it('keeps the vortex band clear of the roughest ground inside its own reach', () => {
    // The one extent with measured headroom rather than an argued guess. Nothing on the home
    // island within a full vortex's 12 m radius differs from a soldier's own footing by more
    // than 6.661 m, against a band of 8.0 — so the vortex catches every stance its footprint
    // holds, at both charges, against all five soldiers. Lifting is the move's whole payoff
    // and a target it cannot reach is a target it cannot lift; here it reaches all of them.
    const vortex = swept().filter((r) => r.move.startsWith('vortex'))
    expect(vortex.length).toBe(2 * 5)
    for (const r of vortex) {
      expect(r.stillHit, `the vortex dropped stances against ${r.soldier}`).toBe(r.inFootprint)
    }
    const worst = Math.max(...vortex.map((r) => r.worstGapInFootprint))
    expect(worst).toBeGreaterThan(6.6)
    expect(worst).toBeLessThan(6.7)
    // The headroom, asserted against the shipped value: this reddens if the band is ever
    // tightened past what the island's own terrain requires of it.
    expect(worst).toBeLessThan(C.vortex.verticalReach)
  })

  it('still catches a group in one gust, and gathers one across a 6 m drop', () => {
    // Reach against a single soldier is not the whole of the fight. Both wide moves are
    // crowd moves — the gust's 60-degree half-angle is "a sweep that catches a group, not a
    // shot at one" — so the band also has to hold when the footprint holds two soldiers at
    // different heights.
    //
    // Every stance on the island from which a gust's or a full vortex's footprint holds two
    // or more soldiers still catches all of them. The full slam has exactly one stance where
    // it does not, and it is the flattest of the four by design.
    const { ground, patrol } = shared_()
    const results = new Map<string, { stances: number; intact: number; dropped: string[] }>()

    for (const move of MOVES) {
      const row = { stances: 0, intact: 0, dropped: [] as string[] }
      // A 1 m grid over the home island. Coarser than the per-soldier sweeps because this
      // asks about the whole island rather than one footprint's rim.
      for (let x = -64; x <= 64; x += 1) {
        for (let z = -64; z <= 64; z += 1) {
          if (Math.hypot(x, z) > 64) continue
          const height = ground(x, z)
          if (height === null) continue
          const origin = new Vector3(x, height, z)
          const near = patrol.filter(
            (e) => Math.hypot(e.position.x - x, e.position.z - z) <= move.reach,
          )
          if (near.length < 2) continue
          // Aimed at the centroid of everything in range, which is what a player trying to
          // catch a group does. Stances where that aim leaves one outside the cone are
          // filtered out below by the footprint test itself.
          const centroid = new Vector3()
          for (const e of near) centroid.add(e.position)
          centroid.divideScalar(near.length)
          const forward = new Vector3(centroid.x - x, 0, centroid.z - z).normalize()

          const footprint = move.catch(origin, forward, patrol, FLAT)
          if (footprint.length < 2) continue
          row.stances++
          const caught = move.catch(origin, forward, patrol, move.band)
          if (caught.length === footprint.length) row.intact++
          else for (const e of footprint) if (!caught.includes(e)) row.dropped.push(e.id)
        }
      }
      results.set(move.name, row)
      console.log(
        `crowd ${move.name.padEnd(21)} stances=${String(row.stances).padStart(4)}`
        + ` allStillCaught=${String(row.intact).padStart(4)}`
        + ` dropped=${row.dropped.join(',') || 'none'}`,
      )
    }

    const gust = results.get('gust')!
    expect(gust.stances, 'a gust should reach two soldiers from somewhere').toBeGreaterThan(100)
    expect(gust.intact, 'a gust dropped a soldier its footprint held').toBe(gust.stances)

    const vortex = results.get('vortex, full charge')!
    expect(vortex.stances).toBeGreaterThan(300)
    expect(vortex.intact, 'a full vortex dropped a soldier its footprint held').toBe(vortex.stances)

    // The one stance where the flattest move does drop somebody: 8 m from `spear-3` and 11 m
    // from `archer-2`, standing 5.98 m above the latter on the slope between them. A
    // shockwave crossing the surface not reaching a soldier on a shelf six metres down is
    // the fiction working, not the band failing — but it is asserted rather than described,
    // so it stays one stance.
    const slam = results.get('wave, full slam')!
    expect(slam.stances).toBeGreaterThan(200)
    expect(slam.stances - slam.intact).toBe(1)
    expect(slam.dropped).toEqual(['archer-2'])

    // Neither staff arc nor either move at its weakest ever holds two at once: the patrol's
    // closest pair is 11.31 m apart. Named so the two zeroes above are not read as a bug.
    for (const name of ['staff opener', 'staff finisher', 'vortex, least charge', 'wave, weakest slam']) {
      expect(results.get(name)!.stances, `${name} should not reach two soldiers`).toBe(0)
    }
    let closest = Infinity
    for (let i = 0; i < patrol.length; i++) {
      for (let j = i + 1; j < patrol.length; j++) {
        const a = patrol[i]!
        const b = patrol[j]!
        closest = Math.min(
          closest, Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z),
        )
      }
    }
    expect(closest).toBeGreaterThan(11.3)
    expect(closest).toBeLessThan(11.4)
    expect(closest).toBeGreaterThan(vortexRadius(0, C.vortex))
  })

  it('keeps every move connecting on the natural walk-in from the spawn', () => {
    // The single-soldier sweeps above ask whether a stance exists. This asks the fight
    // question: walking out from the island's centre — where the player spawns — straight at
    // a soldier, at what standoff does each move start to land?
    //
    // For four of the five soldiers the answer is the move's full nominal reach, unchanged.
    // For `archer-2` the walk-in descends the slope above its shelf, so the player is high
    // over it until close: measured, a gust connects from 5.35 m of a nominal 12, and a staff
    // swing from 2.35 m of 3.6. Full reach against it survives from other bearings — the
    // first test in this file measures that — so the cost is a bearing, not the move.
    const { ground, patrol } = shared_()
    const standoff = new Map<string, number>()

    for (const move of MOVES) {
      for (const target of patrol) {
        const radius = Math.hypot(target.position.x, target.position.z)
        let furthest = 0
        for (let back = 0.05; back <= move.reach; back += 0.05) {
          const scale = (radius - back) / radius
          const x = target.position.x * scale
          const z = target.position.z * scale
          const height = ground(x, z)
          if (height === null) continue
          const origin = new Vector3(x, height, z)
          const forward = new Vector3(
            target.position.x - x, 0, target.position.z - z,
          ).normalize()
          if (move.catch(origin, forward, [target], move.band).length > 0) furthest = back
        }
        standoff.set(`${move.name}|${target.id}`, furthest)
        console.log(
          `walk-in ${move.name.padEnd(21)} ${target.id.padEnd(9)}`
          + ` connectsFrom=${furthest.toFixed(2)} of ${move.reach}`,
        )
      }
    }

    // Every move connects on the walk-in against every soldier. Nothing became unhittable by
    // walking at it.
    for (const [key, value] of standoff) {
      expect(value, `nothing connects on the walk-in: ${key}`).toBeGreaterThan(0)
    }

    for (const move of MOVES) {
      // The three spears keep the full nominal standoff, to within the 0.05 m probe step.
      for (const target of patrol.filter((e) => e.id.startsWith('spear'))) {
        expect(
          standoff.get(`${move.name}|${target.id}`)!,
          `${move.name} lost walk-in standoff against ${target.id}`,
        ).toBeGreaterThan(move.reach - 0.06)
      }
    }

    // `archer-2`'s two reductions, pinned at the measured values rather than described. Both
    // are what the slope costs, and both move if any of the extents move.
    expect(standoff.get(`gust|archer-2`)!).toBeGreaterThan(5.3)
    expect(standoff.get(`gust|archer-2`)!).toBeLessThan(5.4)
    expect(standoff.get(`staff opener|archer-2`)!).toBeGreaterThan(2.3)
    expect(standoff.get(`staff opener|archer-2`)!).toBeLessThan(2.4)
    // And the staff still out-spaces a spear's thrust, which is the reason its arcs reach
    // just past `strikeRange` at all. Against `archer-2` it does not, but an archer strikes
    // from 30 m and the player is always inside that.
    for (const target of patrol.filter((e) => e.id.startsWith('spear'))) {
      expect(standoff.get(`staff opener|${target.id}`)!)
        .toBeGreaterThan(C.enemies.spear.strikeRange)
    }

    // The vortex reaches every soldier at full standoff on the walk-in at both charges,
    // including `archer-2` down the slope — the 8.0 band is what buys that.
    for (const target of patrol) {
      expect(
        standoff.get(`vortex, full charge|${target.id}`)!,
        `a full vortex lost walk-in standoff against ${target.id}`,
      ).toBeGreaterThan(vortexRadius(1, C.vortex) - 0.06)
    }
  })
})

describe('the Pressure Wave against real landing positions', () => {
  it('measures the gap from every aimed landing to each soldier', () => {
    // The value the design names as most likely wrong, and the measurement built to decide
    // it. `pressureWave.verticalReach` is 4.0 and `minRadius` is also 4, so the weakest
    // qualifying slam is exactly as tall as it is wide — the sphere the design's own argument
    // forbids, produced by the argument's own number.
    //
    // An aimed landing is real ground within `minRadius` of the soldier: the radius even the
    // weakest slam covers, so a player who dives at a soldier and lands inside it has aimed
    // well. Sign is ignored — `waveTargets` uses `Math.abs`, so only magnitude counts, and
    // the earlier claim that a slam's origin is the lowest nearby ground is false anyway
    // (it is `input.playerPosition`, the topmost surface at the player's own x/z).
    const { ground, patrol } = shared_()
    const radius = waveRadius(0, C.pressureWave)
    let worstOverall = 0
    let worstSoldier = ''
    let coverageFloor = 1

    for (const target of patrol) {
      const gaps: number[] = []
      for (let dx = -radius; dx <= radius; dx += STEP) {
        for (let dz = -radius; dz <= radius; dz += STEP) {
          if (Math.hypot(dx, dz) > radius) continue
          const height = ground(target.position.x + dx, target.position.z + dz)
          if (height === null) continue
          gaps.push(Math.abs(height - target.position.y))
        }
      }
      gaps.sort((a, b) => a - b)
      const worst = gaps[gaps.length - 1]!
      const inside = gaps.filter((g) => g <= C.pressureWave.verticalReach).length
      const coverage = inside / gaps.length
      if (worst > worstOverall) { worstOverall = worst; worstSoldier = target.id }
      coverageFloor = Math.min(coverageFloor, coverage)
      console.log(
        `aimed landing ${target.id.padEnd(9)} n=${String(gaps.length).padStart(4)}`
        + ` median=${gaps[Math.floor(gaps.length / 2)]!.toFixed(3)}`
        + ` p99=${gaps[Math.floor(gaps.length * 0.99)]!.toFixed(3)}`
        + ` worst=${worst.toFixed(4)}`
        + ` inside ${C.pressureWave.verticalReach}=${(100 * coverage).toFixed(2)}%`,
      )
    }
    console.log(
      `aimed landing worst over all five = ${worstOverall.toFixed(4)} (${worstSoldier})`
      + ` vs verticalReach ${C.pressureWave.verticalReach}`,
    )

    // **The verdict, and it is not the one the brief hoped for.** The worst aimed-landing gap
    // is 4.1404 m, on `archer-2`, 4.00 m out on the slope above its shelf — 0.1404 m outside
    // the shipped 4.0. So "the measured worst case is inside 4.0" is false, by 3.5%.
    //
    // Pinned two-sided so it is a measurement and not a tolerance, and so it reddens if the
    // patrol moves or the island's noise seed changes rather than going quietly stale.
    expect(worstOverall).toBeGreaterThan(4.13)
    expect(worstOverall).toBeLessThan(4.15)
    expect(worstSoldier).toBe('archer-2')

    // And the size of the shortfall, which is what stops the line above from being an
    // argument to move the number: 4.0 still covers 99.37% of the aimed-landing disc around
    // the worst-placed soldier and 100% of the other four. Depends on the shipped band, so
    // this is the assertion that reddens if `verticalReach` is retuned in either direction.
    expect(coverageFloor).toBeGreaterThan(0.993)
    expect(coverageFloor).toBeLessThan(0.994)

    // The whole 0.63% shortfall is the wedge above the overhanging lip, and every stance in
    // it fails by less than 0.15 m — the least gap dropped is 4.060.
    const weakest = rowsFor('wave, weakest slam').filter((r) => r.soldier === 'archer-2')[0]!
    expect(weakest.leastGapDropped).toBeGreaterThan(4.0)
    expect(weakest.leastGapDropped).toBeLessThan(4.07)
    expect(weakest.worstGapDropped - C.pressureWave.verticalReach).toBeLessThan(0.15)

    // The number is left at 4.0. Moving it is a design decision and this cycle does not own
    // it: covering the whole disc needs at least 4.1404, which would put the weakest slam
    // taller than it is wide and turn it into the column `config.ts` argues it must not be.
    // The two constraints have crossed, and `pressure-wave.test.ts` already pins the
    // `verticalReach <= minRadius` side at equality with no slack.
    expect(worstOverall).toBeGreaterThan(C.pressureWave.minRadius)
    expect(C.pressureWave.verticalReach).toBe(C.pressureWave.minRadius)
  })
})
