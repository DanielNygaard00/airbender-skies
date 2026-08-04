import {
  BackSide, Group, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, type Object3D,
} from 'three'

/**
 * The shell shown while a Slipstream's invulnerability window is open.
 *
 * The window is the entire mechanic, and it is 0.11 seconds long — so the tell has to
 * track it exactly. A shell that lingered would tell the player they were protected
 * when they were not, which is worse than no tell at all.
 */
export interface GuardShell {
  object: Object3D
  /** Call every frame with whether the window is open. */
  update(dt: number, active: boolean): void
  dispose(): void
}

const RADIUS = 1.15
/** Centred on the body, since the avatar's origin is at its feet. */
const CENTRE_Y = 0.95
const TINT = 0xd6f6ff
const PEAK_OPACITY = 0.4
/** Short, because the 0.11s window is brief and a slow fade-in eats a chunk of it
 * before the tell is even readable. */
const FADE_IN_SECONDS = 0.02
/** Bounded to a small fraction of `invulnerableSeconds`: this tail must not outlive
 * the protection, so it decays close enough to instantly that a player never sees a
 * glow they can no longer act on. */
const FADE_OUT_SECONDS = 0.03

export function createGuardShell(): GuardShell {
  const object = new Group()
  const geometry = new SphereGeometry(RADIUS, 20, 14)
  const material = new MeshBasicMaterial({
    color: TINT, transparent: true, side: BackSide, depthWrite: false, opacity: 0,
  })
  const shell = new Mesh(geometry, material)
  shell.userData.excludeFromShadows = true
  object.add(shell)
  object.position.y = CENTRE_Y
  object.visible = false

  let shown = 0

  return {
    object,
    update(dt: number, active: boolean): void {
      const seconds = active ? FADE_IN_SECONDS : FADE_OUT_SECONDS
      const step = seconds > 0 ? dt / seconds : 1
      shown = active
        ? Math.min(1, shown + step)
        : Math.max(0, shown - step)
      material.opacity = PEAK_OPACITY * MathUtils.clamp(shown, 0, 1)
      object.visible = shown > 0.001
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
