import { describe, expect, it } from 'vitest'
import { freshChain, isFinisher, landChain, stepChain, type ChainConfig } from './chain'

const C: ChainConfig = { maxLinks: 3, windowSeconds: 0.9 }
const advance = (state = freshChain(), seconds = 0, c = C) => {
  let s = state
  for (let t = 0; t < seconds; t += 1 / 60) s = stepChain(s, 1 / 60, c)
  return s
}

describe('the chain', () => {
  it('starts empty', () => {
    expect(freshChain()).toEqual({ links: 0, sinceLink: 0 })
  })

  it('counts a landing', () => {
    expect(landChain(freshChain(), C).links).toBe(1)
  })

  it('resets the window on every landing', () => {
    const stale = advance(landChain(freshChain(), C), 0.5)
    expect(stale.sinceLink).toBeGreaterThan(0)
    expect(landChain(stale, C).sinceLink).toBe(0)
  })

  it('expires the string once the window lapses', () => {
    const one = landChain(freshChain(), C)
    expect(advance(one, C.windowSeconds - 0.05).links).toBe(1)
    expect(advance(one, C.windowSeconds + 0.05).links).toBe(0)
  })

  it('spends the string on the landing that completes it', () => {
    // Replaces an earlier test that asserted the string *capped* at maxLinks and that a further
    // landing did not overflow it. That capped state was the balance defect: it reset `sinceLink`
    // on every landing while still answering `isFinisher`, so a player who kept landing blows
    // inside the window held a permanent finisher. See `landChain`.
    let s = freshChain()
    for (let i = 0; i < C.maxLinks - 1; i++) s = landChain(s, C)
    expect(s.links).toBe(C.maxLinks - 1)
    expect(landChain(s, C)).toEqual(freshChain())
  })

  it('never stands at the cap, however many blows land', () => {
    // The other half of the claim above: there is no reachable state with a completed string in
    // it, so nothing downstream can hold one.
    let s = freshChain()
    for (let i = 0; i < C.maxLinks * 3; i++) {
      s = landChain(s, C)
      expect(s.links).toBeLessThan(C.maxLinks)
    }
  })

  it('is a finisher on exactly the completing landing', () => {
    // Read *before* each landing, because `landChain` spends the string on the completing one and
    // a completed string is therefore never a state to read it off. The loop walks the string up
    // to one short of the cap, asserting the answer is no every time, then asserts it is yes for
    // the landing that would complete it.
    let s = freshChain()
    for (let i = 0; i < C.maxLinks - 1; i++) {
      expect(isFinisher(s, C)).toBe(false)
      s = landChain(s, C)
    }
    expect(isFinisher(s, C)).toBe(true)
  })

  it('is not a finisher once the string has expired', () => {
    // A string one landing short of the finisher, left to lapse. Previously this built a *whole*
    // string and let it expire, which the consumption rule makes unbuildable — there is no
    // completed string to age.
    let s = freshChain()
    for (let i = 0; i < C.maxLinks - 1; i++) s = landChain(s, C)
    expect(isFinisher(s, C)).toBe(true)
    expect(isFinisher(advance(s, C.windowSeconds + 0.05), C)).toBe(false)
  })

  it('makes the next finisher cost a whole string again', () => {
    // The plateau's absence, stated end to end: spend a finisher, and the landing straight after
    // it is the first link of a new string rather than another finisher.
    let s = freshChain()
    for (let i = 0; i < C.maxLinks - 1; i++) s = landChain(s, C)
    s = landChain(s, C)
    expect(isFinisher(s, C)).toBe(false)
    expect(landChain(s, C).links).toBe(1)
  })

  it('carries no element, which is what makes a swap free', () => {
    // The Ghost of Yotei property is structural rather than a rule enforced somewhere:
    // there is nothing in this state for an element switch to invalidate. If a future
    // change adds an element field here, this test is the one that should stop it.
    expect(Object.keys(landChain(freshChain(), C)).sort()).toEqual(['links', 'sinceLink'])
  })

  it('never advances on a bare step', () => {
    expect(advance(freshChain(), 5).links).toBe(0)
  })
})
