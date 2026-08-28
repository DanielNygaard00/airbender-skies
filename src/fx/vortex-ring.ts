import { Color, MathUtils, Mesh, RingGeometry, Vector3 } from 'three'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { safeScale } from './scale'

/**
 * The air a Vortex gathers, drawn at the radius it actually caught.
 *
 * Sweeps inward, which is the visual contrast with the Pressure Wave's ring going out:
 * one gathers a group, the other scatters it. Drawn at the true `vortexRadius` for the
 * same reason the gust cone is drawn at its true hit volume — a pull that reaches
 * outside the visible ring reads as a bug.
 *
 * The closing sweep alone reads as a hoop shrinking, which is a shape, not a force. A second
 * motion around the ring — streaks travelling along its circumference while the ring itself
 * travels inward — is what turns it into something that reads as a pull rather than a wipe,
 * the same two-axes trick `gust-cone.ts`'s travelling arc uses on its own outward sweep.
 *
 * **`RingGeometry`'s own UVs are a trap for exactly this.** They are not polar — three.js
 * builds them as a Cartesian projection of each vertex, `uv = (position / outerRadius + 1) /
 * 2` — so `vUv.x` alone does not run around the ring; it runs left-to-right across it like an
 * ordinary quad. An earlier draft of this file drove the streak straight off `vUv.x` and wrote
 * a `vUv.y`-based vignette on top, which reads as a static top/bottom-dark ring with bands
 * scanning horizontally, not as rotation. `RING_BODY` below re-derives an actual angle and
 * radius from the centred UV first (`p = vUv * 2 - 1`, `atan(p.y, p.x)`), which is what makes
 * `fract(angle - time * ...)` wrap continuously around a full turn.
 */
const LIFETIME = 0.45
const THICKNESS = 0.3
/** How far in the ring travels: not to nothing, so it stays legible as it closes. */
const END_FRACTION = 0.15
const HEIGHT = 0.6
/**
 * The ring's peak alpha, before the shader's own streak-and-edge falloff take their bite.
 *
 * Exported so `vortex-ring.test.ts` can pin it: this ring carries no separate quiet element the
 * way `gust-cone.ts`'s fill does, so there is nothing else in this file for a "stays quiet"
 * guard to check — the guard here is that gameplay opacity does not silently drift instead.
 */
export const OPACITY = 0.75

/**
 * The ring's tint, bright enough on its own to clear `post.ts`'s bloom threshold.
 *
 * This ring has no quiet companion mesh the way `gust-cone.ts`'s fill-plus-arc pair does — it
 * is the whole visible effect, so it has to carry the bloom itself rather than handing that job
 * to a second, brighter element.
 *
 * Measured the way `post.ts`'s threshold actually reads it: `new Color(hex)` and
 * `0.2126*c.r + 0.7152*c.g + 0.0722*c.b`, the linear values three's sRGB decoding produces —
 * not hex-divided-by-255. The original `0x9fd9ff` measures `{ r: 0.347, g: 0.694, b: 1 }`,
 * luminance ≈ 0.642 — under the 0.82 threshold, so it would neither bloom nor read as the
 * bright element the move needs.
 *
 * Green carries the dominant weight in that formula (0.7152, against red's 0.2126), so the
 * cheap way to clear the threshold is to raise green alone rather than lift every channel
 * toward white — the same correction `gust-cone.ts`'s `ARC_TINT` records. Taking `0x9fd9ff`'s
 * green from `0xd9` to `0xff` and leaving red and blue untouched gives `0x9fffff`:
 * `{ r: 0.347, g: 1, b: 1 }`, luminance ≈ 0.861, clearing 0.82 by ≈ 0.041 while red stays well
 * below green and blue, so it still reads as the same periwinkle-cyan as the original, not as
 * white.
 */
const TINT = 0x9fffff

/**
 * Streaks travelling around the circumference, with the ring's own inward scale left to `apply`.
 *
 * `angle`, derived from the UV recentred to `[-1, 1]`, runs 0 to 1 once around the full turn, so
 * `fract(angle * 3.0 - time * 1.1)` wraps continuously and the streak genuinely travels the loop
 * rather than scanning across a flat quad — the mesh shrinks inward while the streak circles it,
 * two motions at once, which is what a pull looks like and what a uniformly fading ring does not.
 * `radius`, the other half of the same polar derivation, replaces a `vUv.y` vignette (which would
 * mirror across the ring's two poles, per this file's own doc comment) with a true radial taper
 * across the ring's thickness — brightest toward the inner edge, fading toward the outer rim, so
 * the light itself leans the way the ring is pulling.
 */
const RING_BODY = /* glsl */ `
    vec2 p = vUv * 2.0 - 1.0;
    float radius = length(p);
    float angle = atan(p.y, p.x) / 6.2832 + 0.5;
    float streak = smoothstep(0.35, 1.0, fract(angle * 3.0 - time * 1.1));
    float edge = smoothstep(0.35, 0.7, radius) * smoothstep(1.05, 0.8, radius);
    gl_FragColor = vec4(tint, alpha * (0.35 + 0.65 * streak) * edge);
`

export function createVortexRing(origin: Vector3, radius: number): Effect {
  const geometry = new RingGeometry(1 - THICKNESS, 1, 48)
  const material = createEffectMaterial({
    body: RING_BODY,
    uniforms: { tint: new Color(TINT), alpha: OPACITY, time: 0 },
    // Every other flat tell in this directory asks for this for the same reason: a ring drawn
    // a little above the ground is otherwise buried by any slope.
    depthTest: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.copy(origin)
  mesh.position.y += HEIGHT
  mesh.userData.excludeFromShadows = true

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    mesh.scale.setScalar(safeScale(MathUtils.lerp(radius, radius * END_FRACTION, t)))
    material.uniforms.alpha!.value = OPACITY * (1 - t * t)
    // Drives the sweep in `RING_BODY`. Raw elapsed age, not scaled here, because the shader's
    // own `time * 1.1` already sets the travel speed.
    material.uniforms.time!.value = age
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
