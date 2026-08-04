import { Vector3 } from 'three'
import type {
  FlightConfig, GroundConfig, InputState, PlayerState, TerrainQuery,
} from '../core/types'
import { flightStep } from './flight'
import { steerToward } from './steering'
import { stepBreath, canBend } from './breath'
import { groundStep } from './ground-move'
import { canAirJump } from './jump'
import { stillAir, type WindSample } from '../world/wind'
import { stepSlipstream, slipstreamHeading, type SlipstreamConfig } from './slipstream'

export interface ControllerDeps {
  terrain: TerrainQuery
  flight: FlightConfig
  ground: GroundConfig
  worldFloorY: number
  /** Where to respawn for the given island, or the level spawn when null. */
  spawnPointFor(islandId: string | null): Vector3
  /**
   * What the air is doing where the glider is. Injected rather than read from the
   * level so movement stays testable against a made-up sky.
   */
  windAt?(position: Vector3, forward: Vector3): WindSample
  slipstream: SlipstreamConfig
}

/** Distance below the glider at which touching down counts as landing. */
const LANDING_PROBE = 2.5
/** Fraction of horizontal speed kept after a too-fast landing. */
const STAGGER_RETENTION = 0.3
/**
 * Fraction kept after a clean landing.
 *
 * Not zero: the design doc is explicit that landing at speed never hard-stops the
 * character — he rolls, skims or scoots out of it — and a dead stop was the one
 * place the ground layer threw away all the momentum the player had built.
 */
const LANDING_RETENTION = 0.85

export function isFinitePlayer(s: PlayerState): boolean {
  const nums = [
    ...s.position.toArray(), ...s.velocity.toArray(), ...s.forward.toArray(),
    s.breath, s.maxBreath, s.airJumpsUsed, s.chargeTime,
  ]
  return nums.every(Number.isFinite)
}

/**
 * Whether `controllerStep` will respawn this state this frame.
 *
 * Two independent triggers both land in the same respawn: falling past the world
 * floor, and any tracked field going non-finite. Both set `grounded: true` (via
 * `respawn()` below), so a caller that only checked the floor would still see a
 * non-finite-triggered respawn as an ordinary landing. Exported so that fact lives
 * in one place rather than being re-derived, and possibly re-derived wrong, at each
 * call site.
 */
export function willRespawn(state: PlayerState, worldFloorY: number): boolean {
  return !isFinitePlayer(state) || state.position.y < worldFloorY
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
    chargeTime: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
    slipstreamElapsed: null, slipstreamCooldown: 0,
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
    chargeTime: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
    slipstreamElapsed: null, slipstreamCooldown: 0,
  }
}

export function controllerStep(
  state: PlayerState,
  input: InputState,
  dt: number,
  deps: ControllerDeps,
): PlayerState {
  if (willRespawn(state, deps.worldFloorY)) return safeRespawn(state, deps)

  let next: PlayerState

  if (state.mode === 'ground') {
    if (input.actionPressed && !state.grounded && !canAirJump(state, deps.ground)) {
      // Deploy the glider mid-fall — but only once the air jump is spent.
      // Grounded presses charge or jump; airborne presses with reserve
      // double-jump. Both are handled by groundStep.
      // The wings snapping open adds a kick rather than only preserving momentum,
      // so a well-timed deploy out of a jump is rewarded.
      const launched = state.velocity.clone()
      launched.y += deps.flight.deployKick
      next = {
        ...state,
        mode: 'glider',
        forward: input.lookDirection.clone().normalize(),
        position: state.position.clone(),
        velocity: launched,
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
    const thrusting = input.forward > 0 && canBend(state)
    // Thrust wins when both are held. They are opposite intentions, and going
    // faster is the one a player is more likely to want mid-manoeuvre.
    const hovering = !thrusting && input.sprint && canBend(state)
    const forward = steerToward(
      state.forward, input.lookDirection, speed, input.strafe, dt, deps.flight,
    )
    const wind = deps.windAt ? deps.windAt(state.position, forward) : stillAir()
    const moved = flightStep(state.position, state.velocity, {
      forward,
      thrust: thrusting,
      flare: input.forward < 0,
      bank: input.strafe * 0.6,
      hover: hovering, tuck: input.tuck,
    }, dt, deps.flight, wind)
    const effort = thrusting ? 'thrust' : hovering ? 'hover' : 'idle'
    const breath = stepBreath(state, effort, false, dt, deps.flight)

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
        velocity: (() => {
          const kept = landingSpeed <= deps.flight.landingSpeed
            ? LANDING_RETENTION
            : STAGGER_RETENTION
          return new Vector3(next.velocity.x * kept, 0, next.velocity.z * kept)
        })(),
        lastGroundIslandId: hit.islandId,
        airJumpsUsed: 0,
        chargeTime: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
      }
    }
  }

  // Breath recovers on foot. Flight handles its own drain above.
  if (state.mode === 'ground' && next.mode === 'ground') {
    next = { ...next, breath: stepBreath(next, 'idle', next.grounded, dt, deps.flight).breath }
  }

  // Applied after the posture branches, because a dodge is available in both and the
  // impulse is the same in each: a burst added to whatever velocity movement produced.
  const slip = stepSlipstream(
    { elapsed: next.slipstreamElapsed, cooldown: next.slipstreamCooldown },
    input.slipstreamPressed,
    slipstreamHeading(input.lookDirection, input.forward, input.strafe),
    dt,
    deps.slipstream,
  )
  next = {
    ...next,
    slipstreamElapsed: slip.state.elapsed,
    slipstreamCooldown: slip.state.cooldown,
    velocity: slip.impulse ? next.velocity.clone().add(slip.impulse) : next.velocity,
  }

  return isFinitePlayer(next) ? next : safeRespawn(state, deps)
}
