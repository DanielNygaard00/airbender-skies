import { Vector3 } from 'three'
import type { Level } from '../level'
import type { IslandDef } from '../island'
import type { WindDef } from '../wind'

/**
 * Canyon Country: the region the wall ride was written for.
 *
 * §3.3 of the design document asks for "narrow, twisting, low ceiling. Ridge lift on every
 * wall, dead air at the bottom. Rewards precision over altitude." The archipelago rewards
 * altitude — it is thirteen round islands in open sky, and `wall-ride-geometry.test.ts`
 * measured what that leaves the scooter: 0.25% of sampled (position, bearing) pairs put a
 * near-vertical face within lateral reach, the median ridable band is 0.25 m, and the tallest
 * wall on the whole map is 6.00 m. This region exists to answer that measurement, so its shape
 * follows from the one geometric fact that governs it.
 *
 * **Where the vertical rock actually is.** An island is a noise-displaced sphere flattened to
 * 0.35 above its equator and stretched to 1.9 below it, so the crown is a dome and the
 * underside is a spike. Measured on real meshes (see the design note): the spike's flank is the
 * only genuinely vertical surface the generator makes. A radius-16, height-34 island holds
 * within 14.5 degrees of vertical for 70 m of unbroken run down its spike, against about 2 m
 * on the dome above it. The archipelago cannot use any of that, because a spike hangs in
 * mid-air below an island's rim and a rider on his feet cannot get to it.
 *
 * So the canyon is built from **hoodoos**: islands lifted until their spikes stand above the
 * floor as walls, with the tapering root buried in the slab below. Each hoodoo shows the top of
 * its spike as a near-vertical trunk that widens slightly with height, then a small dome cap to
 * stand on. A row of overlapping hoodoos is a fluted wall; two rows facing each other across a
 * slab of floor is a slot canyon.
 *
 * **Why the walls are thin.** A spike widens as it rises, so a rider at its foot stands under
 * an overhang: `groundHeightAt` answers with the flank above him rather than with the floor,
 * the position is thrown out as unstandable, and the wall beside it is never counted or ridden.
 * The flare over an exposed run `d`, for horizontal radius `R` and vertical semi-axis
 * `a = 1.9 * height`, is about `R * d² / (2 * a²)`, and it has to stay under
 * `GroundConfig.snapDistance` of 1.2 m or the wall leans out of reach as it rises. That bounds
 * exposure at roughly `a * sqrt(2.4 / R)`, which is why these are radius-11 needles on tall
 * spikes rather than radius-30 buttes: at radius 11 a height-64 island can show 56 m of wall,
 * where a radius-30 island on the same spike runs out of reach after 34 m. Every exposure
 * below sits inside that bound with margin for the noise.
 *
 * **Precision over altitude, concretely.** The corridor runs about 14 m between wall faces
 * against `home`'s 140 m of open plateau, it turns 110 degrees over 215 m so that nothing past
 * the first bend is visible from the mouth, and the air is ridge lift on the walls with dead air
 * on the floor. No thermals: the archipelago's four are how it teaches free height, and
 * withholding them is most of what makes this region about precision. A player who climbs out
 * of the slot finds a downdraft lid and no lift above it. The way through is the walls.
 */

/** The corridor floor, nominal. Slabs sit at y = 0 and their crowns land near here. */
const FLOOR = 12

/** A canyon floor slab: wide, shallow, and deep enough to bury the hoodoo roots planted in it. */
const slab = (
  id: string, x: number, z: number, radius: number, height: number, noiseSeed: number,
): IslandDef => ({
  id, position: new Vector3(x, 0, z), radius, height, biome: 'rock', noiseSeed,
})

/**
 * A hoodoo: an island raised so that `exposure` metres of its spike flank stand above the floor
 * as wall, with the rest of the spike inside the slab it grows out of.
 *
 * `exposure` is therefore the wall's height, and the cap the rider lands on sits roughly
 * `0.35 * height` above that.
 */
const hoodoo = (
  id: string, x: number, z: number, radius: number, height: number, exposure: number,
  noiseSeed: number,
): IslandDef => ({
  id, position: new Vector3(x, FLOOR + exposure, z), radius, height, biome: 'rock', noiseSeed,
})

interface Room {
  id: string
  x: number
  z: number
}

/**
 * The six rooms, in the order the player walks them. Slab positions and the corridor centreline
 * are the same list, because in a canyon the floor *is* the route.
 *
 * The spacing is what makes the walls possible rather than what makes the rooms: a hoodoo at
 * `WALL_OFFSET` from the centreline needs floor under it, so it has to sit inside some slab's
 * footprint, which for a radius-30 slab and a 19 m offset means within about 22 m of that
 * slab's centre along the corridor. Rooms 44 m apart therefore give continuous wall coverage
 * with nothing to spare, and that — not a room count chosen for its own sake — is why there are
 * six.
 *
 * The headings run 0, 33, 57, 79 and 110 degrees off +Z, so the corridor turns steadily right.
 * +Z is `forward`, so the spawn faces into the canyon and the mouth is the only room with a
 * sightline out of it.
 */
const MOUTH: Room = { id: 'canyon-mouth', x: 0, z: -62 }
const NARROWS: Room = { id: 'canyon-narrows', x: 0, z: -18 }
const BEND: Room = { id: 'canyon-bend', x: 22, z: 16 }
const ELBOW: Room = { id: 'canyon-elbow', x: 56, z: 38 }
const GORGE: Room = { id: 'canyon-gorge', x: 98, z: 46 }
const AMPHITHEATRE: Room = { id: 'canyon-amphitheatre', x: 142, z: 30 }

export const CANYON_ROOMS = [MOUTH, NARROWS, BEND, ELBOW, GORGE, AMPHITHEATRE] as const

const SLABS: IslandDef[] = [
  // Overlapping footprints, by 20 m of nominal radius at each join. Two tangent slabs would
  // leave a notch wherever the noise pulled both rims inward, and a notch in a canyon floor is
  // a hole the player falls through. `findOverlappingIslands` flags these joins and
  // `canyon-country.test.ts` pins the exact set, because here they are the level rather than a
  // smell — see that test for the rule this region respects instead.
  slab(MOUTH.id, MOUTH.x, MOUTH.z, 34, 40, 2101),
  slab(NARROWS.id, NARROWS.x, NARROWS.z, 30, 40, 2102),
  slab(BEND.id, BEND.x, BEND.z, 30, 40, 2103),
  slab(ELBOW.id, ELBOW.x, ELBOW.z, 30, 42, 2104),
  slab(GORGE.id, GORGE.x, GORGE.z, 30, 44, 2105),
  slab(AMPHITHEATRE.id, AMPHITHEATRE.x, AMPHITHEATRE.z, 40, 52, 2106),
]

/** Unit heading from one room to the next, flat. */
function heading(from: Room, to: Room): Vector3 {
  return new Vector3(to.x - from.x, 0, to.z - from.z).normalize()
}

/** The left-hand side of a heading, so a wall can be asked for by side rather than by sign. */
function leftOf(direction: Vector3): Vector3 {
  return new Vector3(-direction.z, 0, direction.x)
}

/**
 * How far a wall's hoodoo centres sit from the centreline. Faces land about 10 m inside that,
 * so the corridor is roughly 14 m of floor between rock, wandering by a few metres either way
 * as the noise flutes each trunk.
 */
const WALL_OFFSET = 19

interface WallSpec {
  from: Room
  to: Room
  /** 1 is the left of the heading, -1 the right. */
  side: 1 | -1
  /** Fractions along the segment, one hoodoo each. Spaced under two radii so the row fuses. */
  at: readonly number[]
  radius: number
  height: number
  exposure: number
  seed: number
  /** Pushed further out than `WALL_OFFSET` where a wall rings a chamber rather than lines it. */
  offset?: number
}

/** One row of hoodoos along one side of one corridor segment. */
function wall(id: string, spec: WallSpec): IslandDef[] {
  const direction = heading(spec.from, spec.to)
  const normal = leftOf(direction).multiplyScalar(spec.side)
  const length = Math.hypot(spec.to.x - spec.from.x, spec.to.z - spec.from.z)
  const offset = spec.offset ?? WALL_OFFSET
  return spec.at.map((t, i) => {
    const x = spec.from.x + direction.x * length * t + normal.x * offset
    const z = spec.from.z + direction.z * length * t + normal.z * offset
    return hoodoo(`${id}-${i + 1}`, x, z, spec.radius, spec.height, spec.exposure, spec.seed + i)
  })
}

/**
 * The walls, in teaching order. Each row is one lesson, and every lesson is about the ride
 * rather than about flight, because a canyon is the one place where the scooter is the better
 * answer.
 *
 * 1. `mouth-wall` — one wall, west side only, with the east side of the mouth left open. The
 *    first wall a player meets is therefore silhouetted against open sky from outside the
 *    canyon, and at 16 m it is well inside the 24 m of climb a full accumulator pays for: the
 *    first ride is meant to succeed.
 * 2. `narrows-west` / `narrows-east` — both sides, 24 m, the corridor at its tightest. Two
 *    walls close enough to ride alternately is the "rhythm game underneath the platforming"
 *    §2.1 describes, and this is the only room where the player can be on either wall at any
 *    moment.
 * 3. `bend-outer` / `bend-inner` — 32 m on the outside of the turn against 20 m on the inside.
 *    Riding the outer wall holds the line through the corner; cutting the inside gives up the
 *    height and the corner both.
 * 4. `elbow-step`, `elbow-mid`, `elbow-tall` — 20, 32 and 44 m of exposure, rising in the
 *    direction of travel so the wall grows as the player advances and §3.4's "verticality is
 *    legible from below" has something to be legible about. This is the room where the rock
 *    outlasts the move: measured through the real mover on this mesh, one full accumulator
 *    driven in at 26 m/s lifts a rider a median 19 m and a best 28 m, so 44 m of wall cannot be
 *    topped by riding at all. What the ride buys here is the height to leave the dead air and
 *    reach the ridge lift, which is the region's central route and the reason the two features
 *    are placed against each other rather than in separate rooms.
 * 5. `gorge-north` / `gorge-south` — 36 m both sides on the straightest run, which is where the
 *    accumulator has room to build between rides rather than being spent on the geometry.
 * 6. `amphitheatre-ring` and `amphitheatre-crown` — 40 m walls around the end chamber and a
 *    48 m one holding the region's last shrine. Dead air fills the chamber, so flying up to it
 *    spends breath the whole way where riding up spends one accumulator.
 */
const WALLS: IslandDef[] = [
  ...wall('canyon-mouth-wall', {
    from: MOUTH, to: NARROWS, side: 1, at: [0.18, 0.55], radius: 11, height: 30,
    exposure: 16, seed: 2201,
  }),
  ...wall('canyon-narrows-west', {
    from: MOUTH, to: NARROWS, side: 1, at: [0.86, 1.14], radius: 11, height: 40,
    exposure: 24, seed: 2211,
  }),
  ...wall('canyon-narrows-east', {
    from: MOUTH, to: NARROWS, side: -1, at: [0.58, 0.86, 1.14], radius: 11, height: 40,
    exposure: 24, seed: 2221,
  }),
  ...wall('canyon-bend-outer', {
    from: NARROWS, to: BEND, side: 1, at: [0.5, 0.78, 1.06], radius: 11, height: 52,
    exposure: 32, seed: 2231,
  }),
  ...wall('canyon-bend-inner', {
    from: NARROWS, to: BEND, side: -1, at: [0.62, 0.95], radius: 11, height: 34,
    exposure: 20, seed: 2241,
  }),
  ...wall('canyon-elbow-step', {
    from: BEND, to: ELBOW, side: 1, at: [0.55], radius: 11, height: 34,
    exposure: 20, seed: 2251,
  }),
  ...wall('canyon-elbow-mid', {
    from: BEND, to: ELBOW, side: 1, at: [0.78], radius: 11, height: 52,
    exposure: 32, seed: 2256,
  }),
  ...wall('canyon-elbow-tall', {
    from: BEND, to: ELBOW, side: 1, at: [1.0, 1.28], radius: 11, height: 64,
    exposure: 44, seed: 2261,
  }),
  ...wall('canyon-elbow-south', {
    from: BEND, to: ELBOW, side: -1, at: [0.7, 1.02], radius: 11, height: 44,
    exposure: 26, seed: 2271,
  }),
  ...wall('canyon-gorge-north', {
    from: ELBOW, to: GORGE, side: 1, at: [0.6, 0.9], radius: 11, height: 56,
    exposure: 36, seed: 2281,
  }),
  ...wall('canyon-gorge-south', {
    from: ELBOW, to: GORGE, side: -1, at: [0.6, 0.9], radius: 11, height: 56,
    exposure: 36, seed: 2291,
  }),
  ...wall('canyon-amphitheatre-ring', {
    from: GORGE, to: AMPHITHEATRE, side: 1, at: [0.82, 1.06], radius: 11, height: 60,
    exposure: 40, seed: 2301, offset: 25,
  }),
  ...wall('canyon-amphitheatre-crown', {
    from: GORGE, to: AMPHITHEATRE, side: -1, at: [0.94], radius: 11, height: 68,
    exposure: 48, seed: 2311, offset: 25,
  }),
]

/**
 * The air. Ridge lift on the walls, dead air on the floor, and a downdraft lid over the rim:
 * §3.3's two features plus the one §3.2 nominates as a soft boundary, which is what a "low
 * ceiling" has to be made of here — real rock overhead would be worse than nothing, because an
 * island has no collidable underside and a player who thrusts into a roof passes through it.
 *
 * Each room gets one ridge column and one dead-air volume rather than one per wall face. The
 * corridor is 14 m across and every feature fades to nothing at its rim, so a pair of columns
 * hugging opposite faces would overlap over the centreline anyway, and the honest reading of a
 * slot canyon is that the whole slot lifts. What that buys is the tell: the motes fill the slot
 * where the player can see them instead of hanging inside the rock, and the ridge's axis — the
 * corridor's own heading — is legible in the room the lift belongs to.
 */
function ridge(room: Room, from: Room, to: Room, radius: number, wallHeight: number): WindDef {
  return {
    kind: 'ridge',
    // Centred a little above mid-wall, so the column runs from the floor to somewhat over the
    // cap line and the lift a rider feels grows as he climbs.
    position: new Vector3(room.x, FLOOR + wallHeight * 0.55, room.z),
    radius,
    height: wallHeight * 1.6,
    strength: 9,
    axis: heading(from, to),
  }
}

/**
 * Dead air over the corridor floor: the bottom of the canyon gives the wing nothing.
 *
 * Spans 8 to 30, which is a measurement rather than a round number. `FLOOR` is where a slab's
 * crown lands at its centre, but a crown is a dome, so the walkable floor beside a wall — 19 m
 * off the centreline — sits several metres lower, and the walked centreline itself runs between
 * 8 and 16. A column centred on `FLOOR + 11` with the same height left live air under itself all
 * along the wall bases, which is the opposite of the intent. Centred on `FLOOR + 7` the strongest
 * dead air is 7 m over the middle of the corridor and the layer covers everything a glider can
 * be doing near the floor.
 *
 * It overlaps the bottom of each ridge column on purpose. `sampleWind` lets dead air clamp
 * `liftScale` while a ridge still contributes acceleration, so low in the slot the wing is dead
 * and the ridge is weak (its influence fades toward its own rim), and both recover together as
 * the player climbs the wall. That is the §3.3 sentence — ridge lift on the walls, dead air at
 * the bottom — expressed as one continuous gradient rather than as two switches. And it is what
 * makes the ride the route: a full accumulator from the floor climbs a median 19 m, which is
 * most of the way out of a 22 m layer.
 */
function dead(room: Room, radius: number): WindDef {
  return {
    kind: 'dead', position: new Vector3(room.x, FLOOR + 5, room.z), radius, height: 34,
    strength: 0,
  }
}

const WINDS: WindDef[] = [
  ridge(MOUTH, MOUTH, NARROWS, 30, 16),
  ridge(NARROWS, MOUTH, NARROWS, 22, 24),
  ridge(BEND, NARROWS, BEND, 22, 32),
  ridge(ELBOW, BEND, ELBOW, 22, 44),
  ridge(GORGE, ELBOW, GORGE, 22, 36),
  ridge(AMPHITHEATRE, GORGE, AMPHITHEATRE, 36, 48),
  dead(MOUTH, 30),
  dead(NARROWS, 22),
  dead(BEND, 22),
  dead(ELBOW, 22),
  dead(GORGE, 22),
  dead(AMPHITHEATRE, 36),
  // The lid. Two columns rather than one, because a single column wide enough to cover a
  // corridor that turns 110 degrees would also cover the ground either side of it, and a
  // downdraft over the walls would push a rider off a cap he had just earned. Both sit clear
  // above the tallest cap in their half of the region, so the lid is something the player
  // climbs into rather than something that reaches down into the slot.
  {
    kind: 'downdraft', position: new Vector3(8, FLOOR + 96, -22), radius: 62, height: 70,
    strength: 8,
  },
  {
    kind: 'downdraft', position: new Vector3(104, FLOOR + 120, 40), radius: 66, height: 70,
    strength: 8,
  },
]

/**
 * Canyon Country as a level.
 *
 * A second `Level` rather than an extension of `ARCHIPELAGO`: the two share no geometry, want
 * opposite air, and §3.1 describes regions as stacked and joined at altitude rather than
 * interleaved. There is no region-switching flow — `levels/index.ts` picks one at startup and
 * `main.ts` reads that. Building a selection screen for two regions would be building the
 * screen before there is anything to choose between.
 */
export const CANYON_COUNTRY: Level = {
  id: 'canyon-country',
  // On the mouth slab, the only room with a sightline out of the canyon. Six above the surface
  // matches the archipelago's spawn clearance; `spawnPointFor` resolves the rest from the mesh.
  spawn: { islandId: MOUTH.id, offset: new Vector3(0, 6, 0) },
  // The deepest geometry is the amphitheatre slab at height 52, which reaches
  // 52 * MAX_DEPTH_MULTIPLIER = 140 below y = 0. Falling out of a canyon means falling past its
  // floor, so the margin here is generous rather than tight.
  worldFloorY: -400,
  islands: [...SLABS, ...WALLS],
  /**
   * Shrines mark the beats of the teaching sequence, and all but the first sit on a hoodoo cap
   * — which is to say, on top of a wall.
   *
   * A shrine's id is its island's id (`placeShrines`) and the save persists that list, so every
   * island here is prefixed `canyon-` and cannot collide with an archipelago id;
   * `canyon-country.test.ts` pins that across both regions.
   *
   * Six rather than the archipelago's thirteen. Most islands here are wall segments rather than
   * destinations, a shrine on every cap would turn a wall into a checklist, and the breath
   * ceiling the shrines raise is shared between both regions through one save file.
   */
  shrines: [
    { islandId: MOUTH.id, offset: new Vector3(0, 0, 0) },
    { islandId: 'canyon-mouth-wall-2', offset: new Vector3(0, 0, 0) },
    { islandId: 'canyon-narrows-east-2', offset: new Vector3(0, 0, 0) },
    { islandId: 'canyon-bend-outer-2', offset: new Vector3(0, 0, 0) },
    { islandId: 'canyon-elbow-tall-1', offset: new Vector3(0, 0, 0) },
    { islandId: 'canyon-amphitheatre-crown-1', offset: new Vector3(0, 0, 0) },
  ],
  winds: WINDS,
  // Dry. A waterfall needs a rim with sky under it and every rim here has canyon under it;
  // §3.3's canyon is a place of stone and dead air, and the archipelago is where the water is.
  waterfalls: [],
}

/** Exported for the tests, which need the centreline and the two classes of island apart. */
export const CANYON_FLOOR_Y = FLOOR
export const CANYON_SLAB_IDS: readonly string[] = SLABS.map((s) => s.id)
export const CANYON_WALL_IDS: readonly string[] = WALLS.map((w) => w.id)
