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
  /**
   * Seconds of glider refusal this carries. Zero for an arrow, non-zero for a net.
   *
   * Carried on the projectile rather than looked up from the enemy that loosed it, for the
   * same reason `damage` is: by the time a net arrives the netter may be downed, restored,
   * or have walked out of the fight, and a payload that has to ask its thrower what it does
   * is a payload that can arrive to find nobody home.
   */
  tangleSeconds: number
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
  /**
   * Seconds of glider refusal this projectile just inflicted, or 0.
   *
   * Non-zero only on the frame a net connects, and reported rather than applied for the same
   * reason `damageToPlayer` is: this function advances one projectile and knows nothing about
   * the player's posture or the state that holds the refusal.
   */
  tangleSeconds: number
}

export function spawnProjectile(
  id: string,
  origin: Vector3,
  direction: Vector3,
  damage: number,
  speed: number,
  /**
   * Required rather than defaulted to 0. A default would compile at the one production call
   * site that matters — `stepEncounter`'s spawn branch — and make every net in the game
   * inert, with nothing anywhere to notice.
   */
  tangleSeconds: number,
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
    tangleSeconds,
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
    // The one branch that reports a payload: a net that lands on the terrain or expires in
    // the air has caught nothing, so its `tangleSeconds` goes nowhere.
    return { projectile: null, damageToPlayer: p.damage, tangleSeconds: p.tangleSeconds }
  }

  // A null height is the void between islands, where there is nothing to stop an arrow.
  const height = ground.groundHeightAt(position.x, position.z)
  if (height !== null && position.y <= height) {
    return { projectile: null, damageToPlayer: 0, tangleSeconds: 0 }
  }

  if (age >= c.maxSeconds) return { projectile: null, damageToPlayer: 0, tangleSeconds: 0 }

  return { projectile: { ...p, position, age }, damageToPlayer: 0, tangleSeconds: 0 }
}
