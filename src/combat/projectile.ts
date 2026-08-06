import { Vector3 } from 'three'
import type { GroundHeightQuery } from './enemy'

/**
 * An arrow in flight.
 *
 * Straight-line, with no gravity. A falling arrow would need an archer that leads a
 * moving target, and a straight one is easier both to read as a threat and to test.
 * Drop is a later config addition if it feels flat, not a redesign.
 */
export interface Projectile {
  id: string
  position: Vector3
  velocity: Vector3
  damage: number
  /** Seconds alive, so a stray arrow cannot outlive the encounter that fired it. */
  age: number
}

export interface ProjectileConfig {
  /** How close to the player's centre counts as a hit. */
  hitRadius: number
  maxSeconds: number
}

export interface ProjectileStep {
  /** null once it is gone: it hit, it reached the ground, or it expired. */
  projectile: Projectile | null
  damageToPlayer: number
}

export function spawnProjectile(
  id: string, origin: Vector3, direction: Vector3, damage: number, speed: number,
): Projectile {
  // Normalised here rather than trusting the caller, so a direction built from a
  // subtraction cannot silently become a speed multiplier.
  const heading = direction.clone()
  if (heading.lengthSq() > 1e-8) heading.normalize()
  return {
    id,
    position: origin.clone(),
    velocity: heading.multiplyScalar(speed),
    damage,
    age: 0,
  }
}

/**
 * Advance one arrow.
 *
 * Three ways to end, and the order matters: the player is tested **before** the ground,
 * so an arrow arriving at a player standing at ground level is not swallowed by the
 * terrain test on the same frame.
 */
export function stepProjectile(
  p: Projectile,
  playerPosition: Vector3,
  ground: GroundHeightQuery,
  dt: number,
  c: ProjectileConfig,
): ProjectileStep {
  const position = p.position.clone().addScaledVector(p.velocity, dt)
  const age = p.age + dt

  if (position.distanceTo(playerPosition) <= c.hitRadius) {
    return { projectile: null, damageToPlayer: p.damage }
  }

  // A null height is the void between islands, where there is nothing to stop an arrow.
  const height = ground.groundHeightAt(position.x, position.z)
  if (height !== null && position.y <= height) return { projectile: null, damageToPlayer: 0 }

  if (age >= c.maxSeconds) return { projectile: null, damageToPlayer: 0 }

  return { projectile: { ...p, position, age }, damageToPlayer: 0 }
}
