# Elemental combos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reward sequencing in combat with two small orthogonal systems — a player-side chain whose top link lands as a finisher, and a per-enemy mark that lets a different element's verb fire a reaction.

**Architecture:** Two new pure modules (`chain.ts`, `reactions.ts`) hold every decision that a node test can reach. One new field on `Enemy` carries the mark, counted down in the one place `heldSeconds` already is. `resolveBlow` in `encounter.ts` — the single shared applier every bending blow already goes through — is where marks are written, reactions resolved and finishers applied.

**Tech Stack:** TypeScript, three.js 0.185.1, Vitest (node environment, no DOM).

**Spec:** `docs/superpowers/specs/2026-08-27-elemental-combos-design.md`

## Global Constraints

- Tests run in the **node** environment: no DOM, no WebGL. `npm run typecheck` covers both tsconfigs and must pass; `npm test` must pass — 124 files / 2525 tests are green at the start of this plan.
- **No `any`.** `noUncheckedIndexedAccess` is on: restructure rather than assert. Two tasks in the previous plan had to be fixed for `any`.
- **Nothing in this plan may shorten any cooldown.** `encounter.ts` keeps its five cooldowns independent precisely so switching element cannot launder one into another. The chain changes what a move *does* when it lands, never when it may be pressed. Task 6 asserts this.
- **Focus is untouched.** No file under `src/focus/` is modified, and no reaction or chain state feeds the meter. `focus.ts` already encodes §4.5's "unbroken chains" as a gain ramp and explicitly rejects a combo counter.
- **One new field on `Enemy`, not a set.** Gripped and frozen share `heldSeconds` so they cannot disagree; the mark follows that precedent.
- **`holdEnemy` stays the only writer of `heldSeconds`.** It takes `Math.max(existing, seconds)`, so Mud passes it a computed total rather than writing the field.
- **No combination of grip, freeze and Mud may hold a soldier past `freezeHoldSeconds` (3.2s).** The freeze pays 35 Focus for that privilege; a free path past it would make the game's one Focus sink pointless.
- **No reaction may grant the player thrust of any kind.** Fire may thrust in the air, never paid in Breath, never on the ground.
- The chain pays in **displacement**, never in extra damage. §4.1: Aang "is not a damage-per-second character, and the systems are tuned so that trying to play him as one fails".
- Commit messages: a sentence in the imperative, no `feat:`/`fix:` prefix. House comment style: explain WHY and name the rejected alternative.

---

## Task 1: The chain

**Files:**
- Create: `src/combat/chain.ts`
- Test: `src/combat/chain.test.ts`
- Modify: `src/combat/config.ts` (add the `chain` block to `DEFAULT_COMBAT_CONFIG` and `ChainConfig` to `CombatConfig`)

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ChainConfig { maxLinks: number; windowSeconds: number }`; `interface ChainState { links: number; sinceLink: number }`; `function freshChain(): ChainState`; `function stepChain(state: ChainState, dt: number, c: ChainConfig): ChainState`; `function landChain(state: ChainState, c: ChainConfig): ChainState`; `function isFinisher(state: ChainState, c: ChainConfig): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/combat/chain.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/combat/chain.test.ts`
Expected: FAIL — `Failed to resolve import "./chain"`.

- [ ] **Step 3: Write the implementation**

Create `src/combat/chain.ts`:

```ts
/**
 * The chain: how many blows have landed in a row, and whether the next one is a finisher.
 *
 * §4.2 says switching element is "fast enough to sequence mid-combo", and this module is what
 * makes sequencing worth doing. It counts *landings*, not presses.
 *
 * **There is no element in this state, and that is the whole Ghost of Yotei property.** A swap
 * cannot reset a string that has nothing element-shaped in it to invalidate, so mixing air into
 * water into earth inside one string needs no rule permitting it — `element.ts` already ruled the
 * switch itself is free, instant and interrupts nothing. The alternative, a per-element chain that
 * a swap would reset, was rejected: it would make the radial a punishment and turn §4.2's own
 * example sequence into three unrelated presses.
 *
 * **A miss does not count.** `focus.ts` pays `gustConnectGain` on connect for the same reason: a
 * string built by pressing keys at empty air would make the finisher free, and the finisher is
 * meant to be the reward for pressure that actually landed.
 *
 * **Nothing here shortens a cooldown.** `encounter.ts` keeps its five cooldowns independent
 * precisely so switching element cannot launder one into another, so this module changes what a
 * blow does when it lands and never when it may be thrown. `encounter.test.ts` asserts it.
 */
export interface ChainConfig {
  /** Landings in one string. The last one is the finisher. */
  maxLinks: number
  /** Grace after a landing during which the next one continues the string. */
  windowSeconds: number
}

export interface ChainState {
  /** Landings in the current string, 0 to maxLinks. */
  links: number
  /** Seconds since the last landing. Resets to 0 on each one. */
  sinceLink: number
}

export function freshChain(): ChainState {
  return { links: 0, sinceLink: 0 }
}

/**
 * Age the string, expiring it once the window lapses.
 *
 * Expiry zeroes `links` rather than decrementing it: a string is a run of blows inside one
 * window, so a lapse ends it outright. Decaying it one link at a time would let a player hold a
 * two-link string indefinitely by landing one blow every window, which is the opposite of the
 * pressure this is meant to reward.
 */
export function stepChain(state: ChainState, dt: number, c: ChainConfig): ChainState {
  if (state.links === 0) return state
  const sinceLink = state.sinceLink + dt
  if (sinceLink > c.windowSeconds) return freshChain()
  return { links: state.links, sinceLink }
}

/** A blow landed. Clamped at the cap so a fourth landing cannot overflow the finisher. */
export function landChain(state: ChainState, c: ChainConfig): ChainState {
  return { links: Math.min(state.links + 1, c.maxLinks), sinceLink: 0 }
}

/**
 * Whether the string is standing at its last link.
 *
 * Read from the state after the landing rather than before it, so the blow that completes the
 * string is itself the finisher. Asking before would make the finisher the *fourth* press of a
 * three-link string, which is one more commitment than the config says a player will make.
 */
export function isFinisher(state: ChainState, c: ChainConfig): boolean {
  return state.links >= c.maxLinks
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/combat/chain.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the config block**

In `src/combat/config.ts`, add `chain` to `DEFAULT_COMBAT_CONFIG` (and `chain: ChainConfig` to the `CombatConfig` interface where that lives):

```ts
  /**
   * The chain, and why the window is three times the staff's.
   *
   * `DEFAULT_STAFF_CONFIG.continueSeconds` is 0.3, tuned for repeated presses of one key.
   * Continuing a string across elements costs a radial flick or a number key *plus* a press, so a
   * 0.3 window would make mixed strings impossible and quietly turn the chain into a staff-only
   * mechanic. 0.9 is the seed and it is a guess: it has not been played.
   *
   * `maxLinks` matches `DEFAULT_STAFF_CONFIG.maxChain` at 3, not for symmetry but because three is
   * the number of landings the staff already proved a player will commit to before standing still
   * costs more than the payoff. Note what the cooldowns do to this: inside 0.9s no move can follow
   * itself (the gust's 0.45 is the only one under half the window, and even it cannot reach three),
   * so a single-element string is the light verb into that element's heavy verb, and a mixed string
   * is the quicker route to a finisher without a line of code rewarding variety directly.
   */
  chain: { maxLinks: 3, windowSeconds: 0.9 },
```

- [ ] **Step 6: Typecheck, full suite, commit**

```bash
npm run typecheck && npm test
git add src/combat/chain.ts src/combat/chain.test.ts src/combat/config.ts
git commit -m "Count landings in a chain, and give it no element for a swap to reset"
```

---

## Task 2: Which element threw a blow

**Files:**
- Create: `src/combat/reactions.ts`
- Test: `src/combat/reactions.test.ts`

**Interfaces:**
- Consumes: `BendingSource` from `./enemy` (`'gust' | 'vortex' | 'wave' | 'staff' | 'grip' | 'freeze' | 'stone' | 'pillar' | 'burst'`); `Element` from `../elements/element` (`'air' | 'water' | 'earth' | 'fire'`).
- Produces: `const SOURCE_ELEMENTS: Record<BendingSource, Element | null>`; `function elementOf(source: BendingSource): Element | null`.

- [ ] **Step 1: Write the failing test**

Create `src/combat/reactions.test.ts`:

```ts
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
```

Check `ELEMENT_ORDER` is the exported name in `src/elements/element.ts` before running; if it differs, use the real one and note it in your report.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/combat/reactions.test.ts`
Expected: FAIL — `Failed to resolve import "./reactions"`.

- [ ] **Step 3: Write the implementation**

Create `src/combat/reactions.ts` with this much for now (the table arrives in Task 3):

```ts
import type { Element } from '../elements/element'
import type { BendingSource } from './enemy'

/**
 * Which element threw each blow.
 *
 * `resolveBlow` already knows the `BendingSource` of everything it applies, and a mark is written
 * in the element's name rather than the move's — water's grip and its freeze both leave a soldier
 * *wet*, and a reaction that fired for one but not the other would be a distinction no player
 * could see.
 *
 * A `Record` over `BendingSource` rather than a switch with a default, so a tenth source fails to
 * compile until someone decides which element owns it. The same device `ArmourTable` uses over the
 * identical union, three files away.
 *
 * **The staff maps to `null` and that is a ruling, not a gap.** It is a weapon rather than a
 * bending verb: it advances the chain, because a landed blow is a landed blow, and it writes no
 * mark, because the reaction table is indexed by `Element` and giving the staff a row would mean
 * inventing a fifth element for the one part of the kit §4.2 keeps separate from bending.
 */
export const SOURCE_ELEMENTS: Record<BendingSource, Element | null> = {
  gust: 'air',
  vortex: 'air',
  // The Pressure Wave is airbending too: §4.2 lists it among the always-available airbending
  // moves, and it is a slam of air whatever the fall that powered it.
  wave: 'air',
  staff: null,
  grip: 'water',
  freeze: 'water',
  stone: 'earth',
  pillar: 'earth',
  burst: 'fire',
}

export function elementOf(source: BendingSource): Element | null {
  return SOURCE_ELEMENTS[source]
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/combat/reactions.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/combat/reactions.ts src/combat/reactions.test.ts
git commit -m "Name the element behind each bending source, and give the staff none"
```

---

## Task 3: The reaction table

**Files:**
- Modify: `src/combat/reactions.ts`
- Test: `src/combat/reactions.test.ts` (add cases)

**Interfaces:**
- Consumes: `Element`, `SOURCE_ELEMENTS` from Task 2.
- Produces: `type ReactionKind = 'none' | 'steam' | 'mud'`; `const REACTIONS: Record<Element, Record<Element, ReactionKind>>`; `function reactionFor(mark: Element, verb: Element): ReactionKind`.

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/reactions.test.ts`:

```ts
import { REACTIONS, reactionFor, type ReactionKind } from './reactions'

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
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/combat/reactions.test.ts`
Expected: FAIL — `REACTIONS` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/combat/reactions.ts`:

```ts
/**
 * What a pairing produces. `'none'` is a decision, not a hole.
 *
 * Two live reactions, and the shortness of that list is the constraint rather than an admission:
 * the chain's finisher displaces, Steam damages, Mud holds. A third reaction that also damaged or
 * also held would make the table longer without making the fight richer, and would give two
 * mechanisms the same job.
 */
export type ReactionKind = 'none' | 'steam' | 'mud'

/**
 * The mark already on the soldier, against the element now landing.
 *
 * Two nested `Record`s over `Element`, so a fifth element fails to compile until every pairing
 * with it — in both directions — has been ruled on. `LOOKS` in `element-radial.ts` and
 * `WIND_LEGEND` in `wind.ts` use the same device for the same reason.
 *
 * **The table is directional.** A wet soldier hit by fire steams; a burning soldier hit by water
 * does not. Sequence is the thing being rewarded, so a symmetric table would be rewarding a *set*
 * of elements rather than an order.
 *
 * **The diagonal is `'none'` by rule**, stated here once rather than four times below: repetition
 * is the chain's business, and paying for it twice would price one press twice.
 *
 * Two pairings were designed and rejected, and they are recorded in §4.2 of the design note so
 * nobody re-proposes them blind. Dust (earth then air) needs a notion of a soldier whose aim is
 * spoiled, which nothing in the game has, and inventing per-enemy perception state for one
 * reaction is the status bag arriving through the back door. Backdraft (air then fire) would widen
 * the burst's cone, and that cone's 30° half-angle *is* how §4.2's "only element with real
 * single-target damage" is implemented — widening it dissolves the one property that makes fire
 * fire.
 */
export const REACTIONS: Record<Element, Record<Element, ReactionKind>> = {
  air: { air: 'none', water: 'none', earth: 'none', fire: 'none' },
  water: { air: 'none', water: 'none', earth: 'mud', fire: 'steam' },
  earth: { air: 'none', water: 'none', earth: 'none', fire: 'none' },
  fire: { air: 'none', water: 'none', earth: 'none', fire: 'none' },
}

export function reactionFor(mark: Element, verb: Element): ReactionKind {
  return REACTIONS[mark][verb]
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/combat/reactions.test.ts`
Expected: PASS, 11 tests total in the file.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/combat/reactions.ts src/combat/reactions.test.ts
git commit -m "Rule on all sixteen element pairings, and leave two of them live"
```

---

## Task 4: The mark on the soldier

**Files:**
- Modify: `src/combat/enemy.ts` (the `Enemy` interface, `stepEnemy`'s countdown, two new helpers)
- Test: `src/combat/enemy.test.ts` (add cases)
- Modify: `src/combat/config.ts` (add `markSeconds` to the new `reactions` block)

**Interfaces:**
- Consumes: `Element` from `../elements/element`.
- Produces: `Enemy` gains `mark: { element: Element; secondsLeft: number } | null`; `function markEnemy(enemy: Enemy, element: Element, seconds: number): Enemy`; `function clearMark(enemy: Enemy): Enemy`. `DEFAULT_COMBAT_CONFIG.reactions.markSeconds` = 2.5.

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/enemy.test.ts`. Use whatever fixture factory that file already has for a fresh enemy — do not invent a second one:

```ts
describe('the mark', () => {
  it('starts absent', () => {
    expect(anEnemy().mark).toBeNull()
  })

  it('records the element that landed', () => {
    const marked = markEnemy(anEnemy(), 'water', 2.5)
    expect(marked.mark).toEqual({ element: 'water', secondsLeft: 2.5 })
  })

  it('is overwritten by a later element rather than accumulating', () => {
    // One field, one element — the precedent heldSeconds sets. A soldier is wet or scorched,
    // not both, so the newest blow owns the mark.
    const marked = markEnemy(markEnemy(anEnemy(), 'water', 2.5), 'fire', 2.5)
    expect(marked.mark?.element).toBe('fire')
  })

  it('counts down on the same clock as the hold, and expires', () => {
    let enemy = markEnemy(anEnemy(), 'water', 0.5)
    for (let t = 0; t < 0.45; t += 1 / 60) enemy = stepEnemy(enemy, ...stepArgs()).enemy
    expect(enemy.mark).not.toBeNull()
    for (let t = 0; t < 0.1; t += 1 / 60) enemy = stepEnemy(enemy, ...stepArgs()).enemy
    expect(enemy.mark).toBeNull()
  })

  it('is cleared outright rather than left at zero', () => {
    expect(clearMark(markEnemy(anEnemy(), 'water', 2.5)).mark).toBeNull()
  })

  it('refuses to mark a downed soldier', () => {
    // holdEnemy refuses the same way. A mark on a body on the ground would let a reaction
    // fire on something that cannot act, and §4.6's downed state is a condition, not a target.
    const downed = /* take the fixture to zero using this file's existing helper */ downEnemy(anEnemy())
    expect(markEnemy(downed, 'water', 2.5).mark).toBeNull()
  })
})
```

Adapt `anEnemy()`, `stepArgs()` and `downEnemy()` to the helpers that already exist in `enemy.test.ts`. If a helper does not exist, build the fixture inline the way the neighbouring tests in that file do — do not add a new shared factory.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/combat/enemy.test.ts`
Expected: FAIL — `mark` is not a property of `Enemy`, `markEnemy` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/combat/enemy.ts`, add to the `Enemy` interface immediately after `heldSeconds`:

```ts
  /**
   * What element last landed on this soldier, and for how much longer it counts.
   *
   * One field carrying one element, deliberately, for the reason `heldSeconds` is one field
   * carrying both the grip and the freeze: a set of per-element statuses could disagree about what
   * a soldier is, and nothing in the game needs a soldier to be wet *and* scorched. The newest
   * blow owns the mark.
   *
   * Remaining time rather than elapsed, so expiry needs no config lookup and the countdown can sit
   * beside the hold's at the top of `stepEnemy`. `null` rather than a zeroed record, so "unmarked"
   * has exactly one representation and no caller has to decide whether 0 means expired.
   */
  mark: { element: Element; secondsLeft: number } | null
```

In `stepEnemy`, beside the existing hold countdown at the top — the comment there explains that decrementing at the top is what makes it impossible for one of the eight exits to forget it, and the mark inherits that argument exactly:

```ts
  // The mark aged in the same place and for the same reason as the hold above: every return
  // below spreads `...enemy`, so a per-branch decrement is a bug waiting for the ninth exit.
  const mark = incoming.mark === null || incoming.mark.secondsLeft <= dt
    ? null
    : { element: incoming.mark.element, secondsLeft: incoming.mark.secondsLeft - dt }
```

Thread `mark` into the `enemy` object that the existing countdown code builds, exactly as `heldSeconds` is threaded.

Add the two helpers beside `holdEnemy`:

```ts
/**
 * Write the mark, unless the soldier is already down.
 *
 * Refuses on a downed body for the reason `holdEnemy` does: §4.6 makes downed a condition rather
 * than a removal, and a reaction firing on something that cannot act is feedback for a fight that
 * is over.
 */
export function markEnemy(enemy: Enemy, element: Element, seconds: number): Enemy {
  if (isDowned(enemy.health) || !(seconds > 0)) return enemy
  return { ...enemy, mark: { element, secondsLeft: seconds } }
}

/** Consume the mark. Separate from `markEnemy` so a reaction cannot accidentally re-mark. */
export function clearMark(enemy: Enemy): Enemy {
  return enemy.mark === null ? enemy : { ...enemy, mark: null }
}
```

Add `mark: null` to wherever `createEnemy` (or the equivalent constructor at `enemy.ts:287`) builds a fresh soldier.

In `src/combat/config.ts`, start the reactions block:

```ts
  reactions: {
    /**
     * How long a mark counts, in seconds.
     *
     * Longer than the chain's 0.9s window, so a mark outlives the string that made it and a
     * player can come back to a wet soldier after dealing with someone else — the mark is a
     * property of the fight, not of the combo. Shorter than the freeze's 3.2s, so being wet is
     * never as durable as being frozen. Both bounds are the argument; 2.5 is the guess inside them.
     */
    markSeconds: 2.5,
  },
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/combat/enemy.test.ts`
Expected: PASS. Fixtures elsewhere that build an `Enemy` literal will fail to typecheck until they gain `mark: null` — add it rather than loosening the type.

- [ ] **Step 5: Typecheck, full suite, commit**

```bash
npm run typecheck && npm test
git add src/combat/enemy.ts src/combat/enemy.test.ts src/combat/config.ts
git commit -m "Mark a soldier with the element that last landed, aged beside the hold"
```

---

## Task 5: Resolving a reaction

**Files:**
- Modify: `src/combat/reactions.ts` (add `applyReaction`)
- Test: `src/combat/reactions.test.ts` (add cases)
- Modify: `src/combat/config.ts` (add `steamDamage`, `mudHoldSeconds`, `holdCeilingSeconds` to the `reactions` block)

**Interfaces:**
- Consumes: `ReactionKind` from Task 3; `Enemy`, `hitEnemy`, `holdEnemy` from `./enemy`.
- Produces: `interface ReactionConfig { markSeconds: number; steamDamage: number; mudHoldSeconds: number; holdCeilingSeconds: number }`; `function applyReaction(enemy: Enemy, kind: ReactionKind, c: ReactionConfig): Enemy`.

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/reactions.test.ts`:

```ts
import { applyReaction, type ReactionConfig } from './reactions'
import { holdEnemy } from './enemy'

const R: ReactionConfig = {
  markSeconds: 2.5, steamDamage: 1.0, mudHoldSeconds: 1.4, holdCeilingSeconds: 3.2,
}

describe('resolving a reaction', () => {
  it('does nothing for none', () => {
    const enemy = anEnemy()
    expect(applyReaction(enemy, 'none', R)).toBe(enemy)
  })

  it('steams for damage and no shove', () => {
    // Steam damages; the finisher displaces. Distinct verbs, so a reaction that also shoved
    // would be doing the chain's job.
    const steamed = applyReaction(anEnemy(), 'steam', R)
    expect(steamed.health.value).toBeCloseTo(anEnemy().health.value - R.steamDamage, 5)
    expect(steamed.knockback.length()).toBe(0)
  })

  it('steams a heavy for the same damage as anyone else', () => {
    // The point of the reaction. armour.burst is { damage: 0.5, knockback: 0 } for a heavy, and
    // Steam goes through hitEnemy directly rather than through throughArmour, so plate does not
    // reduce it. §4.4's escape clause for the heavy is "earth or the environment", and steam is
    // the environment.
    const heavy = aHeavy()
    const steamed = applyReaction(heavy, 'steam', R)
    expect(heavy.health.value - steamed.health.value).toBeCloseTo(R.steamDamage, 5)
  })

  it('muds for hold and no damage', () => {
    const before = anEnemy()
    const mudded = applyReaction(before, 'mud', R)
    expect(mudded.heldSeconds).toBeCloseTo(R.mudHoldSeconds, 5)
    expect(mudded.health.value).toBe(before.health.value)
  })

  it('adds mud on top of an existing hold', () => {
    const gripped = holdEnemy(anEnemy(), 1.4)
    expect(applyReaction(gripped, 'mud', R).heldSeconds).toBeCloseTo(2.8, 5)
  })

  it('never holds past the ceiling, however often mud lands', () => {
    // The load-bearing guard of this whole step. config.ts sets gripCooldownSeconds (1.1) just
    // under gripHoldSeconds (1.4) so that chain-holding one target costs the entire light-verb
    // budget. Mud stacking without a ceiling would buy a longer lockdown while leaving the light
    // verb free for another element — cheaper than the freeze that pays 35 Focus for exactly that
    // privilege, which §4.5 calls the game's one Focus sink.
    let enemy = holdEnemy(anEnemy(), 3.2)
    for (let i = 0; i < 5; i++) enemy = applyReaction(enemy, 'mud', R)
    expect(enemy.heldSeconds).toBeLessThanOrEqual(R.holdCeilingSeconds)
  })

  it('never shortens a hold that is already past the ceiling', () => {
    // holdEnemy takes Math.max, so nothing in the game can shorten ice. A ceiling that clamped
    // downwards would be the first thing that could, and it would make mudding a frozen soldier
    // a way to free them.
    const frozen = holdEnemy(anEnemy(), 5)
    expect(applyReaction(frozen, 'mud', R).heldSeconds).toBe(5)
  })
})
```

Reuse this file's `anEnemy()` from the earlier tasks' tests and add an `aHeavy()` that builds a `kind: 'heavy'` fixture the way `enemy.test.ts` does.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/combat/reactions.test.ts`
Expected: FAIL — `applyReaction` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/combat/reactions.ts`:

```ts
import { Vector3 } from 'three'
import { hitEnemy, holdEnemy, type Enemy } from './enemy'

export interface ReactionConfig {
  markSeconds: number
  steamDamage: number
  mudHoldSeconds: number
  /** No combination of grip, freeze and Mud may hold a soldier longer than this. */
  holdCeilingSeconds: number
}

/** Reused rather than allocated per reaction: Steam shoves nobody, so the impulse is always zero. */
const NO_IMPULSE = new Vector3()

/**
 * One reaction, resolved at once, leaving nothing behind.
 *
 * Reactions are expressed only in effects the game already has — damage through `hitEnemy`, hold
 * through `holdEnemy` — because a reaction with its own lingering state would need its own field,
 * and the one-field ruling on `Enemy.mark` is what keeps the struct from becoming a status bag.
 *
 * **Steam deliberately skips `throughArmour`.** That split is the reaction: `resolveBlow` puts
 * every ordinary blow through the target's armour table first, and Steam is the one thing in the
 * game that does not go through it. See the heavy's `armour.burst` of `{ damage: 0.5, knockback: 0 }`
 * for what it is bypassing.
 *
 * **Mud goes through `holdEnemy` and never writes `heldSeconds` itself**, because `holdEnemy` is
 * the only writer of that field and its `Math.max` is what guarantees nothing in the game can
 * shorten ice. The ceiling is applied to the *sum* before the call, so a hold already past the
 * ceiling is left exactly where it is rather than clamped down onto it.
 */
export function applyReaction(enemy: Enemy, kind: ReactionKind, c: ReactionConfig): Enemy {
  if (kind === 'none') return enemy
  if (kind === 'steam') return hitEnemy(enemy, c.steamDamage, NO_IMPULSE)
  const total = Math.min(enemy.heldSeconds + c.mudHoldSeconds, c.holdCeilingSeconds)
  return holdEnemy(enemy, total)
}
```

In `src/combat/config.ts`, complete the `reactions` block:

```ts
    /**
     * Steam's damage: the Fire Burst's own `burstDamage` of 1.0, applied without the armour
     * multiplier. Borrowed rather than invented so the figure needs no defence of its own — Steam
     * is "a burst the plate cannot stop" rather than a new damage tier.
     */
    steamDamage: 1.0,
    /** Mud's hold: the water grip's own `gripHoldSeconds`, added to whatever is on the clock. */
    mudHoldSeconds: 1.4,
    /**
     * The hold ceiling: the freeze's own `freezeHoldSeconds`.
     *
     * The freeze pays 35 Focus — §4.5's one sink — for the privilege of holding a soldier this
     * long. A free path past it would make that sink pointless, so grip, freeze and Mud together
     * cannot exceed it. Not a tuning number: it is the same 3.2 the freeze uses, and it should
     * move only if that one does.
     */
    holdCeilingSeconds: 3.2,
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/combat/reactions.test.ts`
Expected: PASS, 18 tests total in the file.

- [ ] **Step 5: Typecheck, full suite, commit**

```bash
npm run typecheck && npm test
git add src/combat/reactions.ts src/combat/reactions.test.ts src/combat/config.ts
git commit -m "Resolve steam and mud in effects the game already has, and cap the hold"
```

---

## Task 6: Wire both systems into the fight

**Files:**
- Modify: `src/combat/encounter.ts` (`Encounter`, `EncounterStep`, `resolveBlow`, `stepEncounter`)
- Test: `src/combat/encounter.test.ts` (add cases)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: `Encounter` gains `chain: ChainState`; `EncounterStep` gains `reactionsThisFrame: { enemyId: string; kind: ReactionKind }[]` and `finisherThisFrame: boolean`.

**Read before you start.** `resolveBlow` at `src/combat/encounter.ts:543` is the single applier every bending blow goes through. It decides connected versus deflected via `deflects`, then puts the blow through `throughArmour` before `hitEnemy`. All three of this task's behaviours belong there, and the ordering below is not negotiable.

- [ ] **Step 1: Write the failing tests**

Add to `src/combat/encounter.test.ts`, using that file's existing fixture helpers:

```ts
describe('the chain in the fight', () => {
  it('advances on a blow that connects', () => {
    const step = gustAt(anEncounterWithASpear())
    expect(step.encounter.chain.links).toBe(1)
  })

  it('does not advance on a blow that connects with nobody', () => {
    const step = gustAt(anEmptyEncounter())
    expect(step.encounter.chain.links).toBe(0)
  })

  it('does not advance on a blow the armour turns away entirely', () => {
    // A deflected gust on a heavy is not pressure applied. It is the armour working.
    const step = gustAt(anEncounterWithAHeavy())
    expect(step.encounter.chain.links).toBe(0)
  })

  it('survives an element switch, which is the whole point', () => {
    let e = anEncounterWithASpear()
    e = gustAt(e).encounter                       // air
    e = gripAt(e).encounter                       // water, no reset
    expect(e.chain.links).toBe(2)
  })

  it('shortens no cooldown, however long the string', () => {
    // The invariant encounter.ts's independent cooldowns exist to protect. Stated as a test
    // rather than a comment so a future contributor cannot pay the finisher out of the
    // cooldown budget.
    const before = anEncounterWithASpear()
    const after = threeLinkString(before).encounter
    expect(after.gustCooldown).toBeLessThanOrEqual(DEFAULT_COMBAT_CONFIG.gust.cooldownSeconds)
    expect(after.waterGripCooldown)
      .toBeLessThanOrEqual(DEFAULT_COMBAT_CONFIG.water.gripCooldownSeconds)
    expect(after.fireBurstCooldown)
      .toBeLessThanOrEqual(DEFAULT_COMBAT_CONFIG.fire.burstCooldownSeconds)
  })

  it('moves a heavy with a finisher, which no gust can do alone', () => {
    // armour.gust is { damage: 0, knockback: 0 }, so a plain gust is deflected and skipped.
    // At the last link the knockback lands unarmoured — §4.4 gives the heavy knockback economy
    // to pressure, and this is the third answer to it, earned by sequencing.
    const heavy = heavyIn(threeLinkStringEndingInGust(anEncounterWithAHeavy()).encounter)
    expect(heavy.knockback.length()).toBeGreaterThan(0)
  })

  it('reports the finisher for the frame it landed on', () => {
    expect(threeLinkStringEndingInGust(anEncounterWithASpear()).finisherThisFrame).toBe(true)
    expect(gustAt(anEncounterWithASpear()).finisherThisFrame).toBe(false)
  })
})

describe('reactions in the fight', () => {
  it('marks a soldier with the element that landed', () => {
    const spear = spearIn(gustAt(anEncounterWithASpear()).encounter)
    expect(spear.mark?.element).toBe('air')
  })

  it('writes no mark for a staff blow', () => {
    const spear = spearIn(staffAt(anEncounterWithASpear()).encounter)
    expect(spear.mark).toBeNull()
  })

  it('fires steam when fire lands on a wet soldier, and consumes the mark', () => {
    let e = anEncounterWithASpear()
    e = gripAt(e).encounter
    const step = burstAt(e)
    expect(step.reactionsThisFrame).toEqual([{ enemyId: 'spear-1', kind: 'steam' }])
    expect(spearIn(step.encounter).mark?.element).toBe('fire')
  })

  it('reads the old mark, not the one the same blow writes', () => {
    // The ordering that makes cross-element reactions possible at all. If the mark were written
    // before the lookup, every pairing would resolve against the element that just landed and
    // reactionFor would only ever see the diagonal — which is 'none' for all four.
    let e = anEncounterWithASpear()
    e = burstAt(e).encounter                      // fire mark
    expect(burstAt(e).reactionsThisFrame).toEqual([])
  })

  it('does not fire on a soldier the blow never reached', () => {
    let e = anEncounterWithASpear()
    e = gripAt(e).encounter
    expect(burstAtNothing(e).reactionsThisFrame).toEqual([])
  })
})
```

Build the helpers (`gustAt`, `gripAt`, `burstAt`, `staffAt`, `threeLinkString`, `threeLinkStringEndingInGust`, `spearIn`, `heavyIn`, `burstAtNothing`) on top of the fixtures `encounter.test.ts` already has for driving `stepEncounter` with a synthetic `EncounterInput`. Do not add a parallel fixture system; extend what is there.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: FAIL — `chain` is not a property of `Encounter`.

- [ ] **Step 3: Add the state and the reporting**

In `src/combat/encounter.ts`, add to `Encounter` beside the cooldowns:

```ts
  /**
   * The current string. See `chain.ts` — it carries no element, so a swap cannot reset it.
   *
   * On the encounter rather than on the player for the reason `Focus` is not on `PlayerState`:
   * movement is a pure function of a struct a dozen tests build fixtures for, and how many blows
   * have landed in a row is not a property of the character's kinematics.
   */
  chain: ChainState
```

Add to `EncounterStep`:

```ts
  /**
   * Reactions that fired this frame, for feedback. Ordered by the enemy list, not by chance.
   *
   * A list rather than a single reaction, because one burst can steam several wet soldiers at
   * once and a feedback layer that could only draw the first would silently under-report the
   * best press in the game.
   */
  reactionsThisFrame: { enemyId: string; kind: ReactionKind }[]
  /** Whether the blow this frame landed as a finisher, for feedback. */
  finisherThisFrame: boolean
```

Age the chain at the top of `stepEncounter`, beside the five cooldowns and for the identical reason — unconditionally, whatever element is selected:

```ts
  let chain = stepChain(encounter.chain, dt, c.chain)
```

- [ ] **Step 4: Teach `resolveBlow` the three new behaviours**

`resolveBlow` gains the chain state, the config it needs, and returns what fired. The order inside the per-enemy map is fixed:

1. read the **old** mark and look up the reaction;
2. apply the ordinary blow — through `throughArmour`, except that a finisher's *impulse* skips the armour's knockback fraction;
3. apply the reaction, if any;
4. write the new mark for this blow's element, if it has one.

Two subtleties that are the whole reason this task is one task and not four:

**A deflected blow must stop being skipped when the blow is a finisher.** The current code skips deflected targets entirely, before armour is ever consulted — so on a heavy, whose `armour.gust` is `{ damage: 0, knockback: 0 }`, `deflects` is true and a finisher gust would do nothing at all. That would make the finisher useless against the one soldier it exists for. When the blow is a finisher, a deflected target is *not* skipped: it takes zero damage through its armour and the full unarmoured impulse.

**The reaction is applied after the blow, not before.** `hitEnemy` advances the recovery ladder off the damage it is handed, and Steam is a separate landing — folding Steam's damage into the same `hitEnemy` call would let one press cross two rungs of the ladder invisibly.

```ts
function resolveBlow(
  enemies: readonly Enemy[],
  caught: ReadonlySet<string>,
  source: BendingSource,
  c: CombatConfig,
  damage: (enemy: Enemy) => number,
  impulse: (enemy: Enemy) => Vector3,
  finisher: boolean,
): Blow {
  const element = elementOf(source)
  const connected: string[] = []
  const deflected: string[] = []
  const reactions: { enemyId: string; kind: ReactionKind }[] = []
  for (const enemy of enemies) {
    if (!caught.has(enemy.id) || !isTargetable(enemy)) continue
    if (deflects(c.enemies[enemy.kind], source) && !finisher) deflected.push(enemy.id)
    else connected.push(enemy.id)
  }
  const turnedAway = new Set(deflected)
  return {
    connected,
    deflected,
    reactions,
    enemies: enemies.map((enemy) => {
      if (!caught.has(enemy.id) || !isTargetable(enemy)) return enemy
      if (turnedAway.has(enemy.id)) return enemy

      const kind = element !== null && enemy.mark !== null
        ? reactionFor(enemy.mark.element, element)
        : 'none'

      const armour = c.enemies[enemy.kind].armour[source]
      const armoured = throughArmour(damage(enemy), impulse(enemy), armour)
      let next = hitEnemy(
        enemy,
        armoured.damage,
        finisher ? impulse(enemy) : armoured.impulse,
      )

      if (kind !== 'none') {
        next = applyReaction(clearMark(next), kind, c.reactions)
        reactions.push({ enemyId: enemy.id, kind })
      }
      return element === null ? next : markEnemy(next, element, c.reactions.markSeconds)
    }),
  }
}
```

Add `reactions` to the `Blow` interface. Every existing `resolveBlow` call site passes the new `finisher` argument — compute it once per frame as `isFinisher(chain, c.chain)` **after** the landing that may have completed the string, which means each call site advances the chain from its own `connected` list and then decides. Keep that in one small local helper rather than repeating it at each of the call sites:

```ts
  /**
   * A blow has landed on somebody: advance the string and say whether this blow is the finisher.
   *
   * One helper rather than the same three lines at each resolver, because the ordering is easy to
   * get backwards: the chain is advanced first and the finisher is read from the result, so the
   * blow that completes a three-link string is itself the finisher rather than the fourth press.
   */
  function land(connectedCount: number): boolean {
    if (connectedCount === 0) return false
    chain = landChain(chain, c.chain)
    return isFinisher(chain, c.chain)
  }
```

Because the finisher must be known *before* the blow is applied and the chain can only be advanced *after* knowing the blow connected, resolve each blow in two passes: call `resolveBlow` with `finisher: false` to learn `connected`, then — if `land(connected.length)` is true — call it again with `finisher: true` against the original enemy list. A blow is applied exactly once either way. Write that reasoning into a comment; it is the least obvious part of the task, and the alternative (predicting connection before applying the blow) would duplicate the catch geometry at every resolver.

- [ ] **Step 5: Thread the state out and run the tests**

Return `chain`, `reactionsThisFrame` (concatenated from every blow this frame) and `finisherThisFrame` from `stepEncounter`. Add `chain: freshChain()` to wherever a fresh `Encounter` is built.

Run: `npx vitest run src/combat/encounter.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, full suite, commit**

```bash
npm run typecheck && npm test
git add src/combat/encounter.ts src/combat/encounter.test.ts
git commit -m "Advance the chain on a landing, fire reactions off the old mark, and let a finisher move a heavy"
```

---

## Task 7: Make it legible

**Files:**
- Modify: `src/elements/element.ts` (`RadialModel` gains the link count)
- Test: `src/elements/element.test.ts` (add cases)
- Modify: `src/ui/element-radial.ts` (draw the count on the badge)
- Modify: `src/main.ts` (pass the chain into `radialModel`; spawn a ring per reaction)

**Interfaces:**
- Consumes: `ChainState` from Task 1; `EncounterStep.reactionsThisFrame` from Task 6; `createShockwave` from `../fx/shockwave`.
- Produces: `radialModel(state, c, act, links: number)` — a fourth parameter; `RadialModel` gains `links: number`.

- [ ] **Step 1: Write the failing test**

Add to `src/elements/element.test.ts`:

```ts
describe('the badge shows the string', () => {
  it('carries the link count', () => {
    expect(radialModel(freshElements(), DEFAULT_ELEMENT_CONFIG, 3, 2).links).toBe(2)
  })

  it('carries a zero rather than hiding it, so the widget has one shape', () => {
    expect(radialModel(freshElements(), DEFAULT_ELEMENT_CONFIG, 3, 0).links).toBe(0)
  })
})
```

Use this file's existing helpers for the element state and act; `freshElements()` above stands for whatever it already calls that.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/elements/element.test.ts`
Expected: FAIL — `radialModel` takes three arguments.

- [ ] **Step 3: Implement**

`radialModel` gains a fourth parameter and copies it onto the model:

```ts
  /**
   * Landings in the current string, from `chain.ts`.
   *
   * On the badge rather than in its own widget, because the badge is already the thing that says
   * what F and R will do — so "what I am holding" and "how far along I am" read in one glance,
   * which is the pairing a player actually needs while deciding whether to switch. A fourth
   * concentric ring at the crosshair was the alternative and the crosshair cluster is already
   * three rings deep; see this module's note on where the radial sits.
   */
  links: number
```

In `src/ui/element-radial.ts`, render the count on the badge — pips rather than a numeral, sized against the existing badge text, using the active element's own colour from `LOOKS`.

In `src/main.ts`, pass `encounter.chain.links` at each `radialModel` call, and spawn one ring per reaction beside the existing effect wiring:

```ts
    for (const reaction of step.reactionsThisFrame) {
      const view = enemyViews.get(reaction.enemyId)
      if (view) effects.add(createShockwave(view.object.position.clone(), REACTION_LOOKS[reaction.kind]))
    }
```

Add a `REACTION_LOOKS: Record<ReactionKind, ...>` beside it — a `Record` so a third reaction cannot ship without a colour. Steam reads pale and warm; Mud reads dark and brown; `'none'` never spawns and takes whatever the type demands with a comment saying so. Adapt the enemy-view lookup and the `createShockwave` signature to what those modules actually take.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS. `element.test.ts` and any test calling `radialModel` will need the fourth argument.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/elements/element.ts src/elements/element.test.ts src/ui/element-radial.ts src/main.ts
git commit -m "Show the string on the element badge, and ring a reaction where it fired"
```

---

## Task 8: Look at it, then hand it over

**Files:** none, unless a defect is found.

- [ ] **Step 1: Verify in the browser**

Start the dev server against this worktree and load the game. Confirm, with the console open:

- pips appear on the badge as blows land, and clear when the string lapses;
- switching element mid-string does not clear them;
- gripping a soldier then bursting it produces a ring and takes visible health;
- no console warnings.

Report what you saw. If a still frame cannot settle something, say so rather than claiming it.

- [ ] **Step 2: Hand the owner the play-test list**

Report to the owner, and say plainly that these are the questions no test in this repository can answer:

- whether the 0.9s window is generous or sloppy once the radial is in the loop — the spec flags this as the likeliest thing to be wrong;
- whether a finisher reads as a finisher without step B's visuals;
- whether Steam and Mud are worth switching for, or whether the fight is still won by mashing one element;
- whether a heavy being displaceable at the last link makes it too easy.

- [ ] **Step 3: Record the verdict**

Whatever comes back goes into the design note's step-B notes in the owner's own terms. "It felt fine" is a result and belongs in the file.

---

## Self-review

**Spec coverage.** §1's three rulings → the Global Constraints, with the anti-laundering one asserted in Task 6. §2's two-systems split → Tasks 1 and 3–5, kept in separate modules. §3's chain → Task 1, including landings-only, the 0.9s window, `maxLinks` 3, and the swap surviving (tested structurally). §3's finisher-displaces → Task 6. §3's staff-advances-but-writes-no-mark → Tasks 2 and 6. §4's mark field → Task 4. §4.1's table → Task 3, exhaustive. §4.1's Steam and Mud including the hold ceiling → Task 5. §4.2's rejected reactions → recorded in Task 3's implementation comment. §5's three feedback pieces → Task 7 (badge and ring) — **gap found and closed: the spec also promised a pip on the soldier's health bar, which Task 7 does not implement.** `health-bar.ts` builds a three.js sprite, so a pip there is untestable FX work and its value is entirely a matter of taste in play; it is deliberately deferred to step B, where the effect inventory is the subject, and Task 8 asks the owner whether the badge alone was enough. That deferral is now stated here rather than left as a silent omission. §6's boundaries → the file lists match. §7's tests → each task's own test step. §8's non-goals → nothing in this plan touches `src/focus/`, `staff.ts`, the cooldowns, or any `armour` table.

**Placeholders.** None. Every code step carries its code. Task 4's and Task 6's "adapt to the fixtures that already exist" notes are instructions to reuse named existing helpers rather than deferred decisions, and each names what to do if the helper is absent.

**Type consistency.** `ChainState` is `{ links, sinceLink }` in Tasks 1, 6 and 7. `ChainConfig` is `{ maxLinks, windowSeconds }` throughout. `ReactionKind` is `'none' | 'steam' | 'mud'` in Tasks 3, 5, 6 and 7. `ReactionConfig`'s four fields are used by those names in Tasks 4, 5 and 6. `Enemy.mark` is `{ element, secondsLeft } | null` in Tasks 4, 5 and 6. `elementOf` returns `Element | null` in Tasks 2 and 6, and Task 6 branches on the null. `resolveBlow` gains exactly one parameter, `finisher: boolean`, and `Blow` gains exactly one field, `reactions`.

**One risk the plan carries deliberately.** Task 6 is the largest task by some distance: it changes the shared applier, adds two fields to two interfaces, and introduces the two-pass resolve. It could be split, but every part of it is one behaviour observed through one function, and a reviewer rejecting half of it would leave the fight in a state where a finisher exists but nothing can be marked. It stays one task, and its test list is correspondingly long.
