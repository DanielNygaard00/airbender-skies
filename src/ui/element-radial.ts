import type { Element, RadialModel } from '../elements/element'

/**
 * The element radial, and the badge it collapses into.
 *
 * One module for both, because they are one widget in two states: the badge is what the radial
 * looks like closed. Splitting them would mean two files agreeing about the element's label and
 * its colour, which is the kind of duplication that drifts — and the badge exists precisely so
 * the player knows what F and R will do without opening anything, so it has to say the same word
 * the radial says.
 *
 * Untested, like `createHud`, `createReticle`, `createPauseOverlay` and `createGuide`: the test
 * environment is node and there is no DOM to build against. Everything here that a test could
 * catch lives in `src/elements/element.ts` — the wedge geometry, the dead zone, which slot is
 * highlighted — and this file is left with a stylesheet, a class toggle and a transform.
 *
 * **Where it sits, and why not at the crosshair.** The middle of the screen is already three
 * concentric rings deep: the reticle at 20px, the hit-direction wedges at 54–74px, and the
 * off-screen threat chevrons at 84–104px. A radial drawn around the aim point would have to start
 * outside all of them, and it would still bury the two rings that tell the player where they are
 * being hit from — at exactly the moment they are being hit from somewhere, since the radial is
 * for use mid-fight. So it is anchored low and centred, in the empty band between the crosshair
 * cluster and the HUD meters. It can afford to be: the pointer input is *relative*, so the
 * highlight follows the flick direction wherever the widget is drawn, and a menu does not need to
 * be at the aim point the way an aim indicator does.
 */

/**
 * The word for each element, and the colour that means it.
 *
 * A `Record<Element, ...>` rather than a lookup with a fallback, so appending earth or fire to
 * `ELEMENT_ORDER` fails to compile until both are given a label and a colour. Cheaper and
 * stronger than a test that could be deleted — the same trick `WIND_LEGEND` uses to force a sixth
 * wind kind to be documented.
 *
 * The colours are the ones the world already uses for each element's effects, not new ones: air
 * takes the gust cone's cyan, water takes the grip's deeper blue-green and fire takes the burst
 * cone's orange-red, so the badge and the thing the key does are the same colour. Gold is
 * deliberately not among them — the Focus bar, the arm pip, the Avatar State vignette and the hot
 * reticle all mean "charged" or "this will land", and an element badge in gold would join a
 * conversation it is not part of. That constraint is what fire's colour is picked *away* from: an
 * amber or yellow flame would read as the Focus family, so the tint is pushed toward red, where
 * nothing else in the HUD lives except the hurt flash, which is full-screen rather than a swatch.
 */
const LOOKS: Record<Element, { label: string; colour: string }> = {
  air: { label: 'Air', colour: '#7fe4ff' },
  water: { label: 'Water', colour: '#2fb8d8' },
  // The sandstone the Stone Throw's reach is drawn in, `earth-reach.ts`'s `0xd9a066`. Warm and
  // light rather than a realistic rock grey, for the reason recorded there: a grey-brown effect
  // over grey-brown ground is one nobody sees, and the same colour has to work as a badge.
  earth: { label: 'Earth', colour: '#d9a066' },
  fire: { label: 'Fire', colour: '#ff5a2d' },
}

/**
 * How far each wedge's centre sits from the radial's own origin, in pixels.
 *
 * Large enough that four labels will not collide when earth and fire arrive: at 74px the four
 * cardinal positions are 104px apart from each other, which comfortably clears a label of a few
 * characters. Sized once for the full set rather than for today's two, so adding an element is an
 * append and not a re-layout.
 */
const SLOT_RADIUS = 74

/**
 * Where the radial is anchored, as viewport fractions.
 *
 * Horizontally centred, so the up/down/left/right flick directions map onto a widget that is
 * itself symmetric about the screen's centre line — a radial anchored off to one side would have
 * its wedges in directions that do not match the gesture. Vertically at 68%: below the chevron
 * ring's 104px reach around screen centre at any plausible window height, and above the HUD's own
 * bottom-left stack.
 */
const ANCHOR_X = 50
const ANCHOR_Y = 68

const STYLE = `
.elements { position: fixed; left: 0; top: 0; width: 0; height: 0;
  /* Never interactive, like every other overlay here. A click sink over the canvas would
     swallow the click that requests the pointer lock, which is how play resumes. Same
     reasoning as .reticle, .pause and the guide panel. */
  pointer-events: none;
  font: 600 12px/1 system-ui, sans-serif; letter-spacing: .06em;
  text-shadow: 0 1px 3px rgba(0,0,0,.6); }

/* The collapsed state: a dot and a word, sitting just above the HUD's meters. Positioned from
   the bottom-left in the same 20px gutter .hud uses, so the two read as one instrument rather
   than as two overlays that happen to be near each other. */
.elements-badge { position: fixed; left: 20px; bottom: 128px;
  display: flex; gap: 7px; align-items: center; transition: opacity .2s; }
.elements-badge-dot { width: 8px; height: 8px; border-radius: 50%; }
.elements-badge-label { color: #f3f6fb; opacity: .8; }

/* The open state. Hidden with display rather than opacity: a radial at zero opacity would still
   have its wedges laid out over the screen, and there is nothing to fade toward when the widget
   is not being used. */
.elements-radial { position: fixed; display: none; }
.elements-radial.is-open { display: block; }
/* A faint disc behind the wedges, so the labels have something to sit on over bright terrain
   and the player can see where the centre — the dead zone — is. */
.elements-radial-disc { position: absolute; left: 0; top: 0;
  width: ${SLOT_RADIUS * 2 + 44}px; height: ${SLOT_RADIUS * 2 + 44}px;
  margin: -${SLOT_RADIUS + 22}px 0 0 -${SLOT_RADIUS + 22}px; border-radius: 50%;
  background: rgba(8,14,22,.42); }
.elements-slot { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.elements-slot-inner { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; gap: 5px; align-items: center;
  /* Colour and opacity only. Nothing here grows, travels or pulses: the radial is not being
     looked at — that is the point of fixed slots and muscle memory — so motion on it would be
     motion in the player's periphery during a fight, paid for with nothing. This is also why
     there is no reduce-motion scalar reaching this file. */
  transition: opacity .1s; opacity: .5; }
.elements-slot-dot { width: 12px; height: 12px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.5); box-sizing: border-box; }
.elements-slot-label { color: #f3f6fb; }
/* The element in effect: fully opaque, so the player's current stance is legible even before
   they have moved the mouse far enough to highlight anything. */
.elements-slot.is-active .elements-slot-inner { opacity: .95; }
/* The element a release would land on: a ring around the dot, which is a shape change rather
   than only a brightness change — the active and highlighted slots are frequently the same one,
   and two states distinguished by opacity alone would be indistinguishable then. */
.elements-slot.is-highlighted .elements-slot-inner { opacity: 1; }
.elements-slot.is-highlighted .elements-slot-dot {
  box-shadow: 0 0 0 3px rgba(243,246,251,.85); }
/* An element the player has not unlocked. Struck through, matching how the guide panel marks an
   unavailable action, so the two say "you cannot do this" the same way. Nothing is dimmed today
   — isElementAvailable returns true for everything until acts exist — and the rule is here so
   that gating one element is a one-line change in one place. */
.elements-slot.is-locked .elements-slot-inner { opacity: .25; }
.elements-slot.is-locked .elements-slot-label { text-decoration: line-through; }
`

export interface ElementRadial {
  update(model: RadialModel): void
  /** Take the widget off screen entirely, for the paused and down-beat frames. */
  hide(): void
  dispose(): void
}

export function createElementRadial(parent: HTMLElement): ElementRadial {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'elements'
  root.innerHTML = `
    <div class="elements-badge">
      <span class="elements-badge-dot"></span>
      <span class="elements-badge-label"></span>
    </div>
    <div class="elements-radial">
      <div class="elements-radial-disc"></div>
    </div>
  `
  parent.append(root)

  const badge = root.querySelector('.elements-badge') as HTMLElement
  const badgeDot = root.querySelector('.elements-badge-dot') as HTMLElement
  const badgeLabel = root.querySelector('.elements-badge-label') as HTMLElement
  const radial = root.querySelector('.elements-radial') as HTMLElement

  radial.style.left = `${ANCHOR_X}%`
  radial.style.top = `${ANCHOR_Y}%`

  /**
   * One element per slot, created on first sight and then reused.
   *
   * Built lazily rather than from `ELEMENT_ORDER` up front, so this file needs no import of the
   * order and cannot disagree with `radialModel` about how many wedges there are. The same
   * grow-and-reuse shape `hit-direction-view.ts` and `off-screen-view.ts` use for their marks,
   * and for the same reason: rebuilding the markup every frame would churn the DOM sixty times a
   * second for a widget that changes one class.
   */
  const slots: HTMLElement[] = []

  function slotAt(index: number, count: number): HTMLElement {
    const existing = slots[index]
    if (existing) return existing
    const slot = document.createElement('div')
    slot.className = 'elements-slot'
    slot.innerHTML = `
      <div class="elements-slot-inner">
        <span class="elements-slot-dot"></span>
        <span class="elements-slot-label"></span>
      </div>
    `
    // Clockwise from straight up, matching `radialHighlight`'s `atan2(x, -y)` convention exactly:
    // slot 0 is up, and screen y grows downward, so the vertical offset is negated. Getting this
    // backwards would draw a radial that is a mirror of the one the gesture selects from, and
    // nothing else in the game would look wrong.
    const angle = (index / count) * Math.PI * 2
    slot.style.left = `${Math.sin(angle) * SLOT_RADIUS}px`
    slot.style.top = `${-Math.cos(angle) * SLOT_RADIUS}px`
    radial.append(slot)
    slots[index] = slot
    return slot
  }

  return {
    update(model: RadialModel): void {
      badge.style.display = ''
      radial.classList.toggle('is-open', model.open)

      for (const entry of model.slots) {
        const look = LOOKS[entry.element]
        if (entry.active) {
          badgeDot.style.background = look.colour
          badgeLabel.textContent = look.label
        }
        const slot = slotAt(entry.index, model.count)
        const dot = slot.querySelector('.elements-slot-dot') as HTMLElement
        const label = slot.querySelector('.elements-slot-label') as HTMLElement
        dot.style.background = look.colour
        label.textContent = look.label
        slot.classList.toggle('is-active', entry.active)
        slot.classList.toggle('is-highlighted', entry.highlighted)
        slot.classList.toggle('is-locked', !entry.available)
      }
    },

    /**
     * Both halves hidden, not just the ring.
     *
     * The badge goes too, because the paused and down-beat frames hide the reticle and both
     * marker rings for the same reason: nothing is being recomputed, so anything left on screen
     * is a stale claim — and during the down beat the HUD's own blackout is meant to be black.
     */
    hide(): void {
      badge.style.display = 'none'
      radial.classList.remove('is-open')
    },

    dispose(): void {
      root.remove()
      style.remove()
    },
  }
}
