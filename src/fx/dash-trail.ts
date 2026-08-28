import {
  BoxGeometry, Color, Group, MathUtils, Mesh, Vector3,
} from 'three'
import type { GroundConfig } from '../core/types'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { safeScale } from './scale'

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

/**
 * The streak's own tint, bright enough on its own to clear `post.ts`'s bloom threshold.
 *
 * This trail has no quiet companion mesh the way `gust-cone.ts`'s fill-plus-arc pair does — it
 * is the whole visible effect, so it has to carry the bloom itself. Air's canonical cyan,
 * `0x7fe4ff`, measures `{ r: 0.212, g: 0.776, b: 1 }`, luminance ≈ 0.672 — well under the 0.82
 * threshold on its own.
 *
 * Measured the way `post.ts`'s threshold actually reads it: `new Color(hex)` and
 * `0.2126*c.r + 0.7152*c.g + 0.0722*c.b`, the linear values three's sRGB decoding produces —
 * not hex-divided-by-255. Green carries the dominant weight in that formula (0.7152, against
 * red's 0.2126), so the cheap way to clear the threshold is to raise green rather than lift
 * every channel toward white — the same correction `gust-cone.ts`'s `ARC_TINT` records, and in
 * fact the same resulting value: `0x99ffff` measures `{ r: 0.319, g: 1, b: 1 }`, luminance ≈
 * 0.855, clearing 0.82 by ≈ 0.035 while red stays well below green and blue, so it still reads
 * as the same cyan family, not as white.
 */
const TINT = 0x99ffff

/** Length and opacity multipliers from the first dash of a chain to the last. */
const FIRST_LENGTH = 0.8
const LAST_LENGTH = 1.35
/**
 * The streak's peak opacity at either end of the chain, before the shader's own streak-and-edge
 * falloff take their bite.
 *
 * Exported so `dash-trail.test.ts` can pin them: this trail carries no separate quiet element
 * the way `gust-cone.ts`'s fill does, so there is nothing else in this file for a "stays quiet"
 * guard to check — the guard here is that gameplay opacity does not silently drift instead.
 */
export const FIRST_OPACITY = 0.45
export const LAST_OPACITY = 0.85

/**
 * The distance an impulse of `dashSpeed` covers while `easeHorizontal` bleeds it off at
 * `groundResponse` -- which is what the dash actually does. It used to be sized from
 * `dashSpeed * dashDurationSeconds`, 5.72 m, for a dash that covers 3.94 m: that config
 * value looked live and the simulation never read it, so it has been deleted.
 *
 * Authority is taken as 1, the on-foot case: drawn length is then within half a frame's
 * travel of a real on-foot dash (3.935 m measured against 3.714 m drawn). Riding a
 * scooter is not free of this gap. Authority scales `groundResponse` directly, so it
 * scales the decay time constant the same way: a scooter dash travels roughly twice as
 * far at charge 0 (8.094 m measured, authority 0.5) and four times as far at charge 1
 * (14.620 m measured, authority 0.25) as the figure this trail draws. The trail is
 * deliberately not resized for either case -- it is drawn for the common, on-foot case,
 * and scaling it live would need the rider's charge threaded down to an effect that
 * currently only takes the static config.
 *
 * Exported so a test can compare it against a dash actually driven through `groundStep`,
 * rather than only checking this formula against itself.
 */
export function trailLength(c: GroundConfig): number {
  return c.dashSpeed / c.groundResponse
}

/**
 * The streak's brightness, run along the trail's own length and broken up so it reads as a
 * burst rather than a uniformly-lit slab.
 *
 * The streak is built from a `BoxGeometry`, and a box's UVs are per-face — each of its six
 * faces carries its own independent 0..1 square, so `vUv.x` means a different axis depending
 * on which face a fragment is on: a body written against it would run along the trail on two
 * faces and across it on the other four. `vLocal.z`, `effect-material.ts`'s object-space
 * varying, does not have that problem — it is the box's own length axis regardless of face, so
 * `along01` (`vLocal.z + 0.5`, undoing the box's -0.5..0.5 span) is the coordinate this body
 * actually needs. `along` fades both ends so the slab does not read as a hard-edged rectangle;
 * `streak` is a travelling sine rather than a texture, the same cheap-hash convention
 * `gust-cone.ts`'s `ARC_BODY` and `shockwave.ts`'s `RING_BODY` both use in place of one.
 */
const TRAIL_BODY = /* glsl */ `
    float along01 = vLocal.z + 0.5;
    float along = smoothstep(0.0, 0.25, along01) * smoothstep(1.0, 0.55, along01);
    float streak = 0.7 + 0.3 * sin(along01 * 26.0 - time * 12.0);
    gl_FragColor = vec4(tint, alpha * along * streak);
`

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

  const covered = trailLength(c)
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
  const material = createEffectMaterial({
    body: TRAIL_BODY,
    uniforms: { tint: new Color(TINT), alpha: peak, time: 0 },
  })
  // Every other flat tell in this directory sets this false for the same reason: a low slab
  // near the ground is otherwise buried by terrain that slopes up. The builder has no
  // `depthTest` option (`air-wall.ts` explains why), so it is set here directly instead.
  material.depthTest = false
  const streak = new Mesh(geometry, material)
  streak.scale.z = safeScale(length)
  // Pushed forward by half its length so it starts at the origin rather than straddling it.
  streak.position.z = length / 2
  streak.userData.excludeFromShadows = true
  group.add(streak)

  let age = 0

  function apply(): void {
    const progress = MathUtils.clamp(age / LIFETIME, 0, 1)
    material.uniforms.alpha!.value = peak * (1 - progress)
    // Drives the streak in TRAIL_BODY. Raw elapsed age, not scaled here, because the shader's
    // own `time * 12.0` already sets the travel speed — the same convention `gust-cone.ts`,
    // `vortex-ring.ts` and `shockwave.ts` all use for their own time uniform.
    material.uniforms.time!.value = age
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
