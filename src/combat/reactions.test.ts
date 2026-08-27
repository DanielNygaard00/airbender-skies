import { describe, expect, it } from 'vitest'
import { elementOf, SOURCE_ELEMENTS } from './reactions'
import { ELEMENT_ORDER } from '../elements/element'

describe('which element threw a blow', () => {
  it('maps every bending source', () => {
    // A Record over BendingSource, so a tenth source cannot compile until it is mapped.
    // This test guards the sweeps below rather than the mapping itself.
    const sources = Object.keys(SOURCE_ELEMENTS)
    expect(sources).toHaveLength(9)
    for (const source of sources) expect(elementOf(source as never)).not.toBeUndefined()
  })

  it('assigns the airbending moves to air', () => {
    expect(elementOf('gust')).toBe('air')
    expect(elementOf('vortex')).toBe('air')
    expect(elementOf('wave')).toBe('air')
  })

  it('assigns each borrowed element its own two moves', () => {
    expect(elementOf('grip')).toBe('water')
    expect(elementOf('freeze')).toBe('water')
    expect(elementOf('stone')).toBe('earth')
    expect(elementOf('pillar')).toBe('earth')
    expect(elementOf('burst')).toBe('fire')
  })

  it('gives the staff no element', () => {
    // The staff is a weapon, not a bending verb. It advances the chain and writes no mark:
    // ReactionKind is indexed by Element, so a staff row would mean inventing a fifth element
    // for the one thing the design document keeps separate from bending.
    expect(elementOf('staff')).toBeNull()
  })

  it('covers every element with at least one source', () => {
    const mapped = new Set(Object.values(SOURCE_ELEMENTS))
    for (const element of ELEMENT_ORDER) expect(mapped.has(element)).toBe(true)
  })
})
