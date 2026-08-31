import {
  Color, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import type { FireConfig } from '../combat/fire'
import { burstShape } from '../combat/fire'
import type { Effect } from './effect'
import { createEffectMaterial, POLAR_PREAMBLE } from './effect-material'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry } from './sector'

/**
 * The blast a Fire Burst throws, drawn at the volume it actually affects.
 *
 * The same honesty rule `gust-cone.ts` argues for at length and `water-reach.ts` follows: the
 * filled sector states the true reach, because a hit landing outside the visible shape teaches the
 * wrong spacing and reads as a bug. So this is the third member of that family and it differs only
 * where the move differs.
 *
 * Where it differs is **speed and width**. A gust's arc travels outward over 0.22 seconds across a
 * 120-degree wedge; a grip's closes inward over 0.3; this one is a 30-degree wedge and its arc
 * crosses it in 0.16, which is the shortest-lived effect in the game. That is the readable
 * difference between a sweep of air and a blast thrown at one soldier, and it is the same
 * vocabulary rather than a new one: direction of travel and duration, both already carrying meaning.
 *
 * The tint is the one genuinely new colour in the effects layer, and it is picked against what is
 * already on screen rather than by name. The gust is cyan, the grip a deeper blue-green, ice nearly
 * white; the Focus bar, the arm pip, the Avatar State vignette and the hot reticle are all gold,
 * which is why fire is deliberately *not* gold — an orange-red that joined that conversation would
 * read as "charged" instead of "this is the damage move". It is also hotter and far more saturated
 * than the health bar's pale salmon, which is the one other warm thing on screen.
 *
 * **The fill stays a `MeshBasicMaterial`; the arc now builds through `createEffectMaterial`.** The
 * fill has nothing to animate beyond a fading opacity, so reaching for a shader there would be a
 * knob with one setting. The arc needs one: its flicker and its collar (see `ARC_BODY`) are a
 * function of radius and time that a flat-colour material cannot express, and a flame that held one
 * flat brightness for its whole 0.16-second life would read as a coloured wedge rather than a
 * blast. The trap that used to keep this whole file off `ShaderMaterial` — a fragment body that
 * includes the `..._pars_fragment` chunks the renderer already injects fails to compile with
 * redefinition errors that throw nowhere visible, and the mesh then simply does not draw, which
 * looks like a correctly transparent effect with the world showing through — is
 * `effect-material.ts`'s to guard against, not this file's; its own doc comment carries that
 * argument in full, so it is not restated here.
 *
 * No `PointsMaterial` either, for the related reason `water-reach.ts` gives: points draw
 * screen-facing squares, so a spray of embers approaching a world unit across reads as a solid
 * block up close — and a burst thrown at seven metres is nearer the camera than any mote cloud.
 */

/**
 * Shorter than the gust's 0.22 and the grip's 0.3, and the shortest in the game.
 *
 * A burst is instantaneous where a gust is a sweep and a grip is a drag. The lifetime is also what
 * keeps the effect from lying about the cooldown: at 0.16 seconds against `burstCooldownSeconds`
 * 1.2, the screen is clear of fire for seven eighths of the wait, so the player never sees a flame
 * while the move is refusing them.
 */
const LIFETIME = 0.16
/** Above the player's origin, which is at their feet — a sector on the ground is hidden. */
const HEIGHT = 1
/**
 * Two tints, unlike the gust's one: a deep orange fill and a near-white core on the travelling arc.
 *
 * The pair is what makes a narrow wedge read as hot rather than merely orange. A single colour at
 * this width is a thin stripe; the bright leading edge is what the eye follows, and it is the same
 * trick the gust's arc plays at a much larger scale.
 */
const FILL_TINT = 0xff5a2d
const ARC_TINT = 0xffd9a0
/** Matches the gust cone's and the water reach's fill, so the three read as the same statement. */
const FILL_OPACITY = 0.34
const ARC_OPACITY = 0.95
/**
 * Arc thickness as a fraction of its own radius, and thicker than the gust's 0.16.
 *
 * A 30-degree arc at a fraction of the gust's width has far less area, so the same thickness
 * fraction would draw a sliver. Thickened until the leading edge reads at the range the move is
 * thrown at rather than to match a number in another file.
 */
const ARC_THICKNESS = 0.3
/**
 * How far out the arc starts, as a fraction of the reach.
 *
 * Not zero: the blast leaves the caster's hand rather than materialising on top of them, and an arc
 * that began at the origin would spend its first frames as a dot inside the avatar's own silhouette.
 */
const ARC_START_FRACTION = 0.25

/**
 * Flicker along the burst's length, and a collar that does not widen it.
 *
 * Every term here varies with `radius` — along the cone — and none with the angular coordinate.
 * That is deliberate: `burst.halfAngle` is `Math.PI / 12`, and §4.2's "only element with real
 * single-target damage" is implemented as that narrowness rather than as a rule. A brightness term
 * varying across the arc's width would read as a wider cone and undo it.
 *
 * **Where the flicker actually comes from.** The two frequencies do different jobs and only one of
 * them flickers. `radius * 18.0` is spatial, and `radius` spans just 0.70..1.0 on this band
 * (`sectorGeometry(halfAngle, 1 - ARC_THICKNESS, 1)` with `ARC_THICKNESS` 0.3), so it covers about
 * 0.86 of a cycle — under one, deliberately. Several concentric bright bands across a thin annulus
 * would read as ripples spreading on water, which is the wrong element entirely; what this buys
 * instead is that the band is not uniformly lit along its thickness. The flickering is the temporal
 * term: 120 rad/s is roughly three cycles inside the 0.16 s `LIFETIME`. It started at 30.0, which
 * over the same life is three quarters of one cycle — a single slow brightness sweep that would
 * have read as a moving stripe, exactly what this comment used to claim it avoided.
 */
const ARC_BODY = /* glsl */ `
    float core = smoothstep(0.82, 0.93, radius);
    float collar = smoothstep(0.72, 0.82, radius) * (1.0 - core);
    float flicker = 0.72 + 0.28 * sin(radius * 18.0 - time * 120.0);
    vec3 colour = mix(tint * 0.18, tint, core);
    gl_FragColor = vec4(colour, alpha * max(core * flicker, collar * 0.5));
`

export function createFireBurst(origin: Vector3, forward: Vector3, c: FireConfig): Effect {
  const shape = burstShape(c)
  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  // Aim the group's +Z along the heading, flattened — because `inCone` tests a flattened heading, so
  // a cone tilted with a climbing glider would misrepresent the hit volume. Same convention as
  // `createGustCone` and `createWaterReach`, and `fire-burst.test.ts` checks the drawn shape against
  // `inFireBurst` rather than restating it.
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() > 1e-8) {
    group.lookAt(group.position.clone().add(flat.normalize()))
  }

  const fillGeometry = sectorGeometry(shape.halfAngle, 0, shape.range)
  const fillMaterial = new MeshBasicMaterial({
    color: FILL_TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: FILL_OPACITY,
    // Drawn over the world rather than depth-tested against it, for the reason the gust cone is: a
    // flat sector a metre above the player's feet is buried by ground sloping up away from them,
    // which made that effect invisible in play while its geometry tests all passed.
    depthTest: false,
  })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.rotation.x = SECTOR_FLAT_ROTATION_X
  fill.userData.excludeFromShadows = true

  // A unit arc scaled at runtime, so travelling outward costs a scale rather than a geometry rebuild
  // sixty times a second.
  const arcGeometry = sectorGeometry(shape.halfAngle, 1 - ARC_THICKNESS, 1)
  const arcMaterial = createEffectMaterial({
    body: POLAR_PREAMBLE + ARC_BODY,
    uniforms: { tint: new Color(ARC_TINT), alpha: ARC_OPACITY, time: 0 },
    // Same reason the fill above sets it: a flat shape near the player's feet is buried by
    // terrain sloping up away from them, which is the defect that made this class of effect
    // invisible in play. The arc is the element the player actually reads, so it is the worse
    // half to lose.
    depthTest: false,
  })
  const arc = new Mesh(arcGeometry, arcMaterial)
  arc.rotation.x = SECTOR_FLAT_ROTATION_X
  arc.userData.excludeFromShadows = true

  // Order matters to the tests and to the reader: the fill carries the true radius.
  group.add(fill)
  group.add(arc)

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    // Outward, unlike the grip's inward close: a blast leaves the caster. Eased so the arc is
    // fastest at the start and settles at full reach, which is what an explosion does and the
    // opposite of the gust's constant sweep.
    const travelled = MathUtils.lerp(ARC_START_FRACTION, 1, 1 - (1 - t) * (1 - t))
    // Never exactly zero: a zero scale collapses the matrix.
    arc.scale.setScalar(Math.max(travelled * shape.range, 1e-4))
    fillMaterial.opacity = FILL_OPACITY * (1 - t)
    // Squared, so the arc holds its brightness through most of its travel and then goes quickly —
    // the leading edge is what the eye follows. Same curve as the gust's and the grip's.
    arcMaterial.uniforms.alpha!.value = ARC_OPACITY * (1 - t * t)
    // Drives ARC_BODY's flicker term. Raw elapsed age, not scaled here — the shader's own
    // `time * 120.0` already sets the flicker speed.
    arcMaterial.uniforms.time!.value = age
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
      arcGeometry.dispose()
      arcMaterial.dispose()
    },
  }
}
