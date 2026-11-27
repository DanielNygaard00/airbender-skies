import { describe, it, expect } from 'vitest'
import { Mesh, MeshBasicMaterial, ShaderMaterial, Vector2, Vector3 } from 'three'
import { waterfallAnchor, advanceScroll, createWaterfall, type WaterfallDef } from './waterfall'
import { createIslandGeometry, type IslandDef } from './island'
import { createTerrainQuery, type IslandMesh } from './terrain-query'
import { ARCHIPELAGO } from './levels/archipelago'
import type { TerrainQuery } from '../core/types'

const island: IslandDef = {
  id: 'home', position: new Vector3(100, 20, -50), radius: 40, height: 30,
  biome: 'grass', noiseSeed: 1,
}
const def = (over: Partial<WaterfallDef> = {}): WaterfallDef => ({
  islandId: 'home', angle: 0, width: 8, length: 60, ...over,
})

const solid: TerrainQuery = {
  groundHeightAt: () => 25,
  // Only answers downward casts. A fake that ignored `direction` would answer a
  // horizontal collision sweep with a hit on the ground below, so a movement test in a
  // flat fake world would start deflecting off phantom walls. The threshold is scaled by
  // the direction's length, not compared against the unit vector: `raycast` accepts an
  // unnormalised direction, and a fake that only recognised the unit down vector would
  // answer `null` to a mostly-downward sweep the real one answers.
  raycast: (from, direction) =>
    direction.y < -0.9 * direction.length()
      ? { point: new Vector3(from.x, 25, from.z), normal: new Vector3(0, 1, 0), islandId: 'home' }
      : null,
}
const empty: TerrainQuery = { groundHeightAt: () => null, raycast: () => null }

describe('advanceScroll', () => {
  it('advances with time', () => {
    expect(advanceScroll(0, 1, 0.25)).toBeCloseTo(0.25, 6)
  })

  it('wraps back into the unit range instead of growing without bound', () => {
    expect(advanceScroll(0.9, 1, 0.25)).toBeCloseTo(0.15, 6)
  })

  it('stays within the unit range over a long run', () => {
    let offset = 0
    for (let i = 0; i < 10000; i++) offset = advanceScroll(offset, 1 / 60, 1.4)
    expect(offset).toBeGreaterThanOrEqual(0)
    expect(offset).toBeLessThan(1)
  })

  it('does not move when time does not pass', () => {
    expect(advanceScroll(0.4, 0, 1.4)).toBeCloseTo(0.4, 6)
  })
})

describe('waterfallAnchor', () => {
  it('places the curtain out at the island rim, not at its centre', () => {
    const anchor = waterfallAnchor(island, def(), solid)!
    const horizontal = Math.hypot(
      anchor.position.x - island.position.x, anchor.position.z - island.position.z,
    )
    expect(horizontal).toBeGreaterThan(island.radius * 0.7)
  })

  it('puts the curtain at the ground height it found', () => {
    expect(waterfallAnchor(island, def(), solid)!.position.y).toBeCloseTo(25, 5)
  })

  it('faces outward, so the angle follows the rim position', () => {
    const north = waterfallAnchor(island, def({ angle: 0 }), solid)!
    const east = waterfallAnchor(island, def({ angle: Math.PI / 2 }), solid)!
    expect(north.rotationY).not.toBeCloseTo(east.rotationY, 3)
  })

  it('moves around the rim as the angle changes', () => {
    const a = waterfallAnchor(island, def({ angle: 0 }), solid)!
    const b = waterfallAnchor(island, def({ angle: Math.PI }), solid)!
    expect(a.position.distanceTo(b.position)).toBeGreaterThan(island.radius)
  })

  it('returns null when the rim point has no ground beneath it', () => {
    expect(waterfallAnchor(island, def(), empty)).toBeNull()
  })

  it('does not mutate the island position it is given', () => {
    waterfallAnchor(island, def(), solid)
    expect(island.position.toArray()).toEqual([100, 20, -50])
  })

  it('is deterministic for the same inputs', () => {
    const a = waterfallAnchor(island, def(), solid)!
    const b = waterfallAnchor(island, def(), solid)!
    expect(a.position.toArray()).toEqual(b.position.toArray())
    expect(a.rotationY).toBeCloseTo(b.rotationY, 10)
  })
})

describe('createWaterfall', () => {
  // No DOM stub any more: the streaks used to be drawn into a 2D canvas, which `node` cannot
  // provide, and are now computed in the shader.

  it('casts no shadow, and contributes no depth under an override material', () => {
    // The curtain is translucent — `transparent: true` with `depthWrite: false` — and it
    // overlaps the rim rock by LIP_RAISE, so any pass that
    // treats it as an opaque surface darkens rock the player can see straight through.
    // `enableShadows` in `src/core/sun.ts` is the consumer today, and it replaces the
    // curtain's own material, as would any later pass rendering depth under
    // `scene.overrideMaterial`. This assertion was missing until the contact shadow pass
    // found the gap; the pass has since been removed and the flag is still correct.
    const waterfall = createWaterfall(island, def(), solid)!
    expect(waterfall.mesh.userData.excludeFromShadows).toBe(true)
  })

  it('draws through the shared effect builder rather than a hand-built shader', () => {
    // The builder is what catches a fragment body that redeclares chunks the renderer already
    // injects -- a failure that throws nowhere and simply stops the mesh drawing.
    const waterfall = createWaterfall(island, def(), solid)!
    const material = waterfall.mesh.material as ShaderMaterial
    expect(material).toBeInstanceOf(ShaderMaterial)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
  })

  it('authors its detail in metres, so every fall carries the same water', () => {
    // The six falls run from 55 to 90 metres long; a pattern written in UV would be stretched
    // to a different density on each.
    const waterfall = createWaterfall(island, def(), solid)!
    const size = (waterfall.mesh.material as ShaderMaterial).uniforms['size']!.value as Vector2
    expect(size.x).toBe(def().width)
    expect(size.y).toBe(def().length)
  })

  it('advances a wrapped phase rather than a growing time', () => {
    // A float32 time loses precision over a session and a waterfall is on screen for all of
    // one. The phase stays in [0, 1) however long the game runs.
    const waterfall = createWaterfall(island, def(), solid)!
    const uniform = (waterfall.mesh.material as ShaderMaterial).uniforms['cycle']!
    for (let i = 0; i < 100000; i++) waterfall.advance(1 / 60)
    expect(uniform.value).toBeGreaterThanOrEqual(0)
    expect(uniform.value).toBeLessThan(1)
  })

  it('wraps its phase seamlessly: every temporal term turns a whole number of times', () => {
    // The wrap is only invisible if the pattern at the end of a cycle is the pattern at the
    // start, which holds exactly when each multiplier of t is an integer.
    const source = (createWaterfall(island, def(), solid)!.mesh.material as ShaderMaterial)
      .fragmentShader
    // A word boundary on `t`, or `glint * 1.2` matches as `t * 1.2`.
    const multipliers = [...source.matchAll(/\bt \* ([0-9.]+)/g)].map((m) => Number(m[1]))
    expect(multipliers.length).toBeGreaterThan(0)
    for (const value of multipliers) expect(Number.isInteger(value)).toBe(true)
  })

  it('fades out at its foot instead of ending on a hard line', () => {
    const source = (createWaterfall(island, def(), solid)!.mesh.material as ShaderMaterial)
      .fragmentShader
    expect(source).toMatch(/smoothstep\(0\.0, size\.y \* 0\.25, wy\)/)
  })
})

describe('waterfallAnchor rim retry', () => {
  // Ground only under the two innermost insets (0.76, 0.72 of the radius),
  // so the outermost probes must miss before this returns a hit.
  const outerMissesInnerHits: TerrainQuery = {
    groundHeightAt: (x, z) => {
      const reach = Math.hypot(x - island.position.x, z - island.position.z)
      return reach <= island.radius * 0.78 ? 25 : null
    },
    raycast: () => null,
  }

  it('steps inward and finds ground when the outermost rim point misses', () => {
    expect(waterfallAnchor(island, def(), outerMissesInnerHits)).not.toBeNull()
  })

  it('the retried point is still a plausible rim distance from the centre', () => {
    const anchor = waterfallAnchor(island, def(), outerMissesInnerHits)!
    const horizontal = Math.hypot(
      anchor.position.x - island.position.x, anchor.position.z - island.position.z,
    )
    expect(horizontal).toBeGreaterThan(island.radius * 0.7)
  })

  it('still returns null when there is no ground at any inset', () => {
    const noGroundAnywhere: TerrainQuery = { groundHeightAt: () => null, raycast: () => null }
    expect(waterfallAnchor(island, def(), noGroundAnywhere)).toBeNull()
  })

  it('resolves a real island angle that the single fixed inset used to miss', () => {
    const home = ARCHIPELAGO.islands.find((i) => i.id === 'ring-east')!
    const waterfallDef = ARCHIPELAGO.waterfalls.find((w) => w.islandId === 'ring-east')!
    const mesh = new Mesh(createIslandGeometry(home), new MeshBasicMaterial())
    mesh.position.copy(home.position)
    mesh.updateMatrixWorld(true)
    const islandMesh: IslandMesh = { id: home.id, mesh }
    const terrain = createTerrainQuery([islandMesh])

    expect(waterfallAnchor(home, waterfallDef, terrain)).not.toBeNull()
  })
})
