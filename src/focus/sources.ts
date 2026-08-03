import { MathUtils } from 'three'
import type { FlightConfig, PlayerState } from '../core/types'
import type { FocusConfig } from './focus'

/**
 * What the player is doing, as a Focus rate.
 *
 * Every branch reads a signal the movement systems already produce. Nothing here
 * measures anything new — in particular the scooter's hidden accumulator is reused
 * rather than a second notion of "a clean line" being invented next to it.
 *
 * There is deliberately no neutral state: everything either builds or drains, so the
 * meter can never be parked.
 */
export function traversalRatePerSecond(
  player: PlayerState,
  inWind: boolean,
  flight: FlightConfig,
  c: FocusConfig,
): number {
  if (player.mode === 'glider' && !player.grounded) {
    // Below stall the wing is not flying, it is falling with a sail out.
    if (player.velocity.length() > flight.stallSpeed) {
      return c.glideGainPerSecond * (inWind ? c.windGainMultiplier : 1)
    }
    return -c.idleDrainPerSecond
  }

  if (player.mode === 'ground' && player.scooterActive) {
    return c.scooterGainPerSecond * MathUtils.clamp(player.scooterCharge, 0, 1)
  }

  return -c.idleDrainPerSecond
}

/**
 * Whether the player fell out of the world this frame.
 *
 * This duplicates the condition `controllerStep` uses to trigger a respawn, and the
 * duplication is deliberate: the controller resolves the fall internally and hands back
 * an already-respawned state, so there is no way to observe it afterwards. Exported and
 * tested so the duplication is visible rather than buried in a call site, and it must be
 * evaluated *before* the controller runs.
 */
export function fellOutOfWorld(player: PlayerState, worldFloorY: number): boolean {
  return player.position.y < worldFloorY
}
