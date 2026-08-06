import { Vector3 } from 'three'
import type { GroundConfig, InputState, PlayerState, TerrainQuery } from '../core/types'
import { stepJump } from './jump'
import { stepScooter, scooterSpeedMultiplier, scooterTurnAuthority } from './scooter'
import { stepDash } from './dash'
import { raycastDown } from '../world/terrain-query'

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
 * `speedScale` carries the scooter's speed multiplier, and `authority` scales the
 * steering component, which is how riding trades manoeuvrability for speed.
 */
export function desiredVelocity(
  input: InputState,
  c: GroundConfig,
  speedScale = 1,
  authority = 1,
): Vector3 {
  const forward = horizontalForward(input.lookDirection)
  const right = new Vector3().crossVectors(forward, WORLD_UP).normalize()
  const move = forward
    .multiplyScalar(input.forward)
    .addScaledVector(right, input.strafe * authority)
  if (move.lengthSq() < 1e-8) return new Vector3()
  const base = input.sprint ? c.runSpeed : c.walkSpeed
  return move.normalize().multiplyScalar(base * speedScale)
}

/**
 * Ease horizontal velocity towards what the player asked for.
 *
 * The design doc's air-assisted run has soft acceleration and slides on stops, so
 * ground speed chases the stick rather than snapping to it. Exponential easing is
 * used so the result is independent of frame rate.
 */
export function easeHorizontal(
  current: Vector3,
  desired: Vector3,
  dt: number,
  c: GroundConfig,
): Vector3 {
  const blend = 1 - Math.exp(-c.groundResponse * dt)
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

  const desired = desiredVelocity(input, c, speedScale, authority)
    .multiplyScalar(jump.walkFactor)
  // Eased rather than assigned, so the run leans into turns and slides on stops.
  const horizontal = easeHorizontal(state.velocity, desired, dt, c)

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

  const velocityY = jump.jumpVelocityY !== null
    ? jump.jumpVelocityY
    : state.velocity.y - c.gravity * dt

  const velocity = new Vector3(horizontal.x, velocityY, horizontal.z)
  const position = state.position.clone().addScaledVector(velocity, dt)

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
