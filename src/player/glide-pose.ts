import {
  AnimationClip, AnimationMixer, Quaternion, QuaternionKeyframeTrack,
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

/** Two keyframes holding the same value, so the clip has a usable duration. */
const TIMES = [0, 1]

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

  const pitch = pitchOnto(root, composed)

  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = []
  for (const [name, pose] of composed) {
    // Pitching the hips carries every descendant with it, so the whole body lies
    // down at once. Pre-multiplying rotates in the parent's space rather than the
    // bone's own, which is what makes this a world-axis pitch.
    const rotation = name === 'Hips'
      ? pitch.clone().multiply(pose.quaternion)
      : pose.quaternion
    const { x, y, z, w } = rotation
    tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, TIMES, [x, y, z, w, x, y, z, w]))

    // Only the hips translate in these clips; every other bone keeps its bind
    // position, so tracking them all would add tracks that never change.
    if (name === 'Hips') {
      const { x: px, y: py, z: pz } = pose.position
      tracks.push(new VectorKeyframeTrack(`${name}.position`, TIMES, [px, py, pz, px, py, pz]))
    }
  }

  if (tracks.length === 0) return null
  return new AnimationClip('glide', TIMES[1], tracks)
}
