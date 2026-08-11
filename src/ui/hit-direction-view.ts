import { HIT_MARK_SECONDS, type HitMark } from '../fx/hit-direction'

/**
 * The hit-direction indicator: one wedge per remembered hit, pointing at where it came from.
 *
 * Untested for the same reason `createHud` and `createReticle` are — the test environment is
 * node, so there is no DOM to build against — and the bearings, the ageing and the drop rule
 * are all pure and tested in `src/fx/hit-direction.ts`.
 *
 * **Deliberately not scaled by any reduce-motion scalar, and this is not an oversight.**
 * `motionScales` zeroes `hurtFlash`, so with reduce motion on this indicator is the player's
 * only feedback that they were hit beyond the health bar moving. It is information rather than
 * motion: a wedge does not shake, pulse, travel or grow, it fades and disappears, so there is
 * nothing vestibular in it to soften. `src/main.ts` says the same thing beside the two scalars
 * it does apply, because the inconsistency is what a future reader will want to "fix".
 */

/**
 * The health bar's warm tint, and the same literal `src/ui/hud.ts` uses for its own health
 * fill and its stall warning.
 *
 * Reused rather than picked, because a hit is exactly a health event: the player already reads
 * this colour as "your health is the subject", so the indicator needs no new vocabulary. Not
 * imported from `hud.ts` — that constant is private there and this is a look rather than a
 * contract, so the two are free to drift; nothing breaks if they do.
 */
const MARK_COLOUR = '#ff8f6b'

/*
 * Geometry, and why it is one rotation rather than a sine and a cosine.
 *
 * Each mark is a tall transparent frame whose *bottom centre* is pinned to the indicator's
 * origin — `transform-origin: 50% 100%` — with the visible wedge drawn at its far end. Rotating
 * that frame swings the wedge around the origin at a fixed radius, so there is no trigonometry
 * in this file and no aspect-ratio correction to get wrong: a rotation is a rotation whatever
 * shape the window is, where an `x = cos θ` / `y = sin θ` placement in viewport percentages
 * would stretch the ring into an ellipse on any window that is not square.
 *
 * **The rotation is `+bearing`, clockwise, and the sign is the one thing in this file that
 * matters.** `bearingFromCamera` returns 0 dead ahead and *positive when the source is to the
 * camera's screen-right* (verified in `hit-direction.test.ts` against a real `PerspectiveCamera`
 * basis, as signed values rather than magnitudes). CSS positive rotation is also clockwise on
 * screen. So a wedge that starts at the top and is rotated by `+bearing` lands to the right for
 * a hit from the right — and a sign flip here would point the player away from whatever hit
 * them, which no test in this repo can catch and which a reader cannot see by inspection.
 *
 * So it was measured instead. Driving this module in a browser with three marks and reading each
 * wedge's `getBoundingClientRect` centre relative to an origin at (0, 0): bearing 0 put it at
 * (0, -64) — straight up, screen coordinates growing downward — `+π/2` at (+64, 0) and `-π/2` at
 * (-64, 0). Right is right. If you change the geometry below, measure it again the same way; there
 * is nothing else that will tell you.
 *
 * The wedge sits 54–74 px out, well clear of the reticle's own 20 px ring, so the two read as
 * one instrument without the marks obscuring the aim point they are drawn around.
 */
const STYLE = `
.hitdir { position: fixed; left: 0; top: 0; width: 0; height: 0;
  /* Never interactive, like every other overlay in this project: a click sink over the canvas
     would swallow the click that requests the pointer lock, which is how play resumes. */
  pointer-events: none; }
.hitdir-mark { position: absolute; left: 0; bottom: 0; width: 26px; height: 74px;
  margin-left: -13px; transform-origin: 50% 100%; }
/* A CSS border triangle rather than a clip-path, for no better reason than that it needs no
   second element and no units the rest of this stylesheet does not already use. Apex up: the
   wedge points away from the player, at the source. */
.hitdir-wedge { position: absolute; top: 0; left: 0; width: 0; height: 0;
  border-left: 13px solid transparent; border-right: 13px solid transparent;
  border-bottom: 20px solid ${MARK_COLOUR};
  filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
`

/*
 * Every number this file writes into a `style` goes through one of these three, which round to
 * below anything visible: a thousandth of a percent is a hundredth of a pixel, 1e-5 radians is six
 * ten-thousandths of a degree, and a thousandth of an opacity step is under one 255th.
 *
 * The point is only to keep full-precision floats out of the DOM — every one of these is written
 * once per rendered frame, and a raw `atan2` result or a raw `life / HIT_MARK_SECONDS` is
 * regularly seventeen significant digits. It is **not** a correctness fix, in case the rounding
 * suggests one: CSS numbers accept exponent notation, checked in a browser rather than assumed
 * (`rotate(2.4e-17rad)` parses and reads back intact), so the unrounded values were never invalid.
 */
function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}%`
}

function radians(angle: number): string {
  return `${angle.toFixed(5)}rad`
}

function alpha(value: number): string {
  return value.toFixed(3)
}

/** Where the wedges are drawn around, as viewport fractions from the top-left. */
export interface HitDirectionOrigin {
  x: number
  y: number
}

export function createHitDirection(parent: HTMLElement) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'hitdir'
  parent.append(root)

  /**
   * One element per concurrent mark, grown on demand and never shrunk.
   *
   * A pool rather than rewriting `innerHTML` each frame: this runs once per rendered frame,
   * and reparsing markup at 120 Hz to draw at most a handful of triangles would be the one
   * piece of per-frame allocation in the whole overlay layer. It never shrinks because the
   * high-water mark is the number of attacks that landed on the player inside 1.2 seconds,
   * which is small, and a hidden `div` costs nothing.
   */
  const marks: HTMLElement[] = []

  function markAt(index: number): HTMLElement {
    const existing = marks[index]
    if (existing) return existing
    const mark = document.createElement('div')
    mark.className = 'hitdir-mark'
    mark.innerHTML = '<div class="hitdir-wedge"></div>'
    root.append(mark)
    marks[index] = mark
    return mark
  }

  return {
    /**
     * Draw one wedge per live mark, around `origin`.
     *
     * `origin` is the reticle's own position rather than screen centre, so the two overlays
     * read as one instrument. The caller decides what to pass when the reticle is hidden;
     * this file has no opinion about it.
     */
    update(live: readonly HitMark[], origin: HitDirectionOrigin): void {
      root.style.display = 'block'
      root.style.left = percent(origin.x)
      root.style.top = percent(origin.y)

      for (let i = 0; i < Math.max(marks.length, live.length); i += 1) {
        const mark = markAt(i)
        const model = live[i]
        if (!model) {
          // Hidden rather than removed, so the pool above stays valid.
          mark.style.display = 'none'
          continue
        }
        mark.style.display = 'block'
        // Radians directly: CSS takes them, and converting to degrees here would be a second
        // place the sign convention could be inverted by accident.
        mark.style.transform = `rotate(${radians(model.bearing)})`
        // Fades out over its whole life rather than blinking off at the end. Not clamped:
        // `stepHitMarks` only ever hands back a life in (0, HIT_MARK_SECONDS], and clamping
        // would hide it if that ever stopped being true.
        mark.style.opacity = alpha(model.life / HIT_MARK_SECONDS)
      }
    },
    /**
     * Take every wedge off screen.
     *
     * Called from the paused branch of `frame()`, which has no origin to draw around because
     * `syncVisuals` — the thing that projects one — does not run while the game is paused. The
     * marks themselves are held in `main.ts` and are not stepped while paused either, so they
     * come back at the same age they were hidden at.
     */
    hide(): void {
      root.style.display = 'none'
    },
    dispose(): void {
      root.remove()
      style.remove()
    },
  }
}
