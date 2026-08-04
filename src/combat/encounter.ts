import { Vector3 } from 'three'
import {
  applyDamage, fullHealth, isDowned, stepHealth, type Health, type HealthConfig,
} from './health'
import {
  hitEnemy, spawnEnemy, stepEnemy, type Enemy, type EnemyConfig, type GroundHeightQuery,
} from './enemy'
import { gustImpulse, gustTargets, type GustConfig } from './gust'
import {
  waveDamage, waveImpulse, waveTargets, type PressureWaveConfig,
} from './pressure-wave'
import { vortexCharge, vortexImpulse, vortexTargets, type VortexConfig } from './vortex'

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
  /** Seconds the player has held a charge, or 0. Not the 0-to-1 fraction. */
  vortexHeldSeconds: number
  vortexCooldown: number
}

export interface CombatConfig {
  player: HealthConfig
  enemy: EnemyConfig
  gust: GustConfig
  pressureWave: PressureWaveConfig
  vortex: VortexConfig
}

export interface EnemySpawn {
  id: string
  position: Vector3
}

/**
 * What the fight needs from the world, separate from the per-frame input.
 *
 * Mirrors how `ControllerDeps` sits beside `InputState` in the player controller:
 * a terrain query is a dependency, not something the player did this frame.
 */
export interface EncounterDeps {
  ground: GroundHeightQuery
  worldFloorY: number
}

export function startEncounter(spawns: readonly EnemySpawn[], c: CombatConfig): Encounter {
  return {
    enemies: spawns.map((spawn) => spawnEnemy(spawn.id, spawn.position, c.enemy)),
    playerHealth: fullHealth(c.player),
    gustCooldown: 0,
    vortexHeldSeconds: 0,
    vortexCooldown: 0,
  }
}

export interface EncounterInput {
  playerPosition: Vector3
  playerForward: Vector3
  /** Edge-triggered: the player asked to gust this frame. */
  gustPressed: boolean
  /** A Pressure Wave landed at the player's feet this frame, or null. */
  slam: { strength: number } | null
  /** R held: a vortex is charging. */
  vortexHeld: boolean
  /** R released this frame. */
  vortexReleased: boolean
}

export interface EncounterStep {
  encounter: Encounter
  /** Enemies knocked down this frame, for feedback and for scoring later. */
  downedThisFrame: string[]
  /** Enemies a gust connected with this frame, for feedback and for Focus. */
  hitThisFrame: string[]
  /** Enemies a Pressure Wave connected with this frame. Kept apart from hitThisFrame:
   *  that one feeds a per-enemy Focus grant, and a slam is already paid for by its
   *  own strength, so folding them together would pay twice for one slam. */
  slamHitThisFrame: string[]
  /** Whether the player was hit this frame, for feedback. */
  playerHit: boolean
  /** The charge a vortex fired at, or null. For the effect that draws it. */
  vortexFired: number | null
}

/** Whether a gust can fire: off cooldown only. */
export function canGust(encounter: Encounter): boolean {
  return encounter.gustCooldown <= 0
}

/** Whether a vortex can start charging: off cooldown only. */
export function canVortex(encounter: Encounter): boolean {
  return encounter.vortexCooldown <= 0
}

/**
 * Advance the whole fight one frame.
 *
 * Order matters: the gust resolves, then the wave, then the enemies act. Both the
 * gust and the wave interrupt a wind-up rather than trading with it, which requires
 * both to land before enemies are stepped. Gust-then-wave is arbitrary between the
 * two moves but deterministic, and it means the wave sees the gust's knockback
 * already applied.
 */
export function stepEncounter(
  encounter: Encounter,
  input: EncounterInput,
  dt: number,
  c: CombatConfig,
  deps: EncounterDeps,
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

  let vortexCooldown = Math.max(0, encounter.vortexCooldown - dt)
  let vortexHeldSeconds = encounter.vortexHeldSeconds
  let vortexFired: number | null = null

  if (input.vortexHeld && vortexCooldown <= 0) {
    vortexHeldSeconds = Math.min(
      vortexHeldSeconds + dt, c.vortex.maxChargeSeconds,
    )
  }

  if (input.vortexReleased) {
    if (vortexHeldSeconds >= c.vortex.minChargeSeconds) {
      const charge = vortexCharge(vortexHeldSeconds, c.vortex)
      const caught = new Set(
        vortexTargets(input.playerPosition, enemies, charge, c.vortex).map((e) => e.id),
      )
      enemies = enemies.map((enemy) =>
        caught.has(enemy.id) && !isDowned(enemy.health)
          // Zero damage: the move is setup. hitEnemy still interrupts, which is
          // what a control move should do to a wind-up.
          ? hitEnemy(enemy, 0, vortexImpulse(
              input.playerPosition, enemy.position, charge, c.vortex,
            ))
          : enemy)
      vortexFired = charge
      vortexCooldown = c.vortex.cooldownSeconds
    }
    // Either way the charge is spent. A release below the minimum costs nothing,
    // so a mistaken tap is not punished with a 3.5 second cooldown.
    vortexHeldSeconds = 0
  }

  let slamHitThisFrame: string[] = []

  if (input.slam) {
    const { strength } = input.slam
    const caught = new Set(
      waveTargets(input.playerPosition, enemies, strength, c.pressureWave)
        .map((enemy) => enemy.id),
    )
    // Read before the hits land, so a connect means a live enemy took it.
    slamHitThisFrame = enemies
      .filter((enemy) => caught.has(enemy.id) && !isDowned(enemy.health))
      .map((enemy) => enemy.id)
    const damage = waveDamage(strength, c.pressureWave)
    enemies = enemies.map((enemy) =>
      caught.has(enemy.id) && !isDowned(enemy.health)
        ? hitEnemy(
            enemy,
            damage,
            waveImpulse(input.playerPosition, enemy.position, strength, c.pressureWave),
          )
        : enemy)
  }

  let damageToPlayer = 0
  enemies = enemies.map((enemy) => {
    const step = stepEnemy(enemy, input.playerPosition, deps.ground, deps.worldFloorY, dt, c.enemy)
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
    encounter: { enemies, playerHealth, gustCooldown, vortexHeldSeconds, vortexCooldown },
    downedThisFrame,
    hitThisFrame,
    slamHitThisFrame,
    playerHit: damageToPlayer > 0,
    vortexFired,
  }
}
