import { Vector3 } from 'three'
import type {
  FlightConfig, GroundConfig, InputState, PlayerState, TerrainQuery,
} from '../core/types'
import { flightStep } from './flight'
import { steerToward } from './steering'
import { stepBreath, canThrust } from './breath'
import { groundStep } from './ground-move'

export interface ControllerDeps {
  terrain: TerrainQuery
  flight: FlightConfig
  ground: GroundConfig
  worldFloorY: number
  /** Where to respawn for the given island, or the level spawn when null. */
  spawnPointFor(islandId: string | null): Vector3
}

/** Distance below the kite at which touching down counts as landing. */
const LANDING_PROBE = 2.5
/** Fraction of horizontal speed kept after a too-fast landing. */
const STAGGER_RETENTION = 0.3

function isFinitePlayer(s: PlayerState): boolean {
  const nums = [
    ...s.position.toArray(), ...s.velocity.toArray(), ...s.forward.toArray(),
    s.breath, s.maxBreath, s.airJumpsUsed, s.chargeTime,
  ]
  return nums.every(Number.isFinite)
}

export function respawn(state: PlayerState, deps: ControllerDeps): PlayerState {
  // A corrupt maxBreath would otherwise be laundered into breath and escape the guard.
  const maxBreath =
    Number.isFinite(state.maxBreath) && state.maxBreath > 0
      ? state.maxBreath
      : deps.flight.baseMaxBreath
  return {
    ...state,
    mode: 'ground',
    position: deps.spawnPointFor(state.lastGroundIslandId),
    velocity: new Vector3(),
    forward: new Vector3(0, 0, -1),
    grounded: true,
    breath: maxBreath,
    maxBreath,
    airJumpsUsed: 0,
    chargeTime: 0,
  }
}

/**
 * Respawn, then verify the result. spawnPointFor is injected, so a caller bug
 * could hand us a non-finite position; without this check the corrupted state
 * would be returned and re-corrupted every frame thereafter.
 */
function safeRespawn(state: PlayerState, deps: ControllerDeps): PlayerState {
  const respawned = respawn(state, deps)
  if (isFinitePlayer(respawned)) return respawned
  console.warn('spawnPointFor returned a non-finite position; falling back to the origin.')
  return {
    mode: 'ground',
    position: new Vector3(),
    velocity: new Vector3(),
    forward: new Vector3(0, 0, -1),
    breath: deps.flight.baseMaxBreath,
    maxBreath: deps.flight.baseMaxBreath,
    grounded: false,
    lastGroundIslandId: null,
    airJumpsUsed: 0,
    chargeTime: 0,
  }
}

export function controllerStep(
  state: PlayerState,
  input: InputState,
  dt: number,
  deps: ControllerDeps,
): PlayerState {
  if (!isFinitePlayer(state)) return safeRespawn(state, deps)
  if (state.position.y < deps.worldFloorY) return safeRespawn(state, deps)

  let next: PlayerState

  if (state.mode === 'ground') {
    if (input.actionPressed && !state.grounded) {
      // Deploy the kite mid-fall. Grounded presses are jumps, handled by groundStep.
      next = {
        ...state,
        mode: 'kite',
        forward: input.lookDirection.clone().normalize(),
        position: state.position.clone(),
        velocity: state.velocity.clone(),
        grounded: false,
      }
    } else {
      next = groundStep(state, input, dt, deps.terrain, deps.ground)
    }
  } else if (input.actionPressed) {
    next = {
      ...state, mode: 'ground', grounded: false,
      position: state.position.clone(),
      velocity: state.velocity.clone(),
      forward: state.forward.clone(),
    }
  } else {
    const speed = state.velocity.length()
    const thrusting = input.forward > 0 && canThrust(state)
    const forward = steerToward(
      state.forward, input.lookDirection, speed, input.strafe, dt, deps.flight,
    )
    const moved = flightStep(state.position, state.velocity, {
      forward,
      thrust: thrusting,
      flare: input.forward < 0,
      bank: input.strafe * 0.6,
    }, dt, deps.flight)
    const breath = stepBreath(state, thrusting, false, dt, deps.flight)

    next = {
      ...state, forward,
      position: moved.position, velocity: moved.velocity,
      breath: breath.breath, grounded: false,
    }

    const hit = deps.terrain.raycastDown(next.position, LANDING_PROBE)
    if (hit) {
      const landingSpeed = next.velocity.length()
      next = {
        ...next, mode: 'ground', grounded: true,
        position: hit.point.clone(),
        velocity: landingSpeed <= deps.flight.landingSpeed
          ? new Vector3()
          : new Vector3(
              next.velocity.x * STAGGER_RETENTION, 0, next.velocity.z * STAGGER_RETENTION,
            ),
        lastGroundIslandId: hit.islandId,
        airJumpsUsed: 0,
        chargeTime: 0,
      }
    }
  }

  // Breath recovers on foot. Flight handles its own drain above.
  if (state.mode === 'ground' && next.mode === 'ground') {
    next = { ...next, breath: stepBreath(next, false, next.grounded, dt, deps.flight).breath }
  }

  return isFinitePlayer(next) ? next : safeRespawn(state, deps)
}
