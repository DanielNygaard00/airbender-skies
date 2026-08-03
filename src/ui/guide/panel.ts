import type { PlayerMode } from '../../core/types'
import type { WindKind } from '../../world/wind'
import { ACTIONS, type ActionContext } from './actions'
import { COMBOS, METERS, WIND_LEGEND, type Combo, type MeterNote } from './reference'

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
    wind: WIND_LEGEND,
  }
}

const STYLE = `
.guide { position: fixed; inset: 0; display: none; overflow-y: auto;
  background: rgba(8,14,22,.86); color: #f3f6fb; pointer-events: none;
  font: 400 13px/1.5 system-ui, sans-serif; padding: 32px clamp(16px, 5vw, 64px); }
.guide.is-open { display: block; }
.guide h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.guide .guide-sub { opacity: .6; margin: 0 0 24px; }
.guide h2 { font-size: 14px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; opacity: .75; margin: 24px 0 8px; }
.guide-cols { display: flex; flex-wrap: wrap; gap: 32px; }
.guide-col { flex: 1 1 320px; min-width: 0; transition: opacity .2s; }
.guide-col.is-dim { opacity: .45; }
.guide-row { display: flex; gap: 10px; padding: 4px 0; align-items: baseline; }
.guide-row.is-off { opacity: .38; }
.guide-row.is-off .guide-name { text-decoration: line-through; }
.guide-key { flex: 0 0 132px; font-family: ui-monospace, monospace; font-size: 12px;
  color: #d9f4ff; }
.guide-key .guide-press { opacity: .55; }
.guide-name { font-weight: 600; }
.guide-detail { opacity: .72; }
.guide-note { padding: 6px 0; }
.guide-note-name { font-weight: 600; color: #ffe9a8; }
`

/** Column headings, so the markup does not repeat the strings. */
const HEADINGS: Record<PlayerMode, string> = { ground: 'On foot', glider: 'In the glider' }

export interface Guide {
  isOpen(): boolean
  open(): void
  close(): void
  toggle(): void
  update(model: GuideModel): void
  dispose(): void
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function rowHtml(row: GuideRow): string {
  const press = row.press === undefined ? '' : ` <span class="guide-press">${escape(row.press)}</span>`
  return `<div class="guide-row${row.available ? '' : ' is-off'}">
    <span class="guide-key">${escape(row.key)}${press}</span>
    <span><span class="guide-name">${escape(row.name)}</span>
    <span class="guide-detail">— ${escape(row.detail)}</span></span>
  </div>`
}

function columnHtml(mode: PlayerMode, rows: GuideRow[], current: PlayerMode): string {
  return `<div class="guide-col${mode === current ? '' : ' is-dim'}">
    <h2>${HEADINGS[mode]}</h2>${rows.map(rowHtml).join('')}
  </div>`
}

function notesHtml(title: string, notes: readonly { name: string; detail: string }[]): string {
  return `<h2>${title}</h2>${notes.map((note) => `<div class="guide-note">
    <span class="guide-note-name">${escape(note.name)}</span>
    <span class="guide-detail">— ${escape(note.detail)}</span></div>`).join('')}`
}

/**
 * Build the panel and give it its own keyboard.
 *
 * The guide deliberately does not go through InputState. The stepper runs fixed
 * sub-steps and can call update more than once per rendered frame, so one sampled
 * input shared across those sub-steps would let an edge-triggered action fire twice —
 * a single Space spending two jumps. Handling these two keys directly, the way the
 * canvas already handles its pointer-lock click, avoids that entirely.
 */
export function createGuide(parent: HTMLElement, onToggle: () => void): Guide {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'guide'
  parent.append(root)

  let open = false

  const api: Guide = {
    isOpen: () => open,
    open(): void {
      if (open) return
      open = true
      root.classList.add('is-open')
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
    update(model: GuideModel): void {
      root.innerHTML = `
        <h1>Everything you can do</h1>
        <p class="guide-sub">The game is paused. H or Escape to close. Struck-through
          actions are unavailable right now; the dimmed column is your other stance.</p>
        <div class="guide-cols">
          ${columnHtml('ground', model.ground, model.current)}
          ${columnHtml('glider', model.glider, model.current)}
        </div>
        ${notesHtml('Chains worth trying', model.combos.map((c) => ({
          name: c.name, detail: `${c.keys.join(' → ')} — ${c.detail}`,
        })))}
        ${notesHtml('The meters', model.meters)}
        ${notesHtml('Wind', Object.entries(model.wind).map(([kind, detail]) => ({
          name: kind, detail,
        })))}
      `
    },
    dispose(): void {
      window.removeEventListener('keydown', onKeyDown)
      root.remove()
      style.remove()
    },
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return
    if (e.code === 'KeyH') {
      e.preventDefault()
      api.toggle()
    } else if (e.code === 'Escape' && open) {
      api.close()
    }
  }

  window.addEventListener('keydown', onKeyDown)
  return api
}
