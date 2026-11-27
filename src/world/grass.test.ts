import { describe, it, expect } from 'vitest'
import { InstancedMesh, Vector3, type WebGLProgramParametersWithUniforms } from 'three'
import { createIslandGeometry, type IslandDef } from './island'
import { paintIsland } from './island-paint'
import {
  CHUNK_SIZE, GRASS_FAR, TUFTS_PER_SQUARE_METRE, createGrassField, createGrassMaterial,
  createTuftGeometry, scatterTufts,
} from './grass'
import { WIND_CLOCK } from '../core/weather'

const def: IslandDef = {
  id: 'grass-test',
  position: new Vector3(100, 20, -50),
  radius: 30,
  height: 20,
  biome: 'grass',
  noiseSeed: 2468,
}

function painted() {
  const geometry = createIslandGeometry(def)
  paintIsland(geometry, def.biome, def.noiseSeed)
  return geometry
}

function chunksOf(field: ReturnType<typeof createGrassField>): InstancedMesh[] {
  return field.group.children as InstancedMesh[]
}

describe('createTuftGeometry', () => {
  it('runs from the root at 0 to the tallest tip at 1, which the shader reads as height', () => {
    const position = createTuftGeometry().attributes.position!
    let low = Infinity
    let high = -Infinity
    for (let i = 0; i < position.count; i++) {
      low = Math.min(low, position.getY(i))
      high = Math.max(high, position.getY(i))
    }
    expect(low).toBe(0)
    expect(high).toBe(1)
  })

  it('points every normal straight up, so the field shades like the ground it grows from', () => {
    const normal = createTuftGeometry().attributes.normal!
    for (let i = 0; i < normal.count; i++) {
      expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual([0, 1, 0])
    }
  })

  it('darkens the roots and lifts the tips', () => {
    const geometry = createTuftGeometry()
    const position = geometry.attributes.position!
    const colour = geometry.attributes.color!
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) === 0) expect(colour.getY(i)).toBeLessThan(1)
      else expect(colour.getY(i)).toBeGreaterThan(1)
    }
  })
})

describe('scatterTufts', () => {
  it('plants only on the walkable top, never down the cliffs or under the island', () => {
    const tufts = scatterTufts(painted(), def.position, 1)
    expect(tufts.length).toBeGreaterThan(0)
    // The island's own origin is its equator; the top is above it.
    for (const tuft of tufts) expect(tuft.position.y).toBeGreaterThan(def.position.y)
  })

  it('grows roughly the density asked for over the island top', () => {
    const tufts = scatterTufts(painted(), def.position, 1)
    // The top is at most the island's disc; most of it is walkable.
    const disc = Math.PI * def.radius * def.radius
    expect(tufts.length).toBeLessThan(disc * TUFTS_PER_SQUARE_METRE * 1.2)
    expect(tufts.length).toBeGreaterThan(disc * TUFTS_PER_SQUARE_METRE * 0.3)
  })

  it('places tufts in world space, offset by the island position', () => {
    for (const tuft of scatterTufts(painted(), def.position, 1)) {
      expect(Math.hypot(tuft.position.x - def.position.x, tuft.position.z - def.position.z))
        .toBeLessThanOrEqual(def.radius * 1.5)
    }
  })

  it('takes each tuft colour from the painted ground beneath it', () => {
    // Grass greens, not cliff greys: green clearly the strongest channel.
    for (const tuft of scatterTufts(painted(), def.position, 1).slice(0, 200)) {
      expect(tuft.colour.g).toBeGreaterThan(tuft.colour.r)
      expect(tuft.colour.g).toBeGreaterThan(tuft.colour.b)
    }
  })

  it('is deterministic for a seed', () => {
    const a = scatterTufts(painted(), def.position, 7).map((t) => t.position.toArray())
    const b = scatterTufts(painted(), def.position, 7).map((t) => t.position.toArray())
    expect(a).toEqual(b)
  })
})

describe('createGrassField', () => {
  const tufts = scatterTufts(painted(), def.position, 1)

  it('buckets the tufts into chunks no wider than a chunk edge, keeping every tuft', () => {
    const field = createGrassField(tufts, 1)
    const chunks = chunksOf(field)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(tufts.length)
    for (const mesh of chunks) {
      expect(mesh.boundingSphere!.radius).toBeLessThan(CHUNK_SIZE * 1.6)
    }
  })

  it('hides chunks beyond reach of the camera and shows the ones near it', () => {
    const field = createGrassField(tufts, 1)
    field.update(new Vector3(def.position.x, def.position.y + 25, def.position.z))
    expect(chunksOf(field).some((mesh) => mesh.visible)).toBe(true)
    field.update(new Vector3(def.position.x + GRASS_FAR * 4, def.position.y, def.position.z))
    expect(chunksOf(field).every((mesh) => !mesh.visible)).toBe(true)
  })

  it('draws the tier\'s fraction of every chunk, and nothing at zero', () => {
    const field = createGrassField(tufts, 1)
    const full = chunksOf(field).map((mesh) => mesh.count)
    field.setDensity(0.5)
    chunksOf(field).forEach((mesh, i) => expect(mesh.count).toBe(Math.round(full[i]! * 0.5)))
    field.setDensity(0)
    field.update(new Vector3(def.position.x, def.position.y + 25, def.position.z))
    expect(chunksOf(field).every((mesh) => mesh.count === 0 && !mesh.visible)).toBe(true)
    field.setDensity(Number.NaN)
    expect(chunksOf(field).every((mesh) => mesh.count === 0)).toBe(true)
  })

  it('receives shadows, casts none, and is composited over the ambient occlusion', () => {
    for (const mesh of chunksOf(createGrassField(tufts, 1))) {
      expect(mesh.receiveShadow).toBe(true)
      expect(mesh.castShadow).toBe(false)
      expect(mesh.userData.excludeFromShadows).toBe(true)
      expect(mesh.userData.cannotReceiveAO).toBe(true)
    }
  })

  it('builds an empty field from no tufts rather than failing', () => {
    const field = createGrassField([], 1)
    expect(field.group.children).toHaveLength(0)
    expect(() => field.update(new Vector3())).not.toThrow()
  })
})

describe('createGrassMaterial', () => {
  it('bends and fades the blades on the shared wind clock, and keeps back faces lit', () => {
    const material = createGrassMaterial()
    const shader = {
      uniforms: {},
      vertexShader: 'void main() {\n#include <project_vertex>\n}',
      fragmentShader: 'void main() {\n#include <normal_fragment_begin>\n}',
    } as unknown as WebGLProgramParametersWithUniforms
    material.onBeforeCompile(shader, undefined as never)
    expect(shader.uniforms['windClock']).toBe(WIND_CLOCK)
    expect(shader.vertexShader).not.toContain('#include <project_vertex>')
    expect(shader.vertexShader).toContain('cameraPosition')
    expect(shader.fragmentShader).not.toContain('gl_FrontFacing ? 1.0 : - 1.0')
    // Both patches named, so it never shares a program with a surface carrying only one.
    expect(material.customProgramCacheKey()).toBe('cloud-shadow|grass')
  })
})
