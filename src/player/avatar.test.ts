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
import { BONES } from './rig'

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

  it('holds the borrowed fall pose on the shipped model instead of playing it', async () => {
    // This test used to prove the FADE_SECONDS sampling offset against the real asset,
    // using the fact that `fall` borrowed a one-second Jump clip whose opening launch
    // phase animated the root upward — so the pose at 0 and the pose a fifth of a second
    // in were visibly different heights. The replacement model has no airborne clip at
    // all, so `fall` is now a *frozen* borrow of `Roll` (see clip-map.ts): timeScale 0
    // with the time pinned at FREEZE_TIME, which means mixer time cannot move it and the
    // old mechanism no longer exists to measure. The offset itself is still pinned, on
    // the fixture clips, by the test directly above this one.
    //
    // What is worth pinning against the real asset is what replaced it: that the borrow
    // is held rather than played. A `Roll` allowed to loop while the player falls reads
    // as tumbling over and over the whole way down.
    const gltf = await loadCommittedModel()

    const durations = new Map(gltf.animations.map((clip) => [clip.name, clip.duration]))
    // FREEZE_TIME is 0.5 and is documented as halfway through a one-second clip. That was
    // written for Jump and happens to still hold for Roll, which is exactly why it is
    // pinned here rather than left to luck.
    expect(durations.get('Roll')).toBe(1)
    expect(durations.get('Idle')).toBeCloseTo(3.125, 3)

    /**
     * Lowest foot joint. The previous rig had toes and this measured `LeftToeBase` and
     * friends; this one stops at the ankle, so the ankle is where the feet are.
     */
    const lowestFoot = (avatar: ReturnType<typeof createAvatar>): number => {
      avatar.object.updateMatrixWorld(true)
      let lowest = Infinity
      for (const name of [BONES.footL, BONES.footR]) {
        const foot = avatar.object.getObjectByName(name)
        if (!foot) throw new Error(`foot joint ${name} missing`)
        lowest = Math.min(lowest, foot.getWorldPosition(new Vector3()).y)
      }
      return lowest
    }

    const idle = createAvatar()
    idle.attachModel(gltf)
    idle.poseNow('idle')
    // Standing on its own feet: the avatar origin is at the ground.
    expect(lowestFoot(idle)).toBeCloseTo(0, 1)

    const falling = createAvatar()
    falling.attachModel(await loadCommittedModel())
    falling.poseNow('fall')
    // Knees drawn up into the tuck, which is the whole reason this frame was chosen.
    const tucked = lowestFoot(falling)
    expect(tucked).toBeCloseTo(1.05, 2)

    // And it drifts rather than holding. `fall` used to be a frozen frame, so a player
    // stepping off an island dropped its entire height in one unchanging attitude; the frame is
    // now sampled once and given the same slow drift the glide has. Small, because the pose is
    // still meant to read as a held brace rather than as a struggle.
    for (let i = 0; i < 30; i++) falling.update(1 / 60)
    const drifted = lowestFoot(falling)
    expect(drifted).not.toBeCloseTo(tucked, 3)
    expect(Math.abs(drifted - tucked)).toBeLessThan(0.1)
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

    expect(knee(BONES.upperLegL, BONES.lowerLegL, BONES.footL)).toBeGreaterThan(120)
    expect(knee(BONES.upperLegR, BONES.lowerLegR, BONES.footR)).toBeGreaterThan(120)

    // Prone beneath the wing, so the body runs forwards rather than standing up.
    const bodyAxis = at(BONES.head).sub(at(BONES.hips)).normalize()
    expect(bodyAxis.z).toBeGreaterThan(0.9)
    expect(Math.abs(bodyAxis.y)).toBeLessThan(0.3)
  })

  it('hangs the rider from the staff, with both hands on it', async () => {
    /*
     * This replaces a test that asserted the wing came to *rest on the rider's back*, and the
     * replacement is a change of premise rather than a loosened threshold.
     *
     * That arrangement was wrong and the numbers said so once anyone measured them. The staff
     * sits at the glider's own z of 0.45 while the prone body runs from roughly 0 to 1.6 along
     * the same axis, so what the wing was resting on was somewhere around the rider's thighs —
     * and the rider's hands, left wherever the borrowed clip frame put them, were not touching
     * any part of it. A hang glider is not carried on the back; it is held, and the whole body
     * hangs off the grip.
     *
     * So the relationship worth pinning is the grip. The old surface-to-surface sweep measured
     * a contact that should no longer exist, and its constant has already been re-swept three
     * times chasing a rider whose shape kept changing underneath it.
     */
    const gltf = await loadCommittedModel()

    const avatar = createAvatar()
    avatar.attachModel(gltf)
    const glider = createGlider()
    avatar.object.add(glider.object)
    avatar.setAnimation('glide')
    for (let i = 0; i < 60; i++) {
      avatar.update(1 / 60)
      glider.update(1 / 60, true, null, 0)
    }
    avatar.object.updateMatrixWorld(true)

    const staff = glider.object.getObjectByName('staff')
    if (!staff) throw new Error('staff missing')
    const bar = staff.getWorldPosition(new Vector3())
    /*
     * The bar's axis is the GLIDER group's local X, not the staff mesh's.
     *
     * Worth stating because taking it off the mesh is the obvious thing to do and is wrong: the
     * staff is a cylinder authored about its own Y and laid on its side by a quarter turn about
     * Z, so a direction pulled through the mesh's own rotation comes out square to the bar. The
     * first version of this measurement did exactly that and reported hands 0.22 adrift that
     * were in fact sitting on the bar, 0.22 apart along it.
     */
    const axis = new Vector3(1, 0, 0)
      .applyQuaternion(glider.object.getWorldQuaternion(new Quaternion()))
      .normalize()

    const at = (name: string) => {
      const bone = avatar.object.getObjectByName(name)
      if (!bone) throw new Error(`missing bone ${name}`)
      return bone.getWorldPosition(new Vector3())
    }
    /** Perpendicular distance from a point to the bar's line: how far off the grip is. */
    const offBar = (point: Vector3) => {
      const along = point.clone().sub(bar)
      return along.clone().sub(axis.clone().multiplyScalar(along.dot(axis))).length()
    }

    // Both hands on the bar, within a couple of centimetres on a 1.8-unit character.
    expect(offBar(at(BONES.handL))).toBeLessThan(0.06)
    expect(offBar(at(BONES.handR))).toBeLessThan(0.06)

    // And gripping it apart rather than both at the centre, which is what holding a bar means.
    const spread = at(BONES.handL).distanceTo(at(BONES.handR))
    expect(spread).toBeGreaterThan(0.25)
    // Still well inside the staff, so the rider is steering it rather than being carried by it.
    expect(spread).toBeLessThan(1.4)
  })

  it('keeps the grip when the model loads while the avatar is turned and away from the origin', async () => {
    /*
     * The case the test above cannot see. Every other test here builds the avatar at the world
     * origin facing +Z, where avatar space and world space are the same space, so a pose that
     * confused the two baked perfectly. In the game the model finishes loading after the first
     * frame, by which time the avatar stands on the spawn island facing whichever way the
     * player spawned -- and the glide pose was baked a half turn wrong, the hands 0.65 from the
     * bar. Baked here facing the spawn heading, then turned again afterwards, because the clip
     * must not remember which way the avatar was facing when it was made.
     */
    const gltf = await loadCommittedModel()
    const avatar = createAvatar()
    avatar.object.position.set(12, 13.87, -40)
    avatar.object.rotation.set(Math.PI, 0, Math.PI)
    avatar.object.updateMatrixWorld(true)
    avatar.attachModel(gltf)
    const glider = createGlider()
    avatar.object.add(glider.object)
    avatar.object.rotation.set(0, 1.1, 0)
    avatar.setAnimation('glide')
    for (let i = 0; i < 60; i++) {
      avatar.update(1 / 60)
      glider.update(1 / 60, true, null, 0)
    }
    avatar.object.updateMatrixWorld(true)

    const staff = glider.object.getObjectByName('staff')
    if (!staff) throw new Error('staff missing')
    const bar = staff.getWorldPosition(new Vector3())
    const axis = new Vector3(1, 0, 0)
      .applyQuaternion(glider.object.getWorldQuaternion(new Quaternion()))
      .normalize()
    for (const name of [BONES.handL, BONES.handR]) {
      const bone = avatar.object.getObjectByName(name)
      if (!bone) throw new Error(`missing bone ${name}`)
      const along = bone.getWorldPosition(new Vector3()).sub(bar)
      const off = along.clone().sub(axis.clone().multiplyScalar(along.dot(axis))).length()
      expect(off).toBeLessThan(0.06)
    }
  })

  it('holds the lower body in a straight plank while gliding', async () => {
    // The standing pose this is composed from stands with its knees at about 156 degrees, which
    // is a gentle crouch and reads at distance as sitting in mid-air. A glider rider holds a
    // line from shoulder to heel.
    const gltf = await loadCommittedModel()
    const avatar = createAvatar()
    avatar.attachModel(gltf)
    avatar.setAnimation('glide')
    for (let i = 0; i < 60; i++) avatar.update(1 / 60)
    avatar.object.updateMatrixWorld(true)

    const at = (name: string) => {
      const bone = avatar.object.getObjectByName(name)
      if (!bone) throw new Error(`missing bone ${name}`)
      return bone.getWorldPosition(new Vector3())
    }
    const angle = (a: Vector3, b: Vector3) =>
      (Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180) / Math.PI

    // Knees straight.
    for (const [hip, knee, foot] of [
      [BONES.upperLegL, BONES.lowerLegL, BONES.footL],
      [BONES.upperLegR, BONES.lowerLegR, BONES.footR],
    ] as const) {
      const thigh = at(hip).sub(at(knee)).normalize()
      const shin = at(foot).sub(at(knee)).normalize()
      expect(angle(thigh, shin)).toBeGreaterThan(170)
    }

    // And the whole line from shoulders through the hips to the ankles, which is what makes it a
    // plank rather than two straight legs hanging off a bent waist.
    const shoulders = at(BONES.upperArmL).add(at(BONES.upperArmR)).multiplyScalar(0.5)
    const ankles = at(BONES.footL).add(at(BONES.footR)).multiplyScalar(0.5)
    const upper = at(BONES.hips).sub(shoulders).normalize()
    const lower = ankles.sub(at(BONES.hips)).normalize()
    expect(angle(upper, lower)).toBeLessThan(15)
  })
})

describe('createAvatar board stance', () => {
  it('lifts the body without lifting the board', async () => {
    // The point of putting the hover on the body: `avatar.object` carries the simulation's
    // position and the board hangs off it, so lifting there would raise the deck with the rider
    // and the gap would never open.
    const avatar = createAvatar()
    avatar.attachModel(await loadCommittedModel())
    const deck = new Object3D()
    deck.name = 'deck'
    avatar.object.add(deck)

    const groundedFeet = spanOf(avatar.object).min.y
    avatar.setHover(0.18)
    avatar.object.updateMatrixWorld(true)

    expect(spanOf(avatar.object).min.y).toBeCloseTo(groundedFeet + 0.18, 4)
    // The board did not come up with it.
    expect(deck.getWorldPosition(new Vector3()).y).toBeCloseTo(0, 6)
  })

  it('crouches towards the deck rather than through it', () => {
    // The fit offset is a property of the model and compresses with a charge; the hover is the
    // height of the deck underfoot and must not. Folding the two together would sink a rider
    // charging a jump straight through their own board.
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle'], { height: 3.6, liftFeet: 0.5 }))

    avatar.setHover(0.18)
    const standing = spanOf(avatar.object).min.y
    avatar.setSquash(0.7)
    const crouched = spanOf(avatar.object).min.y

    // Still at the deck, not below it.
    expect(crouched).toBeCloseTo(standing, 4)
    expect(crouched).toBeCloseTo(0.18, 4)
  })

  it('turns the body across the deck without turning the avatar', () => {
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle']))
    avatar.setStanceYaw(1.38)

    const wrapper = avatar.object.children[0]
    if (!wrapper) throw new Error('model wrapper missing')
    expect(wrapper.rotation.y).toBeCloseTo(1.38, 6)
    // The node the board and the glider hang off is untouched, so they keep pointing along
    // the direction of travel while the rider stands across them.
    expect(avatar.object.rotation.y).toBe(0)
  })

  it('poses the placeholder too, for a model that never arrives', () => {
    const avatar = createAvatar()
    avatar.setHover(0.18)
    avatar.setStanceYaw(1.38)
    const placeholder = avatar.object.children[0]
    if (!placeholder) throw new Error('placeholder missing')
    expect(placeholder.position.y).toBeCloseTo(0.18, 6)
    expect(placeholder.rotation.y).toBeCloseTo(1.38, 6)
  })

  it('refuses a corrupted hover or stance rather than losing the character', () => {
    // A NaN here writes NaN into the wrapper's matrix, and the character vanishes for the rest
    // of the session with nothing logged.
    const avatar = createAvatar()
    avatar.attachModel(fakeGltf(['Idle']))
    avatar.setHover(Number.NaN)
    avatar.setStanceYaw(Number.NaN)
    const span = spanOf(avatar.object)
    expect(Number.isFinite(span.min.y)).toBe(true)
    expect(Number.isFinite(span.height)).toBe(true)
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
