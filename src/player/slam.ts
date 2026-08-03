import { Vector3 } from 'three'
import type { PlayerState } from '../core/types'
import { slamStrength, type PressureWaveConfig } from '../combat/pressure-wave'

/**
 * Detecting a Pressure Wave without touching the movement code.
 *
 * A slam is a thing that can be *observed* about a frame — the player was in the air,
 * now they are on the ground, and they were holding the commit key — so it is read by
 * comparing the player either side of `controllerStep` rather than by teaching movement
 * about combat. `src/combat/encounter.ts` is explicit that a fight is something
 * happening in the world rather than a property of the character's kinematics, and this
 * keeps that boundary intact.
 */
export interface Slam {
  /** Downward speed at the moment of contact, m/s. */
  impactSpeed: number
  /** 0 to 1. */
  strength: number
}

export function detectSlam(
  before: PlayerState,
  after: PlayerState,
  tuckHeld: boolean,
  respawned: boolean,
  c: PressureWaveConfig,
): Slam | null {
  // A respawn also lands the player, and it lands them from an arbitrarily fast fall.
  // Without this guard, dying is the hardest slam in the game.
  if (respawned) return null
  if (!tuckHeld) return null
  // Contact has to have happened on this frame, or walking around with the key held
  // would slam continuously.
  if (before.grounded || !after.grounded) return null

  // Read from `before`: landing zeroes the vertical velocity, so `after` no longer
  // knows how hard the contact was.
  const impactSpeed = -before.velocity.y
  if (impactSpeed < c.minImpactSpeed) return null

  return { impactSpeed, strength: slamStrength(impactSpeed, c) }
}

/**
 * The bounce out of a slam.
 *
 * `airJumpsUsed: 0` here is belt-and-braces, not the reason the re-deploy stays
 * reachable: landing already zeroed it, in both `groundStep` and the glider-landing
 * branch of `controllerStep`. What actually keeps §4.3's combo alive is `grounded:
 * false` — clearing it while the player is standing on the surface is safe, because
 * `groundStep` snaps only a player who was already grounded or who is descending onto
 * the surface, and a bouncing player is neither.
 */
export function applyBounce(
  player: PlayerState,
  slam: Slam,
  c: PressureWaveConfig,
): PlayerState {
  return {
    ...player,
    velocity: new Vector3(
      player.velocity.x,
      slam.impactSpeed * c.bounceFactor,
      player.velocity.z,
    ),
    grounded: false,
    airJumpsUsed: 0,
  }
}
