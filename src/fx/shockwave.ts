import { Color, MathUtils, Mesh, RingGeometry } from 'three'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { safeScale } from './scale'

/**
 * The ring a Pressure Wave leaves on the ground.
 *
 * This repo treats a wind feature the player cannot see as a bug, and an invisible
 * slam is the same mistake — especially here, where the strength of the slam is the
 * whole mechanic. So the ring carries the same information the damage does: a weak
 * slam is a faint ring, a full one is bright.
 *
 * **Once shared by three callers; now the slam's alone.** Steam and Mud both fired this same
 * ring as an admitted placeholder for a reaction burst, telling the two apart from the slam and
 * from each other only by `tint` — `main.ts`'s `REACTION_LOOKS` held that tint table until Task 8
 * deleted it. Task 7 gave Steam its own rising column and Task 8 gives Mud its own flat spatter,
 * so the slam above is this module's only caller today. The material stays tint-driven anyway
 * rather than losing the parameter now that nothing else calls it: a chain finisher is still a
 * deferred third caller on the same terms — deferred to step B2 and does not exist yet, so this
 * comment does not count it — and a caller saying what it means with a parameter it already has
 * is cheaper than reintroducing one the day that finisher lands.
 */
export type Shockwave = Effect

const LIFETIME = 0.4
/** Fraction of the final radius the ring starts at. */
const START_FRACTION = 0.2
/** Ring thickness as a fraction of its radius. */
const THICKNESS = 0.35
/** Opacity of a minimum-strength slam, so a weak one is still visible. */
const FAINTEST = 0.25

/**
 * The Pressure Wave's own colour, and the default for a caller with nothing else to say.
 *
 * Measured the way `post.ts`'s threshold actually reads it: `new Color(hex)` and
 * `0.2126*c.r + 0.7152*c.g + 0.0722*c.b`, the linear values three's sRGB decoding produces — not
 * hex-divided-by-255. `new Color(0xdff1ff)` is `{ r: 0.738, g: 0.880, b: 1 }`, luminance ≈ 0.858 —
 * already clearing the 0.82 bloom threshold on its own, which is expected of a colour picked to
 * read as "bright slam" before this task ever measured it, and is why this default did not need
 * the raise-green trick `gust-cone.ts`'s `ARC_TINT` and `vortex-ring.ts`'s `TINT` both needed.
 */
const DEFAULT_TINT = 0xdff1ff

/**
 * A bright leading edge with a soft trail behind it, so the ring reads as a front the slam pushed
 * outward rather than a hoop of even brightness — the outward half of the vocabulary
 * `water-reach.ts` documents against `vortex-ring.ts`'s ring closing inward.
 *
 * **`RingGeometry`'s own UVs are a trap for exactly this.** They are not polar — three.js builds
 * them as a Cartesian projection of each vertex, `uv = (position / outerRadius + 1) / 2` — so
 * neither `vUv.x` nor `vUv.y` alone runs across the ring's thickness; on a unit ring the vertex at
 * angle 0 sits at `(0.92, 0.50)` and the one at 90 degrees at `(0.50, 0.92)`. `vortex-ring.ts`'s
 * own doc comment records an earlier draft of this plan driving a radial term straight off
 * `vUv.y` for exactly this reason, which reads as a static top/bottom vignette, not a gradient
 * crossing the annulus. `radius` and `around` below are re-derived from the centred UV instead
 * (`p = vUv * 2 - 1`, `length(p)`, `atan(p.y, p.x)`), which is the one construction that actually
 * crosses the ring's thickness and runs around its circumference respectively.
 *
 * The two `smoothstep` bands are tuned against this ring's own `THICKNESS` (0.35), which puts the
 * inner edge at `radius = 1 - THICKNESS = 0.65`: `front`'s lower bound (0.55) sits below that inner
 * edge, so the whole visible annulus gets a nonzero value instead of being clipped dark near the
 * middle; `trail`'s upper bound (0.75) sits inside the annulus, so only the innermost sliver — the
 * ring's trailing edge — is dimmed while the rest stays near full. Combined, brightness climbs
 * steeply from a dim inner (trailing) edge to a fully bright outer (leading) one. `grain` is the
 * same cheap two-term hash `gust-cone.ts`'s `ARC_BODY` uses in place of a noise texture, driven by
 * `around` rather than radius so it breaks up the ring's circumference instead of its thickness.
 */
const RING_BODY = /* glsl */ `
    vec2 p = vUv * 2.0 - 1.0;
    float radius = length(p);
    float around = atan(p.y, p.x);
    float front = smoothstep(0.55, 1.0, radius);
    float trail = smoothstep(0.35, 0.75, radius);
    float grain = 0.9 + 0.1 * sin(around * 24.0 - time * 6.0);
    gl_FragColor = vec4(tint, alpha * front * trail * grain);
`

/**
 * `tint` defaults to the Pressure Wave's own colour rather than being required, so the slam ring
 * did not have to change to keep its look the day Steam and Mud arrived as second and third
 * callers wanting their own colours instead — see the module comment above for why both have
 * since left. A reaction has no notion of "strength" the way a slam does, so for the time those
 * two did call this it was the colour, not the shape, that told the player which one just fired.
 */
export function createShockwave(radius: number, strength: number, tint = DEFAULT_TINT): Effect {
  // A unit ring scaled at runtime. Rebuilding the geometry each frame to grow it
  // would allocate sixty times a second for something a scale already does.
  const geometry = new RingGeometry(1 - THICKNESS, 1, 48)
  const material = createEffectMaterial({
    body: RING_BODY,
    uniforms: { tint: new Color(tint), alpha: FAINTEST, time: 0 },
  })

  const mesh = new Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.userData.excludeFromShadows = true

  const peak = MathUtils.lerp(FAINTEST, 1, MathUtils.clamp(strength, 0, 1))
  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    mesh.scale.setScalar(safeScale(MathUtils.lerp(START_FRACTION * radius, radius, t)))
    material.uniforms.alpha!.value = peak * (1 - t)
    // Drives the grain in RING_BODY. Raw elapsed age, not scaled here, because the shader's own
    // `time * 6.0` already sets its speed — the same convention `gust-cone.ts` and
    // `vortex-ring.ts` both use for their own time uniform.
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
