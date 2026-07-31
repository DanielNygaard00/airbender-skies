import { Vector3 } from 'three'
import type { GroundConfig, InputState, PlayerState, TerrainQuery } from '../core/types'

const WORLD_UP = new Vector3(0, 1, 0)

/** Flatten a look direction onto the horizontal plane. */
export function horizontalForward(lookDirection: Vector3): Vector3 {
  const flat = new Vector3(lookDirection.x, 0, lookDirection.z)
  if (flat.lengthSq() < 1e-8) return new Vector3(0, 0, -1)
  return flat.normalize()
}

/** Camera-relative desired horizontal velocity. Normalised so diagonals are not faster. */
export function desiredVelocity(input: InputState, c: GroundConfig): Vector3 {
  const forward = horizontalForward(input.lookDirection)
  const right = new Vector3().crossVectors(forward, WORLD_UP).normalize()
  const move = forward.multiplyScalar(input.forward).addScaledVector(right, input.strafe)
  if (move.lengthSq() < 1e-8) return new Vector3()
  return move.normalize().multiplyScalar(input.sprint ? c.runSpeed : c.walkSpeed)
}

export function groundStep(
  state: PlayerState,
  input: InputState,
  dt: number,
  terrain: TerrainQuery,
  c: GroundConfig,
): PlayerState {
  const horizontal = desiredVelocity(input, c)
  let velocityY = state.velocity.y

  if (state.grounded && input.actionPressed) velocityY = c.jumpSpeed
  else velocityY -= c.gravity * dt

  const velocity = new Vector3(horizontal.x, velocityY, horizontal.z)
  const position = state.position.clone().addScaledVector(velocity, dt)

  // Walking keeps a distance snap so slopes and small drops stick underfoot.
  // An airborne body must not be grabbed from a distance — that cancelled the
  // top of every jump — so it lands only when its feet actually reach ground.
  let grounded = false
  let lastGroundIslandId = state.lastGroundIslandId
  if (velocity.y <= 0) {
    const probe = position.clone().setY(position.y + c.eyeProbeHeight)
    const hit = terrain.raycastDown(probe, c.eyeProbeHeight + c.snapDistance)
    if (hit && (state.grounded || position.y <= hit.point.y)) {
      position.y = hit.point.y
      velocity.y = 0
      grounded = true
      lastGroundIslandId = hit.islandId
    }
  }

  return {
    ...state, position, velocity,
    forward: state.forward.clone(), grounded, lastGroundIslandId,
  }
}
