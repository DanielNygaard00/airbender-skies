import { Vector3 } from 'three'
import type {
  FlightConfig, GroundConfig, InputState, PlayerState, TerrainQuery,
} from '../core/types'
import { flightStep } from './flight'
import { steerToward } from './steering'
import { stepBreath, canBend } from './breath'
import { groundStep } from './ground-move'
import { canAirJump, fallWithinBufferWindow } from './jump'
import { stillAir, type WindSample } from '../world/wind'
import { stepSlipstream, dodgeHeading, type SlipstreamConfig } from './slipstream'
import {
  idleStaff, staffBusy, staffOf, stepStaff, type StaffConfig, type StaffSwing,
} from './staff'
import { raycastDown } from '../world/terrain-query'
import { isWall, resolveMovement, type CollisionConfig } from '../world/collision'

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
  staff: StaffConfig
  /** How the body is held off terrain. Injected like every other config here. */
  collision: CollisionConfig
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

/**
 * The four staff fields, flattened onto `PlayerState`, at their idle value.
 *
 * Exists so `respawn` and its non-finite fallback both clear the combo through
 * `idleStaff()` rather than typing out `0, null, 0, 0` twice and risking the two
 * copies drifting apart.
 */
function idleStaffFields(): Pick<
  PlayerState, 'staffChain' | 'staffElapsed' | 'staffRecovery' | 'staffSinceSwing'
> {
  const s = idleStaff()
  return {
    staffChain: s.chain, staffElapsed: s.elapsed, staffRecovery: s.recovery,
    staffSinceSwing: s.sinceSwing,
  }
}

/**
 * Whether the ground is close enough that a press belongs to the landing rather than to the
 * wings.
 *
 * The terrain question behind the deploy gate below, kept out of the condition itself so the
 * gate stays readable and so the raycast only runs on frames that have already satisfied
 * every cheap test above it.
 *
 * `reach > 0` short-circuits two cases at once rather than restating them: a rising player,
 * whose reach `fallWithinBufferWindow` reports as zero, and a `jumpBufferSeconds` of zero,
 * which switches the whole rule off along with the buffer it serves. Neither wants a cast,
 * and neither wants the deploy blocked.
 *
 * Cast from `state.position` rather than from the eye-height probe `groundStep` uses,
 * because the two ask different questions: that probe asks whether ground is underfoot
 * *now*, and this asks how much further there is to fall. An airborne descending body lands
 * when its position reaches the surface height, so the distance to cast is the distance from
 * the position, not from above it.
 *
 * The hit has to be real ground rather than merely a hit, and `isWall` is the same threshold
 * `resolveMovement` uses to decide what the body is held off rather than seated on. A face
 * steeper than `wallNormalY` is not somewhere a fall ends: collision pushes the body `radius`
 * clear of it and it skims on down, so a press yielded to such a face buys neither a glide
 * nor a jump, which is strictly worse than the defect this whole gate exists to fix.
 *
 * The faces that matter are not downward-facing overhangs -- front-side culling makes those
 * unhittable, which is why an earlier pass reasoned the filter unnecessary. They are faces
 * that point upward and are simply too steep: the rims and flanks of every island, which a
 * downward ray hits perfectly well. Measured over the real archipelago in
 * `wall-face-reach.test.ts`: 3.37% of the downward hits a descending player gets are faces
 * `isWall` rejects, the shallowest of them at `normal.y` 0.0040, and on `needle` it is 17.31%
 * of the island. Every one of those positions satisfied the unfiltered condition, so the
 * missing filter was the whole of the fault rather than one contributor to it.
 */
function aboutToLand(state: PlayerState, deps: ControllerDeps): boolean {
  const reach = fallWithinBufferWindow(state.velocity.y, deps.ground)
  if (!(reach > 0)) return false
  const hit = raycastDown(deps.terrain, state.position, reach)
  return hit !== null && !isWall(hit.normal, deps.collision)
}

export function isFinitePlayer(s: PlayerState): boolean {
  const nums = [
    ...s.position.toArray(), ...s.velocity.toArray(), ...s.forward.toArray(),
    s.breath, s.maxBreath, s.airJumpsUsed, s.chargeTime, s.coyoteTime, s.jumpBuffer,
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
    chargeTime: 0, coyoteTime: 0, jumpBuffer: 0,
    scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
    slipstreamElapsed: null, slipstreamCooldown: 0,
    ...idleStaffFields(),
  }
}

/**
 * Respawn, then verify the result. spawnPointFor is injected, so a caller bug
 * could hand us a non-finite position; without this check the corrupted state
 * would be returned and re-corrupted every frame thereafter.
 *
 * Exported because going down uses the same recovery as falling out of the world does.
 * Two triggers, one mechanism — and both want this guard, not the unguarded `respawn`.
 */
export function safeRespawn(state: PlayerState, deps: ControllerDeps): PlayerState {
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
    chargeTime: 0, coyoteTime: 0, jumpBuffer: 0,
    scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
    slipstreamElapsed: null, slipstreamCooldown: 0,
    ...idleStaffFields(),
  }
}

/**
 * The swing the staff started this frame, if any — reported separately from
 * `controllerStep` because a `PlayerState` cannot say so on its own: `staffElapsed`
 * reads 0 for the whole first frame of a swing whether or not one just began.
 *
 * This is the parallel-function shape from Task 5's brief, chosen over recomputing
 * `finisher` from a before/after `staffChain` comparison in `main.ts`: that would put
 * chain-length knowledge in a second place, and only `stepStaff` is allowed to decide
 * `finisher`. Calling `stepStaff` again here is safe because it is a pure read of the
 * same state, input, dt and config `controllerStep` is about to use — fed the same
 * inputs, the two calls can never disagree.
 */
export function staffStep(
  state: PlayerState, input: InputState, dt: number, c: StaffConfig,
): StaffSwing | null {
  // The staff steps only in ground mode: in the glider the staff IS the wing, so a
  // press here is dropped rather than queued for landing.
  if (state.mode !== 'ground') return null
  return stepStaff(staffOf(state), input.staffPressed, dt, c).started
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
    if (input.actionPressed && !state.grounded && !canAirJump(state, deps.ground)
        && !staffBusy(staffOf(state)) && !aboutToLand(state, deps)) {
      // Deploy the glider mid-fall — but only once the air jump is spent, only once
      // the staff is free, and only while there is still air left to use the wing in.
      // The glider IS the staff, folded across the back and
      // unfolding fan leaves on deploy: it cannot open while it is out swinging, and
      // that is the design document's central risk decision, not a restriction
      // bolted on afterward. Grounded presses charge or jump; airborne presses with
      // reserve double-jump. Both are handled by groundStep.
      // The wings snapping open adds a kick rather than only preserving momentum,
      // so a well-timed deploy out of a jump is rewarded.
      //
      // `aboutToLand` is the newest of the four conditions, and it is what stops this gate
      // eating the jump buffer whole. The rest of the gate was otherwise identical to the
      // buffer's arming branch in `stepJump` minus `staffBusy`, and this runs first, so
      // `Space` with no air jump left opened the wings and the buffer could only ever arm
      // while a swing, a chain or a recovery was live. Measured through this function before
      // the condition existed: airborne with the air jump spent and the staff idle gave
      // `mode: 'glider'` and `jumpBuffer` 0 whether the ground was 200 m away or half a
      // metre. Yielding near the ground costs the deploy nothing worth keeping -- wings that
      // open three frames before touchdown unfold, kick and stow again -- and the press falls
      // through to `groundStep`, arms the buffer, and becomes a jump on the landing instead.
      const launched = state.velocity.clone()
      launched.y += deps.flight.deployKick
      next = {
        ...state,
        mode: 'glider',
        forward: input.lookDirection.clone().normalize(),
        position: state.position.clone(),
        velocity: launched,
        grounded: false,
        // Both forgiveness counters are dropped rather than carried, for one reason: nothing
        // in glider mode advances either of them. The countdowns live in `groundStep`, which
        // does not run below. So anything carried across this line stops being 0.1 s of memory
        // and becomes 0.1 s of *ground-mode* time spread over an unbounded stretch of wall
        // clock — stow the glider (the branch below), touch down a few frames later, and a
        // press or an edge from before a minute-long glide is still live.
        //
        // Zeroed here rather than at the stow because this is the only entrance to glider
        // mode, so closing the entrance closes every path through it.
        //
        // `coyoteTime` is dropped as a statement about this line rather than as insurance. It
        // used to be left out on the argument that the gate above cannot see an open window —
        // deploying requires the air jump to be spent, and spending it zeroes the window. That
        // argument is true at `maxAirJumps` 1 and false at 0, where `canAirJump` is never
        // satisfied and the gate opens to a player who has just walked off a ledge with the
        // window full. Measured at that config, with nothing else changed: the window survived
        // the deploy, 120 glide frames and the stow, and a release then fired a 9.000 m/s
        // ground jump with the air jump untouched. Zeroing a documented config value is
        // supposed to degrade safely in this codebase, so the line is cheaper than the proof.
        coyoteTime: 0,
        jumpBuffer: 0,
      }
    } else {
      // Sampled with state.forward, which on foot is the flattened camera direction --
      // where the character faces. Ridge lift and rivers ask which way the sampler points,
      // so a falling player who turns to look along a river gets carried by it. The glider
      // asks the same question with its steered heading, after steerToward has run; that
      // sample stays where it is, because moving it would change which heading the glider
      // asks with and its flight is the most heavily tested behaviour here.
      const groundWind = deps.windAt ? deps.windAt(state.position, state.forward) : stillAir()
      next = groundStep(state, input, dt, deps.terrain, deps.ground, deps.collision, groundWind)
    }

    // Gated on next.mode, not state.mode: a press that lands on the same frame the
    // glider deploys must not start a swing here. stepStaff only ever advances from
    // this ground branch, so a swing begun on a deploy frame would freeze at
    // elapsed: 0 for the entire glide — staffBusy stuck true, since nothing steps it
    // down until landing returns the player to ground mode. Reading `state.mode`
    // instead would have missed exactly that frame, because the deploy branch above
    // runs while state.mode is still 'ground'.
    if (next.mode === 'ground') {
      // The staff steps only on foot — in the glider it IS the wing, so a press there
      // is dropped rather than queued for landing.
      const staff = stepStaff(staffOf(state), input.staffPressed, dt, deps.staff).state
      next = {
        ...next,
        staffChain: staff.chain, staffElapsed: staff.elapsed, staffRecovery: staff.recovery,
        staffSinceSwing: staff.sinceSwing,
      }
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
    const thrusting = input.forward > 0 && canBend(state, deps.flight)
    // Thrust wins when both are held. They are opposite intentions, and going
    // faster is the one a player is more likely to want mid-manoeuvre.
    const hovering = !thrusting && input.sprint && canBend(state, deps.flight)
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

    // Between the integrator and the landing probe, and the order is not arbitrary.
    // flightStep produces a destination; this resolves the path to it; only then does the
    // landing probe run, against the resolved position. Resolving after the landing check
    // would let a player land on the far side of a wall they should have hit.
    const cleared = resolveMovement(
      state.position, moved.position, moved.velocity, deps.terrain, deps.collision,
    )

    const effort = thrusting ? 'thrust' : hovering ? 'hover' : 'idle'
    const breath = stepBreath(state, effort, false, dt, deps.flight)

    next = {
      ...state, forward,
      position: cleared.position, velocity: cleared.velocity,
      breath: breath.breath, grounded: false,
    }

    const hit = raycastDown(deps.terrain, next.position, LANDING_PROBE)
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
        chargeTime: 0, coyoteTime: 0, jumpBuffer: 0,
        scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
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
    // Posture-aware: on foot the movement keys are walk and strafe, but in the glider
    // they are thrust and bank, so `dodgeHeading` reads only what means direction there.
    dodgeHeading(
      next.mode, next.forward, input.lookDirection, input.forward, input.strafe,
      // The same 0.6 flightStep uses to turn strafe into bank a few lines up. Not shared
      // through a constant because it doesn't read naturally as one here, but this is one
      // of three call sites carrying this literal -- the other two are `main.ts`'s
      // dodge-streak effect, which resolves the same dodge for drawing, and `flightStep`'s
      // own bank field above -- and all three are meant to move together if bank
      // responsiveness is ever retuned.
      input.strafe * 0.6,
    ),
    // Read after the posture branches, so this is the breath the branch settled: the
    // glider's drain from thrust or hover, or the ground branch's regeneration. A
    // pre-step value would let a player spend breath the same frame they ran out of it.
    next.breath,
    dt,
    deps.slipstream,
  )
  next = {
    ...next,
    slipstreamElapsed: slip.state.elapsed,
    slipstreamCooldown: slip.state.cooldown,
    velocity: slip.impulse ? next.velocity.clone().add(slip.impulse) : next.velocity,
    // Breath cannot go negative here — canSlipstream already refuses to fire below
    // c.breathCost, and the firing branch spends exactly that — but the clamp is the
    // safe answer if that gate and this deduction ever drift apart, because a negative
    // bar would read as a permanently unusable dodge.
    breath: Math.max(0, next.breath - slip.breathSpent),
  }

  return isFinitePlayer(next) ? next : safeRespawn(state, deps)
}
