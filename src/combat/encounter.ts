import { Vector3 } from 'three'
import {
  applyDamage, fullHealth, isDowned, stepHealth, type Health, type HealthConfig,
} from './health'
import { hitEnemy, spawnEnemy, stepEnemy, type Enemy, type EnemyConfig } from './enemy'
import { gustImpulse, gustTargets, type GustConfig } from './gust'

/**
 * One fight: the enemies, the player's health, and the cooldown on their bending.
 *
 * Kept out of PlayerState on purpose. Movement is a pure function of a player
 * struct that a dozen tests build fixtures for, and combat has no business widening
 * that struct — a fight is a thing happening in the world, not a property of the
 * character's kinematics.
 */
export interface Encounter {
  enemies: Enemy[]
  playerHealth: Health
  /** Seconds until the next gust is available. */
  gustCooldown: number
}

export interface CombatConfig {
  player: HealthConfig
  enemy: EnemyConfig
  gust: GustConfig
}

export interface EnemySpawn {
  id: string
  position: Vector3
}

export function startEncounter(spawns: readonly EnemySpawn[], c: CombatConfig): Encounter {
  return {
    enemies: spawns.map((spawn) => spawnEnemy(spawn.id, spawn.position, c.enemy)),
    playerHealth: fullHealth(c.player),
    gustCooldown: 0,
  }
}

export interface EncounterInput {
  playerPosition: Vector3
  playerForward: Vector3
  /** Edge-triggered: the player asked to gust this frame. */
  gustPressed: boolean
}

export interface EncounterStep {
  encounter: Encounter
  /** Enemies knocked down this frame, for feedback and for scoring later. */
  downedThisFrame: string[]
  /** Enemies a gust connected with this frame, for feedback and for Focus. */
  hitThisFrame: string[]
  /** Whether the player was hit this frame, for feedback. */
  playerHit: boolean
}

/** Whether a gust can fire: off cooldown only. */
export function canGust(encounter: Encounter): boolean {
  return encounter.gustCooldown <= 0
}

/**
 * Advance the whole fight one frame.
 *
 * Order matters. The gust resolves before the enemies act, so a gust fired during a
 * wind-up interrupts that strike instead of trading with it — which is the entire
 * point of the move having high knockback and almost no damage.
 */
export function stepEncounter(
  encounter: Encounter,
  input: EncounterInput,
  dt: number,
  c: CombatConfig,
): EncounterStep {
  const wasDowned = new Set(
    encounter.enemies.filter((enemy) => isDowned(enemy.health)).map((enemy) => enemy.id),
  )

  let enemies = encounter.enemies
  let gustCooldown = Math.max(0, encounter.gustCooldown - dt)

  let hitThisFrame: string[] = []

  if (input.gustPressed && canGust(encounter)) {
    const caught = new Set(
      gustTargets(input.playerPosition, input.playerForward, enemies, c.gust)
        .map((enemy) => enemy.id),
    )
    // Read before the hits land, so "connected" means a live enemy took it rather
    // than a body being blown around the island.
    hitThisFrame = enemies
      .filter((enemy) => caught.has(enemy.id) && !isDowned(enemy.health))
      .map((enemy) => enemy.id)
    enemies = enemies.map((enemy) =>
      caught.has(enemy.id) && !isDowned(enemy.health)
        ? hitEnemy(
            enemy,
            c.gust.damage,
            gustImpulse(input.playerPosition, enemy.position, c.gust),
          )
        : enemy)
    gustCooldown = c.gust.cooldownSeconds
  }

  let damageToPlayer = 0
  enemies = enemies.map((enemy) => {
    const step = stepEnemy(enemy, input.playerPosition, dt, c.enemy)
    damageToPlayer += step.damageToPlayer
    return step.enemy
  })

  const hurt = damageToPlayer > 0
    ? applyDamage(encounter.playerHealth, damageToPlayer)
    : encounter.playerHealth
  const playerHealth = stepHealth(hurt, dt, c.player)

  const downedThisFrame = enemies
    .filter((enemy) => isDowned(enemy.health) && !wasDowned.has(enemy.id))
    .map((enemy) => enemy.id)

  return {
    encounter: { enemies, playerHealth, gustCooldown },
    downedThisFrame,
    hitThisFrame,
    playerHit: damageToPlayer > 0,
  }
}
