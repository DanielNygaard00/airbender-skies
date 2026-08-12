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

/**
 * No band at all: the move's horizontal footprint, which is what it hit before this cycle.
 *
 * **This reference is one-directional, and the limit is structural rather than a matter of how
 * the assertions below are phrased.** `FLAT` is the loosest band that exists, so `stillHit` is
 * always a subset of `inFootprint` and `furthestBanded` is always at most `furthestFlat`.
 * Loosening a shipped `verticalReach` can only move `stillHit` towards `inFootprint`, which
 * makes the headline equality hold *a fortiori* — so no comparison against `FLAT` can ever
 * catch a band that has been loosened, however far. Every bit of this file's sensitivity to
 * over-loosening comes from the incidental two-sided pins on measured figures (the spear gap,
 * the vortex gap, the walk-in standoffs, the aimed-landing disc), not from the reference.
 * Tighten a band and this file objects loudly; loosen one and only those pins are watching.
 */
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
    //
    // **Every soldier in this file is therefore standing on the ground, and that is a real
    // coverage hole rather than a simplification.** A gust, a slam and a vortex all launch
    // their targets, and once a target is airborne the height band is measured against a
    // position no terrain query produced. Nothing here exercises that case for any of the four
    // moves. `vortex.test.ts` pins the arithmetic of the one case where it matters most, and
    // the "airborne targets" entry in `docs/HANDOFF.md` records why it is a play-pass question
    // rather than something this cycle can settle.
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

/**
 * The grid the stance sweeps walk.
 *
 * **This is not only a precision choice: five of this file's assertions are pinned two-sided at
 * figures read off this exact grid, and they move if it moves.** They are the worst spear gap
 * (2.5..2.6), the worst gap inside each staff arc around a spear (1.33..1.34 and 1.54..1.55),
 * the worst gap inside a vortex footprint (6.6..6.7), and the two archers' stance-retention
 * counts and fractions. Refining `STEP` samples more terrain, so every one of those maxima can
 * only grow and every retention fraction can only shift — none of them is a continuum value a
 * finer grid converges onto from below.
 *
 * Two other probe steps in this file carry pins of their own and are independent of this one:
 * the walk-in sweep's 0.05 m back-off step (`archer-2`'s 5.3..5.4, 2.3..2.4 and 4.25..4.35
 * standoffs) and `DISC_STEP` below. The remaining two-sided pins depend on neither grid — the
 * patrol's closest pair (11.3..11.4) is a function of `HOME_PATROL` alone, and the lip drop is
 * a pair of raycasts at a fixed coordinate, so it moves only with the island noise seed.
 */
const STEP = 0.25

/**
 * The grid the aimed-landing disc walks, five times finer than `STEP`.
 *
 * Its own constant because the disc measurement is the one number in this cycle a design
 * decision was taken against, and at `STEP` it does not converge: 0.25 m sampling reports a
 * worst gap of 4.1404 m where the terrain's real worst is 4.2275 m, and it reports a coverage
 * that sits *above* a two-sided pin any finer grid then falls below. The whole of that
 * correction is in the last test in this file.
 *
 * 0.05 m rather than 0.01 m for cost: 0.01 m over five discs is half a million raycasts and
 * about 40 s, against roughly 1.4 s here. The figures 0.01 m produces are asserted anyway,
 * because the point carrying the worst gap is probed directly rather than found by sweeping.
 */
const DISC_STEP = 0.05

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

function rowFor(move: string, soldier: string): Sweep {
  const found = swept().find((r) => r.move === move && r.soldier === soldier)
  if (!found) throw new Error(`no sweep for ${move} against ${soldier}`)
  return found
}

describe('the vertical extents against the real archipelago', () => {
  it('keeps the furthest connecting stance on some bearing against every soldier', () => {
    // **The claim, scoped to what is actually measured here: for every move at every strength
    // against every soldier, there is still a bearing from which the furthest stance on real
    // ground connects, and it is the same distance it was before the band existed.**
    //
    // That is a statement about the maximum over bearings and nothing more. It is emphatically
    // *not* the statement that no standoff was lost. Standoff was lost, on the bearing that
    // matters most — the walk-in test at the bottom of this file measures a gust connecting
    // against `archer-2` only from 5.35 m of its nominal 12, which is 6.6 m of standoff gone,
    // and a staff finisher from 2.35 m of 4.2. Only the three spears keep full standoff on the
    // walk-in bearing. An earlier version of this comment said "no move lost a metre of
    // standoff against anyone in the patrol", which the same file refutes 180 lines further
    // down; the per-target losses are in the test immediately below.
    //
    // Asserted as an equality between two measurements rather than against the config's
    // ranges, so it stays true if a horizontal reach is retuned. Note the direction: because
    // the reference is `FLAT`, this equality can only be broken by *tightening* a band. See
    // `FLAT` for why nothing here can catch a loosened one.
    for (const r of swept()) {
      expect(
        r.furthestBanded,
        `${r.move} lost its furthest bearing against ${r.soldier}: `
        + `${r.furthestFlat.toFixed(2)} without the band, ${r.furthestBanded.toFixed(2)} with it`,
      ).toBe(r.furthestFlat)
      // And the footprint is not empty, so the equality above is not vacuous.
      expect(r.inFootprint, `${r.move} has no stance at all against ${r.soldier}`)
        .toBeGreaterThan(0)
    }
    // Same reasoning as the Pressure Wave sweep further down, and the same multiplier: this
    // walks every stance against every soldier, so the patrol growing from five to seven grew
    // it too. Measured at 3.9 s in a full-suite run -- 78% of the 5 s default -- which is close
    // enough that it would have been the next thing to fail in CI once the wave sweep was
    // fixed. Raised now rather than after watching that happen.
  }, 30_000)

  it('records how many stances each band costs against each archer', () => {
    // What the reach-preserving equality above deliberately does not say. A move can keep its
    // furthest bearing and still lose most of the ground it can be thrown from, and against the
    // two rim archers that is exactly what happens. These are the losses, pinned rather than
    // left in the console log, because they are the size of the change a player would feel and
    // the previous framing hid them.
    //
    // The two heaviest carry their raw stance counts as well as the fraction: against
    // `archer-2` a gust keeps 4332 of the 6172 stances its footprint holds, losing 29.8% of
    // them, and a full slam keeps 3506 of 5297, losing 33.8%.
    const gust = rowFor('gust', 'archer-2')
    expect(gust.inFootprint).toBe(6172)
    expect(gust.stillHit).toBe(4332)
    expect(1 - gust.stillHit / gust.inFootprint).toBeGreaterThan(0.297)
    expect(1 - gust.stillHit / gust.inFootprint).toBeLessThan(0.299)

    const slam = rowFor('wave, full slam', 'archer-2')
    expect(slam.inFootprint).toBe(5297)
    expect(slam.stillHit).toBe(3506)
    expect(1 - slam.stillHit / slam.inFootprint).toBeGreaterThan(0.337)
    expect(1 - slam.stillHit / slam.inFootprint).toBeLessThan(0.339)

    // The staff's narrow band costs the largest share of what little ground it has against
    // `archer-2`: the finisher keeps 79.9% of its stances and the opener 84.1%. Against
    // `archer-1`, the gentler of the two rims, the finisher and the full slam both keep 92.4%.
    const kept = (move: string, soldier: string) => {
      const r = rowFor(move, soldier)
      return r.stillHit / r.inFootprint
    }
    expect(kept('staff finisher', 'archer-2')).toBeGreaterThan(0.798)
    expect(kept('staff finisher', 'archer-2')).toBeLessThan(0.800)
    expect(kept('staff opener', 'archer-2')).toBeGreaterThan(0.840)
    expect(kept('staff opener', 'archer-2')).toBeLessThan(0.842)
    expect(kept('staff finisher', 'archer-1')).toBeGreaterThan(0.923)
    expect(kept('staff finisher', 'archer-1')).toBeLessThan(0.925)
    expect(kept('wave, full slam', 'archer-1')).toBeGreaterThan(0.923)
    expect(kept('wave, full slam', 'archer-1')).toBeLessThan(0.925)
  })

  it('costs the three spears nothing, because they stand on the flat', () => {
    // The spears are the fight the player meets first, at radius 34.06 to 36.06 where the home
    // island is still a plateau. The worst height difference any move's own footprint can
    // reach around one of them is 2.593 m — spear-2, inside a 12 m gust or vortex — and the
    // narrowest band is the staff's 2.0, which only has to hold across its own arcs: the worst
    // inside the opener's 3.6 m is 1.337 and inside the finisher's 4.2 m is 1.548, both again
    // on spear-2. So every stance that could hit a spear before still can.
    //
    // This is where over-tightening would show up first as a felt regression, so it is
    // asserted as an exact "nothing lost" rather than as a coverage floor.
    const spears = swept().filter((r) => r.soldier.startsWith('spear'))
    expect(spears.length).toBe(3 * MOVES.length)
    for (const r of spears) {
      expect(r.stillHit, `${r.move} dropped stances against ${r.soldier}`).toBe(r.inFootprint)
    }
    // The radii the paragraph cites. An earlier version said "34 to 36", which `spear-2` falls
    // outside at 36.0555 — a one-sided bound would have let that stand, so both ends are pinned.
    const { patrol } = shared_()
    const spearRadii = patrol
      .filter((e) => e.id.startsWith('spear'))
      .map((e) => Math.hypot(e.position.x, e.position.z))
    expect(Math.min(...spearRadii)).toBeGreaterThan(34.0)
    expect(Math.min(...spearRadii)).toBeLessThan(34.1)
    expect(Math.max(...spearRadii)).toBeGreaterThan(36.0)
    expect(Math.max(...spearRadii)).toBeLessThan(36.1)
    // The gap figures the paragraph cites, pinned rather than narrated. All are maxima over the
    // `STEP` grid, so all grow if that grid is refined.
    const worstAroundASpear = Math.max(...spears.map((r) => r.worstGapInFootprint))
    expect(worstAroundASpear).toBeGreaterThan(2.5)
    expect(worstAroundASpear).toBeLessThan(2.6)
    // Per arc, not pooled. Pooling them is how the 1.337 in the comment went unasserted: the
    // one-sided `< 2.0` bound that used to stand here was computed over both arcs at once, so
    // it was really bounding the finisher's 1.548 and said nothing about the opener at all.
    const worstIn = (move: string) => Math.max(
      ...spears.filter((r) => r.move === move).map((r) => r.worstGapInFootprint),
    )
    expect(worstIn('staff opener')).toBeGreaterThan(1.33)
    expect(worstIn('staff opener')).toBeLessThan(1.34)
    expect(worstIn('staff finisher')).toBeGreaterThan(1.54)
    expect(worstIn('staff finisher')).toBeLessThan(1.55)
    expect(worstIn('staff opener')).toBeLessThan(C.staffArc.opener.verticalReach)
    expect(worstIn('staff finisher')).toBeLessThan(C.staffArc.finisher.verticalReach)
  })

  it('confines every dropped stance to the two archers on the rim', () => {
    // Everything the bands take away is on the two archers, which is where the home island
    // stops being a plateau: they sit at radius 55 against a walkable rim that ends at 62.86
    // on `archer-1`'s own bearing and 65.12 on `archer-2`'s. `archer-2` is the extreme — it
    // stands on a low shelf under an overhanging lip, with a second surface 1.8076 m below the
    // lip's top and a 47.8-degree face beyond it. That is the "soldier on a low ledge or partway
    // up a shallow slope" the gust's comment names, inverted: the soldier is the one below.
    //
    // Recorded as a property rather than a tolerance, because it is what makes the coverage
    // shortfalls readable: they are one piece of terrain, not a systematic shortage.
    for (const r of swept()) {
      if (r.stillHit === r.inFootprint) continue
      expect(r.soldier, `${r.move} dropped stances against ${r.soldier}, not an archer`)
        .toMatch(/^archer-/)
    }
    const { terrain, patrol } = shared_()
    // The archers' own radii, and where the walkable ground actually stops on each of their
    // bearings. "A rim near 65" was true of one of the two and not the other, so both are
    // measured here rather than averaged into one round number.
    const archers = patrol.filter((e) => e.id.startsWith('archer'))
    const rimOn = (e: Enemy): number => {
      const r0 = Math.hypot(e.position.x, e.position.z)
      let rim = 0
      for (let r = 40; r <= 80; r += 0.01) {
        if (terrain.groundHeightAt((e.position.x / r0) * r, (e.position.z / r0) * r) !== null) {
          rim = r
        }
      }
      return rim
    }
    for (const e of archers) {
      const radius = Math.hypot(e.position.x, e.position.z)
      expect(radius, `${e.id} radius`).toBeGreaterThan(55.0)
      expect(radius, `${e.id} radius`).toBeLessThan(55.2)
    }
    const rim1 = rimOn(archers.find((e) => e.id === 'archer-1')!)
    expect(rim1).toBeGreaterThan(62.85)
    expect(rim1).toBeLessThan(62.90)
    const rim2 = rimOn(archers.find((e) => e.id === 'archer-2')!)
    expect(rim2).toBeGreaterThan(65.10)
    expect(rim2).toBeLessThan(65.15)

    // The shelf and lip the paragraph cites, measured off the geometry rather than assumed.
    // Both surface heights are pinned, not only the difference between them, because the
    // difference alone would survive the whole shelf moving.
    const lip = terrain.raycast(new Vector3(17.182, 900, -49.638), new Vector3(0, -1, 0), 4000)
    expect(lip, 'the lip above archer-2 should be real ground').not.toBe(null)
    const below = terrain.raycast(
      new Vector3(17.182, lip!.point.y - 0.01, -49.638), new Vector3(0, -1, 0), 4000,
    )
    expect(below, 'the lip should overhang a second surface').not.toBe(null)
    expect(lip!.point.y).toBeGreaterThan(5.867)
    expect(lip!.point.y).toBeLessThan(5.868)
    expect(below!.point.y).toBeGreaterThan(4.060)
    expect(below!.point.y).toBeLessThan(4.061)
    expect(lip!.point.y - below!.point.y).toBeGreaterThan(1.807)
    expect(lip!.point.y - below!.point.y).toBeLessThan(1.808)
    // Home island geometry, not another island's underside reported by the topmost-surface
    // probe — the trap `config.ts` warns about in the +X+Z quadrant. Asserted for both
    // surfaces: the pair being one island is what makes it an overhang rather than two islands
    // stacked.
    expect(lip!.islandId).toBe('home')
    expect(below!.islandId).toBe('home')

    // The face past the lip. An earlier version of this comment said "a 48-degree slope climbing
    // about 6 m over the next 4 m of run", which the geometry does not support: the face is
    // 47.77 degrees and gains 2.891 m over its first 3 m of run before flattening to 10.0
    // degrees, so the gain over a full 4 m is 3.487 m rather than 6. All of it is pinned here,
    // since the 6 survived review precisely because nothing measured it.
    const angleAt = (x: number, z: number): number => {
      const hit = terrain.raycast(new Vector3(x, 900, z), new Vector3(0, -1, 0), 4000)
      if (!hit) throw new Error(`no ground at ${x},${z}`)
      return (Math.acos(hit.normal.y) * 180) / Math.PI
    }
    expect(angleAt(17.182, -49.638)).toBeGreaterThan(47.7)
    expect(angleAt(17.182, -49.638)).toBeLessThan(47.8)
    // Inward from the lip, along the line back towards the island's centre.
    const lipRadius = Math.hypot(17.182, 49.638)
    const inwardOf = (run: number): { x: number; z: number } => ({
      x: 17.182 - (17.182 / lipRadius) * run,
      z: -49.638 + (49.638 / lipRadius) * run,
    })
    const climb = (run: number): number => {
      const p = inwardOf(run)
      const height = terrain.groundHeightAt(p.x, p.z)
      if (height === null) throw new Error(`no ground ${run} m inward of the lip`)
      return height - lip!.point.y
    }
    expect(climb(3)).toBeGreaterThan(2.89)
    expect(climb(3)).toBeLessThan(2.90)
    expect(climb(4)).toBeGreaterThan(3.48)
    expect(climb(4)).toBeLessThan(3.49)
    expect(angleAt(inwardOf(4).x, inwardOf(4).z)).toBeLessThan(10.1)
  })

  it('leaves the vortex band the loosest of the five, not the best-measured', () => {
    // **The vortex's 8.0 is the extent with the *least* upper constraint of the five, and an
    // earlier version of this comment called it "the one extent with measured headroom rather
    // than an argued guess", which inverts that.** Nothing on the home island within a full
    // vortex's 12 m radius differs from a soldier's own footing by more than 6.661 m, so the
    // vortex catches every stance its footprint holds at both charges against all five
    // soldiers — a good result for the fight and a bad one for pinning the number. Having no
    // stance to lose is precisely why nothing here objects to the band growing.
    //
    // What is actually pinned, across the whole suite, is a bracket: above the measured 6.661 m
    // by this test, and below `maxRadius` by `vortex.test.ts`'s "taller than any other move but
    // stays wider than it is tall". That leaves a free window over 5.3 m wide in which the
    // shipped value can sit with nothing objecting; mutation-measured, 6.7 and 11.9 both leave
    // the entire suite green. The value is not unpinned, but it is bracketed rather than
    // measured, and the bracket is by far the widest of the five.
    //
    // Recorded rather than retuned. Generous is the safe direction for a lift move — a band too
    // short to hold a target it has just launched would fight its own effect — so this is a
    // recording problem, not a balance one.
    const vortex = swept().filter((r) => r.move.startsWith('vortex'))
    // Two charges against every soldier in the shipped patrol. Read off `HOME_PATROL` rather
    // than written as a literal: this said `2 * 5` and went red the day the patrol grew from
    // five soldiers to seven, which is a roster count masquerading as a claim about the vortex.
    expect(vortex.length).toBe(2 * HOME_PATROL.length)
    for (const r of vortex) {
      expect(r.stillHit, `the vortex dropped stances against ${r.soldier}`).toBe(r.inFootprint)
    }
    const worst = Math.max(...vortex.map((r) => r.worstGapInFootprint))
    expect(worst).toBeGreaterThan(6.6)
    expect(worst).toBeLessThan(6.7)
    // The lower end of the bracket, asserted against the shipped value: this reddens if the
    // band is ever tightened past what the island's own terrain requires of it.
    expect(worst).toBeLessThan(C.vortex.verticalReach)
    // And the width of the window, so the looseness is a number in the suite rather than a claim
    // in a comment. `maxRadius` is the only thing bounding the band from above.
    expect(C.vortex.verticalReach).toBeLessThan(C.vortex.maxRadius)
    expect(C.vortex.maxRadius - worst).toBeGreaterThan(5.3)
    expect(C.vortex.maxRadius - worst).toBeLessThan(5.4)
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

    // The one stance where the flattest move does drop somebody: `(18, −41)`, which is 11.00 m
    // from `spear-3` and 11.00 m from `archer-2` — exactly the full slam's radius on both sides,
    // which is why it is the only such stance — standing 5.981 m above `archer-2` on the slope
    // between them. A shockwave crossing the surface not reaching a soldier on a shelf six
    // metres down is the fiction working, not the band failing.
    const slam = results.get('wave, full slam')!
    expect(slam.stances).toBeGreaterThan(200)
    expect(slam.stances - slam.intact).toBe(1)
    expect(slam.dropped).toEqual(['archer-2'])
    // The three figures that sentence cites, probed directly. An earlier version said "8 m from
    // `spear-3`", which is 3 m out.
    const archer2 = patrol.find((e) => e.id === 'archer-2')!
    const spear3 = patrol.find((e) => e.id === 'spear-3')!
    const dropHeight = ground(18, -41)
    expect(dropHeight, 'the dropping stance should be on real ground').not.toBe(null)
    expect(dropHeight! - archer2.position.y).toBeGreaterThan(5.98)
    expect(dropHeight! - archer2.position.y).toBeLessThan(5.99)
    expect(Math.hypot(18 - spear3.position.x, -41 - spear3.position.z))
      .toBeCloseTo(waveRadius(1, C.pressureWave), 6)
    expect(Math.hypot(18 - archer2.position.x, -41 - archer2.position.z))
      .toBeCloseTo(waveRadius(1, C.pressureWave), 6)

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
    // For `archer-2` the walk-in descends the slope above its shelf, so the player is high over
    // it until close, and this is where the standoff losses actually cost something: a gust
    // connects from 5.35 m of a nominal 12 (6.6 m of standoff gone), a staff opener from 2.35 m
    // of 3.6, a staff finisher from the same 2.35 m of 4.2, and a full slam from 4.30 m of 11.
    // Full reach against it survives from *other* bearings — the first test in this file
    // measures that — so the cost is a bearing rather than the move; but "no standoff was lost"
    // would be false, and all four reductions are pinned below so the claim cannot drift back
    // to it.
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

    // `archer-2`'s four reductions, pinned at the measured values rather than described. All
    // four are what the slope costs, and all four move if any of the extents move.
    expect(standoff.get(`gust|archer-2`)!).toBeGreaterThan(5.3)
    expect(standoff.get(`gust|archer-2`)!).toBeLessThan(5.4)
    expect(standoff.get(`staff opener|archer-2`)!).toBeGreaterThan(2.3)
    expect(standoff.get(`staff opener|archer-2`)!).toBeLessThan(2.4)
    expect(standoff.get(`staff finisher|archer-2`)!).toBeGreaterThan(2.3)
    expect(standoff.get(`staff finisher|archer-2`)!).toBeLessThan(2.4)
    expect(standoff.get(`wave, full slam|archer-2`)!).toBeGreaterThan(4.25)
    expect(standoff.get(`wave, full slam|archer-2`)!).toBeLessThan(4.35)
    // And the largest of them expressed as a loss rather than as a survivor, which is the
    // framing the headline test above is structurally unable to give: 6.6 m of the gust's 12.
    expect(C.gust.range - standoff.get(`gust|archer-2`)!).toBeGreaterThan(6.6)
    expect(C.gust.range - standoff.get(`gust|archer-2`)!).toBeLessThan(6.7)
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
  /**
   * Given a generous explicit timeout rather than left on the 5-second default, because this
   * test's cost is inherent and it went over the line in CI.
   *
   * The sweep raycasts a `DISC_STEP` grid over the wave's whole footprint once per soldier, and
   * the comment below explains why 0.05 m is not negotiable: at 0.25 m the reported worst gap
   * was 4.1404 m, which is not the terrain's worst gap but the worst of 797 samples, and a
   * coverage pin that hung off it sat *below its own lower bound* at any finer grid. Coarsening
   * the grid to fit a timeout would reintroduce exactly the defect that comment records.
   *
   * So the cost stays and the limit moves. What pushed it over was `HOME_PATROL` growing from
   * five soldiers to seven when the heavy and the net thrower landed: the sweep is per soldier,
   * so the patrol's size is a direct multiplier. Measured in isolation on this machine at
   * 3.9 s against the 5 s default -- already 78% of the budget before any contention -- and it
   * fails locally too when run alongside the other real-geometry files, because the workers
   * starve each other. It failed in CI on hardware slower than this machine.
   *
   * 30 seconds rather than something tighter: the point of the number is to stop being a
   * tripwire on machine speed, and a limit set just above today's measurement is the same
   * tripwire one enemy kind later. It is still short enough to catch a genuine hang.
   */
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
    // **Walked at `DISC_STEP`, not at `STEP`, and that is the whole of a correction.** An
    // earlier version of this test sampled the disc at 0.25 m and reported a worst gap of
    // 4.1404 m, which is not the terrain's worst gap — it is the worst of 797 samples. The
    // figure does not converge until about 0.05 m, and the converged value is 4.2275 m. Every
    // number that hung off the 0.25 m figure was wrong in the same direction, including a
    // two-sided coverage pin that was *below its own lower bound* at any finer grid and so
    // passed only because the grid stayed coarse.
    const { terrain, ground, patrol } = shared_()
    const band = C.pressureWave.verticalReach
    const radius = waveRadius(0, C.pressureWave)
    let worstOverall = 0
    let worstSoldier = ''
    let coverageFloor = 1
    // The failing wedge on the worst-placed soldier, collected in the same pass so describing
    // it costs no extra raycasts.
    const failing: { d: number; bearing: number; x: number; z: number; height: number }[] = []

    for (const target of patrol) {
      const gaps: number[] = []
      const steps = Math.round((2 * radius) / DISC_STEP)
      for (let i = 0; i <= steps; i++) {
        // Indexed rather than accumulated, so the grid does not drift by a float epsilon per
        // row and the sample count is a function of `DISC_STEP` alone.
        const dx = -radius + i * DISC_STEP
        for (let j = 0; j <= steps; j++) {
          const dz = -radius + j * DISC_STEP
          const d = Math.hypot(dx, dz)
          if (d > radius) continue
          const x = target.position.x + dx
          const z = target.position.z + dz
          const height = ground(x, z)
          if (height === null) continue
          const gap = Math.abs(height - target.position.y)
          gaps.push(gap)
          if (gap > band && target.id === 'archer-2') {
            failing.push({ d, bearing: (Math.atan2(dx, dz) * 180) / Math.PI, x, z, height })
          }
        }
      }
      gaps.sort((a, b) => a - b)
      const worst = gaps[gaps.length - 1]!
      const inside = gaps.filter((g) => g <= band).length
      const coverage = inside / gaps.length
      if (worst > worstOverall) { worstOverall = worst; worstSoldier = target.id }
      coverageFloor = Math.min(coverageFloor, coverage)
      console.log(
        `aimed landing ${target.id.padEnd(9)} n=${String(gaps.length).padStart(6)}`
        + ` median=${gaps[Math.floor(gaps.length / 2)]!.toFixed(3)}`
        + ` p99=${gaps[Math.floor(gaps.length * 0.99)]!.toFixed(3)}`
        + ` worst=${worst.toFixed(4)}`
        + ` inside ${band}=${(100 * coverage).toFixed(4)}%`
        + ` failing=${gaps.length - inside}`,
      )
    }
    console.log(
      `aimed landing worst over all five = ${worstOverall.toFixed(4)} (${worstSoldier})`
      + ` vs verticalReach ${band}, coverage floor ${(100 * coverageFloor).toFixed(4)}%`,
    )

    // **The verdict, corrected.** The worst aimed-landing gap is **4.2275 m**, on `archer-2`,
    // 4.00 m out on the slope above its shelf — **0.2275 m outside** the shipped 4.0, which is
    // 5.69% of the band. So "the measured worst case is comfortably inside 4.0" is false, and
    // false by considerably more than the 3.5% first recorded.
    //
    // Two assertions, because they are two different claims and conflating them is what went
    // wrong the first time. This pair is about the **terrain**: the bounds hold at every grid
    // measured — 0.1 m, 0.05 m, 0.02 m and 0.01 m — so refining `DISC_STEP` cannot redden it.
    expect(worstOverall).toBeGreaterThan(4.20)
    expect(worstOverall).toBeLessThan(4.23)
    expect(worstSoldier).toBe('archer-2')

    // And this is the converged value itself, pinned to four decimals by probing the point that
    // carries it rather than by sweeping onto it — one raycast instead of half a million, which
    // is what makes the 0.01 m figure affordable to assert at all. The point was found by an
    // off-suite 0.01 m sweep of this same disc; the coordinates are inputs here, and only the
    // height they report is the measurement.
    const argmax = ground(15.04, -49.31)
    expect(argmax, 'the worst aimed-landing point should be real ground').not.toBe(null)
    const archer2 = patrol.find((e) => e.id === 'archer-2')!
    const converged = Math.abs(argmax! - archer2.position.y)
    expect(converged).toBeGreaterThan(4.2274)
    expect(converged).toBeLessThan(4.2276)
    // Inside the disc, so it is an aimed landing rather than a point past `minRadius`, and right
    // at its rim — 4.00 m out, which is what the sentence above claims.
    const argmaxDistance = Math.hypot(15.04 - archer2.position.x, -49.31 - archer2.position.z)
    expect(argmaxDistance).toBeLessThan(radius)
    expect(argmaxDistance).toBeGreaterThan(3.99)
    // The excess over the band, as a length and as a fraction of it.
    expect(converged - band).toBeGreaterThan(0.2274)
    expect(converged - band).toBeLessThan(0.2276)
    expect((converged - band) / band).toBeGreaterThan(0.0568)
    expect((converged - band) / band).toBeLessThan(0.0569)
    // The 0.25 m grid's own figure, kept as an assertion so the artifact is documented rather
    // than merely described: sampling the same disc five times coarser lands on 4.1404, which is
    // 0.0871 m short of the truth and — this is the part that mattered — inside the old
    // `< 4.15` pin with 0.0096 m to spare.
    const coarse = ground(14.75, -49.75)
    expect(coarse, 'the old grid\'s worst point should be real ground').not.toBe(null)
    expect(Math.abs(coarse! - archer2.position.y)).toBeGreaterThan(4.140)
    expect(Math.abs(coarse! - archer2.position.y)).toBeLessThan(4.141)

    // **Coverage, and the pin that was a grid artifact.** 4.0 covers 99.28% of the aimed-landing
    // disc around the worst-placed soldier at this file's 0.05 m grid and 100% of the other
    // four, so the shortfall is 0.72% of the disc rather than the 0.63% first recorded. Again
    // two claims, and again deliberately not merged.
    //
    // The outer pair is about the terrain. It holds at 0.1 m, 0.05 m, 0.02 m and 0.01 m, and it
    // is where the old pin failed: the old `> 0.993` sat *above* the converged 0.99298, so the
    // assertion carrying the coverage claim would have gone red the moment anyone sampled finer
    // than 0.1 m. A pin that survives at exactly one sampling density is a claim about the
    // sampling.
    expect(coverageFloor).toBeGreaterThan(0.9925)
    expect(coverageFloor).toBeLessThan(0.9931)
    // The tighter pair that pins this file's own 0.05 m sampling is at the bottom of this test,
    // with the other sampling-specific figures.

    // **Where the shortfall is, which is the fact the owner decision actually rests on: it is
    // one face of one overhang, not a thin ring around the whole disc.** Split into a terrain
    // claim and a sampling claim for the same reason the coverage figures above are.
    //
    // Terrain first, at bounds that hold at 0.05 m, 0.02 m and 0.01 m alike: every failing
    // sample sits in the outermost 0.21 m of the disc — none anywhere in its interior — and all
    // of them lie inside a single bearing wedge under 38° wide on the −67°..−29° side.
    const leastD = Math.min(...failing.map((f) => f.d))
    const leastBearing = Math.min(...failing.map((f) => f.bearing))
    const mostBearing = Math.max(...failing.map((f) => f.bearing))
    expect(failing.length).toBeGreaterThan(0)
    expect(leastD).toBeGreaterThan(3.79)
    expect(radius - leastD).toBeLessThan(0.21)
    expect(Math.max(...failing.map((f) => f.d))).toBeLessThan(radius + 1e-9)
    expect(leastBearing).toBeGreaterThan(-67)
    expect(mostBearing).toBeLessThan(-29)
    expect(mostBearing - leastBearing).toBeLessThan(38)

    // And every failing sample stands on the overhang rather than on solid ground: a second
    // `home` surface lies below each one, at least 0.5 m down and in fact never less than 34.1 m
    // down, which is the island's own underside. A player who lands there has landed on a lip
    // above the soldier, not beside it. This one is grid-robust in the direction that matters —
    // refining the grid can only add samples, and more samples can only lower the minimum, so
    // the `> 0.5` floor is the claim and the two-sided pin is a measurement beside it.
    let leastAir = Infinity
    for (const f of failing) {
      const under = terrain.raycast(
        new Vector3(f.x, f.height - 0.01, f.z), new Vector3(0, -1, 0), 4000,
      )
      expect(under, `no second surface under the failing sample at ${f.x},${f.z}`).not.toBe(null)
      leastAir = Math.min(leastAir, f.height - under!.point.y)
    }
    expect(leastAir).toBeGreaterThan(0.5)
    expect(leastAir).toBeGreaterThan(34.1)
    expect(leastAir).toBeLessThan(34.3)

    // **What is deliberately no longer asserted here.** The old block pinned the least gap among
    // dropped stances at 4.060 and claimed "every miss is under 0.15 m". Both were artifacts.
    // The least dropped gap converges onto the band itself as the grid refines — a continuity
    // statement about sampling rather than about terrain, so pinning it measures `DISC_STEP` —
    // and the worst miss is 0.2275 m, so "under 0.15 m" was false by 52%. The honest version of
    // the second claim is the excess assertion above.

    // The number is left at 4.0, and the corrected figures do not change that. Moving it is a
    // design decision this cycle does not own: covering the whole disc needs at least 4.2275,
    // which would put the weakest slam more than 5% taller than it is wide and turn it into the
    // column `config.ts` argues it must not be. The two constraints have crossed, and
    // `pressure-wave.test.ts` already pins the `verticalReach <= minRadius` side at equality
    // with no slack. The owner's decision, re-taken against these figures, is recorded in
    // `docs/HANDOFF.md` and in the spec's third correction block.
    expect(worstOverall).toBeGreaterThan(C.pressureWave.minRadius)
    expect(C.pressureWave.verticalReach).toBe(C.pressureWave.minRadius)

    // **Everything below this line pins this file's 0.05 m sampling rather than the island**, and
    // it is deliberately last in the test so that refining `DISC_STEP` fails here and nowhere
    // above it. That is the property the old version of this test lacked: its grid-artifact pins
    // sat in the middle of terrain claims with nothing distinguishing them, which is how a
    // coverage bound the geometry does not support went unnoticed.
    //
    // The figures: 144 failing samples out of 20081, reaching in to 3.796 m — the outermost
    // 0.2036 m — across a wedge from −64.7° to −30.1°, with a coverage floor of 99.28%. At 0.01 m
    // the same wedge holds 3530 samples reaching in to 3.7933 m across −66.3°..−29.5°, at 99.30%.
    // If `DISC_STEP` moves, these are the numbers to re-measure; the bounds above are the ones to
    // trust. They are kept tight rather than loosened so that a retune of `verticalReach` in
    // either direction reddens something exact.
    expect(failing.length).toBe(144)
    expect(leastD).toBeGreaterThan(3.796)
    expect(radius - leastD).toBeLessThan(0.204)
    expect(leastBearing).toBeGreaterThan(-64.8)
    expect(mostBearing).toBeLessThan(-30.0)
    expect(coverageFloor).toBeGreaterThan(0.9928)
    expect(coverageFloor).toBeLessThan(0.9929)
  }, 30_000)
})
