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

  it('disposes without throwing', () => {
    expect(() => createVortexChargeTell().dispose()).not.toThrow()
  })
})
