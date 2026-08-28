import {
  Color, Group, MathUtils, Mesh, RingGeometry, type Object3D,
} from 'three'
import { vortexRadius, vortexCharge, type VortexConfig } from '../combat/vortex'
import { createEffectMaterial } from './effect-material'
import { safeScale } from './scale'

/**
 * The ring that shows what a held Vortex will catch.
 *
 * A charged move whose reach is invisible until it fires cannot be aimed, and this repo
 * treats a mechanic the player cannot see as a bug. Persistent rather than an `Effect`
 * because it lives as long as the button is held, which is not a one-shot.
 *
 * Shares its shader body's rotation with `vortex-ring.ts` — a held charge and a fired ring are
 * one move, not two, and giving the charge a static ring while the fired ring spins would say
 * so. What is unique to the charge is the leading edge sharpening as `charge` climbs toward 1,
 * which is the thing a held vortex has that a fired one does not: a fill level.
 */
export interface VortexChargeTell {
  object: Object3D
  /** Call every frame with how long the charge has been held. */
  update(dt: number, heldSeconds: number, c: VortexConfig): void
  dispose(): void
}

const THICKNESS = 0.06
const HEIGHT = 0.5

/**
 * The tell's peak alpha, before the charge fraction and the shader's own falloff take their
 * bite. Exported so `vortex-charge.test.ts` can pin it: this ring carries no separate quiet
 * element the way `gust-cone.ts`'s fill does, so there is nothing else in this file for a
 * "stays quiet" guard to check — the guard here is that gameplay opacity does not silently
 * drift instead.
 */
export const PEAK_OPACITY = 0.55

/**
 * The tell's tint, bright enough on its own to clear `post.ts`'s bloom threshold.
 *
 * Shared with `vortex-ring.ts` deliberately: the charge and the fired ring are one move, and a
 * held charge that bloomed a different colour than its own release would read as two effects.
 * `vortex-ring.ts` carries the measurement — `0x9fd9ff` raised to `0x9fffff` by lifting only
 * green (the dominant weight in the bloom luminance formula), landing at luminance ≈ 0.861,
 * clearing the 0.82 threshold by ≈ 0.041.
 */
const TINT = 0x9fffff

/**
 * The same rotation `vortex-ring.ts` uses, with a leading edge that sharpens as `charge` rises.
 *
 * At `charge` 0 the lit band covers the last 15% of the loop; at `charge` 1 it covers the last
 * 35%, so the ring reads as filling up rather than merely spinning faster. `lead`'s width is
 * the tell for how close the hold is to full charge, which a uniform rotation speed alone would
 * not carry — the player would have to watch the radius grow instead, which is a much smaller
 * signal at low charge, right when knowing "not yet" matters most.
 */
const CHARGE_BODY = /* glsl */ `
    float around = fract(vUv.x - time * 0.8);
    float lead = smoothstep(1.0 - 0.15 - charge * 0.2, 1.0, around);
    gl_FragColor = vec4(tint, alpha * (0.4 + 0.6 * lead));
`

export function createVortexChargeTell(): VortexChargeTell {
  const object = new Group()
  const geometry = new RingGeometry(1 - THICKNESS, 1, 64)
  const material = createEffectMaterial({
    body: CHARGE_BODY,
    uniforms: {
      tint: new Color(TINT), alpha: PEAK_OPACITY, time: 0, charge: 0,
    },
  })
  // Matches every other flat tell in this directory: a ring near the ground is otherwise
  // buried by any slope. The builder has no `depthTest` option (`air-wall.ts` explains why),
  // so it is set here directly instead.
  material.depthTest = false
  const ring = new Mesh(geometry, material)
  ring.rotation.x = -Math.PI / 2
  ring.userData.excludeFromShadows = true
  object.add(ring)
  object.position.y = HEIGHT
  object.visible = false

  let time = 0

  return {
    object,
    update(dt: number, heldSeconds: number, c: VortexConfig): void {
      // Advances even while hidden, so the rotation is wall-clock rather than restarting from
      // zero the instant a new charge begins — a shader with a discontinuous `time` on every
      // press would jump-cut its own animation.
      time += dt
      object.visible = heldSeconds > 0
      if (!object.visible) return
      const charge = vortexCharge(heldSeconds, c)
      ring.scale.setScalar(safeScale(vortexRadius(charge, c)))
      // Brightens as it fills, so the moment it is worth releasing is visible.
      material.uniforms.alpha!.value = PEAK_OPACITY * MathUtils.lerp(0.45, 1, charge)
      material.uniforms.time!.value = time
      material.uniforms.charge!.value = charge
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
