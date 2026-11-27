import { describe, it, expect } from 'vitest'
import { ShaderChunk } from 'three'
import { HAZE_MAX, hazeAt, installHaze } from './haze'
import { FOG_FAR } from './renderer'

/** The linear fog the haze sits under, as renderer.ts configures it. */
const linear = (d: number) => {
  const t = Math.min(Math.max((d - 400) / (FOG_FAR - 400), 0), 1)
  return t * t * (3 - 2 * t)
}

describe('hazeAt', () => {
  it('is clear at the camera and rises with distance toward its ceiling', () => {
    expect(hazeAt(0)).toBe(0)
    let previous = 0
    for (const d of [50, 200, 500, 1000, 2000, 5000]) {
      expect(hazeAt(d)).toBeGreaterThan(previous)
      expect(hazeAt(d)).toBeLessThan(HAZE_MAX)
      previous = hazeAt(d)
    }
  })

  it('adds a depth cue where the linear fog gave none, inside its 400 m start', () => {
    expect(linear(300)).toBe(0)
    expect(hazeAt(300)).toBeGreaterThan(0.1)
  })

  it('leaves a kilometre-distant landmark visible: well under half hazed', () => {
    expect(Math.max(hazeAt(1000), linear(1000))).toBeLessThan(0.4)
  })

  it('never stops the linear fog closing completely at the far plane', () => {
    // max(), not a blend: the haze can only add, so the far-plane guarantee survives.
    expect(Math.max(hazeAt(FOG_FAR), linear(FOG_FAR))).toBe(1)
  })
})

describe('installHaze', () => {
  it('rewrites all four fog chunks together, so every fogging material stays consistent', () => {
    installHaze()
    expect(ShaderChunk.fog_pars_vertex).toContain('vFogDirection')
    expect(ShaderChunk.fog_vertex).toContain('vFogDirection')
    expect(ShaderChunk.fog_pars_fragment).toContain('vFogDirection')
    expect(ShaderChunk.fog_fragment).toContain('max(')
    expect(ShaderChunk.fog_fragment).toContain('fogTint')
  })

  it('keeps three\'s exponential fog path intact for anything that uses FogExp2', () => {
    installHaze()
    expect(ShaderChunk.fog_fragment).toContain('FOG_EXP2')
    expect(ShaderChunk.fog_pars_fragment).toContain('fogDensity')
  })

  it('is safe to call twice', () => {
    installHaze()
    const once = ShaderChunk.fog_fragment
    installHaze()
    expect(ShaderChunk.fog_fragment).toBe(once)
  })
})
