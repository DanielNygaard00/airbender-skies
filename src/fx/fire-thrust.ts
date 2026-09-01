import {
  BoxGeometry, Color, Group, MathUtils, Mesh, Vector3,
} from 'three'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'

/**
 * The plume a Fire Thrust leaves, drawn opposite the push.
 *
 * The one effect in the game whose whole job is to say a *resource* was spent rather than that
 * something was hit. A thrust produces no damage, no burst on a body and no sound of contact, so
 * without this the player's only feedback that a charge went is one pip going out in the corner of
 * the HUD — and the move exists to be pressed in an emergency, which is exactly when nobody is
 * looking at the HUD.
 *
 * **It points backwards, and that is the whole readability decision.** Fire leaves the wing in the
 * direction opposite the acceleration, so the plume is the impulse mirrored: a thrust that climbs
 * draws a flame going down and behind. That is also what separates it at a glance from the burst,
 * which throws its cone *forward* — the same outward-versus-inward vocabulary `water-reach.ts`
 * borrows from `vortex-ring.ts`, applied to the two verbs of one element instead of to two elements.
 *
 * Its length comes from the impulse it is drawn for rather than from a constant, so retuning
 * `thrustUpSpeed` or `thrustForwardSpeed` moves the tell with the move. The other candidate was a
 * fixed length, and it would have quietly stopped describing the thrust the first time either number
 * changed.
 *
 * Aimed in full 3D, unlike every cone in `src/fx/`, and the difference is not an oversight: those
 * are drawings of flattened hit volumes and have to be flattened to stay honest, and this is a
 * drawing of a vector that genuinely has a vertical component. Flattening it would draw a horizontal
 * flame for a move whose main axis is up.
 *
 * **The plume now builds through `createEffectMaterial`, the last of the five Task 2 collar
 * carries onto.** It was a flat `MeshBasicMaterial` before: the trap that kept it there — a
 * `ShaderMaterial` including the `..._pars_fragment` chunks the renderer already injects fails to
 * compile with redefinition errors that throw nowhere visible, and the mesh then simply does not
 * draw, which reads as a tastefully transparent effect rather than as a broken one — is
 * `effect-material.ts`'s to guard against, not this file's; its own doc comment carries that
 * argument in full, so it is not restated here. What a shader buys that a flat colour could not is
 * `PLUME_BODY`'s bright core and collar (see its own doc comment), the last of the five places this
 * pattern lands — five, not the design note's original six: Task 7 made Steam the collar's first
 * exemption instead of its sixth carrier, and `mud.ts` names itself the second and last such
 * exemption, so the count that actually ships is `grep -n "mix(tint \* 0.18, tint, core)"
 * src/fx/*.ts`'s five non-test hits: `earth-reach.ts`, `fire-burst.ts`, this file, `ice-shell.ts`
 * and `water-reach.ts`.
 */

/** Short: a thrust is one shove, not a sustained burn. Under the burst cone's own 0.16. */
const LIFETIME = 0.14
/**
 * How much of the impulse's travel the plume is drawn along, in seconds.
 *
 * The flame is as long as the distance the push carries the glider in this much time, which at the
 * shipped impulse of 10.8 m/s is about 1.3 m — around two thirds of the character's 1.8 height, so
 * it reads as a jet off the wing rather than as a beam.
 */
const PLUME_SECONDS = 0.12
/** Off the feet, at roughly the height the wing is carried. Matches the ice shell's centre. */
const HEIGHT = 0.95
/** Cross-section, tapering to nothing over the life. Narrower than the dash trail's 0.45 slab. */
const WIDTH = 0.34
const THICKNESS = 0.34
/** The burst's core white-orange, so the two verbs of one element share a colour. */
const TINT = 0xffd9a0
const PEAK_OPACITY = 0.85

/**
 * A plume brightest at the nozzle, fading and collared down its length.
 *
 * `vLocal.z` rather than `vUv`: a `BoxGeometry` carries a full 0..1 UV square on each of its six
 * faces, so `vUv.x` means a different axis depending on which face a fragment belongs to, and a
 * gradient written against it would streak along the plume on two faces and across it on four.
 * Object-space z is face-independent.
 *
 * **Which end is the nozzle was read from the placement, not assumed.** The group is aimed against
 * the impulse so its +Z is where the fire goes, and `apply()` pushes the slab forward by half its
 * length "so it starts at the wing rather than straddling it" — so the box's near face, object-space
 * z = -0.5, is the wing, and `along01` 0 is the nozzle. Both bands are therefore written with their
 * edges descending, which is what puts the bright core at the nozzle and the dark collar in the
 * mid-plume rather than the other way round. Writing them ascending would have lit the plume's far
 * tip and darkened the hand it leaves, which is a picture of something being sucked in.
 *
 * **The two frequencies in `lick` do different jobs, and under-one-cycle travel is right here for
 * the opposite reason it was wrong for `fire-burst.ts`'s `ARC_BODY`.** `along01 * 30.0` is spatial
 * and `along01` spans a full 0..1 across the whole plume, so it covers 30 / (2π) ≈ 4.77 cycles along
 * the length — the same idiom `dash-trail.ts`'s `TRAIL_BODY` already ships (`along01 * 26.0` across
 * its own full 0..1 length, ≈ 4.14 cycles): a rich standing pattern of several bright ropes at once,
 * not a single band. `time * 36.0` is temporal, and over the 0.14 s `LIFETIME` it advances
 * 36 * 0.14 = 5.04 rad, ≈ 0.80 of one cycle — sub-one-cycle travel, same regime as `dash-trail.ts`'s
 * own `time * 12.0` over its 0.3 s `LIFETIME` (12 * 0.3 = 3.6 rad, ≈ 0.57 of one cycle), already
 * shipped on the same `BoxGeometry`/`vLocal.z` idiom. Because several ropes already exist along the
 * length, sliding that whole pattern by most of one band period over the life reads as the ropes
 * *travelling* down the plume — legible motion, because there is spatial structure for it to move
 * across; this term does not produce a flicker, it produces travel.
 *
 * Contrast `ARC_BODY`, where the identical under-one-cycle arithmetic was the defect, not the fix.
 * Its spatial term, `radius * 18.0`, only crosses a thin 0.70..1.0 annulus and so covers ≈ 0.86 of
 * one cycle — effectively a single band, with no companion band for it to slide past. A single band
 * has no motion to travel *as*; its only visible behaviour is its own brightness rising and falling
 * in place, which is a flicker, not travel. `ARC_BODY`'s comment records that its temporal rate
 * started at 30 rad/s, which over its 0.16 s `LIFETIME` is 30 * 0.16 / (2π) ≈ 0.75 of one cycle — under
 * one, and because the sole band never finished even one full rise-and-fall before the effect ended,
 * that read as "a single slow brightness sweep... exactly what this comment used to claim it
 * avoided," fixed by raising the rate to 120 rad/s (≈ 3.06 cycles over the same life). Same
 * arithmetic, opposite consequence, because the spatial term differs in kind: a rich pattern here
 * turns sub-one-cycle temporal motion into travel; a single band there turns the same regime into an
 * unfinished flicker.
 */
const PLUME_BODY = /* glsl */ `
    float along01 = vLocal.z + 0.5;
    float core = smoothstep(0.45, 0.05, along01);
    float collar = smoothstep(0.80, 0.45, along01) * (1.0 - core);
    float lick = 0.7 + 0.3 * sin(along01 * 30.0 - time * 36.0);
    vec3 colour = mix(tint * 0.18, tint, core);
    gl_FragColor = vec4(colour, alpha * max(core * lick, collar * 0.5));
`

/**
 * The plume's length for a given impulse.
 *
 * Exported so a test can hold the drawn length to the shipped `FireConfig` through
 * `fireThrustImpulse`, rather than checking this formula against itself.
 */
export function plumeLength(impulse: Vector3): number {
  return impulse.length() * PLUME_SECONDS
}

export function createFireThrust(origin: Vector3, impulse: Vector3): Effect {
  const length = plumeLength(impulse)

  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  // Aimed *against* the impulse, so the group's +Z is where the fire goes. A zero or non-finite
  // impulse leaves the group unrotated rather than throwing or producing a NaN matrix: nothing in
  // the game can hand one over — `fireThrustImpulse` always carries `thrustUpSpeed` — but a plume
  // pointing along +Z is a visible wrong answer where a corrupted matrix is an invisible one.
  const exhaust = impulse.clone().negate()
  if (exhaust.lengthSq() > 1e-8 && Number.isFinite(exhaust.lengthSq())) {
    group.lookAt(group.position.clone().add(exhaust.normalize()))
  }

  // A unit-length slab along +Z, scaled to the plume length — the same shape `dash-trail.ts` uses,
  // so the streak can be stretched without rebuilding geometry and a test can read the length off
  // the scale.
  const geometry = new BoxGeometry(WIDTH, THICKNESS, 1)
  // `side` is left to the builder's default, deliberately: it defaults to DoubleSide, which is
  // exactly what the original MeshBasicMaterial here set explicitly, so this is not an oversight.
  const material = createEffectMaterial({
    body: PLUME_BODY,
    uniforms: { tint: new Color(TINT), alpha: PEAK_OPACITY, time: 0 },
    // Drawn over the world, for the same reason the dash trail and every cone here are: a thrust
    // fired close to a cliff face would otherwise be swallowed by the rock at exactly the moment
    // the player most needs to know the charge went. `createEffectMaterial`'s own default is
    // `true`, so this stays an explicit override rather than an inherited accident.
    depthTest: false,
  })
  const plume = new Mesh(geometry, material)
  plume.userData.excludeFromShadows = true
  group.add(plume)

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    // Stretches as it fades and thins as it stretches, which is what an exhaust plume does. Never
    // exactly zero on any axis: a zero scale collapses the matrix.
    const stretch = MathUtils.lerp(1, 1.6, t)
    plume.scale.set(
      Math.max(MathUtils.lerp(1, 0.2, t), 1e-4), Math.max(MathUtils.lerp(1, 0.2, t), 1e-4),
      Math.max(length * stretch, 1e-4),
    )
    // Pushed forward by half its length so it starts at the wing rather than straddling it, the
    // same offset `dash-trail.ts` applies, recomputed because the length grows.
    plume.position.z = (length * stretch) / 2
    material.uniforms.alpha!.value = PEAK_OPACITY * (1 - t)
    // Drives PLUME_BODY's lick term. Raw elapsed age, not scaled here — the shader's own
    // `time * 36.0` already sets the flicker speed, the same convention `dash-trail.ts` and
    // `fire-burst.ts` both use for their own time uniform.
    material.uniforms.time!.value = age
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
      geometry.dispose()
      material.dispose()
    },
  }
}
