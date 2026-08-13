import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Vector3 } from 'three'
import { ACTIONS, actionKeys, type ActionContext } from './actions'
import { DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG } from '../../core/config'
import { DEFAULT_COMBAT_CONFIG } from '../../combat/config'
import type { PlayerState } from '../../core/types'

const README = fileURLToPath(new URL('../../../README.md', import.meta.url))

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0, coyoteTime: 0, jumpBuffer: 0,
  scooterActive: false, scooterCharge: 0, wallRideNormal: null, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, tangled: 0, ...over,
})

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  player: p(),
  ground: DEFAULT_GROUND_CONFIG,
  flight: DEFAULT_FLIGHT_CONFIG,
  wave: DEFAULT_COMBAT_CONFIG.pressureWave,
  gustReady: true,
  avatarStateReady: false,
  vortexReady: true,
  slipstreamReady: true,
  airWallReady: true,
  // Air by default, so every row that predates the element system keeps being asked in the stance
  // it was written for. The water rows are asked with `element: 'water'` explicitly.
  element: 'air',
  gripReady: true,
  iceLockReady: true,
  burstReady: true,
  fireThrustReady: true,
  carryReady: true,
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

describe('the staff', () => {
  it('offers the combo while idle on the ground', () => {
    expect(can('Staff combo')).toBe(true)
  })

  it('withholds the combo while a swing is in flight', () => {
    expect(can('Staff combo', { player: p({ staffElapsed: 0.1 }) })).toBe(false)
  })

  it('withholds the combo during the post-combo recovery', () => {
    expect(can('Staff combo', { player: p({ staffRecovery: 0.2 }) })).toBe(false)
  })

  it('withholds the combo in the glider', () => {
    // Ground only — in the air the staff is a wing, not a weapon.
    expect(can('Staff combo', { player: p({ mode: 'glider', grounded: false }) })).toBe(false)
  })

  it('withholds deploying the glider while the staff is busy, even with the jump spent', () => {
    // The glider IS the staff: mid-combo or still recovering, there is no wing to snap
    // open, so the panel must agree with the controller rather than only checking the
    // jump count.
    expect(can('Deploy the glider', {
      player: p({
        grounded: false, airJumpsUsed: DEFAULT_GROUND_CONFIG.maxAirJumps, staffRecovery: 0.2,
      }),
    })).toBe(false)
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

  it('withholds thrust and hover below the floor, even with breath to spare', () => {
    // breath: 0 above does not actually exercise canBend's floor: it reads false whether
    // canBend is `breath > 0` or `breath >= bendFloor`, so it would not catch hasBreath
    // being wired to the wrong predicate. 10 is nonzero but under DEFAULT_FLIGHT_CONFIG's
    // bendFloor of 15, so this is true under the old rule and false under the real one.
    expect(can('Airbending thrust', gliding({ breath: 10 }))).toBe(false)
    expect(can('Hover', gliding({ breath: 10 }))).toBe(false)
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

  it('follows the vortex readiness it is handed', () => {
    // Every other flag is held true in the false case, so a row that read the wrong one —
    // `ctx.gustReady` copied onto the Vortex entry, say — is caught rather than passing.
    expect(can('Vortex', { vortexReady: true })).toBe(true)
    expect(can('Vortex', {
      vortexReady: false, gustReady: true, slipstreamReady: true, avatarStateReady: true,
    })).toBe(false)
  })

  it('follows the slipstream readiness it is handed', () => {
    expect(can('Slipstream', { slipstreamReady: true })).toBe(true)
    expect(can('Slipstream', {
      slipstreamReady: false, gustReady: true, vortexReady: true, avatarStateReady: true,
    })).toBe(false)
  })

  it('follows the Air Wall readiness it is handed', () => {
    // Every other flag held true in the false case, for the reason the Vortex row above does
    // it: a row that read the wrong flag is caught rather than passing. This row is the most
    // likely to go wrong that way, because `canAirWall` and `canSlipstream` have the same three
    // clauses in the same order and it would be an easy copy to make.
    expect(can('Air Wall', { airWallReady: true })).toBe(true)
    expect(can('Air Wall', {
      airWallReady: false,
      gustReady: true,
      vortexReady: true,
      slipstreamReady: true,
      avatarStateReady: true,
    })).toBe(false)
  })

  it('follows the carry readiness it is handed', () => {
    // Every other flag held true in the false case, the same guard the Vortex and Slipstream
    // rows get: a row wired to `ctx.gustReady` by a copy-paste would pass otherwise.
    expect(can('Pick up or set down a payload', { carryReady: true })).toBe(true)
    expect(can('Pick up or set down a payload', {
      carryReady: false, gustReady: true, vortexReady: true, slipstreamReady: true,
      avatarStateReady: true,
    })).toBe(false)
  })

  it('offers the wall ride only with the scooter up and a tier of charge in hand', () => {
    // The two halves of the entry gate a UI module can honestly check. The third — a
    // near-vertical wall within lateral reach — is a raycast and cannot be answered here, so the
    // row can be lit with no wall in front of the player. That is a deliberate, documented
    // over-report rather than a drift: dimming it would need terrain in the guide.
    expect(can('Wall ride')).toBe(false)
    expect(can('Wall ride', { player: p({ scooterActive: true, scooterCharge: 1 }) })).toBe(true)
    // Charge is a real part of the gate here, not decoration: a rider on a fresh scooter has
    // not yet earned a ride.
    expect(can('Wall ride', {
      player: p({ scooterActive: true, scooterCharge: 0 }),
    })).toBe(false)
    expect(can('Wall ride', {
      player: p({
        scooterActive: true, scooterCharge: DEFAULT_GROUND_CONFIG.wallRideMinCharge - 0.001,
      }),
    })).toBe(false)
    expect(can('Wall ride', {
      player: p({ scooterActive: true, scooterCharge: DEFAULT_GROUND_CONFIG.wallRideMinCharge }),
    })).toBe(true)
  })

  it('never offers the wall ride in the glider', () => {
    // The scooter does not exist up there, so neither does this. Guarded because the predicate
    // reads `scooterActive`, which a glider state can technically still carry.
    expect(can('Wall ride', {
      player: p({ mode: 'glider', grounded: false, scooterActive: true, scooterCharge: 1 }),
    })).toBe(false)
  })

  it('shows the carry row in both columns', () => {
    // 'both' rather than 'ground', even though only a grounded press does anything. The row
    // has to be readable from the glider column, because that is where a player is standing
    // when they wonder why the wing feels heavy.
    expect(action('Pick up or set down a payload').mode).toBe('both')
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

describe('the bending keys follow the selected element', () => {
  it('offers the air moves on air and strikes through the water ones', () => {
    // The question a player opening the panel mid-fight actually has: what do my two bending keys
    // do right now. Asserted as all four rows at once, because an implementation where every row
    // was always available would pass each half individually — and that is exactly the bug, since
    // the panel would then list four moves for two keys with no indication which is live.
    const air = { element: 'air' as const }
    expect(can('Gust', air)).toBe(true)
    expect(can('Vortex', air)).toBe(true)
    expect(can('Water Grip', air)).toBe(false)
    expect(can('Ice Lock', air)).toBe(false)
  })

  it('offers the water moves on water and strikes through the air ones', () => {
    const water = { element: 'water' as const }
    expect(can('Water Grip', water)).toBe(true)
    expect(can('Ice Lock', water)).toBe(true)
    expect(can('Gust', water)).toBe(false)
    expect(can('Vortex', water)).toBe(false)
  })

  it('follows the grip readiness it is handed, on water', () => {
    // Every other flag is held true in the false case, so a row that read the wrong one — the
    // gust's cooldown copied onto the grip entry, say — is caught rather than passing.
    expect(can('Water Grip', { element: 'water', gripReady: true })).toBe(true)
    expect(can('Water Grip', {
      element: 'water', gripReady: false, gustReady: true, vortexReady: true,
      iceLockReady: true, slipstreamReady: true, avatarStateReady: true,
    })).toBe(false)
  })

  it('follows the Ice Lock readiness it is handed, on water', () => {
    expect(can('Ice Lock', { element: 'water', iceLockReady: true })).toBe(true)
    expect(can('Ice Lock', {
      element: 'water', iceLockReady: false, gripReady: true, gustReady: true,
      vortexReady: true, slipstreamReady: true, avatarStateReady: true,
    })).toBe(false)
  })

  it('strikes through a water move even when it is affordable, if air is selected', () => {
    // The element gate and the resource gate are independent, and the element has to win. A row
    // that only checked affordability would tell an airbending player that a freeze is ready.
    expect(can('Ice Lock', { element: 'air', iceLockReady: true })).toBe(false)
    expect(can('Water Grip', { element: 'air', gripReady: true })).toBe(false)
  })

  it('offers the fire moves on fire and strikes through everything else', () => {
    // The third element on the same two keys. All six rows at once, because an implementation where
    // every row was always available would pass each half individually — and that is exactly the bug,
    // since the panel would then list six moves for two keys with no indication which pair is live.
    const fire = { element: 'fire' as const, player: p({ mode: 'glider', grounded: false }) }
    expect(can('Fire Burst', fire)).toBe(true)
    expect(can('Fire Thrust', fire)).toBe(true)
    expect(can('Gust', fire)).toBe(false)
    expect(can('Vortex', fire)).toBe(false)
    expect(can('Water Grip', fire)).toBe(false)
    expect(can('Ice Lock', fire)).toBe(false)
  })

  it('strikes through the fire moves whenever another element is selected', () => {
    // The mirror, and the flags are held true in both cases so a row reading the wrong one is caught
    // rather than passing.
    for (const element of ['air', 'water'] as const) {
      expect(can('Fire Burst', { element, burstReady: true })).toBe(false)
      expect(can('Fire Thrust', {
        element, fireThrustReady: true, player: p({ mode: 'glider', grounded: false }),
      })).toBe(false)
    }
  })

  it('follows the burst readiness it is handed, on fire', () => {
    // Every other flag is held true in the false case, so a row that read the wrong one — the gust's
    // cooldown copied onto the burst entry, say — is caught rather than passing.
    expect(can('Fire Burst', { element: 'fire', burstReady: true })).toBe(true)
    expect(can('Fire Burst', {
      element: 'fire', burstReady: false, gustReady: true, vortexReady: true, gripReady: true,
      iceLockReady: true, fireThrustReady: true, slipstreamReady: true, avatarStateReady: true,
    })).toBe(false)
  })

  it('follows the thrust readiness it is handed, which is what dims it on the ground', () => {
    // The row has to dim exactly when `canFireThrust` refuses, and the posture half of that rule is
    // the owner's ruling that fire does not move the player on the ground. The panel is handed the
    // answer rather than deriving it, so what is pinned here is that it uses the answer.
    const airborne = p({ mode: 'glider', grounded: false })
    expect(can('Fire Thrust', {
      element: 'fire', fireThrustReady: true, player: airborne,
    })).toBe(true)
    expect(can('Fire Thrust', {
      element: 'fire', fireThrustReady: false, player: airborne, burstReady: true,
      gustReady: true, vortexReady: true, gripReady: true, iceLockReady: true,
    })).toBe(false)
  })

  it('lists the thrust in the glider column only, unlike every other bending row', () => {
    // The one asymmetry in the catalogue, and it is the rule rather than an oversight: fire does not
    // move the player on the ground, so a row in the ground column would be offering something that
    // is refused there. Its five siblings are 'both'.
    expect(action('Fire Thrust').mode).toBe('glider')
    for (const name of ['Gust', 'Vortex', 'Water Grip', 'Ice Lock', 'Fire Burst']) {
      expect(action(name).mode, name).toBe('both')
    }
  })

  it('always offers the radial and the direct binds', () => {
    // Switching is free, so these two can never be unavailable — there is no cooldown, no cost and
    // no posture requirement. Checked in both stances, since every other row varies by one or the
    // other.
    for (const element of ['air', 'water', 'fire'] as const) {
      expect(can('Element radial', { element })).toBe(true)
      expect(can('Select element directly', { element })).toBe(true)
      expect(can('Element radial', {
        element, player: p({ mode: 'glider', grounded: false }),
      })).toBe(true)
    }
  })
})
