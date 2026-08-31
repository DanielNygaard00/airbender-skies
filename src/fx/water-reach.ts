import {
  Color, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import type { WaterConfig } from '../combat/water'
import { freezeShape, gripShape } from '../combat/water'
import type { ConeShape } from '../combat/cone'
import type { Effect } from './effect'
import { createEffectMaterial, POLAR_PREAMBLE } from './effect-material'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry } from './sector'
import { safeScale } from './scale'

/**
 * The water a grip or a freeze reaches, drawn at the volume it actually affects.
 *
 * The same honesty rule `gust-cone.ts` argues for at length: the filled sector states the true
 * reach, because a hit landing outside the visible shape teaches the wrong spacing and reads as
 * a bug. So this is the gust cone's sibling rather than a new idea, and the two differ only where
 * the moves differ.
 *
 * Where they differ is the direction of travel, which is how the player tells the two elements
 * apart at a glance without reading anything. A gust's bright arc travels *outward*, away from
 * the caster. A grip's travels *inward*, because the move drags a soldier back — the same
 * inward-versus-outward contrast `vortex-ring.ts` draws against the Pressure Wave's ring, reused
 * deliberately so the vocabulary is one vocabulary and not two. A freeze's arc does not travel at
 * all: it snaps to full reach and holds, because nothing is being moved.
 *
 * **The fill stays a `MeshBasicMaterial`; the arc now builds through `createEffectMaterial`.** The
 * fill has nothing to animate beyond a fading opacity, so reaching for a shader there would be a
 * knob with one setting. The arc needs one: its dark collar (see `ARC_BODY`) is a function of
 * radius and angle that a flat-colour material cannot express. The trap that used to keep this
 * whole file off `ShaderMaterial` — a fragment body that includes the `..._pars_fragment` chunks
 * the renderer already injects fails to compile with redefinition errors that throw nowhere
 * visible, and the mesh then simply does not draw, which looks like a correctly transparent effect
 * with the world showing through — is `effect-material.ts`'s to guard against, not this file's;
 * its own doc comment carries that argument in full, so it is not restated here.
 *
 * There is no `PointsMaterial` here either, for the related reason: points draw screen-facing
 * squares, so a spray of droplets at anything approaching a world unit across reads as a white
 * block from close up. `src/world/wind-tell.ts` keeps its motes at 0.45 to 0.75 for exactly that,
 * and a water effect thrown at melee range is closer to the camera than any mote cloud.
 */
export type WaterMove = 'grip' | 'freeze'

const LIFETIME = 0.3
/** Above the player's origin, which is at their feet — a sector on the ground is hidden. */
const HEIGHT = 1

/**
 * Cooler and deeper than the gust's `0x7fe4ff`, and the two are meant to be told apart in
 * peripheral vision.
 *
 * The gust's own comment records that its first pale-blue pass measured fine and was invisible
 * in play against pale green terrain and a washed sky, so this is picked away from that hazard in
 * the same direction: saturated rather than pale. Water is the deeper blue-green of the two, and
 * ice is nearly white with a blue cast — which also separates the freeze from the Focus bar's
 * gold, the one other colour in the game that means "this cost you something".
 */
const GRIP_TINT = 0x2fb8d8
const FREEZE_TINT = 0xcfeeff

/** Matches the gust cone's fill so the two moves read as the same kind of statement. */
const FILL_OPACITY = 0.34
const ARC_OPACITY = 0.9
/** Arc thickness as a fraction of its own radius, the same as the gust's. */
const ARC_THICKNESS = 0.16
/**
 * How far in a grip's arc travels: to a fraction of the reach rather than to nothing, so it stays
 * legible as it closes. The same reasoning and the same value as `vortex-ring.ts`'s
 * `END_FRACTION`.
 */
const GRIP_END_FRACTION = 0.15

/**
 * The arc's bright core and the dark collar just inside it.
 *
 * **Why a collar rather than a brighter tint.** B1's rule was that every bright element clears
 * `post.ts`'s 0.82 bloom threshold. It is wrong in kind: contrast is a difference and 0.82 is a
 * level, so no absolute brightness separates an effect from a *bright* ground — measured twice on
 * the bench, where B1's cyan read on the canyon's rock and washed out on the island's grass. The
 * collar draws a dark band instead, so the contrast is internal and the ground behind it stops
 * mattering. The rejected alternative was raising the tint again: B1 already spent the red-channel
 * headroom five times and its four air tints now differ only in red.
 *
 * `radius` comes from `POLAR_PREAMBLE` and is the true normalised radius even on a bounded wedge.
 *
 * **Why the bounds start at 0.85 and not at zero.** The arc is `sectorGeometry(halfAngle,
 * 1 - ARC_THICKNESS, 1)`, so its fragments only ever span radius 0.84..1.0 — the mesh is a thin
 * band, not a disc, and `POLAR_PREAMBLE`'s `radius` normalises by the *outer* radius. Bounds chosen
 * in a 0..1 space would all fall below the band's inner edge, leaving `core` saturated at 1 and
 * `collar` at 0 everywhere: a collar that compiles, draws nothing, and looks exactly like the
 * uniform arc it replaced. Every bound here is a fraction of the band's own 0.16 of radius: the
 * innermost 1/16 (0.84..0.85) is left to fade so the band has a soft inner edge instead of a cut,
 * the collar fills the next 5/16 (0.85..0.90), the core ramps over the 6/16 after that
 * (0.90..0.96), and the outermost 4/16 (0.96..1.0) is fully lit.
 *
 * `travel` is 0 for the freeze and 1 for the grip, which is how one body serves both verbs without
 * a second shader: multiplied into the drift term it makes the freeze's arc snap and hold.
 */
const ARC_BODY = /* glsl */ `
    float core = smoothstep(0.90, 0.96, radius);
    float collar = smoothstep(0.85, 0.90, radius) * (1.0 - core);
    float drift = 0.86 + 0.14 * sin(angle * 40.0 - time * travel * 5.0);
    vec3 colour = mix(tint * 0.18, tint, core);
    gl_FragColor = vec4(colour, alpha * max(core * drift, collar * 0.55));
`

interface Look {
  shape: ConeShape
  tint: number
  /** Where the bright arc starts and ends, as fractions of the reach. */
  from: number
  to: number
}

function lookFor(move: WaterMove, c: WaterConfig): Look {
  return move === 'grip'
    // Inward: the arc starts at the full reach and closes on the caster, which is the direction
    // the soldier is about to travel.
    ? { shape: gripShape(c), tint: GRIP_TINT, from: 1, to: GRIP_END_FRACTION }
    // Still: ice does not travel. It arrives at full reach and fades where it stands.
    : { shape: freezeShape(c), tint: FREEZE_TINT, from: 1, to: 1 }
}

export function createWaterReach(
  origin: Vector3, forward: Vector3, move: WaterMove, c: WaterConfig,
): Effect {
  const look = lookFor(move, c)
  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  // Aim the group's +Z along the heading, flattened — because `inCone` tests a flattened
  // heading, so a cone tilted with a climbing glider would misrepresent the hit volume. Same
  // convention as `createGustCone`, and `water-reach.test.ts` checks the drawn shape against
  // `inWaterGrip`/`inIceLock` rather than restating it.
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() > 1e-8) {
    group.lookAt(group.position.clone().add(flat.normalize()))
  }

  const fillGeometry = sectorGeometry(look.shape.halfAngle, 0, look.shape.range)
  const fillMaterial = new MeshBasicMaterial({
    color: look.tint, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: FILL_OPACITY,
    // Drawn over the world rather than depth-tested against it, for the reason the gust cone is:
    // a flat sector a metre above the player's feet is buried by ground sloping up away from
    // them, which made that effect invisible in play while its geometry tests all passed.
    depthTest: false,
  })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.rotation.x = SECTOR_FLAT_ROTATION_X
  fill.userData.excludeFromShadows = true

  // A unit arc scaled at runtime, so travelling costs a scale rather than a geometry rebuild
  // sixty times a second.
  const arcGeometry = sectorGeometry(look.shape.halfAngle, 1 - ARC_THICKNESS, 1)
  const arcMaterial = createEffectMaterial({
    body: POLAR_PREAMBLE + ARC_BODY,
    uniforms: {
      tint: new Color(look.tint), alpha: ARC_OPACITY, time: 0, travel: move === 'grip' ? 1 : 0,
    },
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
    const reach = MathUtils.lerp(look.from, look.to, t) * look.shape.range
    // Never exactly zero: a zero scale collapses the matrix, and the grip's arc closes toward
    // the caster rather than to nothing anyway.
    arc.scale.setScalar(safeScale(reach))
    fillMaterial.opacity = FILL_OPACITY * (1 - t)
    // Squared, so the arc holds its brightness through most of its travel and then goes
    // quickly — the leading edge is what the eye follows. Same curve as the gust's.
    arcMaterial.uniforms.alpha!.value = ARC_OPACITY * (1 - t * t)
    // Drives ARC_BODY's drift term. Raw elapsed age, not scaled here, because the shader's own
    // `time * travel * 5.0` already sets the travel speed.
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
