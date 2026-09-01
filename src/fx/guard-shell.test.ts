import { describe, it, expect } from 'vitest'
import { BackSide, Mesh, ShaderMaterial } from 'three'
import { createGuardShell } from './guard-shell'
import { DEFAULT_SLIPSTREAM_CONFIG as S } from '../core/config'

function shell(guard: { object: { children: unknown[] } }): Mesh {
  const first = guard.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected a mesh')
  return first
}

// The shell moved from a `MeshBasicMaterial` to a `ShaderMaterial` built through
// `createEffectMaterial` (see `guard-shell.ts`'s own `SHELL_BODY` comment), so what carries
// opacity moved with it: from the material's own `.opacity` to an `alpha` uniform `update`
// writes every frame.
function shellMaterialOf(guard: { object: { children: unknown[] } }): ShaderMaterial {
  const material = shell(guard).material
  if (!(material instanceof ShaderMaterial)) throw new Error('expected a ShaderMaterial')
  return material
}

function opacity(guard: { object: { children: unknown[] } }): number {
  const value = shellMaterialOf(guard).uniforms.alpha?.value
  if (typeof value !== 'number') throw new Error('expected a numeric alpha uniform')
  return value
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

describe('the shell reads as a surface rather than a wash', () => {
  it('brightens toward its silhouette, where the surface turns away', () => {
    // ice-shell.ts's argument, unchanged: on a closed shell the visible boundary is a fact
    // about the view, so a band in object space is not a band on screen.
    const material = shellMaterialOf(createGuardShell())
    expect(material.fragmentShader).toContain('vViewNormal')
    expect(material.fragmentShader).toContain('1.0 - abs(n.z)')
  })

  it('stays BackSide, so it still reads as air around the character', () => {
    expect(shellMaterialOf(createGuardShell()).side).toBe(BackSide)
  })

  it('stays depth-tested, so its lower half is hidden by the ground', () => {
    expect(shellMaterialOf(createGuardShell()).depthTest).toBe(true)
  })

  it('drives alpha from the fade, not from a time uniform', () => {
    // The window is the entire mechanic and it is 0.11s long. A shell with its own clock
    // could outlive the protection it advertises; this one cannot, because `update` is the
    // only thing that writes its opacity.
    const shell = createGuardShell()
    const material = shellMaterialOf(shell)
    shell.update(1 / 60, true)
    const lit = material.uniforms.alpha?.value
    shell.update(1 / 60, false)
    shell.update(1 / 60, false)
    expect(material.uniforms.alpha?.value).toBeLessThan(lit as number)
  })

  it('costs nothing while invisible', () => {
    const shell = createGuardShell()
    shell.update(1 / 60, false)
    expect(shell.object.visible).toBe(false)
  })
})
