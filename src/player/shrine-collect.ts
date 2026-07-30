import type { FlightConfig, PlayerState } from '../core/types'
import { collectShrinesAt, type Shrine } from '../world/shrine'
import { applyShrineBonus } from './breath'

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
  return {
    player: { ...player, breath: bonus.breath, maxBreath: bonus.maxBreath },
    shrines: shrines.map((s) => (collected.includes(s.id) ? { ...s, collected: true } : s)),
    collected,
  }
}
