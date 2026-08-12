import { describe, it, expect } from 'vitest'
import { Box3, Vector3 } from 'three'
import {
  buildPayloadMesh, isAtDestination, payloadInReach, placePayloads, REACH_RADIUS,
  type Payload,
} from './payload'
import { COLLECT_RADIUS } from './shrine'
import { ARCHIPELAGO } from './levels/archipelago'
import type { TerrainQuery } from '../core/types'
import type { Level } from './level'

const flat: TerrainQuery = {
  groundHeightAt: () => 10,
  raycast: (from, direction) =>
    direction.y < -0.9 * direction.length()
      ? { point: new Vector3(from.x, 10, from.z), normal: new Vector3(0, 1, 0), islandId: 'x' }
      : null,
}
const empty: TerrainQuery = { groundHeightAt: () => null, raycast: () => null }

const payload = (over: Partial<Payload> = {}): Payload => ({
  id: 'p', position: new Vector3(), origin: new Vector3(),
  destinationIslandId: 'climb-north', carried: false, delivered: false, ...over,
})

describe('placePayloads', () => {
  it('places one payload per level definition', () => {
    expect(placePayloads(ARCHIPELAGO, flat))
      .toHaveLength((ARCHIPELAGO.payloads ?? []).length)
  })

  it('sits the payload on the ground rather than floating it', () => {
    // The shrine's own placement lifts it 1.5 above the surface, so "on the ground" is a
    // real difference from the module it is modelled on rather than a restatement of it.
    expect(placePayloads(ARCHIPELAGO, flat)[0]!.position.y).toBe(10)
  })

  it('offsets from the island centre', () => {
    const def = (ARCHIPELAGO.payloads ?? [])[0]!
    const island = ARCHIPELAGO.islands.find((i) => i.id === def.islandId)!
    const placed = placePayloads(ARCHIPELAGO, flat)[0]!
    expect(placed.position.x).toBeCloseTo(island.position.x + def.offset.x, 6)
    expect(placed.position.z).toBeCloseTo(island.position.z + def.offset.z, 6)
  })

  it('gives origin its own vector rather than sharing position', () => {
    // The respawn path copies origin into position. One vector behind both fields would
    // make that a no-op that looked correct in every other test here.
    const placed = placePayloads(ARCHIPELAGO, flat)[0]!
    placed.position.set(999, 999, 999)
    expect(placed.origin.x).not.toBe(999)
  })

  it('drops a payload with no ground under it', () => {
    expect(placePayloads(ARCHIPELAGO, empty)).toHaveLength(0)
  })

  it('skips a payload on a missing island', () => {
    const level: Level = {
      ...ARCHIPELAGO,
      payloads: [{
        islandId: 'ghost', offset: new Vector3(), destinationIslandId: 'home',
      }],
    }
    expect(placePayloads(level, flat)).toHaveLength(0)
  })

  it('places nothing for a level with no payloads at all', () => {
    expect(placePayloads({ ...ARCHIPELAGO, payloads: undefined }, flat)).toEqual([])
  })
})

describe('payloadInReach', () => {
  const near = payload({ id: 'near', position: new Vector3(REACH_RADIUS - 0.5, 0, 0) })
  const far = payload({ id: 'far', position: new Vector3(REACH_RADIUS + 0.5, 0, 0) })

  it('finds one just inside the radius', () => {
    expect(payloadInReach([near, far], new Vector3())?.id).toBe('near')
  })

  it('refuses one just outside it', () => {
    expect(payloadInReach([far], new Vector3())).toBeNull()
  })

  it('ignores a payload already being carried', () => {
    expect(payloadInReach([{ ...near, carried: true }], new Vector3())).toBeNull()
  })

  it('ignores a delivered payload', () => {
    // The rule that makes delivery mean anything: without it, a delivered bundle could be
    // picked straight back up off its destination.
    expect(payloadInReach([{ ...near, delivered: true }], new Vector3())).toBeNull()
  })

  it('reaches half as far as a shrine collects from', () => {
    // The anchor, pinned rather than described. Every other test in this block is written
    // relative to REACH_RADIUS, so all of them pass at any value — measured, widening it from
    // 3 to 10 reddened nothing at all. This is the one that fails, and it is worth failing:
    // the radius is deliberately tighter than `COLLECT_RADIUS`, which is sized so a shrine can
    // be caught by a glider crossing it at 25 m/s, because a payload is only ever lifted on
    // foot and "stand next to the thing" has to be an act the player performs.
    expect(REACH_RADIUS).toBe(COLLECT_RADIUS / 2)
  })

  it('takes the nearest when two are in reach', () => {
    const closer = payload({ id: 'closer', position: new Vector3(0.5, 0, 0) })
    expect(payloadInReach([near, closer], new Vector3())?.id).toBe('closer')
    expect(payloadInReach([closer, near], new Vector3())?.id).toBe('closer')
  })
})

describe('isAtDestination', () => {
  const island = ARCHIPELAGO.islands.find((i) => i.id === 'climb-north')!

  it('accepts a point inside the destination island footprint', () => {
    expect(isAtDestination(ARCHIPELAGO, payload(), island.position.clone())).toBe(true)
  })

  it('measures horizontally, so height above the island still counts', () => {
    // Not a licence to deliver from the air — `carryStep` requires standing on ground — but
    // it is why this function does not need to know the island's surface height.
    const above = island.position.clone().setY(island.position.y + 500)
    expect(isAtDestination(ARCHIPELAGO, payload(), above)).toBe(true)
  })

  it('refuses a point outside the footprint', () => {
    const outside = island.position.clone()
    outside.x += island.radius + 1
    expect(isAtDestination(ARCHIPELAGO, payload(), outside)).toBe(false)
  })

  it('refuses the island the payload started on', () => {
    const home = ARCHIPELAGO.islands.find((i) => i.id === 'home')!
    expect(isAtDestination(ARCHIPELAGO, payload(), home.position.clone())).toBe(false)
  })

  it('refuses everywhere when the destination island is unknown', () => {
    expect(isAtDestination(
      ARCHIPELAGO, payload({ destinationIslandId: 'ghost' }), new Vector3(),
    )).toBe(false)
  })
})

describe('buildPayloadMesh', () => {
  it('stands on its own origin, so a placed position is where it sits', () => {
    const box = new Box3().setFromObject(buildPayloadMesh())
    expect(box.min.y).toBeCloseTo(0, 2)
  })

  it('reads as a carried bundle rather than a landmark', () => {
    // Under a metre in every direction, against the character's 1.8. A payload the size of
    // a boulder would be a silhouette problem long before it was a gameplay one.
    const box = new Box3().setFromObject(buildPayloadMesh())
    const size = box.getSize(new Vector3())
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(1)
    expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.3)
  })

  it('merges to one geometry carrying its own colours', () => {
    // One draw call and vertex colours, the way props.ts builds its own scatter — the
    // material below has `vertexColors` on, so a merge that lost the attribute would render
    // the bundle black rather than failing.
    const mesh = buildPayloadMesh()
    expect(mesh.geometry.getAttribute('color')).toBeDefined()
    expect(Array.isArray(mesh.material)).toBe(false)
  })
})

describe('the archipelago route', () => {
  const def = (ARCHIPELAGO.payloads ?? [])[0]!

  it('runs from the home plateau to the first thrust island', () => {
    expect(ARCHIPELAGO.payloads).toHaveLength(1)
    expect(def.islandId).toBe('home')
    expect(def.destinationIslandId).toBe('climb-north')
  })

  it('puts the destination above the source, so gliding alone cannot reach it', () => {
    // The whole point of the placement. A glider trades altitude for distance and never the
    // reverse without thrust or lift, so a destination above the source is what makes the
    // payload's degraded climb the subject of the route instead of an inconvenience on it.
    const source = ARCHIPELAGO.islands.find((i) => i.id === def.islandId)!
    const destination = ARCHIPELAGO.islands.find((i) => i.id === def.destinationIslandId)!
    expect(destination.position.y).toBeGreaterThan(source.position.y + 50)
  })

  it('keeps the bundle clear of the shrine and of the patrol on that island', () => {
    // Both are placed by other systems that know nothing about this one, so the clearance is
    // asserted rather than eyeballed: a bundle inside the shrine's collect radius would be
    // picked up in the same walk, and one among the spears would make the first payload
    // pick-up a fight.
    const shrine = ARCHIPELAGO.shrines.find((s) => s.islandId === def.islandId)!
    expect(Math.hypot(shrine.offset.x - def.offset.x, shrine.offset.z - def.offset.z))
      .toBeGreaterThan(20)
    // The patrol holds +x / -z on home; the bundle is on the far side of the plateau.
    expect(def.offset.x).toBeLessThan(0)
  })

  it('leaves lift on the route at both ends', () => {
    // The route is only flyable loaded because thermals cover the climb — measured, thrust
    // alone runs the bar dry short of it. Those two thermals predate the payload and belong
    // to nothing else that would notice their loss, so this is the guard that stops a wind
    // retune quietly making the payload undeliverable.
    const near = (id: string) => {
      const island = ARCHIPELAGO.islands.find((i) => i.id === id)!
      return (ARCHIPELAGO.winds ?? []).some((w) => w.kind === 'thermal'
        && Math.hypot(w.position.x - island.position.x, w.position.z - island.position.z)
          <= w.radius)
    }
    expect(near('home')).toBe(true)
    expect(near('climb-north')).toBe(true)
  })
})
