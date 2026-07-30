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

// Avatar-local +Z is forward: Object3D.lookAt aligns local +Z with its target (only
// Camera and Light use -Z), and avatar.object in main.ts is a plain Group. So the
// stowed staff sits behind the rider (-Z) and the deployed wing sits ahead (+Z).
// y bumped from 1.0 to clear the ground: at y=1.0 the stowed box's min.y was -0.059,
// six centimetres through the terrain (the avatar origin is at the feet).
const STOWED_POSITION = new Vector3(0, 1.08, -0.3)
/** Tilted well off horizontal so the stowed staff reads as slung across the back. */
const STOWED_ROTATION = new Vector3(0.1, 0, 1.05)
// z is 1.1, not the mirrored 0.4, because the fan's own local shape is asymmetric:
// fully open, it sweeps from local z -1.04 to +0.15, not centred on the pivot. 0.4
// left most of the wing (min.z -0.64) still behind the rider; 1.1 clears zero.
const DEPLOYED_POSITION = new Vector3(0, 2.0, 1.1)
/**
 * Near-level. The staff mesh is already laid along local X at build time, so this
 * rotation must NOT add another quarter turn about Z — doing so stands the wing on
 * its end and collapses the span to nothing.
 */
const DEPLOYED_ROTATION = new Vector3(0.18, 0, 0)

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

export function createGlider(): {
  object: Object3D
  update(dt: number, deployed: boolean): void
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

  let openness = 0

  function apply(): void {
    const eased = easeOpenness(openness)
    object.position.lerpVectors(STOWED_POSITION, DEPLOYED_POSITION, eased)
    object.rotation.set(
      MathUtils.lerp(STOWED_ROTATION.x, DEPLOYED_ROTATION.x, eased),
      MathUtils.lerp(STOWED_ROTATION.y, DEPLOYED_ROTATION.y, eased),
      MathUtils.lerp(STOWED_ROTATION.z, DEPLOYED_ROTATION.z, eased),
    )
    for (const { pivot, index, side } of panels) {
      // Rotating about Y sweeps each leaf fore-aft in the wing plane. Closed, every
      // leaf sits at zero and they stack into a stick along the staff.
      pivot.rotation.y = panelAngle(index, PANELS_PER_SIDE, openness, FAN_SPREAD) * side
    }
  }
  apply()

  return {
    object,
    update(dt: number, deployed: boolean): void {
      openness = advanceOpenness(openness, deployed, dt, OPEN_SECONDS)
      apply()
    },
    openness: () => openness,
  }
}
