import { describe, it, expect } from 'vitest'
import { defaultSettings, readSettings, effectiveVolume, motionScales } from './settings'
import { DEFAULT_QUALITY } from './quality'
// Reached across from the fx layer deliberately: the `speedFov` scalar below is argued from
// what `fovForSpeed` actually produces, and asserting those degrees is the only way the
// argument in that comment can be wrong and caught.
import { BASE_FOV, FX_SPEED_REFERENCE, MAX_DASH_FOV_KICK, fovForSpeed } from '../fx/mapping'

describe('readSettings', () => {
  // Every fixture below gives the *other* fields non-default values. If the
  // implementation fell back to defaultSettings() wholesale on a single bad
  // field, these other fields would also read back as defaults and the
  // assertions below would still pass — so they have to start non-default to
  // tell field-by-field fallback apart from whole-object fallback.

  it('falls back only the sensitivity field when it is not a number', () => {
    const result = readSettings(
      { sensitivity: 'fast', invertY: true, volume: 0.3, muted: true, reduceMotion: true },
      false,
    )
    expect(result.sensitivity).toBe(1)
    expect(result.invertY).toBe(true)
    expect(result.volume).toBe(0.3)
    expect(result.muted).toBe(true)
    expect(result.reduceMotion).toBe(true)
  })

  it('falls back only the volume field when it is NaN', () => {
    const result = readSettings(
      { sensitivity: 2, invertY: true, volume: NaN, muted: true, reduceMotion: true },
      false,
    )
    expect(result.volume).toBe(0.7)
    expect(result.sensitivity).toBe(2)
    expect(result.invertY).toBe(true)
    expect(result.muted).toBe(true)
    expect(result.reduceMotion).toBe(true)
  })

  it('falls back only the invertY field when it is null', () => {
    const result = readSettings(
      { sensitivity: 2, invertY: null, volume: 0.3, muted: true, reduceMotion: true },
      false,
    )
    expect(result.invertY).toBe(false)
    expect(result.sensitivity).toBe(2)
    expect(result.volume).toBe(0.3)
    expect(result.muted).toBe(true)
    expect(result.reduceMotion).toBe(true)
  })

  it('falls back only the muted field when it is absent', () => {
    const result = readSettings(
      { sensitivity: 2, invertY: true, volume: 0.3, reduceMotion: true },
      false,
    )
    expect(result.muted).toBe(false)
    expect(result.sensitivity).toBe(2)
    expect(result.invertY).toBe(true)
    expect(result.volume).toBe(0.3)
    expect(result.reduceMotion).toBe(true)
  })

  it('falls back only the reduceMotion field, to the media-query parameter, when it is a stray string', () => {
    const result = readSettings(
      { sensitivity: 2, invertY: true, volume: 0.3, muted: true, reduceMotion: 'yes' },
      true,
    )
    expect(result.reduceMotion).toBe(true)
    expect(result.sensitivity).toBe(2)
    expect(result.invertY).toBe(true)
    expect(result.volume).toBe(0.3)
    expect(result.muted).toBe(true)
  })

  it('returns defaults for null, undefined, and a non-object payload', () => {
    expect(readSettings(null, false)).toEqual(defaultSettings(false))
    expect(readSettings(undefined, false)).toEqual(defaultSettings(false))
    expect(readSettings('nonsense', false)).toEqual(defaultSettings(false))
  })

  it('clamps sensitivity below the floor up to 0.25', () => {
    expect(readSettings({ sensitivity: 0.1 }, false).sensitivity).toBe(0.25)
  })

  it('clamps sensitivity above the ceiling down to 4', () => {
    expect(readSettings({ sensitivity: 10 }, false).sensitivity).toBe(4)
  })

  it('passes sensitivity at the floor through unchanged', () => {
    expect(readSettings({ sensitivity: 0.25 }, false).sensitivity).toBe(0.25)
  })

  it('passes sensitivity at the ceiling through unchanged', () => {
    expect(readSettings({ sensitivity: 4 }, false).sensitivity).toBe(4)
  })

  it('clamps volume below 0 up to 0', () => {
    expect(readSettings({ volume: -1 }, false).volume).toBe(0)
  })

  it('clamps volume above 1 down to 1', () => {
    expect(readSettings({ volume: 2 }, false).volume).toBe(1)
  })

  it('passes volume at 0 through unchanged', () => {
    expect(readSettings({ volume: 0 }, false).volume).toBe(0)
  })

  it('passes volume at 1 through unchanged', () => {
    expect(readSettings({ volume: 1 }, false).volume).toBe(1)
  })
})

describe('effectiveVolume', () => {
  it('is the volume field when not muted', () => {
    expect(effectiveVolume({ sensitivity: 1, invertY: false, volume: 0.55, muted: false, reduceMotion: false, quality: DEFAULT_QUALITY })).toBe(
      0.55,
    )
  })

  it('is 0 when muted, without touching the stored volume, so unmuting restores it', () => {
    const s = { sensitivity: 1, invertY: false, volume: 0.55, muted: true, reduceMotion: false, quality: DEFAULT_QUALITY }
    expect(effectiveVolume(s)).toBe(0)
    expect(s.volume).toBe(0.55)
  })
})

describe('motionScales', () => {
  const normal = motionScales(defaultSettings(false))
  const reduced = motionScales(defaultSettings(true))

  it('leaves shake at full strength normally, and removes it when reduced', () => {
    expect(normal.shake).toBe(1)
    expect(reduced.shake).toBe(0)
  })

  it('leaves hurtFlash at full strength normally, and removes it when reduced', () => {
    expect(normal.hurtFlash).toBe(1)
    expect(reduced.hurtFlash).toBe(0)
  })

  it('leaves dashKick at full strength normally, and removes it when reduced', () => {
    expect(normal.dashKick).toBe(1)
    expect(reduced.dashKick).toBe(0)
  })

  it('leaves hitstop at full strength normally, and only softens it to 0.4 when reduced', () => {
    expect(normal.hitstop).toBe(1)
    expect(reduced.hitstop).toBe(0.4)
  })

  it('leaves vignette at full strength normally, and only softens it to 0.35 when reduced', () => {
    expect(normal.vignette).toBe(1)
    expect(reduced.vignette).toBe(0.35)
  })

  it('leaves speedFov at full strength normally, and only softens it to 0.35 when reduced', () => {
    expect(normal.speedFov).toBe(1)
    expect(reduced.speedFov).toBe(0.35)
  })

  it('softens the speed field of view to less than the dash punch it replaced', () => {
    // The argument for 0.35 rather than 0, pinned. `fovForSpeed` swings 14 degrees across
    // the speed range and this is the game's largest and most sustained motion effect, so
    // it cannot be left alone; but it is also the cue that makes fast flight read as fast,
    // so it is softened like `hitstop` and `vignette` rather than zeroed like `dashKick`.
    // 0.35 leaves 4.9 degrees, which is under the 6-degree dash punch `dashKick` switches
    // off entirely — the residual is quieter than the transient this cycle already
    // rejected, which is what makes softening defensible instead of a half-measure.
    const residual = fovForSpeed(FX_SPEED_REFERENCE, reduced.speedFov) - BASE_FOV
    expect(residual).toBeCloseTo(4.9)
    expect(residual).toBeLessThan(MAX_DASH_FOV_KICK)
    // And it stays a cue: 20 m/s and 50 m/s still look different under reduce motion.
    expect(fovForSpeed(50, reduced.speedFov)).toBeGreaterThan(fovForSpeed(20, reduced.speedFov))
  })
})

describe('the quality setting', () => {
  it('defaults to the default tier', () => {
    expect(defaultSettings(false).quality).toBe(DEFAULT_QUALITY)
  })

  it('resolves a payload written before the field existed', () => {
    // The migration case, and the reason it matters: every player who has opened the
    // settings panel already has a stored payload with no `quality` key in it.
    const stored = { sensitivity: 1.5, invertY: true, volume: 0.4, muted: false, reduceMotion: false }
    expect(readSettings(stored, false).quality).toBe(DEFAULT_QUALITY)
  })

  it('keeps a stored tier', () => {
    expect(readSettings({ quality: 'low' }, false).quality).toBe('low')
    expect(readSettings({ quality: 'medium' }, false).quality).toBe('medium')
  })

  it('discards a tier that is not one', () => {
    for (const bad of ['ultra', '', 'HIGH', 3, null]) {
      expect(readSettings({ quality: bad }, false).quality).toBe(DEFAULT_QUALITY)
    }
  })

  it('does not let a bad tier cost the player their other preferences', () => {
    // The field-by-field fallback readSettings already promises, extended to the new field.
    const s = readSettings({ sensitivity: 2, invertY: true, quality: 'ultra' }, false)
    expect(s.sensitivity).toBe(2)
    expect(s.invertY).toBe(true)
    expect(s.quality).toBe(DEFAULT_QUALITY)
  })
})

describe('defaultSettings', () => {
  it('differs between prefersReducedMotion true and false only in reduceMotion', () => {
    const normal = defaultSettings(false)
    const reduced = defaultSettings(true)
    expect(normal.reduceMotion).toBe(false)
    expect(reduced.reduceMotion).toBe(true)
    expect(reduced.sensitivity).toBe(normal.sensitivity)
    expect(reduced.invertY).toBe(normal.invertY)
    expect(reduced.volume).toBe(normal.volume)
    expect(reduced.muted).toBe(normal.muted)
  })
})
