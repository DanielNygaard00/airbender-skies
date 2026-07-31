import type { Vector3 } from 'three'

export type PlayerMode = 'ground' | 'kite'

/** Player intent for one frame. Produced by input, consumed by movement. */
export interface InputState {
  /** Normalised camera forward direction. */
  lookDirection: Vector3
  /** W = +1, S = -1. Thrust in kite mode, walk in ground mode. */
  forward: number
  /** D = +1, A = -1. Bank in kite mode, strafe in ground mode. */
  strafe: number
  /** Shift held. */
  sprint: boolean
  /** Space, edge-triggered: jump, deploy, or stow. */
  actionPressed: boolean
  /** Space currently held down. Drives jump charging. */
  actionHeld: boolean
  /** Space, edge-triggered on key-up: releases a charged jump. */
  actionReleased: boolean
}

export interface PlayerState {
  mode: PlayerMode
  position: Vector3
  velocity: Vector3
  /** Where the character or kite points. Always normalised. */
  forward: Vector3
  breath: number
  maxBreath: number
  grounded: boolean
  lastGroundIslandId: string | null
  /** Air jumps spent since last standing on ground. */
  airJumpsUsed: number
  /** Seconds space has been held toward a charged jump. 0 = not charging. */
  chargeTime: number
}

export interface TerrainHit {
  point: Vector3
  normal: Vector3
  islandId: string
}

/** The only channel through which movement code may ask about the world. */
export interface TerrainQuery {
  groundHeightAt(x: number, z: number): number | null
  raycastDown(from: Vector3, maxDistance: number): TerrainHit | null
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
  /** Built-in trim angle of the kite, radians. Gives a natural cruise speed. */
  rigAoa: number
  /** Turn rate at or below turnRateSpeedRef, radians/s. */
  baseTurnRate: number
  /** Airspeed above which turns start widening, m/s. */
  turnRateSpeedRef: number
  /** Extra roll rate contributed by bank input, radians/s. */
  bankTurnRate: number
  /** Breath consumed per second of thrust. */
  breathDrainPerSecond: number
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
  /** Holds shorter than this are taps: a normal jump. */
  chargeThresholdSeconds: number
  /** Hold time at which the charge is full. */
  chargeMaxSeconds: number
  /** Vertical speed at full charge. */
  chargedJumpSpeed: number
  /** Movement speed multiplier while charging. */
  chargeWalkFactor: number
}
