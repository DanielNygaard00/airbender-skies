import { Vector3 } from 'three'
import type { GroundConfig, InputState, PlayerState, TerrainQuery } from '../core/types'
import { stepJump } from './jump'
import { stepScooter, scooterSpeedMultiplier, scooterTurnAuthority } from './scooter'
import { stepDash } from './dash'
import { stepWallRide } from './wall-ride'
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
  // The ride that was running when the frame began. It keeps the scooter alive over a wall
  // the way the ground keeps it alive underfoot, and it is also what tells `stepWallRide`
  // below whether this frame is an entry or a continuation.
  const wasWallRiding = state.wallRideNormal !== null
  const scooter = stepScooter(
    { active: state.scooterActive, charge: state.scooterCharge },
    {
      toggle: input.scooterPressed, turn: input.strafe, moving, clipped: false,
      wallRiding: wasWallRiding,
    },
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
  // toward, rather than being treated as something the player asked for.
  //
  // A consequence of landing in `state.velocity` this way, worth knowing rather than
  // avoiding: next frame `easeHorizontal` blends whatever is sitting there back toward the
  // stick's desired velocity (zero with no input held), so the horizontal push does not
  // accumulate indefinitely -- it settles at a plateau of `accel / c.groundResponse`
  // (measured: 18.1623 for the 120 m/s^2 river below, against a nominal groundResponse of
  // 7), the fixed point of "push once, decay once" repeated every frame. The vertical
  // component has no such decay counterpart -- gravity's own term is undamped -- so it
  // integrates without bound instead, which is why a sustained updraft keeps climbing while
  // a sustained river settles into a fixed drift speed rather than accelerating forever.
  // The scooter's reduced turn authority cannot be part of that story either way: stepScooter
  // deactivates the scooter the instant the body leaves the ground, and wind here only ever
  // applies while airborne, so the two conditions never overlap.
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

  const candidate = new Vector3(horizontal.x, velocityY, horizontal.z)

  // Last, after everything else has settled the frame's velocity, because the ride's entry
  // probe is aimed along the line of travel and the line of travel is not known until the
  // ease, the dash and the wind have all run. `stepWallRide` corrects the gravity it
  // inherits rather than pre-empting it — see its own doc comment for why that is exact.
  //
  // Fed `scooter.active` and `scooter.charge`, this frame's values rather than last
  // frame's, so a scooter toggled off this frame ends the ride on the same frame the player
  // asked it to. That is the "or the player releases" exit: `Z` stows the ball, and the
  // ball is what was climbing.
  const wallRide = stepWallRide(
    state.wallRideNormal,
    { scooterActive: scooter.active, charge: scooter.charge, jumped: jump.jumped },
    state.position,
    candidate,
    dt,
    terrain,
    c,
  )
  const velocity = wallRide.velocity ?? candidate
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
    // Pinned while grounded, decaying while airborne, and zeroed by any jump. That one
    // rule is the whole of coyote time: it needs no "did I leave the ground this frame"
    // comparison, because the last grounded frame already left the window full -- and
    // zeroing it on a jump is what stops a ground jump being followed by a second one,
    // without which every jump would be a double jump for its first six frames.
    //
    // Both counters are written here rather than in `stepJump` because `stepJump` runs
    // before the ground probe and cannot know the authoritative `grounded`. Same split this
    // function already uses for `airJumpsUsed` one line up.
    coyoteTime: jump.jumped ? 0 : grounded ? c.coyoteSeconds : Math.max(0, state.coyoteTime - dt),
    // The decay reads `jump.jumpBuffer`, not `state.jumpBuffer`: `stepJump` may have just
    // armed it this frame, and reading the pre-frame value instead would decay a buffer that
    // was still zero when the frame began -- clamping it back to zero and losing the press
    // outright rather than merely one frame of it.
    jumpBuffer: jump.jumped ? 0 : Math.max(0, jump.jumpBuffer - dt),
    scooterActive: scooter.active,
    // Clamped at zero rather than allowed to go negative, for the same reason the
    // slipstream's breath deduction is: the accumulator is read as a fraction by the speed
    // multiplier, the turn authority and the Focus rate, and a negative one would make all
    // three lie. The ride reads the clamped value next frame and ends on it, so the drain's
    // last frame is allowed to overshoot and cost nothing.
    scooterCharge: Math.max(0, scooter.charge - wallRide.chargeSpent),
    wallRideNormal: wallRide.normal,
    dashesUsed: dash.state.used,
    dashRecovery: dash.state.recovery,
  }
}
