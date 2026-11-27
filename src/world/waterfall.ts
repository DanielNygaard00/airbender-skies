import { Color, DoubleSide, Mesh, PlaneGeometry, Vector2, Vector3 } from 'three'
import type { IslandDef } from './island'
import type { TerrainQuery } from '../core/types'
import { createEffectMaterial } from '../fx/effect-material'

export interface WaterfallDef {
  islandId: string
  /** Radians around the island rim, measured from +X toward +Z. */
  angle: number
  width: number
  /** Metres of visible fall before it fades out. */
  length: number
}

/** Insets to try, outermost first. Noise displacement means the outermost rim
 *  point often has no ground under it, so stepping inward finds the real edge
 *  instead of silently dropping the waterfall. */
const RIM_INSETS = [0.88, 0.84, 0.8, 0.76, 0.72] as const
/** How far above the found ground the curtain starts, hiding the seam. */
const LIP_RAISE = 0.6

/**
 * How long one full cycle of the fall's motion takes, in seconds.
 *
 * The shader's clock is a phase that wraps once per cycle rather than a time that grows, and
 * this is the reason it can: every temporal term in `FALL_BODY` advances by a whole number of
 * turns per cycle, so the pattern at the end of one cycle is exactly the pattern at the start of
 * the next and the wrap is invisible. A growing time would be simpler to write and would decay
 * instead — `sin` of a float32 time loses precision as the session runs on, and a waterfall is
 * on screen for the whole of one, so after an hour or so the water would visibly start to stutter.
 *
 * Three seconds because it is the shortest period whose whole-number turns land the two flow
 * layers near the speeds a real fall reads at; see the speeds documented on `FALL_BODY`.
 */
const FLOW_PERIOD = 3

/** The water where it runs clear, before it breaks up. */
const DEEP_TINT = 0x2e8fb0
/** The water once it has broken into white: the lip, the streaks, the spray at the foot. */
const FOAM_TINT = 0xeaf7ff

const PEAK_ALPHA = 0.62

/** Scrolling texture offset, wrapped so it never grows without bound. */
export function advanceScroll(offset: number, dt: number, speed: number): number {
  const next = (offset + dt * speed) % 1
  return next < 0 ? next + 1 : next
}

/**
 * Where the curtain hangs and which way it faces. Steps inward through
 * RIM_INSETS until it finds ground, so noise-displaced silhouettes that miss
 * the outermost probe still resolve to the real edge. Returns null only when
 * every inset comes up empty, so a genuinely misplaced waterfall is dropped
 * rather than left hanging in mid-air.
 */
export function waterfallAnchor(
  island: IslandDef, def: WaterfallDef, terrain: TerrainQuery,
): { position: Vector3; rotationY: number } | null {
  for (const inset of RIM_INSETS) {
    const reach = island.radius * inset
    const x = island.position.x + Math.cos(def.angle) * reach
    const z = island.position.z + Math.sin(def.angle) * reach

    const groundY = terrain.groundHeightAt(x, z)
    if (groundY === null) continue

    return {
      position: new Vector3(x, groundY, z),
      // Face outward, away from the island centre.
      rotationY: -def.angle + Math.PI / 2,
    }
  }
  return null
}

/**
 * A fall of water, drawn as moving liquid rather than as a scrolled picture of streaks.
 *
 * It used to be a flat plane carrying a 64-pixel canvas of white lines, scrolled downward at a
 * constant rate at 55% opacity. That read as a waterfall from a distance and as wallpaper from
 * anywhere near it: one pattern, one speed, no surface, a hard rectangle with a straight bottom
 * edge where the documented intent was always for the fall to fade out. This is the water the
 * player spends longest looking at, and it was the plainest thing in the world.
 *
 * Everything below is written in metres rather than in UV, through the `size` uniform. The six
 * falls run from 55 to 90 metres long and 5 to 10 wide, so a pattern authored in UV would be
 * stretched to a different density on every one of them — and a nine-to-one plane would turn
 * any round feature into a vertical smear. In metres, every fall has the same water.
 *
 * **What makes it read as water, in order of how much each one does.**
 *
 * *Streaks.* Water falling any distance separates into ropes, and the eye reads a waterfall by
 * them before anything else. Fine vertical streaks across the width, each one wandering slowly
 * sideways so the fall is never a comb.
 *
 * *Two flow layers at different speeds.* Bands running down the face at around 8 and 11 metres a
 * second, the second sheared slightly sideways against the first. One speed reads as a conveyor
 * belt; two that beat against each other read as water that is accelerating and breaking up.
 *
 * *White water where it would be white.* A band of foam at the lip where the flow pours over the
 * edge and aerates, and a widening break-up over the bottom third as the fall turns to spray and
 * fades out — which is the fade the old plane never had.
 *
 * *Ragged edges.* The sides thin out over the outer eighth of the width, broken by the flow, so
 * the fall is not a rectangle. A straight-edged waterfall reads as a sheet of glass.
 *
 * *Glints.* The slope of all three layers is exact and free — they are sines of linear phases —
 * and it bends the normal so a tight highlight catches the ropes. This is the principle borrowed
 * from the reference that prompted this rewrite, a raymarched ocean whose surface normals come
 * from scrolling maps: a flat plane's own normal is the same everywhere, so without the bend any
 * lighting on it is uniform and nothing sparkles.
 *
 * **The bend is an approximation, stated rather than hidden.** The slope lives in the fall's own
 * across-and-down space and is added to a view-space normal. For a vertical fall seen roughly
 * face-on from a level camera — which is how the player meets these — across lines up with view
 * x and down with view y, and the result is right. Seen edge-on or from steeply above, the glints
 * drift off the ropes they belong to. Doing it properly needs the plane's tangent frame in view
 * space, which `effect-material.ts` does not carry, and a highlight that wanders slightly at
 * glancing angles is not worth a second vertex shader.
 */
const FALL_BODY = /* glsl */ `
    // Metres across from the left edge and metres up from the foot.
    float wx = vUv.x * size.x;
    float wy = vUv.y * size.y;
    // One full turn per cycle. Every temporal term below takes a whole number of these, which is
    // what makes the wrap at the end of the cycle seamless.
    float t = cycle * 6.2832;

    // Streaks: about six-tenths of a metre apart, each wandering sideways along the fall.
    float wander = wy * 0.35 + t;
    float streakPhase = wx * 10.5 + sin(wander) * 1.2;
    float streak = 0.5 + 0.5 * sin(streakPhase);

    // Flow A: bands three metres apart falling at eight metres a second.
    float phaseA = wy * 2.0944 + t * 8.0;
    // Flow B: bands 1.7 metres apart at about eleven, sheared slightly across the first.
    float phaseB = wy * 3.6960 + wx * 0.9 + t * 19.0;
    float flow = 0.5 + 0.5 * (sin(phaseA) * 0.6 + sin(phaseB) * 0.4);

    // How broken-up and white the water is here: the ropes, and the flow running through them.
    float aeration = streak * 0.55 + flow * 0.45;

    // The slope of all three, worked out exactly. Each is a sine of a linear phase, so its
    // gradient is its cosine times the phase's own coefficients; the streak's wander adds a
    // small term down the fall through the chain rule.
    vec2 slope = vec2(
      cos(streakPhase) * 10.5 * 0.55 + cos(phaseB) * 0.9 * 0.4 * 0.45,
      cos(streakPhase) * cos(wander) * 1.2 * 0.35 * 0.55
        + (cos(phaseA) * 2.0944 * 0.6 + cos(phaseB) * 3.6960 * 0.4) * 0.45
    );

    // White water at the lip, where the flow pours over the edge and aerates: the top two and a
    // half metres, broken up by the streaks so it is a lip and not a painted stripe.
    float lip = smoothstep(size.y - 3.0, size.y - 0.4, wy) * (0.55 + 0.45 * streak);

    // And over the bottom third, where the fall turns to spray before it fades out. Widening as
    // it goes down, so the break-up arrives rather than starting at a line.
    float spray = smoothstep(size.y * 0.36, 0.0, wy);

    float white = clamp(aeration * 0.55 + lip + spray * 0.7, 0.0, 1.0);
    vec3 colour = mix(tint, foam, white);

    // Glints off the bent normal, against a fixed light high and to one side of the camera.
    vec3 n = normalize(normalize(vViewNormal) + vec3(slope * 0.05, 0.0));
    vec3 halfway = normalize(normalize(vec3(-0.35, 0.8, 0.5)) + vec3(0.0, 0.0, 1.0));
    float glint = pow(max(dot(n, halfway), 0.0), 70.0);
    colour += vec3(1.0) * glint * 1.2;

    // Ragged at the sides: the outer eighth of the width thins away, pushed in and out by the
    // flow so the edge moves rather than sitting on a straight line.
    float edgeX = min(vUv.x, 1.0 - vUv.x) * 8.0 + (flow - 0.5) * 0.6;
    float sides = smoothstep(0.0, 1.0, edgeX);

    // Faded out over the bottom quarter, which the plane never did: its foot used to be a hard
    // horizontal line in mid-air.
    float foot = smoothstep(0.0, size.y * 0.25, wy);

    float body = alpha * sides * foot;
    // Foam and caught light are the genuinely opaque parts of falling water, so they lift the
    // opacity as well as the colour; the clear water between them stays see-through.
    float opacity = body * (0.55 + 0.45 * white) + body * glint * 0.4;
    gl_FragColor = vec4(colour, clamp(opacity, 0.0, 1.0));
`

/** A curtain of falling water, or null if it has nowhere to hang. */
export function createWaterfall(
  island: IslandDef, def: WaterfallDef, terrain: TerrainQuery,
): { mesh: Mesh; advance(dt: number): void } | null {
  const anchor = waterfallAnchor(island, def, terrain)
  if (!anchor) return null

  const geometry = new PlaneGeometry(def.width, def.length)
  const material = createEffectMaterial({
    body: FALL_BODY,
    uniforms: {
      tint: new Color(DEEP_TINT),
      foam: new Color(FOAM_TINT),
      alpha: PEAK_ALPHA,
      cycle: 0,
      size: new Vector2(def.width, def.length),
    },
    side: DoubleSide,
  })

  const mesh = new Mesh(geometry, material)
  // A translucent curtain, so it must never contribute depth. `enableShadows` in
  // `src/core/sun.ts` reads this flag to keep the curtain out of the shadow map, and any
  // future pass that renders the scene under `scene.overrideMaterial` must read it too.
  // An override replaces the material above wholesale, `depthWrite: false` included, so
  // such a pass would record the curtain as an opaque near surface — and because the
  // curtain overlaps the lip by LIP_RAISE, that would darken a band of rim rock the
  // colour frame shows you straight through. The removed contact shadow pass was the
  // first consumer to hit this; see docs/HANDOFF.md for why it is no longer here.
  mesh.userData.excludeFromShadows = true
  // The plane's origin is its centre, so drop it half its length to hang from the lip,
  // raised by LIP_RAISE above the found ground so the mesh overlaps the rock and hides the seam.
  mesh.position.set(
    anchor.position.x,
    anchor.position.y + LIP_RAISE - def.length / 2,
    anchor.position.z,
  )
  mesh.rotation.y = anchor.rotationY

  let cycle = 0
  return {
    mesh,
    advance(dt: number): void {
      cycle = advanceScroll(cycle, dt, 1 / FLOW_PERIOD)
      material.uniforms['cycle']!.value = cycle
    },
  }
}
