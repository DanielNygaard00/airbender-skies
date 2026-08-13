import { Vector3 } from 'three'
import { horizontalDistance, isTargetable, type Enemy, type GroundHeightQuery } from './enemy'
import { blockingPillar, type Pillar } from './earth'

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
  /**
   * True once an Air Wall has turned this arrow around.
   *
   * It flips which side of the fight the arrow is dangerous to: a fresh arrow can only hit
   * the player, a deflected one can only hit soldiers. Both halves of that are deliberate.
   *
   * A fresh arrow is inert to soldiers because nothing in the design makes archers a hazard
   * to their own line, and letting them be one would have a patrol of five downing itself
   * while the player walked away — the shipped `HOME_PATROL` has both archers firing straight
   * over three spear soldiers.
   *
   * A deflected arrow is inert to the player because "deflects rather than eating them"
   * (section 4.2) is a promise that the threat is *converted*, not merely displaced. A mirror
   * preserves the component of the velocity in its own plane, so a grazing arrow stays close
   * to the player after the bounce, and keeping it live would let a badly angled wall kill
   * you with your own defence. That reads as a bug however correct the physics is.
   *
   * Also the flag `deflect` reads to enforce one turn per arrow; see its own comment.
   */
  deflected: boolean
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
   * The soldier a deflected arrow struck this frame, or null.
   *
   * The id only. The damage is the arrow's own, which every caller already holds — the same
   * reason `EnemyStep.firedProjectile` carries an origin and a direction and leaves the speed
   * and the damage to the config the caller has in hand. Two places deciding what an arrow is
   * worth is how they come to disagree.
   */
  hitEnemyId: string | null
  /**
   * Seconds of glider refusal this projectile just inflicted, or 0.
   *
   * Non-zero only on the frame a net connects, and reported rather than applied for the same
   * reason `damageToPlayer` is: this function advances one projectile and knows nothing about
   * the player's posture or the state that holds the refusal.
   */
  tangleSeconds: number
  /**
   * The pillar that stopped this projectile this frame, or null.
   *
   * Reported rather than merely ending the flight silently, because a shot that vanishes with no
   * sound and no dust is indistinguishable from a shot that was never fired — the same argument
   * `deflectedThisFrame` makes for armour. Cover the player cannot hear working is cover they
   * will not learn to use.
   *
   * The id rather than the pillar, since the caller already holds the list. Distinct from
   * `hitEnemyId` even though both end a flight: one is an arrow arriving somewhere it was aimed,
   * and the other is an arrow arriving nowhere.
   */
  blockedByPillarId: string | null
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
    // Fresh arrows come from bows. Only `deflect` sets this.
    deflected: false,
  }
}

/**
 * Whether an arrow has reached a soldier's body.
 *
 * A flat band rather than a sphere: `hitRadius` across the ground, and the soldier's own
 * height as a separate vertical extent. That is the convention every reach in this game
 * follows — `ConeShape` is the same shape for the same reason — and here it is not a
 * convention borrowed for tidiness, it is forced.
 *
 * A single sphere of radius `hitRadius` cannot catch both of the two shots the Air Wall
 * produces, and both were measured before this was written. Centred on the soldier's feet it
 * misses a perfectly mirrored long return by 0.2: a mirror sends the arrow back along the line
 * it arrived on, so it comes home to the *bow* at `SHOT_HEIGHT` 1.1, against a `hitRadius` of
 * 0.9. Centred on the bow instead it misses the close-in conversion by 0.1: every arrow in this
 * game is aimed at `playerPosition`, which is the player's feet, so an arrow returned near
 * ground level passes a soldier six units away at about y 0.07 — 1.03 below a bow-height
 * centre. There is no single centre that covers both, and both are shots the move is for.
 *
 * The vertical extent is `2 * hitRadius`, which is not a new number: `hitRadius` is already
 * documented as roughly half the character's 1.8 height, so doubling it is the whole body
 * expressed through the constant that already models half of it. An arrow below the soldier's
 * feet is out rather than given a skirt — at that point it has met the ground, and the ground
 * test below is the honest thing to let end its flight.
 */
function hitsBody(arrow: Vector3, enemy: Enemy, c: ProjectileConfig): boolean {
  if (horizontalDistance(arrow, enemy.position) > c.hitRadius) return false
  const above = arrow.y - enemy.position.y
  return above >= 0 && above <= 2 * c.hitRadius
}

/**
 * Advance one arrow.
 *
 * Five ways to end, and the order matters: whoever the arrow can hurt is tested **before**
 * the ground, so an arrow arriving at a target standing at ground level is not swallowed by
 * the terrain test on the same frame. That was already true of the player and it has to hold
 * for soldiers too — they stand on the ground by definition, so a ground-first order would
 * make a returned arrow essentially unable to connect with anything.
 *
 * Which side it can hurt is `p.deflected`, not a parameter: see the flag's own comment. The
 * `enemies` list is therefore ignored on the overwhelming majority of frames, and is passed
 * anyway rather than being made optional — an optional target list is a target list a caller
 * forgets, and this function has exactly one production caller.
 *
 * **A raised pillar is tested first, ahead of every one of those, and that ordering is the whole
 * of whether earth's cover works.** Tested against the step as a swept segment rather than
 * against the arrow's new position: at the archer's shipped speed of 34 an arrow covers 0.57
 * units a frame at 60 Hz against a pillar 2.4 units across, so a position test would hold, but it
 * would hold by luck and would stop holding the day either number moved. Tested *before* the
 * player, because an arrow that crosses a pillar and reaches the player inside one frame has to
 * be stopped by the rock rather than counted as a hit — the pillar is between them, and a cover
 * that lost a race with the frame rate would fail exactly when the player was closest to it.
 *
 * The pillar list is not filtered by which side the arrow belongs to. A returned arrow is stopped
 * by a rock in its way just as an incoming one is; see `pillarBlocks`.
 */
export function stepProjectile(
  p: Projectile,
  playerPosition: Vector3,
  enemies: readonly Enemy[],
  pillars: readonly Pillar[],
  ground: GroundHeightQuery,
  dt: number,
  c: ProjectileConfig,
): ProjectileStep {
  const position = p.position.clone().addScaledVector(p.velocity, dt)
  const age = p.age + dt

  const stopped = blockingPillar(p.position, position, pillars)
  if (stopped) {
    // No damage to anyone and no payload delivered, which is the point: the rock ate the shot.
    // A net stopped by a pillar therefore grounds nobody, exactly as one that lands on the
    // terrain does.
    return {
      projectile: null, damageToPlayer: 0, hitEnemyId: null, tangleSeconds: 0,
      blockedByPillarId: stopped.id,
    }
  }

  if (!p.deflected && position.distanceTo(playerPosition) <= c.hitRadius) {
    // The one branch that reports a payload: a net that lands on the terrain or expires in
    // the air has caught nothing, so its `tangleSeconds` goes nowhere.
    return {
      projectile: null, damageToPlayer: p.damage, hitEnemyId: null,
      tangleSeconds: p.tangleSeconds, blockedByPillarId: null,
    }
  }

  if (p.deflected) {
    for (const enemy of enemies) {
      // The same `isTargetable` every resolver in `stepEncounter` asks. A returned arrow
      // sailing through a body already flat on the ground is not a hit, and one striking a
      // soldier mid-push-up is — that is the state the rest of the fight treats as live.
      if (!isTargetable(enemy)) continue
      if (hitsBody(position, enemy, c)) {
        // `tangleSeconds` 0 even for a returned net, and this is the deliberate answer rather
        // than an oversight the merge left behind. The refusal a net carries is a refusal to
        // deploy a glider, and a soldier has no glider to refuse — there is nothing on the
        // enemy side for the payload to mean. A returned net therefore lands as a plain
        // zero-damage strike, which is what `hitEnemyId` already reports. The day enemies get
        // a posture worth taking away, this is the line that grows a branch.
        return {
          projectile: null, damageToPlayer: 0, hitEnemyId: enemy.id, tangleSeconds: 0,
          blockedByPillarId: null,
        }
      }
    }
  }

  // A null height is the void between islands, where there is nothing to stop an arrow.
  const height = ground.groundHeightAt(position.x, position.z)
  if (height !== null && position.y <= height) {
    return {
      projectile: null, damageToPlayer: 0, hitEnemyId: null, tangleSeconds: 0,
      blockedByPillarId: null,
    }
  }

  if (age >= c.maxSeconds) {
    return {
      projectile: null, damageToPlayer: 0, hitEnemyId: null, tangleSeconds: 0,
      blockedByPillarId: null,
    }
  }

  return {
    projectile: { ...p, position, age }, damageToPlayer: 0, hitEnemyId: null, tangleSeconds: 0,
    blockedByPillarId: null,
  }
}
