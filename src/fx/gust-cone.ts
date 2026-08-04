import {
  DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, RingGeometry, Vector3,
} from 'three'
import type { GustConfig } from '../combat/gust'
import type { Effect } from './effect'

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
const FILL_OPACITY = 0.16
const ARC_OPACITY = 0.5
/** Arc thickness as a fraction of its own radius. */
const ARC_THICKNESS = 0.16
const SEGMENTS = 48
const TINT = 0xdff1ff

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

  // RingGeometry is authored in XY with theta anticlockwise from +X. After the -90°
  // rotation below, local +Z corresponds to pre-rotation -Y, i.e. theta = -PI/2, so the
  // span is centred there. gust-cone.test.ts's containment check is the authority on
  // this: if it disagrees, this offset is what is wrong.
  const thetaLength = 2 * c.halfAngle
  const thetaStart = -Math.PI / 2 - c.halfAngle

  const fillGeometry = new RingGeometry(0, c.range, SEGMENTS, 1, thetaStart, thetaLength)
  const fillMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: FILL_OPACITY,
  })
  const fill = new Mesh(fillGeometry, fillMaterial)
  fill.rotation.x = -Math.PI / 2
  fill.userData.excludeFromShadows = true

  // A unit arc scaled at runtime, so travelling outward costs a scale rather than a
  // geometry rebuild sixty times a second.
  const arcGeometry = new RingGeometry(
    1 - ARC_THICKNESS, 1, SEGMENTS, 1, thetaStart, thetaLength,
  )
  const arcMaterial = new MeshBasicMaterial({
    color: TINT, transparent: true, side: DoubleSide, depthWrite: false,
    opacity: ARC_OPACITY,
  })
  const arc = new Mesh(arcGeometry, arcMaterial)
  arc.rotation.x = -Math.PI / 2
  arc.userData.excludeFromShadows = true

  // Order matters to the tests and to the reader: the fill carries the true radius.
  group.add(fill)
  group.add(arc)

  let age = 0

  function apply(): void {
    const t = MathUtils.clamp(age / LIFETIME, 0, 1)
    arc.scale.setScalar(Math.max(t * c.range, 1e-4))
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
