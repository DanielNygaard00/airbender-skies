import {
  DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import type { GustConfig } from '../combat/gust'
import type { Effect } from './effect'
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
  const arcMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: ARC_OPACITY, depthTest: false,
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
    arcMaterial.opacity = ARC_OPACITY * (1 - t * t)
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
