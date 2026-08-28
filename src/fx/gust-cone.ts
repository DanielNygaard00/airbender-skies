import {
  Color, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import type { GustConfig } from '../combat/gust'
import type { Effect } from './effect'
import { createEffectMaterial } from './effect-material'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry } from './sector'
import { safeScale } from './scale'

/**
 * The air a gust moves, drawn at the volume it actually affects.
 *
 * The honest visual here is a large one: the move really does sweep a 12-unit, 120-degree
 * wedge. A tidier, smaller puff would look better in isolation and teach the wrong
 * spacing — a hit landing outside the visible puff reads as a bug. So the filled sector
 * states the true reach at low opacity, and a brighter arc travels out through it to make
 * it read as a pulse of air rather than a wedge blinking on.
 */
const LIFETIME = 0.22
/** Above the player's origin, which is at their feet — a sector on the ground is hidden. */
const HEIGHT = 1
/**
 * Opacities and tint chosen against the world, not in the abstract.
 *
 * The first pass used a very pale blue at 0.16 and 0.5, which measured fine and was
 * invisible in play: that tint sits almost on top of the pale green terrain and the washed
 * sky, so even where the effect drew, nothing read. Found only by playing — the geometry
 * tests all passed throughout. Raised and cooled toward cyan so the effect separates from
 * both the ground and the sky.
 *
 * The fill is exported because the aim preview is required to be quieter than the cone it
 * previews, and `aim-tell.test.ts` checks that relationship against this value. Pinned to a
 * literal there instead, the guard would keep passing against a stale number the moment this
 * one was retuned — which is precisely the retune it exists to catch.
 */
export const FILL_OPACITY = 0.34
const ARC_OPACITY = 0.9
/** Arc thickness as a fraction of its own radius. */
const ARC_THICKNESS = 0.16
const TINT = 0x7fe4ff
/**
 * The arc's own tint — brighter than the fill's `TINT`, but kept in the same cyan family
 * rather than lifted toward white.
 *
 * `TINT` (`0x7fe4ff`) is `element-radial.ts`'s air badge colour too — "air takes the gust cone's
 * cyan" is that file's own comment — so this hue is the project's canonical identity for air, not
 * an incidental value the arc is free to wash out. An arc that reads as near-white breaks the
 * thing the fill and arc are supposed to do together: read as one effect.
 *
 * Measured the way `post.ts`'s threshold actually reads it: `new Color(hex)` and
 * `0.2126*c.r + 0.7152*c.g + 0.0722*c.b`, on the same `Color` instance the material carries —
 * not hex-divided-by-255, which three's default sRGB-to-linear colour management makes wrong.
 * By that measurement `TINT` is `{ r: 0.212, g: 0.776, b: 1 }`, luminance ≈ 0.672 — well under the
 * 0.82 bloom threshold, which is exactly why the fill alone was never going to bloom or read as
 * the bright element.
 *
 * Green carries the dominant weight in that formula (0.7152, against red's 0.2126), so the cheap
 * way to clear the threshold is to raise green, not to lift every channel toward white. Maxing
 * `TINT`'s green and blue alone (`0x7fffff`) already clears it — `{ r: 0.212, g: 1, b: 1 }`,
 * luminance ≈ 0.8325 — but only by 0.0125, thin against a threshold this value has to clear on
 * every GPU it renders on. `0x99ffff` adds a modest bump to red as well — `0x7f` to `0x99`, still
 * well short of a wash-out value like `0xd6` (84% of full red) — for real margin:
 * `{ r: 0.319, g: 1, b: 1 }`, luminance ≈ 0.855, clearing 0.82 by ≈ 0.035 while red stays far
 * enough below green and blue to read as the same cyan as `TINT`, not as white.
 */
const ARC_TINT = 0x99ffff

/**
 * The arc's brightness, swept along its length and broken up.
 *
 * `vUv.x` runs along the arc, so `sweep` is a bright band travelling around it while the mesh
 * itself travels outward — two motions at once, which is what a gust of air looks like and what a
 * uniformly fading ring does not. `grain` is a two-term hash rather than a texture: `ASSETS.md`
 * would want a licence entry for a noise image, and this is four lines of arithmetic instead.
 *
 * The tint is brighter than the fill's and above `post.ts`'s 0.82 bloom threshold on purpose. The
 * fill states the volume the move affects and must stay quiet enough to see the world through;
 * everything the player actually reads is carried here. `gust-cone.ts`'s own history is the
 * argument: the first tint measured fine and was invisible in play, and raising the *fill* is the
 * fix that hides terrain and still does not bloom.
 */
const ARC_BODY = /* glsl */ `
    float sweep = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
    float travel = fract(vUv.x - time * 1.6);
    float band = smoothstep(0.55, 1.0, travel);
    float grain = 0.85 + 0.15 * sin(vUv.x * 90.0 + time * 9.0);
    gl_FragColor = vec4(tint, alpha * sweep * band * grain);
`

export function createGustCone(origin: Vector3, forward: Vector3, c: GustConfig): Effect {
  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  // Aim the group's +Z along the heading. Flattened, because inGust tests a flattened
  // heading — a cone tilted with a climbing glider would misrepresent the hit volume.
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() > 1e-8) {
    group.lookAt(group.position.clone().add(flat.normalize()))
  }

  // The flattening convention (RingGeometry authored in XY, theta anticlockwise from +X,
  // centred on -PI/2 so it lands on local +Z once flattened) now lives in ./sector, shared
  // with the aim preview. gust-cone.test.ts's containment check remains the authority on
  // whether that convention is right: if it disagrees, the offset in sector.ts is what is
  // wrong.
  const fillGeometry = sectorGeometry(c.halfAngle, 0, c.range)
  const fillMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: FILL_OPACITY,
    // Drawn over the world rather than depth-tested against it. A flat sector a metre
    // above the player's feet is buried by ground that slopes up away from them, which
    // made this effect invisible in play — the shape was right, the terrain was simply in
    // front of it. Rendering on top keeps the footprint exactly true at the cost of
    // showing through a hill for the fifth of a second it lives.
    depthTest: false,
  })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.rotation.x = SECTOR_FLAT_ROTATION_X
  fill.userData.excludeFromShadows = true

  // A unit arc scaled at runtime, so travelling outward costs a scale rather than a
  // geometry rebuild sixty times a second.
  const arcGeometry = sectorGeometry(c.halfAngle, 1 - ARC_THICKNESS, 1)
  const arcMaterial = createEffectMaterial({
    body: ARC_BODY,
    uniforms: { tint: new Color(ARC_TINT), alpha: ARC_OPACITY, time: 0 },
    // The same reason the fill above sets it: a flat shape near the player's feet is buried by
    // terrain sloping up away from them, which is the defect that made this whole effect
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
    arc.scale.setScalar(safeScale(t * c.range))
    fillMaterial.opacity = FILL_OPACITY * (1 - t)
    // The arc brightens as it goes out, so the leading edge is what the eye follows.
    arcMaterial.uniforms.alpha!.value = ARC_OPACITY * (1 - t * t)
    // Drives the sweep in `ARC_BODY`. Raw elapsed age, not scaled here, because the shader's
    // own `time * 1.6` already sets the travel speed — a second multiplier here would just be
    // the same knob turned twice.
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
