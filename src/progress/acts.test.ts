import { describe, it, expect } from 'vitest'
import {
  ACTS, ACT_THREE_SHRINES, ACT_TWO_SHRINES, UNLOCKED_IN, actFromShrineCount, actFromShrines,
  isUnlocked, type Ability, type Act,
} from './acts'
import { ARCHIPELAGO } from '../world/levels/archipelago'
import { ELEMENT_ORDER } from '../elements/element'

/**
 * The act model, which had no test file at all when this cycle was integrated.
 *
 * That gap mattered more than a missing file usually does: `UNLOCKED_IN` is the single statement
 * of what the player has in hand at any point in the game, and nothing anywhere asserted its
 * contents, its totality, or that `isUnlocked` reads it cumulatively rather than exactly.
 *
 * **Every "locked" assertion here is paired with an "unlocked later" one on the same ability.**
 * That pairing is the whole point: "the Avatar State is unavailable in Act 1" passes just as well
 * for an Avatar State that never works in any act, so on its own it is not evidence of a gate.
 */
describe('the unlock table', () => {
  it('names an act for every ability, and no act outside the three', () => {
    // The compile already forces the Record to be total, so this is about the *values*: an
    // ability mapped to an act the game does not have would gate it forever.
    for (const ability of Object.keys(UNLOCKED_IN) as Ability[]) {
      expect(ACTS).toContain(UNLOCKED_IN[ability])
    }
  })

  it('covers every element that exists, so an element cannot ship ungated', () => {
    // The contract water's design note promised and this cycle owes: adding an element to
    // `ELEMENT_ORDER` must not be possible without deciding its act. The Record's totality is
    // what enforces it at compile time; this asserts the two lists have not drifted apart by
    // some other route, such as an element added to the union but not to the order.
    for (const element of ELEMENT_ORDER) {
      expect(UNLOCKED_IN[element]).toBeDefined()
    }
  })

  it('never withholds air, which is the baseline the whole kit assumes', () => {
    // Section 2.3 of the water design note states this as an invariant: "Air is never gated."
    // Asserted at Act 1 specifically, because a player in Act 1 with no element at all would
    // have no attack whatsoever.
    expect(UNLOCKED_IN.air).toBe(1)
    expect(isUnlocked('air', 1)).toBe(true)
  })

  it('transcribes section 5 exactly, ability by ability', () => {
    // Section 5's table as values, not trusted to the comments in `acts.ts`, so a retune is a test
    // change somebody has to justify.
    //
    // **Every ability is named here, and it has to be.** Nearly every other assertion in this file
    // derives its expectations from `UNLOCKED_IN` itself, which is right for the structural
    // properties -- cumulativeness, totality, no act being a no-op -- but means none of them can
    // fail for a *wrong act on a specific ability*. Moving earth and fire to Act 1 left this whole
    // suite green until this test named them, because "something is still withheld at Act 2" stayed
    // true of water. Caught by mutation at the merge that added them.
    expect(UNLOCKED_IN.air).toBe(1)
    expect(UNLOCKED_IN.water).toBe(2)
    expect(UNLOCKED_IN.earth).toBe(2)
    expect(UNLOCKED_IN.fire).toBe(3)
    expect(UNLOCKED_IN['wall-ride']).toBe(2)
    expect(UNLOCKED_IN['dive-rebound']).toBe(3)
    expect(UNLOCKED_IN['avatar-state']).toBe(3)
    // And nothing is left unnamed: a new ability has to be added above rather than slipping in
    // under the structural tests alone.
    expect(Object.keys(UNLOCKED_IN).sort()).toEqual(
      ['air', 'avatar-state', 'dive-rebound', 'earth', 'fire', 'wall-ride', 'water'],
    )
  })
})

describe('isUnlocked', () => {
  it('keeps an unlock unlocked in every later act', () => {
    // The cumulative rule, and the reason `isUnlocked` is an inequality rather than an equality.
    // An equality would hand water over in Act 2 and take it away again in Act 3.
    expect(isUnlocked('water', 2)).toBe(true)
    expect(isUnlocked('water', 3)).toBe(true)
    expect(isUnlocked('wall-ride', 3)).toBe(true)
  })

  it('withholds each gated ability before its act, and hands it over in it', () => {
    // The paired form, over the whole table at once rather than ability by ability, so a new row
    // is covered the day it is added. Both halves of every pair are asserted: the first alone
    // would pass for an ability that is never available, and the second alone for one that is
    // always available.
    for (const ability of Object.keys(UNLOCKED_IN) as Ability[]) {
      const at = UNLOCKED_IN[ability]
      expect(isUnlocked(ability, at)).toBe(true)
      for (const earlier of ACTS.filter((a) => a < at)) {
        expect(isUnlocked(ability, earlier), `${ability} in act ${earlier}`).toBe(false)
      }
    }
  })

  it('gates something in every act after the first, so no act is a no-op', () => {
    // Otherwise the structure could be satisfied by a table that unlocked everything in Act 1
    // and still passed every assertion above.
    for (const act of ACTS.filter((a) => a > 1)) {
      const newlyUnlocked = (Object.keys(UNLOCKED_IN) as Ability[])
        .filter((ability) => UNLOCKED_IN[ability] === act)
      expect(newlyUnlocked.length, `act ${act} hands over nothing`).toBeGreaterThan(0)
    }
  })
})

describe('the shrine thresholds', () => {
  it('rises through the three acts at its two thresholds and nowhere else', () => {
    expect(actFromShrineCount(0)).toBe(1)
    expect(actFromShrineCount(ACT_TWO_SHRINES - 1)).toBe(1)
    expect(actFromShrineCount(ACT_TWO_SHRINES)).toBe(2)
    expect(actFromShrineCount(ACT_THREE_SHRINES - 1)).toBe(2)
    expect(actFromShrineCount(ACT_THREE_SHRINES)).toBe(3)
  })

  it('never falls back down, and saturates rather than running past Act 3', () => {
    // Monotonic over the whole plausible range including past the shrine count that exists, so
    // a fourth act cannot appear by arithmetic accident.
    let previous: Act = 1
    for (let n = 0; n <= 40; n++) {
      const act = actFromShrineCount(n)
      expect(act).toBeGreaterThanOrEqual(previous)
      expect(ACTS).toContain(act)
      previous = act
    }
    expect(actFromShrineCount(1000)).toBe(3)
  })

  it('treats a negative or non-finite count as Act 1 rather than throwing', () => {
    // A count comes from a save file, and `save.ts` never throws by design. A corrupt count has
    // to read as the least progress rather than as an exception or as Act 3.
    expect(actFromShrineCount(-1)).toBe(1)
    expect(actFromShrineCount(Number.NaN)).toBe(1)
  })

  it('is reachable in the shipped archipelago, with Act 3 needing more than half of it', () => {
    // The thresholds are meaningless if the region cannot supply them. Asserted against the real
    // level rather than a literal thirteen, so adding or removing a shrine surfaces here.
    const available = ARCHIPELAGO.shrines.length
    expect(ACT_THREE_SHRINES).toBeLessThanOrEqual(available)
    expect(ACT_TWO_SHRINES).toBeLessThan(ACT_THREE_SHRINES)
    // And Act 3 is not handed out for a couple of easy pickups: it takes more than half the
    // region's shrines, which is what makes it the late-game state section 4.5 describes.
    expect(ACT_THREE_SHRINES / available).toBeGreaterThan(0.5)
  })

  it('counts collected shrines rather than shrine records', () => {
    // The positive control on `actFromShrines`: a list of uncollected shrines is Act 1 however
    // long it is, and the same list collected is Act 3.
    const shrines = (collected: number, total: number) =>
      Array.from({ length: total }, (_, i) => ({ collected: i < collected }))
    expect(actFromShrines(shrines(0, 13))).toBe(1)
    expect(actFromShrines(shrines(ACT_TWO_SHRINES, 13))).toBe(2)
    expect(actFromShrines(shrines(ACT_THREE_SHRINES, 13))).toBe(3)
  })
})
