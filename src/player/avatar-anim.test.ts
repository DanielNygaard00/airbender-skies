import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { animationFor } from './avatar-anim'
import type { PlayerState } from '../core/types'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, ...over,
})

describe('animationFor', () => {
  it('glides whenever the kite is out', () => {
    expect(animationFor(p({ mode: 'kite', grounded: false }))).toBe('glide')
  })

  it('glides even when the kite is barely moving', () => {
    expect(animationFor(p({ mode: 'kite', grounded: false, velocity: new Vector3() })))
      .toBe('glide')
  })

  it('falls when airborne without the kite', () => {
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
