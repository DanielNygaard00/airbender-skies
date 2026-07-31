import {
  Object3D, Group, Mesh, CapsuleGeometry, ConeGeometry, Box3,
  MeshLambertMaterial, AnimationMixer, type AnimationClip,
} from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { AnimationName } from './avatar-anim'
import { planClips } from './clip-map'

const FADE_SECONDS = 0.18

/** Matches the placeholder capsule: CapsuleGeometry(0.4, 1.0) is 1.8 tall. */
const TARGET_HEIGHT = 1.8

/**
 * Yaw correction for a model that does not face its direction of travel.
 * Forward here is +Z, because main.ts calls avatar.object.lookAt(...) on a plain
 * Group and Object3D.lookAt aligns local +Z. Set to Math.PI for a -Z model.
 */
const MODEL_YAW = 0

/** Primitive stand-in used until a real model loads, and if none ever does. */
function createPlaceholder(): Group {
  const group = new Group()

  const body = new Mesh(
    new CapsuleGeometry(0.4, 1.0, 4, 8),
    new MeshLambertMaterial({ color: 0xf0e6d2 }),
  )
  body.position.y = 0.9
  group.add(body)

  // A cone marks the facing direction, so orientation is readable while testing.
  // Avatar-local +Z is forward: Object3D.lookAt aligns local +Z with its target
  // (only Camera and Light use -Z), and main.ts calls avatar.object.lookAt(...) on
  // this plain Group. ConeGeometry's apex sits at +Y before rotation; rotation.x =
  // Math.PI / 2 carries that apex to +Z, so it already points the correct way —
  // only the position was on the wrong side (the character's back, not its front).
  const nose = new Mesh(
    new ConeGeometry(0.22, 0.5, 8),
    new MeshLambertMaterial({ color: 0xd9863f }),
  )
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 1.1, 0.45)
  group.add(nose)

  return group
}

/**
 * Size a loaded model to the placeholder and seat its feet at y = 0.
 *
 * Model authors pick their own units, and the numbers are not guessable: this
 * character exports 5.2594 units tall, with a scale of 100 on its armature node
 * and raw vertex bounds spanning only 0.08. So the height is measured through
 * the built scene graph rather than assumed, which also means a replacement
 * model needs no retuning. The transform lands on the wrapper, never on the
 * avatar root, because the glider is a child of that root.
 */
function fitToPlaceholder(wrapper: Object3D, model: Object3D): void {
  const box = new Box3().setFromObject(model)
  const height = box.max.y - box.min.y
  if (!Number.isFinite(height) || height <= 0) return

  const scale = TARGET_HEIGHT / height
  wrapper.scale.setScalar(scale)
  wrapper.position.y = -box.min.y * scale
}

export function createAvatar() {
  const object: Object3D = new Group()
  const placeholder = createPlaceholder()
  object.add(placeholder)

  let mixer: AnimationMixer | null = null
  let clips = new Map<AnimationName, { clip: AnimationClip; freeze: boolean }>()
  let current: AnimationName | null = null

  return {
    object,

    /** Swap the placeholder for a real model once it has loaded. */
    attachModel(gltf: GLTF): void {
      // Remove only the placeholder we added, not every child: main.ts also parents
      // the glider under this object, and object.clear() would delete it too,
      // silently orphaning it from the scene graph.
      object.remove(placeholder)

      // The model gets its own wrapper so scaling it cannot touch the glider.
      const modelRoot = new Group()
      modelRoot.add(gltf.scene)
      fitToPlaceholder(modelRoot, gltf.scene)
      modelRoot.rotation.y = MODEL_YAW
      object.add(modelRoot)

      mixer = new AnimationMixer(gltf.scene)
      const byName = new Map(gltf.animations.map((clip) => [clip.name, clip]))
      clips = new Map()
      for (const [state, plan] of planClips(gltf.animations.map((c) => c.name))) {
        const clip = byName.get(plan.source)
        if (clip) clips.set(state, { clip, freeze: plan.freeze })
      }
      current = null
    },

    setAnimation(name: AnimationName): void {
      if (name === current) return
      const entry = clips.get(name)
      if (!mixer || !entry) {
        // No model or no matching clip: the placeholder simply does not animate.
        current = name
        return
      }
      const next = mixer.clipAction(entry.clip)
      if (current) {
        const previous = clips.get(current)
        if (previous) mixer.clipAction(previous.clip).fadeOut(FADE_SECONDS)
      }
      next.reset().fadeIn(FADE_SECONDS).play()
      current = name
    },

    update(dt: number): void {
      mixer?.update(dt)
    },
  }
}
