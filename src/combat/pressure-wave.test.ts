import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  slamStrength, waveRadius, waveDamage, waveTargets, waveImpulse,
  type PressureWaveConfig,
} from './pressure-wave'
import { DEFAULT_COMBAT_CONFIG } from './config'
import { spawnEnemy, type Enemy } from './enemy'

/** Round numbers, so every expectation below is a hand-computed literal. */
const C: PressureWaveConfig = {
  minImpactSpeed: 10,
  fullImpactSpeed: 50,
  minRadius: 4,
  maxRadius: 12,
  verticalReach: 4,
  minDamage: 0.5,
  maxDamage: 2.5,
  minKnockback: 10,
  maxKnockback: 30,
  bounceFactor: 0.5,
}

const ORIGIN = new Vector3(0, 0, 0)
const at = (x: number, z: number): Enemy =>
  spawnEnemy(`${x}:${z}`, new Vector3(x, 0, z), 'spear', DEFAULT_COMBAT_CONFIG.enemies.spear)

describe('slamStrength', () => {
  it('is zero at the minimum impact and one at full', () => {
    expect(slamStrength(10, C)).toBeCloseTo(0)
    expect(slamStrength(50, C)).toBeCloseTo(1)
  })

  it('is halfway at halfway', () => {
    // 10 -> 50, so 30 is the midpoint.
    expect(slamStrength(30, C)).toBeCloseTo(0.5)
  })

  it('clamps beyond both ends', () => {
    expect(slamStrength(2, C)).toBe(0)
    expect(slamStrength(400, C)).toBe(1)
  })
})

describe('waveRadius', () => {
  it('interpolates between the minimum and maximum radius', () => {
    expect(waveRadius(0, C)).toBeCloseTo(4)
    expect(waveRadius(0.5, C)).toBeCloseTo(8)
    expect(waveRadius(1, C)).toBeCloseTo(12)
  })
})

describe('waveDamage', () => {
  it('interpolates between the minimum and maximum damage', () => {
    expect(waveDamage(0, C)).toBeCloseTo(0.5)
    expect(waveDamage(0.5, C)).toBeCloseTo(1.5)
    expect(waveDamage(1, C)).toBeCloseTo(2.5)
  })

  it('downs a spear soldier outright at full impact but not at minimum', () => {
    // The claim, stated against the enemy's health rather than against the damage
    // numbers the code reads. This threshold is the whole payoff of the move.
    const wave = DEFAULT_COMBAT_CONFIG.pressureWave
    const health = DEFAULT_COMBAT_CONFIG.enemies.spear.maxHealth
    expect(waveDamage(1, wave)).toBeGreaterThanOrEqual(health)
    expect(waveDamage(0, wave)).toBeLessThan(health)
  })
})

describe('waveTargets', () => {
  it('catches an enemy inside the radius', () => {
    expect(waveTargets(ORIGIN, [at(0, 6)], 1, C).map((e) => e.id)).toEqual(['0:6'])
  })

  it('misses an enemy beyond the radius', () => {
    expect(waveTargets(ORIGIN, [at(0, 20)], 1, C)).toEqual([])
  })

  it('reaches further at full strength than at minimum', () => {
    // An enemy at 6 is inside the full radius of 12 and outside the minimum of 4.
    expect(waveTargets(ORIGIN, [at(0, 6)], 0, C)).toEqual([])
    expect(waveTargets(ORIGIN, [at(0, 6)], 1, C).length).toBe(1)
  })

  it('ignores facing entirely', () => {
    // Regression guard: a slam is radial. Anyone reusing the gust's cone test would
    // silently drop everyone standing behind the player.
    const ids = waveTargets(ORIGIN, [at(0, 6), at(0, -6), at(6, 0), at(-6, 0)], 1, C)
      .map((e) => e.id)
    expect(ids.length).toBe(4)
  })

  it('measures reach as a disc rather than a sphere, so the radius does not shrink with height', () => {
    // Both of these are inside the full radius of 12 horizontally and inside the vertical
    // band. A 3D distance test would drop the second one, which is the falloff this move
    // deliberately does not have.
    const level = spawnEnemy('level', new Vector3(11, 0, 0), 'spear', DEFAULT_COMBAT_CONFIG.enemies.spear)
    const raised = spawnEnemy('raised', new Vector3(11, C.verticalReach, 0), 'spear', DEFAULT_COMBAT_CONFIG.enemies.spear)
    expect(waveTargets(ORIGIN, [level, raised], 1, C).map((e) => e.id)).toEqual(['level', 'raised'])
  })

  it('stops at the vertical reach, so a slam is a shockwave across the ground and not a sphere', () => {
    // Zero horizontal distance in both cases, so only the height band decides. The heights
    // come off the config, so the pair keeps straddling the boundary if the value moves.
    const spawn = (id: string, y: number) =>
      spawnEnemy(id, new Vector3(0, y, 0), 'spear', DEFAULT_COMBAT_CONFIG.enemies.spear)
    expect(waveTargets(ORIGIN, [spawn('edge', C.verticalReach)], 1, C).map((e) => e.id))
      .toEqual(['edge'])
    expect(waveTargets(ORIGIN, [spawn('past', C.verticalReach + 0.01)], 1, C)).toEqual([])
  })

  it('keeps the shipped wave flatter than the gust it shares ground with', () => {
    // Two claims about the shipped number instead of a restatement of it. Under the gust's
    // band, because this is a shockwave across a surface and that is a sweep of open air;
    // and under its own full radius, so growing the radius with fall speed makes the wave
    // wider rather than turning it into a sphere.
    const wave = DEFAULT_COMBAT_CONFIG.pressureWave
    expect(wave.verticalReach).toBeLessThan(DEFAULT_COMBAT_CONFIG.gust.verticalReach)
    expect(wave.verticalReach).toBeLessThan(wave.maxRadius)
  })
})

describe('waveImpulse', () => {
  it('pushes outward from the slam', () => {
    const push = waveImpulse(ORIGIN, new Vector3(0, 0, 5), 1, C)
    expect(push.z).toBeGreaterThan(0)
    expect(push.x).toBeCloseTo(0)
  })

  it('lifts as well as pushes, so bodies can go off a ledge', () => {
    expect(waveImpulse(ORIGIN, new Vector3(0, 0, 5), 1, C).y).toBeGreaterThan(0)
  })

  it('pushes materially harder at full strength than at minimum', () => {
    const weak = waveImpulse(ORIGIN, new Vector3(0, 0, 5), 0, C).length()
    const full = waveImpulse(ORIGIN, new Vector3(0, 0, 5), 1, C).length()
    // A margin, not a bare comparison: 10 -> 30 is three times the push.
    expect(full).toBeGreaterThan(weak * 2.5)
  })

  it('still moves someone at minimum strength', () => {
    // A slam that damages without displacing would contradict the crowd-control
    // identity, and is what a single full-strength-only knockback value would give.
    expect(waveImpulse(ORIGIN, new Vector3(0, 0, 5), 0, C).length()).toBeGreaterThan(5)
  })

  it('has a defined direction for a target standing exactly on the origin', () => {
    const push = waveImpulse(ORIGIN, ORIGIN.clone(), 1, C)
    expect(Number.isFinite(push.x)).toBe(true)
    expect(Number.isFinite(push.z)).toBe(true)
    expect(push.length()).toBeGreaterThan(0)
  })
})
