import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  elementOf, SOURCE_ELEMENTS, REACTIONS, reactionFor, applyReaction,
  type ReactionKind, type ReactionConfig,
} from './reactions'
import { ELEMENT_ORDER } from '../elements/element'
import { spawnEnemy, holdEnemy, UNARMOURED, type EnemyConfig } from './enemy'
import { DEFAULT_COMBAT_CONFIG } from './config'

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

describe('resolving a reaction', () => {
  // This file had no enemy fixtures before this task -- every earlier test here was a pure table
  // lookup. Built in the style enemy.test.ts's own top-level `C` fixture uses, rather than shared,
  // since nothing else in this file spawns an enemy.
  const C: EnemyConfig = {
    maxHealth: 3, outOfCombatSeconds: 4, regenPerSecond: 0.4,
    moveSpeed: 4, strikeRange: 3, aggroRange: 30, windUpSeconds: 0.5, recoverSeconds: 0.6,
    attack: { kind: 'melee', damage: 1 }, knockbackDamping: 3, gravity: 20, snapDistance: 1.2,
    downedSeconds: 18, risingSeconds: 1.2, recoveryHealthFractions: [0.6, 0.3],
    armour: UNARMOURED,
  }
  const anEnemy = () => spawnEnemy('a', new Vector3(0, 0, 0), 'spear', C)
  // The shipped heavy, read the way enemy.test.ts's own "a heavy armoured soldier" block reads
  // it -- its armour.burst of { damage: 0.5, knockback: 0 } is what makes 'steams a heavy for the
  // same damage as anyone else' below a real test of the bypass rather than a coincidence.
  const aHeavy = () => spawnEnemy('a', new Vector3(0, 0, 0), 'heavy', DEFAULT_COMBAT_CONFIG.enemies.heavy)

  const R: ReactionConfig = {
    markSeconds: 2.5, steamDamage: 1.0, mudHoldSeconds: 1.4, holdCeilingSeconds: 3.2,
  }

  it('does nothing for none', () => {
    const enemy = anEnemy()
    expect(applyReaction(enemy, 'none', R)).toBe(enemy)
  })

  it('steams for damage and no shove', () => {
    // Steam damages; the finisher displaces. Distinct verbs, so a reaction that also shoved
    // would be doing the chain's job.
    const steamed = applyReaction(anEnemy(), 'steam', R)
    expect(steamed.health.current).toBeCloseTo(anEnemy().health.current - R.steamDamage, 5)
    expect(steamed.knockback.length()).toBe(0)
  })

  it('steams a heavy for the same damage as anyone else', () => {
    // The point of the reaction. armour.burst is { damage: 0.5, knockback: 0 } for a heavy, and
    // Steam goes through hitEnemy directly rather than through throughArmour, so plate does not
    // reduce it. §4.4's escape clause for the heavy is "earth or the environment", and steam is
    // the environment.
    const heavy = aHeavy()
    const steamed = applyReaction(heavy, 'steam', R)
    expect(heavy.health.current - steamed.health.current).toBeCloseTo(R.steamDamage, 5)
  })

  it('muds for hold and no damage', () => {
    const before = anEnemy()
    const mudded = applyReaction(before, 'mud', R)
    expect(mudded.heldSeconds).toBeCloseTo(R.mudHoldSeconds, 5)
    expect(mudded.health.current).toBe(before.health.current)
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
