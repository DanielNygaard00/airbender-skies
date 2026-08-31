import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { BENCH_EFFECTS, benchEffect } from './effects'
import { BENCH_SCENES } from './scenes'

const ORIGIN = new Vector3(0, 11.9, 0)
const FORWARD = new Vector3(0, 0, -1)

describe('the bench effect registry', () => {
  it('can spawn every id it declares', () => {
    // A Record over BenchEffectId, so an effect added to the union without a factory is a
    // compile error rather than a bench scene that renders an empty frame.
    for (const id of Object.keys(BENCH_EFFECTS)) {
      const effect = benchEffect(id as keyof typeof BENCH_EFFECTS, ORIGIN, FORWARD)
      expect(effect.object).toBeDefined()
      expect(typeof effect.advance).toBe('function')
      expect(typeof effect.dispose).toBe('function')
      effect.dispose()
    }
  })

  it('gives every effect it can spawn at least one scene to be shot in', () => {
    // The other direction, and the one that catches the real mistake: an effect that exists,
    // is registered, and has no scene is an effect nobody ever looks at.
    const shot = new Set(BENCH_SCENES.map((s) => s.effect).filter((e) => e !== null))
    for (const id of Object.keys(BENCH_EFFECTS)) expect(shot).toContain(id)
  })

  it('advances without throwing, which is the cheapest proof a factory is wired', () => {
    for (const id of Object.keys(BENCH_EFFECTS)) {
      const effect = benchEffect(id as keyof typeof BENCH_EFFECTS, ORIGIN, FORWARD)
      for (let t = 0; t < 0.5; t += 1 / 60) effect.advance(1 / 60)
      effect.dispose()
    }
  })

  it('keeps every scene\'s frozen frame inside its effect\'s lifetime', () => {
    // `scenes.test.ts`'s own `fireAt < duration` check knows nothing about a real effect's real
    // lifetime — it would pass just as happily for a scene tuned to freeze on a corpse, exactly
    // the failure `fireAt`'s own doc comment on `BenchScene` warns about. This drives each
    // scene's own effect for `duration - fireAt` seconds, the effect's age at the moment the
    // bench stops, and requires `advance` still report the effect alive there: every real effect
    // returns `age < LIFETIME`, and the two held-state wrappers in this file return their own
    // equivalent (`held < maxChargeSeconds`, `up || panel.object.visible`) — `false` in either
    // case means the frame the bench would freeze on shows nothing.
    const STEP = 1 / 240
    for (const scene of BENCH_SCENES) {
      if (scene.effect === null) continue
      const effect = benchEffect(scene.effect, ORIGIN, FORWARD)
      const life = scene.duration - scene.fireAt
      let alive = true
      let elapsed = 0
      while (elapsed < life) {
        const dt = Math.min(STEP, life - elapsed)
        alive = effect.advance(dt)
        elapsed += dt
      }
      expect(alive).toBe(true)
      effect.dispose()
    }
  })
})
