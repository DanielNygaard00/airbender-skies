import {
  BackSide, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, type Object3D,
} from 'three'

/**
 * The shell of air around the character while the Avatar State runs.
 *
 * Deliberately not an Effect: an Effect self-terminates, and this lasts exactly as long as
 * the state does. It takes the shape the glider already uses instead — a long-lived child
 * of the avatar with an update that is told whether it should be showing.
 *
 * It must be added as a child of `avatar.object`, alongside the glider, and NOT of the
 * model. docs/HANDOFF.md records why: the model lives in an inner wrapper that absorbs
 * fitting and squash, and anything parented there would be squashed with it.
 */
export interface AvatarAura {
  object: Object3D
  /** Call every frame with whether the state is running. */
  update(dt: number, active: boolean): void
  dispose(): void
}

const RADIUS = 1.35
/** Centred on the character's middle, since the avatar's origin is at its feet. */
const HEIGHT = 1
const PEAK_OPACITY = 0.3
/** Snaps on, eases off — the state should arrive hard and leave as a wind-down. */
const FADE_IN_SECONDS = 0.15
const FADE_OUT_SECONDS = 0.4
const TINT = 0xfff3c4

export function createAvatarAura(): AvatarAura {
  const geometry = new SphereGeometry(RADIUS, 20, 14)
  const material = new MeshBasicMaterial({
    color: TINT,
    transparent: true,
    // Inside-out, so the shell reads as air around the character rather than a bubble
    // drawn over them.
    side: BackSide,
    depthWrite: false,
    opacity: 0,
  })

  const mesh = new Mesh(geometry, material)
  mesh.position.y = HEIGHT
  mesh.userData.excludeFromShadows = true
  mesh.visible = false

  /** 0 to 1, independent of the peak opacity so the fade curve is easy to reason about. */
  let lit = 0

  return {
    object: mesh,
    update(dt: number, active: boolean): void {
      const seconds = active ? FADE_IN_SECONDS : FADE_OUT_SECONDS
      const step = seconds > 0 ? dt / seconds : 1
      lit = MathUtils.clamp(active ? lit + step : lit - step, 0, 1)
      material.opacity = PEAK_OPACITY * lit
      // Skipped entirely when invisible, so it costs nothing the rest of the time.
      mesh.visible = lit > 0.001
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
