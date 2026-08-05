import { MathUtils } from 'three'
import type { FlightConfig, PlayerState } from '../core/types'
import { stallFactor } from './flight'

/**
 * How badly the wing has stopped flying: 0 while it flies, 1 at rest.
 *
 * The arithmetic complement of the `stallFactor` that `flightStep` scales its lift by, and it
 * gets that number by calling the same function rather than by restating the formula. A second
 * copy of the ramp would be a second opinion about where a stall begins, and the first person
 * to soften the ramp — a quadratic fade is the obvious attempt — would leave the readout
 * reddening and the wings shuddering at speeds where the wing still makes most of its lift.
 * With one formula there is nothing left to diverge.
 *
 * Its own module rather than an export from `flight.ts`: that file is the integrator, and this
 * is a presentation query over the same threshold. The dependency runs one way only — this
 * file imports the flight model, and nothing in the flight model imports it back.
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
  return MathUtils.clamp(1 - stallFactor(speed, c), 0, 1)
}
