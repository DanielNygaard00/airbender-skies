import {
  DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, Vector3,
} from 'three'
import type { ConeShape } from '../combat/cone'
import type { Effect } from './effect'
import { SECTOR_FLAT_ROTATION_X, sectorGeometry } from './sector'
import { safeScale } from './scale'

/**
 * The staff's swing, drawn at the exact reach and half-angle the fight resolved with.
 *
 * Takes a `ConeShape` rather than a `finisher` flag: this effect draws whatever shape it is
 * handed and has no business knowing which swing produced it. The caller passes
 * `staffShape(swing.finisher, fightConfig.staffArc)` — the same call the fight resolved
 * with — so the drawn arc and the hit arc cannot diverge. See `gust-cone.ts` for the same
 * honesty argument in more detail; it applies here unchanged.
 */
const LIFETIME = 0.16
/** Above the player's origin, which is at their feet — a sector on the ground is hidden. */
const HEIGHT = 1
/**
 * A swing is an instant, not a pulse of air: full opacity from the first frame, fading out,
 * rather than the gust's travelling arc. Brighter and warmer than the gust's cyan so a staff
 * sweep reads as an impact rather than as bending air.
 */
const FILL_OPACITY = 0.55
const TINT = 0xffa64d

export function createStaffArc(origin: Vector3, forward: Vector3, shape: ConeShape): Effect {
  const group = new Group()
  group.position.copy(origin)
  group.position.y += HEIGHT

  // Aim the group's +Z along the heading. Flattened, because inCone tests a flattened
  // heading — an arc tilted with a climbing glider would misrepresent the hit volume.
  const flat = new Vector3(forward.x, 0, forward.z)
  if (flat.lengthSq() > 1e-8) {
    group.lookAt(group.position.clone().add(flat.normalize()))
  }

  // The flattening convention (RingGeometry authored in XY, theta anticlockwise from +X,
  // centred on -PI/2 so it lands on local +Z once flattened) lives in ./sector, shared with
  // the gust cone and the aim preview — a local copy of the offset would drift silently,
  // since a rotated sector still looks like a sector. staff-arc-fx.test.ts's containment
  // check against inCone remains the independent authority on whether that convention is
  // right: if it disagrees, the offset in sector.ts is what is wrong.
  //
  // Drawn at radius 1 and scaled by shape.range, so the drawn radius comes from the shape
  // rather than being baked into the geometry — an opener and a finisher share this
  // geometry construction and differ only by the scale applied below.
  const fillGeometry = sectorGeometry(shape.halfAngle, 0, 1)
  const fillMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: FILL_OPACITY,
    // Drawn over the world rather than depth-tested against it, like the other attack
    // effects — a flat sector a metre above the player's feet would otherwise be buried
    // by ground that slopes up away from them.
    depthTest: false,
  })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.rotation.x = SECTOR_FLAT_ROTATION_X
  fill.scale.setScalar(safeScale(shape.range))
  fill.userData.excludeFromShadows = true

  group.add(fill)

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    fillMaterial.opacity = FILL_OPACITY * (1 - t)
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
    },
  }
}
