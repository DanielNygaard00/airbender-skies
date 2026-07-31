import { describe, it, expect } from 'vitest'
// This project deliberately scopes tsconfig's "types" to "vite/client" only,
// so @types/node is not installed and Node's own ambient types are
// unavailable to the type checker. These two imports run fine under vitest's
// `environment: 'node'`; only the type declarations are missing.
// @ts-expect-error -- no @types/node in this project (see comment above)
import { readFileSync } from 'node:fs'
// @ts-expect-error -- no @types/node in this project (see comment above)
import { fileURLToPath } from 'node:url'
import { AnimationClip, AnimationMixer, Group, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { buildGlideClip } from './glide-pose'
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
  const bodyAxis = at('Head').sub(at('Hips')).normalize()

  return {
    kneeL: kneeAngle('LeftUpLeg', 'LeftLeg', 'LeftFoot'),
    kneeR: kneeAngle('RightUpLeg', 'RightLeg', 'RightFoot'),
    feetGap: at('LeftFoot').distanceTo(at('RightFoot')),
    /** How far the hand sits towards the head end of the body. */
    handAlongBody: at('LeftHand').sub(at('LeftShoulder')).dot(bodyAxis),
    /** Degrees the body is tilted above horizontal. */
    pitchDegrees: (Math.asin(bodyAxis.y) * 180) / Math.PI,
    headForwardOfHips: at('Head').z - at('Hips').z,
  }
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

  it('holds a single pose rather than animating', async () => {
    const gltf = await loadModel()
    const clip = buildGlideClip(gltf.scene, gltf.animations)
    if (!clip) throw new Error('expected a glide clip')

    const mixer = new AnimationMixer(gltf.scene)
    mixer.clipAction(clip).play()
    mixer.setTime(0)
    const start = poseWith(gltf, clip).kneeL
    mixer.setTime(clip.duration * 0.75)
    gltf.scene.updateMatrixWorld(true)
    const later = poseWith(gltf, clip).kneeL

    expect(later).toBeCloseTo(start, 6)
  })

  it('gives up when the model has neither source clip', () => {
    const root = new Group()
    const clips = [new AnimationClip('Death', 1, []), new AnimationClip('Idle', 1, [])]
    expect(buildGlideClip(root, clips)).toBeNull()
  })
})
