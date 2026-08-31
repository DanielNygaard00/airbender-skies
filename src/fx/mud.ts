import {
  Color, MathUtils, Mesh, RingGeometry, Vector3,
} from 'three'
import type { Effect } from './effect'
import { createEffectMaterial, POLAR_PREAMBLE } from './effect-material'
import { safeScale } from './scale'

/**
 * The stain a Mud reaction leaves where it fired.
 *
 * **Why this stopped being a ring.** The step that first wired the two elemental reactions —
 * Steam and Mud — pointed both at `createShockwave`, a ring, and said so plainly: it was "the
 * cheapest shape that says *something happened here* without pretending to be steam or mud". A
 * later step hands that same ring to the chain finisher, and one shape cannot mean Pressure Wave,
 * the Vortex, the finisher, Steam and Mud all at once. Task 7 gave Steam a shape that rises; this
 * gives Mud the opposite motion — a flat disc that lands and stays down — which is the whole
 * reason the two need different geometry rather than just different tints.
 *
 * **A single flat disc, not a Group.** Same reasoning `steam.ts` gives for its own single
 * `Mesh`: every layered effect in this directory (`water-reach.ts`, `fire-burst.ts`) is a fill
 * plus an arc because the fill states a true reach and the arc carries a travelling highlight on
 * top of it. A reaction is a binary event with no reach for a hit box to care about and nothing
 * that travels across it, so there is nothing for a second mesh to add.
 *
 * **Built on a `RingGeometry` with inner radius 0, not a `CircleGeometry`.** `effect-material.ts`'s
 * own geometry table records `RingGeometry`'s UV convention as proven — `uv = (position /
 * outerRadius + 1) / 2`, read directly out of three's own source rather than assumed — and that is
 * exactly the convention `POLAR_PREAMBLE` is built and tested against. Reaching for
 * `CircleGeometry` instead would mean trusting a second shape's UV math with no entry in that
 * table and no other effect in this directory that has already paid for the mistake if it were
 * wrong — the same class of trap the table exists to close off. Passing `0` as the inner radius
 * turns the ring into a filled disc while keeping that already-proven convention; verified against
 * `RingGeometry`'s own constructor (`node_modules/three/src/geometries/RingGeometry.js`) rather
 * than assumed, since `innerRadius` there is only ever a starting value for a loop
 * (`let radius = innerRadius`) with no division by it and no lower bound enforced, so `0`
 * constructs without incident and every vertex's `uv` is computed by the exact formula above,
 * `radius` at the centre included.
 *
 * **The tint is `main.ts`'s own `0x4a3423`, moved house.** Argued there as "dark and brown: earth
 * compacted wet around a soldier's feet, pushed well away from the sandstone `earth-reach.ts`
 * already uses so the two effects do not read as the same material" — that reasoning does not
 * change by changing which file owns the literal, so it is carried forward rather than re-derived.
 * `main.ts`'s `REACTION_LOOKS` is gone: it was a `Record<ReactionKind, number>` kept total only so
 * `'mud'` had a value to compile against, and now that both reactions own their tint as a module
 * constant of their own (this one and `steam.ts`'s `TINT`) nothing reads a shared table any more.
 *
 * **Mud is exempt from the collar rule, and this is the second and last such exemption** (`steam.ts`
 * is the first, for a different reason). Every arc in this directory that reaches for a shader
 * pairs a bright core with a dark collar just inside it (`water-reach.ts`'s `ARC_BODY`,
 * `fire-burst.ts`'s own version) — but that pattern exists to carve a bright leading edge out of a
 * bright fill, and wet earth has no bright element to carve one out of and nothing above the
 * bloom threshold in the first place. Measured the way `shockwave.ts`'s own `DEFAULT_TINT` comment
 * measures it — `new Color(0x4a3423)` and `0.2126*c.r + 0.7152*c.g + 0.0722*c.b` on the linear
 * values three's sRGB decoding produces — this tint's luminance is ≈0.040, nowhere near the 0.82
 * bloom threshold that comment cites. Mud's legibility comes from being *darker* than everything
 * around it, the opposite of what a collar is for, so this module writes no `core`/`collar` pair
 * and does not register in `collar-bounds.test.ts` — that suite exists to catch a collar's bounds
 * drifting out of step with the geometry it shades, and a body with no collar has nothing there to
 * drift.
 */

/** Argued in full above: `main.ts`'s own reaction tint, carried rather than re-derived. */
const TINT = 0x4a3423

/**
 * Total lifetime, in seconds.
 *
 * Shorter than steam's own `LIFETIME` of 1.1 and well under `ReactionConfig.mudHoldSeconds`'s 1.4
 * (`DEFAULT_COMBAT_CONFIG.reactions`, `src/combat/config.ts` — cited by value, not imported, for
 * the same reason `steam.ts` cites `markSeconds` and `mudHoldSeconds` rather than importing them:
 * a comment can quote a constant without this module taking a dependency on `src/combat/`). A
 * spatter's whole story — the landing and the spread — is told in its first tenth of a second
 * (`SPREAD_DURATION`, below); everything after that is only a fade, and a puddle has no reason to
 * linger as long as a column that is still visibly climbing. `0.8` clears well under both figures,
 * so a soldier's own hold and mark both outlast the visual that announced them.
 */
const LIFETIME = 0.8

/**
 * How long the spread takes, in seconds, out of the total `LIFETIME` above.
 *
 * A tenth of a second: mud does not climb the way steam's column does, it lands, so the widening
 * has to read as an impact rather than a process the eye can watch unfold. Short enough that by
 * the time a player's eye catches the shape at all, it is already most of the way to its held
 * size.
 */
const SPREAD_DURATION = 0.1

/**
 * Radius the disc starts and ends at, in world units.
 *
 * `HELD_RADIUS` sits *under* the old ring's `REACTION_RING_RADIUS` of 1.4 (`main.ts`, cited by
 * value — that constant is deleted along with the ring reactions used, since neither Steam nor Mud
 * fires it any more), the opposite choice from `steam.ts`'s `END_RADIUS`, which finishes past it.
 * Steam dissipates outward past the point it fired from; mud lands *at* the point of impact and
 * stays there, so its footprint reading as reaching further than the blow that made it would be
 * the wrong shape of lie. `START_RADIUS` at a quarter of `HELD_RADIUS` is small enough that the
 * spread is visible as a spread rather than the disc appearing to begin already fully formed.
 */
const START_RADIUS = 0.3
const HELD_RADIUS = 1.2

/**
 * Peak opacity, before the shader's own edge fade and lobe pattern take their bite out of it.
 *
 * Higher than steam's own `PEAK_OPACITY` of 0.5. Steam has a bright highlight and a moving wisp
 * to carry the eye; mud has neither — its whole signal is contrast against the ground it darkens
 * — so a fainter puddle would read as barely there rather than as legibly dark.
 */
const PEAK_OPACITY = 0.8

/**
 * Segments around the ring.
 *
 * `48` — the same count `shockwave.ts` and `vortex-ring.ts` both spend on a full ring. Those are
 * the only other full rings (as opposed to the bounded wedges `sector.ts` builds) in this
 * directory, and matching them means this is not a fourth constant to defend a different number
 * for the same job.
 */
const RING_SEGMENTS = 48

/**
 * `blob` breaks the disc's brightness into an uneven scatter of lobes rather than a perfect
 * painted circle, which is what actually thrown mud looks like. `edge` fades the outermost sliver
 * of the disc so it does not end in a hard-edged cutout.
 *
 * **Why the frequency is written as `angle * 6.2832 * 7.0` and not a bare `angle * 7.0`.**
 * `POLAR_PREAMBLE`'s `angle` is a normalised turn — it runs 0..1 once around the disc, not 0..2π
 * (see that preamble's own doc comment). So a bare `sin(angle * 7.0)` would be seven *radians*
 * across the whole circumference — 1.11 cycles — which both fails to give seven lobes and, worse,
 * does not meet itself at the wrap: `sin(0)` is `0` and `sin(7)` is `0.657`, so the disc would
 * carry a hard radial discontinuity down one side, the first thing the eye finds on an otherwise
 * rotationally symmetric shape. Multiplying by a whole turn first (`6.2832`, spelled out because
 * GLSL ES 1.00 has no built-in `PI`) makes the `7.0` mean seven whole lobes and makes the whole
 * expression periodic in `angle`, so the wrap is seamless. `steam.ts`'s wisp term had the identical
 * bug for the identical reason on a cylinder's `vUv.x`. Pinned in `mud.test.ts` as the whole
 * expression, not just the `7.0`, so a later retune cannot reintroduce the seam by rounding it to
 * a value that looks equivalent.
 */
const SPATTER_BODY = /* glsl */ `
    float blob = 0.55 + 0.45 * sin(angle * 6.2832 * 7.0) * smoothstep(0.2, 1.0, radius);
    float edge = smoothstep(1.0, 0.75, radius);
    gl_FragColor = vec4(tint, alpha * edge * blob);
`

export function createMud(at: Vector3): Effect {
  // Unit outer radius, inner radius 0, so growing the disc at runtime is a scale rather than a
  // rebuild sixty times a second — the same convention every other ring effect in this directory
  // uses.
  const geometry = new RingGeometry(0, 1, RING_SEGMENTS)

  const material = createEffectMaterial({
    body: POLAR_PREAMBLE + SPATTER_BODY,
    uniforms: { tint: new Color(TINT), alpha: PEAK_OPACITY },
    // A spatter lying on ground that slopes up away from the player is otherwise hidden by it —
    // the same defect `gust-cone.ts`'s `depthTest` comment records for the gust cone's own fill,
    // and the reason every other flat ground effect in this directory passes `false` here. The
    // builder defaults to `true`.
    depthTest: false,
  })

  const mesh = new Mesh(geometry, material)
  // RingGeometry is authored flat in the XY plane; rotated onto the ground plane the same way
  // `shockwave.ts` and `vortex-ring.ts` orient their own rings.
  mesh.rotation.x = -Math.PI / 2
  mesh.name = 'mud-spatter'
  mesh.position.copy(at)
  mesh.userData.excludeFromShadows = true

  let age = 0

  function apply(): void {
    const spreadT = MathUtils.clamp(age / SPREAD_DURATION, 0, 1)
    const lifeT = MathUtils.clamp(age / LIFETIME, 0, 1)
    const radius = MathUtils.lerp(START_RADIUS, HELD_RADIUS, spreadT)
    // Every scale this module hands the scene graph goes through `safeScale`: a NaN or
    // non-finite `age` (from a NaN `dt` reaching `advance`) would otherwise reach `radius` and
    // `mesh.scale` directly and collapse the object's matrix. `scale-wiring.test.ts` drives
    // exactly that path.
    mesh.scale.setScalar(safeScale(radius))
    material.uniforms.alpha!.value = PEAK_OPACITY * (1 - lifeT)
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
