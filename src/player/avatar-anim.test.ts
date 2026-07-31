import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { animationFor, chargeSquashScale } from './avatar-anim'
import type { PlayerState } from '../core/types'
import { DEFAULT_GROUND_CONFIG as G } from '../core/config'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0, ...over,
})

describe('animationFor', () => {
  it('glides whenever the glider is out', () => {
    expect(animationFor(p({ mode: 'glider', grounded: false }))).toBe('glide')
  })

  it('glides even when the glider is barely moving', () => {
    expect(animationFor(p({ mode: 'glider', grounded: false, velocity: new Vector3() })))
      .toBe('glide')
  })

  it('falls when airborne without the glider', () => {
    expect(animationFor(p({ grounded: false }))).toBe('fall')
  })

  it('idles when standing still', () => {
    expect(animationFor(p())).toBe('idle')
  })

  it('walks at a walking pace', () => {
    expect(animationFor(p({ velocity: new Vector3(0, 0, -7) }))).toBe('walk')
  })

  it('runs at a running pace', () => {
    expect(animationFor(p({ velocity: new Vector3(0, 0, -13) }))).toBe('run')
  })

  it('ignores vertical speed when picking a ground clip', () => {
    expect(animationFor(p({ velocity: new Vector3(0, -30, 0) }))).toBe('idle')
  })
})

describe('chargeSquashScale', () => {
  it('stands at full height when not charging', () => {
    expect(chargeSquashScale(p(), G)).toBe(1)
  })

  it('is below the threshold not squashed at all', () => {
    expect(chargeSquashScale(p({ chargeTime: G.chargeThresholdSeconds / 2 }), G)).toBe(1)
  })

  it('squashes to 0.7 at full charge', () => {
    expect(chargeSquashScale(p({ chargeTime: G.chargeMaxSeconds }), G)).toBeCloseTo(0.7, 6)
  })

  it('squashes partially mid-charge', () => {
    const s = chargeSquashScale(p({ chargeTime: G.chargeMaxSeconds / 2 }), G)
    expect(s).toBeLessThan(1)
    expect(s).toBeGreaterThan(0.7)
  })

  it('never squashes in the air', () => {
    expect(chargeSquashScale(p({ grounded: false, chargeTime: 1 }), G)).toBe(1)
  })
})
