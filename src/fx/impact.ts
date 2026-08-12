import {
  DoubleSide, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, Vector3,
} from 'three'
import type { Effect } from './effect'

/**
 * The burst where a blow lands, or fails to.
 *
 * A connect and a down are deliberately different in kind, not just in size: a connect is
 * quick and tight, a down is broad and slow. Both are pale rather than red, because the
 * design document's non-lethality is meant to be encoded by the systems rather than
 * mentioned, and a red splash would say the opposite of what a downed enemy means.
 *
 * `deflect` is the third, and it is the odd one out on purpose: it marks a blow that did
 * *nothing*, because a move with no damage, no push, no sound and no burst reads as a broken
 * game rather than as armour. It is the smallest, the shortest and the only cold grey of the
 * three, so the player learns "that bounced" rather than "that hit a bit". Section 4.4's heavy
 * armoured soldier is the whole reason it exists.
 */
export type ImpactKind = 'hit' | 'down' | 'deflect'

/** Above the enemy's own origin, which is at its feet. */
const HEIGHT = 0.9
const START_FRACTION = 0.25

export interface Shape {
  radius: number
  lifetime: number
  opacity: number
  tint: number
}

const SHAPES: Record<ImpactKind, Shape> = {
  hit: { radius: 1.1, lifetime: 0.18, opacity: 0.55, tint: 0xdff1ff },
  down: { radius: 2.3, lifetime: 0.45, opacity: 0.4, tint: 0xfff3d8 },
  /**
   * Smaller than a connect and shorter-lived, and cold grey where the other two are warm.
   *
   * Every number here is chosen *against* `hit` rather than in the abstract, because the one
   * thing this burst must not do is read as a weaker version of a connect — that would teach
   * the player that the gust is working badly rather than not working at all. So it is
   * decisively smaller (0.7 against 1.1), decisively faster (0.12 against 0.18) and the
   * brightest of the three at its peak, which together read as a spark off metal instead of a
   * puff of air. `impact-targets.test.ts` pins the size and lifetime comparisons rather than
   * the literals, so retuning `hit` drags this with it.
   */
  deflect: { radius: 0.7, lifetime: 0.12, opacity: 0.7, tint: 0xbcc4d2 },
}

/** The shape a given burst is drawn at. Exported so a test can compare two without a mesh. */
export function impactShape(kind: ImpactKind): Readonly<Shape> {
  return SHAPES[kind]
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
