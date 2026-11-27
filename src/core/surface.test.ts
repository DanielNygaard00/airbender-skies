import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DoubleSide, MeshStandardMaterial } from 'three'
import { createSurface, SURFACES, type SurfaceKind } from './surface'

const SRC = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })
}

describe('createSurface', () => {
  it('builds a physically based material carrying the kind\'s finish', () => {
    for (const kind of Object.keys(SURFACES) as SurfaceKind[]) {
      const material = createSurface(kind)
      expect(material).toBeInstanceOf(MeshStandardMaterial)
      expect(material.roughness).toBe(SURFACES[kind].roughness)
      expect(material.metalness).toBe(SURFACES[kind].metalness)
    }
  })

  it('passes every other parameter through untouched', () => {
    const material = createSurface('fabric', {
      color: 0x336699, side: DoubleSide, transparent: true, opacity: 0.4, vertexColors: true,
    })
    expect(material.color.getHex()).toBe(0x336699)
    expect(material.side).toBe(DoubleSide)
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBe(0.4)
    expect(material.vertexColors).toBe(true)
  })

  it('keeps every finish in the physical range', () => {
    for (const finish of Object.values(SURFACES)) {
      expect(finish.roughness).toBeGreaterThanOrEqual(0)
      expect(finish.roughness).toBeLessThanOrEqual(1)
      expect(finish.metalness).toBeGreaterThanOrEqual(0)
      expect(finish.metalness).toBeLessThanOrEqual(1)
    }
  })

  it('keeps the flat-shaded world rough, so no facet flashes the whole sun as plastic', () => {
    // Only armour and the translucent board are allowed a visible highlight; see surface.ts.
    const glossy = (Object.keys(SURFACES) as SurfaceKind[])
      .filter((kind) => SURFACES[kind].roughness < 0.6)
    expect(new Set(glossy)).toEqual(new Set(['metal', 'glass']))
  })
})

describe('the move to physically based materials', () => {
  it('leaves no Lambert material anywhere in the game', () => {
    // One Lambert surface in a world lit by the sky environment would be the one thing that fill
    // never reaches: Lambert ignores `scene.environment`, so it would sit in shade as a flat dark
    // patch beside rocks that pick up the blue of the sky. New lit surfaces go through
    // `createSurface`.
    const offenders = sourceFiles(SRC)
      .filter((path) => readFileSync(path, 'utf8').includes('new MeshLambertMaterial'))
    expect(offenders).toEqual([])
  })
})
