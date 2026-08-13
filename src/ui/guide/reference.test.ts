import { describe, it, expect } from 'vitest'
import { COMBOS, ELEMENT_LEGEND, METERS, WIND_LEGEND, SCREEN_MARKS } from './reference'
import { actionKeys } from './actions'
import { ELEMENT_ORDER } from '../../elements/element'
import { ARCHIPELAGO } from '../../world/levels/archipelago'

describe('COMBOS', () => {
  it('only names keys the game actually has', () => {
    // A combo citing a key that does not exist is a lie a tester would chase.
    const known = actionKeys()
    for (const combo of COMBOS) {
      for (const key of combo.keys) {
        expect(known, `combo "${combo.name}" names unknown key "${key}"`).toContain(key)
      }
    }
  })

  it('gives every combo a name, keys and a detail', () => {
    expect(COMBOS.length).toBeGreaterThan(0)
    for (const combo of COMBOS) {
      expect(combo.name.length).toBeGreaterThan(0)
      expect(combo.keys.length).toBeGreaterThan(0)
      expect(combo.detail.length).toBeGreaterThan(0)
    }
  })
})

describe('METERS', () => {
  it('explains all three bars on the HUD', () => {
    // The HUD draws three unlabelled bars; leaving one unexplained is the gap this
    // section exists to close.
    expect(METERS.map((m) => m.name)).toEqual(['Breath', 'Focus', 'Health'])
  })

  it('gives every meter a detail', () => {
    for (const meter of METERS) expect(meter.detail.length).toBeGreaterThan(0)
  })
})

describe('SCREEN_MARKS', () => {
  it('explains both rings drawn around the crosshair', () => {
    // Two entries, because there are two rings and the whole purpose of this list is
    // telling them apart. A test on `length` alone would pass a list with two copies of
    // one entry, so the names are asserted too.
    expect(SCREEN_MARKS.map((mark) => mark.name)).toEqual(['Hit direction', 'Threats off screen'])
  })

  it('names each ring\'s colour, so the legend can be matched to the screen at all', () => {
    // Not because colour is the thing that distinguishes the two rings — measured, the two
    // hues are 5.6 degrees apart, and the hollow-V-versus-filled-wedge shape plus the 10 px
    // radial gap are what a glance actually resolves. It is because a legend that described
    // the behaviour without naming any appearance at all would leave the player matching
    // prose to shapes with nothing to key on. Both entries name a shape as well, and this
    // pins the colour half of that.
    expect(SCREEN_MARKS[0]?.detail).toMatch(/orange/)
    expect(SCREEN_MARKS[1]?.detail).toMatch(/red/)
  })
})

describe('WIND_LEGEND', () => {
  it('labels every wind kind the level actually places', () => {
    // Type-level exhaustiveness already forces an entry per WindKind. This checks the
    // other direction: that the kinds the archipelago really uses are all described.
    for (const def of ARCHIPELAGO.winds ?? []) {
      expect(WIND_LEGEND[def.kind]?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('describes which way each kind pushes', () => {
    for (const [kind, text] of Object.entries(WIND_LEGEND)) {
      expect(text.length, `${kind} has no description`).toBeGreaterThan(0)
    }
  })
})

describe('ELEMENT_LEGEND', () => {
  it('describes every element the radial can select', () => {
    // Type-level exhaustiveness over `Element` already forces an entry per element, which is the
    // real guard — a fourth element fails to compile until it is described. This checks the other
    // direction: that each entry actually says something, since a Record satisfied with empty
    // strings would type-check and ship an element with a key and no explanation.
    for (const element of ELEMENT_ORDER) {
      expect(ELEMENT_LEGEND[element]?.length ?? 0, element).toBeGreaterThan(40)
    }
  })

  it('names the radial direction and the number bind for each element', () => {
    // The legend is the only place the layout is written down in prose, and the layout is what the
    // whole design leans on — fixed slots so a flick direction means the same thing every session.
    // A legend that described the elements without saying where they are would leave the player
    // hunting for them mid-fight, which is when the radial is used.
    //
    // Water's line used to claim "straight down", which was true while there were two elements and
    // stopped being true the moment earth was appended: three sectors of 120 degrees put water at
    // down-and-right and earth at down-and-left, and straight down became a boundary belonging to
    // neither. That is the failure this block exists to catch, and it caught it — so the
    // directions are named per element here rather than looped, deliberately, because each one is a
    // separate claim about a separate wedge and a loop could only check that *some* direction was
    // mentioned.
    // Each claim is tied to the slot the element actually occupies, rather than only to the prose.
    // Mutation found that checking the words alone cannot fail for a *reordered* `ELEMENT_ORDER`:
    // swapping water and earth leaves both sentences untouched and both of them wrong, since the
    // wedge geometry is numbered straight off that array. Asserting the index beside the phrase is
    // what makes this block a statement about the radial and not about the paragraph.
    const claims = [
      { element: 'air' as const, index: 0, phrase: /straight up/i, bind: /1/ },
      { element: 'water' as const, index: 1, phrase: /down and to the right/i, bind: /2/ },
      { element: 'earth' as const, index: 2, phrase: /down and to the left/i, bind: /3/ },
    ]
    // Every element is claimed, so a fourth one cannot arrive undescribed by this block either.
    expect(claims.map((c) => c.element)).toEqual([...ELEMENT_ORDER])
    for (const { element, index, phrase, bind } of claims) {
      expect(ELEMENT_ORDER.indexOf(element), `${element}'s wedge`).toBe(index)
      expect(ELEMENT_LEGEND[element], `${element}'s direction`).toMatch(phrase)
      expect(ELEMENT_LEGEND[element], `${element}'s number bind`).toMatch(bind)
    }
    // Nothing may claim straight down any more, in any entry. The bare direction is the one a
    // reader carrying the old two-element layout in their head would reach for, and
    // `element.test.ts` pins that it is a sector boundary rather than an element's own direction.
    for (const element of ELEMENT_ORDER) {
      expect(ELEMENT_LEGEND[element], element).not.toMatch(/straight down/i)
    }
  })

  it('says water does no damage, which is the one thing a player must not guess wrong', () => {
    // Water is the control element and reaching for it as a damage tool is the mistake the whole
    // kit is built to make fail. If the guide does not say so, the player learns it by losing a
    // fight slowly.
    expect(ELEMENT_LEGEND.water).toMatch(/no damage/i)
  })

  it('says earth breaks armour, which is the other thing a player must not guess wrong', () => {
    // The mirror of the water assertion above, and the reason is the same shape. Section 4.4 makes
    // earth the designed answer to the heavy armoured soldier, and a player who does not know that
    // has no answer to it at all except a dive they may not have the height for — so they would
    // grind at plate with a staff, which the numbers deliberately make almost futile. The one fact
    // that has to survive from the design document into the player's hands is that earth is the
    // thing that breaks armour.
    expect(ELEMENT_LEGEND.earth).toMatch(/armour|armor/i)
  })
})
