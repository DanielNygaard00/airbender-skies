import type { Vector3 } from 'three'
import type { PlayerHit } from '../combat/encounter'

/**
 * How long a hit mark lingers, in seconds.
 *
 * Long enough to read and turn toward, short enough that a sustained fight does not
 * leave a permanent ring of marks. An argued guess, not measured.
 */
export const HIT_MARK_SECONDS = 1.2

/**
 * Where a hit sits relative to where the camera is looking, as a turn in radians:
 * 0 is dead ahead, positive is clockwise on screen, ±π is directly behind.
 *
 * Computed horizontally — the flattened camera forward against the flattened vector
 * from player to source — so a hit from directly above or below still has a bearing
 * worth drawing instead of a NaN from a vertical-only offset. The vertical drop of
 * the source is deliberately not part of the answer: the mark is a horizontal wedge,
 * not a 3D pointer.
 */
export function bearingFromCamera(
  cameraForward: Vector3, playerPosition: Vector3, from: Vector3,
): number {
  const dx = from.x - playerPosition.x
  const dz = from.z - playerPosition.z
  const sourceDistance = Math.hypot(dx, dz)
  // A source with no horizontal offset from the player — directly overhead or
  // underfoot — has no horizontal direction to report. Dead ahead rather than
  // normalising (0, 0) into NaN, the same guard shape `inCone` uses for the same
  // reason.
  if (sourceDistance < 1e-6) return 0

  const fx = cameraForward.x
  const fz = cameraForward.z
  const forwardDistance = Math.hypot(fx, fz)
  // A camera pitched straight up or down flattens to nothing horizontal to compare
  // against. "Ahead" is itself undefined then, so dead ahead is as good an answer as
  // any, and the only one that is not a NaN.
  if (forwardDistance < 1e-6) return 0

  // Dividing by the two distances here is for readability, not correctness: atan2
  // is invariant under scaling both of its arguments by the same positive factor,
  // and `sourceDistance` / `forwardDistance` are only ever used as divisors of both
  // the x and z component of their own vector, so the unnormalised dx/dz and fx/fz
  // would produce the identical angle below. Do not "optimise" this away — the
  // guards above are what actually do the work, this is just so the two vectors
  // being compared read as the unit directions they conceptually are.
  const ux = dx / sourceDistance
  const uz = dz / sourceDistance
  const vx = fx / forwardDistance
  const vz = fz / forwardDistance

  // Signed angle from the forward direction to the source direction, both flattened
  // to the xz plane. The cross term's sign is chosen so that a source to the world
  // side matching `forward × up` (i.e. the camera's screen-right) comes out positive
  // — verified against three.js's own default camera orientation (forward -Z, up
  // +Y, right +X) in the committed test below, rather than assumed.
  return Math.atan2(vx * uz - vz * ux, vx * ux + vz * uz)
}

/** A hit's remembered screen bearing, fading out over `HIT_MARK_SECONDS`. */
export interface HitMark {
  bearing: number
  life: number
}

/**
 * Advance every mark by `dt` and drop the ones that have fully faded.
 *
 * Deliberately does not touch `bearing`. A mark records the direction a hit came
 * from at the moment it landed; recomputing it every frame against the camera's
 * current heading is the instinct and it is the wrong one — it would drag the wedge
 * around as the player turns, instead of leaving it behind, which is what makes
 * turning toward it feel like it worked.
 */
export function stepHitMarks(marks: readonly HitMark[], dt: number): HitMark[] {
  return marks
    .map((mark) => ({ bearing: mark.bearing, life: mark.life - dt }))
    .filter((mark) => mark.life > 0)
}

/** Turns a reported hit into a mark, fixing its bearing at the moment of impact. */
export function markFor(
  cameraForward: Vector3, playerPosition: Vector3, hit: PlayerHit,
): HitMark {
  return {
    bearing: bearingFromCamera(cameraForward, playerPosition, hit.from),
    life: HIT_MARK_SECONDS,
  }
}
