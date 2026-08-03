import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Vector3 } from 'three'
import { ACTIONS, actionKeys, type ActionContext } from './actions'
import { DEFAULT_GROUND_CONFIG } from '../../core/config'
import { DEFAULT_COMBAT_CONFIG } from '../../combat/config'
import type { PlayerState } from '../../core/types'

const README = fileURLToPath(new URL('../../../README.md', import.meta.url))

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

/** Look an action up by the name shown to the player. */
function action(name: string) {
  const found = ACTIONS.find((a) => a.name === name)
  if (!found) throw new Error(`no action named "${name}"`)
  return found
}

const can = (name: string, over: Partial<ActionContext> = {}) =>
  action(name).available(ctx(over))

describe('the catalogue covers the game', () => {
  it('lists an action for every key the README documents', () => {
    // Both directions, so neither list can grow without the other. The failure
    // message has to name the offender, or a mismatch is a puzzle rather than a bug
    // report.
    const inCatalogue = actionKeys()
    const inReadme = readmeKeys()
    expect({ missingFromCatalogue: inReadme.filter((k) => !inCatalogue.includes(k)) })
      .toEqual({ missingFromCatalogue: [] })
    expect({ missingFromReadme: inCatalogue.filter((k) => !inReadme.includes(k)) })
      .toEqual({ missingFromReadme: [] })
  })

  it('gives every action a name and a detail', () => {
    for (const a of ACTIONS) {
      expect(a.name.length, `action on ${a.key} has no name`).toBeGreaterThan(0)
      expect(a.detail.length, `${a.name} has no detail`).toBeGreaterThan(0)
    }
  })

  it('answers availability for every action in both modes without throwing', () => {
    // Cheap guard against a predicate reading a field its own mode never has.
    for (const a of ACTIONS) {
      expect(typeof a.available(ctx({ player: p({ mode: 'ground' }) }))).toBe('boolean')
      expect(typeof a.available(ctx({ player: p({ mode: 'glider', grounded: false }) })))
        .toBe('boolean')
    }
  })
})

describe('availability on the ground', () => {
  it('offers the dash while standing', () => {
    expect(can('Air blast dash')).toBe(true)
  })

  it('withholds the dash in mid-air', () => {
    // Found only by playing, during the ground-kit work: the dash used to fire in
    // mid-air. The guide has to agree with the rule that fixed it.
    expect(can('Air blast dash', { player: p({ grounded: false }) })).toBe(false)
  })

  it('withholds the dash once the chain is spent', () => {
    expect(can('Air blast dash', {
      player: p({ dashesUsed: DEFAULT_GROUND_CONFIG.maxDashChain }),
    })).toBe(false)
  })

  it('withholds the dash during recovery', () => {
    expect(can('Air blast dash', { player: p({ dashRecovery: 0.4 }) })).toBe(false)
  })

  it('withholds the air scooter in mid-air', () => {
    expect(can('Air scooter', { player: p({ grounded: false }) })).toBe(false)
  })

  it('offers jumping while standing and not while airborne', () => {
    expect(can('Jump')).toBe(true)
    expect(can('Jump', { player: p({ grounded: false }) })).toBe(false)
  })
})

describe('the double jump and the deploy are mutually exclusive', () => {
  it('offers the double jump with the air jump unspent, and the deploy only once spent', () => {
    // Asserted as a pair on purpose. Tested apart, an implementation where BOTH are
    // always true would pass each test individually — and that is exactly the bug,
    // because the escalation chain is the whole reason the combo takes two presses.
    const unspent = { player: p({ grounded: false, airJumpsUsed: 0 }) }
    const spent = {
      player: p({ grounded: false, airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps }),
    }
    expect(can('Double jump', unspent)).toBe(true)
    expect(can('Deploy the glider', unspent)).toBe(false)
    expect(can('Double jump', spent)).toBe(false)
    expect(can('Deploy the glider', spent)).toBe(true)
  })
})

describe('availability in the air', () => {
  const gliding = (over: Partial<PlayerState> = {}) =>
    ({ player: p({ mode: 'glider', grounded: false, ...over }) })

  it('offers thrust and hover while there is breath', () => {
    expect(can('Airbending thrust', gliding())).toBe(true)
    expect(can('Hover', gliding())).toBe(true)
  })

  it('withholds thrust and hover at empty breath', () => {
    expect(can('Airbending thrust', gliding({ breath: 0 }))).toBe(false)
    expect(can('Hover', gliding({ breath: 0 }))).toBe(false)
  })

  it('withholds thrust on the ground', () => {
    expect(can('Airbending thrust')).toBe(false)
  })
})

describe('the Pressure Wave', () => {
  const wave = DEFAULT_COMBAT_CONFIG.pressureWave

  it('is unavailable while standing on the ground', () => {
    expect(can('Pressure Wave')).toBe(false)
  })

  it('is unavailable falling slower than the slam threshold', () => {
    expect(can('Pressure Wave', {
      player: p({ grounded: false, velocity: new Vector3(0, -(wave.minImpactSpeed - 2), 0) }),
    })).toBe(false)
  })

  it('is available falling faster than the slam threshold', () => {
    expect(can('Pressure Wave', {
      player: p({ grounded: false, velocity: new Vector3(0, -(wave.minImpactSpeed + 10), 0) }),
    })).toBe(true)
  })

  it('is unavailable while rising, however fast', () => {
    expect(can('Pressure Wave', {
      player: p({ grounded: false, velocity: new Vector3(0, 40, 0) }),
    })).toBe(false)
  })
})

describe('actions owned by other systems', () => {
  it('follows the gust readiness it is handed', () => {
    expect(can('Gust', { gustReady: true })).toBe(true)
    expect(can('Gust', { gustReady: false })).toBe(false)
  })

  it('follows the Avatar State readiness it is handed', () => {
    expect(can('Avatar State', { avatarStateReady: true })).toBe(true)
    expect(can('Avatar State', { avatarStateReady: false })).toBe(false)
  })

  it('always offers this guide', () => {
    expect(can('This guide')).toBe(true)
    expect(can('This guide', { player: p({ mode: 'glider', grounded: false }) })).toBe(true)
  })
})

/**
 * The keys the README's controls table documents.
 *
 * Every key in that table is in backticks except `Mouse`, which is bare, so backticks
 * are stripped when present rather than required — otherwise the test fails on a row
 * that is perfectly correct. Compound cells like "`W` / `S`" split into their parts, so
 * both sides of the comparison are individual physical keys.
 */
function readmeKeys(): string[] {
  const lines = readFileSync(README, 'utf8').split('\n')
  const header = lines.findIndex((line) => line.startsWith('| Input'))
  if (header < 0) throw new Error('no controls table found in README.md')

  const keys: string[] = []
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break
    const cell = line.split('|')[1]
    if (cell === undefined) continue
    for (const part of cell.split('/')) {
      const key = part.trim().replace(/`/g, '')
      if (key.length > 0) keys.push(key)
    }
  }
  return [...new Set(keys)].sort()
}
