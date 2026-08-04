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

/**
 * Just the ground height, and nothing else.
 *
 * `TerrainQuery` also carries `raycastDown`, which stepping an enemy has no use for.
 * Asking for the narrower thing keeps the combat model independent of the parts of
 * terrain it does not need, and makes a test fixture one line instead of six.
 */
export interface GroundHeightQuery {
  groundHeightAt(x: number, z: number): number | null
}

export interface Enemy {
  id: string
  position: Vector3
  /** Which way it is facing, for its own animation and strike direction. */
  facing: Vector3
  stance: Stance
  /** Seconds spent in the current stance. */
  stanceTime: number
  health: Health
  /** Decaying horizontal push from a gust, a slam or a vortex. Horizontal only. */
  knockback: Vector3
  /** Ballistic vertical speed. Gravity acts on this; the ground snap ends it. */
  verticalVelocity: number
  /**
   * Set by the ground snap, and the authority on "airborne".
   *
   * Stored rather than derived because every consumer would otherwise re-test y
   * against the ground with its own epsilon and drift from the snap that decides it.
   */
  grounded: boolean
}

export interface EnemyConfig extends HealthConfig {
  /** Closing speed on foot. Slower than the player, who should out-run it. */
  moveSpeed: number
  /**
   * How far away it will notice and pursue.
   *
   * Without this an enemy walks towards the player forever from anywhere on the
   * map, so a patrol on the home island would eventually trail the player across
   * the whole archipelago. A leash also makes disengaging a real option, which
   * matters for a character whose defence is positional.
   */
  aggroRange: number
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
  /** Matches the world's own gravity in DEFAULT_GROUND_CONFIG. */
  gravity: number
  /**
   * Step-down tolerance for the ground snap, in metres.
   *
   * Walking downhill, an enemy's horizontal step lands it above the lower ground
   * ahead of it for one frame — `position.y > height` — before gravity pulls it down
   * onto the snap on the next frame. Without a tolerance that alternation reads as
   * airborne every other frame, which halves its effective walk speed and, because an
   * airborne enemy is inert, halves its ability to attack too. This tolerance lets a
   * body that was already on the ground stick to a slope or small drop underfoot.
   */
  snapDistance: number
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
    verticalVelocity: 0,
    grounded: true,
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

interface Fallen {
  position: Vector3
  verticalVelocity: number
  grounded: boolean
  knockback: Vector3
}

/** One frame of ballistics: decaying horizontal push, gravity, then a ground snap. */
function fall(
  enemy: Enemy, ground: GroundHeightQuery, dt: number, c: EnemyConfig,
): Fallen {
  const knockback = enemy.knockback.clone()
    .multiplyScalar(Math.max(0, 1 - c.knockbackDamping * dt))
  let verticalVelocity = enemy.verticalVelocity - c.gravity * dt
  const position = enemy.position.clone()
  position.x += knockback.x * dt
  position.z += knockback.z * dt
  position.y += verticalVelocity * dt

  let grounded = false
  const height = ground.groundHeightAt(position.x, position.z)
  // Only a descending enemy lands, so a lift is not cancelled on its first frame.
  //
  // The second half of the OR is a step-down tolerance, matching the player's own
  // snapDistance in groundStep (src/player/ground-move.ts): walking downhill, the
  // horizontal step lands an enemy above the lower ground ahead of it for one
  // frame, and without this it reads as airborne every other frame -- half its
  // walk speed, and since an airborne enemy is inert, half its ability to attack.
  //
  // That tolerance is gated on `enemy.grounded` (last frame's state, not this
  // one's) for the same reason the player's is gated on `state.grounded`: a body
  // that was not already on the ground must actually reach it. A Vortex lifts an
  // enemy several metres up, and an ungated tolerance would snap it onto the
  // ground up to snapDistance before it truly landed -- a visible pop for a lift
  // that size.
  if (
    height !== null && verticalVelocity <= 0 &&
    (position.y <= height || (enemy.grounded && position.y - height <= c.snapDistance))
  ) {
    position.y = height
    verticalVelocity = 0
    grounded = true
  }
  return { position, verticalVelocity, grounded, knockback }
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
  ground: GroundHeightQuery,
  worldFloorY: number,
  dt: number,
  c: EnemyConfig,
): EnemyStep {
  const moved = fall(enemy, ground, dt, c)

  // Off the island and below the floor: downed, per section 4.6's list of ways an
  // enemy goes down. Without this, gravity would mean falling forever.
  if (moved.position.y < worldFloorY && !isDowned(enemy.health)) {
    return {
      enemy: {
        ...enemy, ...moved,
        health: applyDamage(enemy.health, enemy.health.current),
        stance: 'downed', stanceTime: 0,
      },
      damageToPlayer: 0,
    }
  }

  if (isDowned(enemy.health)) {
    // Down, not gone: the body stays in the world — but it still falls, and settles.
    return {
      enemy: { ...enemy, ...moved, stance: 'downed', stanceTime: enemy.stanceTime + dt },
      damageToPlayer: 0,
    }
  }

  // Airborne: inert. This is what makes a Vortex setup rather than damage — the payoff
  // for lifting a group is that the group stops acting. A wind-up in progress is
  // dropped, consistent with hitEnemy already treating a hit as an interruption.
  if (!moved.grounded) {
    const winding = enemy.stance === 'wind-up'
    return {
      enemy: {
        ...enemy, ...moved,
        stance: winding ? 'recover' : enemy.stance,
        stanceTime: winding ? 0 : enemy.stanceTime + dt,
      },
      damageToPlayer: 0,
    }
  }

  const toPlayer = horizontalTo(moved.position, playerPosition)
  const distance = horizontalDistance(moved.position, playerPosition)
  const stanceTime = enemy.stanceTime + dt
  let damageToPlayer = 0
  let stance: Stance = enemy.stance
  let position = moved.position
  let time = stanceTime

  if (enemy.stance === 'advance') {
    if (distance > c.aggroRange) {
      // Out of notice range: hold station rather than trailing the player home.
      position = moved.position
    } else if (distance <= c.strikeRange) {
      stance = 'wind-up'
      time = 0
    } else {
      // Closes only horizontally: it is infantry, it does not chase into the sky.
      position = moved.position.clone().addScaledVector(toPlayer, c.moveSpeed * dt)
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
    enemy: {
      ...enemy, ...moved, position, facing: toPlayer, stance, stanceTime: time,
    },
    damageToPlayer,
  }
}

/** Take a hit: damage, plus a push that decays. */
export function hitEnemy(enemy: Enemy, damage: number, impulse: Vector3): Enemy {
  const health = applyDamage(enemy.health, damage)
  return {
    ...enemy,
    health,
    // Horizontal push and ballistic lift are different physics: damping a fall would
    // make a body float down, which is why they are separate fields now.
    knockback: enemy.knockback.clone().add(new Vector3(impulse.x, 0, impulse.z)),
    verticalVelocity: enemy.verticalVelocity + impulse.y,
    // grounded is deliberately not set here: the physics step below recomputes it from
    // the snap, and two places deciding it is how they drift apart.
    // Being hit interrupts: a wind-up in progress is cancelled, which is how a
    // gust "interrupts, staggers, opens gaps" rather than merely chipping health.
    stance: isDowned(health) ? 'downed' : 'recover',
    stanceTime: 0,
  }
}
