import type { FlightConfig } from './types'

/** Validated by prototype measurement — see the plan's tuning table. */
export const DEFAULT_FLIGHT_CONFIG: FlightConfig = {
  gravity: 20,
  liftCoeff: 0.075,
  dragCoeff: 0.0045,
  inducedDragFactor: 6,
  stallSpeed: 8,
  thrustAccel: 22,
  flareAoaBoost: 0.35,
  rigAoa: 0.09,
  // Weight shift leads and look assists: baseTurnRate came down from 2.2 so that
  // pointing the mouse trims a turn instead of commanding it outright.
  baseTurnRate: 0.9,
  turnRateSpeedRef: 40,
  bankTurnRate: 1.5,
  weightShiftTurnRate: 1.7,
  breathDrainPerSecond: 18,
  // Hovering costs about 1.7x thrust, so holding station is a deliberate spend
  // rather than a free way to wait out a bad approach.
  hoverBreathPerSecond: 30,
  hoverDamping: 1.6,
  tuckLiftFactor: 0.1,
  tuckDragFactor: 0.55,
  deployKick: 3,
  landingSpeed: 14,
  baseMaxBreath: 100,
  breathRegenPerSecond: 12,
  breathRegenGroundedMultiplier: 2.5,
  shrineBreathBonusFraction: 0.1,
  // The payload's three degradations. Each number is anchored to a value the game already
  // has rather than picked by feel, and each claim below was measured through the real
  // `flightStep` and `steerToward` rather than argued -- see
  // `docs/superpowers/specs/2026-08-11-payload-design.md` for the full tables.
  //
  // Lift: 0.7 is bounded from below by the level's own longest glide-only crossing. `home` to
  // `ring-east` drops 80 m between the two summits over 276 m of ground to the near rim, so it
  // demands a glide ratio of 3.46:1, and the archipelago's comment calls those ring islands
  // "reachable by gliding alone". Measured over a 20 s unpowered glide from 25 m/s: the empty
  // wing does 6.09:1, a factor of 0.7 does 4.40:1, and 0.5 does 3.13:1 -- which does not clear
  // that crossing at all, so half is the value that closes a route the level teaches. 0.7
  // keeps it open at 1.27 times the requirement, against the 1.76 times an empty wing enjoys.
  // Centre to centre rather than to the rim the requirement is 4.03:1 and the loaded margin is
  // 1.09 times, which is the figure for a player who insists on overflying the middle of it.
  // What the player feels for all this is sink: 3.85 m/s empty against 5.61 loaded.
  payloadLiftFactor: 0.7,
  // Roll: the same 0.5 the air scooter already charges for its speed
  // (`scooterTurnFactor`). The game has exactly one tuned number for "this posture costs you
  // half your steering", and a loaded glider is the same bargain in the air, so it takes
  // that number rather than a new one. Measured through `steerToward` with a full weight
  // shift and the mouse held still: 1.70 rad/s empty against 0.85 loaded, which at 25 m/s is
  // a turn radius of 14.7 m against 29.4 m. That is the figure that matters on the payload's
  // route, because circling a thermal is a radius problem: the column under `climb-north` has
  // a radius of 45, so a loaded glider still fits inside it at 25 m/s but no longer at the
  // 40 m/s (47.1 m) an empty one can carve at. Slowing down to stay in lift is the lesson.
  payloadTurnFactor: 0.5,
  // Breath: 1.5, anchored twice over. It is exactly `1 + 5 * shrineBreathBonusFraction`, so on
  // paper five air shrines restore a loaded player's thrust endurance to the empty-handed
  // baseline to the second -- 150 breath at 27/s is 5.56 s, and 100 at 18/s is the same 5.56 s.
  // Measured through the real gate it lands 5.6% ahead of parity rather than level, 5.00 s
  // against 4.73 s, because `bendFloor` holds back a flat 15 units rather than a fraction of
  // the bar and a bigger bar loses proportionally less of itself to it. Either way, with 13
  // shrines in the archipelago the payload is a real cost that exploration can pay off rather
  // than a permanent tax. And it sits below `hoverBreathPerSecond /
  // breathDrainPerSecond` (1.67), which `validateFlightConfig` enforces: loaded thrust must
  // stay cheaper than an empty-handed hover, because the guide tells the player hovering is
  // the most expensive thing they can do with breath, and that has to keep being true.
  payloadBreathMultiplier: 1.5,
  // canBend is re-evaluated every frame against this floor, so it gates AT the floor
  // rather than at zero: breath sits at 15, thrust takes it to 14.7, the gate closes,
  // regeneration walks it back up in about a frame and a half, and it engages again. That
  // still slows the buzz -- measured at 210 of 600 frames engaged, down from 300 of 600
  // with no floor -- but it does not stop it, and it does not buy a clean run of thrust.
  // What the floor buys instead: thrust now needs 15 breath in hand, so an empty bar is a
  // real interruption rather than something a player can limp along on fumes with.
  bendFloor: 15,
}

export function validateFlightConfig(c: FlightConfig): void {
  const positive: (keyof FlightConfig)[] = [
    'gravity', 'liftCoeff', 'dragCoeff', 'stallSpeed',
    'thrustAccel', 'baseTurnRate', 'turnRateSpeedRef',
    'breathDrainPerSecond', 'landingSpeed', 'baseMaxBreath',
    'breathRegenPerSecond', 'breathRegenGroundedMultiplier',
    'shrineBreathBonusFraction', 'hoverBreathPerSecond', 'hoverDamping',
    'weightShiftTurnRate', 'tuckLiftFactor', 'tuckDragFactor', 'deployKick',
    'payloadLiftFactor', 'payloadTurnFactor', 'payloadBreathMultiplier',
  ]
  for (const key of positive) {
    if (!(c[key] > 0)) throw new Error(`FlightConfig.${key} must be > 0, got ${c[key]}`)
  }
  if (!(c.payloadLiftFactor < 1) || !(c.payloadTurnFactor < 1)) {
    throw new Error(
      'FlightConfig payload factors must be below 1: carrying something is a weakness, so ' +
      'it cannot hand the wing more lift or more steering than flying empty ' +
      `(got ${c.payloadLiftFactor}, ${c.payloadTurnFactor})`,
    )
  }
  if (!(c.payloadBreathMultiplier > 1)) {
    throw new Error(
      `FlightConfig.payloadBreathMultiplier (${c.payloadBreathMultiplier}) must exceed 1: ` +
      'a payload that made breath cheaper would be a reward rather than a weight',
    )
  }
  if (!(c.tuckLiftFactor < 1) || !(c.tuckDragFactor < 1)) {
    throw new Error(
      'FlightConfig tuck factors must be below 1: a tuck folds the wings away, it ' +
      `does not add lift or drag (got ${c.tuckLiftFactor}, ${c.tuckDragFactor})`,
    )
  }
  if (c.hoverBreathPerSecond <= c.breathDrainPerSecond) {
    throw new Error(
      `FlightConfig.hoverBreathPerSecond (${c.hoverBreathPerSecond}) must exceed ` +
      `breathDrainPerSecond (${c.breathDrainPerSecond}): hovering carries the whole ` +
      'glider, thrust only adds to a flying wing',
    )
  }
  // Below the hover-versus-thrust check on purpose, not merely after it. The two overlap: a
  // config with hovering *cheaper* than thrust also fails this one, and when this check ran
  // first it reported the payload multiplier for a config whose actual fault had nothing to do
  // with payloads — which quietly retargeted the existing hover-cost test in
  // `config.test.ts` onto this message. Order the general invariant first and each failure
  // names its own cause.
  //
  // The bound itself is the hover-to-thrust ratio, and it is a claim the game makes out loud
  // rather than a safety margin: the guide calls hovering "the most expensive thing you can do
  // with breath". A multiplier above this ratio would make loaded thrust cost more than an
  // empty-handed hover and turn that sentence into a lie.
  if (c.payloadBreathMultiplier * c.breathDrainPerSecond > c.hoverBreathPerSecond) {
    throw new Error(
      `FlightConfig.payloadBreathMultiplier (${c.payloadBreathMultiplier}) must not push ` +
      `thrust (${c.breathDrainPerSecond}/s) above an unloaded hover ` +
      `(${c.hoverBreathPerSecond}/s): hovering has to stay the most expensive way to spend ` +
      'breath, because that is what the guide tells the player',
    )
  }
  if (c.stallSpeed >= c.turnRateSpeedRef) {
    throw new Error(
      `FlightConfig.stallSpeed (${c.stallSpeed}) must be below turnRateSpeedRef (${c.turnRateSpeedRef})`,
    )
  }
  if (!(c.bendFloor > 0) || !(c.bendFloor < c.baseMaxBreath)) {
    throw new Error(
      `FlightConfig.bendFloor (${c.bendFloor}) must sit strictly between 0 and ` +
      `baseMaxBreath (${c.baseMaxBreath}): at 0 there is no floor and at the ceiling the ` +
      'glider could never bend at all',
    )
  }
}

import type { GroundConfig } from './types'

export const DEFAULT_GROUND_CONFIG: GroundConfig = {
  walkSpeed: 7,
  runSpeed: 13,
  jumpSpeed: 9,
  gravity: 20,
  snapDistance: 1.2,
  eyeProbeHeight: 2,
  maxAirJumps: 1,
  airJumpSpeed: 9,
  airJumpRisingBonus: 0.6,
  chargeThresholdSeconds: 0.2,
  chargeMaxSeconds: 1.5,
  chargedJumpSpeed: 20,
  chargeWalkFactor: 0.4,
  // Both are 6 fixed steps at 60 Hz -- the common platformer standard, and argued
  // guesses rather than a measurement of this game. Measured before they existed: a
  // press on the last grounded frame released one frame later produced no jump at all,
  // and a press released up to 8 frames before a landing produced nothing on landing.
  // Both measurements are now asserted as the inverse claim, at those same frame counts,
  // in `jump.test.ts` and `ground-move.test.ts`. One of them is only partly inverted: the
  // buffer reaches 5 frames before touchdown, not 8, because 8 frames is 133 ms against
  // this 100 ms window. The table in `ground-move.test.ts` pins where the edge falls.
  coyoteSeconds: 0.1,
  jumpBufferSeconds: 0.1,
  // Soft enough to lean into turns and slide on stops, per the doc's air-assisted
  // run, without feeling like ice.
  groundResponse: 7,
  scooterSpeedFactor: 2,
  scooterChargeSpeedBonus: 0.6,
  scooterTurnFactor: 0.5,
  scooterChargeTurnPenalty: 0.25,
  scooterChargeGain: 0.35,
  scooterChargeLoss: 0.8,
  scooterTierDrop: 0.34,
  // Wall-riding. The design doc files it inside the Air Scooter row, so its numbers sit
  // with the rest of the scooter's rather than in a config of their own.
  //
  // 0.25 is a face within 14.5 degrees of vertical (acos 0.25 is 75.5 degrees), against
  // `DEFAULT_COLLISION_CONFIG.wallNormalY`'s 0.5, which is 60 degrees. Half of it, and
  // chosen by measurement rather than by argument: swept over the real archipelago from
  // every position a rider could actually be standing on, relaxing this to 0.5 moves
  // lateral contact from 0.25% of (position, bearing) pairs to 0.61% and the tallest
  // continuous ridable band from 6.00 m to 7.00 m. So the looser threshold buys essentially
  // nothing here, while letting the move fire on 60-degree slopes the ground snap already
  // walks up — which would read as sticking to hillsides. See `wall-ride-geometry.test.ts`,
  // which pins all four of those figures.
  wallRideNormalY: 0.25,
  // `runSpeed`. You have to be closing on the wall at least as fast as a flat-out sprint
  // on foot, which the scooter clears easily — at the entry charge below, its multiplier is
  // 2.20, so even a walk into a wall is 15.4 m/s. The gate is therefore about the scooter
  // being up to speed and pointed at the wall, not about holding sprint.
  wallRideEntrySpeed: 13,
  // One tier: `scooterTierDrop`, the accumulator's own unit of loss. Entry and exit are then
  // denominated in the same currency with a tier of hysteresis between them, which is what
  // stops a charge-0 rider entering and being dropped on the next frame — a stutter against
  // every wall on the map rather than a move.
  wallRideMinCharge: 0.34,
  // `scooterChargeLoss` 0.8, the rate a hard turn bleeds the accumulator, because a wall ride
  // is the same idea pointed upward: you are spending the clean line rather than holding it. A
  // full accumulator therefore pays for 1.25 s of wall against the 2.86 s at
  // `scooterChargeGain` that it takes to build one, so a ride gives back well under half the
  // line that bought it — which is what the design doc means by a vertical shortcut costing
  // the speed you built to reach it.
  wallRideChargeDrain: 0.8,
  // `jumpSpeed` / `runSpeed` = 9 / 13 = 0.692, rounded. The statement it encodes: a ride
  // entered at the slowest legal closing speed climbs at exactly the speed a jump leaves
  // the ground with, so the worst wall ride is worth one jump and everything above it is
  // profit. Not derived from those two at runtime, because that would move the feel of
  // every wall ride the next time anyone retunes the jump; the relationship is asserted in
  // `wall-ride.test.ts` instead, so a retune reddens a test rather than shipping silently.
  wallRideRedirect: 0.7,
  // A third of `gravity` 20 — the ball of air carries two thirds of the rider's weight
  // while the ride lasts. Picked so the two limits on a ride bind together instead of one
  // making the other decorative: the minimum legal ride climbs at 9.1 m/s and decays to
  // `wallRideHoldSpeed` in 1.22 s, against the 1.25 s a full accumulator pays for at
  // `wallRideChargeDrain`. Above the minimum, the accumulator is what runs out first, which
  // is the ordering the design doc asks for.
  wallRideClimbDecay: 6.7,
  // A tenth of `jumpSpeed` 9. Zero would read simpler and would work, but a ride crawling
  // upward at a few centimetres a second still drains the accumulator and still holds the
  // avatar leaning into the rock, so it would look like sticking to the wall rather than
  // like letting go of it. A tenth of a jump is below anything a player can see as a climb.
  wallRideHoldSpeed: 0.9,
  maxDashChain: 3,
  dashSpeed: 26,
  dashRecoverySeconds: 0.7,
}

import type { CollisionConfig } from '../world/collision'

/**
 * Terrain collision.
 *
 * A body radius of 0.5 against the character's 1.8 height — the same reference
 * `projectile.hitRadius` takes. Wide enough that the camera does not see through the body
 * into rock, narrow enough to fit the gate islands' 60 m gap without feeling wide.
 *
 * `wallNormalY` of 0.5 is a surface past 60 degrees from horizontal. Below that the ground
 * snap can already climb it: it probes from `eyeProbeHeight` 2 above the feet and accepts
 * anything within `snapDistance` 1.2 of the ray.
 *
 * Both are argued guesses. Neither has been played.
 */
export const DEFAULT_COLLISION_CONFIG: CollisionConfig = {
  radius: 0.5,
  wallNormalY: 0.5,
}

export function validateCollisionConfig(c: CollisionConfig): void {
  if (!(c.radius > 0)) {
    throw new Error(`CollisionConfig.radius must be > 0, got ${c.radius}`)
  }
  if (!(c.wallNormalY > 0) || !(c.wallNormalY < 1)) {
    throw new Error(
      'CollisionConfig.wallNormalY must sit strictly between 0 and 1: at 0 nothing is a ' +
      'wall and at 1 level ground is one, and either way collision stops being about ' +
      `walls (got ${c.wallNormalY})`,
    )
  }
}

import type { SlipstreamConfig } from '../player/slipstream'

/**
 * Slipstream. The window is 0.11s inside an enemy telegraph of 0.55s
 * (`windUpSeconds`), so beating a strike takes real timing rather than a mash.
 *
 * `breathCost` of 28 buys three dodges from a full bar. Breath regenerates at
 * `breathRegenPerSecond` 12 airborne but `breathRegenGroundedMultiplier` 2.5 times that,
 * 30, on the ground, so the same cost is repaid in 0.93s on foot — inside the dodge's own
 * cooldown, leaving the ground dodge as freely available as it was — against 2.33s in the
 * glider, which is longer than the cooldown and so makes chaining it a real decision.
 */
export const DEFAULT_SLIPSTREAM_CONFIG: SlipstreamConfig = {
  // A shade faster than the blast dash's 26: this one is bought with a cooldown
  // rather than being the everyday traversal tool.
  speed: 30,
  durationSeconds: 0.2,
  invulnerableSeconds: 0.11,
  cooldownSeconds: 1.5,
  breathCost: 28,
}

import type { StaffConfig } from '../player/staff'

/**
 * The staff. A full three-swing combo occupies it for about 0.8s of swinging plus 0.4s of
 * recovery, so committing to melee costs over a second with no wing — which is the price
 * the design document's "central risk decision" is supposed to have.
 */
export const DEFAULT_STAFF_CONFIG: StaffConfig = {
  maxChain: 3,
  swingSeconds: 0.26,
  continueSeconds: 0.3,
  recoverySeconds: 0.4,
}

import type { DownConfig } from '../player/down'

/**
 * The beat between going down and standing back up.
 *
 * 1.5 seconds total. Long enough to register as an event, short enough not to read as a
 * loading screen. The fade in is the longer half on purpose: coming back should feel
 * slower than going down.
 *
 * Every value here is an argued guess. None of it has been played.
 */
export const DEFAULT_DOWN_CONFIG: DownConfig = {
  fadeOutSeconds: 0.6,
  fadeInSeconds: 0.9,
}
