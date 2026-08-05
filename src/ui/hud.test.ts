import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { formatAltitude, formatAirspeed, breathFraction, hudModelFor } from './hud'
import type { PlayerState } from '../core/types'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, slipstreamElapsed: null, slipstreamCooldown: 0, staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, ...over,
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
    expect(hudModelFor(p({ mode: 'glider', grounded: false })).showBreath).toBe(true)
  })

  it('shows the breath meter when it is not full, even on the ground', () => {
    expect(hudModelFor(p({ breath: 60 })).showBreath).toBe(true)
  })
})

describe('hudModelFor focus', () => {
  it('hides the meter before the player has built anything', () => {
    const model = hudModelFor(p(), undefined, {
      focus: 0, avatarCharge: 0, avatarActive: false,
    })
    expect(model.showFocus).toBe(false)
  })

  it('shows the meter once there is something in it', () => {
    const model = hudModelFor(p(), undefined, {
      focus: 0.02, avatarCharge: 0, avatarActive: false,
    })
    expect(model.showFocus).toBe(true)
  })

  it('shows the meter during the Avatar State even at zero', () => {
    // The state freezes Focus, but an empty bar vanishing mid-state would read as
    // the HUD breaking at the loudest moment in the game.
    const model = hudModelFor(p(), undefined, {
      focus: 0, avatarCharge: 0, avatarActive: true,
    })
    expect(model.showFocus).toBe(true)
  })

  it('clamps a fraction that arrives out of range', () => {
    const model = hudModelFor(p(), undefined, {
      focus: 1.4, avatarCharge: -0.2, avatarActive: false,
    })
    expect(model.focus).toBe(1)
    expect(model.avatarCharge).toBe(0)
  })

  it('never shows a non-finite fraction', () => {
    // These arrive from a division, so a zero maximum upstream must not reach the DOM
    // as a NaN transform.
    const model = hudModelFor(p(), undefined, {
      focus: NaN, avatarCharge: NaN, avatarActive: false,
    })
    expect(model.focus).toBe(0)
    expect(model.avatarCharge).toBe(0)
  })

  it('works with no focus readout at all, for anywhere Focus is not running', () => {
    const model = hudModelFor(p())
    expect(model.focus).toBe(0)
    expect(model.showFocus).toBe(false)
    expect(model.avatarActive).toBe(false)
  })
})

describe('hudModelFor fade', () => {
  it('is clear when no fade is given', () => {
    expect(hudModelFor(p()).fade).toBe(0)
  })

  it('passes a mid fade through', () => {
    expect(hudModelFor(p(), undefined, undefined, 0.4).fade).toBeCloseTo(0.4)
  })

  it('clamps a fade above one', () => {
    expect(hudModelFor(p(), undefined, undefined, 4).fade).toBe(1)
  })

  it('never lets a non-finite fade reach the DOM', () => {
    // Same rule the focus fractions follow: opacity is written straight into a style.
    expect(hudModelFor(p(), undefined, undefined, NaN).fade).toBe(0)
  })
})
