export interface Settings {
  /** Multiplier on the base look speed. 1 is the shipped feel. */
  sensitivity: number
  invertY: boolean
  /** 0 to 1. */
  volume: number
  muted: boolean
  reduceMotion: boolean
}

export interface MotionScales {
  shake: number
  hurtFlash: number
  dashKick: number
  hitstop: number
  vignette: number
}

export const SENSITIVITY_MIN = 0.25
export const SENSITIVITY_MAX = 4

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * `prefersReducedMotion` seeds `reduceMotion` here rather than this module
 * reading `matchMedia` itself — there is no DOM in the test environment, and
 * keeping the media query out of this file keeps the whole module pure.
 */
export function defaultSettings(prefersReducedMotion: boolean): Settings {
  return {
    sensitivity: 1,
    invertY: false,
    volume: 0.7,
    muted: false,
    reduceMotion: prefersReducedMotion,
  }
}

/**
 * Never throws. Reads each field independently and falls back field by
 * field, so a single corrupted value (a hand-edited save, an old schema)
 * doesn't cost the player every other preference too.
 */
export function readSettings(raw: unknown, prefersReducedMotion: boolean): Settings {
  const fallback = defaultSettings(prefersReducedMotion)
  if (typeof raw !== 'object' || raw === null) return fallback

  const data = raw as Partial<Settings>

  const sensitivity =
    typeof data.sensitivity === 'number' && Number.isFinite(data.sensitivity)
      ? clamp(data.sensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX)
      : fallback.sensitivity

  const invertY = typeof data.invertY === 'boolean' ? data.invertY : fallback.invertY

  const volume =
    typeof data.volume === 'number' && Number.isFinite(data.volume)
      ? clamp(data.volume, 0, 1)
      : fallback.volume

  const muted = typeof data.muted === 'boolean' ? data.muted : fallback.muted

  const reduceMotion =
    typeof data.reduceMotion === 'boolean' ? data.reduceMotion : fallback.reduceMotion

  return { sensitivity, invertY, volume, muted, reduceMotion }
}

/**
 * Mute never overwrites `volume` — it only changes what gets read here — so
 * unmuting restores exactly what the player had rather than a default.
 */
export function effectiveVolume(s: Settings): number {
  return s.muted ? 0 : s.volume
}

/**
 * Five independent scalars, not one, because reduced motion isn't a single
 * dial: some effects are pure vestibular triggers that should disappear
 * outright, and two are also the player's only signal for something they
 * need to know, so they're softened instead of removed.
 */
export function motionScales(s: Settings): MotionScales {
  if (!s.reduceMotion) {
    return { shake: 1, hurtFlash: 1, dashKick: 1, hitstop: 1, vignette: 1 }
  }
  return {
    // Camera shake, the hurt flash, and the dash's FOV kick are the
    // vestibular/photosensitive triggers proper — off, not softened.
    shake: 0,
    hurtFlash: 0,
    dashKick: 0,
    // Hitstop is the main signal a hit landed; zeroing it costs legibility
    // rather than buying comfort, and a freeze is itself the absence of
    // motion, so it's softened instead of removed.
    hitstop: 0.4,
    // The vignette marks the Avatar State being active, information the
    // player still needs, so it's softened rather than switched off.
    vignette: 0.35,
  }
}
