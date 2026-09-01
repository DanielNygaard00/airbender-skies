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
   * The angular frequency of the surface break-up, in whole turns around the sphere's vertical
   * axis. Zero is smooth. Must be a whole number — a fractional turn leaves a stationary
   * discontinuity down one meridian, the bug B2 caught twice.
   */
  shards: number
}

const SHAPES: Record<ImpactKind, Shape> = {
  // `rim` and `fill` are a holding position, not a design: they reproduce today's one-shade
  // sphere as closely as one shared body can -- smooth (`shards: 0`), a moderately wide rim so
  // the silhouette does not go flat, and a fill high enough that the interior reads as filled
  // rather than hollow. Task 3 is where these two get tuned on their own terms; nothing here
  // has been judged against a real connect or a real down on screen yet.
  hit: {
    radius: 1.1, lifetime: 0.18, opacity: 0.55, tint: 0xdff1ff, rim: 0.5, fill: 0.6, shards: 0,
  },
  down: {
    radius: 2.3, lifetime: 0.45, opacity: 0.4, tint: 0xfff3d8, rim: 0.5, fill: 0.6, shards: 0,
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
   * rim (`rim: 0.2`, against the other two's 0.5) instead of a soft billow, a low fill (`0.15`)
   * so what is left once the rim falls away is a broken shell rather than a ball, and five whole
   * turns of surface break-up (`shards: 5`) so the shell itself reads as shattered plating
   * rather than a smaller smooth puff. This is the one kind this task actually tunes; `hit` and
   * `down` above are holding values only.
   */
  deflect: {
    radius: 0.7, lifetime: 0.12, opacity: 0.7, tint: 0xbcc4d2, rim: 0.2, fill: 0.15, shards: 5,
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
 * **Why `shards` is in whole turns.** It is an angular frequency around the sphere, so a value
 * that is not periodic leaves a stationary discontinuity down one meridian — the bug B2 caught
 * twice, on a cylinder's `vUv.x` and on a disc's `angle`. Multiplying by a turn first makes the
 * literal mean lobes rather than radians, and makes it wrap cleanly. `atan(vLocal.x, vLocal.z)`
 * is `atan2(x, z)` in GLSL's `atan(y, x)` two-argument form — three.js is Y-up, so the x/z plane
 * is horizontal and this measures the angle swept going around the sphere's *vertical* axis, the
 * axis the shards actually run around, rather than around the view axis or some other meridian.
 *
 * `fill` is what stops a smooth kind from being an outline: it is the floor the interior is
 * drawn at once `edge` has fallen away. `deflect` runs it low, so what is left is a broken
 * shell rather than a ball.
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
 * sense holds, and this body ships the expression as given in the brief.
 *
 * **The `shards` branch: `mix` on a `step`, not a ternary on a uniform.** `shards > 0.0 ? wave
 * : 1.0` is legal GLSL but reads oddly as a branch on a value that never varies per-fragment.
 * `step(shards, 0.0)` is 1.0 exactly when `shards <= 0.0` — the boundary both `hit` and `down`
 * actually sit on — and 0.0 once `shards` is positive, so `mix(shardWave, 1.0, isSmooth)` picks
 * the constant for a smooth kind and the wave for a shard kind with no branch at all. The
 * rejected alternative was `step(0.0, shards)`: GLSL's `step(edge, x)` returns 1.0 when
 * `x >= edge`, so at exactly `shards = 0.0` it would select the *wave* branch instead of the
 * constant, leaving `hit` and `down` pulsing with `time` even though neither has a frequency to
 * modulate — the flip side of the same boundary this body has to get right.
 */
const BURST_BODY = /* glsl */ `
    vec3 n = normalize(vViewNormal);
    float facing = abs(n.z);
    float edge = smoothstep(1.0 - rim, 1.0 - rim * 0.35, 1.0 - facing);
    float shardWave = 0.55 + 0.45 * sin(atan(vLocal.x, vLocal.z) * 6.2832 * shards + time * 40.0);
    float isSmooth = step(shards, 0.0);
    float lumps = mix(shardWave, 1.0, isSmooth);
    gl_FragColor = vec4(tint, alpha * max(edge * lumps, fill * (1.0 - edge)));
`

export function createImpact(position: Vector3, kind: ImpactKind): Effect {
  const shape = SHAPES[kind]

  // A unit sphere scaled at runtime, so growing costs a scale rather than a rebuild.
  const geometry = new SphereGeometry(1, 18, 12)
  const material = createEffectMaterial({
    body: BURST_BODY,
    uniforms: {
      tint: new Color(shape.tint), alpha: shape.opacity, time: 0, rim: shape.rim,
      fill: shape.fill, shards: shape.shards,
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
