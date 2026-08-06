import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import { spawnPointFor } from '../player/state'
import { DEFAULT_COMBAT_CONFIG, DEFAULT_PATROL_CONFIG, HOME_PATROL } from './config'
import { startEncounter, stepEncounter } from './encounter'

/**
 * Where the patrol stands, measured against the ground it actually stands on.
 *
 * This is the one property of `HOME_PATROL` that cannot be read off the coordinates alone:
 * a soldier's distance from the player's spawn point depends on the terrain height under
 * both, so the check needs the real island geometry rather than a fixture. Building all
 * thirteen islands' geometry costs a couple of hundred milliseconds, which is why this
 * lives in its own file rather than being folded into a faster suite.
 *
 * The defect it guards against shipped once: the archers were placed 34 and 47 units out
 * against a 40-unit firing range and a 48-unit notice range, so one loosed an arrow 0.8
 * seconds after load and a motionless player was dead in about five. Nothing failed,
 * because nothing measured placement against the enemies' own ranges.
 */
function homeTerrain() {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  return createTerrainQuery(islands)
}

/** Each soldier standing on the ground, as `spawnEnemy` plus the first ground snap leaves it. */
function placedPatrol(terrain: ReturnType<typeof homeTerrain>) {
  return HOME_PATROL.map((spawn) => {
    const ground = terrain.groundHeightAt(spawn.position.x, spawn.position.z)
    return { spawn, ground, at: new Vector3(spawn.position.x, ground ?? 0, spawn.position.z) }
  })
}

describe('the home patrol stands on the island', () => {
  it('puts every soldier on real ground', () => {
    // A null height is the void between islands. A soldier spawned there falls out of the
    // world on its first step and is downed before the player ever sees it.
    for (const { spawn, ground } of placedPatrol(homeTerrain())) {
      expect(ground, `${spawn.id} has no ground beneath it`).not.toBe(null)
    }
  })

  it('keeps every soldier clear of the island rim', () => {
    // The home island's ground runs out near radius 65. A soldier much closer to the edge
    // than this gets blown into the void by ordinary knockback, which turns every fight
    // into free environmental removals and quietly cheapens section 4.6's scoring.
    for (const { spawn } of placedPatrol(homeTerrain())) {
      const radius = Math.hypot(spawn.position.x, spawn.position.z)
      expect(radius, `${spawn.id} is too close to the rim`).toBeLessThan(58)
    }
  })
})

describe('the home patrol does not engage a player who has just loaded the game', () => {
  it('places every soldier outside its own notice range of the spawn point', () => {
    // The regression guard. Measured in 3D against each kind's own aggroRange, because a
    // ranged attacker measures in 3D — a check written horizontally would pass an archer
    // sitting directly above or below the spawn.
    const terrain = homeTerrain()
    const spawn = spawnPointFor(ARCHIPELAGO, terrain)('home')

    for (const { spawn: s, at } of placedPatrol(terrain)) {
      const config = DEFAULT_COMBAT_CONFIG.enemies[s.kind]
      const distance = at.distanceTo(spawn)
      expect(
        distance,
        `${s.id} (${s.kind}) is ${distance.toFixed(2)} from the spawn, `
        + `inside its notice range of ${config.aggroRange}`,
      ).toBeGreaterThan(config.aggroRange)
    }
  })

  it('leaves a real margin rather than sitting on the threshold', () => {
    // Not a bare "outside": a soldier parked one unit beyond its notice range engages on
    // the first step in any direction, which is indistinguishable from engaging at spawn.
    const terrain = homeTerrain()
    const spawn = spawnPointFor(ARCHIPELAGO, terrain)('home')

    for (const { spawn: s, at } of placedPatrol(terrain)) {
      const config = DEFAULT_COMBAT_CONFIG.enemies[s.kind]
      expect(
        at.distanceTo(spawn) - config.aggroRange,
        `${s.id} has too little margin beyond its notice range`,
      ).toBeGreaterThan(5)
    }
  })

  it('keeps the archers behind the spears', () => {
    // The shape section 4.4 asks for: walking out from the spawn you meet the spears first
    // and the archers cover them from behind. Asserted as a relationship between the two
    // groups rather than against literal radii, so the layout can be retuned freely.
    const placed = placedPatrol(homeTerrain())
    const radius = (id: string) => {
      const found = placed.find((p) => p.spawn.id === id)
      if (!found) throw new Error(`no soldier named ${id}`)
      return Math.hypot(found.spawn.position.x, found.spawn.position.z)
    }
    const spears = placed.filter((p) => p.spawn.kind === 'spear').map((p) => radius(p.spawn.id))
    const archers = placed.filter((p) => p.spawn.kind === 'archer').map((p) => radius(p.spawn.id))

    expect(Math.min(...archers)).toBeGreaterThan(Math.max(...spears))
  })
})

describe('a motionless player is left alone', () => {
  it('takes no damage over ten seconds of standing on the spawn point', () => {
    // The distance tests above assert a proxy — that each soldier is outside its own notice
    // range. This asserts the thing actually wanted: run the real fight, from the real
    // spawn, over the real ground, and confirm nothing reaches the player. Worth having
    // separately, because a proxy can hold while the goal fails: the release re-checks
    // reach at the end of a wind-up, arrows travel for a second before landing, and neither
    // is visible to a distance measurement taken once at frame zero.
    const terrain = homeTerrain()
    const spawn = spawnPointFor(ARCHIPELAGO, terrain)('home')
    const deps = {
      ground: terrain,
      worldFloorY: ARCHIPELAGO.worldFloorY,
      spawns: HOME_PATROL,
      patrol: DEFAULT_PATROL_CONFIG,
    }
    const input = {
      playerPosition: spawn,
      playerForward: new Vector3(0, 0, -1),
      gustPressed: false,
      slam: null,
      vortexHeld: false,
      vortexReleased: false,
      playerInvulnerable: false,
      staffSwing: null,
    }

    let encounter = startEncounter(HOME_PATROL, DEFAULT_COMBAT_CONFIG)
    const full = encounter.playerHealth.current
    let arrowsSeen = 0

    // Ten seconds. The old layout's first hit landed at 1.80s and zero health at 5.63s, so
    // this window is well past the failure it guards against.
    for (let frame = 0; frame < 600; frame++) {
      const step = stepEncounter(encounter, input, 1 / 60, DEFAULT_COMBAT_CONFIG, deps)
      arrowsSeen += step.firedThisFrame.length
      encounter = step.encounter
    }

    expect(encounter.playerHealth.current, 'a motionless player lost health').toBe(full)
    // And nothing was even thrown at them — health surviving because every arrow happened to
    // miss would be luck, not placement.
    expect(arrowsSeen, 'an archer loosed at a motionless player').toBe(0)
  })
})

describe('a cleared patrol can still be restored', () => {
  it('leaves somewhere on the home island beyond respawnRange of every spawn point', () => {
    // Moving the patrol outward costs something: a restore needs the player beyond
    // respawnRange of *every* spawn point, so pushing the archers out pushes that
    // requirement out too. If no such spot existed on the home island, clearing this
    // patrol would mean flying to another island to bring it back.
    const terrain = homeTerrain()
    const placed = placedPatrol(terrain)

    let best = 0
    for (let x = -64; x <= 64; x += 4) {
      for (let z = -64; z <= 64; z += 4) {
        if (Math.hypot(x, z) > 64) continue
        if (terrain.groundHeightAt(x, z) === null) continue
        const nearest = Math.min(
          ...placed.map((p) => Math.hypot(x - p.spawn.position.x, z - p.spawn.position.z)),
        )
        best = Math.max(best, nearest)
      }
    }

    expect(best).toBeGreaterThan(DEFAULT_PATROL_CONFIG.respawnRange)
  })
})
