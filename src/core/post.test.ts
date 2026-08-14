import { describe, expect, it } from 'vitest'
import { postEffects } from './post'
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

  it('puts antialiasing last', () => {
    // SMAA reads the composited image. Ahead of the grade or the bloom it would smooth an
    // image that is then re-brightened, and the edges it fixed would come back.
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
