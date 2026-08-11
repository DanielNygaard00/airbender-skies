import { alpha, percent, radians } from './overlay-format'
import type { EnemyMarker } from '../fx/off-screen'

/**
 * The off-screen threat ring: one chevron per engaged soldier outside the frame, pointing
 * at where they are.
 *
 * Untested for the reason all three overlay views are — the test environment is node, so
 * there is no DOM to build against — and every decision it draws from is pure and tested
 * in `src/fx/off-screen.ts`.
 *
 * **Deliberately not scaled by any reduce-motion scalar**, exactly like the hit-direction
 * wedges, and for the same reason: it is information rather than motion. A chevron does
 * not shake, pulse, travel or grow. It fades in, tracks, and fades out. `motionScales`
 * zeroes `hurtFlash`, which is what makes screen-space information the thing that keeps a
 * fight playable in that mode — so scaling this would take away the help exactly where it
 * is needed most.
 */

/**
 * The enemy health bar's fill, and the same literal `src/combat/health-bar.ts` uses.
 *
 * Reused rather than picked: the player already reads this cooler red as "an enemy is the
 * subject", against the warm `#ff8f6b` the hit wedges and the player's own health bar share,
 * so the two rings speak different halves of a vocabulary the game has already taught.
 *
 * **What that does not do is make the two rings distinguishable — the shape and the radial
 * gap do that, and it is worth knowing by how little the colours differ before anyone tunes
 * them.** Measured: `#ff8f6b` is hue 14.6° and `#e4614a` is hue 9.0°, **5.6° apart**, so the
 * two differ mainly in saturation and value rather than in hue. At a glance, side by side and
 * small, they are close. The hollow V against the filled wedge and the 10 px gap between the
 * two radii are what a glance actually resolves; the colour is a reinforcement of a
 * distinction already made, not the distinction itself. If a future reader decides the palette
 * needs retuning, that 5.6° is the number to start from — and nobody has yet seen either ring
 * on a screen, so this whole choice is unjudged rather than settled.
 *
 * Copied rather than imported, like the hit wedge's colour: a look, not a contract, and
 * nothing breaks if the two drift.
 */
const MARKER_COLOUR = '#e4614a'

/**
 * The same hue family pushed to full saturation, for a soldier in its wind-up.
 *
 * Same family so the chevron still reads as an enemy; hot enough to separate from both
 * `MARKER_COLOUR` and the hit wedges' `#ff8f6b` at a glance, since all three can be on
 * screen at once. Deliberately not the Focus gold, which means something else entirely.
 */
const WINDING_COLOUR = '#ff3b21'

/*
 * Geometry, and why it is a rotation rather than a sine and a cosine.
 *
 * Each chevron is a tall transparent frame whose *bottom centre* is pinned to the ring's
 * origin — `transform-origin: 50% 100%` — with the visible shape drawn at its far end.
 * Rotating that frame swings the chevron around the origin at a fixed radius, so there is
 * no trigonometry in this file and no aspect-ratio correction to get wrong: a rotation is
 * a rotation whatever shape the window is, where an `x = cos θ` / `y = sin θ` placement in
 * viewport percentages would stretch the ring into an ellipse on any window that is not
 * square.
 *
 * **The rotation is `+bearing`, clockwise.** `bearingFromCamera` returns 0 dead ahead and
 * positive when the source is to the camera's screen-right; CSS positive rotation is also
 * clockwise on screen. `src/ui/hit-direction-view.ts` records the browser measurement that
 * established this — three marks driven at bearings 0, +π/2 and -π/2 landed at (0, -64),
 * (+64, 0) and (-64, 0) — and it carries over unchanged here because the bearing comes from
 * the same function. A sign flip would point the player away from the threat, and no test
 * in this repo can catch it: if you change the geometry below, measure it again the same
 * way.
 *
 * The chevron sits 84–104 px out, clear of the hit wedges' 54–74 px by 10 px, so a full
 * ring of both does not overlap.
 *
 * A `clip-path` polygon rather than the CSS border triangle `hit-direction-view.ts` prefers,
 * and the departure is the point: these two rings orbit the same origin and must not be
 * mistaken for one another. A border triangle cannot be hollow without a second element,
 * and a hollow V beside a filled wedge is the cheapest difference a glance can resolve —
 * cheaper than the colour, whose two hues are only 5.6 degrees apart (see `MARKER_COLOUR`).
 * The shape and the 10 px radial gap carry this distinction; the colour reinforces it.
 * Apex up — the chevron points away from the player, at the soldier.
 */
const STYLE = `
.offscr { position: fixed; left: 0; top: 0; width: 0; height: 0;
  /* Never interactive, like every other overlay in this project: a click sink over the
     canvas would swallow the click that requests the pointer lock, which is how play
     resumes. */
  pointer-events: none; }
.offscr-mark { position: absolute; left: 0; bottom: 0; width: 26px; height: 104px;
  margin-left: -13px; transform-origin: 50% 100%; }
.offscr-chevron { position: absolute; top: 0; left: 0; width: 26px; height: 20px;
  background: ${MARKER_COLOUR};
  clip-path: polygon(50% 0%, 100% 100%, 82% 100%, 50% 26%, 18% 100%, 0% 100%);
  filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
.offscr-mark.winding .offscr-chevron { background: ${WINDING_COLOUR}; }
`

/**
 * Where the chevrons are drawn around, as viewport fractions from the top-left.
 *
 * Declared here rather than shared with `HitDirectionOrigin`: it is two structural fields
 * that a `ReticleModel` already satisfies, so a shared name would couple two views for no
 * benefit.
 */
export interface OffScreenOrigin {
  x: number
  y: number
}

export function createOffScreen(parent: HTMLElement) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const root = document.createElement('div')
  root.className = 'offscr'
  parent.append(root)

  /**
   * One element per concurrent chevron, grown on demand and never shrunk.
   *
   * The same pool `createHitDirection` uses and for the same reason: this runs once per
   * rendered frame, and reparsing markup at 120 Hz to draw a handful of shapes would be
   * the one piece of per-frame allocation in the whole overlay layer. It never shrinks
   * because the high-water mark is the size of the patrol, which is small, and a hidden
   * `div` costs nothing.
   */
  const marks: HTMLElement[] = []

  function markAt(index: number): HTMLElement {
    const existing = marks[index]
    if (existing) return existing
    const mark = document.createElement('div')
    mark.className = 'offscr-mark'
    mark.innerHTML = '<div class="offscr-chevron"></div>'
    root.append(mark)
    marks[index] = mark
    return mark
  }

  return {
    /**
     * Draw one chevron per marker, around `origin`.
     *
     * `origin` is the reticle's own position rather than screen centre, so the reticle and
     * both rings read as one instrument. The caller decides what to pass when the reticle
     * is hidden; this file has no opinion about it.
     */
    update(markers: readonly EnemyMarker[], origin: OffScreenOrigin): void {
      root.style.display = 'block'
      root.style.left = percent(origin.x)
      root.style.top = percent(origin.y)

      for (let i = 0; i < Math.max(marks.length, markers.length); i += 1) {
        const mark = markAt(i)
        const model = markers[i]
        if (!model) {
          // Hidden rather than removed, so the pool above stays valid.
          mark.style.display = 'none'
          continue
        }
        mark.style.display = 'block'
        // Radians directly: CSS takes them, and converting to degrees here would be a
        // second place the sign convention could be inverted by accident.
        mark.style.transform = `rotate(${radians(model.bearing)})`
        mark.style.opacity = alpha(model.strength)
        // A class rather than writing the colour, so the two tints stay in the stylesheet
        // together where a reader comparing them does not have to look in two places.
        mark.classList.toggle('winding', model.winding)
      }
    },
    /**
     * Take every chevron off screen.
     *
     * Called from the paused branch of `frame()` and from the down beat, neither of which
     * has a fresh origin or a fresh marker list — `syncVisuals` is what produces both.
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
