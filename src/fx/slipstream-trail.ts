import { BoxGeometry, Color, FrontSide, Mesh, Vector3 } from 'three'
import type { SlipstreamConfig } from '../player/slipstream'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { safeScale } from './scale'

/**
 * The streak a Slipstream leaves.
 *
 * A cooler, sharper tint than the dash trail, because the two moves must not be
 * confused: one is traversal, the other is the dodge you bet a hit on. It also carries a
 * marked leading edge the dash trail does not — the invulnerability window is the whole
 * reason this move exists, and the edge is the only thing telling a player which of the
 * two they just spent.
 */
const LIFETIME = 0.26
const WIDTH = 0.5
const TALL = 1.5

/**
 * The trail's own tint, bright enough on its own to clear `post.ts`'s bloom threshold.
 *
 * This trail has no quiet companion mesh the way `gust-cone.ts`'s fill-plus-arc pair does — it
 * is the whole visible effect, so it has to carry the bloom itself. The original `0xc9f2ff`
 * measures `{ r: 0.584, g: 0.888, b: 1 }`, luminance ≈ 0.831 — already just over the 0.82
 * threshold, but by a margin (≈ 0.011) too thin to trust across GPUs.
 *
 * Measured the way `post.ts`'s threshold actually reads it: `new Color(hex)` and
 * `0.2126*c.r + 0.7152*c.g + 0.0722*c.b`, the linear values three's sRGB decoding produces —
 * not hex-divided-by-255. Green carries the dominant weight in that formula (0.7152, against
 * red's 0.2126), so the cheap way to buy real margin is to raise green alone, leaving red and
 * blue exactly as they were: `0xc9ffff` measures `{ r: 0.584, g: 1, b: 1 }`, luminance ≈ 0.912,
 * clearing 0.82 by ≈ 0.092. Red is untouched, so the trail stays the same pale, cooler cyan
 * relative to the dash trail's more saturated `0x99ffff` — the contrast the doc comment above
 * still relies on.
 */
const TINT = 0xc9ffff
/**
 * The trail's peak opacity, before the shader's own edge-and-lead falloff take their bite.
 *
 * Exported so `slipstream-trail.test.ts` can pin it: this trail carries no separate quiet
 * element the way `gust-cone.ts`'s fill does, so there is nothing else in this file for a
 * "stays quiet" guard to check — the guard here is that gameplay opacity does not silently
 * drift instead.
 */
export const OPACITY = 0.7

/**
 * The trail's brightness, run along its own length with a bright leading edge marking the
 * invulnerability window this move carries.
 *
 * Built from the same `BoxGeometry`-is-per-face reasoning as `dash-trail.ts`'s `TRAIL_BODY` —
 * see that comment for why `vLocal.z`, not `vUv.x`, is the coordinate along the trail. `along`
 * fades both ends the same way; `lead` is the addition that sets this trail apart: a bright
 * band confined to `along01` near 1.
 *
 * **That end is confirmed the leading edge, not assumed.** `main.ts`'s call site records the
 * `origin` argument as "where the dodge started" and `heading` as the direction the dodge
 * actually travelled (`dodgeHeading`, not raw velocity). Below, `mesh.lookAt` aims the mesh at
 * `origin + heading`; for a plain `Mesh` (unlike a camera or light) `Object3D.lookAt` points the
 * object's local **+Z** at the target, not -Z, so local +Z runs in the direction of travel. The
 * box's own `-0.5..0.5` z-span is centred on `origin` with no forward offset (`mesh.position`
 * is set once, to `origin`, and never shifted along z the way `dash-trail.ts`'s streak is) — so
 * the `vLocal.z = +0.5` half sits on the travel side of that centre, closer to where the dodge
 * actually ends, and the `-0.5` half sits on the started-from side. `along01 = vLocal.z + 0.5`
 * near 1 is therefore the end nearer the player's post-dodge position: the leading edge.
 */
const TRAIL_BODY = /* glsl */ `
    float along01 = vLocal.z + 0.5;
    float along = smoothstep(0.0, 0.2, along01) * smoothstep(1.0, 0.6, along01);
    float lead = smoothstep(0.75, 1.0, along01);
    float streak = 0.7 + 0.3 * sin(along01 * 22.0 - time * 10.0);
    gl_FragColor = vec4(tint, alpha * (along * streak + lead * 0.8));
`

export function createSlipstreamTrail(
  origin: Vector3, heading: Vector3, c: SlipstreamConfig,
): Effect {
  // Length is what the dash actually covers, so the streak cannot claim ground the
  // move does not reach.
  const length = safeScale(c.speed * c.durationSeconds)
  const geometry = new BoxGeometry(WIDTH, TALL, 1)
  const material = createEffectMaterial({
    body: TRAIL_BODY,
    uniforms: { tint: new Color(TINT), alpha: OPACITY, time: 0 },
    // The builder defaults to DoubleSide, which is free on the flat sectors and rings every
    // other effect in this directory is built from — front and back are the same plane there.
    // This trail is a real box with depth, so DoubleSide would additionally render each far
    // interior wall behind the near one, layering two transparent quads with depthTest off.
    // The original MeshBasicMaterial here never set `side`, so it rendered FrontSide (three's
    // own default) — pinned explicitly here to keep that same single wall per side.
    side: FrontSide,
    // Every other flat tell in this directory asks for this for the same reason: a slab that
    // runs along the ground for the length of a dodge is otherwise buried by terrain that
    // slopes up anywhere along that length.
    depthTest: false,
  })
  const mesh = new Mesh(geometry, material)
  // Copied before the offset, because the caller passes the player's live position.
  mesh.position.copy(origin)
  mesh.position.y += TALL / 2
  mesh.scale.z = length

  const flat = new Vector3(heading.x, 0, heading.z)
  if (flat.lengthSq() > 1e-8) {
    mesh.lookAt(mesh.position.clone().add(flat.normalize()))
  }
  mesh.userData.excludeFromShadows = true

  let age = 0

  return {
    object: mesh,
    advance(dt: number): boolean {
      age += dt
      material.uniforms.alpha!.value = OPACITY * Math.max(0, 1 - age / LIFETIME)
      // Drives the streak and lead in TRAIL_BODY. Raw elapsed age, not scaled here, because
      // the shader's own `time * 10.0` already sets the travel speed — the same convention
      // `dash-trail.ts`, `gust-cone.ts`, `vortex-ring.ts` and `shockwave.ts` all use for their
      // own time uniform.
      material.uniforms.time!.value = age
      return age < LIFETIME
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
