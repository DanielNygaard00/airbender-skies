import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { createIslandGeometry } from '../world/island'
import { createTerrainQuery, type IslandMesh } from '../world/terrain-query'
import { DEFAULT_COMBAT_CONFIG, DEFAULT_PATROL_CONFIG } from './config'
import { startEncounter, stepEncounter, type EncounterInput, type EnemySpawn } from './encounter'
import { isDowned } from './health'
import { deflects } from './enemy'

/**
 * The heavy armoured soldier's route off the island, measured rather than asserted.
 *
 * Section 4.4 says this type "must be broken with earth or the environment", and earthbending
 * does not exist in this game — so the environment is the whole of the answer, and an answer that
 * only exists in a comment is not an answer. This file runs the real fight over the real home
 * island geometry and watches a heavy leave the world.
 *
 * **The claim is narrow and worth stating exactly: a full-strength Pressure Wave, thrown by a
 * player standing between a heavy and the island's rim, pushes it past the edge of the walkable
 * ground, and it then falls past `worldFloorY` and is downed with `fellOutOfWorld` set.** Not
 * "the heavy can be beaten", which `encounter.test.ts` covers separately by grinding one down the
 * recovery ladder with slams; and not "any knockback works", which is false — the gust is the
 * move a player would reach for and it does nothing at all.
 *
 * Own file rather than an addition to `encounter.test.ts`, following `patrol-placement.test.ts`
 * and `reach-geometry.test.ts`: building all thirteen islands' geometry costs a couple of hundred
 * milliseconds, and `encounter.test.ts` is a fast fixture suite whose enemies stand on level fake
 * ground by design. The terrain fixture copies `patrol-placement.test.ts` rather than inventing a
 * second way to build one.
 */
function homeTerrain() {
  const islands: IslandMesh[] = ARCHIPELAGO.islands.map((def) => {
    const mesh = new Mesh(createIslandGeometry(def))
    mesh.position.copy(def.position)
    return { id: def.id, mesh }
  })
  return createTerrainQuery(islands)
}

const C = DEFAULT_COMBAT_CONFIG
const HEAVY = C.enemies.heavy

/**
 * The launch pair, on the home island's closest rim.
 *
 * Measured, not chosen. The home island's walkable ground stops at a different radius on every
 * bearing — 58.5 at its nearest and 78 at its furthest — and the shove available is fixed: a full
 * slam pushes at `maxKnockback` 30 m/s against `knockbackDamping` 2.6, so the total displacement
 * is `30 / 2.6 ≈ 11.5 m` however long the body stays airborne. So the bearing with the closest rim
 * is the one where the route exists with the most margin, and that is 300 degrees — out over the
 * +X, −Z quadrant where the patrol lives, which is also where the fight actually happens.
 *
 * `HEAVY_AT` sits at radius 50 on that bearing, needing 8.5 m of the 11.5 available. `PLAYER_AT`
 * is at radius 42 on the same bearing, so the wave's outward direction is very nearly radial and
 * the 8 m gap between them is inside the full slam's 11 m radius. Both stand on real ground, and
 * `stands on real ground with the rim where this expects it` pins all of that before the route
 * test runs, so a terrain change cannot quietly turn this into a test of nothing.
 */
const BEARING = (300 / 180) * Math.PI
const at = (radius: number) =>
  new Vector3(Math.cos(BEARING) * radius, 0, Math.sin(BEARING) * radius)
const HEAVY_AT = at(50)
const PLAYER_AT = at(42)

/** A neutral frame: nothing pressed. */
function inputAt(playerPosition: Vector3): EncounterInput {
  return {
    playerPosition,
    playerForward: new Vector3(0, 0, -1),
    gustPressed: false,
    slam: null,
    vortexHeld: false,
    vortexReleased: false,
    playerInvulnerable: false,
    staffSwing: null,
    // The Air Wall's three fields, all neutral. `playerAim` is the look direction the wall
    // faces along and is only read when `airWallHeld` is true, but it is not optional -- an
    // aim a caller can forget is an aim that defaults to a bearing nobody chose.
    playerAim: new Vector3(0, 0, -1),
    playerBreath: 100,
    airWallHeld: false,
    // Air, so `gustPressed` resolves to a gust rather than a Water Grip. Nothing in this file
    // presses a bending key, but the field is not optional and the element decides what the
    // two bending keys mean, so the neutral frame has to name one.
    element: 'air' as const,
    focusAvailable: 0,
    breathAvailable: 100,
  }
}

/** A soldier of the given kind, dropped onto the ground under it the way `main.ts` does. */
function spawnOn(
  terrain: ReturnType<typeof homeTerrain>, id: string, kind: EnemySpawn['kind'], where: Vector3,
): EnemySpawn {
  const ground = terrain.groundHeightAt(where.x, where.z)
  if (ground === null) throw new Error(`no ground under ${id} at ${where.x}, ${where.z}`)
  return { id, position: new Vector3(where.x, ground, where.z), kind }
}

/**
 * Run the fight from one position, slamming on the first frame, until the soldier leaves the
 * world or the window runs out.
 *
 * The window is generous: the drop from the island's surface at about y 8 to `worldFloorY` at
 * −600 takes roughly 7.8 seconds under gravity 20, so 15 seconds is about twice what is needed.
 */
function slamAndWatch(
  soldier: { id: string; kind: EnemySpawn['kind']; at: Vector3 },
  playerAt: Vector3,
  strength: number,
) {
  const terrain = homeTerrain()
  const deps = {
    ground: terrain,
    worldFloorY: ARCHIPELAGO.worldFloorY,
    // Empty, so `shouldRestorePatrol` always declines: a restore mid-fall would replace the very
    // body this test is watching, and the route would read as never having happened.
    spawns: [] as EnemySpawn[],
    patrol: DEFAULT_PATROL_CONFIG,
  }
  // Dropped onto the terrain, exactly the way `main.ts` builds `patrolSpawns`. Not optional: the
  // wave's `verticalReach` is 4 m and the home island's surface out here is about 8 m up, so a
  // soldier left at the authored `y: 0` is outside the band from a player standing on the ground
  // and every slam in this file misses. That is how the first draft of this file passed three of
  // its assertions for entirely the wrong reason.
  let encounter = startEncounter([spawnOn(terrain, soldier.id, soldier.kind, soldier.at)], C)
  const stand = playerAt.clone()
  const ground = terrain.groundHeightAt(stand.x, stand.z)
  if (ground === null) throw new Error('the player is not standing on ground')
  stand.y = ground

  let lost: string[] = []
  let slamConnected: string[] = []
  for (let frame = 0; frame < 60 * 15 && lost.length === 0; frame++) {
    const step = stepEncounter(
      encounter,
      { ...inputAt(stand), slam: frame === 0 ? { strength } : null },
      1 / 60, C, deps,
    )
    if (frame === 0) slamConnected = step.slamHitThisFrame
    lost = step.lostThisFrame
    encounter = step.encounter
  }
  return { encounter, lost, slamConnected, terrain }
}

describe('the ground the environment route needs', () => {
  it('stands on real ground with the rim where this expects it', () => {
    // Every premise of the route test below, pinned before it runs. Without this, a terrain change
    // that moved the rim outward would turn "the heavy did not leave the world" into a mysterious
    // failure, and one that moved it inward would let the route pass for a soldier that was
    // already standing in mid-air.
    const terrain = homeTerrain()
    const heavyGround = terrain.groundHeightAt(HEAVY_AT.x, HEAVY_AT.z)
    const playerGround = terrain.groundHeightAt(PLAYER_AT.x, PLAYER_AT.z)
    expect(heavyGround, 'the heavy should start on walkable ground').not.toBe(null)
    expect(playerGround, 'the player should stand on walkable ground').not.toBe(null)

    // The rim on this bearing, to a tenth of a metre.
    let rim = 0
    for (let r = 40; r <= 90; r += 0.1) {
      if (terrain.groundHeightAt(Math.cos(BEARING) * r, Math.sin(BEARING) * r) === null) {
        rim = r
        break
      }
    }
    expect(rim).toBeGreaterThan(58.4)
    expect(rim).toBeLessThan(58.6)

    // The shove available, from the config rather than from a literal: `maxKnockback` decaying at
    // `knockbackDamping` integrates to `v / damping` metres of total travel.
    const shove = C.pressureWave.maxKnockback / HEAVY.knockbackDamping
    expect(shove).toBeGreaterThan(11.5)
    // And the margin: the heavy needs to cross the rim, and it has more push than distance.
    const needed = rim - HEAVY_AT.length()
    expect(needed).toBeLessThan(shove)
    // Recorded, so the size of the margin is a number in the suite rather than a claim: 8.5 m
    // needed against 11.5 available.
    expect(needed).toBeGreaterThan(8.4)
    expect(needed).toBeLessThan(8.6)

    // The two stand within the full slam's radius of each other, or the slam never reaches it.
    expect(HEAVY_AT.distanceTo(PLAYER_AT)).toBeLessThan(C.pressureWave.maxRadius)
    // And within its vertical band, which the slope between them could otherwise break.
    expect(Math.abs(heavyGround! - playerGround!))
      .toBeLessThan(C.pressureWave.verticalReach)
  })
})

describe('a heavy armoured soldier and the rim', () => {
  it('goes down by leaving the world when a full slam throws it off the edge', () => {
    // The route, played. This is the sentence section 4.4 asks for, and the only place in the
    // codebase where it is true rather than argued.
    const { lost, encounter, slamConnected } = slamAndWatch(
      { id: 'plate', kind: 'heavy', at: HEAVY_AT }, PLAYER_AT, 1,
    )
    // The slam reached it at all, so nothing below can pass because the wave missed.
    expect(slamConnected).toEqual(['plate'])
    expect(lost, 'a full slam at the rim did not put the heavy out of the world').toEqual(['plate'])
    const plate = encounter.enemies[0]!
    expect(isDowned(plate.health)).toBe(true)
    // Section 4.6 pays an environmental removal differently from a knockdown, so it has to be
    // reported as one rather than merely ending up downed.
    expect(plate.downs).toBe(1)
    expect(plate.position.y).toBeLessThan(ARCHIPELAGO.worldFloorY)
  })

  it('leaves the same heavy standing when the same slam lands away from the rim', () => {
    // The positive control, and it is the one that makes the test above mean something. Same
    // soldier, same full-strength slam, same 8 m standoff, same bearing — 20 units further in, so
    // the 11.5 m of shove has nowhere near enough ground to run out of. Without this, a route test
    // could pass for a soldier that was going to fall regardless of the slam.
    const { lost, encounter } = slamAndWatch(
      { id: 'plate', kind: 'heavy', at: at(30) }, at(22), 1,
    )
    expect(lost).toEqual([])
    const plate = encounter.enemies[0]!
    expect(plate.position.y).toBeGreaterThan(ARCHIPELAGO.worldFloorY)
    // Still on the island rather than merely still above the floor.
    expect(plate.grounded).toBe(true)
  })

  it('leaves it standing when no slam is thrown at all', () => {
    // The second control, on the slam rather than on the position: a heavy left alone at radius 50
    // stays there. Together with the test above, the only difference between falling and not
    // falling is the slam and the ground under it.
    const { lost, encounter } = slamAndWatch(
      { id: 'plate', kind: 'heavy', at: HEAVY_AT }, PLAYER_AT, 0,
    )
    expect(lost).toEqual([])
    expect(encounter.enemies[0]!.grounded).toBe(true)
  })

  it('is not put off the edge by a gust from the same place, however many land', () => {
    // The other half of the design, and the reason the environment is the answer rather than one
    // answer among several: the cheap displacement move cannot do this at all. Twenty seconds of
    // gusting on every cooldown, from a stance between the heavy and the rim, does not move it.
    const terrain = homeTerrain()
    const deps = {
      ground: terrain,
      worldFloorY: ARCHIPELAGO.worldFloorY,
      spawns: [] as EnemySpawn[],
      patrol: DEFAULT_PATROL_CONFIG,
    }
    const spawn = spawnOn(terrain, 'plate', 'heavy', HEAVY_AT)
    let encounter = startEncounter([spawn], C)
    const stand = PLAYER_AT.clone()
    stand.y = terrain.groundHeightAt(stand.x, stand.z)!
    // Aimed at the heavy, so the cone genuinely holds it.
    const forward = new Vector3(
      spawn.position.x - stand.x, 0, spawn.position.z - stand.z,
    ).normalize()

    let deflected = 0
    let lostAny = 0
    for (let frame = 0; frame < 60 * 20; frame++) {
      const step = stepEncounter(
        encounter,
        {
          ...inputAt(stand),
          playerForward: forward,
          gustPressed: encounter.gustCooldown <= 0,
        },
        1 / 60, C, deps,
      )
      deflected += step.deflectedThisFrame.length
      lostAny += step.lostThisFrame.length
      encounter = step.encounter
    }
    expect(lostAny).toBe(0)
    expect(encounter.enemies[0]!.grounded).toBe(true)
    // The control on the loop: the gusts really did reach it, dozens of times. Without this the
    // two lines above pass for a cone that never held the soldier.
    expect(deflected).toBeGreaterThan(20)
    // And the reason, stated where a reader will look for it.
    expect(deflects(HEAVY, 'gust')).toBe(true)
  })

  it('does put an unarmoured soldier off the same edge with the same gusts', () => {
    // The counterpart control, and the one that proves the loop above is a statement about armour
    // rather than about the geometry: a spear standing exactly where the heavy stood, gusted from
    // exactly the same stance, does leave the world.
    const terrain = homeTerrain()
    const deps = {
      ground: terrain,
      worldFloorY: ARCHIPELAGO.worldFloorY,
      spawns: [] as EnemySpawn[],
      patrol: DEFAULT_PATROL_CONFIG,
    }
    const spawn = spawnOn(terrain, 'leather', 'spear', HEAVY_AT)
    let encounter = startEncounter([spawn], C)
    const stand = PLAYER_AT.clone()
    stand.y = terrain.groundHeightAt(stand.x, stand.z)!
    const forward = new Vector3(
      spawn.position.x - stand.x, 0, spawn.position.z - stand.z,
    ).normalize()

    let lost: string[] = []
    for (let frame = 0; frame < 60 * 20 && lost.length === 0; frame++) {
      const step = stepEncounter(
        encounter,
        { ...inputAt(stand), playerForward: forward, gustPressed: encounter.gustCooldown <= 0 },
        1 / 60, C, deps,
      )
      lost = step.lostThisFrame
      encounter = step.encounter
    }
    expect(lost).toEqual(['leather'])
  })
})
