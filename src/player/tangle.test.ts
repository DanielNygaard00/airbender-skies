import { describe, it, expect } from 'vitest'
import { applyTangle, isTangled, stepTangle } from './tangle'

describe('whether the wings are refused', () => {
  it('says no with nothing owed', () => {
    expect(isTangled({ tangled: 0 })).toBe(false)
  })

  it('says yes with any time left at all', () => {
    expect(isTangled({ tangled: 0.001 })).toBe(true)
  })

  it('treats a corrupt countdown as free rather than as locked', () => {
    // The direction matters. `hudModelFor` asks the same `> 0` question, so both fail the same
    // way and the tell cannot end up contradicting the gate — and a player left permanently
    // unable to fly by a NaN would be a game-ending bug where a player who can fly is not.
    expect(isTangled({ tangled: Number.NaN })).toBe(false)
  })
})

describe('a fresh net arriving', () => {
  it('starts the countdown from nothing', () => {
    expect(applyTangle(0, 2)).toBe(2)
  })

  it('takes the longer of what is owed and what just landed', () => {
    // The whole rule. Two nets a frame apart cost one refusal, not two — the mechanic is priced
    // in seconds of being unable to fly, and a group of netters stacking into six seconds on the
    // ground over open sky is a death sentence none of them individually threatened.
    expect(applyTangle(1.4, 2)).toBe(2)
  })

  it('does not shorten a refusal already running', () => {
    // The other side of `Math.max`, and the direction a plain assignment would get wrong: a
    // second net landing late in a long refusal must not reset it to its own shorter value and
    // hand the player their wings back early as a *reward* for being hit again.
    expect(applyTangle(2, 0.5)).toBe(2)
  })

  it('ignores a net that carries no refusal', () => {
    // An arrow's payload is 0, and `stepEncounter` reports 0 on almost every frame. Neither may
    // disturb a countdown in progress.
    expect(applyTangle(1.25, 0)).toBe(1.25)
  })

  it('ignores a negative payload rather than trusting it', () => {
    expect(applyTangle(1.25, -5)).toBe(1.25)
  })

  it('discards a non-finite payload instead of laundering it into the state', () => {
    // `isFinitePlayer` does watch `PlayerState.tangled`, so a NaN would respawn the player rather
    // than corrupt them — but respawning because a net landed is a worse outcome than ignoring
    // one impossible net.
    expect(applyTangle(1.5, Number.NaN)).toBe(1.5)
    expect(applyTangle(1.5, Number.POSITIVE_INFINITY)).toBe(1.5)
  })

  it('recovers from a corrupt countdown instead of propagating it', () => {
    expect(applyTangle(Number.NaN, 2)).toBe(2)
    // And with nothing incoming, a corrupt countdown resolves to free rather than to NaN.
    expect(applyTangle(Number.NaN, 0)).toBe(0)
  })

  it('never reports a negative countdown, however it was reached', () => {
    expect(applyTangle(-3, 0)).toBe(0)
  })
})

describe('counting the refusal down', () => {
  it('takes the frame off', () => {
    expect(stepTangle(2, 0.25)).toBeCloseTo(1.75, 10)
  })

  it('stops at zero rather than going negative', () => {
    // `isTangled` is a `> 0` test, so a deeply negative value would be indistinguishable from
    // zero to every reader while quietly being a different number in a log or a save.
    expect(stepTangle(0.1, 1)).toBe(0)
    expect(stepTangle(0, 1)).toBe(0)
  })

  it('leaves the countdown alone on a frame with no time in it', () => {
    expect(stepTangle(1.5, 0)).toBe(1.5)
    expect(stepTangle(1.5, -1)).toBe(1.5)
    expect(stepTangle(1.5, Number.NaN)).toBe(1.5)
  })

  it('clears a corrupt countdown rather than carrying it forward', () => {
    expect(stepTangle(Number.NaN, 1 / 60)).toBe(0)
  })

  it('expires within a frame of the seconds it was given, at sixty frames a second', () => {
    // The property that makes the shipped `tangleSeconds` mean what `config.ts` says it means.
    // Stepped frame by frame rather than in one jump, because that is how the controller does it
    // and because an accumulation error would show here and nowhere else.
    //
    // The measured answer is 121 frames rather than the arithmetic 120, and the extra frame is
    // floating point rather than an off-by-one: `1 / 60` is not representable, and 120 subtractions
    // of it leave about 2e-14 seconds on the clock, which `isTangled`'s `> 0` correctly reports as
    // still owed. Both bounds are pinned rather than the exact figure, so the assertion states the
    // thing that matters — the refusal lasts its two seconds and not two and a half — while
    // staying honest about the residue.
    let held = applyTangle(0, 2)
    let frames = 0
    while (isTangled({ tangled: held }) && frames < 600) {
      held = stepTangle(held, 1 / 60)
      frames++
    }
    expect(frames).toBeGreaterThanOrEqual(120)
    expect(frames).toBeLessThanOrEqual(121)
  })
})
