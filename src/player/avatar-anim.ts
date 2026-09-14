import type { GroundConfig, PlayerState } from '../core/types'
import { isCharging } from './jump'

export type AnimationName = 'idle' | 'walk' | 'run' | 'fall' | 'glide'

const WALK_THRESHOLD = 0.5
const RUN_THRESHOLD = 9
const FULL_CHARGE_SQUASH = 0.7

/**
 * How far the body rolls toward a wall it is riding, in radians, at full commitment.
 *
 * A third of the quarter turn that would lay the character flat against the rock. The full
 * quarter turn is what a purpose-made wall-run clip does, and `clip-map.ts` records that
 * the shipped model has no such clip — there are five, and the nearest is `run`, whose legs
 * drive downward. Laying that flat would put the feet out sideways with nothing under them.
 * A third of the way reads as leaning into the wall and leaves the run readable, which is
 * the trade a procedural pose over a borrowed clip is always making.
 */
const WALL_RIDE_LEAN = Math.PI / 6

/**
 * Which clip should be playing. Pure, so the state machine is testable without
 * a Three.js AnimationMixer.
 */
export function animationFor(state: PlayerState): AnimationName {
  if (state.mode === 'glider') return 'glide'
  // A wall ride is airborne by every other measure in the game — `grounded` is false, and
  // that is deliberate, because a wall is not footing — but `fall` is the one pose it must
  // not borrow. That clip is the model's `Jump`, limbs out and knees up, which is precisely
  // what a rider driving up a face is not doing. `run` is the honest choice of the five the
  // model has: the legs are working, and `wallRideLean` below rolls the whole body into the
  // rock so the run reads as going up it rather than along it. Checked before `grounded`,
  // so this cannot be reordered into a no-op.
  if (state.wallRideNormal !== null) return 'run'
  if (!state.grounded) return 'fall'
  const horizontal = Math.hypot(state.velocity.x, state.velocity.z)
  if (horizontal < WALK_THRESHOLD) return 'idle'
  return horizontal >= RUN_THRESHOLD ? 'run' : 'walk'
}

/**
 * How fast the walk or run cycle should play, as a multiple of its authored speed.
 *
 * Without this the cycle runs at one rate whatever the player is doing, and `walk` covers
 * everything from `WALK_THRESHOLD`'s 0.5 m/s to `RUN_THRESHOLD`'s 9 — an eighteen-fold span of
 * real speed set to a single stride rate. The feet slide the whole way across it: far too fast
 * at a crawl, far too slow at a near-sprint, and correct at exactly one speed nobody holds. That
 * mismatch is what reads as movement being disconnected from the ground.
 *
 * Derived from the config the movement itself uses rather than tuned by eye, the same way
 * `windUpTimeScale` derives a soldier's telegraph speed: `walkSpeed` and `runSpeed` are what the
 * controller accelerates toward, so a clip played at `speed / walkSpeed` runs at its authored
 * rate exactly when the player is walking at walking pace. Nothing here needs revisiting when the
 * movement is retuned.
 *
 * Clamped at both ends, and the lower one matters more. A player easing off the stick passes
 * through arbitrarily small speeds on the way to `idle`, and an unclamped ratio would drag the
 * cycle towards a frame-by-frame slideshow before the idle cross-fade took over — trading
 * skating for something worse. The upper clamp is the cheaper guard: the only ways past it are a
 * boost or a slope, and a cycle running at nearly twice speed already reads as scrambling.
 */
const MIN_RATE = 0.35
const MAX_RATE = 1.8

export function locomotionRate(state: PlayerState, c: GroundConfig): number {
  const name = animationFor(state)
  // Every other state is a pose or a single-speed action: a glide has no stride to match, and
  // `fall` is a held frame whose rate is meaningless.
  if (name !== 'walk' && name !== 'run') return 1

  const reference = name === 'walk' ? c.walkSpeed : c.runSpeed
  // A zero or missing reference would divide the rate to infinity rather than fail visibly.
  if (!(reference > 0)) return 1

  const speed = Math.hypot(state.velocity.x, state.velocity.z)
  return Math.min(MAX_RATE, Math.max(MIN_RATE, speed / reference))
}

/** Vertical crouch while charging a jump. 1 = full height. */
export function chargeSquashScale(state: PlayerState, c: GroundConfig): number {
  if (!state.grounded || !isCharging(state.chargeTime, c)) return 1
  const t = Math.min(state.chargeTime, c.chargeMaxSeconds) / c.chargeMaxSeconds
  return 1 - (1 - FULL_CHARGE_SQUASH) * t
}

/**
 * Roll toward a wall being ridden, in radians about the character's own forward axis, and 0
 * when there is no ride. Positive rolls the head toward the character's right.
 *
 * Scaled by which side the wall is on rather than snapped to a fixed angle, and that is the
 * whole reason this is a function of the normal instead of a constant. A wall dead ahead —
 * the square hit that buys the most climb — gets no roll at all, because the body should
 * pitch into that one, not tip sideways; a wall being skimmed along at a glancing angle gets
 * the full lean. Everything between is continuous, so sliding around a curved face rolls the
 * body through it rather than popping between two poses.
 *
 * The sign is derived, not guessed. `main.ts` orients the avatar with
 * `Object3D.lookAt`, which aligns local +Z with the heading, so the character's own right is
 * `forward × up` = `(-forward.z, 0, forward.x)`, and a positive rotation about local +Z
 * carries local up toward local -X, which is that right. The wall lies along `-normal`, so
 * its component on that right axis is `-(normal · right)`, and rolling by that much tips the
 * head onto the rock. `avatar-anim.test.ts` pins both sides of it against the same `lookAt`
 * three.js actually performs, rather than against this paragraph.
 *
 * No smoothing here on purpose. This is a pure read of one frame's state, and the smoothing
 * belongs where the frame time lives — see the exponential blend at the call site in
 * `main.ts`, which is what keeps the lean framerate-independent.
 */
export function wallRideLean(state: PlayerState): number {
  const normal = state.wallRideNormal
  if (normal === null) return 0
  // Not normalised. `isRidableWall` has already bounded |normal.y| below `wallRideNormalY`
  // 0.25, so the horizontal part of a unit normal is at least 0.968 long, and treating it as
  // unit-length costs at most 3% of the lean angle — well under a degree.
  const side = -(normal.x * -state.forward.z + normal.z * state.forward.x)
  return WALL_RIDE_LEAN * Math.max(-1, Math.min(1, side))
}
