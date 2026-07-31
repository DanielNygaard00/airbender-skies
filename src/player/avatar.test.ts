import { describe, it, expect } from 'vitest'
import {
  Box3, Group, Mesh, Object3D, BoxGeometry, CapsuleGeometry, AnimationClip, VectorKeyframeTrack,
} from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { createAvatar } from './avatar'

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
