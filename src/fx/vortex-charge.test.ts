import { describe, it, expect } from 'vitest'
import { Mesh } from 'three'
import { createVortexChargeTell } from './vortex-charge'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'

const V = DEFAULT_COMBAT_CONFIG.vortex

function ring(tell: { object: { children: unknown[] } }): Mesh {
  const first = tell.object.children[0]
  if (!(first instanceof Mesh)) throw new Error('expected a mesh')
  return first
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
