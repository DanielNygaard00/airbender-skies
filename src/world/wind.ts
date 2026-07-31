import { Vector3 } from 'three'

/**
 * Wind is level geometry, not weather.
 *
 * The design pillar is that the air is terrain: lift is something the player reads
 * and routes through, the way they read a ledge. Each kind below is a shape in the
 * world with a rule attached, and every one of them is meant to have a visual tell
 * — a wind feature the player cannot see is a bug, not a puzzle.
 */
export type WindKind = 'thermal' | 'ridge' | 'river' | 'downdraft' | 'dead'

export interface WindDef {
  kind: WindKind
  /** Centre of the column or corridor. */
  position: Vector3
  /** Horizontal reach. Effect fades to nothing at the rim. */
  radius: number
  /** Vertical reach, centred on `position`. */
  height: number
  /**
   * Lift in m/s² for a thermal, ridge or downdraft; conveyor acceleration for a
   * river. Ignored by dead air, which removes lift rather than adding any.
   */
  strength: number
  /**
   * Which way the feature runs. A ridge gives lift to anyone flying along it, and
   * a river pushes along it, so both need a direction; thermals, downdrafts and
   * dead air are columns and ignore this.
   */
  axis?: Vector3
}

/** What the air is doing to the glider at one point, this frame. */
export interface WindSample {
  /** Added to the glider's acceleration. */
  accel: Vector3
  /** Multiplies the wing's own lift. Dead air drives this to zero. */
  liftScale: number
}

export function stillAir(): WindSample {
  return { accel: new Vector3(), liftScale: 1 }
}

/**
 * How strongly a point sits inside a feature: 1 at the core, fading to 0 at the
 * rim and at the top and bottom. Soft edges matter — a hard boundary would make
 * lift switch on and off as the player drifts, which reads as a bug rather than as
 * terrain.
 */
export function influenceAt(def: WindDef, position: Vector3): number {
  const dy = Math.abs(position.y - def.position.y)
  const halfHeight = def.height / 2
  if (dy >= halfHeight) return 0

  const dx = position.x - def.position.x
  const dz = position.z - def.position.z
  const horizontal = Math.hypot(dx, dz)
  if (horizontal >= def.radius) return 0

  const radial = 1 - horizontal / def.radius
  const vertical = 1 - dy / halfHeight
  return radial * vertical
}

const WORLD_UP = new Vector3(0, 1, 0)

/** Horizontal heading, so alignment tests ignore climb and dive. */
function flatten(direction: Vector3): Vector3 {
  const flat = new Vector3(direction.x, 0, direction.z)
  return flat.lengthSq() < 1e-8 ? new Vector3() : flat.normalize()
}

/**
 * The air's contribution at a point, for a glider pointing `forward`.
 *
 * Accelerations from overlapping features add, because two thermals over the same
 * ridge really should lift harder. Dead air instead takes the strongest claim: a
 * region that kills lift is a statement about the whole volume, so overlapping it
 * with a thermal must not average the two into a mild updraft.
 */
export function sampleWind(
  defs: readonly WindDef[],
  position: Vector3,
  forward: Vector3,
): WindSample {
  const accel = new Vector3()
  let liftScale = 1

  for (const def of defs) {
    const influence = influenceAt(def, position)
    if (influence <= 0) continue

    if (def.kind === 'dead') {
      liftScale = Math.min(liftScale, 1 - influence)
      continue
    }
    if (def.kind === 'thermal') {
      accel.addScaledVector(WORLD_UP, def.strength * influence)
      continue
    }
    if (def.kind === 'downdraft') {
      accel.addScaledVector(WORLD_UP, -def.strength * influence)
      continue
    }

    const axis = flatten(def.axis ?? new Vector3())
    if (axis.lengthSq() < 1e-8) continue
    const heading = flatten(forward)

    if (def.kind === 'ridge') {
      // Lift for flying along the face, nothing for flying at it. Absolute value:
      // either direction along the ridge works, which is what makes ridge lift a
      // road rather than a one-way street.
      const along = Math.abs(heading.dot(axis))
      accel.addScaledVector(WORLD_UP, def.strength * influence * along)
      continue
    }

    // A river is a conveyor: enter aligned and it carries you, cross it and it
    // barely touches you. Clamped at zero so flying against the current is
    // simply unhelpful rather than a reverse thrust.
    const with_ = Math.max(0, heading.dot(axis))
    accel.addScaledVector(axis, def.strength * influence * with_)
  }

  return { accel, liftScale }
}

/** Bind a level's wind so movement code can sample it without knowing the level. */
export function windSampler(defs: readonly WindDef[]) {
  return (position: Vector3, forward: Vector3): WindSample =>
    sampleWind(defs, position, forward)
}
