import { describe, it, expect } from 'vitest'
import { Vector3, Points } from 'three'
import { createWindTell } from './wind-tell'
import type { WindDef, WindKind } from './wind'

const def = (kind: WindKind): WindDef => ({
  kind, position: new Vector3(10, 100, -20), radius: 40, height: 200, strength: 10,
  axis: new Vector3(0, 0, 1),
})

const KINDS: WindKind[] = ['thermal', 'ridge', 'river', 'downdraft', 'dead']

function motes(tell: ReturnType<typeof createWindTell>): Float32Array {
  const points = tell.object.children[0]
  if (!(points instanceof Points)) throw new Error('expected a Points cloud')
  return points.geometry.attributes.position!.array as Float32Array
}

describe('createWindTell', () => {
  it('gives every wind kind a visible tell', () => {
    // The doc's rule for artists: a wind feature the player cannot see is a bug.
    for (const kind of KINDS) {
      expect(motes(createWindTell(def(kind))).length).toBeGreaterThan(0)
    }
  })

  it('sits on the feature it describes', () => {
    expect(createWindTell(def('thermal')).object.position.toArray()).toEqual([10, 100, -20])
  })

  it('never casts or catches a shadow', () => {
    // Wind is not a surface. A shadow would make it read as landable geometry.
    expect(createWindTell(def('thermal')).object.userData.excludeFromShadows).toBe(true)
  })

  describe('given an open-air test', () => {
    /**
     * A slot running along world Z through the feature's centre: air within 8 units of x = 10,
     * rock beyond it. Chosen to stand in for Canyon Country's corridor, where the field radius of
     * 40 is deliberately far wider than the gap the player can be in.
     */
    const SLOT_HALF_WIDTH = 8
    const slot = (x: number, _y: number, _z: number): boolean =>
      Math.abs(x - 10) <= SLOT_HALF_WIDTH

    /** Motes as world offsets from the feature centre, which is where the group sits. */
    const offsets = (tell: ReturnType<typeof createWindTell>): [number, number, number][] => {
      const data = motes(tell)
      const out: [number, number, number][] = []
      for (let i = 0; i < data.length; i += 3) out.push([data[i]!, data[i + 1]!, data[i + 2]!])
      return out
    }

    it('keeps the motes in the air instead of scattering them into rock', () => {
      // The defect this exists for: with the field radius of 40 in an 8-unit slot, the unclamped
      // scatter puts most of its motes inside the walls. Stated as a comparison against the
      // unclamped tell rather than as an absolute count, so it is the clamp being measured.
      const loose = offsets(createWindTell(def('ridge'))).filter((m) => Math.abs(m[0]) > SLOT_HALF_WIDTH)
      const hugged = offsets(createWindTell(def('ridge'), slot)).filter(
        (m) => Math.abs(m[0]) > SLOT_HALF_WIDTH,
      )
      expect(loose.length).toBeGreaterThan(50)
      expect(hugged.length).toBeLessThan(loose.length / 4)
    })

    it('still reaches along the slot, so the clamp is per direction and not one radius', () => {
      // The reason the probe walks each azimuth separately. A single clamp to the narrow width
      // would keep the motes out of the rock and also cut the feature short along its own length,
      // which for a ridge is the axis the lift runs on — the thing the tell is there to show.
      const hugged = offsets(createWindTell(def('ridge'), slot))
      const alongSlot = Math.max(...hugged.map((m) => Math.abs(m[2])))
      expect(alongSlot).toBeGreaterThan(SLOT_HALF_WIDTH * 2)
    })

    it('draws a small core rather than nothing when the centre itself is walled in', () => {
      // A tell that vanishes is worse than one partly in rock: the player would have no sign the
      // feature is there at all, and the level-authoring mistake would be invisible rather than
      // obvious. `canyon-country.test.ts` is what catches that mistake.
      const walled = offsets(createWindTell(def('ridge'), () => false))
      const spread = Math.max(...walled.map((m) => Math.hypot(m[0], m[2])))
      expect(spread).toBeGreaterThan(0)
    })
  })

  it('keeps its motes inside the feature it marks', () => {
    const tell = createWindTell(def('thermal'))
    for (let i = 0; i < 400; i++) tell.advance(1 / 60)
    const data = motes(tell)
    for (let i = 0; i < data.length; i += 3) {
      expect(Math.abs(data[i + 1]!)).toBeLessThanOrEqual(100.001)
    }
  })

  it('animates thermals upward', () => {
    const tell = createWindTell(def('thermal'))
    const before = motes(tell)[1]!
    tell.advance(0.2)
    expect(motes(tell)[1]!).toBeGreaterThan(before)
  })

  it('animates downdrafts downward', () => {
    const tell = createWindTell(def('downdraft'))
    const before = motes(tell)[1]!
    tell.advance(0.2)
    expect(motes(tell)[1]!).toBeLessThan(before)
  })

  it('barely moves dead air, so it reads as still rather than frozen', () => {
    const dead = createWindTell(def('dead'))
    const thermal = createWindTell(def('thermal'))
    const deadBefore = motes(dead)[1]!
    const thermalBefore = motes(thermal)[1]!
    dead.advance(0.2)
    thermal.advance(0.2)
    const deadMoved = Math.abs(motes(dead)[1]! - deadBefore)
    const thermalMoved = Math.abs(motes(thermal)[1]! - thermalBefore)
    expect(deadMoved).toBeLessThan(thermalMoved)
  })

  it('scatters the same way on every load', () => {
    // Deterministic, like the rest of the world build: Math.random here would make
    // a level look different each time it was opened.
    expect([...motes(createWindTell(def('thermal')))])
      .toEqual([...motes(createWindTell(def('thermal')))])
  })

  it('scatters differently for features in different places', () => {
    const here = createWindTell(def('thermal'))
    const moved = createWindTell({ ...def('thermal'), position: new Vector3(-300, 40, 90) })
    expect([...motes(here)]).not.toEqual([...motes(moved)])
  })
})
