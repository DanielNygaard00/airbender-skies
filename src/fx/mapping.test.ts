import { describe, it, expect } from 'vitest'
import {
  speedIntensity, fovForSpeed, windVolumeForSpeed, windPitchForSpeed, trailOpacityForSpeed,
  BASE_FOV, MAX_FOV_KICK, FX_SPEED_REFERENCE, TRAIL_SPEED_THRESHOLD,
  fovKickForDash, MAX_DASH_FOV_KICK,
  COMBAT_LEVELS, swingLevel, swingSeconds,
  bowReleaseLevel, BOW_RELEASE_CEILING,
} from './mapping'

describe('speedIntensity', () => {
  it('is zero at rest', () => { expect(speedIntensity(0)).toBe(0) })
  it('is one at the reference speed', () => { expect(speedIntensity(FX_SPEED_REFERENCE)).toBe(1) })
  it('clamps above the reference', () => { expect(speedIntensity(500)).toBe(1) })
  it('clamps below zero', () => { expect(speedIntensity(-10)).toBe(0) })
})

describe('fovForSpeed', () => {
  it('is the base field of view at rest', () => { expect(fovForSpeed(0)).toBe(BASE_FOV) })

  it('kicks out at full speed', () => {
    expect(fovForSpeed(FX_SPEED_REFERENCE)).toBe(BASE_FOV + MAX_FOV_KICK)
  })

  it('increases monotonically', () => {
    expect(fovForSpeed(40)).toBeGreaterThan(fovForSpeed(20))
  })

  it('stays within a sane range', () => {
    expect(fovForSpeed(1000)).toBeLessThanOrEqual(BASE_FOV + MAX_FOV_KICK)
  })
})

describe('windVolumeForSpeed', () => {
  it('is silent at rest', () => { expect(windVolumeForSpeed(0)).toBe(0) })

  it('is full at the reference speed', () => {
    expect(windVolumeForSpeed(FX_SPEED_REFERENCE)).toBe(1)
  })

  it('ramps in slowly rather than linearly', () => {
    expect(windVolumeForSpeed(FX_SPEED_REFERENCE / 2)).toBeLessThan(0.5)
  })

  it('never exceeds one', () => { expect(windVolumeForSpeed(1000)).toBe(1) })
})

describe('windPitchForSpeed', () => {
  it('rises with speed', () => {
    expect(windPitchForSpeed(50)).toBeGreaterThan(windPitchForSpeed(5))
  })

  it('stays positive at rest so playback never stops', () => {
    expect(windPitchForSpeed(0)).toBeGreaterThan(0)
  })
})

describe('trailOpacityForSpeed', () => {
  it('shows nothing below the threshold', () => {
    expect(trailOpacityForSpeed(TRAIL_SPEED_THRESHOLD - 1)).toBe(0)
  })

  it('fades in above the threshold', () => {
    expect(trailOpacityForSpeed(TRAIL_SPEED_THRESHOLD + 5)).toBeGreaterThan(0)
  })

  it('is fully opaque at the reference speed', () => {
    expect(trailOpacityForSpeed(FX_SPEED_REFERENCE)).toBe(1)
  })

  it('never exceeds one', () => { expect(trailOpacityForSpeed(1000)).toBe(1) })
})

describe('the dash FOV kick', () => {
  it('is nothing when no dash is running', () => {
    expect(fovKickForDash(0)).toBe(0)
  })

  it('peaks at six degrees on the frame the dash fires', () => {
    // A literal, not MAX_DASH_FOV_KICK: asserting the constant the code reads would
    // pass for any value, including the 14 that full glider speed already uses.
    expect(fovKickForDash(1)).toBeCloseTo(6)
  })

  it('scales with the pulse', () => {
    expect(fovKickForDash(0.5)).toBeCloseTo(3)
  })

  it('stays well under the glider speed kick, so a dash is a burst not flight', () => {
    expect(fovKickForDash(1)).toBeLessThan(MAX_FOV_KICK * 0.6)
  })

  it('composes additively with the speed FOV', () => {
    // On foot fovForSpeed(0) is a constant 70, which is why a 26 m/s dash currently
    // has no visual weight at all. The kick has to add to it rather than replace it,
    // or a dash on landing would fight the speed FOV.
    expect(fovForSpeed(0) + fovKickForDash(1)).toBeCloseTo(76)
  })

  it('clamps a pulse outside the range', () => {
    expect(fovKickForDash(-1)).toBe(0)
    expect(fovKickForDash(3)).toBeCloseTo(6)
    expect(fovKickForDash(Number.NaN)).toBe(0)
  })
})

describe('the combat voices', () => {
  it('makes the finisher louder than an opener, by a real margin', () => {
    expect(swingLevel(true)).toBeGreaterThan(swingLevel(false) * 1.2)
  })

  it('makes the finisher longer than an opener, by a real margin', () => {
    expect(swingSeconds(true)).toBeGreaterThan(swingSeconds(false) * 1.2)
  })

  it('keeps every voice audible and none of them clipping', () => {
    for (const [name, level] of Object.entries(COMBAT_LEVELS)) {
      expect(level, `${name} is silent`).toBeGreaterThan(0.05)
      expect(level, `${name} will clip`).toBeLessThanOrEqual(0.5)
    }
  })

  it('makes a hit taken the loudest thing in the fight, by a real margin', () => {
    // The player's own damage is the event they most need to notice, and before this
    // cycle it had no feedback of any kind.
    //
    // Strictly greater, and by a margin, in the same multiplicative style as the two
    // finisher tests above. With `toBeGreaterThanOrEqual` and no margin, retuning `hurt`
    // down to `down`'s 0.36 — a dead tie, where the event that matters most no longer
    // stands out at all — kept this test green. 1.1 rather than those tests' 1.2 because
    // the loudest rival, `down` at 0.36, sits 11% below `hurt`'s 0.4: this asserts the
    // gap that is actually mixed, and tightening the mix further is a tuning decision,
    // not something to smuggle in through a test.
    const others = [
      COMBAT_LEVELS.gust, COMBAT_LEVELS.swing, COMBAT_LEVELS.finisher,
      COMBAT_LEVELS.impact, COMBAT_LEVELS.down,
    ]
    expect(COMBAT_LEVELS.hurt).toBeGreaterThan(Math.max(...others) * 1.1)
  })
})

describe('the bow release', () => {
  // "is audible" and "does not clip" used to live here. Both were exact duplicates of
  // the Object.entries loop in "keeps every voice audible and none of them clipping"
  // above, which already covers bowRelease along with every other voice.

  it('is quieter than the player being hurt', () => {
    // A hit taken stays the loudest thing in the fight; an enemy's telegraph is a
    // warning, not an alarm. A margin, not a bare comparison.
    expect(COMBAT_LEVELS.bowRelease).toBeLessThan(COMBAT_LEVELS.hurt * 0.85)
  })

  it('is loud enough to notice from behind', () => {
    // It is the only warning an archer out of shot gives, so it must not be the
    // quietest thing in the mix either.
    expect(COMBAT_LEVELS.bowRelease).toBeGreaterThan(COMBAT_LEVELS.swing)
  })
})

describe('a volley of bow releases on one frame', () => {
  it('is silent when nothing was loosed', () => {
    // main.ts calls this unconditionally with the frame's count, which is zero on almost
    // every frame, so silence at zero is the common case rather than an edge case.
    expect(bowReleaseLevel(0)).toBe(0)
  })

  it('is the single-arrow level when one archer looses', () => {
    expect(bowReleaseLevel(1)).toBeCloseTo(COMBAT_LEVELS.bowRelease, 6)
  })

  it('grows with the count, by a real margin', () => {
    // Two archers loosing together should read as bigger than one, or the cap has simply
    // thrown the information away.
    expect(bowReleaseLevel(2)).toBeGreaterThan(bowReleaseLevel(1) * 1.2)
    expect(bowReleaseLevel(3)).toBeGreaterThan(bowReleaseLevel(2))
  })

  it('stays under the clipping ceiling at every count', () => {
    // The defect this function exists for. main.ts used to call the voice once per arrow,
    // and each call builds its own chain into a master at gain 1, so N identical bursts
    // starting at the same currentTime summed to N × 0.24: two reached 0.48 against the
    // ceiling and three clipped. The literal 0.5, not the constant the code reads --
    // asserting BOW_RELEASE_CEILING against itself would pass for any value.
    for (const count of [1, 2, 3, 10]) {
      expect(bowReleaseLevel(count), `${count} simultaneous releases clip`)
        .toBeLessThan(0.5)
    }
    expect(BOW_RELEASE_CEILING).toBeLessThan(0.5)
  })

  it('is not a straight multiple of the single-arrow level', () => {
    // The precise shape of the old bug, stated as its own claim: three arrows must not be
    // three times one arrow, whatever the ceiling happens to be.
    expect(bowReleaseLevel(3)).toBeLessThan(COMBAT_LEVELS.bowRelease * 3 * 0.75)
  })

  it('never gets quieter as arrows are added', () => {
    let previous = 0
    for (let count = 1; count <= 20; count++) {
      const level = bowReleaseLevel(count)
      expect(level, `${count} arrows is quieter than ${count - 1}`)
        .toBeGreaterThanOrEqual(previous)
      previous = level
    }
  })

  it('is silent for a nonsense count rather than NaN into the graph', () => {
    expect(bowReleaseLevel(-1)).toBe(0)
    expect(bowReleaseLevel(Number.NaN)).toBe(0)
    expect(bowReleaseLevel(Number.POSITIVE_INFINITY)).toBe(0)
  })
})
