import {
  Color, MathUtils, Mesh, SphereGeometry, Vector3,
} from 'three'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { safeScale } from './scale'

/**
 * The burst where a blow lands, or fails to.
 *
 * A connect and a down are deliberately different in kind, not just in size: a connect is
 * quick and tight, a down is broad and slow. Both are pale rather than red, because the
 * design document's non-lethality is meant to be encoded by the systems rather than
 * mentioned, and a red splash would say the opposite of what a downed enemy means.
 *
 * `deflect` is the third, and it is the odd one out on purpose: it marks a blow that did
 * *nothing*, because a move with no damage, no push, no sound and no burst reads as a broken
 * game rather than as armour. It is the smallest, the shortest and the only cold grey of the
 * three, so the player learns "that bounced" rather than "that hit a bit". Section 4.4's heavy
 * armoured soldier is the whole reason it exists.
 */
export type ImpactKind = 'hit' | 'down' | 'deflect'

/** Above the enemy's own origin, which is at its feet. */
const HEIGHT = 0.9
const START_FRACTION = 0.25

export interface Shape {
  radius: number
  lifetime: number
  opacity: number
  tint: number
  /**
   * How wide the bright silhouette band is, in `facing`-space (0 at the silhouette, 1 facing
   * the camera). Narrow reads as a hard shell; wide reads as a soft billow. See `BURST_BODY`'s
   * doc comment for the measurement this reads.
   */
  rim: number
  /**
   * How much of the interior is drawn at all, once the rim's bright band has fallen away. Near
   * zero reads as an outline; higher reads as a filled volume.
   */
  fill: number
  /**
   * The number of lobes the surface break-up radiates in, as seen on screen. Zero is smooth.
   * Must be a whole number — see `BURST_BODY`'s doc comment for why a fractional value seams at
   * the screen-space azimuth's branch cut, and why that is not the same requirement B2's
   * `6.2832 * n` rule was written for.
   */
  shards: number
  /**
   * How dark the interior goes, as a fraction of `tint`, once `edge`'s bright silhouette band
   * has fallen away — the collar's own darkening (`mix(tint * dark, tint, core)` in every arc
   * body that survived B2's gate), added on top of this burst's own surface rather than in place
   * of it. A low fraction (near 0) is a hard, near-black core; a high one (near 1) barely darkens
   * at all. See `BURST_BODY`'s doc comment for why this is a per-kind field rather than one
   * shared constant.
   */
  dark: number
}

const SHAPES: Record<ImpactKind, Shape> = {
  // `rim`, `fill` and `dark` are a holding position, not a design: they reproduce today's
  // one-shade sphere as closely as one shared body can -- smooth (`shards: 0`), a moderately
  // wide rim so the silhouette does not go flat, and a fill high enough that the interior reads
  // as filled rather than hollow. Task 3 is where these get tuned on their own terms; nothing
  // here has been judged against a real connect or a real down on screen yet.
  //
  // `dark: 0.6` is a light touch deliberately: these are soft, broad puffs rather than a hard
  // spark, and `BURST_BODY`'s own doc comment records that `0.18` -- the fraction the five arc
  // bodies that survived B2's gate share -- reads as *nearly black* against either of these
  // kinds' own pale tints. That much darkening would be a real design change to a shape this
  // task is explicitly not designing yet, so `hit` and `down` get just enough interior
  // darkening to carry the collar's own contrast argument (an effect needs an edge against
  // whatever is behind it, not only a colour) without redrawing the puff Task 3 still owns.
  hit: {
    radius: 1.1,
    lifetime: 0.18,
    opacity: 0.55,
    tint: 0xdff1ff,
    rim: 0.5,
    fill: 0.6,
    shards: 0,
    dark: 0.6,
  },
  down: {
    radius: 2.3,
    lifetime: 0.45,
    opacity: 0.4,
    tint: 0xfff3d8,
    rim: 0.5,
    fill: 0.6,
    shards: 0,
    dark: 0.6,
  },
  /**
   * Smaller than a connect and shorter-lived, and cold grey where the other two are warm.
   *
   * Every number here is chosen *against* `hit` rather than in the abstract, because the one
   * thing this burst must not do is read as a weaker version of a connect — that would teach
   * the player that the gust is working badly rather than not working at all. So it is
   * decisively smaller (0.7 against 1.1), decisively faster (0.12 against 0.18) and the
   * brightest of the three at its peak, which together read as a spark off metal instead of a
   * puff of air. `impact-targets.test.ts` pins the size and lifetime comparisons rather than
   * the literals, so retuning `hit` drags this with it.
   *
   * Task 2 adds the surface argument the size and tint alone could not carry: a hard, narrow
   * rim (`rim: 0.2`, against the other two's 0.5) instead of a soft billow, and five lobes of
   * surface break-up (`shards: 5`) so the shell reads as shattered plating rather than a
   * smaller smooth puff. This is the one kind this task actually tunes; `hit` and `down` above
   * are holding values only.
   *
   * **`fill: 0.55`, raised from an initial 0.15 in the first gate round this comment now
   * records.** `BURST_BODY`'s alpha shape was originally `max(edge * lumps, fill * (1.0 -
   * edge))`, which confined the shard modulation to `edge`'s own narrow band and left the rest
   * of the sphere at a flat `fill` floor — at `rim: 0.2` that band is a sliver, so the first
   * shot the controller took showed a nearly featureless disc with no visible shards at all.
   * `BURST_BODY`'s doc comment carries the fix (`lumps` now multiplies the whole alpha shape,
   * not just `edge`); this value is the other half of that fix. A low `fill` made sense when
   * only the rim carried the break-up — the interior was supposed to stay quiet — but now that
   * `lumps` modulates everywhere, a low `fill` just makes the whole sphere faint rather than
   * making it read as broken. 0.55, close to `hit`/`down`'s own 0.6, is high enough that the
   * shard wave's peaks (up to `1.0`, see `BURST_BODY`) read as bright plating and its troughs
   * (down to `0.55 * 0.20 = 0.11`) read as gaps between shards, rather than the whole surface
   * staying too dim to judge.
   *
   * **`dark: 0.18`, added in the second gate round.** The second shot showed the shards reading
   * correctly but the whole burst nearly invisible against pale grass: `tint` (`0xbcc4d2`, cold
   * grey) and the terrain it is drawn over are close in luminance, so a shape carrying no darker
   * value anywhere has nothing to separate it from its background — precisely the failure the
   * collar mechanism exists to fix elsewhere, and this burst had none of it. `0.18` is the exact
   * fraction the five collar-bearing arc bodies already use, kept here rather than invented,
   * because `deflect` is the one kind actually arguing for a *hard* spark: a near-black core
   * reads as decisive metal-on-metal contact, which is the opposite failure mode from `hit`/
   * `down`'s soft billow, where the same fraction would over-darken a shape nobody has designed
   * yet. Unlike `hit`/`down`, `deflect`'s tight `rim` (0.2) means most of the visible surface
   * sits in the darkened `edge ≈ 0` region, so this fraction is doing real, load-bearing work
   * here rather than shading a sliver.
   */
  deflect: {
    radius: 0.7,
    lifetime: 0.12,
    opacity: 0.7,
    tint: 0xbcc4d2,
    rim: 0.2,
    fill: 0.55,
    shards: 5,
    dark: 0.18,
  },
}

/** The shape a given burst is drawn at. Exported so a test can compare two without a mesh. */
export function impactShape(kind: ImpactKind): Readonly<Shape> {
  return SHAPES[kind]
}

/**
 * One surface for all three kinds, differing by what `SHAPES` says rather than by three bodies.
 *
 * **Why the silhouette comes from the view.** A sphere's visible boundary is wherever its
 * surface turns edge-on to the camera, which is a fact about the view and not about the mesh —
 * `ice-shell.ts`'s `SHELL_BODY` carries that argument in full and this is the same measurement.
 * `facing` is 1 where the surface points at the camera and 0 at the silhouette, so `rim`'s
 * bound decides how wide the bright edge band is: a narrow band reads as a hard shell, a wide
 * one as a soft billow. That single number is most of what separates a spark from a cloud.
 *
 * `fill` is what stops a smooth kind from being an outline: it is the floor the interior is
 * drawn at once `edge` has fallen away.
 *
 * **`edge`'s sense, checked rather than assumed.** At `facing = 0` (the silhouette),
 * `1.0 - facing = 1.0`, which sits above `1.0 - rim * 0.35` for any `rim` in `(0, 1]`, so
 * `smoothstep` saturates high and `edge = 1` — bright — for a `rim` of 0.2 and of 0.9 alike. At
 * `facing = 1` (pointing straight at the camera), `1.0 - facing = 0.0`, which sits below
 * `1.0 - rim` for the same range, so `edge = 0` — dark — again for either `rim`. The two
 * endpoints hold regardless of `rim`'s size, which is exactly what a boundary condition should
 * do; `rim`'s actual effect is in between; it sets how far *inward* from the silhouette
 * (`facing` running from 0 up to `rim`, with the ramp itself between `0.35 * rim` and `rim`)
 * the bright band still reaches before the surface goes dark. A larger `rim` pushes that reach
 * further toward face-on, which is the "wider band" the field's own doc comment claims — the
 * sense holds, and this body ships the expression as given in the original brief.
 *
 * **Gate round: `lumps` moved off `edge` and onto the whole alpha shape.** The first version of
 * this body wrote `max(edge * lumps, fill * (1.0 - edge))`, which confined the shard modulation
 * to `edge`'s own band. At `deflect`'s tight `rim` (0.2) that band is a sliver right at the
 * silhouette, so `lumps` had almost no area to modulate and the shot the controller actually
 * took showed a nearly featureless disc — the shards were mathematically present and visually
 * absent. Shards are meant to break up the *whole visible surface*, not just its rim, so `lumps`
 * now multiplies `max(edge, fill)` — the full alpha shape — instead of being folded into one
 * term of it: `alpha * max(edge, fill) * lumps`. Checked against the smooth kinds: `lumps` is
 * exactly `1.0` for `hit` and `down` (see below), so this reduces to `alpha * max(edge, fill)`
 * for them either way, which is close to the pre-gate shape they already shipped at unchanged
 * `rim`/`fill` values — nothing about their own look moves.
 *
 * **The modulation is deep, not a shading wobble.** A term that floors at `fill` and only wobbles
 * by ±0.45 around it reads as soft shading, not as separate shards — indistinguishable from a
 * lit, slightly bumpy ball. `wave` maps the raw `sin` into 0..1, and `shardWave` then stretches
 * that into `0.20` (near-dark trough — a gap between shards) to `1.0` (full brightness — a lit
 * facet), so at `deflect`'s `fill: 0.55` the visible range runs `0.55 * 0.20 ≈ 0.11` up to
 * `0.55 * 1.0 = 0.55` — a real break in the surface rather than a texture on top of it.
 *
 * **The `shards` branch: `mix` on a `step`, not a ternary on a uniform.** `shards > 0.0 ? wave
 * : 1.0` is legal GLSL but reads oddly as a branch on a value that never varies per-fragment.
 * `step(0.5, shards)` is 0.0 for `shards = 0` (both `hit` and `down`) and 1.0 for any `shards`
 * of 1 or more (every shard kind so far), so `mix(1.0, shardWave, isShard)` picks the constant
 * for a smooth kind and the deep wave for a shard kind with no branch at all. `0.5` rather than
 * `0.0` as the threshold is deliberate: it sits at the midpoint between the only two values this
 * uniform actually takes today (0 and a positive integer), so it does not carry the same
 * exactly-on-the-boundary risk `step(0.0, shards)` had in the first version of this body, where
 * `shards = 0` and `shards > 0` both had to resolve correctly right at the comparison point.
 *
 * **Spokes radiate in screen space, not around the mesh's vertical axis.** The first version
 * read `atan(vLocal.x, vLocal.z)`, the azimuth around the sphere's own Y axis — correct as an
 * angle, but wrong as a *spark*: from a side view those lobes run top-to-bottom as vertical
 * stripes down the ball, because they are laid out in object space and the object's vertical
 * axis rarely lines up with anything the camera sees as "outward from the impact point". A spark
 * radiates from where it is struck *as seen*, which is a view-space fact exactly like `facing`
 * above, not an object-space one — so `spokeAngle` reads `n`, the same view-space normal `facing`
 * already reads, and takes its on-screen azimuth: `atan(n.y, n.x)` is the angle of that normal's
 * projection onto the screen's own x/y plane, which sweeps around the visible disc the way a
 * spark's rays actually do, regardless of which way the sphere itself is oriented.
 *
 * **Why this seam rule is not `6.2832 * n`, and why that form would be wrong here.** Every other
 * periodic angle in this codebase (`POLAR_PREAMBLE`'s `angle`, the vertical-axis azimuth this
 * body used before the gate round) is pre-divided into a 0..1 turn fraction, so multiplying by
 * `6.2832` (one turn in radians) converts "n turns" back into "n full radian cycles" before it
 * reaches `sin`. `spokeAngle` is not that kind of coordinate: `atan(y, x)` already returns a
 * value in radians over its own natural `(-pi, pi]` domain, with no turn-fraction division in
 * between. Multiplying an already-radian coordinate by `6.2832` would not fix a seam — it would
 * just scale the frequency by a further factor of `2*pi`, which is not what `shards` is meant to
 * mean (lobes, not lobes times two-pi). The seam-free condition for `sin(spokeAngle * shards)` is
 * simply that `shards` is a whole number: `sin` evaluated at the branch cut gives
 * `sin(shards * pi)` approaching from one side and `sin(shards * -pi) = -sin(shards * pi)`
 * approaching from the other, and these two agree (both `0`) exactly when `shards * pi` is a
 * multiple of `pi` — i.e. `shards` is an integer — with no turn conversion required at all. So
 * `shards` still has to be a whole number, for a real reason, but writing `6.2832 * shards` here
 * would be reintroducing the exact bug this rule exists to prevent, not fixing one: a future
 * reader who "fixes" this into that form on the general "sin around a loop needs a turn count"
 * instinct would be re-scaling an already-correct radian coordinate and changing `shards`' actual
 * meaning without changing its seam behaviour at all.
 *
 * **Second gate round: the collar's own darkening, added on top of the surface above rather than
 * substituted for it.** The design note this task was drawn from said the impact burst "needs
 * something the collar does not provide"; the first two rounds of this body read that as
 * permission to replace the collar's contrast mechanism with a per-kind surface instead of
 * adding to it. The second gate shot proved that reading wrong: `deflect`'s `tint` (`0xbcc4d2`,
 * cold grey) sits close in luminance to pale grass, so a shape that draws flat `tint` everywhere
 * has no darker value anywhere to separate it from that background — contrast is a difference,
 * brightness is a level, and this body was only ever varying the level. The fix is literally the
 * collar: every arc body that survived B2's gate writes `mix(tint * 0.18, tint, core)`, and here
 * `edge` plays `core`'s role, since it is already this body's own "how close to the visible
 * boundary" measurement. `colour` darkens toward `tint * dark` as `edge` falls from 1 (silhouette)
 * to 0 (face-on) — the same direction the collar darkens away from a shell's own bright rim.
 * `lumps` and `max(edge, fill)` are untouched by this change and still shape the alpha exactly as
 * the first gate round left them; this round changes what colour is drawn, not where.
 *
 * **Why `dark` is a per-kind field instead of the shared `0.18`.** Checked before shipping,
 * rather than copied on the collar bodies' own precedent: `0xbcc4d2 * 0.18` and `0xfff3d8 * 0.18`
 * both land under 46 of 255 on every channel — both are nearly black, regardless of one tint
 * being cold grey and the other warm near-white. That is very likely the right amount of
 * darkening for `deflect`, whose whole claim is a hard, decisive spark. It is very likely too
 * much for `hit` and `down`, which are still on holding values standing in for today's flat,
 * uniformly pale puff — driving them to near-black on one side of every sphere would be a real
 * design change to a shape nobody has actually designed yet, smuggled in as a side effect of a
 * fix aimed at `deflect`. So `dark` moved from a shared constant to the fourth per-kind field
 * beside `rim`, `fill` and `shards`; see `SHAPES`'s own comments for each kind's chosen value and
 * why.
 */
const BURST_BODY = /* glsl */ `
    vec3 n = normalize(vViewNormal);
    float facing = abs(n.z);
    float edge = smoothstep(1.0 - rim, 1.0 - rim * 0.35, 1.0 - facing);
    float spokeAngle = atan(n.y, n.x);
    float wave = 0.5 + 0.5 * sin(spokeAngle * shards + time * 40.0);
    float shardWave = 0.20 + 0.80 * wave;
    float isShard = step(0.5, shards);
    float lumps = mix(1.0, shardWave, isShard);
    vec3 colour = mix(tint * dark, tint, edge);
    gl_FragColor = vec4(colour, alpha * max(edge, fill) * lumps);
`

export function createImpact(position: Vector3, kind: ImpactKind): Effect {
  const shape = SHAPES[kind]

  // A unit sphere scaled at runtime, so growing costs a scale rather than a rebuild.
  const geometry = new SphereGeometry(1, 18, 12)
  const material = createEffectMaterial({
    body: BURST_BODY,
    uniforms: {
      tint: new Color(shape.tint), alpha: shape.opacity, time: 0, rim: shape.rim,
      fill: shape.fill, shards: shape.shards, dark: shape.dark,
    },
    // `side` and `depthTest` are both left at the builder's defaults -- `DoubleSide` and
    // `true` -- which is what the old `MeshBasicMaterial` set here: `side: DoubleSide`
    // explicitly, and no `depthTest` at all, which three defaults to `true`. A burst around a
    // soldier is a closed shape whose far half is behind them from the camera's side, and
    // `air-wall.ts` and `ice-shell.ts` both keep the depth test for the same reason: without it
    // that hidden far half would draw over whatever is actually in front of it.
  })

  const mesh = new Mesh(geometry, material)
  // Copied before the offset is applied: the caller hands us an enemy's live position
  // vector, and writing the height into it would teleport the enemy upward.
  mesh.position.copy(position)
  mesh.position.y += HEIGHT
  mesh.userData.excludeFromShadows = true

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / shape.lifetime, 0, 1)
    mesh.scale.setScalar(safeScale(MathUtils.lerp(START_FRACTION * shape.radius, shape.radius, t)))
    material.uniforms.alpha!.value = shape.opacity * (1 - t)
    // Raw elapsed age, not scaled here -- BURST_BODY's own `time * 40.0` already sets the
    // shard-wave's speed, the same division of labour `fire-burst.ts`'s flicker term uses.
    material.uniforms.time!.value = age
  }

  apply()

  return {
    object: mesh,
    advance(dt: number): boolean {
      age += dt
      apply()
      return age < shape.lifetime
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
