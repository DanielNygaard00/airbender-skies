import { describe, it, expect } from 'vitest'
import { impactTargets, type ImpactLists } from './impact-targets'

const lists = (over: Partial<ImpactLists> = {}): ImpactLists => ({
  hits: [], slamHits: [], staffHits: [], redirectHits: [], downed: [], ...over,
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
  })
})
