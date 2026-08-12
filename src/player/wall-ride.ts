import { Vector3 } from 'three'
import type { GroundConfig, TerrainQuery } from '../core/types'

/**
 * Wall-riding: taking the air scooter up a vertical face.
 *
 * Not a move of its own. The design document puts it inside the Air Scooter row — "can
 * ride up vertical walls while speed holds" — and then names the economy in the details
 * paragraph: "wall-riding drains the accumulator, so vertical shortcuts cost the speed you
 * built to reach them". So everything here is gated on the scooter being up, and the
 * accumulator `scooter.ts` builds is what pays for the climb. There is no separate meter
 * and no cooldown, because the accumulator already is both.
 *
 * The shape of the move is a redirect rather than a new source of speed, which is the
 * third design pillar ("redirect, don't absorb") applied to terrain instead of to an
 * attack. `resolveMovement` already turns a fast approach to a cliff into a skim along it
 * by deleting the velocity that went into the surface; this takes that same deleted
 * component and points it up the wall instead of throwing it away. The consequence is a
 * rule a player can learn in one attempt: the squarer you hit the wall, the higher you go,
 * and a glancing approach still just skims.
 *
 * What that buys on the shipped archipelago is small, and it is measured rather than
 * hoped for — see `wall-ride-geometry.test.ts`. These islands are noise-displaced
 * squashed spheres, so the genuinely vertical rock is a thin ring near each island's
 * equator, mostly hanging below the walkable crown where a rider cannot reach it. From
 * footing a rider can actually stand on, 0.25% of (position, bearing) pairs have a
 * ridable face within reach, and the tallest continuous band above any of them is 6.00 m,
 * on `spire`. The move is correct; this level is not built for it. That is a level-design
 * gap and it is recorded here rather than papered over by loosening the threshold, which
 * was measured and does not help either — see `wallRideNormalY` in `core/config.ts`.
 */

/**
 * Steep enough to ride, judged from the surface normal.
 *
 * Two-sided rather than one-sided, and that is the whole content of the function beyond
 * the threshold. `isWall` in `collision.ts` asks `normal.y < wallNormalY`, which is
 * satisfied by every overhang on these islands — the undersides are stretched to 1.9x and
 * face outward and *downward*, so their `normal.y` is strongly negative. Riding up the
 * inside of an overhang cannot work: the climb carries the body away from the surface, the
 * next frame's probe finds nothing, and the ride drops. Refusing at the threshold is
 * better than entering and being thrown off, because the second reads as a stutter and
 * costs the accumulator on the way through.
 */
export function isRidableWall(normal: Vector3, c: GroundConfig): boolean {
  return Math.abs(normal.y) < c.wallRideNormalY
}

export interface WallRideInput {
  /**
   * Riding the scooter, after `stepScooter` has had its say this frame. Wall-riding is a
   * property of the scooter, so this is a hard gate rather than a modifier.
   */
  scooterActive: boolean
  /** The accumulator, 0 to 1, likewise after the scooter has settled it. */
  charge: number
  /**
   * A jump fired this frame.
   *
   * An exit, and a load-bearing one twice over. It is the design intent — leaving the
   * ground by a jump stows the scooter, and kicking off a wall is leaving it — and it is
   * also what keeps the gravity correction below honest: `groundStep` overrides the
   * frame's vertical velocity outright on a jump frame rather than integrating gravity
   * into it, so there would be no gravity there to give back.
   */
  jumped: boolean
}

export interface WallRideStep {
  /**
   * The wall's outward normal, or null when no ride is running. Non-null *is* the ride:
   * there is no separate flag, because a second field could disagree with this one.
   */
  normal: Vector3 | null
  /**
   * The velocity the ride wants, or null when the caller should keep its own. Returned
   * rather than applied, the same contract `stepDash` and `stepSlipstream` use.
   */
  velocity: Vector3 | null
  /** Accumulator spent this frame, and zero when no ride is running. */
  chargeSpent: number
}

const IDLE: WallRideStep = { normal: null, velocity: null, chargeSpent: 0 }

/**
 * Advance the ride.
 *
 * `velocity` is the frame's candidate velocity as `groundStep` has already settled it:
 * eased toward the stick, plus any dash impulse, plus wind, with a full step of gravity
 * integrated. That ordering is not incidental. The entry probe has to be aimed along the
 * line of travel, and the line of travel is only known once the ease, the dash and the
 * wind have all run — so the ride corrects the integration it inherits rather than
 * pre-empting it. The correction is exact: adding `(gravity - wallRideClimbDecay) * dt`
 * restores precisely the fraction of the step the ball of air is carrying, and leaves the
 * rest of the frame's arithmetic untouched.
 *
 * Wind is deliberately left in. A ride is airborne from its second frame, so a thermal
 * against a cliff helps a rider up it, which is the second design pillar working exactly
 * as intended rather than a leak.
 *
 * Pure: nothing here mutates an argument.
 */
export function stepWallRide(
  /** The wall ridden when the frame began, or null. */
  normal: Vector3 | null,
  input: WallRideInput,
  position: Vector3,
  velocity: Vector3,
  dt: number,
  terrain: TerrainQuery,
  c: GroundConfig,
): WallRideStep {
  if (!input.scooterActive || input.jumped) return IDLE

  const riding = normal !== null
  // Asymmetric on purpose, and this asymmetry is the hysteresis that keeps the move from
  // stuttering. Starting a ride costs a whole tier of accumulator in hand; continuing one
  // needs only that the accumulator is not empty. Symmetric gates at zero would let a
  // rider at charge 0 enter and be dropped on the very next frame, against every wall on
  // the map, which reads as the character catching on scenery rather than as a move.
  const affordable = riding ? input.charge > 0 : input.charge >= c.wallRideMinCharge
  if (!affordable) return IDLE

  // Into the wall already being ridden, or along the horizontal line of travel to find a
  // new one. The distinction matters: once riding, the velocity has had its into-the-wall
  // component removed and runs *along* the face, so probing along travel would look past
  // the wall and drop the ride on its second frame.
  const aim = riding
    ? normal.clone().negate()
    : new Vector3(velocity.x, 0, velocity.z)
  if (aim.lengthSq() < 1e-8) return IDLE

  // From the middle of the body rather than from the feet. `position` is at the feet — the
  // ground snap seats it on the surface — and a probe from there meets the fillet where
  // the wall meets the floor, whose normal is a blend of the two and is rejected as often
  // as not. Half of `eyeProbeHeight` is 1 m against a 1.8 m character (`TARGET_HEIGHT` in
  // avatar.ts), so it asks about the wall the chest is against.
  const from = position.clone()
  from.y += c.eyeProbeHeight / 2
  // `snapDistance` rather than a lateral distance of its own: it is the same question in a
  // different axis. Downward it means "ground this close is still underfoot"; here it means
  // "a wall this close is still against you", and there is no reason for the two to differ.
  // It has to exceed `CollisionConfig.radius`, or the body would be held clear of a wall it
  // could no longer feel — at 1.2 against 0.5 there is more than double the margin.
  const hit = terrain.raycast(from, aim, c.snapDistance)
  if (!hit || !isRidableWall(hit.normal, c)) return IDLE

  // Closing speed on the wall. Measured on the full velocity rather than on its horizontal
  // part, so there is one rule for every wall: a face leaning a few degrees off vertical
  // reads a rider's vertical motion as part of the approach, and it is.
  const into = -velocity.dot(hit.normal)
  // Entry only. A ride already running must not re-earn its climb every frame from
  // whatever the stick is pushing into the wall — that would be a hold-forward-to-fly
  // engine, with the accumulator as its only limit rather than as its price.
  if (!riding && into < c.wallRideEntrySpeed) return IDLE

  const next = velocity.clone()
  // Held against the face, not driven through it. `resolveMovement` would delete this same
  // component a few lines later in `groundStep`, but doing it here is what makes this
  // function's own arithmetic mean anything: the climb below is measured off a velocity
  // that is already in the plane of the wall.
  if (into > 0) next.addScaledVector(hit.normal, into)
  next.y += (c.gravity - c.wallRideClimbDecay) * dt
  if (!riding) next.y += into * c.wallRideRedirect

  // The ride lasts exactly as long as the climb it was bought with — "while speed holds",
  // and nothing else is needed to make that sentence true, because `wallRideClimbDecay` is
  // what spends it. Checked after the redirect so entry and continuation are held to the
  // same standard: a ride that would not climb never starts.
  if (next.y <= c.wallRideHoldSpeed) return IDLE

  return {
    normal: hit.normal.clone(),
    velocity: next,
    chargeSpent: c.wallRideChargeDrain * dt,
  }
}
