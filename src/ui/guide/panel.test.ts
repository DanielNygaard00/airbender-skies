import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { guideModelFor } from './panel'
import type { ActionContext } from './actions'
import { DEFAULT_GROUND_CONFIG } from '../../core/config'
import { DEFAULT_COMBAT_CONFIG } from '../../combat/config'
import type { PlayerState } from '../../core/types'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, ...over,
})

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  player: p(),
  ground: DEFAULT_GROUND_CONFIG,
  wave: DEFAULT_COMBAT_CONFIG.pressureWave,
  gustReady: true,
  avatarStateReady: false,
  ...over,
})

const names = (rows: { name: string }[]) => rows.map((r) => r.name)

describe('guideModelFor', () => {
  it('puts a ground-only action in the ground column alone', () => {
    const model = guideModelFor(ctx())
    expect(names(model.ground)).toContain('Air blast dash')
    expect(names(model.glider)).not.toContain('Air blast dash')
  })

  it('puts a glider-only action in the glider column alone', () => {
    const model = guideModelFor(ctx())
    expect(names(model.glider)).toContain('Hover')
    expect(names(model.ground)).not.toContain('Hover')
  })

  it('puts a both-mode action in both columns', () => {
    const model = guideModelFor(ctx())
    expect(names(model.ground)).toContain('Gust')
    expect(names(model.glider)).toContain('Gust')
  })

  it('reports which mode the player is in', () => {
    expect(guideModelFor(ctx()).current).toBe('ground')
    expect(guideModelFor(ctx({ player: p({ mode: 'glider', grounded: false }) })).current)
      .toBe('glider')
  })

  it('keeps an unavailable action in the model rather than dropping it', () => {
    // The panel dims rather than hides. A tester needs to see that the dash exists and
    // is currently impossible — a vanished row reads as a missing feature.
    const airborne = guideModelFor(ctx({ player: p({ grounded: false }) }))
    const dash = airborne.ground.find((r) => r.name === 'Air blast dash')
    expect(dash).toBeDefined()
    expect(dash?.available).toBe(false)
  })

  it('marks an available action available', () => {
    const dash = guideModelFor(ctx()).ground.find((r) => r.name === 'Air blast dash')
    expect(dash?.available).toBe(true)
  })

  it('carries the reference sections through', () => {
    const model = guideModelFor(ctx())
    expect(model.combos.length).toBeGreaterThan(0)
    expect(model.meters.length).toBe(3)
    expect(Object.keys(model.wind).length).toBe(5)
  })

  it('carries the press qualifier through, so two actions on one key are told apart', () => {
    const rows = guideModelFor(ctx()).ground.filter((r) => r.key === 'Space')
    // Jump, charged jump, double jump and deploy all live on Space.
    expect(rows.length).toBeGreaterThan(2)
    for (const row of rows) expect(row.press?.length ?? 0).toBeGreaterThan(0)
  })
})
