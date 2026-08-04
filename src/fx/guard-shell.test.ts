import { describe, it, expect } from 'vitest'
import { Mesh } from 'three'
import { createGuardShell } from './guard-shell'
import { DEFAULT_SLIPSTREAM_CONFIG as S } from '../core/config'

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
    // the player was actually protected. Asserted both sides: visible while active,
    // so this test cannot pass against a no-op `update`, and gone afterward.
    const guard = createGuardShell()
    for (let t = 0; t < 0.1; t += 1 / 60) guard.update(1 / 60, true)
    expect(guard.object.visible).toBe(true)
    for (let t = 0; t < 0.5; t += 1 / 60) guard.update(1 / 60, false)
    expect(guard.object.visible).toBe(false)
  })

  it('cuts off within a small fraction of the invulnerable window, not a slow fade', () => {
    // The window is the whole mechanic: a shell that lingers past it claims protection
    // the player no longer has. Derived from the config, not a literal, so retuning
    // the window retunes the tolerance for this check with it.
    const guard = createGuardShell()
    for (let t = 0; t < 0.1; t += 1 / 60) guard.update(1 / 60, true)
    expect(guard.object.visible).toBe(true)
    guard.update(S.invulnerableSeconds / 3, false)
    expect(guard.object.visible).toBe(false)
  })

  it('disposes without throwing', () => {
    expect(() => createGuardShell().dispose()).not.toThrow()
  })
})
