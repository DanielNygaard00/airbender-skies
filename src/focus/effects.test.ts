import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { boostedCombatConfig, refillBreath, surgeWind } from './effects'
import type { AvatarStateConfig } from './avatar-state'
import { DEFAULT_COMBAT_CONFIG } from '../combat/config'
import { stillAir, type WindSample } from '../world/wind'
import type { PlayerState } from '../core/types'

const C: AvatarStateConfig = {
  armSeconds: 4,
  durationSeconds: 8,
  gustDamageMultiplier: 3,
  gustKnockbackMultiplier: 1.5,
  surgeAccelMultiplier: 2,
  relentFactor: 0.2,
}

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'glider', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: false, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, ...over,
})

const sample = (accel: Vector3, liftScale = 1): WindSample => ({ accel, liftScale })

describe('boostedCombatConfig', () => {
  it('hands back the same config untouched while inactive', () => {
    const base = DEFAULT_COMBAT_CONFIG
    expect(boostedCombatConfig(base, false, C)).toBe(base)
  })

  it('makes a gust down a spear soldier in one hit', () => {
    // The claim, stated against the enemy's health rather than against the
    // multiplier the code reads: boosted gust must reach a full health bar.
    const boosted = boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, C)
    expect(boosted.gust.damage).toBeGreaterThanOrEqual(DEFAULT_COMBAT_CONFIG.enemies.spear.maxHealth)
    expect(DEFAULT_COMBAT_CONFIG.gust.damage)
      .toBeLessThan(DEFAULT_COMBAT_CONFIG.enemies.spear.maxHealth)
  })

  it('drops the gust cooldown entirely', () => {
    expect(boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, C).gust.cooldownSeconds).toBe(0)
  })

  it('raises knockback to 39 from 26', () => {
    expect(boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, C).gust.knockback).toBeCloseTo(39)
  })

  it('leaves the original config alone', () => {
    // Regression guard: the fight config is a module-level constant, so a mutating
    // boost would permanently buff gust for the rest of the session.
    boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, C)
    expect(DEFAULT_COMBAT_CONFIG.gust.damage).toBeCloseTo(0.5)
    expect(DEFAULT_COMBAT_CONFIG.gust.cooldownSeconds).toBeCloseTo(0.45)
  })

  it('leaves the enemy and player config alone', () => {
    const boosted = boostedCombatConfig(DEFAULT_COMBAT_CONFIG, true, C)
    expect(boosted.enemies).toBe(DEFAULT_COMBAT_CONFIG.enemies)
    expect(boosted.player).toBe(DEFAULT_COMBAT_CONFIG.player)
  })
})

describe('surgeWind', () => {
  it('returns the sample untouched at zero intensity', () => {
    const s = sample(new Vector3(0, 5, 0))
    expect(surgeWind(s, 0, C)).toBe(s)
  })

  it('amplifies a thermal', () => {
    expect(surgeWind(sample(new Vector3(0, 5, 0)), 1, C).accel.y).toBeCloseTo(10)
  })

  it('amplifies a wind river, whose push is horizontal', () => {
    // accel.y is zero here, so a sign test alone would leave rivers unsurged.
    expect(surgeWind(sample(new Vector3(8, 0, 0)), 1, C).accel.x).toBeCloseTo(16)
  })

  it('makes a downdraft relent instead of pushing harder', () => {
    expect(surgeWind(sample(new Vector3(0, -6, 0)), 1, C).accel.y).toBeCloseTo(-1.2)
  })

  it('never inverts a downdraft into lift', () => {
    expect(surgeWind(sample(new Vector3(0, -6, 0)), 1, C).accel.y).toBeLessThan(0)
  })

  it('lets dead air relent back to normal lift', () => {
    expect(surgeWind(sample(new Vector3(), 0), 1, C).liftScale).toBeCloseTo(1)
  })

  it('scales in with intensity', () => {
    expect(surgeWind(sample(new Vector3(), 0), 0.5, C).liftScale).toBeCloseTo(0.5)
  })

  it('never reduces a lift scale it is handed', () => {
    // Guard for any future wind kind that reports lift above normal.
    expect(surgeWind(sample(new Vector3(), 1.4), 1, C).liftScale).toBeCloseTo(1.4)
  })

  it('does not mutate the sample it is given', () => {
    const s = sample(new Vector3(0, 5, 0))
    surgeWind(s, 1, C)
    expect(s.accel.y).toBeCloseTo(5)
  })

  it('leaves still air still', () => {
    const surged = surgeWind(stillAir(), 1, C)
    expect(surged.accel.lengthSq()).toBeCloseTo(0)
    expect(surged.liftScale).toBeCloseTo(1)
  })
})

describe('refillBreath', () => {
  it('fills a drained meter', () => {
    expect(refillBreath(p({ breath: 12 })).breath).toBeCloseTo(100)
  })

  it('leaves the maximum alone', () => {
    const filled = refillBreath(p({ breath: 12, maxBreath: 140 }))
    expect(filled.breath).toBeCloseTo(140)
    expect(filled.maxBreath).toBeCloseTo(140)
  })

  it('hands back the same object when already full', () => {
    const full = p({ breath: 100, maxBreath: 100 })
    expect(refillBreath(full)).toBe(full)
  })
})
