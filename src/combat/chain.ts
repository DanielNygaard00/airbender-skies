/**
 * The chain: how many blows have landed in a row, and whether the next one is a finisher.
 *
 * §4.2 says switching element is "fast enough to sequence mid-combo", and this module is what
 * makes sequencing worth doing. It counts *landings*, not presses.
 *
 * **There is no element in this state, and that is the whole Ghost of Yotei property.** A swap
 * cannot reset a string that has nothing element-shaped in it to invalidate, so mixing air into
 * water into earth inside one string needs no rule permitting it — `element.ts` already ruled the
 * switch itself is free, instant and interrupts nothing. The alternative, a per-element chain that
 * a swap would reset, was rejected: it would make the radial a punishment and turn §4.2's own
 * example sequence into three unrelated presses.
 *
 * **A miss does not count.** `focus.ts` pays `gustConnectGain` on connect for the same reason: a
 * string built by pressing keys at empty air would make the finisher free, and the finisher is
 * meant to be the reward for pressure that actually landed.
 *
 * **Nothing here shortens a cooldown.** `encounter.ts` keeps its five cooldowns independent
 * precisely so switching element cannot launder one into another, so this module changes what a
 * blow does when it lands and never when it may be thrown. `encounter.test.ts` asserts it.
 */
export interface ChainConfig {
  /** Landings in one string. The last one is the finisher. */
  maxLinks: number
  /** Grace after a landing during which the next one continues the string. */
  windowSeconds: number
}

export interface ChainState {
  /** Landings in the current string, 0 to maxLinks. */
  links: number
  /** Seconds since the last landing. Resets to 0 on each one. */
  sinceLink: number
}

export function freshChain(): ChainState {
  return { links: 0, sinceLink: 0 }
}

/**
 * Age the string, expiring it once the window lapses.
 *
 * Expiry zeroes `links` rather than decrementing it: a string is a run of blows inside one
 * window, so a lapse ends it outright. Decaying it one link at a time would let a player hold a
 * two-link string indefinitely by landing one blow every window, which is the opposite of the
 * pressure this is meant to reward.
 */
export function stepChain(state: ChainState, dt: number, c: ChainConfig): ChainState {
  if (state.links === 0) return state
  const sinceLink = state.sinceLink + dt
  if (sinceLink > c.windowSeconds) return freshChain()
  return { links: state.links, sinceLink }
}

/** A blow landed. Clamped at the cap so a fourth landing cannot overflow the finisher. */
export function landChain(state: ChainState, c: ChainConfig): ChainState {
  return { links: Math.min(state.links + 1, c.maxLinks), sinceLink: 0 }
}

/**
 * Whether the string is standing at its last link.
 *
 * Read from the state after the landing rather than before it, so the blow that completes the
 * string is itself the finisher. Asking before would make the finisher the *fourth* press of a
 * three-link string, which is one more commitment than the config says a player will make.
 */
export function isFinisher(state: ChainState, c: ChainConfig): boolean {
  return state.links >= c.maxLinks
}
