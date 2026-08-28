import { describe, it, expect } from 'vitest'
import { Color, Mesh, ShaderMaterial, Vector3 } from 'three'
import { createSlipstreamTrail, OPACITY } from './slipstream-trail'
import { DEFAULT_SLIPSTREAM_CONFIG as S } from '../core/config'
import type { Effect } from './effect'

const AT = new Vector3(2, 8, -3)
const NORTH = new Vector3(0, 0, -1)

function mesh(effect: Effect): Mesh {
  if (!(effect.object instanceof Mesh)) throw new Error('expected a mesh')
  return effect.object
}

/** The trail's own shader material. */
function quadMaterialOf(effect: Effect): ShaderMaterial {
  const { material } = mesh(effect)
  if (!(material instanceof ShaderMaterial)) throw new Error('expected the trail to carry a shader material')
  return material
}

describe('createSlipstreamTrail', () => {
  it('is as long as the dash actually travels', () => {
    // Derived from config rather than a chosen number, so retuning the dash retunes
    // the streak with it.
    const trail = createSlipstreamTrail(AT, NORTH, S)
    expect(mesh(trail).scale.z).toBeCloseTo(S.speed * S.durationSeconds, 0)
  })

  it('keeps a positive length for a config that covers no ground', () => {
    // The `Math.max(..., 1e-4)` floor on the length, which this effect's own arithmetic cannot
    // reach: `speed * durationSeconds` is a product of two shipped positives. It bounds the
    // config, and a zero scale is a degenerate matrix — the same reason and the same shape as
    // the floors in `vortex-ring.ts` and `shockwave.ts`, which are pinned the same way.
    const trail = createSlipstreamTrail(AT, NORTH, { ...S, speed: 0 })
    expect(mesh(trail).scale.z).toBeGreaterThan(0)
  })

  it('does not alias the position it was handed', () => {
    const at = AT.clone()
    createSlipstreamTrail(at, NORTH, S)
    expect(at.toArray()).toEqual(AT.toArray())
  })

  it('fades out', () => {
    const trail = createSlipstreamTrail(AT, NORTH, S)
    const material = quadMaterialOf(trail)
    const start = material.uniforms.alpha?.value
    trail.advance(0.1)
    expect(material.uniforms.alpha?.value).toBeLessThan(start)
  })

  it('runs and then finishes', () => {
    const trail = createSlipstreamTrail(AT, NORTH, S)
    expect(trail.advance(0.01)).toBe(true)
    expect(trail.advance(5)).toBe(false)
  })

  it('casts no shadow', () => {
    expect(mesh(createSlipstreamTrail(AT, NORTH, S)).userData.excludeFromShadows).toBe(true)
  })

  it('disposes without throwing', () => {
    expect(() => createSlipstreamTrail(AT, NORTH, S).dispose()).not.toThrow()
  })
})

describe('the trail reads as moving air, not a static streak', () => {
  it('carries a time uniform, so the streak moves rather than the trail fading as a flat gradient', () => {
    const material = quadMaterialOf(createSlipstreamTrail(AT, NORTH, S))
    expect(material.uniforms.time).toBeDefined()
  })

  it('advances that uniform as the effect advances', () => {
    // A time uniform nothing writes is a still gradient, which is the failure this test exists
    // to catch: it looks like a shader effect and animates nothing.
    const trail = createSlipstreamTrail(AT, NORTH, S)
    const material = quadMaterialOf(trail)
    const before = material.uniforms.time?.value
    for (let t = 0; t < 0.1; t += 1 / 60) trail.advance(1 / 60)
    expect(material.uniforms.time?.value).not.toBe(before)
  })

  it('keeps a bright element above the bloom threshold', () => {
    // post.ts sets luminanceThreshold 0.82, measured on new Color(hex).r/g/b — the linear
    // values bloom actually thresholds against, not hex-divided-by-255.
    const material = quadMaterialOf(createSlipstreamTrail(AT, NORTH, S))
    const tint = material.uniforms.tint?.value
    expect(tint).toBeInstanceOf(Color)
    if (tint instanceof Color) {
      const luminance = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b
      expect(luminance).toBeGreaterThan(0.82)
    }
  })

  it('keeps its peak opacity at the value it shipped with', () => {
    // Task 4's mirrored guard pins a quiet companion element (a separate fill mesh) under
    // 0.5. This trail has no such second element — OPACITY is its only brightness knob, and
    // it was already 0.7 before this task. Gameplay says no opacity constant moves, so this
    // pins the literal shipped value rather than a threshold that was never true for it.
    expect(OPACITY).toBe(0.7)
  })

  it('marks its leading edge, because this trail means something the dash trail does not', () => {
    // The Slipstream carries a brief invulnerability window. The dash does not, and the two
    // effects are otherwise the same shape — so the edge is the only thing telling a player
    // which one they just spent.
    const material = quadMaterialOf(createSlipstreamTrail(AT, NORTH, S))
    expect(material.fragmentShader).toContain('lead')
  })
})
