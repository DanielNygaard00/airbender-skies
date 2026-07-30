import { Vector3 } from 'three'
import type { Level } from '../level'
import type { Biome } from '../island'

const island = (
  id: string, x: number, y: number, z: number, radius: number, height: number,
  biome: Biome, noiseSeed: number,
) => ({ id, position: new Vector3(x, y, z), radius, height, biome, noiseSeed })

/**
 * Eight islands sequenced to teach the flight model:
 *  - home:    large and flat. Learn walking, jumping, deploying the kite.
 *  - ring-*:  below and outward. Reachable by gliding alone, which teaches that
 *             altitude converts to distance.
 *  - climb-*: above home. Need sustained thrust, which introduces breath as a cost.
 *  - rest:    a mid-height waypoint for recovering breath on a long crossing.
 *  - spire:   highest. Needs a dive, a zoom climb, and thrust together.
 */
export const ARCHIPELAGO: Level = {
  id: 'archipelago',
  spawn: { islandId: 'home', offset: new Vector3(0, 6, 0) },
  worldFloorY: -600,
  islands: [
    island('home', 0, 0, 0, 70, 34, 'grass', 1001),
    island('ring-east', 320, -70, 40, 46, 24, 'grass', 1002),
    island('ring-south', -60, -110, 340, 42, 22, 'grass', 1003),
    island('ring-west', -350, -60, -80, 50, 26, 'rock', 1004),
    island('climb-north', 40, 120, -330, 38, 20, 'rock', 1005),
    island('climb-far', 380, 190, -300, 34, 18, 'rock', 1006),
    island('rest', -300, 40, 320, 30, 16, 'grass', 1007),
    island('spire', 60, 420, 60, 26, 44, 'temple', 1008),
  ],
  shrines: [
    { islandId: 'home', offset: new Vector3(20, 0, -14) },
    { islandId: 'ring-east', offset: new Vector3(0, 0, 0) },
    { islandId: 'ring-south', offset: new Vector3(-8, 0, 6) },
    { islandId: 'ring-west', offset: new Vector3(10, 0, 10) },
    { islandId: 'climb-north', offset: new Vector3(0, 0, 0) },
    { islandId: 'climb-far', offset: new Vector3(0, 0, 0) },
    { islandId: 'rest', offset: new Vector3(0, 0, 0) },
    { islandId: 'spire', offset: new Vector3(0, 0, 0) },
  ],
  waterfalls: [
    { islandId: 'home', angle: 2.1, width: 10, length: 90 },
    { islandId: 'home', angle: 4.4, width: 6, length: 70 },
    { islandId: 'ring-east', angle: 0.7, width: 8, length: 80 },
    { islandId: 'ring-south', angle: 3.5, width: 7, length: 75 },
    { islandId: 'ring-west', angle: 5.2, width: 9, length: 85 },
    { islandId: 'rest', angle: 1.2, width: 5, length: 55 },
  ],
}
