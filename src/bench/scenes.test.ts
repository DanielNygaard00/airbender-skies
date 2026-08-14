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
