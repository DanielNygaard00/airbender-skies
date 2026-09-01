import {
  BackSide, Color, MathUtils, Mesh, OctahedronGeometry, Vector3,
} from 'three'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { safeScale } from './scale'

/**
 * The ice on a held soldier, for exactly as long as the hold lasts.
 *
 * **The lifetime is the mechanic.** One is created per soldier caught, with the hold duration the
 * fight actually applied, so the shell is on screen for precisely the window in which that soldier
 * cannot act — the same rule `guard-shell.ts` follows for the Slipstream's 0.11-second
 * invulnerability, and for the same reason: a tell that outlives its mechanic tells the player
 * they are safe when they are not, and here it would tell them a soldier is locked when it is
 * already winding up. Both water moves use this, at their own durations, which is what makes a
 * grip and a freeze read as the same condition held for different lengths of time rather than as
 * two effects.
 *
 * An octahedron rather than a sphere, so it reads as faceted ice rather than as a bubble — the
 * `BackSide` sphere in `guard-shell.ts` is the shape that already means "protected", and the two
 * must not be confused when one is on the player and one is on a soldier a few metres away. Drawn
 * from the inside, like that shell, so the enemy inside it stays visible: the point of §4.6's
 * non-lethality is that the body remains in the world, and a shell that hid it would undo that at
 * the one moment the player is looking straight at it.
 *
 * **Placed once, at the freeze point, and it does not follow the body.** The `Effect` contract is
 * an `Object3D` and an `advance(dt)`, with no hook for tracking a target, and the alternative —
 * parenting a shell to the per-enemy view in `combat/enemy-mesh.ts` — would put the fx layer
 * inside the module that owns enemy rigs. That is the wrong direction architecturally and it is
 * also the module a parallel branch is adding two enemy kinds to. The visible cost is bounded and
 * known: `holdEnemy` deliberately leaves knockback alone, so a soldier frozen while still sliding
 * from an earlier gust drifts out of its shell over roughly `knockback / knockbackDamping`
 * seconds — about 0.4 at the shipped damping — before settling. Freezing a stationary soldier,
 * which is the ordinary case, drifts not at all.
 */

/** Centred on the body, since an enemy's origin is at its feet. Matches the guard shell's. */
const CENTRE_Y = 0.95
/** Comfortably around a 1.8-unit character without swallowing the ground under it. */
const RADIUS = 1.3
/** Nearly white with a blue cast, matching the freeze arc in `water-reach.ts`. */
const TINT = 0xcfeeff
const PEAK_OPACITY = 0.42
/**
 * How long the shell takes to form and to melt, in seconds.
 *
 * Both are a small fraction of the shortest hold the game applies — the grip's 1.2 seconds — so
 * the shell is at full strength for nearly all of even the briefest hold. The melt is what
 * matters for honesty: it starts at the *end* of the hold rather than before it, so the shell is
 * never fading while the soldier is still locked.
 */
const FORM_SECONDS = 0.12
const MELT_SECONDS = 0.25

/**
 * Facet brightness from object space, and the bright rim that carries the collar's contrast.
 *
 * An `OctahedronGeometry` does generate a UV — `PolyhedronGeometry`'s `generateUVs` derives one
 * from spherical azimuth and inclination — but it carries pole and seam artefacts from that
 * projection, so `vLocal` is the coordinate actually worth reading here: it is the right one for
 * the faceting regardless, since how bright a facet is should depend on where that facet is, not
 * on a texture coordinate. `facet` quantises the object-space direction into bands so adjacent
 * faces differ, which is what makes it read as cut ice rather than a smooth blob.
 *
 * **Why the contrast is view-dependent and not object-space.** Task 2's collar earns its keep by
 * putting a dark band immediately inside the effect's *visible boundary*, so the eye has an edge
 * to catch regardless of what is behind it. On a flat ground wedge the boundary is a radius, so a
 * band in object space is a band on screen. On a closed shell it is not: the boundary is wherever
 * the surface turns edge-on to the viewer, and that is a fact about the view, not about the mesh.
 * An earlier draft of this body darkened `length(vLocal.xz)` instead, which shades the shell's top
 * and bottom tips — from any side view that is its *middle*, leaving the silhouette uniformly
 * bright and the collar's whole argument unimplemented while the comment claimed a rim.
 *
 * So `grazing` is `1 - abs(n.z)` on the view-space normal: 0 where the surface faces the camera
 * squarely, 1 at the silhouette. `abs` because the shell is `BackSide` and its rendered normals
 * point away from the viewer. On a sphere of projected radius 1, the bounds below light the rim
 * from about 0.76 out to the edge, which at this shell's 1.3 units is a broad rim rather than a
 * hairline — chosen over a tighter band because a hairline on a 1.3-unit object at combat range
 * is one pixel of anti-aliasing.
 *
 * No `time` uniform, deliberately. Ice holds a soldier still; a drifting shell would claim motion
 * the move does not have.
 *
 * **The interior term, and why "collar" now covers two different things.** Every arc body in this
 * directory writes `collar = smoothstep(hi, lo, coord) * (1.0 - core)` — a band bounded on both
 * sides, with nothing drawn past its outer edge, because a ground arc's job stops at its own edge:
 * there is no "inside" left to account for once the band ends. `gl_FragColor`'s alpha here instead
 * writes `(1.0 - core) * 0.45` for the whole non-rim interior, unbounded on the near side — every
 * fragment that is not part of the bright silhouette rim gets some alpha, not just a band next to
 * it. Against `PEAK_OPACITY` 0.42 that interior fragment renders at `0.42 * 0.45 ≈ 0.19` effective
 * opacity, down from a flat 0.42 before this shell had a shader at all. That is a deliberate choice
 * for this shape and not an accident of copying the arc idiom: the shell's whole point per its own
 * doc comment above is that the soldier inside stays visible, so its faces need to stay dim rather
 * than empty — a ground arc has nothing behind it worth seeing through, and a hard cut to zero past
 * its band is the honest reading of "this is where the effect ends"; a shell wants the opposite
 * reading everywhere that is not the rim: "the ice is here, thin enough to see through." One word,
 * `collar`, ends up naming both a bounded band with nothing beyond it and an unbounded dim fill
 * with a bright rim on top — structurally different shapes serving the same "put contrast at the
 * boundary" argument, not the same shape reused.
 */
const SHELL_BODY = /* glsl */ `
    vec3 n = normalize(vViewNormal);
    float grazing = 1.0 - abs(n.z);
    float core = smoothstep(0.35, 0.75, grazing);
    float facet = 0.68 + 0.32 * fract(dot(normalize(vLocal), vec3(3.7, 2.3, 5.1)));
    vec3 colour = mix(tint * 0.18, tint, core);
    gl_FragColor = vec4(colour, alpha * max(core * facet, (1.0 - core) * 0.45));
`

export function createIceShell(position: Vector3, holdSeconds: number): Effect {
  // A unit octahedron scaled at runtime, so forming costs a scale rather than a rebuild. Detail 1
  // rather than 0: a bare octahedron is eight flat faces and reads as a crystal, but at this size
  // one subdivision is what stops it looking like a die.
  const geometry = new OctahedronGeometry(1, 1)
  const material = createEffectMaterial({
    body: SHELL_BODY,
    uniforms: { tint: new Color(TINT), alpha: 0 },
    // Drawn from the inside, like `guard-shell.ts`'s sphere: rendering the near faces too would
    // double what every pixel of the shell is looking through, a visible density change nothing
    // here asks for. `depthTest` is left at the builder's own default of `true`: the shell is a
    // closed volume around a soldier, extending as far below its footing as above it, and the
    // depth test is what keeps that underground half hidden — the same reason `air-wall.ts` wants
    // it on.
    side: BackSide,
  })

  const mesh = new Mesh(geometry, material)
  // Copied before the offset is applied: the caller hands us an enemy's live position vector, and
  // writing the height into it would teleport the enemy upward. The same trap `createImpact`
  // documents, and the same answer.
  mesh.position.copy(position)
  mesh.position.y += CENTRE_Y
  mesh.userData.excludeFromShadows = true

  // The total life is the hold plus the melt, so the melt is time *added* after the lock ends
  // rather than time taken out of it. A non-positive hold still gets a melt, so a mistuned
  // duration degrades to a brief flash rather than to an effect that never draws.
  const total = Math.max(0, holdSeconds) + MELT_SECONDS
  let age = 0

  function apply(): void {
    const remaining = total - age
    const forming = FORM_SECONDS > 0 ? MathUtils.clamp(age / FORM_SECONDS, 0, 1) : 1
    const melting = MELT_SECONDS > 0 ? MathUtils.clamp(remaining / MELT_SECONDS, 0, 1) : 1
    // The smaller of the two ramps, so a hold shorter than the two ramps together produces a
    // single rise and fall rather than a shell that pops to full and then jumps down.
    const shown = Math.min(forming, melting)
    // `safeScale` here is for its non-finite half, not its floor. The floor cannot bite: `forming`
    // is clamped to 0..1 so the lerp never leaves 0.6..1, and `RADIUS` is a constant in this file
    // rather than anything passed in, so the smallest scale this expression can produce is
    // 0.6 × 1.3 = 0.78. A hand-written `Math.max(..., 1e-4)` did sit here for exactly that reason
    // and was removed as a line no input could reach — correct about zero, and wrong about NaN,
    // which arrives by a different route: `age` accumulates whatever `dt` `advance` is handed, so
    // one NaN frame makes `forming` NaN and the scale with it, and `Math.max` would have passed
    // that through anyway. If `RADIUS` ever becomes a parameter the floor starts mattering too,
    // and `safeScale` already covers that case.
    mesh.scale.setScalar(safeScale(RADIUS * MathUtils.lerp(0.6, 1, forming)))
    material.uniforms.alpha!.value = PEAK_OPACITY * shown
  }

  apply()

  return {
    object: mesh,
    advance(dt: number): boolean {
      age += dt
      apply()
      return age < total
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
