import { describe, it, expect } from 'vitest'
import { BackSide, Mesh, ShaderMaterial } from 'three'
import { createAvatarAura, type AvatarAura } from './avatar-aura'

function shell(aura: AvatarAura): Mesh {
  const object = aura.object
  if (!(object instanceof Mesh)) throw new Error('expected a mesh')
  return object
}

// The aura moved from a `MeshBasicMaterial` to a `ShaderMaterial` built through
// `createEffectMaterial` (see `avatar-aura.ts`'s own `SHELL_BODY` comment), so what carries
// opacity moved with it: from the material's own `.opacity` to an `alpha` uniform `update`
// writes every frame.
function shellMaterialOf(aura: AvatarAura): ShaderMaterial {
  const material = shell(aura).material
  if (!(material instanceof ShaderMaterial)) throw new Error('expected a ShaderMaterial')
  return material
}

function opacityOf(aura: AvatarAura): number {
  const value = shellMaterialOf(aura).uniforms.alpha?.value
  if (typeof value !== 'number') throw new Error('expected a numeric alpha uniform')
  return value
}

/** Hold `active` for `seconds` at 60 Hz. */
function hold(aura: AvatarAura, seconds: number, active: boolean): void {
  for (let t = 0; t < seconds; t += 1 / 60) aura.update(1 / 60, active)
}

describe('createAvatarAura', () => {
  it('starts invisible, so it cannot flash before the state begins', () => {
    const aura = createAvatarAura()
    expect(opacityOf(aura)).toBe(0)
    expect(shell(aura).visible).toBe(false)
  })

  it('fades in while the state is active', () => {
    const aura = createAvatarAura()
    hold(aura, 0.3, true)
    expect(opacityOf(aura)).toBeGreaterThan(0.1)
    expect(shell(aura).visible).toBe(true)
  })

  it('fades back out when the state ends', () => {
    const aura = createAvatarAura()
    hold(aura, 0.3, true)
    const lit = opacityOf(aura)
    hold(aura, 0.6, false)
    expect(opacityOf(aura)).toBeLessThan(lit * 0.5)
  })

  it('winds down rather than cutting out', () => {
    // One frame of inactivity must not blank it — the state ending should read as a
    // fade, which is the whole reason this is not a one-shot effect.
    const aura = createAvatarAura()
    hold(aura, 0.5, true)
    aura.update(1 / 60, false)
    expect(opacityOf(aura)).toBeGreaterThan(0)
  })

  it('settles fully invisible once it has wound down', () => {
    const aura = createAvatarAura()
    hold(aura, 0.5, true)
    hold(aura, 3, false)
    expect(opacityOf(aura)).toBeCloseTo(0)
    expect(shell(aura).visible).toBe(false)
  })

  it('takes materially longer to fade out than to fade in', () => {
    // The state should arrive hard and leave as a wind-down, so the two directions are
    // deliberately not symmetrical.
    const framesTo = (target: number, active: boolean, from: AvatarAura): number => {
      let frames = 0
      while (frames < 1000) {
        from.update(1 / 60, active)
        const lit = opacityOf(from)
        if (active ? lit >= target : lit <= target) break
        frames += 1
      }
      return frames
    }
    const rising = createAvatarAura()
    const peak = (() => {
      hold(rising, 2, true)
      return opacityOf(rising)
    })()

    const inFrames = framesTo(peak * 0.9, true, createAvatarAura())
    const settled = createAvatarAura()
    hold(settled, 2, true)
    const outFrames = framesTo(peak * 0.1, false, settled)
    expect(outFrames).toBeGreaterThan(inFrames * 1.5)
  })

  it('never leaves its opacity range, however long the frame', () => {
    const aura = createAvatarAura()
    aura.update(100, true)
    const peak = opacityOf(aura)
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(1)
    aura.update(100, false)
    expect(opacityOf(aura)).toBeGreaterThanOrEqual(0)
  })

  it('casts no shadow', () => {
    expect(shell(createAvatarAura()).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    expect(() => createAvatarAura().dispose()).not.toThrow()
  })
})

describe('the shell reads as a surface rather than a wash', () => {
  it('brightens toward its silhouette, where the surface turns away', () => {
    // ice-shell.ts's argument, unchanged: on a closed shell the visible boundary is a fact
    // about the view, so a band in object space is not a band on screen.
    const material = shellMaterialOf(createAvatarAura())
    expect(material.fragmentShader).toContain('vViewNormal')
    expect(material.fragmentShader).toContain('1.0 - abs(n.z)')
  })

  it('stays BackSide, so it still reads as air around the character', () => {
    expect(shellMaterialOf(createAvatarAura()).side).toBe(BackSide)
  })

  it('stays depth-tested, so its lower half is hidden by the ground', () => {
    expect(shellMaterialOf(createAvatarAura()).depthTest).toBe(true)
  })

  it('drives alpha from the fade, not from a time uniform', () => {
    // The aura's fade-out is the slow one here (0.4s against the guard shell's 0.03s), so this
    // holds the state active long enough to reach a meaningfully lit value before release,
    // rather than reusing the guard shell's one-frame timing verbatim.
    const aura = createAvatarAura()
    const material = shellMaterialOf(aura)
    for (let t = 0; t < 0.3; t += 1 / 60) aura.update(1 / 60, true)
    const lit = material.uniforms.alpha?.value
    for (let t = 0; t < 0.1; t += 1 / 60) aura.update(1 / 60, false)
    expect(material.uniforms.alpha?.value).toBeLessThan(lit as number)
  })

  it('costs nothing while invisible', () => {
    const aura = createAvatarAura()
    aura.update(1 / 60, false)
    expect(aura.object.visible).toBe(false)
  })
})
