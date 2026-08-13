import { Vector3 } from 'three'
import type { FlightConfig, PlayerState, TerrainQuery } from '../core/types'
import type { Level } from '../world/level'
import type { SaveData } from '../core/save'
import type { Act } from '../progress/acts'

/** How far above the surface to place a spawning player. */
const SPAWN_CLEARANCE = 2

/** Resolve a respawn position, falling back to the level spawn island. */
export function spawnPointFor(
  level: Level, terrain: TerrainQuery,
): (islandId: string | null) => Vector3 {
  return (islandId) => {
    const island =
      level.islands.find((i) => i.id === islandId) ??
      level.islands.find((i) => i.id === level.spawn.islandId)!
    const x = island.position.x
    const z = island.position.z
    const groundY = terrain.groundHeightAt(x, z)
    // If the surface cannot be found, sit above the island's nominal top.
    const y = groundY === null ? island.position.y + island.height : groundY
    return new Vector3(x, y + SPAWN_CLEARANCE, z)
  }
}

/**
 * The player as a session begins.
 *
 * `act` is a parameter rather than read out of `save`, and the reason is the hand-edited save.
 * The act is derived from the shrines the *level* recognises as collected, not from the length of
 * the array in storage, and resolving a saved id against the level is `placeShrines`'s job — so
 * the caller places the shrines first and hands the answer in. Recomputing it here from `save`
 * would be a second derivation, on weaker input, and the weaker one would be the one that
 * decided what the player can do.
 */
export function createPlayerState(
  level: Level, terrain: TerrainQuery, save: SaveData, config: FlightConfig, act: Act,
): PlayerState {
  const position = spawnPointFor(level, terrain)(level.spawn.islandId)
  const maxBreath = Math.max(save.maxBreath, config.baseMaxBreath)
  return {
    mode: 'ground',
    act,
    position,
    velocity: new Vector3(),
    forward: new Vector3(0, 0, -1),
    breath: maxBreath,
    maxBreath,
    grounded: true,
    lastGroundIslandId: level.spawn.islandId,
    airJumpsUsed: 0,
    chargeTime: 0, coyoteTime: 0, jumpBuffer: 0,
    scooterActive: false, scooterCharge: 0, wallRideNormal: null,
    dashesUsed: 0, dashRecovery: 0,
    slipstreamElapsed: null, slipstreamCooldown: 0,
    staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0,
    tangled: 0,
  }
}
