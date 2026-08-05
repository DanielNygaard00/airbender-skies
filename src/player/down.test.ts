import { describe, it, expect } from 'vitest'
import {
  COLLAPSE_SCALE, collapseSquash, fadeOpacity, startDown, stepDown, type Down,
} from './down'
import { DEFAULT_DOWN_CONFIG as D } from '../core/config'

const WHOLE_BEAT = D.fadeOutSeconds + D.fadeInSeconds

/**
 * Step a fresh down at 60 Hz for `seconds`, recording the elapsed time at every frame
 * that reported a respawn. Mirrors how main.ts drives it.
 */
function run(seconds: number, dt = 1 / 60) {
  let down: Down | null = startDown()
  const respawnsAt: number[] = []
  for (let t = 0; t < seconds && down; t += dt) {
    const step = stepDown(down, dt, D)
    down = step.down
    if (step.respawnNow) respawnsAt.push(t + dt)
  }
  return { down, respawnsAt }
}

describe('stepDown', () => {
  it('starts at the beginning of the beat', () => {
    expect(startDown().elapsed).toBe(0)
  })

  it('advances by the step', () => {
    expect(stepDown(startDown(), 0.25, D).down?.elapsed).toBeCloseTo(0.25)
  })

  it('respawns exactly once, on the frame the screen reaches full black', () => {
    // Once, not never and not every frame: a repeat would respawn the player in a loop.
    const { respawnsAt } = run(WHOLE_BEAT + 1)
    expect(respawnsAt).toHaveLength(1)
    expect(respawnsAt[0]).toBeGreaterThanOrEqual(D.fadeOutSeconds)
    expect(respawnsAt[0]).toBeLessThan(D.fadeOutSeconds + 1 / 60 + 1e-9)
  })

  it('does not respawn while the screen is still fading', () => {
    // The teleport has to happen behind full black or the player watches it happen.
    const almost: Down = { elapsed: D.fadeOutSeconds - 1 / 60 }
    expect(stepDown(almost, 1 / 120, D).respawnNow).toBe(false)
  })

  it('clears itself once the fade in has finished', () => {
    expect(run(WHOLE_BEAT + 1).down).toBeNull()
  })

  it('respawns and clears in one step when a frame spans the whole beat', () => {
    const step = stepDown(startDown(), WHOLE_BEAT + 1, D)
    expect(step.respawnNow).toBe(true)
    expect(step.down).toBeNull()
  })

  it('escapes the state rather than hanging on a non-finite step', () => {
    // Clamping here would trap the player in a frozen world with no input, which is
    // strictly worse than an unexplained recovery.
    const step = stepDown(startDown(), NaN, D)
    expect(step.respawnNow).toBe(true)
    expect(step.down).toBeNull()
  })
})

describe('fadeOpacity', () => {
  it('is clear when nobody is down', () => {
    expect(fadeOpacity(null, D)).toBe(0)
  })

  it('is clear at the start of the beat', () => {
    expect(fadeOpacity(startDown(), D)).toBe(0)
  })

  it('is half way through the fade out', () => {
    expect(fadeOpacity({ elapsed: D.fadeOutSeconds / 2 }, D)).toBeCloseTo(0.5)
  })

  it('is fully black on the frame the respawn lands', () => {
    expect(fadeOpacity({ elapsed: D.fadeOutSeconds }, D)).toBe(1)
  })

  it('is clear again at the end of the beat', () => {
    expect(fadeOpacity({ elapsed: WHOLE_BEAT }, D)).toBeCloseTo(0)
  })

  it('clamps rather than going negative past the end', () => {
    expect(fadeOpacity({ elapsed: WHOLE_BEAT + 5 }, D)).toBe(0)
  })

  it('never sends a non-finite opacity to the DOM', () => {
    expect(fadeOpacity({ elapsed: NaN }, D)).toBe(0)
  })
})

describe('collapseSquash', () => {
  it('is full height when nobody is down', () => {
    expect(collapseSquash(null, D)).toBe(1)
  })

  it('is full height at the start of the beat', () => {
    expect(collapseSquash(startDown(), D)).toBe(1)
  })

  it('has sunk by the end of the fade out', () => {
    expect(collapseSquash({ elapsed: D.fadeOutSeconds - 1e-6 }, D)).toBeCloseTo(COLLAPSE_SCALE)
  })

  it('stands back up the moment the respawn lands', () => {
    // The boundary belongs to the standing-up side. He is already at the island by then,
    // and a squashed statue revealed by the lifting black would undo the whole effect.
    expect(collapseSquash({ elapsed: D.fadeOutSeconds }, D)).toBe(1)
    expect(collapseSquash({ elapsed: WHOLE_BEAT }, D)).toBe(1)
  })

  it('is full height for a non-finite timer', () => {
    expect(collapseSquash({ elapsed: NaN }, D)).toBe(1)
  })
})
