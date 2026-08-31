import { describe, expect, it, vi } from 'vitest'
import { BENCH_SCENES, resolveBench } from './scenes'
import { LEVELS } from '../world/levels'

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
