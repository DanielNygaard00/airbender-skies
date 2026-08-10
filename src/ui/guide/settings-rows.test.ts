import { describe, it, expect } from 'vitest'
import { patchForRow, settingsRows, type SettingsRow } from './settings-rows'
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
    const rows = settingsRows(s())
    // The length assertion is not decoration: without it this loop is the one test in the
    // file that a `settingsRows` returning `[]` would leave green, because a loop over
    // nothing asserts nothing.
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.label.length).toBeGreaterThan(0)
  })
})

const rowFor = (key: string): SettingsRow => {
  // Taken from the real rows rather than written out, so these tests cannot pass against a
  // row shape the panel does not actually render.
  const row = settingsRows(s()).find((r) => r.key === key)
  if (!row) throw new Error(`no settings row for ${key}`)
  return row
}

describe('patchForRow', () => {
  it('patches exactly the field its row names, for every row', () => {
    // The test with the teeth. Swapping two branches of the mapping — `case 'muted':
    // return { invertY: on }` — type-checks, since every branch returns the same
    // `Partial<Settings>`, and it was undetectable while the mapping sat inside the DOM
    // half of `panel.ts`: the whole suite stayed green through exactly that substitution.
    const rows = settingsRows(s())
    // Same reason the label test counts first: a loop over an empty list asserts nothing,
    // and `settingsRows` returning `[]` would otherwise leave this one green.
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const patch = patchForRow(row, { value: '0.5', checked: true })
      expect(Object.keys(patch ?? {})).toEqual([row.key])
    }
  })

  it('reads a slider from the value and carries it through unrounded', () => {
    expect(patchForRow(rowFor('sensitivity'), { value: '2.15', checked: false }))
      .toEqual({ sensitivity: 2.15 })
    expect(patchForRow(rowFor('volume'), { value: '0.35', checked: false }))
      .toEqual({ volume: 0.35 })
  })

  it('reads a toggle from checked, both ways, and ignores the value', () => {
    // `value` on a checkbox is the string "on" whether it is checked or not, so a mapping
    // that read it would report every toggle as true.
    expect(patchForRow(rowFor('invertY'), { value: 'on', checked: true })).toEqual({ invertY: true })
    expect(patchForRow(rowFor('invertY'), { value: 'on', checked: false }))
      .toEqual({ invertY: false })
    expect(patchForRow(rowFor('muted'), { value: 'on', checked: true })).toEqual({ muted: true })
    expect(patchForRow(rowFor('muted'), { value: 'on', checked: false })).toEqual({ muted: false })
    expect(patchForRow(rowFor('reduceMotion'), { value: 'on', checked: true }))
      .toEqual({ reduceMotion: true })
    expect(patchForRow(rowFor('reduceMotion'), { value: 'on', checked: false }))
      .toEqual({ reduceMotion: false })
  })

  it('discards a slider value that is not a number', () => {
    // Storing NaN would be worse than dropping the edit: `readSettings` throws a non-finite
    // field away on the next load, silently and only for that one field, so the player's
    // sensitivity would revert without anything having told them.
    expect(patchForRow(rowFor('sensitivity'), { value: 'loud', checked: false })).toBeNull()
    expect(patchForRow(rowFor('volume'), { value: 'Infinity', checked: false })).toBeNull()
  })

  it('treats an empty slider value as 0 rather than discarding it', () => {
    // `Number('')` is 0, not NaN, so an empty value is not what the guard above catches —
    // and 0 is the right answer for both sliders anyway: silence for volume, and clamped up
    // to SENSITIVITY_MIN by `readSettings` for sensitivity. Asserted because the comment
    // this replaced claimed the guard covered the empty case, and it never did.
    expect(patchForRow(rowFor('volume'), { value: '', checked: false })).toEqual({ volume: 0 })
    expect(patchForRow(rowFor('sensitivity'), { value: '', checked: false }))
      .toEqual({ sensitivity: 0 })
  })

  it('keeps a slider value the model would clamp, rather than dropping it', () => {
    // Out of range is not the same as unparseable. `readSettings` clamps 9 to
    // SENSITIVITY_MAX, which is a value the player gets; dropping the edit here would
    // instead leave the slider showing a position that never took effect.
    expect(patchForRow(rowFor('sensitivity'), { value: '9', checked: false }))
      .toEqual({ sensitivity: 9 })
  })
})
