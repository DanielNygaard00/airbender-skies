import {
  AnimationClip, AnimationMixer, Quaternion, QuaternionKeyframeTrack,
  Vector3, VectorKeyframeTrack, type Object3D, type Bone,
} from 'three'

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

/** Bones from the waist down. Everything else takes the upper-body source. */
const LOWER_BODY = /Leg|Foot|Toe|Hips/

/**
 * Where each half of the pose comes from, best first, matched against clip names
 * the way clip-map matches them. The fractions are positions within the clip,
 * measured against the shipped model: 5% into `Punch` is its wind-up, with both
 * hands up near the head and the legs straight, and 60% into `Walk` has the legs
 * together and nearly straight (knees 161 degrees and 140 degrees, feet 0.96
 * apart). A model whose clips are timed differently would want its own numbers.
 */
const UPPER_SOURCES = ['glide', 'gliding', 'fly', 'flying', 'punch'] as const
const LOWER_SOURCES = ['glide', 'gliding', 'fly', 'flying', 'walk'] as const
const UPPER_FRACTION = 0.05
const LOWER_FRACTION = 0.6

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
 * Build the glide pose for a model that has no glide clip of its own. Returns
 * null when neither source clip is present, leaving the caller on its fallback.
 */
export function buildGlideClip(root: Object3D, clips: AnimationClip[]): AnimationClip | null {
  const upperSource = firstMatch(clips, UPPER_SOURCES)
  const lowerSource = firstMatch(clips, LOWER_SOURCES)
  if (!upperSource || !lowerSource) return null

  const upper = sampleBones(root, upperSource, UPPER_FRACTION)
  const lower = sampleBones(root, lowerSource, LOWER_FRACTION)

  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = []
  for (const name of upper.keys()) {
    const pose = (LOWER_BODY.test(name) ? lower : upper).get(name)
    if (!pose) continue

    const { x, y, z, w } = pose.quaternion
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
