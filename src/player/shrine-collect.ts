import type { FlightConfig, PlayerState } from '../core/types'
import { collectShrinesAt, type Shrine } from '../world/shrine'
import { applyShrineBonus } from './breath'
import { actFromShrines } from '../progress/acts'

export interface CollectResult {
  player: PlayerState
  shrines: Shrine[]
  /** Ids collected on this step. Empty when nothing was in range. */
  collected: string[]
}

/**
 * Collect any shrines the player is touching and apply their bonuses.
 *
 * Lives here rather than inline in main.ts's update loop so the rule it encodes
 * is testable: a shrine permanently raises the breath ceiling and never refunds
 * spent breath. That was a human ruling, and with the logic inline the only
 * guard was main.ts, which has no tests — writing `bonus.maxBreath` into
 * `breath` there would have re-opened the exploit with the suite still green.
 *
 * **It is also where an act advances, for exactly that reason.** A shrine pays out twice now —
 * the breath ceiling and, at the fourth and eighth, an act — and the two payments have to happen
 * on the same frame from the same count or the game can be in Act 2 with three shrines. Doing it
 * here rather than in main.ts is what makes the coupling testable at all.
 *
 * The act is recomputed from the whole updated shrine list rather than incremented, and that is
 * deliberate: an increment would be a second way of arriving at the number, and it would drift
 * the moment anything else touched the list. `actFromShrines` is the only expression of the rule,
 * fed the same list the caller is about to keep, so the act cannot end up describing a shrine
 * list that no longer exists.
 *
 * Pure: never mutates the player or the shrines it is given.
 */
export function collectStep(
  player: PlayerState, shrines: readonly Shrine[], c: FlightConfig,
): CollectResult {
  const collected = collectShrinesAt(shrines, player.position)
  if (collected.length === 0) return { player, shrines: shrines.slice(), collected }

  const bonus = collected.reduce(
    (acc) => applyShrineBonus(acc, c),
    { breath: player.breath, maxBreath: player.maxBreath },
  )
  const next = shrines.map((s) => (collected.includes(s.id) ? { ...s, collected: true } : s))
  return {
    player: {
      ...player, breath: bonus.breath, maxBreath: bonus.maxBreath, act: actFromShrines(next),
    },
    shrines: next,
    collected,
  }
}
