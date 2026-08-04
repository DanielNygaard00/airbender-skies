import { MathUtils } from 'three'

/**
 * Health for a crowd-control evasion fighter.
 *
 * The design doc is specific: health is small, there is no block and no parry, and
 * it regenerates slowly out of combat. Small health is the whole reason the
 * defensive options have to be positional — a pool big enough to trade through
 * would quietly turn Aang into the damage-per-second character the doc says the
 * systems should make fail.
 */
export interface Health {
  current: number
  max: number
  /** Seconds since the last hit. Regeneration waits on this. */
  sinceHit: number
}

export interface HealthConfig {
  /** Small on purpose. A handful of hits, not a sponge. */
  maxHealth: number
  /** Quiet seconds required before any regeneration begins. */
  outOfCombatSeconds: number
  /** Health per second once out of combat. Slow. */
  regenPerSecond: number
}

export function fullHealth(c: HealthConfig): Health {
  return { current: c.maxHealth, max: c.maxHealth, sinceHit: c.outOfCombatSeconds }
}

/**
 * Down, not dead.
 *
 * Aang wins without killing, and the doc asks the systems to encode that rather
 * than mention it in cutscenes. Nothing in this module removes a combatant: they
 * reach zero and are downed, which is a state they stay in.
 */
export function isDowned(h: Health): boolean {
  return h.current <= 0
}

export function applyDamage(h: Health, amount: number): Health {
  if (amount <= 0) return h
  return { ...h, current: Math.max(0, h.current - amount), sinceHit: 0 }
}

/** Regenerate only after a quiet spell, and never off the floor once downed. */
export function stepHealth(h: Health, dt: number, c: HealthConfig): Health {
  const sinceHit = h.sinceHit + dt
  // A downed combatant does not get back up on their own. Standing them up is a
  // decision for a system above this one, not a side effect of time passing.
  if (isDowned(h)) return { ...h, sinceHit }
  if (sinceHit < c.outOfCombatSeconds) return { ...h, sinceHit }
  return {
    ...h,
    sinceHit,
    current: MathUtils.clamp(h.current + c.regenPerSecond * dt, 0, h.max),
  }
}

/**
 * Health as a 0-to-1 fraction, for anything that draws it.
 *
 * Fails closed rather than propagating a bad number: the result is multiplied into a
 * transform, where a NaN corrupts the matrix instead of just looking wrong. Note that
 * `hudModelFor` returns 1 for a missing pool, because there an absent health pool means
 * "nothing to report"; here a `max` of zero means there is nothing to fill.
 */
export function healthFraction(h: Health): number {
  if (!(h.max > 0) || !Number.isFinite(h.current)) return 0
  return MathUtils.clamp(h.current / h.max, 0, 1)
}
