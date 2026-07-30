import {
  Object3D, Group, Mesh, CapsuleGeometry, ConeGeometry,
  MeshLambertMaterial, AnimationMixer, type AnimationClip,
} from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { AnimationName } from './avatar-anim'

const FADE_SECONDS = 0.18

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
  const nose = new Mesh(
    new ConeGeometry(0.22, 0.5, 8),
    new MeshLambertMaterial({ color: 0xd9863f }),
  )
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 1.1, -0.45)
  group.add(nose)

  return group
}

export function createAvatar() {
  const object: Object3D = new Group()
  object.add(createPlaceholder())

  let mixer: AnimationMixer | null = null
  let clips = new Map<AnimationName, AnimationClip>()
  let current: AnimationName | null = null

  return {
    object,

    /** Swap the placeholder for a real model once it has loaded. */
    attachModel(gltf: GLTF): void {
      object.clear()
      object.add(gltf.scene)
      mixer = new AnimationMixer(gltf.scene)
      clips = new Map()
      for (const clip of gltf.animations) {
        const name = clip.name.toLowerCase() as AnimationName
        clips.set(name, clip)
      }
      current = null
    },

    setAnimation(name: AnimationName): void {
      if (name === current) return
      const clip = clips.get(name)
      if (!mixer || !clip) {
        // No model or no matching clip: the placeholder simply does not animate.
        current = name
        return
      }
      const next = mixer.clipAction(clip)
      if (current) {
        const previous = clips.get(current)
        if (previous) mixer.clipAction(previous).fadeOut(FADE_SECONDS)
      }
      next.reset().fadeIn(FADE_SECONDS).play()
      current = name
    },

    update(dt: number): void {
      mixer?.update(dt)
    },
  }
}
