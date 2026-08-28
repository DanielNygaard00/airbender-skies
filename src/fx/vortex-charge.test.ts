import { describe, it, expect } from 'vitest'
import { Color, Mesh, ShaderMaterial } from 'three'
import { createVortexChargeTell, PEAK_OPACITY } from './vortex-charge'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const V = DEFAULT_COMBAT_CONFIG.vortex

function ring(tell: { object: { children: unknown[] } }): Mesh {
  const first = tell.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected a mesh')
  return first
}

/** The charge ring's own shader material. */
function materialOf(tell: { object: { children: unknown[] } }): ShaderMaterial {
  const { material } = ring(tell)
  if (!(material instanceof ShaderMaterial)) throw new Error('expected the ring to carry a shader material')
  return material
}

describe('createVortexChargeTell', () => {
  it('is hidden when nothing is charging', () => {
    const tell = createVortexChargeTell()
    tell.update(1 / 60, 0, V)
    expect(tell.object.visible).toBe(false)
  })

  it('appears once a charge is being held', () => {
    const tell = createVortexChargeTell()
    tell.update(1 / 60, V.minChargeSeconds, V)
    expect(tell.object.visible).toBe(true)
  })

  it('shows the radius the release will actually cover', () => {
    // The charge has to be legible before it is spent, not after.
    const tell = createVortexChargeTell()
    tell.update(1 / 60, V.maxChargeSeconds, V)
    const full = ring(tell).scale.x
    tell.update(1 / 60, V.minChargeSeconds, V)
    expect(full).toBeGreaterThan(ring(tell).scale.x)
    expect(full).toBeCloseTo(V.maxRadius, 1)
  })

  it('keeps a positive scale for a config whose radius starts at zero', () => {
    // The `Math.max(..., 1e-4)` floor on the ring's scale, which the tell's own animation cannot
    // reach: `vortexRadius` lerps from `minRadius`, shipped at 5, so the smallest radius it ever
    // asks for is 5. The floor bounds the config instead, and a zero scale is a degenerate
    // matrix — the same reason and the same shape as the floors in `vortex-ring.ts` and
    // `shockwave.ts`. Held at zero charge, where a zero `minRadius` actually bites.
    const tell = createVortexChargeTell()
    tell.update(1 / 60, V.minChargeSeconds, { ...V, minRadius: 0, maxRadius: 0 })
    expect(ring(tell).scale.x).toBeGreaterThan(0)
    tell.dispose()
  })

  it('disposes without throwing', () => {
    expect(() => createVortexChargeTell().dispose()).not.toThrow()
  })
})

describe('the charge tell reads as air gathering, not just a static ring', () => {
  it('carries a time uniform, so the streaks move rather than the ring holding a still gradient', () => {
    const tell = createVortexChargeTell()
    tell.update(1 / 60, V.minChargeSeconds, V)
    expect(materialOf(tell).uniforms.time).toBeDefined()
  })

  it('advances that uniform as the charge is held', () => {
    // A time uniform nothing writes is a still gradient, which is the failure this test exists
    // to catch: it looks like a shader effect and animates nothing.
    const tell = createVortexChargeTell()
    tell.update(1 / 60, V.minChargeSeconds, V)
    const before = materialOf(tell).uniforms.time?.value
    for (let t = 0; t < 0.1; t += 1 / 60) tell.update(1 / 60, V.minChargeSeconds + t, V)
    expect(materialOf(tell).uniforms.time?.value).not.toBe(before)
  })

  it('keeps a bright element above the bloom threshold', () => {
    // post.ts sets luminanceThreshold 0.82, measured on new Color(hex).r/g/b — the linear
    // values bloom actually thresholds against, not hex-divided-by-255.
    const tell = createVortexChargeTell()
    tell.update(1 / 60, V.minChargeSeconds, V)
    const tint = materialOf(tell).uniforms.tint?.value
    expect(tint).toBeInstanceOf(Color)
    if (tint instanceof Color) {
      const luminance = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b
      expect(luminance).toBeGreaterThan(0.82)
    }
  })

  it('keeps its peak alpha at the value it shipped with', () => {
    // Task 4's mirrored guard pins a quiet companion element (a separate fill mesh) under 0.5.
    // This tell has no such second element — PEAK_OPACITY is its only brightness knob, and it
    // was already 0.55 before this task. Gameplay says no opacity constant moves, so this pins
    // the literal shipped value rather than a threshold that was never true for it.
    expect(PEAK_OPACITY).toBe(0.55)
  })

  it('brightens as the charge fills', () => {
    // A charge that looks the same at 10% and 90% tells the player nothing about the one move
    // in the game with a hold-to-charge input.
    const tell = createVortexChargeTell()
    tell.update(1 / 60, V.maxChargeSeconds * 0.1, V)
    const dim = materialOf(tell).uniforms.alpha?.value
    tell.update(1 / 60, V.maxChargeSeconds * 0.9, V)
    expect(materialOf(tell).uniforms.alpha?.value).toBeGreaterThan(Number(dim))
  })

  it('derives an angle from the recentred UV, rather than treating vUv.x as one', () => {
    // The same guard as vortex-ring.test.ts, for the same reason: RingGeometry's own UVs are a
    // Cartesian projection, not polar, so a body that scans `vUv.x` directly puts the leading
    // edge at the ring's top and bottom at once rather than travelling around it — the exact
    // defect this file's own doc comment records an earlier draft shipping. No node test can
    // confirm the edge reads as travelling on screen; this pins the derivation instead.
    const tell = createVortexChargeTell()
    tell.update(1 / 60, V.minChargeSeconds, V)
    const { fragmentShader } = materialOf(tell)
    expect(fragmentShader).toContain('atan(')
    expect(fragmentShader).not.toContain('vUv.x')
  })
})
