import { describe, it, expect } from 'vitest'
import { Box3, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { createBoard, HOVER_HEIGHT } from './board'

function deckOf(board: ReturnType<typeof createBoard>): Mesh {
  const deck = board.object.getObjectByName('deck')
  if (!(deck instanceof Mesh)) throw new Error('deck missing')
  return deck
}

function cushionMaterialOf(board: ReturnType<typeof createBoard>): MeshBasicMaterial {
  const cushion = board.object.getObjectByName('cushion')
  if (!(cushion instanceof Mesh)) throw new Error('cushion missing')
  const material = cushion.material
  if (Array.isArray(material) || !(material instanceof MeshBasicMaterial)) {
    throw new Error('cushion material missing')
  }
  return material
}

describe('createBoard', () => {
  it('is stowed until the scooter is up', () => {
    const board = createBoard()
    expect(board.visible()).toBe(false)
    board.update(1 / 60, false, 0, 0)
    expect(board.visible()).toBe(false)
  })

  it('appears the moment the scooter is', () => {
    // Not faded in: a deck that ghosted into view would read as a spirit rather than as air
    // packing together under the feet.
    const board = createBoard()
    board.update(1 / 60, true, 0, 0)
    expect(board.visible()).toBe(true)
  })

  it('points its nose along the direction of travel', () => {
    // Avatar-local +Z is forward, and the board is a child of the node `lookAt` aims. A deck
    // built along X would sit across the player's path like a hurdle.
    const board = createBoard()
    board.update(1 / 60, true, 0, 0)
    const box = new Box3().setFromObject(deckOf(board))
    const size = box.getSize(new Vector3())
    expect(size.z).toBeGreaterThan(size.x)
  })

  it('puts the deck under the feet at the hover height', () => {
    // The rider is lifted by exactly HOVER_HEIGHT, so the deck's top surface has to be there or
    // the character stands in mid-air above its own board.
    const board = createBoard()
    board.update(0, true, 0, 0)
    const top = new Box3().setFromObject(deckOf(board)).max.y
    expect(top).toBeLessThanOrEqual(HOVER_HEIGHT)
    expect(top).toBeGreaterThan(HOVER_HEIGHT - 0.1)
  })

  it('leaves air between the deck and the ground', () => {
    // The whole effect: if the deck reached y = 0 it would be a plank on the floor.
    const board = createBoard()
    board.update(0, true, 0, 0)
    expect(new Box3().setFromObject(deckOf(board)).min.y).toBeGreaterThan(0)
  })

  it('bobs, so a parked board is not a static prop', () => {
    const board = createBoard()
    board.update(0, true, 0, 0)
    const start = board.object.position.y
    // A quarter of the bob cycle, which is where a sine is furthest from where it began.
    for (let i = 0; i < 12; i++) board.update(1 / 60, true, 0, 0)
    expect(board.object.position.y).not.toBeCloseTo(start, 3)
  })

  it('keeps the bob smaller than the hover it rides on', () => {
    // Or the deck would visibly dip towards the ground it is supposed to be clear of.
    const board = createBoard()
    let lowest = Infinity
    for (let i = 0; i < 240; i++) {
      board.update(1 / 60, true, 0, 0)
      lowest = Math.min(lowest, new Box3().setFromObject(deckOf(board)).min.y)
    }
    expect(lowest).toBeGreaterThan(0)
  })

  it('banks into a turn, and the other way for the other turn', () => {
    const board = createBoard()
    board.update(0, true, 0, 1)
    const right = board.object.rotation.z
    board.update(0, true, 0, -1)
    const left = board.object.rotation.z
    expect(Math.sign(right)).toBe(-Math.sign(left))
    expect(right).not.toBeCloseTo(0, 3)
  })

  it('clamps the bank however hard the caller pushes', () => {
    // The rider's legs do not bank with the deck, so a steep lean separates the feet from it.
    const board = createBoard()
    board.update(0, true, 0, 50)
    const clamped = Math.abs(board.object.rotation.z)
    board.update(0, true, 0, 1)
    expect(Math.abs(board.object.rotation.z)).toBeCloseTo(clamped, 6)
    expect(clamped).toBeLessThan(0.5)
  })

  it('packs the cushion tighter as the accumulator fills', () => {
    // The only place the scooter's hidden speed tier is visible at all, and deliberately as a
    // hint rather than a readout -- see `scooter.ts`, which keeps it off the HUD.
    const board = createBoard()
    board.update(0, true, 0, 0)
    const cold = cushionMaterialOf(board).opacity
    board.update(0, true, 1, 0)
    expect(cushionMaterialOf(board).opacity).toBeGreaterThan(cold)
  })

  it('forgets its bob when stowed, so redeploying does not pop', () => {
    const board = createBoard()
    for (let i = 0; i < 20; i++) board.update(1 / 60, true, 0, 0)
    board.update(1 / 60, false, 0, 0)
    board.update(0, true, 0, 0)
    // Back to the top of the cycle, where sin is zero, rather than wherever it was stowed.
    expect(board.object.position.y).toBeCloseTo(0, 6)
  })

  it('survives a corrupted frame time rather than flinging the deck to NaN', () => {
    const board = createBoard()
    board.update(Number.NaN, true, 0, 0)
    expect(Number.isFinite(board.object.position.y)).toBe(true)
    board.update(-5, true, 0, 0)
    expect(Number.isFinite(board.object.position.y)).toBe(true)
  })

  it('keeps the cushion out of the shadow pass, like every other soft tell', () => {
    const board = createBoard()
    const cushion = board.object.getObjectByName('cushion')
    expect(cushion?.userData.excludeFromShadows).toBe(true)
  })
})
