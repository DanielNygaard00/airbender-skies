import { Color, CylinderGeometry, DoubleSide, Group, MathUtils, Mesh, Vector3 } from 'three'
import { gripShape, type WaterConfig } from '../combat/water'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { SECTOR_SEGMENTS } from './sector'

/**
 * The curtain of water a Water Grip drags in, drawn as a moving body of liquid.
 *
 * `water-reach.ts` states the ground the grip covers — a flat sector with a bright arc closing on
 * the caster — and that statement is honest and stays. What it cannot do is look wet. A flat
 * translucent wedge lying on grass has no surface, no thickness and no up: every cue that says
 * "liquid" rather than "coloured light" lives in the third dimension, and the sector has none of
 * it. Photographed on the bench, water and earth differed only in hue.
 *
 * So this stands the water up. A curved sheet rises off the ground at the reach and sweeps inward
 * over the grip's life, which is the move: the arc in `water-reach.ts` travels inward for exactly
 * this reason, and this is the same journey with a body attached.
 *
 * **Three cues, and each is doing a specific job.**
 *
 * *A broken crest.* The top edge is not a line but a row of lobes that slide along the sheet,
 * because the single readable difference between water and glass at a distance is that water's
 * edge is never straight. This is the cue that does most of the work.
 *
 * *Flow down the face.* Bands run down the sheet and inward, against a surface with several
 * cycles of its own across it — the criterion `fire-thrust.ts` set for motion that reads as travel
 * rather than as flicker, which `water-reach.ts`'s own comment admits its arc does not meet. This
 * one does: sixteen cycles up the face against a temporal term that crosses nine radians a second.
 *
 * *Thinning at every edge.* The sheet fades out at its foot rather than cutting a line into the
 * terrain, thins toward the crest so the top breaks into spray, and runs out at both ends of the
 * arc. That last one was not in the first pass and mattered more than it sounds: an open cylinder
 * ends in two dead-straight verticals, and once the crest was broken and the face was flowing
 * those were the only straight lines left in the effect, so the eye went to them and read the
 * whole thing as a cut panel.
 *
 * Depth-tested, which is the departure from the flat tells in this directory and the same one
 * `air-wall.ts` makes for the same reason: this is a tall curved shell rather than a sheet lying a
 * metre off the floor, and the depth test is what keeps the part of it below the terrain hidden by
 * the terrain. A shell drawn over the world would show its own underside through the hill.
 */

/** Matched to `water-reach.ts`'s own `LIFETIME`, so the two tells start and end together. */
const LIFETIME = 0.3

/**
 * How far the sheet closes on the caster, as a fraction of the grip's reach.
 *
 * The same 0.15 `water-reach.ts` runs its bright arc to, and it has to be: the two draw the same
 * journey, and a curtain that stopped short of where the arc ended would read as two different
 * moves happening at once.
 */
const END_FRACTION = 0.15

/**
 * How tall the sheet stands, as a fraction of the grip's reach.
 *
 * Proportional rather than absolute so the curtain keeps its shape if the grip's range is retuned
 * — a fixed height would read as a wall at short range and as a puddle at long.
 *
 * Better than a third, which is higher than it first sounds. The grip's range is 10, so this
 * stands the crest at 3.8 units: over twice the height of the soldiers it is dragging. The first
 * pass took a fifth, which is physically the more sober choice and photographed as a ripple — a
 * two-unit sheet seen from the twenty-odd units a fight is read at, through a camera angled down
 * onto it, is a few pixels of foreshortened band. A wave has to be taller than what it is picking
 * up or it does not read as one.
 */
const HEIGHT_FRACTION = 0.38

/** Cooler and deeper than the gust's pale blue, and the same tint `water-reach.ts`'s grip uses. */
const TINT = 0x2fb8d8

const PEAK_ALPHA = 0.85

/**
 * `vUv` on a cylinder's side genuinely is (around, up) — the one geometry in this directory whose
 * UVs need no translation, which `effect-material.ts`'s geometry table records.
 *
 * The lobe and flow counts are written against `vUv.x`, which runs 0 to 1 across the wedge rather
 * than around a closed loop, so there is no wrap for a `sin` to be discontinuous at and the seam
 * rule that governs `steam.ts` and `mud.ts` does not apply here.
 */
const SHEET_BODY = /* glsl */ `
    float up = vUv.y;

    // Two detail layers crossed against each other, rather than one travelling wave.
    //
    // The single sin this replaces was the honest minimum and it read as corrugation: one
    // spacing, one direction, so the eye finds the period immediately and the surface becomes a
    // washboard. Real water never shows one frequency. The second layer is sampled on a rotated,
    // differently-scaled coordinate and slid the other way, so the two beat against each other
    // and the combined field does not repeat inside the third of a second anyone sees it for.
    //
    // The rotation is the part worth copying rather than the exact numbers: layering the same
    // pattern at the same orientation just doubles its contrast, where crossing it breaks the
    // grain up. It is the trick every scrolling-normal ocean uses to avoid a visible tiling
    // direction, reduced here to what a procedural body can afford.
    vec2 q = vec2(vUv.x, up);
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    vec2 r = turn * q;
    float phaseA = q.x * 29.0 - q.y * 14.0 + time * 6.0;
    float phaseB = r.x * 47.0 + r.y * 22.0 - time * 9.4;
    float layerA = sin(phaseA);
    float layerB = sin(phaseB);
    float detail = 0.5 + 0.5 * (layerA * 0.62 + layerB * 0.38);

    /*
     * The slope of that field, worked out exactly rather than sampled.
     *
     * Both layers are sines of a linear phase, so each one's gradient is its cosine times the
     * phase's own coefficients -- no extra texture fetches, no finite differences, and no error.
     * Layer B lives on the rotated coordinate, so its gradient is carried back through the
     * transpose of that rotation to land in the same space as layer A's.
     *
     * This is what the reference's water has that this sheet did not: its surface normal is
     * bent, frame by frame, by the waves running across it. A vertical curtain's own normal is
     * horizontal everywhere, so any lighting computed against it is uniform -- which is why a
     * highlight keyed on that normal produced nothing at all on the first attempt.
     */
    vec2 slopeA = cos(phaseA) * vec2(29.0, -14.0);
    vec2 slopeB = cos(phaseB) * (vec2(47.0, 22.0) * turn);
    vec2 slope = slopeA * 0.62 + slopeB * 0.38;

    // The crest, broken by that combined field. Water's edge is never straight, and at the range
    // this is read from that is the whole difference between a wave and a pane of glass.
    float crest = 0.74 + 0.16 * detail;

    // The body of the sheet, ending at that broken crest.
    float body = smoothstep(crest, crest - 0.42, up);

    // Flow running down the face and around it, which is the direction the grip drags.
    float flow = 0.70 + 0.30 * sin(up * 16.0 - time * 9.0 + vUv.x * 9.0);

    // The collar: contrast drawn inside the sheet's own top edge, so the shape is legible
    // against whatever is behind it rather than relying on the terrain being dark.
    float core = smoothstep(crest - 0.30, crest - 0.06, up);
    vec3 colour = mix(tint * 0.22, tint, core);

    /*
     * Fresnel, and this is the cue that does the most work of anything in this file.
     *
     * Water is barely visible looking straight into it and almost a mirror at a glancing angle,
     * and that one fact is most of why a surface reads as liquid rather than as coloured glass.
     * Nothing else here was expressing it: the sheet was equally opaque wherever you looked at
     * it, which is how a plastic panel behaves.
     *
     * Schlick's approximation, the same 0.02 + 0.98 * pow(1 - cos, 5) shape any water shader
     * uses, against the view-space normal effect-material.ts already carries for ice-shell.ts.
     * A curved sheet seen from outside therefore brightens along its turning edges and thins
     * where it faces the camera, which is exactly where the body behind it should show through.
     */
    // Bent by the slope above. The scale is small on purpose: the slope's raw magnitude runs into
    // the tens, and a normal tipped that far reads as hammered metal rather than moving water.
    vec3 n = normalize(normalize(vViewNormal) + vec3(slope * 0.022, 0.0));
    float facing = abs(n.z);
    float fresnel = 0.08 + 0.92 * pow(1.0 - facing, 5.0);

    /*
     * Glints: a tight specular off the bent normal, against a fixed light in view space.
     *
     * Fixed rather than read from the scene's sun because effect-material.ts deliberately
     * carries no lighting into its bodies -- every effect here is self-lit -- and wiring the sun
     * through for one effect would make it the only one that changes with time of day. A light
     * high and slightly to the side of the camera puts the glints on the crests of whichever
     * waves are tipped towards the viewer, which is where the eye expects them.
     *
     * Very tight, and that is what makes it read as water rather than as gloss: a broad
     * highlight is plastic sheen, a scatter of sharp points is a wet surface catching light.
     */
    vec3 light = normalize(vec3(-0.35, 0.8, 0.5));
    vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
    float glint = pow(max(dot(n, halfway), 0.0), 90.0);
    colour += vec3(0.9, 0.97, 1.0) * glint * 1.4;

    /*
     * Lace: foam as a hard threshold on the detail field rather than a soft gradient.
     *
     * Foam is not a lighter shade of water, it is a different substance with an edge, and a
     * threshold is what gives it one. Taken high up the sheet and only on the peaks of the
     * combined field, so it breaks into patches along the crest instead of banding across it.
     */
    float lace = smoothstep(0.70, 0.79, detail) * smoothstep(crest - 0.34, crest - 0.04, up);
    colour = mix(colour, vec3(0.86, 0.95, 1.0), lace * 0.55);

    // Thinned at the foot so the sheet does not cut a hard line into the grass.
    float foot = smoothstep(0.0, 0.2, up);

    // And thinned at both ends of the arc, which is what stops the wedge reading as a cut panel.
    // An open cylinder ends in two dead-straight vertical edges, and nothing else in the shader
    // softens them: with the crest broken and the face flowing, those two hard verticals were
    // the only straight lines left and the eye went to them first. Faded over a tenth of the
    // span at each end, the sheet reads as a wave that runs out rather than as one that was cut.
    float ends = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);

    // Fresnel adds at the edges rather than taking away from the face. The first pass floored
    // face-on opacity at 0.45, which is physically the truer reading and photographed as a ghost
    // from the twenty-odd metres a fight is read at: a sheet curved around the caster mostly
    // faces a camera behind them, so nearly all of it sat at the floor. This is a combat tell
    // before it is a material, and a grip the player cannot see is worse than one that is a
    // little too present -- so the face keeps its opacity and the turning edges go past it.
    float clarity = mix(0.9, 1.35, fresnel);
    colour += tint * fresnel * 0.6;

    // Lace and glints both push opacity as well as colour. A bright pixel at the sheet's own
    // translucency is still mostly the grass behind it; foam and a caught highlight are the two
    // things on a water surface that are genuinely opaque, so they are allowed to be.
    float shell = alpha * body * ends;
    float sheet = shell * flow * foot * clarity;
    gl_FragColor = vec4(colour, clamp(sheet + shell * (lace * 0.3 + glint * 0.5), 0.0, 1.0));
`

export function createWaterSheet(at: Vector3, forward: Vector3, c: WaterConfig): Effect {
  const shape = gripShape(c)
  const object = new Group()
  object.name = 'water-sheet'
  object.position.copy(at)

  // Aimed by yaw alone, because the grip's cone is horizontal: pitching the curtain with a
  // caster who is looking down would tip the water off the ground it is being dragged across.
  // `CylinderGeometry` places theta 0 at local +Z — `air-wall.ts` records why that differs from
  // `sector.ts` — so centring the span on zero aims it straight ahead before this rotation.
  const flat = new Vector3(forward.x, 0, forward.z)
  object.rotation.y = flat.lengthSq() < 1e-6 ? 0 : Math.atan2(flat.x, flat.z)

  const height = shape.range * HEIGHT_FRACTION
  const geometry = new CylinderGeometry(
    1, 1, 1, SECTOR_SEGMENTS, 1,
    // Open-ended, for `air-wall.ts`'s reason: caps would close the wedge into a slice of pie,
    // and a curtain is a surface.
    true,
    -shape.halfAngle, 2 * shape.halfAngle,
  )
  const material = createEffectMaterial({
    body: SHEET_BODY,
    uniforms: { tint: new Color(TINT), alpha: 0, time: 0 },
    side: DoubleSide,
  })

  const mesh = new Mesh(geometry, material)
  // The cylinder is authored centred on its own origin, so half its height lifts its foot to the
  // caster's feet rather than burying half the curtain in the ground.
  mesh.position.y = height / 2
  mesh.scale.set(shape.range, height, shape.range)
  object.add(mesh)

  let elapsed = 0

  return {
    object,

    advance(dt: number): boolean {
      elapsed += Number.isFinite(dt) && dt > 0 ? dt : 0
      if (elapsed >= LIFETIME) return false

      const life = elapsed / LIFETIME

      // Closing on the caster, which is the move. Only the two horizontal axes shrink: a curtain
      // that lost its height as it came in would read as draining away rather than as arriving.
      const radius = shape.range * MathUtils.lerp(1, END_FRACTION, life)
      mesh.scale.x = radius
      mesh.scale.z = radius

      // Up fast and down slow, so the water arrives as a surge and leaves as a drain. A
      // symmetrical fade reads as a light being switched on and off.
      const rise = smoothFade(life)
      material.uniforms['alpha']!.value = PEAK_ALPHA * rise
      material.uniforms['time']!.value = elapsed

      return true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** Fast in, slow out: 1 by a fifth of the way through, then easing to nothing. */
function smoothFade(life: number): number {
  if (life < 0.2) return life / 0.2
  const out = (life - 0.2) / 0.8
  return 1 - out * out
}
