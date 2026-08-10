import { describe, it, expect } from 'vitest'
import { settingsRows, type SettingsRow } from './settings-rows'
import {
  defaultSettings, SENSITIVITY_MAX, SENSITIVITY_MIN, type Settings,
} from '../../core/settings'

const s = (over: Partial<Settings> = {}): Settings => ({ ...defaultSettings(false), ...over })

/**
 * Narrowed lookups, so a missing row surfaces as an `undefined` field rather than as a
 * type error at the call site. `noUncheckedIndexedAccess` is on, so indexing would need
 * a guard on every line anyway.
 */
const slider = (rows: readonly SettingsRow[], key: string) =>
  rows.find((r): r is Extract<SettingsRow, { kind: 'slider' }> =>
    r.kind === 'slider' && r.key === key)

const toggle = (rows: readonly SettingsRow[], key: string) =>
  rows.find((r): r is Extract<SettingsRow, { kind: 'toggle' }> =>
    r.kind === 'toggle' && r.key === key)

describe('settingsRows', () => {
  it('gives every field of Settings exactly one row', () => {
    // The expected key list is derived from a real Settings object rather than written
    // out here, which is the whole point of this test: a field added to Settings without
    // a row in the panel fails here instead of shipping as a setting nobody can reach.
    const expected = Object.keys(s()).sort()
    const actual = settingsRows(s()).map((row) => row.key).sort()
    expect(actual).toEqual(expected)
  })

  it('takes the sensitivity slider bounds from the clamp the model already enforces', () => {
    // Not 0.25 and 4 written out again: readSettings clamps to these two constants, so a
    // slider with its own copy of the numbers could offer a value the model would reject.
    const row = slider(settingsRows(s()), 'sensitivity')
    expect(row?.min).toBe(SENSITIVITY_MIN)
    expect(row?.max).toBe(SENSITIVITY_MAX)
  })

  it('carries the sensitivity value through', () => {
    expect(slider(settingsRows(s({ sensitivity: 2.5 })), 'sensitivity')?.value).toBe(2.5)
  })

  it('gives the volume slider the full 0-to-1 range and carries its value through', () => {
    const row = slider(settingsRows(s({ volume: 0.3 })), 'volume')
    expect(row?.min).toBe(0)
    expect(row?.max).toBe(1)
    expect(row?.value).toBe(0.3)
  })

  it('offers a step small enough to be usable on both sliders', () => {
    const rows = settingsRows(s())
    expect(slider(rows, 'sensitivity')?.step).toBeGreaterThan(0)
    expect(slider(rows, 'sensitivity')?.step).toBeLessThanOrEqual(0.1)
    expect(slider(rows, 'volume')?.step).toBeGreaterThan(0)
    expect(slider(rows, 'volume')?.step).toBeLessThanOrEqual(0.1)
  })

  it('shows sensitivity as a multiplier, and a different one for a different value', () => {
    expect(slider(settingsRows(s({ sensitivity: 1 })), 'sensitivity')?.display).toBe('1.00×')
    expect(slider(settingsRows(s({ sensitivity: 2.5 })), 'sensitivity')?.display).toBe('2.50×')
  })

  it('shows volume as a percentage, and a different one for a different value', () => {
    expect(slider(settingsRows(s({ volume: 0.7 })), 'volume')?.display).toBe('70%')
    expect(slider(settingsRows(s({ volume: 0.35 })), 'volume')?.display).toBe('35%')
  })

  it('reflects invertY both ways', () => {
    expect(toggle(settingsRows(s({ invertY: false })), 'invertY')?.on).toBe(false)
    expect(toggle(settingsRows(s({ invertY: true })), 'invertY')?.on).toBe(true)
  })

  it('reflects muted both ways', () => {
    expect(toggle(settingsRows(s({ muted: false })), 'muted')?.on).toBe(false)
    expect(toggle(settingsRows(s({ muted: true })), 'muted')?.on).toBe(true)
  })

  it('reflects reduceMotion both ways', () => {
    expect(toggle(settingsRows(s({ reduceMotion: false })), 'reduceMotion')?.on).toBe(false)
    expect(toggle(settingsRows(s({ reduceMotion: true })), 'reduceMotion')?.on).toBe(true)
  })

  it('leaves the volume slider showing the stored level while muted', () => {
    // Mute is its own row, and the slider keeps showing what unmuting will restore.
    // Reading effectiveVolume here instead would draw a 0% slider whose stored value the
    // player cannot see, and the first drag would then start from a level they never set.
    const rows = settingsRows(s({ volume: 0.7, muted: true }))
    expect(slider(rows, 'volume')?.value).toBe(0.7)
    expect(slider(rows, 'volume')?.display).toBe('70%')
    expect(toggle(rows, 'muted')?.on).toBe(true)
  })

  it('labels every row with something a player can read', () => {
    for (const row of settingsRows(s())) expect(row.label.length).toBeGreaterThan(0)
  })
})
