import {
  DoubleSide, MathUtils, Mesh, MeshBasicMaterial, RingGeometry, type Object3D,
} from 'three'

/**
 * The ring a Pressure Wave leaves on the ground.
 *
 * This repo treats a wind feature the player cannot see as a bug, and an invisible
 * slam is the same mistake — especially here, where the strength of the slam is the
 * whole mechanic. So the ring carries the same information the damage does: a weak
 * slam is a faint ring, a full one is bright.
 */
export interface Shockwave {
  object: Object3D
  /** Advance the ring. False once it has finished and can be removed. */
  advance(dt: number): boolean
  /** Release the geometry and material. One ring is created per slam. */
  dispose(): void
}

const LIFETIME = 0.4
/** Fraction of the final radius the ring starts at. */
const START_FRACTION = 0.2
/** Ring thickness as a fraction of its radius. */
const THICKNESS = 0.35
/** Opacity of a minimum-strength slam, so a weak one is still visible. */
const FAINTEST = 0.25

export function createShockwave(radius: number, strength: number): Shockwave {
  // A unit ring scaled at runtime. Rebuilding the geometry each frame to grow it
  // would allocate sixty times a second for something a scale already does.
  const geometry = new RingGeometry(1 - THICKNESS, 1, 48)
  const material = new MeshBasicMaterial({
    color: 0xdff1ff,
    transparent: true,
    side: DoubleSide,
    // The ring sits on the ground and must not occlude what it overlaps.
    depthWrite: false,
  })

  const mesh = new Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.userData.excludeFromShadows = true

  const peak = MathUtils.lerp(FAINTEST, 1, MathUtils.clamp(strength, 0, 1))
  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    mesh.scale.setScalar(Math.max(MathUtils.lerp(START_FRACTION * radius, radius, t), 1e-4))
    material.opacity = peak * (1 - t)
  }

  apply()

  return {
    object: mesh,
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
