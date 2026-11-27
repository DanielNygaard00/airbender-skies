import {
  AnimationClip, AnimationMixer, Euler, MathUtils, Quaternion, QuaternionKeyframeTrack,
  Vector3, VectorKeyframeTrack, type Object3D, type Bone,
} from 'three'
import { DEPLOYED_PITCH, DEPLOYED_POSITION } from './glider'
import { BONES } from './rig'

/**
 * Stock character packs ship no gliding animation, and freezing a frame of the
 * jump clip reads as a mid-air crouch rather than flight. No single frame of
 * this model works either: nothing in it raises both arms above the shoulders
 * while the legs are together.
 *
 * So the glide pose is composed from two frames instead — arms from one clip,
 * legs from another — and baked into a constant clip. Being an ordinary clip, it
 * cross-fades like any other, and `glide` stops sharing an action with `fall`.
 */

/**
 * Bones taken from the settled source. Everything else takes the upper-body one.
 *
 * The waist down, plus the two nodes above the hips that carry the character
 * rather than pose it. `Root` and `Body` are in here for a different reason from
 * the legs, and it is the reason this is no longer just a waist test: the upper
 * source is now a clip that travels. Sampling `Root` 30% into a roll would bake
 * that roll's displacement into the pose, and because the composed clip writes
 * position tracks as well as rotations, the glider would fly with the character
 * permanently shunted off the harness. The settled source is standing still, so
 * taking the carrying nodes from it contributes no translation at all.
 *
 * This was free with the previous model — its upper source was 5% into a punch,
 * where nothing had moved yet — which is exactly why it is worth naming now.
 */
const LOWER_BODY = /Leg|Foot|Toe|Hips|^Root$|^Body$/

/**
 * The bone that carries the whole character, and the one every attitude here is applied to.
 *
 * `Root`, not `Hips`, and the difference is not cosmetic. This rig does not hang the body off
 * its hips the way a Mixamo-style skeleton does: `Foot.L`, `Foot.R` and the two `PoleTarget`
 * bones are children of `Root` (they are IK targets), `UpperLeg.L` and `UpperLeg.R` are children
 * of `Body`, and `Hips` carries only the spine upward — Abdomen, Torso, Neck, Head and the arms.
 *
 * So a rotation applied at `Hips` lays the *torso* down and leaves the legs standing exactly
 * where they were, with the feet not moving at all. That is what the glide pose did when this
 * module was first pointed at this model, and no test caught it: the pitch is asserted by
 * measuring the Hips-to-Head axis, which is precisely the part that does rotate.
 *
 * `Root` is the only node above all three of the spine, the legs and the IK targets, so it is
 * the only one whose rotation moves the entire character as one piece.
 */
const CARRIER = 'Root'

/**
 * Pitch laid onto the hips so the rider hangs flat beneath the wing rather than
 * dangling upright from it. A quarter turn would be dead level; backing off by
 * the wing's own nose-up tilt leaves the body parallel to it, so the two read as
 * one object in flight.
 *
 * Applied about world X, which is valid because the armature node carries no
 * rotation of its own — the hips' parent space is world-aligned.
 */
const GLIDE_PITCH = Math.PI / 2 - DEPLOYED_PITCH

/**
 * Where each half of the pose comes from, best first, matched against clip names
 * the way clip-map matches them. The fractions are positions within the clip,
 * measured against the shipped model: 30% into `Roll` is the moment the arms are
 * thrown forward ahead of the body, and the start of `Idle` has the legs
 * straightest and closest together (knees 156 degrees each, feet 0.42 apart).
 * A model whose clips are timed differently would want its own numbers.
 *
 * `roll` and `idle` lead the fallbacks because of what this pack actually
 * contains. It ships no airborne clip at all, so the arms have to be borrowed
 * from a ground move, and `Roll` is the only one that puts them out in front:
 * measured along the body's own axis, the hand sits 0.51 towards the head end at
 * 30%, against 0.28 for `Attack` and 0.18 for `Idle_Attacking`. `punch` and
 * `walk` stay in the lists behind them because they are what the previous model
 * used and cost nothing to keep — the same alias-list pattern `clip-map.ts` uses,
 * where a name that matches nothing is simply skipped.
 *
 * `idle` is ahead of `walk` on purpose rather than appended: this model's `Walk`
 * has the legs apart at every fraction (feet 1.09 at 60%, against `Idle`'s 0.42),
 * so a list that tried `walk` first would compose a gliding character in mid
 * stride.
 */
const UPPER_SOURCES = ['glide', 'gliding', 'fly', 'flying', 'roll', 'punch'] as const
const LOWER_SOURCES = ['glide', 'gliding', 'fly', 'flying', 'idle', 'walk'] as const
const UPPER_FRACTION = 0.3
const LOWER_FRACTION = 0

/**
 * The slow bank and bob the rider rides the wing with.
 *
 * The composed pose used to be two identical keyframes — a clip in name only, holding one
 * attitude for as long as the player stayed airborne. In a game whose central activity is
 * gliding that is most of the time on screen, and a rider who never moves reads as a model
 * hanging off the wing rather than a person flying it. The wing itself has had life the whole
 * time: `glider.ts` shudders it on a stall and swings it on a turn. Only the body was still.
 *
 * So the clip now loops a gentle bank with a bob under it. Both are deliberately tiny — under
 * three degrees of roll and a centimetre and a half of rise — because the job is to stop the
 * silhouette being frozen, not to add a motion the player has to read. Anything large enough to
 * notice as an animation would compete with the wing's own stall shudder, which is a real tell.
 *
 * **Every offset is zero at t = 0**, which is what lets the pose the rest of this module
 * composes stay exactly the pose that gets measured. `glide-pose.test.ts` samples at time zero,
 * so the parallel-to-the-wing pitch and the prone body axis are asserted against the composed
 * attitude itself rather than against some point part-way through a sway.
 *
 * The pitch runs at double the roll's frequency so the two do not simply trace one diagonal
 * line back and forth; the body drifts through a shallow figure instead, which is what stops a
 * short loop reading as a loop.
 */
const SWAY_SECONDS = 3.6
const SWAY_ROLL = 0.045
const SWAY_PITCH = 0.022
const SWAY_BOB = 0.015
/**
 * Samples around the cycle. Nine is four per roll half-cycle plus the closing duplicate, which
 * is enough for three.js's own interpolation to round a sine off smoothly — the motion is slow
 * and small, so the error between samples is far below what the amplitudes themselves are.
 */
const SWAY_SAMPLES = 9

const TIMES = Array.from(
  { length: SWAY_SAMPLES },
  (_, i) => (i / (SWAY_SAMPLES - 1)) * SWAY_SECONDS,
)

function baseName(clipName: string): string {
  const segments = clipName.split('|')
  return (segments[segments.length - 1] ?? '').trim().toLowerCase()
}

function firstMatch(clips: AnimationClip[], wanted: readonly string[]): AnimationClip | null {
  for (const name of wanted) {
    const hit = clips.find((clip) => baseName(clip.name) === name)
    if (hit) return hit
  }
  return null
}

type BonePose = { quaternion: Quaternion; position: Vector3 }

/**
 * Read every bone's local transform at one instant of a clip. This poses the
 * model as a side effect, so callers must not measure it afterwards expecting
 * the bind pose.
 */
function sampleBones(root: Object3D, clip: AnimationClip, fraction: number): Map<string, BonePose> {
  const mixer = new AnimationMixer(root)
  mixer.clipAction(clip).play()
  // setTime(0) first, so the action is evaluated from a known point rather than
  // from whatever the previous sample left behind.
  mixer.setTime(0)
  mixer.setTime(clip.duration * fraction)

  const pose = new Map<string, BonePose>()
  root.traverse((node) => {
    if ((node as Bone).isBone) {
      pose.set(node.name, { quaternion: node.quaternion.clone(), position: node.position.clone() })
    }
  })
  mixer.stopAllAction()
  return pose
}

/**
 * The rotation that lays the composed pose parallel to the wing.
 *
 * Measured rather than assumed. A fixed quarter turn leaves the body wherever the
 * source pose's own spine lean puts it — the composed pose sits about six degrees
 * off — so this reads the pose's actual hips-to-head axis and computes the
 * rotation that carries it onto the wing's heading. That keeps the result correct
 * if either source frame is retuned, or if the model is replaced.
 *
 * Falls back to a plain pitch when the rig lacks the bones to measure.
 *
 * **Three spaces meet here, and the function used to treat them as one.** The body's axis is
 * measured from bone world positions. The wing's heading is a fact about the avatar: "forward and
 * nose-up" means the avatar's forward, whichever way the player happens to be facing. And the
 * rotation returned is pre-multiplied onto the carrier bone's *local* quaternion, so it has to be
 * stated in the carrier's parent's frame. The earlier version compared a world axis against an
 * avatar-local heading and handed the answer back as if it were local, which is right only when
 * the avatar faces down world +Z — exactly where every test stands it.
 *
 * In the game the avatar is already turned by the time the model finishes loading. At the spawn
 * heading it faces world -Z, the rotation came out a half turn wrong, and the rider was baked
 * lying the wrong way along the wing with the hands solved toward a bar that was not there:
 * measured in the live game, 0.65 from the staff, against 0.013 for the same model baked facing
 * +Z and turned afterwards.
 */
function pitchOnto(
  root: Object3D, composed: Map<string, BonePose>, avatarSpace: Object3D,
): Quaternion {
  const fixed = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), GLIDE_PITCH)

  const hips = root.getObjectByName('Hips')
  const head = root.getObjectByName('Head')
  if (!hips || !head) return fixed

  for (const [name, pose] of composed) {
    const bone = root.getObjectByName(name)
    if (bone) bone.quaternion.copy(pose.quaternion)
  }
  root.updateMatrixWorld(true)

  const axis = head.getWorldPosition(new Vector3())
    .sub(hips.getWorldPosition(new Vector3()))
    .normalize()
  if (axis.lengthSq() < 1e-6) return fixed

  // Where the body should point: the wing's own heading, nose tilted up -- in the avatar's
  // frame, carried into world space to meet the axis it is compared against.
  const target = new Vector3(0, Math.sin(DEPLOYED_PITCH), Math.cos(DEPLOYED_PITCH))
    .applyQuaternion(avatarSpace.getWorldQuaternion(new Quaternion()))
  const turn = new Quaternion().setFromUnitVectors(axis, target)

  // Restated in the carrier's parent frame: the caller multiplies this onto the carrier's local
  // quaternion, so a world-space turn R becomes P^-1 R P for a parent whose world rotation is P.
  const parent = root.getObjectByName(CARRIER)?.parent
  const frame = parent ? parent.getWorldQuaternion(new Quaternion()) : new Quaternion()
  return frame.clone().invert().multiply(turn).multiply(frame)
}

/**
 * How the body drifts while a composed pose is held, so the rider is never a frozen model.
 *
 * The two states want different motion, which is why this is a parameter rather than a
 * constant. A glide is sustained and serene — the wing is carrying its weight, so the body
 * banks slowly through a long cycle. A fall is neither: nothing is supporting the character,
 * air is going past faster, and it lasts seconds rather than minutes. So the fall's cycle is
 * under half the glide's length with a little more angle in it, which reads as being buffeted
 * rather than riding.
 */
interface Sway {
  seconds: number
  roll: number
  pitch: number
  bob: number
}

/**
 * No bob, unlike the fall's. The rider's hands are on the staff, and the staff hangs off the
 * avatar root while the bob moves the model inside it: a centimetre and a half of rise would lift
 * both fists off the bar and back onto it every cycle, against a grip measured to about one. (This
 * used to argue from the wing resting on the rider's back, which is how the glider sat before the
 * rider held it.) The roll and pitch stay because their excursion at the hands is far smaller.
 */
const GLIDE_SWAY: Sway = {
  seconds: SWAY_SECONDS,
  roll: SWAY_ROLL,
  pitch: SWAY_PITCH,
  bob: 0,
}

/**
 * The fall's own drift. Faster and slightly wider than the glide's, and with barely any bob:
 * a rising-and-falling body reads as floating, which is the one thing a fall must not look
 * like. Nearly all of the motion is angle instead.
 */
const FALL_SWAY: Sway = {
  seconds: 1.4,
  roll: 0.06,
  pitch: 0.035,
  bob: 0.008,
}

/**
 * Turn a composed pose into a looping clip that holds every joint angle and drifts the body.
 *
 * The sway is applied at the hips and nowhere else, and that is what makes it safe: rotating
 * the root of a skeleton changes the body's attitude in the world without altering a single
 * joint angle below it. So whatever the pose was composed to achieve — straight knees, closed
 * feet, raised hands — survives the motion exactly, and no caller has to re-check its own
 * geometry after asking for life. Animating the limbs instead would be re-authoring the pose
 * several times a second.
 *
 * Every offset is zero at t = 0, so the pose that gets measured is the pose that was composed.
 */
function buildSwayedClip(
  name: string,
  composed: Map<string, BonePose>,
  pitch: Quaternion | null,
  sway: Sway,
): AnimationClip | null {
  const times = Array.from(
    { length: SWAY_SAMPLES },
    (_, i) => (i / (SWAY_SAMPLES - 1)) * sway.seconds,
  )

  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = []
  for (const [boneName, pose] of composed) {
    // Pitching the hips carries every descendant with it, so the whole body lies
    // down at once. Pre-multiplying rotates in the parent's space rather than the
    // bone's own, which is what makes this a world-axis pitch. A fall passes null:
    // the pose it samples is already the attitude it wants.
    const rotation = boneName === CARRIER && pitch
      ? pitch.clone().multiply(pose.quaternion)
      : pose.quaternion

    const values: number[] = []
    for (const time of times) {
      const turn = (time / sway.seconds) * Math.PI * 2
      const swayed = boneName === CARRIER
        ? new Quaternion()
          .setFromEuler(new Euler(
            sway.pitch * Math.sin(turn * 2),
            0,
            sway.roll * Math.sin(turn),
          ))
          // In the parent's space, on the outside of the world-axis pitch, for the reason the
          // pitch itself is pre-multiplied: these are attitudes in the world, not twists of
          // the bone about its own axes.
          .multiply(rotation)
        : rotation
      values.push(swayed.x, swayed.y, swayed.z, swayed.w)
    }
    tracks.push(new QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values))

    // A position track for *every* bone, not just the hips. This used to write one for the
    // hips alone, on the stated grounds that nothing else translates — which was true of the
    // model this module was written against and is false of the one here: its clips animate
    // translation, rotation and scale on all 32 bones. Dropping the other 31 quietly rebuilt
    // each pose with every bone back at its bind offset, which costs almost nothing for a pose
    // sampled near the rest position and wrecks one sampled mid-motion. It is why the fall's
    // tuck came back with the knee at 93 degrees instead of 52.
    const { x: px, y: py, z: pz } = pose.position
    const positions: number[] = []
    for (const time of times) {
      const turn = (time / sway.seconds) * Math.PI * 2
      // The bob rides on the carrier only: it is the body rising, not every joint drifting.
      const bob = boneName === CARRIER ? sway.bob * Math.sin(turn * 2) : 0
      positions.push(px, py + bob, pz)
    }
    tracks.push(new VectorKeyframeTrack(`${boneName}.position`, times, positions))
  }

  if (tracks.length === 0) return null
  return new AnimationClip(name, sway.seconds, tracks)
}

/**
 * Build the glide pose for a model that has no glide clip of its own. Returns
 * null when neither source clip is present, leaving the caller on its fallback.
 */
/**
 * How far apart the hands grip the staff, each side of its centre, in avatar units.
 *
 * A shoulder-width grip on a 1.9-unit staff, which leaves most of the span either side of the
 * hands — a rider holding a control bar at its very ends looks like they are being carried by it
 * rather than steering it.
 */
const GRIP_HALF_SPAN = 0.22

/**
 * Where the hands have to end up, in avatar-local space.
 *
 * Avatar-local, and every caller has to convert before using it — see `inAvatarSpace`.
 *
 * Read off `DEPLOYED_POSITION` rather than written out again, which matters more here than it
 * usually does: that constant has already moved three times — 1.19, then 0.892, then 0.664, each
 * time because the rider's shape changed underneath it — and a copy of the number in this file
 * would have been wrong after the first of those and silently so. The staff is laid along the
 * glider's local X and the deployed tilt is a rotation *about* X, so a point on the staff's axis
 * is unmoved by that tilt and the target is simply the glider's own position offset sideways.
 */
function gripTarget(side: number): Vector3 {
  return new Vector3(
    DEPLOYED_POSITION.x + side * GRIP_HALF_SPAN, DEPLOYED_POSITION.y, DEPLOYED_POSITION.z,
  )
}

/**
 * Carry an avatar-local point into world space.
 *
 * This exists because its absence was the whole bug, and the bug was invisible in every test.
 *
 * The staff's position is stated in the avatar's own space: `glider.ts` hangs off
 * `avatar.object`, so `DEPLOYED_POSITION` means "this far in front of the character", not "this
 * point in the world". The bones, meanwhile, report world positions. Feeding one to the other
 * reads an avatar-local target as a world one, which is the *same number* whenever the avatar
 * happens to be standing at the world origin — which is exactly where every unit test puts it,
 * and nowhere the game ever does.
 *
 * So the pose solved perfectly in node and, in the running game, dragged the entire body from
 * the player's position at y 13.87 down to the world origin. The mesh was present, visible,
 * un-culled, with finite bone matrices and a valid material, and drew nothing anywhere near the
 * camera. It was diagnosed by reading bone world positions out of the live scene: the mesh node
 * at y 13.869 and its own skeleton at y 1.
 */
function inAvatarSpace(point: Vector3, avatarSpace: Object3D): Vector3 {
  avatarSpace.updateMatrixWorld(true)
  return avatarSpace.localToWorld(point.clone())
}

/** Turn a bone so the direction to `child` points along `aim`, given in world space. */
function aimBone(bone: Object3D, child: Object3D, aim: Vector3): void {
  const from = child.getWorldPosition(new Vector3())
    .sub(bone.getWorldPosition(new Vector3()))
  if (from.lengthSq() < 1e-12 || aim.lengthSq() < 1e-12) return
  from.normalize()

  // Built in world space and then carried back into the parent's, because a bone's own axes are
  // whatever the rigger left them as: this rig's arms do not run down any one local axis, so a
  // rotation authored in bone space would need a per-bone convention nothing here can know.
  const turn = new Quaternion().setFromUnitVectors(from, aim.clone().normalize())
  const world = turn.multiply(bone.getWorldQuaternion(new Quaternion()))
  const parent = bone.parent
    ? bone.parent.getWorldQuaternion(new Quaternion()).invert()
    : new Quaternion()
  bone.quaternion.copy(parent.multiply(world))
  bone.updateMatrixWorld(true)
}

/**
 * Bend a two-bone chain so its end lands on `target`.
 *
 * The ordinary analytic solve: the two bone lengths and the distance to the target give the
 * angle at the shoulder by the law of cosines, and `pole` picks which way the elbow breaks out
 * of the infinitely many solutions that circle the shoulder-to-target line.
 *
 * The target is clamped inside the arm's own reach rather than left to produce a `NaN` from an
 * out-of-domain `acos`. An unreachable target is not a failure case to guard against here, it is
 * the *normal* one: the staff sits where the glider put it and the arm is as long as the model
 * makes it, so the honest answer for a rider who cannot quite reach is a fully extended arm
 * pointing at the bar, which is exactly what the clamp produces.
 */
function reachTo(
  upper: Object3D, lower: Object3D, end: Object3D, target: Vector3, pole: Vector3,
): void {
  const shoulder = upper.getWorldPosition(new Vector3())
  const elbow = lower.getWorldPosition(new Vector3())
  const hand = end.getWorldPosition(new Vector3())

  const upperLength = elbow.distanceTo(shoulder)
  const lowerLength = hand.distanceTo(elbow)
  if (upperLength < 1e-6 || lowerLength < 1e-6) return

  const toTarget = target.clone().sub(shoulder)
  const distance = MathUtils.clamp(
    toTarget.length(),
    Math.abs(upperLength - lowerLength) + 1e-4,
    upperLength + lowerLength - 1e-4,
  )
  if (toTarget.lengthSq() < 1e-12) return
  const direction = toTarget.clone().normalize()

  const cosShoulder = MathUtils.clamp(
    (upperLength * upperLength + distance * distance - lowerLength * lowerLength)
    / (2 * upperLength * distance),
    -1, 1,
  )

  // The bend plane. Degenerate when the pole happens to lie along the reach, which a fixed pole
  // eventually will, so fall back to any perpendicular rather than producing a zero axis.
  let axis = new Vector3().crossVectors(direction, pole)
  if (axis.lengthSq() < 1e-8) axis = new Vector3().crossVectors(direction, new Vector3(0, 0, 1))
  if (axis.lengthSq() < 1e-8) axis = new Vector3(1, 0, 0)
  axis.normalize()

  const elbowDirection = direction.clone()
    .applyQuaternion(new Quaternion().setFromAxisAngle(axis, Math.acos(cosShoulder)))

  aimBone(upper, lower, elbowDirection)
  // Re-read the elbow: aiming the upper arm has just moved it.
  const bentElbow = lower.getWorldPosition(new Vector3())
  aimBone(lower, end, target.clone().sub(bentElbow))
}

/** Put a bone at a world position, expressed in whatever space its parent uses. */
function placeBoneAt(bone: Object3D, world: Vector3): void {
  const parent = bone.parent
  bone.position.copy(parent ? parent.worldToLocal(world.clone()) : world)
  bone.updateMatrixWorld(true)
}

/**
 * Point a foot along the leg, the way a body held in a line points its toes.
 *
 * Straightening the legs leaves each foot at the standing pose's right angle to the shin, and on
 * a prone body that right angle aims the boots straight at the ground: in the live game the rider
 * flew with a straight body and two feet hanging off the end of it like a figure standing on a
 * wall. This rig has no toe bone to aim, so the toe's direction is taken as the part of the
 * avatar's "down" that is square to the leg — which is where a foot perpendicular to a horizontal
 * shin points — and the foot is turned about the ankle until that direction runs along the leg.
 */
function pointToes(foot: Object3D, along: Vector3, belly: Vector3): void {
  const toe = belly.clone().addScaledVector(along, -belly.dot(along))
  if (toe.lengthSq() < 1e-8) return
  const turn = new Quaternion().setFromUnitVectors(toe.normalize(), along)
  const world = turn.multiply(foot.getWorldQuaternion(new Quaternion()))
  const parent = foot.parent
    ? foot.parent.getWorldQuaternion(new Quaternion()).invert()
    : new Quaternion()
  foot.quaternion.copy(parent.multiply(world))
  foot.updateMatrixWorld(true)
}

/**
 * Put the rider's hands on the staff and straighten the lower body into a plank.
 *
 * Everything above this point composes the glide pose out of frames the character pack happens
 * to contain, which is what a pack with no gliding clip allows. It got the body prone and the
 * arms roughly forward, and it could never do more than that: the arms ended wherever `Roll`'s
 * thirtieth percentile left them, and the staff ended wherever `glider.ts` put it, and nothing
 * made those two agree. The rider flew alongside their glider rather than on it.
 *
 * So the arms are solved rather than sampled. The hands are placed on the staff by an ordinary
 * two-bone reach, which means they stay on it if the staff moves — and the staff has moved three
 * times already.
 *
 * The legs are straightened along the body's own axis instead of being left at the standing
 * pose's 156-degree knees. A glider rider holds a line from shoulder to heel; 156 degrees is a
 * gentle crouch, which reads at distance as sitting in mid-air.
 *
 * **The feet need moving as well as the shins turning, and that is this rig rather than a
 * mistake.** `Foot.L` and `Foot.R` are children of `Root` — they are IK targets, not the ends of
 * the leg chains — so straightening a knee leaves the foot exactly where it was and the ankle
 * pulls away from it. They are repositioned onto the end of each straightened shin, which the
 * clip can carry because `buildSwayedClip` now writes a position track for every bone.
 *
 * Works on the live scene graph and reads the result back, the way `pitchOnto` already does: the
 * whole module poses these bones destructively and bakes what it finds, and `sampleBones` carries
 * that warning for callers.
 */
function gripTheGlider(
  root: Object3D, composed: Map<string, BonePose>, avatarSpace: Object3D,
): void {
  // The composed pose has to be standing in the bones before anything can be solved against it:
  // an IK solve reads world positions, and those are meaningless until the pose is applied.
  for (const [name, pose] of composed) {
    const bone = root.getObjectByName(name)
    if (!bone) continue
    bone.quaternion.copy(pose.quaternion)
    bone.position.copy(pose.position)
  }
  root.updateMatrixWorld(true)

  /*
   * No unit conversion, and the absence is the point.
   *
   * The obvious reading is that a target expressed in the game's space has to be scaled into the
   * model's, because the avatar fits whatever model loads to a fixed height and this one takes a
   * factor of about 0.62. That reading is wrong here, and measurably so: by the time this runs,
   * `attachModel` has already parented the model inside the fitted wrapper, so every
   * `getWorldPosition` below reports a position that has *been* through the fit. Dividing the
   * target by the scale as well pushed the grip 1.6 times too far out, and the solve then reached
   * it exactly — hands a third of a unit clear of the staff, with nothing failing anywhere.
   */

  const hips = root.getObjectByName(BONES.hips)
  const head = root.getObjectByName(BONES.head)
  const carrier = root.getObjectByName(CARRIER)

  /*
   * The body is left where the composed pose put it, and `glider.ts` carries the staff to meet
   * the hands instead of the body being moved to meet the staff.
   *
   * Moving the body was tried first, twice. It is the obvious approach — shift the rider back
   * along their own axis until the bar is inside arm's length — and it fails in a way worth
   * recording: the translation and the prone pitch fight each other, and the rider ends up
   * standing on the bar head-up rather than hanging behind it in a line. Solving the shift
   * against an axis measured before the shift, then reaching afterwards, is a small circular
   * dependency that a single pass does not settle.
   *
   * Placing the staff is better founded anyway. `DEPLOYED_POSITION` used to be swept against the
   * wing resting on the rider's back; now that the rider holds the bar, the grip is the thing
   * that constant should be derived from, and it is.
   */
  for (const [side, upperName, lowerName, handName] of [
    [-1, BONES.upperArmL, BONES.lowerArmL, BONES.handL],
    [1, BONES.upperArmR, BONES.lowerArmR, BONES.handR],
  ] as const) {
    const upper = root.getObjectByName(upperName)
    const lower = root.getObjectByName(lowerName)
    const hand = root.getObjectByName(handName)
    if (!upper || !lower || !hand) continue
    // Elbows break downward, which is how anyone holds a bar in front of them -- and for a rider
    // lying prone under a wing it is also the only direction with room.
    reachTo(
      upper, lower, hand, inAvatarSpace(gripTarget(side), avatarSpace), new Vector3(0, -1, 0),
    )
  }

  if (!hips || !head) return

  // Back along the body's own axis rather than along world -Z, so the legs stay in line with a
  // torso whose pitch is the wing's and not a constant.
  const along = head.getWorldPosition(new Vector3())
    .sub(hips.getWorldPosition(new Vector3()))
  if (along.lengthSq() < 1e-12) return
  const back = along.normalize().multiplyScalar(-1)
  // The avatar's own down, carried into world space: the side a prone rider's toes hang toward.
  const belly = new Vector3(0, -1, 0)
    .applyQuaternion(avatarSpace.getWorldQuaternion(new Quaternion()))

  for (const [upperName, lowerName, footName] of [
    [BONES.upperLegL, BONES.lowerLegL, BONES.footL],
    [BONES.upperLegR, BONES.lowerLegR, BONES.footR],
  ] as const) {
    const upper = root.getObjectByName(upperName)
    const lower = root.getObjectByName(lowerName)
    const foot = root.getObjectByName(footName)
    if (!upper || !lower || !foot) continue

    const ankleLength = foot.getWorldPosition(new Vector3())
      .distanceTo(lower.getWorldPosition(new Vector3()))

    aimBone(upper, lower, back)
    aimBone(lower, foot, back)

    // The ankle is now at the end of a straight leg; the foot bone is not, because it hangs off
    // `Root` rather than off the shin.
    placeBoneAt(
      foot,
      lower.getWorldPosition(new Vector3()).addScaledVector(back, ankleLength),
    )
    pointToes(foot, back, belly)
  }

  // Read the solved pose back out, so the clip is built from what was actually reached rather
  // than from what was sampled.
  for (const name of [...composed.keys()]) {
    const bone = root.getObjectByName(name)
    if (!bone) continue
    composed.set(name, {
      quaternion: bone.quaternion.clone(), position: bone.position.clone(),
    })
  }
}

export function buildGlideClip(
  root: Object3D, clips: AnimationClip[], avatarSpace: Object3D = root,
): AnimationClip | null {
  const upperSource = firstMatch(clips, UPPER_SOURCES)
  const lowerSource = firstMatch(clips, LOWER_SOURCES)
  if (!upperSource || !lowerSource) return null

  const upper = sampleBones(root, upperSource, UPPER_FRACTION)
  const lower = sampleBones(root, lowerSource, LOWER_FRACTION)

  const composed = new Map<string, BonePose>()
  for (const name of upper.keys()) {
    const pose = (LOWER_BODY.test(name) ? lower : upper).get(name)
    if (pose) composed.set(name, pose)
  }

  // The pitch is baked into the pose here rather than left for `buildSwayedClip` to apply, and
  // the order is the reason: the hands are solved onto a staff whose position is fixed in the
  // avatar's space, so the body has to already be lying down when the arms reach for it.
  // Solving first and pitching afterwards would rotate the solved arms off the bar by exactly
  // the angle of the pitch.
  const pitch = pitchOnto(root, composed, avatarSpace)
  const carrier = composed.get(CARRIER)
  if (carrier) {
    composed.set(CARRIER, {
      quaternion: pitch.clone().multiply(carrier.quaternion),
      position: carrier.position,
    })
  }

  gripTheGlider(root, composed, avatarSpace)

  // Null, because the pitch is already in the pose above.
  return buildSwayedClip('glide', composed, null, GLIDE_SWAY)
}

/**
 * Names a model might use for an airborne clip, best first — the same list `clip-map.ts`
 * resolves `fall` through, including the borrowed `roll` it falls back on.
 */
const FALL_SOURCES = ['fall', 'falling', 'jump', 'roll'] as const

/**
 * Build a living fall pose for a model whose `fall` is a held frame of a borrowed clip.
 *
 * The shipped pack has no airborne clip at all, so `fall` borrows a roll and freezes it at its
 * tuck — knees drawn up, which reads as bracing in mid-air. That was the right frame and the
 * wrong amount of life: frozen means the character drops the entire height of an island in one
 * unchanging attitude, the same statue problem the glide had and for the same reason.
 *
 * So the frame is sampled once and handed the sway treatment instead. `atSeconds` is where in
 * the source clip to take it, in seconds, so the caller's own freeze time stays the single
 * definition of which frame this is — passing a fraction would have meant two places knowing
 * that Roll is one second long. Clamped into the clip either way, because the freeze time was
 * chosen against a one-second borrow and a pack with a shorter one must not sample past its end.
 *
 * No pitch is applied, unlike the glide: a falling body wants the attitude the tuck already has,
 * not to be laid flat under a wing.
 */
export function buildFallClip(
  root: Object3D, clips: AnimationClip[], atSeconds: number,
): AnimationClip | null {
  const source = firstMatch(clips, FALL_SOURCES)
  if (!source || !(source.duration > 0)) return null

  const fraction = Math.min(1, Math.max(0, atSeconds / source.duration))
  const composed = sampleBones(root, source, fraction)
  if (composed.size === 0) return null

  return buildSwayedClip('fall', composed, null, FALL_SWAY)
}
