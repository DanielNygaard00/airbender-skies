import { MathUtils, Vector3 } from 'three'
import type { FlightConfig, PlayerState } from '../core/types'
import type { Level } from '../world/level'
import { isAtDestination, payloadInReach, type Payload } from '../world/payload'
import { easeOpenness } from './glider'

/**
 * Carrying something on the glider: the interaction, the degraded flight model, and where the
 * bundle hangs while it is up there.
 *
 * §2.4 of the design document asks for three named degradations — "lower lift ceiling,
 * sluggish roll, faster Breath drain" — and for them to be legible and physical rather than a
 * number the player cannot feel. `loadedFlight` below is all three, and each one names the
 * quantity it chose and why that quantity is the one that means something *in this model*
 * rather than in a generic one.
 *
 * Pure, and posture-free about the scene: like `shrine-collect.ts` it knows nothing about a
 * mesh or a renderer. `main.ts` owns the meshes and the `carriedId`.
 */

/** What a press of the carry key would do right now. Null means nothing. */
export type CarryIntent = 'pick-up' | 'set-down' | null

/**
 * Whether the drop is a key press or a landing: it is a key press, and it has to be.
 *
 * A landing was the tempting answer — it needs no key, and "he sets it down when his feet
 * touch" is a nice sentence. It loses to the game's own transition layer. §2.3 is explicit
 * that "landing at high speed never hard-stops Aang", and `controller.ts` implements exactly
 * that: `LANDING_RETENTION` keeps 0.85 of the horizontal speed through a touchdown precisely
 * so a landing is a beat in a line rather than the end of one. A skim landing between two
 * hops is therefore an ordinary move, and dropping the payload on it would leave the cargo
 * behind mid-chain without the player asking — the mechanic losing to the game's momentum
 * culture. The other half of the argument is thrash: an automatic drop needs an automatic
 * pick-up to match, and a proximity pick-up would re-lift the bundle the instant it was set
 * down, so it would need a "step away before you can lift it again" flag purely to undo its
 * own convenience.
 *
 * So one edge-triggered key does both directions, and both require standing on the ground.
 * Requiring ground for the *pick-up* is what keeps the payload out of the air entirely — a
 * bundle snatched at 25 m/s would need somewhere to have come from — and requiring it for the
 * *drop* is what keeps it out of the sky, which is why nothing in this system ever has to
 * simulate a falling payload.
 */
export function carryIntent(
  player: PlayerState, payloads: readonly Payload[], carriedId: string | null,
): CarryIntent {
  // Standing on the ground, in either posture. `grounded` rather than `mode === 'ground'`:
  // the glider lands into ground mode on the same step it touches down, so the two agree
  // here, and `grounded` is the field that says what the feet are doing.
  if (!player.grounded) return null
  if (carriedId !== null) return 'set-down'
  return payloadInReach(payloads, player.position) === null ? null : 'pick-up'
}

export interface CarryResult {
  payloads: Payload[]
  carriedId: string | null
  /** What happened this step, for the caller's effects and reparenting. Null when nothing did. */
  event: 'picked-up' | 'set-down' | 'delivered' | null
}

/**
 * Resolve one step of the carry interaction.
 *
 * Shaped like `collectStep`, and here for the same reason that one is not inline in the
 * update loop: the rules are ruling — a delivered payload can never be lifted again, a
 * set-down lands at the player's feet and not at the payload's old position, and delivery is
 * decided by where it was put down rather than by where the player later walks. With this
 * logic in `main.ts`, which has no tests, each of those would be guarded by nothing.
 *
 * Pure: never mutates the player or the payloads it is given.
 */
export function carryStep(
  player: PlayerState,
  payloads: readonly Payload[],
  carriedId: string | null,
  pressed: boolean,
  level: Level,
): CarryResult {
  const intent = pressed ? carryIntent(player, payloads, carriedId) : null
  if (intent === null) return { payloads: payloads.slice(), carriedId, event: null }

  if (intent === 'pick-up') {
    const target = payloadInReach(payloads, player.position)
    // carryIntent already refused a null target, so this is unreachable — but it is the
    // second call to `payloadInReach` in one step and the type says it can be null.
    if (!target) return { payloads: payloads.slice(), carriedId, event: null }
    return {
      payloads: payloads.map((p) => (p.id === target.id ? { ...p, carried: true } : p)),
      carriedId: target.id,
      event: 'picked-up',
    }
  }

  const carried = payloads.find((p) => p.id === carriedId)
  // A carriedId naming no payload is a caller bug rather than a game state, so this clears it
  // instead of leaving the player permanently loaded by something that does not exist.
  if (!carried) return { payloads: payloads.slice(), carriedId: null, event: null }

  const delivered = isAtDestination(level, carried, player.position)
  return {
    payloads: payloads.map((p) => (p.id === carried.id
      ? { ...p, carried: false, delivered, position: player.position.clone() }
      : p)),
    carriedId: null,
    event: delivered ? 'delivered' : 'set-down',
  }
}

/**
 * Put a carried payload back where the level placed it.
 *
 * This is the answer to both respawn paths, and it is a deliberate choice over the two
 * obvious alternatives.
 *
 * *Surviving the respawn* is the bug it exists to prevent. Both respawns move the player
 * somewhere else — `respawn()` in `controller.ts` puts them on the last island they stood on,
 * and going down does the same through `safeRespawn` — so a payload that stayed carried would
 * be teleported across the map for free. On the fall-out-of-the-world path that is not a minor
 * exploit: the fastest way to move cargo would be to jump off the edge of the world with it.
 *
 * *Vanishing* is the other failure. Dropping it where the player went down works for a death
 * on an island and is meaningless for a fall past `worldFloorY`, where there is no ground to
 * leave it on — and a payload left at the bottom of the void is an objective removed from the
 * level with no way to get it back.
 *
 * Home is the only answer that is the same answer for both paths, keeps the route repeatable,
 * and costs the player exactly what the mistake was worth: the walk back to where they picked
 * it up. A delivered payload is never carried, so this cannot resurrect one.
 */
export function returnCarriedHome(
  payloads: readonly Payload[], carriedId: string | null,
): Payload[] {
  if (carriedId === null) return payloads.slice()
  return payloads.map((p) => (p.id === carriedId
    ? { ...p, carried: false, position: p.origin.clone() }
    : p))
}

/**
 * The flight config a loaded glider flies with. All three of §2.4's degradations, and nothing
 * else.
 *
 * A derived config rather than a `carrying` flag threaded through `flightStep` and
 * `steerToward`, following `boostedCombatConfig` in `src/focus/effects.ts`: the integrator and
 * the steering stay unaware, which keeps the most heavily tested code in the game untouched,
 * and the whole weakness ends up as four multiplications in one testable place.
 *
 * **Lower lift ceiling.** There is no altitude term anywhere in this model, so there is no
 * height the glider cannot exceed and "ceiling" cannot be taken literally — saying so is part
 * of the answer. What limits height here is energy: lift acts perpendicular to velocity and so
 * does no work, which means gliding can only trade altitude for speed and back, and thrust is
 * the only thing that adds energy. So the quantity chosen is `liftCoeff`, because with no mass
 * in the model, weight can only be expressed as lift taken away — and lowering it lowers the
 * reachable height in the two ways the player actually experiences: every glide sinks faster
 * (measured 3.85 m/s empty against 5.61 loaded, and a 6.09:1 glide ratio against 4.40:1), and
 * thrust has to spend more of itself covering that sink before any of it becomes altitude.
 * Measured end to end, holding thrust 30 degrees nose-up from a standing launch until the
 * breath runs out: the empty glider tops out at 442 m, the loaded one at 191 m.
 *
 * `stallSpeed` was the rejected alternative, and it is worth naming because it looks like the
 * obvious one: a heavier wing does stall sooner. It is not touched here because `stallFactor`
 * and `stallSeverity` share that number — `flight.ts` says so at length — so raising it would
 * also move the HUD's warning colour and the wings' shudder onto a different threshold from the
 * one the player learned unloaded, and the same feature would be teaching two different stall
 * speeds. The load shows up in the stall anyway, through the sink rate: a loaded glider arrives
 * at the same 8 m/s sooner.
 *
 * **Sluggish roll.** `weightShiftTurnRate`, and only that. `steering.ts` is explicit that the
 * weight shift is what a hang glider actually steers with and that `baseTurnRate` exists so
 * that "looking trims the turn rather than driving it" — so the roll input is the weight shift,
 * and it is the only honest place for the word "sluggish". `baseTurnRate` and `bankTurnRate`
 * were both rejected: they govern how fast the nose chases the mouse, so degrading them would
 * read as the camera having gone laggy rather than as the glider having gained weight, and
 * `bankTurnRate` in particular cannot command a heading on its own — it only speeds up a chase
 * toward where the player is already looking, so scaling it as well would count the same input
 * twice.
 *
 * **Faster Breath drain.** One multiplier over both costs, so that the tuned 1.7 ratio between
 * hovering and thrusting survives intact rather than being rewritten as a side effect.
 */
export function loadedFlight(c: FlightConfig): FlightConfig {
  return {
    ...c,
    liftCoeff: c.liftCoeff * c.payloadLiftFactor,
    weightShiftTurnRate: c.weightShiftTurnRate * c.payloadTurnFactor,
    breathDrainPerSecond: c.breathDrainPerSecond * c.payloadBreathMultiplier,
    hoverBreathPerSecond: c.hoverBreathPerSecond * c.payloadBreathMultiplier,
  }
}

/**
 * Where the bundle rides while it is carried, in avatar-local space, held in both arms on foot
 * and slung behind the harness in the air.
 *
 * Two poses rather than one, driven by the glider's own `openness` so the bundle travels with
 * the wing over the same 0.3 s the fan takes to unfurl and needs no timer of its own. On foot
 * it sits against the chest, forward of the body (+Z is forward here, as everywhere in this
 * codebase). Deployed, it hangs low and behind: the rider is prone under the wing then, and the
 * follow camera sits 12 units back and 3.2 up along the flight path, so a bundle tucked under
 * the belly would spend the whole flight hidden behind the rider's own body — which would fail
 * the one requirement the visible carry has.
 *
 * Writes into `out` and returns it rather than allocating, because this runs every frame the
 * payload is carried, and the presentation layer in `main.ts` allocates nothing per frame.
 */
export const CARRY_ON_FOOT = new Vector3(0, 0.72, 0.5)
export const CARRY_IN_FLIGHT = new Vector3(0, 0.5, -0.55)

export function carryPose(openness: number, out: Vector3): Vector3 {
  // Clamped through `easeOpenness`, which is where the guard lives for the glider's own
  // panels; a non-finite openness would otherwise write NaN into a transform.
  const eased = Number.isFinite(openness) ? easeOpenness(MathUtils.clamp(openness, 0, 1)) : 0
  return out.lerpVectors(CARRY_ON_FOOT, CARRY_IN_FLIGHT, eased)
}
