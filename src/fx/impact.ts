import {
  DoubleSide, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, Vector3,
} from 'three'
import type { Effect } from './effect'

/**
 * The burst where a blow lands.
 *
 * A connect and a down are deliberately different in kind, not just in size: a connect is
 * quick and tight, a down is broad and slow. Both are pale rather than red, because the
 * design document's non-lethality is meant to be encoded by the systems rather than
 * mentioned, and a red splash would say the opposite of what a downed enemy means.
 */
export type ImpactKind = 'hit' | 'down'

/** Above the enemy's own origin, which is at its feet. */
const HEIGHT = 0.9
const START_FRACTION = 0.25

interface Shape {
  radius: number
  lifetime: number
  opacity: number
  tint: number
}

const SHAPES: Record<ImpactKind, Shape> = {
  hit: { radius: 1.1, lifetime: 0.18, opacity: 0.55, tint: 0xdff1ff },
  down: { radius: 2.3, lifetime: 0.45, opacity: 0.4, tint: 0xfff3d8 },
}

export function createImpact(position: Vector3, kind: ImpactKind): Effect {
  const shape = SHAPES[kind]

  // A unit sphere scaled at runtime, so growing costs a scale rather than a rebuild.
  const geometry = new SphereGeometry(1, 18, 12)
  const material = new MeshBasicMaterial({
    color: shape.tint, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: shape.opacity,
  })

  const mesh = new Mesh(geometry, material)
  // Copied before the offset is applied: the caller hands us an enemy's live position
  // vector, and writing the height into it would teleport the enemy upward.
  mesh.position.copy(position)
  mesh.position.y += HEIGHT
  mesh.userData.excludeFromShadows = true

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / shape.lifetime, 0, 1)
    mesh.scale.setScalar(MathUtils.lerp(START_FRACTION * shape.radius, shape.radius, t))
    material.opacity = shape.opacity * (1 - t)
  }

  apply()

  return {
    object: mesh,
    advance(dt: number): boolean {
      age += dt
      apply()
      return age < shape.lifetime
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
