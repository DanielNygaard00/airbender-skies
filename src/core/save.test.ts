import { describe, it, expect } from 'vitest'
import { loadSave, writeSave, defaultSave, SAVE_KEY, type StorageLike } from './save'

function memory(initial: Record<string, string> = {}): StorageLike {
  const data = { ...initial }
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v } }
}
const hostile: StorageLike = {
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('quota exceeded') },
}

describe('loadSave', () => {
  it('returns a fresh save when storage is empty', () => {
    expect(loadSave(memory(), 100)).toEqual(defaultSave(100))
  })

  it('round-trips a written save', () => {
    const s = memory()
    writeSave(s, { collectedShrines: ['home', 'spire'], maxBreath: 120 })
    expect(loadSave(s, 100)).toEqual({ collectedShrines: ['home', 'spire'], maxBreath: 120 })
  })

  it('falls back on malformed JSON rather than throwing', () => {
    expect(loadSave(memory({ [SAVE_KEY]: '{not json' }), 100)).toEqual(defaultSave(100))
  })

  it('falls back when the stored value is not an object', () => {
    expect(loadSave(memory({ [SAVE_KEY]: '42' }), 100)).toEqual(defaultSave(100))
  })

  it('discards non-string shrine entries', () => {
    const raw = JSON.stringify({ collectedShrines: ['home', 7, null], maxBreath: 110 })
    expect(loadSave(memory({ [SAVE_KEY]: raw }), 100).collectedShrines).toEqual(['home'])
  })

  it('rejects an implausible maxBreath', () => {
    const raw = JSON.stringify({ collectedShrines: [], maxBreath: -5 })
    expect(loadSave(memory({ [SAVE_KEY]: raw }), 100).maxBreath).toBe(100)
  })

  it('survives storage that throws on read', () => {
    expect(loadSave(hostile, 100)).toEqual(defaultSave(100))
  })
})

describe('writeSave', () => {
  it('reports success on a working store', () => {
    expect(writeSave(memory(), defaultSave(100))).toBe(true)
  })

  it('reports failure instead of throwing when storage is full', () => {
    expect(writeSave(hostile, defaultSave(100))).toBe(false)
  })
})
