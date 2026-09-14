import {
  AnimationClip, AnimationMixer, Euler, Quaternion, QuaternionKeyframeTrack,
  Vector3, VectorKeyframeTrack, type Object3D, type Bone,
} from 'three'
import { DEPLOYED_PITCH } from './glider'

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
 */
function pitchOnto(root: Object3D, composed: Map<string, BonePose>): Quaternion {
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

  // Where the body should point: the wing's own heading, nose tilted up.
  const target = new Vector3(0, Math.sin(DEPLOYED_PITCH), Math.cos(DEPLOYED_PITCH))
  return new Quaternion().setFromUnitVectors(axis, target)
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
 * No bob, unlike the fall's. Something is resting on this body: `glider.ts` sweeps
 * `DEPLOYED_POSITION.y` down until the wing touches the rider's back and leaves three
 * millimetres, and the wing hangs off the avatar root while the bob moves the model inside it.
 * A centimetre and a half of rise against three millimetres of clearance would push the back up
 * through the wing for half of every cycle. The roll and pitch stay because their vertical
 * excursion is far smaller and the swept height accounts for the worst of it.
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
export function buildGlideClip(root: Object3D, clips: AnimationClip[]): AnimationClip | null {
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

  return buildSwayedClip('glide', composed, pitchOnto(root, composed), GLIDE_SWAY)
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
