import { describe, it, expect } from 'vitest'
import { Box3, Euler, Mesh, MeshBasicMaterial, Quaternion } from 'three'
import { createHealthBar, healthBarVisible } from './health-bar'
import type { Health } from './health'

const at = (current: number, max = 4): Health => ({ current, max, sinceHit: 0 })
const CAMERA = new Quaternion()

/** The bar's children are named, so a test does not depend on the order they were added. */
function meshNamed(bar: { object: { getObjectByName(name: string): unknown } }, name: string): Mesh {
  const found = bar.object.getObjectByName(name)
  if (!(found instanceof Mesh)) throw new Error(`expected a mesh named ${name}`)
  return found
}

function materialOf(mesh: Mesh): MeshBasicMaterial {
  const material = mesh.material
  if (Array.isArray(material) || !(material instanceof MeshBasicMaterial)) {
    throw new Error('expected a single MeshBasicMaterial')
  }
  return material
}

describe('healthBarVisible', () => {
  it('is hidden at full health', () => {
    expect(healthBarVisible(at(4))).toBe(false)
  })

  it('is shown once damaged', () => {
    expect(healthBarVisible(at(3))).toBe(true)
  })

  it('is hidden when downed', () => {
    // Damaged as well as downed, so this cannot pass by way of the damage check.
    expect(healthBarVisible(at(0))).toBe(false)
  })
})

describe('createHealthBar', () => {
  it('sits above the head rather than at the feet', () => {
    // The body capsule is radius 0.35 and length 1.0 centred at y 0.85, so its top
    // is at 1.7. The bar has to clear that.
    expect(createHealthBar().object.position.y).toBeGreaterThan(1.7)
  })

  it('scales the fill to the health fraction', () => {
    const bar = createHealthBar()
    bar.update(at(1), CAMERA)
    expect(meshNamed(bar, 'fill').scale.x).toBeCloseTo(0.25, 4)
  })

  it('empties from the right, not from both ends', () => {
    // A quad scaled about its centre shrinks toward the middle from both sides, which
    // reads as a bar draining from both ends at once. The scale value alone cannot
    // tell the two apart, so this compares edges.
    const bar = createHealthBar()
    bar.update(at(2), CAMERA)
    const fill = new Box3().setFromObject(meshNamed(bar, 'fill'))
    const track = new Box3().setFromObject(meshNamed(bar, 'track'))
    expect(fill.min.x).toBeCloseTo(track.min.x, 5)
    expect(fill.max.x).toBeLessThan(track.max.x - 0.1)
  })

  it('faces where the camera faces', () => {
    const bar = createHealthBar()
    const camera = new Quaternion().setFromEuler(new Euler(-0.4, 1.2, 0))
    bar.update(at(2), camera)
    expect(bar.object.quaternion.angleTo(camera)).toBeLessThan(1e-6)
  })

  it('hides itself at full health and shows itself once damaged', () => {
    const bar = createHealthBar()
    bar.update(at(4), CAMERA)
    expect(bar.object.visible).toBe(false)
    bar.update(at(2), CAMERA)
    expect(bar.object.visible).toBe(true)
  })

  it('keeps a finite scale for a non-finite health', () => {
    const bar = createHealthBar()
    bar.update({ current: Number.NaN, max: 4, sinceHit: 0 }, CAMERA)
    expect(Number.isFinite(meshNamed(bar, 'fill').scale.x)).toBe(true)
  })

  it('is depth-tested, so terrain hides it', () => {
    // Regression guard, and a deliberate difference from src/fx/gust-cone.ts and
    // src/fx/dash-trail.ts, the two modules that set depthTest false. A bar drawn over
    // a hill would reveal an enemy the player cannot see.
    const bar = createHealthBar()
    for (const name of ['track', 'fill']) {
      expect(materialOf(meshNamed(bar, name)).depthTest).toBe(true)
    }
  })

  it('casts no shadow', () => {
    const bar = createHealthBar()
    for (const name of ['track', 'fill']) {
      expect(meshNamed(bar, name).userData.excludeFromShadows).toBe(true)
    }
  })

  it('disposes without throwing', () => {
    expect(() => createHealthBar().dispose()).not.toThrow()
  })
})
