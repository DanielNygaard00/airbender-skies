import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AnimationClip, AnimationMixer, Group, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { buildFallClip, buildGlideClip } from './glide-pose'
import { BONES } from './rig'
import { DEPLOYED_PITCH } from './glider'

const MODEL_PATH = fileURLToPath(new URL('../../public/models/character.glb', import.meta.url))

function loadModel(): Promise<GLTF> {
  const bytes = readFileSync(MODEL_PATH)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject)
  })
}

/** Pose the model with a clip so the resulting bone positions can be measured. */
function poseWith(gltf: GLTF, clip: AnimationClip) {
  const mixer = new AnimationMixer(gltf.scene)
  mixer.clipAction(clip).play()
  mixer.setTime(0)
  gltf.scene.updateMatrixWorld(true)

  const at = (name: string) => {
    const bone = gltf.scene.getObjectByName(name)
    if (!bone) throw new Error(`missing bone ${name}`)
    return bone.getWorldPosition(new Vector3())
  }
  const kneeAngle = (hip: string, knee: string, foot: string) => {
    const a = at(hip).sub(at(knee)).normalize()
    const b = at(foot).sub(at(knee)).normalize()
    return (Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180) / Math.PI
  }

  // The body lies down when gliding, so "raised" arms and body tilt have to be
  // measured against the body's own axis rather than against world up.
  const bodyAxis = at(BONES.head).sub(at(BONES.hips)).normalize()

  return {
    kneeL: kneeAngle(BONES.upperLegL, BONES.lowerLegL, BONES.footL),
    kneeR: kneeAngle(BONES.upperLegR, BONES.lowerLegR, BONES.footR),
    feetGap: at(BONES.footL).distanceTo(at(BONES.footR)),
    /** How far the hand sits towards the head end of the body. */
    handAlongBody: at(BONES.handL).sub(at(BONES.shoulderL)).dot(bodyAxis),
    /** Degrees the body is tilted above horizontal. */
    pitchDegrees: (Math.asin(bodyAxis.y) * 180) / Math.PI,
    headForwardOfHips: at(BONES.head).z - at(BONES.hips).z,
  }
}

/** The left knee angle at one instant of a clip, in degrees. */
function kneeAt(gltf: GLTF, clip: AnimationClip, seconds: number): number {
  const mixer = new AnimationMixer(gltf.scene)
  mixer.clipAction(clip).play()
  mixer.setTime(0)
  mixer.setTime(seconds)
  gltf.scene.updateMatrixWorld(true)
  const at = (name: string) => {
    const bone = gltf.scene.getObjectByName(name)
    if (!bone) throw new Error(`missing bone ${name}`)
    return bone.getWorldPosition(new Vector3())
  }
  const a = at(BONES.upperLegL).sub(at(BONES.lowerLegL)).normalize()
  const b = at(BONES.footL).sub(at(BONES.lowerLegL)).normalize()
  return (Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180) / Math.PI
}

describe('buildGlideClip', () => {
  it('builds a glide clip for the shipped model', async () => {
    const gltf = await loadModel()
    expect(buildGlideClip(gltf.scene, gltf.animations)).not.toBeNull()
  })

  it('takes the legs from a clip that has them together and straight', async () => {
    // The defect this replaces: freezing the jump clip left one knee bent to 69
    // degrees, which reads as crouching in mid-air rather than gliding.
    const gltf = await loadModel()
    const clip = buildGlideClip(gltf.scene, gltf.animations)
    if (!clip) throw new Error('expected a glide clip')

    const pose = poseWith(gltf, clip)

    expect(pose.kneeL).toBeGreaterThan(120)
    expect(pose.kneeR).toBeGreaterThan(120)
    expect(pose.feetGap).toBeLessThan(1.2)
  })

  it('takes the arms from a clip that raises them', async () => {
    const gltf = await loadModel()
    const clip = buildGlideClip(gltf.scene, gltf.animations)
    if (!clip) throw new Error('expected a glide clip')

    // Hanging arms are what made the borrowed jump frame look wrong.
    expect(poseWith(gltf, clip).handAlongBody).toBeGreaterThan(0)
  })

  it('lies parallel to the deployed wing', async () => {
    const gltf = await loadModel()
    const clip = buildGlideClip(gltf.scene, gltf.animations)
    if (!clip) throw new Error('expected a glide clip')

    const pose = poseWith(gltf, clip)
    const wingPitchDegrees = (DEPLOYED_PITCH * 180) / Math.PI

    // Parallel to the wing, not merely level: the rider and the glider should read
    // as one object rather than a body dangling at its own angle.
    expect(pose.pitchDegrees).toBeCloseTo(wingPitchDegrees, 1)
    // Prone and facing its direction of travel, not lying feet-first.
    expect(pose.headForwardOfHips).toBeGreaterThan(1)
  })

  it('holds every joint angle while the body itself banks', async () => {
    // This was 'holds a single pose rather than animating', from when the clip was two
    // identical keyframes. It now loops a slow bank and bob so the rider is not a statue for
    // the whole of a flight -- but the guarantee that mattered is unchanged and is what this
    // still pins: the sway is applied at the hips alone, and rotating the root of a skeleton
    // moves the body through the world without altering any joint angle beneath it. The defect
    // it was written against was a borrowed jump clip flailing the limbs, and that would still
    // fail here.
    const gltf = await loadModel()
    const clip = buildGlideClip(gltf.scene, gltf.animations)
    if (!clip) throw new Error('expected a glide clip')

    const at = (fraction: number) => {
      const mixer = new AnimationMixer(gltf.scene)
      mixer.clipAction(clip).play()
      mixer.setTime(0)
      mixer.setTime(clip.duration * fraction)
      gltf.scene.updateMatrixWorld(true)
      return poseWith(gltf, clip)
    }

    const start = poseWith(gltf, clip)
    for (const fraction of [0.25, 0.5, 0.75]) {
      const later = at(fraction)
      // Joint angles and the distances between limbs: all invariant under a hip rotation.
      expect(later.kneeL).toBeCloseTo(start.kneeL, 4)
      expect(later.kneeR).toBeCloseTo(start.kneeR, 4)
      expect(later.feetGap).toBeCloseTo(start.feetGap, 4)
    }
  })

  it('actually moves, so the rider is not frozen for the whole flight', async () => {
    // The other half, and the reason the test above had to be rewritten rather than deleted:
    // with the sway removed, every assertion up there would still pass on a dead clip. Gliding
    // is this game's central activity, so a rider holding one attitude is most of the screen
    // time spent looking at a statue.
    const gltf = await loadModel()
    const clip = buildGlideClip(gltf.scene, gltf.animations)
    if (!clip) throw new Error('expected a glide clip')

    expect(clip.duration).toBeGreaterThan(1)

    const bankAt = (fraction: number) => {
      const mixer = new AnimationMixer(gltf.scene)
      mixer.clipAction(clip).play()
      mixer.setTime(0)
      mixer.setTime(clip.duration * fraction)
      gltf.scene.updateMatrixWorld(true)
      const hips = gltf.scene.getObjectByName(BONES.hips)
      if (!hips) throw new Error('missing hips')
      return hips.getWorldQuaternion(new Quaternion())
    }

    // A quarter of the way in is the roll's own peak, so if anything moves at all it is here.
    const angle = bankAt(0).angleTo(bankAt(0.25))
    expect(angle).toBeGreaterThan(0.01)
    // Small on purpose: large enough to see, too small to compete with the wing's stall shudder.
    expect(angle).toBeLessThan(0.2)
  })

  it('rebuilds the fall frame faithfully, translations and all', async () => {
    // REGRESSION, and it failed silently. This module used to write a position track for the
    // hips alone, on the stated grounds that nothing else translates -- true of the rig it was
    // written against, false of this one, whose clips animate translation, rotation and scale
    // on all 32 bones. Every other bone was therefore rebuilt at its bind offset, which costs
    // almost nothing for a pose sampled near the rest position (the glide's legs come from the
    // start of Idle, which is why that one still looked right) and wrecks one sampled mid-
    // motion: the fall's tuck came back with the knee at 93 degrees instead of 52.
    const gltf = await loadModel()
    const roll = gltf.animations.find((clip) => clip.name === 'Roll')
    if (!roll) throw new Error('expected a Roll clip to borrow')

    // The pose the frozen borrow used to show, measured straight off the source at the same
    // instant. Measured with its own sampler rather than `poseWith`, which always sets time 0 --
    // reusing it here silently compared the rebuild against Roll's *first* frame instead of the
    // tuck, and reported a 77-degree difference that was entirely the test's own doing.
    const sourceKnee = kneeAt(gltf, roll, 0.5)

    const fresh = await loadModel()
    const fall = buildFallClip(fresh.scene, fresh.animations, 0.5)
    if (!fall) throw new Error('expected a fall clip')
    const rebuilt = poseWith(fresh, fall).kneeL

    // Exactly, not approximately: a rebuild that drops a channel lands tens of degrees away.
    expect(rebuilt).toBeCloseTo(sourceKnee, 3)
    // And it is genuinely a tuck rather than a stand, so the assertion above cannot be
    // satisfied by both poses happening to be the rest position.
    expect(rebuilt).toBeLessThan(90)
  })

  it('builds a fall that drifts rather than holding one frame', async () => {
    // `fall` was a frozen frame, so stepping off an island dropped the character its whole
    // height in one unchanging attitude -- the same statue the glide was, over a shorter time.
    const gltf = await loadModel()
    const fall = buildFallClip(gltf.scene, gltf.animations, 0.5)
    if (!fall) throw new Error('expected a fall clip')

    const bankAt = (fraction: number) => {
      const mixer = new AnimationMixer(gltf.scene)
      mixer.clipAction(fall).play()
      mixer.setTime(0)
      mixer.setTime(fall.duration * fraction)
      gltf.scene.updateMatrixWorld(true)
      const hips = gltf.scene.getObjectByName(BONES.hips)
      if (!hips) throw new Error('missing hips')
      return hips.getWorldQuaternion(new Quaternion())
    }
    const angle = bankAt(0).angleTo(bankAt(0.25))
    expect(angle).toBeGreaterThan(0.01)
    // Faster and slightly wider than the glide's, because nothing is carrying a falling body.
    expect(angle).toBeLessThan(0.3)

    // And the joints are still held, for the glide's reason: the drift is applied at the
    // carrier bone, so no limb angle moves.
    const start = poseWith(gltf, fall)
    const mixer = new AnimationMixer(gltf.scene)
    mixer.clipAction(fall).play()
    mixer.setTime(0)
    mixer.setTime(fall.duration * 0.5)
    gltf.scene.updateMatrixWorld(true)
    expect(poseWith(gltf, fall).kneeL).toBeCloseTo(start.kneeL, 4)
  })

  it('clamps the sample into the borrowed clip rather than past its end', async () => {
    // The freeze time was chosen against a one-second borrow. A pack whose nearest clip is
    // shorter must still get a pose rather than an empty one.
    const gltf = await loadModel()
    expect(buildFallClip(gltf.scene, gltf.animations, 99)).not.toBeNull()
    expect(buildFallClip(gltf.scene, gltf.animations, -5)).not.toBeNull()
  })

  it('gives up on a fall when the model has nothing airborne to borrow', () => {
    const root = new Group()
    const clips = [new AnimationClip('Walk', 1, []), new AnimationClip('Idle', 1, [])]
    expect(buildFallClip(root, clips, 0.5)).toBeNull()
  })

  it('gives up when the model has no upper-body source', () => {
    // Named for the upper body specifically, because `idle` is now a lower-body source:
    // this model's `Idle` is where the straight, together legs come from. So a model with
    // Death and Idle has half a pose available, and half is not enough -- composing from
    // it would glide with the arms in whatever the bind pose left them.
    const root = new Group()
    const clips = [new AnimationClip('Death', 1, []), new AnimationClip('Idle', 1, [])]
    expect(buildGlideClip(root, clips)).toBeNull()
  })
})
