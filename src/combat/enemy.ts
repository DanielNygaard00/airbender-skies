import { Vector3 } from 'three'
import { applyDamage, isDowned, type Health, type HealthConfig } from './health'

/**
 * Spear infantry.
 *
 * The doc's enemy contract gives every type one axis of Aang's movement to
 * pressure, and this one pressures ground spacing: it closes, it strikes at reach,
 * and it punishes standing still. That is the whole behaviour — it is not built to
 * be a fair duel, it is built to make holding one spot expensive.
 */
export type Stance = 'advance' | 'wind-up' | 'recover' | 'downed'

export interface Enemy {
  id: string
  position: Vector3
  /** Which way it is facing, for its own animation and strike direction. */
  facing: Vector3
  stance: Stance
  /** Seconds spent in the current stance. */
  stanceTime: number
  health: Health
  /** Decaying push from a gust or a slam. */
  knockback: Vector3
}

export interface EnemyConfig extends HealthConfig {
  /** Closing speed on foot. Slower than the player, who should out-run it. */
  moveSpeed: number
  /** Reach of the spear. Inside this it commits to a strike. */
  strikeRange: number
  /** Telegraph before the hit lands, so the strike is dodgeable. */
  windUpSeconds: number
  /** Vulnerable window after striking. */
  recoverSeconds: number
  /** Damage one spear thrust does. */
  strikeDamage: number
  /** How fast knockback bleeds away, per second. */
  knockbackDamping: number
}

export function spawnEnemy(id: string, position: Vector3, c: EnemyConfig): Enemy {
  return {
    id,
    position: position.clone(),
    facing: new Vector3(0, 0, -1),
    stance: 'advance',
    stanceTime: 0,
    health: { current: c.maxHealth, max: c.maxHealth, sinceHit: c.outOfCombatSeconds },
    knockback: new Vector3(),
  }
}

export interface EnemyStep {
  enemy: Enemy
  /** Damage to deal to the player this frame. Zero on most frames. */
  damageToPlayer: number
}

function horizontalTo(from: Vector3, to: Vector3): Vector3 {
  const flat = new Vector3(to.x - from.x, 0, to.z - from.z)
  return flat.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : flat.normalize()
}

export function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/**
 * Advance one enemy.
 *
 * A downed enemy is inert but still present — it is not deleted, because the doc's
 * non-lethality is meant to be visible in the world rather than implied by a
 * disappearing body. Knockback still decays on a downed enemy so it settles where
 * it was blown to.
 */
export function stepEnemy(
  enemy: Enemy,
  playerPosition: Vector3,
  dt: number,
  c: EnemyConfig,
): EnemyStep {
  const knockback = enemy.knockback.clone().multiplyScalar(Math.max(0, 1 - c.knockbackDamping * dt))
  const pushed = enemy.position.clone().addScaledVector(knockback, dt)

  if (isDowned(enemy.health)) {
    return {
      enemy: { ...enemy, stance: 'downed', stanceTime: enemy.stanceTime + dt, position: pushed, knockback },
      damageToPlayer: 0,
    }
  }

  const toPlayer = horizontalTo(pushed, playerPosition)
  const distance = horizontalDistance(pushed, playerPosition)
  const stanceTime = enemy.stanceTime + dt
  let damageToPlayer = 0
  let stance: Stance = enemy.stance
  let position = pushed
  let time = stanceTime

  if (enemy.stance === 'advance') {
    if (distance <= c.strikeRange) {
      stance = 'wind-up'
      time = 0
    } else {
      // Closes only horizontally: it is infantry, it does not chase into the sky.
      position = pushed.addScaledVector(toPlayer, c.moveSpeed * dt)
    }
  } else if (enemy.stance === 'wind-up') {
    if (stanceTime >= c.windUpSeconds) {
      // The hit lands only if the player is still in reach — which is what makes
      // the telegraph a real dodge window rather than decoration.
      if (distance <= c.strikeRange) damageToPlayer = c.strikeDamage
      stance = 'recover'
      time = 0
    }
  } else if (stanceTime >= c.recoverSeconds) {
    stance = 'advance'
    time = 0
  }

  return {
    enemy: { ...enemy, position, facing: toPlayer, stance, stanceTime: time, knockback },
    damageToPlayer,
  }
}

/** Take a hit: damage, plus a push that decays. */
export function hitEnemy(enemy: Enemy, damage: number, impulse: Vector3): Enemy {
  const health = applyDamage(enemy.health, damage)
  return {
    ...enemy,
    health,
    knockback: enemy.knockback.clone().add(impulse),
    // Being hit interrupts: a wind-up in progress is cancelled, which is how a
    // gust "interrupts, staggers, opens gaps" rather than merely chipping health.
    stance: isDowned(health) ? 'downed' : 'recover',
    stanceTime: 0,
  }
}
