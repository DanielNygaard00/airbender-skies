import {
  BoxGeometry, IcosahedronGeometry, Mesh, MeshLambertMaterial, Vector3,
  type BufferGeometry,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { TerrainQuery } from '../core/types'
import type { IslandDef } from './island'
import type { Level } from './level'
import { colored } from './props'

/**
 * The thing on the glider, and where it is in the world.
 *
 * Modelled the way `Shrine` is — a plain record placed once from the level and replaced
 * rather than mutated — and for the same reason: the rules that move it are pure functions
 * in `src/player/payload.ts`, and a record is what those can be tested against.
 *
 * Note what is *not* here: whether the player is carrying it is not a field on `Payload`, and
 * it is not a field on `PlayerState` either. It is one `carriedId` in `main.ts`, beside
 * `shrines`, for the reason `shrine-collect.ts` gives about the shrine ceiling: state that
 * `respawn()` would silently carry across a death is worse than state a call site has to
 * remember. Carrying is exactly that kind of state, so it is deliberately somewhere
 * `respawn()` cannot reach, and the two respawn paths return it home explicitly. See
 * `returnCarriedHome`.
 */
export interface Payload {
  id: string
  /**
   * Where it sits in the world. Not updated while it is being carried — the mesh follows the
   * avatar then, and this holds the last place it stood so nothing has to guess.
   */
  position: Vector3
  /** Where the level put it. Every respawn puts it back here. */
  origin: Vector3
  destinationIslandId: string
  carried: boolean
  /** Set down on its destination island. A delivered payload cannot be lifted again. */
  delivered: boolean
}

/**
 * How close the player must stand to lift a payload.
 *
 * Half of the shrine's `COLLECT_RADIUS` 6, and the halving is the argument. That radius is
 * generous because a shrine is collected in passing — it has to be catchable by a glider
 * crossing it at 25 m/s, so it is sized for a fly-through. A payload is only ever lifted on
 * foot, where `walkSpeed` is 7, so 3 units is still most of a second of walking either side
 * of the exact spot. Sizing it like a shrine would instead mean a player who lands beside it
 * is already in range without having walked to it, and then "stand next to the thing" stops
 * being an act the player performs.
 */
export const REACH_RADIUS = 3

/**
 * How far above the surface the payload's own origin sits.
 *
 * Zero, unlike the shrine's `HOVER_HEIGHT` of 1.5: a shrine is a floating spirit-light and a
 * payload is a bundle someone put down, so its base is built at the mesh origin below and the
 * ground height is used unmodified. Named rather than left implicit because "the payload sits
 * on the floor" is a decision about what it is, and a future levitating objective would
 * change this line rather than discover the assumption.
 */
const GROUND_OFFSET = 0

/** Place each payload on its island's surface, dropping any that misses the ground. */
export function placePayloads(level: Level, terrain: TerrainQuery): Payload[] {
  const payloads: Payload[] = []
  for (const def of level.payloads ?? []) {
    const island = level.islands.find((i) => i.id === def.islandId)
    if (!island) continue
    const x = island.position.x + def.offset.x
    const z = island.position.z + def.offset.z
    const groundY = terrain.groundHeightAt(x, z)
    // No ground under it means nobody could ever walk up to it, so drop it — the same
    // ruling `placeShrines` makes about an unreachable shrine.
    if (groundY === null) continue
    const position = new Vector3(x, groundY + GROUND_OFFSET, z)
    payloads.push({
      id: def.islandId,
      position,
      // Cloned rather than shared: `returnCarriedHome` copies from `origin` into
      // `position`, and one vector behind both fields would make that a no-op that
      // looked right.
      origin: position.clone(),
      destinationIslandId: def.destinationIslandId,
      carried: false,
      delivered: false,
    })
  }
  return payloads
}

/**
 * The payload the player could lift right now, or null.
 *
 * Nearest first, though with one payload in the archipelago that is a rule for later rather
 * than one that fires today. Carried and delivered payloads are excluded here rather than at
 * the call site, so a caller cannot ask a question that produces a second answer.
 */
export function payloadInReach(
  payloads: readonly Payload[], position: Vector3,
): Payload | null {
  let best: Payload | null = null
  let bestDistance = Infinity
  for (const payload of payloads) {
    if (payload.carried || payload.delivered) continue
    const distance = payload.position.distanceTo(position)
    if (distance <= REACH_RADIUS && distance < bestDistance) {
      best = payload
      bestDistance = distance
    }
  }
  return best
}

/**
 * Whether `position` is over the payload's destination island.
 *
 * Measured horizontally against the island's own radius, not against a delivery pad of its
 * own: the destination is "get it to that island", and an island already has a footprint the
 * level author tuned. A separate radius here would be a second number that could disagree
 * with the shape the player can see.
 *
 * Height is deliberately not checked. The islands are floating rock with overhangs, so a
 * point inside the footprint but far below it is possible in principle — but the only way to
 * set a payload down is to be standing on ground (see `carryStep`), and standing on ground
 * inside `climb-north`'s footprint means standing on `climb-north`.
 */
export function isAtDestination(
  level: Level, payload: Payload, position: Vector3,
): boolean {
  const island: IslandDef | undefined =
    level.islands.find((i) => i.id === payload.destinationIslandId)
  if (!island) return false
  return Math.hypot(island.position.x - position.x, island.position.z - position.z)
    <= island.radius
}

/** Pale wrapped cloth, and the staff's own brown for the lashings that hold it shut. */
const CLOTH = 0xe8dcc0
const LASHING = 0x6b4a2f

/**
 * How tall the bundle stands. Roughly a third of the character's 1.8, which is the size a
 * thing has to be to read as carried rather than as dragged.
 */
const BUNDLE_HEIGHT = 0.62

/**
 * Build the payload's mesh.
 *
 * **This is placeholder geometry standing in for a companion model.** There is no companion
 * asset in `ASSETS.md` and this work deliberately does not add one, so what the player sees
 * is a wrapped bundle assembled from an icosahedron and two boxes — the same primitives, the
 * same `colored` helper and the same single-merged-mesh approach `props.ts` uses for trees and
 * boulders. When a companion model arrives, this function is the only thing that has to go:
 * everything else in the payload system deals in a `Payload` record and an `Object3D`.
 *
 * Built with its base at y = 0 so the returned object's position is where it stands, matching
 * `GROUND_OFFSET` above and the island meshes' own convention.
 */
export function buildPayloadMesh(): Mesh {
  const parts: BufferGeometry[] = []

  // The bundle itself: a squashed icosahedron, flat-shaded like the boulders, so it reads as
  // cloth folded over something rather than as a sphere.
  const body = colored(new IcosahedronGeometry(BUNDLE_HEIGHT * 0.5, 0), CLOTH)
  body.scale(1, 0.9, 0.85)
  body.translate(0, BUNDLE_HEIGHT * 0.5, 0)
  parts.push(body)

  // Two straps at right angles, standing a little proud of the cloth so they catch the light
  // separately from it. This is the whole of the silhouette's readability at distance: a
  // pale blob alone would read as a rock.
  for (const rotated of [false, true]) {
    const strap = colored(new BoxGeometry(BUNDLE_HEIGHT * 0.92, 0.07, 0.12), LASHING)
    if (rotated) strap.rotateY(Math.PI / 2)
    strap.translate(0, BUNDLE_HEIGHT * 0.52, 0)
    parts.push(strap)
  }

  const geometry = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  if (!geometry) {
    // mergeGeometries returns null only for mismatched attribute sets, which cannot happen
    // for a fixed list built two lines up — but the type says it can, and a thrown error
    // beats a silently invisible objective.
    throw new Error('payload geometry failed to merge')
  }
  // Seated on y = 0 by measurement rather than by construction. Translating the body down by
  // its own radius looks right and is not: a detail-0 icosahedron has no vertex at its south
  // pole, so its lowest point sits at 0.851 of the radius and the bundle floated 7 cm above
  // the ground -- visible on a flat plateau, and pinned by `payload.test.ts` now. Reading the
  // merged box covers the straps too, which stand proud of the cloth.
  geometry.computeBoundingBox()
  const lowest = geometry.boundingBox?.min.y ?? 0
  geometry.translate(0, -lowest, 0)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }))
}
