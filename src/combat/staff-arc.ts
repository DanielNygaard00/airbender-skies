import { Vector3 } from 'three'
import { inCone, type ConeShape } from './cone'
import type { Enemy } from './enemy'

/**
 * What a staff swing hits.
 *
 * Every function here takes a `finisher` flag rather than a swing index, because this module
 * has no business knowing how long a combo is — `stepStaff` owns `maxChain` and labels the
 * swing on the way out. An index here would mean two modules agreeing about the chain
 * length, which is the kind of shared constant that drifts.
 */
export interface StaffArcConfig {
  opener: ConeShape
  finisher: ConeShape
  openerDamage: number
  finisherDamage: number
  openerKnockback: number
  finisherKnockback: number
}

export function staffShape(finisher: boolean, c: StaffArcConfig): ConeShape {
  return finisher ? c.finisher : c.opener
}

export function staffDamage(finisher: boolean, c: StaffArcConfig): number {
  return finisher ? c.finisherDamage : c.openerDamage
}

/** Everyone caught by one swing. Named so a caller cannot forget the arc. */
export function staffTargets(
  origin: Vector3, forward: Vector3, finisher: boolean,
  enemies: readonly Enemy[], c: StaffArcConfig,
): Enemy[] {
  const shape = staffShape(finisher, c)
  return enemies.filter((enemy) => inCone(origin, forward, enemy.position, shape))
}

/**
 * The shove a swing puts on a target: outward, and flat.
 *
 * No vertical component, deliberately. Lift is what air does, and a lifted enemy is inert —
 * that is the Vortex's whole payoff. A staff sweep slides a soldier sideways instead, which
 * is why the two moves read differently at the same range.
 */
export function staffImpulse(
  origin: Vector3, target: Vector3, finisher: boolean, c: StaffArcConfig,
): Vector3 {
  const away = new Vector3(target.x - origin.x, 0, target.z - origin.z)
  const direction = away.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : away.normalize()
  return direction.multiplyScalar(finisher ? c.finisherKnockback : c.openerKnockback)
}
