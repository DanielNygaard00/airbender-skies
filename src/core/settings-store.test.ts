import { describe, it, expect } from 'vitest'
import { loadSettings, writeSettings, SETTINGS_KEY } from './settings-store'
import { defaultSettings } from './settings'
import { DEFAULT_QUALITY } from './quality'
import type { StorageLike } from './save'

function memory(initial: Record<string, string> = {}): StorageLike {
  const data = { ...initial }
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v } }
}
const hostile: StorageLike = {
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('quota exceeded') },
}

describe('loadSettings', () => {
  it('returns defaults when storage is empty', () => {
    expect(loadSettings(memory(), false)).toEqual(defaultSettings(false))
  })

  it('honours prefersReducedMotion on an empty store', () => {
    expect(loadSettings(memory(), true).reduceMotion).toBe(true)
  })

  it('round-trips a written settings object', () => {
    const s = memory()
    const written = { sensitivity: 2.5, invertY: true, volume: 0.4, muted: true, reduceMotion: true, quality: DEFAULT_QUALITY }
    writeSettings(s, written)
    expect(loadSettings(s, false)).toEqual(written)
  })

  it('falls back on malformed JSON rather than throwing', () => {
    expect(loadSettings(memory({ [SETTINGS_KEY]: '{not json' }), false)).toEqual(defaultSettings(false))
  })

  it('falls back when the stored value is valid JSON but not an object', () => {
    expect(loadSettings(memory({ [SETTINGS_KEY]: '42' }), false)).toEqual(defaultSettings(false))
  })

  it('falls back only the bad field of a stored payload, keeping the rest', () => {
    const raw = JSON.stringify({ sensitivity: 'fast', invertY: true, volume: 0.4, muted: true, reduceMotion: true })
    const result = loadSettings(memory({ [SETTINGS_KEY]: raw }), false)
    expect(result.sensitivity).toBe(1)
    expect(result.invertY).toBe(true)
    expect(result.volume).toBe(0.4)
    expect(result.muted).toBe(true)
    expect(result.reduceMotion).toBe(true)
  })

  it('survives storage that throws on read', () => {
    expect(loadSettings(hostile, false)).toEqual(defaultSettings(false))
  })
})

describe('writeSettings', () => {
  it('reports success on a working store', () => {
    expect(writeSettings(memory(), defaultSettings(false))).toBe(true)
  })

  it('reports failure instead of throwing when storage is full', () => {
    expect(writeSettings(hostile, defaultSettings(false))).toBe(false)
  })
})
