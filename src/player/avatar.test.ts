import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  Box3, Group, Mesh, Object3D, BoxGeometry, CapsuleGeometry, AnimationClip, VectorKeyframeTrack,
  QuaternionKeyframeTrack, Quaternion, Euler, Vector3, type SkinnedMesh,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { createAvatar } from './avatar'
import { createGlider } from './glider'
import { planClips } from './clip-map'

/**
 * A stand-in for a loaded model. `height` is the mesh's own height and `liftFeet`
 * lifts it off the origin, mimicking a real export whose lowest vertex is not
 * exactly zero — the committed model sits at -0.006.
 */
function fakeGltf(
  clipNames: string[],
  { height = 3.6, liftFeet = 0 } = {},
): GLTF {
  const scene = new Group()
  const mesh = new Mesh(new BoxGeometry(0.5, height, 0.5))
  mesh.name = 'Body'
  mesh.position.y = height / 2 + liftFeet
  scene.add(mesh)

  const animations = clipNames.map((name) =>
    new AnimationClip(name, 1, [
      new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 0, 1, 0]),
    ]),
  )

  return { scene, animations } as unknown as GLTF
}

/**
 * Parse the shipped model in node, for the tests that need the real rig rather than a
 * box. Each caller gets its own parse: `attachModel` poses the bones it is handed as a
 * side effect of composing the glide clip, so a shared GLTF would let one test's pose
 * leak into the next one's measurements.
 */
async function loadCommittedModel(): Promise<GLTF> {
  const modelPath = fileURLToPath(
    new URL('../../public/models/character.glb', import.meta.url),
  )
  const bytes = readFileSync(modelPath)
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer

  return await new Promise<GLTF>((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolve, reject)
  })
}

function spanOf(object: Object3D) {
  object.updateMatrixWorld(true)
  const box = new Box3().setFromObject(object)
  return { min: box.min.clone(), height: box.max.y - box.min.y }
}

describe('createAvatar placeholder', () => {
  it('starts at the placeholder capsule height', () => {
    // CapsuleGeometry(0.4, 1.0) at y = 0.9 spans 0 to 1.8.
    expect(spanOf(createAvatar().object).height).toBeCloseTo(1.8, 1)
  })

  it('survives setAnimation before any model has loaded', () => {
    expect(() => createAvatar().setAnimation('walk')).not.toThrow()
  })

  it('survives update before any model has loaded', () => {
    expect(() => createAvatar().update(1 / 60)).not.toThrow()
  })
})

describe('createAvatar attachModel', () => {
  it('scales an oversized model down to the placeholder height', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594 }))
    expect(spanOf(avatar.object).height).toBeCloseTo(1.8, 3)
  })

  it('scales an undersized model up to the placeholder height', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 0.4 }))
    expect(spanOf(avatar.object).height).toBeCloseTo(1.8, 3)
  })

  it('seats the feet at the origin', () => {
    // The real export's lowest vertex is at -0.006, not 0, so the offset has to
    // be applied rather than assumed away.
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594, liftFeet: 0.5 }))
    expect(spanOf(avatar.object).min.y).toBeCloseTo(0, 5)
  })

  it('keeps the glider when a model replaces the placeholder', () => {
    // REGRESSION: object.clear() would drop the glider too. main.ts parents the
    // glider under avatar.object, and commit a636ec3 already fixed this once.
    const avatar = createAvatar()
    const glider = new Object3D()
    glider.name = 'glider'
    avatar.object.add(glider)

    avatar.attachModel(fakeGltf(['Idle']))

    expect(avatar.object.children).toContain(glider)
  })

  it('leaves the glider unscaled while resizing the character', () => {
    // The fit must land on the model wrapper. Scaling avatar.object would shrink
    // the glider by the same factor.
    const avatar = createAvatar()
    const glider = new Object3D()
    avatar.object.add(glider)

    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594 }))

    expect(avatar.object.scale.y).toBe(1)
    glider.updateMatrixWorld(true)
    expect(glider.matrixWorld.elements[5]).toBe(1)
  })

  it('removes the placeholder capsule', () => {
    // Asserting structure, not measured height: a correctly fitted model spans
    // the same [0, 1.8] range as the placeholder, so a height-only assertion
    // would pass identically whether or not the placeholder was actually removed.
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594 }))

    expect(avatar.object.children).toHaveLength(1) // only the model wrapper

    let hasCapsule = false
    avatar.object.traverse((child) => {
      if (child instanceof Mesh && child.geometry instanceof CapsuleGeometry) hasCapsule = true
    })
    expect(hasCapsule).toBe(false)
  })

  it('refuses to divide by a degenerate model height', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 0 }))
    // A zero-height model must not produce an Infinity scale and vanish.
    expect(Number.isFinite(spanOf(avatar.object).height)).toBe(true)
  })

  it('replaces a previously attached model instead of leaking it', () => {
    // REGRESSION: object.remove(placeholder) is a no-op on a second call, and
    // nothing removed the first modelRoot, so two Body meshes stacked up and
    // the mixer for the first model was dropped without stopping its actions.
    const avatar = createAvatar()
    const glider = new Object3D()
    glider.name = 'glider'
    avatar.object.add(glider)

    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594 }))
    avatar.attachModel(fakeGltf(['Idle'], { height: 3.6 }))

    const span = spanOf(avatar.object)
    expect(span.height).toBeCloseTo(1.8, 3)
    expect(span.min.y).toBeCloseTo(0, 5)

    // Exactly one model wrapper alongside the glider, not two stacked ones.
    expect(avatar.object.children).toHaveLength(2)
    expect(avatar.object.children).toContain(glider)

    let bodyCount = 0
    avatar.object.traverse((child) => {
      if (child.name === 'Body') bodyCount++
    })
    expect(bodyCount).toBe(1)
  })
})

describe('createAvatar frozen poses', () => {
  const REAL_CLIPS = [
    'Human Armature|Idle',
    'Human Armature|Walk',
    'Human Armature|Run',
    'Human Armature|Jump',
  ]

  /**
   * Run the mixer past the cross-fade, then report the animated value.
   *
   * The frame count must not advance the action by a whole multiple of the
   * clip's duration. The fixture's clips are exactly 1.000s long, so 60 frames
   * of 1/60 would land every sample back on the same phase — making a looping
   * action look frozen. 25 frames advances 5/12 of a cycle, so consecutive
   * samples sit at distinct phases (0.417, 0.833, 0.250) while still clearing
   * the 0.18s cross-fade on the first call.
   */
  function settle(avatar: ReturnType<typeof createAvatar>): number {
    for (let i = 0; i < 25; i++) avatar.update(1 / 60)
    const body = avatar.object.getObjectByName('Body')
    if (!body) throw new Error('fixture mesh missing')
    return body.position.y
  }

  it('stops advancing time while gliding', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(REAL_CLIPS))
    avatar.setAnimation('glide')

    const first = settle(avatar)
    const second = settle(avatar)

    expect(second).toBeCloseTo(first, 6)
  })

  it('keeps advancing time while falling', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(REAL_CLIPS))
    avatar.setAnimation('fall')

    const samples = [settle(avatar), settle(avatar), settle(avatar)]

    expect(new Set(samples.map((v) => v.toFixed(4))).size).toBeGreaterThan(1)
  })

  it('resumes falling after a glide released the shared clip', () => {
    // REGRESSION: fall and glide borrow the same jump clip, so they share one
    // AnimationAction. Freezing it for glide without restoring timeScale leaves
    // falling frozen too.
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(REAL_CLIPS))

    avatar.setAnimation('glide')
    settle(avatar)
    avatar.setAnimation('fall')

    const samples = [settle(avatar), settle(avatar), settle(avatar)]

    expect(new Set(samples.map((v) => v.toFixed(4))).size).toBeGreaterThan(1)
  })

  it('does not freeze an ordinary clip', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(REAL_CLIPS))
    avatar.setAnimation('walk')

    const samples = [settle(avatar), settle(avatar), settle(avatar)]

    expect(new Set(samples.map((v) => v.toFixed(4))).size).toBeGreaterThan(1)
  })
})

describe('createAvatar poseNow', () => {
  /**
   * FADE_SECONDS from avatar.ts, which keeps it private. Restated here because the
   * length of poseNow's single tick is exactly what these tests are about.
   */
  const FADE_SECONDS = 0.18

  /** fakeGltf's default model is 3.6 tall, so its mesh binds at half that. */
  const BIND_Y = 1.8

  function bodyY(avatar: ReturnType<typeof createAvatar>): number {
    const body = avatar.object.getObjectByName('Body')
    if (!body) throw new Error('fixture mesh missing')
    return body.position.y
  }

  it('lands the pose where setAnimation and a zero-length tick leave the bind pose', () => {
    // THE REASON THE METHOD EXISTS, and the claim its own comment makes. setAnimation
    // starts its action at weight 0 and leaves fadeIn to ramp it up over FADE_SECONDS of
    // mixer time; at mixer time 0 that interpolant still evaluates to 0, so a following
    // update(0) blends the clip in at no strength at all and the bind pose survives.
    const unposed = createAvatar()
    unposed.attachModel(fakeGltf(['Idle']))
    unposed.setAnimation('idle')
    unposed.update(0)
    expect(bodyY(unposed)).toBe(BIND_Y)

    const posed = createAvatar()
    posed.attachModel(fakeGltf(['Idle']))
    posed.poseNow('idle')

    // fakeGltf's clips carry Body.position.y linearly from 0 to 1 over one second, so the
    // value read back off the model reports the clip time the pose was sampled at. It is
    // FADE_SECONDS rather than 0 because AnimationAction._update advances the action's
    // clip time before it evaluates the fade's weight, so the one tick that lands the
    // weight moves the playhead by the same amount.
    expect(bodyY(posed)).toBeCloseTo(FADE_SECONDS, 6)

    // Effectively full weight, but not exactly full, which is why the line above is a
    // tolerance rather than an equality: _scheduleFading stores the fade's end time in a
    // Float32Array while mixer.time is a double, so `time > parameterPositions[1]` is
    // false at exactly FADE_SECONDS, stopFading() never fires, and the weight comes back
    // one float ulp short of 1. What is left over is that fraction of the bind pose,
    // which sits above the sampled value here — so "not exactly full" is observable as a
    // strict inequality with a known sign, rather than only as a loose tolerance.
    expect(bodyY(posed)).toBeGreaterThan(FADE_SECONDS)
  })

  it('samples the shipped model FADE_SECONDS into the clip rather than at its start', async () => {
    // Immaterial for the only clip main.ts asks poseNow for -- Idle is a ten-second
    // subtle loop, so a fifth of a second in is indistinguishable from its start, and the
    // character stands with its feet on the ground either way. The offset is a latent
    // trap for every other clip name, though, which is why poseNow documents it: `fall`
    // borrows the one-second Jump clip, whose opening launch phase animates the root
    // upward, so poseNow('fall') would hang the character clear of its own feet.
    const gltf = await loadCommittedModel()

    const durations = new Map(gltf.animations.map((clip) => [clip.name, clip.duration]))
    expect(durations.get('Human Armature|Idle')).toBe(10)
    expect(durations.get('Human Armature|Jump')).toBe(1)

    /** Lowest toe joint, which is where this model's feet are. */
    const lowestToe = (avatar: ReturnType<typeof createAvatar>): number => {
      avatar.object.updateMatrixWorld(true)
      const toes = ['LeftToeBase', 'LeftToe_End', 'RightToeBase', 'RightToe_End']
        .map((name) => avatar.object.getObjectByName(name))
      let lowest = Infinity
      for (const toe of toes) {
        if (!toe) throw new Error('toe joint missing')
        lowest = Math.min(lowest, toe.getWorldPosition(new Vector3()).y)
      }
      return lowest
    }

    const idle = createAvatar()
    idle.attachModel(gltf)
    idle.poseNow('idle')
    expect(lowestToe(idle)).toBeCloseTo(0, 1)

    const falling = createAvatar()
    falling.attachModel(await loadCommittedModel())
    falling.poseNow('fall')
    expect(lowestToe(falling)).toBeCloseTo(0.64, 2)
  })
})

describe('createAvatar pose continuity', () => {
  // fall and glide both resolve to the model's Jump clip when no glide clip
  // exists, so mixer.clipAction(clip) hands back the very same AnimationAction
  // for both states. A transition between them is not a cross-fade between two
  // actions — it is the same action continuing under a new name — so the pose
  // must carry over exactly, not snap toward the bind pose for a frame while a
  // fade ramps back up.
  it('keeps the pose continuous across a fall→glide transition instead of snapping to bind pose', () => {
    const scene = new Group()
    const bone = new Object3D()
    bone.name = 'Bone'
    scene.add(bone)

    // Bind pose is identity; the clip carries the bone to a 90-degree rotation
    // by its end, so bind and mid-clip poses are unambiguously far apart.
    const bind = new Quaternion()
    const target = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0))

    const jumpClip = new AnimationClip('Human Armature|Jump', 1, [
      new QuaternionKeyframeTrack('Bone.quaternion', [0, 1], [
        bind.x, bind.y, bind.z, bind.w,
        target.x, target.y, target.z, target.w,
      ]),
    ])

    const gltf = { scene, animations: [jumpClip] } as unknown as GLTF

    const avatar = createAvatar()
    avatar.attachModel(gltf)

    avatar.setAnimation('fall')
    for (let i = 0; i < 20; i++) avatar.update(1 / 60) // clear the 0.18s fade

    avatar.setAnimation('glide') // shared action: fall and glide both borrow Jump
    avatar.update(1 / 60) // one frame after the transition

    const sampled = bone.quaternion.clone()

    // glide freezes at FREEZE_TIME = 0.5, halfway through a 1-second clip: a
    // slerp of bind→target at alpha 0.5.
    const frozen = bind.clone().slerp(target, 0.5)

    const angleToFrozen = sampled.angleTo(frozen)
    const angleToBind = sampled.angleTo(bind)

    expect(angleToFrozen).toBeLessThan(angleToBind)
    // Not just "closer" — continuous. A cross-fade-against-itself would still
    // land partway toward bind pose after one frame; this must be exact.
    expect(angleToFrozen).toBeLessThan(0.01)
  })
})

describe('createAvatar with the real committed model', () => {
  // Every other fixture in this file is a Mesh(BoxGeometry), which takes the
  // geometry-bbox path inside Box3.expandByObject. The shipped model is a
  // SkinnedMesh, which takes a different path — SkinnedMesh.computeBoundingBox()
  // applying bone transforms — so this is the only test that would catch a
  // skinned-measurement regression. It also pins the clip names and MODEL_YAW
  // that the shipped asset actually resolves to.
  it('fits, seats, and resolves animations for public/models/character.glb', async () => {
    const gltf = await loadCommittedModel()

    const avatar = createAvatar()
    avatar.attachModel(gltf)

    const span = spanOf(avatar.object)
    expect(span.height).toBeCloseTo(1.8, 3)
    expect(span.min.y).toBeCloseTo(0, 3)

    const modelRoot = avatar.object.children[0]
    if (!modelRoot) throw new Error('model wrapper missing')
    // The shipped model already faces its direction of travel: no yaw correction.
    expect(modelRoot.rotation.y).toBe(0)

    const plan = planClips(gltf.animations.map((clip) => clip.name))
    expect([...plan.keys()].sort()).toEqual(['fall', 'glide', 'idle', 'run', 'walk'])
  })

  it('glides with its legs extended rather than crouched', async () => {
    // END TO END: the composed glide pose has to actually reach the character.
    // Freezing the borrowed jump clip left one knee bent to 69 degrees, which
    // reads as sitting down in mid-air.
    const gltf = await loadCommittedModel()

    const avatar = createAvatar()
    avatar.attachModel(gltf)
    avatar.setAnimation('glide')
    for (let i = 0; i < 30; i++) avatar.update(1 / 60)
    avatar.object.updateMatrixWorld(true)

    const at = (name: string) => {
      const bone = avatar.object.getObjectByName(name)
      if (!bone) throw new Error(`missing bone ${name}`)
      return bone.getWorldPosition(new Vector3())
    }
    const knee = (hip: string, mid: string, foot: string) => {
      const a = at(hip).sub(at(mid)).normalize()
      const b = at(foot).sub(at(mid)).normalize()
      return (Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180) / Math.PI
    }

    expect(knee('LeftUpLeg', 'LeftLeg', 'LeftFoot')).toBeGreaterThan(120)
    expect(knee('RightUpLeg', 'RightLeg', 'RightFoot')).toBeGreaterThan(120)

    // Prone beneath the wing, so the body runs forwards rather than standing up.
    const bodyAxis = at('Head').sub(at('Hips')).normalize()
    expect(bodyAxis.z).toBeGreaterThan(0.9)
    expect(Math.abs(bodyAxis.y)).toBeLessThan(0.3)
  })

  it("rests the deployed wing on the gliding rider's back", async () => {
    // Where the wing sits is only meaningful against the rider it rests on, which
    // is why this lives here rather than in glider-mesh.test.ts: it needs the posed
    // model. Bounding boxes cannot express it either — the wing's lowest point is a
    // forward fan tip overhanging past the shoulders with no body beneath it, so
    // this measures surface to surface instead.
    const gltf = await loadCommittedModel()

    const avatar = createAvatar()
    avatar.attachModel(gltf)
    // Parented exactly as main.ts parents it, so the wing inherits avatar space.
    const glider = createGlider()
    avatar.object.add(glider.object)
    avatar.setAnimation('glide')
    for (let i = 0; i < 60; i++) {
      avatar.update(1 / 60)
      glider.update(1 / 60, true, null, 0)
    }
    avatar.object.updateMatrixWorld(true)

    let skinned: SkinnedMesh | null = null
    avatar.object.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh) skinned = node as SkinnedMesh
    })
    if (!skinned) throw new Error('no skinned mesh')
    const mesh: SkinnedMesh = skinned

    const skin: Vector3[] = []
    const attribute = mesh.geometry.attributes.position
    if (!attribute) throw new Error('no position attribute')
    for (let i = 0; i < attribute.count; i++) {
      const point = new Vector3().fromBufferAttribute(attribute, i)
      mesh.applyBoneTransform(i, point)
      skin.push(mesh.localToWorld(point))
    }

    const wing: Vector3[] = []
    glider.object.traverse((node) => {
      const candidate = node as Mesh
      if (!candidate.isMesh) return
      const positions = candidate.geometry.attributes.position
      if (!positions) return
      for (let i = 0; i < positions.count; i++) {
        wing.push(candidate.localToWorld(new Vector3().fromBufferAttribute(positions, i)))
      }
    })

    // Closest vertical distance from the wing down to the skin below it.
    const NEAR = 0.09
    let gap = Infinity
    for (const w of wing) {
      for (const s of skin) {
        if (Math.abs(w.x - s.x) > NEAR || Math.abs(w.z - s.z) > NEAR) continue
        gap = Math.min(gap, w.y - s.y)
      }
    }

    expect(gap).toBeLessThan(0.02) // touching, not hovering above the back
    expect(gap).toBeGreaterThanOrEqual(0) // resting on it, not sunk through it
  })
})

describe('createAvatar charge squash', () => {
  /** World-space Y scale, which is what a squash on any ancestor would change. */
  function worldScaleY(object: Object3D): number {
    object.updateMatrixWorld(true)
    return object.matrixWorld.elements[5]
  }

  it('squashes the character without squashing the glider', () => {
    // REGRESSION: the charge-jump squash used to scale avatar.object, but the
    // glider is a child of that object rather than of the model wrapper, so a
    // charging jump compressed the staff along with the character.
    const avatar = createAvatar()
    const glider = new Object3D()
    avatar.object.add(glider)
    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594 }))

    avatar.setSquash(0.6)

    expect(spanOf(avatar.object).height).toBeCloseTo(1.8 * 0.6, 3)
    expect(worldScaleY(glider)).toBeCloseTo(1, 6)
  })

  it('squashes the placeholder before a model has loaded', () => {
    const avatar = createAvatar()
    const glider = new Object3D()
    avatar.object.add(glider)

    avatar.setSquash(0.5)

    expect(spanOf(avatar.object).height).toBeCloseTo(1.8 * 0.5, 3)
    expect(worldScaleY(glider)).toBeCloseTo(1, 6)
  })

  it('keeps a squash that was set before the model loaded', () => {
    const avatar = createAvatar()
    avatar.setSquash(0.6)

    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594 }))

    expect(spanOf(avatar.object).height).toBeCloseTo(1.8 * 0.6, 3)
  })

  it('restores full height when the squash is released', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594 }))

    avatar.setSquash(0.6)
    avatar.setSquash(1)

    expect(spanOf(avatar.object).height).toBeCloseTo(1.8, 3)
  })

  it('keeps the feet on the ground while squashed', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 5.2594, liftFeet: 0.5 }))

    avatar.setSquash(0.6)

    expect(spanOf(avatar.object).min.y).toBeCloseTo(0, 5)
  })
})
