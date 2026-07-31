import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { formatAltitude, formatAirspeed, breathFraction, hudModelFor } from './hud'
import type { PlayerState } from '../core/types'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0, ...over,
})

describe('formatAltitude', () => {
  it('rounds to whole metres', () => {
    expect(formatAltitude(123.7)).toBe('124 m')
  })

  it('handles negative altitude below the islands', () => {
    expect(formatAltitude(-42.2)).toBe('-42 m')
  })

  it('never shows a non-finite value to the player', () => {
    expect(formatAltitude(NaN)).toBe('— m')
  })
})

describe('formatAirspeed', () => {
  it('rounds to whole metres per second', () => {
    expect(formatAirspeed(23.91)).toBe('24 m/s')
  })

  it('shows zero at rest', () => {
    expect(formatAirspeed(0)).toBe('0 m/s')
  })

  it('never shows a non-finite value to the player', () => {
    expect(formatAirspeed(Infinity)).toBe('— m/s')
  })
})

describe('breathFraction', () => {
  it('is one at full breath', () => {
    expect(breathFraction(p())).toBe(1)
  })

  it('is a half at half breath', () => {
    expect(breathFraction(p({ breath: 50 }))).toBe(0.5)
  })

  it('is zero when empty', () => {
    expect(breathFraction(p({ breath: 0 }))).toBe(0)
  })

  it('accounts for a raised maximum from shrines', () => {
    expect(breathFraction(p({ breath: 90, maxBreath: 180 }))).toBeCloseTo(0.5, 5)
  })

  it('guards against a zero maximum rather than dividing by zero', () => {
    expect(breathFraction(p({ breath: 0, maxBreath: 0 }))).toBe(0)
  })
})

describe('hudModelFor', () => {
  it('reports altitude from the player position', () => {
    expect(hudModelFor(p({ position: new Vector3(0, 250, 0) })).altitude).toBe('250 m')
  })

  it('reports airspeed from the velocity magnitude', () => {
    expect(hudModelFor(p({ velocity: new Vector3(0, 0, -30) })).airspeed).toBe('30 m/s')
  })

  it('hides the breath meter when full and on the ground', () => {
    expect(hudModelFor(p()).showBreath).toBe(false)
  })

  it('shows the breath meter while flying', () => {
    expect(hudModelFor(p({ mode: 'kite', grounded: false })).showBreath).toBe(true)
  })

  it('shows the breath meter when it is not full, even on the ground', () => {
    expect(hudModelFor(p({ breath: 60 })).showBreath).toBe(true)
  })
})
