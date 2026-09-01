import {
  Color, Group, MathUtils, Mesh, Vector3,
} from 'three'
import type { ConeShape } from '../combat/cone'
import type { Effect } from './effect'
import { createEffectMaterial, WEDGE_PREAMBLE } from './effect-material'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry } from './sector'
import { safeScale } from './scale'

/**
 * The staff's swing, drawn at the exact reach and half-angle the fight resolved with.
 *
 * Takes a `ConeShape` rather than a `finisher` flag: this effect draws whatever shape it is
 * handed and has no business knowing which swing produced it. The caller passes
 * `staffShape(swing.finisher, fightConfig.staffArc)` — the same call the fight resolved
 * with — so the drawn arc and the hit arc cannot diverge. See `gust-cone.ts` for the same
 * honesty argument in more detail; it applies here unchanged.
 *
 * **The fill now builds through `createEffectMaterial`, consuming `WEDGE_PREAMBLE`.** It was a
 * flat `MeshBasicMaterial` before, and the reason it could not stay one is `staffArc.finisher`:
 * at `Math.PI / 1.9`, about 94.7 degrees, it is the widest sweep in the game, and neither of the
 * two coordinates an angular gradient would normally reach for survives it — see `FILL_BODY`'s
 * own doc comment for the measurements. `effect-material.ts`'s own doc comment carries the
 * `..._pars_fragment` trap this file no longer has to repeat.
 *
 * **A finisher paint flag was floated for this file and dropped, deliberately, and that is
 * worth recording here rather than only in a commit message.** The idea was to hand
 * `createStaffArc` a `finisher: boolean` alongside the shape, so the fill could paint itself
 * differently for the two swings. But the shape it is handed already differs — 94.7 degrees at
 * range 4.2 against the opener's 81.8 at 3.6 — so a finisher swing already looks different
 * without the flag, and the flag would only have bought a second cue for a fact that already has
 * one. The landing gets its own cue instead, in Task 8, which is the signal that genuinely has
 * no consumer yet. Two cues for one fact, one of them derived from a flag this file would then
 * have to carry just to know which swing produced the shape it was handed, is worse than one cue
 * in the right place — and it would have undone the very honesty argument the paragraph above
 * makes: this file draws whatever shape it is handed, not whatever a flag tells it to pretend.
 */
const LIFETIME = 0.16
/** Above the player's origin, which is at their feet — a sector on the ground is hidden. */
const HEIGHT = 1
/**
 * A swing is an instant, not a pulse of air: full opacity from the first frame, fading out,
 * rather than the gust's travelling arc. Brighter and warmer than the gust's cyan so a staff
 * sweep reads as an impact rather than as bending air.
 */
const FILL_OPACITY = 0.55
const TINT = 0xffa64d

/**
 * Bright at the leading edge, bright down the middle of the sweep, thin at both ends.
 *
 * `across` comes from `WEDGE_PREAMBLE` rather than from `vUv.x` or `POLAR_PREAMBLE`'s `angle`,
 * and on this effect that is not a preference. `staffArc.finisher.halfAngle` is `Math.PI / 1.9`,
 * about 94.7 degrees, and `sectorTheta` puts that wedge's start edge at -184.7 — outside
 * `atan`'s range. Measured on the real geometry, `angle` returns 0.0088..0.9978 with a 0.4737
 * gap in the middle: two clusters, not a run, so a gradient written against it seams down the
 * centre of the swing and reverses on one side. `vUv.x` saturates to the full 0..1 there, which
 * is `sectorUvIsMonotone`'s bound failing in practice. `across` runs -1 to +1 across any wedge.
 *
 * `sweep` is `1.0 - across * across`: 1 down the centre line, 0 at both edges. A staff lands
 * with the middle of its arc, and a fill that is flat across the wedge reads as a shape being
 * displayed rather than a blow being struck. Squared rather than `abs`, so the falloff is
 * gentle near the centre and steep at the rim — which is where the swing stops mattering.
 *
 * The collar is at the leading edge, and unlike every arc in B2 this is a *disc* sector, so
 * `radius` really does span 0..1 and these bounds mean what they look like. The outer 12 per
 * cent is left to fall away so the reach has a soft end rather than a cut edge.
 *
 * **`shimmer`'s two frequencies, checked against the geometry and the lifetime rather than
 * assumed, the way `fire-thrust.ts`'s `PLUME_BODY` comment checks its own `lick` term.**
 * `radius * 26.0` runs across the full 0..1 disc — this is the first wedge in the arc that is
 * not a thin annulus, so unlike `fire-burst.ts`'s `ARC_BODY` (`radius * 18.0` across a
 * 0.70..1.0 band, ≈0.86 of a cycle — effectively one band) this is a rich pattern:
 * `26.0 / (2π) ≈ 4.14` cycles, the same idiom `dash-trail.ts`'s `along01 * 26.0` and
 * `fire-thrust.ts`'s own `along01 * 30.0` (≈4.77 cycles) already ship — several bands at once,
 * not a single one. `time * 90.0` over the 0.16 s `LIFETIME` advances `90.0 * 0.16 = 14.4` rad,
 * ≈2.29 cycles.
 *
 * An earlier pass at this comment read that 2.29 as "over one cycle, so this flickers rather
 * than travels" — `fire-burst.ts`'s own rule, misapplied. `fire-thrust.ts`'s comment draws the
 * flicker/travel line from spatial richness, not from the temporal count on its own: a *single*
 * band (`ARC_BODY`'s ≈0.86-cycle annulus) needs an *over*-one-cycle temporal shift to read as a
 * true flicker — under one cycle it read as "a single slow brightness sweep" instead, which is
 * why `ARC_BODY`'s own rate was raised from 30 to 120 rad/s. A *rich* pattern reads the opposite
 * way: `PLUME_BODY`'s several ropes travel because there is a companion band for each one to
 * slide past, at a temporal shift under one cycle (≈0.80). Nothing in that rule flips a rich
 * pattern back to flicker once its temporal shift crosses one cycle — more cycles of phase on a
 * multi-band pattern is more distance travelled, not a change of kind. So `shimmer`, with
 * `radius`'s rich four-band pattern and `time`'s 2.29-cycle shift, reads as the bands rippling
 * outward across the reach, the same travelling mechanism as `PLUME_BODY`'s `lick`, carried
 * further because the strike's short life pushes the phase past a full cycle rather than
 * stopping short of one. That is still right for a strike: the ripple races across the whole
 * reach in a tenth of a second, which reads as a blow landing rather than a shape being
 * displayed — the same job `sweep`, above, does in the angular direction instead of the radial
 * one.
 */
const FILL_BODY = /* glsl */ `
    float core = smoothstep(0.62, 0.88, radius);
    float collar = smoothstep(0.34, 0.62, radius) * (1.0 - core);
    float sweep = 1.0 - across * across;
    float shimmer = 0.88 + 0.12 * sin(radius * 26.0 - time * 90.0);
    gl_FragColor = vec4(mix(tint * 0.18, tint, core), alpha * sweep * max(core * shimmer, collar * 0.5));
`

export function createStaffArc(origin: Vector3, forward: Vector3, shape: ConeShape): Effect {
  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  // Aim the group's +Z along the heading. Flattened, because inCone tests a flattened
  // heading — an arc tilted with a climbing glider would misrepresent the hit volume.
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() > 1e-8) {
    group.lookAt(group.position.clone().add(flat.normalize()))
  }

  // The flattening convention (RingGeometry authored in XY, theta anticlockwise from +X,
  // centred on -PI/2 so it lands on local +Z once flattened) lives in ./sector, shared with
  // the gust cone and the aim preview — a local copy of the offset would drift silently,
  // since a rotated sector still looks like a sector. staff-arc-fx.test.ts's containment
  // check against inCone remains the independent authority on whether that convention is
  // right: if it disagrees, the offset in sector.ts is what is wrong.
  //
  // Drawn at radius 1 and scaled by shape.range, so the drawn radius comes from the shape
  // rather than being baked into the geometry — an opener and a finisher share this
  // geometry construction and differ only by the scale applied below.
  const fillGeometry = sectorGeometry(shape.halfAngle, 0, 1)
  // `side` is left to the builder's default, deliberately: it defaults to DoubleSide, which is
  // exactly what the original MeshBasicMaterial here set explicitly, so this is not an
  // oversight — the same note `fire-thrust.ts` makes for its own plume material.
  const fillMaterial = createEffectMaterial({
    body: WEDGE_PREAMBLE + FILL_BODY,
    uniforms: {
      tint: new Color(TINT), alpha: FILL_OPACITY, time: 0, halfAngle: shape.halfAngle,
    },
    // Drawn over the world rather than depth-tested against it, like the other attack
    // effects — a flat sector a metre above the player's feet would otherwise be buried
    // by ground that slopes up away from them.
    depthTest: false,
  })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.rotation.x = SECTOR_FLAT_ROTATION_X
  fill.scale.setScalar(safeScale(shape.range))
  fill.userData.excludeFromShadows = true

  group.add(fill)

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    fillMaterial.uniforms.alpha!.value = FILL_OPACITY * (1 - t)
    // Drives FILL_BODY's shimmer term. Raw elapsed age, the same convention `dash-trail.ts` and
    // `fire-thrust.ts` both use for their own time uniform.
    fillMaterial.uniforms.time!.value = age
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
      fillGeometry.dispose()
      fillMaterial.dispose()
    },
  }
}
