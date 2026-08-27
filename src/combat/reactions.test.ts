import { describe, expect, it } from 'vitest'
import { elementOf, SOURCE_ELEMENTS, REACTIONS, reactionFor, type ReactionKind } from './reactions'
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

describe('the reaction table', () => {
  it('rules on every pairing of elements', () => {
    for (const mark of ELEMENT_ORDER) {
      for (const verb of ELEMENT_ORDER) {
        expect(REACTIONS[mark][verb]).toBeDefined()
      }
    }
  })

  it('never reacts an element with itself', () => {
    // Repetition is what the chain rewards. Letting the mark pay for it too would price one
    // press twice.
    for (const element of ELEMENT_ORDER) expect(reactionFor(element, element)).toBe('none')
  })

  it('steams water then fire', () => {
    expect(reactionFor('water', 'fire')).toBe('steam')
  })

  it('muds water then earth', () => {
    expect(reactionFor('water', 'earth')).toBe('mud')
  })

  it('is directional', () => {
    // A wet soldier hit by fire steams; a burning soldier hit by water does not. The pairing
    // is ordered, and a table that read the same both ways would be a set, not a sequence.
    expect(reactionFor('fire', 'water')).toBe('none')
    expect(reactionFor('earth', 'water')).toBe('none')
  })

  it('leaves exactly two pairings live, so the inventory step B inherits is closed', () => {
    const live: ReactionKind[] = []
    for (const mark of ELEMENT_ORDER) {
      for (const verb of ELEMENT_ORDER) {
        const kind = REACTIONS[mark][verb]
        if (kind !== 'none') live.push(kind)
      }
    }
    expect(live.sort()).toEqual(['mud', 'steam'])
  })
})
