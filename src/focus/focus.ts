import { MathUtils } from 'three'

/**
 * Focus: the meter that rewards sustained clean play.
 *
 * The design document has Focus build "from unbroken chains", and this module encodes
 * the chain as a ramp on the gain rate rather than as a separate combo counter. Going
 * unbroken makes everything pay better; a break costs a chunk of the meter and puts the
 * ramp back to nothing. One number, two behaviours, no second meter to explain.
 *
 * Deliberately not part of PlayerState. Movement is a pure function of a struct that a
 * dozen tests build fixtures for, and a scoring meter has no business widening it.
 */
export interface Focus {
  value: number
  max: number
  /** Seconds the chain has gone unbroken. Drives the gain ramp. */
  chainTime: number
}

export interface FocusConfig {
  maxFocus: number
  /** Focus per second for clean gliding above stall speed. */
  glideGainPerSecond: number
  /** Multiplies the glide rate while inside a wind feature. */
  windGainMultiplier: number
  /** Focus per second on a fully charged air scooter. */
  scooterGainPerSecond: number
  /** Focus per second lost while doing nothing worth rewarding. */
  idleDrainPerSecond: number
  /** Unbroken seconds needed to reach the full ramp. */
  chainRampSeconds: number
  /** Gain multiplier at the top of the ramp. */
  chainRampMax: number
  /** Focus for one gust connecting with a live enemy. */
  gustConnectGain: number
  /** Focus for downing an enemy. */
  downGain: number
  /** Focus for a full-strength Pressure Wave. */
  slamGainAtFullImpact: number
  /** Focus lost to a single hit. */
  damageDrain: number
  /** Focus lost to falling out of the world. */
  crashDrain: number
  /** Focus for a dodge that beat an incoming hit. */
  dodgeGain: number
}

/** What happened this frame that Focus cares about. */
export interface FocusEvents {
  /** Enemies a gust connected with. */
  gustConnects: number
  /** Enemies downed. */
  downs: number
  /** Strength of a Pressure Wave landed this frame, 0 to 1. Zero when there was none. */
  slamStrength: number
  playerHit: boolean
  fellOutOfWorld: boolean
  /** A slipstream dodge beat a hit that would otherwise have landed this frame. */
  damageAvoided: boolean
}

export interface FocusInput {
  /** Focus per second from traversal. Negative while idling. */
  ratePerSecond: number
  events: FocusEvents
  /** The Avatar State is running: the meter holds still. */
  frozen: boolean
  /** The Avatar State just ended: the meter empties. */
  reset: boolean
}

export function noFocusEvents(): FocusEvents {
  return {
    gustConnects: 0, downs: 0, slamStrength: 0, playerHit: false, fellOutOfWorld: false,
    damageAvoided: false,
  }
}

export function emptyFocus(c: FocusConfig): Focus {
  return { value: 0, max: c.maxFocus, chainTime: 0 }
}

/**
 * An inequality rather than an exact comparison. The meter is clamped with `Math.min`
 * so a full one holds `max` exactly today, but the Avatar State's arming rule hangs off
 * this and must not silently stop working if a future gain path overshoots.
 */
export function isFull(focus: Focus): boolean {
  return focus.value >= focus.max
}

export function chainRamp(focus: Focus, c: FocusConfig): number {
  const t = MathUtils.clamp(focus.chainTime / c.chainRampSeconds, 0, 1)
  return MathUtils.lerp(1, c.chainRampMax, t)
}

/**
 * Advance the meter one frame.
 *
 * The order is load-bearing. Breaks apply before gains, and the ramp is measured after
 * the break — so an enemy downed on the same frame the player takes a spear pays the
 * base rate, because the chain really did end that frame.
 */
export function stepFocus(
  focus: Focus,
  input: FocusInput,
  dt: number,
  c: FocusConfig,
): Focus {
  // Reset wins over freeze: the state ends and the meter empties on the same frame.
  if (input.reset) return { value: 0, max: focus.max, chainTime: 0 }
  if (input.frozen) return focus

  const { events } = input
  const broke = events.playerHit || events.fellOutOfWorld

  let value = focus.value
  if (events.playerHit) value -= c.damageDrain
  if (events.fellOutOfWorld) value -= c.crashDrain

  const chainTime = broke ? 0 : focus.chainTime + dt
  const ramp = chainRamp({ ...focus, chainTime: broke ? 0 : focus.chainTime }, c)

  // The ramp scales the drain as well as the gain: a long clean run bleeds away
  // faster once it stops, so idling costs more the better the run was.
  value += input.ratePerSecond * ramp * dt
  value += (events.gustConnects * c.gustConnectGain
    + events.downs * c.downGain
    + events.slamStrength * c.slamGainAtFullImpact
    + (events.damageAvoided ? c.dodgeGain : 0)) * ramp

  return { value: MathUtils.clamp(value, 0, focus.max), max: focus.max, chainTime }
}
