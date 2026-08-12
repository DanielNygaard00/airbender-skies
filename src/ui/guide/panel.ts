import type { PlayerMode } from '../../core/types'
import type { Settings } from '../../core/settings'
import type { WindKind } from '../../world/wind'
import { ACTIONS, type ActionContext } from './actions'
import {
  COMBOS, ELEMENT_LEGEND, METERS, WIND_LEGEND, SCREEN_MARKS, type Combo, type MeterNote,
} from './reference'
import type { Element } from '../../elements/element'
import { patchForRow, settingsRows, type SettingsRow } from './settings-rows'

/**
 * The guide panel: a pure model function, then the DOM, split the way hud.ts splits.
 *
 * The panel never reads game state. It is handed a model and draws it, which is what
 * keeps the interesting half testable in a node environment.
 */
export interface GuideRow {
  key: string
  press?: string
  name: string
  detail: string
  available: boolean
}

export interface GuideModel {
  ground: GuideRow[]
  glider: GuideRow[]
  /** So the panel can emphasise the column that applies right now. */
  current: PlayerMode
  combos: readonly Combo[]
  meters: readonly MeterNote[]
  /** The two rings around the crosshair. Separate from `meters`: markers, not bars. */
  screenMarks: readonly MeterNote[]
  /** What each element is for. Its own section: this is a stance, not a meter or a marker. */
  elements: Record<Element, string>
  /** Which element is selected, so the section can mark it. */
  currentElement: Element
  wind: Record<WindKind, string>
}

export function guideModelFor(ctx: ActionContext): GuideModel {
  const rows = (mode: PlayerMode): GuideRow[] => ACTIONS
    .filter((action) => action.mode === mode || action.mode === 'both')
    .map((action) => ({
      key: action.key,
      ...(action.press === undefined ? {} : { press: action.press }),
      name: action.name,
      detail: action.detail,
      available: action.available(ctx),
    }))

  return {
    ground: rows('ground'),
    glider: rows('glider'),
    current: ctx.player.mode,
    combos: COMBOS,
    meters: METERS,
    screenMarks: SCREEN_MARKS,
    elements: ELEMENT_LEGEND,
    currentElement: ctx.element,
    wind: WIND_LEGEND,
  }
}

/**
 * Exported for one assertion, not for reuse: `pointer-events` is the only rule in here
 * whose deletion changes behaviour rather than looks, and it fails silently — the panel
 * still renders, the rows still carry their class, and nothing in a node test environment
 * notices that a click can no longer reach them. Counting `.guide-setting` classes in the
 * markup asserts the marker; asserting the rule is what asserts the opt-in.
 */
export const STYLE = `
.guide { position: fixed; inset: 0; display: none; overflow-y: auto;
  background: rgba(8,14,22,.86); color: #f3f6fb; pointer-events: none;
  font: 400 13px/1.5 system-ui, sans-serif; padding: 24px clamp(16px, 5vw, 64px); }
.guide.is-open { display: block; }
.guide h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.guide .guide-sub { opacity: .6; margin: 0 0 16px; }
.guide h2 { font-size: 14px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; opacity: .75; margin: 16px 0 6px; }
.guide-cols { display: flex; flex-wrap: wrap; gap: 32px; }
.guide-col { flex: 1 1 320px; min-width: 0; transition: opacity .2s; }
.guide-col.is-dim { opacity: .45; }
.guide-row { display: flex; gap: 10px; padding: 3px 0; align-items: baseline; }
.guide-row.is-off { opacity: .38; }
.guide-row.is-off .guide-name { text-decoration: line-through; }
.guide-key { flex: 0 0 132px; font-family: ui-monospace, monospace; font-size: 12px;
  color: #d9f4ff; }
.guide-key .guide-press { opacity: .55; }
.guide-name { font-weight: 600; }
.guide-detail { opacity: .72; }
.guide-note { padding: 4px 0; }
.guide-note-name { font-weight: 600; color: #ffe9a8; }
.guide-settings { display: flex; flex-direction: column; max-width: 460px; }
/* The one exception to the panel's pointer-events: none — see the comment in the keydown
   handler for why the rest of the panel keeps it, and why these rows are safe to opt out. */
.guide-setting { display: flex; gap: 10px; align-items: center; padding: 4px 0;
  pointer-events: auto; }
.guide-setting-label { flex: 0 0 168px; }
.guide-setting input { accent-color: #8fd8ff; }
.guide-setting input[type=range] { flex: 1 1 140px; min-width: 0; }
.guide-setting-value { flex: 0 0 52px; text-align: right;
  font-family: ui-monospace, monospace; font-size: 12px; color: #d9f4ff; }
`

/** Column headings, so the markup does not repeat the strings. */
const HEADINGS: Record<PlayerMode, string> = { ground: 'On foot', glider: 'In the glider' }

export interface Guide {
  isOpen(): boolean
  open(): void
  close(): void
  toggle(): void
  /**
   * `settings` is a second required argument rather than a field on `GuideModel`, because
   * `guideModelFor` derives its model from an `ActionContext` — game state — and the
   * player's preferences are not that. Required rather than optional so a caller that
   * forgets them fails the typecheck; `main.ts` is the only caller and has no tests.
   */
  update(model: GuideModel, settings: Settings): void
  dispose(): void
}

/**
 * Escape text for use as HTML text content.
 *
 * Safe to drop between tags. NOT safe inside an attribute value — it does not escape
 * quotes, so a caller that interpolates escaped text into `href="..."` or similar
 * would still be exposed to attribute-breakout injection. Every call site here only
 * ever places the result between tags.
 */
export function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function rowHtml(row: GuideRow): string {
  const press = row.press === undefined ? '' : ` <span class="guide-press">${escape(row.press)}</span>`
  return `<div class="guide-row${row.available ? '' : ' is-off'}">
    <span class="guide-key">${escape(row.key)}${press}</span>
    <span><span class="guide-name">${escape(row.name)}</span>
    <span class="guide-detail">— ${escape(row.detail)}</span></span>
  </div>`
}

export function columnHtml(mode: PlayerMode, rows: GuideRow[], current: PlayerMode): string {
  return `<div class="guide-col${mode === current ? '' : ' is-dim'}">
    <h2>${HEADINGS[mode]}</h2>${rows.map(rowHtml).join('')}
  </div>`
}

export function notesHtml(title: string, notes: readonly { name: string; detail: string }[]): string {
  return `<h2>${title}</h2>${notes.map((note) => `<div class="guide-note">
    <span class="guide-note-name">${escape(note.name)}</span>
    <span class="guide-detail">— ${escape(note.detail)}</span></div>`).join('')}`
}

/**
 * One settings row.
 *
 * `data-setting` carries the key back to the delegated listener in `createGuide`, so the
 * rows can be rebuilt from a string without wiring a listener per control. `data-display`
 * marks the value readout so it can be refreshed in place mid-drag.
 *
 * Only `label` is interpolated text, and it goes between tags where `escape` is safe. Every
 * attribute value here is either a fixed key from the `SettingsRow` union or a number, so
 * nothing reaches an attribute that `escape`'s documented quote limitation would apply to.
 */
export function settingRowHtml(row: SettingsRow): string {
  const label = `<span class="guide-setting-label">${escape(row.label)}</span>`
  if (row.kind === 'toggle') {
    return `<label class="guide-setting">${label}
      <input type="checkbox" data-setting="${row.key}"${row.on ? ' checked' : ''}>
    </label>`
  }
  return `<label class="guide-setting">${label}
    <input type="range" data-setting="${row.key}" min="${row.min}" max="${row.max}"
      step="${row.step}" value="${row.value}">
    <span class="guide-setting-value" data-display="${row.key}">${escape(row.display)}</span>
  </label>`
}

export function settingsHtml(rows: readonly SettingsRow[]): string {
  return `<h2>Settings</h2><div class="guide-settings">${rows.map(settingRowHtml).join('')}</div>`
}

/**
 * Build the panel and give it its own keyboard.
 *
 * The guide deliberately does not go through InputState. The stepper runs fixed
 * sub-steps and can call update more than once per rendered frame, so one sampled
 * input shared across those sub-steps would let an edge-triggered action fire twice —
 * a single Space spending two jumps. Handling open/close and scrolling directly, the
 * way the canvas already handles its pointer-lock click, avoids that entirely.
 */
export function createGuide(
  parent: HTMLElement,
  onToggle: () => void,
  /**
   * One changed field per call, so the caller merges rather than replaces. The panel does
   * not own the settings — it is handed them by `update` and reports edits back.
   */
  onSettingsChange: (patch: Partial<Settings>) => void,
): Guide {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'guide'
  parent.append(root)

  let open = false
  /**
   * The settings as last rendered, so an edit can be merged into them without asking the
   * caller for them again mid-gesture. Re-seeded from the caller's copy on every `update`,
   * which is every open, so the only divergence possible is the panel's own unreported
   * edits — and those are reported synchronously in `onInput` below.
   */
  let rendered: Settings | null = null
  let rows: readonly SettingsRow[] = []

  const api: Guide = {
    isOpen: () => open,
    open(): void {
      if (open) return
      open = true
      root.classList.add('is-open')
      // The whole settings panel depends on this line. While the canvas holds the pointer
      // lock there is no visible cursor, so nothing here can be clicked or dragged;
      // releasing the lock is what makes a mouse-driven panel possible at all.
      //
      // It costs nothing, and that is not obvious from either module involved. Releasing
      // the lock is itself a pause reason — but `pauseReason` in `src/core/pause.ts` is
      // ordered `guide`, then `hidden`, then `unlocked`, so with the guide open the reason
      // stays `'guide'` and `pauseOverlayModel` returns an invisible card: the player does
      // not get a "Click to resume" card stacked on top of the panel they just opened.
      // Closing the guide then leaves them genuinely unlocked, which drops them into
      // exactly the click-to-resume flow Escape already uses. `pause.test.ts` enumerates
      // all eight input combinations, so that ordering is asserted; what is not asserted
      // anywhere is that this call is what depends on it. Do not remove it.
      document.exitPointerLock()
      onToggle()
    },
    close(): void {
      if (!open) return
      open = false
      root.classList.remove('is-open')
      onToggle()
    },
    toggle(): void {
      if (open) api.close()
      else api.open()
    },
    update(model: GuideModel, settings: Settings): void {
      rendered = settings
      rows = settingsRows(settings)
      root.innerHTML = `
        <h1>Everything you can do</h1>
        <p class="guide-sub">The game is paused and the mouse is yours, so the settings at
          the bottom can be dragged and clicked. H or Escape to close, arrow keys or
          Page Up / Page Down to scroll, Home / End to jump to the ends. Struck-through
          actions are unavailable right now; the dimmed column is your other stance.</p>
        <div class="guide-cols">
          ${columnHtml('ground', model.ground, model.current)}
          ${columnHtml('glider', model.glider, model.current)}
        </div>
        ${notesHtml('Chains worth trying', model.combos.map((c) => ({
          name: c.name, detail: `${c.keys.join(' → ')} — ${c.detail}`,
        })))}
        ${notesHtml('The elements', Object.entries(model.elements).map(([element, detail]) => ({
          // The selected one is named as such in the entry's own title rather than by a class,
          // because this section is prose and the columns above already carry the strike-through
          // that marks what is and is not usable. A reader wants to know which of these they are
          // currently in, and the word is unambiguous where a highlight would need a legend.
          name: element === model.currentElement ? `${element} — selected` : element,
          detail,
        })))}
        ${notesHtml('The meters', model.meters)}
        ${notesHtml('Around the crosshair', model.screenMarks)}
        ${notesHtml('Wind', Object.entries(model.wind).map(([kind, detail]) => ({
          name: kind, detail,
        })))}
        ${settingsHtml(rows)}
      `
    },
    dispose(): void {
      window.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('input', onInput)
      root.remove()
      style.remove()
    },
  }

  /**
   * One delegated listener rather than one per control, because `update` replaces the
   * panel's whole `innerHTML` on every open and per-control listeners would go with it.
   *
   * `input` rather than `change` so a slider reports while it is being dragged: volume
   * and sensitivity are both things a player judges by feel, and a value that only
   * arrives on release cannot be judged that way. Checkboxes fire `input` too.
   */
  function onInput(e: Event): void {
    const target = e.target
    if (!(target instanceof HTMLInputElement)) return
    if (rendered === null) return
    const row = rows.find((r) => r.key === target.dataset.setting)
    if (!row) return

    // The key-to-field mapping lives in `settings-rows.ts`, next to the rows it mirrors,
    // because it is pure logic and here it would be untestable: swapping two of its five
    // branches type-checks and, while it sat in this function, reddened nothing at all.
    // `target` satisfies `RowInput` structurally, so the element goes straight in.
    const patch = patchForRow(row, target)
    if (patch === null) return

    rendered = { ...rendered, ...patch }
    rows = settingsRows(rendered)
    // The readouts are refreshed in place rather than by re-rendering the section: a
    // re-render replaces the very input element the player is dragging, which ends the
    // drag mid-gesture. Every slider is refreshed rather than only the edited one, which
    // costs two text writes and means a future row derived from another field cannot go
    // stale here.
    for (const r of rows) {
      if (r.kind !== 'slider') continue
      const readout = root.querySelector(`[data-display="${r.key}"]`)
      if (readout) readout.textContent = r.display
    }
    onSettingsChange(patch)
  }

  /** How far one Arrow press moves the panel, in pixels. */
  const SCROLL_STEP = 60

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'KeyH') {
      if (e.repeat) return
      e.preventDefault()
      api.toggle()
      return
    }
    if (!open) return
    if (e.code === 'Escape') {
      if (e.repeat) return
      api.close()
      return
    }
    // A focused slider keeps its own keys: Arrow, Page, Home and End all move a range
    // input, and the switch below would preventDefault them out from under it.
    //
    // Narrowed to `range` rather than every input. A checkbox uses none of these keys, so
    // yielding to one only cost the player the panel's scrolling while a toggle happened to
    // be focused — which, since Tab walks straight from the sensitivity slider into the
    // toggles, is most of the time a keyboard user spends in here.
    if (e.target instanceof HTMLInputElement && e.target.type === 'range') return
    // The panel keeps `pointer-events: none` so it can never swallow a click meant
    // for the canvas underneath — that would break pointer lock. That also takes it
    // out of hit-testing, so the mouse wheel cannot reach it and it is not focusable
    // for the browser's own keyboard scrolling. This is the replacement: scroll the
    // root element directly, on the keys a reader would already reach for. Repeats
    // are allowed through (unlike KeyH/Escape above) so holding a key keeps scrolling.
    //
    // The settings rows are the single exception, and only the rows: `.guide-setting`
    // takes `pointer-events: auto` (see STYLE). The rule above is about the click that
    // *requests* the lock, and by the time those rows are on screen `api.open()` has
    // deliberately released it — there is no lock left for a swallowed click to cost, and
    // the game is paused. That reasoning does not extend to the rest of the panel, which
    // covers the whole viewport: relaxing it there would put a full-screen click sink over
    // the canvas, and clicking to resume after closing the guide would stop working.
    switch (e.code) {
      case 'ArrowDown': root.scrollTop += SCROLL_STEP; break
      case 'ArrowUp': root.scrollTop -= SCROLL_STEP; break
      case 'PageDown': root.scrollTop += root.clientHeight; break
      case 'PageUp': root.scrollTop -= root.clientHeight; break
      case 'Home': root.scrollTop = 0; break
      case 'End': root.scrollTop = root.scrollHeight; break
      default: return
    }
    e.preventDefault()
  }

  window.addEventListener('keydown', onKeyDown)
  root.addEventListener('input', onInput)
  return api
}
