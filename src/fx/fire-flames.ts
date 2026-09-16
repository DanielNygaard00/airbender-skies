import { Color, CylinderGeometry, DoubleSide, Group, Mesh, Vector3 } from 'three'
import { burstShape, type FireConfig } from '../combat/fire'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { SECTOR_SEGMENTS } from './sector'

/**
 * The flames a Fire Burst actually burns with.
 *
 * `fire-burst.ts` draws the burst's reach as a flat sector and lives 0.16 seconds, the shortest
 * effect in the game. Both of those are deliberate and both stay. What the pair produced, though,
 * was the single worst read in the directory: photographed on the bench, the fire burst and the
 * stone throw were the same shape, the same flatness and very nearly the same colour — a pale
 * warm wedge lying on green grass. Two elements that share a silhouette and a hue are, to a
 * player at combat range, one element.
 *
 * This is the other half: a wall of flame standing up inside that cone, with fingers, a heat ramp
 * and a flicker.
 *
 * **Colour is where this departs hardest, and on purpose.** `fire-burst.ts`'s `0xffd9a0` is a
 * pale cream that sits a few degrees of hue from earth's `0xd9a066`, and `enemy-mesh.ts` already
 * carries a note about the same warm-tan register swallowing distinctions elsewhere. Retinting
 * the existing tells was ruled out as a non-goal across three visual passes, and it stays ruled
 * out — but this effect is new, so its colours are chosen rather than inherited. They run from a
 * hot yellow at the base to a deep orange-red at the tips, which is the one gradient no other
 * element in the game has any claim on.
 *
 * **The ramp is what makes it fire rather than orange light.** Real flame is hottest where it is
 * fed and coolest where it runs out, so the colour is a function of height *within each tongue*
 * rather than of height up the mesh — a fixed gradient would put the same colour across tall and
 * short fingers alike and read as a painted backdrop.
 *
 * Depth-tested, like `water-sheet.ts` and `air-wall.ts` and unlike the flat tells: a standing
 * shell has an underside, and the terrain is what should hide it.
 */

/**
 * How long the flames burn.
 *
 * Twice `fire-burst.ts`'s 0.16, and the two are not in competition for the same reason the earth
 * volley outlasts its sector: the flat arc states the reach and the flame is the event. A sixth
 * of a second is enough to flash a shape and far too little to watch something burn, and fire is
 * the element whose whole brief is being alive — which needs long enough for the flicker to
 * flicker more than once.
 *
 * Still well inside the move's own rhythm: the burst resolves on the frame it fires, so every
 * frame of this is already after the fact, the same licence `impact.ts` takes.
 */
const LIFETIME = 0.34

/**
 * How tall the flames stand, as a fraction of the burst's range.
 *
 * Proportional so the shape survives a retune of the cone. The burst's range is 7, so this puts
 * the tallest tongues a little over three units up — around twice a soldier's height, which is
 * what a burst of fire should look like next to the people it is aimed at.
 */
const HEIGHT_FRACTION = 0.45

/** Hot yellow where the flame is fed. */
const CORE_TINT = 0xffe08a
/** Deep orange-red where it runs out. Nothing else in the game is this colour. */
const EMBER_TINT = 0xd6380f

const PEAK_ALPHA = 0.9

/**
 * Cylinder side `vUv` is (around, up), which is the one geometry here needing no translation.
 *
 * `vUv.x` runs 0 to 1 across an open wedge rather than around a closed loop, so there is no wrap
 * for these `sin` terms to be discontinuous at and the seam rule that governs `steam.ts` does not
 * bite. That is worth stating because the multipliers below are deliberately not multiples of a
 * turn, which on a closed body would be a defect.
 */
const FLAME_BODY = /* glsl */ `
    float up = vUv.y;

    // Two families of tongues at different spacings, sliding in opposite directions. One alone
    // reads as a comb; crossed, they beat against each other and the fire never repeats itself
    // inside the third of a second anybody watches it for.
    float lick = 0.5 + 0.5 * sin(vUv.x * 26.0 + time * 14.0);
    float cross = 0.5 + 0.5 * sin(vUv.x * 41.0 - time * 19.0);
    float tongue = 0.45 + 0.55 * (lick * 0.6 + cross * 0.4);

    // Each tongue's own tip, so the flame has fingers rather than a ceiling.
    float tip = 0.32 + 0.62 * tongue;
    float body = smoothstep(tip, tip - 0.46, up);

    // The heat ramp, measured up each tongue rather than up the mesh: a fixed gradient would
    // paint tall and short fingers the same colour and read as a backdrop rather than as fire.
    vec3 colour = mix(tint, ember, clamp(up / max(tip, 0.001), 0.0, 1.0));

    // Fast, because fire is the one element that must never look still. Far above the rate any
    // other effect here flickers at, which is the point of difference rather than an oversight.
    float flicker = 0.76 + 0.24 * sin(time * 40.0 + vUv.x * 12.0);

    // Soft at the foot and at both ends of the arc, so the wedge does not read as a cut panel --
    // the correction water-sheet.ts needed once its crest was broken.
    float foot = smoothstep(0.0, 0.08, up);
    float ends = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);

    gl_FragColor = vec4(colour, alpha * body * flicker * foot * ends);
`

export function createFireFlames(at: Vector3, forward: Vector3, c: FireConfig): Effect {
  const shape = burstShape(c)
  const object = new Group()
  object.name = 'fire-flames'
  object.position.copy(at)

  // Yaw only: the burst's cone is horizontal, so a caster looking down must not tip the flames
  // into the ground. `CylinderGeometry` puts theta 0 at local +Z, which `air-wall.ts` records.
  const flat = new Vector3(forward.x, 0, forward.z)
  object.rotation.y = flat.lengthSq() < 1e-6 ? 0 : Math.atan2(flat.x, flat.z)

  const height = shape.range * HEIGHT_FRACTION
  const geometry = new CylinderGeometry(
    1, 1, 1, SECTOR_SEGMENTS, 1,
    // Open-ended: a curtain of flame is a surface, not a slice of pie.
    true,
    -shape.halfAngle, 2 * shape.halfAngle,
  )
  const material = createEffectMaterial({
    body: FLAME_BODY,
    uniforms: {
      tint: new Color(CORE_TINT), ember: new Color(EMBER_TINT), alpha: 0, time: 0,
    },
    side: DoubleSide,
  })

  const mesh = new Mesh(geometry, material)
  mesh.position.y = height / 2
  object.add(mesh)

  let elapsed = 0

  return {
    object,

    advance(dt: number): boolean {
      elapsed += Number.isFinite(dt) && dt > 0 ? dt : 0
      if (elapsed >= LIFETIME) return false

      const life = elapsed / LIFETIME

      // The flame runs *out* along the cone rather than closing in like the water: the burst
      // pushes away from the caster, which is the direction `fire-burst.ts`'s own arc travels.
      // It starts part-way out rather than at nothing, or the first frames are a flame burning
      // inside the caster's own chest.
      const radius = shape.range * (0.35 + 0.65 * life)
      mesh.scale.set(radius, height, radius)

      // Up almost at once and then a long burn down, which is how fire behaves and the opposite
      // of the symmetrical fade a flat tell can get away with.
      const rise = life < 0.12 ? life / 0.12 : 1 - ((life - 0.12) / 0.88) ** 1.6
      material.uniforms['alpha']!.value = PEAK_ALPHA * Math.max(0, rise)
      material.uniforms['time']!.value = elapsed

      return true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
