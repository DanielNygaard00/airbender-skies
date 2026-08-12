import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  guideModelFor, escape, rowHtml, columnHtml, notesHtml, settingRowHtml, settingsHtml, STYLE,
  type GuideRow,
} from './panel'
import { settingsRows } from './settings-rows'
import { defaultSettings } from '../../core/settings'
import type { ActionContext } from './actions'
import { DEFAULT_FLIGHT_CONFIG, DEFAULT_GROUND_CONFIG } from '../../core/config'
import { DEFAULT_COMBAT_CONFIG } from '../../combat/config'
import type { PlayerState } from '../../core/types'

const p = (over: Partial<PlayerState> = {}): PlayerState => ({
  mode: 'ground', position: new Vector3(), velocity: new Vector3(),
  forward: new Vector3(0, 0, 1), breath: 100, maxBreath: 100,
  grounded: true, lastGroundIslandId: null, airJumpsUsed: 0, chargeTime: 0,
  coyoteTime: 0, jumpBuffer: 0,
  scooterActive: false, scooterCharge: 0, dashesUsed: 0, dashRecovery: 0,
  slipstreamElapsed: null, slipstreamCooldown: 0,
  staffChain: 0, staffElapsed: null, staffRecovery: 0, staffSinceSwing: 0, ...over,
})

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  player: p(),
  ground: DEFAULT_GROUND_CONFIG,
  flight: DEFAULT_FLIGHT_CONFIG,
  wave: DEFAULT_COMBAT_CONFIG.pressureWave,
  gustReady: true,
  avatarStateReady: false,
  vortexReady: true,
  slipstreamReady: true,
  airWallReady: true,
  ...over,
})

const names = (rows: { name: string }[]) => rows.map((r) => r.name)

describe('guideModelFor', () => {
  it('puts a ground-only action in the ground column alone', () => {
    const model = guideModelFor(ctx())
    expect(names(model.ground)).toContain('Air blast dash')
    expect(names(model.glider)).not.toContain('Air blast dash')
  })

  it('puts a glider-only action in the glider column alone', () => {
    const model = guideModelFor(ctx())
    expect(names(model.glider)).toContain('Hover')
    expect(names(model.ground)).not.toContain('Hover')
  })

  it('puts a both-mode action in both columns', () => {
    const model = guideModelFor(ctx())
    expect(names(model.ground)).toContain('Gust')
    expect(names(model.glider)).toContain('Gust')
  })

  it('reports which mode the player is in', () => {
    expect(guideModelFor(ctx()).current).toBe('ground')
    expect(guideModelFor(ctx({ player: p({ mode: 'glider', grounded: false }) })).current)
      .toBe('glider')
  })

  it('keeps an unavailable action in the model rather than dropping it', () => {
    // The panel dims rather than hides. A tester needs to see that the dash exists and
    // is currently impossible — a vanished row reads as a missing feature.
    const airborne = guideModelFor(ctx({ player: p({ grounded: false }) }))
    const dash = airborne.ground.find((r) => r.name === 'Air blast dash')
    expect(dash).toBeDefined()
    expect(dash?.available).toBe(false)
  })

  it('marks an available action available', () => {
    const dash = guideModelFor(ctx()).ground.find((r) => r.name === 'Air blast dash')
    expect(dash?.available).toBe(true)
  })

  it('carries the reference sections through', () => {
    const model = guideModelFor(ctx())
    expect(model.combos.length).toBeGreaterThan(0)
    expect(model.meters.length).toBe(3)
    expect(Object.keys(model.wind).length).toBe(5)
  })

  it('carries the press qualifier through, so two actions on one key are told apart', () => {
    const rows = guideModelFor(ctx()).ground.filter((r) => r.key === 'Space')
    // Jump, charged jump, double jump and deploy all live on Space.
    expect(rows.length).toBe(4)
    for (const row of rows) expect(row.press?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('escape', () => {
  it('escapes ampersands, less-than and greater-than', () => {
    expect(escape('&')).toBe('&amp;')
    expect(escape('<')).toBe('&lt;')
    expect(escape('>')).toBe('&gt;')
  })

  it('leaves ordinary text alone', () => {
    expect(escape('tap to ride, tap to step off')).toBe('tap to ride, tap to step off')
  })

  it('renders a script tag inert', () => {
    const escaped = escape('<script>alert(1)</script>')
    expect(escaped).not.toContain('<script>')
    expect(escaped).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('HTML builders', () => {
  const row = (over: Partial<GuideRow> = {}) => ({
    key: 'Space', name: 'Jump', detail: 'A short hop.', available: true, ...over,
  })

  it('keeps a row whose name carries a script tag inert', () => {
    const html = rowHtml(row({ name: '<script>alert(1)</script>' }))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('keeps a row whose detail carries a script tag inert', () => {
    const html = rowHtml(row({ detail: '<script>alert(1)</script>' }))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('builds a column heading for the given mode', () => {
    const html = columnHtml('ground', [row()], 'ground')
    expect(html).toContain('On foot')
    expect(html).not.toContain('is-dim')
  })

  it('dims a column that is not the current mode', () => {
    const html = columnHtml('glider', [row()], 'ground')
    expect(html).toContain('is-dim')
  })

  it('builds a notes section and escapes each note', () => {
    const html = notesHtml('Wind', [{ name: '<script>x</script>', detail: 'ok' }])
    expect(html).toContain('Wind')
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
  })
})

describe('settings HTML builders', () => {
  it('carries a slider row\'s bounds, step and value into the input', () => {
    const html = settingRowHtml({
      kind: 'slider', key: 'volume', label: 'Volume', value: 0.7,
      min: 0, max: 1, step: 0.05, display: '70%',
    })
    expect(html).toContain('type="range"')
    expect(html).toContain('data-setting="volume"')
    expect(html).toContain('min="0"')
    expect(html).toContain('max="1"')
    expect(html).toContain('step="0.05"')
    expect(html).toContain('value="0.7"')
    expect(html).toContain('70%')
  })

  it('checks a toggle that is on and leaves one that is off unchecked', () => {
    const on = settingRowHtml({ kind: 'toggle', key: 'muted', label: 'Mute', on: true })
    const off = settingRowHtml({ kind: 'toggle', key: 'muted', label: 'Mute', on: false })
    expect(on).toContain('checked')
    expect(off).not.toContain('checked')
  })

  it('keeps a label carrying a script tag inert', () => {
    const html = settingRowHtml({
      kind: 'toggle', key: 'muted', label: '<script>alert(1)</script>', on: false,
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('gives every row the class that opts it into pointer events', () => {
    // The rows are the only part of the panel allowed to take a click, and the class is
    // what carries that. Counting them here is what would catch a row rendered without it.
    const rows = settingsRows(defaultSettings(false))
    const html = settingsHtml(rows)
    expect(html.split('class="guide-setting"').length - 1).toBe(rows.length)
    // Against a count derived from `Settings` too, not only from `rows.length`: both sides
    // of the comparison above come from the same `rows`, so a `settingsRows` that returned
    // nothing would satisfy it with 0 === 0.
    expect(rows.length).toBe(Object.keys(defaultSettings(false)).length)
  })

  it('keeps the stylesheet rule that class opts the rows into', () => {
    // The class is the marker; this is the behaviour. Deleting `pointer-events: auto` from
    // `.guide-setting` leaves the whole suite green and the panel looking identical, while
    // no click can reach a control — the panel root is `pointer-events: none` and there is
    // no DOM here to notice. The root's `none` is asserted alongside it because it is
    // load-bearing in the other direction: relaxing it there would put a full-screen click
    // sink over the canvas and break the click that resumes play.
    expect(STYLE).toMatch(/\.guide-setting\s*\{[^}]*pointer-events:\s*auto/)
    expect(STYLE).toMatch(/\.guide\s*\{[^}]*pointer-events:\s*none/)
  })
})
