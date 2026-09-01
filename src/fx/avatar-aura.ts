import {
  BackSide, Color, MathUtils, Mesh, SphereGeometry, type Object3D,
} from 'three'
import { createEffectMaterial } from './effect-material'

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

/**
 * A bright silhouette and a dim interior, so the shell reads as a surface and not a wash.
 *
 * `guard-shell.ts`'s `SHELL_BODY` — byte-identical to this one — carries the full argument:
 * why the edge has to be read off `vViewNormal` rather than object space (pointing at
 * `ice-shell.ts` in turn), why `abs` is required for a `BackSide` mesh, why there is no `time`
 * uniform, why the two files duplicate this body rather than sharing it, and why `0.35` replaces
 * the arc bodies' `0.18` here with both fractions computed against both tints. None of that is
 * restated in this file.
 */
const SHELL_BODY = /* glsl */ `
    vec3 n = normalize(vViewNormal);
    float grazing = 1.0 - abs(n.z);
    float core = smoothstep(0.30, 0.70, grazing);
    gl_FragColor = vec4(mix(tint * 0.35, tint, core), alpha * max(core, 0.30));
`

export function createAvatarAura(): AvatarAura {
  const geometry = new SphereGeometry(RADIUS, 20, 14)
  const material = createEffectMaterial({
    body: SHELL_BODY,
    uniforms: { tint: new Color(TINT), alpha: 0 },
    // Inside-out, so the shell reads as air around the character rather than a bubble
    // drawn over them. `depthTest` is left at the builder's own default of `true`, for
    // `air-wall.ts`'s reason: this shell extends as far below the character's footing as
    // above it, and the depth test is what keeps that underground half hidden by the ground.
    side: BackSide,
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
      material.uniforms.alpha!.value = PEAK_OPACITY * lit
      // Skipped entirely when invisible, so it costs nothing the rest of the time.
      mesh.visible = lit > 0.001
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
