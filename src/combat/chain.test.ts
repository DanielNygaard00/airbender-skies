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

  it('caps at maxLinks, and a further landing does not overflow it', () => {
    let s = freshChain()
    for (let i = 0; i < C.maxLinks + 2; i++) s = landChain(s, C)
    expect(s.links).toBe(C.maxLinks)
  })

  it('is a finisher only at the cap', () => {
    let s = freshChain()
    for (let i = 0; i < C.maxLinks - 1; i++) {
      s = landChain(s, C)
      expect(isFinisher(s, C)).toBe(false)
    }
    expect(isFinisher(landChain(s, C), C)).toBe(true)
  })

  it('is not a finisher once the string has expired', () => {
    let s = freshChain()
    for (let i = 0; i < C.maxLinks; i++) s = landChain(s, C)
    expect(isFinisher(advance(s, C.windowSeconds + 0.05), C)).toBe(false)
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
