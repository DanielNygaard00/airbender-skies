import { MathUtils, Vector3 } from 'three'
import { applyDamage, isDowned, type Health, type HealthConfig } from './health'

/**
 * Spear infantry.
 *
 * The doc's enemy contract gives every type one axis of Aang's movement to
 * pressure, and this one pressures ground spacing: it closes, it strikes at reach,
 * and it punishes standing still. That is the whole behaviour — it is not built to
 * be a fair duel, it is built to make holding one spot expensive.
 */
export type Stance = 'advance' | 'wind-up' | 'recover' | 'downed' | 'rising'

/**
 * Which soldier this is.
 *
 * Identity, not behaviour — the behaviour lives in `EnemyAttack` below. Kept separate
 * because the view layer and the per-kind config lookup both need to know *which* type
 * they are looking at, and two types could one day share an attack shape.
 */
export type EnemyKind = 'spear' | 'archer'

/**
 * What a release produces.
 *
 * The spear's thrust and the archer's shot are the same four beats — advance, wind up,
 * release, recover — so there is one state machine and this says what the release does.
 * A discriminated union of whole enemies would be the right answer if the design
 * document's six types diverged sharply, but four of them do not exist yet.
 */
export type EnemyAttack =
  | { kind: 'melee'; damage: number }
  | { kind: 'projectile'; damage: number; speed: number }

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
  /** Which soldier this is. The caller uses it to pick the right config. */
  kind: EnemyKind
  position: Vector3
  /** Which way it is facing, for its own animation and strike direction. */
  facing: Vector3
  stance: Stance
  /** Seconds spent in the current stance. */
  stanceTime: number
  health: Health
  /**
   * How many times this soldier has been taken to zero.
   *
   * Indexes the recovery ladder: each rise restores less than the last, and running off
   * the end of `recoveryHealthFractions` is what makes a down permanent. Counts crossings
   * only — knocking a rising soldier back down does not advance it, so descending the
   * ladder always costs real damage.
   */
  downs: number
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
  /**
   * What this soldier's release does. Damage lives here rather than beside it, so a
   * projectile's damage is not split between the enemy and the arrow it fires.
   */
  attack: EnemyAttack
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
  /**
   * Seconds flat on the ground before pushing back up.
   *
   * Deliberately not named `recoverSeconds`: that one already exists and means the
   * vulnerable window after a strike. Two fields a syllable apart, both about recovering,
   * is how a caller reaches for the wrong one.
   */
  downedSeconds: number
  /** The push-up itself: long, visible, and a hit lands them straight back down. */
  risingSeconds: number
  /**
   * Health on each successive rise, as a fraction of max.
   *
   * The array's length is how many recoveries a soldier gets: run off the end and the
   * down is permanent, so the ladder's depth and its steps are one constant rather than
   * two that can disagree. An empty array is meaningful rather than broken — nobody ever
   * rises, which is exactly how this module behaved before recovery existed.
   */
  recoveryHealthFractions: readonly number[]
}

export function spawnEnemy(
  id: string, position: Vector3, kind: EnemyKind, c: EnemyConfig,
): Enemy {
  return {
    id,
    kind,
    position: position.clone(),
    facing: new Vector3(0, 0, -1),
    stance: 'advance',
    stanceTime: 0,
    health: { current: c.maxHealth, max: c.maxHealth, sinceHit: c.outOfCombatSeconds },
    downs: 0,
    knockback: new Vector3(),
    verticalVelocity: 0,
    grounded: true,
  }
}

export interface EnemyStep {
  enemy: Enemy
  /** Damage to deal to the player this frame. Zero on most frames. */
  damageToPlayer: number
  /**
   * True only on the frame this enemy went down by passing the world floor.
   *
   * Section 4.6 pays a non-lethal removal more than an environmental accident, so the
   * fight has to know which happened. It must not latch: the parked branch below
   * returns false for a body that is already down and already below the floor, which
   * is every frame after the first.
   */
  fellOutOfWorld: boolean
  /**
   * A shot loosed this frame, or null.
   *
   * Reported rather than resolved for the same reason `damageToPlayer` is: this function
   * advances one enemy and knows nothing about the projectile list or the player's
   * health. Carries only origin and direction — speed and damage come from the config
   * the caller already holds, so nothing is decided twice.
   */
  firedProjectile: { origin: Vector3; direction: Vector3 } | null
}

/** Chest height, so an arrow leaves the archer rather than the ground it stands on. */
const SHOT_HEIGHT = 1.1

function horizontalTo(from: Vector3, to: Vector3): Vector3 {
  const flat = new Vector3(to.x - from.x, 0, to.z - from.z)
  return flat.lengthSq() < 1e-8 ? new Vector3(0, 0, -1) : flat.normalize()
}

export function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/**
 * How much health this soldier gets back on its next rise, or null when the ladder is
 * spent and the down is permanent.
 *
 * One place owns the index arithmetic, so the check that starts a rise and the restore
 * that ends it cannot disagree about which rung is next. Indexed at `downs - 1` because
 * `downs` counts crossings and the first crossing earns the first rung.
 *
 * A non-positive rung is treated as the end of the ladder, same as a missing one, rather
 * than `?? null` alone: a soldier restored to zero or negative health is still downed by
 * `isDowned`'s own `<= 0`, so a rise that lands on such a rung could never complete —
 * `stepEnemy` would cycle downed -> rising -> zero-health-still-downed forever, with no
 * crossing to report and so no burst and no Focus. Treating it as absent instead makes
 * the down permanent up front, which is what a soldier that can never actually rise
 * amounts to anyway.
 */
export function nextRecoveryFraction(enemy: Enemy, c: EnemyConfig): number | null {
  const fraction = c.recoveryHealthFractions[enemy.downs - 1]
  return fraction !== undefined && fraction > 0 ? fraction : null
}

/** Worth aiming at: on its feet, or pushing back up onto them. */
export function isTargetable(enemy: Enemy): boolean {
  return !isDowned(enemy.health) || enemy.stance === 'rising'
}

/**
 * How far through pushing back up, 0 to 1. Zero when not rising.
 *
 * Fails closed on a non-positive `risingSeconds` rather than dividing by it: the result is
 * multiplied into a rotation, where a NaN corrupts the matrix instead of just looking wrong.
 */
export function risingProgress(enemy: Enemy, c: EnemyConfig): number {
  if (enemy.stance !== 'rising' || !(c.risingSeconds > 0)) return 0
  return MathUtils.clamp(enemy.stanceTime / c.risingSeconds, 0, 1)
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
  // Already downed and below the floor: parked. Downing a body does not stop it falling,
  // and the downed branch below keeps integrating, so without this a corpse in empty air
  // accelerates without bound — measured at 36km down and still gaining 1.2km/s a minute
  // in. Nothing can see it again, so it stops rather than running the physics forever.
  if (isDowned(enemy.health) && enemy.position.y < worldFloorY) {
    return {
      enemy: {
        ...enemy,
        verticalVelocity: 0,
        knockback: new Vector3(),
        stance: 'downed',
        stanceTime: enemy.stanceTime + dt,
      },
      damageToPlayer: 0,
      fellOutOfWorld: false,
      firedProjectile: null,
    }
  }

  const moved = fall(enemy, ground, dt, c)

  // Off the island and below the floor: downed, per section 4.6's list of ways an
  // enemy goes down. Without this, gravity would mean falling forever.
  if (moved.position.y < worldFloorY && !isDowned(enemy.health)) {
    return {
      enemy: {
        ...enemy, ...moved,
        health: applyDamage(enemy.health, enemy.health.current),
        downs: enemy.downs + 1,
        stance: 'downed', stanceTime: 0,
      },
      damageToPlayer: 0,
      fellOutOfWorld: true,
      firedProjectile: null,
    }
  }

  if (isDowned(enemy.health)) {
    // Frozen while airborne: a body still falling out of a Vortex is not recovering, and
    // without this it would land with the countdown already spent and rise on the spot.
    const stanceTime = moved.grounded ? enemy.stanceTime + dt : enemy.stanceTime
    const fraction = nextRecoveryFraction(enemy, c)

    if (enemy.stance === 'rising') {
      // The ladder cannot empty mid-rise — `downs` only moves on a crossing, and a rise
      // only starts with a rung available — but lying back down is the safe answer if it
      // ever did, because a rise that can never complete is a soldier stuck on one knee.
      if (fraction !== null && stanceTime >= c.risingSeconds) {
        return {
          enemy: {
            ...enemy, ...moved,
            // Clamped: a mistuned fraction above 1 would otherwise leave the pool over
            // max and the health bar overflowing its own frame.
            health: {
              ...enemy.health,
              current: MathUtils.clamp(enemy.health.max * fraction, 0, enemy.health.max),
              sinceHit: 0,
            },
            stance: 'advance',
            stanceTime: 0,
          },
          damageToPlayer: 0,
          fellOutOfWorld: false,
          firedProjectile: null,
        }
      }
      if (fraction !== null) {
        // Still pushing up: inert, but targetable. A hit here goes through hitEnemy's
        // ordinary path and puts the soldier straight back down.
        return {
          enemy: { ...enemy, ...moved, stance: 'rising', stanceTime },
          damageToPlayer: 0,
          fellOutOfWorld: false,
          firedProjectile: null,
        }
      }
    } else if (fraction !== null && moved.grounded && stanceTime >= c.downedSeconds) {
      return {
        enemy: {
          ...enemy, ...moved,
          stance: 'rising',
          stanceTime: 0,
          // Set at the start of the rise rather than the end: `facing` only updates in
          // the active branch below, so a soldier would otherwise push up aimed wherever
          // it fell and snap round on its first advance frame.
          facing: horizontalTo(moved.position, playerPosition),
        },
        damageToPlayer: 0,
        fellOutOfWorld: false,
        firedProjectile: null,
      }
    }

    // Down, not gone: the body stays in the world — but it still falls, and settles.
    return {
      enemy: { ...enemy, ...moved, stance: 'downed', stanceTime },
      damageToPlayer: 0,
      fellOutOfWorld: false,
      firedProjectile: null,
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
      fellOutOfWorld: false,
      firedProjectile: null,
    }
  }

  const toPlayer = horizontalTo(moved.position, playerPosition)
  // A spear cannot reach up and an arrow can, so the two measure differently. This is
  // the only place the two types genuinely diverge, and it is the whole reason an archer
  // pressures altitude: measured horizontally, a player hovering directly overhead sits
  // at distance 0 and would be inside any range, so climbing would stop being an escape.
  const ranged = c.attack.kind === 'projectile'
  const distance = ranged
    ? moved.position.distanceTo(playerPosition)
    : horizontalDistance(moved.position, playerPosition)
  const stanceTime = enemy.stanceTime + dt
  let damageToPlayer = 0
  let firedProjectile: EnemyStep['firedProjectile'] = null
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
      // Closes only horizontally, whichever type it is: infantry does not chase into the
      // sky, and an archer does not need to — it shoots upward instead.
      position = moved.position.clone().addScaledVector(toPlayer, c.moveSpeed * dt)
    }
  } else if (enemy.stance === 'wind-up') {
    if (stanceTime >= c.windUpSeconds) {
      // The release lands only if the player is still in reach — which is what makes the
      // telegraph a real dodge window rather than decoration.
      if (distance <= c.strikeRange) {
        if (c.attack.kind === 'melee') {
          damageToPlayer = c.attack.damage
        } else {
          // Aimed in 3D, unlike `facing` below: the arrow has to climb to a hovering
          // player. Shot from the soldier's chest rather than its feet, since the
          // position is at ground level.
          const origin = moved.position.clone().setY(moved.position.y + SHOT_HEIGHT)
          firedProjectile = { origin, direction: playerPosition.clone().sub(origin).normalize() }
        }
      }
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
    firedProjectile,
    fellOutOfWorld: false,
  }
}

/** Take a hit: damage, plus a push that decays. */
export function hitEnemy(enemy: Enemy, damage: number, impulse: Vector3): Enemy {
  const health = applyDamage(enemy.health, damage)
  // Crossings only. A hit on a body already at zero — which is what interrupting a rise
  // is — must not advance the ladder, or a tap at the right moment would substitute for
  // chipping through a whole health bar.
  const wentDown = isDowned(health) && !isDowned(enemy.health)
  return {
    ...enemy,
    health,
    downs: wentDown ? enemy.downs + 1 : enemy.downs,
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
