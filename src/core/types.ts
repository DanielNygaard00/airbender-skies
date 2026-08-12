import type { Vector3 } from 'three'

export type PlayerMode = 'ground' | 'glider'

/** Player intent for one frame. Produced by input, consumed by movement. */
export interface InputState {
  /** Normalised camera forward direction. */
  lookDirection: Vector3
  /** W = +1, S = -1. Thrust in glider mode, walk in ground mode. */
  forward: number
  /** D = +1, A = -1. Bank in glider mode, strafe in ground mode. */
  strafe: number
  /** Shift held. */
  sprint: boolean
  /** Ctrl held: fold the wings into a dive. */
  tuck: boolean
  /** Space, edge-triggered: jump, deploy, or stow. */
  actionPressed: boolean
  /** Space currently held down. Drives jump charging. */
  actionHeld: boolean
  /** Space, edge-triggered on key-up: releases a charged jump. */
  actionReleased: boolean
  /** Shift, edge-triggered: toggles the air scooter on the ground. */
  scooterPressed: boolean
  /** Q, edge-triggered: an air blast dash. */
  dashPressed: boolean
  /** F, edge-triggered: a gust of air. */
  gustPressed: boolean
  /** E, edge-triggered: enter the Avatar State when it is armed. */
  avatarStatePressed: boolean
  /** R held: charging a vortex. */
  vortexHeld: boolean
  /** R, edge-triggered on key-up: release the vortex. */
  vortexReleased: boolean
  /** C, edge-triggered: a slipstream dodge. */
  slipstreamPressed: boolean
  /**
   * G held: raise or hold an Air Wall.
   *
   * A held key with no release edge, unlike the Vortex's pair. The Vortex needs the edge
   * because releasing it is what *fires* the move and the charge in between is accumulated
   * state; a wall simply stands while the key is down, so the absence of a key-up event — which
   * is what a window blur produces — correctly drops it rather than freezing it.
   */
  airWallHeld: boolean
  /** Left mouse button, edge-triggered, only while the canvas holds the pointer lock. */
  staffPressed: boolean
}

export interface PlayerState {
  mode: PlayerMode
  position: Vector3
  velocity: Vector3
  /** Where the character or glider points. Always normalised. */
  forward: Vector3
  breath: number
  maxBreath: number
  grounded: boolean
  lastGroundIslandId: string | null
  /** Air jumps spent since last standing on ground. */
  airJumpsUsed: number
  /** Seconds space has been held toward a charged jump. 0 = not charging. */
  chargeTime: number
  /** Seconds of grace left to still jump as though grounded. Pinned while grounded. */
  coyoteTime: number
  /** Seconds left on a jump press remembered across a landing. */
  jumpBuffer: number
  /** Riding the air scooter. */
  scooterActive: boolean
  /** The scooter's hidden speed accumulator, 0 to 1. */
  scooterCharge: number
  /** Dashes spent in the current chain. */
  dashesUsed: number
  /** Seconds of dash recovery still owed. */
  dashRecovery: number
  /** Seconds since a slipstream fired, or null when not slipstreaming. */
  slipstreamElapsed: number | null
  /** Seconds of slipstream cooldown still owed. */
  slipstreamCooldown: number
  /** Swings thrown in the current staff combo. See `StaffState.chain`. */
  staffChain: number
  /** Seconds into the active staff swing, or null between swings. See `StaffState.elapsed`. */
  staffElapsed: number | null
  /** Seconds of staff recovery still owed. See `StaffState.recovery`. */
  staffRecovery: number
  /** Seconds since the last swing ended, mid-combo. See `StaffState.sinceSwing`. */
  staffSinceSwing: number
}

export interface TerrainHit {
  point: Vector3
  normal: Vector3
  islandId: string
}

/**
 * The single channel through which the game asks about terrain.
 *
 * One general cast rather than a downward special case. It was downward-only for a long
 * time, and three systems were missing behaviour because of it: the player passed through
 * solid rock in both postures, the camera arm could not shorten through a wall, and the
 * air scooter's tier drop was unreachable because nothing could report a clip.
 */
export interface TerrainQuery {
  groundHeightAt(x: number, z: number): number | null
  /**
   * The first surface along a ray, or null. `direction` need not be normalised;
   * `maxDistance` is always in world units.
   */
  raycast(from: Vector3, direction: Vector3, maxDistance: number): TerrainHit | null
}

export interface FlightConfig {
  /** Downward acceleration, m/s². */
  gravity: number
  /** Lift scale. Lift ∝ liftCoeff · v² · sin(2·aoa). */
  liftCoeff: number
  /** Parasitic drag scale. Drag ∝ dragCoeff · v². */
  dragCoeff: number
  /** How much angle of attack multiplies drag. */
  inducedDragFactor: number
  /** Below this airspeed lift falls off linearly to zero. */
  stallSpeed: number
  /** Forward acceleration while thrusting, m/s². */
  thrustAccel: number
  /** Extra angle of attack added while flaring, radians. */
  flareAoaBoost: number
  /** Built-in trim angle of the glider, radians. Gives a natural cruise speed. */
  rigAoa: number
  /** Turn rate at or below turnRateSpeedRef, radians/s. */
  baseTurnRate: number
  /** Airspeed above which turns start widening, m/s. */
  turnRateSpeedRef: number
  /** Extra roll rate contributed by bank input, radians/s. */
  bankTurnRate: number
  /**
   * Yaw a full weight shift produces on its own, radians/s.
   *
   * This is the primary steering input, the way it is on a real hang glider.
   * baseTurnRate is deliberately smaller so that looking trims the turn rather
   * than driving it.
   */
  weightShiftTurnRate: number
  /** Breath consumed per second of thrust. */
  breathDrainPerSecond: number
  /**
   * Breath consumed per second of hovering. Higher than thrust: holding station
   * means bending air downward hard enough to carry the glider's whole weight,
   * where thrust only has to add to a wing that is already flying.
   */
  hoverBreathPerSecond: number
  /**
   * How hard hovering bleeds airspeed, per second. This is what lets the glider
   * stop dead in the air rather than merely stop sinking.
   */
  hoverDamping: number
  /**
   * Lift and drag retained while tucked. Folding the wings costs nearly all the
   * lift and some of the drag, which is what turns a dive into a speed gain
   * rather than just a descent.
   */
  tuckLiftFactor: number
  tuckDragFactor: number
  /**
   * Upward kick given when the glider snaps open mid-jump. Deploying should feel
   * like a reward for good timing, so the transition adds energy instead of merely
   * preserving it.
   */
  deployKick: number
  /** Touching ground at or below this speed lands cleanly. */
  landingSpeed: number
  /** Starting maximum breath, before any shrines. */
  baseMaxBreath: number
  /** Breath recovered per second while not thrusting, in the air. */
  breathRegenPerSecond: number
  /** Regeneration is multiplied by this while standing on ground. */
  breathRegenGroundedMultiplier: number
  /** Each shrine adds this fraction of baseMaxBreath to the maximum. */
  shrineBreathBonusFraction: number
  /**
   * Breath needed to start bending, as opposed to zero.
   *
   * Without a floor, an empty bar oscillates: regeneration adds a fraction, the drain takes
   * slightly more, and thrust flickers on and off every other frame -- measured at 300 of
   * 600 frames engaged, which reads as a buzz rather than as exhaustion.
   *
   * The floor slows that buzz rather than silencing it: canBend is re-evaluated every
   * frame with no memory of "was already bending", so it gates at the floor the same way
   * the old code gated at zero. Measured with bendFloor 15: 210 of 600 frames still
   * engaged, down from 300. The floor's independent, still-valid value is that thrust now
   * needs a real reserve of breath rather than a merely non-zero bar -- see canBend in
   * breath.ts for the full account and why true elimination is a separate piece of work.
   */
  bendFloor: number
}

export interface GroundConfig {
  walkSpeed: number
  runSpeed: number
  jumpSpeed: number
  gravity: number
  /** How far below the feet the ground still counts as underfoot. */
  snapDistance: number
  /** How far above the feet the ground probe starts. */
  eyeProbeHeight: number
  /** Extra jumps available while airborne. */
  maxAirJumps: number
  /** Vertical speed set by an air jump. */
  airJumpSpeed: number
  /**
   * Fraction of existing upward speed the air jump adds on top of airJumpSpeed.
   *
   * The second jump is a downward air push, so it bites hardest against air that
   * is already moving: rising fast gains more height than jumping from a hover,
   * and falling gains nothing extra.
   */
  airJumpRisingBonus: number
  /** Holds shorter than this are taps: a normal jump. */
  chargeThresholdSeconds: number
  /** Hold time at which the charge is full. */
  chargeMaxSeconds: number
  /** Vertical speed at full charge. */
  chargedJumpSpeed: number
  /** Movement speed multiplier while charging. */
  chargeWalkFactor: number
  /**
   * Grace after walking off an edge during which a jump still counts as a ground jump.
   *
   * Note the interaction with `chargeThresholdSeconds`: at 0.1 against a threshold of 0.2,
   * this window cannot let a charge *complete* in the air. What it carries is a charge
   * already earned on the ground.
   */
  coyoteSeconds: number
  /** How long a jump press is remembered across a landing. */
  jumpBufferSeconds: number
  /**
   * How sharply ground speed chases the stick, per second. Low values give the
   * doc's soft acceleration and slide-on-stop instead of snapping to a stop.
   */
  groundResponse: number
  /** Speed multiplier for riding the scooter at zero charge. */
  scooterSpeedFactor: number
  /** Extra speed multiplier at full charge. */
  scooterChargeSpeedBonus: number
  /** Steering authority kept while riding, before charge tightens it further. */
  scooterTurnFactor: number
  /** Authority given up at full charge. */
  scooterChargeTurnPenalty: number
  /** Charge gained per second on a clean line. */
  scooterChargeGain: number
  /** Charge lost per second while turning hard. */
  scooterChargeLoss: number
  /** Charge lost outright on contact — a tier, not a trickle. */
  scooterTierDrop: number
  /** Dashes available before a recovery is owed. */
  maxDashChain: number
  /** Speed added by one dash. */
  dashSpeed: number
  /** Recovery owed once the chain is spent. */
  dashRecoverySeconds: number
}
