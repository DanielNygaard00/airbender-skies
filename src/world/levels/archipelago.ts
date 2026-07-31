import { Vector3 } from 'three'
import type { Level } from '../level'
import type { Biome } from '../island'
import type { WindDef } from '../wind'

const thermal = (x: number, y: number, z: number, radius: number, height: number,
  strength: number): WindDef => ({
  kind: 'thermal', position: new Vector3(x, y, z), radius, height, strength,
})

const island = (
  id: string, x: number, y: number, z: number, radius: number, height: number,
  biome: Biome, noiseSeed: number,
) => ({ id, position: new Vector3(x, y, z), radius, height, biome, noiseSeed })

/**
 * Thirteen islands sequenced to teach the flight model:
 *  - home:    large and flat. Learn walking, jumping, deploying the glider.
 *  - ring-*:  below and outward. Reachable by gliding alone, which teaches that
 *             altitude converts to distance.
 *  - climb-*: above home. Need sustained thrust, which introduces breath as a cost.
 *  - rest:    a mid-height waypoint for recovering breath on a long crossing.
 *  - spire:   highest. Needs a dive, a zoom climb, and thrust together.
 *
 * Then a second arc that teaches hovering. A glider can only trade altitude for
 * distance, so every target above is big enough to be reached at speed. These are
 * not: they are small enough that arriving fast means overshooting, which is what
 * makes stopping in mid-air the answer rather than a luxury.
 *  - perch-east: a first tiny target, close in and slightly below home, so the
 *                lesson costs a short glide rather than a long one to retry.
 *  - gate-*:     two stumps 60 apart at the same height. Too close together to
 *                pick one at cruise speed; hover between them and choose.
 *  - needle:     small and high. Reaching it needs thrust, landing on it needs the
 *                hover, so it is the first place both abilities are required.
 *  - beacon:     directly above the spire and smaller again. The full sequence:
 *                dive, zoom, thrust up the last stretch, then stop dead to land.
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
    // The hover arc. Radii here are a fraction of the islands above: 14 down to 11,
    // against home's 70.
    island('perch-east', 170, -20, 20, 14, 12, 'rock', 1009),
    island('gate-north', -140, 60, 180, 18, 14, 'rock', 1010),
    island('gate-south', -140, 60, 240, 18, 14, 'rock', 1011),
    island('needle', 150, 240, -160, 12, 30, 'rock', 1012),
    // Stacked directly over the spire. Allowed because the 140 vertical gap clears
    // the (44 + 12) * 2 the overlap rule requires of islands sharing a footprint.
    island('beacon', 60, 560, 60, 11, 12, 'temple', 1013),
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
    // Centred on the hover islands: they are too small for a meaningful offset, and
    // the reward for landing on one belongs where the player actually touches down.
    { islandId: 'perch-east', offset: new Vector3(0, 0, 0) },
    { islandId: 'gate-north', offset: new Vector3(0, 0, 0) },
    { islandId: 'gate-south', offset: new Vector3(0, 0, 0) },
    { islandId: 'needle', offset: new Vector3(0, 0, 0) },
    { islandId: 'beacon', offset: new Vector3(0, 0, 0) },
  ],
  /**
   * The air as terrain. Placed so that every one of them serves a route the player
   * already wants: lift where the climb is otherwise expensive, a conveyor along
   * the longest crossing, and dead air where the game wants a fight kept low.
   *
   * The artist rule from the design doc applies — a wind feature the player cannot
   * see is a bug — so each of these gets a visible tell in the world build.
   */
  winds: [
    // Over home, so the very first climb can be made for free once the player
    // notices the dust spiralling up off the plateau.
    thermal(0, 120, 0, 55, 240, 9),
    // Under the two climb islands, which previously cost breath to reach at all.
    thermal(40, 150, -330, 45, 260, 11),
    thermal(380, 200, -300, 40, 240, 11),
    // A column up the spire, so the highest island rewards reading the air rather
    // than holding thrust.
    thermal(60, 320, 60, 38, 420, 13),
    // Ridge lift along the west island's cliff face: free height for anyone who
    // flies the wall instead of at it.
    {
      kind: 'ridge', position: new Vector3(-350, 20, -80), radius: 90, height: 160,
      strength: 8, axis: new Vector3(0, 0, 1),
    },
    // The long south-west crossing is the emptiest stretch on the map, so it gets
    // the conveyor.
    {
      kind: 'river', position: new Vector3(-180, 60, 240), radius: 70, height: 150,
      strength: 26, axis: new Vector3(-0.6, 0, 0.8).normalize(),
    },
    // A downdraft as a soft boundary past the east rim: it pushes you home rather
    // than walling you in.
    {
      kind: 'downdraft', position: new Vector3(520, 40, 120), radius: 110, height: 320,
      strength: 10,
    },
    // Dead air in the low gap between the ring islands. No lift at all, so crossing
    // the bottom of the map is breath-only flying.
    {
      kind: 'dead', position: new Vector3(-60, -150, 340), radius: 80, height: 200,
      strength: 0,
    },
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
