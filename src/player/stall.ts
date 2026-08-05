import { MathUtils } from 'three'
import type { FlightConfig, PlayerState } from '../core/types'

/**
 * How badly the wing has stopped flying: 0 while it flies, 1 at rest.
 *
 * The arithmetic mirror of the `stallFactor` that `flightStep` already computes
 * (`speed < stallSpeed ? speed / stallSpeed : 1`), so the tell cannot claim a stall while the
 * flight model is still making full lift. A second, differently-shaped opinion about where a
 * stall begins is exactly how a warning ends up disagreeing with the physics.
 *
 * Its own module rather than an export from `flight.ts`: that file is the integrator, and this
 * is a presentation query over the same threshold. Nothing in the flight model imports it.
 *
 * Takes the whole state rather than a bare speed so the posture gate lives here, in one tested
 * place, rather than at each of the two call sites — the HUD and the wing shudder — that need
 * it. On foot a walk is 7 and stall speed is 8, so an ungated severity would report a
 * permanent stall while the player strolls around an island.
 */
export function stallSeverity(state: PlayerState, c: FlightConfig): number {
  if (state.mode !== 'glider') return 0
  if (!(c.stallSpeed > 0)) return 0
  const speed = state.velocity.length()
  if (!Number.isFinite(speed)) return 0
  return MathUtils.clamp(1 - speed / c.stallSpeed, 0, 1)
}
