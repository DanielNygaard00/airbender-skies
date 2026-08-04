import {
  BoxGeometry, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import type { GroundConfig } from '../core/types'
import type { Effect } from './effect'

/**
 * The streak an air blast dash leaves behind.
 *
 * Its length comes from the distance the dash actually covers, so the mark on the ground
 * is the ground the burst crossed. Its brightness and length also grow with the chain
 * index, which is not decoration: the chain count is information the player currently has
 * no way to read, and the recovery after the third dash is otherwise a mystery.
 */
const LIFETIME = 0.3
/** Off the ground, so terrain does not swallow it. */
const HEIGHT = 0.5
const WIDTH = 0.45
const THICKNESS = 0.12
const TINT = 0x7fe4ff
/** Length and opacity multipliers from the first dash of a chain to the last. */
const FIRST_LENGTH = 0.8
const LAST_LENGTH = 1.35
const FIRST_OPACITY = 0.45
const LAST_OPACITY = 0.85

export function createDashTrail(
  origin: Vector3,
  heading: Vector3,
  chain: number,
  c: GroundConfig,
): Effect {
  // Clamped, because a caller mis-reporting the chain index should look slightly wrong
  // rather than draw nothing or draw something enormous.
  const span = Math.max(1, c.maxDashChain - 1)
  const t = MathUtils.clamp((chain - 1) / span, 0, 1)

  const covered = c.dashSpeed * c.dashDurationSeconds
  const length = covered * MathUtils.lerp(FIRST_LENGTH, LAST_LENGTH, t)
  const peak = MathUtils.lerp(FIRST_OPACITY, LAST_OPACITY, t)

  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  const flat = new Vector3(heading.x, 0, heading.z)
  if (flat.lengthSq() > 1e-8) {
    group.lookAt(group.position.clone().add(flat.normalize()))
  }

  // A unit-length slab along +Z, scaled to the covered distance — so the streak can be
  // stretched without rebuilding geometry, and so tests can read the length off the scale.
  const geometry = new BoxGeometry(WIDTH, THICKNESS, 1)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false, opacity: peak,
    // Drawn over the world, for the same reason as the gust cone: a low slab near the
    // ground is buried by terrain that slopes up, which made it invisible in play.
    depthTest: false,
  })
  const streak = new Mesh(geometry, material)
  streak.scale.z = length
  // Pushed forward by half its length so it starts at the origin rather than straddling it.
  streak.position.z = length / 2
  streak.userData.excludeFromShadows = true
  group.add(streak)

  let age = 0

  function apply(): void {
    const progress = MathUtils.clamp(age / LIFETIME, 0, 1)
    material.opacity = peak * (1 - progress)
  }

  apply()

  return {
    object: group,
    advance(dt: number): boolean {
      age += dt
      apply()
      return age < LIFETIME
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
