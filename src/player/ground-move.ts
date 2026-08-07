import { Vector3 } from 'three'
import type { GroundConfig, InputState, PlayerState, TerrainQuery } from '../core/types'
import { stepJump } from './jump'
import { stepScooter, scooterSpeedMultiplier, scooterTurnAuthority } from './scooter'
import { stepDash } from './dash'
import { raycastDown } from '../world/terrain-query'
import { resolveMovement, type CollisionConfig } from '../world/collision'
import { stillAir, type WindSample } from '../world/wind'

const WORLD_UP = new Vector3(0, 1, 0)

/** Flatten a look direction onto the horizontal plane. */
export function horizontalForward(lookDirection: Vector3): Vector3 {
  const flat = new Vector3(lookDirection.x, 0, lookDirection.z)
  if (flat.lengthSq() < 1e-8) return new Vector3(0, 0, -1)
  return flat.normalize()
}

/**
 * Camera-relative desired horizontal velocity. Normalised so diagonals are not faster.
 *
 * `speedScale` still carries the scooter's speed multiplier. Steering is no longer this
 * function's business: it used to also take an `authority` that scaled the strafe axis
 * here, but the heading comes from the camera, not from strafe, so that scaling barely
 * touched the turn — see `easeHorizontal`, which is where authority actually lives now.
 */
export function desiredVelocity(
  input: InputState,
  c: GroundConfig,
  speedScale = 1,
): Vector3 {
  const forward = horizontalForward(input.lookDirection)
  const right = new Vector3().crossVectors(forward, WORLD_UP).normalize()
  const move = forward
    .multiplyScalar(input.forward)
    .addScaledVector(right, input.strafe)
  if (move.lengthSq() < 1e-8) return new Vector3()
  const base = input.sprint ? c.runSpeed : c.walkSpeed
  return move.normalize().multiplyScalar(base * speedScale)
}

/**
 * Ease horizontal velocity towards what the player asked for.
 *
 * The design doc's air-assisted run has soft acceleration and slides on stops, so ground
 * speed chases the stick rather than snapping to it. Exponential easing is used so the
 * result is independent of frame rate.
 *
 * `authority` is how much steering the mover keeps, 1 being full on-foot control. It scales
 * the response rate, because that is what actually turns you: the heading comes from the
 * camera, so a rider who kept full response would carve exactly as tightly as a runner no
 * matter what the accumulator said. It used to scale the strafe axis inside
 * `desiredVelocity` instead, which measured as no effect at all -- a 90-degree turn took
 * 0.45 seconds on foot, at charge 0 and at charge 1 alike.
 */
export function easeHorizontal(
  current: Vector3,
  desired: Vector3,
  dt: number,
  c: GroundConfig,
  authority = 1,
): Vector3 {
  const blend = 1 - Math.exp(-c.groundResponse * authority * dt)
  return new Vector3(
    current.x + (desired.x - current.x) * blend,
    0,
    current.z + (desired.z - current.z) * blend,
  )
}

export function groundStep(
  state: PlayerState,
  input: InputState,
  dt: number,
  terrain: TerrainQuery,
  c: GroundConfig,
  collision: CollisionConfig,
  wind: WindSample = stillAir(),
): PlayerState {
  const jump = stepJump(state, input, dt, c)

  // The scooter is the connective tissue of ground movement: it doubles speed and
  // halves steering, and its accumulator rewards holding a clean line.
  const moving = Math.abs(input.forward) > 0.01 || Math.abs(input.strafe) > 0.01
  const scooter = stepScooter(
    { active: state.scooterActive, charge: state.scooterCharge },
    { toggle: input.scooterPressed, turn: input.strafe, moving, clipped: false },
    state.grounded,
    dt,
    c,
  )
  const speedScale = scooter.active ? scooterSpeedMultiplier(scooter.charge, c) : 1
  const authority = scooter.active ? scooterTurnAuthority(scooter.charge, c) : 1

  const desired = desiredVelocity(input, c, speedScale).multiplyScalar(jump.walkFactor)
  // Eased rather than assigned, so the run leans into turns and slides on stops -- and at
  // reduced authority the lean becomes a genuine cost, which is the scooter's whole trade.
  const horizontal = easeHorizontal(state.velocity, desired, dt, c, authority)

  // The dash is an impulse on top, which is what lets it cancel out of anything.
  const dash = stepDash(
    { used: state.dashesUsed, recovery: state.dashRecovery },
    input.dashPressed,
    desired.lengthSq() > 1e-8 ? desired : horizontalForward(input.lookDirection),
    state.grounded,
    dt,
    c,
  )
  if (dash.impulse) horizontal.add(dash.impulse)

  // The air, applied only while airborne: a player standing on rock is braced against a
  // thermal, and pushing a grounded body would fight the ground snap, which owns vertical
  // placement down there. Same division of labour terrain collision already keeps -- one
  // system owns the surface and the others leave it alone.
  //
  // Added after easing and the dash impulse, not folded into `desired` before them: both of
  // those already settled on a velocity this frame, and the air is a further push on top of
  // that outcome, the same way the dash's own impulse is added on top rather than eased
  // toward. Folding it earlier would let `easeHorizontal`'s exponential blend chase it like
  // stick input, smearing an instantaneous acceleration into something that ramps in over
  // the response time instead of applying in full this frame -- and it would let the
  // scooter's reduced turn authority mute how hard the world's air pushes a rider around,
  // which has nothing to do with steering.
  //
  // wind.liftScale is deliberately ignored. It multiplies a wing's own lift, and a body
  // without a wing has none to scale, so dead air does nothing on foot. That is correct:
  // dead air is a volume where a wing stops working, not one where gravity changes.
  const airborne = !state.grounded
  if (airborne) {
    horizontal.x += wind.accel.x * dt
    horizontal.z += wind.accel.z * dt
  }

  // Gravity, then the air. The ternary's first branch, a jump frame, overrides velocityY
  // outright, so the air does not add to the instant of a jump -- only to the arc after
  // it: a jump's height is the jump's, and the air acts on the flight that follows.
  const velocityY = jump.jumpVelocityY !== null
    ? jump.jumpVelocityY
    : state.velocity.y - c.gravity * dt + (airborne ? wind.accel.y * dt : 0)

  const velocity = new Vector3(horizontal.x, velocityY, horizontal.z)
  const target = state.position.clone().addScaledVector(velocity, dt)
  // Before the ground snap, not after. The snap adjusts only y, and only for a player who
  // was already grounded or is descending onto a surface, so a horizontal deflection
  // composes with it instead of competing. Resolving after the snap would leave a walker
  // deflected off a wall without being re-seated on the ground under them.
  const cleared = resolveMovement(state.position, target, velocity, terrain, collision)
  const position = cleared.position
  velocity.copy(cleared.velocity)

  // Walking keeps a distance snap so slopes and small drops stick underfoot.
  // An airborne body must not be grabbed from a distance — that cancelled the
  // top of every jump — so it lands only when its feet actually reach ground.
  let grounded = false
  let lastGroundIslandId = state.lastGroundIslandId
  if (velocity.y <= 0) {
    const probe = position.clone().setY(position.y + c.eyeProbeHeight)
    const hit = raycastDown(terrain, probe, c.eyeProbeHeight + c.snapDistance)
    if (hit && (state.grounded || position.y <= hit.point.y)) {
      position.y = hit.point.y
      velocity.y = 0
      grounded = true
      lastGroundIslandId = hit.islandId
    }
  }

  return {
    ...state, position, velocity,
    // On foot the aim follows the camera, flattened — the same basis this module already
    // uses to steer with (`desiredVelocity`) and to point a standing dash. Carrying the
    // old heading instead left `forward` frozen at spawn, or at whatever heading the
    // glider last landed on, and the gust's cone is tested against `forward`: every blast
    // on foot went in that stale direction regardless of where the player was facing.
    // Velocity cannot serve here, because a player who stops to aim has none.
    forward: horizontalForward(input.lookDirection), grounded, lastGroundIslandId,
    chargeTime: jump.chargeTime,
    airJumpsUsed: grounded ? 0 : jump.airJumpsUsed,
    scooterActive: scooter.active,
    scooterCharge: scooter.charge,
    dashesUsed: dash.state.used,
    dashRecovery: dash.state.recovery,
  }
}
