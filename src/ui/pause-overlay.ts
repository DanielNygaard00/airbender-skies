import type { OverlayModel } from '../core/pause'

/**
 * The card shown when the game is not running.
 *
 * Untested, like `createHud` and `createGuide`: the test environment is node, so there is
 * no DOM to build against. The decision about what the card says, and whether it is shown
 * at all, lives in `src/core/pause.ts` and is tested there.
 */
const STYLE = `
.pause { position: fixed; inset: 0; display: grid; place-items: center;
  /* Never interactive. The canvas underneath owns the click that requests the pointer
     lock, and a panel that can swallow that click breaks the lock -- the same reason
     src/ui/guide/panel.ts gives for its own pointer-events: none. */
  pointer-events: none;
  background: rgba(11,16,32,.55); opacity: 0; transition: opacity .2s;
  font: 500 16px/1.5 system-ui, sans-serif; color: #f3f6fb; }
.pause.is-on { opacity: 1; }
.pause-card { text-align: center; padding: 28px 40px; border-radius: 12px;
  background: rgba(11,16,32,.72); box-shadow: 0 8px 40px rgba(0,0,0,.45); }
.pause-title { margin: 0 0 14px; font-size: 28px; font-weight: 600;
  letter-spacing: .01em; }
.pause-action { margin: 0; }
.pause-hint { margin: 14px 0 0; font-size: 13px; opacity: .5; }
`

export function createPauseOverlay(parent: HTMLElement) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'pause'
  root.innerHTML = `
    <div class="pause-card">
      <p class="pause-title" data-title></p>
      <p class="pause-action" data-action></p>
      <p class="pause-hint" data-hint></p>
    </div>
  `
  parent.append(root)

  const title = root.querySelector('[data-title]') as HTMLElement
  const action = root.querySelector('[data-action]') as HTMLElement
  const hint = root.querySelector('[data-hint]') as HTMLElement

  return {
    update(model: OverlayModel): void {
      root.classList.toggle('is-on', model.visible)
      // Written even while invisible, so the card never fades in showing the previous
      // reason's wording for the length of the transition.
      title.textContent = model.title
      action.textContent = model.action
      hint.textContent = model.hint
    },
    dispose(): void {
      root.remove()
      style.remove()
    },
  }
}
