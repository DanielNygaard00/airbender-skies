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
 *
 * **The finisher is punctuation, not a plateau.** `landChain` spends the string on the landing that
 * completes it, so a finisher is a single blow and the next one costs three more landings. See that
 * function for the balance defect the alternative — clamping at the cap — produced.
 */
export interface ChainConfig {
  /** Landings in one string. The last one is the finisher, and it spends the string. */
  maxLinks: number
  /** Grace after a landing during which the next one continues the string. */
  windowSeconds: number
}

export interface ChainState {
  /**
   * Landings in the current string, 0 to `maxLinks - 1`.
   *
   * Never `maxLinks`: the landing that would take it there is the finisher, and `landChain`
   * spends the string on that landing rather than parking it at the cap. A completed string is a
   * moment, not a state anybody holds.
   */
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

/**
 * A blow landed. **The landing that completes the string spends it**, returning a fresh chain.
 *
 * Consumed rather than clamped at the cap, and the difference is a balance rule rather than
 * bookkeeping. Clamping left a finished string *standing*: every landing resets `sinceLink`, so
 * any landing inside the window both kept the window alive and re-qualified as a finisher — and at
 * the gust's 0.45 second cooldown, with any soldier in the fight to land on, that state never
 * lapsed. A string a player could hold indefinitely is a permanent licence to ignore the whole
 * armour table's knockback column at once, which is exactly what `config.ts` cuts the Stone
 * Throw's knockback to 0.6 to prevent. Spending it makes the finisher punctuation: the next one
 * costs three more landings.
 */
export function landChain(state: ChainState, c: ChainConfig): ChainState {
  return isFinisher(state, c) ? freshChain() : { links: state.links + 1, sinceLink: 0 }
}

/**
 * Whether a landing on this string is the one that completes it.
 *
 * **Asked of the state before the landing, not after**, and that inversion is forced by
 * `landChain` spending the string: a completed string is never a state anybody holds, so "standing
 * at its last link" is no longer a question a persisted `ChainState` can answer. Read this way the
 * answer is still about the completing blow rather than the press after it — a two-link string
 * answers true, and the blow that lands on it is the finisher, which is the one commitment the
 * config says a player makes.
 */
export function isFinisher(state: ChainState, c: ChainConfig): boolean {
  return state.links + 1 >= c.maxLinks
}
