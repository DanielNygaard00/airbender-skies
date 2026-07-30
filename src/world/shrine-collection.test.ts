import { describe, it, expect } from 'vitest'
import { applyShrineBonus } from '../player/breath'
import { DEFAULT_FLIGHT_CONFIG } from '../core/config'

/**
 * Pins the composition contract main.ts's shrine-collection block must honour:
 * a shrine permanently raises the breath ceiling but never refunds spent
 * breath. main.ts previously force-set breath to the new maximum on
 * collection (a full refill), contradicting applyShrineBonus's own tested
 * "preserve current breath" contract. These tests exercise that contract
 * directly with the real DEFAULT_FLIGHT_CONFIG, at the values a collection
 * event actually produces, so a regression here is caught before it can
 * reach main.ts again.
 */
describe('shrine collection breath contract', () => {
  it('raises the ceiling without refunding spent breath', () => {
    const result = applyShrineBonus({ breath: 40, maxBreath: 100 }, DEFAULT_FLIGHT_CONFIG)
    expect(result.breath).toBe(40)
    expect(result.maxBreath).toBeCloseTo(110, 5)
  })

  it('does not clamp a full player downward', () => {
    const result = applyShrineBonus({ breath: 100, maxBreath: 100 }, DEFAULT_FLIGHT_CONFIG)
    expect(result.breath).toBe(100)
    expect(result.maxBreath).toBeCloseTo(110, 5)
  })

  it('stacks across two shrines without ever refunding breath', () => {
    const first = applyShrineBonus({ breath: 40, maxBreath: 100 }, DEFAULT_FLIGHT_CONFIG)
    const second = applyShrineBonus(first, DEFAULT_FLIGHT_CONFIG)
    expect(second.breath).toBe(40)
    expect(second.maxBreath).toBeCloseTo(120, 5)
  })
})
