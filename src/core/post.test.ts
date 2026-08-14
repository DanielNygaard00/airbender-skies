import { describe, expect, it } from 'vitest'
import { postEffects, postPasses } from './post'
import { profileFor, QUALITIES } from './quality'

describe('the pass list', () => {
  it('is empty on a tier that bypasses the composer', () => {
    for (const q of QUALITIES) {
      const p = profileFor(q)
      if (!p.composer) expect(postEffects(p)).toEqual([])
    }
  })

  it('tone maps whenever the composer runs', () => {
    // The other half of toneMappingOwner: if the composer is on, ACES must be in the pass
    // list, or the renderer has handed tone mapping away to nobody.
    for (const q of QUALITIES) {
      const p = profileFor(q)
      if (p.composer) expect(postEffects(p)).toContain('tone-mapping')
    }
  })

  it('asks for antialiasing last', () => {
    // The *intent*. This list is not the shipped order on its own — `EffectPass` re-sorts the
    // effects inside one pass by attribute bitmask, and SMAA's is the highest of the four, so
    // a single merged pass would run it first. What makes the order below real is the pass
    // split, and "the pass split" describe block is where that is pinned.
    const list = postEffects(profileFor('high'))
    expect(list[list.length - 1]).toBe('smaa')
  })

  it('orders bloom before the grade', () => {
    const list = postEffects(profileFor('high'))
    expect(list.indexOf('bloom')).toBeLessThan(list.indexOf('grade'))
  })

  it('names nothing twice', () => {
    for (const q of QUALITIES) {
      const list = postEffects(profileFor(q))
      expect(new Set(list).size).toBe(list.length)
    }
  })

  it('asks for exactly what the profile turned on', () => {
    for (const q of QUALITIES) {
      const p = profileFor(q)
      const list = postEffects(p)
      expect(list.includes('bloom')).toBe(p.bloom)
      expect(list.includes('grade')).toBe(p.grade)
      expect(list.includes('smaa')).toBe(p.smaa)
    }
  })
})

describe('the pass split', () => {
  it('gives antialiasing a pass of its own, after everything else', () => {
    // The load-bearing test of the ordering. `EffectPass.setEffects` sorts the effects handed
    // to one pass by attribute bitmask descending: SMAA declares CONVOLUTION | DEPTH (3) and
    // every colour effect declares NONE (0), so merging SMAA with them runs it *first*. A
    // separate pass added afterwards is the only thing that makes "antialiasing last" true,
    // so putting SMAA back into the merged group has to fail here.
    const passes = postPasses(profileFor('high'))
    expect(passes[passes.length - 1]).toEqual(['smaa'])
  })

  it('never merges antialiasing with a colour effect', () => {
    // Stated as an invariant over every tier rather than as a fact about high, because a
    // future tier that turns bloom off must not quietly become "one pass with SMAA in it".
    for (const q of QUALITIES) {
      for (const pass of postPasses(profileFor(q))) {
        if (pass.includes('smaa')) expect(pass).toEqual(['smaa'])
      }
    }
  })

  it('keeps the colour effects in one pass, which is why this library was chosen', () => {
    // The pass-count argument in the module comment. Bloom, the grade and tone mapping share
    // a single fullscreen shader; only antialiasing costs an extra pass. Two, never four.
    const passes = postPasses(profileFor('high'))
    expect(passes.length).toBe(2)
    expect(passes[0]).toEqual(['bloom', 'grade', 'tone-mapping'])
  })

  it('groups exactly the effects the tier asked for, in the same order', () => {
    // The grouping must not drop, duplicate or reorder anything relative to `postEffects` —
    // flattening it has to give the intent back verbatim.
    for (const q of QUALITIES) {
      const p = profileFor(q)
      expect(postPasses(p).flat()).toEqual([...postEffects(p)])
    }
  })

  it('asks for no passes at all on a tier that bypasses the composer', () => {
    // Not "one empty pass": an EffectPass with no effects still costs a fullscreen draw,
    // which is exactly what the cheapest tier cannot spare.
    for (const q of QUALITIES) {
      const p = profileFor(q)
      if (!p.composer) expect(postPasses(p)).toEqual([])
    }
  })
})
