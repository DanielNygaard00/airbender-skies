import {
  Color, CylinderGeometry, MathUtils, Mesh, Vector3,
} from 'three'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { safeScale } from './scale'

/**
 * The vapour a Steam reaction leaves where it fired.
 *
 * **Why this stopped being a ring.** The step that first wired the two elemental reactions —
 * Steam and Mud — pointed both at `createShockwave`, a ring, and said so plainly: it was "the
 * cheapest shape that says *something happened here* without pretending to be steam or mud". A
 * later step hands that same ring to the chain finisher, and one shape cannot mean Pressure Wave,
 * the Vortex, the finisher, Steam and Mud all at once without the player losing the ability to
 * tell them apart at a glance. So Steam gets a shape that actually looks like what it is. Steam
 * **rises**; Mud **stays down** — the opposite motion is the whole reason the two need different
 * geometry rather than just different tints, and Mud keeps the ring until it gets its turn.
 *
 * **A single rising, widening column, not a Group.** Every layered effect in this directory
 * (`water-reach.ts`, `fire-burst.ts`) is a fill plus an arc because the fill states a true reach
 * and the arc carries a travelling highlight on top of it. Steam has no reach to state — a
 * reaction is a binary event with no distance a hit box cares about — so there is nothing for a
 * second mesh to add. One `Mesh` is `effect.object` directly, which is also why `advance` can
 * write straight to `object.position` and `object.scale` instead of a child's.
 *
 * **Built on a `CylinderGeometry`, open at both ends.** Its side-face `vUv` genuinely runs
 * (around, up) — `effect-material.ts`'s own geometry table says so, and `air-wall.ts`'s panel
 * already leans on the same fact for its drifting streaks. That is exactly what a rising column
 * wants: `vUv.y` for the fade from the ground up to the top, `vUv.x` for a wisp pattern that
 * wraps the circumference without needing `POLAR_PREAMBLE` (that preamble exists to recover polar
 * coordinates from a *flat* ring's Cartesian UVs — a cylinder's side never has that problem, so
 * reaching for it here would be solving a problem this shape does not have). Open-ended because
 * the column is a hollow tube seen from outside; a cap would only ever be seen from directly
 * above or below and costs vertices for a view nothing in this game takes.
 *
 * **The tint is `main.ts`'s own `0xffdfae`, moved house.** Argued there as "pale and warm: this
 * is water flashing off against heat, and the burst's own orange-red would read as fire itself
 * rather than as water leaving" — that reasoning does not change by changing which file owns the
 * literal, so it is not re-derived here, only carried forward. `main.ts`'s `REACTION_LOOKS` keeps
 * an entry for `'steam'` because the `Record` is total over `ReactionKind` and `'mud'` still
 * needs the type to compile, but nothing reads that entry any more: this module is the live copy.
 *
 * **Steam is vapour, so it has no collar.** Every arc in this directory that reaches for a shader
 * pairs a bright core with a dark collar just inside it (`water-reach.ts`'s `ARC_BODY`,
 * `fire-burst.ts`'s own version) — but a collar is a rim drawn at a *bound of radius*, and this
 * shape's `radius` coordinate is one it does not have: nothing here varies across the tube's
 * thickness because there is no thickness to speak of, only a circumference and a height. Steam
 * has no bright core to rim in the first place, and the column's own silhouette against the
 * ground behind it is what reads. This is a deliberate exception to the pattern every earlier
 * task in this set follows, said here explicitly so a later reader does not take the absence for
 * an oversight. It also means `collar-bounds.test.ts` does not register this file: that suite
 * exists to catch a collar's bounds drifting out of step with the geometry it shades, and a body
 * with no collar has nothing there to drift.
 */

/** Argued in full above: `main.ts`'s own reaction tint, carried rather than re-derived. */
const TINT = 0xffdfae

/**
 * Long enough that the column visibly climbs and widens before it is gone — anything near the
 * ring it replaces (`shockwave.ts`'s own `LIFETIME` of 0.4) reads as a blink rather than a rise —
 * short enough that it clears well inside a couple of seconds, so a second Steam landing on the
 * same soldier never finds an old column still hanging in the air over them.
 */
const LIFETIME = 1.1

/**
 * Radius the column starts and ends at, in world units.
 *
 * `START_RADIUS` is a third of the ring it replaces (`REACTION_RING_RADIUS` 1.4, private to
 * `main.ts` so cited rather than imported — `bench/effects.ts` already cites the same two
 * constants the same way): a burst that begins already ring-sized would not visibly widen at all.
 * `END_RADIUS` finishes past that 1.4, because dissipating means the vapour spreads *beyond* the
 * footprint the old ring drew, not up to it — the reaction is still legible as "about that big"
 * without literally redrawing the ring's own number.
 */
const START_RADIUS = 0.4
const END_RADIUS = 1.3

/**
 * The column's height, fixed rather than animated.
 *
 * The climbing the eye reads is the object's own translation (`RISE_DISTANCE`, below), not a
 * sliver growing from nothing — a cylinder stretched up from zero height would read as a tape
 * measure extending, not as a puff of vapour that was already there and is now leaving. So height
 * is one number for the column's whole life, and only the radius and the position move.
 */
const HEIGHT = 1.5

/**
 * How far the whole column drifts upward over its life, in world units.
 *
 * A touch taller than the column's own fixed `HEIGHT`, so by the time it fades the shape has
 * visibly left the reaction point rather than merely swelling in place — the difference between
 * "steam rising" and "a balloon inflating".
 */
const RISE_DISTANCE = 1.6

/**
 * Peak opacity, before the shader's own top-fade and wisp take their bite out of it.
 *
 * Between the flat sector fills' 0.34 (`water-reach.ts`, `fire-burst.ts`) and their arcs'
 * 0.9-0.95: a reaction burst is not a hard-edged attack shape whose true reach has to read at a
 * glance, so it does not need an arc's near-opaque leading edge, but a puff left at fill-opacity
 * alone — with no collar and no travelling arc to carry extra contrast — would be close to
 * invisible.
 */
const PEAK_OPACITY = 0.5

/**
 * Radial segments on the tube.
 *
 * The sector arcs in this directory spend 48 on a wedge the camera watches edge-on for the length
 * of a whole move (`SECTOR_SEGMENTS` in `sector.ts`). A full column asks for less: it disappears
 * in a bit over a second and is never the shape a hit box is judged against, so it only has to
 * avoid reading as an obvious hexagon at the range Steam is actually seen from — 18 clears that
 * without spending triangles on a shape gone before the eye finishes counting facets.
 */
const RADIAL_SEGMENTS = 18

/**
 * `up` fades the column from solid at the base to nothing by the top, so the shape ends in a soft
 * wisp instead of a cut-off cylinder cap — `1.0` down to `0.45` rather than down to `0.0` so the
 * fade is doing most of its work in the top half, where a real puff of vapour actually thins out,
 * instead of smearing evenly along the whole height.
 *
 * `wisp` breaks up the column's brightness around its circumference and drifts it with `time`, the
 * same job `air-wall.ts`'s `streak` term does for its panel — a still, evenly-lit tube reads as a
 * solid piece of glass, which is the wrong material for something that is supposed to be leaving.
 *
 * **Why the frequency is written as `6.2832 * 3.0` rather than `18.0`.** `vUv.x` wraps from 1 back
 * to 0 all the way around the cylinder's circumference (the same fact `air-wall.ts` leans on for
 * its own streaks, and the geometry table in `effect-material.ts` states outright). A frequency
 * that is not a whole number of cycles then leaves the pattern not meeting itself where the seam
 * wraps — a stationary vertical line down one side of an otherwise rotationally symmetric shape,
 * which is the first thing the eye finds. `6.2832` is one turn (`2 * PI`, spelled out because
 * GLSL ES 1.00 has no built-in `PI`), so `6.2832 * 3.0` is exactly three whole turns; the bare
 * `18.0` it looks like it should round to is actually 2.87 turns, and the missing 0.13 of a turn
 * is the seam. Written as the product rather than the pre-multiplied `18.8496` so the "three whole
 * turns" reading survives in the source, not just in a comment beside it — and pinned in
 * `steam.test.ts` as the literal expression rather than as `18.8496`, so a later author cannot
 * rewrite it into that same rounding mistake.
 */
const COLUMN_BODY = /* glsl */ `
    float up = smoothstep(1.0, 0.45, vUv.y);
    float wisp = 0.6 + 0.4 * sin(vUv.x * 6.2832 * 3.0 + time * 3.0);
    gl_FragColor = vec4(tint, alpha * up * wisp);
`

export function createSteam(at: Vector3): Effect {
  // Unit radius, unit height, so growing the column at runtime is a scale rather than a rebuild
  // sixty times a second — the same convention every other effect in this directory uses.
  const geometry = new CylinderGeometry(1, 1, 1, RADIAL_SEGMENTS, 1, true)
  // `CylinderGeometry` is authored centred on its own origin, spanning -0.5..0.5. Lifted by half
  // so the base sits at local y = 0: the reaction point the caller hands in is where the vapour
  // leaves the ground, not where its midpoint happens to be.
  geometry.translate(0, 0.5, 0)

  const material = createEffectMaterial({
    body: COLUMN_BODY,
    uniforms: { tint: new Color(TINT), alpha: PEAK_OPACITY, time: 0 },
    // `depthTest` left at the builder's own default of `true`, the same departure from the flat
    // ground decals in this directory that `air-wall.ts` makes and for the same reason: this is
    // not a flat shape a metre above the player's feet that sloping terrain buries (the defect
    // that made the gust cone invisible in play), it is a standing column, so depth-testing earns
    // something real — nothing needs to show through whatever the column stands in front of.
  })

  const mesh = new Mesh(geometry, material)
  mesh.name = 'steam-column'
  mesh.userData.excludeFromShadows = true

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    const radius = MathUtils.lerp(START_RADIUS, END_RADIUS, t)
    // Every scale this module hands the scene graph goes through `safeScale`: a NaN or
    // non-finite `t` (from a NaN `dt` reaching `advance`) would otherwise reach `radius` and
    // `mesh.scale` directly and collapse the object's matrix. `scale-wiring.test.ts` drives
    // exactly that path.
    mesh.scale.set(safeScale(radius), safeScale(HEIGHT), safeScale(radius))
    // Only `y` moves — the widening above is what says "dissipating", and a column that also
    // drifted sideways would read as travelling, which is the one thing this reaction is not.
    mesh.position.set(at.x, at.y + RISE_DISTANCE * t, at.z)
    material.uniforms.alpha!.value = PEAK_OPACITY * (1 - t)
    // Drives COLUMN_BODY's wisp term. Raw elapsed age, not scaled here, because the shader's own
    // `time * 3.0` already sets its speed — the same convention every other timed effect in this
    // directory uses for its own time uniform.
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
