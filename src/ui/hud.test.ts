import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  formatAltitude, formatAirspeed, breathFraction, hudModelFor, STYLE, VIGNETTE_SCALE_PROPERTY,
} from './hud'
import type { PlayerState } from '../core/types'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, -1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0, coyoteTime: 0, jumpBuffer: 0, scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0, slipstreamElapsed: null, slipstreamCooldown: 0, staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, ...over,
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

describe('the stall warning', () => {
  it('is nothing when the caller does not pass one', () => {
    expect(hudModelFor(p()).stall).toBe(0)
  })

  it('passes a fraction through', () => {
    expect(hudModelFor(p(), undefined, undefined, 0, 0.7).stall).toBeCloseTo(0.7)
  })

  it('clamps out of range values', () => {
    expect(hudModelFor(p(), undefined, undefined, 0, 3).stall).toBe(1)
    expect(hudModelFor(p(), undefined, undefined, 0, -1).stall).toBe(0)
  })

  it('turns a non-finite value into nothing rather than a broken colour', () => {
    expect(hudModelFor(p(), undefined, undefined, 0, Number.NaN).stall).toBe(0)
  })

  it('does not disturb the hurt flash or the fade beside it', () => {
    // All three are trailing optional numbers, which is exactly the shape where two
    // arguments get swapped and nothing complains. Three distinct values in one call, so
    // any transposition shows up here rather than on screen.
    const model = hudModelFor(p(), undefined, undefined, 0.25, 0.75, 0.5)
    expect(model.hurtFlash).toBeCloseTo(0.25)
    expect(model.stall).toBeCloseTo(0.75)
    expect(model.fade).toBeCloseTo(0.5)
  })
})

describe('the hurt flash', () => {
  it('is nothing when the caller does not pass one', () => {
    // Optional on purpose: every existing call site and test keeps working, which is
    // what keeps this a widening rather than a migration.
    expect(hudModelFor(p()).hurtFlash).toBe(0)
  })

  it('passes a fraction through', () => {
    expect(hudModelFor(p(), undefined, undefined, 0.6).hurtFlash).toBeCloseTo(0.6)
  })

  it('clamps out of range values, so the overlay cannot go opaque', () => {
    expect(hudModelFor(p(), undefined, undefined, 4).hurtFlash).toBe(1)
    expect(hudModelFor(p(), undefined, undefined, -2).hurtFlash).toBe(0)
  })

  it('turns a non-finite flash into nothing rather than into a broken opacity', () => {
    expect(hudModelFor(p(), undefined, undefined, Number.NaN).hurtFlash).toBe(0)
  })
})

describe('the downed fade', () => {
  it('is clear when no fade is given', () => {
    expect(hudModelFor(p()).fade).toBe(0)
  })

  it('passes a mid fade through', () => {
    expect(hudModelFor(p(), undefined, undefined, 0, 0, 0.4).fade).toBeCloseTo(0.4)
  })

  it('clamps a fade above one', () => {
    expect(hudModelFor(p(), undefined, undefined, 0, 0, 4).fade).toBe(1)
  })

  it('never lets a non-finite fade reach the DOM', () => {
    // Same rule the focus fractions follow: opacity is written straight into a style.
    expect(hudModelFor(p(), undefined, undefined, 0, 0, NaN).fade).toBe(0)
  })
})

describe('the Avatar State vignette rule', () => {
  it('reads its opacity from the custom property main.ts writes, with a fallback of 1', () => {
    // The one behaviour in this stylesheet a node test can hold onto. reduce-motion softens
    // the gold rim by writing VIGNETTE_SCALE_PROPERTY on the root element in main.ts; if
    // this rule stops reading it, the rim goes back to full strength under reduce motion
    // and nothing else changes — no error, no visual difference in the normal case, and
    // main.ts has no tests of its own. The property name comes from the shared constant on
    // both sides, so what is left to assert is that the rule still reads it at all.
    expect(STYLE).toContain(`.hud-vignette.is-on { opacity: var(${VIGNETTE_SCALE_PROPERTY}, 1); }`)
  })
})
