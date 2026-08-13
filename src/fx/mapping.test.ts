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

  it('swings 14 degrees at the reference speed and 7 at half of it', () => {
    // The two figures `motionScales`' `speedFov` comment argues from, written out as
    // literals rather than derived from the constants: the point of the assertion is that
    // the numbers quoted in that comment are the numbers this function actually produces.
    // 27.5 m/s is not arbitrary either — it is the scooter cruise speed `input.ts` records.
    expect(fovForSpeed(55) - BASE_FOV).toBeCloseTo(14)
    expect(fovForSpeed(27.5) - BASE_FOV).toBeCloseTo(7)
  })

  it('scales the kick and never the base', () => {
    // Reduce motion softens the speed kick through this argument. It has to leave BASE_FOV
    // alone: a scale on the whole angle would narrow the camera to nothing at 0 and make
    // the softened case a different lens rather than a calmer one.
    expect(fovForSpeed(FX_SPEED_REFERENCE, 0)).toBe(BASE_FOV)
    expect(fovForSpeed(0, 0)).toBe(BASE_FOV)
    expect(fovForSpeed(FX_SPEED_REFERENCE, 0.5)).toBeCloseTo(BASE_FOV + MAX_FOV_KICK / 2)
  })

  it('is unscaled when no scale is given', () => {
    // The default keeps this module correct on its own, and keeps a caller that has no
    // settings to hand from silently getting a narrowed view.
    expect(fovForSpeed(FX_SPEED_REFERENCE)).toBe(fovForSpeed(FX_SPEED_REFERENCE, 1))
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
    // Both bounds are strict. 0.5 is the mix's clipping threshold, not the last safe level, so
    // a voice sitting exactly on it is at best marginal rather than compliant -- and this used
    // to be `toBeLessThanOrEqual`, which accepted exactly that. The volley test below holds
    // `bowReleaseLevel` to the same 0.5 with a strict `toBeLessThan`, and the audibility bound
    // on the line above has always been strict, so the `<=` here was the odd one out and the
    // looser of the two treatments of one threshold.
    for (const [name, level] of Object.entries(COMBAT_LEVELS)) {
      expect(level, `${name} is silent`).toBeGreaterThan(0.05)
      expect(level, `${name} will clip`).toBeLessThan(0.5)
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
    // the loudest rival sits comfortably below `hurt`: this asserts the gap that is
    // actually mixed, and tightening the mix further is a tuning decision, not something
    // to smuggle in through a test. The rival used to be `down` at 0.36 against a `hurt`
    // of 0.4, an 11% gap; it is now the Ice Lock's 0.42 against 0.47, which is why `hurt`
    // moved rather than the freeze -- see the note on `hurt` in `mapping.ts`.
    // Derived from the record rather than listed, which this used to be. The list named five
    // voices and the mix now has eight, so `bowRelease` and `clang` were both outside it -- and a
    // new voice added at 0.45 would have left `hurt` no longer the loudest with nothing objecting.
    // `bowRelease` is the only entry whose own level is not the whole story, and its volley
    // ceiling has its own assertion further down.
    const others = Object.entries(COMBAT_LEVELS)
      .filter(([name]) => name !== 'hurt')
      .map(([, level]) => level)
    expect(COMBAT_LEVELS.hurt).toBeGreaterThan(Math.max(...others) * 1.1)
  })
})

describe('fire\'s two voices', () => {
  it('makes the burst the loudest of the player\'s damage moves', () => {
    // The mix has to rank the player's own moves the way the damage figures do, or the one move in
    // the kit that really hurts somebody is also one of the quietest. Both rivals asserted, because
    // the gust is the other move on the same key and the finisher is the other big hit.
    expect(COMBAT_LEVELS.fireBurst).toBeGreaterThan(COMBAT_LEVELS.gust)
    expect(COMBAT_LEVELS.fireBurst).toBeGreaterThan(COMBAT_LEVELS.finisher)
  })

  it('keeps the burst under the down it is trying to cause', () => {
    // The two land on the same frame whenever a burst finishes a soldier, and the *event* has to be
    // the louder of the pair — otherwise the confirmation the player is listening for is buried under
    // the thing that caused it.
    expect(COMBAT_LEVELS.fireBurst).toBeLessThan(COMBAT_LEVELS.down)
  })

  it('leaves the Ice Lock the loudest thing the player can do', () => {
    // The freeze's own claim, which it keeps: it spends a third of the Focus bar where fire spends a
    // charge a landing gives back. If fire ever wants to be louder than this, `hurt` has to move
    // first — see the note on `hurt` in `mapping.ts`, and the derived margin test above, which is the
    // constraint to argue with rather than route around.
    expect(COMBAT_LEVELS.fireBurst).toBeLessThan(COMBAT_LEVELS.freeze)
    expect(COMBAT_LEVELS.fireThrust).toBeLessThan(COMBAT_LEVELS.freeze)
  })

  it('makes the thrust audible over the wind it is heard in', () => {
    // The only voice here for a move that hits nobody, and the only one heard in the glider rather
    // than at fighting range — `createWindAudio` is at full strength by the speed reference. So it
    // sits above the quietest player voice rather than at the bottom of the mix, and still below the
    // burst, because spending a charge to move is a smaller event than spending one to hurt someone.
    expect(COMBAT_LEVELS.fireThrust).toBeGreaterThan(COMBAT_LEVELS.grip)
    expect(COMBAT_LEVELS.fireThrust).toBeLessThan(COMBAT_LEVELS.fireBurst)
  })

  it('leaves the element switch the quietest voice in the game', () => {
    // Fire adds two voices and neither may undercut the switch, which is deliberately under half the
    // softest thing in the fight because it is free and happens several times an exchange.
    for (const level of [COMBAT_LEVELS.fireBurst, COMBAT_LEVELS.fireThrust]) {
      expect(level).toBeGreaterThan(COMBAT_LEVELS.elementSwitch * 2)
    }
  })
})

describe('a blow bouncing off armour', () => {
  it('is exactly as loud as a blow that lands', () => {
    // Deliberately equal to `impact` rather than below it. The instinct is to make a move that did
    // nothing quieter than one that connected, and it is wrong here: quiet reads as "barely hit",
    // and the one conclusion the player must not draw from a gust on a heavy is that it hit a
    // little. The whole difference is carried by timbre in `combat-audio.ts` -- a short high snap
    // against a low thud -- so the level has to hold still.
    //
    // Tied to `impact` rather than pinned at 0.3, because the two are the same number for a reason
    // and should move together if the mix is ever rebalanced.
    expect(COMBAT_LEVELS.clang).toBe(COMBAT_LEVELS.impact)
  })

  it('is not the loudest thing in the fight', () => {
    // A deflect is information, not an alarm. The `hurt` assertion above already covers this by
    // derivation; stated here as well because this is where a reader looks for the clang's place
    // in the mix.
    expect(COMBAT_LEVELS.clang).toBeLessThan(COMBAT_LEVELS.hurt)
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
