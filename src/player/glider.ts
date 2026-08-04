import {
  MathUtils, Object3D, Group, Mesh, CylinderGeometry, BufferGeometry, BufferAttribute,
  MeshLambertMaterial, Vector3, DoubleSide,
} from 'three'

/** How long the fan takes to travel from fully stowed to fully deployed. */
export const OPEN_SECONDS = 0.3
export const PANELS_PER_SIDE = 4
export const FAN_SPREAD = MathUtils.degToRad(78)

/**
 * Move `openness` toward its target at a constant rate, clamped to [0, 1].
 * Guarding non-finite input matters: a stalled frame or a corrupted delta would
 * otherwise drive the fan angles to NaN and corrupt every mesh transform.
 */
export function advanceOpenness(
  current: number, deployed: boolean, dt: number, seconds: number,
): number {
  if (!Number.isFinite(current) || !Number.isFinite(dt) || dt <= 0) {
    return MathUtils.clamp(Number.isFinite(current) ? current : 0, 0, 1)
  }
  const target = deployed ? 1 : 0
  const next = current + Math.sign(target - current) * (dt / seconds)
  return target > current
    ? MathUtils.clamp(Math.min(next, target), 0, 1)
    : MathUtils.clamp(Math.max(next, target), 0, 1)
}

/** Smoothstep, so the fan eases in and out rather than moving mechanically. */
export function easeOpenness(openness: number): number {
  const t = MathUtils.clamp(openness, 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Where fan leaf `index` sits, as an angle from the staff. All leaves collapse to
 * zero when closed, which is what makes them stack into a stick.
 */
export function panelAngle(
  index: number, count: number, openness: number, spread: number,
): number {
  if (count <= 1) return 0
  return easeOpenness(openness) * spread * (index / (count - 1))
}

const STAFF_LENGTH = 1.9
const STAFF_RADIUS = 0.045
/** How far out from the grip each side's fan pivots, along the staff. */
const PIVOT_OFFSET = 0.16
const PANEL_LENGTH = 1.05
const PANEL_HALF_WIDTH = 0.15

/**
 * The tail fin. The show's glider is two wings plus a fin, and without it the
 * silhouette from behind reads as a fan rather than an aircraft.
 *
 * It stands in the y-z plane at the centre line, so it never widens the span and
 * cannot break the wing's symmetry. Kept shorter than the fan's own rearward sweep
 * of 1.04, so it adds no new rearmost point.
 */
const FIN_LENGTH = 0.82
const FIN_HEIGHT = 0.34

// Avatar-local +Z is forward: Object3D.lookAt aligns local +Z with its target (only
// Camera and Light use -Z), and avatar.object in main.ts is a plain Group. So the
// stowed staff sits behind the rider (-Z) and the deployed wing sits ahead (+Z).
// y bumped from 1.0 to clear the ground: at y=1.0 the stowed box's min.y was -0.059,
// six centimetres through the terrain (the avatar origin is at the feet).
const STOWED_POSITION = new Vector3(0, 1.08, -0.3)
/** Tilted well off horizontal so the stowed staff reads as slung across the back. */
const STOWED_ROTATION = new Vector3(0.1, 0, 1.05)
// The staff rests on the rider's back, so both numbers come from the glide pose
// rather than from clearances.
//
// z was 1.1 while the rider stood upright: the fan sweeps from local z -1.04 to
// +0.15, so 1.1 was the smallest value keeping the whole wing ahead of a standing
// body. Gliding lays the rider flat from z -0.96 to +0.92, so there is no longer
// an "ahead" to stay in front of — the wing lies over the body instead, and 0.45
// puts the staff across the shoulders and upper back.
//
// y is where the staff comes to rest on the rider. Not derivable from the back's
// height alone: the wing's lowest point is a forward fan tip that overhangs past
// the shoulders with no body under it, so bounding boxes mislead here. Measured
// instead by sweeping the wing down until the closest wing-to-skin distance
// reaches zero, which happens at 1.1867. 1.19 leaves 3mm — contact to the eye,
// while keeping the two surfaces off each other so they cannot z-fight.
const DEPLOYED_POSITION = new Vector3(0, 1.19, 0.45)
/**
 * Nose-up tilt of the deployed wing, in radians. Exported because the rider's
 * glide pose lies parallel to the wing, and the two must not drift apart: retune
 * the wing and the pose follows.
 */
export const DEPLOYED_PITCH = 0.18
/**
 * Near-level. The staff mesh is already laid along local X at build time, so this
 * rotation must NOT add another quarter turn about Z — doing so stands the wing on
 * its end and collapses the span to nothing.
 */
const DEPLOYED_ROTATION = new Vector3(DEPLOYED_PITCH, 0, 0)

/** How far the staff sweeps through a swing, radians either side of the stowed pose. */
const SWEEP_ARC = MathUtils.degToRad(150)

/**
 * One fan leaf: a long thin triangle running out along +X from the pivot, widening
 * slightly in Z at its tip so the open fan reads as a membrane rather than spokes.
 */
function createPanelGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    PANEL_LENGTH, 0, -PANEL_HALF_WIDTH,
    PANEL_LENGTH, 0, PANEL_HALF_WIDTH,
  ]), 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

/** The tail fin: a vertical triangle running back from the grip and rising aft. */
function createFinGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    0, 0, -FIN_LENGTH,
    0, FIN_HEIGHT, -FIN_LENGTH,
  ]), 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

export function createGlider(): {
  object: Object3D
  update(dt: number, deployed: boolean, swing?: number | null): void
  openness(): number
} {
  const object = new Group()

  const staffMaterial = new MeshLambertMaterial({ color: 0x6b4a2f })
  const fabricMaterial = new MeshLambertMaterial({ color: 0xe0913f, side: DoubleSide })

  // The cylinder's axis is local Y, so lay it along local X to be the spanwise staff.
  const staff = new Mesh(
    new CylinderGeometry(STAFF_RADIUS, STAFF_RADIUS, STAFF_LENGTH, 8), staffMaterial,
  )
  staff.rotation.z = Math.PI / 2
  object.add(staff)

  // Each side fans from a single shared pivot, the way a real fan turns on its rivet.
  // Spacing the pivots along the staff instead would lay the leaves end-to-end when
  // closed, making the stowed glider wider than the deployed one.
  const panels: { pivot: Group; index: number; side: number }[] = []
  for (const side of [-1, 1]) {
    const root = new Group()
    root.position.x = PIVOT_OFFSET * side
    object.add(root)
    for (let index = 0; index < PANELS_PER_SIDE; index++) {
      const pivot = new Group()
      const panel = new Mesh(createPanelGeometry(), fabricMaterial)
      panel.scale.x = side
      pivot.add(panel)
      root.add(pivot)
      panels.push({ pivot, index, side })
    }
  }

  const fin = new Mesh(createFinGeometry(), fabricMaterial)
  fin.name = 'tail-fin'
  object.add(fin)

  let openness = 0
  let swing: number | null = null

  function apply(): void {
    const eased = easeOpenness(openness)
    object.position.lerpVectors(STOWED_POSITION, DEPLOYED_POSITION, eased)
    object.rotation.set(
      MathUtils.lerp(STOWED_ROTATION.x, DEPLOYED_ROTATION.x, eased),
      MathUtils.lerp(STOWED_ROTATION.y, DEPLOYED_ROTATION.y, eased),
      MathUtils.lerp(STOWED_ROTATION.z, DEPLOYED_ROTATION.z, eased),
    )
    // The sweep composes onto the stowed pose rather than replacing it, and only while
    // stowed: a deployed glider is a wing and has nothing to swing with. `openness` gates
    // it rather than the `deployed` flag so a glider still folding away does not twitch.
    if (swing !== null && openness < 1e-3) {
      object.rotation.y += MathUtils.lerp(-SWEEP_ARC / 2, SWEEP_ARC / 2, swing)
    }
    for (const { pivot, index, side } of panels) {
      // Rotating about Y sweeps each leaf fore-aft in the wing plane. Closed, every
      // leaf sits at zero and they stack into a stick along the staff.
      pivot.rotation.y = panelAngle(index, PANELS_PER_SIDE, openness, FAN_SPREAD) * side
    }
    // The fin unfurls with the wings rather than standing proud of a folded staff.
    fin.scale.setScalar(eased)
  }
  apply()

  return {
    object,
    update(dt: number, deployed: boolean, swingProgress: number | null = null): void {
      openness = advanceOpenness(openness, deployed, dt, OPEN_SECONDS)
      swing = swingProgress
      apply()
    },
    openness: () => openness,
  }
}
