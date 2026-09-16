import { describe, it, expect } from 'vitest'
import { Mesh, Vector3, type MeshLambertMaterial } from 'three'
import { createEarthRocks } from './earth-rocks'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { inStoneThrow, stoneShape } from '../combat/earth'

const EARTH = DEFAULT_COMBAT_CONFIG.earth
const ORIGIN = new Vector3(0, 0, 0)
const FORWARD = new Vector3(0, 0, 1)

function rocksOf(effect: { object: { children: unknown[] } }): Mesh[] {
  return effect.object.children.filter((child): child is Mesh => child instanceof Mesh)
}

/** Run the volley to `seconds`, reporting whether it was still alive at the end. */
function run(effect: ReturnType<typeof createEarthRocks>, seconds: number): boolean {
  let alive = true
  for (let t = 0; t < seconds; t += 1 / 120) alive = effect.advance(1 / 120)
  return alive
}

describe('createEarthRocks', () => {
  it('throws a volley rather than one rock', () => {
    const effect = createEarthRocks(ORIGIN, FORWARD, EARTH)
    expect(rocksOf(effect).length).toBeGreaterThan(3)
    effect.dispose()
  })

  it('starts them at the hands rather than on the floor', () => {
    // Rocks scuffed off the ground read as debris kicked up by something else.
    const effect = createEarthRocks(ORIGIN, FORWARD, EARTH)
    for (const rock of rocksOf(effect)) expect(rock.position.y).toBeGreaterThan(0.8)
    effect.dispose()
  })

  it('sends every rock into the cone the throw actually covers', () => {
    // Checked against `inStoneThrow`, the simulation's own membership test, rather than against
    // a repeat of the angle here -- the same discipline `earth-reach.ts` keeps for the sector it
    // draws. A volley that flew wider than the cone would teach a reach that does not bite.
    const effect = createEarthRocks(ORIGIN, FORWARD, EARTH)
    run(effect, 0.3)

    for (const rock of rocksOf(effect)) {
      const landed = ORIGIN.clone().add(rock.position)
      expect(inStoneThrow(ORIGIN, FORWARD, landed, EARTH)).toBe(true)
    }
    effect.dispose()
  })

  it('carries them outward, not just upward', () => {
    const effect = createEarthRocks(ORIGIN, FORWARD, EARTH)
    const before = rocksOf(effect).map((rock) => rock.position.z)
    run(effect, 0.3)
    const after = rocksOf(effect).map((rock) => rock.position.z)
    for (let i = 0; i < before.length; i++) {
      expect(after[i] ?? 0).toBeGreaterThan((before[i] ?? 0) + 1)
    }
    effect.dispose()
  })

  it('reaches most of the throw s range before it is done', () => {
    // The volley has to cover the ground the sector promised, or the two tells disagree about
    // how far the move goes.
    const effect = createEarthRocks(ORIGIN, FORWARD, EARTH)
    run(effect, 0.61)
    const furthest = Math.max(...rocksOf(effect).map((rock) => rock.position.length()))
    expect(furthest).toBeGreaterThan(stoneShape(EARTH).range * 0.6)
    effect.dispose()
  })

  it('arcs: every rock is falling by the time it lands', () => {
    // Thrown under gravity rather than fired along a rail, which is the difference between a
    // rock and a bullet.
    const effect = createEarthRocks(ORIGIN, FORWARD, EARTH)
    run(effect, 0.3)
    const mid = rocksOf(effect).map((rock) => rock.position.y)
    run(effect, 0.25)
    const late = rocksOf(effect).map((rock) => rock.position.y)
    for (let i = 0; i < mid.length; i++) expect(late[i] ?? 0).toBeLessThan(mid[i] ?? 0)
    effect.dispose()
  })

  it('tumbles them', () => {
    const effect = createEarthRocks(ORIGIN, FORWARD, EARTH)
    const before = rocksOf(effect).map((rock) => rock.rotation.x)
    run(effect, 0.2)
    const after = rocksOf(effect).map((rock) => rock.rotation.x)
    for (let i = 0; i < before.length; i++) expect(after[i]).not.toBeCloseTo(before[i] ?? 0, 3)
    effect.dispose()
  })

  it('stays solid through the part of the flight that is read', () => {
    // A rock fading from the moment it leaves the hand never looks thrown; it looks summoned
    // and then cancelled.
    const effect = createEarthRocks(ORIGIN, FORWARD, EARTH)
    run(effect, 0.3)
    for (const rock of rocksOf(effect)) {
      expect((rock.material as MeshLambertMaterial).opacity).toBeCloseTo(1, 6)
    }
    effect.dispose()
  })

  it('ends, and reports that it has', () => {
    const effect = createEarthRocks(ORIGIN, FORWARD, EARTH)
    expect(run(effect, 0.5)).toBe(true)
    expect(run(effect, 0.3)).toBe(false)
    effect.dispose()
  })

  it('is the same volley every time, so the bench can photograph it', () => {
    // `src/bench` runs a fixed clock to a fixed time and expects the same image every run. One
    // call to Math.random in here would quietly destroy the tool used to check this effect.
    const first = createEarthRocks(ORIGIN, FORWARD, EARTH)
    const second = createEarthRocks(ORIGIN, FORWARD, EARTH)
    run(first, 0.3)
    run(second, 0.3)
    const positions = (effect: typeof first) => rocksOf(effect).map((r) => r.position.toArray())
    expect(positions(second)).toEqual(positions(first))
    first.dispose()
    second.dispose()
  })

  it('throws level even when the caster is looking at their feet', () => {
    // The cone the simulation tests is horizontal, so a steeply aimed throw must not put its
    // rocks into the ground short of the reach the sector just drew.
    const aim = new Vector3(0, -0.9, 0.44).normalize()
    const steep = createEarthRocks(ORIGIN, aim, EARTH)
    run(steep, 0.3)
    for (const rock of rocksOf(steep)) {
      expect(inStoneThrow(ORIGIN, aim, ORIGIN.clone().add(rock.position), EARTH)).toBe(true)
    }
    steep.dispose()
  })

  it('survives a degenerate heading rather than throwing nothing anywhere', () => {
    // Straight up has no horizontal component to build a cone around.
    const effect = createEarthRocks(ORIGIN, new Vector3(0, 1, 0), EARTH)
    run(effect, 0.3)
    for (const rock of rocksOf(effect)) {
      expect(Number.isFinite(rock.position.x)).toBe(true)
      expect(Number.isFinite(rock.position.z)).toBe(true)
    }
    effect.dispose()
  })

  it('ignores a corrupted frame time rather than flinging the volley to NaN', () => {
    const effect = createEarthRocks(ORIGIN, FORWARD, EARTH)
    effect.advance(Number.NaN)
    effect.advance(-1)
    for (const rock of rocksOf(effect)) expect(Number.isFinite(rock.position.y)).toBe(true)
    effect.dispose()
  })
})
