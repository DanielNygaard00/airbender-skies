import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { BENCH_EFFECTS, benchEffect } from './effects'
import { BENCH_SCENES } from './scenes'
import { runFixedClock } from './clock'

// Matches `bench/main.ts`'s own `STEP_SECONDS`: the guard below has to advance at the real
// bench's fixed step, not an arbitrary one, or the age it derives is a fiction of its own step
// size rather than the age the bench would actually freeze on.
const STEP = 1 / 60

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
    // the failure `fireAt`'s own doc comment on `BenchScene` warns about. This requires `advance`
    // still report the effect alive at the exact frame the bench would freeze on: every real
    // effect returns `age < LIFETIME`, and the two held-state wrappers in this file return their
    // own equivalent (`held < maxChargeSeconds`, `up || panel.object.visible`) — `false` in
    // either case means the frame the bench would freeze on shows nothing.
    //
    // **Runs the scene through the real clock rather than approximating its age.** A prior
    // version of this test drove the effect for `scene.duration - scene.fireAt` seconds, which is
    // not the age the bench actually freezes on: `runFixedClock` (`./clock.ts`) fires on the
    // first fixed `STEP` where `elapsed >= fireAt` and keeps calling `advance` on every step after
    // that — including the firing step itself — through to the step where `elapsed >= duration`,
    // which is a real age a step or two later than the naive subtraction implies (`STEP` never
    // divides a scene's own numbers evenly, and the loop always runs one full step past the
    // boundary it is checking — the same float-drift argument `clock.ts`'s own comment makes for
    // `MAX_SANE_STEPS`'s padding). Reusing `runFixedClock` itself, rather than re-deriving that
    // arithmetic here a second time, is what keeps this guard from silently drifting out of step
    // with the loop it exists to check — a second formula is a second place for the two to
    // disagree.
    for (const scene of BENCH_SCENES) {
      if (scene.effect === null) continue
      const effectId = scene.effect
      let effect: ReturnType<typeof benchEffect> | undefined
      let alive = true
      runFixedClock(
        scene.fireAt,
        scene.duration,
        STEP,
        () => { effect = benchEffect(effectId, ORIGIN, FORWARD) },
        (dt) => {
          if (effect) alive = effect.advance(dt)
        },
      )
      expect(alive).toBe(true)
      effect?.dispose()
    }
  })
})
