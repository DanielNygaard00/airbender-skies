import {
  Color, CylinderGeometry, MathUtils, Mesh, Vector3,
} from 'three'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { safeScale } from './scale'

/**
 * The flourish drawn over a chain finisher, at the player's own feet.
 *
 * **Why `encounter.ts` grew a signal nothing read.** `stepEncounter`'s `finisherThisFrame` has
 * carried two comments since it was added, both saying the same thing: it exists for a later
 * step to hang a flourish on. This is that step. The signal is a `boolean`, not a list of
 * soldiers, and that shape is deliberate rather than a simplification worth widening — the
 * finisher is the player's own act, landed once with whichever weapon closed the string, so the
 * flourish draws once at the player and never once per enemy the string happened to catch. The
 * `land` helper is what raises it; the freeze that completes a string instead routes through
 * `advanceChain` on purpose, and that call site's own comment gives the reason word for word: "a
 * flourish drawn over it would be feedback for nothing" — a frame that behaved like any other
 * freeze earns no finisher beat just because it happened to be the one that closed the count.
 *
 * **Why this is not a ring.** `createShockwave`'s ring already carries two meanings before this
 * effect existed — Pressure Wave and the Vortex — and Task 7/Task 8 gave Steam and Mud each their
 * own shape on exactly that argument: one silhouette cannot mean five different things and still
 * let a player tell them apart at a glance. `bench/effects.ts` still pointed the `finisher` bench
 * id at that same ring as a placeholder until this module existed to repoint it at; that
 * repointing is the last of the borrowing the whole arc set out to undo, and after this task no
 * `BenchEffectId` still shares another effect's shape.
 *
 * **Why a `CylinderGeometry` frustum, and why it looks like nothing else in the vocabulary.**
 * Every reach and reaction shape drawn so far is flat and sits over an enemy: the sector wedges
 * are ground-level cones, the rings lie flat, Steam's own column is the sole thing that stands up
 * — and Steam stands over the *enemy* it reacted on, pale and slow because vapour has nowhere to
 * be but patient. This flourish is the opposite of that shape on every axis that matters: it
 * stands at the *player*, it is warm rather than pale, and it is over before Steam has finished
 * widening past its own starting radius. Narrow at the base and flared wide at the top says
 * "something just launched out of the ground here" the way a flat wedge or a disc cannot — the
 * shape it is not confused with is the only guide a glance gets, and nothing else in this
 * directory stands a flare up vertically at the player's own position.
 *
 * `CylinderGeometry`'s side-face `vUv` genuinely runs (around, up) — the verified row
 * `effect-material.ts`'s own geometry table carries for this exact geometry, and the same fact
 * `steam.ts` and `air-wall.ts` already lean on. Open-ended for the same reason `steam.ts` gives:
 * the flare is a hollow shell seen from outside, and a cap would only ever be seen from directly
 * above or below, which nothing in this game's camera does.
 *
 * **The tint is the staff's own `0xffa64d`, moved to a second file rather than re-derived.**
 * `staff-arc-fx.ts` argues that colour once, for the swing that throws it; a finisher is that
 * same swing's payoff, and reusing its tint is not a missed chance to give the flourish a colour
 * of its own — it is the point. The flourish reads as "the weapon that just closed the string,"
 * not as a sixth warm hue added to a palette that has not asked for one. No number in that file
 * changes, only a second reader of it.
 *
 * **This is the third and last effect in this directory built with no collar, and for a
 * different reason than the first two.** `mud.ts` has none because wet earth has nothing bright
 * to carve a rim out of; `steam.ts` has none because its shape has no radius coordinate for a
 * collar to be a band *of* — only a circumference and a height. This shape shares `steam.ts`'s
 * structural reason exactly, being built on the same geometry: `water-reach.ts`'s and
 * `fire-burst.ts`'s collars are both bands across `POLAR_PREAMBLE`'s `radius`, a coordinate a
 * `RingGeometry`'s flat face has and a `CylinderGeometry`'s side face does not. Reaching for that
 * preamble here to manufacture one would be applying ring math to a shape it was never verified
 * against — precisely the trap that preamble's own doc comment warns off, and the same reasoning
 * `mud.ts`'s doc comment gives for declining `POLAR_PREAMBLE` on a shape whose UV convention has
 * already been checked and is not that one. And even setting the geometry aside, a collar earns
 * its keep by giving the eye a moment to resolve one band nested inside another; this flourish
 * lives for `LIFETIME` seconds below, under a third of a second and shorter than every other
 * timed effect in this directory, most of which is spent growing out of a spark too small to
 * read at all. A dark band nested inside a gradient that is itself barely open by the time it
 * closes would not separate anything — it would just be noise inside a flash.
 */

/** Argued in full above: the staff's own tint, carried rather than re-derived. */
const TINT = 0xffa64d

/**
 * Total lifetime, in seconds.
 *
 * This is punctuation on a landing, not a state — unlike Steam or Mud, which report a soldier's
 * own mark for as long as that mark lasts, the finisher flourish has nothing to keep saying once
 * the beat has read. `gust-cone.ts`'s own `LIFETIME` of `0.22` is the fastest full beat already
 * shipped in this vocabulary, and matching it rather than inventing a new fastest number says
 * this is exactly that fast a beat, not a special case that needed its own tempo. Checked against
 * the state the finisher itself leaves on the player: `DEFAULT_STAFF_CONFIG.swingSeconds` is
 * `0.26` and `recoverySeconds` is `0.4` (`src/core/config.ts` — cited by value, not imported, the
 * same convention `steam.ts` and `mud.ts` use to quote a combat constant without this module
 * taking a dependency on `src/combat/` or `src/core/config.ts`), so `0.22` clears even the
 * shorter of those two numbers before the swing that earned it has finished playing, let alone
 * before the `0.4` seconds of recovery that follow it — the flourish is gone before the player
 * could possibly have pressed anything else anyway.
 */
const LIFETIME = 0.22

/**
 * The frustum's radii at full growth, in world units.
 *
 * `TOP_RADIUS` sits under the old shared ring's `1.4` (`REACTION_RING_RADIUS`, deleted alongside
 * the ring reactions that used it — cited by value the same way `steam.ts` and `mud.ts` cite it
 * for their own footprints) and under Mud's own `HELD_RADIUS` of `1.2`: this shape is not a
 * footprint spread across the ground where a blow landed, it is a narrow column standing at one
 * point, so it earns a tighter number than either flat reaction. `BASE_RADIUS` at roughly a sixth
 * of `TOP_RADIUS` is what makes the frustum read as flaring outward rather than as a slightly
 * tapered tube — Steam's own column has parallel sides for the whole of its life precisely
 * because it does not flare, and matching that ratio here would draw the same silhouette Steam
 * already owns with a different tint.
 */
const TOP_RADIUS = 0.9
const BASE_RADIUS = 0.14

/**
 * The frustum's height at full growth, in world units.
 *
 * Taller than it is wide — `HEIGHT` is a bit over `TOP_RADIUS`'s own diameter — because a flare
 * that read as wider than it stood tall would look like a squat cone sitting on the ground rather
 * than a column erupting past the player. Nowhere near Steam's `HEIGHT` of `1.5` sustained for a
 * whole 1.1-second life: this shape is gone in a third of that time, so it has to say "erupting"
 * in one glance rather than across a life long enough to be watched rising.
 */
const HEIGHT = 2.3

/**
 * The growth curve's own starting size, in world units — the same unit `TOP_RADIUS` is measured
 * in, since both are the two ends `apply`'s single `size` scalar interpolates between.
 *
 * A tenth of `TOP_RADIUS`, chosen so the very first drawn frame is a spark rather than the
 * frustum already at a third of its full size — `steam.ts`'s own `START_RADIUS` is a third of
 * the radius it grows to, but Steam has 1.1 seconds to visibly widen and can afford to start
 * further along; this shape has under a quarter of a second for the whole arc from spark to full
 * flare, so nearly all its available `size` range has to be spent actually growing rather than
 * a rounding difference nobody sees.
 */
const START_SIZE = TOP_RADIUS * 0.1

/**
 * Peak opacity, before the shader's own edge fade and fluting take their bite out of it.
 *
 * At `staff-arc-fx.ts`'s own arc opacity — `0.9`, the brightest number in this vocabulary,
 * carried rather than re-derived for the same reason the tint is: this flourish is the payoff of
 * that same swing, and a payoff drawn fainter than the swing that earned it would read as an
 * anticlimax. Both Steam's `0.5` and Mud's `0.8` sit under it because both of those hold their
 * shape for the better part of a second and have to stay legible as they fade for that whole
 * span; this shape spends most of its short life growing rather than fading, so it can afford to
 * open at full strength.
 */
const PEAK_OPACITY = 0.9

/**
 * Radial segments on the frustum.
 *
 * `18`, matching `steam.ts`'s own count on the identical reasoning taken one step further: that
 * comment's argument was that a full column disappearing in "a bit over a second" only has to
 * avoid reading as an obvious hexagon at the range it is actually seen from. This shape is gone
 * in a fifth of that time and is never the shape a hit box is judged against either, so the same
 * eighteen facets that already cleared that bar for a longer-lived shape clear it here with more
 * room, not less.
 */
const RADIAL_SEGMENTS = 18

/**
 * How fast the fluting drifts. Faster than Steam's own `3.0` multiplier on its `time` term,
 * because this is fire erupting rather than vapour drifting apart, and the two verbs earn
 * different tempos on the one term both shapes share. The exact number is a visual judgement,
 * the same kind `steam.ts`'s own `soft` bound calls out as one rather than a derived fact — there
 * is no combat constant this rides on.
 */
const FLICKER_RATE = 8

/**
 * Brightens toward the top, where the frustum opens, and flutes around the circumference so the
 * shape reads as a moving flame rather than a lit, static shell.
 *
 * `foot` and `mouth` are the same double-`smoothstep` band idiom `steam.ts`'s own `up` term uses,
 * for the identical reason: a shape whose geometry has a real edge at each end of `vUv.y` draws
 * that edge at full strength unless something fades toward it first, and both this frustum's
 * base (flush with the ground the whole time, never lifting off it the way Steam's column does)
 * and its open top (a real cut, not a taper to a point) are exactly that kind of edge. `foot`'s
 * band is tight — `0.0` to `0.05` — for the reason `steam.ts`'s own tight base band gives: this is
 * not a gradual thinning, it is a column meeting the ground it stands on, so the fade only has to
 * erase the rim, not read as fading in from a quarter of the way up. `mouth`'s band is wider —
 * `1.0` down to `0.7` — because the open top is the whole point of this shape's silhouette and
 * deserves more of the shape's own height to resolve, the same trade-off `steam.ts`'s wider top
 * band over its tighter base band makes.
 *
 * `bright` is the term the module comment above calls "brightens toward the top" — a `mix` from a
 * dimmer base tone up to the full tint, driven by the same `vUv.y` the edge bands read, so the
 * one coordinate does both jobs: shaping the silhouette and lighting it.
 *
 * `flute` is `steam.ts`'s own `wisp` term, renamed for what this shape's texture actually is, and
 * carrying that term's identical reasoning for why the frequency is written as `6.2832 * 4.0`
 * rather than the bare `25.0` it looks like it should round to — that bare number is actually
 * 3.98 turns, not 4, and the missing 0.02 of a turn is a seam even at that small a gap.
 * `vUv.x` wraps once around the frustum's
 * circumference — the same fact `steam.ts` cites from `effect-material.ts`'s own geometry table
 * — so a frequency that is not a whole number of turns leaves the pattern not meeting itself
 * where the wrap closes: a stationary vertical seam down one side of an otherwise rotationally
 * symmetric shape, the first thing the eye finds on one. `6.2832` is one turn (`2 * PI`, spelled
 * out because GLSL ES 1.00 has no built-in `PI`), so `6.2832 * 4.0` is exactly four whole turns —
 * caught twice already in this plan on `steam.ts`'s own wisp and on `mud.ts`'s lobes, and written
 * as the product here for the same reason both of those keep it unmultiplied: the "whole turns"
 * reading has to survive in the source itself, not live only in a comment beside it.
 */
const FLARE_BODY = /* glsl */ `
    float foot = smoothstep(0.0, 0.05, vUv.y);
    float mouth = smoothstep(1.0, 0.7, vUv.y);
    float bright = mix(0.55, 1.0, vUv.y);
    float flute = 0.7 + 0.3 * sin(vUv.x * 6.2832 * 4.0 + time * ${FLICKER_RATE}.0);
    gl_FragColor = vec4(tint * bright, alpha * foot * mouth * flute);
`

export function createFinisherFlare(at: Vector3): Effect {
  // Unit top radius, base radius baked as a fraction of it, unit height — so the frustum's own
  // shape (narrow base, wide flared top) is fixed at construction and growing it at runtime is a
  // single uniform scale rather than a rebuild sixty times a second, the same convention every
  // other effect in this directory uses. `BASE_RADIUS / TOP_RADIUS` is the ratio the two named
  // constants above already argue; nothing here re-derives it.
  const geometry = new CylinderGeometry(1, BASE_RADIUS / TOP_RADIUS, 1, RADIAL_SEGMENTS, 1, true)
  // `CylinderGeometry` is authored centred on its own origin, spanning -0.5..0.5. Lifted by half
  // so the base sits at local y = 0, the same translation `steam.ts` makes and for the same
  // reason: the position the caller hands in is where the flare stands, not where its midpoint
  // happens to fall.
  geometry.translate(0, 0.5, 0)

  const material = createEffectMaterial({
    body: FLARE_BODY,
    uniforms: { tint: new Color(TINT), alpha: PEAK_OPACITY, time: 0 },
    // Left at the builder's own default of `true`, the same departure from the flat ground
    // decals in this directory that `steam.ts` and `air-wall.ts` both make and for the same
    // reason: this is a standing column, not a flat shape a sloping hillside could bury, so
    // depth-testing earns something real rather than costing visibility to a defect already
    // paid for once (`gust-cone.ts`'s own `depthTest` comment).
  })

  const mesh = new Mesh(geometry, material)
  mesh.name = 'finisher-flare'
  // Copied once, not read from `at` again after this — the flare stands at the point it was
  // launched from for its whole life, unlike Steam's column, which drifts. Copying rather than
  // holding the caller's own vector is the same defensiveness `steam.ts`'s own "does not mutate
  // the position it is given" test checks: writing into a live vector the caller still holds
  // would move whatever they think that vector still is.
  mesh.position.copy(at)
  mesh.userData.excludeFromShadows = true

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    const size = MathUtils.lerp(START_SIZE, TOP_RADIUS, t)
    // Every scale this module hands the scene graph goes through `safeScale`: a NaN or
    // non-finite `age` (from a NaN `dt` reaching `advance`) would otherwise reach `size` and
    // `mesh.scale` directly and collapse the object's matrix. `scale-wiring.test.ts` drives
    // exactly that path. `size * (HEIGHT / TOP_RADIUS)` keeps the frustum's height growing in
    // step with its radius rather than the two drifting apart as `size` moves — the object's
    // own aspect ratio (`HEIGHT`'s own comment argues it) stays fixed for the whole life.
    mesh.scale.set(
      safeScale(size),
      safeScale(size * (HEIGHT / TOP_RADIUS)),
      safeScale(size),
    )
    material.uniforms.alpha!.value = PEAK_OPACITY * (1 - t)
    // Drives FLARE_BODY's flute term. Raw elapsed age, not scaled here, because the shader's own
    // `time * FLICKER_RATE` already sets its speed — the same convention every other timed
    // effect in this directory uses for its own time uniform.
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
