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

/**
 * Where in a borrowed clip a frozen pose sits. The jump clip is 1.000s long, so
 * halfway through is its airborne portion rather than the crouch or the landing.
 */
const FREEZE_TIME = 0.5

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
 *
 * Returns the transform it applied, so the squash can compose with it rather
 * than overwrite it.
 */
function fitToPlaceholder(
  wrapper: Object3D,
  model: Object3D,
): { scale: number; offsetY: number } {
  const box = new Box3().setFromObject(model)
  const height = box.max.y - box.min.y
  if (!Number.isFinite(height) || height <= 0) return { scale: 1, offsetY: 0 }

  const scale = TARGET_HEIGHT / height
  const offsetY = -box.min.y * scale
  wrapper.scale.setScalar(scale)
  wrapper.position.y = offsetY
  return { scale, offsetY }
}

export function createAvatar() {
  const object: Object3D = new Group()
  const placeholder = createPlaceholder()
  object.add(placeholder)

  let mixer: AnimationMixer | null = null
  let clips = new Map<AnimationName, { clip: AnimationClip; freeze: boolean }>()
  let current: AnimationName | null = null
  let modelRoot: Object3D | null = null
  // The fit transform the squash multiplies into, so squashing never discards it.
  let fitScale = 1
  let fitOffsetY = 0
  let squash = 1

  /**
   * Apply the squash to whichever visual currently stands in for the character.
   * It targets that wrapper rather than `object`, because the glider is a child
   * of `object` and scaling there would compress the staff too.
   *
   * The model's vertical offset scales alongside its height. That offset exists
   * to lift a model whose lowest vertex sits above its own origin, so leaving it
   * fixed while shrinking the model drops the feet through the ground — a crouch
   * has to compress towards the feet, not around them.
   */
  function applySquash(): void {
    if (modelRoot) {
      modelRoot.scale.y = fitScale * squash
      modelRoot.position.y = fitOffsetY * squash
    } else {
      placeholder.scale.y = squash
    }
  }

  return {
    object,

    /** Swap the placeholder for a real model once it has loaded. */
    attachModel(gltf: GLTF): void {
      // Remove only the placeholder we added, not every child: main.ts also parents
      // the glider under this object, and object.clear() would delete it too,
      // silently orphaning it from the scene graph.
      object.remove(placeholder)

      // A second call would otherwise leave the previous model's wrapper parented
      // (object.remove(placeholder) is a no-op the second time around) and drop
      // its mixer without stopping its actions.
      if (modelRoot) object.remove(modelRoot)
      mixer?.stopAllAction()

      // The model gets its own wrapper so scaling it cannot touch the glider.
      modelRoot = new Group()
      modelRoot.add(gltf.scene)
      ;({ scale: fitScale, offsetY: fitOffsetY } = fitToPlaceholder(modelRoot, gltf.scene))
      modelRoot.rotation.y = MODEL_YAW
      object.add(modelRoot)
      // A squash already in progress must carry over to the new model, or a jump
      // charged while the model was still loading would pop back to full height.
      applySquash()

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
      const previous = current ? clips.get(current) : undefined
      if (previous && previous.clip === entry.clip) {
        // Two states can share one clip (fall and glide both borrow Jump when no
        // glide clip exists), and mixer.clipAction(clip) returns the same
        // AnimationAction for the same clip — so this is not a transition
        // between two actions but the same action continuing under a new name.
        // Fading it out and back in would fade it against itself: reset()
        // calls stopFading(), cancelling the fadeOut before it does anything,
        // and the weight ramping 0→1 during fadeIn leaves the remainder of the
        // blend (1 − weight) filled from the bind pose saved by
        // PropertyMixer.saveOriginalState, snapping the skeleton to bind pose
        // for a frame before easing back into the held pose. Keep the action's
        // current weight and time instead of restarting its fade.
        next.stopFading()
        next.setEffectiveWeight(1)
        next.paused = false
        next.enabled = true
        next.play()
      } else {
        if (previous) mixer.clipAction(previous.clip).fadeOut(FADE_SECONDS)
        next.reset().fadeIn(FADE_SECONDS).play()
      }
      // A frozen state has no clip of its own — it holds one frame of a borrowed
      // one. timeScale = 0 stops playback while leaving the fade's weight
      // blending to run, where `paused` would stall that too. Restoring 1 is not
      // optional: fall and glide share the jump clip, and therefore share one
      // action, so a glide that left timeScale at 0 would freeze falling as well.
      next.timeScale = entry.freeze ? 0 : 1
      if (entry.freeze) next.time = FREEZE_TIME
      current = name
    },

    /**
     * Vertically compress the character, for the charge-jump crouch. 1 is
     * unsquashed. This deliberately does not touch `object`: the glider hangs
     * off `object`, so squashing there would compress the staff too.
     */
    setSquash(scaleY: number): void {
      squash = scaleY
      applySquash()
    },

    update(dt: number): void {
      mixer?.update(dt)
    },
  }
}
