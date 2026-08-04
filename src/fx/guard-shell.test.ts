import { describe, it, expect } from 'vitest'
import { Mesh } from 'three'
import { createGuardShell } from './guard-shell'

function shell(guard: { object: { children: unknown[] } }): Mesh {
  const first = guard.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected a mesh')
  return first
}

function opacity(guard: { object: { children: unknown[] } }): number {
  const material = shell(guard).material
  if (Array.isArray(material)) throw new Error('expected one material')
  return material.opacity
}

describe('createGuardShell', () => {
  it('is invisible before anything happens', () => {
    const guard = createGuardShell()
    guard.update(1 / 60, false)
    expect(guard.object.visible).toBe(false)
  })

  it('appears while the window is open', () => {
    const guard = createGuardShell()
    guard.update(1 / 60, true)
    expect(guard.object.visible).toBe(true)
    expect(opacity(guard)).toBeGreaterThan(0)
  })

  it('goes away once the window closes', () => {
    // The window IS the mechanic, so a shell that outlived it would lie about when
    // the player was actually protected.
    const guard = createGuardShell()
    for (let t = 0; t < 0.1; t += 1 / 60) guard.update(1 / 60, true)
    for (let t = 0; t < 0.5; t += 1 / 60) guard.update(1 / 60, false)
    expect(guard.object.visible).toBe(false)
  })

  it('disposes without throwing', () => {
    expect(() => createGuardShell().dispose()).not.toThrow()
  })
})
