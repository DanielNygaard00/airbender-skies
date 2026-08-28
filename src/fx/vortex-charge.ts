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
 *
 * **`RingGeometry`'s own UVs are a trap here too**, and it is the same trap `vortex-ring.ts`
 * documents at length: they are a Cartesian projection of each vertex
 * (`uv = (position / outerRadius + 1) / 2`), not polar, so `vUv.x` alone does not run around the
 * ring. An earlier draft drove the leading edge straight off `vUv.x` with no radial term at all,
 * which puts the lit band at both the top and bottom of the ring at the same time, in lockstep —
 * two mirrored bands, not one travelling edge. `CHARGE_BODY` below re-derives an actual angle and
 * radius from the centred UV first, the same derivation `vortex-ring.ts` uses.
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
 * The same polar derivation `vortex-ring.ts` uses, with a leading edge that sharpens as `charge`
 * rises instead of a travelling streak.
 *
 * At `charge` 0 the lit band covers the last 15% of the loop; at `charge` 1 it covers the last
 * 35%, so the ring reads as filling up rather than merely spinning faster. `lead`'s width is
 * the tell for how close the hold is to full charge, which a uniform rotation speed alone would
 * not carry — the player would have to watch the radius grow instead, which is a much smaller
 * signal at low charge, right when knowing "not yet" matters most.
 *
 * `edge`'s thresholds are this ring's own, not copied from `vortex-ring.ts` unchanged: this
 * ring's `THICKNESS` is 0.06 against the fired ring's 0.3, so in the recentred-UV radius the
 * whole visible band sits between 0.94 and 1.0 rather than 0.7 and 1.0. Reusing the fired
 * ring's `(0.35, 0.7)` / `(1.05, 0.8)` bands verbatim would land almost entirely outside that
 * narrow window, leaving `edge` a near-flat 0.2–0.44 across the whole ring instead of an actual
 * taper. `(0.91, 0.97)` / `(1.03, 0.97)` centres a feather of half-width 0.03 — half this ring's
 * own thickness — on each true edge (0.94 and 1.0), so the band is brightest at its centre
 * (`edge` ≈ 1 at radius 0.97) and tapers to half brightness at both the inner and outer rim.
 */
const CHARGE_BODY = /* glsl */ `
    vec2 p = vUv * 2.0 - 1.0;
    float radius = length(p);
    float angle = atan(p.y, p.x) / 6.2832 + 0.5;
    float lead = smoothstep(1.0 - 0.15 - charge * 0.2, 1.0, fract(angle - time * 0.8));
    float edge = smoothstep(0.91, 0.97, radius) * smoothstep(1.03, 0.97, radius);
    gl_FragColor = vec4(tint, alpha * (0.4 + 0.6 * lead) * edge);
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
