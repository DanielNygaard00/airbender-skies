import { describe, it, expect } from 'vitest'
import { impactTargets, type ImpactLists } from './impact-targets'
import { impactShape } from './impact'

const lists = (over: Partial<ImpactLists> = {}): ImpactLists => ({
  hits: [], slamHits: [], staffHits: [], stoneHits: [], redirectHits: [], downed: [],
  deflected: [], ...over,
})

describe('the union of everything that connected', () => {
  it('sparks a gust connect', () => {
    expect(impactTargets(lists({ hits: ['a'] })).hits).toEqual(['a'])
  })

  it('sparks a slam connect', () => {
    expect(impactTargets(lists({ slamHits: ['a'] })).hits).toEqual(['a'])
  })

  it('sparks a staff connect', () => {
    // The regression this module exists for. `main.ts` built its impact list from the
    // gust and slam lists only, so the staff was the one attack in the game with no
    // hit spark -- and a staff swing that downed a soldier still sparked, through the
    // separate downed loop, which is what hid it.
    expect(impactTargets(lists({ staffHits: ['a'] })).hits).toEqual(['a'])
  })

  it('sparks a thrown stone', () => {
    // The other list that pays no Focus, and the same hazard as `redirectHits` below: a list left
    // out of the Focus grants is a list it is easy to leave out of the union as well, and this one
    // is the hardest-hitting single press in the borrowed elements.
    expect(impactTargets(lists({ stoneHits: ['a'] })).hits).toEqual(['a'])
  })

  it('sparks a soldier struck by a redirected arrow', () => {
    // The one list here that pays no Focus, so it would be easy to leave out of the union as
    // well — and a soldier taking an arrow it fired with no burst at all is the single event in
    // the fight a player most needs to see land.
    expect(impactTargets(lists({ redirectHits: ['a'] })).hits).toEqual(['a'])
  })

  it('sparks one enemy once when two attacks land on it in a frame', () => {
    const targets = impactTargets(lists({ hits: ['a'], staffHits: ['a'], slamHits: ['a'] }))
    expect(targets.hits).toEqual(['a'])
  })

  it('keeps every distinct enemy', () => {
    const targets = impactTargets(lists({ hits: ['a'], staffHits: ['b'], slamHits: ['c'] }))
    expect([...targets.hits].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('a down is the louder statement', () => {
  it('gives an enemy that both took a hit and went down only the down', () => {
    const targets = impactTargets(lists({ hits: ['a'], staffHits: ['a'], downed: ['a'] }))
    expect(targets.downs).toEqual(['a'])
    expect(targets.hits).toEqual([])
  })

  it('still sparks the others in the same frame', () => {
    const targets = impactTargets(lists({ hits: ['a', 'b'], downed: ['b'] }))
    expect(targets.hits).toEqual(['a'])
    expect(targets.downs).toEqual(['b'])
  })

  it('deduplicates the downed list too', () => {
    expect(impactTargets(lists({ downed: ['a', 'a'] })).downs).toEqual(['a'])
  })

  it('produces nothing from nothing', () => {
    const targets = impactTargets(lists())
    expect(targets.hits).toEqual([])
    expect(targets.downs).toEqual([])
    expect(targets.deflects).toEqual([])
  })
})

describe('a blow that bounced off armour', () => {
  it('sparks a deflect of its own', () => {
    const targets = impactTargets(lists({ deflected: ['a'] }))
    expect(targets.deflects).toEqual(['a'])
    // And not as a hit. A deflect that leaked into the hit list would draw the connect burst and
    // play the impact thud for a move that did nothing, which is worse than silence: it tells the
    // player the gust is working.
    expect(targets.hits).toEqual([])
  })

  it('deduplicates, so a soldier that bounced two blows clangs once', () => {
    expect(impactTargets(lists({ deflected: ['a', 'a'] })).deflects).toEqual(['a'])
  })

  it('yields to a real hit on the same soldier in the same frame', () => {
    // The cross-move case, and the only one that needs a precedence rule: a gust and a staff
    // finisher can both land on one heavy on one frame, and the gust bounces while the staff
    // bites. Something did happen to that soldier, so drawing a "nothing happened" spark over the
    // connect would contradict it and the player would have to guess which burst to believe.
    const targets = impactTargets(lists({ staffHits: ['a'], deflected: ['a'] }))
    expect(targets.hits).toEqual(['a'])
    expect(targets.deflects).toEqual([])
  })

  it('yields to a down on the same soldier too', () => {
    const targets = impactTargets(lists({ downed: ['a'], deflected: ['a'] }))
    expect(targets.downs).toEqual(['a'])
    expect(targets.deflects).toEqual([])
    expect(targets.hits).toEqual([])
  })

  it('still clangs for a different soldier in the same frame', () => {
    // The control on the two precedence tests above: they must not be satisfied by a deflect list
    // that is simply always emptied. One gust across two soldiers, one of them armoured.
    const targets = impactTargets(lists({ hits: ['a'], deflected: ['b'] }))
    expect(targets.hits).toEqual(['a'])
    expect(targets.deflects).toEqual(['b'])
  })
})

describe('the three bursts read as three different events', () => {
  it('draws a deflect smaller and shorter than a connect', () => {
    // The one thing this burst must not do is read as a weaker connect -- that would teach the
    // player the gust is working badly rather than not working at all. Asserted as comparisons
    // against `hit` rather than against literals, so retuning the connect drags the deflect with
    // it instead of letting the two cross over.
    expect(impactShape('deflect').radius).toBeLessThan(impactShape('hit').radius)
    expect(impactShape('deflect').lifetime).toBeLessThan(impactShape('hit').lifetime)
    // And brighter at its peak, which is the half that makes it read as a spark off metal rather
    // than as a smaller puff of air.
    expect(impactShape('deflect').opacity).toBeGreaterThan(impactShape('hit').opacity)
  })

  it('gives all three their own tint', () => {
    const tints = new Set(
      (['hit', 'down', 'deflect'] as const).map((kind) => impactShape(kind).tint),
    )
    expect(tints.size).toBe(3)
  })
})

describe('a returned arrow against armour', () => {
  // One case, and only one, because the block above already pins deflect-versus-hit precedence,
  // the down override and the different-soldier control. What none of them can reach is the
  // pairing that exists only because the Air Wall and the heavy armoured soldier landed in the
  // same game: `redirectHits` is the newer of the two lists and was not in the union the
  // precedence rule was written against.
  it('reports the strike rather than the shrug, when one frame is both', () => {
    // A body that shrugged off a gust and took a deflected arrow on the same frame. The arrow
    // landing outranks the gust not landing, so exactly one tell draws.
    const both = impactTargets(lists({ redirectHits: ['a'], deflected: ['a'] }))
    expect(both.hits).toEqual(['a'])
    expect(both.deflects).toEqual([])
  })
})
