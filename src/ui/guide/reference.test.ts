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
  it('explains all three bars on the HUD, and the pip row beside them', () => {
    // The HUD draws three unlabelled bars; leaving one unexplained is the gap this
    // section exists to close. Fire's charges join the list as the fourth entry and the only one
    // that is not a bar, because they are drawn in the same bottom-left stack and answer the same
    // question the bars do — how much of something is left. Asserted as the whole list in order, so
    // a new HUD element cannot be added to the screen without being described here.
    expect(METERS.map((m) => m.name)).toEqual(['Breath', 'Focus', 'Fire charges', 'Health'])
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

  it('names each element\'s own number bind, derived from the order rather than transcribed', () => {
    // The legend is the only place the layout is written down in prose, and the layout is what the
    // whole design leans on — fixed slots, so a flick means the same thing every session. A legend
    // that described the elements without saying where they are would leave the player hunting for
    // them mid-fight, which is when the radial is used.
    //
    // **The digit is computed from `ELEMENT_ORDER`, and that is what makes this test able to fail
    // for the right reason.** It used to assert "straight down" and "2" for water as literals, and
    // appending fire silently made the direction wrong while the digit stayed right by luck. Read
    // this way, an element whose prose claims a slot it no longer occupies reddens here — which is
    // exactly the mistake the next append will make, since the last element in the array is the one
    // whose digit changes.
    ELEMENT_ORDER.forEach((element, index) => {
      expect(ELEMENT_LEGEND[element], element).toContain(String(index + 1))
    })
    // Air is the one element allowed to name an absolute direction, because slot 0 is the only slot
    // that does not move when the count changes. Every other entry says "clockwise from air"
    // instead — see the note on ELEMENT_LEGEND.
    expect(ELEMENT_LEGEND.air).toMatch(/straight up/i)
    for (const element of ELEMENT_ORDER) {
      if (element === 'air') continue
      expect(ELEMENT_LEGEND[element], element).toMatch(/clockwise/i)
      expect(ELEMENT_LEGEND[element], element).not.toMatch(/straight (up|down|left|right)/i)
    }
  })

  it('says fire is rationed and how it comes back, which is the rule nothing else teaches', () => {
    // The two facts a player cannot discover by pressing the key. That fire hurts is obvious the first
    // time a burst lands; that it is three charges and that *landing* is the only thing that refills
    // them is invisible until the pips run out mid-flight, which is the worst possible moment to be
    // learning it. The guide is the only place either is written down.
    expect(ELEMENT_LEGEND.fire).toMatch(/three charges/i)
    expect(ELEMENT_LEGEND.fire).toMatch(/ground/i)
  })

  it('says water does no damage, which is the one thing a player must not guess wrong', () => {
    // Water is the control element and reaching for it as a damage tool is the mistake the whole
    // kit is built to make fail. If the guide does not say so, the player learns it by losing a
    // fight slowly.
    expect(ELEMENT_LEGEND.water).toMatch(/no damage/i)
  })
})
