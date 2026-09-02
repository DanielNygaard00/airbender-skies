import { Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { AT_PARAM, BENCH_SCENES, resolveBench, type BenchScene } from './scenes'
import { LEVELS } from '../world/levels'
import { runFixedClock } from './clock'

// Matches `bench/main.ts`'s own `STEP_SECONDS`, the same reason `effects.test.ts`'s own `STEP`
// gives: the age a scene actually freezes at is a property of the real fixed step, not of
// whatever step size a test happens to pick.
const STEP = 1 / 60

/**
 * The real age `runFixedClock` freezes a scene's effect at — computed the same way
 * `effects.test.ts` computes it, by running the actual clock and counting seconds from the
 * fire callback onward, not by subtracting `fireAt` from `duration`. This function is the sole
 * authority the `at`-override tests below check against; a hand-rolled formula here could
 * quietly agree with a wrong implementation instead of catching one.
 */
function realAgeOf(scene: Pick<BenchScene, 'fireAt' | 'duration'>): number {
  let age = 0
  let hasFired = false
  runFixedClock(
    scene.fireAt,
    scene.duration,
    STEP,
    () => { hasFired = true },
    (dt) => { if (hasFired) age += dt },
  )
  return age
}

describe('bench scenes', () => {
  it('names every scene once', () => {
    const ids = BENCH_SCENES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('points every scene at a region that exists', () => {
    // A scene naming a region that was renamed would render an empty sky, which reads as a
    // broken effect rather than as a broken bench entry.
    for (const scene of BENCH_SCENES) {
      expect(LEVELS.map((l) => l.id)).toContain(scene.regionId)
    }
  })

  it('gives every scene a finite pose, a sane elevation and a positive duration', () => {
    for (const scene of BENCH_SCENES) {
      for (const v of [scene.camera.position, scene.camera.target]) {
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true)
      }
      expect(scene.elevation).toBeGreaterThanOrEqual(0)
      expect(scene.elevation).toBeLessThanOrEqual(90)
      expect(scene.duration).toBeGreaterThan(0)
      expect(scene.fireAt).toBeGreaterThanOrEqual(0)
      expect(scene.fireAt).toBeLessThan(scene.duration)
    }
  })

  it('never poses the camera on its own target', () => {
    // A zero-length look vector makes the view matrix degenerate and the shot black.
    for (const scene of BENCH_SCENES) {
      expect(scene.camera.position.distanceTo(scene.camera.target)).toBeGreaterThan(0.5)
    }
  })

  it('resolves a registered id', () => {
    // Non-null: the registry test above already established there is at least one scene.
    const first = BENCH_SCENES[0]!
    expect(resolveBench(`?scene=${first.id}`)).toBe(first)
  })

  it('treats an absent or empty parameter as no bench', () => {
    expect(resolveBench('')).toBeNull()
    expect(resolveBench('?scene=')).toBeNull()
    expect(resolveBench('?region=canyon-country')).toBeNull()
  })

  it('shoots water-grip from the same poses as the gust, so the collar gate compares against an identical frame', () => {
    // `water` and `water-canyon` exist to compare the grip's collar against the gust's flat
    // arc, not against a differently-framed picture of it — see the scenes' own doc comments.
    // A hand-edit to either pose would silently break that comparison without failing any
    // other check here, since a pose is just as "finite and non-degenerate" moved a metre as
    // it was before.
    const gust = BENCH_SCENES.find((s) => s.id === 'gust')!
    const water = BENCH_SCENES.find((s) => s.id === 'water')!
    expect(water.camera.position.equals(gust.camera.position)).toBe(true)
    expect(water.camera.target.equals(gust.camera.target)).toBe(true)
    expect(water.elevation).toBe(gust.elevation)

    const gustCanyon = BENCH_SCENES.find((s) => s.id === 'gust-canyon')!
    const waterCanyon = BENCH_SCENES.find((s) => s.id === 'water-canyon')!
    expect(waterCanyon.camera.position.equals(gustCanyon.camera.position)).toBe(true)
    expect(waterCanyon.camera.target.equals(gustCanyon.camera.target)).toBe(true)
    expect(waterCanyon.elevation).toBe(gustCanyon.elevation)
  })

  it('shoots the two remaining ground effects from the same pose as the gust, so nothing but the effect differs', () => {
    // `earth-reach` and `fire-burst` still reuse `gust`'s camera and elevation verbatim, for the
    // reason `water`'s own comment argues against `gust`: with an identical frame the only thing
    // that can differ between two shots is the effect. A hand-edit to either pose would silently
    // break that comparison without failing any other check here, the same trap the water/gust
    // case above guards against.
    //
    // `fire-thrust` used to be the third name in this list. It no longer is — see its own scene
    // comment and the dedicated test just below for why the shared frame cannot hold it.
    const gust = BENCH_SCENES.find((s) => s.id === 'gust')!
    for (const id of ['earth-reach', 'fire-burst']) {
      const scene = BENCH_SCENES.find((s) => s.id === id)!
      expect(scene.camera.position.equals(gust.camera.position)).toBe(true)
      expect(scene.camera.target.equals(gust.camera.target)).toBe(true)
      expect(scene.elevation).toBe(gust.elevation)
    }
  })

  it('gives fire-thrust its own closer pose, since the shared frame photographs the plume as an invisible sliver', () => {
    // The plume is a 0.34-unit slab; at the shared frame's ~22-unit throw it measured as a pale
    // sliver a few pixels across near the bottom edge of the frame, indistinguishable from
    // nothing — the failure this whole bench exists to catch, in the one shot meant to catch it
    // for fire's resource cost. See `fire-thrust`'s own scene comment for the full argument and
    // the measurements this pose is built from. Pinned as a literal, the same way the shared-pose
    // tests above pin `gust`'s: a hand-edit back toward the wide pose would silently reintroduce
    // the sliver without failing any other check in this file.
    const scene = BENCH_SCENES.find((s) => s.id === 'fire-thrust')!
    expect(scene.camera.position.equals(new Vector3(4.5, 13.8, 0))).toBe(true)
    expect(scene.camera.target.equals(new Vector3(0, 11.9, 0))).toBe(true)
  })

  it('shoots the staff finisher from the same pose and timing as the opener, so the swing is the only difference', () => {
    // The argument `water`'s own comment makes at length against `gust`, applied to two shots of
    // one weapon instead of two effects. Pinned as literals, the same way the shared-pose tests
    // above pin `gust`'s: a hand-edit to either scene would silently break the comparison without
    // failing any other check in this file.
    const opener = BENCH_SCENES.find((s) => s.id === 'staff-opener')!
    const finisher = BENCH_SCENES.find((s) => s.id === 'staff-finisher')!
    expect(finisher.camera.position.equals(opener.camera.position)).toBe(true)
    expect(finisher.camera.target.equals(opener.camera.target)).toBe(true)
    expect(finisher.elevation).toBe(opener.elevation)
    expect(finisher.fireAt).toBe(opener.fireAt)
    expect(finisher.duration).toBe(opener.duration)
  })

  it('warns and returns nothing for an unknown id', () => {
    // Falls back to nothing rather than to a default scene: a mistyped bench id should say
    // so, and silently rendering a different scene is how a screenshot gets filed against
    // the wrong effect.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveBench('?scene=nope')).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('bench scenes: the `at` age override', () => {
  it('lands the real age, run through runFixedClock exactly as effects.test.ts computes it, within one step of a valid `at`', () => {
    // impact-deflect is the scene named in this task's own brief: its own fireAt (0.01) sits
    // close enough to a single step that this case also exercises the override choosing a
    // duration shorter than fireAt itself (see `resolveBench`'s own comment on why that is
    // correct rather than a bug). The wider values check the general case.
    const scene = BENCH_SCENES.find((s) => s.id === 'impact-deflect')!
    for (const at of [0.01, 0.02, 0.05, 0.08]) {
      const resolved = resolveBench(`?scene=impact-deflect&${AT_PARAM}=${at}`)
      expect(resolved).not.toBeNull()
      const age = realAgeOf(resolved!)
      expect(Math.abs(age - at)).toBeLessThanOrEqual(STEP)
      // `at` overrides `duration` and leaves `fireAt` alone — the effect still fires at the
      // same point in the run the camera pose and world state were chosen around.
      expect(resolved!.fireAt).toBe(scene.fireAt)
    }
  })

  it('leaves every scene\'s duration exactly as the table has it when `at` is absent', () => {
    for (const scene of BENCH_SCENES) {
      const resolved = resolveBench(`?scene=${scene.id}`)
      expect(resolved).not.toBeNull()
      expect(resolved!.duration).toBe(scene.duration)
      expect(resolved!.fireAt).toBe(scene.fireAt)
    }
  })

  it('falls back to the table\'s own timing, and warns, for every malformed `at`', () => {
    const scene = BENCH_SCENES.find((s) => s.id === 'gust')!
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const bad of ['-1', '0', 'NaN', '', 'banana', 'Infinity']) {
      warn.mockClear()
      const resolved = resolveBench(`?scene=gust&${AT_PARAM}=${bad}`)
      expect(resolved).not.toBeNull()
      expect(resolved!.duration).toBe(scene.duration)
      expect(resolved!.fireAt).toBe(scene.fireAt)
      expect(warn).toHaveBeenCalledOnce()
    }
    warn.mockRestore()
  })

  it('does not mutate BENCH_SCENES when overriding duration', () => {
    const before = BENCH_SCENES.find((s) => s.id === 'gust')!.duration
    const resolved = resolveBench(`?scene=gust&${AT_PARAM}=0.5`)
    expect(resolved).not.toBeNull()
    expect(resolved!.duration).not.toBe(before)
    const after = BENCH_SCENES.find((s) => s.id === 'gust')!.duration
    expect(after).toBe(before)
    // Not merely unchanged in value — a different object than the table's own entry.
    expect(resolved).not.toBe(BENCH_SCENES.find((s) => s.id === 'gust'))
  })
})
