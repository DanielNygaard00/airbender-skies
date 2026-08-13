import { Vector3 } from 'three'
import type { PlayerState } from '../core/types'
import { slamStrength, type PressureWaveConfig } from '../combat/pressure-wave'
import { isUnlocked } from '../progress/acts'

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

/**
 * Whether the player arrived on the ground on this step: airborne before, grounded after.
 *
 * Extracted from `detectSlam` below when fire's charges needed the same edge, and shared rather
 * than restated because a second notion of "touched down" is exactly the kind of duplicate that
 * drifts silently — one of the two would eventually start counting a respawn, or a frame of
 * ground-snap jitter, and nothing about the other would look wrong. `willRespawn` in
 * `controller.ts` is exported for the same reason.
 *
 * It covers every route onto the ground deliberately, because all of them are arrivals: the glider
 * landing branch, `groundStep`'s own snap, and a respawn — which `safeRespawn` hands back with
 * `grounded: true` from whatever fall provoked it. `detectSlam` refuses the respawn case
 * separately, with its own `respawned` guard and its own reason (dying would otherwise be the
 * hardest slam in the game); fire's refill wants it, because a player put back on solid ground has
 * touched down.
 *
 * Reads `grounded` and nothing else. That field is documented on `Enemy` and behaves the same way
 * here: the snap decides it, and every consumer that re-derived it from a height comparison would
 * drift from the snap.
 */
export function touchedDown(before: PlayerState, after: PlayerState): boolean {
  return !before.grounded && after.grounded
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
  // would slam continuously. Through `touchedDown` rather than inline, so the fire charges'
  // refill and this cannot disagree about when the player arrived.
  if (!touchedDown(before, after)) return null

  // Read from `before`: landing zeroes the vertical velocity, so `after` no longer
  // knows how hard the contact was.
  const impactSpeed = -before.velocity.y
  // Written as the negated form on purpose: `impactSpeed < c.minImpactSpeed` fails
  // open on NaN, since every `<` comparison with NaN is false. A NaN impact speed
  // would then flow into `strength`, into `stepFocus`, and leave `focus.value` NaN
  // for the rest of the session — `isFull` never returns true again, so the Avatar
  // State can never arm and never fires the reset that would clear it.
  if (!(impactSpeed >= c.minImpactSpeed)) return null

  return { impactSpeed, strength: slamStrength(impactSpeed, c) }
}

/**
 * The bounce out of a slam.
 *
 * **This is what section 5 gates in Act 3, and the slam itself is not.** The table's Act 3
 * movement column reads "Extended Breath, dive-shockwave", and the obvious reading is that the
 * whole Pressure Wave is withheld until then. That reading loses to section 4.2, which lists
 * the Pressure Wave under "Airbending — **always available**", and to section 5's own Act 1
 * combat column, which grants the "Airbending core" that list defines. The two rows of the same
 * table cannot both own the move, so the split follows section 4.3, which describes the aerial
 * version in two clauses: "Diving attacks convert airspeed into a shockwave on impact, **then
 * bounce Aang back into the air**." The shockwave is core. The bounce, and the "high-speed dive →
 * Pressure Wave → re-deploy glider" chain it exists to open, is the flagship *aerial* combo, and
 * that is the half Act 3 adds.
 *
 * It is also the half that can be gated without breaking anything, which is not a coincidence
 * but is worth recording as a check rather than as a justification. Gating the whole wave would
 * take the heavy armoured soldier's only reliable answer away in the game's only encounter for
 * two acts — `DEFAULT_COMBAT_CONFIG.enemies.heavy`'s armour table gives the wave full effect and
 * says so in as many words: "It is also the only reason the type is beatable at all in the
 * current kit." Gating the bounce costs the player a re-deploy and costs the heavy nothing.
 *
 * The refusal returns the player untouched rather than a softened bounce, so a locked rebound is
 * an ordinary hard landing — a state the player already knows — rather than a mystery. The slam
 * still fires, the ring is still drawn and the damage still lands, because none of that is
 * this function's business.
 *
 * `airJumpsUsed: 0` here is belt-and-braces, not the reason the re-deploy stays
 * reachable: landing already zeroed it, in both `groundStep` and the glider-landing
 * branch of `controllerStep`. What actually keeps §4.3's combo alive is `grounded:
 * false` — clearing it while the player is standing on the surface is safe, because
 * `groundStep` snaps only a player who was already grounded or who is descending onto
 * the surface, and a bouncing player is neither.
 *
 * `coyoteTime: 0` is not belt-and-braces, and it is the reason this function has to know
 * about the jump at all. The frame this reads was a *grounded* frame, so `groundStep` left
 * the coyote window full; carrying that into the air alongside `grounded: false` hands the
 * player a free ground jump for the next six frames, and a ground jump overrides the bounce
 * with a slower velocity. Measured before this line existed: a 34.333 m/s slam bounces at
 * 15.450 m/s and peaks 5.839 m up, and a tap on any of the next six frames replaced that with
 * 9.000 m/s and a 2.100 m peak — worse than pressing nothing, and worse than the 18.270 m/s
 * air jump the same tap bought before coyote time existed. A bounce is the game giving the
 * player height, so it closes the window exactly as a jump does.
 *
 * `jumpBuffer` deliberately needs no clearing: unlike the window, it is not pinned by being
 * grounded, and `grounded: false` here leaves it decaying in the air on the normal schedule.
 * Nor can a buffered press eat a slam — it fires only from a state that was already grounded,
 * and `detectSlam` requires the frame before the landing not to have been.
 */
export function applyBounce(
  player: PlayerState,
  slam: Slam,
  c: PressureWaveConfig,
): PlayerState {
  // Read off the state rather than taken as a parameter, which is the whole benefit of the act
  // living on `PlayerState`: the call site in main.ts is unchanged, so there is no way to call
  // this and forget the gate.
  if (!isUnlocked('dive-rebound', player.act)) return player
  return {
    ...player,
    velocity: new Vector3(
      player.velocity.x,
      slam.impactSpeed * c.bounceFactor,
      player.velocity.z,
    ),
    grounded: false,
    airJumpsUsed: 0,
    coyoteTime: 0,
  }
}
